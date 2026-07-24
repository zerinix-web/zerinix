import "server-only";

export type PortfolioRiskLevel = "low" | "medium" | "high";

export type PortfolioUsageInput = {
  reportType: string;
  costUsd: number;
  confidenceScore: number;
  businessImpactScore: number;
  roiRatio: number;
  outcomeScore: number;
  sourceReliability: number;
  evidenceCount: number;
  decisionScore: number;
  createdAt: string;
};

export type PortfolioIntelligence = {
  portfolio_score: number;
  portfolio_health_score: number;
  average_confidence: number;
  average_business_impact: number;
  average_roi: number;
  average_outcome_probability: number;
  average_source_reliability: number;
  portfolio_risk: PortfolioRiskLevel;
  portfolio_growth_score: number;
  portfolio_efficiency_score: number;
  portfolio_version: "v1";
  reportTypeDistribution: Array<{ reportType: string; count: number }>;
  highRiskReportClusters: Array<{ reportType: string; count: number }>;
  lowConfidenceTrends: Array<{ label: string; value: number }>;
  weakEvidenceTrends: Array<{ label: string; value: number }>;
  costHeavyReportCategories: Array<{ reportType: string; costUsd: number }>;
  underperformingReportTypes: Array<{ reportType: string; score: number }>;
  topPerformingCategories: Array<{ reportType: string; score: number }>;
  lowestPerformingCategories: Array<{ reportType: string; score: number }>;
  overallAiValueIndex: number;
};

export const EMPTY_PORTFOLIO_INTELLIGENCE: PortfolioIntelligence = {
  portfolio_score: 0,
  portfolio_health_score: 0,
  average_confidence: 0,
  average_business_impact: 0,
  average_roi: 0,
  average_outcome_probability: 0,
  average_source_reliability: 0,
  portfolio_risk: "low",
  portfolio_growth_score: 0,
  portfolio_efficiency_score: 0,
  portfolio_version: "v1",
  reportTypeDistribution: [],
  highRiskReportClusters: [],
  lowConfidenceTrends: [],
  weakEvidenceTrends: [],
  costHeavyReportCategories: [],
  underperformingReportTypes: [],
  topPerformingCategories: [],
  lowestPerformingCategories: [],
  overallAiValueIndex: 0,
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  const cleanValues = values.filter((value) => Number.isFinite(value) && value > 0);

  return cleanValues.length
    ? Math.round(cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length)
    : 0;
}

function dayLabel(value: string) {
  return value ? value.slice(0, 10) : "unknown";
}

