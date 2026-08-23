import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- improve Business Plan decision language and preserve
// user inputs.
//
// 1. "Evidence Quality"/"Source Confidence"/"Missing Evidence" (internal
//    audit-tool-sounding labels) replaced with natural executive
//    language in the shared Executive Snapshot/PDF-cover quality
//    breakdown and Planner.tsx's live executive-summary card. "Verified"
//    as a bare classification word is left untouched -- it turned out to
//    be a deliberate, cross-file, already-tested evidence taxonomy
//    (report-evidence.ts/financial-assumptions.ts/plan.ts all share it
//    consistently), not a stray internal-sounding leak, so unwinding it
//    was correctly judged out of scope for this fix (see the reverted
//    attempt documented in this session).
// 2. Preserve user-provided facts: extractUserStatedFinancials
//    (financial-model.ts) previously extracted only mrr/arr/customers,
//    and had a real bug -- "Year 1 target: 200 customers" was NOT
//    excluded from being read as a current, actual customer count
//    (the exclusion regex required the qualifier word to be followed by
//    nothing but whitespace, and a colon broke that anchor). Now also
//    extracts a stated subscription/per-account price, an initial
//    investment amount, an employee count, and a Year-1 customer target
//    (as its own distinct, correctly-labeled fact -- never blended into
//    the customer-count/revenue calculation as if it were current
//    performance).
// 3. User Inputs vs Planning Assumptions: buildCanonicalFinancialAssumptions
//    (plan-executor.ts) now explicitly lists every user-provided fact
//    under "User-provided facts:", and never duplicates a user-provided
//    figure under "AI assumptions:" too.
// 4. Financial Dashboard: the "Live model" badge no longer renders
//    unconditionally regardless of whether any figure is real; the
//    decorative, metric-unrelated hardcoded progress-bar fill is now
//    tied to the metric's own real evidence tier.
// 5. "Low Confidence" replaced with executive language naming what needs
//    validation.
//
// Routing, acquisition logic, PDF, and sanitization were not touched.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href)
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

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-output-sanitization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { extractUserStatedFinancials, createFinancialModel } = await importFinancialModel();
const { getReportQualityBreakdown, buildExecutiveSnapshot } = await importReportPresentation();

const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");

// --- 1. Internal system language removed from user-facing labels ----------

// NOTE: superseded by the "Business Plan final quality polish" ticket --
// "Analysis Rigor"/"Data Reliability" (this test's original assertion)
// were themselves flagged as still reading like internal scoring
// dimensions and were replaced again with "Data Completeness"/"Planning
// Confidence". See tests/business-plan-final-quality-polish-fix.test.mjs
// for the full, current assertion.
test("getReportQualityBreakdown no longer labels metric cards 'Evidence Quality'/'Source Confidence'", () => {
  const breakdown = getReportQualityBreakdown({
    totalScore: 70,
    dimensions: {
      evidenceQuality: 65,
      sourceConfidence: 60,
      financialConsistency: 75,
      benchmarkFit: 70,
      validationReadiness: 68,
    },
  });
  const labels = breakdown.map((item) => item.label);
  assert.ok(!labels.includes("Evidence Quality"), "should not include the literal 'Evidence Quality' label");
  assert.ok(!labels.includes("Source Confidence"), "should not include the literal 'Source Confidence' label");
  assert.ok(!labels.includes("Analysis Rigor"), "should not include the now-superseded 'Analysis Rigor' label");
  assert.ok(!labels.includes("Data Reliability"), "should not include the now-superseded 'Data Reliability' label");
  assert.ok(labels.includes("Data Completeness"));
  assert.ok(labels.includes("Planning Confidence"));
});

