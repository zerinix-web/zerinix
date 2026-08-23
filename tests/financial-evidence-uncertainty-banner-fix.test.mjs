import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inferEvidenceLevel } from "../app/lib/report-evidence.ts";

// CRITICAL REPORT QUALITY FIX -- eliminate fabricated-looking financial
// outputs when evidence is missing.
//
// Scope was clarified with the user before implementation: the chosen
// direction keeps the existing benchmark-derived financial projections
// (ARR/CAC/LTV/Scenario Analysis/etc.) rendering exactly as before --
// removing them entirely would disable a core feature for the large
// majority of pre-revenue founders, the primary users of a Business Idea
// Validation tool. Instead: every value already carries a per-metric
// evidence badge (Verified/Estimated/Assumption/AI Analysis, wired
// correctly as of the two immediately preceding fix rounds), and this fix
// adds a section-level uncertainty banner -- shown only when NONE of a
// section's metrics carry verified evidence -- making the "these are
// modeled estimates, not confirmed performance" framing impossible to
// miss, without hiding a single number. A report containing verified
// financial data continues to render exactly as before (no banner, all
// values and badges unchanged).
//
// Applied identically to Unit Economics, Financial Dashboard, and
// Scenario Analysis in both app/dashboard/[id]/page.tsx and
// components/Planner.tsx -- the established duplicate-implementation
// pattern this app repeats across these two files.

const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");

// --- The banner condition itself: verified vs. zero evidence -------------

test("a metric with an explicit 'Verified' signal in its context classifies as verified evidence", () => {
  const level = inferEvidenceLevel({
    label: "Revenue",
    value: "$12,400/month",
    context: "Revenue: $12,400/month (Verified from Stripe export, actual bookkeeping data)",
  });

  assert.equal(level, "verified");
});

test("a metric with no real-data signal (benchmark/model-derived language) never classifies as verified", () => {
  const level = inferEvidenceLevel({
    label: "CAC",
    value: "$8k",
    context: "formula: benchmark CAC x complexity multiplier; benchmarkComparison: Within benchmark range ($4k-$22k)",
  });

  assert.notEqual(level, "verified");
});

test("a section where every metric is benchmark/assumption-derived correctly computes hasVerifiedEvidence = false (banner shows)", () => {
  const metrics = [
    { label: "Revenue", context: "formula: benchmark ARPA x idea scope multiplier" },
    { label: "CAC", context: "formula: benchmark CAC x complexity multiplier" },
    { label: "LTV", context: "formula: ARPA x Gross Margin x lifetime months" },
  ];
  const levels = metrics.map((m) => inferEvidenceLevel({ label: m.label, value: "$1", context: m.context }));

  assert.ok(!levels.includes("verified"), "no metric should be classified verified for a pure-benchmark section");
});

test("a section where at least one metric is genuinely verified correctly computes hasVerifiedEvidence = true (banner hidden)", () => {
  const metrics = [
    { label: "Revenue", context: "Revenue: $12,400/month (Verified from Stripe export, actual accounting data)" },
    { label: "CAC", context: "formula: benchmark CAC x complexity multiplier" },
  ];
  const levels = metrics.map((m) => inferEvidenceLevel({ label: m.label, value: "$1", context: m.context }));

  assert.ok(levels.includes("verified"), "at least one metric should be classified verified");
});

