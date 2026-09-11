import type { DecisionConfidenceModel } from "@/app/lib/ai/decision-confidence";
import type { FinancialConsistencyCheck, FinancialModel } from "@/app/lib/ai/financial-model";
import type { SourceIntelligenceModel } from "@/app/lib/ai/source-intelligence";

export type ValidationType =
  | "Customer Interview"
  | "Pricing Test"
  | "Landing Page Test"
  | "Paid Acquisition Test"
  | "B2B Pilot"
  | "Prototype Test"
  | "Market Research";

export type ValidationScore = "Not Started" | "In Progress" | "Validated";

export type ValidationExperiment = {
  priority: number;
  assumption: string;
  risk: string;
  type: ValidationType;
  action: string;
  successCriteria: string;
  score: ValidationScore;
};

export type ValidationIntelligenceModel = {
  version: "validation_intelligence_engine_v1";
  score: ValidationScore;
  experiments: ValidationExperiment[];
};

export type ValidationRiskLevel = "Critical" | "High" | "Medium";
export type ValidationEvidenceStatus = "Validated" | "Partial" | "Missing";
export type ValidationConfidenceLevel = "High" | "Medium" | "Low";

export type ValidationAssumption = {
  id: string;
  assumption: string;
  riskLevel: ValidationRiskLevel;
  evidenceStatus: ValidationEvidenceStatus;
  experiment: string;
  successMetric: string;
  timeframe: string;
  priority: number;
};

export type ValidationIntelligence = {
  version: "validation_intelligence_engine_v2";
  overallScore: number;
  confidenceLevel: ValidationConfidenceLevel;
  assumptions: ValidationAssumption[];
  summary: string;
  recommendedSequence: string[];
};

function hasUserEvidence(financialConsistency: FinancialConsistencyCheck) {
  return financialConsistency.sources.userProvidedData.some((item) =>
    /supplied validation evidence|provided/i.test(item)
  );
}

function getValidationScore(input: {
  financialConsistency: FinancialConsistencyCheck;
  decisionConfidence: DecisionConfidenceModel;
}) {
  if (hasUserEvidence(input.financialConsistency) && input.decisionConfidence.confidenceScore >= 72) {
    return "Validated";
  }

  if (hasUserEvidence(input.financialConsistency) || input.decisionConfidence.confidenceScore >= 55) {
    return "In Progress";
  }

  return "Not Started";
}

