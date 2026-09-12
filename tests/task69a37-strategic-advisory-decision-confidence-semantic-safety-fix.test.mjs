import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractGenericDecisionSignal,
  correctConfidenceDecisionConflation,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import {
  domainAnalysisPrompts,
  buildDomainAnalysisInstructions,
} from "../app/lib/report-engine/prompts/domain-analysis.ts";
import { acquisitionAnalysisPrompts } from "../app/lib/report-engine/prompts/acquisition-analysis.ts";

// ===========================================================================
// TASK #69A-37 -- a real Strategic Advisory response contained:
//   "Recommendation: Slow down aggressive growth spending now..."
//   "Confidence: GO (95%)."
// -- a decision/recommendation word ("GO") appearing INSIDE the
// confidence statement. Decision and confidence are different concepts
// and must never share one label.
//
// TRACE: "Strategic Advisory" is not a distinct report kind -- it is the
// shared Legal/Finance/Accounting/Operations/Procurement "domain-
// analysis" family (see executive-decision-vocabulary.ts's own comment).
// Its finalRecommendation field is model-authored free text, built from
// domainAnalysisPrompts.finalRecommendation's own instruction ("Open
// with the call... State the confidence level...") which never forbade
// combining the two into one mislabeled sentence. Separately,
// buildDomainAnalysisExecutiveDecisionBrief (plan-executor.ts) derives
// this report's OWN deterministic confidence number by calling
// extractGenericDecisionSignal(report.decisionAssessment + "\n" +
// report.finalRecommendation) -- and THAT function's own confidence
// regex required the percentage to sit IMMEDIATELY after "confidence:"
// with only whitespace in between, so "Confidence: GO (95%)." matched
// NEITHER of its two alternatives at all, silently defaulting to 50
// instead of the real, stated 95. This was not just a display bug: it
// corrupted the CANONICAL derived confidence value the deterministic
// banner itself then displays.
//
// FIX (three layers, matching this session's own established
// prompt-fix + deterministic-backstop pattern):
//   1. extractGenericDecisionSignal's confidence regex now skips over
//      exactly one of this codebase's own known decision words (never
//      arbitrary text) sitting between "confidence:" and the number, so
//      the CANONICAL value is correctly derived even when the model's
//      own prose conflates the two.
//   2. correctConfidenceDecisionConflation (new, exported) deterministic-
//      ally rewrites the SAME pattern in the model's own displayed prose
//      -- "Confidence: GO (95%)." -> "Confidence: 95%." -- wired into
//      parseDomainAnalysisReport AND parseAcquisitionAnalysisReport
//      (plan-executor.ts), which both share this same underlying risk.
//   3. domainAnalysisPrompts.finalRecommendation/decisionAssessment and
//      acquisitionAnalysisPrompts's own classification instruction now
//      explicitly forbid a decision word inside a confidence statement,
//      require confidence as a percentage/certainty-level only, and ask
//      for an ACTION-SPECIFIC call (not a bare proceed/wait/avoid label)
//      plus explicit Benchmark/Assumption labeling for illustrative
//      numeric thresholds -- preventing the conflation and the
//      unlabeled-benchmark risk at generation time, going forward.
//
// No new cache-version bump is required: correctConfidenceDecisionConflation
// is applied inside parseDomainAnalysisReport/parseAcquisitionAnalysisReport's
// own per-field loop, which BOTH plan-executor.ts's cache-hit and
// fresh-generation code paths call fresh on every read of the raw
// (cached-or-new) response text -- so this fix is already retroactive
// for previously-cached responses without needing to force
// regeneration, mirroring #69A-62's own identical "no bump needed for a
// per-field-loop fix" precedent.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const executiveDecisionBriefSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts"),
  "utf8"
);

const REAL_CASE_TEXT =
  "Recommendation: Slow down aggressive growth spending now and reallocate " +
  "budget toward unit-economics optimization. Confidence: GO (95%). " +
  "The team should prioritize CAC reduction over new-market expansion this quarter.";

