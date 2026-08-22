import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// FINAL ACQUISITION INTELLIGENCE POLISH -- improve the remaining weak
// acquisition sections without touching routing, sanitization, report
// structure, or calculations.
//
// This turn's changes:
// 1. Strategic Fit's deterministic fallback now reasons from whichever
//    single fact IS available (ARR alone, or customer count alone), not
//    just the "both together" case -- it no longer bails out to a bare
//    "cannot be produced yet" whenever only one figure is known.
// 2. Revenue Synergies / Cost Synergies (both the AI prompt and the
//    deterministic fallback) now cover the exact required themes --
//    cross-sell opportunities / customer expansion / product portfolio
//    fit for revenue; infrastructure consolidation / operational
//    efficiency / procurement leverage for cost -- and never invent a
//    dollar figure.
// 3. The Final Recommendation vocabulary changed from Proceed/Wait/Reject
//    to Proceed/Proceed with Conditions/Pause, applied consistently across
//    the AI prompt (finalInvestmentRecommendation, and
//    executiveAcquisitionSummary's own preliminary-recommendation part)
//    and the deterministic fallback (buildFallbackPreliminaryRecommendation/
//    buildFallbackFinalRecommendation, via describeAcquisitionExecutiveCall).
// 4. The three named internal-sounding phrases -- "authoritative evidence",
//    "critical evidence gaps", "evidence-based risk assessment" -- are gone
//    from every acquisition-reachable content generator, replaced with
//    natural executive language.

const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const decisionEngineSource = readFileSync(
  new URL("../app/lib/decision-intelligence/decision-engine.ts", import.meta.url),
  "utf8"
);

const { acquisitionAnalysisPrompts } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);

// --- 1. Strategic Fit: reason from partial facts, never just bail out -----

test("buildFallbackStrategicFit's derived-insight branch reasons from ARR alone or customer count alone, not just 'both together or nothing'", () => {
  const fnMatch = /function buildFallbackStrategicFit\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackStrategicFit not found");
  const body = fnMatch[0];
  assert.match(body, /already generates recurring revenue at a scale worth strategic evaluation/);
  assert.match(body, /points to an established go-to-market motion worth building on/);
});

// --- 2. Revenue Synergies / Cost Synergies: required themes, no invented numbers -

test("acquisitionAnalysisPrompts.revenueSynergies covers cross-sell opportunities, customer expansion, and product portfolio fit, and forbids inventing revenue numbers", () => {
  const prompt = acquisitionAnalysisPrompts.revenueSynergies;
  assert.match(prompt, /cross-sell opportunities/i);
  assert.match(prompt, /customer expansion/i);
  assert.match(prompt, /product portfolio fit/i);
  assert.match(prompt, /do not invent revenue numbers/i);
});

test("acquisitionAnalysisPrompts.costSynergies covers infrastructure consolidation, operational efficiency, and procurement leverage, and forbids inventing savings amounts", () => {
  const prompt = acquisitionAnalysisPrompts.costSynergies;
  assert.match(prompt, /infrastructure consolidation/i);
  assert.match(prompt, /operational efficiency/i);
  assert.match(prompt, /procurement leverage/i);
  assert.match(prompt, /do not invent savings amounts/i);
});

test("buildFallbackRevenueSynergies/buildFallbackCostSynergies are wired into the report's return object, replacing the old bare decision.opportunities-or-boilerplate pattern", () => {
  assert.match(planExecutorSource, /revenueSynergies: buildFallbackRevenueSynergies\(facts, decision, isTurkish\),/);
  assert.match(planExecutorSource, /costSynergies: buildFallbackCostSynergies\(facts, decision, isTurkish\),/);
  assert.doesNotMatch(planExecutorSource, /revenueSynergies: decision\.opportunities\.length/);
  assert.doesNotMatch(planExecutorSource, /costSynergies: decision\.opportunities\.length/);
});

test("buildFallbackRevenueSynergies/buildFallbackCostSynergies never construct a dollar-figure string -- no $ interpolation of an invented number, only formatUsdCompact of already-verified facts", () => {
  const revenueMatch = /function buildFallbackRevenueSynergies\([\s\S]*?\n}/.exec(planExecutorSource);
  const costMatch = /function buildFallbackCostSynergies\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(revenueMatch && costMatch);
  for (const body of [revenueMatch[0], costMatch[0]]) {
    const dollarLiterals = body.match(/\$\d/g) || [];
    assert.deepEqual(dollarLiterals, [], "no literal dollar figure should be hardcoded");
  }
});

