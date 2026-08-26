// Decision Engine V2 -- aggregation, decision, confidence, reasoning.
//
// This is where PHASE 5's invariants are actually enforced. Every rule
// below is a plain, auditable comparison over the dimension array built
// by dimensions.ts -- there is no hidden weighting inside a prompt, and
// no step here makes a new AI or search call (PHASE 9).

import type { MarketReportField } from "@/app/lib/report-engine/prompts/market";
import {
  assessAllDimensions,
  type DecisionEngineV2Input,
} from "./dimensions.ts";
import {
  classifyConfidenceBand,
  dimensionKeys,
  type DecisionReasoning,
  type DecisionV2Code,
  type DecisionV2Result,
  type DimensionAssessment,
  type DimensionKey,
  type EvidenceMetaAssessment,
  type InvariantTrace,
} from "./types.ts";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Relative importance of each dimension to the market-QUALITY judgment.
// Deliberately does not include evidenceQuality/evidenceCompleteness --
// those are a structurally separate axis (confidence), never blended
// into this weighting (INVARIANT 7).
const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  marketAttractiveness: 0.25,
  customerProblemEvidence: 0.15,
  competitiveIntensity: 0.2,
  differentiationPotential: 0.15,
  economicViability: 0.15,
  executionFeasibility: 0.05,
  regulatoryLegalExposure: 0.05,
};

// GO/NO_GO thresholds against the market-quality score. Chosen wider
// apart than the legacy engine's 65/40 split specifically so a middling
// blend defaults to CONDITIONAL_GO rather than tipping into NO_GO --
// CONDITIONAL_GO is the first-class default state PHASE 3 requires, not
// a narrow band between two more common outcomes.
const GO_MARKET_QUALITY_THRESHOLD = 65;
const NO_GO_MARKET_QUALITY_THRESHOLD = 40;
const MINIMUM_EVIDENCE_COMPLETENESS_FOR_GO = 50;
const MINIMUM_EVIDENCE_QUALITY_FOR_GO = 40;

function weightedAverage(dimensions: readonly DimensionAssessment[]) {
  const assessable = dimensions.filter((d): d is DimensionAssessment & { score: number } => d.score !== null);
  if (assessable.length === 0) return null;

  const totalWeight = assessable.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key], 0);
  if (totalWeight <= 0) return null;

  const weightedSum = assessable.reduce((sum, d) => sum + d.score * DIMENSION_WEIGHTS[d.key], 0);
  return clamp(weightedSum / totalWeight);
}

const UNCERTAINTY_CERTAINTY_FACTOR: Record<DimensionAssessment["uncertainty"], number> = {
  low: 1,
  medium: 0.75,
  high: 0.5,
};

// How much of the DECISION-RELEVANT evidence actually exists, weighted
// by how much each dimension matters and how solid what we do have is --
// not a raw source count. A market missing only the two lowest-weight
// dimensions (execution feasibility, regulatory exposure) scores far
// higher completeness than one missing market attractiveness or
// competitive intensity.
function computeEvidenceCompleteness(dimensions: readonly DimensionAssessment[]) {
  const totalWeight = dimensionKeys.reduce((sum, key) => sum + DIMENSION_WEIGHTS[key], 0);
  const coveredWeight = dimensions.reduce((sum, d) => {
    if (d.state === "unknown") return sum;
    return sum + DIMENSION_WEIGHTS[d.key] * UNCERTAINTY_CERTAINTY_FACTOR[d.uncertainty];
  }, 0);
  return clamp((coveredWeight / totalWeight) * 100);
}

// How internally consistent the assessable dimensions are -- a market
// where every known dimension points the same direction is easier to be
// certain about than one where strong positives and real negatives
// coexist (TEST SCENARIO G: contradictory evidence must lower
// confidence and be surfaced, never averaged away silently).
function computeAgreement(dimensions: readonly DimensionAssessment[]) {
  const scores = dimensions
    .filter((d): d is DimensionAssessment & { score: number } => d.score !== null)
    .map((d) => d.score);
  if (scores.length < 2) return 100;
  const spread = Math.max(...scores) - Math.min(...scores);
  return clamp(100 - spread);
}

