import { z } from "zod";
import type { UniversalDocumentIntelligence } from "./universal-document-intelligence.ts";
import type { DecisionPlan } from "./intelligence-router.ts";
import {
  recommendationStatusValues,
  runExpertReasoningEngine,
  type ExpertReasoningResult,
  type ReasoningDomain,
  type ReasoningSection,
} from "./expert-reasoning-engine.ts";

// Layer 6 of ZERINIX Business Intelligence: the Executive Decision
// Brief -- integrated with the ZERINIX Expert Reasoning Engine
// (expert-reasoning-engine.ts). The required flow is: (1) existing
// evidence/intelligence objects are collected, (2) the Expert Reasoning
// Engine evaluates them into an ExpertReasoningResult, (3) this module
// converts that result into the brief below. This module no longer
// computes its own domain-support check, status, or assumptions
// independently of the engine -- it consumes the engine's own
// determination so there is a single source of truth for "is this
// supported" and "what does the evidence support," not two that could
// drift apart. It never generates a report or PDF, and it never invents
// evidence, metrics, market size, competitors, or confidence.
//
// v2 (feature-flagged): McKinsey-style executive advisory. Set
// ZERINIX_EXECUTIVE_ADVISORY_ENABLED="true" (or pass `enabled: true`,
// primarily for tests) to opt in. Existing architecture and call sites
// are unchanged -- `executiveDecisionBriefSchema` gained exactly one new
// field, `executiveAdvisory` (null unless the flag is on), and both
// builder functions gained one optional, backward-compatible options
// argument. With the flag off (the default), every existing caller of
// this module sees byte-for-byte the same output as before this change.
//
// The advisory leads with the recommendation, then explains why, cites
// supporting AND contradictory evidence (a genuinely new distinction --
// evidence is partitioned by counter-signal keywords, never invented),
// explains confidence, business impact, risks, opportunities,
// assumptions, and missing evidence, and always closes with exactly
// three actionable next decisions.
//
// Domain-differentiated structure: Expert Reasoning Engine only performs
// grounded, evidence-based reasoning for business/financial contexts
// (see reasoningDomainValues) -- it has no comparable-sales, statute,
// clinical-guideline, or engineering-standard reasoning at all. So for
// an explicit domainHint of "legal", "real_estate", "healthcare", or
// "engineering", this module never pretends to produce a grounded
// business recommendation about the document's actual content -- doing
// so would be fabrication. Instead it returns a structurally distinct,
// honest brief per domain (a different headline, rationale, missing-
// evidence list, and next decisions for each of the four), stating
// plainly that domain-specific expert reasoning is required and listing
// exactly what that would take. Only "business" and "finance" (the
// domains Expert Reasoning Engine can genuinely ground) receive the full
// evidence-derived advisory.

export { recommendationStatusValues };
export type RecommendationStatus = (typeof recommendationStatusValues)[number];

export const executiveBriefDomainValues = [
  "business",
  "legal",
  "finance",
  "real_estate",
  "healthcare",
  "engineering",
] as const;

export type ExecutiveBriefDomain = (typeof executiveBriefDomainValues)[number];

const NON_BUSINESS_ADVISORY_DOMAINS = ["legal", "real_estate", "healthcare", "engineering"] as const;
type NonBusinessExecutiveBriefDomain = (typeof NON_BUSINESS_ADVISORY_DOMAINS)[number];

function isNonBusinessAdvisoryDomain(domain: ExecutiveBriefDomain): domain is NonBusinessExecutiveBriefDomain {
  return (NON_BUSINESS_ADVISORY_DOMAINS as readonly string[]).includes(domain);
}

export const EXECUTIVE_ADVISORY_ENABLED_ENV_VAR = "ZERINIX_EXECUTIVE_ADVISORY_ENABLED";

export function isExecutiveAdvisoryEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const executiveAdvisorySchema = z
  .object({
    domain: z.enum(executiveBriefDomainValues).nullable(),
    executiveRecommendationHeadline: shortString(600),
    why: z.array(shortString(400)).max(12),
    supportingEvidence: z.array(shortString(400)).max(60),
    contradictoryEvidence: z.array(shortString(400)).max(60),
    confidenceNarrative: shortString(500),
    businessImpact: z.array(shortString(400)).max(6),
    risks: z.array(shortString(400)).max(30),
    opportunities: z.array(shortString(400)).max(30),
    assumptions: z.array(shortString(400)).max(10),
    missingEvidence: z.array(shortString(300)).max(30),
    nextDecisions: z.tuple([shortString(300), shortString(300), shortString(300)]),
    structureNotes: z.array(shortString(300)).max(4),
  })
  .strict();

