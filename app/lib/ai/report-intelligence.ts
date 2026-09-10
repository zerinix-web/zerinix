import type { FinancialConsistencyCheck, FinancialModel } from "@/app/lib/ai/financial-model";
import type { InvestmentScore } from "@/app/lib/ai/investment-score";
import type { SourceIntelligenceModel } from "@/app/lib/ai/source-intelligence";
import type { ValidationIntelligence } from "@/app/lib/ai/validation-intelligence";
import { deriveReportQualityConfidence } from "@/app/lib/report-confidence-quality.mjs";

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

// TASK #69A-44 -- ROOT CAUSE FIX (canonical metric consolidation).
// Confirmed live: a fresh report's Executive Snapshot showed "Validation
// Readiness: 19/100" while the SAME report's own
// formatValidationIntelligenceSummary text (financial-assumptions.ts,
// embedded elsewhere in the same report) showed "Validation Readiness
// Score: 47/100" -- two DIFFERENT numbers already carrying the
// near-identical label "Validation Readiness"/"Validation Readiness
// Score" for what is unambiguously meant to be the SAME concept
// (how mature is this business's real-world validation).
//
// ROOT CAUSE: this dimension used to read context.validationIntelligence
// (ValidationIntelligenceModel, "V1" -- a crude score/experiments-count
// model, #69A-4-era) instead of context.validationIntelligenceV2
// (ValidationIntelligence, "V2" -- the richer, per-assumption
// customer-demand/pricing/CAC/retention/operational model that already
// IS this report's own single canonical validation-maturity source
// everywhere else: formatValidationIntelligenceSummary's own "Validation
// Readiness Score" text, and the persisted metadata.validationIntelligence
// object every renderer's dedicated validation panel reads). V1 and V2
// are two independently-computed scoring functions for the exact same
// semantic metric, calculated inconsistently -- a genuine duplicate,
// not two legitimately different concepts. V1 is never touched by
// market research (same as V2 -- both read only financialModel/
// financialConsistency/sourceIntelligence/decisionConfidence, confirmed
// in financial-assumptions.ts), so this is a pure consolidation onto the
// existing, richer, already-canonical source -- not a new computation
// and not a formula change to any OTHER metric.
function validationReadinessScore(validationIntelligenceV2?: ValidationIntelligence) {
  if (!validationIntelligenceV2) {
    return 42;
  }

  return clampScore(validationIntelligenceV2.overallScore);
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
  // TASK #69A-44 -- consolidated onto V2 (the richer, per-assumption
  // model already used as this report's single canonical validation-
  // maturity source everywhere else); V1 (ValidationIntelligenceModel)
  // is intentionally no longer read here.
  validationIntelligenceV2?: ValidationIntelligence;
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
  const validationReadiness = validationReadinessScore(context.validationIntelligenceV2);
  const weightedScore = clampScore(
    (evidenceQuality * 0.25) +
      (sourceConfidence * 0.2) +
      (financialConsistency * 0.25) +
      (benchmarkFit * 0.15) +
      (validationReadiness * 0.15)
  );
  const sourceItems = context.sourceIntelligence?.items || [];
  const marketItems = sourceItems.filter((item) =>
    item.area === "TAM/SAM/SOM" || item.area === "Market Size"
  );
  const competitorItem = sourceItems.find((item) => item.area === "Competitor Insights");
  const uncertainFinancialMetricCount = Object.values(context.metrics).filter(
    (metric) => metric.confidence === "Low"
  ).length;
  const assumptionCount =
    context.financialConsistency.sources.aiPlanningAssumptions.length +
    context.financialConsistency.sources.benchmarkAssumptions.length;
  const userProvidedValueCount =
    context.financialConsistency.sources.userProvidedData.filter((item) =>
      !/\bno direct operating data\b/i.test(item) &&
      /\b(user supplied|actual|traction|pilot|sales|waitlist)\b/i.test(item)
    ).length;
  const authoritativeSourceCount = sourceItems.filter(
    (item) =>
      item.confidence === "High Confidence" &&
      (item.sourceType === "Market Research" ||
        item.sourceType === "Competitor Data" ||
        item.sourceType === "User Provided")
  ).length;
  const totalScore = deriveReportQualityConfidence({
    weightedScore,
    assumptionCount,
    missingMarketData:
      marketItems.length === 0 ||
      marketItems.every((item) => item.confidence === "Low Confidence"),
    weakCompetitiveEvidence:
      !competitorItem || competitorItem.confidence === "Low Confidence",
    uncertainFinancialMetricCount,
    authoritativeSourceCount,
    userProvidedValueCount,
  });
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
    assumptionCount >= 4 ? "The report relies on multiple unverified assumptions" : "",
    marketItems.length === 0 ||
    marketItems.every((item) => item.confidence === "Low Confidence")
      ? "Market evidence is missing or low confidence"
      : "",
    !competitorItem || competitorItem.confidence === "Low Confidence"
      ? "Competitive evidence is weak"
      : "",
    uncertainFinancialMetricCount >= 3
      ? "Financial projections contain substantial uncertainty"
      : "",
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
    assumptionCount >= 4 ? "Replace the highest-impact assumptions with observed evidence." : "",
    financialConsistency < 65 ? "Validate CAC, LTV, payback, burn, and runway assumptions." : "",
    benchmarkFit < 60 ? "Refine benchmark selection by industry, model, and geography." : "",
    validationReadiness < 60 ? "Run the highest-priority validation experiments before scaling." : "",
  ].filter(Boolean);
  const rawOverallQuality = qualityFromScore(totalScore);
  const rawConfidenceLevel = confidenceLevelFromScore(totalScore);

  // CRITICAL FIX -- confidence must reflect available information and
  // validation gaps, not just the weighted score. Business Plan reports
  // specifically should never read "High Confidence" when none of the
  // core financial figures (MRR/ARR/current customers/subscription
  // price/investment amount) were ever confirmed by the founder --
  // every number driving the decision is still a benchmark estimate at
  // that point, regardless of how strong the rest of the analysis is.
  // Gated to business_plan only (context.reportKind), so this never
  // changes Market Analysis's confidence banding, which this same
  // function also computes.
  const businessPlanFinancialValidationFactCount =
    context.reportKind === "business_plan"
      ? [
          context.userProvidedFacts.mrr,
          context.userProvidedFacts.arr,
          context.userProvidedFacts.customers,
          context.userProvidedFacts.pricePerCustomer,
          context.userProvidedFacts.investmentAmount,
        ].filter((value) => value !== null).length
      : null;
  const financialValidationLimited = businessPlanFinancialValidationFactCount === 0;
  const overallQuality: ReportQualityLevel =
    financialValidationLimited && rawOverallQuality === "High Confidence"
      ? "Moderate Confidence"
      : rawOverallQuality;
  const confidenceLevel: ReportQualityConfidenceLevel =
    financialValidationLimited && rawConfidenceLevel === "High Confidence"
      ? "Medium Confidence"
      : rawConfidenceLevel;

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
