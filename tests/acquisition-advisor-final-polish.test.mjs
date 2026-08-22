import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// FINAL ACQUISITION ADVISOR POLISH -- convert remaining internal decision
// language into executive language, narrow the executive-call vocabulary
// one more time, and add strategic reasoning to the Executive Summary.
//
// Do not change: user facts, calculations, routing, sanitization. Only
// wording and the executive-call vocabulary/reasoning quality changed.
//
// 1. Final Recommendation: the three-tier vocabulary narrowed again, from
//    Proceed/Proceed with Conditions/Pause to Proceed with Conditions/
//    Pause with Reasons/Reject -- dropping a bare "Proceed" (every
//    proceed call must name its conditions) and giving the decision
//    engine's strongest negative signal ("Avoid") its own dedicated
//    "Reject" tier instead of folding it into the same "Pause" bucket as
//    "Wait".
// 2. Four more internal-style words/phrases -- "verified figures",
//    "authoritative evidence", the bare word "evidence", and "validation
//    required" -- are gone from acquisition-reachable customer-facing
//    content (the deterministic fallback's literal strings, and the AI
//    prompt instructions that could cause the model to echo them).
// 3. executiveAcquisitionSummary's "Main opportunity" part now weaves in
//    real strategic reasoning: sector/market fit, enterprise customer
//    base strength, recurring-revenue quality, and acquisition rationale.
// 4. The existing "never invent EBITDA/margins/growth/churn" bans are
//    confirmed still intact.

const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const dealFactsSource = readFileSync(
  new URL("../app/lib/ai/acquisition-deal-facts.ts", import.meta.url),
  "utf8"
);

const { acquisitionAnalysisPrompts } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);

// --- 1. Final Recommendation: Proceed with Conditions / Pause with Reasons / Reject -

test("describeAcquisitionExecutiveCall maps Proceed/Proceed Carefully to 'Proceed with Conditions', Wait to 'Pause with Reasons', and Avoid to its own dedicated 'Reject' tier", () => {
  const fnMatch = /function describeAcquisitionExecutiveCall\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "describeAcquisitionExecutiveCall not found");
  const body = fnMatch[0];
  assert.match(body, /if \(recommendation === "Proceed"\) return "Proceed with Conditions";/);
  assert.match(body, /if \(recommendation === "Proceed Carefully"\) return "Proceed with Conditions";/);
  assert.match(body, /if \(recommendation === "Avoid"\) return "Reject";/);
  assert.match(body, /return "Pause with Reasons";/);
});

test("finalInvestmentRecommendation requires exactly Proceed with Conditions / Pause with Reasons / Reject, each with its own named reasoning requirement, and forbids outputting only the bare call word", () => {
  const prompt = acquisitionAnalysisPrompts.finalInvestmentRecommendation;
  assert.match(prompt, /Proceed with Conditions, Pause with Reasons, or Reject/);
  assert.match(prompt, /Never output only the word 'Pause', 'Reject', or 'Proceed'/);
  assert.match(prompt, /name the specific conditions/i);
  assert.match(prompt, /name the specific reasons driving the pause/i);
  assert.match(prompt, /name the specific, material finding that makes the deal unworkable/i);
});

test("executiveAcquisitionSummary's preliminary-recommendation part uses the same three-tier vocabulary as the final call", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /Proceed with Conditions, Pause with Reasons, or Reject/);
});

test("a bare decision.recommendation is never the sole content of the preliminary/final recommendation fields -- the call is always followed by '-- ${reasoning}'", () => {
  const prelimMatch = /function buildFallbackPreliminaryRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  const finalMatch = /function buildFallbackFinalRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(prelimMatch && finalMatch);
  assert.match(prelimMatch[0], /\$\{call\} -- \$\{reasoning\}/);
  assert.match(finalMatch[0], /\$\{call\} -- \$\{reasoning\}/);
});

// --- 2. Four more internal-style phrases removed ----------------------------

const bannedPhrases = ["verified figures", "authoritative evidence"];

test("'verified figures' and 'authoritative evidence' do not appear anywhere in acquisition-analysis.ts or plan-executor.ts", () => {
  for (const phrase of bannedPhrases) {
    assert.doesNotMatch(acquisitionAnalysisSource, new RegExp(phrase, "i"), `"${phrase}" in acquisition-analysis.ts`);
    assert.doesNotMatch(planExecutorSource, new RegExp(phrase, "i"), `"${phrase}" in plan-executor.ts`);
  }
});

