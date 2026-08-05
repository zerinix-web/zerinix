import { z } from "zod";
import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
} from "./executive-decision-system.ts";
import { decisionEngineStatusValues } from "./decision-engine.ts";
import { executiveDecisionSignalValues } from "./business-intelligence-orchestrator.ts";
import { confidenceDriverSchema, confidencePenaltySchema } from "./confidence-engine.ts";
import { detectedConflictSchema } from "./conflict-detection-engine.ts";
import { prioritizedResearchTaskSchema } from "./research-prioritization-engine.ts";
import type { ExecutiveDecisionBrief } from "./executive-decision-brief.ts";
import type { BusinessIntelligenceContext } from "./business-intelligence-orchestrator.ts";

// ZERINIX Strategic Decision Memo v1.
//
// Generates a Strategic Decision Memo directly from ZERINIX Executive
// Decision System v1's own output -- never from a raw LLM prompt, and
// never by re-running Decision Engine, Business Intelligence
// Orchestrator, or any of the 8 engines beneath it. This module makes
// no network/AI calls; it only reads fields that Confidence Engine,
// Conflict Detection Engine, Evidence Quality Scoring, Source
// Reliability Engine, Evidence Corroboration Engine, Research
// Prioritization, and Executive Decision Brief have already computed
// and validated, and reshapes them into six clearly distinguished
// categories: Verified Facts, Assumptions, Risks, Opportunities,
// Recommended Actions, and Confidence.
//
// Never fabricates evidence or unsupported conclusions: every string
// in every category is either a direct, unmodified read of a real
// field (verifiedFacts <- verifiedEvidence, assumptions <-
// assumptions, confidence <- aggregateConfidence/decisionConfidence),
// or a small, deterministic, documented combination of real fields
// (risks <- keyRisks plus a literal quote of any real detected
// conflict's own reason/severity; opportunities <- the Executive
// Advisory's own opportunities list, honestly empty when that feature
// is off or nothing was found). Every recommended action cites its
// supporting evidence by finding which real evidence strings are
// literally contained within the action's own text (Executive
// Decision Brief already builds its immediateNextActions by
// embedding the real gap/risk text verbatim) -- never an invented or
// guessed citation, and never a citation to text that is not present
// verbatim elsewhere in the same package.
//
// Scope (v1): this module is a pure, standalone reshaping function. It
// does not modify report generation, PDF generation, UI, billing,
// authentication, or routing, and it is not wired into any of those --
// a future caller decides how (or whether) to surface this memo.
// Feature-flagged via ZERINIX_STRATEGIC_DECISION_MEMO_ENABLED,
// defaulting to disabled (or pass `enabled: true`, primarily for
// tests).

export const STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR = "ZERINIX_STRATEGIC_DECISION_MEMO_ENABLED";

export function isStrategicDecisionMemoEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const recommendedActionSourceValues = ["brief_next_action", "top_research_priority"] as const;

export type RecommendedActionSource = (typeof recommendedActionSourceValues)[number];

export const strategicRecommendedActionSchema = z
  .object({
    action: shortString(400),
    // Every recommendation references its supporting evidence
    // internally: at least one real, verbatim-quoted string from the
    // same package, never an invented citation.
    supportingEvidence: z.array(shortString(400)).min(1).max(10),
    source: z.enum(recommendedActionSourceValues),
  })
  .strict();

export type StrategicRecommendedAction = z.infer<typeof strategicRecommendedActionSchema>;

export const strategicDecisionMemoConfidenceSchema = z
  .object({
    aggregateConfidence: z.number().min(0).max(100),
    decisionConfidence: z.number().min(0).max(1),
    narrative: shortString(800),
    drivers: z.array(confidenceDriverSchema).max(10),
    penalties: z.array(confidencePenaltySchema).max(10),
  })
  .strict();

export type StrategicDecisionMemoConfidence = z.infer<typeof strategicDecisionMemoConfidenceSchema>;

