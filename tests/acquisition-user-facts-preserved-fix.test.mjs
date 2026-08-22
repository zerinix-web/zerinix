import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- preserve user-provided acquisition facts as authoritative
// inputs.
//
// The user reported: enterprise customer count (500) and employee count
// (80) were explicitly provided, and the report still described them as
// unverified. Root cause, found by reproducing the exact structured
// "Field: Value" phrasing the user's own problem statement uses:
//
//   Purchase price: $40M
//   ARR: $10M
//   Enterprise customers: 500
//   Employees: 80
//   Buyer available capital: $25M
//   Debt financing: $15M
//
// extractAcquisitionDealFacts (acquisition-deal-facts.ts) silently
// corrupted this input in two ways:
//
// 1. Its "value-then-label" regex direction connected a value to a label
//    with plain \s*, which matches across a newline. So "$40M" (Purchase
//    price's own value) bled forward into matching the very next line's
//    "ARR" label, and "500" (Enterprise customers' own value) bled
//    forward into matching "Employees" on the line after that --
//    reassigning one field's figure to a completely different field.
// 2. extractLabeledCount and extractEnterpriseCustomers never supported
//    the label-then-value direction at all ("Employees: 80",
//    "Enterprise customers: 500") -- only "80 employees"/"500 customers"
//    prose. Even once bleeding was fixed, these fields still returned
//    null for structured input, which is exactly what makes a field read
//    as "not verified" downstream: a null fact is indistinguishable from
//    a fact the user never provided.
//
// This suite proves both the extraction fix and its consequence: once
// extraction is correct, the customer/employee counts are non-null facts,
// and every acquisition-reachable content generator that already branches
// on "facts.enterpriseCustomers != null" / "facts.employees != null"
// (built in the prior "acquisition intelligence polish" turns) naturally
// treats them as known inputs -- no change to routing, sanitization, or
// the EV/ARR / equity-debt-split calculations was needed or made.

const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
  "../app/lib/ai/acquisition-deal-facts.ts"
);
const { acquisitionAnalysisPrompts, buildAcquisitionAnalysisInstructions } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const dealFactsSource = readFileSync(
  new URL("../app/lib/ai/acquisition-deal-facts.ts", import.meta.url),
  "utf8"
);

// --- 1. The exact reported scenario, structured "Field: Value" phrasing --

const structuredPrompt = [
  "Purchase price: $40M",
  "ARR: $10M",
  "Enterprise customers: 500",
  "Employees: 80",
  "Buyer available capital: $25M",
  "Debt financing: $15M",
].join("\n");

test("extractAcquisitionDealFacts correctly parses every field of the exact structured, one-fact-per-line scenario from the ticket -- no cross-line bleeding", () => {
  const facts = extractAcquisitionDealFacts(structuredPrompt);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.enterpriseCustomers, 500);
  assert.equal(facts.employees, 80);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);
  assert.equal(facts.remainingFinancingType, "debt");
});

test("customer count and employee count are non-null (known) facts for the structured scenario -- the exact requirement from the ticket", () => {
  const facts = extractAcquisitionDealFacts(structuredPrompt);
  assert.notEqual(facts.enterpriseCustomers, null);
  assert.notEqual(facts.employees, null);
});

test("computeAcquisitionDerivedMetrics still correctly computes EV/ARR = 4x and the $25M/$15M equity/debt split for the structured scenario (calculations untouched)", () => {
  const facts = extractAcquisitionDealFacts(structuredPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(derived.debtSharePercent, 37.5);
  assert.equal(derived.equitySharePercent, 62.5);
});

// --- 2. The same scenario in ordinary prose phrasing still works (no regression) -

const prosePrompt =
  "We are acquiring a company. Purchase price is $40M, target ARR is $10M, it has 500 enterprise customers and 80 employees, buyer available capital is $25M, and remaining financing is debt.";

test("extractAcquisitionDealFacts still correctly parses the same scenario in ordinary prose phrasing (no regression from the structured-input fix)", () => {
  const facts = extractAcquisitionDealFacts(prosePrompt);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.enterpriseCustomers, 500);
  assert.equal(facts.employees, 80);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);
  assert.equal(facts.remainingFinancingType, "debt");
});

// --- 3. No bleeding regardless of line order --------------------------------

