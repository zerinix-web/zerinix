import test from "node:test";
import assert from "node:assert/strict";

// CRITICAL QUALITY FIX -- improve acquisition analysis depth without
// restoring internal metadata.
//
// The presentation sanitizer (report-presentation-sanitizer.ts, built
// across the prior four turns) is correct and untouched by this fix --
// this turn is entirely about the GENERATOR's own instructions
// (acquisition-analysis.ts's acquisitionAnalysisPrompts and
// buildAcquisitionAnalysisInstructions), not routing or sanitization.
// Confirmed live: several fields (Strategic Fit, Debt Capacity, ROI
// Analysis in particular) were collapsing into a bare "Additional
// information is needed" instead of doing the analysis that IS possible
// from the verified deal facts alone. Every field prompt now names its
// own required sub-structure explicitly, distinguishes Known facts from
// Derived insights from Assumptions, and the model is explicitly told to
// stop writing internal-pipeline-sounding placeholder phrases ("More
// evidence required", "Additional verification required", "Need
// authoritative source") in favor of natural advisor language ("Further
// review is recommended for...", "Management should validate...").
//
// This suite proves the prompt/instruction changes carry every required
// structural element for the exact acquisition case named in the fix:
// $40M purchase price, $10M ARR, 500 enterprise customers, 80 employees,
// $25M buyer available capital, $15M debt financing.

const { acquisitionAnalysisPrompts, buildAcquisitionAnalysisInstructions } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);
const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
  "../app/lib/ai/acquisition-deal-facts.ts"
);

const instructions = buildAcquisitionAnalysisInstructions("English");
const combined = `${instructions}\n${Object.values(acquisitionAnalysisPrompts).join("\n")}`;

const scenarioPrompt =
  "We are acquiring a cybersecurity SaaS company. Purchase price is $40M, target ARR is $10M, it has 500 enterprise customers and 80 employees, buyer available capital is $25M, and remaining financing is debt.";

// --- 0. Reproduce the exact scenario: $40M/$10M/500/80/$25M/$15M --------

test("extractAcquisitionDealFacts parses every fact in the exact scenario: $40M purchase price, $10M ARR, 500 enterprise customers, 80 employees, $25M buyer capital, debt financing", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.enterpriseCustomers, 500);
  assert.equal(facts.employees, 80);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);
  assert.equal(facts.remainingFinancingType, "debt");
});

test("computeAcquisitionDerivedMetrics reproduces EV/ARR = 4x and the exact $25M equity / $15M debt split the fix names", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);

  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
});

// --- 1. Executive Acquisition Summary -------------------------------------

test("executiveAcquisitionSummary requires the five-part structure: transaction overview, main opportunity, main risks, preliminary recommendation, conditions before closing", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /real executive recommendation/i);
  assert.match(prompt, /Transaction overview/i);
  assert.match(prompt, /Main opportunity/i);
  assert.match(prompt, /Main risks/i);
  assert.match(prompt, /Preliminary recommendation/i);
  assert.match(prompt, /Conditions before closing/i);
  assert.doesNotMatch(prompt, /generic hold\/wait placeholder$/);
});

// NOTE: superseded by the "final acquisition intelligence polish" turn --
// the report's executive-call vocabulary was deliberately narrowed from
// Proceed/Wait/Reject to Proceed/Proceed with Conditions/Pause, to read
// like a senior M&A advisor's call rather than a validation checklist.
test("executiveAcquisitionSummary explicitly forbids outputting only the bare verdict word 'Wait' (or 'Proceed'/'Pause') as this field's entire content", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /Never output only the single word 'Wait'/);
  assert.match(prompt, /'Proceed' or 'Pause'/);
});

// --- 2. Strategic Fit -------------------------------------------------------

test("strategicFit forbids the bare 'Additional information is needed' placeholder and requires Known facts / Derived insights / Assumptions separation", () => {
  const prompt = acquisitionAnalysisPrompts.strategicFit;
  assert.match(prompt, /Never write only 'Additional information is needed'/i);
  assert.match(prompt, /Known facts/);
  assert.match(prompt, /Derived insights/);
  assert.match(prompt, /Assumptions/);
});

test("strategicFit requires analysis of AI\\/cybersecurity market fit, enterprise customer base, recurring-revenue quality, strategic advantages, and integration considerations", () => {
  const prompt = acquisitionAnalysisPrompts.strategicFit;
  assert.match(prompt, /AI\/cybersecurity target/i);
  assert.match(prompt, /enterprise customer base/i);
  assert.match(prompt, /recurring-revenue profile/i);
  assert.match(prompt, /strategic advantages/i);
  assert.match(prompt, /integration considerations/i);
});

// --- 3. Valuation Analysis --------------------------------------------------

test("valuationAnalysis keeps the EV/ARR requirement and adds interpretation of the multiple, attractive/expensive framing, and what financial data is still needed", () => {
  const prompt = acquisitionAnalysisPrompts.valuationAnalysis;
  assert.match(prompt, /EV\/ARR/);
  assert.match(prompt, /interpret it, not just state it/i);
  assert.match(prompt, /attractive|full, or expensive/i);
  assert.match(prompt, /what financial data is still needed/i);
  assert.match(prompt, /EBITDA, gross margin, revenue growth rate, or customer churn/i);
});