export type ExecutiveAdvisory = z.infer<typeof executiveAdvisorySchema>;

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
    executiveAdvisory: executiveAdvisorySchema.nullable(),
  })
  .strict();

export type ExecutiveDecisionBrief = z.infer<typeof executiveDecisionBriefSchema>;

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const STATUS_CLOSING_DECISIONS: Record<RecommendationStatus, readonly [string, string, string]> = {
  proceed: [
    "Decide on the resourcing and timeline needed to execute this recommendation now.",
    "Decide who owns execution and how progress will be tracked.",
    "Decide on the specific milestone or metric that would trigger a re-evaluation.",
  ],
  proceed_with_conditions: [
    "Decide which specific conditions must be satisfied before committing full resources.",
    "Decide who is responsible for verifying each condition, and by when.",
    "Decide what happens if a condition is not met by the deadline.",
  ],
  wait: [
    "Decide what specific evidence or trigger would change this from 'wait' to 'proceed'.",
    "Decide on a review date to re-evaluate this decision with fresh evidence.",
    "Decide whether any low-cost preparatory step can be taken while waiting.",
  ],
  reject: [
    "Decide whether to formally close out this option or revisit it if circumstances change.",
    "Decide what specific change in evidence would be required to reconsider this decision.",
    "Decide how to communicate this decision and its rationale to stakeholders.",
  ],
  insufficient_evidence: [
    "Decide not to proceed until the missing evidence identified above has been obtained.",
    "Decide who is responsible for gathering the missing evidence, and by when.",
    "Decide whether this request should be re-submitted once the missing evidence is available.",
  ],
};

// Always returns exactly 3 items: draws first from real, already-
// verified gaps/risks/opportunities (never fabricated), then fills any
// remaining slots from a fixed, status-specific set of process
// decisions (methodology statements about the decision process itself,
// not claims about the world, so this never fabricates evidence either).
function buildNextDecisions(
  missingCriticalEvidence: readonly string[],
  keyRisks: readonly string[],
  opportunities: readonly string[],
  recommendationStatus: RecommendationStatus
): [string, string, string] {
  const decisions: string[] = [];

  for (const gap of missingCriticalEvidence.slice(0, 2)) {
    decisions.push(`Decide how to obtain or verify: ${gap}`);
  }
  if (keyRisks.length > 0) {
    decisions.push(`Decide how to mitigate this risk before proceeding: ${keyRisks[0]}`);
  }
  if (opportunities.length > 0) {
    decisions.push(`Decide whether to pursue this opportunity: ${opportunities[0]}`);
  }

  const closingDecisions = STATUS_CLOSING_DECISIONS[recommendationStatus];
  let closingIndex = 0;
  while (decisions.length < 3) {
    decisions.push(closingDecisions[closingIndex]);
    closingIndex += 1;
  }

  return decisions.slice(0, 3) as [string, string, string];
}

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
    executiveAdvisory: null,
  };
}

function buildUnsupportedAdvisory(
  base: ExecutiveDecisionBrief,
  domainHint: ExecutiveBriefDomain | null
): ExecutiveAdvisory {
  const missingEvidence = [
    "A supported business decision context (business idea validation, market intelligence, company analysis, financial analysis, investment research, product strategy, pricing, go-to-market, or growth/risk assessment)",
    "Or, if this is a legal, real estate, healthcare, or engineering matter, an explicit domain hint so ZERINIX can select the correct reasoning structure",
  ];
  const nextDecisions = buildNextDecisions([], [], [], "insufficient_evidence");

  return {
    domain: domainHint,
    executiveRecommendationHeadline: base.executiveRecommendation,
    why: base.decisionRationale,
    supportingEvidence: [],
    contradictoryEvidence: [],
    confidenceNarrative: base.confidenceExplanation,
    businessImpact: [],
    risks: [],
    opportunities: [],
    assumptions: [],
    missingEvidence,
    nextDecisions,
    structureNotes: [
      "No supported business context and no domain hint were available, so no domain-specific structure was applied.",
    ],
  };
}

type NonBusinessDomainTemplate = {
  headline: string;
  why: readonly string[];
  missingEvidence: readonly string[];
  nextDecisions: readonly [string, string, string];
};

