import { z } from "zod";
import {
  recommendationStatusValues,
  type ExecutiveDecisionBrief,
  type RecommendationStatus,
} from "./executive-decision-brief.ts";
import type { ExpertReasoningResult, StrategicOption } from "./expert-reasoning-engine.ts";
import type { DecisionCategory, DecisionIntentResult } from "./decision-intent-engine.ts";

// ZERINIX Decision Strategy Engine v1. Runs after the Decision Intent
// Engine. ZERINIX's goal here is not to summarize -- it is to recommend
// the strongest business decision using only verified evidence already
// produced by the earlier layers (DecisionIntentResult,
// ExpertReasoningResult, ExecutiveDecisionBrief). Like every earlier
// layer, this is a deterministic, pattern-based derivation, not a model
// call: every recommendation is a direct pass-through, a re-labeling, or
// a conservative combination of fields the earlier layers already
// computed and already traced to evidence. Nothing here invents a new
// fact, a financial value, or a motivational framing.

export const strategyDecisionTypeValues = [
  "investment",
  "acquisition",
  "pricing",
  "product launch",
  "market expansion",
  "fundraising",
  "partnership",
  "hiring",
  "budgeting",
  "operational strategy",
  "company analysis",
  "market analysis",
  "strategic planning",
] as const;

export type StrategyDecisionType = (typeof strategyDecisionTypeValues)[number];

