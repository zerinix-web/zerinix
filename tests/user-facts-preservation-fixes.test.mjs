import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- preserve user facts over AI assumptions.
//
// 1. A prompt stating a real, current "$18,000 MRR" was still shown in
//    the report as a benchmark-formula-derived MRR figure -- every
//    financial metric was a pure multiplier chain off industry-benchmark
//    modeling data, with no path for the user's own literal number to
//    ever become the metric's actual value.
// 2. A prompt naming "Germany, Japan, South Korea, United States, and
//    Canada" silently dropped Canada -- no regionPatterns entry existed
//    for it at all, the same class of gap already fixed for Netherlands/
//    Switzerland/Qatar in an earlier turn.
// 3. "AI-powered strategic procurement intelligence for large
//    manufacturing and energy companies" (a clear AI SaaS product) was
//    classified with businessModel "asset-heavy manufacturing" and
//    pricingModel "unit sales plus service contracts" -- the only signal
//    present was the industry the product SERVES ("manufacturing"), not
//    any word describing what the business itself sells.

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

const { createFinancialModel, inferFinancialModelingInputs } = await importFinancialModel();

// --- Requirement 1: user-stated financial metrics are never overwritten --

test("the exact live bug: a stated '$18,000 MRR' is preserved as the report's actual MRR value, not replaced by a benchmark-derived figure", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management. We currently have $18,000 MRR.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.mrr.value, 18_000);
  assert.equal(model.metrics.mrr.confidence, "High");
  assert.match(model.metrics.mrr.assumptions.join(" "), /actual, user-provided mrr/i);
  assert.match(model.metrics.mrr.benchmarkComparison, /actual figure supplied in the request/i);
});

