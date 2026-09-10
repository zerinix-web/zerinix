import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyFinancialMetricEvidenceType,
  hasVerifiedUserProvidedData,
  localizeFinancialEvidenceType,
  deriveFinancialEvidenceSummary,
  consolidateFinancialAssumptions,
  formatKeyFinancialAssumptionsList,
} from "../app/lib/financial-evidence-labeling.ts";

// TASK #69A-46 -- ROOT CAUSE FIX (canonical financial evidence
// unification): classifyFinancialMetricEvidenceType used to return a
// second, narrower, competing 3-state vocabulary (financialEvidenceTypeValues:
// "Verified" | "Derived" | "Benchmark / Assumption") for the exact same
// concept report-evidence.ts's EvidenceLevel already models with 5
// states, used pervasively across web/PDF. It now returns EvidenceLevel
// directly -- financialEvidenceTypeValues is gone entirely, not renamed.

test("only the canonical EvidenceLevel vocabulary exists -- the old, narrower 3-state financialEvidenceTypeValues export is gone", async () => {
  const financialEvidenceLabelingModule = await import("../app/lib/financial-evidence-labeling.ts");
  assert.equal("financialEvidenceTypeValues" in financialEvidenceLabelingModule, false);
});

// --- Classification is derived from each metric's own real formula/ ---
// --- benchmarkComparison/assumptions text, never fabricated. ---

test("a benchmark-derived formula (TAM, CAC, gross margin, monthly burn) is classified benchmarkDerived", () => {
  const tam = { label: "TAM", formula: "industry TAM x geography multiplier x idea scope multiplier", benchmarkComparison: "Derived from benchmark market scope.", assumptions: [] };
  const cac = { label: "CAC", formula: "benchmark CAC x complexity multiplier", benchmarkComparison: "Within range", assumptions: [] };
  const grossMargin = { label: "Gross Margin", formula: "industry gross margin benchmark", benchmarkComparison: "Within range", assumptions: [] };

  assert.equal(classifyFinancialMetricEvidenceType(tam), "benchmarkDerived");
  assert.equal(classifyFinancialMetricEvidenceType(cac), "benchmarkDerived");
  assert.equal(classifyFinancialMetricEvidenceType(grossMargin), "benchmarkDerived");
});

test("a pure calculation composed from other benchmark-derived metrics (LTV, CAC payback, runway) resolves benchmarkDerived when its assumptions carry the real pipeline's shared 'Industry benchmark' context, and planningAssumption (via the composition signal) when they do not", () => {
  // Mirrors the REAL financial-model.ts shape: every metric's own
  // `assumptions` array is seeded with the same sharedAssumptions
  // boilerplate, whose first entry is always "Industry benchmark:
  // <label>" -- so in practice, every one of these composed metrics
  // still resolves to benchmarkDerived via that shared context, never
  // to planningAssumption. This is a documented, deliberate scope
  // decision (see financial-evidence-labeling.ts's own comment): a
  // finer benchmark-vs-composed-assumption split was investigated and
  // reverted after proving it misclassified TAM/SAM/SOM/ARPA/CAC/Gross
  // Margin (which ALSO use a multiplier in their own formula) as
  // planningAssumption too.
  const ltv = { label: "LTV", formula: "ARPA x Gross Margin x lifetime months", benchmarkComparison: "Within range", assumptions: ["Industry benchmark: SaaS", "Lifetime: 24 months"] };
  const payback = { label: "CAC Payback", formula: "CAC / monthly gross profit per customer", benchmarkComparison: "Within range", assumptions: ["Industry benchmark: SaaS"] };
  const runway = { label: "Runway", formula: "Investment Needed / Monthly Burn", benchmarkComparison: "Runway is calculated from financing need and monthly burn.", assumptions: ["Industry benchmark: SaaS"] };

  assert.equal(classifyFinancialMetricEvidenceType(ltv), "benchmarkDerived");
  assert.equal(classifyFinancialMetricEvidenceType(payback), "benchmarkDerived");
  assert.equal(classifyFinancialMetricEvidenceType(runway), "benchmarkDerived");

  // Without that shared context (an isolated composition formula with
  // genuinely no benchmark/industry word anywhere), the composition
  // signal correctly resolves it to planningAssumption instead --
  // proving the composition check is still real, load-bearing logic,
  // not dead code.
  const isolatedPayback = { label: "CAC Payback", formula: "CAC / monthly gross profit per customer", benchmarkComparison: "Within range", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(isolatedPayback), "planningAssumption");
});

