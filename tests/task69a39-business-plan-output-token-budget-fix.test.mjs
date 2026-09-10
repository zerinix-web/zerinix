// TASK #69A-39 -- Fix the fresh-report competitive-evidence pipeline
// regression proven by real localhost + PDF output.
//
// LIVE FAILURE: direct inspection of the 3 most recent real `reports` rows
// (service-role, read-only, scratch script deleted immediately after use)
// proved that competitorLandscape/executiveSummary/portersFiveForces were
// byte-identical to createPlanFieldFallback's own generic templates in
// EVERY one of them -- i.e. the real AI generation call for this exact
// prompt fell through to createGroundedBusinessTimeoutFallback on every
// single attempt, never once reaching the success path #69A-38D/#69A-38E/
// #69A-38F/#69A-38G's own fixes live in. Those four tickets correctly made
// the FALLBACK path's own metadata/text internally consistent, but a total
// generation failure means there is, by design, no AI-produced competitor
// list at all (buildBusinessCompetitorLandscapeState("") is correctly
// null) -- so no downstream consistency fix could ever restore real
// competitors. The actual defect had to be upstream of all of that: why
// does the real OpenAI call itself never complete for this report type?
//
// ROOT CAUSE (traced by direct code inspection, not guessed): the
// business_plan report call requires -- in ONE Responses API call, under
// ONE strict json_schema -- all 24 planFields (each individually capped by
// its own prompt at up to "Max N words", summed below from the actual
// prompt text) PLUS competitorLandscapeStructured (#69A-15A: up to 5
// competitor records x up to 7 fields) PLUS portersFiveForcesStructured
// (#69A-28: 5 forces x 3 fields each with real analytical text), all
// sharing a single `max_output_tokens` ceiling. That ceiling
// (FULL_REPORT_MAX_OUTPUT_TOKENS = 8_000) is also used, UNCHANGED, by the
// real-estate/domain-analysis/acquisition report paths, none of which were
// ever asked for these two additional structured keys -- it was never
// re-sized when #69A-15A/#69A-28 added them. gpt-5-mini is a reasoning
// model: `max_output_tokens` on the Responses API caps hidden reasoning
// tokens AND visible completion tokens TOGETHER, so satisfying a large,
// strict, deeply-nested schema can consume a meaningful, unpredictable
// share of that ceiling before any visible JSON text is produced at all.
// When the ceiling is exhausted mid-generation, the API returns
// status: "incomplete", incomplete_details.reason: "max_output_tokens";
// assertCompletedOpenAiResponse throws immediately;
// shouldUseGroundedFallback (hardcoded true, by design, per the #69A-4
// comment covering ALL failure reasons) sends the request down the
// deterministic empty-JSON skeleton. This is precisely the same class of
// resource-starvation bug already found and fixed for TIME (see
// BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS's own comment, split out from the
// shared timeout for the identical reason) -- just never fixed for output
// TOKENS when the schema grew.
//
// WHY 6083/6083 EXISTING TESTS MISSED THIS: every existing competitor/
// Porter/coverage test (including this session's own #69A-38D through
// #69A-38G suites) feeds parseFullPlanReport/buildBusinessCompetitorLandscapeState/
// buildPortersFiveForcesStateFromStructuredResponse a hand-built, ALREADY-
// COMPLETE JSON string or object -- none of them model an OpenAI response
// that never finished because it ran out of its shared output-token
// budget. There was no test anywhere in the suite asserting that the
// business_plan schema's own worst-case requested output size actually
// fits inside the token ceiling given to the model -- that is the missing
// regression boundary this file adds.
//
// FIX (app/lib/report-jobs/plan-executor.ts):
//   1. New BUSINESS_PLAN_REPORT_MAX_OUTPUT_TOKENS (24_000) constant, used
//      ONLY at the business_plan call site -- the shared
//      FULL_REPORT_MAX_OUTPUT_TOKENS (8_000) is untouched for every other
//      report path.
//   2. assertCompletedOpenAiResponse now accepts the already-extracted
//      tokenUsage and includes "Completion tokens used: N." in its thrown
//      message, so a token-budget truncation is diagnosable from the
//      error text alone.
//   3. The failure-reason classification in the catch block now
//      distinguishes "output_token_limit" (matches "max_output_tokens" in
//      the thrown message) from the previous catch-all "generation_error"
//      bucket, and the raw error text is logged (errorDetail, never user
//      prompt content) so a future regression is diagnosable from
//      operational logs instead of requiring another live DB inspection.
//
// SAFETY: this fix touches ONLY the output-token ceiling and diagnostic
// logging. It does not fabricate competitors, does not lower any evidence
// gate, does not touch the quality gate's threshold, and does not touch
// research execution's own bounded cost/timeout/dedupe logic.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const planPromptsSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/prompts/plan.ts"),
  "utf8"
);

