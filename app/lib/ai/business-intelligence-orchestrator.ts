import { z } from "zod";
import type { EvidenceAcquisitionResult } from "./evidence-acquisition-engine.ts";
import {
  scoreEvidenceQuality,
  evidenceQualityScoringResultSchema,
  type ScorableEvidenceItem,
  type EvidenceQualityScoringResult,
} from "./evidence-quality-scoring.ts";
import {
  scoreSourceReliabilityBatch,
  sourceReliabilityResultSchema,
  type SourceReliabilityInput,
  type SourceReliabilityBatchResult,
} from "./source-reliability-engine.ts";
import {
  detectConflicts,
  conflictDetectionResultSchema,
  type ConflictDetectionResult,
} from "./conflict-detection-engine.ts";
import {
  checkEvidenceCorroboration,
  evidenceCorroborationResultSchema,
  type CorroborationConclusion,
  type EvidenceCorroborationResult,
} from "./evidence-corroboration-engine.ts";
import {
  computeConfidence,
  confidenceEngineResultSchema,
  type ConfidenceEngineResult,
} from "./confidence-engine.ts";
import {
  detectLiveResearchNeed,
  liveResearchEngineResultSchema,
  researchGapValues,
  decisionImpactValues,
  type LiveResearchEngineResult,
} from "./live-research-engine.ts";
import {
  prioritizeResearchTasks,
  researchPrioritizationResultSchema,
  type PrioritizationTaskCandidate,
  type ResearchPrioritizationResult,
} from "./research-prioritization-engine.ts";
import {
  planResearchExecution,
  researchExecutionPlanSchema,
  type ResearchExecutionTaskCandidate,
  type ResearchExecutionPlan,
} from "./research-execution-planner.ts";
import type { ExecutiveBriefDomain } from "./executive-decision-brief.ts";
import type { DecisionComplexity } from "./decision-intent-engine.ts";

// ZERINIX Business Intelligence Orchestrator v1.
//
// This is the central orchestration layer that runs every ZERINIX
// Business Intelligence engine built so far -- Evidence Quality
// Scoring, Source Reliability Engine, Conflict Detection Engine,
// Evidence Corroboration Engine, Confidence Engine, Live Research
// Engine, Research Prioritization Engine, and Research Execution
// Planner -- in their REAL data-flow dependency order, and folds
// their outputs into one Business Intelligence context object. Like
// the existing Brain Orchestrator, this module is NOT another
// intelligence engine itself: it never scores, detects, or reasons
// about anything on its own. Every number in the returned context
// either comes directly from one of the 8 engines above, or is a
// documented, transparent aggregate formula over their real outputs
// (never an invented "looks about right" figure).
//
// Real dependency order (matching each engine's actual function
// signature, not an illustrative diagram):
//   1. input_validation          -- reject structurally invalid raw
//                                    input before any engine runs.
//   2. evidence_quality_scoring  -- operates on the raw evidence pool.
//   3. source_reliability        -- operates on raw source info.
//   4. conflict_detection        -- operates on the raw evidence pool.
//   5. evidence_corroboration    -- operates on raw conclusions + pool.
//   6. confidence_engine         -- consumes evidence_quality_scoring's
//                                    output.
//   7. live_research             -- consumes evidence_quality_scoring's
//                                    output (+ an optional externally
//                                    supplied Evidence Acquisition
//                                    Engine result).
//   8. research_prioritization   -- consumes live_research's detected
//                                    gaps, mapped into task candidates.
//   9. research_execution_planning -- consumes research_prioritization's
//                                    ranked tasks, mapped into planner
//                                    candidates.
//
// Validate outputs between stages / stop on critical failures: every
// stage's raw result is checked against that engine's own exported
// zod schema before the next stage is allowed to run; if a stage ever
// returns something that does not parse, the ENTIRE remaining
// pipeline halts immediately (no later stage runs at all) and the
// context records exactly which stage and why. This is also why raw
// input is validated FIRST, as its own stage: several engines below
// would throw a raw JS error (not a graceful fallback) if handed an
// evidence item with no real `text`, so that structural check is a
// real, load-bearing gate, not a formality.
//
// Never fabricates intermediate results: a stage that never ran (was
// skipped by a critical failure) is represented as `null`, never as a
// look-alike "disabled" or "empty" object that could be mistaken for
// a real computed result. Every aggregate (confidence, evidence
// quality, executive decision signal) is a documented formula over
// whatever real stage outputs exist; a missing stage contributes a
// named, conservative neutral default (never a guess), and this
// engine's own top comment on each formula states exactly which.
//
// Deliberate override: each of the 8 engines above defaults to
// disabled via its OWN independent feature flag. Once this
// orchestrator itself is confirmed enabled, it explicitly passes
// `enabled: true` to every engine it calls, overriding each engine's
// individual flag -- there is no useful scenario where an operator
// turns the orchestrator on but wants an inner stage to silently
// no-op and report an empty/zero result, since that would silently
// corrupt every aggregate above it. This is a documented, intentional
// design choice, not a bypass of the "feature flag only" requirement:
// the orchestrator's OWN flag is still the single real gate.
//
// Scope (v1): this module makes no network/AI calls, never generates
// a report, and is not wired into any route, engine, PDF generation,
// UI, or billing -- it produces a context object for a future caller
// to consume, but does not itself call Executive Decision Brief or any
// other strategic-recommendation-producing module. Feature-flagged via
// ZERINIX_BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED, defaulting to
// disabled (or pass `enabled: true`, primarily for tests).