// --- 3. Final Recommendation vocabulary: Proceed with Conditions / Pause with Reasons / Reject -
// NOTE: superseded by the "final acquisition advisor polish" turn -- see
// tests/acquisition-executive-language-final-polish.test.mjs for the
// full rationale. The call vocabulary narrowed again, dropping a bare
// "Proceed" and reintroducing a dedicated "Reject" tier.

test("finalInvestmentRecommendation requires the Proceed with Conditions / Pause with Reasons / Reject vocabulary, and explicitly forbids the bare 'Preliminary recommendation: Wait' pattern", () => {
  const prompt = acquisitionAnalysisPrompts.finalInvestmentRecommendation;
  assert.match(prompt, /Proceed with Conditions, Pause with Reasons, or Reject/);
  assert.match(prompt, /never a bare 'Preliminary recommendation: Wait'/);
});

test("executiveAcquisitionSummary's own preliminary-recommendation part uses the same Proceed with Conditions / Pause with Reasons / Reject vocabulary as the final call", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /Proceed with Conditions, Pause with Reasons, or Reject/);
  assert.match(prompt, /matching the same vocabulary used in the Final Investment Recommendation/);
});

// NOTE: superseded by the "final acquisition advisor polish" turn -- see
// tests/acquisition-executive-language-final-polish.test.mjs.
test("describeAcquisitionExecutiveCall translates every decision-engine recommendation value into the report's three-tier vocabulary", () => {
  const fnMatch = /function describeAcquisitionExecutiveCall\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "describeAcquisitionExecutiveCall not found");
  const body = fnMatch[0];
  assert.match(body, /recommendation === "Proceed"/);
  assert.match(body, /recommendation === "Proceed Carefully"/);
  assert.match(body, /recommendation === "Avoid"/);
  assert.match(body, /"Proceed with Conditions"/);
  assert.match(body, /return "Reject"/);
  assert.match(body, /return "Pause with Reasons"/);
});

// --- 4. Remove remaining internal wording -----------------------------------

test("'authoritative evidence' no longer appears anywhere in plan-executor.ts or decision-engine.ts's generic nextActionFor default", () => {
  assert.doesNotMatch(planExecutorSource, /authoritative evidence/i);
  assert.doesNotMatch(decisionEngineSource, /Obtain the authoritative evidence required/);
});

test("'critical evidence gaps' no longer appears anywhere in customer-facing content generators in plan-executor.ts", () => {
  const reasoningMatch = /function buildFallbackRecommendationReasoning\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(reasoningMatch);
  assert.doesNotMatch(reasoningMatch[0], /critical evidence gaps/i);
  const prelimMatch = /function buildFallbackPreliminaryRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(prelimMatch);
  assert.doesNotMatch(prelimMatch[0], /critical evidence gaps/i);
});

test("'evidence-based risk assessment' no longer appears anywhere in buildFallbackIntegrationRisks", () => {
  const fnMatch = /function buildFallbackIntegrationRisks\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /evidence-based risk assessment/i);
  assert.match(fnMatch[0], /also stand out in this review/i);
});

// --- 5. Do not touch routing, sanitization, report structure, calculations -

test("acquisition-deal-facts.ts's calculation functions (EV/ARR, equity/debt split) are untouched by this fix", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const scenarioPrompt =
    "Purchase price is $40M, target ARR is $10M, buyer available capital is $25M, remaining financing is debt.";
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
});

test("acquisitionAnalysisFields (the report's field/section structure) is unchanged by this fix", async () => {
  const { acquisitionAnalysisFields } = await import(
    "../app/lib/report-engine/prompts/acquisition-analysis.ts"
  );
  assert.deepEqual(acquisitionAnalysisFields, [
    "executiveAcquisitionSummary",
    "targetCompanyOverview",
    "externalEvidence",
    "strategicFit",
    "valuationAnalysis",
    "financingStructure",
    "debtCapacity",
    "roiAnalysis",
    "irrAnalysis",
    "revenueSynergies",
    "costSynergies",
    "integrationRisks",
    "operationalRisks",
    "regulatoryReview",
    "competitivePosition",
    "dealRisks",
    "postMergerIntegrationPlan",
    "missingInformation",
    "finalInvestmentRecommendation",
    "sources",
  ]);
});

test("report-presentation-sanitizer.ts and domain routing are untouched (drift check)", async () => {
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(typeof stripReportPresentationArtifacts, "function");
  assert.equal(
    classifyReportDomain("We are acquiring a cybersecurity SaaS company for $40M."),
    "acquisition"
  );
});