function isSeriousNegative(dimension: DimensionAssessment) {
  return dimension.state === "weak" || (dimension.state === "unfavorable" && dimension.uncertainty !== "high");
}

function isStrongPositive(dimension: DimensionAssessment) {
  return dimension.state === "strong" || dimension.state === "favorable";
}

function determineDecision(
  dimensions: readonly DimensionAssessment[],
  marketQualityScore: number | null,
  evidenceCompletenessScore: number,
  evidenceQualityScore: number
): { decision: DecisionV2Code; invariants: InvariantTrace } {
  // A hard blocker (today: only assessRegulatoryLegalExposure's
  // prohibition tier) bypasses the weighted market-quality blend
  // entirely -- checked BEFORE anything else, so a genuine "cannot
  // legally operate" finding cannot be out-voted by an otherwise
  // strong/favorable market. This is the fix for the regulatory-
  // weighting weakness: a real prohibition previously only carried the
  // dimension's ordinary 0.05 blend weight, so strong topline demand
  // could mathematically dilute it into CONDITIONAL_GO. REQUIREMENT 8.
  const hardBlocker = dimensions.find((d) => d.isHardBlocker === true);
  if (hardBlocker) {
    return {
      decision: "NO_GO",
      invariants: {
        noGoJustifiedByNegativeEvidence: true,
        noGoJustifiedByHardBlocker: true,
        goBlockedByLowEvidenceCompleteness: false,
        goDowngradedToConditional: false,
        missingEvidenceTreatedAsUnknownNotNegative: true,
        provisional: false,
      },
    };
  }

  const seriousNegativeCount = dimensions.filter(isSeriousNegative).length;
  const weakCount = dimensions.filter((d) => d.state === "weak").length;

  // INVARIANT 2/3: NO_GO requires BOTH a real, named negative finding
  // (never just "we don't know") AND a net-unfavorable weighted picture
  // among whatever IS assessable. Missing TAM/SAM/SOM alone can never
  // reach this branch -- an unverified TAM produces an "unknown"
  // marketAttractiveness dimension, which contributes zero seriously-
  // negative signal by construction (dimensions.ts never returns
  // "weak"/"unfavorable" purely for missing sizing data).
  const seriousNegativeSignal = weakCount > 0 || seriousNegativeCount >= 2;
  if (seriousNegativeSignal && marketQualityScore !== null && marketQualityScore < NO_GO_MARKET_QUALITY_THRESHOLD) {
    return {
      decision: "NO_GO",
      invariants: {
        noGoJustifiedByNegativeEvidence: true,
        noGoJustifiedByHardBlocker: false,
        goBlockedByLowEvidenceCompleteness: false,
        goDowngradedToConditional: false,
        missingEvidenceTreatedAsUnknownNotNegative: true,
        provisional: false,
      },
    };
  }

  const strongPositiveCount = dimensions.filter(isStrongPositive).length;
  const meetsGoQualityBar =
    marketQualityScore !== null &&
    marketQualityScore >= GO_MARKET_QUALITY_THRESHOLD &&
    weakCount === 0 &&
    strongPositiveCount >= 3;

  if (meetsGoQualityBar) {
    // INVARIANT 4: a GO-quality market picture is not enough on its own
    // when evidence completeness or quality is dangerously low -- the
    // decision is downgraded to CONDITIONAL_GO (explicitly provisional)
    // rather than presenting an under-evidenced GO as full confidence.
    if (
      evidenceCompletenessScore < MINIMUM_EVIDENCE_COMPLETENESS_FOR_GO ||
      evidenceQualityScore < MINIMUM_EVIDENCE_QUALITY_FOR_GO
    ) {
      return {
        decision: "CONDITIONAL_GO",
        invariants: {
          noGoJustifiedByNegativeEvidence: false,
          noGoJustifiedByHardBlocker: false,
          goBlockedByLowEvidenceCompleteness: true,
          goDowngradedToConditional: true,
          missingEvidenceTreatedAsUnknownNotNegative: true,
          provisional: true,
        },
      };
    }

    return {
      decision: "GO",
      invariants: {
        noGoJustifiedByNegativeEvidence: false,
        noGoJustifiedByHardBlocker: false,
        goBlockedByLowEvidenceCompleteness: false,
        goDowngradedToConditional: false,
        missingEvidenceTreatedAsUnknownNotNegative: true,
        provisional: false,
      },
    };
  }

  // CONDITIONAL_GO is the default, first-class outcome (PHASE 3) -- it
  // is what a large TAM with a weak customer-problem signal (TEST
  // SCENARIO E), a small/niche market with strong economics (TEST
  // SCENARIO F), or a thin-evidence report (TEST SCENARIO H) all land
  // on, rather than either extreme.
  return {
    decision: "CONDITIONAL_GO",
    invariants: {
      noGoJustifiedByNegativeEvidence: false,
      noGoJustifiedByHardBlocker: false,
      goBlockedByLowEvidenceCompleteness: false,
      goDowngradedToConditional: false,
      missingEvidenceTreatedAsUnknownNotNegative: true,
      provisional: marketQualityScore === null,
    },
  };
}

