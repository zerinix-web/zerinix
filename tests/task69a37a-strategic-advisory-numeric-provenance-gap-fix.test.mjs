import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachNumericProvenanceLabels } from "../app/lib/report-engine/numeric-provenance-guard.ts";
import {
  extractGenericDecisionSignal,
  correctConfidenceDecisionConflation,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import { domainAnalysisPrompts, buildDomainAnalysisInstructions } from "../app/lib/report-engine/prompts/domain-analysis.ts";

// ===========================================================================
// TASK #69A-37A -- a fresh, real Strategic Advisory response confirmed
// #69A-37's decision/confidence fix works, but still presented many
// model-generated numeric thresholds, budgets, and impact ranges with
// no provenance at all: "CAC reduction >=20%", "LTV/CAC >=3", "CAC
// payback <=12 months", "$5-15k"/"$10-30k"/"$20-60k" spend ranges,
// "10-20%"/"10-30%"/"10-25%" improvement ranges, "NRR +3-8 percentage
// points", an "8-12 week sprint". None of these were user-supplied --
// they read as verified facts about this specific business when they
// are really the model's own planning assumptions, illustrative
// benchmarks, or approximate estimates.
//
// FIX (two layers, matching #69A-37's own established pattern):
//   1. domain-analysis.ts/acquisition-analysis.ts's prompts now require
//      the model to attach one of Verified/Benchmark/Assumption/
//      Estimated directly next to every such number, in the SAME
//      clause, across every field that plausibly carries one -- and
//      explicitly forbid calling a self-generated number "Benchmark"
//      unless a real external reference backs it.
//   2. attachNumericProvenanceLabels (new, exported,
//      numeric-provenance-guard.ts) is the deterministic backstop,
//      wired into both parseDomainAnalysisReport and
//      parseAcquisitionAnalysisReport's per-field loop (plan-
//      executor.ts): it appends the single safest label "(Estimate)"
//      to any material numeric claim with no provenance signal nearby,
//      never invents "Benchmark" or "Verified" itself, and leaves an
//      already-labeled or user-referenced number completely untouched.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const domainAnalysisPromptSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/prompts/domain-analysis.ts"),
  "utf8"
);
const acquisitionAnalysisPromptSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/prompts/acquisition-analysis.ts"),
  "utf8"
);
const executiveDecisionVocabularySource = readFileSync(
  join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"),
  "utf8"
);

const REAL_CASE_TEXT =
  "Recommendation: Slow down aggressive growth spending and reallocate budget toward unit-economics " +
  "optimization. Confidence: 95%. Target CAC reduction >=20% as the initial gate, with LTV/CAC >=3 as " +
  "the sustained bar. CAC payback should stay <=12 months. Budget $5-15k for experimentation, $10-30k " +
  "for engineering/UX investment, for a total of $20-60k. Expect 10-20% CAC reduction, 10-30% activation " +
  "improvement, and 10-25% ARPU increase. NRR should move by +3-8 percentage points. Plan for an 8-12 " +
  "week sprint to execute the first phase.";

// ===========================================================================
// 1. User-provided numeric facts remain user-provided
// ===========================================================================

test("1a. a number explicitly attributed to the user (via 'as you stated', 'your own', or an existing Verified label) is left completely untouched -- never re-tagged as an Estimate", () => {
  const cases = [
    "As you stated, your own CAC is $50 today.",
    "Your own current CAC payback is 9 months.",
    "The user-provided ARR figure is $500k.",
    "Verified: your current LTV/CAC is 2.1.",
  ];
  for (const text of cases) {
    assert.equal(attachNumericProvenanceLabels(text), text, text);
  }
});

test("1b. domainAnalysisPrompts' numeric-provenance instruction explicitly requires marking a user-stated or user-derived figure as Verified, naming the user's own figure -- never silently reclassifying it as a weaker tier", () => {
  const instructions = buildDomainAnalysisInstructions("finance", "English");
  assert.match(
    instructions,
    /If the user directly stated it, or it is mathematically derived from a figure the user stated, mark it Verified/i
  );
});

// ===========================================================================
// 2. Model-generated budgets are labeled Estimate or Planning Assumption
// ===========================================================================

