import { z } from "zod";
import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
} from "./executive-decision-system.ts";
import { decisionEngineStatusValues } from "./decision-engine.ts";
import { executiveDecisionSignalValues } from "./business-intelligence-orchestrator.ts";
import { confidenceDriverSchema, confidencePenaltySchema } from "./confidence-engine.ts";
import {
  strategicRecommendedActionSchema,
  strategicDecisionMemoSchema,
  type StrategicRecommendedAction,
  type StrategicDecisionMemo,
} from "./strategic-decision-memo.ts";
import type { ExecutiveDecisionBrief } from "./executive-decision-brief.ts";
import type { BusinessIntelligenceContext } from "./business-intelligence-orchestrator.ts";

// ZERINIX Executive Brief Generator v1.
//
// Generates an Executive Brief directly and exclusively from ZERINIX
// Executive Decision System v1's own output. This is a NEW, additive
// pipeline: it does not modify, replace, or call
// executive-decision-brief.ts (Layer 6's ExpertReasoningResult-primary
// builder, still used unchanged by Brain Orchestrator, the Intelligence
// Pipeline connector, and Decision Engine's own internal integration)
// -- it reads that module's own output (already embedded
// in the Executive Decision Package as `executiveDecisionBrief`) as
// ONE of several real inputs, alongside Business Intelligence
// Orchestrator's own confidence/conflict/evidence-quality/source-
// reliability/corroboration/research-priority data. Executive Decision
// System is the ONLY primary source; this module makes no network/AI
// calls of its own and never re-runs Decision Engine, Business
// Intelligence Orchestrator, or any of the 8 engines beneath them.
//
// Never fabricates missing evidence: every one of the 8 required
// sections (Executive Summary, Key Findings, Critical Risks, Strategic
// Opportunities, Recommended Decisions, Immediate Next Actions,
// Confidence Assessment, Supporting Evidence Summary) is either a
// direct, unmodified read of a real field, or a small, deterministic,
// documented combination of real fields (e.g. Critical Risks combines
// Expert Reasoning's own keyRisks with a literal quote of any real
// detected conflict's severity/reason). An empty category is rendered
// as an empty list, never an invented placeholder. Immediate Next
// Actions cites its own supporting evidence the same way Strategic
// Decision Memo does -- by finding which real evidence strings are
// literally contained within the action's own text -- preserving
// evidence traceability end to end. Supporting Evidence Summary keeps
// verified facts, assumptions, inferred/directional conclusions, and
// unknowns in four separate, clearly labeled lists, exactly matching
// the same distinction already established for report-generation
// context (see executive-decision-system-context.ts).
//
// Pipeline wiring (v1.1, additive): this generator optionally accepts
// an already-computed Strategic Decision Memo (the same Executive
// Decision Package, reshaped one stage earlier). When a real, already-
// generated memo is supplied, Critical Risks, Strategic Opportunities,
// Immediate Next Actions, and Confidence Assessment are read directly
// from the memo's own already-computed, already-cited fields instead
// of being independently re-derived -- the two modules' derivation
// logic for those categories is identical, so reusing the memo's real
// output here is a genuine "no duplicated execution" optimization, not
// a behavioral change: the numbers and citations are the same either
// way. When no memo is supplied (or it never generated anything real),
// this module falls back to its own original, independent derivation,
// exactly as before -- fully backward compatible.
//
// Scope (v1): this module does not modify UI, API contracts, report
// schema, routing, billing, authentication, PDF generation, or
// localization, and is not wired into any of those -- a future caller
// decides how (or whether) to surface this brief. Feature-flagged via
// ZERINIX_EXECUTIVE_BRIEF_GENERATOR_ENABLED, defaulting to disabled
// (or pass `enabled: true`, primarily for tests).

export const EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR = "ZERINIX_EXECUTIVE_BRIEF_GENERATOR_ENABLED";

export function isExecutiveBriefGeneratorEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const executiveBriefConfidenceAssessmentSchema = z
  .object({
    aggregateConfidence: z.number().min(0).max(100),
    decisionConfidence: z.number().min(0).max(1),
    narrative: shortString(800),
    drivers: z.array(confidenceDriverSchema).max(10),
    penalties: z.array(confidencePenaltySchema).max(10),
  })
  .strict();

