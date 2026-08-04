import { z } from "zod";
import type { DocumentDomain, UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { DecisionPlan, IntelligenceModule } from "./intelligence-router.ts";

// Layer 6 of ZERINIX Business Intelligence: the Executive Decision
// Brief. This converts layer 5's DecisionPlan (plus layer 4's underlying
// UniversalDocumentIntelligence, for the actual traceable evidence
// arrays) into a concise, evidence-grounded brief for a narrow set of
// supported business decisions. It never generates a report or PDF, and
// it never invents evidence, metrics, market size, competitors, or
// confidence -- every array below is either a direct pass-through of an
// already-extracted fact list or a fixed, clearly-labeled caveat.

export const recommendationStatusValues = [
  "proceed",
  "proceed_with_conditions",
  "wait",
  "reject",
  "insufficient_evidence",
] as const;

export type RecommendationStatus = (typeof recommendationStatusValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const executiveDecisionBriefSchema = z
  .object({
    decisionQuestion: z.string().trim().max(400),
    executiveRecommendation: shortString(400),
    recommendationStatus: z.enum(recommendationStatusValues),
    decisionRationale: z.array(shortString(400)).max(10),
    verifiedEvidence: z.array(shortString(400)).max(30),
    directionalSignals: z.array(shortString(400)).max(30),
    assumptions: z.array(shortString(400)).max(10),
    keyRisks: z.array(shortString(400)).max(30),
    missingCriticalEvidence: z.array(shortString(300)).max(20),
    immediateNextActions: z.array(shortString(300)).max(3),
    decisionConfidence: z.number().min(0).max(1),
    confidenceExplanation: shortString(400),
  })
  .strict();

export type ExecutiveDecisionBrief = z.infer<typeof executiveDecisionBriefSchema>;

// The six supported contexts (business idea validation, market
// intelligence, company analysis, product strategy, investment
// research, pricing/go-to-market) all resolve to one of these document
// domains or recommended modules -- there is no dedicated legal,
// medical, engineering, or HR path here, and there never should be
// (rule 8): those are out of scope for this layer by construction.
const SUPPORTED_BUSINESS_DOMAINS = new Set<DocumentDomain>(["Business", "Financial"]);
const SUPPORTED_BUSINESS_MODULES = new Set<IntelligenceModule>([
  "Business Intelligence",
  "Market Intelligence",
  "Investment Intelligence",
  "Decision Brief",
]);

function isSupportedBusinessContext(decisionPlan: DecisionPlan) {
  if (SUPPORTED_BUSINESS_DOMAINS.has(decisionPlan.detectedDomain)) return true;
  return decisionPlan.recommendedAnalyses.some((item) =>
    SUPPORTED_BUSINESS_MODULES.has(item.module)
  );
}

function unsupportedContextBrief(decisionPlan: DecisionPlan): ExecutiveDecisionBrief {
  return {
    decisionQuestion: decisionPlan.detectedIntent || "",
    executiveRecommendation:
      "This request is not one of the supported business decision contexts (business idea validation, market intelligence, company analysis, product strategy, investment research, or pricing/go-to-market), so no business recommendation is produced.",
    recommendationStatus: "insufficient_evidence",
    decisionRationale: [
      `The detected document domain is "${decisionPlan.detectedDomain}", and none of the business-relevant modules (Business Intelligence, Market Intelligence, Investment Intelligence, Decision Brief) were recommended by the decision plan.`,
    ],
    verifiedEvidence: [],
    directionalSignals: [],
    assumptions: [],
    keyRisks: [],
    missingCriticalEvidence: [],
    immediateNextActions: [],
    decisionConfidence: 0,
    confidenceExplanation:
      "No confidence is assigned because this request falls outside the business decision contexts this layer supports.",
  };
}

function buildAssumptions(documentIntelligence: UniversalDocumentIntelligence) {
  const assumptions = [
    "Facts and figures presented in the source material are assumed accurate as stated; no independent, external verification was performed by this layer.",
    "This brief assumes the document's stated purpose still reflects the decision the user currently wants to make.",
  ];

  if (documentIntelligence.entities.numbers.length > 0) {
    assumptions.push(
      "Numeric figures in the document are treated as assumptions rather than confirmed facts, because no independently corroborating source was found in the visible content."
    );
  }

  return assumptions;
}

function determineStatus({
  verifiedEvidence,
  directionalSignals,
  keyRisks,
  missingCriticalEvidence,
  decisionPlan,
}: {
  verifiedEvidence: string[];
  directionalSignals: string[];
  keyRisks: string[];
  missingCriticalEvidence: string[];
  decisionPlan: DecisionPlan;
}): RecommendationStatus {
  if (verifiedEvidence.length === 0 && directionalSignals.length === 0) {
    return "insufficient_evidence";
  }
  if (keyRisks.length >= 2 && verifiedEvidence.length === 0) {
    return "reject";
  }
  if (missingCriticalEvidence.length >= 3 || decisionPlan.confidence < 0.4) {
    return "wait";
  }
  if (keyRisks.length > 0) {
    return "proceed_with_conditions";
  }
  if (verifiedEvidence.length >= 2 && decisionPlan.confidence >= 0.55) {
    return "proceed";
  }
  return "proceed_with_conditions";
}

const EXECUTIVE_RECOMMENDATION_TEXT: Record<RecommendationStatus, string> = {
  proceed:
    "Proceed. The verified evidence below supports moving forward on this decision.",
  proceed_with_conditions:
    "Proceed, but only after addressing the key risks and conditions identified below.",
  wait:
    "Wait before proceeding. Critical evidence gaps must be closed before this decision can be made responsibly.",
  reject:
    "Do not proceed on the current information. The identified risks are not offset by any verified supporting evidence.",
  insufficient_evidence:
    "There is not enough verified information to make a responsible recommendation either way.",
};

function buildRationale({
  status,
  verifiedEvidence,
  directionalSignals,
  keyRisks,
  missingCriticalEvidence,
  decisionPlan,
}: {
  status: RecommendationStatus;
  verifiedEvidence: string[];
  directionalSignals: string[];
  keyRisks: string[];
  missingCriticalEvidence: string[];
  decisionPlan: DecisionPlan;
}) {
  const rationale = [
    `${verifiedEvidence.length} verified evidence statement(s) and ${directionalSignals.length} directional signal(s) were found in the underlying document intelligence.`,
  ];

  if (keyRisks.length > 0) {
    rationale.push(`${keyRisks.length} risk statement(s) were identified that must be accounted for.`);
  }
  if (missingCriticalEvidence.length > 0) {
    rationale.push(`${missingCriticalEvidence.length} piece(s) of critical evidence remain missing.`);
  }
  rationale.push(
    `The underlying decision plan's overall confidence is ${decisionPlan.confidence}, which is a direct factor in recommending "${status}".`
  );

  return rationale;
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

export function buildExecutiveDecisionBrief({
  decisionPlan,
  documentIntelligence,
}: {
  decisionPlan: DecisionPlan;
  documentIntelligence: UniversalDocumentIntelligence;
}): ExecutiveDecisionBrief {
  if (!isSupportedBusinessContext(decisionPlan)) {
    return unsupportedContextBrief(decisionPlan);
  }

  // Every array below is either a direct pass-through of a fact list
  // layer 4 already extracted from the document, or (for assumptions) a
  // fixed, explicitly-labeled caveat -- nothing here is synthesized as a
  // new fact, so every statement stays traceable to its source field.
  const verifiedEvidence = [...documentIntelligence.evidence];
  const directionalSignals = [
    ...documentIntelligence.decisions,
    ...documentIntelligence.obligations,
  ];
  const keyRisks = [...documentIntelligence.risks];
  const missingCriticalEvidence = [...decisionPlan.missingEvidence];
  const assumptions = buildAssumptions(documentIntelligence);

  const status = determineStatus({
    verifiedEvidence,
    directionalSignals,
    keyRisks,
    missingCriticalEvidence,
    decisionPlan,
  });

  return {
    decisionQuestion:
      decisionPlan.detectedIntent ||
      "No explicit decision question was identified from the user's request or the document.",
    executiveRecommendation: EXECUTIVE_RECOMMENDATION_TEXT[status],
    recommendationStatus: status,
    decisionRationale: buildRationale({
      status,
      verifiedEvidence,
      directionalSignals,
      keyRisks,
      missingCriticalEvidence,
      decisionPlan,
    }),
    verifiedEvidence,
    directionalSignals,
    assumptions,
    keyRisks,
    missingCriticalEvidence,
    immediateNextActions: buildImmediateNextActions(missingCriticalEvidence, keyRisks),
    decisionConfidence: decisionPlan.confidence,
    confidenceExplanation: `This is the underlying decision plan's own confidence score (combining document domain confidence and intent clarity), not independently recalculated. ${verifiedEvidence.length} verified evidence item(s) support it.`,
  };
}
