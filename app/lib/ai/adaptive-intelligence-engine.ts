import { z } from "zod";
import type { DocumentClassificationAsset } from "./document-intelligence.ts";
import type { DocumentDomain, UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { DecisionCategory, DecisionIntentResult } from "./decision-intent-engine.ts";

// ZERINIX Adaptive Intelligence Engine v1.
//
// ZERINIX must stop behaving like a report generator: it must decide HOW
// to think before it thinks. This engine detects the document type, the
// user's intent, and their decision objective, then selects one of nine
// domain-specific reasoning profiles -- never a single generic reasoning
// process applied to every request. Two requests classified into
// different domains must come back with genuinely different
// reasoningApproach/reasoningSteps/keyQuestions/applicableFrameworks/
// prohibitedReasoningPatterns; this is enforced by construction (each
// domain's profile is hand-authored, not templated) and proven in tests.
//
// Scope (v1, standalone): this is a SELECTION + PROFILE engine. It does
// not itself run any of the nine downstream intelligence pipelines --
// deciding which pipeline applies is exactly the deliverable asked for
// here; actually executing that pipeline is a separate, already-existing
// connector's job. This module makes no network/AI calls, is not wired
// into any route, and does not modify report generation, PDF generation,
// billing, or UI.
//
// Reuse, not re-detection: following the same convention already used by
// decision-intent-engine.ts and decision-strategy-engine.ts, this engine
// accepts already-computed
// UniversalDocumentIntelligence / DecisionIntentResult as optional typed
// inputs and trusts them completely when supplied, rather than
// re-deriving a classification a caller already computed. When they are
// not supplied (this engine has no caller yet), it falls back to its own
// lightweight, deterministic keyword detection over the raw prompt/
// attachment text -- at correspondingly lower confidence, and never
// silently promoted to a false-confident guess.
//
// "No generic reasoning" is enforced structurally: when neither the
// document type nor the intent signal can identify one of the nine
// domains, `selectedDomain` and `reasoningProfile` are both null and
// `cannotDetermineReason` explains why -- this engine will never default
// to a catch-all domain the way a lower-stakes planner safely could,
// because guessing wrong here (e.g. applying business reasoning to an
// actual medical report) is unsafe, not just imprecise.

export const adaptiveIntelligenceDomainValues = [
  "business_intelligence",
  "market_intelligence",
  "legal_intelligence",
  "financial_intelligence",
  "property_intelligence",
  "medical_intelligence",
  "engineering_intelligence",
  "hr_intelligence",
  "contract_intelligence",
] as const;

export type AdaptiveIntelligenceDomain = (typeof adaptiveIntelligenceDomainValues)[number];

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const reasoningProfileSchema = z
  .object({
    domain: z.enum(adaptiveIntelligenceDomainValues),
    reasoningApproach: shortString(300),
    reasoningSteps: z.array(shortString(220)).min(4).max(8),
    keyQuestions: z.array(shortString(220)).min(3).max(6),
    applicableFrameworks: z.array(shortString(120)).min(2).max(6),
    prohibitedReasoningPatterns: z.array(shortString(220)).min(2).max(5),
  })
  .strict();

export type ReasoningProfile = z.infer<typeof reasoningProfileSchema>;

export const confidenceProfileSchema = z
  .object({
    documentTypeConfidence: z.number().min(0).max(1),
    intentConfidence: z.number().min(0).max(1),
    decisionObjectiveConfidence: z.number().min(0).max(1),
    overallConfidence: z.number().min(0).max(1),
  })
  .strict();

export type ConfidenceProfile = z.infer<typeof confidenceProfileSchema>;

export const adaptiveIntelligenceResultSchema = z
  .object({
    selectedDomain: z.enum(adaptiveIntelligenceDomainValues).nullable(),
    cannotDetermineReason: z.string().trim().max(500).nullable(),
    detectedDocumentType: z.string().trim().max(160).nullable(),
    detectedIntent: z.string().trim().max(160).nullable(),
    detectedDecisionObjective: z.string().trim().max(400).nullable(),
    reasoningProfile: reasoningProfileSchema.nullable(),
    confidenceProfile: confidenceProfileSchema,
    evidenceRequirements: z.array(shortString(300)).min(1).max(10),
    evidenceTrace: z.array(shortString(500)).max(20),
  })
  .strict();

export type AdaptiveIntelligenceResult = z.infer<typeof adaptiveIntelligenceResultSchema>;

export type AdaptiveIntelligenceInput = {
  prompt?: string;
  attachments?: readonly DocumentClassificationAsset[];
  // Optional, already-computed upstream results. When supplied, trusted
  // completely instead of re-derived (see file header).
  documentIntelligence?: UniversalDocumentIntelligence;
  decisionIntentResult?: DecisionIntentResult;
};

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

// ---------------------------------------------------------------------
// Document-type detection
// ---------------------------------------------------------------------

const DOCUMENT_DOMAIN_TO_ADAPTIVE_DOMAIN: Partial<Record<DocumentDomain, AdaptiveIntelligenceDomain>> = {
  Legal: "legal_intelligence",
  Contract: "contract_intelligence",
  Financial: "financial_intelligence",
  Business: "business_intelligence",
  Medical: "medical_intelligence",
  Engineering: "engineering_intelligence",
  "Real Estate": "property_intelligence",
  HR: "hr_intelligence",
};

// document-intelligence.ts / universal-document-intelligence.ts have no
// dedicated "market research" category -- Business covers both. This
// engine's own refinement distinguishes them, since business_intelligence
// and market_intelligence require genuinely different reasoning (venture
// validation vs. market-structure analysis).
const MARKET_RESEARCH_PATTERN =
  /\b(market research|market study|competitive landscape|industry report|market sizing study|tam sam som analysis|market analysis report)\b/;

function refineBusinessDomain(text: string): AdaptiveIntelligenceDomain {
  return MARKET_RESEARCH_PATTERN.test(normalizeForMatch(text)) ? "market_intelligence" : "business_intelligence";
}

const OWN_DOCUMENT_TYPE_PATTERNS: Record<AdaptiveIntelligenceDomain, RegExp> = {
  business_intelligence:
    /\b(business idea|startup|business plan|revenue model|go-to-market|go to market|business model)\b/g,
  market_intelligence: MARKET_RESEARCH_PATTERN,
  legal_intelligence:
    /\b(lawsuit|litigation|plaintiff|defendant|court of appeal|supreme court|statute|precedent|attorney|verdict|docket)\b/g,
  financial_intelligence:
    /\b(financial statement|balance sheet|income statement|cash flow statement|financial ratio|ebitda|valuation multiple)\b/g,
  property_intelligence:
    /\b(real estate|property listing|zoning|rental yield|comparable sales|parcel|cap rate|tenant|landlord)\b/g,
  medical_intelligence:
    /\b(patient|clinical trial|diagnosis|medical report|treatment plan|contraindication|medical guideline|symptom)\b/g,
  engineering_intelligence:
    /\b(engineering drawing|structural analysis|load calculation|material specification|safety factor|blueprint|schematic|asme|eurocode)\b/g,
  hr_intelligence:
    /\b(employee|hr policy|performance review|job offer letter|termination|payroll|recruitment|onboarding|hr document)\b/g,
  contract_intelligence:
    /\b(contract|agreement|clauses?|party a|party b|terms and conditions|indemnification|breach of contract)\b/g,
};

type DomainSignal = {
  domain: AdaptiveIntelligenceDomain | null;
  confidence: number;
};

function detectOwnDocumentType(text: string): DomainSignal {
  const normalized = normalizeForMatch(text);
  let bestDomain: AdaptiveIntelligenceDomain | null = null;
  let bestHits = 0;

  for (const domain of adaptiveIntelligenceDomainValues) {
    const matches = normalized.match(OWN_DOCUMENT_TYPE_PATTERNS[domain]) || [];
    const uniqueHits = new Set(matches).size;
    if (uniqueHits > bestHits) {
      bestHits = uniqueHits;
      bestDomain = domain;
    }
  }

  if (!bestDomain || bestHits === 0) {
    return { domain: null, confidence: 0 };
  }

  const refined = bestDomain === "business_intelligence" ? refineBusinessDomain(text) : bestDomain;
  return { domain: refined, confidence: Math.min(0.5 + bestHits * 0.15, 0.9) };
}

function detectDocumentType(input: {
  prompt: string;
  attachments: readonly DocumentClassificationAsset[];
  documentIntelligence?: UniversalDocumentIntelligence;
}): DomainSignal & { label: string | null; source: "provided" | "detected" | "none" } {
  if (input.documentIntelligence) {
    const mapped = DOCUMENT_DOMAIN_TO_ADAPTIVE_DOMAIN[input.documentIntelligence.documentDomain];
    if (mapped) {
      const domain = mapped === "business_intelligence" ? refineBusinessDomain(input.prompt) : mapped;
      return {
        domain,
        confidence: input.documentIntelligence.domainConfidence,
        label: ADAPTIVE_DOMAIN_LABELS[domain],
        source: "provided",
      };
    }
  }

  const combinedText = [input.prompt, ...input.attachments.map((asset) => asset.textContent || "")].join("\n");
  const own = detectOwnDocumentType(combinedText);
  return {
    domain: own.domain,
    confidence: own.confidence,
    label: own.domain ? ADAPTIVE_DOMAIN_LABELS[own.domain] : null,
    source: own.domain ? "detected" : "none",
  };
}

// ---------------------------------------------------------------------
// Intent / decision-objective detection
// ---------------------------------------------------------------------

const DECISION_CATEGORY_TO_DOMAIN: Record<DecisionCategory, AdaptiveIntelligenceDomain> = {
  start_business: "business_intelligence",
  validate_business: "business_intelligence",
  enter_market: "market_intelligence",
  expand_market: "market_intelligence",
  launch_product: "business_intelligence",
  pricing: "business_intelligence",
  fundraising: "business_intelligence",
  investment: "financial_intelligence",
  acquisition: "financial_intelligence",
  partnership: "contract_intelligence",
  hiring: "hr_intelligence",
  budgeting: "financial_intelligence",
  financial_review: "financial_intelligence",
  company_analysis: "business_intelligence",
  competitor_analysis: "market_intelligence",
  growth_strategy: "business_intelligence",
  operational_decision: "business_intelligence",
  strategic_decision: "business_intelligence",
  risk_assessment: "business_intelligence",
};

const OWN_INTENT_PATTERNS: Record<string, RegExp> = {
  validate: /\b(validate|is this viable|worth pursuing|should we do this)\b/,
  analyze: /\b(analyz|assess|evaluate)\b/,
  decide: /\b(decide|decision|should we|go or no.go)\b/,
  review: /\b(review|check|audit)\b/,
  compare: /\b(compare|versus|vs\.?|benchmark against)\b/,
  diagnose: /\b(diagnos|what is wrong|troubleshoot)\b/,
  comply: /\b(complian|comply|is this legal|is this allowed)\b/,
};

type IntentSignal = {
  domain: AdaptiveIntelligenceDomain | null;
  intentLabel: string | null;
  intentConfidence: number;
  decisionObjective: string | null;
  decisionObjectiveConfidence: number;
  source: "provided" | "detected" | "none";
};

function detectIntent(input: { prompt: string; decisionIntentResult?: DecisionIntentResult }): IntentSignal {
  const { decisionIntentResult, prompt } = input;

  if (decisionIntentResult && decisionIntentResult.decisionCategory && decisionIntentResult.primaryDecision) {
    return {
      domain: DECISION_CATEGORY_TO_DOMAIN[decisionIntentResult.decisionCategory],
      intentLabel: decisionIntentResult.decisionCategory,
      intentConfidence: decisionIntentResult.confidence,
      decisionObjective: decisionIntentResult.primaryDecision.statement,
      decisionObjectiveConfidence: decisionIntentResult.primaryDecision.confidence,
      source: "provided",
    };
  }

  const trimmedPrompt = prompt.trim();
  const normalized = normalizeForMatch(trimmedPrompt);
  const matchedLabel =
    Object.entries(OWN_INTENT_PATTERNS).find(([, pattern]) => pattern.test(normalized))?.[0] || null;

  return {
    domain: null,
    intentLabel: matchedLabel,
    intentConfidence: matchedLabel ? 0.5 : 0,
    decisionObjective: trimmedPrompt ? trimmedPrompt.slice(0, 400) : null,
    decisionObjectiveConfidence: trimmedPrompt ? 0.4 : 0,
    source: matchedLabel ? "detected" : "none",
  };
}

// ---------------------------------------------------------------------
// Domain labels, reasoning profiles, and evidence requirements
// ---------------------------------------------------------------------

const ADAPTIVE_DOMAIN_LABELS: Record<AdaptiveIntelligenceDomain, string> = {
  business_intelligence: "Business idea / business plan",
  market_intelligence: "Market research document",
  legal_intelligence: "Legal document",
  financial_intelligence: "Financial statement",
  property_intelligence: "Real estate document",
  medical_intelligence: "Medical report",
  engineering_intelligence: "Engineering drawing / document",
  hr_intelligence: "HR document",
  contract_intelligence: "Contract",
};

const REASONING_PROFILES: Record<AdaptiveIntelligenceDomain, ReasoningProfile> = {
  business_intelligence: {
    domain: "business_intelligence",
    reasoningApproach:
      "Evidence-based venture reasoning: validate demand, differentiate from competitors, and stress-test the business model before recommending action.",
    reasoningSteps: [
      "Identify the core value proposition and target customer segment.",
      "Assess market demand and size using verified or user-provided evidence.",
      "Evaluate the business model's revenue mechanics and unit economics.",
      "Compare against known competitors and substitutes.",
      "Weigh evidence strength against identified risks before forming a recommendation.",
    ],
    keyQuestions: [
      "What problem does this solve, and for whom?",
      "Is there verifiable evidence of demand?",
      "How does this compare to existing alternatives?",
      "What would have to be true for this to fail?",
    ],
    applicableFrameworks: ["TAM/SAM/SOM", "Business Model Canvas", "Porter's Five Forces", "Unit economics (CAC/LTV)"],
    prohibitedReasoningPatterns: [
      "Never present a growth projection as certain rather than assumption-based.",
      "Never recommend 'proceed' without at least one piece of verified demand evidence.",
    ],
  },
  market_intelligence: {
    domain: "market_intelligence",
    reasoningApproach:
      "Market-structure reasoning: size the market, map the competitive landscape, and identify trend-driven opportunity or risk from verified external data.",
    reasoningSteps: [
      "Establish market size, growth rate, and segmentation from verifiable sources.",
      "Map the competitive landscape and market concentration.",
      "Identify macro and industry trends affecting demand.",
      "Assess entry barriers and regulatory context.",
      "Separate verified market data from directional or assumed estimates.",
    ],
    keyQuestions: [
      "How large is the market, and how fast is it growing?",
      "Who are the dominant players, and how concentrated is the market?",
      "What structural trend is driving or limiting this opportunity?",
    ],
    applicableFrameworks: ["TAM/SAM/SOM", "PESTEL analysis", "Competitive landscape mapping"],
    prohibitedReasoningPatterns: [
      "Never state a market-size figure without a cited source or explicit 'estimated' label.",
      "Never conflate a single competitor's numbers with total market size.",
    ],
  },
  legal_intelligence: {
    domain: "legal_intelligence",
    reasoningApproach:
      "Precedent- and statute-based legal reasoning: classify the matter, identify governing law, and reason from cited authority -- never from predicted outcome.",
    reasoningSteps: [
      "Classify the legal matter type and applicable jurisdiction.",
      "Identify the governing statutes, codes, or regulations.",
      "Locate binding or persuasive precedent relevant to the facts.",
      "Separate document facts, party arguments, and court findings.",
      "Identify what evidence or procedural step is still missing.",
    ],
    keyQuestions: [
      "What is the exact legal classification of this matter?",
      "What law or precedent governs it?",
      "What evidence in the record is missing or contested?",
    ],
    applicableFrameworks: ["IRAC (Issue, Rule, Application, Conclusion)", "Precedent comparison"],
    prohibitedReasoningPatterns: [
      "Never predict a case outcome with a numeric probability.",
      "Never state a legal conclusion as fact without citing the statute, code, or ruling it comes from.",
      "Never substitute for licensed legal advice.",
    ],
  },
  financial_intelligence: {
    domain: "financial_intelligence",
    reasoningApproach:
      "Statement-based financial reasoning: validate the numbers, compute standard ratios, and assess solvency and valuation from the actual financial statements.",
    reasoningSteps: [
      "Validate that the core financial statements are present and internally consistent.",
      "Compute liquidity, profitability, and leverage ratios.",
      "Assess cash flow and runway independently of reported net income.",
      "Benchmark performance against industry-standard ratios.",
      "Establish a valuation range using a stated, named methodology.",
    ],
    keyQuestions: [
      "Is the business solvent and generating (or burning) cash at what rate?",
      "How do the ratios compare to industry benchmarks?",
      "What valuation methodology applies, and what are its key assumptions?",
    ],
    applicableFrameworks: ["DCF valuation", "Comparable multiples", "DuPont ratio analysis"],
    prohibitedReasoningPatterns: [
      "Never present a valuation as a single certain number without a range and stated methodology.",
      "Never compute a ratio from figures not verified as present in the statements.",
    ],
  },
  property_intelligence: {
    domain: "property_intelligence",
    reasoningApproach:
      "Comparable-based property reasoning: anchor valuation to location and recent comparable sales, then adjust for zoning, yield, and future development.",
    reasoningSteps: [
      "Confirm the exact location and neighborhood context.",
      "Identify recent, genuinely comparable sales.",
      "Compute achievable rental yield from comparable rents.",
      "Confirm zoning classification and permitted use.",
      "Identify planned development that could shift future value.",
    ],
    keyQuestions: [
      "What do truly comparable properties sell or rent for?",
      "Does current zoning permit the intended use?",
      "What nearby development could change value over time?",
    ],
    applicableFrameworks: ["Comparable sales approach", "Income capitalization (cap rate)", "Highest-and-best-use analysis"],
    prohibitedReasoningPatterns: [
      "Never value a property from a comparable that differs materially in size, condition, or location without stating the adjustment.",
      "Never assume a zoning or use permission without confirming the current classification.",
    ],
  },
  medical_intelligence: {
    domain: "medical_intelligence",
    reasoningApproach:
      "Guideline- and evidence-based clinical reasoning: ground every consideration in published guidelines and clinical evidence, and flag contraindications before any treatment discussion.",
    reasoningSteps: [
      "Identify the applicable clinical guideline and its issuing body.",
      "Gather clinical evidence (trial/study data) relevant to the case.",
      "Check contraindications and patient-specific risk factors first.",
      "Enumerate standard-of-care and alternative treatment options.",
      "State the strength/level of the evidence behind each consideration.",
    ],
    keyQuestions: [
      "What does the current clinical guideline recommend for this presentation?",
      "What contraindications or interactions apply to this patient?",
      "What is the standard of care, and what are the alternatives?",
    ],
    applicableFrameworks: ["Evidence-based medicine hierarchy (RCT > observational > expert opinion)", "Differential diagnosis"],
    prohibitedReasoningPatterns: [
      "Never issue a diagnosis or prescribe treatment as if from a licensed clinician.",
      "Never omit a known contraindication once it is present in the record.",
      "Never present anecdotal or non-peer-reviewed evidence as guideline-level.",
    ],
  },
  engineering_intelligence: {
    domain: "engineering_intelligence",
    reasoningApproach:
      "Standards-compliance reasoning: ground every judgment in the applicable code or standard, and never assert safety without a stated calculation and safety factor.",
    reasoningSteps: [
      "Identify the applicable engineering standard or code and its jurisdiction.",
      "Perform or validate the core load, stress, or capacity calculation.",
      "Confirm material specifications and their properties.",
      "Apply and justify an explicit safety factor.",
      "Enumerate plausible failure modes and their mitigations.",
    ],
    keyQuestions: [
      "Which standard or code governs this design, and does it apply in this jurisdiction?",
      "What is the calculated safety margin, and is it adequate?",
      "What is the most severe plausible failure mode?",
    ],
    applicableFrameworks: ["Factor-of-safety analysis", "Failure mode and effects analysis (FMEA)"],
    prohibitedReasoningPatterns: [
      "Never assert a design is 'safe' without a stated calculation and safety factor.",
      "Never certify code compliance without citing the specific standard section.",
    ],
  },
  hr_intelligence: {
    domain: "hr_intelligence",
    reasoningApproach:
      "Policy- and role-based HR reasoning: ground every consideration in the written policy, role definition, or applicable employment law -- never in a protected-class judgment.",
    reasoningSteps: [
      "Identify the applicable HR policy, role definition, or employment law.",
      "Establish the specific facts of the personnel matter from the record.",
      "Check for compliance with anti-discrimination and labor requirements.",
      "Identify documentation or process steps still missing.",
      "State the range of policy-consistent options, not a single directive.",
    ],
    keyQuestions: [
      "What does the written policy or role definition actually require?",
      "Is there a documented, policy-consistent basis for the decision?",
      "What employment-law or compliance risk applies here?",
    ],
    applicableFrameworks: ["Role/competency-based evaluation", "Progressive discipline framework"],
    prohibitedReasoningPatterns: [
      "Never base a recommendation on a protected characteristic (age, gender, race, religion, disability, etc.).",
      "Never recommend termination or hiring as a certainty rather than a policy-consistent option.",
    ],
  },
  contract_intelligence: {
    domain: "contract_intelligence",
    reasoningApproach:
      "Clause-based contract reasoning: read obligations, rights, and remedies directly from the text, and never infer enforceability without jurisdiction-specific legal review.",
    reasoningSteps: [
      "Identify the parties and the contract's stated purpose.",
      "Extract each party's obligations, rights, and conditions precisely as written.",
      "Identify termination, remedy, and indemnification clauses.",
      "Flag ambiguous or missing clauses rather than resolving them by assumption.",
      "Separate what the contract states from what a party merely claims about it.",
    ],
    keyQuestions: [
      "What does each party actually owe under this contract?",
      "What triggers termination, breach, or remedy?",
      "What clause is ambiguous, missing, or contradictory?",
    ],
    applicableFrameworks: ["Clause-by-clause extraction", "Obligation/right mapping"],
    prohibitedReasoningPatterns: [
      "Never assert a clause is legally enforceable without noting jurisdiction-specific review is required.",
      "Never fill in a missing clause with an assumed standard term.",
    ],
  },
};

const EVIDENCE_REQUIREMENTS: Record<AdaptiveIntelligenceDomain, readonly string[]> = {
  business_intelligence: [
    "A description of the target customer and problem being solved",
    "Any available evidence of demand (pre-orders, LOIs, waitlist, survey)",
    "A stated revenue or business model",
  ],
  market_intelligence: [
    "A defined market or industry to size",
    "At least one third-party market data point (size, growth rate, or competitor data)",
    "A stated geography or segment scope",
  ],
  legal_intelligence: [
    "The specific legal matter type and jurisdiction",
    "The relevant document(s), filing(s), or ruling(s)",
    "Identification of the parties involved",
  ],
  financial_intelligence: [
    "The relevant financial statement(s) (income statement, balance sheet, or cash flow statement)",
    "The reporting period covered",
    "Whether the statements are audited/reviewed or unaudited",
  ],
  property_intelligence: [
    "The property's address or parcel identifier",
    "At least one comparable sale or rental listing",
    "The current zoning classification",
  ],
  medical_intelligence: [
    "The specific clinical question or patient presentation",
    "Any relevant guideline, study, or clinical record already available",
    "Known contraindications or patient-specific risk factors",
  ],
  engineering_intelligence: [
    "The applicable engineering standard or code",
    "The relevant design parameters, loads, or material specifications",
    "The jurisdiction the design will be built or used in",
  ],
  hr_intelligence: [
    "The applicable HR policy or role definition",
    "The specific facts of the personnel matter",
    "Any documentation already on file (reviews, warnings, contracts)",
  ],
  contract_intelligence: [
    "The contract text itself, or the specific clause(s) in question",
    "The parties and their roles under the contract",
    "The jurisdiction/governing law clause, if present",
  ],
};

const CANNOT_DETERMINE_EVIDENCE_REQUIREMENTS: readonly string[] = [
  "A clearer description of what type of document or decision this concerns",
  "The specific objective the user wants ZERINIX to help decide",
  "If a document was intended to be analyzed, the document's content or a description of it",
];

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

export function runAdaptiveIntelligenceEngine(
  input: AdaptiveIntelligenceInput = {}
): AdaptiveIntelligenceResult {
  const { prompt = "", attachments = [], documentIntelligence, decisionIntentResult } = input;
  const evidenceTrace: string[] = [];

  const documentSignal = detectDocumentType({ prompt, attachments, documentIntelligence });
  evidenceTrace.push(
    documentSignal.source === "provided"
      ? `Document type derived from the supplied UniversalDocumentIntelligence result: "${documentSignal.label}" (confidence ${documentSignal.confidence}).`
      : documentSignal.source === "detected"
        ? `Document type detected from prompt/attachment keywords: "${documentSignal.label}" (confidence ${documentSignal.confidence}).`
        : "No document-type signal was found in the prompt or attachments."
  );

  const intentSignal = detectIntent({ prompt, decisionIntentResult });
  evidenceTrace.push(
    intentSignal.source === "provided"
      ? `Intent and decision objective derived from the supplied DecisionIntentResult: category "${intentSignal.intentLabel}" (confidence ${intentSignal.intentConfidence}).`
      : intentSignal.source === "detected"
        ? `Intent detected from prompt keywords: "${intentSignal.intentLabel}" (confidence ${intentSignal.intentConfidence}).`
        : "No intent signal was found in the prompt."
  );

  let selectedDomain: AdaptiveIntelligenceDomain | null = null;
  let overallConfidence = 0;

  if (documentSignal.domain && intentSignal.domain && documentSignal.domain === intentSignal.domain) {
    selectedDomain = documentSignal.domain;
    overallConfidence = Math.min(0.97, Math.max(documentSignal.confidence, intentSignal.intentConfidence) + 0.1);
    evidenceTrace.push(
      `Document-type and intent signals agree on "${selectedDomain}"; confidence boosted by corroboration.`
    );
  } else if (documentSignal.domain) {
    selectedDomain = documentSignal.domain;
    overallConfidence = intentSignal.domain ? documentSignal.confidence * 0.85 : documentSignal.confidence;
    evidenceTrace.push(
      intentSignal.domain
        ? `Document-type signal ("${documentSignal.domain}") and intent signal ("${intentSignal.domain}") disagree; the document-type signal was used, at reduced confidence.`
        : `Only the document-type signal identified a domain: "${selectedDomain}".`
    );
  } else if (intentSignal.domain) {
    selectedDomain = intentSignal.domain;
    overallConfidence = intentSignal.intentConfidence * 0.7;
    evidenceTrace.push(
      `Only the intent signal identified a domain: "${selectedDomain}" (a weaker basis than a direct document-type match).`
    );
  }

  const confidenceProfile: ConfidenceProfile = {
    documentTypeConfidence: documentSignal.confidence,
    intentConfidence: intentSignal.intentConfidence,
    decisionObjectiveConfidence: intentSignal.decisionObjectiveConfidence,
    overallConfidence,
  };

  if (!selectedDomain) {
    const cannotDetermineReason =
      "Neither the document type nor the user's intent could be matched to one of the nine supported reasoning domains; applying a generic or default reasoning process would be unsafe, so no domain was selected.";
    evidenceTrace.push(cannotDetermineReason);
    return {
      selectedDomain: null,
      cannotDetermineReason,
      detectedDocumentType: documentSignal.label,
      detectedIntent: intentSignal.intentLabel,
      detectedDecisionObjective: intentSignal.decisionObjective,
      reasoningProfile: null,
      confidenceProfile,
      evidenceRequirements: [...CANNOT_DETERMINE_EVIDENCE_REQUIREMENTS],
      evidenceTrace,
    };
  }

  evidenceTrace.push(`Selected reasoning domain: "${selectedDomain}" (overall confidence ${overallConfidence}).`);

  return {
    selectedDomain,
    cannotDetermineReason: null,
    detectedDocumentType: documentSignal.label,
    detectedIntent: intentSignal.intentLabel,
    detectedDecisionObjective: intentSignal.decisionObjective,
    reasoningProfile: REASONING_PROFILES[selectedDomain],
    confidenceProfile,
    evidenceRequirements: [...EVIDENCE_REQUIREMENTS[selectedDomain]],
    evidenceTrace,
  };
}