export type ExecutiveBriefConfidenceAssessment = z.infer<typeof executiveBriefConfidenceAssessmentSchema>;

export const executiveBriefSupportingEvidenceSummarySchema = z
  .object({
    verifiedFacts: z.array(shortString(400)).max(60),
    assumptions: z.array(shortString(400)).max(10),
    inferredConclusions: z.array(shortString(400)).max(60),
    unknowns: z.array(shortString(400)).max(30),
    evidenceQualityScore: z.number().min(0).max(100).nullable(),
    sourceReliabilitySummary: shortString(300).nullable(),
    corroborationSummary: shortString(300).nullable(),
  })
  .strict();

export type ExecutiveBriefSupportingEvidenceSummary = z.infer<
  typeof executiveBriefSupportingEvidenceSummarySchema
>;

export const executiveBriefSchema = z
  .object({
    enabled: z.boolean(),
    // False whenever there was no real Executive Decision System
    // context to build from -- every section below is empty/null in
    // that case, never a fabricated placeholder brief.
    generated: z.boolean(),
    reasonNotGenerated: z.string().trim().max(500).nullable(),
    decisionQuestion: z.string().trim().max(400).nullable(),
    status: z.enum(decisionEngineStatusValues),
    executiveDecisionSignal: z.enum(executiveDecisionSignalValues).nullable(),

    executiveSummary: z.string().trim().max(700).nullable(),
    keyFindings: z.array(shortString(500)).max(12),
    criticalRisks: z.array(shortString(400)).max(40),
    strategicOpportunities: z.array(shortString(400)).max(30),
    recommendedDecisions: z.array(shortString(400)).max(6),
    immediateNextActions: z.array(strategicRecommendedActionSchema).max(10),
    confidenceAssessment: executiveBriefConfidenceAssessmentSchema,
    supportingEvidenceSummary: executiveBriefSupportingEvidenceSummarySchema,

    evidenceTrace: z.array(shortString(500)).max(30),
    briefTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type ExecutiveBrief = z.infer<typeof executiveBriefSchema>;

export type ExecutiveBriefGeneratorInput = {
  // The Executive Decision System's own output (typically
  // `runExecutiveDecisionSystem(...).package`, or the same object
  // after a round trip through JSON). Untyped on purpose -- validated
  // against the real executiveDecisionPackageSchema before anything is
  // read from it.
  executiveDecisionPackage?: unknown;
  // An already-computed Strategic Decision Memo for the SAME
  // executiveDecisionPackage, if the caller already built one (see
  // file header). Untyped and optional on purpose -- validated
  // against the real strategicDecisionMemoSchema before anything is
  // read from it; omitted or invalid falls back to this module's own
  // independent derivation.
  strategicDecisionMemo?: unknown;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_EXECUTIVE_BRIEF_GENERATOR_ENABLED environment
  // variable.
  enabled?: boolean;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function emptyConfidenceAssessment(narrative: string): ExecutiveBriefConfidenceAssessment {
  return {
    aggregateConfidence: 0,
    decisionConfidence: 0,
    narrative,
    drivers: [],
    penalties: [],
  };
}

function emptySupportingEvidenceSummary(): ExecutiveBriefSupportingEvidenceSummary {
  return {
    verifiedFacts: [],
    assumptions: [],
    inferredConclusions: [],
    unknowns: [],
    evidenceQualityScore: null,
    sourceReliabilitySummary: null,
    corroborationSummary: null,
  };
}

function emptyBrief(
  enabled: boolean,
  reasonNotGenerated: string,
  status: (typeof decisionEngineStatusValues)[number] = "not_started"
): ExecutiveBrief {
  return {
    enabled,
    generated: false,
    reasonNotGenerated,
    decisionQuestion: null,
    status,
    executiveDecisionSignal: null,
    executiveSummary: null,
    keyFindings: [],
    criticalRisks: [],
    strategicOpportunities: [],
    recommendedDecisions: [],
    immediateNextActions: [],
    confidenceAssessment: emptyConfidenceAssessment(reasonNotGenerated),
    supportingEvidenceSummary: emptySupportingEvidenceSummary(),
    evidenceTrace: [],
    briefTrace: [reasonNotGenerated],
  };
}

// Never invents a citation (see file header): only real evidence
// strings literally contained within the action's own text are cited.
// Falls back to citing the action's own text only for a generic
// catch-all action that quotes no specific evidence -- still a real
// string from the package, never an invented one.
function citeSupportingEvidence(action: string, evidencePool: readonly string[]): string[] {
  const matches = evidencePool.filter((evidence) => action.includes(evidence));
  return matches.length > 0 ? matches : [action];
}

function buildImmediateNextActions(
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): StrategicRecommendedAction[] {
  const evidencePool = uniqueStrings([
    ...brief.verifiedEvidence,
    ...brief.assumptions,
    ...brief.missingCriticalEvidence,
    ...brief.keyRisks,
  ]);

  const actions: StrategicRecommendedAction[] = brief.immediateNextActions.map((action) => ({
    action,
    supportingEvidence: citeSupportingEvidence(action, evidencePool),
    source: "brief_next_action",
  }));

  const topResearchTask = businessIntelligence.researchPrioritization?.prioritizedTasks[0];
  if (topResearchTask) {
    actions.push({
      action: topResearchTask.topic,
      supportingEvidence: [topResearchTask.explanation],
      source: "top_research_priority",
    });
  }

  return actions.slice(0, 10);
}

function buildCriticalRisks(
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): string[] {
  const conflictRisks = (businessIntelligence.conflictDetection?.conflicts ?? []).map(
    (conflict) => `Unresolved evidence conflict [${conflict.severity}]: ${conflict.reason}`
  );
  return uniqueStrings([...brief.keyRisks, ...conflictRisks]).slice(0, 40);
}

function buildRecommendedDecisions(brief: ExecutiveDecisionBrief): string[] {
  const statusDecision = `Recommended decision: ${brief.recommendationStatus}.`;
  const advisoryDecisions = brief.executiveAdvisory ? [...brief.executiveAdvisory.nextDecisions] : [];
  return uniqueStrings([statusDecision, ...advisoryDecisions]).slice(0, 6);
}

function buildConfidenceAssessment(
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): ExecutiveBriefConfidenceAssessment {
  return {
    aggregateConfidence: businessIntelligence.aggregateConfidence,
    decisionConfidence: brief.decisionConfidence,
    narrative:
      businessIntelligence.confidence?.confidenceExplanation ??
      brief.executiveAdvisory?.confidenceNarrative ??
      brief.confidenceExplanation,
    drivers: businessIntelligence.confidence?.confidenceDrivers ?? [],
    penalties: businessIntelligence.confidence?.confidencePenalties ?? [],
  };
}

function buildSourceReliabilitySummary(businessIntelligence: BusinessIntelligenceContext): string | null {
  const sources = businessIntelligence.sourceReliability?.sources ?? [];
  if (sources.length === 0) {
    return "No sources were assessed for reliability.";
  }
  const mean = Math.round(sources.reduce((sum, source) => sum + source.reliabilityScore, 0) / sources.length);
  const weakCount = sources.filter((source) => source.isAnonymousOrWeak).length;
  return `${sources.length} source(s) assessed; mean reliability ${mean}/100${weakCount > 0 ? `; ${weakCount} anonymous/weak source(s) flagged` : ""}.`;
}

function buildCorroborationSummary(businessIntelligence: BusinessIntelligenceContext): string | null {
  const corroboration = businessIntelligence.evidenceCorroboration;
  if (!corroboration || corroboration.conclusions.length === 0) {
    return "No conclusions were checked for corroboration.";
  }
  return `${corroboration.conclusions.length} conclusion(s) checked: ${corroboration.multiSourceConclusionIds.length} multi-source corroborated, ${corroboration.singleSourceConclusionIds.length} single-source, ${corroboration.unattributedOnlyConclusionIds.length} unattributed-only, ${corroboration.unsupportedConclusionIds.length} unsupported.`;
}

function buildSupportingEvidenceSummary(
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): ExecutiveBriefSupportingEvidenceSummary {
  return {
    verifiedFacts: [...brief.verifiedEvidence],
    assumptions: [...brief.assumptions],
    inferredConclusions: [...brief.directionalSignals],
    unknowns: uniqueStrings(brief.missingCriticalEvidence),
    evidenceQualityScore: businessIntelligence.evidenceQuality?.overallPoolScore ?? null,
    sourceReliabilitySummary: buildSourceReliabilitySummary(businessIntelligence),
    corroborationSummary: buildCorroborationSummary(businessIntelligence),
  };
}

function buildExecutiveSummary(brief: ExecutiveDecisionBrief, businessIntelligence: BusinessIntelligenceContext): string {
  const headline = brief.executiveAdvisory?.executiveRecommendationHeadline ?? brief.executiveRecommendation;
  return `${headline} Recommendation status: "${brief.recommendationStatus}". Aggregate confidence: ${businessIntelligence.aggregateConfidence}/100.`.slice(
    0,
    700
  );
}

function buildGeneratedBrief(
  enabled: boolean,
  pkg: ExecutiveDecisionPackage,
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext,
  memo: StrategicDecisionMemo | undefined
): ExecutiveBrief {
  const briefTrace: string[] = [
    `Executive Brief generated from Executive Decision System status "${pkg.status}" (executive decision signal "${businessIntelligence.executiveDecisionSignal}").`,
  ];

  const reuseMemo = memo?.generated === true;
  if (reuseMemo) {
    briefTrace.push(
      "Reused the already-computed Strategic Decision Memo's own risks, opportunities, recommended actions, and confidence assessment instead of re-deriving them."
    );
  }

  const immediateNextActions = reuseMemo ? memo.recommendedActions : buildImmediateNextActions(brief, businessIntelligence);
  const criticalRisks = reuseMemo ? memo.risks : buildCriticalRisks(brief, businessIntelligence);
  const strategicOpportunities = reuseMemo ? memo.opportunities : brief.executiveAdvisory ? [...brief.executiveAdvisory.opportunities] : [];
  const confidenceAssessment = reuseMemo ? memo.confidence : buildConfidenceAssessment(brief, businessIntelligence);
  briefTrace.push(
    `Assembled ${immediateNextActions.length} immediate next action(s), ${criticalRisks.length} critical risk(s), and ${strategicOpportunities.length} strategic opportunity/opportunities.`
  );

  return {
    enabled,
    generated: true,
    reasonNotGenerated: null,
    decisionQuestion: brief.decisionQuestion || null,
    status: pkg.status,
    executiveDecisionSignal: businessIntelligence.executiveDecisionSignal,
    executiveSummary: buildExecutiveSummary(brief, businessIntelligence),
    keyFindings: [...brief.decisionRationale],
    criticalRisks,
    strategicOpportunities,
    recommendedDecisions: buildRecommendedDecisions(brief),
    immediateNextActions,
    confidenceAssessment,
    supportingEvidenceSummary: buildSupportingEvidenceSummary(brief, businessIntelligence),
    evidenceTrace: uniqueStrings([...brief.evidenceTrace, ...pkg.decision.evidenceTrace]).slice(0, 30),
    briefTrace,
  };
}

export function generateExecutiveBrief(
  input: ExecutiveBriefGeneratorInput = {}
): ExecutiveBrief {
  const enabled = input.enabled ?? isExecutiveBriefGeneratorEnabled();
  if (!enabled) {
    return emptyBrief(
      false,
      `Executive Brief Generator is disabled (set ${EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR}="true" to enable it).`
    );
  }

  const parsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  if (!parsed.success) {
    return emptyBrief(
      true,
      "No valid Executive Decision System package was supplied; nothing was generated."
    );
  }

  const pkg = parsed.data;
  const brief = pkg.executiveDecisionBrief;
  const businessIntelligence = pkg.businessIntelligence;

  if (!brief || !businessIntelligence) {
    return emptyBrief(
      true,
      "The Executive Decision System did not compute Business Intelligence / Executive Decision Brief data for this request; nothing was generated.",
      pkg.status
    );
  }

  const parsedMemo = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = parsedMemo.success ? parsedMemo.data : undefined;

  return buildGeneratedBrief(enabled, pkg, brief, businessIntelligence, memo);
}