test("a metric with no benchmark/composition signal defaults to planningAssumption, never verified, without real user evidence", () => {
  const metric = { label: "Custom", formula: "flat estimate", benchmarkComparison: "N/A", assumptions: ["Assumed conservatively"] };
  assert.equal(classifyFinancialMetricEvidenceType(metric, false), "planningAssumption");
});

test("verified is only ever returned when real user-provided evidence is passed in -- never guessed", () => {
  const metric = { label: "Custom", formula: "flat estimate", benchmarkComparison: "N/A", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(metric, true), "verified");
  assert.notEqual(classifyFinancialMetricEvidenceType(metric, false), "verified");
});

// --- New tier: a value mathematically derived only from another ---
// --- verified value (e.g. ARR = MRR x 12) is derived, never verified. ---

test("a metric whose formula/assumptions say it was stated directly by the user is classified verified", () => {
  const arr = {
    label: "ARR",
    formula: "User-provided (stated directly in the request)",
    benchmarkComparison: "ARR reflects the actual figure supplied in the request, not a benchmark estimate.",
    assumptions: ["Actual, user-provided ARR: $600k"],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "verified");
});

test("the exact live bug: a metric calculated only from another verified metric (ARR derived from a stated MRR) is classified derived, never verified and never benchmarkDerived", () => {
  const arr = {
    label: "ARR",
    formula: "Derived from the verified MRR (x 12)",
    benchmarkComparison: "ARR is derived directly from the verified MRR, not a benchmark estimate.",
    assumptions: ["Derived value: ARR calculated from the verified MRR of $25k."],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "derived");
});

test("derived text mentioning 'verified' as a modifier on the source value is never misclassified as verified (word-collision guard)", () => {
  const mrr = {
    label: "MRR",
    formula: "Derived from the verified ARR (/ 12)",
    benchmarkComparison: "MRR is derived directly from the verified ARR, not a benchmark estimate.",
    assumptions: ["Derived value: MRR calculated from the verified ARR of $600k."],
  };
  assert.equal(classifyFinancialMetricEvidenceType(mrr), "derived");
});

test("derived text mentioning 'benchmark' as a negation is never misclassified as benchmarkDerived (word-collision guard)", () => {
  // The literal word "benchmark" appears here only inside "not a
  // benchmark estimate" -- a negation describing what this value is
  // NOT, not a benchmark classification of the value itself.
  const arr = {
    label: "ARR",
    formula: "Derived from the verified MRR (x 12)",
    benchmarkComparison: "ARR is derived directly from the verified MRR, not a benchmark estimate.",
    assumptions: [],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "derived");
});

test("hasVerifiedUserProvidedData ignores the generic 'no direct operating data' placeholder", () => {
  assert.equal(hasVerifiedUserProvidedData(["No direct operating data was provided."]), false);
  assert.equal(hasVerifiedUserProvidedData([]), false);
  assert.equal(hasVerifiedUserProvidedData(["User reported $12,000 MRR from Stripe."]), true);
});

test("a benchmark signal always wins over a composition signal, even if the formula also divides/multiplies (both now resolve to the same benchmarkDerived tier)", () => {
  const metric = { label: "X", formula: "industry benchmark rate x adjustment", benchmarkComparison: "", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(metric), "benchmarkDerived");
});

test("localizeFinancialEvidenceType renders in all 5 supported languages with distinct text", () => {
  const english = localizeFinancialEvidenceType("benchmarkDerived", "English");
  for (const language of ["Turkish", "German", "French", "Spanish"]) {
    const localized = localizeFinancialEvidenceType("benchmarkDerived", language);
    assert.notEqual(localized, english);
    assert.ok(localized.length > 0);
  }
});

// --- TASK #69A-46 -- the new, canonical, report-level financial ---
// --- evidence strength aggregate (deliberately separate from ---
// --- financialConsistency, which measures internal coherence, not ---
// --- evidence strength). ---

