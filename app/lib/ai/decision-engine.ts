import { z } from "zod";
import type { DocumentClassificationAsset } from "./document-intelligence.ts";
import {
  runAdaptiveIntelligenceEngine,
  type AdaptiveIntelligenceDomain,
  type AdaptiveIntelligenceResult,
} from "./adaptive-intelligence-engine.ts";
import { runIntelligencePipeline, type IntelligencePipelineOutput } from "./intelligence-pipeline.ts";
import type { EvidenceAcquisitionCandidate } from "./evidence-acquisition-engine.ts";

// ZERINIX Decision Engine v1.
//
// This replaces the generic report-generation entry point with a real
// decision flow, gated behind its own feature flag:
//
//   User Request
//         v
//   Adaptive Intelligence Engine   (decide HOW to think: domain + reasoning profile)
//         v
//   Intelligence Pipeline           (run the connected reasoning stages)
//         v
//   Evidence Validation             (checkpoint: is there enough evidence to proceed?)
//         v
//   Expert Reasoning                (sourced from the pipeline's own result, not re-run)
//         v
//   Executive Decision Brief        (sourced from the pipeline's own result, not re-run)
//         v
//   Existing Report Generator       (unchanged -- this module never calls it)
//
// "Expert Reasoning" and "Executive Decision Brief" are listed as their
// own stages here (matching the requested flow) but are never executed a
// second time: Intelligence Pipeline already runs both internally, so
// this engine only reads their already-computed results out of the
// pipeline's output -- exactly the same "never duplicate an already-run
// engine" principle used throughout the rest of ZERINIX Intelligence.
//
// Scope: this module makes no network/AI calls, never generates a report,
// and never touches PDF generation, billing, or UI. Its only output is a
// decision -- ready_for_report_generation, insufficient_evidence, or
// failed -- plus the structured context a caller can attach to an
// existing, unmodified report-generation request. Wiring it into
// app/api/plan/route.ts is the only "production" touch this task makes,
// and it is entirely gated behind DECISION_ENGINE_ENABLED_ENV_VAR,
// defaulting to disabled so the existing flow is completely unaffected
// unless the flag is explicitly turned on.
//
// Intelligence Pipeline's own reasoning stages (Decision Intent Engine,
// Decision Strategy Engine, Expert Reasoning Engine) are business-
// reasoning engines; they do not yet have a dedicated executable
// pipeline for medical_intelligence, engineering_intelligence,
// hr_intelligence, or contract_intelligence domains that Adaptive
// Intelligence Engine can identify. When Adaptive Intelligence Engine
// selects one of those domains, Intelligence Pipeline still runs (its own
// Expert Reasoning Engine already hard-blocks non-business document
// domains as "unsupported"), and Evidence Validation correctly reports
// insufficient_evidence -- this is intentional: a report generator that
// only knows how to reason about business/financial/market decisions
// must never fabricate a business-flavored answer to a medical,
// engineering, HR, or contract document just because a report was
// requested.

export const decisionEngineStageValues = [
  "Adaptive Intelligence Engine",
  "Intelligence Pipeline",
  "Evidence Validation",
  "Expert Reasoning",
  "Executive Decision Brief",
] as const;

export type DecisionEngineStage = (typeof decisionEngineStageValues)[number];

export const decisionEngineStatusValues = [
  "not_started",
  "ready_for_report_generation",
  "insufficient_evidence",
  "failed",
] as const;

export type DecisionEngineStatus = (typeof decisionEngineStatusValues)[number];

export const DECISION_ENGINE_ENABLED_ENV_VAR = "ZERINIX_DECISION_ENGINE_ENABLED";

