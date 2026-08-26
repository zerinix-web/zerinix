// Decision Engine V2 -- canonical internal decision model.
//
// This module is intentionally free of any dependency on presentation
// code, Planner.tsx, or route-level plumbing: it defines the SHAPE of a
// decision, nothing about how one gets rendered. Every other file in
// this directory builds toward producing one DecisionV2Result; every
// consumer (shadow-mode logging today, a future production wiring)
// reads this same object rather than re-deriving anything from prose.
//
// SHADOW MODE: this engine does not replace app/lib/report-engine/
// market-intelligence-presentation.ts's assessMarketEntryConfidence/
// buildMarketExecutiveDecisionBrief (the current production decision
// path). It runs alongside it, consuming the same already-computed
// MarketIntelligenceGraph/MarketResearchCoverage/report-section payload,
// and its result is only ever logged for comparison -- see
// shadow-mode.ts. See app/api/market-analysis/route.ts for the one call
// site that invokes it.

export type DecisionV2Code = "GO" | "CONDITIONAL_GO" | "NO_GO";

export type ConfidenceBand = "high" | "moderate" | "low" | "very_low";

export function classifyConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 75) return "high";
  if (confidence >= 55) return "moderate";
  if (confidence >= 35) return "low";
  return "very_low";
}

// A dimension's STATE is the market-quality judgment (is this favorable
// or not); "unknown" is a first-class state, not a synonym for
// "unfavorable" -- PHASE 3's central distinction depends on every
// dimension being able to say "we don't know" without that silently
// counting as a negative. "neutral" is for a dimension that is
// genuinely not applicable or found to carry no material signal either
// way (e.g. no regulatory exposure was described at all, in a market
// where that plausibly means there isn't any) -- distinct from
// "unknown", which means the evidence needed to judge this dimension at
// all is simply missing.
export type DimensionState =
  | "strong"
  | "favorable"
  | "neutral"
  | "unfavorable"
  | "weak"
  | "unknown";

export const dimensionKeys = [
  "marketAttractiveness",
  "customerProblemEvidence",
  "competitiveIntensity",
  "differentiationPotential",
  "economicViability",
  "executionFeasibility",
  "regulatoryLegalExposure",
] as const;

export type DimensionKey = (typeof dimensionKeys)[number];

// The two evidence-META dimensions -- deliberately kept in a SEPARATE
// type from DimensionKey (the market-quality dimensions above) so no
// aggregation code can accidentally average "evidence quality" together
// with "is this a good market", the exact conflation this engine exists
// to eliminate (PHASE 3 / INVARIANT 7).
export const evidenceMetaKeys = ["evidenceQuality", "evidenceCompleteness"] as const;
export type EvidenceMetaKey = (typeof evidenceMetaKeys)[number];

export type DimensionAssessment = {
  key: DimensionKey;
  state: DimensionState;
  // 0-100 when the dimension could be scored at all; null when the
  // state is "unknown" -- a null score must never be silently treated
  // as 0 by aggregation code (INVARIANT 1).
  score: number | null;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  uncertainty: "low" | "medium" | "high";
  evidenceRefs: string[];
  rationale: string;
  // True ONLY when this dimension's own evidence is, by itself, severe
  // enough to justify NO_GO regardless of how strong every other
  // dimension looks -- e.g. an explicit statement the business cannot
  // legally operate at all. Every dimension defaults to false/undefined;
  // today only assessRegulatoryLegalExposure's prohibition tier sets
  // this. Deliberately distinct from "weak"/"unfavorable" state, which
  // still gets diluted by the weighted market-quality average -- a
  // genuine hard blocker must NOT be out-voted by an otherwise
  // attractive market (a large TAM does not make an illegal business
  // legal). See engine.ts's determineDecision.
  isHardBlocker?: boolean;
};

export type EvidenceMetaAssessment = {
  key: EvidenceMetaKey;
  score: number;
  rationale: string;
};

export type DecisionReasoning = {
  strongestPositiveEvidence: string[];
  strongestNegativeEvidence: string[];
  criticalUncertainties: string[];
  evidenceGaps: string[];
  assumptions: string[];
  whatWouldChangeTheDecision: string;
  recommendedValidationActions: string[];
  executiveRationale: string;
};

// Machine-checkable record of which invariant conditions actually fired
// for this specific result -- exists so tests can assert on invariant
// enforcement directly (PHASE 5) rather than only on the final code, and
// so shadow-mode logging can explain WHY V2 landed where it did without
// re-deriving it from the dimensions array.
export type InvariantTrace = {
  noGoJustifiedByNegativeEvidence: boolean;
  // True only when NO_GO was reached via a single dimension's
  // isHardBlocker flag (bypassing the weighted market-quality blend
  // entirely), not via the ordinary multi-dimension negative-evidence
  // path. Lets tests and shadow-mode logging distinguish "the overall
  // picture was bad" from "one finding made this categorically
  // non-viable regardless of the rest."
  noGoJustifiedByHardBlocker: boolean;
  goBlockedByLowEvidenceCompleteness: boolean;
  goDowngradedToConditional: boolean;
  missingEvidenceTreatedAsUnknownNotNegative: boolean;
  provisional: boolean;
};

export type DecisionV2Result = {
  engineVersion: "decision-engine-v2.0";
  decision: DecisionV2Code;
  // Confidence is CERTAINTY IN THIS DECISION -- how much the evidence
  // base supports believing `decision` is the right call -- never a
  // measure of how attractive the opportunity looks (INVARIANT 6). A
  // confidently-reached NO_GO built on strong, high-quality negative
  // evidence scores HIGH confidence; a CONDITIONAL_GO reached mostly
  // through unknown dimensions scores LOW confidence, regardless of how
  // promising the known parts look.
  confidence: number;
  confidenceBand: ConfidenceBand;
  dimensions: DimensionAssessment[];
  evidenceMeta: EvidenceMetaAssessment[];
  // Separate, explicit aggregate scores so no downstream consumer needs
  // to reconstruct them from the dimension array (and can never
  // accidentally blend them together the way the legacy engine's single
  // confidence number does).
  marketQualityScore: number | null;
  evidenceCompletenessScore: number;
  evidenceQualityScore: number;
  reasoning: DecisionReasoning;
  invariants: InvariantTrace;
};
