import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- Business Plan final quality polish.
//
// 1. Remove internal system language from user-facing Business Plan
//    output: "Evidence"/"Verified"/"Source Confidence"/"Data
//    Reliability"/"Missing Evidence" replaced with executive wording
//    ("Data Completeness", "Founder-Confirmed", "Planning Confidence",
//    "Founder Targets"/"AI Planning Scenarios", "Key Gap"). This
//    supersedes two prior tickets' own replacements ("Analysis Rigor"/
//    "Data Reliability", "No verified financial data available.") which
//    themselves still read as internal scoring language. The protected,
//    deliberate, cross-file 4-tier bare-word evidence taxonomy
//    (report-evidence.ts/financial-assumptions.ts/plan.ts, asserted by
//    tests/report-source-confidence.test.mjs) is left untouched -- only
//    the financial-dashboard-only display wrapper
//    (financialEvidenceBadgeLabels) gained a "verified" override,
//    exactly the same mechanism already used for its other tiers.
// 2. Founder-provided facts ($500/month price, $1M investment, 200
//    Year-1 customers, 12 employees) are preserved, unchanged from the
//    prior ticket's extraction/labeling work -- this ticket does not
//    touch extractUserStatedFinancials or createFinancialModel.
// 3. buildCanonicalFinancialAssumptions and
//    createSourcesAssumptionsFallback (plan-executor.ts) now group
//    content under exactly two headers -- "Founder Targets:" and "AI
//    Planning Scenarios:" -- instead of three ambiguous ones
//    ("User-provided facts:"/"Market-derived estimates:"/"AI
//    assumptions:"). Founder-stated values are never overwritten or
//    duplicated into the AI Planning Scenarios bucket.
// 4. Financial Dashboard / Unit Economics card titles no longer read a
//    bare metric name for a benchmark-derived figure -- non-founder
//    figures are prefixed ("Estimated ARR", "Planning CAC", "Scenario
//    Runway") so the card title itself, not just its badge, makes clear
//    this is a scenario/estimate rather than reported performance.
//    Applied identically in both app/dashboard/[id]/page.tsx and
//    components/Planner.tsx (the established duplicate-implementation
//    pattern this app repeats across these two files), including a
//    previously-unfixed "Live model" unconditional badge and hardcoded
//    decorative progress-bar fill in Planner.tsx's own copy of the
//    Financial Dashboard block.
// 5. createReportIntelligenceModel (report-intelligence.ts) now caps a
//    Business Plan report's confidence level at Medium/Moderate
//    Confidence whenever none of the founder-stated financial facts
//    (MRR/ARR/current customers/subscription price/investment amount)
//    are present, regardless of how high the underlying weighted score
//    is -- financial validation being limited must never be masked by a
//    high confidence label. Gated to reportKind === "business_plan" so
//    Market Analysis's confidence banding (which shares this same
//    function) is provably unaffected.
//
// Routing, acquisition logic, and PDF generation (ReportPdfButton.tsx)
// were not touched.

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

async function importReportIntelligence() {
  const sourcePath = join(repoRoot, "app/lib/ai/report-intelligence.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-confidence-quality.mjs"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-confidence-quality.mjs")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-intelligence-"));
  const outPath = join(dir, "report-intelligence.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { extractUserStatedFinancials } = await importFinancialModel();
const { getReportQualityBreakdown } = await importReportPresentation();
const { createReportIntelligenceModel } = await importReportIntelligence();

const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");

// --- 1. Internal system language removed -----------------------------------

test("getReportQualityBreakdown labels no longer read 'Evidence'/'Source Confidence'/'Data Reliability' -- now 'Data Completeness'/'Planning Confidence'", () => {
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
  for (const bannedLabel of ["Evidence Quality", "Source Confidence", "Data Reliability", "Analysis Rigor"]) {
    assert.ok(!labels.includes(bannedLabel), `should not include the literal '${bannedLabel}' label`);
  }
  assert.ok(labels.includes("Data Completeness"));
  assert.ok(labels.includes("Planning Confidence"));
});

test("the financial-dashboard-only badge wrapper renames 'Verified' to 'Founder-Confirmed' in both page.tsx and Planner.tsx, without touching the protected report-evidence.ts taxonomy", () => {
  for (const [name, source] of [["page.tsx", pageSource], ["Planner.tsx", plannerSource]]) {
    const startIndex = source.indexOf("const financialEvidenceBadgeLabels");
    assert.ok(startIndex > -1, `${name}: financialEvidenceBadgeLabels not found`);
    const block = source.slice(startIndex, startIndex + 700);
    assert.match(block, /verified:\s*\{\s*\n\s*English:\s*"Founder-Confirmed"/, `${name}: verified override missing`);
  }

  const reportEvidenceSource = readFileSync(
    new URL("../app/lib/report-evidence.ts", import.meta.url),
    "utf8"
  );
  assert.match(reportEvidenceSource, /verified:\s*"Verified"/, "protected taxonomy must be untouched");
});

test("the Financial Dashboard/Unit Economics 'No verified financial data available' banner is replaced with 'No founder-confirmed financial data available' in both files", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(source, /No verified financial data available/);
    assert.match(source, /No founder-confirmed financial data available\./g);
  }
});

