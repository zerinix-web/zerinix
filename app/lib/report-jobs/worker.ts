import "server-only";

import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import {
  executePlanRequest,
  type PlanExecutionContext,
} from "@/app/lib/report-jobs/plan-executor";
import {
  planFieldLabels,
  planFields,
  type PlanReportField,
} from "@/app/lib/report-engine/prompts/plan";
import {
  domainAnalysisFieldLabels,
  domainAnalysisFields,
  type DomainAnalysisField,
  type SpecializedReportDomain,
} from "@/app/lib/report-engine/prompts/domain-analysis";
import {
  realEstateFieldLabels,
  realEstateFields,
  type RealEstateReportField,
} from "@/app/lib/report-engine/prompts/real-estate";
import type { ReportDomain } from "@/app/lib/report-engine/domain";
import type { ReportMetadata } from "@/app/lib/report-investment-score";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import {
  getResponseLanguage,
  getReportLanguageCode,
  repairReportLanguageSections,
  resolveReportLanguage,
  validateReportLanguageConsistency,
} from "@/app/lib/report-language";
import { expertiseProfileSchema } from "@/app/lib/ai/expertise-profile";
import { dynamicReportPlanSchema } from "@/app/lib/ai/dynamic-report-plan";
import { dynamicResearchPlanSchema } from "@/app/lib/ai/dynamic-research-plan";

const JOB_LEASE_SECONDS = 120;
const JOB_HEARTBEAT_MS = 20_000;
const TRANSIENT_RETRY_BASE_SECONDS = 30;
type ActiveWorkerStatus =
  | "claimed"
  | "extracting"
  | "researching"
  | "validating"
  | "generating"
  | "rendering_pdf";

type ReportJobRow = {
  id: string;
  user_id: string;
  status: string;
  progress: number;
  request_payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
};

type ParsedReport = {
  domain: ReportDomain;
  language: ResponseLanguage;
  sections: Array<{ field: string; title: string; content: string }>;
  metadata?: ReportMetadata;
  warnings: string[];
};

type QueueMetadata = {
  clientIp?: unknown;
  universalInput?: unknown;
  requestedPipeline?: unknown;
};

type ReportWorkerOptions = {
  defer?: (task: () => Promise<void>) => void;
  jobId?: string;
};

const ACTIVE_JOB_STATUSES = [
  "claimed",
  "extracting",
  "researching",
  "validating",
  "generating",
  "rendering_pdf",
] as const;

let targetedClaimRpcUnavailable = false;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function claimReportJobByIdWithoutRpc(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
  workerId: string
) {
  const { data: candidate, error: candidateError } = await supabase
    .from("report_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (candidateError) {
    throw new Error(`Targeted report job lookup failed: ${candidateError.message}`);
  }

  if (!candidate) {
    return null;
  }

  const job = candidate as ReportJobRow;
  const now = Date.now();
  const nextAttemptAt = job.next_attempt_at
    ? Date.parse(job.next_attempt_at)
    : null;
  const leaseExpiresAt = job.lease_expires_at
    ? Date.parse(job.lease_expires_at)
    : null;
  const pendingAndDue =
    (job.status === "queued" || job.status === "retry_wait") &&
    (nextAttemptAt === null || nextAttemptAt <= now);
  const expiredActiveLease =
    ACTIVE_JOB_STATUSES.includes(
      job.status as (typeof ACTIVE_JOB_STATUSES)[number]
    ) && leaseExpiresAt !== null && leaseExpiresAt <= now;

  if (
    job.attempt_count >= job.max_attempts ||
    (!pendingAndDue && !expiredActiveLease)
  ) {
    return null;
  }

  let claimQuery = supabase
    .from("report_jobs")
    .update({
      status: "claimed",
      progress_stage: "claimed",
      attempt_count: job.attempt_count + 1,
      next_attempt_at: null,
      lease_owner: workerId,
      lease_expires_at: new Date(
        now + JOB_LEASE_SECONDS * 1_000
      ).toISOString(),
      started_at: job.started_at || new Date(now).toISOString(),
    })
    .eq("id", job.id)
    .eq("status", job.status)
    .eq("attempt_count", job.attempt_count);

  claimQuery = job.lease_owner
    ? claimQuery.eq("lease_owner", job.lease_owner)
    : claimQuery.is("lease_owner", null);
  claimQuery = job.lease_expires_at
    ? claimQuery.eq("lease_expires_at", job.lease_expires_at)
    : claimQuery.is("lease_expires_at", null);
  claimQuery = job.next_attempt_at
    ? claimQuery.eq("next_attempt_at", job.next_attempt_at)
    : claimQuery.is("next_attempt_at", null);

  const { data: claimedJob, error: claimError } = await claimQuery
    .select("*")
    .maybeSingle();

  if (claimError) {
    throw new Error(`Targeted report job claim failed: ${claimError.message}`);
  }

  return (claimedJob as ReportJobRow | null) || null;
}