test("a stated ARR is preserved directly, and MRR is derived consistently from it (arr / 12) rather than staying benchmark-derived", () => {
  const model = createFinancialModel({
    prompt: "A subscription software company. We have $600,000 ARR today.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.arr.value, 600_000);
  assert.equal(model.metrics.mrr.value, 50_000);
  assert.match(model.metrics.arr.benchmarkComparison, /actual figure supplied in the request/i);
  assert.match(model.metrics.mrr.formula, /derived from the verified arr/i);
});

// PRODUCTION DATA PROVENANCE POLISH: MRR was itself stated, so it is
// Verified; ARR was only calculated from that stated MRR, so it is
// Derived -- never itself shown as Verified (see
// tests/data-provenance-three-tier-classification.test.mjs).
test("a stated MRR alone still keeps ARR internally consistent (mrr x 12) -- MRR is Verified, the calculated ARR is Derived, not Verified", () => {
  const model = createFinancialModel({
    prompt: "A SaaS analytics platform. Current MRR is $25,000.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.mrr.value, 25_000);
  assert.equal(model.metrics.arr.value, 300_000);
  assert.match(model.metrics.mrr.formula, /stated directly in the request/i);
  assert.match(model.metrics.arr.formula, /derived from the verified mrr/i);
});

test("a stated customer count is used as the actual Month-12 customer base instead of the benchmark-derived ramp estimate", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management. We currently have 240 paying customers.",
    reportKind: "business_plan",
  });

  assert.match(model.metrics.mrr.assumptions.join(" "), /Month-12 customers: 240/);
});

test("a prompt naming no real MRR/ARR/customer figures continues to use benchmark-derived values, unaffected (no regression)", () => {
  const model = createFinancialModel({
    prompt: "An AI-powered SaaS platform for expense management targeting mid-market companies.",
    reportKind: "business_plan",
  });

  assert.notEqual(model.metrics.mrr.confidence, "High");
  assert.doesNotMatch(model.metrics.mrr.benchmarkComparison, /actual figure supplied in the request/i);
});

test("a negated MRR claim ('we don't have $18,000 in MRR yet') is never misread as a real figure", () => {
  const model = createFinancialModel({
    prompt: "An early-stage SaaS idea. We don't have $18,000 in MRR yet -- this is pre-revenue.",
    reportKind: "business_plan",
  });

  assert.doesNotMatch(model.metrics.mrr.benchmarkComparison, /actual figure supplied in the request/i);
});

test("a customer count immediately qualified as a market-size estimate ('50,000 potential customers') is never mistaken for a real, current customer base", () => {
  const model = createFinancialModel({
    prompt: "A SaaS platform targeting 50,000 potential customers in the addressable market.",
    reportKind: "business_plan",
  });

  assert.doesNotMatch(model.metrics.mrr.assumptions.join(" "), /Month-12 customers: 50000/);
});

test("MRR/ARR expressed with a 'k' suffix ($18k MRR) parses to the correct full numeric value", () => {
  const model = createFinancialModel({
    prompt: "A SaaS platform. We have $18k MRR today.",
    reportKind: "business_plan",
  });

  assert.equal(model.metrics.mrr.value, 18_000);
});

// --- Requirement 2: every explicit user entity (country) survives -------

test("the exact live bug: Germany, Japan, South Korea, United States, and Canada all survive into the resolved geography, none silently dropped", () => {
  const geography = inferFinancialModelingInputs(
    "A SaaS platform expanding across Germany, Japan, South Korea, United States, and Canada."
  ).geography;
  const regions = new Set(geography.split(" + "));

  for (const country of ["Germany", "Japan", "South Korea", "United States", "Canada"]) {
    assert.ok(regions.has(country), `"${country}" missing from geography "${geography}"`);
  }
  assert.equal(regions.size, 5, `expected exactly 5 countries, got "${geography}"`);
});

test("Canada alone resolves to its own explicit 'Canada' value, not the unspecified-geography default", () => {
  assert.equal(
    inferFinancialModelingInputs("A logistics platform for retailers in Canada.").geography,
    "Canada"
  );
});

test("Canada is never dropped when named alongside other countries, in any order", () => {
  const geography = inferFinancialModelingInputs(
    "A fintech platform operating in Canada, Mexico, and the United States."
  ).geography;
  const regions = new Set(geography.split(" + "));

  for (const country of ["Canada", "Mexico", "United States"]) {
    assert.ok(regions.has(country), `"${country}" missing from geography "${geography}"`);
  }
});

// --- Requirement 3: SaaS is never rewritten as a different business model --

test("the exact live bug: 'AI-powered strategic procurement intelligence for large manufacturing and energy companies' classifies as subscription software, not asset-heavy manufacturing", () => {
  const prompt =
    "AI-powered strategic procurement intelligence for large manufacturing and energy companies. It analyzes supplier contracts, purchase orders, ERP data, commodity prices, shipping delays, geopolitical risk, sanctions exposure, and supplier financial health. It integrates with SAP S/4HANA, Oracle ERP, Coupa, Microsoft Dynamics 365, and Snowflake.";
  const inputs = inferFinancialModelingInputs(prompt);

  assert.equal(inputs.businessModel, "subscription software");
  assert.equal(inputs.pricingModel, "subscription");
  assert.notEqual(inputs.businessModel, "asset-heavy manufacturing");
  assert.notEqual(inputs.pricingModel, "unit sales plus service contracts");
});

test("an AI-powered enterprise risk intelligence platform classifies as subscription software (no regression, uses the literal 'platform' keyword)", () => {
  const inputs = inferFinancialModelingInputs(
    "An AI-powered enterprise risk intelligence platform analyzing sanctions, compliance, cyber incidents, supplier contracts, and geopolitical risk."
  );

  assert.equal(inputs.businessModel, "subscription software");
});

test("a genuine consulting firm still classifies as services, not SaaS (no over-correction)", () => {
  const inputs = inferFinancialModelingInputs(
    "A consulting firm offering strategy advisory services to enterprise clients."
  );

  assert.equal(inputs.businessModel, "services");
});

test("a genuine manufacturer (not a SaaS company serving manufacturers) still classifies as asset-heavy manufacturing (no over-correction)", () => {
  const inputs = inferFinancialModelingInputs(
    "A battery manufacturer producing lithium-ion cells for industrial customers."
  );

  assert.equal(inputs.businessModel, "asset-heavy manufacturing");
});

test("a genuine marketplace still classifies as marketplace, not subscription software (no over-correction)", () => {
  const inputs = inferFinancialModelingInputs(
    "A two-sided marketplace connecting freelance designers with small businesses."
  );

  assert.equal(inputs.businessModel, "marketplace");
});

test("an AI-powered SaaS company's unit economics stay internally consistent with a subscription business: MRR/ARR/CAC/LTV all derive from the same subscription-priced model, not a unit-sales one", () => {
  const model = createFinancialModel({
    prompt:
      "AI-powered strategic procurement intelligence for large manufacturing and energy companies, sold as a subscription platform.",
    reportKind: "business_plan",
  });

  assert.equal(model.inputs.businessModel, "subscription software");
  assert.equal(model.inputs.pricingModel, "subscription");
  assert.match(model.metrics.arr.formula, /MRR x 12/i);
  assert.match(model.metrics.mrr.formula, /Month-12 customers x ARPA/i);
});

// --- Wiring / no-architecture-change drift checks ------------------------

const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");

test("extractUserStatedFinancials is wired into createFinancialModel before the mrr/arr/month12Customers formulas run (drift check)", () => {
  const fnIndex = financialModelSource.indexOf("export function createFinancialModel");
  assert.ok(fnIndex > -1, "createFinancialModel not found");
  const mrrLineIndex = financialModelSource.indexOf("const mrr = userStated.mrr", fnIndex);
  assert.ok(mrrLineIndex > fnIndex, "mrr override wiring not found inside createFinancialModel");
});

test("no new FinancialMetricModel fields, section removals, or type changes were introduced (drift check on the exported metrics shape)", () => {
  assert.match(
    financialModelSource,
    /metrics:\s*\{\s*tam:\s*FinancialMetricModel;\s*sam:\s*FinancialMetricModel;\s*som:\s*FinancialMetricModel;/
  );
});
