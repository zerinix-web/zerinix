import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachNumericProvenanceLabels } from "../app/lib/report-engine/numeric-provenance-guard.ts";
import {
  correctConfidenceDecisionConflation,
  stripUnsupportedPreferenceClaims,
} from "../app/lib/report-engine/executive-decision-brief.ts";

// ===========================================================================
// TASK #69A-37B -- a fresh, REAL localhost Strategic Advisory chat response
// proved #69A-37/#69A-37A's own automated tests were passing while the
// ACTUAL runtime output still violated both tickets:
//
//   "Confidence: GO with 95% confidence (per your preference)..."
//
// plus a long list of unlabeled model-generated numeric claims ($10k-$50k
// investment, 15-30% CAC reduction, CAC >=20% reduction, payback <=12
// months, LTV/CAC >=3x, net retention >=110%, churn reduction >=20%,
// LTV/CAC >=2.5, LTV lift >=20%, reallocate 20-40% of paid spend).
//
// WHY THE PREVIOUS TESTS PASSED WHILE THE REAL OUTPUT FAILED (root cause,
// traced live): #69A-37/#69A-37A's guards (correctConfidenceDecisionConflation,
// attachNumericProvenanceLabels) were wired ONLY into
// parseDomainAnalysisReport/parseAcquisitionAnalysisReport
// (app/lib/report-jobs/plan-executor.ts) -- the structured domain-analysis/
// acquisition-analysis REPORT pipeline. But a real Strategic Advisory
// request from the UI's direct-submission form (components/Planner.tsx)
// posts to a COMPLETELY SEPARATE route, app/api/chat/route.ts, with
// `analysisMode: "chat"` (read there as `isDirectStrategicAdvisory`).
// That route builds its own inline prompt, streams
// response.output_text.delta chunks straight to the client as they
// arrive, and never imported or called either guard function anywhere --
// confirmed by an exhaustive grep across app/ before this fix: the only
// two call sites in the entire codebase were inside plan-executor.ts.
// Every previous test exercised the guard FUNCTIONS directly (correctly
// proving they work) or the plan-executor.ts PIPELINE (a real but
// different pipeline) -- none of them exercised app/api/chat/route.ts,
// so none could have caught this gap. This file adds that missing proof:
// source-level evidence that the guards are now actually wired into the
// literal file/branch a real chat request executes, plus the exact
// real-response fixtures reconstructed as fail-before/pass-after cases.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const chatRouteSource = readFileSync(join(repoRoot, "app/api/chat/route.ts"), "utf8");

const REAL_RESPONSE_TEXT =
  "Confidence: GO with 95% confidence (per your preference), given the strength of the unit-economics case. " +
  "Investment: $10k-$50k for the first sprint, with expected outcome: 15-30% CAC reduction. " +
  "Investment: $20k-$80k for the second phase, with expected outcome: 10-30% LTV increase. " +
  "Investment: $15k-$60k for the retention initiative. " +
  "Use CAC reduction >=20% as the re-scaling gate, with payback <=12 months and LTV/CAC >=3x as the sustained bar. " +
  "Target net retention >=110% and churn reduction >=20%, with LTV/CAC >=2.5 as the minimum and LTV lift >=20% as the stretch goal. " +
  "Reallocate 20-40% of paid spend toward retention. " +
  "Your own current CAC improved by +35% and MoM growth is 8%, which supports this plan.";

function runFullOutputGuardPipeline(text) {
  return stripUnsupportedPreferenceClaims(
    attachNumericProvenanceLabels(correctConfidenceDecisionConflation(text))
  );
}

// ===========================================================================
// 1. "Confidence: GO with 95% confidence" cannot survive final output.
// ===========================================================================

test("1a. [FAIL-BEFORE PROOF] the pre-#69A-37B correctConfidenceDecisionConflation pattern (reconstructed) does not touch this exact real shape at all", () => {
  const decisionWordInsideConfidencePattern =
    "(?:GO|NO[\\s-]?GO|CONDITIONAL\\s+GO|PROCEED(?:\\s+WITH\\s+CONDITIONS)?|PROCEED\\s+CONDITIONALLY|PAUSE\\s+PENDING\\s+REVIEW|REJECT|WAIT|AVOID|ENTER|MONITOR|PASS|DO\\s+NOT\\s+PROCEED|INSUFFICIENT\\s+EVIDENCE)";
  const preFixPattern = new RegExp(
    `\\bconfidence\\s*(?:level)?\\s*[:\\-–—]\\s*${decisionWordInsideConfidencePattern}\\s*\\(?\\s*(\\d{1,3})\\s*%\\)?`,
    "gi"
  );
  const before = REAL_RESPONSE_TEXT.replace(preFixPattern, (_m, p) => `Confidence: ${p}%`);
  assert.match(before, /Confidence:\s*GO with 95% confidence/i);
});

