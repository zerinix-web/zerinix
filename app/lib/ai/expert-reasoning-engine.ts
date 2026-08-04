import { z } from "zod";
import type { DocumentDomain, UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { DecisionPlan } from "./intelligence-router.ts";

// ZERINIX Expert Reasoning Engine v1. This is a reasoning layer for the
// existing supported business intelligence contexts only -- it does not
// turn ZERINIX into a general-purpose chatbot or a universal specialist
// platform, and it never adds a legal, medical, engineering, or HR
// reasoning path. Every input it accepts is an already-structured object
// from an earlier layer (document intelligence, decision plan) or an
// already-extracted evidence list; this engine never re-parses raw
// documents and never invents a fact that is not already present in one
// of those inputs.
//
// This module owns RecommendationStatus (rather than importing it from
// executive-decision-brief.ts) so the dependency runs one way only:
// executive-decision-brief.ts consumes this engine's output, and this
// engine never needs to import anything from executive-decision-brief.ts.

export const recommendationStatusValues = [
  "proceed",
  "proceed_with_conditions",
  "wait",
  "reject",
  "insufficient_evidence",
] as const;

export type RecommendationStatus = (typeof recommendationStatusValues)[number];

export const reasoningDomainValues = [
  "business_intelligence",
  "market_intelligence",
  "company_analysis",
  "financial_intelligence",
  "investment_intelligence",
  "product_strategy",
  "pricing_strategy",
  "go_to_market_strategy",
  "growth_strategy",
  "risk_intelligence",
  "unsupported",
] as const;

export type ReasoningDomain = (typeof reasoningDomainValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

const reasoningSectionSchema = z
  .object({
    applicable: z.boolean(),
    summary: z.string().trim().max(500),
    supportingEvidence: z.array(shortString(400)).max(20),
  })
  .strict();

const strategicOptionSchema = z
  .object({
    option: shortString(300),
    rationale: shortString(400),
    supportingEvidence: z.array(shortString(400)).max(10),
  })
  .strict();

export const expertReasoningResultSchema = z
  .object({
    detectedBusinessContext: z.enum(reasoningDomainValues),
    decisionObjective: z.string().trim().max(400),
    verifiedFacts: z.array(shortString(400)).max(60),
    directionalSignals: z.array(shortString(400)).max(60),
    assumptions: z.array(shortString(400)).max(10),
    keyBusinessQuestions: z.array(shortString(400)).max(20),
    marketReasoning: reasoningSectionSchema,
    competitorReasoning: reasoningSectionSchema,
    financialReasoning: reasoningSectionSchema,
    businessModelReasoning: reasoningSectionSchema,
    pricingReasoning: reasoningSectionSchema,
    goToMarketReasoning: reasoningSectionSchema,
    riskReasoning: reasoningSectionSchema,
    investmentReasoning: reasoningSectionSchema,
    strategicOptions: z.array(strategicOptionSchema).max(6),
    recommendedOption: strategicOptionSchema.nullable(),
    rejectedOptions: z.array(strategicOptionSchema).max(6),
    recommendationStatus: z.enum(recommendationStatusValues),
    evidenceGaps: z.array(shortString(400)).max(30),
    confidence: z.number().min(0).max(1),
    confidenceExplanation: shortString(500),
    evidenceTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type ExpertReasoningResult = z.infer<typeof expertReasoningResultSchema>;
export type ReasoningSection = z.infer<typeof reasoningSectionSchema>;
export type StrategicOption = z.infer<typeof strategicOptionSchema>;

export type ExpertReasoningInput = {
  prompt?: string;
  documentIntelligence?: UniversalDocumentIntelligence;
  decisionPlan?: DecisionPlan;
  marketResearchEvidence?: readonly string[];
  businessPlanEvidence?: readonly string[];
  financialEvidence?: readonly string[];
  userProvidedFacts?: readonly string[];
};

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const SUPPORTED_DOCUMENT_DOMAINS = new Set<DocumentDomain>(["Business", "Financial"]);
const SUPPORTED_RECOMMENDED_MODULES = new Set([
  "Business Intelligence",
  "Market Intelligence",
  "Investment Intelligence",
  "Decision Brief",
]);

// A real uploaded document that layer 4/5 confidently classified as a
// non-business domain (Legal, Medical, Technical, Engineering, Real
// Estate, HR, Government, Academic, Contract, Spreadsheet) is treated as
// unsupported unconditionally, regardless of what other evidence buckets
// were separately provided -- rule 6 protects the document's own
// classification, not just the absence of business keywords. "Unknown"
// is deliberately NOT in this set: layer 4/5's 13-domain classifier is
// coarser than this engine's own 10-domain keyword classifier below, so
// an "Unknown" document (or no decisionPlan at all) should still get a
// chance at the finer-grained classification instead of being blocked
// on a classifier that simply didn't have a matching bucket for it.
const HARD_UNSUPPORTED_DOCUMENT_DOMAINS = new Set<DocumentDomain>([
  "Legal",
  "Medical",
  "Technical",
  "Engineering",
  "Real Estate",
  "HR",
  "Government",
  "Academic",
  "Contract",
  "Spreadsheet",
]);

function isDocumentDomainSupported(decisionPlan: ExpertReasoningInput["decisionPlan"]) {
  if (!decisionPlan) return false;
  if (SUPPORTED_DOCUMENT_DOMAINS.has(decisionPlan.detectedDomain)) return true;
  return decisionPlan.recommendedAnalyses.some((item) =>
    SUPPORTED_RECOMMENDED_MODULES.has(item.module)
  );
}

type DomainSignal = Exclude<ReasoningDomain, "unsupported">;

const DOMAIN_SIGNALS: Record<DomainSignal, RegExp> = {
  market_intelligence:
    /\b(market size|market share|total addressable market|\btam\b|\bsam\b|\bsom\b|competitive landscape|industry trend|market research|customer segment)\b/gi,
  company_analysis:
    /\b(company overview|corporate structure|company profile|organi[sz]ational structure|company performance|annual report)\b/gi,
  financial_intelligence:
    /\b(balance sheet|income statement|cash flow|profit margin|financial statement|financial health)\b/gi,
  investment_intelligence:
    /\b(investment|valuation|funding round|equity stake|return on investment|\broi\b|acquisition|venture capital)\b/gi,
  product_strategy:
    /\b(product roadmap|product-market fit|feature prioriti[sz]ation|product strategy|minimum viable product|\bmvp\b)\b/gi,
  pricing_strategy:
    /\b(pricing model|price point|subscription price|pricing strategy|price sensitivity|willingness to pay)\b/gi,
  go_to_market_strategy:
    /\b(go-to-market|launch strategy|distribution channel|customer acquisition|sales channel)\b/gi,
  growth_strategy:
    /\b(growth strategy|scaling|expansion plan|user growth|revenue growth|market expansion)\b/gi,
  risk_intelligence:
    /\b(risk assessment|risk factor|regulatory risk|operational risk|risk mitigation)\b/gi,
  business_intelligence:
    /\b(business model|business plan|business strategy|business case|strategic plan)\b/gi,
};

const DOMAIN_PRIORITY: DomainSignal[] = [
  "investment_intelligence",
  "financial_intelligence",
  "pricing_strategy",
  "go_to_market_strategy",
  "product_strategy",
  "growth_strategy",
  "risk_intelligence",
  "market_intelligence",
  "company_analysis",
  "business_intelligence",
];

function classifyReasoningDomain(text: string): { domain: DomainSignal; hits: number } | null {
  let best: { domain: DomainSignal; hits: number } | null = null;

  for (const domain of DOMAIN_PRIORITY) {
    const matches = text.match(DOMAIN_SIGNALS[domain]) || [];
    if (matches.length === 0) continue;
    const hits = new Set(matches.map((m) => m.toLowerCase())).size;
    if (!best || hits > best.hits) {
      best = { domain, hits };
    }
  }

  return best;
}

function detectBusinessContext({
  decisionPlan,
  combinedEvidenceText,
}: {
  decisionPlan: ExpertReasoningInput["decisionPlan"];
  combinedEvidenceText: string;
}): ReasoningDomain {
  if (decisionPlan && HARD_UNSUPPORTED_DOCUMENT_DOMAINS.has(decisionPlan.detectedDomain)) {
    return "unsupported";
  }

  const classified = classifyReasoningDomain(combinedEvidenceText);
  if (classified) return classified.domain;

  if (isDocumentDomainSupported(decisionPlan)) return "business_intelligence";
  return "unsupported";
}

function buildReasoningSection(
  pattern: RegExp,
  evidencePool: readonly string[],
  topicText: string
): ReasoningSection {
  const matching = evidencePool.filter((item) => pattern.test(item));
  if (matching.length > 0) {
    return {
      applicable: true,
      summary: `${matching.length} item(s) of existing evidence relate to this area; see supportingEvidence for the exact statements.`,
      supportingEvidence: unique(matching),
    };
  }

  // The topic can be indicated by the document's purpose or headings
  // even when no individual sentence was captured as evidence/decision/
  // obligation/risk by layer 4. That still makes the section applicable
  // (there is a real topic signal to reason about), but without any
  // supportingEvidence there is nothing to fabricate, so the summary
  // says exactly that.
  if (pattern.test(topicText)) {
    return {
      applicable: true,
      summary:
        "This area is indicated by the document's stated purpose or headings, but no specific verified evidence or directional signal was found to support it.",
      supportingEvidence: [],
    };
  }

  return { applicable: false, summary: "", supportingEvidence: [] };
}

const REASONING_SECTION_PATTERNS = {
  market: /\b(market|demand|customer segment|industry|competitive landscape)\b/i,
  competitor: /\b(competitor|competition|rival|market share)\b/i,
  financial: /\b(revenue|profit|margin|balance sheet|income statement|cash flow|financial)\b/i,
  businessModel: /\b(business model|revenue model|unit economics|monetization)\b/i,
  pricing: /\b(pricing|price point|subscription|per[- ]unit price|willingness to pay)\b/i,
  goToMarket: /\b(go-to-market|launch strategy|distribution channel|customer acquisition|sales channel)\b/i,
  risk: /\b(risk|liability|penalty|breach|violation|non-compliance|exposure|hazard|threat)\b/i,
  investment: /\b(invest(?:ment)?|valuation|funding|equity|venture capital|return on investment|\broi\b)\b/i,
} as const;

function buildAssumptions(hasNumbers: boolean) {
  const assumptions = [
    "Facts and figures presented in the supplied evidence are assumed accurate as stated; no independent, external verification was performed by this engine.",
    "This reasoning assumes the supplied evidence still reflects the current state of the decision being evaluated.",
  ];
  if (hasNumbers) {
    assumptions.push(
      "Numeric figures in the evidence are treated as assumptions rather than confirmed facts, because no independently corroborating source was found."
    );
  }
  return assumptions;
}

function deriveStatus({
  verifiedFacts,
  keyRisks,
  evidenceGaps,
  confidence,
}: {
  verifiedFacts: string[];
  keyRisks: string[];
  evidenceGaps: string[];
  confidence: number;
}): RecommendationStatus {
  if (verifiedFacts.length === 0) return "insufficient_evidence";
  if (keyRisks.length >= 2 && verifiedFacts.length === 0) return "reject";
  if (evidenceGaps.length >= 3 || confidence < 0.4) return "wait";
  if (keyRisks.length > 0) return "proceed_with_conditions";
  if (verifiedFacts.length >= 2 && confidence >= 0.55) return "proceed";
  return "proceed_with_conditions";
}

function buildStrategicOptions({
  status,
  evidenceGaps,
  keyRisks,
}: {
  status: RecommendationStatus;
  evidenceGaps: string[];
  keyRisks: string[];
}): StrategicOption[] {
  const options: StrategicOption[] = [
    {
      option: "Proceed as currently planned.",
      rationale:
        status === "proceed"
          ? "The verified evidence and the absence of unresolved risk support proceeding now."
          : "Not currently recommended: the available evidence does not clear the bar for proceeding without conditions.",
      supportingEvidence: [],
    },
  ];

  if (evidenceGaps.length > 0) {
    options.push({
      option: "Close the identified evidence gaps before proceeding.",
      rationale: `${evidenceGaps.length} gap(s) were identified that materially affect confidence in this decision.`,
      supportingEvidence: evidenceGaps.slice(0, 5),
    });
  }
  if (keyRisks.length > 0) {
    options.push({
      option: "Address the identified risks before proceeding.",
      rationale: `${keyRisks.length} risk statement(s) were identified in the existing evidence.`,
      supportingEvidence: keyRisks.slice(0, 5),
    });
  }

  options.push({
    option: "Do not proceed with the current information.",
    rationale:
      status === "reject" || status === "insufficient_evidence"
        ? "The available evidence does not support proceeding, or there is not enough evidence to decide responsibly."
        : "Not currently recommended: the available evidence does not point toward rejection.",
    supportingEvidence: [],
  });

  return options;
}

function pickRecommendedOption(
  options: StrategicOption[],
  status: RecommendationStatus
): { recommended: StrategicOption | null; rejected: StrategicOption[] } {
  const byLabel = (label: string) => options.find((item) => item.option === label) || null;

  const recommended =
    status === "proceed"
      ? byLabel("Proceed as currently planned.")
      : status === "proceed_with_conditions"
        ? byLabel("Address the identified risks before proceeding.") ||
          byLabel("Close the identified evidence gaps before proceeding.") ||
          byLabel("Proceed as currently planned.")
        : status === "wait"
          ? byLabel("Close the identified evidence gaps before proceeding.")
          : byLabel("Do not proceed with the current information.");

  const rejected = options.filter((item) => item !== recommended);
  return { recommended, rejected };
}

export function runExpertReasoningEngine(input: ExpertReasoningInput): ExpertReasoningResult {
  const {
    prompt = "",
    documentIntelligence,
    decisionPlan,
    marketResearchEvidence = [],
    businessPlanEvidence = [],
    financialEvidence = [],
    userProvidedFacts = [],
  } = input;

  const evidenceTrace: string[] = [];

  const verifiedFacts = unique([
    ...(documentIntelligence?.evidence || []),
    ...marketResearchEvidence,
    ...businessPlanEvidence,
    ...financialEvidence,
    ...userProvidedFacts,
  ]);
  evidenceTrace.push(
    `verifiedFacts combines documentIntelligence.evidence (${(documentIntelligence?.evidence || []).length} item(s)), marketResearchEvidence (${marketResearchEvidence.length}), businessPlanEvidence (${businessPlanEvidence.length}), financialEvidence (${financialEvidence.length}), and userProvidedFacts (${userProvidedFacts.length}).`
  );

  const directionalSignals = unique(
    documentIntelligence
      ? [...documentIntelligence.decisions, ...documentIntelligence.obligations]
      : []
  );
  evidenceTrace.push(
    `directionalSignals is sourced from documentIntelligence.decisions/obligations (${directionalSignals.length} item(s)).`
  );

  const keyRisks = unique([...(documentIntelligence?.risks || [])]);

  const evidenceGaps = unique([
    ...(decisionPlan?.missingEvidence || []),
    ...(documentIntelligence?.missingInformation || []),
  ]);
  evidenceTrace.push(
    `evidenceGaps combines decisionPlan.missingEvidence (${(decisionPlan?.missingEvidence || []).length}) and documentIntelligence.missingInformation (${(documentIntelligence?.missingInformation || []).length}).`
  );

  const combinedEvidenceText = [
    prompt,
    documentIntelligence?.documentPurpose || "",
    ...(documentIntelligence?.importantSections || []),
    ...verifiedFacts,
    ...directionalSignals,
    ...keyRisks,
  ].join(" ");

  const detectedBusinessContext = detectBusinessContext({ decisionPlan, combinedEvidenceText });
  evidenceTrace.push(
    decisionPlan
      ? `detectedBusinessContext ("${detectedBusinessContext}") is based on decisionPlan.detectedDomain ("${decisionPlan.detectedDomain}") and keyword classification of the combined evidence text.`
      : `detectedBusinessContext ("${detectedBusinessContext}") is based on keyword classification of the combined evidence text; no decisionPlan was supplied.`
  );

  if (detectedBusinessContext === "unsupported") {
    return {
      detectedBusinessContext,
      decisionObjective: decisionPlan?.detectedIntent || "",
      verifiedFacts: [],
      directionalSignals: [],
      assumptions: [],
      keyBusinessQuestions: [],
      marketReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      competitorReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      financialReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      businessModelReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      pricingReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      goToMarketReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      riskReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      investmentReasoning: { applicable: false, summary: "", supportingEvidence: [] },
      strategicOptions: [],
      recommendedOption: null,
      rejectedOptions: [],
      recommendationStatus: "insufficient_evidence",
      evidenceGaps: [],
      confidence: 0,
      confidenceExplanation:
        "No confidence is assigned because this input is not one of the supported business reasoning contexts.",
      evidenceTrace: [
        ...evidenceTrace,
        "No further fields are populated: this input is outside the supported business reasoning contexts (rule 6), so no business recommendation is produced.",
      ],
    };
  }

  const evidencePoolForSections = [...verifiedFacts, ...directionalSignals];
  const marketReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.market,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const competitorReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.competitor,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const financialReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.financial,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const businessModelReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.businessModel,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const pricingReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.pricing,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const goToMarketReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.goToMarket,
    evidencePoolForSections,
    combinedEvidenceText
  );
  const riskReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.risk,
    [...evidencePoolForSections, ...keyRisks],
    combinedEvidenceText
  );
  const investmentReasoning = buildReasoningSection(
    REASONING_SECTION_PATTERNS.investment,
    evidencePoolForSections,
    combinedEvidenceText
  );

  const keyBusinessQuestions = evidenceGaps
    .slice(0, 10)
    .map((gap) => `What verifiable evidence exists for: ${gap}`);

  const confidence = decisionPlan?.confidence ?? 0;
  evidenceTrace.push(
    decisionPlan
      ? `confidence (${confidence}) is a direct pass-through of decisionPlan.confidence.`
      : `confidence (${confidence}) defaults to 0 because no decisionPlan was supplied.`
  );

  const status = deriveStatus({ verifiedFacts, keyRisks, evidenceGaps, confidence });
  evidenceTrace.push(
    `recommendationStatus ("${status}") and recommendedOption are derived from verifiedFacts (${verifiedFacts.length}), keyRisks (${keyRisks.length}), evidenceGaps (${evidenceGaps.length}), and confidence (${confidence}).`
  );

  const strategicOptions = buildStrategicOptions({ status, evidenceGaps, keyRisks });
  const { recommended, rejected } = pickRecommendedOption(strategicOptions, status);

  const assumptions = buildAssumptions((documentIntelligence?.entities.numbers.length || 0) > 0);

  return {
    detectedBusinessContext,
    decisionObjective:
      decisionPlan?.detectedIntent || (prompt ? prompt.slice(0, 400) : ""),
    verifiedFacts,
    directionalSignals,
    assumptions,
    keyBusinessQuestions,
    marketReasoning,
    competitorReasoning,
    financialReasoning,
    businessModelReasoning,
    pricingReasoning,
    goToMarketReasoning,
    riskReasoning,
    investmentReasoning,
    strategicOptions,
    recommendedOption: recommended,
    rejectedOptions: rejected,
    recommendationStatus: status,
    evidenceGaps,
    confidence,
    confidenceExplanation: decisionPlan
      ? "This is decisionPlan.confidence, passed through without recalculation."
      : "No decision plan was supplied, so no confidence basis exists.",
    evidenceTrace,
  };
}