test("Planner.tsx's live executive-summary card no longer labels a metric 'Missing Evidence'", () => {
  assert.doesNotMatch(plannerSource, /\["Missing Evidence",/);
  assert.match(plannerSource, /\["Key Gap",/);
});

// --- 2. Preserve user-provided facts ----------------------------------------

const exampleFactsPrompt =
  "We want to launch a B2B SaaS product. Our subscription price is $500/month. Year 1 target: 200 customers. We are seeking a $1M initial investment. Our team currently has 12 employees.";

test("extractUserStatedFinancials extracts all four of the ticket's example facts correctly", () => {
  const facts = extractUserStatedFinancials(exampleFactsPrompt);
  assert.equal(facts.pricePerCustomer, 500);
  assert.equal(facts.year1CustomerTarget, 200);
  assert.equal(facts.investmentAmount, 1_000_000);
  assert.equal(facts.employees, 12);
});

test("the exact reported bug is fixed: 'Year 1 target: 200 customers' is never misread as the CURRENT, actual customer count", () => {
  const facts = extractUserStatedFinancials(exampleFactsPrompt);
  assert.equal(facts.customers, null, "200 is a stated goal, not a current customer count");
});

test("a genuine current customer count ('we currently have 200 paying customers') is still correctly extracted (no over-correction from the target-exclusion fix)", () => {
  const facts = extractUserStatedFinancials("We currently have 200 paying customers and $18,000 in MRR.");
  assert.equal(facts.customers, 200);
});

test("the target-exclusion fix also catches 'target is X' (a linking verb between the qualifier and the value, not just a colon), and the pre-existing 'potential' qualifier still works", () => {
  // "target is X" is a genuine improvement made alongside the colon fix
  // (the original exclusion never covered a linking verb either --
  // confirmed by testing against the pre-fix regex directly).
  assert.equal(extractUserStatedFinancials("Our target is 500 customers by year 2.").customers, null);
  assert.equal(extractUserStatedFinancials("There are 50,000 potential customers in this market.").customers, null);
});

test("negated facts are still never misread (no regression from the new extraction functions)", () => {
  const facts = extractUserStatedFinancials(
    "We don't have $500/month in subscription price yet, and we do not have $1M in initial investment secured."
  );
  assert.equal(facts.pricePerCustomer, null);
  assert.equal(facts.investmentAmount, null);
});

// --- 3. The new facts correctly override the benchmark calculations --------

test("createFinancialModel prefers the user-stated subscription price over the benchmark ARPA formula, and labels it User-provided", () => {
  const model = createFinancialModel({ prompt: exampleFactsPrompt, reportKind: "business_plan" });
  assert.equal(model.metrics.arpa.value, 500);
  assert.equal(model.metrics.arpa.confidence, "High");
  assert.equal(model.metrics.arpa.formula, "User-provided (stated directly in the request)");
});

test("createFinancialModel prefers the user-stated investment amount over the benchmark runway formula, and labels it User-provided", () => {
  const model = createFinancialModel({ prompt: exampleFactsPrompt, reportKind: "business_plan" });
  assert.equal(model.metrics.investmentNeeded.value, 1_000_000);
  assert.equal(model.metrics.investmentNeeded.confidence, "High");
  assert.equal(model.metrics.investmentNeeded.formula, "User-provided (stated directly in the request)");
});

test("createFinancialModel surfaces employees and year1CustomerTarget via userProvidedFacts, without inventing a fake formula for them", () => {
  const model = createFinancialModel({ prompt: exampleFactsPrompt, reportKind: "business_plan" });
  assert.equal(model.userProvidedFacts.employees, 12);
  assert.equal(model.userProvidedFacts.year1CustomerTarget, 200);
});

test("a report with no stated price/investment still falls back to the ordinary benchmark formulas, unaffected by this fix", () => {
  const model = createFinancialModel({
    prompt: "We are launching a generic B2B SaaS product for mid-market companies.",
    reportKind: "business_plan",
  });
  assert.notEqual(model.metrics.arpa.formula, "User-provided (stated directly in the request)");
  assert.notEqual(model.metrics.investmentNeeded.formula, "User-provided (stated directly in the request)");
  assert.equal(model.userProvidedFacts.employees, null);
  assert.equal(model.userProvidedFacts.year1CustomerTarget, null);
});

// --- 4. User Inputs vs Planning Assumptions are separated, never duplicated -

test("buildCanonicalFinancialAssumptions lists every user-provided fact under 'User-provided facts:', separately from 'AI assumptions:'", () => {
  const fnMatch = /function buildCanonicalFinancialAssumptions\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildCanonicalFinancialAssumptions not found");
  const body = fnMatch[0];
  assert.match(body, /Current customers:/);
  assert.match(body, /Year 1 customer target:.*a stated goal, not a current customer count/);
  assert.match(body, /Subscription price:/);
  assert.match(body, /Initial investment:/);
  assert.match(body, /Team size:/);
});

test("buildCanonicalFinancialAssumptions never lists Investment Needed under 'AI assumptions:' when it was user-provided (no duplication across the two sections)", () => {
  const fnMatch = /function buildCanonicalFinancialAssumptions\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildCanonicalFinancialAssumptions not found");
  assert.match(fnMatch[0], /isUserProvidedMetric\(context\.metrics\.investmentNeeded\)\s*\n\s*\?\s*\[\]/);
});

// --- 5. Financial Dashboard: benchmark estimates never presented as confirmed -

test("the Financial Dashboard's 'Live model' badge is no longer shown unconditionally -- it now reflects whether any real, confirmed figure is present", () => {
  assert.doesNotMatch(pageSource, />\s*Live model\s*</);
  assert.match(pageSource, /hasVerifiedEvidence \? "Includes confirmed figures" : "Modeled estimate"/);
});

test("the Financial Dashboard's per-card progress bar is no longer a hardcoded, metric-unrelated array -- it now tracks the metric's own real evidence tier", () => {
  assert.doesNotMatch(pageSource, /\[78, 64, 72, 58, 70, 50, 66, 62, 54, 60, 48\]/);
  assert.match(pageSource, /evidenceFillPercent: Record<EvidenceLevel, number>/);
});

// --- 6. "Low Confidence" replaced with executive language -----------------

test("localizeReportQualityLevel replaces 'Low Confidence' with executive language naming what needs validation, in both English and Turkish", () => {
  const snapshotLow = buildExecutiveSnapshot(
    "Some report text with no labeled decision or confidence.",
    undefined,
    { totalScore: 30, confidenceLevel: "Low Confidence", overallQuality: "Low Confidence", dimensions: {
      evidenceQuality: 20, sourceConfidence: 20, financialConsistency: 20, benchmarkFit: 20, validationReadiness: 20,
    } }
  );
  assert.notEqual(snapshotLow.reportQuality, "Low Confidence");
  assert.match(snapshotLow.reportQuality, /Needs Validation|Validation/i);
});

test("'High Confidence'/'Medium Confidence' wording is unchanged (only 'Low Confidence' was flagged as internal-sounding)", () => {
  const snapshotHigh = buildExecutiveSnapshot(
    "Some report text with no labeled decision or confidence.",
    undefined,
    { totalScore: 85, confidenceLevel: "High Confidence", overallQuality: "High Confidence", dimensions: {
      evidenceQuality: 85, sourceConfidence: 85, financialConsistency: 85, benchmarkFit: 85, validationReadiness: 85,
    } }
  );
  assert.equal(snapshotHigh.reportQuality, "High Confidence");
});

// --- 7. Do not change routing, acquisition logic, PDF, sanitization --------

test("acquisition report generation, calculations, and the sanitizer are untouched by this Business-Plan-only fix (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(typeof stripReportPresentationArtifacts, "function");
  assert.equal(
    classifyReportDomain("I want to acquire a cybersecurity SaaS company."),
    "acquisition"
  );
  assert.equal(
    classifyReportDomain(
      "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe."
    ),
    "business"
  );
});

test("ReportPdfButton.tsx (PDF generation) is untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  // The PDF's own "Missing Evidence" card label (a different, PDF-drawing
  // code path than Planner.tsx's live UI fix above) is deliberately left
  // exactly as it was -- PDF generation is explicitly out of scope.
  assert.match(pdfSource, /"Missing Evidence"/);
});
