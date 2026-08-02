import { z } from "zod";
import {
  expertiseDomainValues,
  expertiseProfileSchema,
  normalizeSelectedAnalysisMode,
  selectedAnalysisModeValues,
  type ExpertiseProfile,
} from "./expertise-profile.ts";
import {
  type DynamicReportPlan,
} from "./dynamic-report-plan.ts";
import type { ResearchTask } from "../decision-intelligence/contracts.ts";
import { expandMarketTaxonomyTerms } from "./market-taxonomy.ts";

const researchPriorityValues = ["critical", "high", "standard"] as const;
const preferredSourceTypeValues = [
  "official_government",
  "primary_authority",
  "statute",
  "regulation",
  "regulator",
  "official_court",
  "municipality",
  "planning_authority",
  "cadastral_authority",
  "hazard_authority",
  "official_filing",
  "audited_statement",
  "tax_authority",
  "official_statistics",
  "company_source",
  "credible_market_data",
  "dated_comparable",
  "professional_standard",
] as const;

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
const conciseText = z.string().trim().min(1).max(240);

export const dynamicResearchTaskSchema = z
  .object({
    id: identifier,
    topic: z.string().trim().min(1).max(160),
    purpose: conciseText,
    reportSectionId: identifier,
    decisionCriterion: z.string().trim().min(1).max(160),
    evidenceField: identifier,
    priority: z.enum(researchPriorityValues),
    preferredSourceTypes: z
      .array(z.enum(preferredSourceTypeValues))
      .min(1)
      .max(5),
    jurisdiction: z.string().trim().max(180),
    queries: z.array(z.string().trim().min(3).max(220)).min(1).max(3),
    required: z.boolean(),
  })
  .strict();

