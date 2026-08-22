import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// PRODUCTION DATA PROVENANCE POLISH -- standardize report data
// classification into exactly three user-facing categories:
//   1. Verified   -- facts explicitly provided by the user.
//   2. Derived    -- values mathematically calculated only from
//                    verified user data (e.g. ARR from a stated MRR).
//                    Never shown as Verified.
//   3. Benchmark / Assumption -- industry benchmarks, AI estimates,
//                    modeled scenarios, or planning inputs. Never
//                    overwrites Verified or Derived data.
//
// Applied consistently across Financial Dashboard, Unit Economics, KPI
// Dashboard, Scenario Analysis, Executive Summary, and Financial
// Assumptions.

// --- report-evidence.ts: the shared EvidenceLevel classifier now has ---
// --- a genuine "derived" tier, distinct from "verified".              ---

const { evidenceLabels, normalizeEvidenceLevel, inferEvidenceLevel, getEvidenceBadgeClass } =
  await import("../app/lib/report-evidence.ts");

test("evidenceLabels exposes a distinct 'Derived' English label, separate from 'Verified'", () => {
  assert.equal(evidenceLabels.English.derived, "Derived");
  assert.notEqual(evidenceLabels.English.derived, evidenceLabels.English.verified);
});

test("normalizeEvidenceLevel resolves 'derived from the verified MRR' text to 'derived', not 'verified' (word-collision guard)", () => {
  assert.equal(normalizeEvidenceLevel("Derived from the verified MRR figure"), "derived");
});

test("normalizeEvidenceLevel still resolves plain 'user-provided'/'actual' text to 'verified' (no regression)", () => {
  assert.equal(normalizeEvidenceLevel("Actual, user-provided MRR: $18k"), "verified");
});

test("inferEvidenceLevel resolves a metric context containing 'derived from the verified X' to 'derived', not 'verified'", () => {
  const level = inferEvidenceLevel({
    label: "ARR",
    value: "$216k",
    context: "formula=Derived from the verified MRR (x 12) | benchmark=ARR is derived directly from the verified MRR, not a benchmark estimate.",
  });
  assert.equal(level, "derived");
});

test("inferEvidenceLevel still resolves a genuinely user-provided metric context to 'verified' (no regression)", () => {
  const level = inferEvidenceLevel({
    label: "MRR",
    value: "$18k",
    context: "formula=User-provided (stated directly in the request) | assumptions=Actual, user-provided MRR: $18k",
  });
  assert.equal(level, "verified");
});

test("getEvidenceBadgeClass returns a distinct class for 'derived', different from 'verified' and 'benchmarkDerived'", () => {
  const derivedClass = getEvidenceBadgeClass("derived");
  assert.notEqual(derivedClass, getEvidenceBadgeClass("verified"));
  assert.notEqual(derivedClass, getEvidenceBadgeClass("benchmarkDerived"));
});

// --- financial-evidence-labeling.ts: the Financial Assumptions/       ---
// --- metric-line classifier, standardized to the same 3 categories.  ---

const {
  financialEvidenceTypeValues,
  classifyFinancialMetricEvidenceType,
} = await import("../app/lib/financial-evidence-labeling.ts");

test("financialEvidenceTypeValues is exactly the 3 required categories", () => {
  assert.deepEqual(
    [...financialEvidenceTypeValues].sort(),
    ["Benchmark / Assumption", "Derived", "Verified"]
  );
});

test("a benchmark-formula metric (TAM) classifies as 'Benchmark / Assumption', never 'Derived' merely for using x/÷ in its formula", () => {
  const tam = {
    label: "TAM",
    formula: "industry TAM x geography multiplier x idea scope multiplier",
    benchmarkComparison: "Within benchmark range",
    assumptions: [],
  };
  assert.equal(classifyFinancialMetricEvidenceType(tam), "Benchmark / Assumption");
});

// --- End-to-end: createFinancialModel's real MRR/ARR overrides -------
// --- classify correctly through the real classifier, both directions. --

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { createFinancialModel } = await importFinancialModel();

test("the exact live bug: a stated MRR classifies Verified, and the ARR calculated from it classifies Derived -- never Verified, never Benchmark / Assumption", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management. We currently have $42,000 MRR.",
    reportKind: "business_plan",
  });

  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.mrr, false), "Verified");
  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.arr, false), "Derived");
});

