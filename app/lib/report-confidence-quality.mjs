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
  const penalized =
    input.weightedScore -
    assumptionPenalty -
    marketPenalty -
    competitionPenalty -
    financialPenalty +
    evidenceBonus;

  // Confirmed live: a report whose 5 displayed sub-scores (evidence
  // quality, source confidence, financial consistency, benchmark fit,
  // validation readiness) were all in the 28-73 range -- a weightedScore
  // around 43 -- still showed "Overall Quality Score: 0/100". The four
  // penalties above are individually capped, but they can still stack to
  // more than weightedScore itself (18 + 10 + 8 + 18 = 54 max, against a
  // typical weightedScore in the 30-60s), clamping straight to 0. That
  // penalty signal is real, but a total of 0 sitting next to five
  // comfortably non-zero sub-scores reads as a broken computation, not
  // as "very low quality" -- readers reasonably expect the total to BE a
  // combination of the parts they can see, not something that can look
  // completely disconnected from all of them at once. Flooring the
  // result at a fraction of weightedScore keeps the penalty meaningfully
  // visible (a penalized report still scores well below its raw
  // weighted average) without ever landing somewhere a reader would call
  // impossible given the sub-scores shown alongside it.
  const floor = Math.round(input.weightedScore * 0.4);

  return clampScore(Math.max(floor, penalized));
}