export const dynamicResearchPlanSchema = z
  .object({
    domain: expertiseProfileSchema.shape.domain,
    subdomain: z.string().trim().min(1).max(240),
    taskType: z.string().trim().min(1).max(240),
    selectedMode: z.enum(selectedAnalysisModeValues),
    tasks: z.array(dynamicResearchTaskSchema).max(12),
    skippedTopics: z.array(z.string().trim().min(1).max(180)).max(16),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type DynamicResearchPlan = z.infer<typeof dynamicResearchPlanSchema>;
export type DynamicResearchTask = z.infer<typeof dynamicResearchTaskSchema>;

type ExtractedFact = {
  field?: string;
  label?: string;
  value?: string;
  verified?: boolean;
};

type AvailableEvidence = {
  field?: string;
  url?: string;
  confidence?: number;
  authorityLevel?: string;
  label?: string;
  supportedIssue?: string;
  proposition?: string;
};

type ResearchPlanInput = {
  expertiseProfile: ExpertiseProfile;
  reportPlan: DynamicReportPlan;
  selectedMode?: unknown;
  prompt?: string;
  extractedFacts?: readonly ExtractedFact[];
  clarificationAnswers?: Record<string, unknown>;
  availableEvidence?: readonly AvailableEvidence[];
};

type TaskSeed = Omit<DynamicResearchTask, "decisionCriterion" | "jurisdiction"> & {
  criterionHints: string[];
};

const unsupportedTopicPatterns: Partial<
  Record<ExpertiseProfile["domain"], RegExp>
> = {
  legal:
    /\b(?:cac|product[- ]market fit|startup funding|market size|saas|customer acquisition)\b/i,
  real_estate:
    /\b(?:cac|product[- ]market fit|startup funding|saas|unrelated legal claim|employee retaliation)\b/i,
  finance:
    /\b(?:zoning|cadastral|title deed|employment claim|product[- ]market fit)\b/i,
  accounting:
    /\b(?:zoning|cadastral|title deed|employment claim|product[- ]market fit)\b/i,
  retail:
    /\b(?:zoning|cadastral|title deed|employment claim|saas metrics)\b/i,
};

function normalizeIdentity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function uniqueText(values: readonly string[], limit: number) {
  const seen = new Set<string>();
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => {
      const identity = normalizeIdentity(value);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, limit);
}

function sectionId(
  reportPlan: DynamicReportPlan,
  candidates: readonly string[]
) {
  return (
    candidates.find((candidate) =>
      reportPlan.sections.some((section) => section.id === candidate)
    ) ||
    reportPlan.sections.find((section) => section.priority === "critical")?.id ||
    reportPlan.sections[0].id
  );
}

function criterion(
  reportPlan: DynamicReportPlan,
  hints: readonly string[]
) {
  const candidates = [
    ...reportPlan.decisionGates.map((gate) => gate.id),
    ...reportPlan.decisionCriteria,
  ];
  return (
    candidates.find((candidate) =>
      hints.some((hint) => normalizeIdentity(candidate).includes(normalizeIdentity(hint)))
    ) || candidates[0] || "evidence_sufficiency"
  );
}

function entityContext(facts: readonly ExtractedFact[]) {
  return uniqueText(
    facts
      .filter((fact) => fact.value?.trim())
      .map((fact) => `${fact.label || fact.field || "entity"} ${fact.value}`),
    8
  )
    .join(" ")
    .slice(0, 260);
}

function q(...parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function task(
  seed: Omit<TaskSeed, "queries"> & { queries: string[] }
): TaskSeed {
  return {
    ...seed,
    queries: uniqueText(seed.queries, 3),
  };
}

function hasSufficientEvidence(
  evidenceField: string,
  availableEvidence: readonly AvailableEvidence[]
) {
  return availableEvidence.some((item) => {
    const verifiedLabel = /verified from (?:official|external) source/i.test(
      item.label || ""
    );
    const usableUrl = /^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(item.url || "");
    const supportedClaim = Boolean(
      item.proposition?.trim() || item.supportedIssue?.trim()
    );
    return (
      item.field === evidenceField &&
      usableUrl &&
      verifiedLabel &&
      supportedClaim &&
      (item.confidence || 0) >= 0.75
    );
  });
}

function createLegalSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan
): TaskSeed[] {
  const jurisdiction = profile.jurisdiction || "applicable jurisdiction";
  const sources = ["official_government", "statute", "regulator"] as const;
  return [
    task({
      id: "employment_overtime_rules",
      topic: `${jurisdiction} overtime rules`,
      purpose: "Verify overtime entitlement and the legal elements of an unpaid-overtime claim.",
      reportSectionId: sectionId(reportPlan, ["unpaid_overtime", "claim_analysis"]),
      evidenceField: "legal_overtime",
      priority: "critical",
      preferredSourceTypes: [...sources],
      queries: [q(jurisdiction, "overtime rules unpaid overtime official"), q(jurisdiction, "labor code overtime official")],
      required: true,
      criterionHints: ["claim", "overtime", "evidence"],
    }),
    task({
      id: "employment_exemption_rules",
      topic: `${jurisdiction} employee exemption criteria`,
      purpose: "Assess whether the reported exempt classification could satisfy the applicable duties and compensation tests.",
      reportSectionId: sectionId(reportPlan, ["exempt_status", "claim_analysis"]),
      evidenceField: "legal_exempt_status",
      priority: "critical",
      preferredSourceTypes: ["official_government", "regulation", "regulator"],
      queries: [q(jurisdiction, "employee exemption duties salary test official"), q(jurisdiction, "computer professional exemption overtime official")],
      required: true,
      criterionHints: ["claim", "classification", "evidence"],
    }),
    task({
      id: "employment_retaliation_rules",
      topic: `${jurisdiction} employment retaliation protections`,
      purpose: "Verify protected activity, adverse-action and causation requirements relevant to the reported retaliation theory.",
      reportSectionId: sectionId(reportPlan, ["retaliation", "claim_analysis"]),
      evidenceField: "legal_retaliation",
      priority: "critical",
      preferredSourceTypes: ["official_government", "statute", "regulator", "official_court"],
      queries: [q(jurisdiction, "wage complaint retaliation protection official"), q(jurisdiction, "employment retaliation elements official court")],
      required: true,
      criterionHints: ["claim", "retaliation", "evidence"],
    }),
    task({
      id: "employment_filing_deadlines",
      topic: `${jurisdiction} employment filing deadlines`,
      purpose: "Identify verified limitation periods and procedural deadlines that could affect claim viability.",
      reportSectionId: sectionId(reportPlan, ["deadline_risks", "immediate_actions"]),
      evidenceField: "legal_limitation_deadlines",
      priority: "critical",
      preferredSourceTypes: ["official_government", "statute", "regulator", "official_court"],
      queries: [q(jurisdiction, "employment wage retaliation filing deadline official"), q(jurisdiction, "statute of limitations employment claim official")],
      required: true,
      criterionHints: ["deadline", "open", "urgency"],
    }),
    task({
      id: "employment_record_rights",
      topic: `${jurisdiction} payroll and personnel-record rights`,
      purpose: "Verify record-retention, inspection and evidence-preservation rules relevant to proving the claims.",
      reportSectionId: sectionId(reportPlan, ["evidence_strength", "material_facts"]),
      evidenceField: "legal_evidence_preservation",
      priority: "high",
      preferredSourceTypes: ["official_government", "regulation", "regulator"],
      queries: [q(jurisdiction, "employee payroll time personnel records access official"), q(jurisdiction, "employment evidence preservation official")],
      required: false,
      criterionHints: ["evidence", "support"],
    }),
    task({
      id: "employment_agency_court_routes",
      topic: `${jurisdiction} employment agency and court routes`,
      purpose: "Verify the available agency, court and dispute-resolution routes for the identified claims.",
      reportSectionId: sectionId(reportPlan, ["resolution_strategy", "immediate_actions"]),
      evidenceField: "legal_filing_routes",
      priority: "high",
      preferredSourceTypes: ["official_government", "regulator", "official_court"],
      queries: [q(jurisdiction, "employment wage claim agency court filing official"), q(jurisdiction, "labor complaint filing route official")],
      required: false,
      criterionHints: ["action", "route", "deadline"],
    }),
    task({
      id: "employment_final_pay_rules",
      topic: `${jurisdiction} final-pay obligations`,
      purpose: "Verify final-wage and accrued-benefit payment duties that may create a separate claim.",
      reportSectionId: sectionId(reportPlan, ["claim_analysis", "immediate_actions"]),
      evidenceField: "legal_final_pay",
      priority: "high",
      preferredSourceTypes: ["official_government", "statute", "regulator"],
      queries: [q(jurisdiction, "termination final wages accrued vacation official"), q(jurisdiction, "final pay deadline labor agency official")],
      required: false,
      criterionHints: ["claim", "evidence"],
    }),
    task({
      id: "employment_primary_case_law",
      topic: `${jurisdiction} employment case law`,
      purpose: "Find primary court authority that interprets the material overtime, classification or retaliation issues.",
      reportSectionId: sectionId(reportPlan, ["claim_analysis", "sources_limitations"]),
      evidenceField: "legal_case_law",
      priority: "high",
      preferredSourceTypes: ["official_court", "primary_authority"],
      queries: [q(jurisdiction, "official court overtime exemption retaliation decision"), q(jurisdiction, "employment wage case law official court")],
      required: false,
      criterionHints: ["claim", "evidence"],
    }),
  ];
}

function createRealEstateSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan,
  facts: readonly ExtractedFact[]
): TaskSeed[] {
  const place = q(profile.jurisdiction, entityContext(facts));
  return [
    task({ id: "property_location_context", topic: "Administrative and cadastral context", purpose: "Verify the property's administrative location and public cadastral context.", reportSectionId: sectionId(reportPlan, ["property_facts", "infrastructure_location"]), evidenceField: "location", priority: "high", preferredSourceTypes: ["cadastral_authority", "municipality", "official_government"], queries: [q(place, "administrative cadastral location official")], required: false, criterionHints: ["title", "location", "identity"] }),
    task({ id: "property_zoning_planning", topic: "Parcel zoning and planning records", purpose: "Verify parcel-specific land use, plan notes and development constraints.", reportSectionId: sectionId(reportPlan, ["zoning_land_use"]), evidenceField: "zoning", priority: "critical", preferredSourceTypes: ["municipality", "planning_authority", "official_government"], queries: [q(place, "parcel zoning land use plan notes official"), q(place, "municipality development plan official")], required: true, criterionHints: ["zoning", "compatible"] }),
    task({ id: "property_regional_development", topic: "Regional development plans", purpose: "Identify verified regional plans or projects that materially affect development potential.", reportSectionId: sectionId(reportPlan, ["regional_development", "infrastructure_location"]), evidenceField: "regional_development", priority: "high", preferredSourceTypes: ["municipality", "planning_authority", "official_government"], queries: [q(place, "regional development transport public projects official")], required: false, criterionHints: ["development", "opportunity"] }),
    task({ id: "property_hazards", topic: "Environmental and geological hazards", purpose: "Verify location-specific seismic, flood, landslide, soil and environmental hazards.", reportSectionId: sectionId(reportPlan, ["environmental_geological"]), evidenceField: "hazards", priority: "critical", preferredSourceTypes: ["hazard_authority", "official_government", "municipality"], queries: [q(place, "seismic flood landslide geological hazard official"), q(place, "disaster risk map official")], required: true, criterionHints: ["hazard", "risk"] }),
    task({ id: "property_access_infrastructure", topic: "Access and infrastructure", purpose: "Verify legal road access and immediate-area utility and transport evidence.", reportSectionId: sectionId(reportPlan, ["access", "infrastructure_location"]), evidenceField: "access", priority: "critical", preferredSourceTypes: ["cadastral_authority", "municipality", "official_government"], queries: [q(place, "legal road access cadastral official"), q(place, "electricity water sewer infrastructure official")], required: true, criterionHints: ["access", "verified"] }),
    task({ id: "property_comparables", topic: "Comparable land market evidence", purpose: "Find dated and genuinely comparable local land listings or transactions with area, currency and price details.", reportSectionId: sectionId(reportPlan, ["comparables", "valuation_inputs"]), evidenceField: "comparables", priority: "critical", preferredSourceTypes: ["dated_comparable", "credible_market_data", "official_filing"], queries: [q(place, "comparable land listing sale area price currency"), q(place, "land transaction square metre price dated")], required: true, criterionHints: ["valuation", "supported"] }),
    task({ id: "property_liquidity_demand", topic: "Local liquidity and demand", purpose: "Assess listing depth, transaction activity and demand indicators without treating absence of results as negative evidence.", reportSectionId: sectionId(reportPlan, ["liquidity", "comparables"]), evidenceField: "liquidity", priority: "high", preferredSourceTypes: ["official_statistics", "credible_market_data", "dated_comparable"], queries: [q(place, "land demand transaction activity listings liquidity"), q(place, "population development demand official statistics")], required: false, criterionHints: ["liquidity", "market"] }),
  ];
}

function createFinanceSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan,
  facts: readonly ExtractedFact[]
): TaskSeed[] {
  const entity = entityContext(facts);
  const place = profile.jurisdiction;
  return [
    task({ id: "finance_official_filings", topic: "Official and audited financial disclosures", purpose: "Verify available issuer filings and audited financial disclosures relevant to the analysed entity and period.", reportSectionId: sectionId(reportPlan, ["revenue_quality", "profitability", "executive_financial_assessment"]), evidenceField: "company_financials", priority: "critical", preferredSourceTypes: ["official_filing", "audited_statement", "regulator"], queries: [q(entity, place, "audited financial statements official filing"), q(entity, "securities regulator filing")], required: true, criterionHints: ["statement", "period", "evidence"] }),
    task({ id: "finance_industry_benchmarks", topic: "Recognized financial benchmarks", purpose: "Find comparable margins, leverage and operating benchmarks from recognized financial sources.", reportSectionId: sectionId(reportPlan, ["profitability", "leverage", "financial_risks"]), evidenceField: "industry_benchmarks", priority: "high", preferredSourceTypes: ["official_filing", "regulator", "credible_market_data"], queries: [q(place, entity, "industry margin leverage benchmark filing"), q(place, "sector operating benchmark regulator")], required: false, criterionHints: ["benchmark", "risk"] }),
    task({ id: "finance_macro_inputs", topic: "Official macroeconomic inputs", purpose: "Verify exchange-rate, inflation and interest-rate inputs that materially affect the financial assessment.", reportSectionId: sectionId(reportPlan, ["scenario_analysis", "financial_risks"]), evidenceField: "macro_inputs", priority: "high", preferredSourceTypes: ["official_government", "official_statistics", "regulator"], queries: [q(place, "central bank exchange rate inflation interest rate official")], required: false, criterionHints: ["scenario", "assumption"] }),
  ];
}

function createRetailSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan,
  facts: readonly ExtractedFact[]
): TaskSeed[] {
  const context = q(profile.jurisdiction, entityContext(facts));
  return [
    task({ id: "retail_external_demand", topic: "Retail demand and customer context", purpose: "Verify external demand, customer and local market signals relevant to branch and product decisions.", reportSectionId: sectionId(reportPlan, ["growth_opportunities", "branch_performance"]), evidenceField: "market_demand", priority: "high", preferredSourceTypes: ["official_statistics", "credible_market_data", "company_source"], queries: [q(context, "retail demand customer spending official statistics"), q(context, "retail category demand dated market data")], required: false, criterionHints: ["growth", "demand"] }),
    task({ id: "retail_competitive_products", topic: "Comparable retailers and product offers", purpose: "Verify current competing formats, product offers and public pricing relevant to the selected market.", reportSectionId: sectionId(reportPlan, ["product_performance", "growth_opportunities"]), evidenceField: "competitors", priority: "high", preferredSourceTypes: ["company_source", "credible_market_data", "dated_comparable"], queries: [q(context, "retail competitors product pricing official"), q(context, "comparable retailer assortment dated")], required: false, criterionHints: ["product", "growth"] }),
    task({ id: "retail_company_sources", topic: "Company and branch disclosures", purpose: "Verify public company, branch, product and pricing facts without replacing the uploaded dataset.", reportSectionId: sectionId(reportPlan, ["branch_performance", "product_performance"]), evidenceField: "company_evidence", priority: "standard", preferredSourceTypes: ["company_source", "official_filing"], queries: [q(context, "company branch product pricing official")], required: false, criterionHints: ["branch", "product"] }),
    task({ id: "retail_inventory_benchmarks", topic: "Retail inventory benchmarks", purpose: "Find recognized category-level turnover or stock benchmarks only where externally comparable.", reportSectionId: sectionId(reportPlan, ["inventory_turnover", "weak_products"]), evidenceField: "industry_benchmarks", priority: "standard", preferredSourceTypes: ["official_statistics", "credible_market_data", "professional_standard"], queries: [q(context, "retail inventory turnover category benchmark")], required: false, criterionHints: ["inventory", "turnover"] }),
  ];
}

function createMarketIntelligenceSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan,
  facts: readonly ExtractedFact[],
  prompt = ""
): TaskSeed[] {
  const context = q(
    profile.jurisdiction,
    entityContext(facts),
    prompt.replace(/\s+/g, " ").trim().slice(0, 150)
  );
  const taxonomyTerms = expandMarketTaxonomyTerms(prompt);
  const categoryQuery = taxonomyTerms.slice(0, 6).join(" OR ");
  const adjacentQuery = taxonomyTerms.slice(6, 12).join(" OR ");

  return [
    task({
      id: "market_vendor_discovery",
      topic: "Multi-source vendor discovery",
      purpose:
        "Discover 10–30 evidence-supported vendors where available by reconciling independent directories, analyst coverage, industry publications, filings, and official company sources.",
      reportSectionId: sectionId(reportPlan, ["major_players", "competitive_landscape", "competition"]),
      evidenceField: "vendor_discovery",
      priority: "critical",
      preferredSourceTypes: ["credible_market_data", "professional_standard", "company_source", "official_filing"],
      queries: [
        q(context, categoryQuery, "vendors alternatives directory market map"),
        q(context, adjacentQuery, "software companies vendor landscape comparison"),
        q(context, "vendor list analyst report industry publication competitors"),
      ],
      required: true,
      criterionHints: ["competition", "market", "evidence"],
    }),
    task({
      id: "market_competitor_landscape",
      topic: "Independent competitor landscape",
      purpose:
        "Identify multiple relevant competitors dynamically and compare their verified market role, positioning, products, and pricing without over-weighting one company.",
      reportSectionId: sectionId(reportPlan, ["competitive_landscape", "major_players", "competition"]),
      evidenceField: "competitors",
      priority: "critical",
      preferredSourceTypes: ["company_source", "official_filing", "credible_market_data"],
      queries: [
        q(context, categoryQuery, "leading competitors vendors independent sources"),
        q(context, categoryQuery, "competitor products pricing official company pages"),
        q(context, "competitor annual report investor filing market position"),
      ],
      required: true,
      criterionHints: ["competition", "market", "evidence"],
    }),
    task({
      id: "market_official_demand",
      topic: "Official demand and adoption evidence",
      purpose:
        "Verify demand, adoption, customer, and business-population signals from government, statistical, regulatory, or industry-association sources.",
      reportSectionId: sectionId(reportPlan, ["market_overview", "market_drivers", "customer_segments"]),
      evidenceField: "market_demand",
      priority: "critical",
      preferredSourceTypes: ["official_statistics", "official_government", "regulator", "credible_market_data"],
      queries: [
        q(context, "demand adoption customers official statistics government"),
        q(context, "industry association adoption survey market demand"),
      ],
      required: true,
      criterionHints: ["market", "demand", "evidence"],
    }),
    task({
      id: "market_size_endpoints",
      topic: "Verifiable market-size endpoints",
      purpose:
        "Find compatible market-size or growth endpoints with geography, period, currency, definition, and methodology; preserve an explicit gap when no reliable endpoint exists.",
      reportSectionId: sectionId(reportPlan, ["market_size", "tam_sam_som", "cagr"]),
      evidenceField: "market_size",
      priority: "high",
      preferredSourceTypes: ["official_statistics", "credible_market_data", "official_filing"],
      queries: [
        q(context, categoryQuery, "market size CAGR methodology geography year analyst report"),
        q(context, categoryQuery, "official statistics market revenue spending adoption"),
        q(context, "industry association public filing annual report market size"),
      ],
      required: false,
      criterionHints: ["market", "size", "evidence"],
    }),
    task({
      id: "market_industry_structure",
      topic: "Industry structure and independent analysis",
      purpose:
        "Verify market structure, trends, regulation, switching costs, and buyer behavior across independent research, associations, and credible publications.",
      reportSectionId: sectionId(reportPlan, ["industry_trends", "porters_five_forces", "barriers"]),
      evidenceField: "industry_structure",
      priority: "high",
      preferredSourceTypes: ["credible_market_data", "professional_standard", "regulator", "official_statistics"],
      queries: [
        q(context, "industry trends buyer behavior switching costs association research"),
        q(context, "regulation technology financial publication market analysis"),
      ],
      required: false,
      criterionHints: ["market", "risk", "evidence"],
    }),
    task({
      id: "market_pricing_intelligence",
      topic: "Vendor pricing intelligence",
      purpose:
        "Collect current public subscription, seat, usage, enterprise, transaction, success-fee, and hybrid pricing evidence from distinct vendor-owned sources without inferring missing prices.",
      reportSectionId: sectionId(reportPlan, ["major_players", "competitive_landscape", "market_segmentation"]),
      evidenceField: "pricing_models",
      priority: "high",
      preferredSourceTypes: ["company_source", "credible_market_data"],
      queries: [
        q(context, categoryQuery, "official pricing subscription per seat usage transaction"),
        q(context, adjacentQuery, "vendor pricing plans enterprise quote official"),
        q(context, "pricing page packages plans official vendors"),
      ],
      required: false,
      criterionHints: ["product", "competition", "market"],
    }),
    task({
      id: "market_product_evidence",
      topic: "Product and pricing evidence",
      purpose:
        "Verify current product scope, deployment, integrations, and public pricing directly from multiple relevant company sources.",
      reportSectionId: sectionId(reportPlan, ["market_segmentation", "major_players", "competitive_landscape"]),
      evidenceField: "product_evidence",
      priority: "high",
      preferredSourceTypes: ["company_source", "credible_market_data"],
      queries: [
        q(context, "competitor product features integrations pricing official"),
        q(context, "software product comparison customer segments deployment official"),
      ],
      required: false,
      criterionHints: ["product", "competition", "market"],
    }),
    task({
      id: "market_company_filings",
      topic: "Company filings and investor evidence",
      purpose:
        "Collect primary company and filing evidence across relevant public competitors without treating one issuer as representative of the entire market.",
      reportSectionId: sectionId(reportPlan, ["major_players", "competitive_landscape", "market_overview"]),
      evidenceField: "company_evidence",
      priority: "high",
      preferredSourceTypes: ["official_filing", "audited_statement", "company_source", "regulator"],
      queries: [
        q(context, "competitors SEC filing annual report investor relations"),
        q(context, "public company filing market competition revenue segment"),
      ],
      required: false,
      criterionHints: ["competition", "company", "evidence"],
    }),
  ];
}