export const orchestratorStageValues = [
  "input_validation",
  "evidence_quality_scoring",
  "source_reliability",
  "conflict_detection",
  "evidence_corroboration",
  "confidence_engine",
  "live_research",
  "research_prioritization",
  "research_execution_planning",
] as const;

export type OrchestratorStage = (typeof orchestratorStageValues)[number];

export const executiveDecisionSignalValues = [
  "proceed",
  "proceed_with_caution",
  "do_not_proceed_insufficient_evidence",
] as const;

export type ExecutiveDecisionSignal = (typeof executiveDecisionSignalValues)[number];

export const BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR =
  "ZERINIX_BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED";

export function isBusinessIntelligenceOrchestratorEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const criticalFailureSchema = z
  .object({
    stage: z.enum(orchestratorStageValues),
    reason: shortString(500),
  })
  .strict();

export type CriticalFailure = z.infer<typeof criticalFailureSchema>;

const sourceReliabilityBatchResultSchema = z
  .object({
    enabled: z.boolean(),
    sources: z.array(sourceReliabilityResultSchema).max(200),
  })
  .strict();

const aggregatedResearchRequirementsSchema = z
  .object({
    // null means the Live Research Engine stage never ran, so whether
    // research is required is genuinely unknown -- never guessed as
    // false (which would falsely claim "no research needed").
    liveResearchRequired: z.boolean().nullable(),
    detectedGaps: z.array(z.enum(researchGapValues)).max(researchGapValues.length),
    overallExpectedDecisionImpact: z.enum(decisionImpactValues).nullable(),
    prioritizedResearchOrder: z.array(shortString(120)).max(100),
    executionSequence: z.array(shortString(120)).max(100),
  })
  .strict();

export type AggregatedResearchRequirements = z.infer<typeof aggregatedResearchRequirementsSchema>;