// --- Drift checks: banner present, correctly gated, in all 3 sections, in both files --

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  // NOTE: superseded by the "Business Plan final quality polish" ticket --
  // the literal banner text "No verified financial data available." was
  // itself flagged as internal-sounding language ("Verified") and
  // replaced with "No founder-confirmed financial data available." The
  // banner's presence/gating logic this test actually cares about is
  // unchanged; only the wording assertion was updated. See
  // tests/business-plan-final-quality-polish-fix.test.mjs for the full,
  // current assertion.
  test(`${name}: Unit Economics has a 'No founder-confirmed financial data available' banner gated on hasVerifiedEvidence`, () => {
    const fieldCheck = name === "Planner.tsx"
      ? 'field === "unitEconomics" || field === "financialAssumptions"'
      : 'normalizedTitle.includes("unit economics") || normalizedTitle.includes("financial assumptions")';
    const startIndex = source.indexOf(fieldCheck);
    assert.ok(startIndex > -1, `${name}: Unit Economics block not found`);
    const block = source.slice(startIndex, startIndex + 2500);

    assert.match(block, /const hasVerifiedEvidence = flowMetrics\.some\(\(item\) => item\.(?:confidenceBadge|evidence) === "verified"\)/);
    assert.match(block, /\{!hasVerifiedEvidence \? \(/);
    assert.match(block, /No founder-confirmed financial data available\./);
  });

  test(`${name}: Financial Dashboard has a 'No founder-confirmed financial data available' banner gated on hasVerifiedEvidence`, () => {
    const fieldCheck = name === "Planner.tsx"
      ? 'field === "financialDashboard") {'
      : 'normalizedTitle.includes("financial dashboard")) {';
    const startIndex = source.indexOf(fieldCheck);
    assert.ok(startIndex > -1, `${name}: Financial Dashboard block not found`);
    const block = source.slice(startIndex, startIndex + 3000);

    assert.match(block, /const hasVerifiedEvidence = dashboardMetrics\.some\(\(item\) => item\.(?:confidenceBadge|evidence) === "verified"\)/);
    assert.match(block, /\{!hasVerifiedEvidence \? \(/);
    assert.match(block, /No founder-confirmed financial data available\./);
  });

  test(`${name}: Scenario Analysis has a 'modeled, not measured' banner gated on hasVerifiedEvidence`, () => {
    const fieldCheck = name === "Planner.tsx"
      ? 'field === "scenarioAnalysis") {'
      : 'normalizedTitle.includes("scenario") && !normalizedTitle.includes("roi") && !normalizedTitle.includes("irr")) {';
    const startIndex = source.indexOf(fieldCheck);
    assert.ok(startIndex > -1, `${name}: Scenario Analysis block not found`);
    const block = source.slice(startIndex, startIndex + 2000);

    assert.match(block, /const hasVerifiedEvidence = scenarioMetrics\.some\(\(metric\) => \{/);
    assert.match(block, /=== "verified"/);
    assert.match(block, /Scenario analysis is modeled, not measured\./);
  });
}

// --- No data was hidden: every value/metric computation is unchanged -----

test("no financial values were removed or hidden -- the metric computation and '{value || \"—\"}' fallback rendering is unchanged in both files (drift check, confirms this is additive-only)", () => {
  for (const source of [plannerSource, pageSource]) {
    assert.match(source, /extractMetricValue\(section\.content, metric\)|extractMetricValue\(content, metric\)/);
    assert.match(source, /\{value \|\| "—"\}/);
  }
});

test("Scenario Analysis's Worst/Base/Best cards and their metric rows are still rendered unconditionally alongside the banner (the banner is additive, not a replacement)", () => {
  for (const source of [plannerSource, pageSource]) {
    assert.match(source, /\["Worst", "Base", "Best"\]\.map\(\(scenario\) => \{/);
  }
});

// --- Requirement 4: operational KPIs are unaffected -----------------------

test("the operational KPI Dashboard grid (Acquisition/Activation/Retention/Conversion) has no uncertainty banner added -- only the three financial sections do", () => {
  for (const source of [plannerSource, pageSource]) {
    // "const kpiMetrics = [" is unique to the KPI Dashboard grid block
    // itself, unlike "kpi"/"kpiDashboard" substrings which also appear in
    // an unrelated icon-picker function earlier in page.tsx.
    const startIndex = source.indexOf("const kpiMetrics = [");
    assert.ok(startIndex > -1, "KPI Dashboard block not found");
    const block = source.slice(startIndex, source.indexOf("Analytics widget", startIndex) + 100);

    assert.doesNotMatch(block, /No verified financial data available/);
  }
});