function createGenericSeeds(
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan,
  facts: readonly ExtractedFact[]
): TaskSeed[] {
  const context = q(profile.jurisdiction, entityContext(facts));
  return reportPlan.sections
    .filter((section) => section.priority === "critical")
    .slice(0, 8)
    .map((section, index) =>
      task({
        id: `research_${section.id}_${index + 1}`.slice(0, 80),
        topic: section.title,
        purpose: section.purpose,
        reportSectionId: section.id,
        evidenceField: section.id,
        priority: "critical",
        preferredSourceTypes: ["official_government", "primary_authority", "credible_market_data"],
        queries: [q(context, section.title, "official evidence")],
        required: true,
        criterionHints: [section.id, section.title],
      })
    );
}

function seedTasks(input: ResearchPlanInput) {
  const { expertiseProfile, reportPlan, extractedFacts = [] } = input;
  if (
    expertiseProfile.domain === "legal" &&
    expertiseProfile.subdomain === "employment_law"
  ) {
    return createLegalSeeds(expertiseProfile, reportPlan);
  }
  if (expertiseProfile.domain === "real_estate") {
    return createRealEstateSeeds(expertiseProfile, reportPlan, extractedFacts);
  }
  const selectedMode = normalizeSelectedAnalysisMode(input.selectedMode);
  const isMarketIntelligenceRequest =
    selectedMode === "market" &&
    (/(?:\bmarket\b|competitors?|competitive landscape|industry landscape|\bTAM\b|\bSAM\b|\bSOM\b|\bCAGR\b)/i.test(
      input.prompt || ""
    ) ||
      reportPlan.sections.some((section) =>
        /market|compet|industry|customer|segment|trend|tam|sam|som|cagr/i.test(
          `${section.id} ${section.title}`
        )
      ));
  if (isMarketIntelligenceRequest) {
    return createMarketIntelligenceSeeds(
      expertiseProfile,
      reportPlan,
      extractedFacts,
      input.prompt
    );
  }
  if (
    expertiseProfile.domain === "finance" ||
    expertiseProfile.domain === "accounting"
  ) {
    return createFinanceSeeds(expertiseProfile, reportPlan, extractedFacts);
  }
  if (expertiseProfile.domain === "retail") {
    return createRetailSeeds(expertiseProfile, reportPlan, extractedFacts);
  }
  return createGenericSeeds(expertiseProfile, reportPlan, extractedFacts);
}

