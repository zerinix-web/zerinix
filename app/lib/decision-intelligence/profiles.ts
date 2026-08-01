import type {
  DecisionDomain,
  DomainDecisionRule,
  DomainProfile,
  DomainResearchRequirement,
} from "./contracts";

const requirement = (
  field: string,
  reason: string,
  preferredSources: string[],
  priority: DomainResearchRequirement["priority"] = "high",
  required = true
): DomainResearchRequirement => ({
  field,
  reason,
  preferredSources,
  priority,
  required,
});

const rule = (
  id: string,
  label: string,
  evidenceFields: string[],
  riskFields: string[],
  weight: number
): DomainDecisionRule => ({
  id,
  label,
  evidenceFields,
  riskFields,
  weight,
});

const sharedBusinessResearch = [
  requirement(
    "company_evidence",
    "Verify the organization, offering, leadership, pricing, and public claims.",
    ["official company website", "company registry", "regulatory filing"]
  ),
  requirement(
    "market_demand",
    "Verify demand, customer behavior, market boundaries, and growth drivers.",
    ["statistics authority", "regulator", "industry association"]
  ),
  requirement(
    "competitors",
    "Verify competitors, substitutes, positioning, and public pricing.",
    ["official company website", "company filing", "regulator"]
  ),
];

const genericRules = [
  rule("evidence", "Evidence Strength", [], [], 0.35),
  rule("risk", "Risk Exposure", [], [], 0.3),
  rule("opportunity", "Decision Opportunity", [], [], 0.2),
  rule("execution", "Execution Readiness", [], [], 0.15),
];