function computeConfidence(
  evidenceCompletenessScore: number,
  evidenceQualityScore: number,
  agreement: number
) {
  return clamp(evidenceCompletenessScore * 0.45 + evidenceQualityScore * 0.35 + agreement * 0.2);
}

function dimensionLabel(key: DimensionKey) {
  const labels: Record<DimensionKey, string> = {
    marketAttractiveness: "market attractiveness",
    customerProblemEvidence: "customer/problem evidence",
    competitiveIntensity: "competitive intensity",
    differentiationPotential: "differentiation potential",
    economicViability: "economic viability",
    executionFeasibility: "execution feasibility",
    regulatoryLegalExposure: "regulatory/legal exposure",
  };
  return labels[key];
}

const VALIDATION_ACTION_BY_DIMENSION: Record<DimensionKey, string> = {
  marketAttractiveness:
    "Commission or locate an independent market-size or category-growth source (industry report, government statistics, or public-company disclosure) for this exact category.",
  customerProblemEvidence:
    "Run direct customer interviews or review third-party usage/retention data to independently confirm the customer problem.",
  competitiveIntensity:
    "Identify and evaluate the top 3-5 named competitors' market position, pricing, and win rates from independent sources.",
  differentiationPotential:
    "Validate the proposed differentiation angle against actual buyer feedback or a competitive teardown, not just internal positioning.",
  economicViability:
    "Confirm real-world pricing/spend benchmarks via vendor pricing pages, disclosed contracts, or procurement data.",
  executionFeasibility:
    "Assess actual sales-cycle length, integration complexity, and capital requirements with a small number of target customers.",
  regulatoryLegalExposure:
    "Confirm with legal/compliance counsel whether any regulatory requirement applies before committing budget.",
};