test("2a. an unlabeled dollar budget/range gets tagged Estimate", () => {
  const text = "Budget $10-30k for the engineering investment.";
  const corrected = attachNumericProvenanceLabels(text);
  assert.equal(corrected, "Budget $10-30k (Estimate) for the engineering investment.");
});

test("2b. a budget the model itself already labeled 'Estimated' or 'Planning assumption' is left untouched (the model's own, stronger-context label is preserved, never overwritten)", () => {
  const cases = [
    "Estimated implementation cost: $10-30k for this phase.",
    "Planning assumption: allocate $20-60k in total investment.",
  ];
  for (const text of cases) {
    assert.equal(attachNumericProvenanceLabels(text), text, text);
  }
});

// ===========================================================================
// 3. Model-generated impact ranges are labeled Estimate
// ===========================================================================

test("3a. an unlabeled percentage impact range (CAC reduction, activation improvement, ARPU increase) gets tagged Estimate", () => {
  const text = "Expect 10-20% CAC reduction and 10-25% ARPU increase within two quarters.";
  const corrected = attachNumericProvenanceLabels(text);
  assert.equal(
    corrected,
    "Expect 10-20% (Estimate) CAC reduction and 10-25% (Estimate) ARPU increase within two quarters."
  );
});

test("3b. an unlabeled percentage-point delta (e.g. an NRR shift) gets tagged Estimate", () => {
  const text = "NRR should move by +3-8 percentage points during the same window.";
  const corrected = attachNumericProvenanceLabels(text);
  assert.equal(corrected, "NRR should move by +3-8 percentage points (Estimate) during the same window.");
});

// ===========================================================================
// 4. Benchmark values require benchmark provenance (never invented by the
//    deterministic backstop, and the prompt forbids the model from
//    self-assigning it without real evidence)
// ===========================================================================

test("4a. attachNumericProvenanceLabels NEVER assigns 'Benchmark' or 'Verified' itself -- the only label it ever appends is the safe, neutral 'Estimate'", () => {
  const guardSource = readFileSync(
    join(repoRoot, "app/lib/report-engine/numeric-provenance-guard.ts"),
    "utf8"
  );
  const appendedLabelMatch = guardSource.match(/APPENDED_LABEL\s*=\s*"([^"]+)"/);
  assert.ok(appendedLabelMatch, "APPENDED_LABEL constant not found");
  assert.equal(appendedLabelMatch[1], " (Estimate)");
  assert.doesNotMatch(guardSource, /APPENDED_LABEL\s*=\s*"[^"]*(?:Benchmark|Verified)[^"]*"/i);
});

test("4b. domain-analysis's prompt explicitly forbids labeling a self-generated number as Benchmark without a real external reference", () => {
  assert.match(
    domainAnalysisPromptSource,
    /If you produced the number yourself with no such external reference, it is never Benchmark/i
  );
});

test("4c. acquisition-analysis's prompt carries the identical Benchmark-requires-real-evidence rule", () => {
  assert.match(
    acquisitionAnalysisPromptSource,
    /If you produced the number yourself with no such external reference, it is never Benchmark/i
  );
});

test("4d. a number already labeled 'Illustrative benchmark' by the model is left untouched by the deterministic backstop", () => {
  const text = "Illustrative benchmark -- verify for your segment: LTV/CAC >=3.";
  assert.equal(attachNumericProvenanceLabels(text), text);
});

// ===========================================================================
// 5. Unsupported numeric thresholds cannot appear as verified facts
// ===========================================================================

test("5a. every material numeric claim in the exact real reported text ends up carrying either the model's own label or the deterministic '(Estimate)' backstop -- none is left as a bare, unlabeled number", () => {
  const corrected = attachNumericProvenanceLabels(REAL_CASE_TEXT);
  // The confidence line must remain untouched (not treated as a
  // material numeric claim -- that is #69A-37's own concern).
  assert.match(corrected, /Confidence: 95%\./);
  // Every previously-unlabeled threshold now carries "(Estimate)".
  for (const fragment of [
    "CAC reduction >=20% (Estimate)",
    "LTV/CAC >=3 (Estimate)",
    "CAC payback should stay <=12 months (Estimate)",
    "$5-15k (Estimate)",
    "$10-30k (Estimate)",
    "$20-60k (Estimate)",
    "10-20% (Estimate) CAC reduction",
    "10-30% (Estimate) activation",
    "10-25% (Estimate) ARPU",
    "+3-8 percentage points (Estimate)",
    "8-12 week (Estimate) sprint",
  ]) {
    assert.ok(corrected.includes(fragment), `expected corrected text to include: "${fragment}"`);
  }
});