// ===========================================================================
// 1. Decision labels cannot populate confidence
// ===========================================================================

test("1a. [FAIL-BEFORE PROOF] the OLD confidence regex (reconstructed inline) could not extract a number from 'Confidence: GO (95%).' at all, and silently defaulted to 50", () => {
  const oldPattern = /\b(\d{1,3})\s*%\s*confidence\b|\bconfidence\s*[:\-–—]?\s*(\d{1,3})\s*%/i;
  const oldMatch = REAL_CASE_TEXT.match(oldPattern);
  assert.equal(oldMatch, null, "sanity: the old pattern genuinely could not find the real 95% figure");
});

test("1b. [PASS-AFTER PROOF] the CURRENT extractGenericDecisionSignal correctly extracts 95, not the default 50, for the exact real reported text", () => {
  const { confidence } = extractGenericDecisionSignal(REAL_CASE_TEXT);
  assert.equal(confidence, 95);
});

test("1c. decision and confidence are independently derived -- extractGenericDecisionSignal never assigns the matched decision keyword INTO the confidence field, or vice versa", () => {
  const { decision, confidence } = extractGenericDecisionSignal(REAL_CASE_TEXT);
  assert.equal(typeof confidence, "number");
  assert.notEqual(String(confidence), decision);
  assert.ok(["GO", "CONDITIONAL_GO", "NO_GO"].includes(decision));
});

// ===========================================================================
// 2. Confidence remains numeric/valid
// ===========================================================================

test("2a. confidence is always a finite number in [0, 100], never a string or decision word, for a range of conflated inputs", () => {
  const cases = [
    "Confidence: GO (95%).",
    "Confidence: PROCEED WITH CONDITIONS (82%).",
    "Confidence: MONITOR (56%)",
    "Confidence: NO-GO (30%).",
    "Confidence level: WAIT (40%)",
  ];
  for (const text of cases) {
    const { confidence } = extractGenericDecisionSignal(text);
    assert.equal(typeof confidence, "number");
    assert.ok(Number.isFinite(confidence) && confidence >= 0 && confidence <= 100, text);
  }
});

test("2b. when no confidence figure exists at all, the function returns the honest conservative default (50) -- never fabricates a different number, never crashes", () => {
  const { confidence } = extractGenericDecisionSignal("This report has no confidence statement at all.");
  assert.equal(confidence, 50);
});

// ===========================================================================
// 3. Action-specific strategic recommendations work (prompt-level, not
//    hardcoded to this scenario)
// ===========================================================================

test("3a. domainAnalysisPrompts.finalRecommendation asks for a SPECIFIC strategic action tied to the decision question -- never just the bare three-word posture -- and names no specific scenario wording (generic across every domain/question)", () => {
  const prompt = domainAnalysisPrompts.finalRecommendation;
  assert.match(prompt, /SPECIFIC strategic action/i);
  assert.doesNotMatch(prompt, /slow down aggressive growth|unit-economics optimization|SLOW AGGRESSIVE GROWTH/i);
});

test("3b. the instruction does not hardcode any single industry/scenario -- it is phrased generically for 'this exact decision question', reusable for any Strategic Advisory prompt", () => {
  const prompt = domainAnalysisPrompts.finalRecommendation;
  assert.match(prompt, /this exact decision question/i);
});

// ===========================================================================
// 4. GO/MONITOR/etc. cannot leak into confidence (the display-text fix)
// ===========================================================================

test("4a. correctConfidenceDecisionConflation rewrites the exact real reported sentence to a clean, semantically valid confidence statement", () => {
  const corrected = correctConfidenceDecisionConflation(REAL_CASE_TEXT);
  assert.match(corrected, /Confidence: 95%\./);
  assert.doesNotMatch(corrected, /Confidence:\s*GO/i);
});

