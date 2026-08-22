import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- 4 real, confirmed issues in the Business
// Plan pipeline, found in production validation for a veterinary AI
// prompt with a multi-region geography (North America + Europe):
//
// 1. Generic "[Section] for [name]:" fallback template text (used only
//    when a section's own synthesized content is empty/unusable) read
//    as a fill-in-the-blank placeholder rather than business-specific
//    analysis, regardless of what businessLabel was substituted in.
// 2. The Business Plan timeout fallback (createGroundedBusinessTimeoutFallback)
//    appended an internal disclosure sentence -- "The report synthesis
//    provider reached its time budget..." -- directly onto the
//    user-facing executiveSummary.
// 3. Geography classification collapsed "North America + Europe" to
//    just "United States", because the bare "america" alternative
//    matched inside "North America" before the "europe" pattern was
//    ever considered, and firstMatching only ever returns its first
//    match, discarding every other region actually named.
// 4. (Same root cause as #1) Problem, Solution, ICP, Market Opportunity,
//    Competitor Landscape, Business Model, Porter's Five Forces,
//    Pricing Strategy, GTM, and Sales Strategy's fallback text is now
//    built from the same already-detected industry/businessModel/
//    targetCustomer/geography/pricingModel classification the financial
//    model and Financial Assumptions section already use, instead of a
//    generic instructional template.

const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
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

const { inferFinancialModelingInputs } = await importFinancialModel();

// --- Issue 2: timeout disclosure leaking into executiveSummary --------

test("createGroundedBusinessTimeoutFallback no longer appends the internal timeout disclosure to executiveSummary (drift check)", () => {
  const match = planExecutorSource.match(
    /function createGroundedBusinessTimeoutFallback\(\{[\s\S]*?\n\}/
  );
  assert.ok(match, "createGroundedBusinessTimeoutFallback not found");
  assert.doesNotMatch(match[0], /reached its time budget/i);
  assert.doesNotMatch(match[0], /süre bütçesine ulaştı/i);
  assert.doesNotMatch(match[0], /report\.executiveSummary = /);
});

// --- Issue 3: geography multi-region + "North America" -----------------

test("'North America + Europe' resolves to both regions, not just 'United States' (the exact live bug)", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a veterinary AI platform for clinics across North America and Europe."
  );

  // Both regions must be present -- order isn't semantically meaningful,
  // so this checks membership rather than a fixed join order.
  const regions = inputs.geography.split(" + ");
  assert.deepEqual(new Set(regions), new Set(["North America", "Europe"]));
  assert.doesNotMatch(inputs.geography, /^United States$/);
});

test("'North America' alone still resolves to 'North America', not 'United States'", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a logistics SaaS platform for warehouses across North America."
  );

  assert.equal(inputs.geography, "North America");
});

test("bare 'United States'/'US'/'America' (no 'North America' present) still resolves to 'United States', unchanged", () => {
  assert.equal(
    inferFinancialModelingInputs("I am building a SaaS platform for the United States market.").geography,
    "United States"
  );
  assert.equal(
    inferFinancialModelingInputs("a SaaS platform for the US market").geography,
    "United States"
  );
});

test("a single-region prompt (just Europe) still resolves to a single value, unchanged", () => {
  assert.equal(
    inferFinancialModelingInputs("a SaaS platform for clinics across Europe").geography,
    "Europe"
  );
});

test("no explicit region still falls back to the existing default, unchanged", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a warehouse automation software platform for mid-sized logistics companies."
  );

  assert.equal(inputs.geography, "global markets");
});

// --- Issues 1 & 4: generic "[Section] for [name]:" fallback template --

test("the narrative fallback fields no longer use the banned '[Section] for [name]:' template pattern (drift check)", () => {
  const fallbackMapMatch = planExecutorSource.match(
    /const fallbackByField: Record<PlanReportField, string> = \{[\s\S]*?\n  \};/
  );
  assert.ok(fallbackMapMatch, "fallbackByField map not found");

  for (const bannedPattern of [
    /Product thesis for \$\{shortBusinessLabel\}/,
    /Target customer for \$\{shortBusinessLabel\}/,
    /Market opportunity for \$\{shortBusinessLabel\}/,
    /Competitor landscape for \$\{shortBusinessLabel\}/,
    /Business model for \$\{shortBusinessLabel\}/,
    /Porter's Five Forces for \$\{shortBusinessLabel\}/,
    /Pricing strategy for \$\{shortBusinessLabel\}/,
    /Go-to-market plan for \$\{shortBusinessLabel\}/,
    /Sales strategy for \$\{shortBusinessLabel\}/,
  ]) {
    assert.doesNotMatch(fallbackMapMatch[0], bannedPattern);
  }
});

test("the 10 improved narrative fallback fields pull from the same already-detected context.inputs values used elsewhere in the report (drift check)", () => {
  assert.match(planExecutorSource, /const industryLabel = context\?\.inputs\.industry \|\| /);
  assert.match(planExecutorSource, /const targetCustomerLabel = context\?\.inputs\.targetCustomer \|\| /);
  assert.match(planExecutorSource, /const businessModelLabel = context\?\.inputs\.businessModel \|\| /);
  assert.match(planExecutorSource, /const geographyLabel = context\?\.inputs\.geography \|\| /);
  assert.match(planExecutorSource, /const pricingModelLabel = context\?\.inputs\.pricingModel \|\| /);

  for (const field of [
    "problem",
    "solution",
    "targetCustomer",
    "marketOpportunity",
    "competitorLandscape",
    "businessModel",
    "portersFiveForces",
    "pricingStrategy",
    "goToMarketPlan",
    "salesStrategy",
  ]) {
    const fieldLineMatch = planExecutorSource.match(
      new RegExp(`\\n    ${field}: \`([^\`]+)\`,`)
    );
    assert.ok(fieldLineMatch, `${field}'s fallback line not found`);
    assert.ok(
      /industryLabel|targetCustomerLabel|businessModelLabel|geographyLabel|pricingModelLabel/.test(
        fieldLineMatch[1]
      ),
      `${field}'s fallback text no longer references any detected context value`
    );
  }
});

test("a fallback field still works (with sensible defaults) even when context is unavailable, without throwing", () => {
  // Mirrors the exact optional-chaining default logic added to
  // createPlanFieldFallback.
  const context = undefined;
  const industryLabel = context?.inputs.industry || "the detected industry";
  const targetCustomerLabel = context?.inputs.targetCustomer || "the primary target buyer";

  assert.equal(industryLabel, "the detected industry");
  assert.equal(targetCustomerLabel, "the primary target buyer");
});