function buildReasoning(
  dimensions: readonly DimensionAssessment[],
  decision: DecisionV2Code,
  marketQualityScore: number | null,
  evidenceCompletenessScore: number,
  agreement: number
): DecisionReasoning {
  const negatives = dimensions.filter((d) => d.state === "weak" || d.state === "unfavorable");
  const positives = dimensions.filter(isStrongPositive);
  const unknowns = dimensions.filter((d) => d.state === "unknown");

  const strongestPositiveEvidence = positives
    .flatMap((d) => (d.supportingEvidence.length ? d.supportingEvidence : [`${dimensionLabel(d.key)}: ${d.rationale}`]))
    .slice(0, 3);
  const strongestNegativeEvidence = negatives
    .flatMap((d) => (d.contradictingEvidence.length ? d.contradictingEvidence : [`${dimensionLabel(d.key)}: ${d.rationale}`]))
    .slice(0, 3);

  const criticalUncertainties = unknowns.map(
    (d) => `${dimensionLabel(d.key)}: ${d.rationale}`
  );
  if (agreement < 60 && positives.length > 0 && negatives.length > 0) {
    criticalUncertainties.push(
      `Dimensions disagree materially (${dimensionLabel(positives[0].key)} reads favorably while ${dimensionLabel(negatives[0].key)} reads unfavorably) -- this contradiction is not resolved by averaging, and directly reduces decision confidence.`
    );
  }

  const evidenceGaps = unknowns.map((d) => dimensionLabel(d.key));

  const assumptions = [
    "Qualitative signal extraction is deterministic keyword/pattern matching over the report's own generated prose, not a semantic re-analysis of the underlying research -- it can miss nuance a human reader would catch.",
    "Every dimension score reflects only evidence already present in this report; no additional research or AI call was made to reach this result.",
  ];

  const weakestAssessable = [...dimensions]
    .filter((d) => d.score !== null)
    .sort((a, b) => (a.score as number) - (b.score as number))[0];
  const mostImpactfulUnknown = unknowns[0];

  let whatWouldChangeTheDecision: string;
  if (decision === "NO_GO") {
    const worst = negatives[0] || weakestAssessable;
    whatWouldChangeTheDecision = worst
      ? `A material, independently confirmed improvement in ${dimensionLabel(worst.key)} would be required to move this decision away from NO_GO.`
      : "New evidence materially improving the weakest assessed dimension would be required to revisit this decision.";
  } else if (decision === "GO") {
    whatWouldChangeTheDecision =
      "A newly confirmed severe negative finding (e.g. a dominant entrenched competitor or a collapsing demand signal) in any dimension would be reason to revisit this decision toward a conditional stance.";
  } else if (mostImpactfulUnknown) {
    whatWouldChangeTheDecision = `Resolving the ${dimensionLabel(mostImpactfulUnknown.key)} evidence gap -- in either direction -- would materially change this decision's confidence and could move it to GO or NO_GO.`;
  } else if (weakestAssessable) {
    whatWouldChangeTheDecision = `A confirmed improvement or deterioration in ${dimensionLabel(weakestAssessable.key)} would move this decision toward GO or NO_GO respectively.`;
  } else {
    whatWouldChangeTheDecision = "Additional independently confirmed evidence across the assessed dimensions would sharpen this decision.";
  }

  const recommendedValidationActions = unknowns
    .map((d) => VALIDATION_ACTION_BY_DIMENSION[d.key])
    .concat(
      negatives.length > 0 && decision !== "NO_GO"
        ? [VALIDATION_ACTION_BY_DIMENSION[negatives[0].key]]
        : []
    )
    .filter((action, index, all) => all.indexOf(action) === index)
    .slice(0, 4);

  const executiveRationale = buildExecutiveRationale(
    decision,
    dimensions,
    marketQualityScore,
    evidenceCompletenessScore
  );

  return {
    strongestPositiveEvidence,
    strongestNegativeEvidence,
    criticalUncertainties,
    evidenceGaps,
    assumptions,
    whatWouldChangeTheDecision,
    recommendedValidationActions,
    executiveRationale,
  };
}