export function isDecisionEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[DECISION_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

const skippedStageSchema = z
  .object({
    stage: z.enum(decisionEngineStageValues),
    reason: shortString(400),
  })
  .strict();

export const evidenceValidationStatusValues = ["sufficient", "insufficient", "not_reached"] as const;
export type EvidenceValidationStatus = (typeof evidenceValidationStatusValues)[number];

export const evidenceValidationSchema = z
  .object({
    status: z.enum(evidenceValidationStatusValues),
    reason: z.string().trim().max(500).nullable(),
    missingEvidenceSummary: z.array(shortString(300)).max(20),
    evidenceTrace: z.array(shortString(400)).max(10),
  })
  .strict();

export type EvidenceValidation = z.infer<typeof evidenceValidationSchema>;

export const decisionEngineResultSchema = z
  .object({
    enabled: z.boolean(),
    status: z.enum(decisionEngineStatusValues),
    stageOrder: z.array(z.enum(decisionEngineStageValues)).length(decisionEngineStageValues.length),
    executedStages: z.array(z.enum(decisionEngineStageValues)).max(decisionEngineStageValues.length),
    skippedStages: z.array(skippedStageSchema).max(decisionEngineStageValues.length),
    stopReason: z.string().trim().max(500).nullable(),
    selectedDomain: z.string().trim().max(60).nullable(),
    reasoningApproach: z.string().trim().max(300).nullable(),
    evidenceValidation: evidenceValidationSchema,
    executiveSummary: z.string().trim().max(2000).nullable(),
    recommendationStatus: z.string().trim().max(60).nullable(),
    nextRecommendedAction: z.string().trim().max(400).nullable(),
    evidenceTrace: z.array(shortString(500)).max(40),
    executionTimeMs: z.number().min(0),
  })
  .strict();

export type DecisionEngineResult = z.infer<typeof decisionEngineResultSchema>;

// Additive, beyond the required result schema: the raw output of every
// stage that actually ran, so a future consumer (e.g. the report
// generator itself, later) can use the real data without re-running
// anything.
export type DecisionEngineResults = {
  adaptiveIntelligenceResult: AdaptiveIntelligenceResult | null;
  intelligencePipelineOutput: IntelligencePipelineOutput | null;
};

export type DecisionEngineOutput = {
  decision: DecisionEngineResult;
  results: DecisionEngineResults;
};

export type DecisionEngineInput = {
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_DECISION_ENGINE_ENABLED environment variable.
  enabled?: boolean;
  prompt?: string;
  conversationContext?: readonly string[];
  attachments?: readonly DocumentClassificationAsset[];
  marketResearchEvidence?: readonly string[];
  businessPlanEvidence?: readonly string[];
  financialEvidence?: readonly string[];
  userProvidedFacts?: readonly string[];
  availableEvidence?: readonly string[];
  additionalVerifiedEvidence?: readonly string[];
  additionalDirectionalSignals?: readonly string[];
  additionalAssumptions?: readonly string[];
  externalEvidenceCandidates?: readonly EvidenceAcquisitionCandidate[];
};

const NO_EVIDENCE_VALIDATION: EvidenceValidation = {
  status: "not_reached",
  reason: null,
  missingEvidenceSummary: [],
  evidenceTrace: [],
};

function validateEvidence(pipelineOutput: IntelligencePipelineOutput): EvidenceValidation {
  const { decisionStrategyResult, expertReasoningResult, evidenceAcquisitionResult } = pipelineOutput.results;
  const evidenceTrace: string[] = [];
  const missingEvidenceSummary = [
    ...(evidenceAcquisitionResult?.missingCategories || []),
    ...(expertReasoningResult?.evidenceGaps || []),
  ];

  if (decisionStrategyResult) {
    evidenceTrace.push(
      `Decision Strategy Engine's recommendedDecision.status is "${decisionStrategyResult.recommendedDecision.status}", evidenceStrength is "${decisionStrategyResult.evidenceStrength}".`
    );
    if (decisionStrategyResult.recommendedDecision.status === "insufficient_evidence") {
      return {
        status: "insufficient",
        reason: decisionStrategyResult.executiveSummary,
        missingEvidenceSummary,
        evidenceTrace,
      };
    }
    return { status: "sufficient", reason: null, missingEvidenceSummary, evidenceTrace };
  }

  if (expertReasoningResult) {
    evidenceTrace.push(`Expert Reasoning Engine's recommendationStatus is "${expertReasoningResult.recommendationStatus}".`);
    if (expertReasoningResult.recommendationStatus === "insufficient_evidence") {
      return {
        status: "insufficient",
        reason: expertReasoningResult.confidenceExplanation,
        missingEvidenceSummary,
        evidenceTrace,
      };
    }
  }

  evidenceTrace.push("Intelligence Pipeline did not reach Decision Strategy Engine or Expert Reasoning Engine.");
  return {
    status: "insufficient",
    reason: "Intelligence Pipeline did not produce a Decision Strategy or Expert Reasoning result to validate.",
    missingEvidenceSummary,
    evidenceTrace,
  };
}

export function runDecisionEngine(input: DecisionEngineInput = {}): DecisionEngineOutput {
  const startedAt = Date.now();
  const results: DecisionEngineResults = {
    adaptiveIntelligenceResult: null,
    intelligencePipelineOutput: null,
  };

  const enabled = input.enabled ?? isDecisionEngineEnabled();

  if (!enabled) {
    const reason = `Decision Engine is disabled (set ${DECISION_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`;
    return {
      decision: {
        enabled: false,
        status: "not_started",
        stageOrder: [...decisionEngineStageValues],
        executedStages: [],
        skippedStages: decisionEngineStageValues.map((stage) => ({ stage, reason })),
        stopReason: "Decision Engine is disabled via feature flag; the existing report generation flow is unaffected.",
        selectedDomain: null,
        reasoningApproach: null,
        evidenceValidation: NO_EVIDENCE_VALIDATION,
        executiveSummary: null,
        recommendationStatus: null,
        nextRecommendedAction: null,
        evidenceTrace: [
          `Decision Engine is disabled (${DECISION_ENGINE_ENABLED_ENV_VAR} is not "true"); no stage was executed.`,
        ],
        executionTimeMs: Date.now() - startedAt,
      },
      results,
    };
  }

  const {
    prompt = "",
    conversationContext = [],
    attachments = [],
    marketResearchEvidence = [],
    businessPlanEvidence = [],
    financialEvidence = [],
    userProvidedFacts = [],
    availableEvidence = [],
    additionalVerifiedEvidence = [],
    additionalDirectionalSignals = [],
    additionalAssumptions = [],
    externalEvidenceCandidates = [],
  } = input;

  const executedStages: DecisionEngineStage[] = [];
  const skippedStages: z.infer<typeof skippedStageSchema>[] = [];
  const evidenceTrace: string[] = [];

  function finish(
    status: DecisionEngineStatus,
    stopReason: string | null,
    overrides: Partial<
      Pick<
        DecisionEngineResult,
        | "selectedDomain"
        | "reasoningApproach"
        | "evidenceValidation"
        | "executiveSummary"
        | "recommendationStatus"
        | "nextRecommendedAction"
      >
    > = {}
  ): DecisionEngineOutput {
    return {
      decision: {
        enabled: true,
        status,
        stageOrder: [...decisionEngineStageValues],
        executedStages,
        skippedStages,
        stopReason,
        selectedDomain: overrides.selectedDomain ?? null,
        reasoningApproach: overrides.reasoningApproach ?? null,
        evidenceValidation: overrides.evidenceValidation ?? NO_EVIDENCE_VALIDATION,
        executiveSummary: overrides.executiveSummary ?? null,
        recommendationStatus: overrides.recommendationStatus ?? null,
        nextRecommendedAction: overrides.nextRecommendedAction ?? null,
        evidenceTrace,
        executionTimeMs: Date.now() - startedAt,
      },
      results,
    };
  }

  function skipRemaining(stages: readonly DecisionEngineStage[], reason: string) {
    for (const stage of stages) {
      skippedStages.push({ stage, reason });
      evidenceTrace.push(`Skipping ${stage}: ${reason}`);
    }
  }

  // Stage 1: Adaptive Intelligence Engine.
  evidenceTrace.push("Running Adaptive Intelligence Engine.");
  const adaptiveIntelligenceResult = runAdaptiveIntelligenceEngine({ prompt, attachments });
  results.adaptiveIntelligenceResult = adaptiveIntelligenceResult;
  executedStages.push("Adaptive Intelligence Engine");

  if (!adaptiveIntelligenceResult.selectedDomain) {
    const stopReason = `Adaptive Intelligence Engine could not determine a reasoning domain: ${adaptiveIntelligenceResult.cannotDetermineReason}`;
    evidenceTrace.push(stopReason);
    skipRemaining(
      ["Intelligence Pipeline", "Evidence Validation", "Expert Reasoning", "Executive Decision Brief"],
      stopReason
    );
    return finish("insufficient_evidence", stopReason);
  }

  const selectedDomain: AdaptiveIntelligenceDomain = adaptiveIntelligenceResult.selectedDomain;
  evidenceTrace.push(
    `Adaptive Intelligence Engine selected domain "${selectedDomain}" (confidence ${adaptiveIntelligenceResult.confidenceProfile.overallConfidence}).`
  );

  // Stage 2: Intelligence Pipeline.
  evidenceTrace.push("Running Intelligence Pipeline.");
  const intelligencePipelineOutput = runIntelligencePipeline({
    enabled: true,
    prompt,
    conversationContext,
    attachments,
    marketResearchEvidence,
    businessPlanEvidence,
    financialEvidence,
    userProvidedFacts,
    availableEvidence,
    additionalVerifiedEvidence,
    additionalDirectionalSignals,
    additionalAssumptions,
    externalEvidenceCandidates,
  });
  results.intelligencePipelineOutput = intelligencePipelineOutput;
  executedStages.push("Intelligence Pipeline");

  if (intelligencePipelineOutput.pipeline.stopReason) {
    const stopReason = `Intelligence Pipeline stopped: ${intelligencePipelineOutput.pipeline.stopReason}`;
    evidenceTrace.push(stopReason);
    skipRemaining(["Evidence Validation", "Expert Reasoning", "Executive Decision Brief"], stopReason);
    return finish("insufficient_evidence", stopReason, {
      selectedDomain,
      reasoningApproach: adaptiveIntelligenceResult.reasoningProfile?.reasoningApproach ?? null,
    });
  }

  // Stage 3: Evidence Validation.
  evidenceTrace.push("Running Evidence Validation.");
  const evidenceValidation = validateEvidence(intelligencePipelineOutput);
  executedStages.push("Evidence Validation");
  evidenceTrace.push(...evidenceValidation.evidenceTrace);

  if (evidenceValidation.status === "insufficient") {
    const stopReason = evidenceValidation.reason || "Evidence Validation determined the available evidence is insufficient.";
    evidenceTrace.push(stopReason);
    skipRemaining(["Expert Reasoning", "Executive Decision Brief"], stopReason);
    return finish("insufficient_evidence", stopReason, {
      selectedDomain,
      reasoningApproach: adaptiveIntelligenceResult.reasoningProfile?.reasoningApproach ?? null,
      evidenceValidation,
    });
  }

  // Stage 4: Expert Reasoning -- sourced from Intelligence Pipeline's own
  // already-computed result, never re-executed.
  executedStages.push("Expert Reasoning");
  evidenceTrace.push("Expert Reasoning sourced from Intelligence Pipeline's own result (not re-executed).");

  // Stage 5: Executive Decision Brief -- same reuse.
  executedStages.push("Executive Decision Brief");
  evidenceTrace.push("Executive Decision Brief sourced from Intelligence Pipeline's own result (not re-executed).");

  const { decisionStrategyResult } = intelligencePipelineOutput.results;
  evidenceTrace.push("Decision Engine is ready to hand off to the existing, unmodified report generator.");

  return finish("ready_for_report_generation", null, {
    selectedDomain,
    reasoningApproach: adaptiveIntelligenceResult.reasoningProfile?.reasoningApproach ?? null,
    evidenceValidation,
    executiveSummary: decisionStrategyResult?.executiveSummary ?? null,
    recommendationStatus: decisionStrategyResult?.recommendedDecision.status ?? null,
    nextRecommendedAction: decisionStrategyResult?.executionPriority[0] ?? null,
  });
}
