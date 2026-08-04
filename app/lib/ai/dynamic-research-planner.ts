import { z } from "zod";

// ZERINIX Dynamic Research Planner v1.
//
// ZERINIX must stop running one generic research flow for every request:
// a legal case and a business idea need fundamentally different research
// -- different topics, different evidence, different priorities. This
// module builds a domain-specific, ordered research plan instead of a
// one-size-fits-all checklist.
//
// Scope (v1, standalone): this is a PLANNER only. It decides *what* should
// be researched, in what order, at what priority, with what evidence
// requirement and confidence bar, and at what estimated cost -- it never
// performs the research itself (no network/AI calls), never generates a
// report, and is not wired into any existing route, engine, or UI. It is
// a pure, deterministic function, following the same "evidence pool /
// typed input, structured output, own closed vocabulary" convention as
// every other ZERINIX Intelligence layer (document-intelligence.ts,
// expert-reasoning-engine.ts, decision-intent-engine.ts,
// decision-strategy-engine.ts, and the standalone evidence acquisition
// module). It does not import from, and is not imported by, any of
// those files, and it is
// intentionally distinct from the existing, already-production
// `dynamic-research-plan.ts` (expertise-profile-driven query planning for
// the live /api/plan pipeline) -- this module does not replace or modify
// that file. `estimatedCostUsd` on each task is a deterministic planning
// heuristic for prioritization only; it is not connected to the real AI
// cost governance system (`app/lib/ai/governance.ts`) or to billing.
//
// Wiring this planner's output into the production route, the Evidence
// Acquisition Engine, or the Executive Decision Engine is intentionally
// left for a future, separate integration step.

export const researchDomainValues = [
  "business",
  "legal",
  "real_estate",
  "finance",
  "healthcare",
  "engineering",
] as const;

export type ResearchDomain = (typeof researchDomainValues)[number];

export const researchTaskPriorityValues = ["critical", "high", "medium", "low"] as const;

export type ResearchTaskPriority = (typeof researchTaskPriorityValues)[number];

export const domainDetectionMethodValues = ["provided", "detected", "fallback"] as const;

export type DomainDetectionMethod = (typeof domainDetectionMethodValues)[number];

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
const shortString = (max: number) => z.string().trim().min(1).max(max);

export const researchTaskSchema = z
  .object({
    id: identifier,
    domain: z.enum(researchDomainValues),
    order: z.number().int().min(1).max(20),
    topic: shortString(120),
    description: shortString(400),
    priority: z.enum(researchTaskPriorityValues),
    requiredEvidence: z.array(shortString(200)).min(2).max(6),
    confidenceTarget: z.number().min(0).max(1),
    estimatedCostUsd: z.number().min(0).max(50),
  })
  .strict();

export type ResearchTask = z.infer<typeof researchTaskSchema>;

export const dynamicResearchPlannerResultSchema = z
  .object({
    detectedDomain: z.enum(researchDomainValues),
    domainConfidence: z.number().min(0).max(1),
    domainDetectionMethod: z.enum(domainDetectionMethodValues),
    tasks: z.array(researchTaskSchema).min(1).max(10),
    totalEstimatedCostUsd: z.number().min(0).max(200),
    planTrace: z.array(shortString(300)).max(20),
  })
  .strict();

export type DynamicResearchPlannerResult = z.infer<typeof dynamicResearchPlannerResultSchema>;

export type DynamicResearchPlannerInput = {
  prompt?: string;
  attachmentText?: readonly string[];
  // If the caller already knows the domain (e.g. from Universal Document
  // Intelligence, Expert Reasoning Engine, or the Expertise Profile), pass
  // it here directly. The planner trusts it completely rather than
  // re-deriving a classification a caller already computed.
  detectedDomain?: ResearchDomain;
};

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

const PRIORITY_CONFIDENCE_TARGET: Record<ResearchTaskPriority, number> = {
  critical: 0.85,
  high: 0.75,
  medium: 0.6,
  low: 0.5,
};

const PRIORITY_COST_WEIGHT: Record<ResearchTaskPriority, number> = {
  critical: 3,
  high: 2,
  medium: 1.5,
  low: 1,
};

const BASE_TASK_COST_USD = 0.03;

function roundTo2(value: number) {
  return Math.round(value * 100) / 100;
}