async function claimReportJob(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workerId: string,
  jobId?: string
) {
  if (!jobId) {
    return supabase.rpc("claim_report_job", {
      worker_id: workerId,
      lease_seconds: JOB_LEASE_SECONDS,
    });
  }

  if (!targetedClaimRpcUnavailable) {
    const result = await supabase.rpc("claim_report_job_by_id", {
      job_id: jobId,
      worker_id: workerId,
      lease_seconds: JOB_LEASE_SECONDS,
    });

    if (!result.error) {
      return result;
    }

    if (result.error.code !== "PGRST202") {
      return result;
    }

    targetedClaimRpcUnavailable = true;
    console.warn(
      "[report-jobs] targeted claim RPC unavailable; using exact-id optimistic claim"
    );
  }

  try {
    const data = await claimReportJobByIdWithoutRpc(supabase, jobId, workerId);
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function detectLanguage(payload: Record<string, unknown>): ResponseLanguage {
  return getResponseLanguage(resolveReportLanguage({
    explicitLanguage: payload.language,
    uiLanguage: payload.uiLanguage,
    browserLanguage: payload.browserLanguage,
    requestText: readString(payload.prompt),
  }));
}

function isSpecializedDomain(value: string): value is SpecializedReportDomain {
  return ["legal", "finance", "accounting", "operations", "procurement"].includes(
    value
  );
}

function getExpectedFields(domain: ReportDomain) {
  if (domain === "real_estate") {
    return realEstateFields as readonly string[];
  }

  if (isSpecializedDomain(domain)) {
    return domainAnalysisFields as readonly string[];
  }

  return planFields as readonly string[];
}

function getFieldTitle(
  domain: ReportDomain,
  language: ResponseLanguage,
  field: string
) {
  if (domain === "real_estate") {
    return realEstateFieldLabels[language][field as RealEstateReportField] || field;
  }

  if (isSpecializedDomain(domain)) {
    return domainAnalysisFieldLabels[language][field as DomainAnalysisField] || field;
  }

  return planFieldLabels[language][field as PlanReportField] || field;
}

function inferDomain(
  payload: Record<string, unknown>,
  events: Array<Record<string, unknown>>
): ReportDomain {
  const eventDomain = events.map((event) => readString(event.reportDomain)).find(Boolean);
  const payloadDomain = readString(payload.reportDomain);
  const candidate = eventDomain || payloadDomain;

  if (
    candidate === "real_estate" ||
    candidate === "business" ||
    isSpecializedDomain(candidate)
  ) {
    return candidate;
  }

  if (events.some((event) => realEstateFields.some((field) => field in event))) {
    return "real_estate";
  }

  if (events.some((event) => domainAnalysisFields.some((field) => field in event))) {
    return "legal";
  }

  return "business";
}

async function readExecutionResponse(
  response: Response,
  payload: Record<string, unknown>
): Promise<ParsedReport> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const message = readString(body?.error) || `Report executor returned HTTP ${response.status}.`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const raw = await response.text();
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const warnings: string[] = [];
  let metadata: ReportMetadata | undefined;

  for (const event of events) {
    const errorText = readString(event.error);

    if (errorText) {
      if (event.fatal === false) {
        warnings.push(errorText);
      } else {
        throw new Error(
          readString(event.errorStage)
            ? `${readString(event.errorStage)}: ${errorText}`
            : errorText
        );
      }
    }

    const warning = readString(event.warning);
    if (warning) {
      warnings.push(warning);
    }

    if (event.reportMetadata && typeof event.reportMetadata === "object") {
      metadata = event.reportMetadata as ReportMetadata;
    }
  }

  const domain = inferDomain(payload, events);
  const language = detectLanguage(payload);
  const expectedFields = getExpectedFields(domain);
  const contentByField = new Map<string, string>();

  for (const event of events) {
    for (const field of expectedFields) {
      const content = readString(event[field]);
      if (content) {
        contentByField.set(field, content);
      }
    }
  }

  const missingFields = expectedFields.filter((field) => !contentByField.has(field));
  if (missingFields.length > 0) {
    throw new Error(
      `Report payload is missing required sections: ${missingFields.join(", ")}.`
    );
  }

  const languageRepair = repairReportLanguageSections(
    expectedFields.map((field) => ({
      field,
      title: getFieldTitle(domain, language, field),
      content: contentByField.get(field) || "",
    })),
    language
  );
  warnings.push(...languageRepair.warnings);
  validateReportLanguageConsistency(
    [
      ...languageRepair.sections.map(
        (section) => `${section.title}\n${section.content}`
      ),
      ...warnings,
    ].join("\n"),
    language
  );

  return {
    domain,
    language,
    sections: languageRepair.sections,
    metadata,
    warnings: [...new Set(warnings)],
  };
}

function getReportType(domain: ReportDomain) {
  if (domain === "real_estate") {
    return "real_estate_investment_analysis";
  }

  if (isSpecializedDomain(domain)) {
    return `${domain}_analysis`;
  }

  return "business_plan";
}

function getReportTitle(
  payload: Record<string, unknown>,
  domain: ReportDomain,
  language: ResponseLanguage
) {
  const supplied = readString(payload.reportTitle);
  if (supplied) {
    return supplied.slice(0, 240);
  }

  if (domain === "real_estate") {
    return ({ English: "Real Estate Investment Analysis", Turkish: "Gayrimenkul Yatırım Analizi", German: "Immobilien-Investitionsanalyse", French: "Analyse d'investissement immobilier", Spanish: "Análisis de inversión inmobiliaria" } as const)[language];
  }

  if (isSpecializedDomain(domain)) {
    return ({ English: "Strategic Analysis", Turkish: "Stratejik Analiz", German: "Strategische Analyse", French: "Analyse stratégique", Spanish: "Análisis estratégico" } as const)[language];
  }

  return ({ English: "Strategic Business Plan", Turkish: "Stratejik İş Planı", German: "Strategischer Geschäftsplan", French: "Plan d'affaires stratégique", Spanish: "Plan de negocio estratégico" } as const)[language];
}

function buildAssistantContent(
  title: string,
  sections: ParsedReport["sections"]
) {
  return [
    `# ${title}`,
    ...sections.map((section) => `## ${section.title}\n\n${section.content}`),
  ].join("\n\n");
}

function isTransientFailure(error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  const code =
    typeof error === "object" && error && "code" in error
      ? readString((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error || "");

  if ([408, 425, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return (
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(code) ||
    /timed out|timeout|temporarily unavailable|network|fetch failed|socket|connection reset|aborted|too many requests|provider rate limit/i.test(
      message
    )
  );
}

async function updateProgress(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
  workerId: string,
  status: ActiveWorkerStatus,
  progress: number,
  progressStage: string
) {
  try {
    const { error } = await supabase.rpc("update_report_job_progress", {
      job_id: jobId,
      worker_id: workerId,
      status,
      progress,
      progress_stage: progressStage,
    });

    if (error) {
      console.warn("[report-jobs] non-blocking progress update failed", {
        jobId,
        status,
        progress,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn("[report-jobs] non-blocking progress update rejected", {
      jobId,
      status,
      progress,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function resolveWorkspaceId(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  payload: Record<string, unknown>
) {
  const requestedWorkspaceId = readString(payload.workspaceId);

  if (requestedWorkspaceId) {
    const { data: requestedWorkspace } = await supabase
      .from("report_workspaces")
      .select("id")
      .eq("id", requestedWorkspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (requestedWorkspace?.id) {
      return requestedWorkspace.id as string;
    }
  }

  const { data: existingWorkspace } = await supabase
    .from("report_workspaces")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "General")
    .maybeSingle();

  if (existingWorkspace?.id) {
    return existingWorkspace.id as string;
  }

  const { data: createdWorkspace, error } = await supabase
    .from("report_workspaces")
    .insert({ user_id: userId, name: "General" })
    .select("id")
    .single();

  if (error || !createdWorkspace?.id) {
    throw new Error(`Report workspace could not be resolved: ${error?.message || "unknown"}`);
  }

  return createdWorkspace.id as string;
}

async function persistCompletedReport({
  supabase,
  job,
  report,
}: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  job: ReportJobRow;
  report: ParsedReport;
}) {
  const payload = job.request_payload;
  const workspaceId = await resolveWorkspaceId(supabase, job.user_id, payload);
  const title = getReportTitle(payload, report.domain, report.language);
  const prompt = readString(payload.prompt);
  const expertiseProfile = expertiseProfileSchema.safeParse(
    payload.expertiseProfile
  );
  const reportPlan = dynamicReportPlanSchema.safeParse(payload.reportPlan);
  const researchPlan = dynamicResearchPlanSchema.safeParse(payload.researchPlan);
  const { error: reportError } = await supabase.from("reports").upsert(
    {
      id: job.id,
      user_id: job.user_id,
      workspace_id: workspaceId,
      title,
      prompt,
      report_type: getReportType(report.domain),
      status: "completed",
      sections: report.sections,
      metadata: {
        ...(report.metadata || {}),
        reportLanguage: getReportLanguageCode(report.language),
        ...(expertiseProfile.success
          ? { expertiseProfile: expertiseProfile.data }
          : {}),
        ...(reportPlan.success ? { reportPlan: reportPlan.data } : {}),
        ...(researchPlan.success ? { researchPlan: researchPlan.data } : {}),
      },
    },
    { onConflict: "id" }
  );

  if (reportError) {
    throw new Error(`Completed report could not be stored: ${reportError.message}`);
  }

  return {
    reportId: job.id,
    title,
    domain: report.domain,
    language: report.language,
    sectionCount: report.sections.length,
    warnings: report.warnings,
  };
}

async function persistAssistantMessage({
  supabase,
  job,
  report,
}: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  job: ReportJobRow;
  report: ParsedReport;
}) {
  const assistantMessageId = readString(job.request_payload.assistantMessageId);
  if (!assistantMessageId) return;

  const title = getReportTitle(job.request_payload, report.domain, report.language);
  const { error } = await supabase
    .from("ai_messages")
    .update({
      content: buildAssistantContent(title, report.sections),
      status: "complete",
    })
    .eq("id", assistantMessageId)
    .eq("user_id", job.user_id);

  if (error) {
    console.error("[report-jobs] deferred assistant message persistence failed", {
      jobId: job.id,
      error: error.message,
    });
  }
}

async function markTerminalFailure(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ReportJobRow,
  workerId: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : "Report generation failed.";
  const { error: updateError } = await supabase
    .from("report_jobs")
    .update({
      status: "failed",
      progress_stage: "failed",
      error_code: "REPORT_JOB_NON_RETRYABLE",
      error_message: message.slice(0, 2_000),
      next_attempt_at: null,
      lease_owner: null,
      lease_expires_at: null,
      failed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("lease_owner", workerId)
    .gt("lease_expires_at", new Date().toISOString());

  if (updateError) {
    throw new Error(`Terminal report job failure could not be stored: ${updateError.message}`);
  }
}

export async function processNextReportJob(options: ReportWorkerOptions = {}) {
  const workerStartedAt = Date.now();
  const supabase = createServiceRoleClient();
  const workerId = `report-worker:${process.pid}:${randomUUID()}`;
  const { data, error: claimError } = await claimReportJob(
    supabase,
    workerId,
    options.jobId
  );

  if (claimError) {
    throw new Error(`Report job claim failed: ${claimError.message}`);
  }

  const job = (Array.isArray(data) ? data[0] : data) as ReportJobRow | null;
  if (!job?.id) {
    return { processed: false as const };
  }

  const abortController = new AbortController();
  let heartbeatInFlight = false;
  let lastSuccessfulHeartbeatAt = Date.now();
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) {
      return;
    }

    heartbeatInFlight = true;
    void (async () => {
      try {
        const { error } = await supabase.rpc("renew_report_job_lease", {
          job_id: job.id,
          worker_id: workerId,
          lease_seconds: JOB_LEASE_SECONDS,
        });

        if (!error) {
          lastSuccessfulHeartbeatAt = Date.now();
        } else if (
          Date.now() - lastSuccessfulHeartbeatAt >= JOB_LEASE_SECONDS * 750 &&
          !abortController.signal.aborted
        ) {
          abortController.abort(
            new Error(`Report job lease renewal failed: ${error.message}`)
          );
        } else {
          console.warn("[report-jobs] transient lease renewal failure", {
            jobId: job.id,
            error: error.message,
          });
        }
      } catch (error) {
        if (
          Date.now() - lastSuccessfulHeartbeatAt >= JOB_LEASE_SECONDS * 750 &&
          !abortController.signal.aborted
        ) {
          abortController.abort(error);
        } else {
          console.warn("[report-jobs] transient lease renewal rejection", {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, JOB_HEARTBEAT_MS);

  try {
    await updateProgress(supabase, job.id, workerId, "extracting", 5, "asset_extraction");
    const queueMetadata =
      job.request_payload._queue && typeof job.request_payload._queue === "object"
        ? (job.request_payload._queue as QueueMetadata)
        : {};
    const requestId = readString(job.request_payload.reportRequestId) || job.id;
    const executorRequest = new Request("http://report-worker.local/api/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zerinix-Pipeline":
          readString(queueMetadata.requestedPipeline) || "decision_intelligence_v1",
        "X-Zerinix-Report-Request-Id": requestId,
        ...(queueMetadata.universalInput === true
          ? { "X-Zerinix-Universal-Input": "true" }
          : {}),
      },
      body: JSON.stringify(job.request_payload),
      signal: abortController.signal,
    });
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.admin.getUserById(job.user_id);

    if (userError || !user) {
      throw new Error(`Report job user could not be loaded: ${userError?.message || "unknown"}`);
    }

    void updateProgress(supabase, job.id, workerId, "researching", 20, "decision_intelligence");
    const executionStartedAt = Date.now();
    const response = await executePlanRequest(executorRequest, {
      supabase: supabase as unknown as PlanExecutionContext["supabase"],
      user: user as User,
      ip: readString(queueMetadata.clientIp) || "report-worker",
    });

    void updateProgress(supabase, job.id, workerId, "generating", 75, "report_generation");
    const parsingStartedAt = Date.now();
    const report = await readExecutionResponse(response, job.request_payload);
    const persistenceStartedAt = Date.now();
    const resultPayload = await persistCompletedReport({ supabase, job, report });
    const completionStartedAt = Date.now();
    const { error: completionError } = await supabase.rpc("complete_report_job", {
      job_id: job.id,
      worker_id: workerId,
      result_payload: resultPayload,
      report_id: resultPayload.reportId,
    });

    if (completionError) {
      throw new Error(`Report job completion failed: ${completionError.message}`);
    }

    const deferredAssistantPersistence = () =>
      persistAssistantMessage({ supabase, job, report }).catch((error) => {
        console.error("[report-jobs] deferred assistant persistence rejected", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    if (options.defer) {
      options.defer(deferredAssistantPersistence);
    } else {
      void deferredAssistantPersistence();
    }

    console.info("[report-jobs] completion timing", {
      jobId: job.id,
      executionMs: parsingStartedAt - executionStartedAt,
      responseParsingMs: persistenceStartedAt - parsingStartedAt,
      reportPersistenceMs: completionStartedAt - persistenceStartedAt,
      completionRpcMs: Date.now() - completionStartedAt,
      totalWorkerMs: Date.now() - workerStartedAt,
    });

    return {
      processed: true as const,
      jobId: job.id,
      reportId: resultPayload.reportId,
      status: "completed" as const,
    };
  } catch (error) {
    let failureStatus: "retry_wait" | "failed" = "failed";

    if (isTransientFailure(error)) {
      const { data: failedJobData, error: failureError } = await supabase.rpc("fail_report_job", {
        job_id: job.id,
        worker_id: workerId,
        error_code: "REPORT_JOB_TRANSIENT_FAILURE",
        error_message:
          error instanceof Error ? error.message.slice(0, 2_000) : "Transient failure",
        retry_delay_seconds: TRANSIENT_RETRY_BASE_SECONDS,
      });

      if (failureError) {
        console.error("[report-jobs] retry scheduling failed", failureError);
      } else {
        const failedJob = (Array.isArray(failedJobData)
          ? failedJobData[0]
          : failedJobData) as { status?: string } | null;
        failureStatus = failedJob?.status === "retry_wait" ? "retry_wait" : "failed";
      }
    } else {
      await markTerminalFailure(supabase, job, workerId, error);
    }

    console.error("[report-jobs] processing failed", {
      jobId: job.id,
      transient: isTransientFailure(error),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      processed: true as const,
      jobId: job.id,
      status: failureStatus,
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function processReportJobQueue(options: ReportWorkerOptions = {}) {
  const processedJobIds: string[] = [];
  let requestedJobId = options.jobId;

  while (true) {
    const result = await processNextReportJob({
      ...options,
      jobId: requestedJobId,
    });

    if (!result.processed) {
      break;
    }

    processedJobIds.push(result.jobId);
    requestedJobId = undefined;
  }

  return {
    processed: processedJobIds.length > 0,
    processedCount: processedJobIds.length,
    jobIds: processedJobIds,
  };
}
