import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real, confirmed production bug (found via live report
// generation, not synthetic input): buildCanonicalFounderScore splices the
// deterministic engine's own 0-100 score together with an explanation
// extracted from the model's own founderScore free text. The model does
// not reliably put each dimension on its own line -- live testing showed
// it just as often writes the whole founderScore field as one continuous
// paragraph with dimensions separated by ". " or "; " instead of a
// newline (e.g. "Market Attractiveness: 53/100; Business Model Quality:
// 69/100; Validation Confidence: 30/100; ..."). The previous regex had
// two separate bugs against that shape:
//   1. The gap between the label and its own number was unbounded
//      ([^\n]*?), so on a failed local match it could skip straight past
//      several OTHER dimensions' labels and scores hunting for a distant
//      number+separator shape, attributing a completely unrelated
//      dimension's explanation to this one.
//   2. The captured explanation itself was bounded only by newline/320
//      chars, so with no newline between dimensions it ran straight
//      through the next dimension's own label and score, producing
//      "explanations" that were really 2-4 dimensions concatenated
//      together with a leftover score number glued onto the canonical
//      score ("Business Model Quality: 62/100 - 32/100 - ...").
//
// The fix guards every character consumed after the label (both the gap
// and the capture) against starting another known dimension label, and
// replaces the old "must find a second separator" requirement with an
// explicit, optional score+trailing-punctuation skip -- covering shapes
// like "32/100 (regulatory + integration)" where a parenthetical, not a
// dash/colon, follows the model's own number.
//
// Tested via a faithful mirror of the real regex, copied verbatim from
// the source below the drift-detection assertion, matching this
// codebase's established convention for plan-executor.ts (heavy
// Supabase/auth dependencies prevent clean direct import).

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

const FOUNDER_DIMENSION_STOP_LABELS = [
  "Idea Quality",
  "Fikir Kalitesi",
  "Market Attractiveness",
  "Pazar Çekiciliği",
  "Business Model Quality",
  "İş Modeli Kalitesi",
  "Validation Confidence",
  "Doğrulama Güveni",
  "Execution Complexity",
  "Yürütme Karmaşıklığı",
  "Evidence Confidence",
  "Kanıt Güveni",
  "Founder Evidence",
  "Kurucu Kanıtı",
  "Founder Readiness Score",
  "Aggregate Founder Readiness Score",
  "Overall Founder Readiness Score",
  "Kurucu Hazırlık Skoru",
];

function extractFounderDimensionExplanation(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stopLookahead = FOUNDER_DIMENSION_STOP_LABELS.filter(
    (other) => other.toLowerCase() !== label.toLowerCase()
  )
    .map((other) => other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const guardedChar = `(?:(?!${stopLookahead})[^\\n])`;
  const scoreSkip =
    `(?:(?:scored\\s+|scoring\\s+|rated\\s+|rating\\s+of\\s+)?\\d{1,3}\\s*(?:/\\s*100|%|out\\s+of\\s+(?:a\\s+possible\\s+)?100|points?)\\s*[-–—;:.,]*\\s*` +
    `|\\d{1,3}\\s*(?:[-–—;:.,]+\\s*|(?=\\()))?`;
  const match = new RegExp(
    `${escapedLabel}${guardedChar}*?[-–—:]\\s*${scoreSkip}(${guardedChar}{20,320})`,
    "i"
  ).exec(content);
  let explanation = match?.[1]?.trim().replace(/[.!?;]+\s*$/, "");

  if (explanation) {
    explanation = explanation
      .replace(
        /^(?:scored\s+|scoring\s+|rated\s+|rating\s+of\s+)?\d{1,3}\s*(?:\/\s*100|%|out\s+of\s+(?:a\s+possible\s+)?100|points?)\b[\s,;:\-–—]*/i,
        ""
      )
      .trim();
  }

  return explanation && explanation.length >= 20 ? `${explanation}.` : "";
}

test("mirrored extractFounderDimensionExplanation regex is present verbatim in the source (catches drift)", () => {
  assert.match(planExecutorSource, /function extractFounderDimensionExplanation\(content: string, label: string\) \{/);
  assert.ok(
    planExecutorSource.includes("const FOUNDER_DIMENSION_STOP_LABELS = ["),
    "the dimension stop-label list has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(
      "const guardedChar = `(?:(?!${stopLookahead})[^\\\\n])`;"
    ),
    "the stop-label guard has diverged from plan-executor.ts"
  );

  const fnMatch = /function extractFounderDimensionExplanation\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "extractFounderDimensionExplanation not found");
  const fnBody = fnMatch[0];

  // Score-skip must recognize the canonical "NN/100"/"NN%" shape AND the
  // wider phrasings a model restates its own score in ("NN out of 100",
  // "scored NN out of a possible 100", "NN points") -- see
  // founder-readiness-score-binding-consistency.test.mjs for the exact
  // live bug this widened pattern fixes.
  assert.match(fnBody, /out\\s\+of\\s\+\(\?:a\\s\+possible\\s\+\)\?100/, "the 'out of 100' score-skip alternative has diverged from plan-executor.ts");
  assert.match(fnBody, /scored\\s\+\|scoring\\s\+\|rated\\s\+\|rating\\s\+of\\s\+/, "the leading-verb score-skip alternative has diverged from plan-executor.ts");
  assert.match(fnBody, /points\?\)/, "the 'points' score-skip alternative has diverged from plan-executor.ts");
  assert.ok(
    fnBody.includes(
      "`${escapedLabel}${guardedChar}*?[-–—:]\\\\s*${scoreSkip}(${guardedChar}{20,320})`,"
    ),
    "the combined pattern has diverged from plan-executor.ts"
  );
  // Defensive post-capture strip: catches any restated score the
  // pre-capture skip above still doesn't anticipate.
  assert.match(fnBody, /explanation\s*=\s*explanation\s*\n?\s*\.replace\(/, "the defensive post-capture strip has diverged from plan-executor.ts");
});

test("does not swallow the model's own score number into the captured explanation", () => {
  const content =
    "Business Model Quality: 32/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.";
  const explanation = extractFounderDimensionExplanation(content, "Business Model Quality");

  assert.doesNotMatch(explanation, /^\d{1,3}\s*\/\s*100/);
  assert.doesNotMatch(explanation, /\d{1,3}\/100/);
  assert.match(explanation, /^The model depends on repeat purchase/);

  // The exact rendered line this feeds into must never contain two
  // different scores for the same dimension.
  const canonicalScore = 62;
  const renderedLine = `Business Model Quality: ${canonicalScore}/100 - ${explanation}`;
  const scoreMentions = renderedLine.match(/\d{1,3}\/100/g) || [];
  assert.equal(scoreMentions.length, 1, `expected exactly one score in the rendered line, found: ${scoreMentions.join(", ")}`);
});

test("still extracts the explanation correctly when the model wrote no score number at all", () => {
  const content =
    "Business Model Quality - The model depends on repeat purchase and disciplined margin management for durability.";
  const explanation = extractFounderDimensionExplanation(content, "Business Model Quality");

  assert.match(explanation, /^The model depends on repeat purchase/);
});

test("handles the number appearing before the colon instead of after it", () => {
  const content =
    "Evidence Confidence 30/100: Evidence remains directional until customer and pricing data are observed in the market.";
  const explanation = extractFounderDimensionExplanation(content, "Evidence Confidence");

  assert.doesNotMatch(explanation, /^\s*\d/);
  assert.match(explanation, /^Evidence remains directional/);
});

test("a real run-on founder-score paragraph (no newlines between dimensions) never bleeds one dimension's explanation into another", () => {
  // Captured verbatim from a live gpt-5-mini report generation.
  const content =
    "Idea Quality: 72/100 — idea addresses clear, high-value clinical problem with market tailwinds (evidence: R3,R56). " +
    "Validation Confidence: 30/100 — no paid pilots or buyer LOIs verified. " +
    "Founder Evidence: 25/100 — limited supplied founder data. " +
    "Market Attractiveness: 53/100; Business Model Quality: 69/100; Validation Confidence: 30/100; " +
    "Execution Complexity: 70/100 (regulatory + integration); Evidence Confidence: 33/100. " +
    "Aggregate Founder Readiness Score: 40/100 — indicates substantial execution and validation work required before investor commitment.";

  const ideaQuality = extractFounderDimensionExplanation(content, "Idea Quality");
  const validationConfidence = extractFounderDimensionExplanation(content, "Validation Confidence");
  const founderEvidence = extractFounderDimensionExplanation(content, "Founder Evidence");

  assert.match(ideaQuality, /^idea addresses clear, high-value clinical problem/);
  assert.match(validationConfidence, /^no paid pilots or buyer LOIs verified\.$/);
  assert.match(founderEvidence, /^limited supplied founder data\.$/);

  // Dimensions the model only gave a bare score for (no real prose before
  // the next dimension label) must fall back to the safe generic
  // explanation, never a fragment built from an unrelated dimension.
  for (const label of ["Market Attractiveness", "Business Model Quality", "Evidence Confidence"]) {
    const explanation = extractFounderDimensionExplanation(content, label);
    assert.doesNotMatch(
      explanation,
      /indicates substantial execution|no paid pilots|limited supplied founder|idea addresses clear/,
      `${label} must not borrow another dimension's explanation`
    );
  }

  // None of the seven dimensions may ever end up with a second score
  // number glued into its explanation.
  for (const label of [
    "Idea Quality",
    "Market Attractiveness",
    "Business Model Quality",
    "Validation Confidence",
    "Execution Complexity",
    "Evidence Confidence",
    "Founder Evidence",
  ]) {
    const explanation = extractFounderDimensionExplanation(content, label);
    assert.doesNotMatch(explanation, /\d{1,3}\/100/, `${label} explanation must not contain a bare score`);
  }
});

test("a bare score followed immediately by a parenthetical (no dash/colon separator) is still captured cleanly, without swallowing the number", () => {
  const content =
    "Execution Complexity: 70/100 (regulatory + integration); Evidence Confidence: 33/100.";
  const explanation = extractFounderDimensionExplanation(content, "Execution Complexity");

  assert.doesNotMatch(explanation, /\d{1,3}\/100/);
  assert.match(explanation, /regulatory \+ integration/);
});

test("a bare model-stated score with no /100 or % suffix is skipped, not swallowed into the explanation", () => {
  // Captured verbatim from a live gpt-5-mini report generation -- the
  // model restated its own score as a bare number ("70 —") rather than
  // the "70/100 —" shape the earlier fix's score-skip required, so the
  // bare number was captured as part of the explanation and rendered
  // as "Idea Quality: 63/100 - 70 — idea addresses...".
  const content =
    "Idea Quality: 70 — idea addresses real carrier pain and has scalable data-opportunity. " +
    "Validation Confidence: 30 — limited primary evidence; needs pilots. " +
    "Founder Evidence: 25 — low documented founder proof in supplied inputs.";

  const ideaQuality = extractFounderDimensionExplanation(content, "Idea Quality");
  const validationConfidence = extractFounderDimensionExplanation(content, "Validation Confidence");
  const founderEvidence = extractFounderDimensionExplanation(content, "Founder Evidence");

  assert.equal(ideaQuality, "idea addresses real carrier pain and has scalable data-opportunity.");
  assert.equal(validationConfidence, "limited primary evidence; needs pilots.");
  assert.equal(founderEvidence, "low documented founder proof in supplied inputs.");
  for (const explanation of [ideaQuality, validationConfidence, founderEvidence]) {
    assert.doesNotMatch(explanation, /^\d/, "explanation must not start with the model's own bare score number");
  }
});

test("an ordinary sentence that happens to start with a number (no separator immediately after) is never mistaken for a restated score", () => {
  const content =
    "Execution Complexity: 3 paid pilots signed by Q2 demonstrate strong operational traction across target regions.";
  const explanation = extractFounderDimensionExplanation(content, "Execution Complexity");

  assert.match(explanation, /^3 paid pilots signed by Q2/);
});

test("a model-written 'Overall Founder Readiness Score:' aside between two dimensions never bleeds into either dimension's explanation", () => {
  // Reproduces a real production bug found via live report generation:
  // the model wrote an unprompted "Overall Founder Readiness Score:
  // 47/100 — ..." aside between the Evidence Confidence and Founder
  // Evidence dimensions. Only "Founder Readiness Score" and "Aggregate
  // Founder Readiness Score" were on the stop-label list, so "Overall
  // Founder Readiness Score" wasn't recognized as a boundary -- the
  // Evidence Confidence capture ran straight through "requiring primary
  // validation." into "Overall ", leaving a truncated "Overall." on its
  // own orphaned line in the rendered report (the canonical builder's 8
  // lines became 9, with a single dangling word as its own line).
  const content =
    "Evidence Confidence: 41/100 — many financials are Estimated/AI Analysis requiring primary validation. " +
    "Overall Founder Readiness Score: 47/100 — indicates moderate readiness pending validation. " +
    "Founder Evidence: 25/100 — low documented sales/scale experience in supplied inputs.";

  const evidenceConfidence = extractFounderDimensionExplanation(content, "Evidence Confidence");
  const founderEvidence = extractFounderDimensionExplanation(content, "Founder Evidence");

  assert.equal(evidenceConfidence, "many financials are Estimated/AI Analysis requiring primary validation.");
  assert.equal(founderEvidence, "low documented sales/scale experience in supplied inputs.");
  assert.doesNotMatch(evidenceConfidence, /Overall/);
});

test("a bare model-stated score directly followed by a parenthetical, with no separator at all, is skipped rather than swallowed", () => {
  // Reproduces a real production bug found via live report generation:
  // "Business Model Quality: 77 (recurring SaaS with upsell)." and
  // "Execution Complexity: 30 (multi-state regulation integration)." --
  // the model's own bare score number (no "/100" suffix) sits directly
  // before a parenthetical with no dash/colon/etc separator in between,
  // a shape the punctuation-only second scoreSkip alternative couldn't
  // match. The result was the canonical score glued to a second copy of
  // itself: "Business Model Quality: 77/100 - 77 (recurring SaaS with
  // upsell)."
  const businessModel = extractFounderDimensionExplanation(
    "Business Model Quality: 77 (recurring SaaS with upsell).",
    "Business Model Quality"
  );
  const executionComplexity = extractFounderDimensionExplanation(
    "Execution Complexity: 30 (multi-state regulation integration).",
    "Execution Complexity"
  );

  assert.equal(businessModel, "(recurring SaaS with upsell).");
  assert.equal(executionComplexity, "(multi-state regulation integration).");
  assert.doesNotMatch(businessModel, /^\d/);
  assert.doesNotMatch(executionComplexity, /^\d/);
});
