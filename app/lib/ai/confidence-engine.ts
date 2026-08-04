import { z } from "zod";
import type { EvidenceQualityScoringResult } from "./evidence-quality-scoring.ts";
import type { ExecutiveBriefDomain } from "./executive-decision-brief.ts";
import type { DecisionComplexity } from "./decision-intent-engine.ts";

// ZERINIX Confidence Engine v1.
//
// Every recommendation, conclusion, and executive decision must carry a
// mathematically derived confidence score -- never a guessed percentage.
// This module computes confidence (0-100) as a weighted average of 10
// fixed factors, each itself a deterministic function of real, already-
// computed evidence properties (mostly sourced from Evidence Quality
// Scoring's own output): evidence quality, independent sources, source
// authority, evidence agreement, evidence conflicts, missing evidence,
// freshness, traceability, domain risk level, and decision complexity.
//
// Never invents confidence, never hardcodes the final percentage: the
// only "hardcoded" numbers in this file are METHODOLOGY constants --
// equal factor weights (10% each, so no single factor is silently
// dominant) and small, documented lookup tables for discrete inputs
// (e.g. domain risk level, decision complexity) -- exactly the same
// bucketed-scoring convention Evidence Quality Scoring already uses for
// freshness. The actual confidence number returned is always the
// computed weighted sum over the real factor scores for THIS input; it
// is never a literal returned as-is. When a factor has no real basis
// (an input was not supplied), it defaults to a documented, conservative
// value -- never an invented "looks about right" number -- and every
// factor's rationale says exactly why it landed where it did.
//
// Confidence decreases when evidence is weak (low evidence-quality
// score, few/no independent sources, conflicts, missing evidence, stale
// or unverifiable sources) and can only increase when there is more
// verified evidence to point to -- there is no code path that raises
// confidence without a corresponding real, cited improvement in one of
// the 10 factors.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_CONFIDENCE_ENGINE_ENABLED, defaulting to disabled (or pass
// `enabled: true`, primarily for tests) -- when disabled, no computation
// runs at all.

export const confidenceFactorValues = [
  "evidence_quality",
  "independent_sources",
  "source_authority",
  "evidence_agreement",
  "evidence_conflicts",
  "missing_evidence",
  "freshness",
  "traceability",
  "domain_risk",
  "decision_complexity",
] as const;

export type ConfidenceFactor = (typeof confidenceFactorValues)[number];

export const CONFIDENCE_ENGINE_ENABLED_ENV_VAR = "ZERINIX_CONFIDENCE_ENGINE_ENABLED";

export function isConfidenceEngineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CONFIDENCE_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const confidenceFactorScoreSchema = z
  .object({
    factor: z.enum(confidenceFactorValues),
    score: z.number().min(0).max(100),
    weight: z.number().min(0).max(1),
    rationale: shortString(400),
  })
  .strict();

export type ConfidenceFactorScore = z.infer<typeof confidenceFactorScoreSchema>;

export const confidenceDriverSchema = z
  .object({
    factor: z.enum(confidenceFactorValues),
    description: shortString(300),
  })
  .strict();

export type ConfidenceDriver = z.infer<typeof confidenceDriverSchema>;

export const confidencePenaltySchema = z
  .object({
    factor: z.enum(confidenceFactorValues),
    description: shortString(300),
    impact: z.number().min(0).max(100),
  })
  .strict();

export type ConfidencePenalty = z.infer<typeof confidencePenaltySchema>;

