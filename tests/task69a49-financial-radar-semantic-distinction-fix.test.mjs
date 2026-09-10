// TASK #69A-49 -- Eliminate the semantic mismatch between "Financial
// Signal" and "Financial Consistency" in the Business Idea Validation
// report.
//
// LIVE OBSERVATION: a fresh, #69A-48-corrected report showed Executive
// Snapshot's "Financial Consistency: 34" directly beside Confidence
// Radar's "Financial Signal: 67" -- two numbers a founder could
// reasonably read as two measurements of the same "is the financial
// story reliable" question.
//
// TRACE (full detail in the final report to the user):
//   Financial Consistency = app/lib/ai/report-intelligence.ts's
//   createReportIntelligenceModel: 86/58/34 keyed off
//   context.financialConsistency.quality ("Healthy"/"Needs Validation"/
//   else), itself computed in financial-model.ts by checking the
//   financial MODEL's own internal coherence -- LTV vs. CAC, margin vs.
//   burn/runway math -- never touching external research evidence. This
//   is #69A-43's own already-protected, unchanged source.
//
//   Confidence Radar "Financial Signal" (now "Financial Research
//   Coverage") = investmentScore.decisionEngine.financialScore.score,
//   refreshed by market-research-coverage.ts's scoreCategory from
//   dimensions.financialEvidence, whose EXACT formula
//   (evaluateMarketResearchCoverage) is:
//     filingCount = count of verified evidence classified "financial_filing"
//     financialEvidence = verifiedMarketSizeAvailable
//       ? clamp(58 + min(22, filingCount*6) + quality*0.2)
//       : clamp(22 + min(24, filingCount*8) + quality*0.08)
//   i.e. the strength of EXTERNAL, independently verified market-size and
//   financial-filing research evidence available to benchmark this
//   business's OWN assumptions against -- a real, legitimate, distinct
//   concept, never reused/aliased from marketConfidence/competitiveEvidence/
//   any other dimension. NOT the same concept as Financial Consistency
//   (internal model coherence) or #69A-46's canonical "Financial
//   Evidence" (per-metric provenance of THIS business's own inputs).
//
// FIX: label-only rename (report-presentation.ts) from "Financial
// Signal" to "Financial Research Coverage" -- names both the SOURCE
// (external research) and the SHAPE (coverage/breadth of verified
// market-size + financial-filing evidence) so it can no longer be
// mistaken for either sibling concept. No value/formula changed for
// Financial Consistency, Financial Evidence, or the radar's own score
// expression.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  evaluateMarketResearchCoverage,
} from "../app/lib/ai/market-research-coverage.ts";
import { classifyFinancialMetricEvidenceType } from "../app/lib/financial-evidence-labeling.ts";
import { buildExecutiveSnapshot, getReportQualityBreakdown } from "../app/lib/report-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const reportIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/report-intelligence.ts"), "utf8");
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

function buildBase() {
  return createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
}

function verifiedEvidence({ id, field, claim, value, sourceType = "credible_market_data", confidence = 78 }) {
  return {
    id,
    field,
    claim,
    value,
    label: "Verified from external source",
    sourceTitle: `${id} independent source`,
    publisher: "Independent Research Co.",
    url: `https://research-example.com/reports/${id}`,
    sourceType,
    authorityLevel: "secondary",
    confidence,
    publishedDate: "2026-01-10",
    lastChecked: "2026-08-20T00:00:00.000Z",
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

function marketSizeEvidence(id) {
  return verifiedEvidence({
    id,
    field: "market_size",
    claim: "TAM is estimated at $4.2 billion, growing at a 12% CAGR.",
    value: "$4.2B TAM, 12% CAGR",
  });
}

function financialFilingEvidence(id) {
  return verifiedEvidence({
    id,
    field: "financial_filing",
    claim: "Annual report shows revenue growth in the SMB fintech segment.",
    value: "10-K annual report",
    sourceType: "official filing",
  });
}

// --- 1: Financial Consistency comes from its canonical, structured -----
// --- source, never research coverage -------------------------------------

test("1. Financial Consistency (reportIntelligence.dimensions.financialConsistency) is identical whether external research evidence is abundant or absent -- proving it is never sourced from research coverage", () => {
  const base = buildBase();
  const withoutResearch = base.reportIntelligence.dimensions.financialConsistency;

  const abundantResearchEvidence = [
    marketSizeEvidence("R1"),
    financialFilingEvidence("R2"),
    financialFilingEvidence("R3"),
    financialFilingEvidence("R4"),
  ];
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: abundantResearchEvidence }, REAL_CASE_PROMPT).context
  );

  assert.equal(refreshed.reportIntelligence.dimensions.financialConsistency, withoutResearch);
});