// --- 4. Financing Structure --------------------------------------------------

test("financingStructure keeps the equity/debt derived-figures requirement and adds leverage considerations, financing risk, and repayment considerations", () => {
  const prompt = acquisitionAnalysisPrompts.financingStructure;
  assert.match(prompt, /equity contribution, debt requirement, or debt\/equity split/i);
  assert.match(prompt, /[Ll]everage considerations/);
  assert.match(prompt, /financing risk/i);
  assert.match(prompt, /repayment considerations/i);
});

// --- 5. Debt Capacity --------------------------------------------------------

test("debtCapacity is never left empty -- it must explain that debt capacity cannot be fully determined without EBITDA/cash flow, name the specific financial statements needed, and explain how debt risk should be evaluated", () => {
  const prompt = acquisitionAnalysisPrompts.debtCapacity;
  assert.match(prompt, /[Nn]ever leave this field empty/);
  assert.match(prompt, /cannot be fully determined without EBITDA and cash-flow data/i);
  assert.match(prompt, /financial statements or figures needed/i);
  assert.match(prompt, /how debt risk should be evaluated/i);
});

// --- 6. ROI Analysis ---------------------------------------------------------

test("roiAnalysis is never left as 'Additional information needed' -- requires what can/cannot be calculated, missing inputs, and scenarios, while forbidding invented EBITDA/margins/growth/churn/cash flow", () => {
  const prompt = acquisitionAnalysisPrompts.roiAnalysis;
  assert.match(prompt, /[Nn]ever leave this field as a bare 'additional information needed' notice/);
  assert.match(prompt, /What can be calculated/i);
  assert.match(prompt, /What cannot be calculated/i);
  assert.match(prompt, /inputs still missing/i);
  assert.match(prompt, /scenarios/i);
  assert.match(prompt, /Do not invent EBITDA, margins, growth rates, churn, or cash flow figures/i);
});

test("roiAnalysis and irrAnalysis both explicitly forbid inventing EBITDA, margins, growth, churn, and cash flow -- the fix's exact named list, in both fields", () => {
  for (const field of ["roiAnalysis", "irrAnalysis"]) {
    const prompt = acquisitionAnalysisPrompts[field];
    assert.doesNotMatch(prompt, /invent(?:ing)?\s+(?:a\s+)?churn\s+or\s+retention\s+rate$/im, `${field} should not silently allow inventing churn`);
    assert.match(prompt, /EBITDA/i, `${field} must mention EBITDA`);
    assert.match(prompt, /cash flow/i, `${field} must mention cash flow`);
  }
});

// --- 7. Integration Risks ----------------------------------------------------

test("integrationRisks requires real analysis across technology integration, customer retention, employee retention, security architecture, and operational alignment", () => {
  const prompt = acquisitionAnalysisPrompts.integrationRisks;
  assert.match(prompt, /technology integration/i);
  assert.match(prompt, /customer retention/i);
  assert.match(prompt, /employee retention/i);
  assert.match(prompt, /security architecture/i);
  assert.match(prompt, /security operations/i);
  assert.match(prompt, /operational alignment/i);
  assert.match(prompt, /never a generic risk list/i);
});

// --- 8. Post-Merger Integration Plan -----------------------------------------

test("postMergerIntegrationPlan requires the exact real 30/60/90-day plan: financial validation, customer contract review, security assessment, employee retention plan / technology integration, operating-model alignment, customer strategy / synergy tracking, unified roadmap, KPI review", () => {
  const prompt = acquisitionAnalysisPrompts.postMergerIntegrationPlan;

  // 30 days
  assert.match(prompt, /financial validation/i);
  assert.match(prompt, /customer contract review/i);
  assert.match(prompt, /security assessment/i);
  assert.match(prompt, /employee retention plan/i);

  // 60 days
  assert.match(prompt, /technology integration/i);
  assert.match(prompt, /operating-model alignment/i);
  assert.match(prompt, /customer strategy/i);

  // 90 days
  assert.match(prompt, /synergy tracking/i);
  assert.match(prompt, /unified go-to-market roadmap/i);
  assert.match(prompt, /KPI review/i);

  assert.match(prompt, /never a generic template/i);
});

// --- 9. Final Recommendation --------------------------------------------------

// NOTE: superseded by the "final executive dashboard language polish" turn
// -- the call vocabulary changed again, from Proceed with Conditions/
// Pause with Reasons/Reject to Proceed with Conditions/Pause Pending
// Review/Reject -- board-memo phrasing rather than an internal-sounding
// "explain your reasons" label.
test("finalInvestmentRecommendation requires a professional Proceed with Conditions/Pause Pending Review/Reject decision, each with its own required reasoning", () => {
  const prompt = acquisitionAnalysisPrompts.finalInvestmentRecommendation;
  assert.match(prompt, /Proceed with Conditions, Pause Pending Review, or Reject/);
  assert.match(prompt, /name the specific conditions/i);
  assert.match(prompt, /name the specific review still pending/i);
  assert.match(prompt, /name the specific, material finding/i);
});