export const evidenceStrengthValues = ["strong", "moderate", "weak", "none"] as const;
export type EvidenceStrength = (typeof evidenceStrengthValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

const strategyOptionSchema = z
  .object({
    decisionType: z.enum(strategyDecisionTypeValues).nullable(),
    status: z.enum(recommendationStatusValues),
    statement: shortString(600),
    rationale: shortString(500),
    supportingEvidence: z.array(shortString(400)).max(15),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type StrategyOption = z.infer<typeof strategyOptionSchema>;

export const decisionStrategyResultSchema = z
  .object({
    recommendedDecision: strategyOptionSchema,
    alternativeStrategies: z.array(strategyOptionSchema).max(6),
    whyRecommended: z.array(shortString(500)).max(10),
    expectedBenefits: z.array(shortString(400)).max(20),
    possibleRisks: z.array(shortString(400)).max(30),
    tradeOffs: z.array(shortString(500)).max(10),
    decisionConditions: z.array(shortString(400)).max(15),
    executionPriority: z.array(shortString(300)).max(10),
    confidence: z.number().min(0).max(1),
    confidenceExplanation: shortString(500),
    evidenceStrength: z.enum(evidenceStrengthValues),
    evidenceTrace: z.array(shortString(500)).max(40),
    assumptionsUsed: z.array(shortString(400)).max(15),
    informationStillNeeded: z.array(shortString(300)).max(20),
    decisionCanChangeIf: z.array(shortString(400)).max(15),
    executiveSummary: shortString(800),
  })
  .strict();

export type DecisionStrategyResult = z.infer<typeof decisionStrategyResultSchema>;

export type DecisionStrategyInput = {
  decisionIntentResult: DecisionIntentResult;
  expertReasoningResult: ExpertReasoningResult;
  executiveDecisionBrief: ExecutiveDecisionBrief;
  verifiedEvidence?: readonly string[];
  directionalSignals?: readonly string[];
  assumptions?: readonly string[];
};

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

// Deliberately conservative and explicit: only decision categories with
// an unambiguous match in the 13 supported strategy types are mapped.
// Everything else (start_business, validate_business, enter_market,
// growth_strategy, risk_assessment, financial_review) is left unmapped
// on purpose -- guessing a "close enough" bucket for those would risk
// presenting a decision type the evidence was never actually about.
const CATEGORY_TO_STRATEGY_TYPE: Partial<Record<DecisionCategory, StrategyDecisionType>> = {
  investment: "investment",
  acquisition: "acquisition",
  pricing: "pricing",
  launch_product: "product launch",
  expand_market: "market expansion",
  fundraising: "fundraising",
  partnership: "partnership",
  hiring: "hiring",
  budgeting: "budgeting",
  operational_decision: "operational strategy",
  company_analysis: "company analysis",
  competitor_analysis: "market analysis",
  strategic_decision: "strategic planning",
};

function mapToStrategyType(category: DecisionCategory | null): StrategyDecisionType | null {
  if (!category) return null;
  return CATEGORY_TO_STRATEGY_TYPE[category] ?? null;
}

const RISK_LIKE_PATTERN =
  /\b(risk|liability|penalty|breach|violation|non-compliance|exposure|hazard|threat|warning)\b/i;

function classifyEvidenceStrength(
  verifiedCount: number,
  directionalCount: number
): EvidenceStrength {
  if (verifiedCount === 0 && directionalCount === 0) return "none";
  if (verifiedCount >= 3) return "strong";
  if (verifiedCount >= 1 || directionalCount >= 2) return "moderate";
  return "weak";
}

function buildInsufficientResult(
  reasonStatement: string,
  evidenceTrace: string[]
): DecisionStrategyResult {
  const recommendedDecision: StrategyOption = {
    decisionType: null,
    status: "insufficient_evidence",
    statement: reasonStatement,
    rationale: reasonStatement,
    supportingEvidence: [],
    confidence: 0,
  };

  return {
    recommendedDecision,
    alternativeStrategies: [],
    whyRecommended: [],
    expectedBenefits: [],
    possibleRisks: [],
    tradeOffs: [],
    decisionConditions: [],
    executionPriority: [],
    confidence: 0,
    confidenceExplanation:
      "No confidence is assigned because a business decision recommendation cannot responsibly be made from the available input.",
    evidenceStrength: "none",
    evidenceTrace,
    assumptionsUsed: [],
    informationStillNeeded: [],
    decisionCanChangeIf: [],
    executiveSummary: reasonStatement,
  };
}

function relabelStrategicOption(
  option: StrategicOption,
  decisionType: StrategyDecisionType | null,
  status: RecommendationStatus
): StrategyOption {
  return {
    decisionType,
    status,
    statement: option.option,
    rationale: option.rationale,
    supportingEvidence: option.supportingEvidence,
    confidence: 0,
  };
}

export function runDecisionStrategyEngine(input: DecisionStrategyInput): DecisionStrategyResult {
  const {
    decisionIntentResult,
    expertReasoningResult,
    executiveDecisionBrief,
    verifiedEvidence = [],
    directionalSignals = [],
    assumptions = [],
  } = input;

  const evidenceTrace: string[] = [];

  if (decisionIntentResult.cannotDetermineReason) {
    evidenceTrace.push(
      `decisionIntentResult.cannotDetermineReason is set ("${decisionIntentResult.cannotDetermineReason}"), so no strategy can be recommended.`
    );
    return buildInsufficientResult(
      "No business decision could be confidently identified upstream, so no strategy is recommended.",
      evidenceTrace
    );
  }

  const strategyType = mapToStrategyType(decisionIntentResult.decisionCategory);
  evidenceTrace.push(
    strategyType
      ? `decisionIntentResult.decisionCategory ("${decisionIntentResult.decisionCategory}") maps to the supported strategy type "${strategyType}".`
      : `decisionIntentResult.decisionCategory ("${decisionIntentResult.decisionCategory}") does not map to any of the 13 supported strategy types.`
  );

  if (!strategyType) {
    return buildInsufficientResult(
      `The detected decision category ("${decisionIntentResult.decisionCategory}") is not one of the supported business decision types for this engine, so no strategy is recommended.`,
      evidenceTrace
    );
  }

  const combinedVerifiedEvidence = unique([
    ...executiveDecisionBrief.verifiedEvidence,
    ...expertReasoningResult.verifiedFacts,
    ...verifiedEvidence,
  ]);
  const combinedDirectionalSignals = unique([
    ...executiveDecisionBrief.directionalSignals,
    ...expertReasoningResult.directionalSignals,
    ...directionalSignals,
  ]);
  const combinedAssumptions = unique([
    ...executiveDecisionBrief.assumptions,
    ...expertReasoningResult.assumptions,
    ...assumptions,
  ]);
  evidenceTrace.push(
    `verifiedEvidence combines executiveDecisionBrief.verifiedEvidence (${executiveDecisionBrief.verifiedEvidence.length}), expertReasoningResult.verifiedFacts (${expertReasoningResult.verifiedFacts.length}), and the directly supplied verifiedEvidence (${verifiedEvidence.length}).`
  );

  const evidenceStrength = classifyEvidenceStrength(
    combinedVerifiedEvidence.length,
    combinedDirectionalSignals.length
  );
  evidenceTrace.push(
    `evidenceStrength ("${evidenceStrength}") is based on ${combinedVerifiedEvidence.length} verified evidence item(s) and ${combinedDirectionalSignals.length} directional signal(s).`
  );

  // The brief's own status is trusted as the primary signal (it already
  // ran its own evidence-based determination) -- but if the combined
  // evidence pool available to this layer is thinner than what the
  // brief operated on, this is a required safety net: never let a
  // "proceed" survive on evidence this engine can independently see is
  // weak or absent.
  let status: RecommendationStatus = executiveDecisionBrief.recommendationStatus;
  if (evidenceStrength === "none" && status !== "insufficient_evidence") {
    evidenceTrace.push(
      `status downgraded from "${status}" to "insufficient_evidence" because the combined evidence pool available to this engine is empty.`
    );
    status = "insufficient_evidence";
  } else if (evidenceStrength === "weak" && status === "proceed") {
    evidenceTrace.push('status downgraded from "proceed" to "wait" because evidenceStrength is "weak".');
    status = "wait";
  }

  const possibleRisks = unique(executiveDecisionBrief.keyRisks);
  const expectedBenefits = combinedVerifiedEvidence.filter((item) => !RISK_LIKE_PATTERN.test(item));
  const tradeOffs =
    expectedBenefits.length > 0 && possibleRisks.length > 0
      ? expectedBenefits
          .slice(0, 3)
          .flatMap((benefit) =>
            possibleRisks.slice(0, 1).map((risk) => `Weigh "${benefit}" against the risk: "${risk}".`)
          )
          .slice(0, 10)
      : [];

  const informationStillNeeded = unique([
    ...executiveDecisionBrief.missingCriticalEvidence,
    ...decisionIntentResult.missingEvidence,
    ...decisionIntentResult.criticalUnknowns,
  ]);

  const decisionConditions = unique([
    ...combinedAssumptions.map((item) => `This recommendation holds only if: ${item}`),
    ...informationStillNeeded.slice(0, 5).map((item) => `Confirm before proceeding: ${item}`),
  ]).slice(0, 15);

  const decisionCanChangeIf = unique([
    ...possibleRisks.map((risk) => `If this risk materializes or worsens: ${risk}`),
    ...informationStillNeeded
      .slice(0, 5)
      .map((item) => `If gathering this evidence reveals an unfavorable answer: ${item}`),
  ]).slice(0, 15);

  const executionPriority = unique([
    ...decisionIntentResult.recommendedAnalysisPath,
    ...executiveDecisionBrief.immediateNextActions,
  ]).slice(0, 10);

  const confidence = Math.round(
    ((decisionIntentResult.confidence + expertReasoningResult.confidence + executiveDecisionBrief.decisionConfidence) / 3) *
      100
  ) / 100;
  evidenceTrace.push(
    `confidence (${confidence}) is the average of decisionIntentResult.confidence, expertReasoningResult.confidence, and executiveDecisionBrief.decisionConfidence.`
  );

  const recommendedDecision: StrategyOption = {
    decisionType: strategyType,
    status,
    statement: executiveDecisionBrief.executiveRecommendation,
    rationale: `Detected decision: "${decisionIntentResult.primaryDecision?.statement ?? decisionIntentResult.detectedBusinessGoal}". ${executiveDecisionBrief.decisionRationale.join(" ")}`.slice(
      0,
      500
    ),
    supportingEvidence: combinedVerifiedEvidence.slice(0, 15),
    confidence,
  };
  evidenceTrace.push(
    `recommendedDecision.status ("${status}") and .statement are sourced from executiveDecisionBrief.recommendationStatus/.executiveRecommendation, adjusted only by the evidenceStrength safety net above.`
  );

  const alternativeStrategies: StrategyOption[] = expertReasoningResult.rejectedOptions.map((option) =>
    relabelStrategicOption(option, strategyType, status)
  );
  if (decisionIntentResult.secondaryDecision) {
    const secondaryType = mapToStrategyType(decisionIntentResult.secondaryDecision.category);
    alternativeStrategies.push({
      decisionType: secondaryType,
      status: "wait",
      statement: `Consider addressing the secondary detected decision first: ${decisionIntentResult.secondaryDecision.statement}`,
      rationale: `A secondary decision candidate was also detected at confidence ${decisionIntentResult.secondaryDecision.confidence}.`,
      supportingEvidence: decisionIntentResult.secondaryDecision.supportingEvidence,
      confidence: decisionIntentResult.secondaryDecision.confidence,
    });
  }

  const whyRecommended = unique([
    `${combinedVerifiedEvidence.length} verified evidence item(s) and ${combinedDirectionalSignals.length} directional signal(s) support this recommendation.`,
    ...executiveDecisionBrief.decisionRationale.slice(0, 5),
  ]).slice(0, 10);

  const executiveSummary = [
    `Recommended: ${recommendedDecision.statement}`,
    possibleRisks.length > 0 ? `Key risk(s) to manage: ${possibleRisks[0]}.` : "",
    informationStillNeeded.length > 0
      ? `Still needed: ${informationStillNeeded[0]}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 800);

  return {
    recommendedDecision,
    alternativeStrategies: alternativeStrategies.slice(0, 6),
    whyRecommended,
    expectedBenefits,
    possibleRisks,
    tradeOffs,
    decisionConditions,
    executionPriority,
    confidence,
    confidenceExplanation: `This is the average of decisionIntentResult.confidence (${decisionIntentResult.confidence}), expertReasoningResult.confidence (${expertReasoningResult.confidence}), and executiveDecisionBrief.decisionConfidence (${executiveDecisionBrief.decisionConfidence}), not independently recalculated.`,
    evidenceStrength,
    evidenceTrace,
    assumptionsUsed: combinedAssumptions,
    informationStillNeeded,
    decisionCanChangeIf,
    executiveSummary,
  };
}