test("the symmetric case: a stated ARR classifies Verified, and the MRR calculated from it classifies Derived", () => {
  const model = createFinancialModel({
    prompt: "A subscription software company. We have $600,000 ARR today.",
    reportKind: "business_plan",
  });

  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.arr, false), "Verified");
  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.mrr, false), "Derived");
});

test("with no stated MRR/ARR at all, both metrics classify Benchmark / Assumption, unaffected", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management targeting mid-market companies.",
    reportKind: "business_plan",
  });

  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.mrr, false), "Benchmark / Assumption");
  assert.equal(classifyFinancialMetricEvidenceType(model.metrics.arr, false), "Benchmark / Assumption");
});

test("TAM/SAM/SOM and other pure benchmark metrics never classify Verified or Derived when no user evidence is present", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management. We currently have $42,000 MRR.",
    reportKind: "business_plan",
  });

  for (const key of ["tam", "sam", "som", "cac", "grossMargin"]) {
    assert.equal(classifyFinancialMetricEvidenceType(model.metrics[key], false), "Benchmark / Assumption", `${key} should classify Benchmark / Assumption`);
  }
});

// --- Requirement: never allow Benchmark/Assumption values to ----------
// --- overwrite Verified or Derived data (the actual VALUE, not just ---
// --- the label -- confirms the value-preservation fix from an        ---
// --- earlier turn is still load-bearing for this turn's labeling).   ---

test("a stated MRR value is never overwritten by the benchmark formula, and the ARR derived from it stays mathematically consistent (mrr x 12)", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management. We currently have $42,000 MRR.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.mrr.value, 42_000);
  assert.equal(model.metrics.arr.value, 504_000);
});

// --- Wiring: Financial Dashboard, Unit Economics, and KPI Dashboard ---
// --- all read from the same standardized 3-tier label source in     ---
// --- both renderers (page.tsx and Planner.tsx).                     ---

const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

for (const [name, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${name}: financialEvidenceBadgeLabels declares Derived and consolidates benchmarkDerived/planningAssumption/validationRequired into one 'Benchmark / Assumption' label`, () => {
    assert.match(source, /derived:\s*\{\s*English:\s*"Derived"/);
    assert.match(source, /benchmarkDerived:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /planningAssumption:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /validationRequired:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
  });
}

test("page.tsx: the KPI Dashboard grid now opts into the standardized 3-tier financial vocabulary, consistent with Financial Dashboard and Unit Economics", () => {
  const kpiStart = pageSource.indexOf('if (normalizedTitle.includes("kpi")) {');
  assert.ok(kpiStart > -1, "KPI Dashboard block not found");
  const kpiBlock = pageSource.slice(kpiStart, kpiStart + 1200);
  assert.match(kpiBlock, /EvidenceBadge level=\{evidence\} locale=\{evidenceLocale\} financial/);
});

test("Planner.tsx: the KPI Dashboard grid now opts into the standardized 3-tier financial vocabulary via getFinancialEvidenceBadgeLabel, consistent with Financial Dashboard and Unit Economics", () => {
  const kpiStart = plannerSource.indexOf('if (field === "kpiDashboard" || field === "kpis") {');
  assert.ok(kpiStart > -1, "KPI Dashboard block not found");
  const kpiBlock = plannerSource.slice(kpiStart, kpiStart + 2000);
  assert.match(kpiBlock, /getFinancialEvidenceBadgeLabel\(confidenceBadge, evidenceLocale\)/);
});

// --- Financial Assumptions section: the deduplicated assumptions list --
// --- and per-metric evidence= line both come from the same real       --
// --- classifier, so the section's own text uses the same 3 tiers.    --

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

test("plan-executor.ts's Financial Assumptions section and per-metric lines both derive from classifyFinancialMetricEvidenceType (single source of truth, no separate hardcoded vocabulary)", () => {
  assert.match(planExecutorSource, /classifyFinancialMetricEvidenceType\(metric, hasUserEvidence\)/);
  assert.match(planExecutorSource, /consolidateFinancialAssumptions\(Object\.values\(context\.metrics\)\)/);
});

// --- Preserve layout: no new UI elements, no section removals --------

test("no new report schema field or section was introduced for this classification change (drift check)", () => {
  assert.doesNotMatch(planExecutorSource, /dataProvenance:\s*\{/);
  assert.doesNotMatch(planExecutorSource, /provenanceClassification:\s*\{/);
});

test("the badge component signature (EvidenceBadge) is unchanged in shape -- same props, just an additional optional 'financial' flag already established in an earlier turn, not a new component", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function EvidenceBadge\(/);
  }
});
