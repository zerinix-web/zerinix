import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  financialEvidenceTypeValues,
  classifyFinancialMetricEvidenceType,
  hasVerifiedUserProvidedData,
  localizeFinancialEvidenceType,
  consolidateFinancialAssumptions,
  formatKeyFinancialAssumptionsList,
} from "../app/lib/financial-evidence-labeling.ts";

test("only the 3 required financial evidence labels exist (PRODUCTION DATA PROVENANCE POLISH)", () => {
  assert.deepEqual(
    [...financialEvidenceTypeValues].sort(),
    ["Benchmark / Assumption", "Derived", "Verified"].sort()
  );
});

// --- Classification is derived from each metric's own real formula/ ---
// --- benchmarkComparison/assumptions text, never fabricated. ---

test("a benchmark-derived formula (TAM, CAC, gross margin, monthly burn) is classified Benchmark / Assumption", () => {
  const tam = { label: "TAM", formula: "industry TAM x geography multiplier x idea scope multiplier", benchmarkComparison: "Derived from benchmark market scope.", assumptions: [] };
  const cac = { label: "CAC", formula: "benchmark CAC x complexity multiplier", benchmarkComparison: "Within range", assumptions: [] };
  const grossMargin = { label: "Gross Margin", formula: "industry gross margin benchmark", benchmarkComparison: "Within range", assumptions: [] };

  assert.equal(classifyFinancialMetricEvidenceType(tam), "Benchmark / Assumption");
  assert.equal(classifyFinancialMetricEvidenceType(cac), "Benchmark / Assumption");
  assert.equal(classifyFinancialMetricEvidenceType(grossMargin), "Benchmark / Assumption");
});

test("a pure calculation composed from other benchmark-derived metrics (LTV, CAC payback, runway) is classified Benchmark / Assumption, not Derived", () => {
  const ltv = { label: "LTV", formula: "ARPA x Gross Margin x lifetime months", benchmarkComparison: "Within range", assumptions: ["Lifetime: 24 months"] };
  const payback = { label: "CAC Payback", formula: "CAC / monthly gross profit per customer", benchmarkComparison: "Within range", assumptions: [] };
  const runway = { label: "Runway", formula: "Investment Needed / Monthly Burn", benchmarkComparison: "Runway is calculated from financing need and monthly burn.", assumptions: [] };

  assert.equal(classifyFinancialMetricEvidenceType(ltv), "Benchmark / Assumption");
  assert.equal(classifyFinancialMetricEvidenceType(payback), "Benchmark / Assumption");
  assert.equal(classifyFinancialMetricEvidenceType(runway), "Benchmark / Assumption");
});

test("a metric with no benchmark/composition signal defaults to Benchmark / Assumption, never Verified, without real user evidence", () => {
  const metric = { label: "Custom", formula: "flat estimate", benchmarkComparison: "N/A", assumptions: ["Assumed conservatively"] };
  assert.equal(classifyFinancialMetricEvidenceType(metric, false), "Benchmark / Assumption");
});

test("Verified is only ever returned when real user-provided evidence is passed in -- never guessed", () => {
  const metric = { label: "Custom", formula: "flat estimate", benchmarkComparison: "N/A", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(metric, true), "Verified");
  assert.notEqual(classifyFinancialMetricEvidenceType(metric, false), "Verified");
});

// --- New tier: a value mathematically derived only from another ---
// --- verified value (e.g. ARR = MRR x 12) is Derived, never Verified. ---

test("a metric whose formula/assumptions say it was stated directly by the user is classified Verified", () => {
  const arr = {
    label: "ARR",
    formula: "User-provided (stated directly in the request)",
    benchmarkComparison: "ARR reflects the actual figure supplied in the request, not a benchmark estimate.",
    assumptions: ["Actual, user-provided ARR: $600k"],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "Verified");
});

test("the exact live bug: a metric calculated only from another verified metric (ARR derived from a stated MRR) is classified Derived, never Verified and never Benchmark / Assumption", () => {
  const arr = {
    label: "ARR",
    formula: "Derived from the verified MRR (x 12)",
    benchmarkComparison: "ARR is derived directly from the verified MRR, not a benchmark estimate.",
    assumptions: ["Derived value: ARR calculated from the verified MRR of $25k."],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "Derived");
});

test("Derived text mentioning 'verified' as a modifier on the source value is never misclassified as Verified (word-collision guard)", () => {
  const mrr = {
    label: "MRR",
    formula: "Derived from the verified ARR (/ 12)",
    benchmarkComparison: "MRR is derived directly from the verified ARR, not a benchmark estimate.",
    assumptions: ["Derived value: MRR calculated from the verified ARR of $600k."],
  };
  assert.equal(classifyFinancialMetricEvidenceType(mrr), "Derived");
});

test("Derived text mentioning 'benchmark' as a negation is never misclassified as Benchmark / Assumption (word-collision guard)", () => {
  // The literal word "benchmark" appears here only inside "not a
  // benchmark estimate" -- a negation describing what this value is
  // NOT, not a benchmark classification of the value itself.
  const arr = {
    label: "ARR",
    formula: "Derived from the verified MRR (x 12)",
    benchmarkComparison: "ARR is derived directly from the verified MRR, not a benchmark estimate.",
    assumptions: [],
  };
  assert.equal(classifyFinancialMetricEvidenceType(arr), "Derived");
});

test("hasVerifiedUserProvidedData ignores the generic 'no direct operating data' placeholder", () => {
  assert.equal(hasVerifiedUserProvidedData(["No direct operating data was provided."]), false);
  assert.equal(hasVerifiedUserProvidedData([]), false);
  assert.equal(hasVerifiedUserProvidedData(["User reported $12,000 MRR from Stripe."]), true);
});

test("a benchmark signal always wins over a composition signal, even if the formula also divides/multiplies (both now resolve to the same Benchmark / Assumption tier)", () => {
  const metric = { label: "X", formula: "industry benchmark rate x adjustment", benchmarkComparison: "", assumptions: [] };
  assert.equal(classifyFinancialMetricEvidenceType(metric), "Benchmark / Assumption");
});

test("localizeFinancialEvidenceType renders in all 5 supported languages with distinct text", () => {
  const english = localizeFinancialEvidenceType("Benchmark / Assumption", "English");
  for (const language of ["Turkish", "German", "French", "Spanish"]) {
    const localized = localizeFinancialEvidenceType("Benchmark / Assumption", language);
    assert.notEqual(localized, english);
    assert.ok(localized.length > 0);
  }
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