export function createValidationIntelligenceModel(input: {
  financialModel: FinancialModel;
  financialConsistency: FinancialConsistencyCheck;
  sourceIntelligence: SourceIntelligenceModel;
  decisionConfidence: DecisionConfidenceModel;
}): ValidationIntelligenceModel {
  const { financialModel, financialConsistency, sourceIntelligence, decisionConfidence } = input;
  const isB2B = /b2b|enterprise|company|companies|kurumsal/i.test(financialModel.inputs.businessModel) ||
    /b2b|enterprise|company|companies|kurumsal/i.test(financialModel.inputs.targetCustomer);
  const lowConfidenceSource = sourceIntelligence.items.find((item) => item.confidence === "Low Confidence");
  const experiments: ValidationExperiment[] = [
    {
      priority: 1,
      assumption: "Customer demand exists",
      risk: "No customer validation",
      type: "Customer Interview",
      action: "Run 50 customer interviews",
      successCriteria: "30%+ strong purchase intent",
      score: hasUserEvidence(financialConsistency) ? "In Progress" : "Not Started",
    },
    {
      priority: 2,
      assumption: `${financialModel.metrics.cac.label} <= ${financialModel.metrics.cac.displayValue}`,
      risk: "CAC not validated",
      type: "Paid Acquisition Test",
      action: "Run a $500 acquisition experiment",
      successCriteria: `${financialModel.metrics.cac.label} <= ${financialModel.metrics.cac.displayValue}`,
      score: financialModel.metrics.cac.confidence === "High" ? "In Progress" : "Not Started",
    },
    {
      priority: 3,
      assumption: `${financialModel.metrics.arpa.label} ${financialModel.metrics.arpa.displayValue} accepted`,
      risk: "Willingness to pay not proven",
      type: "Pricing Test",
      action: "Test 3 pricing packages",
      successCriteria: "20%+ conversion intent",
      score: financialModel.metrics.arpa.confidence === "High" ? "In Progress" : "Not Started",
    },
    {
      priority: 4,
      assumption: isB2B ? "B2B demand exists" : "Market positioning converts qualified interest",
      risk: isB2B ? "B2B demand not proven" : "Messaging and conversion not proven",
      type: isB2B ? "B2B Pilot" : "Landing Page Test",
      action: isB2B ? "Interview 20 target companies" : "Launch a landing page with one offer and one CTA",
      successCriteria: isB2B ? "5+ pilot commitments" : "10%+ qualified conversion intent",
      score: "Not Started",
    },
    {
      priority: 5,
      assumption: lowConfidenceSource?.area || "Market assumptions require validation",
      risk: lowConfidenceSource?.summary || "Market evidence is incomplete",
      type: lowConfidenceSource?.area === "Competitor Insights" ? "Market Research" : "Prototype Test",
      action: lowConfidenceSource?.area === "Competitor Insights"
        ? "Validate competitors, substitutes, and pricing from primary sources"
        : "Test the smallest prototype or concierge workflow",
      successCriteria: lowConfidenceSource?.area === "Competitor Insights"
        ? "5+ verified competitor/source checks"
        : "5+ qualified users complete the core workflow",
      score: "Not Started",
    },
  ];

  return {
    version: "validation_intelligence_engine_v1",
    score: getValidationScore({ financialConsistency, decisionConfidence }),
    experiments,
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function evidenceStatusFromScore(score: number): ValidationEvidenceStatus {
  if (score >= 72) {
    return "Validated";
  }

  if (score >= 48) {
    return "Partial";
  }

  return "Missing";
}

function riskFromStatus(
  status: ValidationEvidenceStatus,
  fallback: ValidationRiskLevel = "High"
): ValidationRiskLevel {
  if (status === "Missing") {
    return fallback;
  }

  if (status === "Partial") {
    return "High";
  }

  return "Medium";
}

function confidenceFromScore(score: number): ValidationConfidenceLevel {
  if (score >= 72) {
    return "High";
  }

  if (score >= 48) {
    return "Medium";
  }

  return "Low";
}

function hasValidationEvidence(financialConsistency: FinancialConsistencyCheck) {
  return financialConsistency.sources.userProvidedData.some((item) =>
    /customer|interview|pilot|paying|paid|revenue|traction|retention|waitlist|validation|müşteri|görüşme|pilot|gelir|çekiş/i.test(item)
  );
}

export function createValidationIntelligence(input: {
  financialModel: FinancialModel;
  financialConsistency: FinancialConsistencyCheck;
  sourceIntelligence: SourceIntelligenceModel;
  decisionConfidence: DecisionConfidenceModel;
}): ValidationIntelligence {
  const { financialModel, financialConsistency, sourceIntelligence, decisionConfidence } = input;
  const userEvidence = hasValidationEvidence(financialConsistency);
  const customerEvidence = clampScore(
    (userEvidence ? 58 : 18) + (decisionConfidence.confidenceScore >= 65 ? 18 : 0)
  );
  const pricingValidation = clampScore(
    financialModel.metrics.arpa.confidence === "High"
      ? 72
      : financialModel.metrics.arpa.confidence === "Medium"
        ? 48
        : 24
  );
  const acquisitionValidation = clampScore(
    financialModel.metrics.cac.confidence === "High"
      ? 68
      : financialModel.metrics.cac.confidence === "Medium"
        ? 45
        : 22
  );
  const retentionValidation = clampScore(
    financialModel.metrics.ltv.confidence === "High"
      ? 66
      : financialModel.metrics.ltv.confidence === "Medium"
        ? 44
        : 24
  );
  const operationalValidation = clampScore(
    financialConsistency.quality === "Healthy"
      ? 70
      : financialConsistency.quality === "Needs Validation"
        ? 42
        : 26
  );
  const overallScore = clampScore(
    (customerEvidence * 0.3) +
      (pricingValidation * 0.2) +
      (acquisitionValidation * 0.2) +
      (retentionValidation * 0.15) +
      (operationalValidation * 0.15)
  );
  const customerStatus = evidenceStatusFromScore(customerEvidence);
  const pricingStatus = evidenceStatusFromScore(pricingValidation);
  const acquisitionStatus = evidenceStatusFromScore(acquisitionValidation);
  const retentionStatus = evidenceStatusFromScore(retentionValidation);
  const operationStatus = evidenceStatusFromScore(operationalValidation);
  const isB2B =
    /b2b|enterprise|company|companies|kurumsal/i.test(financialModel.inputs.businessModel) ||
    /b2b|enterprise|company|companies|kurumsal/i.test(financialModel.inputs.targetCustomer);
  const lowConfidenceSource = sourceIntelligence.items.find((item) => item.confidence === "Low Confidence");
  const assumptions: ValidationAssumption[] = [
    {
      id: "customer-demand",
      assumption: "Customer demand",
      riskLevel: riskFromStatus(customerStatus, "Critical"),
      evidenceStatus: customerStatus,
      experiment: "Run 50 customer interviews",
      successMetric: "30%+ strong purchase intent",
      timeframe: "14 days",
      priority: 1,
    },
    {
      id: "cac",
      assumption: "CAC",
      riskLevel: riskFromStatus(acquisitionStatus),
      evidenceStatus: acquisitionStatus,
      experiment: "Run a $500 paid acquisition test",
      successMetric: `${financialModel.metrics.cac.label} <= ${financialModel.metrics.cac.displayValue}`,
      timeframe: "14-21 days",
      priority: 2,
    },
    {
      id: "pricing",
      assumption: "Pricing acceptance",
      riskLevel: riskFromStatus(pricingStatus),
      evidenceStatus: pricingStatus,
      experiment: "Run an A/B pricing test with 3 packages",
      successMetric: "20%+ conversion intent",
      timeframe: "10-14 days",
      priority: 3,
    },
    {
      id: "retention",
      assumption: "Retention and repeat purchase",
      riskLevel: riskFromStatus(retentionStatus),
      evidenceStatus: retentionStatus,
      experiment: isB2B ? "Run a B2B pilot cohort" : "Track repeat purchase or subscription cohort",
      successMetric: isB2B ? "5+ pilot commitments" : "Repeat purchase or retention signal meets benchmark",
      timeframe: "30-45 days",
      priority: 4,
    },
    {
      id: "operations",
      assumption: lowConfidenceSource?.area || "Operational delivery",
      riskLevel: riskFromStatus(operationStatus),
      evidenceStatus: operationStatus,
      // TASK #69A-59 -- ROOT CAUSE FIX. Confirmed live: this entry's own
      // `assumption` field already correctly took on the lowest-confidence
      // source's real area name (e.g. "Competitor Insights"), but
      // `experiment`/`successMetric` stayed hardcoded to a generic
      // delivery-workflow test regardless -- producing gap text like
      // "Competitor Insights: evidence missing -- Test the smallest
      // delivery workflow before scaling to establish Core workflow
      // completes within target cost, quality, and delivery threshold,"
      // a closure action with no relationship to the actual gap. The
      // sibling validation-experiments builder above (createValidation
      // Experiments, priority 5) already branches on this exact same
      // `lowConfidenceSource?.area === "Competitor Insights"` condition
      // with a genuinely relevant closure action -- reused verbatim here
      // rather than inventing a second, divergent one.
      experiment: lowConfidenceSource?.area === "Competitor Insights"
        ? "Validate competitors, substitutes, and pricing from primary sources"
        : "Test the smallest delivery workflow before scaling",
      successMetric: lowConfidenceSource?.area === "Competitor Insights"
        ? "5+ verified competitor/source checks"
        : "Core workflow completes within target cost, quality, and delivery threshold",
      timeframe: "30 days",
      priority: 5,
    },
  ];

  return {
    version: "validation_intelligence_engine_v2",
    overallScore,
    confidenceLevel: confidenceFromScore(overallScore),
    assumptions,
    summary:
      overallScore >= 72
        ? "Validation evidence supports scaling the next decision step."
        : overallScore >= 48
          ? "Validation is partially complete; the next decision should focus on unresolved assumptions."
          : "Validation is early; customer demand, pricing, acquisition, retention, and operations need proof before scaling.",
    recommendedSequence: [
      "Validate customer demand",
      "Validate pricing",
      "Test acquisition channel",
      "Confirm retention",
      "Scale operations",
    ],
  };
}
