export type ReportQualityConfidenceInput = {
  weightedScore: number;
  assumptionCount: number;
  missingMarketData: boolean;
  weakCompetitiveEvidence: boolean;
  uncertainFinancialMetricCount: number;
  authoritativeSourceCount: number;
  userProvidedValueCount: number;
};

export function deriveReportQualityConfidence(
  input: ReportQualityConfidenceInput
): number;
