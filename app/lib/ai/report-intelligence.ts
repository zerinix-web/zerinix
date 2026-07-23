import type { FinancialConsistencyCheck, FinancialModel } from "@/app/lib/ai/financial-model";
import type { InvestmentScore } from "@/app/lib/ai/investment-score";
import type { SourceIntelligenceModel } from "@/app/lib/ai/source-intelligence";
import type { ValidationIntelligenceModel } from "@/app/lib/ai/validation-intelligence";

export type ReportQualityLevel = "High Confidence" | "Moderate Confidence" | "Low Confidence";
export type ReportQualityConfidenceLevel = "High Confidence" | "Medium Confidence" | "Low Confidence";

export type ReportQualityScore = {
  totalScore: number;
  dimensions: {
    evidenceQuality: number;
    sourceConfidence: number;
    financialConsistency: number;
    benchmarkFit: number;
    validationReadiness: number;
  };
  confidenceLevel: ReportQualityConfidenceLevel;
  strengths: string[];
  weaknesses: string[];
  improvementActions: string[];
};

export type ReportIntelligenceModel = ReportQualityScore & {
  version: "report_quality_engine_v2";
  overallQuality: ReportQualityLevel;
  qualityScore: number;
  risks: string[];
  warnings: string[];
  confidenceSummary: string;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function categoryScore(
  context: ReportIntelligenceInput,
  key: keyof InvestmentScore["categories"]
) {
  const category = context.investmentScore.categories[key];

  return Math.round((category.score / Math.max(1, category.maximumScore)) * 100);
}

function qualityFromScore(score: number): ReportQualityLevel {
  if (score >= 72) {
    return "High Confidence";
  }

  if (score >= 48) {
    return "Moderate Confidence";
  }

  return "Low Confidence";
}

function confidenceLevelFromScore(score: number): ReportQualityConfidenceLevel {
  if (score >= 72) {
    return "High Confidence";
  }

  if (score >= 48) {
    return "Medium Confidence";
  }

  return "Low Confidence";
}

function sourceConfidenceScore(sourceIntelligence?: SourceIntelligenceModel) {
  const items = sourceIntelligence?.items || [];

  if (!items.length) {
    return 42;
  }

  const scores = items.map((item) => {
    if (item.confidence === "High Confidence") return 88;
    if (item.confidence === "Medium Confidence") return 62;
    return 34;
  });

  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function benchmarkFitScore(context: ReportIntelligenceInput) {
  const fitBase =
    context.benchmarkFit.fit === "Strong Fit"
      ? 86
      : context.benchmarkFit.fit === "Moderate Fit"
        ? 64
        : 42;
  const confidenceAdjustment =
    context.benchmarkFit.confidence === "High"
      ? 8
      : context.benchmarkFit.confidence === "Medium"
        ? 0
        : -10;
  const gapPenalty = Math.min(18, context.benchmarkFit.validationGaps.length * 4);

  return clampScore(fitBase + confidenceAdjustment - gapPenalty);
}

function validationReadinessScore(validationIntelligence?: ValidationIntelligenceModel) {
  if (!validationIntelligence) {
    return 42;
  }

  const scoreBase =
    validationIntelligence.score === "Validated"
      ? 84
      : validationIntelligence.score === "In Progress"
        ? 62
        : 34;
  const requiredExperiments = validationIntelligence.experiments.filter(
    (experiment) => experiment.score !== "Validated"
  ).length;

  return clampScore(scoreBase - Math.min(18, requiredExperiments * 3));
}

function hasUserEvidence(context: ReportIntelligenceInput) {
  return context.financialConsistency.sources.userProvidedData.some((item) =>
    /supplied validation evidence|provided|customer|revenue|traction|pilot|sales|waitlist/i.test(item)
  );
}

type ReportIntelligenceInput = FinancialModel & {
  investmentScore: InvestmentScore;
  financialConsistency: FinancialConsistencyCheck;
  sourceIntelligence?: SourceIntelligenceModel;
  validationIntelligence?: ValidationIntelligenceModel;
  decisionConfidence: {
    confidenceScore: number;
    decision: "GO" | "WAIT" | "NO-GO";
    positiveFactors: string[];
    negativeFactors: string[];
  };
};

export function createReportIntelligenceModel(context: ReportIntelligenceInput): ReportIntelligenceModel {
  const financialConsistency =
    context.financialConsistency.quality === "Healthy"
      ? 86
      : context.financialConsistency.quality === "Needs Validation"
        ? 58
        : 34;
  const evidenceQuality = clampScore(
    (context.investmentScore.confidence * 0.45) +
      (context.decisionConfidence.confidenceScore * 0.25) +
      (hasUserEvidence(context) ? 22 : 4)
  );
  const businessModelQuality = categoryScore(context, "businessModel");
  const executionReadiness = categoryScore(context, "executionRisk");
  const sourceConfidence = sourceConfidenceScore(context.sourceIntelligence);
  const benchmarkFit = benchmarkFitScore(context);
  const validationReadiness = validationReadinessScore(context.validationIntelligence);
  const totalScore = clampScore(
    (evidenceQuality * 0.25) +
      (sourceConfidence * 0.2) +
      (financialConsistency * 0.25) +
      (benchmarkFit * 0.15) +
      (validationReadiness * 0.15)
  );
  const aggressiveDecision =
    context.decisionConfidence.decision === "GO" ||
    context.investmentScore.recommendation === "GO";
  const unresolvedRisks =
    context.financialConsistency.quality !== "Healthy" ||
    context.decisionConfidence.negativeFactors.length >= 2 ||
    context.investmentScore.topRisks.length >= 2;
  const warnings = [
    aggressiveDecision && unresolvedRisks
      ? "Decision vs Risk: aggressive recommendation conflicts with unresolved risk signals."
      : "",
    context.financialConsistency.warnings.some((warning) => warning.code === "capital_efficiency") &&
    context.investmentScore.confidence < 60
      ? "Financial vs Recommendation: high funding need and weak validation require caution."
      : "",
    context.investmentScore.confidence < 50 && aggressiveDecision
      ? "Score vs Decision: low confidence does not support an aggressive recommendation."
      : "",
  ].filter(Boolean);
  const strengths = [
    evidenceQuality >= 62 ? "Evidence base supports directional planning" : "",
    sourceConfidence >= 62 ? "Source confidence is sufficient for planning" : "",
    businessModelQuality >= 58 ? "Clear business model" : "",
    context.metrics.grossMargin.value >= context.benchmark.ranges.grossMargin.low
      ? "Attractive margin potential"
      : "",
    benchmarkFit >= 62 ? "Benchmark fit supports the modeled assumptions" : "",
    context.decisionConfidence.positiveFactors[0] || "",
  ].filter(Boolean);
  const weaknesses = [
    evidenceQuality < 65 ? "Limited customer validation" : "",
    sourceConfidence < 55 ? "Source confidence requires stronger validation" : "",
    context.financialConsistency.quality !== "Healthy"
      ? "Financial assumptions require testing"
      : "",
    benchmarkFit < 55 ? "Benchmark fit needs refinement" : "",
    validationReadiness < 55 ? "Validation roadmap has unresolved experiments" : "",
    executionReadiness < 55 ? "Execution readiness needs stronger proof" : "",
    context.decisionConfidence.negativeFactors[0] || "",
  ].filter(Boolean);
  const improvementActions = [
    evidenceQuality < 65 ? "Collect customer, revenue, retention, or pilot evidence." : "",
    sourceConfidence < 60 ? "Attach verified market sources and benchmark references." : "",
    financialConsistency < 65 ? "Validate CAC, LTV, payback, burn, and runway assumptions." : "",
    benchmarkFit < 60 ? "Refine benchmark selection by industry, model, and geography." : "",
    validationReadiness < 60 ? "Run the highest-priority validation experiments before scaling." : "",
  ].filter(Boolean);
  const overallQuality = qualityFromScore(totalScore);
  const confidenceLevel = confidenceLevelFromScore(totalScore);

  return {
    version: "report_quality_engine_v2",
    totalScore,
    confidenceLevel,
    overallQuality,
    qualityScore: totalScore,
    dimensions: {
      evidenceQuality,
      sourceConfidence,
      financialConsistency,
      benchmarkFit,
      validationReadiness,
    },
    strengths: [...new Set(strengths)].slice(0, 4),
    weaknesses: [...new Set(weaknesses)].slice(0, 4),
    improvementActions: [...new Set(improvementActions)].slice(0, 5),
    risks: [...new Set(weaknesses)].slice(0, 4),
    warnings,
    confidenceSummary:
      overallQuality === "High Confidence"
        ? "Report findings are directionally reliable, with limited consistency issues."
        : overallQuality === "Moderate Confidence"
          ? "Report findings are useful for decision planning, but validation gaps remain."
          : "Report findings should be treated as early-stage planning input until evidence improves.",
  };
}