test("1b. [PASS-AFTER PROOF] correctConfidenceDecisionConflation now heals the exact real shape to a clean, numeric-only confidence statement", () => {
  const healed = correctConfidenceDecisionConflation(REAL_RESPONSE_TEXT);
  assert.match(healed, /Confidence: 95%/);
  assert.doesNotMatch(healed, /Confidence:\s*GO/i);
});

test("1c. no decision word survives inside the confidence clause in the fully-healed pipeline output for the real response", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.doesNotMatch(healed, /Confidence:\s*(?:GO|NO-GO|MONITOR|PAUSE|PROCEED WITH CONDITIONS)/i);
  assert.match(healed, /Confidence: 95%/);
});

// ===========================================================================
// 2-8. Every observed unlabeled numeric claim from the real response gets
// tagged once the full guard pipeline runs.
// ===========================================================================

test("2. $10k-$50k investment cannot survive unlabeled when model-generated", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /\$10k-\$50k \(Estimate\)/);
});

test("3. 15-30% expected CAC reduction cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /15-30% \(Estimate\) CAC reduction/);
});

test("4. >=20% CAC gate cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /CAC reduction >=20% \(Estimate\)/);
});

test("5. <=12 month payback threshold cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /payback <=12 months \(Estimate\)/);
});

test("6. >=3x LTV/CAC cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /LTV\/CAC >=3x \(Estimate\)/);
});

test("7. >=110% NRR (net retention) cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /net retention >=110% \(Estimate\)/);
});

test("8. 20-40% spend reallocation cannot survive unlabeled", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /Reallocate 20-40% \(Estimate\) of paid spend/);
});

test("8b. every remaining unlabeled threshold from the real response (churn reduction, second LTV/CAC minimum, LTV lift, second/third investment ranges, second impact range) is also tagged -- none slips through", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  for (const fragment of [
    "$20k-$80k (Estimate)",
    "10-30% (Estimate) LTV increase",
    "$15k-$60k (Estimate)",
    "churn reduction >=20% (Estimate)",
    "LTV/CAC >=2.5 (Estimate)",
    "LTV lift >=20% (Estimate)",
  ]) {
    assert.ok(healed.includes(fragment), `expected healed output to include: "${fragment}"`);
  }
});

// ===========================================================================
// 9. User-provided +35% CAC and 8% MoM remain recognized as user facts and
//    are NOT incorrectly relabeled as model estimates.
// ===========================================================================

test("9. 'Your own current CAC improved by +35%' and 'MoM growth is 8%' are left completely untouched -- never tagged (Estimate)", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.match(healed, /Your own current CAC improved by \+35% and MoM growth is 8%/);
  assert.doesNotMatch(healed, /\+35%\s*\(Estimate\)/);
  assert.doesNotMatch(healed, /8%\s*\(Estimate\)/);
});

// ===========================================================================
// 10. "(per your preference)" is removed/rejected when unsupported.
// ===========================================================================

test("10a. the vague, unnamed '(per your preference)' phrase is fully removed from the healed output", () => {
  const healed = runFullOutputGuardPipeline(REAL_RESPONSE_TEXT);
  assert.doesNotMatch(healed, /per your preference/i);
  // The surrounding sentence remains coherent, not double-spaced/mangled.
  assert.match(healed, /Confidence: 95%, given the strength of the unit-economics case\./);
});

test("10b. a SPECIFIC, named preference claim is preserved -- only the vague, contentless form is stripped", () => {
  const named = "Confidence: 95% (per your stated preference for aggressive growth over margin).";
  assert.equal(stripUnsupportedPreferenceClaims(named), named);
});

test("10c. stripUnsupportedPreferenceClaims never fabricates text and returns unmatched input untouched", () => {
  const plain = "This sentence has no preference claim at all.";
  assert.equal(stripUnsupportedPreferenceClaims(plain), plain);
  assert.equal(stripUnsupportedPreferenceClaims(""), "");
});

// ===========================================================================
// 8 (ticket item). Proof the final-output guard is invoked on the REAL
// runtime path -- app/api/chat/route.ts, not just plan-executor.ts.
// ===========================================================================

test("route-proof a. app/api/chat/route.ts imports all three output guards directly from their canonical modules", () => {
  assert.match(
    chatRouteSource,
    /import\s*\{\s*\n\s*correctConfidenceDecisionConflation,\s*\n\s*stripUnsupportedPreferenceClaims,\s*\n\s*\}\s*from\s*"@\/app\/lib\/report-engine\/executive-decision-brief"/
  );
  assert.match(
    chatRouteSource,
    /import\s*\{\s*attachNumericProvenanceLabels\s*\}\s*from\s*"@\/app\/lib\/report-engine\/numeric-provenance-guard"/
  );
});

