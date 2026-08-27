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
  acquisitionAnalysisFieldLabels,
  acquisitionAnalysisFields,
  type AcquisitionAnalysisField,
} from "@/app/lib/report-engine/prompts/acquisition-analysis";
import {
  realEstateFieldLabels,
  realEstateFields,
  type RealEstateReportField,
} from "@/app/lib/report-engine/prompts/real-estate";
import {
  marketFieldLabels,
  marketReportFields,
  type MarketReportField,
} from "@/app/lib/report-engine/prompts/market";
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
import { validateExecutiveReportQuality } from "@/app/lib/report-engine/executive-report-quality-validator";
import { checkReportConsistency } from "@/app/lib/report-engine/report-consistency-checker";
import { generateReportAuditTrail } from "@/app/lib/report-engine/report-audit-trail";
import { generateExplainabilityReport } from "@/app/lib/report-engine/explainability-engine";
import { generateReproducibilityRecord } from "@/app/lib/report-engine/decision-reproducibility-engine";
import { generateReportVersionManifest } from "@/app/lib/report-engine/report-versioning-engine";

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

type ReportExecutionDomain = ReportDomain | "market";

type ParsedReport = {
  domain: ReportExecutionDomain;
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

function getExpectedFields(domain: ReportExecutionDomain) {
  if (domain === "market") {
    return marketReportFields as readonly string[];
  }

  if (domain === "real_estate") {
    return realEstateFields as readonly string[];
  }

  if (domain === "acquisition") {
    return acquisitionAnalysisFields as readonly string[];
  }

  if (isSpecializedDomain(domain)) {
    return domainAnalysisFields as readonly string[];
  }

  return planFields as readonly string[];
}

function getFieldTitle(
  domain: ReportExecutionDomain,
  language: ResponseLanguage,
  field: string
) {
  if (domain === "market") {
    return marketFieldLabels[language][field as MarketReportField] || field;
  }

  if (domain === "real_estate") {
    return realEstateFieldLabels[language][field as RealEstateReportField] || field;
  }

  if (domain === "acquisition") {
    return acquisitionAnalysisFieldLabels[language][field as AcquisitionAnalysisField] || field;
  }

  if (isSpecializedDomain(domain)) {
    return domainAnalysisFieldLabels[language][field as DomainAnalysisField] || field;
  }

  return planFieldLabels[language][field as PlanReportField] || field;
}

// Live-reproduced bug: "scenarioAnalysis" is a field name shared by
// planFields, realEstateFields, AND domainAnalysisFields (each schema
// defined independently). The old fallback below matched on ANY
// shared field name, so a real, complete business-plan report event
// stream -- which always includes "scenarioAnalysis" -- was
// misclassified as "real_estate" whenever payload/event reportDomain
// was absent, and worker.ts then checked the response against the
// wrong field list, reporting every real field as "missing." These
// derived lists only ever match on a field name that is exclusive to
// that domain, so a shared field name can never cause a false match
// again, including for schemas added later.
const realEstateDistinguishingFields = realEstateFields.filter(
  (field) => !(planFields as readonly string[]).includes(field)
);
const domainAnalysisDistinguishingFields = domainAnalysisFields.filter(
  (field) =>
    !(planFields as readonly string[]).includes(field) &&
    !(realEstateFields as readonly string[]).includes(field)
);
// Acquisition Due Diligence has its own fully dedicated field names
// (valuation, purchasePriceFairness, synergies, ...) -- none shared with
// planFields/realEstateFields/domainAnalysisFields -- so every one of its
// fields is already distinguishing; the same shared-name filter is kept
// here anyway for defensive consistency with the two lists above.
const acquisitionAnalysisDistinguishingFields = acquisitionAnalysisFields.filter(
  (field) =>
    !(planFields as readonly string[]).includes(field) &&
    !(realEstateFields as readonly string[]).includes(field) &&
    !(domainAnalysisFields as readonly string[]).includes(field)
);

function inferDomain(
  payload: Record<string, unknown>,
  events: Array<Record<string, unknown>>
): ReportExecutionDomain {
  if (readString(payload.analysisMode) === "market") {
    return "market";
  }

  const eventDomain = events.map((event) => readString(event.reportDomain)).find(Boolean);
  const payloadDomain = readString(payload.reportDomain);
  const candidate = eventDomain || payloadDomain;

  if (
    candidate === "real_estate" ||
    candidate === "business" ||
    candidate === "acquisition" ||
    isSpecializedDomain(candidate)
  ) {
    return candidate;
  }

  if (events.some((event) => realEstateDistinguishingFields.some((field) => field in event))) {
    return "real_estate";
  }

  if (events.some((event) => acquisitionAnalysisDistinguishingFields.some((field) => field in event))) {
    return "acquisition";
  }

  if (events.some((event) => domainAnalysisDistinguishingFields.some((field) => field in event))) {
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

function getReportType(domain: ReportExecutionDomain) {
  if (domain === "market") {
    return "market_analysis";
  }

  if (domain === "real_estate") {
    return "real_estate_investment_analysis";
  }

  if (domain === "acquisition") {
    return "acquisition_due_diligence_analysis";
  }

  if (isSpecializedDomain(domain)) {
    return `${domain}_analysis`;
  }

  return "business_plan";
}

function getReportTitle(
  payload: Record<string, unknown>,
  domain: ReportExecutionDomain,
  language: ResponseLanguage
) {
  const supplied = readString(payload.reportTitle);
  if (supplied) {
    return supplied.slice(0, 240);
  }

  if (domain === "market") {
    return ({ English: "Market Intelligence Report", Turkish: "Pazar İstihbaratı Raporu", German: "Marktintelligenzbericht", French: "Rapport d'intelligence de marché", Spanish: "Informe de inteligencia de mercado" } as const)[language];
  }

  if (domain === "real_estate") {
    return ({ English: "Real Estate Investment Analysis", Turkish: "Gayrimenkul Yatırım Analizi", German: "Immobilien-Investitionsanalyse", French: "Analyse d'investissement immobilier", Spanish: "Análisis de inversión inmobiliaria" } as const)[language];
  }

  if (domain === "acquisition") {
    return ({ English: "Acquisition Due Diligence Report", Turkish: "Satın Alma Durum Tespiti Raporu", German: "Akquisitions-Due-Diligence-Bericht", French: "Rapport de diligence raisonnable d'acquisition", Spanish: "Informe de diligencia debida de adquisición" } as const)[language];
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

export function isTransientFailure(error: unknown) {
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
  const failureFields = {
    status: "failed" as const,
    progress_stage: "failed",
    error_code: "REPORT_JOB_NON_RETRYABLE",
    error_message: message.slice(0, 2_000),
    next_attempt_at: null,
    lease_owner: null,
    lease_expires_at: null,
    failed_at: new Date().toISOString(),
  };

  const { data: updatedRows, error: updateError } = await supabase
    .from("report_jobs")
    .update(failureFields)
    .eq("id", job.id)
    .eq("lease_owner", workerId)
    .gt("lease_expires_at", new Date().toISOString())
    .select("id");

  if (updateError) {
    throw new Error(`Terminal report job failure could not be stored: ${updateError.message}`);
  }

  // P0 PRODUCTION FIX -- confirmed live: this UPDATE is lease-conditioned
  // (only the worker that still legitimately owns an unexpired lease may
  // write it), but Supabase/PostgREST returns success with an EMPTY row
  // list -- never an `error` -- when the WHERE clause matches zero rows
  // (e.g. this worker's own lease already expired by the time a long-
  // running job finally failed, or a deadline-triggered abort took a
  // moment to unwind). The caller previously had no way to detect this:
  // it believed the failure was recorded when nothing was actually
  // written, and the job stayed stuck at its last active status forever.
  // A forced, lease-unconditional fallback (scoped only by id) trades a
  // theoretical, benign overwrite race against another worker's own
  // legitimate concurrent write for the certainty that this job reaches
  // a terminal state -- exactly the tradeoff "never infinite pending"
  // requires.
  if (!updatedRows || updatedRows.length === 0) {
    console.error("[report-jobs] lease-conditioned terminal failure write matched no rows -- forcing an unconditional fallback write", {
      jobId: job.id,
      workerId,
    });

    const { error: fallbackError } = await supabase
      .from("report_jobs")
      .update(failureFields)
      .eq("id", job.id)
      .neq("status", "completed");

    if (fallbackError) {
      throw new Error(
        `Terminal report job failure could not be stored even via the unconditional fallback: ${fallbackError.message}`
      );
    }
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
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
  // timeout incident): this function has no top-level deadline of its
  // own -- it blindly trusted the SUM of its nested per-call budgets
  // (research + full-report synthesis + post-processing, and optional
  // entity extraction) to stay under whichever caller's Vercel
  // maxDuration is in effect (300s on every trigger path: /api/plan,
  // the polling route, and the cron worker route). That sum could
  // legitimately reach ~312-327s even in the NON-pathological case,
  // exceeding 300s outright. When Vercel hard-kills the function at its
  // maxDuration, that is NOT a catchable JS exception -- this function's
  // own try/catch/finally never runs, so no failure is ever recorded and
  // the job is left stuck at whatever active status its last progress
  // write reached.
  //
  // This deadline is a proactive backstop, not the primary bound --
  // each nested call already has (and keeps) its own tighter timeout;
  // this only fires if their SUM runs long, or if any nested timeout
  // somehow fails to fire as expected. Aborting abortController.signal
  // here propagates all the way down through executorRequest's signal
  // (below) into executePlanRequest -> the market-analysis/plan-executor
  // OpenAI and research calls, which already honor it. The resulting
  // rejection is deliberately worded to match isTransientFailure's
  // existing "timed out" pattern, so it flows through the EXISTING
  // catch block's transient-failure path below (fail_report_job ->
  // retry_wait, or terminal "failed" once attempts are exhausted) with
  // no new failure-handling logic required.
  const JOB_PROCESSING_DEADLINE_MS = 280_000;
  const deadlineRemainingMs = Math.max(
    0,
    JOB_PROCESSING_DEADLINE_MS - (Date.now() - workerStartedAt)
  );
  const deadlineTimer = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort(
        new Error(
          `Report job exceeded its internal processing deadline of ${Math.round(
            JOB_PROCESSING_DEADLINE_MS / 1_000
          )} seconds (timed out) -- aborted proactively before the platform's own hard timeout could strand it in a non-terminal status.`
        )
      );
    }
  }, deadlineRemainingMs);
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
        "X-Zerinix-AI-Request-Id":
          readString(job.request_payload.aiCostRequestId) || job.id,
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

    // ZERINIX Executive Report Quality Validator v1: the real, final
    // gate before any report is persisted (and therefore visible to
    // the user via the dashboard) -- reusing the SAME request_payload
    // fields already carried by earlier ZERINIX Executive Decision
    // work (executiveDecisionSystemResult / strategicDecisionMemo /
    // executiveBrief), never recomputing them. Disabled by default
    // (like every other ZERINIX module); when disabled, `validated` is
    // false and this block is a no-op, so the existing pipeline is
    // completely unaffected unless the flag is explicitly turned on.
    // A blocking finding (critical/error severity) throws here, which
    // flows into this function's own, pre-existing catch block below
    // exactly like any other report-generation failure (e.g.
    // readExecutionResponse's own missing-field validation) --
    // reusing the existing terminal-failure path rather than adding a
    // new one, so no report ever reaches persistCompletedReport in a
    // state this validator considers broken. On a pass, the result is
    // attached as an additive, optional reports.metadata field -- no
    // existing API/response contract changes.
    const qualityValidation = validateExecutiveReportQuality({
      sections: report.sections,
      expectedFields: getExpectedFields(report.domain),
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
    });
    if (qualityValidation.validated && !qualityValidation.passed) {
      const blockingIssues = qualityValidation.issues.filter(
        (issue) => issue.severity === "critical" || issue.severity === "error"
      );
      throw new Error(
        `Report failed Executive Report Quality Validator: ${blockingIssues
          .map((issue) => `[${issue.severity}] ${issue.category}: ${issue.message}`)
          .join(" | ")}`
      );
    }
    if (qualityValidation.validated) {
      report.metadata = { ...(report.metadata || {}), reportQualityValidation: qualityValidation };
    }

    // ZERINIX Report Consistency Checker v1: runs immediately AFTER
    // the Executive Report Quality Validator above (per the check
    // ordering this module is meant to follow), on the same already-
    // validated report and the same already-computed request_payload
    // fields -- never recomputing Executive Decision System, Strategic
    // Decision Memo, or Executive Brief. Disabled by default; when
    // disabled, `checked` is false and this block is a no-op. A
    // blocking finding (critical/error severity) throws here, reusing
    // the exact same pre-existing terminal-failure path as the quality
    // validator above and readExecutionResponse's own validation. On a
    // pass, the result is attached as a second, additive, optional
    // reports.metadata field.
    const consistencyCheck = checkReportConsistency({
      sections: report.sections,
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
    });
    if (consistencyCheck.checked && !consistencyCheck.consistent) {
      const blockingIssues = consistencyCheck.issues.filter(
        (issue) => issue.severity === "critical" || issue.severity === "error"
      );
      throw new Error(
        `Report failed Report Consistency Checker: ${blockingIssues
          .map((issue) => `[${issue.severity}] ${issue.type}: ${issue.message}`)
          .join(" | ")}`
      );
    }
    if (consistencyCheck.checked) {
      report.metadata = { ...(report.metadata || {}), reportConsistencyCheck: consistencyCheck };
    }

    // ZERINIX Report Audit Trail Generator v1: runs immediately AFTER
    // both validation modules above, on the same already-validated
    // report and the same already-computed request_payload fields --
    // never recomputing Executive Decision System, Strategic Decision
    // Memo, or Executive Brief. Unlike the two modules above, this one
    // never throws/blocks a report -- it only records how each of 8
    // tracked report categories was produced (source engines, evidence
    // references, confidence derivation, the Quality Validator's and
    // Consistency Checker's own already-computed findings for that
    // category, generation timestamp, execution order, and version
    // identifiers). Disabled by default; when disabled, `generated` is
    // false and this block is a no-op. On a pass, the result is
    // attached as a third, additive, optional reports.metadata field.
    const auditTrail = generateReportAuditTrail({
      sections: report.sections,
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
      qualityValidation,
      consistencyCheck,
    });
    if (auditTrail.generated) {
      report.metadata = { ...(report.metadata || {}), reportAuditTrail: auditTrail };
    }

    // ZERINIX Explainability Engine v1: runs immediately AFTER the
    // Report Audit Trail Generator above, on the same already-
    // computed request_payload fields and the same already-computed
    // qualityValidation/consistencyCheck results -- never recomputing
    // Executive Decision System, Strategic Decision Memo, Executive
    // Brief, or either validator/checker, and never calling an LLM.
    // Like the Audit Trail Generator, this one never throws/blocks a
    // report -- it only explains why each real recommendation,
    // verdict, risk, opportunity, and confidence assessment was
    // reached. Disabled by default; when disabled, `generated` is
    // false and this block is a no-op. On a pass, the result is
    // attached as a fourth, additive, optional reports.metadata field.
    const explainability = generateExplainabilityReport({
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
      qualityValidation,
      consistencyCheck,
    });
    if (explainability.generated) {
      report.metadata = { ...(report.metadata || {}), reportExplainability: explainability };
    }

    // ZERINIX Decision Reproducibility Engine v1: runs immediately
    // AFTER the Explainability Engine above, on the same already-
    // computed request_payload fields plus the audit trail and
    // explainability results just computed in this same request --
    // never recomputing Executive Decision System, Strategic Decision
    // Memo, Executive Brief, or either module above, and never
    // re-running the pipeline a second time (that would violate this
    // pipeline's own "exactly once" guarantee). Like the two modules
    // above, this one never throws/blocks a report -- it only records
    // a deterministic reproducibility fingerprint and execution
    // metadata. Disabled by default; when disabled, `generated` is
    // false and this block is a no-op. On a pass, the result is
    // attached as a fifth, additive, optional reports.metadata field.
    const reproducibility = generateReproducibilityRecord({
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
      auditTrail,
      explainability,
    });
    if (reproducibility.generated) {
      report.metadata = { ...(report.metadata || {}), reportReproducibility: reproducibility };
    }

    // ZERINIX Report Versioning Engine v1: runs LAST, immediately
    // after the Decision Reproducibility Engine above, folding in the
    // real, already-computed qualityValidation/consistencyCheck/
    // auditTrail/explainability/reproducibility results -- never
    // recomputing any of them. Like the three modules above, this one
    // never throws/blocks a report -- it only attaches immutable
    // version metadata and a structured compatibility manifest.
    // Disabled by default; when disabled, `generated` is false and
    // this block is a no-op. On a pass, the result is attached as a
    // sixth, additive, optional reports.metadata field.
    const versionManifest = generateReportVersionManifest({
      executiveDecisionPackage: job.request_payload.executiveDecisionSystemResult,
      strategicDecisionMemo: job.request_payload.strategicDecisionMemo,
      executiveBrief: job.request_payload.executiveBrief,
      qualityValidation,
      consistencyCheck,
      auditTrail,
      explainability,
      reproducibility,
    });
    if (versionManifest.generated) {
      report.metadata = { ...(report.metadata || {}), reportVersion: versionManifest };
    }

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
        // P0 PRODUCTION FIX -- confirmed live: fail_report_job (SQL)
        // raises when the caller's lease no longer matches (already
        // expired/reclaimed) -- previously this branch only logged that
        // and returned, recording NOTHING in the database, leaving the
        // job stuck exactly like the bug this whole pass fixes.
        // markTerminalFailure's own lease-conditioned-write-plus-forced-
        // fallback (see its comment) is reused here as the guaranteed
        // last resort, so a transient failure that can't be scheduled
        // for retry still reaches a real terminal state instead of
        // silently vanishing.
        console.error("[report-jobs] retry scheduling failed; forcing terminal failure instead", failureError);
        await markTerminalFailure(supabase, job, workerId, error);
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
    clearTimeout(deadlineTimer);
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