test("plan-executor.ts's Sources/Assumptions fallback no longer reads 'Verified external citations'", () => {
  assert.doesNotMatch(planExecutorSource, /Verified external citations/);
  assert.match(planExecutorSource, /External citations were not returned/);
});

test("plan-executor.ts's SWOT and Founder Score emergency fallbacks no longer read 'Evidence quality'/'Missing evidence'", () => {
  assert.doesNotMatch(planExecutorSource, /Evidence quality is incomplete/);
  assert.match(planExecutorSource, /Data completeness is limited until customer and pricing proof is collected\./);
  assert.doesNotMatch(planExecutorSource, /Missing evidence lowers confidence/);
  assert.match(planExecutorSource, /Missing information lowers confidence\./);
});

// --- 2. Founder-provided facts are preserved (unchanged by this ticket) ----

test("all four of the ticket's founder-provided facts still extract correctly", () => {
  const facts = extractUserStatedFinancials(
    "We want to launch a B2B SaaS product. Our subscription price is $500/month. Year 1 target: 200 customers. We are seeking a $1M initial investment. Our team currently has 12 employees."
  );
  assert.equal(facts.pricePerCustomer, 500);
  assert.equal(facts.year1CustomerTarget, 200);
  assert.equal(facts.investmentAmount, 1_000_000);
  assert.equal(facts.employees, 12);
});

// --- 3. Financial model separation: Founder Targets vs AI Planning Scenarios

test("buildCanonicalFinancialAssumptions groups content under 'Founder Targets:' and 'AI Planning Scenarios:', not the old three-way split", () => {
  const fnMatch = /function buildCanonicalFinancialAssumptions\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildCanonicalFinancialAssumptions not found");
  const body = fnMatch[0];
  assert.match(body, /"Founder Targets:"/);
  assert.match(body, /"AI Planning Scenarios:"/);
  assert.doesNotMatch(body, /"User-provided facts:"/);
  assert.doesNotMatch(body, /"Market-derived estimates:"/);
  assert.doesNotMatch(body, /"AI assumptions:"/);
  // Founder facts are still listed, and Investment Needed is still never
  // duplicated into the AI Planning Scenarios bucket when user-provided.
  assert.match(body, /Current customers:/);
  assert.match(body, /Subscription price:/);
  assert.match(body, /Initial investment:/);
  assert.match(body, /isUserProvidedMetric\(context\.metrics\.investmentNeeded\)\s*\n\s*\?\s*\[\]/);
});

test("createSourcesAssumptionsFallback also uses 'Founder Targets:'/'AI Planning Scenarios:', consistent with the primary Financial Assumptions section", () => {
  const fnMatch = /function createSourcesAssumptionsFallback\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "createSourcesAssumptionsFallback not found");
  const body = fnMatch[0];
  assert.match(body, /Founder Targets: The business context/);
  assert.match(body, /AI Planning Scenarios: /);
  assert.doesNotMatch(body, /User-provided facts:/);
  assert.doesNotMatch(body, /AI assumptions:/);
  assert.doesNotMatch(body, /Market-derived estimates:/);
});

// --- 4. Financial Dashboard labels: Estimated/Planning/Scenario prefixes ---

test("getFinancialMetricDisplayLabel prefixes non-founder figures (Estimated for revenue/ARR/MRR, Scenario for runway/break-even, Planning otherwise) and leaves founder-confirmed figures unprefixed, identically in both files", () => {
  for (const [name, source] of [["page.tsx", pageSource], ["Planner.tsx", plannerSource]]) {
    const fnMatch = /function getFinancialMetricDisplayLabel\([\s\S]*?\n}/.exec(source);
    assert.ok(fnMatch, `${name}: getFinancialMetricDisplayLabel not found`);
    const body = fnMatch[0];
    assert.match(body, /if \(evidence === "verified"\)/);
    assert.match(body, /revenue\|\\barr\\b\|\\bmrr\\b/);
    assert.match(body, /Estimated \$\{metricLabel\}/);
    assert.match(body, /runway\|break-even\|break even/);
    assert.match(body, /Scenario \$\{metricLabel\}/);
    assert.match(body, /Planning \$\{metricLabel\}/);
  }
});