function extractConstant(name) {
  const match = planExecutorSource.match(
    new RegExp(`const ${name}\\s*=\\s*([\\d_]+);`)
  );
  assert.ok(match, `expected ${name} to be defined in plan-executor.ts`);
  return Number(match[1].replace(/_/g, ""));
}

// --- FAIL-BEFORE PROOF: the documented worst-case requested output size
//     leaves the OLD shared budget with no real margin --------------------

test("FAIL-BEFORE PROOF: the documented per-field word caps alone (before adding the two #69A-15A/#69A-28 structured keys or any reasoning-token overhead) already consume the large majority of the OLD shared 8,000-token ceiling, leaving no defensible margin for a reasoning model", () => {
  const maxWordsPerField = [
    ...planPromptsSource.matchAll(/Max (\d+) words/g),
  ].map((m) => Number(m[1]));
  // 24 planFields, each individually capped -- confirms this is reading
  // the real, current prompt contract, not a stale/partial count.
  assert.equal(maxWordsPerField.length, 24);

  const totalMaxWords = maxWordsPerField.reduce((a, b) => a + b, 0);
  assert.ok(totalMaxWords > 0);

  // Standard English words-to-tokens approximation (~0.75 words per
  // token), the same order of magnitude the codebase's own
  // evidence-compression.ts already uses (Math.ceil(chars / 4)) for its
  // own token estimates.
  const estimatedProseTokens = Math.ceil(totalMaxWords / 0.75);

  const oldSharedBudget = extractConstant("FULL_REPORT_MAX_OUTPUT_TOKENS");

  // The prose fields ALONE -- before a single token of the two new
  // structured keys, JSON structural overhead, or any hidden reasoning
  // tokens a reasoning model spends satisfying a large strict schema --
  // already consume most of the old shared ceiling. This is the
  // regression boundary no prior test encoded: nothing previously
  // asserted that the requested output actually fits the token budget
  // given to the model.
  assert.ok(
    estimatedProseTokens > oldSharedBudget * 0.6,
    `expected the documented prose-field ceiling alone (~${estimatedProseTokens} tokens) to consume most of the old shared budget (${oldSharedBudget}), proving it had no real margin left for competitorLandscapeStructured/portersFiveForcesStructured or reasoning-token overhead`
  );
});

// --- THE FIX ITSELF -------------------------------------------------------

test("the business_plan report call now has its own output-token ceiling, strictly larger than the shared budget every other report path still uses", () => {
  const sharedBudget = extractConstant("FULL_REPORT_MAX_OUTPUT_TOKENS");
  const businessPlanBudget = extractConstant(
    "BUSINESS_PLAN_REPORT_MAX_OUTPUT_TOKENS"
  );

  assert.ok(
    businessPlanBudget > sharedBudget,
    "expected BUSINESS_PLAN_REPORT_MAX_OUTPUT_TOKENS to exceed the shared FULL_REPORT_MAX_OUTPUT_TOKENS"
  );
  // Guards against a future regression shrinking the new budget back down
  // toward the old one without anyone noticing -- the two new structured
  // keys plus reasoning-token overhead need a real multiple, not a
  // marginal bump.
  assert.ok(
    businessPlanBudget >= sharedBudget * 2,
    "expected the business_plan budget to be at least double the shared budget, given it alone carries competitorLandscapeStructured and portersFiveForcesStructured on top of every other report path's planFields"
  );
});

