import { z } from "zod";
import type { DocumentDomain, UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { ExpertReasoningResult } from "./expert-reasoning-engine.ts";

// ZERINIX Decision Intent Engine v1. Runs immediately after the Expert
// Reasoning Engine. ZERINIX is not a chatbot and not a report generator;
// this engine's only job is to determine WHAT business decision the
// user is actually trying to make, before any analysis is generated.
// Like every earlier layer, it is a deterministic, pattern-based
// derivation (not a model call): every field is either a direct
// pass-through of an already-extracted fact, a fixed generic checklist
// keyed only by decision category (never a company-specific claim), or
// a keyword match against text the user or an earlier layer actually
// produced. Nothing here is invented, and nothing here generates a
// report, touches PDF/report generation, billing, or UI.

export const decisionCategoryValues = [
  "start_business",
  "validate_business",
  "enter_market",
  "expand_market",
  "launch_product",
  "pricing",
  "fundraising",
  "investment",
  "acquisition",
  "partnership",
  "hiring",
  "budgeting",
  "financial_review",
  "company_analysis",
  "competitor_analysis",
  "growth_strategy",
  "operational_decision",
  "strategic_decision",
  "risk_assessment",
] as const;

export type DecisionCategory = (typeof decisionCategoryValues)[number];

export const urgencyValues = ["immediate", "near_term", "long_term", "unspecified"] as const;
export type Urgency = (typeof urgencyValues)[number];

export const decisionComplexityValues = ["low", "medium", "high"] as const;
export type DecisionComplexity = (typeof decisionComplexityValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

const detectedDecisionSchema = z
  .object({
    category: z.enum(decisionCategoryValues),
    statement: shortString(400),
    confidence: z.number().min(0).max(1),
    supportingEvidence: z.array(shortString(400)).max(10),
  })
  .strict();

export type DetectedDecision = z.infer<typeof detectedDecisionSchema>;

export const decisionIntentResultSchema = z
  .object({
    primaryDecision: detectedDecisionSchema.nullable(),
    secondaryDecision: detectedDecisionSchema.nullable(),
    detectedBusinessGoal: z.string().trim().max(400),
    urgency: z.enum(urgencyValues),
    confidence: z.number().min(0).max(1),
    decisionCategory: z.enum(decisionCategoryValues).nullable(),
    stakeholders: z.array(shortString(200)).max(30),
    requiredEvidence: z.array(shortString(300)).max(20),
    missingEvidence: z.array(shortString(300)).max(20),
    criticalUnknowns: z.array(shortString(300)).max(20),
    decisionComplexity: z.enum(decisionComplexityValues),
    recommendedAnalysisPath: z.array(shortString(300)).max(10),
    recommendedBusinessModules: z.array(shortString(100)).max(12),
    reasoningSummary: z.array(shortString(500)).max(10),
    evidenceTrace: z.array(shortString(500)).max(30),
    cannotDetermineReason: z.string().trim().max(500).nullable(),
  })
  .strict();

export type DecisionIntentResult = z.infer<typeof decisionIntentResultSchema>;

export type DecisionIntentInput = {
  userRequest?: string;
  conversationContext?: readonly string[];
  documentIntelligence?: UniversalDocumentIntelligence;
  expertReasoningResult?: ExpertReasoningResult;
  availableEvidence?: readonly string[];
};

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

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

// Each pattern is checked only against text that actually came from the
// user's request, the conversation, the document, or verified/directional
// evidence -- never invented. Overlapping vocabulary (e.g. "pricing
// strategy" vs. "strategic decision") is resolved by scoring distinct
// hits and ranking, not by a single first-match short-circuit.
const CATEGORY_SIGNALS: Record<DecisionCategory, RegExp> = {
  start_business:
    /\b(start(?:ing)? a business|start(?:ing)? my own company|found(?:ing)? a company|new venture|new startup)\b/gi,
  validate_business:
    /\b(validate|validation|is this a good (?:business )?idea|viable business idea|business idea)\b/gi,
  enter_market:
    /\b(enter(?:ing)? (?:the|a|this) market|market entry|expand(?:ing)? into (?:a|the|this) market)\b/gi,
  expand_market:
    /\b(expand(?:ing)? (?:our|the|my) market|market expansion|geographic expansion|scale into new markets)\b/gi,
  launch_product:
    /\b(launch(?:ing)? (?:a|the|our|my) product|product launch|new product launch)\b/gi,
  pricing:
    /\b(pricing strategy|price point|how much (?:to|should we) charge|subscription price|price sensitivity)\b/gi,
  fundraising:
    /\b(fundrais\w*|raise capital|raise funding|seed round|series [abc] round|raise money)\b/gi,
  investment:
    /\b(should we invest|investment (?:decision|opportunity)|is this a good investment|invest in (?:this|the))\b/gi,
  acquisition:
    /\b(acquisition|acquire (?:the|this) company|merger|buy(?:ing)? (?:the|this) company|\bm&a\b)\b/gi,
  partnership:
    /\b(partnership|strategic partner|joint venture|collaborat(?:e|ion) with)\b/gi,
  hiring:
    /\b(hir(?:e|ing)|recruit(?:ing|ment)?|new hire|should we hire|headcount)\b/gi,
  budgeting:
    /\b(budget(?:ing)?|allocate (?:funds|budget)|spending plan)\b/gi,
  financial_review:
    /\b(financial review|financial health|review (?:our|the) financials|financial statement review)\b/gi,
  company_analysis:
    /\b(company analysis|company overview|analy[sz]e (?:the|this) company|due diligence on (?:the|this) company)\b/gi,
  competitor_analysis:
    /\b(competitor analysis|competitive analysis|analy[sz]e (?:our|the) competitors|competitor research)\b/gi,
  growth_strategy:
    /\b(growth strategy|scaling strategy|how (?:to|do we) grow|growth plan)\b/gi,
  operational_decision:
    /\b(operational decision|operations decision|process improvement|operational efficiency)\b/gi,
  strategic_decision:
    /\b(strategic decision|strategic direction|strategic plan(?:ning)?)\b/gi,
  risk_assessment:
    /\b(risk assessment|assess(?:ing)? (?:the )?risk|risk analysis|evaluate risk)\b/gi,
};

const MIN_CONFIDENT_DECISION_CONFIDENCE = 0.5;

function confidenceFromHits(userHits: number, contextHits: number) {
  const weighted = userHits * 2 + contextHits;
  if (weighted === 0) return 0;
  return Math.min(0.5 + weighted * 0.12, 0.97);
}

function detectDecisionsRankedByConfidence(
  userRequest: string,
  broaderContext: string
): DetectedDecision[] {
  const candidates: DetectedDecision[] = [];

  for (const category of decisionCategoryValues) {
    const pattern = CATEGORY_SIGNALS[category];
    const userMatches = userRequest.match(pattern) || [];
    const contextMatches = broaderContext.match(pattern) || [];
    if (userMatches.length === 0 && contextMatches.length === 0) continue;

    const userHits = new Set(userMatches.map((m) => m.toLowerCase())).size;
    const contextHits = new Set(contextMatches.map((m) => m.toLowerCase())).size;
    const confidence = confidenceFromHits(userHits, contextHits);
    if (confidence < MIN_CONFIDENT_DECISION_CONFIDENCE) continue;

    const supportingEvidence = unique([...userMatches, ...contextMatches]).slice(0, 10);
    candidates.push({
      category,
      statement:
        userMatches.length > 0
          ? `The user's request indicates a "${category}" decision (matched: ${supportingEvidence.slice(0, 3).join(", ")}).`
          : `The available context indicates a "${category}" decision (matched: ${supportingEvidence.slice(0, 3).join(", ")}).`,
      confidence,
      supportingEvidence,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

const URGENCY_SIGNALS: Record<Exclude<Urgency, "unspecified">, RegExp> = {
  immediate: /\b(urgent(?:ly)?|asap|immediately|right away|this week|today|critical deadline)\b/i,
  near_term: /\b(this month|this quarter|in the next few weeks|short[- ]term|soon)\b/i,
  long_term: /\b(long[- ]term|next year|eventually|no rush|down the road)\b/i,
};

function detectUrgency(text: string): Urgency {
  if (URGENCY_SIGNALS.immediate.test(text)) return "immediate";
  if (URGENCY_SIGNALS.near_term.test(text)) return "near_term";
  if (URGENCY_SIGNALS.long_term.test(text)) return "long_term";
  return "unspecified";
}

const STAKEHOLDER_ROLE_PATTERN =
  /\b(co-?founders?|investors?|the board|shareholders?|customers?|partners?|employees?|management team|executive team|advisors?)\b/gi;

function detectStakeholders(
  documentIntelligence: UniversalDocumentIntelligence | undefined,
  combinedText: string
) {
  const roleMentions = unique(
    (combinedText.match(STAKEHOLDER_ROLE_PATTERN) || []).map((match) => match.toLowerCase())
  );
  return unique([
    ...(documentIntelligence?.entities.people || []),
    ...(documentIntelligence?.entities.organizations || []),
    ...roleMentions,
  ]).slice(0, 30);
}

// A static, category-keyed checklist of the KIND of evidence a
// responsible decision in that category typically needs -- this is a
// procedural checklist, not a claim about any specific company, so
// listing it is not "fabricating business context."
const REQUIRED_EVIDENCE_BY_CATEGORY: Record<DecisionCategory, string[]> = {
  start_business: [
    "a clearly defined business concept",
    "target customer definition",
    "an initial go-to-market plan",
  ],
  validate_business: [
    "evidence of customer demand",
    "target market definition",
    "competitive landscape overview",
  ],
  enter_market: [
    "target market definition",
    "market size or demand evidence",
    "competitive landscape in the target market",
    "regulatory or entry barriers",
  ],
  expand_market: [
    "performance data from the current market",
    "target expansion market definition",
    "resource or capacity assessment for expansion",
  ],
  launch_product: [
    "product readiness evidence",
    "target customer definition",
    "a go-to-market plan",
  ],
  pricing: ["cost structure", "competitor pricing data", "customer willingness-to-pay evidence"],
  fundraising: [
    "financial statements",
    "a use-of-funds plan",
    "a valuation basis",
    "cap table information",
  ],
  investment: [
    "target financials",
    "a valuation basis",
    "an expected-return basis",
  ],
  acquisition: ["target company financials", "a valuation basis", "due diligence findings"],
  partnership: [
    "partner capability or track record evidence",
    "proposed partnership terms",
    "mutual value proposition evidence",
  ],
  hiring: ["role definition and business need", "budget for the role", "hiring timeline"],
  budgeting: ["current spending baseline", "revenue or funding basis", "budget priorities"],
  financial_review: ["financial statements", "cash flow data", "reporting period and currency"],
  company_analysis: [
    "company financials or operations data",
    "organizational structure",
    "company performance history",
  ],
  competitor_analysis: [
    "an identified competitor set",
    "competitor positioning or pricing data",
    "market share or performance data",
  ],
  growth_strategy: [
    "current growth metrics",
    "growth channel performance data",
    "resource or capacity assessment",
  ],
  operational_decision: [
    "current process or operational baseline",
    "cost or efficiency data",
    "operational risk factors",
  ],
  strategic_decision: [
    "a strategic objective definition",
    "resource and capability assessment",
    "alternative options considered",
  ],
  risk_assessment: [
    "identified risk factors",
    "risk likelihood/impact evidence",
    "existing mitigations",
  ],
};

const REASONING_SECTION_TO_MODULE: Array<
  [key: keyof ExpertReasoningResult, module: string]
> = [
  ["marketReasoning", "Market Intelligence"],
  ["competitorReasoning", "Competitor Intelligence"],
  ["financialReasoning", "Financial Intelligence"],
  ["businessModelReasoning", "Business Model Intelligence"],
  ["pricingReasoning", "Pricing Intelligence"],
  ["goToMarketReasoning", "Go-To-Market Intelligence"],
  ["riskReasoning", "Risk Intelligence"],
  ["investmentReasoning", "Investment Intelligence"],
];

function evidenceCovers(evidencePool: readonly string[], topic: string) {
  const topicWords = topic
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3 && !["with", "from", "that", "this", "basis"].includes(word));
  if (topicWords.length === 0) return false;
  return evidencePool.some((item) => {
    const lower = item.toLowerCase();
    return topicWords.some((word) => lower.includes(word));
  });
}

function cannotDetermineResult(
  reason: string,
  evidenceTrace: string[]
): DecisionIntentResult {
  return {
    primaryDecision: null,
    secondaryDecision: null,
    detectedBusinessGoal: "",
    urgency: "unspecified",
    confidence: 0,
    decisionCategory: null,
    stakeholders: [],
    requiredEvidence: [],
    missingEvidence: [],
    criticalUnknowns: [],
    decisionComplexity: "low",
    recommendedAnalysisPath: [],
    recommendedBusinessModules: [],
    reasoningSummary: [],
    evidenceTrace,
    cannotDetermineReason: reason,
  };
}

export function runDecisionIntentEngine(input: DecisionIntentInput): DecisionIntentResult {
  const {
    userRequest = "",
    conversationContext = [],
    documentIntelligence,
    expertReasoningResult,
    availableEvidence = [],
  } = input;

  const evidenceTrace: string[] = [];

  // A confirmed non-business document domain (an actual uploaded
  // document that layer 4 classified as Legal, Medical, etc.) hard-blocks
  // regardless of what the user asked -- rule "unsupported document
  // categories must not receive fabricated business recommendations."
  // This is deliberately narrower than trusting
  // expertReasoningResult.detectedBusinessContext === "unsupported"
  // outright: that value also covers "no strong signal was found yet,"
  // which must NOT block this engine from trying its own, more specific
  // decision-category classification against the user's own words --
  // the same reasoning that fixed the equivalent bug in
  // expert-reasoning-engine.ts's own domain gate.
  if (documentIntelligence && HARD_UNSUPPORTED_DOCUMENT_DOMAINS.has(documentIntelligence.documentDomain)) {
    evidenceTrace.push(
      `documentIntelligence.documentDomain is "${documentIntelligence.documentDomain}", which is outside the supported business decision categories.`
    );
    return cannotDetermineResult(
      `The document domain ("${documentIntelligence.documentDomain}") is outside the supported business decision categories, so no decision intent can be determined without fabricating one.`,
      evidenceTrace
    );
  }

  const broaderContext = [
    ...conversationContext,
    documentIntelligence?.documentPurpose || "",
    ...(documentIntelligence?.importantSections || []),
    ...(expertReasoningResult?.verifiedFacts || []),
    ...(expertReasoningResult?.directionalSignals || []),
    ...availableEvidence,
  ].join(" ");

  const ranked = detectDecisionsRankedByConfidence(userRequest, broaderContext);
  evidenceTrace.push(
    `${ranked.length} candidate decision categor${ranked.length === 1 ? "y" : "ies"} matched keyword signals in the user request and/or broader context.`
  );

  if (ranked.length === 0) {
    return cannotDetermineResult(
      "No decision category could be confidently matched from the user's request, the conversation context, the document, or the expert reasoning result. Ask the user what decision this analysis should support rather than guessing.",
      evidenceTrace
    );
  }

  const [primaryDecision, secondaryDecision = null] = ranked;
  evidenceTrace.push(
    `primaryDecision ("${primaryDecision.category}", confidence ${primaryDecision.confidence}) is the highest-ranked candidate; ${secondaryDecision ? `secondaryDecision ("${secondaryDecision.category}", confidence ${secondaryDecision.confidence}) is the next-ranked candidate.` : "no second candidate met the confidence threshold."}`
  );

  const combinedText = `${userRequest} ${broaderContext}`;
  const urgency = detectUrgency(combinedText);
  evidenceTrace.push(
    urgency === "unspecified"
      ? "urgency is \"unspecified\" because no explicit urgency language was found in the user request or context."
      : `urgency ("${urgency}") is based on explicit language matched in the user request or context.`
  );

  const stakeholders = detectStakeholders(documentIntelligence, combinedText);
  evidenceTrace.push(
    `stakeholders combines documentIntelligence.entities.people/organizations and explicit role mentions in the combined text (${stakeholders.length} item(s)).`
  );

  const requiredEvidence = REQUIRED_EVIDENCE_BY_CATEGORY[primaryDecision.category];
  const evidencePool = unique([
    ...(expertReasoningResult?.verifiedFacts || []),
    ...(expertReasoningResult?.directionalSignals || []),
    ...availableEvidence,
    ...(documentIntelligence?.evidence || []),
  ]);
  const missingEvidence = requiredEvidence.filter((topic) => !evidenceCovers(evidencePool, topic));
  const upstreamGaps = unique([
    ...(expertReasoningResult?.evidenceGaps || []),
    ...(documentIntelligence?.missingInformation || []),
  ]);
  const combinedMissingEvidence = unique([...missingEvidence, ...upstreamGaps]);
  evidenceTrace.push(
    `missingEvidence combines requiredEvidence items not found in the available evidence pool (${missingEvidence.length}) with upstream evidenceGaps/missingInformation (${upstreamGaps.length}).`
  );

  const highStakesCategory = new Set<DecisionCategory>([
    "fundraising",
    "investment",
    "acquisition",
    "financial_review",
  ]);
  const criticalUnknowns = highStakesCategory.has(primaryDecision.category)
    ? combinedMissingEvidence
    : combinedMissingEvidence.slice(0, Math.max(1, Math.ceil(combinedMissingEvidence.length / 2)));

  const complexity: DecisionComplexity =
    combinedMissingEvidence.length >= 3 || (secondaryDecision !== null && stakeholders.length >= 3)
      ? "high"
      : combinedMissingEvidence.length >= 1 || secondaryDecision !== null
        ? "medium"
        : "low";

  const recommendedBusinessModules = REASONING_SECTION_TO_MODULE.filter(([key]) => {
    const section = expertReasoningResult?.[key];
    return (
      section &&
      typeof section === "object" &&
      "applicable" in section &&
      (section as { applicable: boolean }).applicable
    );
  }).map(([, businessModule]) => businessModule);

  const recommendedAnalysisPath: string[] = [];
  if (combinedMissingEvidence.length > 0) {
    recommendedAnalysisPath.push(
      `Close ${combinedMissingEvidence.length} missing evidence item(s) before proceeding.`
    );
  }
  for (const businessModule of recommendedBusinessModules) {
    recommendedAnalysisPath.push(`Run ${businessModule}.`);
  }
  if (expertReasoningResult?.recommendedOption) {
    recommendedAnalysisPath.push(expertReasoningResult.recommendedOption.option);
  }

  const reasoningSummary = [
    `Primary decision detected as "${primaryDecision.category}" with confidence ${primaryDecision.confidence}, based on ${primaryDecision.supportingEvidence.length} matched signal(s).`,
    `${combinedMissingEvidence.length} evidence gap(s) remain against the standard checklist for this decision category.`,
  ];
  if (secondaryDecision) {
    reasoningSummary.push(
      `A secondary decision candidate, "${secondaryDecision.category}", was also detected at lower confidence (${secondaryDecision.confidence}).`
    );
  }

  const confidence = Math.round(
    (primaryDecision.confidence * (expertReasoningResult ? 0.7 : 1) +
      (expertReasoningResult ? expertReasoningResult.confidence * 0.3 : 0)) *
      100
  ) / 100;
  evidenceTrace.push(
    expertReasoningResult
      ? `confidence (${confidence}) combines primaryDecision.confidence and expertReasoningResult.confidence.`
      : `confidence (${confidence}) is primaryDecision.confidence; no expertReasoningResult was supplied.`
  );

  return {
    primaryDecision,
    secondaryDecision,
    detectedBusinessGoal:
      expertReasoningResult?.decisionObjective || (userRequest ? userRequest.slice(0, 400) : ""),
    urgency,
    confidence,
    decisionCategory: primaryDecision.category,
    stakeholders,
    requiredEvidence,
    missingEvidence: combinedMissingEvidence,
    criticalUnknowns,
    decisionComplexity: complexity,
    recommendedAnalysisPath: recommendedAnalysisPath.slice(0, 10),
    recommendedBusinessModules,
    reasoningSummary,
    evidenceTrace,
    cannotDetermineReason: null,
  };
}
