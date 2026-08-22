import { z } from "zod";
import {
  expertiseDomainValues,
  expertiseProfileSchema,
  normalizeSelectedAnalysisMode,
  selectedAnalysisModeValues,
  type ExpertiseProfile,
  type SelectedAnalysisMode,
} from "./expertise-profile.ts";

const reportLanguageValues = ["en", "tr", "de", "fr", "es"] as const;
const sectionPriorityValues = ["critical", "high", "standard"] as const;
const evidenceTypeValues = [
  "user_statement",
  "uploaded_document",
  "official_source",
  "external_source",
  "calculation",
] as const;

const boundedText = z.string().trim().min(1).max(240);
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);

export const dynamicReportSectionSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(120),
    purpose: boundedText,
    requiredEvidenceTypes: z.array(z.enum(evidenceTypeValues)).min(1).max(5),
    analysisMethod: identifier,
    priority: z.enum(sectionPriorityValues),
  })
  .strict();

export const dashboardMetricSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(180),
    valueType: z.enum(["factual", "qualitative", "calculated"]),
    requiredEvidenceTypes: z.array(z.enum(evidenceTypeValues)).min(1).max(5),
  })
  .strict();

export const decisionGateSchema = z
  .object({
    id: identifier,
    condition: boundedText,
    evidenceRequired: z.string().trim().min(1).max(180),
    blocking: z.boolean(),
  })
  .strict();

export const reportPlanClarificationSchema = z
  .object({
    id: identifier,
    question: z.string().trim().min(1).max(200),
    materialImpact: z.string().trim().min(1).max(200),
  })
  .strict();

export const dynamicReportPlanSchema = z
  .object({
    reportTitle: z.string().trim().min(1).max(180),
    reportPurpose: boundedText,
    primaryDecision: boundedText,
    domain: expertiseProfileSchema.shape.domain,
    subdomain: z.string().trim().min(1).max(240),
    taskType: z.string().trim().min(1).max(240),
    selectedMode: z.enum(selectedAnalysisModeValues),
    sections: z.array(dynamicReportSectionSchema).min(1).max(16),
    dashboardMetrics: z.array(dashboardMetricSchema).max(10),
    decisionCriteria: z.array(z.string().trim().min(1).max(160)).max(12),
    decisionGates: z.array(decisionGateSchema).max(10),
    requiredEvidence: z.array(z.string().trim().min(1).max(160)).max(12),
    forbiddenSections: z.array(z.string().trim().min(1).max(120)).max(16),
    clarificationQuestions: z.array(reportPlanClarificationSchema).max(3),
    language: z.enum(reportLanguageValues),
  })
  .strict();

export type DynamicReportPlan = z.infer<typeof dynamicReportPlanSchema>;
export type DynamicReportSection = z.infer<typeof dynamicReportSectionSchema>;

type ExtractedFact = {
  field?: string;
  label?: string;
  value?: string;
};

type CreateReportPlanInput = {
  expertiseProfile: ExpertiseProfile;
  selectedMode?: unknown;
  prompt?: string;
  extractedFacts?: readonly ExtractedFact[];
  clarificationAnswers?: Record<string, unknown>;
  language?: unknown;
};

const domainIncompatiblePatterns: Partial<
  Record<ExpertiseProfile["domain"], RegExp>
> = {
  legal:
    /\b(?:cac|customer validation|product[- ]market fit|capital efficiency|market size|product metrics?|startup execution|investment score)\b/i,
  real_estate:
    /\b(?:cac|product[- ]market fit|saas metrics?|startup execution|customer validation|legal claim analysis|claim[- ]by[- ]claim)\b/i,
  finance:
    /\b(?:zoning|title verification|property facts|legal claim|customer validation|product[- ]market fit|startup execution)\b/i,
  accounting:
    /\b(?:zoning|title verification|property facts|legal claim|customer validation|product[- ]market fit|startup execution)\b/i,
  retail:
    /\b(?:zoning|title verification|legal claim|customer validation|product[- ]market fit|startup execution|saas metrics?)\b/i,
  // CRITICAL FIX -- acquisition report builder isolation regression.
  // Every other structured domain above filters an AI-generated dynamic
  // section/metric against its own incompatible-vocabulary pattern before
  // it ever reaches the report generator; acquisition had no entry here,
  // so a dynamically-planned section titled e.g. "Go-To-Market Strategy"
  // or a dashboard metric named "TAM" passed straight through
  // isSectionCompatible/isMetricCompatible into the acquisition report's
  // own section-routing contract (see adaptive-report-writer.ts's
  // assignOutputField, which maps these titles/purposes into the fixed
  // acquisitionAnalysisFields output keys -- the JSON key stays correct,
  // but the section's own title/purpose text still biases the model
  // toward Business Plan content inside it).
  //
  // CRITICAL FIX -- separate legitimate acquisition metrics from Business
  // Plan leakage. CAC and LTV (and "unit economics" framing generally)
  // ARE now blocked here -- confirmed live, these are a startup unit-
  // economics TEMPLATE, not evidence-grounded acquisition vocabulary,
  // even when a real figure is available. ARR, MRR, Revenue, EBITDA,
  // Gross margin, Cash flow, Runway, Purchase price, EV/ARR, ROI, IRR,
  // Debt service, and Financing structure remain deliberately excluded
  // from this pattern: those are legitimate, evidence-grounded
  // acquisition vocabulary for an already-operating target company, not a
  // startup-pitch concept.
  acquisition:
    /\b(?:tam|sam|som|icp|ideal customer profile|go[- ]to[- ]market|pricing strategy|founder roadmap|startup kpis?|business validation|product validation|founder validation|gtm validation|startup validation(?: metrics)?|sales strategy|unit economics(?: template)?|cac payback|customer acquisition cost|cac|ltv|customer validation|product[- ]market fit|startup execution)\b/i,
};