type TaskTemplate = {
  topic: string;
  description: string;
  priority: ResearchTaskPriority;
  requiredEvidence: readonly string[];
};

function buildTask(domain: ResearchDomain, order: number, template: TaskTemplate): ResearchTask {
  const confidenceTarget = PRIORITY_CONFIDENCE_TARGET[template.priority];
  const estimatedCostUsd = roundTo2(
    BASE_TASK_COST_USD * PRIORITY_COST_WEIGHT[template.priority] * template.requiredEvidence.length
  );

  return {
    id: `${domain}_${template.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`,
    domain,
    order,
    topic: template.topic,
    description: template.description,
    priority: template.priority,
    requiredEvidence: [...template.requiredEvidence],
    confidenceTarget,
    estimatedCostUsd,
  };
}

// Each domain's tasks are listed in the exact order ZERINIX should research
// them -- this order is the plan's authoritative sequence (`order`), while
// `priority` is a separate, independent judgment of how critical each task
// is to a responsible decision.
const DOMAIN_TASK_TEMPLATES: Record<ResearchDomain, readonly TaskTemplate[]> = {
  business: [
    {
      topic: "Market size",
      description:
        "Establish the total and serviceable addressable market for the business idea, including current market value and near-term growth trajectory.",
      priority: "critical",
      requiredEvidence: [
        "Total addressable market (TAM) estimate with source",
        "Serviceable addressable market (SAM) estimate",
        "Market growth rate or CAGR reference",
        "Publication date of the market sizing source",
      ],
    },
    {
      topic: "Competitors",
      description:
        "Identify direct and indirect competitors, their market position, and how the business idea differentiates from them.",
      priority: "critical",
      requiredEvidence: [
        "List of direct competitors",
        "List of indirect or substitute competitors",
        "Competitor pricing or positioning summary",
        "Evidence of competitor market share or traction",
      ],
    },
    {
      topic: "Pricing",
      description: "Determine realistic pricing benchmarks for comparable products or services in this market.",
      priority: "high",
      requiredEvidence: [
        "Comparable pricing benchmarks from at least two sources",
        "Pricing model used by comparable competitors (subscription, one-time, usage-based)",
        "Willingness-to-pay signal, if available",
      ],
    },
    {
      topic: "Business model",
      description: "Clarify how the business intends to generate revenue and structure its core value proposition.",
      priority: "high",
      requiredEvidence: [
        "Revenue model description (e.g. subscription, transactional, licensing)",
        "Primary value proposition statement",
        "Key cost drivers of the business model",
      ],
    },
    {
      topic: "Customers",
      description: "Define the target customer segments and their specific needs or pain points.",
      priority: "high",
      requiredEvidence: [
        "Primary target customer segment definition",
        "Evidence of customer pain point or unmet need",
        "Any existing customer validation signal (interviews, LOIs, waitlist)",
      ],
    },
    {
      topic: "GTM",
      description: "Determine how the business plans to acquire its first customers and scale distribution.",
      priority: "medium",
      requiredEvidence: [
        "Primary go-to-market channel(s) identified",
        "Customer acquisition cost benchmark for a comparable channel",
        "Evidence of a repeatable acquisition motion, if any",
      ],
    },
  ],
  legal: [
    {
      topic: "Case type",
      description:
        "Classify the exact legal matter type (civil, criminal, administrative, commercial, etc.) to route to the correct body of law.",
      priority: "critical",
      requiredEvidence: [
        "Explicit classification of the case type",
        "Jurisdiction and applicable court level",
        "Parties involved and their roles",
      ],
    },
    {
      topic: "Applicable laws",
      description: "Identify the specific statutes, codes, or regulations that govern this matter.",
      priority: "critical",
      requiredEvidence: [
        "Relevant statute or code citation(s)",
        "Jurisdiction-specific applicability confirmation",
        "Any recent amendments affecting applicability",
      ],
    },
    {
      topic: "Court decisions",
      description: "Locate the actual court ruling(s) or filings relevant to this matter, if any exist.",
      priority: "high",
      requiredEvidence: [
        "Court name and decision date",
        "Case outcome or ruling summary",
        "Docket or case number, if available",
      ],
    },
    {
      topic: "Precedents",
      description: "Identify binding or persuasive precedents that could affect the outcome of this matter.",
      priority: "high",
      requiredEvidence: [
        "At least one comparable precedent case",
        "Court level of the precedent (binding vs. persuasive)",
        "How the precedent's facts compare to this matter",
      ],
    },
    {
      topic: "Missing evidence",
      description:
        "Explicitly identify what evidence is absent from the case file that would be required to reach a confident conclusion.",
      priority: "critical",
      requiredEvidence: [
        "List of documents or testimony not present in the case file",
        "Explanation of why each missing item matters to the outcome",
        "Whether the missing evidence is obtainable, and how",
      ],
    },
    {
      topic: "Risks",
      description: "Assess legal, financial, and reputational risks associated with this matter.",
      priority: "high",
      requiredEvidence: [
        "Risk of adverse ruling or liability exposure",
        "Estimated financial exposure, if quantifiable from the record",
        "Reputational or regulatory follow-on risk, if any",
      ],
    },
    {
      topic: "Strategy",
      description:
        "Outline viable legal strategies or next procedural steps based on the case type, applicable law, and precedents.",
      priority: "medium",
      requiredEvidence: [
        "At least one viable strategic option",
        "Procedural next step and its deadline, if known",
        "Trade-offs between the available strategic options",
      ],
    },
  ],
  real_estate: [
    {
      topic: "Location",
      description: "Establish the exact property location and neighborhood-level context relevant to valuation.",
      priority: "critical",
      requiredEvidence: [
        "Confirmed property address or parcel identifier",
        "Neighborhood classification (e.g. urban, suburban, commercial corridor)",
        "Proximity to key infrastructure (transit, schools, employment centers)",
      ],
    },
    {
      topic: "Comparable sales",
      description: "Identify recent comparable property sales to establish a realistic valuation range.",
      priority: "critical",
      requiredEvidence: [
        "At least two comparable sales within a relevant radius and timeframe",
        "Sale price and sale date for each comparable",
        "Adjustments made for size, condition, or feature differences",
      ],
    },
    {
      topic: "Rental yield",
      description: "Determine achievable rental income and resulting yield for the property.",
      priority: "high",
      requiredEvidence: [
        "Comparable rental rates for similar units/properties",
        "Estimated gross rental yield calculation",
        "Vacancy rate assumption for the area",
      ],
    },
    {
      topic: "Zoning",
      description: "Confirm the zoning classification and any use restrictions or entitlements affecting the property.",
      priority: "high",
      requiredEvidence: [
        "Current zoning classification",
        "Permitted uses under current zoning",
        "Any pending rezoning or variance applications",
      ],
    },
    {
      topic: "Demographics",
      description: "Profile the population and economic characteristics of the surrounding area relevant to demand.",
      priority: "medium",
      requiredEvidence: [
        "Population growth trend for the area",
        "Median household income for the area",
        "Relevant age or occupation distribution, if it affects demand",
      ],
    },
    {
      topic: "Future development",
      description: "Identify planned or proposed development that could affect future property value.",
      priority: "medium",
      requiredEvidence: [
        "Any planned infrastructure or development projects nearby",
        "Municipal or regional development plan references",
        "Estimated timeline and likely impact on property value",
      ],
    },
  ],
  finance: [
    {
      topic: "Financial statements",
      description: "Obtain and validate the core financial statements needed to assess financial health.",
      priority: "critical",
      requiredEvidence: [
        "Income statement for the relevant period(s)",
        "Balance sheet for the relevant period(s)",
        "Cash flow statement for the relevant period(s)",
        "Audit or review status of the statements",
      ],
    },
    {
      topic: "Ratios",
      description: "Calculate key financial ratios to benchmark performance and solvency.",
      priority: "high",
      requiredEvidence: [
        "Liquidity ratio(s) (e.g. current ratio)",
        "Profitability ratio(s) (e.g. gross/net margin)",
        "Leverage ratio(s) (e.g. debt-to-equity)",
      ],
    },
    {
      topic: "Cash flow",
      description: "Assess the actual cash generation and burn characteristics of the business.",
      priority: "critical",
      requiredEvidence: [
        "Operating cash flow figure",
        "Free cash flow or burn rate figure",
        "Cash runway estimate, if burning cash",
      ],
    },
    {
      topic: "Risk",
      description: "Identify material financial risks including concentration, covenant, and liquidity risk.",
      priority: "high",
      requiredEvidence: [
        "Customer or revenue concentration risk, if present",
        "Any debt covenant or default risk",
        "Currency, interest rate, or liquidity risk exposure",
      ],
    },
    {
      topic: "Valuation",
      description: "Establish a defensible valuation range using at least one recognized methodology.",
      priority: "high",
      requiredEvidence: [
        "Valuation methodology used (e.g. DCF, comparables, multiples)",
        "Key assumptions driving the valuation",
        "Comparable transaction or trading multiples, if used",
      ],
    },
    {
      topic: "Benchmarks",
      description: "Compare the target's financial performance against relevant industry benchmarks.",
      priority: "medium",
      requiredEvidence: [
        "Industry-average benchmark for at least one key metric",
        "Source and date of the benchmark data",
        "Explanation of how the target compares to the benchmark",
      ],
    },
  ],
  healthcare: [
    {
      topic: "Guidelines",
      description: "Identify the current clinical practice guidelines relevant to this case or question.",
      priority: "critical",
      requiredEvidence: [
        "Name and issuing body of the applicable guideline",
        "Publication or last-review date of the guideline",
        "Specific guideline recommendation relevant to this case",
      ],
    },
    {
      topic: "Clinical evidence",
      description: "Gather the clinical evidence (trials, studies, meta-analyses) supporting or contradicting the proposed approach.",
      priority: "critical",
      requiredEvidence: [
        "At least one peer-reviewed study or trial reference",
        "Study population and outcome relevant to this case",
        "Level or strength of evidence (e.g. RCT vs. observational)",
      ],
    },
    {
      topic: "Contraindications",
      description:
        "Identify contraindications, interactions, or patient-specific factors that would preclude the proposed approach.",
      priority: "critical",
      requiredEvidence: [
        "Known contraindications for the proposed treatment or approach",
        "Drug or treatment interaction risks, if applicable",
        "Patient-specific risk factors noted in the record",
      ],
    },
    {
      topic: "Risks",
      description: "Assess the clinical risks and potential adverse outcomes of the proposed approach.",
      priority: "high",
      requiredEvidence: [
        "Known adverse effect rate or risk profile",
        "Severity and reversibility of the most significant risk",
        "Risk mitigation or monitoring plan, if any",
      ],
    },
    {
      topic: "Treatment options",
      description: "Enumerate the viable treatment or management options, including the standard of care.",
      priority: "medium",
      requiredEvidence: [
        "Standard-of-care option for this condition",
        "At least one alternative treatment option",
        "Comparative effectiveness or trade-off between options",
      ],
    },
  ],
  engineering: [
    {
      topic: "Standards",
      description: "Identify the specific engineering standards or codes that govern this design or analysis.",
      priority: "critical",
      requiredEvidence: [
        "Applicable standard/code name and version (e.g. ASME, ISO, Eurocode)",
        "Section(s) of the standard relevant to this case",
        "Jurisdictional adoption status of the standard",
      ],
    },
    {
      topic: "Calculations",
      description: "Perform or validate the core engineering calculations required to assess feasibility or safety.",
      priority: "critical",
      requiredEvidence: [
        "Load, stress, or capacity calculation with stated assumptions",
        "Safety factor applied and its justification",
        "Units and methodology used for the calculation",
      ],
    },
    {
      topic: "Materials",
      description: "Confirm the material properties and specifications relevant to the design.",
      priority: "high",
      requiredEvidence: [
        "Material specification or grade used",
        "Relevant material property values (e.g. yield strength, tolerance)",
        "Source of the material property data (datasheet, standard, test report)",
      ],
    },
    {
      topic: "Safety",
      description: "Assess the safety implications of the design or process, including failure modes affecting people.",
      priority: "critical",
      requiredEvidence: [
        "Identified safety hazard(s) associated with the design",
        "Applicable safety factor or margin",
        "Mitigation or safeguard for each identified hazard",
      ],
    },
    {
      topic: "Compliance",
      description: "Verify regulatory and code compliance for the jurisdiction in which the design will be used or built.",
      priority: "high",
      requiredEvidence: [
        "Applicable regulatory body and requirement",
        "Compliance status or certification needed",
        "Any known compliance gap",
      ],
    },
    {
      topic: "Failure risks",
      description: "Identify plausible failure modes and their consequences.",
      priority: "high",
      requiredEvidence: [
        "At least one plausible failure mode",
        "Likelihood and severity of the failure mode",
        "Existing mitigation or redundancy for the failure mode",
      ],
    },
  ],
};