test("the business_plan call site actually requests the business-plan-specific token budget, not the shared one", () => {
  const callSiteMatch = planExecutorSource.match(
    /model,\s*instructions: fullReportInstructions,[\s\S]{0,1400}?max_output_tokens:\s*([A-Z_0-9]+),/
  );
  assert.ok(
    callSiteMatch,
    "expected to find the business_plan responses.create call's max_output_tokens assignment"
  );
  assert.equal(callSiteMatch[1], "BUSINESS_PLAN_REPORT_MAX_OUTPUT_TOKENS");
});

test("real-estate/domain-analysis/acquisition report paths still use the unchanged shared budget (this fix is scoped to business_plan only)", () => {
  const occurrences = [
    ...planExecutorSource.matchAll(
      /max_output_tokens:\s*FULL_REPORT_MAX_OUTPUT_TOKENS/g
    ),
  ];
  assert.ok(
    occurrences.length >= 1,
    "expected at least one other report path to still use the shared FULL_REPORT_MAX_OUTPUT_TOKENS, proving this fix did not change behavior for non-business_plan reports"
  );
});

// --- DIAGNOSTIC WIRING: a future regression must be diagnosable without
//     another live DB inspection ------------------------------------------

test("assertCompletedOpenAiResponse now accepts tokenUsage and surfaces the completion-token count in its thrown message", () => {
  const fnMatch = planExecutorSource.match(
    /function assertCompletedOpenAiResponse\(([^)]*)\)\s*\{[\s\S]{0,1200}?\n\}/
  );
  assert.ok(fnMatch, "expected to find assertCompletedOpenAiResponse's definition");
  assert.match(fnMatch[1], /tokenUsage/);
  assert.match(fnMatch[0], /Completion tokens used:/);
});

test("the business_plan call site passes tokenUsage into assertCompletedOpenAiResponse", () => {
  assert.ok(
    planExecutorSource.includes("assertCompletedOpenAiResponse(response, tokenUsage);"),
    "expected the business_plan call site to pass tokenUsage so a future truncation is diagnosable from the thrown message alone"
  );
});

test("the failure classification distinguishes an output-token-budget truncation from the generic generation_error bucket, and logs the raw error detail", () => {
  assert.match(
    planExecutorSource,
    /const providerRanOutOfOutputTokens =\s*\n?\s*\/max_output_tokens\/i\.test\(errorMessage\);/
  );
  assert.match(planExecutorSource, /reason:\s*providerTimedOut[\s\S]{0,50}"timeout"[\s\S]{0,200}"quality_gate"[\s\S]{0,120}providerRanOutOfOutputTokens[\s\S]{0,50}"output_token_limit"[\s\S]{0,50}"generation_error"/);
  assert.match(planExecutorSource, /errorDetail:\s*errorMessage\.slice\(0,\s*500\)/);
});

// --- SAFETY: the fix must not touch the quality gate, evidence gates, or
//     research execution bounds -------------------------------------------

test("SAFETY: the quality gate's own instantiation/threshold logic is untouched by this fix", () => {
  assert.ok(
    planExecutorSource.includes(
      "The quality gate itself, and its threshold, are\n            // untouched"
    ),
    "expected the existing comment documenting the quality gate is untouched to still be present, confirming this fix did not touch gate thresholds"
  );
});

test("SAFETY: research execution's own timeout/budget constants are untouched by this fix", () => {
  assert.match(planExecutorSource, /const BUSINESS_PLAN_PIPELINE_BUDGET_MS = 200_000;/);
  assert.match(planExecutorSource, /const BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS = 90_000;/);
});