function unique<T>(values: readonly T[], key: (value: T) => string, limit: number) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value).trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, limit);
}

function uniqueText(values: readonly string[], limit = 12) {
  return unique(values.map((value) => value.trim()).filter(Boolean), (value) => value, limit);
}

function normalizeLanguage(value: unknown, prompt = ""): DynamicReportPlan["language"] {
  if (reportLanguageValues.includes(value as DynamicReportPlan["language"])) {
    return value as DynamicReportPlan["language"];
  }

  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (/turkish|türkçe|^tr\b/.test(normalized)) return "tr";
  if (/german|deutsch|^de\b/.test(normalized)) return "de";
  if (/french|français|^fr\b/.test(normalized)) return "fr";
  if (/spanish|español|^es\b/.test(normalized)) return "es";
  if (/[çğıöşüÇĞİÖŞÜ]/.test(prompt)) return "tr";
  return "en";
}

function section(
  id: string,
  title: string,
  purpose: string,
  analysisMethod: string,
  priority: DynamicReportSection["priority"] = "standard",
  requiredEvidenceTypes: DynamicReportSection["requiredEvidenceTypes"] = [
    "user_statement",
    "uploaded_document",
    "external_source",
  ]
): DynamicReportSection {
  return {
    id,
    title,
    purpose,
    requiredEvidenceTypes,
    analysisMethod,
    priority,
  };
}

function metric(
  id: string,
  label: string,
  purpose: string,
  valueType: DynamicReportPlan["dashboardMetrics"][number]["valueType"] =
    "qualitative",
  requiredEvidenceTypes: DynamicReportPlan["dashboardMetrics"][number]["requiredEvidenceTypes"] = [
    "user_statement",
    "uploaded_document",
    "external_source",
  ]
) {
  return { id, label, purpose, valueType, requiredEvidenceTypes };
}

function gate(
  id: string,
  condition: string,
  evidenceRequired: string,
  blocking = true
) {
  return { id, condition, evidenceRequired, blocking };
}

function answeredClarificationIds(answers: Record<string, unknown>) {
  return new Set(
    Object.entries(answers)
      .filter(([, value]) => typeof value === "string" && Boolean(value.trim()))
      .map(([id]) => id.trim().toLowerCase())
  );
}

function clarificationId(question: string, index: number) {
  const normalized = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || `critical_clarification_${index + 1}`;
}

function buildClarifications(
  profile: ExpertiseProfile,
  answers: Record<string, unknown>,
  extractedFacts: readonly ExtractedFact[]
) {
  const answered = answeredClarificationIds(answers);
  const extracted = new Set(
    extractedFacts.flatMap((fact) =>
      [fact.field, fact.label]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
    )
  );
  return profile.criticalClarifications
    .map((question, index) => ({
      id: clarificationId(question, index),
      question,
      materialImpact: `The answer may change the ${profile.taskType.replace(/_/g, " ")} assessment.`,
    }))
    .filter(
      (item) =>
        !answered.has(item.id) &&
        ![...extracted].some((field) =>
          item.question.toLowerCase().includes(field)
        )
    )
    .slice(0, 3);
}

function modePurpose(mode: SelectedAnalysisMode, purpose: string) {
  const label =
    mode === "plan"
      ? "Business Idea Validation"
      : mode === "market"
        ? "Market Intelligence"
        : "Strategic Advisory";
  return `${purpose} within the user-selected ${label} mode.`;
}