const profiles: Record<DecisionDomain, DomainProfile> = {
  real_estate: {
    id: "real_estate",
    label: "Real Estate",
    signals: [
      /\b(real[\s-]?estate|property|land|parcel|plot|title deed|land registry|cadastral|zoning|tapu|arsa|arazi|parsel|gayrimenkul|taşınmaz|imar|kadastro|emlak)\b/i,
    ],
    criticalEvidence: [
      "asset_identification",
      "location",
      "parcel_size",
      "title_status",
      "zoning",
      "access",
      "infrastructure",
      "hazards",
      "comparables",
      "currency",
      "valuation_method",
      "liquidity",
    ],
    researchRequirements: [
      requirement("asset_identification", "Verify the asset identity against cadastral and registry references.", ["land registry", "cadastral authority", "government map"], "critical"),
      requirement("location", "Verify the administrative and geographic location.", ["land registry", "municipality", "government map"], "critical"),
      requirement("parcel_size", "Verify the official parcel area and measurement unit.", ["land registry", "cadastral authority"], "critical"),
      requirement("title_status", "Verify ownership, encumbrances, annotations, easements, and title limitations.", ["land registry", "official title record"], "critical"),
      requirement("zoning", "Verify official municipal zoning, land use, plan notes, development rights, and applicable planning decisions.", ["municipality zoning portal", "planning authority", "official gazette"], "critical"),
      requirement("access", "Verify the parcel's legal and physical road access, road frontage, rights of way, and transport connections.", ["cadastral authority", "municipality road record", "transport authority", "official maps"], "critical"),
      requirement("infrastructure", "Verify parcel-level electricity, water, sewerage, telecommunications, public services, and planned infrastructure.", ["electricity utility", "water and sewerage authority", "municipality", "official project source"], "critical"),
      requirement("hazards", "Verify parcel-linked seismic, flood, stream, wildfire, contamination, slope, drainage, soil, geological, and environmental risks.", ["AFAD", "DSİ", "MTA", "environmental authority", "municipality geology record"], "critical"),
      requirement("comparables", "Find current same-neighborhood or nearby listings and transactions for similarly qualified land; capture date, area, asking or transaction price, currency, exact URL, and calculated square-metre price.", ["official transaction register", "licensed exchange", "dated property listing"], "critical"),
      requirement("currency", "Verify the currency used by comparable and valuation evidence.", ["official transaction register", "central bank"], "critical"),
      requirement("valuation_method", "Identify an evidence-supported valuation method and its required inputs.", ["valuation standards body", "official transaction register"], "critical"),
      requirement("liquidity", "Assess listing depth, transaction activity, demand, time-to-sale indicators, and the effect of nearby projects and amenities on liquidity.", ["statistics authority", "municipality", "dated market source", "official project source"], "critical"),
      requirement("amenities_projects", "Research nearby transport, schools, hospitals, commercial or industrial zones, and major projects.", ["municipality", "transport authority", "education ministry", "health ministry", "official project source"], "high", false),
      requirement("regional_development", "Research population, development plans, investment activity, and local demand signals.", ["TÜİK", "municipality", "ministry", "regional development agency"], "high", false),
      requirement("geospatial_context", "Research map, satellite, topography, parcel surroundings, and observable land context.", ["official geospatial portal", "cadastral map", "municipality map", "satellite imagery"], "high", false),
    ],
    decisionRules: [
      rule("evidence_quality", "Evidence Quality", [], [], 0.12),
      rule("title_ownership_risk", "Title / Ownership Risk", ["asset_identification", "title_status"], ["title_status"], 0.13),
      rule("zoning_risk", "Zoning Risk", ["zoning"], ["zoning"], 0.13),
      rule("access_infrastructure", "Access and Infrastructure", ["access", "infrastructure", "amenities_projects"], ["access"], 0.1),
      rule("environmental_geotechnical_risk", "Environmental and Geotechnical Risk", ["hazards", "geospatial_context"], ["hazards"], 0.1),
      rule("market_evidence", "Market Evidence", ["comparables", "regional_development"], [], 0.12),
      rule("liquidity", "Liquidity", ["liquidity", "comparables"], [], 0.08),
      rule("development_potential", "Development Potential", ["zoning", "infrastructure", "access", "regional_development"], ["hazards"], 0.1),
      rule("valuation_confidence", "Valuation Confidence", ["location", "parcel_size", "zoning", "comparables", "currency", "valuation_method"], [], 0.12),
    ],
    riskModel: ["title", "zoning", "access", "environmental", "geotechnical", "liquidity"],
    reportTemplate: "real_estate_investment_analysis",
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    signals: [/\b(healthcare|medical|clinical|patient|hospital|drug|medicine|sağlık|tıbbi|hasta|hastane|ilaç)\b/i],
    criticalEvidence: ["clinical_context", "guideline", "contraindications", "patient_safety", "regulatory_status"],
    researchRequirements: [
      requirement("clinical_guidelines", "Verify applicable clinical guidance.", ["health ministry", "WHO", "professional medical society"], "critical"),
      requirement("drug_safety", "Verify interactions, contraindications, and safety notices.", ["medicines regulator", "official formulary", "peer-reviewed research"], "critical"),
      requirement("care_standards", "Verify hospital, diagnostic, and care standards.", ["health authority", "accreditation body", "clinical guideline"]),
    ],
    decisionRules: genericRules,
    riskModel: ["patient_safety", "clinical_uncertainty", "contraindications", "regulatory"],
    reportTemplate: "healthcare_decision_analysis",
  },
  legal: {
    id: "legal",
    label: "Legal",
    signals: [/\b(contract|agreement|clause|legal|liability|indemnity|termination|governing law|sözleşme|hukuk|sorumluluk|tazminat|fesih)\b/i],
    criticalEvidence: ["parties", "governing_law", "obligations", "payment", "termination", "liability", "compliance"],
    researchRequirements: [
      requirement("governing_law", "Verify current governing statutes and regulator guidance.", ["official legislation", "regulator", "court"], "critical"),
      requirement("compliance", "Verify sector-specific compliance, licensing, privacy, and filing duties.", ["regulator", "ministry", "official guidance"], "critical"),
      requirement("market_standard", "Benchmark clauses against authoritative model terms.", ["standards body", "bar association", "government model contract"]),
    ],
    decisionRules: genericRules,
    riskModel: ["enforceability", "liability", "termination", "compliance", "dispute"],
    reportTemplate: "legal_decision_analysis",
  },
  finance: {
    id: "finance",
    label: "Finance",
    signals: [/\b(finance|financial|cash flow|forecast|valuation|portfolio|balance sheet|finans|nakit akışı|değerleme|bilanço)\b/i],
    criticalEvidence: ["currency", "period", "revenue", "costs", "cash_flow", "assumptions", "benchmark"],
    researchRequirements: [
      requirement("macro_inputs", "Verify rates, inflation, exchange rates, and macro assumptions.", ["central bank", "statistics authority", "treasury"], "critical"),
      requirement("industry_benchmarks", "Verify margins, multiples, and operating benchmarks.", ["financial filing", "stock exchange", "regulator"], "critical"),
      requirement("company_financials", "Verify issuer disclosures where applicable.", ["securities regulator", "stock exchange", "audited filing"]),
    ],
    decisionRules: genericRules,
    riskModel: ["liquidity", "solvency", "market", "credit", "assumption"],
    reportTemplate: "financial_decision_analysis",
  },
  accounting: {
    id: "accounting",
    label: "Accounting",
    signals: [/\b(accounting|invoice|ledger|trial balance|tax|vat|ifrs|gaap|muhasebe|fatura|vergi|kdv|defter)\b/i],
    criticalEvidence: ["entity", "period", "currency", "ledger_support", "tax_treatment", "accounting_standard"],
    researchRequirements: [
      requirement("accounting_standard", "Verify recognition, measurement, and disclosure requirements.", ["IFRS Foundation", "accounting standards board", "regulator"], "critical"),
      requirement("tax_treatment", "Verify current tax, VAT, filing, and documentation rules.", ["tax authority", "ministry of finance", "official guidance"], "critical"),
    ],
    decisionRules: genericRules,
    riskModel: ["recognition", "measurement", "tax", "documentation", "control"],
    reportTemplate: "accounting_review",
  },
  operations: {
    id: "operations",
    label: "Operations",
    signals: [/\b(operations|workflow|capacity|inventory|warehouse|quality control|operasyon|iş akışı|kapasite|stok|depo)\b/i],
    criticalEvidence: ["process", "capacity", "demand", "constraints", "service_level", "cost", "compliance"],
    researchRequirements: [
      requirement("standards", "Verify operating, safety, quality, and certification standards.", ["standards body", "regulator", "ministry"], "critical"),
      requirement("benchmarks", "Verify capacity, utilization, lead-time, and service benchmarks.", ["industry association", "academic research", "official statistics"]),
    ],
    decisionRules: genericRules,
    riskModel: ["capacity", "quality", "continuity", "cost", "compliance"],
    reportTemplate: "operations_analysis",
  },
  procurement: {
    id: "procurement",
    label: "Procurement",
    signals: [/\b(procurement|supplier|vendor|tender|rfp|sourcing|purchase order|tedarik|tedarikçi|ihale|satın alma)\b/i],
    criticalEvidence: ["specification", "supplier_identity", "price", "currency", "lead_time", "compliance", "sanctions", "delivery_risk"],
    researchRequirements: [
      requirement("supplier_verification", "Verify identity, registrations, certifications, sanctions, and ownership.", ["company registry", "sanctions authority", "certification body"], "critical"),
      requirement("commercial_benchmark", "Verify pricing, lead times, capacity, and alternatives.", ["official supplier", "commodity exchange", "public tender"], "critical"),
      requirement("regulatory_requirements", "Verify import, safety, labor, and environmental obligations.", ["customs authority", "regulator", "standards body"]),
    ],
    decisionRules: genericRules,
    riskModel: ["supplier", "sanctions", "delivery", "quality", "commercial"],
    reportTemplate: "procurement_analysis",
  },
  manufacturing: {
    id: "manufacturing",
    label: "Manufacturing",
    signals: [/\b(manufacturing|factory|production line|oee|yield|scrap|üretim|fabrika|üretim hattı|fire oranı)\b/i],
    criticalEvidence: ["product", "process", "capacity", "yield", "quality", "cost", "safety"],
    researchRequirements: [
      requirement("technical_standards", "Verify product, process, safety, and quality standards.", ["standards body", "regulator", "certification body"], "critical"),
      requirement("process_benchmarks", "Verify capacity, yield, OEE, defect, and cost benchmarks.", ["industry association", "technical research", "official statistics"]),
    ],
    decisionRules: genericRules,
    riskModel: ["quality", "capacity", "safety", "supply_chain", "capital"],
    reportTemplate: "manufacturing_decision_analysis",
  },
  construction: {
    id: "construction",
    label: "Construction",
    signals: [/\b(construction|building permit|contractor|project schedule|inşaat|yapı ruhsatı|müteahhit|şantiye)\b/i],
    criticalEvidence: ["site", "permit", "scope", "schedule", "budget", "contractor", "safety"],
    researchRequirements: [
      requirement("permits_codes", "Verify permits, building codes, and planning constraints.", ["municipality", "building authority", "official code"], "critical"),
      requirement("cost_schedule", "Verify current material, labor, and schedule benchmarks.", ["statistics authority", "industry association", "public tender"]),
    ],
    decisionRules: genericRules,
    riskModel: ["permit", "cost", "schedule", "contractor", "safety"],
    reportTemplate: "construction_decision_analysis",
  },
  agriculture: {
    id: "agriculture",
    label: "Agriculture",
    signals: [/\b(agriculture|farm|crop|soil|irrigation|tarım|çiftlik|mahsul|toprak|sulama)\b/i],
    criticalEvidence: ["location", "soil", "water", "climate", "crop", "yield", "market"],
    researchRequirements: [
      requirement("agronomic_conditions", "Verify soil, water, climate, disease, and crop suitability.", ["agriculture ministry", "meteorological service", "research institute"], "critical"),
      requirement("market_support", "Verify commodity prices, demand, subsidies, and logistics.", ["commodity exchange", "statistics authority", "agriculture ministry"]),
    ],
    decisionRules: genericRules,
    riskModel: ["climate", "water", "yield", "disease", "price"],
    reportTemplate: "agriculture_decision_analysis",
  },
  logistics: {
    id: "logistics",
    label: "Logistics",
    signals: [/\b(logistics|freight|fleet|route|warehouse|lojistik|nakliye|filo|rota|depo)\b/i],
    criticalEvidence: ["network", "volume", "route", "capacity", "service_level", "cost", "compliance"],
    researchRequirements: [
      requirement("transport_rules", "Verify transport, customs, safety, and operating requirements.", ["transport authority", "customs authority", "regulator"], "critical"),
      requirement("network_benchmarks", "Verify rates, transit times, capacity, and demand.", ["official statistics", "port authority", "industry association"]),
    ],
    decisionRules: genericRules,
    riskModel: ["capacity", "route", "fuel", "customs", "service"],
    reportTemplate: "logistics_decision_analysis",
  },
  energy: {
    id: "energy",
    label: "Energy",
    signals: [/\b(energy|power|electricity|solar|wind|battery|enerji|elektrik|güneş|rüzgar|batarya)\b/i],
    criticalEvidence: ["technology", "site", "capacity", "grid", "tariff", "permit", "resource"],
    researchRequirements: [
      requirement("regulation_grid", "Verify licensing, grid, tariff, and market rules.", ["energy regulator", "grid operator", "ministry"], "critical"),
      requirement("resource_technology", "Verify resource potential, technology performance, and cost benchmarks.", ["energy agency", "technical institute", "manufacturer data"]),
    ],
    decisionRules: genericRules,
    riskModel: ["resource", "grid", "tariff", "technology", "permit"],
    reportTemplate: "energy_decision_analysis",
  },
  technology: {
    id: "technology",
    label: "Technology",
    signals: [/\b(technology|software|saas|platform|app|cybersecurity|teknoloji|yazılım|platform|uygulama|siber güvenlik)\b/i],
    criticalEvidence: ["product", "customer", "market", "competition", "economics", "security", "execution"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["product", "market", "security", "scalability", "execution"],
    reportTemplate: "business_plan",
  },
  automotive: {
    id: "automotive",
    label: "Automotive",
    signals: [/\b(automotive|vehicle|car|ev|charging|otomotiv|araç|otomobil|elektrikli araç|şarj)\b/i],
    criticalEvidence: ["product", "market", "regulation", "supply_chain", "safety", "economics"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["safety", "regulation", "supply_chain", "technology", "demand"],
    reportTemplate: "automotive_decision_analysis",
  },
  retail: {
    id: "retail",
    label: "Retail",
    signals: [/\b(retail|store|shop|merchandising|perakende|mağaza|mağazacılık)\b/i],
    criticalEvidence: ["format", "location", "customer", "demand", "competition", "margin", "inventory"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["location", "demand", "margin", "inventory", "competition"],
    reportTemplate: "business_plan",
  },
  ecommerce: {
    id: "ecommerce",
    label: "E-commerce",
    signals: [/\b(e[\s-]?commerce|online store|marketplace seller|e-ticaret|online mağaza)\b/i],
    criticalEvidence: ["product", "customer", "channel", "demand", "competition", "margin", "fulfillment"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["acquisition", "margin", "returns", "platform", "fulfillment"],
    reportTemplate: "business_plan",
  },
  restaurant: {
    id: "restaurant",
    label: "Restaurant",
    signals: [/\b(restaurant|cafe|food service|menu|restoran|kafe|yemek hizmeti|menü)\b/i],
    criticalEvidence: ["concept", "location", "customer", "competition", "menu_economics", "permit"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["location", "food_cost", "labor", "permit", "demand"],
    reportTemplate: "business_plan",
  },
  hospitality: {
    id: "hospitality",
    label: "Hospitality and Tourism",
    signals: [/\b(hospitality|hotel|tourism|travel|konaklama|otel|turizm|seyahat)\b/i],
    criticalEvidence: ["property", "location", "demand", "seasonality", "competition", "rate", "permit"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["seasonality", "occupancy", "location", "regulation", "capital"],
    reportTemplate: "hospitality_decision_analysis",
  },
  education: {
    id: "education",
    label: "Education",
    signals: [/\b(education|school|course|curriculum|student|eğitim|okul|kurs|müfredat|öğrenci)\b/i],
    criticalEvidence: ["learner", "outcome", "curriculum", "delivery", "accreditation", "demand"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["outcomes", "accreditation", "demand", "delivery", "privacy"],
    reportTemplate: "education_decision_analysis",
  },
  insurance: {
    id: "insurance",
    label: "Insurance",
    signals: [/\b(insurance|policy|premium|claim|underwriting|sigorta|poliçe|prim|hasar|aktüerya)\b/i],
    criticalEvidence: ["policy", "coverage", "exclusion", "premium", "claim", "regulation"],
    researchRequirements: [
      requirement("insurance_rules", "Verify policy, product, disclosure, and claims rules.", ["insurance regulator", "official legislation", "ombudsman"], "critical"),
      requirement("market_benchmarks", "Verify loss, pricing, and product benchmarks.", ["regulator statistics", "insurer filing", "industry association"]),
    ],
    decisionRules: genericRules,
    riskModel: ["coverage", "exclusion", "claim", "counterparty", "regulatory"],
    reportTemplate: "insurance_decision_analysis",
  },
  government: {
    id: "government",
    label: "Government",
    signals: [/\b(government|public sector|municipality|ministry|kamu|belediye|bakanlık)\b/i],
    criticalEvidence: ["authority", "mandate", "budget", "procurement", "compliance", "stakeholder"],
    researchRequirements: [
      requirement("authority_rules", "Verify mandate, legislation, policy, and official procedure.", ["official gazette", "ministry", "municipality"], "critical"),
      requirement("public_evidence", "Verify budgets, tenders, plans, and public statistics.", ["public budget", "procurement portal", "statistics authority"]),
    ],
    decisionRules: genericRules,
    riskModel: ["authority", "procurement", "budget", "compliance", "stakeholder"],
    reportTemplate: "government_decision_analysis",
  },
  business: {
    id: "business",
    label: "Business",
    signals: [/\b(business|startup|company|market|competitor|pricing|customer|iş|girişim|şirket|pazar|rakip|fiyatlandırma|müşteri)\b/i],
    criticalEvidence: ["company", "market", "customer", "competitors", "pricing", "demand", "regulation", "economics"],
    researchRequirements: sharedBusinessResearch,
    decisionRules: genericRules,
    riskModel: ["market", "customer", "competition", "economics", "execution"],
    reportTemplate: "business_plan",
  },
  general: {
    id: "general",
    label: "General Strategic Advisory",
    signals: [],
    criticalEvidence: ["objective", "context", "constraints"],
    researchRequirements: [],
    decisionRules: genericRules,
    riskModel: ["uncertainty", "context", "execution"],
    reportTemplate: "strategic_advisory",
  },
};

export const domainProfiles = profiles;

export function getDomainProfile(domain: DecisionDomain) {
  return profiles[domain];
}

const domainDetectionPriority: DecisionDomain[] = [
  "real_estate",
  "healthcare",
  "legal",
  "accounting",
  "procurement",
  "manufacturing",
  "construction",
  "agriculture",
  "logistics",
  "energy",
  "automotive",
  "ecommerce",
  "restaurant",
  "hospitality",
  "education",
  "insurance",
  "government",
  "finance",
  "operations",
  "technology",
  "retail",
];

export function detectDecisionDomain(input: string): DecisionDomain {
  const profile = domainDetectionPriority
    .map((domain) => profiles[domain])
    .map((candidate, index) => ({
      candidate,
      index,
      matches: candidate.signals.filter((signal) => signal.test(input)).length,
    }))
    .filter(({ matches }) => matches > 0)
    .sort(
      (left, right) =>
        right.matches - left.matches || left.index - right.index
    )[0]?.candidate;

  if (profile) return profile.id;
  if (profiles.business.signals.some((signal) => signal.test(input))) {
    return "business";
  }
  return "general";
}
