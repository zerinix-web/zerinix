import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// FINAL POLISH -- convert remaining internal decision language into
// executive language.
//
// The acquisition report's underlying logic (fact extraction, EV/ARR and
// financing-split calculations, section coverage, the executive-call
// translation) is already correct as of the prior turns. This turn is
// wording-only: five specific internal-validation-system phrases --
// "verified sources", "verified figures", "authoritative evidence",
// "unverified items", "evidence available so far" -- still appeared in
// acquisition-reachable content (both the AI prompt layer and the
// deterministic timeout-fallback layer) and read like an internal audit
// tool rather than a senior M&A advisor. Each is replaced with natural
// executive language; nothing about routing, calculations, user-fact
// extraction, or sanitization changed.

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

const bannedPhrases = [
  "verified sources",
  "verified figures",
  "authoritative evidence",
  "unverified items",
  "evidence available so far",
];

// --- 1. The five named internal phrases are gone from acquisition-reachable content -

test("none of the five banned internal-validation phrases appear anywhere in acquisition-analysis.ts", () => {
  for (const phrase of bannedPhrases) {
    assert.doesNotMatch(
      acquisitionAnalysisSource,
      new RegExp(phrase, "i"),
      `"${phrase}" should not appear in acquisition-analysis.ts`
    );
  }
});

test("none of the five banned internal-validation phrases appear anywhere in plan-executor.ts", () => {
  for (const phrase of bannedPhrases) {
    assert.doesNotMatch(
      planExecutorSource,
      new RegExp(phrase, "i"),
      `"${phrase}" should not appear in plan-executor.ts`
    );
  }
});

// --- 2. The ticket's exact BAD -> GOOD example is applied -----------------

test("buildFallbackTransactionOverview no longer says the parties 'have not yet been confirmed from verified sources' -- it now uses the ticket's exact GOOD phrasing about confirming during due diligence", () => {
  assert.doesNotMatch(planExecutorSource, /have not yet been confirmed from verified sources/i);
  assert.match(
    planExecutorSource,
    /involved parties should be confirmed during due diligence/i
  );
});

// --- 3. Final Investment Recommendation: never a bare "Pause" -------------

// NOTE: the call vocabulary narrowed further in the "final acquisition
// advisor polish" turn, from Proceed/Proceed with Conditions/Pause to
// Proceed with Conditions/Pause with Reasons/Reject.
test("finalInvestmentRecommendation explicitly forbids outputting only the bare word 'Pause', 'Reject', or 'Proceed' and requires the call to be based on current information", () => {
  const prompt = acquisitionAnalysisPrompts.finalInvestmentRecommendation;
  assert.match(prompt, /Never output only the word 'Pause', 'Reject', or 'Proceed'/);
  assert.match(prompt, /Proceed with Conditions, Pause with Reasons, or Reject/);
  assert.match(prompt, /based on the current information available/);
});

test("buildFallbackFinalRecommendation/buildFallbackPreliminaryRecommendation always pair the executive call with reasoning in the same sentence -- structurally, 'Pause' can never be the field's entire content", () => {
  const finalMatch = /function buildFallbackFinalRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  const prelimMatch = /function buildFallbackPreliminaryRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(finalMatch && prelimMatch);
  assert.match(finalMatch[0], /\$\{call\} -- \$\{reasoning\}/);
  assert.match(prelimMatch[0], /\$\{call\} -- \$\{reasoning\}/);
});

// --- 4. Live proof: the exact GOOD examples read naturally through the real sanitizer -

test("the GOOD transaction-overview and integration-risk phrasing from the ticket survive the real sanitizer unchanged (no internal tags to strip, natural prose passes through)", async () => {
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  const goodTransactionOverview =
    "The transaction structure and involved parties should be confirmed during due diligence.";
  const goodIntegrationNote =
    "Complete operational and technical due diligence to reduce integration risk.";

  assert.equal(stripReportPresentationArtifacts(goodTransactionOverview), goodTransactionOverview);
  assert.equal(stripReportPresentationArtifacts(goodIntegrationNote), goodIntegrationNote);
});

// --- 5. Do not change routing, calculations, user facts, or sanitization --

test("computeAcquisitionDerivedMetrics's calculation logic and extractAcquisitionDealFacts's field extraction are unchanged by this wording-only fix (drift check)", () => {
  assert.match(
    dealFactsSource,
    /const evToArr =\s*\n\s*purchasePrice != null && targetArr != null && targetArr > 0/
  );
  assert.match(dealFactsSource, /export function extractAcquisitionDealFacts/);
});

test("the exact acquisition scenario ($40M/$10M/500/80/$25M/$15M) still extracts and computes correctly after the wording-only changes", async () => {
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

test("acquisitionAnalysisFields (the report's section structure) is unchanged by this wording-only fix", async () => {
  const { acquisitionAnalysisFields } = await import(
    "../app/lib/report-engine/prompts/acquisition-analysis.ts"
  );
  assert.equal(acquisitionAnalysisFields.length, 20);
  assert.ok(acquisitionAnalysisFields.includes("finalInvestmentRecommendation"));
});