// Hand-authored per domain -- never templated from one shared skeleton --
// so that legal, real estate, healthcare, and engineering matters each
// produce a genuinely different brief structure, and so none of them
// ever reads as a disguised business recommendation.
const NON_BUSINESS_DOMAIN_ADVISORY: Record<NonBusinessExecutiveBriefDomain, NonBusinessDomainTemplate> = {
  legal: {
    headline:
      "This is a legal matter; ZERINIX's business reasoning engines do not produce legal conclusions, so no legal recommendation is issued here.",
    why: [
      "Legal reasoning requires statute- and precedent-based analysis (issue, rule, application, conclusion), not the market/financial evidence weighing this engine performs.",
      "Issuing a business-style recommendation on a legal matter risks presenting an unqualified legal opinion as fact.",
    ],
    missingEvidence: [
      "The specific legal matter type and governing jurisdiction",
      "The relevant statute, code, or precedent",
      "Confirmation from a licensed legal reviewer before any action is taken",
    ],
    nextDecisions: [
      "Route this matter to legal review rather than business report generation.",
      "Identify the specific statute or precedent that governs this matter before proceeding.",
      "Do not act on this document until a qualified legal reviewer has confirmed the applicable law.",
    ],
  },
  real_estate: {
    headline:
      "This is a real estate / property matter; ZERINIX's business reasoning engines do not perform comparable-sales or zoning analysis, so no property recommendation is issued here.",
    why: [
      "Property valuation requires location, comparable-sales, and zoning analysis, not the market/financial reasoning this engine performs about business ideas.",
      "A business-style recommendation here would imply a valuation this engine has no comparable-sales evidence to support.",
    ],
    missingEvidence: [
      "The property's exact location or parcel identifier",
      "At least one genuinely comparable recent sale or rental listing",
      "The current zoning classification and permitted use",
    ],
    nextDecisions: [
      "Route this matter to a property/real-estate-specific analysis, not a business report.",
      "Obtain comparable sales or rental data for the property before any valuation is attempted.",
      "Confirm the zoning classification before assuming a particular use is permitted.",
    ],
  },
  healthcare: {
    headline:
      "This is a clinical/healthcare matter; ZERINIX's business reasoning engines do not perform clinical or diagnostic analysis, so no clinical recommendation is issued here.",
    why: [
      "Clinical reasoning requires guideline- and evidence-based analysis by a qualified clinician, not the business/market evidence weighing this engine performs.",
      "Issuing any recommendation here risks presenting an unqualified clinical judgment as fact.",
    ],
    missingEvidence: [
      "The specific clinical question or patient presentation",
      "The applicable clinical guideline and its issuing body",
      "Confirmation from a licensed clinician before any treatment-related action is taken",
    ],
    nextDecisions: [
      "Route this matter to a qualified clinician rather than business report generation.",
      "Identify the specific clinical guideline that applies before any further analysis.",
      "Do not act on this document for treatment purposes until a licensed clinician has reviewed it.",
    ],
  },
  engineering: {
    headline:
      "This is an engineering matter; ZERINIX's business reasoning engines do not perform structural, load, or safety-factor calculations, so no engineering recommendation is issued here.",
    why: [
      "Engineering reasoning requires standards-compliance and calculation-based analysis by a qualified engineer, not the market/financial evidence weighing this engine performs.",
      "Issuing a recommendation here without a stated calculation and safety factor would risk asserting a safety conclusion this engine cannot verify.",
    ],
    missingEvidence: [
      "The applicable engineering standard or code",
      "The relevant load, stress, or capacity calculation with its safety factor",
      "Confirmation from a licensed engineer before any design or safety decision is made",
    ],
    nextDecisions: [
      "Route this matter to a qualified engineer rather than business report generation.",
      "Identify the applicable standard or code before any further analysis.",
      "Do not treat this document as safety-certified until a licensed engineer has reviewed the calculations.",
    ],
  },
};