function taskIsCompatible(
  task: DynamicResearchTask,
  profile: ExpertiseProfile,
  reportPlan: DynamicReportPlan
) {
  const sectionExists = reportPlan.sections.some(
    (section) => section.id === task.reportSectionId
  );
  const criteria = new Set(
    [
      ...reportPlan.decisionCriteria,
      ...reportPlan.decisionGates.flatMap((gate) => [gate.id, gate.condition]),
    ].map(normalizeIdentity)
  );
  const criterionExists = criteria.has(normalizeIdentity(task.decisionCriterion));
  const topicText = `${task.topic} ${task.purpose} ${task.evidenceField} ${task.queries.join(" ")}`;
  const forbiddenByProfile = profile.forbiddenTopics.some((topic) =>
    normalizeIdentity(topicText).includes(normalizeIdentity(topic))
  );
  const forbiddenByDomain =
    unsupportedTopicPatterns[profile.domain]?.test(topicText) ?? false;

  return (
    sectionExists &&
    criterionExists &&
    !forbiddenByProfile &&
    !forbiddenByDomain
  );
}

function normalizeTasks(
  tasks: readonly DynamicResearchTask[],
  input: ResearchPlanInput,
  limit: number
) {
  const seenTasks = new Set<string>();
  const seenQueries = new Set<string>();
  const availableEvidence = input.availableEvidence || [];
  return tasks
    .filter((item) => taskIsCompatible(item, input.expertiseProfile, input.reportPlan))
    .filter((item) => !hasSufficientEvidence(item.evidenceField, availableEvidence))
    .flatMap((item) => {
      const identity = normalizeIdentity(
        `${item.reportSectionId} ${item.evidenceField} ${item.topic}`
      );
      if (seenTasks.has(identity)) return [];
      seenTasks.add(identity);
      const queries = item.queries.filter((query) => {
        const queryIdentity = normalizeIdentity(query);
        if (!queryIdentity || seenQueries.has(queryIdentity)) return false;
        seenQueries.add(queryIdentity);
        return true;
      });
      return queries.length ? [{ ...item, queries }] : [];
    })
    .sort((left, right) => {
      const rank = { critical: 3, high: 2, standard: 1 } as const;
      const mode = normalizeSelectedAnalysisMode(input.selectedMode);
      const emphasis =
        mode === "plan"
          ? /feasib|business|customer|execution|financial|risk/i
          : mode === "market"
            ? /market|demand|compet|pricing|comparable|liquidity|trend/i
            : /decision|risk|deadline|evidence|action|route/i;
      const leftScore = rank[left.priority] * 10 + (emphasis.test(`${left.topic} ${left.purpose}`) ? 1 : 0);
      const rightScore = rank[right.priority] * 10 + (emphasis.test(`${right.topic} ${right.purpose}`) ? 1 : 0);
      return rightScore - leftScore;
    })
    .slice(0, limit);
}

