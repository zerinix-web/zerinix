import { after, NextResponse } from "next/server";
import { authorizeStrategicReportAccess } from "@/app/lib/strategic-report-access";
import { getAnalysisAssetValidationError } from "@/app/lib/ai/analysis-assets";
import { getUniversalReportReadinessError } from "@/app/lib/ai/understanding";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { createAuthenticatedReportJobClient } from "@/app/lib/report-jobs/request-auth";
import { processReportJobQueue } from "@/app/lib/report-jobs/worker";
import {
  getResponseLanguage,
  resolveReportLanguage,
} from "@/app/lib/report-language";
import {
  createExpertiseProfileFallback,
  normalizeSelectedAnalysisMode,
  resolveExpertiseProfile,
} from "@/app/lib/ai/expertise-profile";
import {
  createDynamicReportPlanFallback,
  resolveDynamicReportPlan,
  type DynamicReportPlan,
} from "@/app/lib/ai/dynamic-report-plan";
import {
  createDynamicResearchPlanFallback,
  resolveDynamicResearchPlan,
} from "@/app/lib/ai/dynamic-research-plan";

export const maxDuration = 300;

type ReportJobRequestPayload = Record<string, unknown> & {
  prompt?: unknown;
  reportRequestId?: unknown;
  reportReadiness?: unknown;
  attachments?: unknown;
};

function readIdempotencyKey(request: Request, body: ReportJobRequestPayload) {
  const candidates = [
    request.headers.get("idempotency-key"),
    request.headers.get("x-zerinix-report-request-id"),
    typeof body.reportRequestId === "string" ? body.reportRequestId : "",
  ];

  return (
    candidates.find((value) => value?.trim())?.trim().slice(0, 180) ||
    crypto.randomUUID()
  );
}

function queuedResponse(job: { id: string; status: string }, reused = false) {
  return NextResponse.json(
    {
      success: true,
      jobId: job.id,
      status: job.status,
      ...(reused ? { reused: true } : {}),
    },
    {
      status: job.status === "queued" ? 202 : 200,
      headers: {
        "Cache-Control": "no-store",
        Location: `/api/report-jobs/${encodeURIComponent(job.id)}`,
      },
    }
  );
}

function readRequestExpertiseProfile(body: ReportJobRequestPayload) {
  const readiness =
    body.reportReadiness &&
    typeof body.reportReadiness === "object" &&
    !Array.isArray(body.reportReadiness)
      ? (body.reportReadiness as Record<string, unknown>)
      : {};
  const assets = Array.isArray(body.attachments)
    ? body.attachments.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }
        const asset = value as Record<string, unknown>;
        return [
          {
            name: typeof asset.name === "string" ? asset.name : "",
            mimeType:
              typeof asset.mimeType === "string"
                ? asset.mimeType
                : typeof asset.type === "string"
                  ? asset.type
                  : "",
            textContent:
              typeof asset.textContent === "string" ? asset.textContent : "",
          },
        ];
      })
    : [];
  const selectedMode = normalizeSelectedAnalysisMode(body.analysisMode);
  const fallback = createExpertiseProfileFallback({
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    assets,
    selectedMode,
    detectedDomain: readiness.detectedIndustry,
  });

  return resolveExpertiseProfile(readiness.expertiseProfile, fallback);
}

function readRequestReportPlan(
  body: ReportJobRequestPayload,
  expertiseProfile: ReturnType<typeof readRequestExpertiseProfile>,
  language: DynamicReportPlan["language"]
) {
  const readiness =
    body.reportReadiness &&
    typeof body.reportReadiness === "object" &&
    !Array.isArray(body.reportReadiness)
      ? (body.reportReadiness as Record<string, unknown>)
      : {};
  const clarificationAnswers =
    readiness.answers &&
    typeof readiness.answers === "object" &&
    !Array.isArray(readiness.answers)
      ? (readiness.answers as Record<string, unknown>)
      : {};
  const extractedFacts = Array.isArray(readiness.extractedAssetFacts)
    ? readiness.extractedAssetFacts
    : [];
  const selectedMode = normalizeSelectedAnalysisMode(body.analysisMode);
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode,
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    extractedFacts,
    clarificationAnswers,
    language,
  });

  return resolveDynamicReportPlan({
    value: body.reportPlan ?? readiness.reportPlan,
    fallback,
    expertiseProfile,
    selectedMode,
    clarificationAnswers,
  });
}

function readRequestResearchPlan(
  body: ReportJobRequestPayload,
  expertiseProfile: ReturnType<typeof readRequestExpertiseProfile>,
  reportPlan: ReturnType<typeof readRequestReportPlan>
) {
  const readiness =
    body.reportReadiness &&
    typeof body.reportReadiness === "object" &&
    !Array.isArray(body.reportReadiness)
      ? (body.reportReadiness as Record<string, unknown>)
      : {};
  const clarificationAnswers =
    readiness.answers &&
    typeof readiness.answers === "object" &&
    !Array.isArray(readiness.answers)
      ? (readiness.answers as Record<string, unknown>)
      : {};
  const extractedFacts = Array.isArray(readiness.extractedAssetFacts)
    ? readiness.extractedAssetFacts
    : [];
  const selectedMode = normalizeSelectedAnalysisMode(body.analysisMode);
  const fallback = createDynamicResearchPlanFallback({
    expertiseProfile,
    reportPlan,
    selectedMode,
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    extractedFacts,
    clarificationAnswers,
  });

  return resolveDynamicResearchPlan({
    value: body.researchPlan ?? readiness.researchPlan,
    fallback,
    expertiseProfile,
    reportPlan,
    selectedMode,
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    extractedFacts,
    clarificationAnswers,
  });
}