function buildExecutiveRationale(
  decision: DecisionV2Code,
  dimensions: readonly DimensionAssessment[],
  marketQualityScore: number | null,
  evidenceCompletenessScore: number
): string {
  const unknownCount = dimensions.filter((d) => d.state === "unknown").length;
  const negativeCount = dimensions.filter((d) => d.state === "weak" || d.state === "unfavorable").length;
  const positiveCount = dimensions.filter(isStrongPositive).length;

  if (decision === "NO_GO") {
    const blocker = dimensions.find((d) => d.isHardBlocker === true);
    if (blocker) {
      return `NO_GO because ${dimensionLabel(blocker.key)} evidence explicitly states the business cannot legally or practically operate in this category -- a material blocker that outweighs the rest of the evidence regardless of how attractive the market otherwise looks. ${blocker.rationale}`.trim();
    }
    const worst = [...dimensions]
      .filter((d) => d.state === "weak" || d.state === "unfavorable")
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
    return `NO_GO because ${negativeCount} dimension(s), including ${worst ? dimensionLabel(worst.key) : "a material dimension"}, carry specific negative evidence from the report's own findings -- not because evidence is missing. ${
      unknownCount > 0
        ? `${unknownCount} dimension(s) remain unassessed, which does not change this call but does bound confidence.`
        : ""
    }`.trim();
  }

  if (decision === "GO") {
    return `GO because ${positiveCount} of ${dimensions.length} assessed dimensions are favorable or strong, no dimension carries serious negative evidence, and evidence completeness (${evidenceCompletenessScore}/100) is sufficient to act on this read with confidence.`;
  }

  if (marketQualityScore === null) {
    return "CONDITIONAL_GO because too little evidence exists across the assessed dimensions to judge this market's quality at all -- this reflects an evidence gap, not a negative finding, so the correct response is validation, not rejection.";
  }

  if (unknownCount > 0 && negativeCount === 0) {
    return `CONDITIONAL_GO because the assessable dimensions read positively (market-quality score ${marketQualityScore}/100) with no confirmed negative finding, but ${unknownCount} dimension(s) remain unassessed -- missing evidence reduces certainty, it does not by itself make this a bad opportunity.`;
  }

  if (negativeCount > 0) {
    return `CONDITIONAL_GO because at least one dimension carries real negative evidence, but it is not severe or corroborated enough on its own to justify NO_GO -- entry should be conditional on validating that specific concern.`;
  }

  return `CONDITIONAL_GO because the overall evidence picture (market-quality score ${marketQualityScore}/100, evidence completeness ${evidenceCompletenessScore}/100) is mixed or moderate -- neither strong enough for GO nor negative enough for NO_GO.`;
}

export function runDecisionEngineV2(input: DecisionEngineV2Input): DecisionV2Result {
  const dimensions = assessAllDimensions(input);
  const marketQualityScore = weightedAverage(dimensions);
  const evidenceCompletenessScore = computeEvidenceCompleteness(dimensions);
  const evidenceQualityScore = clamp(input.coverage.averageQuality);
  const agreement = computeAgreement(dimensions);

  const { decision, invariants } = determineDecision(
    dimensions,
    marketQualityScore,
    evidenceCompletenessScore,
    evidenceQualityScore
  );

  const confidence = computeConfidence(evidenceCompletenessScore, evidenceQualityScore, agreement);
  const reasoning = buildReasoning(dimensions, decision, marketQualityScore, evidenceCompletenessScore, agreement);

  const evidenceMeta: EvidenceMetaAssessment[] = [
    {
      key: "evidenceQuality",
      score: evidenceQualityScore,
      rationale: `Derived from source authority, diversity, and freshness across ${input.coverage.verifiedSources} verified source(s) and ${input.coverage.independentDomains} independent domain(s).`,
    },
    {
      key: "evidenceCompleteness",
      score: evidenceCompletenessScore,
      rationale: `${dimensions.filter((d) => d.state !== "unknown").length} of ${dimensions.length} decision dimensions could be assessed from available evidence, weighted by each dimension's importance and certainty.`,
    },
  ];

  return {
    engineVersion: "decision-engine-v2.0",
    decision,
    confidence,
    confidenceBand: classifyConfidenceBand(confidence),
    dimensions,
    evidenceMeta,
    marketQualityScore,
    evidenceCompletenessScore,
    evidenceQualityScore,
    reasoning,
    invariants,
  };
}

export type { DecisionEngineV2Input };
export type { MarketReportField };