test("2. Financial Consistency's own formula reads only context.financialConsistency.quality -- no reference to dimensions.financialEvidence or any research-coverage field", () => {
  const financialConsistencySnippet = reportIntelligenceSource.slice(
    reportIntelligenceSource.indexOf("const financialConsistency ="),
    reportIntelligenceSource.indexOf("const evidenceQuality =")
  );
  assert.match(financialConsistencySnippet, /context\.financialConsistency\.quality/);
  assert.doesNotMatch(financialConsistencySnippet, /financialEvidence/);
  assert.doesNotMatch(financialConsistencySnippet, /dimensions\./);
});

// --- 2: the financial radar metric comes from its own canonical --------
// --- structured source, precisely defined --------------------------------

test("3. [ROOT FORMULA] dimensions.financialEvidence rewards a verified market-size figure and financial-filing source count from EXTERNAL research evidence -- reproducing the exact formula live, not a guess", () => {
  const sparseEvidence = [verifiedEvidence({ id: "S1", field: "general", claim: "General market color.", value: "n/a" })];
  const richEvidence = [marketSizeEvidence("R1"), financialFilingEvidence("R2"), financialFilingEvidence("R3")];

  const sparseCoverage = evaluateMarketResearchCoverage(sparseEvidence, REAL_CASE_PROMPT);
  const richCoverage = evaluateMarketResearchCoverage(richEvidence, REAL_CASE_PROMPT);

  assert.equal(sparseCoverage.verifiedMarketSizeAvailable, false);
  assert.equal(richCoverage.verifiedMarketSizeAvailable, true);
  assert.ok(
    richCoverage.dimensions.financialEvidence > sparseCoverage.dimensions.financialEvidence,
    `expected verified market-size + filing evidence to raise financialEvidence (sparse=${sparseCoverage.dimensions.financialEvidence}, rich=${richCoverage.dimensions.financialEvidence})`
  );
});

test("4. [ROOT FORMULA] financial-filing evidence alone (no verified market size) still raises financialEvidence, but stays on the lower ('no market size') branch of the formula", () => {
  const noFilingEvidence = [verifiedEvidence({ id: "S1", field: "general", claim: "General commentary.", value: "n/a" })];
  const filingOnlyEvidence = [financialFilingEvidence("R1"), financialFilingEvidence("R2")];

  const noFilingCoverage = evaluateMarketResearchCoverage(noFilingEvidence, REAL_CASE_PROMPT);
  const filingOnlyCoverage = evaluateMarketResearchCoverage(filingOnlyEvidence, REAL_CASE_PROMPT);

  assert.equal(filingOnlyCoverage.verifiedMarketSizeAvailable, false);
  assert.ok(filingOnlyCoverage.dimensions.financialEvidence > noFilingCoverage.dimensions.financialEvidence);
  // Even well-evidenced, filing-only coverage must stay well below the
  // verified-market-size branch's own floor (58) -- confirming these are
  // two genuinely different formula branches, not one blended score.
  assert.ok(filingOnlyCoverage.dimensions.financialEvidence < 58);
});

test("5. the financial radar's canonical source, dimensions.financialEvidence, is computed independently of marketConfidence/competitiveEvidence -- confirmed by its own formula never referencing them", () => {
  const financialEvidenceSnippet = marketResearchCoverageSource.slice(
    marketResearchCoverageSource.indexOf("const financialEvidence = clamp("),
    marketResearchCoverageSource.indexOf("const productSources =")
  );
  assert.match(financialEvidenceSnippet, /verifiedMarketSizeAvailable/);
  assert.match(financialEvidenceSnippet, /filingCount/);
  assert.doesNotMatch(financialEvidenceSnippet, /marketConfidence/);
  assert.doesNotMatch(financialEvidenceSnippet, /competitiveEvidence/);
});