function startReportWorker(jobId: string) {
  const workerPromise = processReportJobQueue({
    defer: (task) => after(task),
    jobId,
  });
  after(async () => {
    await workerPromise.catch((error) => {
      console.error("[report-jobs] deferred worker failed", error);
    });
  });
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with a JSON body to enqueue report generation." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function POST(req: Request) {
  const requestValidation = validateApiRequest(req, {
    maxBodyBytes: 17_000_000,
  });

  if (!requestValidation.ok) {
    return NextResponse.json(
      { error: requestValidation.message },
      { status: requestValidation.status }
    );
  }

  const ip = getClientIpFromRequest(req);
  const ipRateLimit = checkRateLimit(`api:plan:ip:${ip}`, {
    limit: 30,
    windowMs: 60_000,
  });

  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Daily AI usage limit reached. Please try again later." },
      { status: 429, headers: getRateLimitHeaders(ipRateLimit) }
    );
  }

  const { supabase, user } = await createAuthenticatedReportJobClient(req);

  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const reportAccess = await authorizeStrategicReportAccess({
    request: req,
    account: user,
  });

  if (!reportAccess.allowed) {
    return NextResponse.json({ error: "Private beta access only." }, { status: 403 });
  }

  const userRateLimit = checkRateLimit(`api:plan:${user.id}:${ip}`, {
    limit: 24,
    windowMs: 60_000,
  });

  if (!userRateLimit.allowed) {
    return NextResponse.json(
      { error: "Daily AI usage limit reached. Please try again later." },
      { status: 429, headers: getRateLimitHeaders(userRateLimit) }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | ReportJobRequestPayload
    | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (req.headers.get("x-zerinix-universal-input") === "true") {
    const readinessError = getUniversalReportReadinessError(body.reportReadiness);

    if (readinessError) {
      return NextResponse.json(
        { error: readinessError, code: "REPORT_INPUT_INCOMPLETE" },
        { status: 422 }
      );
    }
  }

  const attachmentValidationError = getAnalysisAssetValidationError(body.attachments);

  if (attachmentValidationError) {
    return NextResponse.json({ error: attachmentValidationError }, { status: 400 });
  }

  const idempotencyKey = readIdempotencyKey(req, body);
  const { data: existingJob, error: existingJobError } = await supabase
    .from("report_jobs")
    .select("id,status")
    .eq("user_id", user.id)
    .eq("idempotency_key", idempotencyKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingJobError) {
    console.error("[report-jobs] idempotency lookup failed", existingJobError);
    return NextResponse.json(
      { error: "Report queue is temporarily unavailable." },
      { status: 503 }
    );
  }

  if (existingJob) {
    if (existingJob.status === "queued" || existingJob.status === "retry_wait") {
      startReportWorker(existingJob.id);
    }

    return queuedResponse(existingJob, true);
  }

  const reportLanguageCode = resolveReportLanguage({
    explicitLanguage: body.explicitReportLanguage,
    uiLanguage: body.uiLanguage || body.language || req.headers.get("x-zerinix-ui-language"),
    browserLanguage: body.browserLanguage || req.headers.get("accept-language"),
    requestText: typeof body.prompt === "string" ? body.prompt : "",
  });
  const reportLanguage = getResponseLanguage(reportLanguageCode);
  const expertiseProfile = readRequestExpertiseProfile(body);
  const reportPlan = readRequestReportPlan(
    body,
    expertiseProfile,
    reportLanguageCode
  );
  const researchPlan = readRequestResearchPlan(
    body,
    expertiseProfile,
    reportPlan
  );
  const requestPayload = {
    ...body,
    expertiseProfile,
    reportPlan,
    researchPlan,
    language: reportLanguage,
    reportRequestId: idempotencyKey,
    _queue: {
      clientIp: ip,
      universalInput:
        req.headers.get("x-zerinix-universal-input") === "true",
      requestedPipeline:
        req.headers.get("x-zerinix-pipeline") || "decision_intelligence_v1",
      enqueuedAt: new Date().toISOString(),
    },
  };
  const { data: createdJob, error: createError } = await supabase
    .from("report_jobs")
    .insert({
      user_id: user.id,
      request_payload: requestPayload,
      idempotency_key: idempotencyKey,
    })
    .select("id,status")
    .single();

  if (createError || !createdJob) {
    if (createError?.code === "23505") {
      const { data: racedJob } = await supabase
        .from("report_jobs")
        .select("id,status")
        .eq("user_id", user.id)
        .eq("idempotency_key", idempotencyKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (racedJob) {
        return queuedResponse(racedJob, true);
      }
    }

    console.error("[report-jobs] enqueue failed", createError);
    return NextResponse.json(
      { error: "Report could not be queued." },
      { status: 503 }
    );
  }

  startReportWorker(createdJob.id);

  return queuedResponse(createdJob);
}
