function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Applies transparent evidence-quality penalties to an otherwise weighted
 * report-quality score. The inputs are counts/flags from deterministic report
 * data, so the same evidence always produces the same confidence.
 */
export function deriveReportQualityConfidence(input) {
  const assumptionPenalty = Math.min(18, input.assumptionCount * 2);
  const marketPenalty = input.missingMarketData ? 10 : 0;
  const competitionPenalty = input.weakCompetitiveEvidence ? 8 : 0;
  const financialPenalty = Math.min(18, input.uncertainFinancialMetricCount * 3);
  const evidenceBonus = Math.min(
    10,
    (input.authoritativeSourceCount * 2) + (input.userProvidedValueCount * 2)
  );

  return clampScore(
    input.weightedScore -
      assumptionPenalty -
      marketPenalty -
      competitionPenalty -
      financialPenalty +
      evidenceBonus
  );
}