test("route-proof b. the chat route reads analysisMode === 'chat' into isDirectStrategicAdvisory -- the exact flag the real UI request sets for a Strategic Advisory submission", () => {
  assert.match(chatRouteSource, /const isDirectStrategicAdvisory = body\?\.analysisMode === "chat";/);
});

test("route-proof c. the chat route suppresses live per-chunk streaming specifically (and only) for isDirectStrategicAdvisory, via shouldStreamLiveDeltas", () => {
  assert.match(chatRouteSource, /const shouldStreamLiveDeltas = !isDirectStrategicAdvisory;/);
  const deltaEnqueueGuards = chatRouteSource.match(/if \(shouldStreamLiveDeltas\) \{/g) || [];
  assert.ok(deltaEnqueueGuards.length >= 4, `expected at least 4 guarded enqueue sites, found ${deltaEnqueueGuards.length}`);
});

// TASK #69A-37C -- UPDATED (not regressed): the inline triple-call
// composition these two tests originally pinned was extracted into one
// named, exported, shared function -- resolveFinalStrategicAdvisoryText
// -- reused by BOTH this flush block and the cache-hit branch #69A-37C
// fixed (see tests/task69a37c-strategic-advisory-cache-hit-bytes-fix.test.mjs's
// own "parity-b" through "parity-e" tests for the full, current proof of
// composition order and both call sites). Re-pinned here to the new
// shape so this file keeps proving the flush block still runs the full
// correction before enqueueing, without duplicating the deeper
// composition-order proof now owned by the #69A-37C file.
test("route-proof d/e (updated for #69A-37C). the chat route's flush block calls the shared resolveFinalStrategicAdvisoryText on the complete accumulated text, gated on isDirectStrategicAdvisory && !usedDisplayFallback, and enqueues the SAME corrected variable to the client", () => {
  const flushBlockMatch = chatRouteSource.match(
    /if \(isDirectStrategicAdvisory && !usedDisplayFallback\) \{[\s\S]{0,300}?\n\s*\}/
  );
  assert.ok(flushBlockMatch, "expected to find the isDirectStrategicAdvisory flush block");
  assert.match(
    flushBlockMatch[0],
    /streamedText = resolveFinalStrategicAdvisoryText\(streamedText\);\s*\n\s*controller\.enqueue\(encoder\.encode\(streamedText\)\);/
  );
});

// ===========================================================================
// 11. BIV and Market Intelligence remain unaffected.
// ===========================================================================

test("11a. no #69A-37B marker exists in investment-score.ts, market-research-coverage.ts, financial-evidence-labeling.ts, or executive-decision-vocabulary.ts", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/financial-evidence-labeling.ts",
    "app/lib/report-evidence.ts",
    "app/lib/report-engine/executive-decision-vocabulary.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-37B/, relativePath);
  }
});

test("11b. the streaming restructure only branches on isDirectStrategicAdvisory -- every other chat mode (Market Intelligence, Business Plan, general chat) keeps its existing shouldStreamLiveDeltas === true live-streaming behavior untouched", () => {
  assert.match(chatRouteSource, /const shouldStreamLiveDeltas = !isDirectStrategicAdvisory;/);
  // No other flag or report-type check gates shouldStreamLiveDeltas.
  const declarationLine = chatRouteSource.match(/const shouldStreamLiveDeltas = [^\n]+/)[0];
  assert.equal(declarationLine, "const shouldStreamLiveDeltas = !isDirectStrategicAdvisory;");
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] plan-executor.ts's domain-analysis/acquisition-analysis pipelines also gained stripUnsupportedPreferenceClaims (defensive parity), without disturbing their existing correctConfidenceDecisionConflation/attachNumericProvenanceLabels calls", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  const occurrences = [...planExecutorSource.matchAll(/validated\[field\] = stripUnsupportedPreferenceClaims\(validated\[field\]\);/g)];
  assert.equal(occurrences.length, 2, "expected exactly one call in each of the two per-field loops");
});

test("[REGRESSION LOCK] the numeric-provenance guard's ratio pattern now folds a trailing x/X multiplier into the same matched span, so the appended label never lands inside the threshold (e.g. never '>=3 (Estimate)x')", () => {
  const healed = attachNumericProvenanceLabels("Target LTV/CAC >=3x for this plan.");
  assert.doesNotMatch(healed, />=3 \(Estimate\)x/);
  assert.match(healed, />=3x \(Estimate\)/);
});
