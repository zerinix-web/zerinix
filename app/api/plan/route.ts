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
  resolveMarketIntelligenceLanguage,
  resolveReportLanguage,
} from "@/app/lib/report-language";
import {
  createExpertiseProfileFallback,
  getSelectedModeMismatchMessage,
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
import {
  applyDocumentAwareModeOverride,
  classifyAttachmentDocument,
} from "@/app/lib/ai/document-intelligence";
import { createLegalDocumentSummaryFallback } from "@/app/lib/ai/legal-document-understanding";
import { createLegalCaseAnalysis } from "@/app/lib/ai/legal-case-analysis";
import { createUniversalDocumentIntelligenceFallback } from "@/app/lib/ai/universal-document-intelligence";
import { buildDecisionPlan, type DecisionPlan } from "@/app/lib/ai/intelligence-router";
import { runBrainOrchestrator } from "@/app/lib/ai/brain-orchestrator";
import { isDecisionEngineEnabled, runDecisionEngine } from "@/app/lib/ai/decision-engine";
import {
  isExecutiveDecisionSystemEnabled,
  runExecutiveDecisionSystem,
} from "@/app/lib/ai/executive-decision-system";
import { buildStrategicDecisionMemo } from "@/app/lib/ai/strategic-decision-memo";
import { generateExecutiveBrief } from "@/app/lib/ai/executive-brief-generator";
import { logOperationalInfo } from "@/app/lib/security/logging";

export const maxDuration = 300;

type ReportJobRequestPayload = Record<string, unknown> & {
  prompt?: unknown;
  reportRequestId?: unknown;
  reportReadiness?: unknown;
  attachments?: unknown;
};

function readRequestAttachmentAssets(body: ReportJobRequestPayload) {
  return Array.isArray(body.attachments)
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
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

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

  return resolveExpertiseProfile(
    readiness.expertiseProfile,
    fallback,
    selectedMode
  );
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

  // Layer 4 of ZERINIX Intelligence: a universal, domain-agnostic
  // Decision Intelligence pass over the uploaded attachment, independent
  // of and unrelated to the legal-specific layers below. This never
  // reads or changes body.analysisMode and is attached under its own
  // key so any future module can consume it without depending on the
  // legal-specific documentIntelligence object.
  const universalDocumentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: readRequestAttachmentAssets(body),
  });
  body.universalDocumentIntelligence = universalDocumentIntelligence;

  // Layer 5 of ZERINIX Intelligence: the Decision Intelligence Router.
  // This is not another document parser -- it only consumes layer 4's
  // output above (plus the prompt) to decide which *future* intelligence
  // modules would be worth running and which would not, with a rationale
  // and confidence for each. It never generates a report, never answers
  // the user, and is attached under its own key so it does not affect
  // anything that reads body.analysisMode or body.documentIntelligence.
  body.decisionPlan = buildDecisionPlan({
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    documentIntelligence: universalDocumentIntelligence,
  });
  const decisionPlan = body.decisionPlan as DecisionPlan;

  // First layer of ZERINIX document intelligence: a confidently detected
  // attachment category can override the selected analysis mode before
  // anything else reads body.analysisMode. This is the only place this
  // runs, so every downstream read of body.analysisMode (expertise
  // profile, report plan, research plan, market-mode dispatch) sees the
  // corrected value. Only legal_document forces a change (into "chat" /
  // Strategic Advisory) -- every other category and every case below the
  // confidence threshold leaves body.analysisMode untouched.
  const documentClassification = classifyAttachmentDocument({
    assets: readRequestAttachmentAssets(body),
  });
  const documentAwareRouting = applyDocumentAwareModeOverride({
    selectedMode: body.analysisMode,
    classification: documentClassification,
  });
  if (documentAwareRouting.overridden) {
    body.analysisMode = documentAwareRouting.selectedMode;
  }
  // Second layer of ZERINIX Legal Intelligence: for a confidently detected
  // legal_document / legal_case_analysis attachment, generate a
  // structured, attachment-only document summary before any advisory
  // analysis runs. This does not build the legal report, PDF, timeline,
  // risk scoring, or precedent search -- it only attaches the structured
  // summary to the request payload for a later layer to consume.
  const isLegalCaseAnalysis =
    documentAwareRouting.documentCategory === "legal_document" &&
    documentAwareRouting.analysisType === "legal_case_analysis";
  const legalDocumentSummary = isLegalCaseAnalysis
    ? createLegalDocumentSummaryFallback({
        assets: readRequestAttachmentAssets(body),
      })
    : null;
  // Third layer of ZERINIX Legal Intelligence: evidence-grounded case
  // analysis, built only from the layer-2 structured summary above (not
  // from the raw attachment again). This does not build the legal
  // report, PDF, timeline, risk scoring, or precedent search yet -- it
  // only attaches the analysis to the request payload for a later layer.
  const legalCaseAnalysis = legalDocumentSummary
    ? createLegalCaseAnalysis(legalDocumentSummary)
    : null;
  body.documentIntelligence = {
    documentCategory: documentAwareRouting.documentCategory,
    analysisType: documentAwareRouting.analysisType,
    confidence: documentClassification.confidence,
    ...(legalDocumentSummary ? { legalDocumentSummary } : {}),
    ...(legalCaseAnalysis ? { legalCaseAnalysis } : {}),
  };

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

  // ZERINIX Brain Orchestrator v1 integration. Feature-flagged so this new
  // path can be disabled instantly without a deploy. Only ever runs for
  // supported ZERINIX Business Intelligence contexts -- "chat" is the mode
  // Layer 1 above already forces confident legal documents into, so
  // excluding "chat" here also satisfies "never run for unsupported
  // document categories" without a second document-category check. All
  // early-stage engine results already computed above (Document
  // Intelligence, Universal Document Intelligence, Intelligence Router)
  // are passed in as `precomputed` so the orchestrator reuses them instead
  // of re-executing those same deterministic functions a second time.
  const brainOrchestratorEnabled =
    process.env.ZERINIX_BRAIN_ORCHESTRATOR_ENABLED === "true";
  const isSupportedBrainOrchestratorContext =
    normalizeSelectedAnalysisMode(body.analysisMode) !== "chat";

  if (brainOrchestratorEnabled && isSupportedBrainOrchestratorContext) {
    const brainOutput = runBrainOrchestrator({
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      attachments: readRequestAttachmentAssets(body),
      precomputed: {
        documentClassification,
        documentRouting: documentAwareRouting,
        universalDocumentIntelligence,
        decisionPlan,
      },
    });
    const brainExecution = brainOutput.execution;

    logOperationalInfo("plan.brain_orchestrator", {
      executedModules: brainExecution.executedModules,
      skippedModules: brainExecution.skippedModules,
      stopReason: brainExecution.stopReason,
      executionTimeMs: brainExecution.executionTime,
    });

    if (
      brainExecution.finalDecisionState.status === "insufficient_evidence" ||
      brainExecution.stopReason
    ) {
      return NextResponse.json(
        {
          error: `A responsible report cannot be produced yet. ${brainExecution.finalDecisionState.summary}`,
          code: "BRAIN_INSUFFICIENT_EVIDENCE",
          missing: brainExecution.stopReason,
          nextRecommendedAction: brainExecution.nextRecommendedAction,
        },
        { status: 422 }
      );
    }

    body.brainExecutionResult = brainExecution;
  }

  // ZERINIX Decision Engine v1 integration. Independently feature-flagged
  // from the Brain Orchestrator block above -- this replaces the generic
  // report-generation entry point with Adaptive Intelligence Engine ->
  // Intelligence Pipeline -> Evidence Validation -> Expert Reasoning ->
  // Executive Decision Brief, but only ever decides whether to hand off
  // to the existing, completely unmodified report-generation / PDF /
  // billing / UI flow below; it never calls or replaces any of those
  // itself. Defaults to disabled (ZERINIX_DECISION_ENGINE_ENABLED unset),
  // so every existing report continues to work exactly as before unless
  // this flag is explicitly set to "true". Gated on the same "not chat
  // mode" condition as the Brain Orchestrator block for the same reason:
  // Layer 1 above already diverts confident legal documents into chat
  // mode, so this excludes them without a second document-category
  // check -- any other domain that reaches the Decision Engine (medical,
  // engineering, HR, contract, etc.) is still handled safely, since
  // Intelligence Pipeline's own business-reasoning engines already
  // degrade to insufficient_evidence for non-business domains rather
  // than fabricating a business-flavored response.
  //
  // ZERINIX Executive Decision System v1 integration (below, checked
  // FIRST): Executive Decision System already calls Decision Engine
  // internally exactly once -- which itself already runs Business
  // Intelligence Orchestrator, Confidence Engine, Conflict Detection,
  // Evidence Quality Scoring, Source Reliability Engine, Evidence
  // Corroboration Engine, Live Research Engine, and Research
  // Prioritization/Execution Planning exactly once each. Running the
  // Decision Engine block below AS WELL for the same request would
  // duplicate every one of those modules a second time, so the two
  // blocks are deliberately mutually exclusive (if/else if): never both
  // executed for one request. When ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED
  // is off (the default), this `if` is skipped entirely and the
  // Decision Engine block runs exactly as it did before this
  // integration -- byte-for-byte unchanged -- so the current production
  // flow is fully preserved. Supported Business Intelligence requests
  // only: Decision Engine's own Adaptive Intelligence Engine stage
  // already makes that determination internally (selectedDomain ===
  // "business_intelligence"); this route only applies the same "not
  // chat mode" pre-filter every sibling integration block already uses.
  const executiveDecisionSystemEnabled = isExecutiveDecisionSystemEnabled();
  const isSupportedExecutiveDecisionSystemContext =
    normalizeSelectedAnalysisMode(body.analysisMode) !== "chat";
  const decisionEngineEnabled = isDecisionEngineEnabled();
  const isSupportedDecisionEngineContext =
    normalizeSelectedAnalysisMode(body.analysisMode) !== "chat";

  if (executiveDecisionSystemEnabled && isSupportedExecutiveDecisionSystemContext) {
    const { package: executiveDecisionPackage } = runExecutiveDecisionSystem({
      enabled: true,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      attachments: readRequestAttachmentAssets(body),
    });
    const businessIntelligence = executiveDecisionPackage.businessIntelligence;
    const criticalFailure = businessIntelligence?.criticalFailure ?? null;

    logOperationalInfo("plan.executive_decision_system", {
      status: executiveDecisionPackage.status,
      businessIntelligenceApplied: executiveDecisionPackage.businessIntelligenceApplied,
      executiveDecisionSignal: businessIntelligence?.executiveDecisionSignal ?? null,
      criticalFailureStage: criticalFailure?.stage ?? null,
      stopReason: executiveDecisionPackage.stopReason,
    });

    // End-to-end pipeline (v1): Executive Decision System -> Strategic
    // Decision Memo -> Executive Brief, each computed exactly once,
    // right here, from the SAME in-memory executiveDecisionPackage --
    // never re-validated, never re-run. Only meaningful on the success
    // path (both require businessIntelligence/executiveDecisionBrief,
    // which only exist when status is ready_for_report_generation); on
    // any other status they would just report generated:false, so they
    // are computed after, not before, the status check below to avoid
    // wasted work on a request that is about to be rejected anyway.

    if (executiveDecisionPackage.status !== "ready_for_report_generation") {
      // Structured explanation, never a fabricated fallback: every
      // field below is a direct, already-computed real value from the
      // package -- an empty array/null means that stage genuinely never
      // ran or found nothing, never an invented placeholder.
      const missingEvidence = uniqueStrings([
        ...executiveDecisionPackage.decision.evidenceValidation.missingEvidenceSummary,
        ...(businessIntelligence?.aggregatedResearchRequirements.detectedGaps ?? []),
      ]);
      const confidencePenalties = businessIntelligence?.confidence?.confidencePenalties ?? [];
      const detectedConflicts = businessIntelligence?.conflictDetection?.conflicts ?? [];
      const topResearchTask = businessIntelligence?.researchPrioritization?.prioritizedTasks[0] ?? null;

      return NextResponse.json(
        {
          error: `A responsible report cannot be produced yet. ${executiveDecisionPackage.stopReason || "Insufficient evidence."}`,
          code: criticalFailure
            ? "EXECUTIVE_DECISION_SYSTEM_CRITICAL_FAILURE"
            : "EXECUTIVE_DECISION_SYSTEM_INSUFFICIENT_EVIDENCE",
          reason: criticalFailure ? "critical_failure" : "insufficient_evidence",
          missingEvidence,
          confidencePenalties,
          detectedConflicts,
          highestValueNextResearchAction: topResearchTask
            ? { topic: topResearchTask.topic, explanation: topResearchTask.explanation }
            : null,
          nextRecommendedAction: executiveDecisionPackage.nextRecommendedAction,
        },
        { status: 422 }
      );
    }

    // Strategic Decision Memo and Executive Brief: each computed
    // exactly once, from the same executiveDecisionPackage above --
    // never re-running Decision Engine, Business Intelligence
    // Orchestrator, or any engine beneath them. Executive Brief reuses
    // the Memo's own already-computed risks/opportunities/actions/
    // confidence instead of re-deriving them a second time (see
    // executive-brief-generator.ts's file header).
    const strategicDecisionMemo = buildStrategicDecisionMemo({
      enabled: true,
      executiveDecisionPackage,
    });
    const executiveBrief = generateExecutiveBrief({
      enabled: true,
      executiveDecisionPackage,
      strategicDecisionMemo,
    });

    logOperationalInfo("plan.executive_brief_pipeline", {
      strategicDecisionMemoGenerated: strategicDecisionMemo.generated,
      executiveBriefGenerated: executiveBrief.generated,
    });

    // Structured context handoff: the existing report generator is
    // never called or modified here -- this only attaches the already-
    // computed package (and, for backward compatibility, the same
    // decisionEngineResult field the block below would have set) to the
    // request body that already flows, unmodified, into the existing
    // report-generation pipeline.
    body.decisionEngineResult = executiveDecisionPackage.decision;
    body.executiveDecisionSystemResult = executiveDecisionPackage;
    body.strategicDecisionMemo = strategicDecisionMemo;
    body.executiveBrief = executiveBrief;
  } else if (decisionEngineEnabled && isSupportedDecisionEngineContext) {
    const decisionEngineOutput = runDecisionEngine({
      enabled: true,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      attachments: readRequestAttachmentAssets(body),
    });
    const decision = decisionEngineOutput.decision;

    logOperationalInfo("plan.decision_engine", {
      executedStages: decision.executedStages,
      skippedStages: decision.skippedStages,
      status: decision.status,
      stopReason: decision.stopReason,
      executionTimeMs: decision.executionTimeMs,
    });

    if (decision.status !== "ready_for_report_generation") {
      return NextResponse.json(
        {
          error: `A responsible report cannot be produced yet. ${decision.stopReason || "Insufficient evidence."}`,
          code: "DECISION_ENGINE_INSUFFICIENT_EVIDENCE",
          missing: decision.evidenceValidation.missingEvidenceSummary,
          nextRecommendedAction: decision.nextRecommendedAction,
        },
        { status: 422 }
      );
    }

    body.decisionEngineResult = decision;
  }

  const isMarketIntelligenceRequest =
    normalizeSelectedAnalysisMode(body.analysisMode) === "market";
  // Market Intelligence never falls back to site/browser locale: a short,
  // keyword-sparse prompt ("US AI accounting software") has no detectable
  // language signal either way, and deferring to locale there is what
  // produces a Turkish report from an English prompt. Explicit selection
  // (Settings -> Preferred Language, when the user actually set it) still
  // takes priority over prompt detection, matching every other mode.
  const reportLanguageCode = isMarketIntelligenceRequest
    ? resolveMarketIntelligenceLanguage({
        explicitLanguage:
          body.explicitReportLanguage ||
          (
            await supabase
              .from("ai_chat_profiles")
              .select("preferred_language")
              .eq("user_id", user.id)
              .maybeSingle()
          ).data?.preferred_language,
        requestText: typeof body.prompt === "string" ? body.prompt : "",
      })
    : resolveReportLanguage({
        explicitLanguage: body.explicitReportLanguage,
        uiLanguage: body.uiLanguage || body.language || req.headers.get("x-zerinix-ui-language"),
        browserLanguage: body.browserLanguage || req.headers.get("accept-language"),
        requestText: typeof body.prompt === "string" ? body.prompt : "",
      });
  const reportLanguage = getResponseLanguage(reportLanguageCode);
  const expertiseProfile = readRequestExpertiseProfile(body);
  const modeMismatchMessage = getSelectedModeMismatchMessage({
    selectedMode: body.analysisMode,
    detectedDomain: expertiseProfile.domain,
    prompt: typeof body.prompt === "string" ? body.prompt : "",
  });
  if (modeMismatchMessage) {
    return NextResponse.json(
      { error: modeMismatchMessage, code: "ANALYSIS_MODE_MISMATCH" },
      { status: 422 }
    );
  }
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
    aiCostRequestId:
      req.headers.get("x-zerinix-ai-request-id")?.trim().slice(0, 128) ||
      idempotencyKey,
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