export function createDynamicReportPlanFallback({
  expertiseProfile: profile,
  selectedMode,
  prompt = "",
  extractedFacts = [],
  clarificationAnswers = {},
  language,
}: CreateReportPlanInput): DynamicReportPlan {
  const mode = normalizeSelectedAnalysisMode(selectedMode);
  const reportLanguage = normalizeLanguage(language, prompt);
  const clarifications = buildClarifications(
    profile,
    clarificationAnswers,
    extractedFacts
  );
  const base = {
    domain: profile.domain,
    subdomain: profile.subdomain,
    taskType: profile.taskType,
    selectedMode: mode,
    decisionCriteria: uniqueText(profile.decisionCriteria),
    requiredEvidence: uniqueText(profile.requiredEvidence),
    clarificationQuestions: clarifications,
    language: reportLanguage,
  };

  // Market Intelligence has its own, separate report schema and field
  // contracts (app/api/market-analysis/route.ts's marketReportFields),
  // never read from this reportPlan. But this plan is still attached to
  // the request body and read by other consumers (worker.ts diagnostics,
  // logging, and any future Decision Engine / Brain Orchestrator pass),
  // so a misclassified expertiseProfile.domain (e.g. "real_estate" for a
  // car wash market request) must never be allowed to select a
  // domain-specific template here -- the user-selected mode is
  // authoritative over a possibly-wrong domain inference. Every
  // domain-specific branch below is therefore gated on mode !== "market";
  // market-mode requests always fall through to the generic, mode-neutral
  // template at the end of this function regardless of domain.
  const allowDomainSpecificTemplate = mode !== "market";

  if (allowDomainSpecificTemplate && profile.domain === "legal" && profile.subdomain === "employment_law") {
    return {
      ...base,
      reportTitle: `${profile.jurisdiction || "Employment"} Claim Assessment`,
      reportPurpose: modePurpose(
        mode,
        "Assess unpaid wages, classification, retaliation, evidence, deadlines, defenses, and next actions"
      ),
      primaryDecision:
        "Determine the strength, urgency, and practical path for the employee's potential claims",
      sections: [
        section("executive_assessment", "Executive Legal Assessment", "Summarize the strongest claims, material risks, urgency, and immediate actions.", "claim_strength_and_evidence_review", "critical"),
        section("material_facts", "Material Facts", "Separate user-reported facts, uploaded-document facts, verified rules, and inference.", "fact_provenance_review", "critical"),
        section("claim_analysis", "Claim-by-Claim Analysis", "Evaluate each potential claim against its elements, supporting facts, contrary facts, and proof gaps.", "claim_element_analysis", "critical"),
        section("exempt_status", "Exempt Status and Misclassification", "Assess the classification issue and the evidence needed to support or defeat it.", "classification_test_review", "high"),
        section("unpaid_overtime", "Unpaid Overtime", "Assess overtime exposure, available records, calculation inputs, and defenses without inventing damages.", "wage_claim_review", "critical"),
        section("retaliation", "Retaliation", "Assess protected activity, adverse action, timing, causation, and employer explanations.", "retaliation_causation_review", "critical"),
        section("evidence_strength", "Evidence Strength", "Evaluate completeness, reliability, contradictions, and the proof needed for each material claim.", "evidence_strength_review", "critical"),
        section("deadline_risks", "Filing and Deadline Risks", "Identify jurisdiction-specific filing steps and time-sensitive risks only from verified rules.", "deadline_and_procedure_review", "critical", ["official_source", "user_statement", "uploaded_document"]),
        section("employer_defenses", "Employer Defenses", "Test the strongest credible defenses and the evidence that may support them.", "counterargument_review", "high"),
        section("resolution_strategy", "Settlement or Litigation Strategy", "Compare practical resolution paths, leverage, costs, and evidence dependencies.", "resolution_path_analysis", "high"),
        section("immediate_actions", "Immediate Actions", "Provide exactly prioritized actions tied to evidence and procedural urgency.", "action_priority_review", "critical"),
        section("final_recommendation", "Final Recommendation", "Give a directional, evidence-weighted legal assessment without unsupported certainty.", "legal_decision_synthesis", "critical"),
        section("sources_limitations", "Sources and Limitations", "List only sources actually used and state material limitations once.", "source_reliability_review", "high", ["official_source", "external_source", "uploaded_document"]),
      ],
      dashboardMetrics: [
        metric("jurisdiction", "Jurisdiction", "Applicable legal system and forum.", "factual", ["user_statement", "uploaded_document", "official_source"]),
        metric("strongest_claim", "Strongest Claim", "Most supportable claim under the current facts."),
        metric("evidence_completeness", "Evidence Completeness", "Qualitative completeness of decision-critical proof."),
        metric("deadline_urgency", "Deadline Urgency", "Time sensitivity based on verified procedural rules.", "qualitative", ["official_source", "user_statement"]),
        metric("defense_risk", "Main Defense Risk", "Strongest credible employer counterargument."),
        metric("immediate_action", "Immediate Action", "Highest-priority evidence or procedural step."),
      ],
      decisionGates: [
        gate("jurisdiction_confirmed", "Applicable jurisdiction is established.", "User statement, operative agreement, or official filing record"),
        gate("claim_elements_supported", "Material claim elements have factual support.", "User chronology plus documents, records, or testimony"),
        gate("deadline_open", "The relevant filing or procedural deadline remains open.", "Verified official rule and event dates"),
      ],
      forbiddenSections: uniqueText([
        ...profile.forbiddenTopics,
        "Market Size",
        "Product Metrics",
        "Generic Investment Score",
      ], 16),
    };
  }

  if (allowDomainSpecificTemplate && profile.domain === "real_estate") {
    return {
      ...base,
      reportTitle: "Real Estate Investment Due-Diligence Assessment",
      reportPurpose: modePurpose(mode, "Assess acquisition suitability, material risks, value support, and decision gates"),
      primaryDecision: "Determine whether the property should proceed, wait for verification, or be avoided",
      sections: [
        section("executive_investment_decision", "Executive Investment Decision", "State the current investment posture and the evidence that controls it.", "investment_gate_synthesis", "critical"),
        section("property_facts", "Property Facts", "Present extracted property identifiers once and distinguish extraction from verification.", "property_identity_review", "critical"),
        section("title_ownership", "Title and Ownership Verification", "Assess title, ownership, encumbrances, and transaction readiness.", "title_due_diligence", "critical", ["uploaded_document", "official_source"]),
        section("zoning_land_use", "Zoning and Land Use", "Assess parcel-specific permitted use and development constraints.", "zoning_due_diligence", "critical", ["official_source", "uploaded_document"]),
        section("access", "Legal and Physical Access", "Assess legal access, road connection, frontage, and practical accessibility.", "access_due_diligence", "critical", ["official_source", "uploaded_document", "external_source"]),
        section("infrastructure_location", "Infrastructure and Location", "Assess immediate-area utilities, services, accessibility, and location implications.", "infrastructure_location_review", "high"),
        section("environmental_geological", "Environmental and Geological Risks", "Assess location-specific hazard, soil, flood, seismic, and environmental evidence.", "hazard_due_diligence", "critical", ["official_source", "external_source"]),
        section("regional_development", "Regional Development", "Assess verified projects and planning signals that materially affect the parcel.", "regional_development_review", "standard"),
        section("comparables", "Comparable Market Evidence", "Evaluate genuinely comparable, dated sale and rental evidence and its limitations.", "comparable_evidence_review", "critical", ["external_source", "calculation"]),
        section("liquidity", "Liquidity", "Assess buyer and tenant depth, occupancy evidence, and saleability only from supported market evidence.", "liquidity_review", "high"),
        section("valuation_inputs", "Valuation Inputs", "State whether valuation gates are met and, for income property, evaluate only supported purchase price, rent, occupancy, NOI, cap rate or yield, financing, and holding-period inputs.", "valuation_gate_review", "critical", ["official_source", "external_source", "calculation"]),
        section("decision_gates", "Decision Gates", "Show the exact legal, zoning, access, hazard, and valuation conditions controlling the decision.", "investment_gate_review", "critical"),
        section("due_diligence_actions", "Due-Diligence Actions", "Prioritize the documents, authorities, and professional checks required before capital commitment.", "due_diligence_action_plan", "critical"),
        section("sources_limitations", "Sources and Limitations", "List only claim-supporting sources and concise limitations.", "source_reliability_review", "high", ["official_source", "external_source", "uploaded_document"]),
      ],
      dashboardMetrics: [
        metric("property_type", "Property Type", "Extracted or verified property classification.", "factual", ["uploaded_document", "official_source"]),
        metric("location", "Location", "Extracted or verified location hierarchy.", "factual", ["uploaded_document", "official_source"]),
        metric("title_verification", "Title Verification", "Current title-evidence status."),
        metric("zoning_status", "Zoning Status", "Parcel-specific zoning-evidence status."),
        metric("market_evidence", "Market Evidence", "Strength of comparable evidence."),
        metric("income_evidence", "Income Evidence", "Strength of rent, occupancy, NOI, and yield evidence."),
        metric("liquidity", "Liquidity", "Qualitative marketability assessment."),
        metric("main_risk", "Main Risk", "Highest-impact verified or unresolved risk."),
        metric("investment_status", "Investment Status", "Current proceed, wait, or avoid posture."),
      ],
      decisionGates: [
        gate("clean_title", "Current title and encumbrance position is acceptable.", "Official current title and encumbrance record"),
        gate("compatible_zoning", "Parcel-specific zoning supports the intended use.", "Official zoning and plan documentation"),
        gate("verified_access", "Legal and physical access is verified.", "Cadastral, title, and site-access evidence"),
        gate("valuation_supported", "Acquisition economics are supported by validated comparables and method.", "Comparable evidence, parcel facts, currency, and calculation method"),
      ],
      forbiddenSections: uniqueText([
        ...profile.forbiddenTopics,
        "Unrelated Legal Claim Analysis",
      ], 16),
    };
  }

  // CRITICAL FIX -- acquisition report builder isolation regression. This
  // domain used to fall through to the fully generic bottom template
  // (Executive Assessment / Material Facts / Decision Analysis / Material
  // Risks / Priority Actions / Sources), leaving the model's own judgment
  // as the only thing standing between the acquisition report and a
  // Business Plan-flavored section plan. A dedicated, acquisition-shaped
  // fallback -- mirroring the legal/real_estate/finance branches above --
  // gives the model an on-topic default whenever its own dynamic plan is
  // absent or rejected by resolveDynamicReportPlan's compatibility check.
  if (allowDomainSpecificTemplate && profile.domain === "acquisition") {
    return {
      ...base,
      reportTitle: "Acquisition Due Diligence Assessment",
      reportPurpose: modePurpose(mode, "Assess acquisition attractiveness, valuation, financing structure, integration risk, and the investment decision"),
      primaryDecision: "Determine whether to proceed, proceed conditionally, renegotiate, or walk away from the acquisition",
      sections: [
        section("executive_acquisition_decision", "Executive Acquisition Decision", "State the acquisition call and the evidence that controls it.", "acquisition_decision_synthesis", "critical"),
        section("target_company_overview", "Target Company Overview", "Present the target's verified business, operations, customers, and financial profile.", "target_profile_review", "critical"),
        section("strategic_fit", "Strategic Fit", "Assess strategic rationale, market position, and competitive advantage gained.", "strategic_fit_review", "critical"),
        section("valuation_purchase_price", "Valuation and Purchase Price Fairness", "Assess EV/ARR or the appropriate multiple, comparable transactions, and purchase price fairness.", "valuation_analysis", "critical", ["user_statement", "uploaded_document", "external_source", "calculation"]),
        section("financing_debt_capacity", "Financing Structure and Debt Capacity", "Assess the proposed financing mix, equity/debt split, and debt capacity implications.", "financing_structure_review", "critical", ["user_statement", "uploaded_document", "calculation"]),
        section("roi_irr", "ROI and IRR Analysis", "Provide evidence-based ROI scenarios and an IRR estimate where computable.", "return_analysis", "high", ["user_statement", "uploaded_document", "calculation"]),
        section("synergies", "Revenue and Cost Synergies", "Assess revenue and cost synergies with their supporting rationale and evidence.", "synergy_analysis", "high"),
        section("integration_operational_risk", "Integration and Operational Risk", "Assess technology, cultural, and operational integration risk and disruption exposure.", "integration_risk_review", "critical"),
        section("regulatory_review", "Regulatory Review", "Assess antitrust, competition, and sector-specific regulatory approval considerations.", "regulatory_review", "high", ["official_source", "external_source"]),
        section("competitive_position", "Competitive Position", "Assess the combined entity's post-acquisition competitive position.", "competitive_position_review", "standard"),
        section("deal_risks", "Deal Risks", "Rank material deal risks by mechanism, evidence, likelihood, consequence, and mitigation.", "deal_risk_review", "high"),
        section("post_merger_integration", "Post-Merger Integration Plan", "Provide a deal-specific 30/60/90-day post-merger integration plan.", "integration_plan_synthesis", "critical"),
        section("final_recommendation", "Final Investment Recommendation", "Give the final acquisition call with confidence and the condition that would change it.", "acquisition_decision_synthesis", "critical"),
        section("sources_limitations", "Sources and Limitations", "List only sources actually used and state material limitations once.", "source_reliability_review", "high", ["official_source", "external_source", "uploaded_document"]),
      ],
      dashboardMetrics: [
        metric("purchase_price", "Purchase Price", "User-verified purchase price.", "factual", ["user_statement", "uploaded_document"]),
        metric("ev_arr_multiple", "EV/ARR Multiple", "Derived valuation multiple from verified purchase price and target ARR.", "calculated", ["calculation"]),
        metric("financing_mix", "Financing Mix", "Derived equity/debt split of the purchase price.", "calculated", ["user_statement", "calculation"]),
        metric("irr_estimate", "IRR Estimate", "IRR only when computable from verified cash-flow timing and exit assumptions.", "calculated", ["calculation"]),
        metric("integration_risk", "Integration Risk", "Qualitative integration-risk posture."),
        metric("investment_decision", "Investment Decision", "Current proceed, proceed-conditionally, renegotiate, or walk-away posture."),
      ],
      decisionGates: [
        gate("valuation_supported", "Purchase price is supported by a computed multiple or comparable transactions.", "Verified purchase price, target ARR, or comparable transaction evidence"),
        gate("financing_confirmed", "Financing structure and debt capacity are confirmed.", "Verified buyer capital, financing terms, or debt capacity evidence"),
        gate("integration_plan_supported", "A concrete post-merger integration plan exists.", "Target operating profile and integration-scope evidence"),
      ],
      // Named items listed BEFORE ...profile.forbiddenTopics: the schema
      // caps forbiddenSections at 16 entries (dynamicReportPlanSchema),
      // and expertise-profile.ts's own domainForbiddenTopics.acquisition
      // list alone already exceeds that cap -- spreading it first would
      // silently truncate away every one of these acquisition-fallback-
      // specific named items before uniqueText's slice(0, 16) ever saw
      // them. These named items are unique to this report; forbiddenTopics
      // is the more generic, larger source, so it is the one that should
      // lose entries to the cap if anything has to.
      forbiddenSections: uniqueText([
        "Problem",
        "Solution",
        "Ideal Customer Profile",
        "TAM/SAM/SOM",
        "Pricing Strategy",
        "Go-To-Market",
        "Sales Strategy",
        "Founder Roadmap",
        "Founder Validation",
        "GTM Validation",
        "Startup Validation Metrics",
        "Startup KPIs",
        "Business Validation",
        "Product Validation",
        // CRITICAL FIX -- separate legitimate acquisition metrics from
        // Business Plan leakage: CAC/LTV are a startup unit-economics
        // template, not evidence-grounded acquisition vocabulary (ARR,
        // EBITDA, EV/ARR, ROI, IRR, financing structure remain allowed
        // and are never listed here). Combined into one entry (rather
        // than three) to stay inside the 16-item cap above.
        "Unit Economics (CAC/LTV/ARR/MRR) / CAC Payback / Customer Acquisition Cost framework",
        ...profile.forbiddenTopics,
      ], 16),
    };
  }

  if (allowDomainSpecificTemplate && (profile.domain === "finance" || profile.domain === "accounting")) {
    return {
      ...base,
      reportTitle: "Financial Health Assessment",
      reportPurpose: modePurpose(mode, "Assess financial health, resilience, and material financial risks"),
      primaryDecision: "Determine the entity's financial strength, vulnerabilities, and priority actions",
      sections: [
        section("executive_financial_assessment", "Executive Financial Assessment", "Summarize financial health, material risks, and decision priorities.", "financial_health_synthesis", "critical"),
        section("revenue_quality", "Revenue Quality", "Assess revenue composition, concentration, recurrence, and recognition quality.", "revenue_quality_review", "high"),
        section("profitability", "Profitability", "Assess margin structure, earnings quality, and operating leverage.", "profitability_analysis", "critical", ["uploaded_document", "calculation"]),
        section("cash_flow", "Cash Flow", "Assess cash generation, conversion, burn, and cash-flow resilience.", "cash_flow_analysis", "critical", ["uploaded_document", "calculation"]),
        section("liquidity", "Liquidity", "Assess near-term obligations and liquid-resource coverage.", "liquidity_analysis", "critical", ["uploaded_document", "calculation"]),
        section("leverage", "Leverage", "Assess debt burden, service capacity, and covenant exposure.", "leverage_analysis", "high", ["uploaded_document", "calculation"]),
        section("expense_structure", "Expense Structure", "Identify cost concentration, fixed-variable mix, and controllable pressure points.", "expense_structure_analysis", "high", ["uploaded_document", "calculation"]),
        section("working_capital", "Working Capital", "Assess receivables, inventory, payables, and cash-conversion implications.", "working_capital_analysis", "high", ["uploaded_document", "calculation"]),
        section("financial_risks", "Financial Risks", "Prioritize evidence-supported financial risks and mitigations.", "financial_risk_review", "critical"),
        section("scenario_analysis", "Scenario Analysis", "Test supported downside, base, and upside conditions without invented values.", "financial_scenario_analysis", "high", ["uploaded_document", "calculation"]),
        section("priority_actions", "Priority Actions", "Provide evidence-linked financial actions and decision gates.", "financial_action_plan", "critical"),
      ],
      dashboardMetrics: [
        metric("profitability", "Profitability", "Supported profitability position.", "calculated", ["uploaded_document", "calculation"]),
        metric("cash_position", "Cash Position", "Reported cash and equivalents.", "factual", ["uploaded_document"]),
        metric("liquidity", "Liquidity", "Supported liquidity position.", "calculated", ["uploaded_document", "calculation"]),
        metric("leverage", "Leverage", "Supported debt and service-capacity position.", "calculated", ["uploaded_document", "calculation"]),
        metric("working_capital", "Working Capital", "Supported working-capital position.", "calculated", ["uploaded_document", "calculation"]),
        metric("main_financial_risk", "Main Financial Risk", "Highest-impact supported financial vulnerability."),
      ],
      decisionGates: [
        gate("period_complete", "The reporting period and currency are established.", "Dated financial statements and currency"),
        gate("statements_reconciled", "Core statements reconcile sufficiently for analysis.", "Balance sheet, income statement, and cash-flow statement"),
      ],
      forbiddenSections: uniqueText(profile.forbiddenTopics, 16),
    };
  }

  if (allowDomainSpecificTemplate && profile.domain === "retail") {
    return {
      ...base,
      reportTitle: "Retail Sales and Inventory Performance Assessment",
      reportPurpose: modePurpose(mode, "Assess branch, product, margin, inventory, and growth performance"),
      primaryDecision: "Determine which branches, products, and inventory actions should be prioritized",
      sections: [
        section("executive_performance_summary", "Executive Performance Summary", "Summarize the strongest and weakest operating signals and priority actions.", "retail_performance_synthesis", "critical"),
        section("branch_performance", "Branch Performance", "Compare branch contribution, trend, and underperformance using consistent periods.", "branch_variance_analysis", "critical", ["uploaded_document", "calculation"]),
        section("product_performance", "Product Performance", "Compare product contribution, mix, and trend.", "product_performance_analysis", "critical", ["uploaded_document", "calculation"]),
        section("revenue_margin", "Revenue and Margin", "Assess revenue quality and gross-margin contribution.", "revenue_margin_analysis", "critical", ["uploaded_document", "calculation"]),
        section("inventory_turnover", "Inventory Turnover", "Assess stock velocity, ageing, and capital tied in inventory.", "inventory_turnover_analysis", "critical", ["uploaded_document", "calculation"]),
        section("weak_products", "Weak Products", "Identify underperforming products using supported contribution and turnover evidence.", "weak_product_detection", "high", ["uploaded_document", "calculation"]),
        section("growth_opportunities", "Growth Opportunities", "Identify evidence-supported branch, product, and inventory opportunities.", "retail_growth_analysis", "high"),
        section("priority_actions", "Priority Actions", "Provide prioritized operating actions tied to measurable evidence.", "retail_action_plan", "critical"),
      ],
      dashboardMetrics: [
        metric("top_branch", "Top Branch", "Highest supported branch contribution.", "calculated", ["uploaded_document", "calculation"]),
        metric("weakest_branch", "Weakest Branch", "Lowest supported branch contribution.", "calculated", ["uploaded_document", "calculation"]),
        metric("top_product", "Top Product", "Highest supported product contribution.", "calculated", ["uploaded_document", "calculation"]),
        metric("gross_margin", "Gross Margin", "Supported margin position.", "calculated", ["uploaded_document", "calculation"]),
        metric("inventory_turnover", "Inventory Turnover", "Supported stock-velocity position.", "calculated", ["uploaded_document", "calculation"]),
        metric("main_performance_risk", "Main Performance Risk", "Highest-impact supported retail risk."),
      ],
      decisionGates: [
        gate("period_currency_known", "Reporting period and currency are established.", "Dataset metadata or user clarification"),
        gate("cost_data_available", "Margin conclusions have sufficient cost data.", "Product and branch cost records"),
      ],
      forbiddenSections: uniqueText(profile.forbiddenTopics, 16),
    };
  }

  return {
    ...base,
    reportTitle: "Decision Assessment",
    reportPurpose: modePurpose(mode, profile.userGoal),
    primaryDecision: "Determine the most defensible decision and immediate actions from available evidence",
    sections: [
      section("executive_assessment", "Executive Assessment", "Summarize the decision, evidence, risks, and immediate actions.", "decision_synthesis", "critical"),
      section("material_facts", "Material Facts", "Separate provided facts, uploaded evidence, external evidence, and inference.", "fact_provenance_review", "critical"),
      section("analysis", "Decision Analysis", "Apply the expertise profile's required analyses and decision criteria.", "domain_decision_analysis", "critical"),
      section("risks", "Material Risks", "Prioritize supported risks and mitigations.", "risk_review", "high"),
      section("priority_actions", "Priority Actions", "Provide evidence-linked next actions.", "action_priority_review", "critical"),
      section("sources_limitations", "Sources and Limitations", "List only evidence actually used and material limitations.", "source_reliability_review", "high"),
    ],
    dashboardMetrics: [],
    decisionGates: profile.decisionCriteria.slice(0, 6).map((criterion, index) =>
      gate(`decision_gate_${index + 1}`, criterion, profile.requiredEvidence[index] || "Relevant evidence")
    ),
    forbiddenSections: uniqueText(profile.forbiddenTopics, 16),
  };
}

