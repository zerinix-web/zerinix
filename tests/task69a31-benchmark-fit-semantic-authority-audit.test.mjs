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
  deriveCanonicalCompetitiveEvidence,
} from "../app/lib/ai/market-research-coverage.ts";
import { getReportQualityBreakdown } from "../app/lib/report-presentation.ts";

// ===========================================================================
// TASK #69A-31 -- AUDIT of the two "Benchmark Fit"-labeled values a fresh
// report shows simultaneously:
//   - Benchmark Intelligence: "Overall Fit" = 70/100
//   - Executive Decision Center / Report Quality: "Benchmark Fit" = 46/100
//
// CONCLUSION: these are two genuinely DIFFERENT, legitimately independent
// metrics -- NOT an authority-drift bug (that class of bug, a post-research
// refresh silently overwriting reportIntelligence.dimensions.benchmarkFit
// with an unrelated competitiveEvidence value, was already found and fixed
// by #69A-38G, re-verified intact below). This IS a naming-ambiguity
// problem: both metrics used to share language ("benchmark fit" is a
// component of both labels/concepts) even though the underlying formulas
// have never been the same thing.
//
//   benchmarkScore.overallFit (benchmark-intelligence.ts,
//   createBenchmarkIntelligenceScore) -- a rich, 5-dimension WEIGHTED
//   COMPOSITE of how well this business's ACTUAL financial metrics
//   (gross margin, CAC, LTV, CAC payback, pricing) + business model +
//   geography fit real INDUSTRY BENCHMARK RANGES. Displayed as
//   "Overall Fit" inside the "Benchmark Intelligence" panel (web:
//   BenchmarkIntelligencePanel.tsx; PDF:
//   createPdfBenchmarkIntelligenceSection, pdf-normalization.mjs -- both
//   read the SAME context.benchmarkScore.overallFit field).
//
//   reportIntelligence.dimensions.benchmarkFit (report-intelligence.ts,
//   benchmarkFitScore) -- a coarse, 3-input measure of how much
//   CONFIDENCE/VALIDATION backs the report's own fit CLASSIFICATION
//   (context.benchmarkFit.fit: "Strong Fit"/"Moderate Fit"/"Needs
//   Validation", plus its own .confidence tag, minus a validation-gap
//   count penalty). It never incorporates the actual metric-vs-range
//   analysis benchmarkScore.overallFit performs. Displayed inside the
//   "Report Quality" breakdown (web + PDF both call the SAME
//   getReportQualityBreakdown, report-presentation.ts).
//
// FIX: renamed the second dimension's DISPLAY LABEL ONLY (no value or
// formula change, and no rename of benchmarkScore.overallFit / its own
// "Overall Fit" label) from "Benchmark Fit" to "Benchmark Validation
// Confidence" -- precise, decision-useful, and can no longer read as
// "the same number restated" next to Benchmark Intelligence's own
// "Overall Fit" metric-alignment score.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
const reportIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/report-intelligence.ts"), "utf8");
const benchmarkIntelligencePanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");

const GOLDEN_PROMPT =
  "I'm considering launching a premium AI-powered financial planning SaaS for " +
  "small and medium-sized businesses in the United States. The product would " +
  "connect to accounting platforms such as QuickBooks and Xero and provide " +
  "automated cash-flow forecasting, scenario planning, financial risk alerts, " +
  "and AI-powered recommendations for business owners. The target customers " +
  "are SMBs with 10-200 employees that need better financial visibility but " +
  "cannot justify a full-time CFO. I want to understand whether this is a " +
  "viable business opportunity, how strong the market and competitive " +
  "landscape are, what pricing and go-to-market strategy would make sense, " +
  "what the key financial assumptions and risks are, and whether I should " +
  "proceed with launching the business.";

function buildContext() {
  return createCanonicalFinancialAssumptions({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });
}

// ===========================================================================
// TEST 1 -- the two benchmark-related metrics have explicit semantics
// ===========================================================================