export const strategicDecisionMemoSchema = z
  .object({
    enabled: z.boolean(),
    // False whenever there was no real Executive Decision System
    // context to build from -- the flag being off, malformed input, or
    // a package that never reached Business Intelligence Orchestrator
    // / Executive Decision Brief. Every category below is empty in
    // that case, never a fabricated placeholder memo.
    generated: z.boolean(),
    reasonNotGenerated: z.string().trim().max(500).nullable(),
    decisionQuestion: z.string().trim().max(400).nullable(),
    status: z.enum(decisionEngineStatusValues),
    executiveDecisionSignal: z.enum(executiveDecisionSignalValues).nullable(),
    verifiedFacts: z.array(shortString(400)).max(60),
    assumptions: z.array(shortString(400)).max(10),
    risks: z.array(shortString(400)).max(40),
    opportunities: z.array(shortString(400)).max(30),
    recommendedActions: z.array(strategicRecommendedActionSchema).max(10),
    confidence: strategicDecisionMemoConfidenceSchema,
    decisionRationale: z.array(shortString(500)).max(12),
    detectedConflicts: z.array(detectedConflictSchema).max(50),
    researchPriorities: z.array(prioritizedResearchTaskSchema).max(20),
    evidenceTrace: z.array(shortString(500)).max(30),
    memoTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type StrategicDecisionMemo = z.infer<typeof strategicDecisionMemoSchema>;

export type StrategicDecisionMemoInput = {
  // The Executive Decision System's own output (typically
  // `runExecutiveDecisionSystem(...).package`, or the same object
  // after a round trip through JSON, e.g. a stored request payload).
  // Untyped on purpose -- validated against the real
  // executiveDecisionPackageSchema before anything is read from it.
  executiveDecisionPackage?: unknown;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_STRATEGIC_DECISION_MEMO_ENABLED environment
  // variable.
  enabled?: boolean;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function emptyConfidence(narrative: string): StrategicDecisionMemoConfidence {
  return {
    aggregateConfidence: 0,
    decisionConfidence: 0,
    narrative,
    drivers: [],
    penalties: [],
  };
}

function emptyMemo(
  enabled: boolean,
  reasonNotGenerated: string,
  status: (typeof decisionEngineStatusValues)[number] = "not_started"
): StrategicDecisionMemo {
  return {
    enabled,
    generated: false,
    reasonNotGenerated,
    decisionQuestion: null,
    status,
    executiveDecisionSignal: null,
    verifiedFacts: [],
    assumptions: [],
    risks: [],
    opportunities: [],
    recommendedActions: [],
    confidence: emptyConfidence(reasonNotGenerated),
    decisionRationale: [],
    detectedConflicts: [],
    researchPriorities: [],
    evidenceTrace: [],
    memoTrace: [reasonNotGenerated],
  };
}

// Never invents a citation: only real evidence strings that are
// literally contained within the action's own text are cited (see
// file header -- Executive Decision Brief already embeds the real
// gap/risk text verbatim when building immediateNextActions). Falls
// back to citing the action's own text only for the rare generic
// catch-all action that quotes no specific evidence at all -- still a
// real string from the package, never an invented one.
function citeSupportingEvidence(action: string, evidencePool: readonly string[]): string[] {
  const matches = evidencePool.filter((evidence) => action.includes(evidence));
  return matches.length > 0 ? matches : [action];
}

function buildRecommendedActions(
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

function buildRisks(brief: ExecutiveDecisionBrief, businessIntelligence: BusinessIntelligenceContext): string[] {
  const conflictRisks = (businessIntelligence.conflictDetection?.conflicts ?? []).map(
    (conflict) => `Unresolved evidence conflict [${conflict.severity}]: ${conflict.reason}`
  );
  return uniqueStrings([...brief.keyRisks, ...conflictRisks]).slice(0, 40);
}

function buildOpportunities(brief: ExecutiveDecisionBrief): string[] {
  return brief.executiveAdvisory ? [...brief.executiveAdvisory.opportunities] : [];
}

function buildConfidence(
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): StrategicDecisionMemoConfidence {
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

function buildGeneratedMemo(
  enabled: boolean,
  pkg: ExecutiveDecisionPackage,
  brief: ExecutiveDecisionBrief,
  businessIntelligence: BusinessIntelligenceContext
): StrategicDecisionMemo {
  const memoTrace: string[] = [
    `Strategic Decision Memo generated from Executive Decision System status "${pkg.status}" (executive decision signal "${businessIntelligence.executiveDecisionSignal}").`,
  ];

  const recommendedActions = buildRecommendedActions(brief, businessIntelligence);
  const risks = buildRisks(brief, businessIntelligence);
  const opportunities = buildOpportunities(brief);
  memoTrace.push(
    `Assembled ${recommendedActions.length} recommended action(s), ${risks.length} risk(s), and ${opportunities.length} opportunity/opportunities.`
  );

  return {
    enabled,
    generated: true,
    reasonNotGenerated: null,
    decisionQuestion: brief.decisionQuestion || null,
    status: pkg.status,
    executiveDecisionSignal: businessIntelligence.executiveDecisionSignal,
    verifiedFacts: [...brief.verifiedEvidence],
    assumptions: [...brief.assumptions],
    risks,
    opportunities,
    recommendedActions,
    confidence: buildConfidence(brief, businessIntelligence),
    decisionRationale: [...brief.decisionRationale],
    detectedConflicts: [...(businessIntelligence.conflictDetection?.conflicts ?? [])],
    researchPriorities: [...(businessIntelligence.researchPrioritization?.prioritizedTasks ?? [])],
    evidenceTrace: uniqueStrings([...brief.evidenceTrace, ...pkg.decision.evidenceTrace]).slice(0, 30),
    memoTrace,
  };
}

export function buildStrategicDecisionMemo(
  input: StrategicDecisionMemoInput = {}
): StrategicDecisionMemo {
  const enabled = input.enabled ?? isStrategicDecisionMemoEnabled();
  if (!enabled) {
    return emptyMemo(
      false,
      `Strategic Decision Memo is disabled (set ${STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR}="true" to enable it).`
    );
  }

  const parsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  if (!parsed.success) {
    return emptyMemo(
      true,
      "No valid Executive Decision System package was supplied; nothing was generated."
    );
  }

  const pkg = parsed.data;
  const brief = pkg.executiveDecisionBrief;
  const businessIntelligence = pkg.businessIntelligence;

  if (!brief || !businessIntelligence) {
    return emptyMemo(
      true,
      "The Executive Decision System did not compute Business Intelligence / Executive Decision Brief data for this request; nothing was generated.",
      pkg.status
    );
  }

  return buildGeneratedMemo(enabled, pkg, brief, businessIntelligence);
}