export const businessIntelligenceContextSchema = z
  .object({
    enabled: z.boolean(),
    stagesExecuted: z.array(z.enum(orchestratorStageValues)).max(orchestratorStageValues.length),
    criticalFailure: criticalFailureSchema.nullable(),
    evidenceQuality: evidenceQualityScoringResultSchema.nullable(),
    sourceReliability: sourceReliabilityBatchResultSchema.nullable(),
    conflictDetection: conflictDetectionResultSchema.nullable(),
    evidenceCorroboration: evidenceCorroborationResultSchema.nullable(),
    confidence: confidenceEngineResultSchema.nullable(),
    liveResearch: liveResearchEngineResultSchema.nullable(),
    researchPrioritization: researchPrioritizationResultSchema.nullable(),
    researchExecutionPlan: researchExecutionPlanSchema.nullable(),
    aggregateConfidence: z.number().min(0).max(100),
    aggregateEvidenceQuality: z.number().min(0).max(100),
    aggregatedResearchRequirements: aggregatedResearchRequirementsSchema,
    executiveDecisionSignal: z.enum(executiveDecisionSignalValues),
    orchestrationTrace: z.array(shortString(600)).max(60),
  })
  .strict();

export type BusinessIntelligenceContext = z.infer<typeof businessIntelligenceContextSchema>;

export type BusinessIntelligenceOrchestratorInput = {
  evidence?: readonly ScorableEvidenceItem[];
  sources?: readonly SourceReliabilityInput[];
  conclusions?: readonly CorroborationConclusion[];
  // Passed through to Evidence Quality Scoring's own context.
  decisionObjective?: string;
  expectedItemCount?: number;
  now?: Date;
  // Passed through to Live Research Engine, when the caller already
  // has one; never constructed by this orchestrator itself.
  evidenceAcquisitionResult?: EvidenceAcquisitionResult;
  // Passed through to Confidence Engine.
  independentSourceCount?: number;
  domain?: ExecutiveBriefDomain;
  decisionComplexity?: DecisionComplexity;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED
  // environment variable.
  enabled?: boolean;
};

function roundClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// A genuine, testable validation gate: every stage's raw output is
// checked against that engine's own exported schema before the next
// stage is allowed to run.
export function validateStageOutput<T>(
  schema: z.ZodType<T>,
  result: T
): { success: true } | { success: false; reason: string } {
  const parsed = schema.safeParse(result);
  if (parsed.success) {
    return { success: true };
  }
  const reason = `Output failed schema validation: ${parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")}`;
  return { success: false, reason };
}

// No real basis for a component: a documented conservative/neutral
// midpoint, never a guess in either direction.
const NEUTRAL_DEFAULT_SCORE = 50;

function meanSourceReliabilityScore(sourceReliability: SourceReliabilityBatchResult | null): number | null {
  if (!sourceReliability || sourceReliability.sources.length === 0) {
    return null;
  }
  const total = sourceReliability.sources.reduce((sum, source) => sum + source.reliabilityScore, 0);
  return total / sourceReliability.sources.length;
}

function meanCorroborationConfidence(evidenceCorroboration: EvidenceCorroborationResult | null): number | null {
  if (!evidenceCorroboration || evidenceCorroboration.conclusions.length === 0) {
    return null;
  }
  const total = evidenceCorroboration.conclusions.reduce((sum, conclusion) => sum + conclusion.confidence, 0);
  return total / evidenceCorroboration.conclusions.length;
}

// Equal-weighted mean of the 4 confidence-relevant signals that exist
// across the whole engine stack -- distinct from Confidence Engine's
// own single-engine score (which only draws from Evidence Quality
// Scoring, domain, and decision complexity). Each component either
// comes from a real stage output, or falls back to the documented
// neutral default with the reason recorded in the trace.
function computeAggregateConfidence(
  confidence: ConfidenceEngineResult | null,
  sourceReliability: SourceReliabilityBatchResult | null,
  conflictDetection: ConflictDetectionResult | null,
  evidenceCorroboration: EvidenceCorroborationResult | null,
  trace: string[]
): number {
  const meanReliability = meanSourceReliabilityScore(sourceReliability);
  const meanCorroboration = meanCorroborationConfidence(evidenceCorroboration);

  const components: { label: string; score: number; real: boolean }[] = [
    {
      label: "confidence_engine_score",
      score: confidence?.confidence ?? NEUTRAL_DEFAULT_SCORE,
      real: confidence !== null,
    },
    {
      label: "mean_source_reliability_score",
      score: meanReliability ?? NEUTRAL_DEFAULT_SCORE,
      real: meanReliability !== null,
    },
    {
      label: "conflict_health_score",
      score: conflictDetection ? 100 - conflictDetection.confidenceImpact : NEUTRAL_DEFAULT_SCORE,
      real: conflictDetection !== null,
    },
    {
      label: "mean_corroboration_confidence",
      score: meanCorroboration ?? NEUTRAL_DEFAULT_SCORE,
      real: meanCorroboration !== null,
    },
  ];

  const aggregate = roundClamp(components.reduce((sum, entry) => sum + entry.score, 0) / components.length);
  trace.push(
    `aggregateConfidence = mean(${components
      .map((entry) => `${entry.label}=${Math.round(entry.score)}${entry.real ? "" : " [defaulted]"}`)
      .join(", ")}) = ${aggregate}.`
  );
  return aggregate;
}