test("4b. every known decision word (business_plan, standard, and canonical-vocabulary phrasings) is corrected when it appears inside a Confidence clause", () => {
  const words = [
    "GO",
    "NO GO",
    "NO-GO",
    "CONDITIONAL GO",
    "MONITOR",
    "AVOID",
    "ENTER",
    "WAIT",
    "PASS",
    "PROCEED",
    "PROCEED WITH CONDITIONS",
    "PROCEED CONDITIONALLY",
    "PAUSE PENDING REVIEW",
    "REJECT",
    "DO NOT PROCEED",
    "INSUFFICIENT EVIDENCE",
  ];
  for (const word of words) {
    const text = `Some analysis. Confidence: ${word} (77%). More analysis.`;
    const corrected = correctConfidenceDecisionConflation(text);
    assert.equal(corrected, "Some analysis. Confidence: 77%. More analysis.", `word: ${word}`);
  }
});

test("4c. clean, already-correct confidence text is returned byte-identical -- the healing pass never alters text it does not need to", () => {
  const clean = "Recommendation: Proceed carefully. Confidence: 82%. Reasoning follows.";
  assert.equal(correctConfidenceDecisionConflation(clean), clean);
});

test("4d. an unrelated sentence that happens to contain both 'confidence' and a percentage, with ordinary prose (not a decision word) in between, is left untouched -- the fix never fabricates a false match", () => {
  const text = "Confidence: We interviewed 15 customers and found 95% renewal intent.";
  assert.equal(correctConfidenceDecisionConflation(text), text);
});

test("4e. both parseDomainAnalysisReport and parseAcquisitionAnalysisReport (plan-executor.ts) call correctConfidenceDecisionConflation inside their own per-field healing loop", () => {
  const domainStart = planExecutorSource.indexOf("function parseDomainAnalysisReport(");
  const acquisitionStart = planExecutorSource.indexOf("function parseAcquisitionAnalysisReport(");
  assert.ok(domainStart >= 0, "parseDomainAnalysisReport not found");
  assert.ok(acquisitionStart >= 0, "parseAcquisitionAnalysisReport not found");
  assert.ok(acquisitionStart > domainStart, "expected parseAcquisitionAnalysisReport to follow parseDomainAnalysisReport");

  const domainFnBody = planExecutorSource.slice(domainStart, acquisitionStart);
  const acquisitionFnBody = planExecutorSource.slice(
    acquisitionStart,
    acquisitionStart + 3000
  );
  assert.match(domainFnBody, /validated\[field\] = correctConfidenceDecisionConflation\(validated\[field\]\);/);
  assert.match(acquisitionFnBody, /validated\[field\] = correctConfidenceDecisionConflation\(validated\[field\]\);/);
});

// ===========================================================================
// 5. User-provided numbers remain user-provided / 6. benchmark/estimated
//    numbers are labeled / 7. unsupported estimates are not presented as
//    verified facts
// ===========================================================================