// --- 3/6: labels accurately describe the formulas; renamed correctly ----

test("6. the Confidence Radar's financial dimension is labeled 'Financial Research Coverage', not 'Financial Signal' -- the prior label is preserved only as a backward-compatible prose-extraction alias", () => {
  assert.match(reportPresentationSource, /label: isTurkish \? "Finansal Araştırma Kapsamı" : "Financial Research Coverage",/);
  const aliasesSnippet = reportPresentationSource.slice(
    reportPresentationSource.indexOf('label: isTurkish ? "Finansal Araştırma Kapsamı"'),
    reportPresentationSource.indexOf("score: investmentScore?.decisionEngine?.financialScore?.score,")
  );
  assert.match(aliasesSnippet, /"Financial Signal"/);
});

test("7. the new label does not collide, textually, with the labels used for Financial Consistency or Report Quality's Source Strength", () => {
  const radarLabel = "Financial Research Coverage";
  const qualityLabels = ["Financial Consistency", "Source Strength", "Validation Readiness", "Benchmark Fit", "Data Completeness"];
  for (const qualityLabel of qualityLabels) {
    assert.notEqual(radarLabel, qualityLabel);
    assert.ok(
      !radarLabel.toLowerCase().includes(qualityLabel.toLowerCase()) &&
        !qualityLabel.toLowerCase().includes(radarLabel.toLowerCase()),
      `expected no substring collision between "${radarLabel}" and "${qualityLabel}"`
    );
  }
});

// --- 4: unrelated scores cannot silently populate the financial radar ---

test("8. [INVARIANT] the Confidence Radar's financial dimension reads decisionEngine.financialScore specifically -- never marketScore, competitionScore, or any other category", () => {
  const investmentScore = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 91, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 67, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 55, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 30, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 99, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  const snapshot = buildExecutiveSnapshot("", investmentScore, undefined);
  const financial = snapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  assert.equal(financial.score, 67, "must read financialScore (67), never marketScore (91) or competitionScore (99)");
});

// --- 5: web and PDF use identical financial radar value + label ---------

test("9. [PARITY] web (single-section content) and PDF (full concatenated content) callers agree on the Financial Research Coverage dimension for the same investmentScore", () => {
  const investmentScore = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 65, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 67, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 60, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 52, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 73, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  const executiveSummarySection = "MONITOR. The opportunity shows directional promise pending validation.";
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    "Financial Dashboard\nFinancial Consistency: 34/100 - assumptions require validation.",
  ].join("\n\n");

  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, investmentScore, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, investmentScore, undefined);

  assert.deepEqual(webSnapshot.confidenceRadar, pdfSnapshot.confidenceRadar);
  const webFinancial = webSnapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  const pdfFinancial = pdfSnapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  assert.equal(webFinancial.score, 67);
  assert.equal(pdfFinancial.score, 67);
});

// --- 6: planning assumptions cannot be treated as verified evidence -----

test("10. [FINANCIAL SAFETY] a high Financial Research Coverage score does not upgrade this business's OWN planning-assumption metrics (ARPA, CAC, LTV, gross margin, burn, runway, investment needed) to Verified -- their classification depends only on their own formula/assumptions text", () => {
  const base = buildBase();
  const abundantResearchEvidence = [
    marketSizeEvidence("R1"),
    financialFilingEvidence("R2"),
    financialFilingEvidence("R3"),
    financialFilingEvidence("R4"),
  ];
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: abundantResearchEvidence }, REAL_CASE_PROMPT).context
  );
  // Confirm the fixture really does produce a high financial radar score
  // -- otherwise this proof would be vacuous.
  assert.ok(
    refreshed.investmentScore.decisionEngine.financialScore.score >= 58,
    `expected abundant financial research evidence to raise the radar score, got ${refreshed.investmentScore.decisionEngine.financialScore.score}`
  );

  for (const metricKey of ["arpa", "cac", "ltv", "grossMargin", "monthlyBurn", "runway", "investmentNeeded"]) {
    const metric = refreshed.metrics[metricKey];
    if (!metric) continue;
    const classification = classifyFinancialMetricEvidenceType(metric);
    assert.notEqual(
      classification,
      "verified",
      `${metricKey} must not be classified "verified" merely because external financial research coverage is high -- got ${classification}`
    );
  }
});