// Deliberately domain-exclusive keywords: overlapping generic terms
// ("regulation", "risk") are intentionally left out of more than one
// domain's pattern so a single mention cannot swing detection toward the
// wrong domain.
const DOMAIN_DETECTION_PATTERNS: Record<ResearchDomain, RegExp> = {
  business: /\b(business idea|business plan|startup|go-to-market|go to market|market size|competitors?|customers?|revenue model|business model|pricing strategy)\b/g,
  legal: /\b(lawsuit|litigation|plaintiff|defendant|court of appeal|supreme court|statute|precedent|attorney|lawyer|legal case|verdict|docket)\b/g,
  real_estate: /\b(real estate|property listing|zoning|rental yield|comparable sales|parcel|square (?:feet|meters|footage)|tenant|landlord|cap rate)\b/g,
  finance: /\b(financial statements?|balance sheet|income statement|cash flow statement|valuation multiple|ebitda|financial ratios?|financial health)\b/g,
  healthcare: /\b(patient|clinical trial|diagnosis|contraindication|healthcare|medical guideline|treatment plan|symptom(?:s)?)\b/g,
  engineering: /\b(engineering|structural analysis|load calculation|material specification|safety factor|iso \d|asme|eurocode|failure mode)\b/g,
};

const FALLBACK_DOMAIN: ResearchDomain = "business";