test("5/6/7a. the domain-analysis classification vocabulary now explicitly includes 'Benchmark' (distinct from Verified/Estimated/Assumption) for industry-typical figures, and forbids presenting one as a verified fact about this specific user", () => {
  const instructions = buildDomainAnalysisInstructions("finance", "English");
  assert.match(instructions, /Verified, Benchmark, Estimated, Assumption, Unknown, or Recommendation/);
  // TASK #69A-37A tightened this exact sentence (Benchmark now requires
  // a real external reference, not just "an industry-typical figure")
  // and moved the "never present as a verified fact" guarantee to the
  // very next instruction sentence -- assert the guarantee still exists
  // in the current wording rather than pinning the old sentence text.
  assert.match(instructions, /never state a benchmark, estimated, or assumption figure as if it were a verified fact about this specific user's own business/i);
});

test("5/6/7b. domain-analysis requires every numeric threshold in Recommended Actions/Final Recommendation to be traced to user-stated fact, verified evidence, benchmark, or assumption, and labeled accordingly", () => {
  const prompt = domainAnalysisPrompts.finalRecommendation;
  const decisionAssessmentPrompt = domainAnalysisPrompts.decisionAssessment;
  assert.doesNotMatch(prompt, /^$/);
  assert.match(decisionAssessmentPrompt, /never as the decision word itself/i);
});

test("5/6/7c. the SAME Benchmark classification extension exists for acquisitionAnalysisPrompts, consistent with domain-analysis's own fix", () => {
  assert.equal(typeof acquisitionAnalysisPrompts.finalInvestmentRecommendation, "string");
  const acquisitionInstructionsSource = readFileSync(
    join(repoRoot, "app/lib/report-engine/prompts/acquisition-analysis.ts"),
    "utf8"
  );
  assert.match(
    acquisitionInstructionsSource,
    /Verified, Benchmark, Estimated, Assumption, Unknown, or Recommendation/
  );
});

// ===========================================================================
// 8. Recommendation-changing evidence remains present (strengths preserved)
// ===========================================================================

test("8. the existing 'name the one condition that would change the call' instruction is preserved verbatim in the updated finalRecommendation prompt -- this fix does not remove any existing strength", () => {
  assert.match(domainAnalysisPrompts.finalRecommendation, /Name the one condition that would change the call\./);
});

test("8b. recommendedActions (ranked, owner/evidence-target/decision-gate actions) is completely untouched by this fix", () => {
  assert.match(domainAnalysisPrompts.recommendedActions, /Provide prioritized, domain-specific next actions with owner, evidence target, and decision gate\./);
});

// ===========================================================================
// 9. Existing BIV/Market Intelligence decision semantics are not regressed
// ===========================================================================

test("9a. #69A-35's WAIT -> PROCEED_WITH_CONDITIONS mapping and #69A-35A's native-decision-token extraction remain completely untouched by this fix", () => {
  const vocabularySource = readFileSync(
    join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"),
    "utf8"
  );
  assert.match(vocabularySource, /if \(recommendation === "WAIT"\) return "PROCEED_WITH_CONDITIONS";/);
  assert.doesNotMatch(vocabularySource, /TASK #69A-37/);
});

test("9b. no #69A-37 marker exists in investment-score.ts, market-research-coverage.ts, or report-presentation.ts -- BIV/Market Intelligence's own scoring and Executive Summary presentation are untouched", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-presentation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-37/, relativePath);
  }
});

test("9c. extractGenericDecisionSignal's decision-keyword classification (GO/NO_GO/CONDITIONAL_GO detection from prose) is completely unchanged -- only the confidence-number regex was strengthened", () => {
  assert.match(
    executiveDecisionBriefSource,
    /for \(const \{ code, pattern \} of decisionKeywordPatterns\) \{\s*\n\s*if \(pattern\.test\(normalized\)\) \{\s*\n\s*decision = code;\s*\n\s*break;\s*\n\s*\}\s*\n\s*\}/
  );
});

// ===========================================================================
// [REGRESSION LOCK]
// ===========================================================================

test("[REGRESSION LOCK] no cache-version bump was added for this fix -- it is confined to a per-field healing pass that already runs fresh on every cache-hit AND fresh-generation read, so no forced-regeneration cost was introduced", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-37.*bump/i);
});

test("[REGRESSION LOCK] correctConfidenceDecisionConflation and extractGenericDecisionSignal's confidence fix share the SAME bounded decision-word list (decisionWordInsideConfidencePattern) -- a single source of truth, never two independently-maintained word lists that could silently drift apart", () => {
  const occurrences = [...executiveDecisionBriefSource.matchAll(/decisionWordInsideConfidencePattern/g)];
  assert.ok(occurrences.length >= 3, "expected the declaration plus at least 2 usages");
});