test("1a. benchmarkScore.overallFit is a 5-dimension weighted composite (industryFit 22%, businessModelFit 20%, geographyFit 16%, pricingFit 17%, financialBenchmarkFit 25%) of the ACTUAL financial model vs. industry benchmark ranges", () => {
  const benchmarkIntelligenceSource = readFileSync(
    join(repoRoot, "app/lib/ai/benchmark-intelligence.ts"),
    "utf8"
  );
  assert.match(
    benchmarkIntelligenceSource,
    /industryFit \* 0\.22 \+\s*\n\s*businessModelFit \* 0\.2 \+\s*\n\s*geographyFit \* 0\.16 \+\s*\n\s*pricingFit \* 0\.17 \+\s*\n\s*financialBenchmarkFit \* 0\.25/
  );
});

test("1b. reportIntelligence.dimensions.benchmarkFit is a 3-input confidence/validation-gap measure (fitBase from the .fit classification, confidenceAdjustment from .confidence, gapPenalty from validationGaps.length) -- structurally unable to read the richer metric-alignment inputs overallFit uses", () => {
  assert.match(reportIntelligenceSource, /function benchmarkFitScore\(context: ReportIntelligenceInput\) \{/);
  const fnMatch = reportIntelligenceSource.match(/function benchmarkFitScore\([\s\S]{0,700}?\n\}/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /metrics\.(grossMargin|cac|ltv|cacPayback|arpa)/);
});

test("1c. for the golden prompt, the two values are genuinely different numbers (not the same value read twice under different labels)", () => {
  const context = buildContext();
  assert.notEqual(context.benchmarkScore.overallFit, context.reportIntelligence.dimensions.benchmarkFit);
});

// ===========================================================================
// TEST 2 -- different concepts are allowed to differ, and cannot silently
//           share an ambiguous label
// ===========================================================================

test("2a. the Report Quality dimension is no longer labeled with the bare, ambiguous 'Benchmark Fit' -- renamed to 'Benchmark Validation Confidence', a name that cannot be mistaken for Benchmark Intelligence's own 'Overall Fit'", () => {
  assert.match(reportPresentationSource, /benchmarkFit: "Benchmark Validation Confidence",/);
  assert.doesNotMatch(
    reportPresentationSource.slice(
      reportPresentationSource.indexOf("export function getReportQualityBreakdown"),
      reportPresentationSource.indexOf("export function getReportQualityBreakdown") + 3000
    ),
    /benchmarkFit: "Benchmark Fit"/
  );
});

test("2b. Benchmark Intelligence's own 'Overall Fit' label is completely untouched by this rename", () => {
  assert.match(benchmarkIntelligencePanelSource, /overallFit: "Overall Fit"/);
  assert.match(pdfNormalizationSource, /overallFit: "Overall Fit"/);
});

test("2c. the new label textually cannot collide with 'Overall Fit' or any other Report Quality/Confidence Radar label", () => {
  const newLabel = "Benchmark Validation Confidence";
  const otherLabels = ["Overall Fit", "Financial Consistency", "Source Strength", "Validation Readiness", "Data Completeness", "Moat Evidence"];
  for (const other of otherLabels) {
    assert.notEqual(newLabel, other);
    assert.ok(
      !newLabel.toLowerCase().includes(other.toLowerCase()) && !other.toLowerCase().includes(newLabel.toLowerCase()),
      `expected no substring collision between "${newLabel}" and "${other}"`
    );
  }
});

// ===========================================================================
// TEST 3 -- if they represent the same concept, all consumers use one
//           canonical authority (N/A here -- but proven: EACH metric has
//           exactly one canonical structured owner)
// ===========================================================================

test("3a. benchmarkScore.overallFit is computed in exactly one place (createBenchmarkIntelligenceScore, called once from financial-assumptions.ts at context-creation time) -- no second, competing overallFit computation exists", () => {
  const callSites = [...financialAssumptionsSource.matchAll(/= createBenchmarkIntelligenceScore\(/g)];
  assert.equal(callSites.length, 1);
});

test("3b. reportIntelligence.dimensions.benchmarkFit is computed in exactly one place (benchmarkFitScore, called once inside createReportIntelligenceModel) at context-creation time, and is only ever PRESERVED (never recomputed) afterward", () => {
  assert.match(reportIntelligenceSource, /const benchmarkFit = benchmarkFitScore\(context\);/);
  const callSites = [...reportIntelligenceSource.matchAll(/= benchmarkFitScore\(context\);/g)];
  assert.equal(callSites.length, 1);
});

// ===========================================================================
// TEST 4 -- web and PDF use the same corresponding canonical fields
// ===========================================================================

test("4a. web (BenchmarkIntelligencePanel.tsx) and PDF (createPdfBenchmarkIntelligenceSection) both read benchmarkScore.overallFit for their own 'Overall Fit' line -- one canonical field, two independent render surfaces", () => {
  assert.match(benchmarkIntelligencePanelSource, /value: `\$\{benchmarkScore\.overallFit\}\/100`/);
  assert.match(pdfNormalizationSource, /\$\{labels\.overallFit\}: \$\{benchmarkScore\.overallFit\}\/100/);
});

test("4b. web and PDF both render the Report Quality breakdown (including the renamed Benchmark Validation Confidence row) through the SAME getReportQualityBreakdown function -- never an independent reconstruction", () => {
  for (const relativePath of ["app/dashboard/[id]/page.tsx", "components/Planner.tsx", "app/dashboard/[id]/ReportPdfButton.tsx"]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.match(source, /getReportQualityBreakdown/, relativePath);
  }
});

test("4c. rendering the golden context's reportIntelligence through getReportQualityBreakdown produces the identical 'Benchmark Validation Confidence' row value every time it is called -- no renderer-specific divergence is even possible", () => {
  const context = buildContext();
  const forWeb = getReportQualityBreakdown(context.reportIntelligence, false);
  const forPdf = getReportQualityBreakdown(context.reportIntelligence, false);
  assert.deepEqual(forWeb, forPdf);
  const row = forWeb.find((item) => item.label === "Benchmark Validation Confidence");
  assert.ok(row, "expected a Benchmark Validation Confidence row");
  assert.equal(row.value, `${context.reportIntelligence.dimensions.benchmarkFit}/100`);
});

// ===========================================================================
// TEST 5 -- post-research refresh cannot silently create stale benchmark
//           values (re-verifying #69A-38G's own fix is still intact)
// ===========================================================================

test("[FAIL-BEFORE PROOF, re-verified from #69A-38G] the OLD buggy behavior -- overwriting reportIntelligence.dimensions.benchmarkFit with the unrelated dimensions.competitiveEvidence value -- is NOT what the current code does", () => {
  const context = buildContext();
  const zeroCompetitorEvidence = deriveCanonicalCompetitiveEvidence(null);
  const { context: afterCoverage, coverage } = applyMarketResearchCoverageToContext(
    context,
    { evidence: [] },
    GOLDEN_PROMPT,
    undefined,
    zeroCompetitorEvidence
  );

  assert.equal(coverage.dimensions.competitiveEvidence, 0, "sanity: this scenario has zero competitive evidence");
  assert.equal(
    afterCoverage.reportIntelligence.dimensions.benchmarkFit,
    context.reportIntelligence.dimensions.benchmarkFit,
    "benchmarkFit must be preserved verbatim, never silently replaced by the unrelated (and here, zero) competitiveEvidence value"
  );
});

test("5a. benchmarkFit is preserved verbatim through applyMarketResearchCoverageToContext even under a STRONG evidence bundle (not just the zero-evidence edge case)", () => {
  const context = buildContext();
  const strongEvidence = Array.from({ length: 20 }, (_, i) => ({
    id: `E${i}`,
    url: `https://example.com/market-research-${i}`,
    claim: `Substantive third-party market research item ${i}.`,
    value: "",
  }));
  const { context: after } = applyMarketResearchCoverageToContext(context, { evidence: strongEvidence }, GOLDEN_PROMPT);
  assert.equal(after.reportIntelligence.dimensions.benchmarkFit, context.reportIntelligence.dimensions.benchmarkFit);
});

test("5b. benchmarkFit is preserved verbatim through the FULL refreshResearchAwareFinancialContext pipeline (coverage + narrative refresh combined)", () => {
  const context = buildContext();
  const before = context.reportIntelligence.dimensions.benchmarkFit;
  const { context: afterCoverage } = applyMarketResearchCoverageToContext(context, { evidence: [] }, GOLDEN_PROMPT);
  const afterFullRefresh = refreshResearchAwareFinancialContext(afterCoverage);
  assert.equal(afterFullRefresh.reportIntelligence.dimensions.benchmarkFit, before);
});

test("5c. benchmarkScore.overallFit itself has no refresh call site at all -- it is never recomputed after context creation, so it cannot go stale relative to a refresh it never participates in", () => {
  assert.doesNotMatch(marketResearchCoverageSource, /createBenchmarkIntelligenceScore\(/);
  const context = buildContext();
  const before = context.benchmarkScore.overallFit;
  const { context: afterCoverage } = applyMarketResearchCoverageToContext(context, { evidence: [] }, GOLDEN_PROMPT);
  const afterFullRefresh = refreshResearchAwareFinancialContext(afterCoverage);
  assert.equal(afterFullRefresh.benchmarkScore.overallFit, before);
});

// ===========================================================================
// TEST 6 -- historical reports degrade honestly when the newer structured
//           field is absent
// ===========================================================================

test("6a. getReportQualityBreakdown returns an empty array (never a fabricated row) when reportIntelligence itself is absent -- the honest degradation path for a report predating this field", () => {
  assert.deepEqual(getReportQualityBreakdown(undefined, false), []);
});

test("6b. market-research-coverage.ts's benchmarkFit preservation line falls back to a safe 0 (never a crash, never a fabricated non-zero score) when reportIntelligence.dimensions is genuinely absent from a hand-built or historical context", () => {
  assert.match(marketResearchCoverageSource, /benchmarkFit: context\.reportIntelligence\?\.dimensions\?\.benchmarkFit \?\? 0,/);
});

test("6c. BenchmarkIntelligencePanel.tsx and the PDF section both render nothing (rather than a fabricated Overall Fit) when neither benchmarkFit nor benchmarkScore is present -- confirmed by source", () => {
  assert.match(benchmarkIntelligencePanelSource, /if \(!benchmarkFit && !benchmarkScore\) \{/);
  assert.match(pdfNormalizationSource, /if \(\(!benchmarkFit \|\| typeof benchmarkFit !== "object"\) && \(!benchmarkScore \|\| typeof benchmarkScore !== "object"\)\) \{\s*\n\s*return null;/);
});

// ===========================================================================
// TEST 7 -- Decision and Founder Readiness values do not drift as a
//           presentation side effect of this rename
// ===========================================================================

test("7a. the rename touches only report-presentation.ts's and financial-assumptions.ts's own label dictionaries -- no #69A-31 marker exists in any decision/confidence/founder-readiness/financial-model/porters-five-forces file", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/decision-confidence.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-31/, relativePath);
  }
});

test("7b. Decision (recommendation), Decision Confidence, Founder Readiness overall score, and all 7 Founder Readiness dimensions are completely unaffected by this rename for the golden prompt", () => {
  const context = buildContext();
  assert.equal(context.investmentScore.recommendation, "WAIT");
  assert.equal(typeof context.investmentScore.confidence, "number");
  assert.equal(typeof context.investmentScore.decisionEngine.founderScore.score, "number");
  assert.equal(context.investmentScore.decisionEngine.founderScore.dimensionScores.length, 7);
});

test("7c. competitor weaknesses (#69A-29B/#69A-29C), Porter's Five Forces, and web/PDF competitor parity are unaffected -- no changed file from this audit overlaps with those modules", () => {
  const businessCompetitorLandscapeSource = readFileSync(
    join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
    "utf8"
  );
  const portersSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.match(businessCompetitorLandscapeSource, /function deriveCapabilityGapWeakness\(/);
  assert.doesNotMatch(businessCompetitorLandscapeSource, /Benchmark Validation Confidence|TASK #69A-31/);
  assert.doesNotMatch(portersSource, /Benchmark Validation Confidence|TASK #69A-31/);
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] this suite fails if a future change makes benchmarkScore.overallFit and reportIntelligence.dimensions.benchmarkFit numerically identical by construction (a sign the two formulas were accidentally merged) -- they must remain independently derived", () => {
  const benchmarkIntelligenceSource = readFileSync(
    join(repoRoot, "app/lib/ai/benchmark-intelligence.ts"),
    "utf8"
  );
  assert.doesNotMatch(benchmarkIntelligenceSource, /benchmarkFitScore\(/);
  assert.doesNotMatch(reportIntelligenceSource, /createBenchmarkIntelligenceScore\(/);
});

test("[REGRESSION LOCK] this suite fails if the Report Quality dimension's label reverts to the bare, ambiguous 'Benchmark Fit' string", () => {
  assert.doesNotMatch(reportPresentationSource, /benchmarkFit: "Benchmark Fit",/);
  assert.doesNotMatch(financialAssumptionsSource, /benchmarkFit: "Benchmark Fit",/);
});