export function createDynamicResearchPlanFallback(
  input: ResearchPlanInput
): DynamicResearchPlan {
  const selectedMode = normalizeSelectedAnalysisMode(input.selectedMode);
  const answerFacts = Object.entries(input.clarificationAnswers || {}).flatMap(
    ([field, value]) =>
      typeof value === "string" && value.trim()
        ? [{ field, label: field, value: value.trim().slice(0, 240) }]
        : []
  );
  const planningInput = {
    ...input,
    extractedFacts: [...(input.extractedFacts || []), ...answerFacts],
  };
  const seeds = seedTasks(planningInput).map(({ criterionHints, ...seed }) => ({
    ...seed,
    jurisdiction: input.expertiseProfile.jurisdiction,
    decisionCriterion: criterion(input.reportPlan, criterionHints),
  }));
  const unresolvedCriticalSections = input.reportPlan.sections.filter(
    (section) =>
      section.priority === "critical" &&
      !section.requiredEvidenceTypes.every((type) =>
        type === "user_statement" || type === "uploaded_document"
      )
  ).length;
  const limit = unresolvedCriticalSections >= 6 ? 12 : 8;
  const tasks = normalizeTasks(seeds, planningInput, limit);
  const skippedTopics = uniqueText(
    seeds
      .filter((seed) =>
        hasSufficientEvidence(seed.evidenceField, input.availableEvidence || [])
      )
      .map((seed) => `${seed.topic}: already_supported`),
    16
  );

  return {
    domain: input.expertiseProfile.domain,
    subdomain: input.expertiseProfile.subdomain,
    taskType: input.expertiseProfile.taskType,
    selectedMode,
    tasks,
    skippedTopics,
    confidence: tasks.length ? Math.min(0.92, 0.55 + tasks.length * 0.04) : 0.45,
  };
}