// "validation required" is Business Plan's own, unrelated evidence-
// classification tag (e.g. "Source type: Validation Required") -- it is
// never reachable from an acquisition report at all, so its continued
// presence elsewhere in plan-executor.ts is correct, not a miss. This
// confirms it specifically never appears in acquisition-reachable code:
// acquisition-analysis.ts's own prompts, and the acquisition timeout
// fallback's own content generators.
test("'validation required' does not appear in acquisition-analysis.ts or in createGroundedAcquisitionTimeoutFallback's own content generators", () => {
  assert.doesNotMatch(acquisitionAnalysisSource, /validation required/i);
  const fnMatch = /function createGroundedAcquisitionTimeoutFallback\([\s\S]*$/.exec(planExecutorSource);
  assert.ok(fnMatch, "createGroundedAcquisitionTimeoutFallback not found");
  assert.doesNotMatch(fnMatch[0], /validation required/i);
});

test("the bare word 'evidence' no longer appears in any of the acquisition fallback content-builder functions (customer-facing prose)", () => {
  const fnNames = [
    "buildFallbackOpportunity",
    "buildFallbackKeyRisks",
    "buildFallbackRevenueSynergies",
    "buildFallbackCostSynergies",
  ];
  for (const fnName of fnNames) {
    const fnMatch = new RegExp(`function ${fnName}\\([\\s\\S]*?\\n}`).exec(planExecutorSource);
    assert.ok(fnMatch, `${fnName} not found`);
    assert.doesNotMatch(fnMatch[0], /\bevidence\b/i, `${fnName} should not use the bare word "evidence"`);
  }
});

test("acquisitionAnalysisPrompts.dealRisks/postMergerIntegrationPlan/missingInformation no longer use the bare word 'evidence'", () => {
  assert.doesNotMatch(acquisitionAnalysisPrompts.dealRisks, /\bevidence\b/i);
  assert.doesNotMatch(acquisitionAnalysisPrompts.postMergerIntegrationPlan, /\bevidence\b/i);
  assert.doesNotMatch(acquisitionAnalysisPrompts.missingInformation, /\bevidence\b/i);
});

test("the acquisition timeout-fallback's (not the unrelated domain-analysis timeout-fallback's) 'all research complete' happy-path sentence no longer ends in 'with evidence'", () => {
  const fnMatch = /function createGroundedAcquisitionTimeoutFallback\([\s\S]*$/.exec(planExecutorSource);
  assert.ok(fnMatch, "createGroundedAcquisitionTimeoutFallback not found");
  const body = fnMatch[0];
  assert.doesNotMatch(body, /All required research tasks completed with evidence/);
  assert.match(body, /All required research tasks are complete\./);
});

// --- 3. Executive Summary: strategic reasoning ------------------------------

test("executiveAcquisitionSummary's Main opportunity part weaves in sector/market fit, enterprise customer base strength, recurring-revenue quality, and acquisition rationale", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /sector\/market fit/i);
  assert.match(prompt, /AI or cybersecurity target/i);
  assert.match(prompt, /strength of the target's enterprise customer base/i);
  assert.match(prompt, /quality of its recurring revenue/i);
  assert.match(prompt, /acquisition rationale/i);
});

test("the new Main opportunity strategic-reasoning language still forbids inventing a churn or retention rate", () => {
  const prompt = acquisitionAnalysisPrompts.executiveAcquisitionSummary;
  assert.match(prompt, /without inventing a churn or retention rate that was not provided/i);
});

// --- 4. Keep uncertainty honest: EBITDA/churn/growth/margins bans intact ---

test("the 'never invent EBITDA, margins, growth rates, churn, or cash flow' ban is still present and unweakened", () => {
  assert.match(
    acquisitionAnalysisSource,
    /Do not invent EBITDA, margins, growth rates, churn, or cash flow figures/
  );
});

// --- 5. Do not change user facts, calculations, routing, sanitization ------

test("the exact acquisition scenario still extracts and computes correctly (user facts and calculations untouched)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const scenarioPrompt = [
    "Purchase price: $40M",
    "ARR: $10M",
    "Enterprise customers: 500",
    "Employees: 80",
    "Buyer available capital: $25M",
    "Debt financing: $15M",
  ].join("\n");
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(facts.enterpriseCustomers, 500);
  assert.equal(facts.employees, 80);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.match(dealFactsSource, /export function computeAcquisitionDerivedMetrics/);
});

test("report-presentation-sanitizer.ts and domain routing are untouched by this fix (drift check)", async () => {
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