export const confidenceEngineResultSchema = z
  .object({
    enabled: z.boolean(),
    confidence: z.number().min(0).max(100),
    confidenceExplanation: shortString(800),
    // Exactly 10 when enabled (one per confidenceFactorValues entry);
    // empty when disabled, since no computation ran at all.
    factorScores: z.array(confidenceFactorScoreSchema).max(confidenceFactorValues.length),
    confidenceDrivers: z.array(confidenceDriverSchema).max(confidenceFactorValues.length),
    confidencePenalties: z.array(confidencePenaltySchema).max(confidenceFactorValues.length),
    scoringTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type ConfidenceEngineResult = z.infer<typeof confidenceEngineResultSchema>;

export type ConfidenceEngineInput = {
  // The primary, connected path: an already-computed Evidence Quality
  // Scoring result. When supplied, evidence_quality, source_authority,
  // evidence_agreement, evidence_conflicts, missing_evidence, freshness,
  // and traceability are all derived from it directly -- never
  // re-guessed. When omitted, each of those factors defaults to 0 (the
  // most conservative value: no evidence basis means no confidence
  // basis), never an invented mid-point.
  evidenceQualityResult?: EvidenceQualityScoringResult;
  // Explicit override for independent source count, when the caller has
  // the real publisher list and can count more precisely than the
  // lower-bound derivation below. If omitted, derived from
  // evidenceQualityResult's own confirmedBy structure.
  independentSourceCount?: number;
  domain?: ExecutiveBriefDomain;
  decisionComplexity?: DecisionComplexity;
  enabled?: boolean;
};

function roundClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const DIMENSION_WEIGHT = 1 / confidenceFactorValues.length;

function meanDimensionScore(
  result: EvidenceQualityScoringResult | undefined,
  dimension: "source_authority" | "source_freshness" | "traceability"
): number {
  if (!result || result.itemScores.length === 0) {
    return 0;
  }
  const total = result.itemScores.reduce((sum, item) => {
    const entry = item.dimensionScores.find((d) => d.dimension === dimension);
    return sum + (entry?.score ?? 0);
  }, 0);
  return total / result.itemScores.length;
}

function scoreEvidenceQualityFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  if (!result || !result.enabled) {
    return {
      factor: "evidence_quality",
      score: 0,
      weight: DIMENSION_WEIGHT,
      rationale: "No Evidence Quality Scoring result was supplied, so there is no verified basis for confidence.",
    };
  }
  return {
    factor: "evidence_quality",
    score: roundClamp(result.overallPoolScore),
    weight: DIMENSION_WEIGHT,
    rationale: `Evidence Quality Scoring's overall pool score is ${result.overallPoolScore}.`,
  };
}

function scoreIndependentSourcesFactor(
  result: EvidenceQualityScoringResult | undefined,
  explicitCount: number | undefined
): ConfidenceFactorScore {
  let count: number;
  let basis: string;

  if (typeof explicitCount === "number") {
    count = explicitCount;
    basis = "the explicitly supplied independent source count";
  } else if (result && result.itemScores.length > 0) {
    const bestConfirmed = Math.max(...result.itemScores.map((item) => item.confirmedBy.length));
    count = bestConfirmed + 1;
    basis = "a lower bound derived from Evidence Quality Scoring's own confirmedBy relationships (best-corroborated item's confirmation count, plus itself)";
  } else {
    count = 0;
    basis = "no evidence pool or explicit count was supplied";
  }

  let score: number;
  if (count <= 0) score = 0;
  else if (count === 1) score = 30;
  else if (count === 2) score = 65;
  else score = 100;

  return {
    factor: "independent_sources",
    score,
    weight: DIMENSION_WEIGHT,
    rationale: `${count} independent source(s), from ${basis}.`,
  };
}

function scoreSourceAuthorityFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  const mean = meanDimensionScore(result, "source_authority");
  return {
    factor: "source_authority",
    score: roundClamp(mean),
    weight: DIMENSION_WEIGHT,
    rationale:
      result && result.itemScores.length > 0
        ? `Mean source_authority across ${result.itemScores.length} evidence item(s) is ${Math.round(mean)}.`
        : "No evidence pool was supplied, so source authority cannot be assessed.",
  };
}

function scoreEvidenceAgreementFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  if (!result || result.itemScores.length === 0) {
    return {
      factor: "evidence_agreement",
      score: 0,
      weight: DIMENSION_WEIGHT,
      rationale: "No evidence pool was supplied, so agreement between sources cannot be assessed.",
    };
  }
  const confirmedCount = result.itemScores.filter((item) => item.confirmedBy.length > 0).length;
  const ratio = confirmedCount / result.itemScores.length;
  return {
    factor: "evidence_agreement",
    score: roundClamp(ratio * 100),
    weight: DIMENSION_WEIGHT,
    rationale: `${confirmedCount} of ${result.itemScores.length} evidence item(s) are independently corroborated by at least one other source.`,
  };
}

function scoreEvidenceConflictsFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  if (!result || result.itemScores.length === 0) {
    return {
      factor: "evidence_conflicts",
      score: 0,
      weight: DIMENSION_WEIGHT,
      rationale: "No evidence pool was supplied, so conflicts cannot be ruled out.",
    };
  }
  const conflictingCount = result.itemScores.filter((item) => item.contradictedBy.length > 0).length;
  const ratio = conflictingCount / result.itemScores.length;
  return {
    factor: "evidence_conflicts",
    score: roundClamp((1 - ratio) * 100),
    weight: DIMENSION_WEIGHT,
    rationale: `${conflictingCount} of ${result.itemScores.length} evidence item(s) are contradicted by another source (${result.contradictions.length} contradiction(s) detected).`,
  };
}

function scoreMissingEvidenceFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  if (!result) {
    return {
      factor: "missing_evidence",
      score: 0,
      weight: DIMENSION_WEIGHT,
      rationale: "No Evidence Quality Scoring result was supplied, so missing evidence cannot be assessed.",
    };
  }
  return {
    factor: "missing_evidence",
    score: roundClamp(100 - result.missingEvidencePenalty),
    weight: DIMENSION_WEIGHT,
    rationale: `Evidence Quality Scoring's missing-evidence penalty is ${result.missingEvidencePenalty}%.`,
  };
}

function scoreFreshnessFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  const mean = meanDimensionScore(result, "source_freshness");
  return {
    factor: "freshness",
    score: roundClamp(mean),
    weight: DIMENSION_WEIGHT,
    rationale:
      result && result.itemScores.length > 0
        ? `Mean source_freshness across ${result.itemScores.length} evidence item(s) is ${Math.round(mean)}.`
        : "No evidence pool was supplied, so freshness cannot be assessed.",
  };
}

function scoreTraceabilityFactor(result: EvidenceQualityScoringResult | undefined): ConfidenceFactorScore {
  const mean = meanDimensionScore(result, "traceability");
  return {
    factor: "traceability",
    score: roundClamp(mean),
    weight: DIMENSION_WEIGHT,
    rationale:
      result && result.itemScores.length > 0
        ? `Mean traceability across ${result.itemScores.length} evidence item(s) is ${Math.round(mean)}.`
        : "No evidence pool was supplied, so traceability cannot be assessed.",
  };
}

// Higher-stakes domains require stronger evidence to reach the same
// confidence -- getting a medical or engineering conclusion wrong has
// far more serious consequences than a business-idea validation. This
// mirrors the same 6-domain vocabulary already used for executive brief
// structuring, so a caller supplying the same domain hint everywhere
// gets a consistent, cross-module risk posture.
const DOMAIN_RISK_SCORE: Record<ExecutiveBriefDomain, number> = {
  business: 85,
  finance: 65,
  real_estate: 65,
  legal: 40,
  healthcare: 40,
  engineering: 40,
};

function scoreDomainRiskFactor(domain: ExecutiveBriefDomain | undefined): ConfidenceFactorScore {
  if (!domain) {
    return {
      factor: "domain_risk",
      score: 50,
      weight: DIMENSION_WEIGHT,
      rationale: "No domain was supplied; defaulted to a conservative mid-range risk level rather than assuming low risk.",
    };
  }
  return {
    factor: "domain_risk",
    score: DOMAIN_RISK_SCORE[domain],
    weight: DIMENSION_WEIGHT,
    rationale: `Domain "${domain}" carries a ${DOMAIN_RISK_SCORE[domain] >= 80 ? "lower" : DOMAIN_RISK_SCORE[domain] >= 60 ? "moderate" : "higher"} real-world risk level if the conclusion is wrong.`,
  };
}