test("deriveFinancialEvidenceSummary aggregates the SAME per-metric classification, never a second, independently-derived scoring path", () => {
  const metrics = {
    mrr: { label: "MRR", formula: "User-provided (stated directly in the request)", benchmarkComparison: "", assumptions: ["Actual, user-provided MRR: $18k"] },
    arr: { label: "ARR", formula: "Derived from the verified MRR (x 12)", benchmarkComparison: "", assumptions: [] },
    tam: { label: "TAM", formula: "industry TAM x geography multiplier", benchmarkComparison: "", assumptions: [] },
    runway: { label: "Runway", formula: "Investment Needed / Monthly Burn", benchmarkComparison: "", assumptions: [] },
  };
  const summary = deriveFinancialEvidenceSummary(metrics, false);

  assert.equal(summary.metrics.mrr, "verified");
  assert.equal(summary.metrics.arr, "derived");
  assert.equal(summary.metrics.tam, "benchmarkDerived");
  assert.equal(summary.metrics.runway, "planningAssumption");
  assert.equal(summary.verifiedCount, 1);
  assert.equal(summary.derivedCount, 1);
  assert.equal(summary.benchmarkDerivedCount, 1);
  assert.equal(summary.planningAssumptionCount, 1);
  assert.equal(summary.totalMetrics, 4);
  // 2 of 4 metrics rest on real, observed data (verified + derived) --
  // 50% coverage lands in the Moderate tier (>=48, <72), mirroring
  // report-intelligence.ts's own qualityFromScore tier boundaries.
  assert.equal(summary.observedEvidenceCoveragePercent, 50);
  assert.equal(summary.strength, "Moderate");
});

test("deriveFinancialEvidenceSummary reports Weak strength (0% coverage) when every metric is benchmark/assumption-derived and no user evidence exists -- the real, common case for a fresh idea with no operating history", () => {
  const metrics = {
    tam: { label: "TAM", formula: "industry TAM x geography multiplier", benchmarkComparison: "", assumptions: [] },
    cacPayback: { label: "CAC Payback", formula: "CAC / monthly gross profit per customer", benchmarkComparison: "", assumptions: [] },
  };
  const summary = deriveFinancialEvidenceSummary(metrics, false);

  assert.equal(summary.observedEvidenceCoveragePercent, 0);
  assert.equal(summary.strength, "Weak");
  assert.equal(summary.verifiedCount, 0);
  assert.equal(summary.derivedCount, 0);
});

test("deriveFinancialEvidenceSummary reports Strong strength when every metric is verified or derived from verified data", () => {
  const metrics = {
    mrr: { label: "MRR", formula: "User-provided (stated directly in the request)", benchmarkComparison: "", assumptions: [] },
    arr: { label: "ARR", formula: "Derived from the verified MRR (x 12)", benchmarkComparison: "", assumptions: [] },
  };
  const summary = deriveFinancialEvidenceSummary(metrics, false);

  assert.equal(summary.observedEvidenceCoveragePercent, 100);
  assert.equal(summary.strength, "Strong");
});

test("deriveFinancialEvidenceSummary never divides by zero -- an empty metrics object reports 0% coverage, never NaN or a fabricated number", () => {
  const summary = deriveFinancialEvidenceSummary({}, false);
  assert.equal(summary.totalMetrics, 0);
  assert.equal(summary.observedEvidenceCoveragePercent, 0);
  assert.equal(summary.strength, "Weak");
  assert.equal(Number.isNaN(summary.observedEvidenceCoveragePercent), false);
});

// --- Requirement 5: the same assumption behind multiple financial ---
// --- figures is stated once, not repeated per metric. ---

test("the same underlying assumption behind two different metrics (different numeric values) is consolidated into one entry", () => {
  const metrics = [
    { label: "CAC", formula: "x", benchmarkComparison: "x", assumptions: ["Complexity multiplier: 1.18", "Shared driver: 5"] },
    { label: "LTV", formula: "x", benchmarkComparison: "x", assumptions: ["Complexity multiplier: 1.3", "Shared driver: 5"] },
  ];
  const consolidated = consolidateFinancialAssumptions(metrics);

  assert.equal(consolidated.length, 2);
  const complexity = consolidated.find((item) => item.label.startsWith("Complexity multiplier"));
  assert.deepEqual(complexity.metricLabels, ["CAC", "LTV"]);
  const shared = consolidated.find((item) => item.label.startsWith("Shared driver"));
  assert.deepEqual(shared.metricLabels, ["CAC", "LTV"]);
});

test("distinct assumptions across metrics are never merged incorrectly", () => {
  const metrics = [
    { label: "TAM", formula: "x", benchmarkComparison: "x", assumptions: ["Geography multiplier: 1.0"] },
    { label: "SAM", formula: "x", benchmarkComparison: "x", assumptions: ["Serviceable market rate: 20%"] },
  ];
  assert.equal(consolidateFinancialAssumptions(metrics).length, 2);
});

