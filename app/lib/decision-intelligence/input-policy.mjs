const domainUserInputFields = {
  real_estate: new Set(["purchase_price", "investment_objective"]),
  legal: new Set([
    "contract_objective",
    "governing_jurisdiction",
    "review_perspective",
    "decision_deadline",
    "available_evidence",
  ]),
  accounting: new Set([
    "analysis_objective",
    "financial_period",
    "currency",
    "reporting_scope",
  ]),
  finance: new Set([
    "analysis_objective",
    "financial_period",
    "currency",
    "reporting_scope",
  ]),
  retail: new Set([
    "analysis_objective",
    "financial_period",
    "currency",
    "reporting_scope",
  ]),
  healthcare: new Set([
    "analysis_objective",
    "healthcare_scope",
    "healthcare_jurisdiction",
    "healthcare_timeframe",
  ]),
  logistics: new Set([
    "analysis_objective",
    "logistics_geography",
    "logistics_volume",
    "logistics_target",
  ]),
  business: new Set([
    "analysis_objective",
    "target_customer",
    "target_market",
    "venture_stage",
  ]),
  manufacturing: new Set([
    "analysis_objective",
    "analysis_timeframe",
    "current_baseline",
    "success_criteria",
  ]),
  technology: new Set([
    "analysis_objective",
    "analysis_timeframe",
    "current_baseline",
    "success_criteria",
  ]),
  general: new Set(["analysis_objective"]),
};

const domainResearchFields = {
  real_estate: [
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
    "amenities_projects",
    "regional_development",
    "geospatial_context",
  ],
  legal: ["governing_law", "compliance", "market_standard"],
  accounting: ["accounting_standard", "tax_treatment"],
  finance: ["macro_inputs", "industry_benchmarks", "company_financials"],
  healthcare: ["clinical_guidelines", "drug_safety", "care_standards"],
  logistics: ["transport_regulation", "cost_benchmarks", "infrastructure"],
  manufacturing: ["technical_standards", "process_benchmarks"],
  technology: ["technical_standards", "security_requirements", "benchmarks"],
  retail: ["market_demand", "competitors", "pricing_benchmarks"],
  business: ["company_evidence", "market_demand", "competitors"],
};

const universalResearchableFieldPattern =
  /\b(?:location|address|coordinates?|province|district|neighborhood|locality|block|parcel|zoning|title|encumbrance|municipality|road|infrastructure|hazard|comparable|regional|market|competitor|benchmark|regulation|standard|guideline|konum|adres|koordinat|il|ilçe|mahalle|mevki|ada|parsel|imar|tapu|takyidat|belediye|yol|altyapı|afet|emsal|bölgesel|pazar|rakip|mevzuat)\b/i;

function normalizeDomain(value) {
  if (value === "startup" || value === "marketing") {
    return "business";
  }

  if (Object.hasOwn(domainUserInputFields, value)) {
    return value;
  }

  return "general";
}

function isUserInputField(domain, field) {
  const allowedFields =
    domainUserInputFields[domain] || domainUserInputFields.general;
  const normalizedText = `${field.id} ${field.question}`.replace(
    /[_-]+/g,
    " "
  );

  if (allowedFields.has(field.id)) {
    return true;
  }

  if (universalResearchableFieldPattern.test(normalizedText)) {
    return false;
  }

  return false;
}

export function createDecisionInputPolicy({ domain, fields }) {
  const normalizedDomain = normalizeDomain(domain);
  const uniqueFields = fields.filter(
    (field, index, values) =>
      values.findIndex((candidate) => candidate.id === field.id) === index
  );
  const classifiedFields = uniqueFields.map((field) => {
    const userInput = isUserInputField(normalizedDomain, field);

    return {
      ...field,
      required: normalizedDomain === "real_estate" ? false : field.required,
      disposition: userInput ? "user_input" : "research",
      reason: userInput
        ? "The value depends on the user's private objective, constraints, or unpublished operating context."
        : "The value can be sought from uploaded evidence, official records, or external research.",
    };
  });
  const plannedResearchFields = (
    domainResearchFields[normalizedDomain] || []
  ).map((field) => ({
    id: field,
    question: "",
    placeholder: "",
    options: [],
    required: true,
    disposition: "research",
    reason:
      "The Decision Engine assigned this field to the domain research plan.",
  }));
  const researchFields = [
    ...classifiedFields.filter(
      (field) => field.disposition === "research"
    ),
    ...plannedResearchFields,
  ].filter(
    (field, index, values) =>
      values.findIndex((candidate) => candidate.id === field.id) === index
  );

  return {
    domain: normalizedDomain,
    userInputFields: classifiedFields.filter(
      (field) => field.disposition === "user_input"
    ),
    researchFields,
  };
}

export function expressDecisionInputFields({ policy, llmPhrasings }) {
  return policy.userInputFields.map((field) => {
    const phrasing = llmPhrasings.find((candidate) => candidate.id === field.id);
    const controlledField = {
      id: field.id,
      question: field.question,
      placeholder: field.placeholder,
      options: field.options,
      required: field.required,
    };

    if (!phrasing) {
      return controlledField;
    }

    return {
      ...controlledField,
      question: phrasing.question,
      placeholder: phrasing.placeholder,
      options: phrasing.options,
    };
  });
}