export function resolveDynamicResearchPlan({
  value,
  fallback,
  ...input
}: ResearchPlanInput & { value: unknown; fallback: DynamicResearchPlan }) {
  const parsed = dynamicResearchPlanSchema.safeParse(value);
  const selectedMode = normalizeSelectedAnalysisMode(input.selectedMode);
  if (!parsed.success) return fallback;
  const candidate = parsed.data;
  if (
    candidate.domain !== input.expertiseProfile.domain ||
    candidate.subdomain !== input.expertiseProfile.subdomain ||
    candidate.taskType !== input.expertiseProfile.taskType ||
    candidate.selectedMode !== selectedMode
  ) {
    return fallback;
  }
  const criticalUnresolved = input.reportPlan.sections.filter(
    (section) => section.priority === "critical"
  ).length;
  const limit = criticalUnresolved >= 6 ? 12 : 8;
  const tasks = normalizeTasks(candidate.tasks, input, limit);
  return tasks.length || fallback.tasks.length === 0
    ? {
        ...candidate,
        tasks,
        skippedTopics: uniqueText(
          [...candidate.skippedTopics, ...fallback.skippedTopics],
          16
        ),
      }
    : fallback;
}

export function dynamicResearchPlanToDecisionTasks(
  plan: DynamicResearchPlan
): ResearchTask[] {
  return plan.tasks.map((task) => ({
    id: task.id,
    field: task.evidenceField,
    priority: task.priority === "standard" ? "medium" : task.priority,
    reason: `${task.purpose} Report section: ${task.reportSectionId}. Decision criterion: ${task.decisionCriterion}.`,
    query: task.queries[0],
    queryVariants: task.queries,
    provider: "auto",
    status: "skipped_with_reason",
    statusReason: "Awaiting existing provider selection and execution.",
    confidence: 0,
    required: task.required,
    preferredSources: task.preferredSourceTypes.map((source) =>
      source.replaceAll("_", " ")
    ),
    jurisdiction: task.jurisdiction,
  }));
}

export function formatDynamicResearchPlanForContext(
  plan: DynamicResearchPlan
) {
  return [
    "Private dynamic research plan. Never render this block, task IDs, skipped topics, or planner schema to the user.",
    `Selected mode: ${plan.selectedMode}.`,
    ...plan.tasks.map(
      (task) =>
        `- ${task.topic}: ${task.purpose} | section ${task.reportSectionId} | criterion ${task.decisionCriterion}`
    ),
  ].join("\n");
}

export function createDynamicResearchPlanObjectJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      domain: { type: "string", enum: [...expertiseDomainValues] },
      subdomain: { type: "string" },
      taskType: { type: "string" },
      selectedMode: { type: "string", enum: [...selectedAnalysisModeValues] },
      tasks: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            purpose: { type: "string" },
            reportSectionId: { type: "string" },
            decisionCriterion: { type: "string" },
            evidenceField: { type: "string" },
            priority: { type: "string", enum: [...researchPriorityValues] },
            preferredSourceTypes: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: { type: "string", enum: [...preferredSourceTypeValues] },
            },
            jurisdiction: { type: "string" },
            queries: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
            required: { type: "boolean" },
          },
          required: ["id", "topic", "purpose", "reportSectionId", "decisionCriterion", "evidenceField", "priority", "preferredSourceTypes", "jurisdiction", "queries", "required"],
        },
      },
      skippedTopics: { type: "array", maxItems: 16, items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["domain", "subdomain", "taskType", "selectedMode", "tasks", "skippedTopics", "confidence"],
  } as const;
}
