export type ReportInvestmentScore = {
  version?: string;
  fingerprint?: string;
  totalScore: number;
  confidence: number;
  recommendation: "GO" | "WAIT" | "PASS" | string;
  estimatedValuation?: string;
  fundingStage?: string;
  nextCriticalAction?: string;
  strengths?: string[];
  weaknesses?: string[];
  topRisks?: string[];
  categories?: Record<string, unknown>;
  decisionEngine?: Record<string, { score?: number; maximumScore?: number; label?: string; reasoning?: string[] }>;
};

export type ReportBenchmarkFit = {
  version?: string;
  industryKey?: string;
  industry?: string;
  businessModel?: string;
  benchmarkBasis?: string;
  confidence?: string;
  fit?: string;
  matchedSignals?: string[];
  validationGaps?: string[];
  rationale?: string;
};

export type ReportQualityScore = {
  version?: string;
  totalScore: number;
  qualityScore?: number;
  overallQuality?: string;
  confidenceLevel: "High Confidence" | "Medium Confidence" | "Low Confidence" | string;
  dimensions: {
    evidenceQuality: number;
    sourceConfidence: number;
    financialConsistency: number;
    benchmarkFit: number;
    validationReadiness: number;
  };
  strengths: string[];
  weaknesses: string[];
  improvementActions: string[];
  risks?: string[];
  warnings?: string[];
  confidenceSummary?: string;
};

export type ReportBenchmarkScore = {
  version?: string;
  overallFit: number;
  dimensions: {
    industryFit: number;
    businessModelFit: number;
    geographyFit: number;
    pricingFit: number;
    financialBenchmarkFit: number;
  };
  confidence: "High" | "Medium" | "Low" | string;
  deviations: Array<{
    metric: string;
    userValue: string;
    benchmarkRange: string;
    status: string;
  }>;
  insights: string[];
  actions: string[];
};

export type ReportValidationIntelligence = {
  version?: string;
  overallScore: number;
  confidenceLevel: "High" | "Medium" | "Low" | string;
  assumptions: Array<{
    id: string;
    assumption: string;
    riskLevel: "Critical" | "High" | "Medium" | string;
    evidenceStatus: "Validated" | "Partial" | "Missing" | string;
    experiment: string;
    successMetric: string;
    timeframe: string;
    priority: number;
  }>;
  summary: string;
  recommendedSequence: string[];
};

export type ReportMetadata = {
  reportLanguage?: "en" | "tr" | "de" | "fr" | "es";
  investmentScore?: ReportInvestmentScore;
  benchmarkFit?: ReportBenchmarkFit;
  benchmarkScore?: ReportBenchmarkScore;
  reportQuality?: ReportQualityScore;
  validationIntelligence?: ReportValidationIntelligence;
  expertiseProfile?: import("@/app/lib/ai/expertise-profile").ExpertiseProfile;
  reportPlan?: import("@/app/lib/ai/dynamic-report-plan").DynamicReportPlan;
  researchPlan?: import("@/app/lib/ai/dynamic-research-plan").DynamicResearchPlan;
  reportQualityValidation?: import("@/app/lib/report-engine/executive-report-quality-validator").ExecutiveReportQualityValidationResult;
  reportConsistencyCheck?: import("@/app/lib/report-engine/report-consistency-checker").ReportConsistencyCheckResult;
  reportAuditTrail?: import("@/app/lib/report-engine/report-audit-trail").ReportAuditTrailResult;
  reportExplainability?: import("@/app/lib/report-engine/explainability-engine").ExplainabilityEngineResult;
  reportReproducibility?: import("@/app/lib/report-engine/decision-reproducibility-engine").ReproducibilityRecord;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isReportInvestmentScore(value: unknown): value is ReportInvestmentScore {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.totalScore === "number" &&
    typeof value.confidence === "number" &&
    typeof value.recommendation === "string"
  );
}

export function readReportInvestmentScore(
  metadata: unknown
): ReportInvestmentScore | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const score = metadata.investmentScore;

  return isReportInvestmentScore(score) ? score : undefined;
}