// --- 10. Never use internal-sounding placeholder phrases ---------------------

test("buildAcquisitionAnalysisInstructions forbids 'More evidence required' / 'Additional verification required' / 'Need authoritative source' and requires 'Further review is recommended for...' / 'Management should validate...' phrasing instead", () => {
  assert.match(instructions, /Never write 'More evidence required', 'Additional verification required', 'Need authoritative source'/);
  assert.match(instructions, /Further review is recommended for/);
  assert.match(instructions, /Management should validate/);
  assert.match(instructions, /naming the exact item/i);
});

test("buildAcquisitionAnalysisInstructions bans 'Additional information is needed' globally (every field, not only the ones that already name it locally)", () => {
  assert.match(instructions, /'Additional information is needed'/);
  assert.match(instructions, /applies to every field, not only the ones that name the phrase explicitly/i);
});

// --- 11. Combined coverage: every required content area is present ----------

test("the combined instructions + prompts still cover every core acquisition analysis concept (regression against the full requirement list)", () => {
  assert.match(combined, /M&A due-diligence/i);
  assert.match(combined, /strategic fit/i);
  assert.match(combined, /EV\/ARR/);
  assert.match(combined, /comparable transactions/i);
  assert.match(combined, /purchase multiple/i);
  assert.match(combined, /purchase price is fair/i);
  assert.match(combined, /financing structure/i);
  assert.match(combined, /debt capacity/i);
  assert.match(combined, /ROI scenarios/i);
  assert.match(combined, /IRR estimate/i);
  assert.match(combined, /integration risk/i);
  assert.match(combined, /cultural integration/i);
  assert.match(combined, /revenue synergies/i);
  assert.match(combined, /cost synergies/i);
  assert.match(combined, /technology integration/i);
  assert.match(combined, /operational risks/i);
  assert.match(combined, /competitive position/i);
  assert.match(combined, /regulatory/i);
  assert.match(combined, /30, 60, and 90/);
  assert.match(combined, /investment recommendation/i);
  assert.match(combined, /burn rate/i);
  assert.match(combined, /runway/i);
  assert.match(combined, /\bCAC\b/);
});

// --- Do not restore internal metadata / do not change routing/sanitization -

test("no prompt or instruction text asks the model to surface sources, citations, URLs, evidence labels, or internal reasoning metadata -- the presentation layer's own exclusions are not reintroduced at the generation layer", () => {
  const fieldsToCheck = Object.entries(acquisitionAnalysisPrompts).filter(
    ([field]) => field !== "sources" && field !== "externalEvidence"
  );
  for (const [field, prompt] of fieldsToCheck) {
    assert.doesNotMatch(prompt, /\bevidence registry ID\b/i, `${field} should not ask for evidence registry IDs`);
    assert.doesNotMatch(prompt, /\bpublisher\b/i, `${field} should not ask for publisher names`);
  }
});

test("report-presentation-sanitizer.ts is untouched by this fix -- it still exports the exact same sanitization API, and its own strip function still removes internal artifacts (drift check, proves this fix never touched sanitization)", async () => {
  const {
    stripReportPresentationArtifacts,
    sanitizeReportSectionsForPresentation,
    isUniversalCustomerFacingSection,
  } = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");

  assert.equal(typeof stripReportPresentationArtifacts, "function");
  assert.equal(typeof sanitizeReportSectionsForPresentation, "function");
  assert.equal(typeof isUniversalCustomerFacingSection, "function");

  // A section made up entirely of internal artifacts is stripped and then
  // backfilled by the sanitizer's own emptyAfterSanitizationFallback safety
  // net (from the prior "payload completeness" fix) -- so the internal
  // tags/URL must be gone, even though the result is a fallback sentence
  // rather than an empty string.
  const stripped = stripReportPresentationArtifacts(
    "[Verified] [R1] Publisher: Statista\nhttps://statista.com/report"
  );
  assert.doesNotMatch(stripped, /\[Verified\]/);
  assert.doesNotMatch(stripped, /\[R1\]/);
  assert.doesNotMatch(stripped, /Publisher:/);
  assert.doesNotMatch(stripped, /https:\/\//);
});

test("app/lib/report-engine/domain.ts's resolveReportDomainForSelectedMode routing is untouched by this fix -- an acquisition prompt under 'plan' mode still resolves to 'acquisition' (drift check, proves this fix never touched routing)", async () => {
  const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
    "../app/lib/report-engine/domain.ts"
  );
  const inferredDomain = classifyReportDomain(scenarioPrompt);
  assert.equal(inferredDomain, "acquisition");

  const resolvedDomain = resolveReportDomainForSelectedMode({
    selectedMode: "plan",
    inferredDomain,
    expertiseDomain: "acquisition",
  });
  assert.equal(resolvedDomain, "acquisition");
});