function planItemText(section: DynamicReportSection) {
  return `${section.id} ${section.title} ${section.purpose} ${section.analysisMethod}`;
}

function isTextCompatible(text: string, profile: ExpertiseProfile) {
  const normalized = text.toLowerCase();
  const profileForbidden = profile.forbiddenTopics.some((topic) =>
    normalized.includes(topic.toLowerCase())
  );
  const domainPattern = domainIncompatiblePatterns[profile.domain];

  return !profileForbidden && !(domainPattern?.test(text) ?? false);
}

function isSectionCompatible(
  section: DynamicReportSection,
  profile: ExpertiseProfile
) {
  const text = planItemText(section);
  return isTextCompatible(text, profile);
}

function isMetricCompatible(
  item: DynamicReportPlan["dashboardMetrics"][number],
  profile: ExpertiseProfile
) {
  const text = `${item.id} ${item.label} ${item.purpose}`;
  const unsupportedScore =
    /(?:score|percentage|percent|%)/i.test(text) && item.valueType !== "calculated";

  return isTextCompatible(text, profile) && !unsupportedScore;
}

export function resolveDynamicReportPlan({
  value,
  fallback,
  expertiseProfile,
  selectedMode,
  clarificationAnswers = {},
}: {
  value: unknown;
  fallback: DynamicReportPlan;
  expertiseProfile: ExpertiseProfile;
  selectedMode: unknown;
  clarificationAnswers?: Record<string, unknown>;
}): DynamicReportPlan {
  const parsed = dynamicReportPlanSchema.safeParse(value);
  const mode = normalizeSelectedAnalysisMode(selectedMode);

  if (!parsed.success) return fallback;

  const candidate = parsed.data;
  if (
    candidate.domain !== expertiseProfile.domain ||
    candidate.subdomain !== expertiseProfile.subdomain ||
    candidate.taskType !== expertiseProfile.taskType ||
    candidate.selectedMode !== mode
  ) {
    return fallback;
  }

  const compatibleSections = unique(
    candidate.sections.filter((item) =>
      isSectionCompatible(item, expertiseProfile)
    ),
    (item) => item.id,
    16
  );
  const requiredFallbackSections = fallback.sections.filter(
    (item) => item.priority === "critical"
  );
  const sections = unique(
    [...compatibleSections, ...requiredFallbackSections],
    (item) => item.id,
    16
  );
  const answered = answeredClarificationIds(clarificationAnswers);
  const clarificationQuestions = unique(
    [...candidate.clarificationQuestions, ...fallback.clarificationQuestions]
      .filter((item) => !answered.has(item.id))
      .filter(
        (item) =>
          !/\b(?:what decision|current baseline|success measured|anything else|more detail)\b/i.test(
            `${item.question} ${item.materialImpact}`
          )
      ),
    (item) => item.id,
    3
  );

  if (!sections.length) return fallback;

  return {
    ...candidate,
    sections,
    dashboardMetrics: unique(
      [
        ...candidate.dashboardMetrics.filter((item) =>
          isMetricCompatible(item, expertiseProfile)
        ),
        ...fallback.dashboardMetrics,
      ],
      (item) => item.id,
      10
    ),
    decisionCriteria: uniqueText([
      ...candidate.decisionCriteria.filter((item) =>
        isTextCompatible(item, expertiseProfile)
      ),
      ...expertiseProfile.decisionCriteria,
    ]),
    decisionGates: unique(
      [
        ...candidate.decisionGates.filter((item) =>
          isTextCompatible(
            `${item.condition} ${item.evidenceRequired}`,
            expertiseProfile
          )
        ),
        ...fallback.decisionGates,
      ],
      (item) => item.id,
      10
    ),
    requiredEvidence: uniqueText([
      ...candidate.requiredEvidence.filter((item) =>
        isTextCompatible(item, expertiseProfile)
      ),
      ...expertiseProfile.requiredEvidence,
    ]),
    forbiddenSections: uniqueText([
      ...candidate.forbiddenSections,
      ...expertiseProfile.forbiddenTopics,
      ...fallback.forbiddenSections,
    ], 16),
    clarificationQuestions,
  };
}