const DECISION_COMPLEXITY_SCORE: Record<DecisionComplexity, number> = {
  low: 90,
  medium: 65,
  high: 40,
};

function scoreDecisionComplexityFactor(complexity: DecisionComplexity | undefined): ConfidenceFactorScore {
  if (!complexity) {
    return {
      factor: "decision_complexity",
      score: 50,
      weight: DIMENSION_WEIGHT,
      rationale: "No decision complexity was supplied; defaulted to a conservative mid-range value rather than assuming low complexity.",
    };
  }
  return {
    factor: "decision_complexity",
    score: DECISION_COMPLEXITY_SCORE[complexity],
    weight: DIMENSION_WEIGHT,
    rationale: `Decision complexity is "${complexity}".`,
  };
}

const DRIVER_THRESHOLD = 70;
const PENALTY_THRESHOLD = 50;

function disabledResult(): ConfidenceEngineResult {
  return {
    enabled: false,
    confidence: 0,
    confidenceExplanation: `Confidence Engine is disabled (set ${CONFIDENCE_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    factorScores: [],
    confidenceDrivers: [],
    confidencePenalties: [],
    scoringTrace: [`Confidence Engine is disabled (${CONFIDENCE_ENGINE_ENABLED_ENV_VAR} is not "true"); no computation ran.`],
  };
}

export function computeConfidence(input: ConfidenceEngineInput = {}): ConfidenceEngineResult {
  const enabled = input.enabled ?? isConfidenceEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const { evidenceQualityResult } = input;
  const factorScores: ConfidenceFactorScore[] = [
    scoreEvidenceQualityFactor(evidenceQualityResult),
    scoreIndependentSourcesFactor(evidenceQualityResult, input.independentSourceCount),
    scoreSourceAuthorityFactor(evidenceQualityResult),
    scoreEvidenceAgreementFactor(evidenceQualityResult),
    scoreEvidenceConflictsFactor(evidenceQualityResult),
    scoreMissingEvidenceFactor(evidenceQualityResult),
    scoreFreshnessFactor(evidenceQualityResult),
    scoreTraceabilityFactor(evidenceQualityResult),
    scoreDomainRiskFactor(input.domain),
    scoreDecisionComplexityFactor(input.decisionComplexity),
  ];

  const confidence = roundClamp(factorScores.reduce((sum, entry) => sum + entry.score * entry.weight, 0));

  const confidenceDrivers: ConfidenceDriver[] = factorScores
    .filter((entry) => entry.score >= DRIVER_THRESHOLD)
    .map((entry) => ({ factor: entry.factor, description: entry.rationale }));

  const confidencePenalties: ConfidencePenalty[] = factorScores
    .filter((entry) => entry.score < PENALTY_THRESHOLD)
    .map((entry) => ({ factor: entry.factor, description: entry.rationale, impact: roundClamp(100 - entry.score) }));

  const topDriver = [...confidenceDrivers].sort(
    (a, b) =>
      factorScores.find((f) => f.factor === b.factor)!.score - factorScores.find((f) => f.factor === a.factor)!.score
  )[0];
  const topPenalty = [...confidencePenalties].sort((a, b) => b.impact - a.impact)[0];

  const confidenceExplanation = [
    `Confidence is ${confidence}/100, computed as the weighted average of 10 factors (10% each).`,
    topDriver ? `The strongest driver is ${topDriver.factor} (${topDriver.description}).` : "",
    topPenalty ? `The largest penalty is ${topPenalty.factor} (${topPenalty.description}).` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 800);

  const scoringTrace = [
    ...factorScores.map((entry) => `${entry.factor}: ${entry.score} (weight ${entry.weight}) -- ${entry.rationale}`),
    `Overall confidence: ${confidence}.`,
  ];

  return {
    enabled: true,
    confidence,
    confidenceExplanation,
    factorScores,
    confidenceDrivers,
    confidencePenalties,
    scoringTrace,
  };
}