export function createAiPortfolioIntelligence(rows: PortfolioUsageInput[]): PortfolioIntelligence {
  const reportRows = rows.filter(
    (row) =>
      row.businessImpactScore > 0 ||
      row.outcomeScore > 0 ||
      row.roiRatio > 0 ||
      row.confidenceScore > 0
  );

  if (!reportRows.length) {
    return EMPTY_PORTFOLIO_INTELLIGENCE;
  }

  const averageConfidence = average(reportRows.map((row) => row.confidenceScore));
  const averageBusinessImpact = average(reportRows.map((row) => row.businessImpactScore));
  const averageOutcomeProbability = average(reportRows.map((row) => row.outcomeScore));
  const averageSourceReliability = average(reportRows.map((row) => row.sourceReliability));
  const averageRoi = Number(
    (
      reportRows.reduce((sum, row) => sum + Math.max(0, row.roiRatio), 0) /
      Math.max(1, reportRows.filter((row) => row.roiRatio > 0).length)
    ).toFixed(2)
  );
  const typeMap = new Map<
    string,
    {
      count: number;
      totalScore: number;
      costUsd: number;
      highRiskCount: number;
    }
  >();
  const lowConfidenceTrendMap = new Map<string, { total: number; low: number }>();
  const weakEvidenceTrendMap = new Map<string, { total: number; weak: number }>();

  for (const row of reportRows) {
    const type = row.reportType || "unknown";
    const category = typeMap.get(type) || {
      count: 0,
      totalScore: 0,
      costUsd: 0,
      highRiskCount: 0,
    };
    const rowScore = clampScore(
      row.businessImpactScore * 0.3 +
        row.outcomeScore * 0.28 +
        Math.min(100, row.roiRatio * 2) * 0.17 +
        row.confidenceScore * 0.15 +
        row.sourceReliability * 0.1
    );

    category.count += 1;
    category.totalScore += rowScore;
    category.costUsd += row.costUsd;
    if (row.outcomeScore < 45 || row.confidenceScore < 45 || row.decisionScore < 45) {
      category.highRiskCount += 1;
    }
    typeMap.set(type, category);

    const label = dayLabel(row.createdAt);
    const confidenceTrend = lowConfidenceTrendMap.get(label) || { total: 0, low: 0 };
    confidenceTrend.total += 1;
    confidenceTrend.low += row.confidenceScore > 0 && row.confidenceScore < 50 ? 1 : 0;
    lowConfidenceTrendMap.set(label, confidenceTrend);

    const evidenceTrend = weakEvidenceTrendMap.get(label) || { total: 0, weak: 0 };
    evidenceTrend.total += 1;
    evidenceTrend.weak += row.evidenceCount <= 0 || row.sourceReliability < 50 ? 1 : 0;
    weakEvidenceTrendMap.set(label, evidenceTrend);
  }

  const categoryScores = [...typeMap.entries()].map(([reportType, summary]) => ({
    reportType,
    score: clampScore(summary.totalScore / Math.max(1, summary.count)),
    count: summary.count,
    costUsd: Number(summary.costUsd.toFixed(4)),
    highRiskCount: summary.highRiskCount,
  }));
  const portfolioGrowthScore = clampScore(
    averageBusinessImpact * 0.45 + averageOutcomeProbability * 0.35 + Math.min(100, averageRoi * 2) * 0.2
  );
  const portfolioEfficiencyScore = clampScore(
    Math.min(100, averageRoi * 3) * 0.45 +
      averageSourceReliability * 0.25 +
      averageConfidence * 0.2 +
      (100 - Math.min(100, average(reportRows.map((row) => row.costUsd * 50)))) * 0.1
  );
  const portfolioHealthScore = clampScore(
    averageConfidence * 0.25 +
      averageBusinessImpact * 0.25 +
      averageOutcomeProbability * 0.25 +
      averageSourceReliability * 0.15 +
      portfolioEfficiencyScore * 0.1
  );
  const highRiskCount = categoryScores.reduce((sum, item) => sum + item.highRiskCount, 0);
  const highRiskRatio = highRiskCount / Math.max(1, reportRows.length);
  const portfolioRisk: PortfolioRiskLevel =
    highRiskRatio >= 0.45 || portfolioHealthScore < 45
      ? "high"
      : highRiskRatio >= 0.2 || portfolioHealthScore < 65
        ? "medium"
        : "low";

  return {
    portfolio_score: portfolioHealthScore,
    portfolio_health_score: portfolioHealthScore,
    average_confidence: averageConfidence,
    average_business_impact: averageBusinessImpact,
    average_roi: averageRoi,
    average_outcome_probability: averageOutcomeProbability,
    average_source_reliability: averageSourceReliability,
    portfolio_risk: portfolioRisk,
    portfolio_growth_score: portfolioGrowthScore,
    portfolio_efficiency_score: portfolioEfficiencyScore,
    portfolio_version: "v1",
    reportTypeDistribution: categoryScores
      .map(({ reportType, count }) => ({ reportType, count }))
      .sort((a, b) => b.count - a.count),
    highRiskReportClusters: categoryScores
      .filter((item) => item.highRiskCount > 0)
      .map((item) => ({ reportType: item.reportType, count: item.highRiskCount }))
      .sort((a, b) => b.count - a.count),
    lowConfidenceTrends: [...lowConfidenceTrendMap.entries()]
      .map(([label, item]) => ({ label, value: Math.round((item.low / Math.max(1, item.total)) * 100) }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-14),
    weakEvidenceTrends: [...weakEvidenceTrendMap.entries()]
      .map(([label, item]) => ({ label, value: Math.round((item.weak / Math.max(1, item.total)) * 100) }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-14),
    costHeavyReportCategories: categoryScores
      .map((item) => ({ reportType: item.reportType, costUsd: item.costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 5),
    underperformingReportTypes: categoryScores
      .filter((item) => item.score < 55)
      .map((item) => ({ reportType: item.reportType, score: item.score }))
      .sort((a, b) => a.score - b.score),
    topPerformingCategories: categoryScores
      .map((item) => ({ reportType: item.reportType, score: item.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
    lowestPerformingCategories: categoryScores
      .map((item) => ({ reportType: item.reportType, score: item.score }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5),
    overallAiValueIndex: clampScore(
      portfolioHealthScore * 0.35 +
        portfolioGrowthScore * 0.3 +
        portfolioEfficiencyScore * 0.25 +
        averageSourceReliability * 0.1
    ),
  };
}