export function formatDynamicReportPlanForContext(plan: DynamicReportPlan) {
  return [
    "Private dynamic report plan. Never render this block, its IDs, or its schema to the user.",
    `Planned title: ${plan.reportTitle}.`,
    `Purpose: ${plan.reportPurpose}.`,
    `Primary decision: ${plan.primaryDecision}.`,
    `Relevant sections: ${plan.sections.map((item) => `${item.title} (${item.priority})`).join("; ")}.`,
    `Dashboard metrics: ${plan.dashboardMetrics.map((item) => `${item.label} [${item.valueType}]`).join("; ") || "none"}.`,
    `Decision criteria: ${plan.decisionCriteria.join("; ")}.`,
    `Decision gates: ${plan.decisionGates.map((item) => item.condition).join("; ")}.`,
    `Required evidence: ${plan.requiredEvidence.join("; ")}.`,
    `Forbidden sections: ${plan.forbiddenSections.join("; ") || "none"}.`,
    "The existing report output schema remains authoritative. Tailor its content to this plan without adding or removing output keys.",
  ].join("\n");
}

export function createDynamicReportPlanObjectJsonSchema() {
  const evidenceTypes = [...evidenceTypeValues];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reportTitle: { type: "string" },
      reportPurpose: { type: "string" },
      primaryDecision: { type: "string" },
      domain: { type: "string", enum: [...expertiseDomainValues] },
      subdomain: { type: "string" },
      taskType: { type: "string" },
      selectedMode: { type: "string", enum: [...selectedAnalysisModeValues] },
      sections: {
        type: "array",
        minItems: 1,
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            purpose: { type: "string" },
            requiredEvidenceTypes: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: { type: "string", enum: evidenceTypes },
            },
            analysisMethod: { type: "string" },
            priority: { type: "string", enum: [...sectionPriorityValues] },
          },
          required: ["id", "title", "purpose", "requiredEvidenceTypes", "analysisMethod", "priority"],
        },
      },
      dashboardMetrics: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            purpose: { type: "string" },
            valueType: { type: "string", enum: ["factual", "qualitative", "calculated"] },
            requiredEvidenceTypes: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: { type: "string", enum: evidenceTypes },
            },
          },
          required: ["id", "label", "purpose", "valueType", "requiredEvidenceTypes"],
        },
      },
      decisionCriteria: { type: "array", maxItems: 12, items: { type: "string" } },
      decisionGates: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            condition: { type: "string" },
            evidenceRequired: { type: "string" },
            blocking: { type: "boolean" },
          },
          required: ["id", "condition", "evidenceRequired", "blocking"],
        },
      },
      requiredEvidence: { type: "array", maxItems: 12, items: { type: "string" } },
      forbiddenSections: { type: "array", maxItems: 16, items: { type: "string" } },
      clarificationQuestions: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            question: { type: "string" },
            materialImpact: { type: "string" },
          },
          required: ["id", "question", "materialImpact"],
        },
      },
      language: { type: "string", enum: [...reportLanguageValues] },
    },
    required: [
      "reportTitle",
      "reportPurpose",
      "primaryDecision",
      "domain",
      "subdomain",
      "taskType",
      "selectedMode",
      "sections",
      "dashboardMetrics",
      "decisionCriteria",
      "decisionGates",
      "requiredEvidence",
      "forbiddenSections",
      "clarificationQuestions",
      "language",
    ],
  } as const;
}