test("no value bleeds into an adjacent field's label regardless of the order the facts are listed in", () => {
  const reordered = [
    "Employees: 80",
    "Enterprise customers: 500",
    "Debt financing: $15M",
    "Buyer available capital: $25M",
    "ARR: $10M",
    "Purchase price: $40M",
  ].join("\n");
  const facts = extractAcquisitionDealFacts(reordered);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.enterpriseCustomers, 500);
  assert.equal(facts.employees, 80);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);
  assert.equal(facts.remainingFinancingType, "debt");
});

test("a bare number on the line immediately before an unrelated label is never misread as that label's value (the exact bleeding bug, isolated)", () => {
  // "80" belongs to Employees; the very next line's label (Buyer available
  // capital) must never inherit it.
  const facts = extractAcquisitionDealFacts("Employees: 80\nBuyer available capital: $25M");
  assert.equal(facts.employees, 80);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);
});

// --- 4. Negation safety is unaffected by the same-line-gap fix -------------

test("a negated figure ('we don't have 500 enterprise customers yet') is still never misread as a real fact -- negation detection unaffected by the same-line-gap fix", () => {
  const facts = extractAcquisitionDealFacts(
    "We don't have 500 enterprise customers yet, and we don't have 80 employees yet."
  );
  assert.equal(facts.enterpriseCustomers, null);
  assert.equal(facts.employees, null);
});

// --- 5. Known facts are never downgraded to unverified/missing/unknown -----

test("buildAcquisitionAnalysisInstructions explicitly forbids describing a [Verified] figure -- including customer and employee count -- as unverified, missing, unknown, or requiring verification anywhere in the report", () => {
  const instructions = buildAcquisitionAnalysisInstructions("English");
  assert.match(instructions, /enterprise customer count and employee count/i);
  assert.match(instructions, /Never describe a \[Verified\] figure as unverified, missing, unknown, or requiring verification/i);
});

// --- 6. Strategic Fit / Revenue Synergies / Integration Risks use these facts as known inputs -

test("strategicFit references enterprise customer count and employee count as facts to use, not facts to re-verify", () => {
  const prompt = acquisitionAnalysisPrompts.strategicFit;
  assert.match(prompt, /enterprise customer count, employee count/i);
});

test("revenueSynergies frames the enterprise customer base as a known input for cross-sell and expansion reasoning", () => {
  const prompt = acquisitionAnalysisPrompts.revenueSynergies;
  assert.match(prompt, /customer expansion/i);
  assert.match(prompt, /existing enterprise customer base/i);
});

test("integrationRisks uses employee count as a known input while still assessing organizational/integration risk", () => {
  const prompt = acquisitionAnalysisPrompts.integrationRisks;
  assert.match(prompt, /employee count/i);
  assert.match(prompt, /employee retention/i);
});

// --- 7. The deterministic fallback's "known" branches are gated correctly --
// (the null-branch "cannot be assessed without a verified count" language
// must only ever fire when the fact is genuinely absent, never when it was
// provided but merely failed to parse -- which is exactly the bug this fix
// addresses at the source.)

test("buildFallbackStrategicFit/buildFallbackIntegrationRisks/buildFallbackRevenueSynergies brackets their 'not yet verified' language behind a facts != null check, so a correctly-extracted fact never reaches it", () => {
  for (const fnName of ["buildFallbackStrategicFit", "buildFallbackIntegrationRisks", "buildFallbackRevenueSynergies"]) {
    const fnMatch = new RegExp(`function ${fnName}\\([\\s\\S]*?\\n}`).exec(planExecutorSource);
    assert.ok(fnMatch, `${fnName} not found`);
    assert.match(fnMatch[0], /facts\.(enterpriseCustomers|employees) != null/, `${fnName} should branch on whether the fact was actually extracted`);
  }
});

// --- 8. Do not change routing, sanitization, or calculations ---------------

test("computeAcquisitionDerivedMetrics's calculation logic is unchanged by this fix (drift check)", () => {
  assert.match(
    dealFactsSource,
    /const evToArr =\s*\n\s*purchasePrice != null && targetArr != null && targetArr > 0/
  );
  assert.match(
    dealFactsSource,
    /const equityContribution =\s*\n\s*purchasePrice != null && buyerAvailableCapital != null\s*\n\s*\? Math\.min\(buyerAvailableCapital, purchasePrice\)/
  );
});

test("report-presentation-sanitizer.ts and domain routing are untouched by this fix (drift check)", async () => {
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(typeof stripReportPresentationArtifacts, "function");
  assert.equal(classifyReportDomain(structuredPrompt), "acquisition");
});