function detectDomain(text: string): { domain: ResearchDomain; confidence: number } {
  const normalized = normalizeForMatch(text);
  let bestDomain: ResearchDomain | null = null;
  let bestMatches = 0;

  for (const domain of researchDomainValues) {
    const matches = normalized.match(DOMAIN_DETECTION_PATTERNS[domain]) || [];
    const uniqueHits = new Set(matches).size;
    if (uniqueHits > bestMatches) {
      bestMatches = uniqueHits;
      bestDomain = domain;
    }
  }

  if (!bestDomain || bestMatches === 0) {
    return { domain: FALLBACK_DOMAIN, confidence: 0 };
  }

  return { domain: bestDomain, confidence: Math.min(0.5 + bestMatches * 0.15, 0.95) };
}

export function runDynamicResearchPlanner(
  input: DynamicResearchPlannerInput = {}
): DynamicResearchPlannerResult {
  const { prompt = "", attachmentText = [], detectedDomain } = input;
  const planTrace: string[] = [];

  let domain: ResearchDomain;
  let domainConfidence: number;
  let domainDetectionMethod: DomainDetectionMethod;

  if (detectedDomain) {
    domain = detectedDomain;
    domainConfidence = 1;
    domainDetectionMethod = "provided";
    planTrace.push(`Domain "${domain}" was provided by the caller and used as-is.`);
  } else {
    const combinedText = [prompt, ...attachmentText].filter(Boolean).join("\n");
    const detection = detectDomain(combinedText);
    domain = detection.domain;
    domainConfidence = detection.confidence;
    domainDetectionMethod = detection.confidence > 0 ? "detected" : "fallback";
    planTrace.push(
      domainDetectionMethod === "detected"
        ? `Domain "${domain}" detected from prompt/attachment keywords (confidence ${domainConfidence}).`
        : `No domain signal found in the prompt/attachments; falling back to "${domain}" with confidence 0. This plan should be treated as low-confidence until a domain is confirmed.`
    );
  }

  const templates = DOMAIN_TASK_TEMPLATES[domain];
  const tasks = templates.map((template, index) => buildTask(domain, index + 1, template));
  const totalEstimatedCostUsd = roundTo2(tasks.reduce((sum, task) => sum + task.estimatedCostUsd, 0));

  planTrace.push(`Built ${tasks.length} ordered research task(s) for domain "${domain}".`);
  planTrace.push(
    `Priorities: ${tasks.filter((t) => t.priority === "critical").length} critical, ${
      tasks.filter((t) => t.priority === "high").length
    } high, ${tasks.filter((t) => t.priority === "medium").length} medium, ${
      tasks.filter((t) => t.priority === "low").length
    } low.`
  );
  planTrace.push(`Total estimated planning cost: $${totalEstimatedCostUsd}.`);

  return {
    detectedDomain: domain,
    domainConfidence,
    domainDetectionMethod,
    tasks,
    totalEstimatedCostUsd,
    planTrace,
  };
}