test("5b. domain-analysis's prompt instruction explicitly states a Benchmark/Estimated/Assumption figure must never be presented as a verified fact about the user's own business", () => {
  assert.match(
    domainAnalysisPromptSource,
    /Never state a Benchmark, Estimated, or Assumption figure as if it were a verified fact about this specific user's own business/i
  );
});

// ===========================================================================
// 6. Provenance stays attached to the relevant number (never a generic
//    end-of-field disclaimer)
// ===========================================================================

test("6a. the appended label sits immediately after the numeric span itself, not appended once at the end of the whole text", () => {
  const text = "First: $10-30k for phase one. Second: 10-20% improvement in phase two. Unrelated closing sentence.";
  const corrected = attachNumericProvenanceLabels(text);
  assert.match(corrected, /\$10-30k \(Estimate\) for phase one/);
  assert.match(corrected, /10-20% \(Estimate\) improvement in phase two/);
  // Not a single trailing disclaimer appended once at the very end.
  assert.ok(!corrected.trim().endsWith("(Estimate)"));
});

test("6b. domain-analysis's prompt explicitly requires the label in the SAME clause or sentence as the number -- never only as a disclaimer elsewhere in the field", () => {
  assert.match(
    domainAnalysisPromptSource,
    /must carry its provenance directly next to that number, in the same clause or sentence -- never only as a disclaimer elsewhere in the field/i
  );
});

test("6c. the function is idempotent -- running it twice never double-tags a number it already tagged", () => {
  const once = attachNumericProvenanceLabels("Budget $10-30k for this plan.");
  const twice = attachNumericProvenanceLabels(once);
  assert.equal(once, twice);
  assert.equal((once.match(/\(Estimate\)/g) || []).length, 1);
});

// ===========================================================================
// 7. Decision/confidence semantics from #69A-37 remain correct
// ===========================================================================

test("7a. extractGenericDecisionSignal still correctly resolves confidence to 95 (not the 50 default) for text containing the numeric-provenance backstop's own output alongside a conflated confidence line", () => {
  const conflated = "Recommendation: Slow down growth. Confidence: GO (95%). CAC reduction >=20%.";
  const { confidence } = extractGenericDecisionSignal(conflated);
  assert.equal(confidence, 95);
});

test("7b. correctConfidenceDecisionConflation and attachNumericProvenanceLabels compose cleanly in pipeline order -- the confidence line is healed and the numeric claim is separately labeled, with neither pass interfering with the other", () => {
  const conflated = "Recommendation: Slow down growth. Confidence: GO (95%). CAC reduction >=20% is the gate.";
  const step1 = correctConfidenceDecisionConflation(conflated);
  const step2 = attachNumericProvenanceLabels(step1);
  assert.match(step2, /Confidence: 95%\./);
  assert.match(step2, /CAC reduction >=20% \(Estimate\) is the gate/);
});

test("7c. no decision word (GO, MONITOR, PROCEED WITH CONDITIONS, etc.) can leak into the confidence clause after both healing passes run in pipeline order -- #69A-37's own guarantee is not regressed by #69A-37A's addition", () => {
  const words = ["GO", "MONITOR", "PROCEED WITH CONDITIONS", "WAIT", "AVOID", "PASS"];
  for (const word of words) {
    const text = `Some analysis. Confidence: ${word} (80%). CAC reduction >=15%.`;
    const healed = attachNumericProvenanceLabels(correctConfidenceDecisionConflation(text));
    assert.doesNotMatch(healed, new RegExp(`Confidence:\\s*${word}`, "i"), word);
    assert.match(healed, /Confidence: 80%\./);
  }
});