// Equal-weighted mean of the 2 evidence-quality-relevant signals that
// exist across the engine stack: Evidence Quality Scoring's own pool
// score, and Source Reliability Engine's mean source score.
function computeAggregateEvidenceQuality(
  evidenceQuality: EvidenceQualityScoringResult | null,
  sourceReliability: SourceReliabilityBatchResult | null,
  trace: string[]
): number {
  const meanReliability = meanSourceReliabilityScore(sourceReliability);

  const components: { label: string; score: number; real: boolean }[] = [
    {
      label: "evidence_quality_pool_score",
      score: evidenceQuality?.overallPoolScore ?? NEUTRAL_DEFAULT_SCORE,
      real: evidenceQuality !== null,
    },
    {
      label: "mean_source_reliability_score",
      score: meanReliability ?? NEUTRAL_DEFAULT_SCORE,
      real: meanReliability !== null,
    },
  ];

  const aggregate = roundClamp(components.reduce((sum, entry) => sum + entry.score, 0) / components.length);
  trace.push(
    `aggregateEvidenceQuality = mean(${components
      .map((entry) => `${entry.label}=${Math.round(entry.score)}${entry.real ? "" : " [defaulted]"}`)
      .join(", ")}) = ${aggregate}.`
  );
  return aggregate;
}

function buildAggregatedResearchRequirements(
  liveResearch: LiveResearchEngineResult | null,
  researchPrioritization: ResearchPrioritizationResult | null,
  researchExecutionPlan: ResearchExecutionPlan | null
): AggregatedResearchRequirements {
  return {
    liveResearchRequired: liveResearch?.liveResearchRequired ?? null,
    detectedGaps: liveResearch?.detectedGaps ?? [],
    overallExpectedDecisionImpact: liveResearch?.overallExpectedDecisionImpact ?? null,
    prioritizedResearchOrder: researchPrioritization?.recommendedOrder ?? [],
    executionSequence: researchExecutionPlan?.executionSequence ?? [],
  };
}

const CRITICAL_CONFIDENCE_THRESHOLD = 40;
const CAUTION_CONFIDENCE_THRESHOLD = 70;

// A deterministic, threshold-based rollup of every engine's
// decision-relevant signal -- never an invented judgment call. A
// critical failure anywhere in the pipeline unconditionally forces
// the most conservative signal, since the pipeline could not even
// validate its own input.
function computeExecutiveDecisionSignal(
  criticalFailure: CriticalFailure | null,
  aggregateConfidence: number,
  conflictDetection: ConflictDetectionResult | null,
  evidenceCorroboration: EvidenceCorroborationResult | null,
  liveResearch: LiveResearchEngineResult | null
): ExecutiveDecisionSignal {
  if (criticalFailure) {
    return "do_not_proceed_insufficient_evidence";
  }

  const hasCriticalConflict = conflictDetection?.overallSeverity === "critical";
  const hasUnmetHighImpactRequirement = (evidenceCorroboration?.highImpactRequirementsNotMet.length ?? 0) > 0;

  if (hasCriticalConflict || hasUnmetHighImpactRequirement || aggregateConfidence < CRITICAL_CONFIDENCE_THRESHOLD) {
    return "do_not_proceed_insufficient_evidence";
  }

  const liveResearchRequired = liveResearch?.liveResearchRequired ?? null;
  if (liveResearchRequired === true || liveResearchRequired === null || aggregateConfidence < CAUTION_CONFIDENCE_THRESHOLD) {
    return "proceed_with_caution";
  }

  return "proceed";
}