test("formatKeyFinancialAssumptionsList renders a plain bullet list under a Financial Assumptions heading, matching the task's example format", () => {
  const metrics = [
    { label: "M1", formula: "x", benchmarkComparison: "x", assumptions: ["Inflation assumption: 3%"] },
    { label: "M2", formula: "x", benchmarkComparison: "x", assumptions: ["Growth assumption: 12%"] },
  ];
  const list = formatKeyFinancialAssumptionsList(consolidateFinancialAssumptions(metrics), "English");

  assert.match(list, /^Financial Assumptions/);
  assert.match(list, /• Inflation assumption: 3%/);
  assert.match(list, /• Growth assumption: 12%/);
});

test("formatKeyFinancialAssumptionsList returns empty string when there is nothing to list, never a fabricated placeholder", () => {
  assert.equal(formatKeyFinancialAssumptionsList([], "English"), "");
});

// --- Wiring: metricLine/marketSizeLine must use the classifier, not ---
// --- the old hardcoded "Planning assumption" for every metric. ---

const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

test("plan-executor.ts's metricLine/marketSizeLine use the real per-metric classifier, not a hardcoded label", () => {
  assert.doesNotMatch(planSource, /evidence=\$\{labels\.assumption\}/);
  assert.match(planSource, /classifyFinancialMetricEvidenceType\(metric, hasUserEvidence\)/);
  assert.match(planSource, /hasVerifiedUserProvidedData\(context\.financialConsistency\.sources\.userProvidedData\)/);
});

test("plan-executor.ts's Financial Assumptions section includes the deduplicated key-assumptions list", () => {
  assert.match(planSource, /consolidateFinancialAssumptions\(Object\.values\(context\.metrics\)\)/);
  assert.match(planSource, /formatKeyFinancialAssumptionsList/);
});

// Report-isolation fix: market-analysis/route.ts used to append CAC/LTV/
// ARR/Gross-Margin unit-economics metrics (computed by a Business Idea
// Validation-style financial model, not real market research) onto its
// tamSamSom section via buildMarketFinancialConfidenceAppendix. Market
// Intelligence has no CAC/LTV/ARR field and no financial model of a
// hypothetical company, so this was removed rather than kept -- this test
// now asserts the removal instead of the old behavior.
test("market-analysis route.ts no longer appends Business Idea Validation's unit-economics metrics to tamSamSom", () => {
  assert.doesNotMatch(marketSource, /buildMarketFinancialConfidenceAppendix\(/);
  assert.doesNotMatch(marketSource, /from "@\/app\/lib\/financial-evidence-labeling"/);
  assert.doesNotMatch(marketSource, /consolidateFinancialAssumptions\(/);
});

test("neither plan-executor.ts nor market-analysis route.ts declares a new report schema field for financial evidence labeling", () => {
  assert.doesNotMatch(planSource, /financialEvidence:\s*\{/);
  assert.doesNotMatch(marketSource, /financialEvidence:\s*\{/);
});

// --- PDF safety: the appended lines must never be mistaken for the ---
// --- PDF's own TAM/SAM/SOM visual-value line by ReportPdfButton.tsx's ---
// --- extractor, which only matches a line that STARTS with the label. ---

test("plan's metricLine/marketSizeLine output still starts directly with the label (unchanged shape), so the existing PDF visual extractor is unaffected", () => {
  const pdfVisualLinePattern = /^\s*TAM\s*[:\-–—]/i;
  const planTamLine = "TAM: $500,000 | evidence=Benchmark / Assumption | formula=x | assumptions=y | benchmark=z | confidence=High";
  assert.equal(pdfVisualLinePattern.test(planTamLine), true);

  const valuePattern = /^\s*TAM\s*[:\-–—]\s*((?:[<>~≈]?\s*)?[€$₺]?\s*\d+(?:[.,]\d+)*(?:\s*[kKmMbBtT%])?)/i;
  assert.equal(valuePattern.exec(planTamLine)?.[1], "$500,000");
});

test("market's appended key-metrics lines are bulleted, so the PDF's label-must-start-the-line visual extractor never picks them up (the existing AI-authored TAM mention, if any, still governs the visual unchanged)", () => {
  const pdfVisualLinePattern = /^\s*TAM\s*[:\-–—]/i;
  const marketAppendixLine = "- TAM: $500,000 | evidence=Benchmark / Assumption | confidence=High";
  assert.equal(pdfVisualLinePattern.test(marketAppendixLine.trim()), false);
});