// ===========================================================================
// 8. Historical responses degrade safely
// ===========================================================================

test("8a. attachNumericProvenanceLabels never throws and never fabricates data for text with no matching numeric pattern -- returns input unchanged", () => {
  const plainText = "This field discusses qualitative strategy with no numeric thresholds at all.";
  assert.equal(attachNumericProvenanceLabels(plainText), plainText);
  assert.equal(attachNumericProvenanceLabels(""), "");
});

test("8b. both parseDomainAnalysisReport and parseAcquisitionAnalysisReport (plan-executor.ts) call attachNumericProvenanceLabels inside their own per-field healing loop -- a historical cached report is healed on its next read, with no cache-version bump required", () => {
  const domainStart = planExecutorSource.indexOf("function parseDomainAnalysisReport(");
  const acquisitionStart = planExecutorSource.indexOf("function parseAcquisitionAnalysisReport(");
  assert.ok(domainStart >= 0 && acquisitionStart > domainStart);

  const domainFnBody = planExecutorSource.slice(domainStart, acquisitionStart);
  const acquisitionFnBody = planExecutorSource.slice(acquisitionStart, acquisitionStart + 3500);

  assert.match(domainFnBody, /validated\[field\] = attachNumericProvenanceLabels\(validated\[field\]\);/);
  assert.match(acquisitionFnBody, /validated\[field\] = attachNumericProvenanceLabels\(validated\[field\]\);/);
});

test("8c. no cache-version bump was introduced for this fix -- confined entirely to the same per-field loop that already runs fresh on every cache-hit and fresh-generation read", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-37A.*bump/i);
});

// ===========================================================================
// 9. BIV and Market Intelligence are not regressed
// ===========================================================================

test("9a. no #69A-37A marker exists in investment-score.ts, market-research-coverage.ts, financial-evidence-labeling.ts, or executive-decision-vocabulary.ts -- BIV/Market Intelligence's own financial and decision architecture is untouched", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/financial-evidence-labeling.ts",
    "app/lib/report-evidence.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-37A/, relativePath);
  }
  assert.doesNotMatch(executiveDecisionVocabularySource, /TASK #69A-37A/);
});

test("9b. #69A-35's WAIT -> PROCEED_WITH_CONDITIONS mapping remains byte-unchanged", () => {
  assert.match(executiveDecisionVocabularySource, /if \(recommendation === "WAIT"\) return "PROCEED_WITH_CONDITIONS";/);
});

test("9c. attachNumericProvenanceLabels is a standalone, additive module -- it does not import from or modify any BIV/Market-Intelligence-specific file, only report-language.ts (a shared, generic dependency already used by financial-evidence-labeling.ts)", () => {
  const guardSource = readFileSync(
    join(repoRoot, "app/lib/report-engine/numeric-provenance-guard.ts"),
    "utf8"
  );
  const importLines = guardSource.match(/^import .+$/gm) || [];
  for (const line of importLines) {
    assert.doesNotMatch(line, /investment-score|market-research|business-competitor|porters-five-forces|market-intelligence/i);
  }
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] domainAnalysisPrompts.finalRecommendation still preserves #69A-37's own decision/confidence separation requirements verbatim -- #69A-37A's edits only touched the classification/numeric-threshold instruction lines, never this field's own prompt", () => {
  assert.match(domainAnalysisPrompts.finalRecommendation, /Name the one condition that would change the call\./);
  assert.match(domainAnalysisPrompts.finalRecommendation, /confidence must never itself be, or contain, a decision\/recommendation word/i);
});

test("[REGRESSION LOCK] the numeric-provenance guard's material-claim patterns recognize both the Unicode (>=, <=) and ASCII ('>=', '<=') comparison-operator forms a model may emit", () => {
  assert.equal(
    attachNumericProvenanceLabels("Target LTV/CAC ≥3 for this plan."),
    "Target LTV/CAC ≥3 (Estimate) for this plan."
  );
  assert.equal(
    attachNumericProvenanceLabels("Target LTV/CAC >=3 for this plan."),
    "Target LTV/CAC >=3 (Estimate) for this plan."
  );
});