test("11. [FINANCIAL SAFETY] financial-model.ts's own consistency warnings are unaffected by this fix -- Financial Consistency continues to honestly reflect model coherence, never smoothed over by a strong external radar score", () => {
  const base = buildBase();
  const abundantResearchEvidence = [marketSizeEvidence("R1"), financialFilingEvidence("R2"), financialFilingEvidence("R3")];
  const refreshed = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: abundantResearchEvidence }, REAL_CASE_PROMPT).context
  );
  assert.deepEqual(
    refreshed.financialConsistency.warnings,
    base.financialConsistency.warnings,
    "financial consistency warnings must be identical regardless of external research coverage"
  );
});

// --- 7: historical reports without the newer structured field ----------
// --- degrade honestly ----------------------------------------------------

test("12. [HISTORICAL SAFETY] with no investmentScore at all, the Confidence Radar's financial dimension reports null (never a fabricated fallback number)", () => {
  const snapshot = buildExecutiveSnapshot("Some report text mentioning nothing about financial dimensions.", undefined, undefined);
  const financial = snapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  assert.ok(financial);
  assert.equal(financial.score, null);
});

test("13. [HISTORICAL SAFETY] with no reportQuality at all, getReportQualityBreakdown degrades to an empty array rather than fabricating a Financial Consistency card", () => {
  assert.deepEqual(getReportQualityBreakdown(undefined, false), []);
});

// --- 8: decision/confidence/founder-readiness untouched by this fix ----

test("14. [INVARIANT] no canonical decision (createRecommendation/applyFatalBlockerOverride), founder-readiness, investment-score, financial-model, or plan-executor file carries a #69A-49 marker -- this fix is confined to report-presentation.ts's one Confidence Radar label", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/report-intelligence.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/financial-evidence-labeling.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-49/, `${relativePath} must not carry a #69A-49 marker`);
  }
  assert.match(reportPresentationSource, /TASK #69A-49/);
});

test("15. [INVARIANT] the rename touches only the `label`/`aliases` fields of the financial Confidence Radar dimension -- the `score` expression is byte-identical to #69A-47's own version", () => {
  assert.match(
    reportPresentationSource,
    /score: investmentScore\?\.decisionEngine\?\.financialScore\?\.score,\s*\n\s*\},/
  );
});

// --- 9: no prose parsing controls either score --------------------------

test("16. [INVARIANT] when investmentScore IS present, the Confidence Radar's financial dimension ignores conflicting prose entirely -- the structured score always wins", () => {
  const investmentScore = {
    totalScore: 62,
    confidence: 65,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 65, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 67, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 60, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 52, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 73, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
  };
  const conflictingContent = "Financial Research Coverage: 12% based on limited external filings.";
  const snapshot = buildExecutiveSnapshot(conflictingContent, investmentScore, undefined);
  const financial = snapshot.confidenceRadar.find((d) => d.label === "Financial Research Coverage");
  assert.equal(financial.score, 67, "the structured decisionEngine value must win over conflicting prose");
});

test("17. [INVARIANT] Financial Consistency's own reportQuality dimension is never re-derived from prose in getReportQualityBreakdown -- it is read directly from the passed reportQuality object", () => {
  const reportQuality = {
    totalScore: 55,
    confidenceLevel: "Moderate Confidence",
    overallQuality: "Preliminary",
    qualityScore: 55,
    dimensions: {
      evidenceQuality: 65,
      sourceConfidence: 71,
      financialConsistency: 34,
      benchmarkFit: 46,
      validationReadiness: 47,
    },
  };
  const breakdown = getReportQualityBreakdown(reportQuality, false);
  const financialConsistencyCard = breakdown.find((item) => item.label === "Financial Consistency");
  assert.ok(financialConsistencyCard);
  assert.equal(financialConsistencyCard.value, "34/100");
});