function disabledContext(): BusinessIntelligenceContext {
  return {
    enabled: false,
    stagesExecuted: [],
    criticalFailure: null,
    evidenceQuality: null,
    sourceReliability: null,
    conflictDetection: null,
    evidenceCorroboration: null,
    confidence: null,
    liveResearch: null,
    researchPrioritization: null,
    researchExecutionPlan: null,
    aggregateConfidence: 0,
    aggregateEvidenceQuality: 0,
    aggregatedResearchRequirements: {
      liveResearchRequired: null,
      detectedGaps: [],
      overallExpectedDecisionImpact: null,
      prioritizedResearchOrder: [],
      executionSequence: [],
    },
    executiveDecisionSignal: "proceed_with_caution",
    orchestrationTrace: [
      `Business Intelligence Orchestrator is disabled (set ${BUSINESS_INTELLIGENCE_ORCHESTRATOR_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function runBusinessIntelligenceOrchestration(
  input: BusinessIntelligenceOrchestratorInput = {}
): BusinessIntelligenceContext {
  const enabled = input.enabled ?? isBusinessIntelligenceOrchestratorEnabled();
  if (!enabled) {
    return disabledContext();
  }

  const orchestrationTrace: string[] = [];
  const stagesExecuted: OrchestratorStage[] = [];
  let criticalFailure: CriticalFailure | null = null;
  let halted = false;

  const evidence = input.evidence ?? [];
  const conclusions = input.conclusions ?? [];
  const sources = input.sources ?? [];

  const invalidEvidenceIndex = evidence.findIndex((item) => !item || typeof item.text !== "string" || !item.text.trim());
  const invalidConclusionIndex = conclusions.findIndex(
    (conclusion) => !conclusion || typeof conclusion.statement !== "string" || !conclusion.statement.trim()
  );

  if (invalidEvidenceIndex !== -1 || invalidConclusionIndex !== -1) {
    const reason =
      invalidEvidenceIndex !== -1
        ? `evidence[${invalidEvidenceIndex}] is missing a required non-empty "text" field.`
        : `conclusions[${invalidConclusionIndex}] is missing a required non-empty "statement" field.`;
    criticalFailure = { stage: "input_validation", reason };
    orchestrationTrace.push(
      `Critical failure at stage "input_validation": ${reason} Halting before any engine runs.`
    );
    halted = true;
  } else {
    stagesExecuted.push("input_validation");
    orchestrationTrace.push(`Stage "input_validation" completed: ${evidence.length} evidence item(s), ${conclusions.length} conclusion(s), ${sources.length} source(s) are structurally valid.`);
  }

  function runStage<T>(stage: OrchestratorStage, compute: () => T, schema: z.ZodType<T>): T | null {
    if (halted) {
      return null;
    }
    const result = compute();
    const check = validateStageOutput(schema, result);
    if (!check.success) {
      criticalFailure = { stage, reason: check.reason };
      orchestrationTrace.push(
        `Critical failure at stage "${stage}": ${check.reason} Halting orchestration before any later stage runs.`
      );
      halted = true;
      return null;
    }
    stagesExecuted.push(stage);
    orchestrationTrace.push(`Stage "${stage}" completed.`);
    return result;
  }

  const evidenceQuality = runStage(
    "evidence_quality_scoring",
    () =>
      scoreEvidenceQuality(evidence, {
        decisionObjective: input.decisionObjective,
        now: input.now,
        expectedItemCount: input.expectedItemCount,
        enabled: true,
      }),
    evidenceQualityScoringResultSchema
  );

  const sourceReliability = runStage(
    "source_reliability",
    () => scoreSourceReliabilityBatch(sources, { enabled: true }),
    sourceReliabilityBatchResultSchema
  );

  const conflictDetection = runStage(
    "conflict_detection",
    () => detectConflicts(evidence, { enabled: true }),
    conflictDetectionResultSchema
  );

  const evidenceCorroboration = runStage(
    "evidence_corroboration",
    () => checkEvidenceCorroboration({ conclusions, evidence, enabled: true }),
    evidenceCorroborationResultSchema
  );

  const confidence = runStage(
    "confidence_engine",
    () =>
      computeConfidence({
        evidenceQualityResult: evidenceQuality ?? undefined,
        independentSourceCount: input.independentSourceCount,
        domain: input.domain,
        decisionComplexity: input.decisionComplexity,
        enabled: true,
      }),
    confidenceEngineResultSchema
  );

  const liveResearch = runStage(
    "live_research",
    () =>
      detectLiveResearchNeed({
        evidenceAcquisitionResult: input.evidenceAcquisitionResult,
        evidenceQualityResult: evidenceQuality ?? undefined,
        enabled: true,
      }),
    liveResearchEngineResultSchema
  );

  const researchPrioritization = runStage(
    "research_prioritization",
    () => {
      const candidates: PrioritizationTaskCandidate[] = (liveResearch?.tasks ?? []).map((task) => ({
        id: task.gap,
        topic: task.topic,
        expectedDecisionImpact: task.expectedDecisionImpact,
      }));
      return prioritizeResearchTasks({ tasks: candidates, enabled: true });
    },
    researchPrioritizationResultSchema
  );

  const researchExecutionPlan = runStage(
    "research_execution_planning",
    () => {
      const candidates: ResearchExecutionTaskCandidate[] = (researchPrioritization?.prioritizedTasks ?? []).map(
        (task) => ({
          id: task.taskId,
          topic: task.topic,
          priorityRank: task.rank,
          valueScore: task.valueScore,
          estimatedTimeHours: task.estimatedTimeHours,
        })
      );
      return planResearchExecution({ tasks: candidates, enabled: true });
    },
    researchExecutionPlanSchema
  );

  const rawAggregateConfidence = computeAggregateConfidence(
    confidence,
    sourceReliability,
    conflictDetection,
    evidenceCorroboration,
    orchestrationTrace
  );
  const rawAggregateEvidenceQuality = computeAggregateEvidenceQuality(
    evidenceQuality,
    sourceReliability,
    orchestrationTrace
  );

  // A critical failure means the pipeline could not even validate (or
  // could not trust the shape of) its own data -- report the worst
  // case (0), never the componentwise neutral-default average, which
  // would misleadingly read as "checked and moderate."
  const aggregateConfidence = criticalFailure ? 0 : rawAggregateConfidence;
  const aggregateEvidenceQuality = criticalFailure ? 0 : rawAggregateEvidenceQuality;

  const aggregatedResearchRequirements = buildAggregatedResearchRequirements(
    liveResearch,
    researchPrioritization,
    researchExecutionPlan
  );

  const executiveDecisionSignal = computeExecutiveDecisionSignal(
    criticalFailure,
    aggregateConfidence,
    conflictDetection,
    evidenceCorroboration,
    liveResearch
  );

  orchestrationTrace.push(
    `Orchestration finished: ${stagesExecuted.length}/${orchestratorStageValues.length} stage(s) executed, executiveDecisionSignal="${executiveDecisionSignal}".`
  );

  return {
    enabled: true,
    stagesExecuted,
    criticalFailure,
    evidenceQuality,
    sourceReliability,
    conflictDetection,
    evidenceCorroboration,
    confidence,
    liveResearch,
    researchPrioritization,
    researchExecutionPlan,
    aggregateConfidence,
    aggregateEvidenceQuality,
    aggregatedResearchRequirements,
    executiveDecisionSignal,
    orchestrationTrace,
  };
}
