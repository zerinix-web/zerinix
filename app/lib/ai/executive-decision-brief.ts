import { z } from "zod";
import type { UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { DecisionPlan } from "./intelligence-router.ts";
import {
  recommendationStatusValues,
  runExpertReasoningEngine,
  type ExpertReasoningResult,
  type ReasoningSection,
} from "./expert-reasoning-engine.ts";

// Layer 6 of ZERINIX Business Intelligence: the Executive Decision
// Brief -- now integrated with the ZERINIX Expert Reasoning Engine
// (expert-reasoning-engine.ts). The required flow is: (1) existing
// evidence/intelligence objects are collected, (2) the Expert Reasoning
// Engine evaluates them into an ExpertReasoningResult, (3) this module
// converts that result into the concise brief below. This module no
// longer computes its own domain-support check, status, or assumptions
// independently of the engine -- it consumes the engine's own
// determination so there is a single source of truth for "is this
// supported" and "what does the evidence support," not two that could
// drift apart. It never generates a report or PDF, and it never invents
// evidence, metrics, market size, competitors, or confidence.

export { recommendationStatusValues };
export type RecommendationStatus = (typeof recommendationStatusValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const executiveDecisionBriefSchema = z
  .object({
    decisionQuestion: z.string().trim().max(400),
    executiveRecommendation: shortString(600),
    recommendationStatus: z.enum(recommendationStatusValues),
    decisionRationale: z.array(shortString(500)).max(12),
    verifiedEvidence: z.array(shortString(400)).max(60),
    directionalSignals: z.array(shortString(400)).max(60),
    assumptions: z.array(shortString(400)).max(10),
    keyRisks: z.array(shortString(400)).max(30),
    missingCriticalEvidence: z.array(shortString(300)).max(30),
    immediateNextActions: z.array(shortString(300)).max(3),
    decisionConfidence: z.number().min(0).max(1),
    confidenceExplanation: shortString(500),
    evidenceTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type ExecutiveDecisionBrief = z.infer<typeof executiveDecisionBriefSchema>;

function unsupportedContextBrief(expertReasoningResult: ExpertReasoningResult): ExecutiveDecisionBrief {
  return {
    decisionQuestion: expertReasoningResult.decisionObjective || "",
    executiveRecommendation:
      "This request is not one of the supported business decision contexts (business idea validation, market intelligence, company analysis, financial analysis, investment research, product strategy, pricing strategy, go-to-market strategy, or growth/business risk decisions), so no business recommendation is produced.",
    recommendationStatus: "insufficient_evidence",
    decisionRationale: [
      `detectedBusinessContext is "${expertReasoningResult.detectedBusinessContext}", which is outside the supported business reasoning contexts.`,
    ],
    verifiedEvidence: [],
    directionalSignals: [],
    assumptions: [],
    keyRisks: [],
    missingCriticalEvidence: [],
    immediateNextActions: [],
    decisionConfidence: 0,
    confidenceExplanation: expertReasoningResult.confidenceExplanation,
    evidenceTrace: expertReasoningResult.evidenceTrace,
  };
}

function buildImmediateNextActions(missingCriticalEvidence: string[], keyRisks: string[]) {
  const actions: string[] = [];

  for (const gap of missingCriticalEvidence.slice(0, 2)) {
    actions.push(`Obtain or verify: ${gap}`);
  }
  if (keyRisks.length > 0 && actions.length < 3) {
    actions.push(`Assess and mitigate this identified risk: ${keyRisks[0]}`);
  }
  if (actions.length === 0) {
    actions.push(
      "No further immediate action beyond executing on this decision is identified from the available evidence."
    );
  }

  return actions.slice(0, 3);
}

const APPLICABLE_SECTIONS: Array<[label: string, key: keyof ExpertReasoningResult]> = [
  ["market", "marketReasoning"],
  ["competitor", "competitorReasoning"],
  ["financial", "financialReasoning"],
  ["business model", "businessModelReasoning"],
  ["pricing", "pricingReasoning"],
  ["go-to-market", "goToMarketReasoning"],
  ["risk", "riskReasoning"],
  ["investment", "investmentReasoning"],
];

// The executive recommendation and rationale are built directly from the
// engine's own recommendedOption/rationale and from whichever reasoning
// sections the engine found applicable -- this is what makes the brief
// evidence-backed rather than a fixed per-status template: the exact
// wording changes with the exact evidence the engine found, and cites
// specific counts rather than a generic sentence.
function buildExecutiveRecommendation(expertReasoningResult: ExpertReasoningResult) {
  const base = expertReasoningResult.recommendedOption
    ? `${expertReasoningResult.recommendedOption.option} ${expertReasoningResult.recommendedOption.rationale}`
    : "There is not enough verified information to make a responsible recommendation either way.";
  return base.slice(0, 600);
}

function buildDecisionRationale(expertReasoningResult: ExpertReasoningResult) {
  const rationale: string[] = [];

  for (const [label, key] of APPLICABLE_SECTIONS) {
    const section = expertReasoningResult[key] as ReasoningSection;
    if (section.applicable) {
      rationale.push(`${label} reasoning applies: ${section.summary}`);
    }
  }

  if (expertReasoningResult.recommendedOption) {
    rationale.push(expertReasoningResult.recommendedOption.rationale);
  }
  rationale.push(
    `The underlying reasoning confidence is ${expertReasoningResult.confidence}, which is a direct factor in recommending "${expertReasoningResult.recommendationStatus}".`
  );

  return rationale.slice(0, 12);
}

export function buildExecutiveDecisionBriefFromExpertReasoning(
  expertReasoningResult: ExpertReasoningResult
): ExecutiveDecisionBrief {
  if (expertReasoningResult.detectedBusinessContext === "unsupported") {
    return unsupportedContextBrief(expertReasoningResult);
  }

  const keyRisks = expertReasoningResult.riskReasoning.applicable
    ? expertReasoningResult.riskReasoning.supportingEvidence
    : [];

  return {
    decisionQuestion:
      expertReasoningResult.decisionObjective ||
      "No explicit decision question was identified from the user's request or the document.",
    executiveRecommendation: buildExecutiveRecommendation(expertReasoningResult),
    recommendationStatus: expertReasoningResult.recommendationStatus,
    decisionRationale: buildDecisionRationale(expertReasoningResult),
    verifiedEvidence: expertReasoningResult.verifiedFacts,
    directionalSignals: expertReasoningResult.directionalSignals,
    assumptions: expertReasoningResult.assumptions,
    keyRisks,
    missingCriticalEvidence: expertReasoningResult.evidenceGaps,
    immediateNextActions: buildImmediateNextActions(expertReasoningResult.evidenceGaps, keyRisks),
    decisionConfidence: expertReasoningResult.confidence,
    confidenceExplanation: expertReasoningResult.confidenceExplanation,
    evidenceTrace: expertReasoningResult.evidenceTrace,
  };
}

export function buildExecutiveDecisionBrief({
  decisionPlan,
  documentIntelligence,
  prompt,
  marketResearchEvidence,
  businessPlanEvidence,
  financialEvidence,
  userProvidedFacts,
}: {
  decisionPlan: DecisionPlan;
  documentIntelligence: UniversalDocumentIntelligence;
  prompt?: string;
  marketResearchEvidence?: readonly string[];
  businessPlanEvidence?: readonly string[];
  financialEvidence?: readonly string[];
  userProvidedFacts?: readonly string[];
}): ExecutiveDecisionBrief {
  const expertReasoningResult = runExpertReasoningEngine({
    prompt,
    documentIntelligence,
    decisionPlan,
    marketResearchEvidence,
    businessPlanEvidence,
    financialEvidence,
    userProvidedFacts,
  });

  return buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);
}
