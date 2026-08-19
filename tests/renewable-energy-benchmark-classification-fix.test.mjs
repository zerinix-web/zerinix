import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- confirmed live: an AI-powered renewable
// energy portfolio optimization platform for utilities was classified as
// "Advanced manufacturing" / "Industrial manufacturing benchmarks" --
// contaminating Financial Assumptions, Benchmark Intelligence, SWOT, the
// Founder Roadmap, and the 30-60-90 Day Plan with industrial-manufacturing
// terminology for a business that manufactures nothing.
//
// Root cause: inferIndustryKey (app/lib/ai/financial-model.ts) had no
// energy/renewable/utility/grid industry category at all. The
// manufacturing pattern's bare "battery" alternative (a physical PRODUCT
// signal, not a reliable signal the business itself manufactures
// anything) matched because the platform manages battery storage ASSETS
// -- the same class of false positive already fixed for "payments"
// (fintech), "vendor" (procurement), and "compliance" (cybersecurity)
// elsewhere in this same function.
//
// The fix adds a dedicated "energy" IndustryKey with its own benchmark
// entry (industry-benchmarks.ts) and a compound-phrase pattern
// (renewable energy, clean energy, solar/wind power, energy grid, smart
// grid, battery storage, utility company, etc.) positioned ahead of the
// manufacturing pattern -- the same "specific pattern wins over a later,
// broader match" precedent used throughout this function. Because
// getIndustryBenchmarks(industryKey) is the single source of truth every
// benchmark-driven section (Financial Assumptions, Benchmark
// Intelligence, SWOT, roadmap, Financial Dashboard, Founder Readiness)
// already reads from, fixing the classifier alone corrects every
// downstream section automatically -- no per-section routing change or
// string replacement was needed.

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferIndustryKey, inferFinancialModelingInputs } = await importFinancialModel();
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const industryBenchmarksSource = readFileSync(join(repoRoot, "app/lib/ai/industry-benchmarks.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const renewableEnergyPrompt =
  "An AI-powered renewable energy portfolio optimization platform for utilities, managing solar, wind, and battery storage assets across the grid.";

// --- The exact live bug and its fix --------------------------------------

test("the exact reported renewable-energy prompt classifies as 'energy', never 'manufacturing' (the exact live bug)", () => {
  const industryKey = inferIndustryKey(renewableEnergyPrompt);

  assert.equal(industryKey, "energy");
  assert.notEqual(industryKey, "manufacturing");
});

test("the resolved benchmark label and basis never mention manufacturing for the renewable-energy prompt", () => {
  const { industry } = inferFinancialModelingInputs(renewableEnergyPrompt);

  assert.doesNotMatch(industry, /manufactur/i);
  assert.equal(industry, "Clean energy / grid technology");
});

// --- Requirement: renewable/utility/grid/battery/energy-trading ideas ----

test("utility, grid, battery-storage, renewable, and energy-trading ideas all map to the energy benchmark", () => {
  const prompts = [
    "A platform that helps electric utility companies manage demand response programs.",
    "A smart grid technology platform for modernizing electricity distribution.",
    "A battery storage dispatch optimization platform for grid operators.",
    "A renewable energy asset management platform for solar and wind farm operators.",
    "An energy trading platform for power utilities and clean energy generators.",
    "A microgrid and distributed energy management platform for commercial buildings.",
    "A virtual power plant platform aggregating residential battery storage.",
  ];

  for (const prompt of prompts) {
    const industryKey = inferIndustryKey(prompt);
    assert.equal(industryKey, "energy", `"${prompt}" should classify as energy, got "${industryKey}"`);
  }
});

test("no resolved industry label for any energy/utility/grid prompt ever mentions manufacturing", () => {
  const prompts = [
    "A platform that helps electric utility companies manage demand response programs.",
    "A battery storage dispatch optimization platform for grid operators.",
    "A renewable energy asset management platform for solar and wind farm operators.",
  ];

  for (const prompt of prompts) {
    const { industry } = inferFinancialModelingInputs(prompt);
    assert.doesNotMatch(industry, /manufactur/i, `"${prompt}" resolved industry label mentions manufacturing: "${industry}"`);
  }
});

// --- Requirement: manufacturing ideas still map correctly (no regression) --

test("genuine manufacturing ideas -- including ones mentioning batteries/EVs as products -- still map to manufacturing", () => {
  const prompts = [
    "A battery manufacturer producing lithium-ion cells for industrial customers.",
    "An EV manufacturer building electric vehicles at a new automotive factory.",
    "An industrial manufacturing company producing precision-machined automotive parts.",
    "A factory automation platform for advanced manufacturing operations.",
  ];

  for (const prompt of prompts) {
    const industryKey = inferIndustryKey(prompt);
    assert.equal(industryKey, "manufacturing", `"${prompt}" should still classify as manufacturing, got "${industryKey}"`);
  }
});

test("the automotive-procurement prompt (a previously-fixed manufacturing regression) still classifies as manufacturing", () => {
  const automotivePrompt =
    "I want to build an AI-powered procurement optimization platform for global automotive manufacturers. The platform integrates with SAP, Oracle, and Microsoft Dynamics, predicts supplier risks, optimizes inventory, monitors ESG compliance, and automatically recommends sourcing decisions. Target customers are automotive manufacturers operating in Germany, Japan, South Korea, Mexico, and the United States.";

  assert.equal(inferIndustryKey(automotivePrompt), "manufacturing");
});

// --- Requirement: other verticals still map correctly (no regression) -----

test("healthcare, fintech, logistics, and AML/Fraud ideas still map correctly", () => {
  const cases = [
    ["An AI-powered patient scheduling automation platform for a hospital network.", "healthcare"],
    ["A neobank platform offering digital wallets and payment processing for consumers.", "fintech"],
    ["A logistics platform for commercial shipping companies optimizing fleet operations and freight routing.", "logistics"],
    [
      "An AML and fraud detection compliance platform (transaction monitoring, sanctions screening, and KYC automation) for banks and fintechs.",
      "cybersecurity",
    ],
  ];

  for (const [prompt, expected] of cases) {
    const industryKey = inferIndustryKey(prompt);
    assert.equal(industryKey, expected, `"${prompt}" should classify as ${expected}, got "${industryKey}"`);
  }
});

// --- Benchmark data integrity ---------------------------------------------

test("the energy benchmark entry has a complete, valid shape matching every other industry entry", async () => {
  const { getIndustryBenchmarks } = await import(
    pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href
  );
  const benchmark = getIndustryBenchmarks("energy");

  assert.equal(benchmark.key, "energy");
  assert.doesNotMatch(benchmark.label, /manufactur/i);
  assert.doesNotMatch(benchmark.benchmarkBasis, /manufactur/i);
  for (const rangeKey of ["grossMargin", "cac", "ltv", "cacPayback", "arrGrowth", "ebitdaMargin", "revenueMultiple"]) {
    assert.ok(benchmark.ranges[rangeKey], `missing range: ${rangeKey}`);
    assert.ok(benchmark.ranges[rangeKey].low < benchmark.ranges[rangeKey].high, `${rangeKey} low must be less than high`);
  }
  for (const modelingKey of ["tamUsd", "samRate", "somRate", "arpaMonthly", "month12Customers", "customerGrowthRate", "cacUsd", "grossMarginRate", "lifetimeMonths", "monthlyBurnUsd", "startupCapexUsd", "targetRunwayMonths"]) {
    assert.ok(typeof benchmark.modeling[modelingKey] === "number" && benchmark.modeling[modelingKey] > 0, `missing/invalid modeling.${modelingKey}`);
  }
});

test("common industry-name aliases for energy all resolve to the same benchmark entry", async () => {
  const { getIndustryBenchmarks } = await import(
    pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href
  );
  const canonical = getIndustryBenchmarks("energy");

  for (const alias of ["renewable energy", "clean energy", "cleantech", "utilities", "utility", "grid technology"]) {
    assert.deepEqual(getIndustryBenchmarks(alias), canonical, `alias "${alias}" did not resolve to the energy benchmark`);
  }
});

// --- Turkish localization completeness (no regression) --------------------

test("the new energy benchmark label has a Turkish translation entry, matching every other industry (drift check)", () => {
  const dictMatch = /const industryBenchmarkLabelTranslations[\s\S]*?\};/.exec(planExecutorSource);
  assert.ok(dictMatch, "industryBenchmarkLabelTranslations not found");
  assert.match(dictMatch[0], /"Clean energy \/ grid technology":\s*"Temiz enerji \/ şebeke teknolojisi"/);
});

// --- Drift checks -----------------------------------------------------

test("inferIndustryKey's energy pattern is positioned before the manufacturing pattern (drift check on match-order precedence)", () => {
  const energyIndex = financialModelSource.indexOf('"energy"]');
  const manufacturingIndex = financialModelSource.indexOf('"manufacturing"],');
  assert.ok(energyIndex > -1, "energy pattern not found");
  assert.ok(manufacturingIndex > -1, "manufacturing pattern not found");
  assert.ok(energyIndex < manufacturingIndex, "energy pattern must be checked before manufacturing");
});

test("IndustryKey type union and the industryBenchmarks record both declare 'energy' (drift check)", () => {
  assert.match(industryBenchmarksSource, /\|\s*"energy"/);
  assert.match(industryBenchmarksSource, /\benergy:\s*\{/);
});

test("the energy pattern is not a bare 'battery'/'industrial' catch -- it only matches compound, energy-specific phrases (no over-broad matching)", () => {
  const patternMatch = /\[\/\\b\(renewable energy\|clean energy[\s\S]*?"energy"\],/.exec(financialModelSource);
  assert.ok(patternMatch, "energy pattern not found in expected shape");
  assert.doesNotMatch(patternMatch[0], /\|\\bbattery\\b\|/, "energy pattern must not bare-match 'battery' the way manufacturing's pattern does");
});