test("the Financial Dashboard and Unit Economics card titles call getFinancialMetricDisplayLabel instead of rendering the bare metric name, in both files", () => {
  assert.match(pageSource, /\{getFinancialMetricDisplayLabel\(metric, evidence\)\}/);
  assert.match(pageSource, /\{getFinancialMetricDisplayLabel\(metric\.label, evidence\)\}/);
  assert.match(plannerSource, /\{getFinancialMetricDisplayLabel\(metric, confidenceBadge\)\}/);
  assert.match(plannerSource, /\{getFinancialMetricDisplayLabel\(metric\.label, confidenceBadge\)\}/);
});

test("Planner.tsx's own copy of the Financial Dashboard 'Live model' badge is no longer shown unconditionally (previously unfixed duplicate of the page.tsx bug)", () => {
  assert.doesNotMatch(plannerSource, />\s*Live model\s*</);
  assert.match(plannerSource, /hasVerifiedEvidence \? "Includes confirmed figures" : "Modeled estimate"/);
});

test("Planner.tsx's own copy of the Financial Dashboard progress-bar fill is no longer a hardcoded, metric-unrelated array (previously unfixed duplicate of the page.tsx bug)", () => {
  assert.doesNotMatch(plannerSource, /\[78, 64, 72, 58, 70, 50, 66, 62, 54, 60, 48\]\[index\]/);
  assert.match(plannerSource, /evidenceFillPercent\[confidenceBadge\]/);
});

// --- 5. Confidence reflects available information and validation gaps -----

function makeReportIntelligenceContext({ reportKind, userProvidedFacts }) {
  return {
    reportKind,
    userProvidedFacts,
    investmentScore: {
      confidence: 90,
      recommendation: "GO",
      topRisks: [],
      categories: {
        businessModel: { score: 90, maximumScore: 100 },
        executionRisk: { score: 90, maximumScore: 100 },
      },
    },
    decisionConfidence: {
      confidenceScore: 90,
      decision: "GO",
      positiveFactors: ["Strong signal"],
      negativeFactors: [],
    },
    financialConsistency: {
      quality: "Healthy",
      sources: {
        userProvidedData: ["user supplied revenue traction"],
        aiPlanningAssumptions: [],
        benchmarkAssumptions: [],
      },
      warnings: [],
    },
    sourceIntelligence: {
      items: [
        { area: "TAM/SAM/SOM", confidence: "High Confidence", sourceType: "Market Research" },
        { area: "Competitor Insights", confidence: "High Confidence", sourceType: "Competitor Data" },
      ],
    },
    benchmarkFit: { fit: "Strong Fit", confidence: "High", validationGaps: [] },
    validationIntelligence: { score: "Validated", experiments: [] },
    metrics: {
      grossMargin: { value: 90, confidence: "High" },
      mrr: { confidence: "High" },
      arr: { confidence: "High" },
    },
    benchmark: { ranges: { grossMargin: { low: 50 } } },
  };
}

const noFounderFinancialFacts = {
  mrr: null,
  arr: null,
  customers: null,
  year1CustomerTarget: null,
  pricePerCustomer: null,
  investmentAmount: null,
  employees: null,
};
const withFounderFinancialFacts = { ...noFounderFinancialFacts, mrr: 18_000, pricePerCustomer: 500 };

test("a Business Plan report with zero founder-provided financial facts never shows High Confidence, even when the underlying weighted score would otherwise reach it", () => {
  const model = createReportIntelligenceModel(
    makeReportIntelligenceContext({ reportKind: "business_plan", userProvidedFacts: noFounderFinancialFacts })
  );
  assert.ok(model.totalScore >= 72, "test fixture should otherwise reach a High-Confidence-range score");
  assert.notEqual(model.confidenceLevel, "High Confidence");
  assert.equal(model.confidenceLevel, "Medium Confidence");
  assert.notEqual(model.overallQuality, "High Confidence");
  assert.equal(model.overallQuality, "Moderate Confidence");
});

test("a Business Plan report WITH founder-provided financial facts is not capped -- High Confidence is still reachable when it's genuinely earned", () => {
  const model = createReportIntelligenceModel(
    makeReportIntelligenceContext({ reportKind: "business_plan", userProvidedFacts: withFounderFinancialFacts })
  );
  assert.equal(model.confidenceLevel, "High Confidence");
  assert.equal(model.overallQuality, "High Confidence");
});

test("the confidence cap is gated to business_plan only -- Market Analysis's confidence banding (which shares this same function) is unaffected", () => {
  const model = createReportIntelligenceModel(
    makeReportIntelligenceContext({ reportKind: "market_analysis", userProvidedFacts: noFounderFinancialFacts })
  );
  assert.equal(model.confidenceLevel, "High Confidence");
  assert.equal(model.overallQuality, "High Confidence");
});

// --- 6. Do not change routing, acquisition logic, PDF ----------------------

test("acquisition report generation and domain routing are untouched by this Business-Plan-only fix (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
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
  assert.match(pdfSource, /"Missing Evidence"/);
});