function buildNonBusinessDomainBrief(
  expertReasoningResult: ExpertReasoningResult,
  domain: NonBusinessExecutiveBriefDomain
): ExecutiveDecisionBrief {
  const template = NON_BUSINESS_DOMAIN_ADVISORY[domain];
  const keyRisks = [`Proceeding without ${domain}-specific expert review before this evidence is available.`];
  const confidenceExplanation = `Confidence is 0 because "${domain}" is outside ZERINIX's currently supported grounded-reasoning scope; no domain-specific evidence was evaluated by the business reasoning engine.`;

  return {
    decisionQuestion: expertReasoningResult.decisionObjective || "",
    executiveRecommendation: template.headline,
    recommendationStatus: "insufficient_evidence",
    decisionRationale: [...template.why],
    verifiedEvidence: [],
    directionalSignals: [],
    assumptions: [],
    keyRisks,
    missingCriticalEvidence: [...template.missingEvidence],
    immediateNextActions: [...template.nextDecisions],
    decisionConfidence: 0,
    confidenceExplanation,
    evidenceTrace: expertReasoningResult.evidenceTrace,
    executiveAdvisory: {
      domain,
      executiveRecommendationHeadline: template.headline,
      why: [...template.why],
      supportingEvidence: [],
      contradictoryEvidence: [],
      confidenceNarrative: confidenceExplanation,
      businessImpact: [],
      risks: keyRisks,
      opportunities: [],
      assumptions: [],
      missingEvidence: [...template.missingEvidence],
      nextDecisions: [...template.nextDecisions],
      structureNotes: [
        `Structured using the "${domain}" domain's own limitation-and-requirements template, not business/financial reasoning.`,
      ],
    },
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

function buildBusinessImpact(expertReasoningResult: ExpertReasoningResult) {
  const impact: string[] = [];

  for (const [label, key] of APPLICABLE_SECTIONS) {
    const section = expertReasoningResult[key] as ReasoningSection;
    if (section.applicable) {
      impact.push(`${label} impact: ${section.summary}`);
    }
  }

  return impact.slice(0, 6);
}

// Deliberately keyword-driven, exactly like every other ZERINIX
// Intelligence layer's classification logic: this only ever re-buckets
// evidence strings that already exist in verifiedFacts/directionalSignals
// (themselves already non-fabricated), it never invents new evidence
// text. An item can appear in at most one bucket for the
// supporting/contradictory split; opportunity-flagging is a separate,
// independent lens over the same pool.
const CONTRADICTORY_SIGNAL_PATTERN =
  /\b(however|but\b|risk|declin|loss|concern|against|unfavorable|conflict|contradict|downside|weakness|uncertain|caution)/i;
const OPPORTUNITY_SIGNAL_PATTERN =
  /\b(opportunit|growth|upside|advantage|favorable|strength|potential|increas|expand|momentum)/i;

function partitionBySignal(items: readonly string[], pattern: RegExp) {
  const matches: string[] = [];
  const rest: string[] = [];
  for (const item of items) {
    (pattern.test(item) ? matches : rest).push(item);
  }
  return { matches, rest };
}

function buildConfidenceNarrative(
  expertReasoningResult: ExpertReasoningResult,
  supportingCount: number,
  contradictoryCount: number
) {
  return `Confidence is ${expertReasoningResult.confidence} based on ${supportingCount} supporting evidence item(s) and ${contradictoryCount} contradictory/counter-signal item(s); ${expertReasoningResult.confidenceExplanation}`.slice(
    0,
    500
  );
}

const BUSINESS_CONTEXT_TO_BRIEF_DOMAIN: Partial<Record<ReasoningDomain, ExecutiveBriefDomain>> = {
  financial_intelligence: "finance",
  investment_intelligence: "finance",
};

function mapBusinessContextToDomain(detectedBusinessContext: ReasoningDomain): ExecutiveBriefDomain {
  return BUSINESS_CONTEXT_TO_BRIEF_DOMAIN[detectedBusinessContext] ?? "business";
}

export type ExecutiveDecisionBriefOptions = {
  // If supplied, trusted completely (see file header for why "legal",
  // "real_estate", "healthcare", and "engineering" never receive a
  // fabricated business-flavored recommendation). When omitted for a
  // supported business context, the domain is derived from
  // expertReasoningResult.detectedBusinessContext instead of guessed.
  domainHint?: ExecutiveBriefDomain;
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_EXECUTIVE_ADVISORY_ENABLED environment variable.
  enabled?: boolean;
};

export function buildExecutiveDecisionBriefFromExpertReasoning(
  expertReasoningResult: ExpertReasoningResult,
  options: ExecutiveDecisionBriefOptions = {}
): ExecutiveDecisionBrief {
  const advisoryEnabled = options.enabled ?? isExecutiveAdvisoryEnabled();
  const domainHint = options.domainHint ?? null;

  if (advisoryEnabled && domainHint && isNonBusinessAdvisoryDomain(domainHint)) {
    return buildNonBusinessDomainBrief(expertReasoningResult, domainHint);
  }

  if (expertReasoningResult.detectedBusinessContext === "unsupported") {
    const base = unsupportedContextBrief(expertReasoningResult);
    if (!advisoryEnabled) {
      return base;
    }
    const executiveAdvisory = buildUnsupportedAdvisory(base, domainHint);
    return { ...base, immediateNextActions: [...executiveAdvisory.nextDecisions], executiveAdvisory };
  }

  const keyRisks = expertReasoningResult.riskReasoning.applicable
    ? expertReasoningResult.riskReasoning.supportingEvidence
    : [];
  const verifiedEvidence = expertReasoningResult.verifiedFacts;
  const directionalSignals = expertReasoningResult.directionalSignals;
  const assumptions = expertReasoningResult.assumptions;
  const missingCriticalEvidence = expertReasoningResult.evidenceGaps;
  const decisionQuestion =
    expertReasoningResult.decisionObjective ||
    "No explicit decision question was identified from the user's request or the document.";
  const executiveRecommendation = buildExecutiveRecommendation(expertReasoningResult);
  const decisionRationale = buildDecisionRationale(expertReasoningResult);

  if (!advisoryEnabled) {
    return {
      decisionQuestion,
      executiveRecommendation,
      recommendationStatus: expertReasoningResult.recommendationStatus,
      decisionRationale,
      verifiedEvidence,
      directionalSignals,
      assumptions,
      keyRisks,
      missingCriticalEvidence,
      immediateNextActions: buildImmediateNextActions(missingCriticalEvidence, keyRisks),
      decisionConfidence: expertReasoningResult.confidence,
      confidenceExplanation: expertReasoningResult.confidenceExplanation,
      evidenceTrace: expertReasoningResult.evidenceTrace,
      executiveAdvisory: null,
    };
  }

  const domain = domainHint ?? mapBusinessContextToDomain(expertReasoningResult.detectedBusinessContext);
  const evidencePool = unique([...verifiedEvidence, ...directionalSignals]);
  const { matches: contradictoryEvidence, rest: supportingEvidence } = partitionBySignal(
    evidencePool,
    CONTRADICTORY_SIGNAL_PATTERN
  );
  const { matches: opportunities } = partitionBySignal(evidencePool, OPPORTUNITY_SIGNAL_PATTERN);
  const businessImpact = buildBusinessImpact(expertReasoningResult);
  const nextDecisions = buildNextDecisions(
    missingCriticalEvidence,
    keyRisks,
    opportunities,
    expertReasoningResult.recommendationStatus
  );
  const confidenceNarrative = buildConfidenceNarrative(
    expertReasoningResult,
    supportingEvidence.length,
    contradictoryEvidence.length
  );

  return {
    decisionQuestion,
    executiveRecommendation,
    recommendationStatus: expertReasoningResult.recommendationStatus,
    decisionRationale,
    verifiedEvidence,
    directionalSignals,
    assumptions,
    keyRisks,
    missingCriticalEvidence,
    immediateNextActions: nextDecisions,
    decisionConfidence: expertReasoningResult.confidence,
    confidenceExplanation: expertReasoningResult.confidenceExplanation,
    evidenceTrace: expertReasoningResult.evidenceTrace,
    executiveAdvisory: {
      domain,
      executiveRecommendationHeadline: executiveRecommendation,
      why: decisionRationale,
      supportingEvidence,
      contradictoryEvidence,
      confidenceNarrative,
      businessImpact,
      risks: keyRisks,
      opportunities,
      assumptions,
      missingEvidence: missingCriticalEvidence,
      nextDecisions,
      structureNotes: [`Structured using verified-evidence business reasoning for the "${domain}" context.`],
    },
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
  domainHint,
  enabled,
}: {
  decisionPlan: DecisionPlan;
  documentIntelligence: UniversalDocumentIntelligence;
  prompt?: string;
  marketResearchEvidence?: readonly string[];
  businessPlanEvidence?: readonly string[];
  financialEvidence?: readonly string[];
  userProvidedFacts?: readonly string[];
  domainHint?: ExecutiveBriefDomain;
  enabled?: boolean;
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

  return buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { domainHint, enabled });
}
