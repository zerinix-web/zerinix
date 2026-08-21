import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// FINAL PRODUCTION FIX -- Founder Readiness score binding consistency.
//
// Confirmed live (airport ground-handling Business Plan report): the
// Founder Readiness Dimensions score cards (read via
// readFounderReadinessMetricValue, app/lib/report-presentation.ts) and
// the explanatory prose text below them (built by
// extractFounderDimensionExplanation inside buildCanonicalFounderScore,
// app/lib/report-jobs/plan-executor.ts) both derive from the SAME single
// source of truth -- the deterministic decision engine's founderScore
// dimension numbers -- but extractFounderDimensionExplanation's own
// "skip past the model's own restated score" regex only recognized the
// canonical "NN/100"/"NN%" shape. When the model restated its own score
// in a different phrasing ("55 out of 100 - ...", "scored 55 out of a
// possible 100 ..."), that phrasing wasn't recognized as a score to skip,
// so the model's own (frequently different) number was captured as part
// of the "explanation" and spliced directly next to the real,
// deterministic score -- e.g. "Market Attractiveness: 75/100 - 55 out of
// 100 - The market shows...", which reads to a person as the card (75)
// and the narrative (55) disagreeing, even though only one number (75)
// -- the deterministic one -- ever actually drove either.
//
// The fix widens the pre-capture score-skip patterns AND adds a
// defensive post-capture strip, so no phrasing of the model's own
// restated score can ever again survive into the visible explanation
// text. This test guarantees that invariant: for every dimension, the
// number shown in the explanation text (if any) must always equal the
// deterministic score card value -- it must never be a second, different
// number.

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  const sanitizationPath = join(repoRoot, "app/lib/report-output-sanitization.ts");
  const investmentScorePath = join(repoRoot, "app/lib/report-investment-score.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(sanitizationPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-investment-score"',
    JSON.stringify(pathToFileURL(investmentScorePath).href)
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

const { readFounderReadinessMetricValue } = await importReportPresentation();

// Mirrors plan-executor.ts's extractFounderDimensionExplanation exactly
// (heavy Supabase/auth dependencies elsewhere in that file prevent clean
// direct import -- established convention for this file elsewhere in
// this suite). Kept in sync with the real implementation via the
// drift-check test below.
const FOUNDER_DIMENSION_STOP_LABELS = [
  "Idea Quality",
  "Market Attractiveness",
  "Business Model Quality",
  "Validation Confidence",
  "Execution Complexity",
  "Evidence Confidence",
  "Founder Evidence",
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

// Mirrors buildCanonicalFounderScore's own line construction exactly:
// `${label}: ${deterministicScore}/100 - ${explanation}`.
function buildDimensionLine(label, deterministicScore, explanation) {
  return `${label}: ${deterministicScore}/100 - ${explanation}`;
}

// Asserts the single binding invariant this whole fix exists to
// guarantee: whatever number the card reads (via
// readFounderReadinessMetricValue, the real production function) must
// equal the deterministic score, AND the explanation text must never
// itself start with a different, competing number.
function assertCardMatchesNarrative(label, deterministicScore, modelRawExplanation) {
  const explanation = extractFounderDimensionExplanation(
    `${label}: ${modelRawExplanation}`,
    label
  );
  const fullLine = buildDimensionLine(label, deterministicScore, explanation);
  const cardScore = readFounderReadinessMetricValue(label, undefined, fullLine);

  assert.equal(cardScore, deterministicScore, `${label}: card score diverged from the deterministic score`);
  assert.doesNotMatch(
    explanation,
    /^\d{1,3}\s*(?:\/\s*100|%|out\s+of)/i,
    `${label}: explanation text starts with a second, competing number`
  );

  return { cardScore, explanation, fullLine };
}

// --- The exact live bug: model restates its score as "NN out of 100" ---

test("Market Attractiveness: card and narrative agree even when the model restates its score as 'NN out of 100' (the exact live bug, airport ground-handling report)", () => {
  const { cardScore, explanation, fullLine } = assertCardMatchesNarrative(
    "Market Attractiveness",
    75,
    "55 out of 100 - The market shows strong potential given clear customer pain points and growing demand."
  );

  assert.equal(cardScore, 75);
  assert.doesNotMatch(explanation, /55/);
  assert.doesNotMatch(fullLine, /55 out of 100/);
});

test("Business Model Quality: card and narrative agree when the model restates its score as 'scored NN out of a possible 100'", () => {
  const { cardScore, explanation } = assertCardMatchesNarrative(
    "Business Model Quality",
    32,
    "scored 60 out of a possible 100 based on recurring revenue potential and margin structure for ground-handling contracts."
  );

  assert.equal(cardScore, 32);
  assert.doesNotMatch(explanation, /^60\b/);
});

// --- Every dimension, generically -----------------------------------

for (const label of FOUNDER_DIMENSION_STOP_LABELS) {
  test(`${label}: card score always equals the deterministic score regardless of how the model phrases its own restated score`, () => {
    const phrasings = [
      [50, "70/100 - reasonable footing but requires validation before scaling further."],
      [50, "70 out of 100 - reasonable footing but requires validation before scaling further."],
      [50, "70% - reasonable footing but requires validation before scaling further."],
      [50, "70 (reasonable footing, requires validation before scaling further)."],
    ];

    for (const [deterministicScore, modelRawExplanation] of phrasings) {
      const { cardScore, explanation } = assertCardMatchesNarrative(
        label,
        deterministicScore,
        modelRawExplanation
      );
      assert.equal(cardScore, deterministicScore);
      assert.doesNotMatch(explanation, /^\d/);
    }
  });
}

// --- Previously-working canonical shapes still work (no regression) -----

test("previously-working canonical 'NN/100 -' phrasing is unaffected by the widened skip patterns", () => {
  const { cardScore, explanation } = assertCardMatchesNarrative(
    "Idea Quality",
    58,
    "58/100 - focused vertical with clear pain and a validated path to revenue."
  );

  assert.equal(cardScore, 58);
  assert.equal(explanation, "focused vertical with clear pain and a validated path to revenue.");
});

test("a bare-number-plus-parenthetical phrasing ('NN (...)') is unaffected by the widened skip patterns", () => {
  const { cardScore, explanation } = assertCardMatchesNarrative(
    "Business Model Quality",
    77,
    "77 (recurring SaaS with upsell, strong margin structure, and a clear expansion motion)."
  );

  assert.equal(cardScore, 77);
  assert.match(explanation, /^\(recurring SaaS/);
});

// --- Drift check: the real source matches what this test mirrors --------

test("plan-executor.ts's extractFounderDimensionExplanation contains the widened score-skip patterns and the defensive post-capture strip (drift check)", () => {
  const fnMatch = /function extractFounderDimensionExplanation\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "extractFounderDimensionExplanation not found");
  assert.match(fnMatch[0], /out\\s\+of\\s\+\(\?:a\\s\+possible\\s\+\)\?100/);
  assert.match(fnMatch[0], /scored\\s\+\|scoring\\s\+\|rated\\s\+\|rating\\s\+of\\s\+/);
  assert.match(
    fnMatch[0],
    /explanation\s*=\s*explanation\s*\n?\s*\.replace\(/,
    "the defensive post-capture strip is missing"
  );
});

test("readFounderReadinessMetricValue (app/lib/report-presentation.ts) still prioritizes the rendered text over investmentScore, so the card and the visible narrative can never silently diverge (drift check)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
  const fnMatch = /export function readFounderReadinessMetricValue\([\s\S]*?\n\}/.exec(source);
  assert.ok(fnMatch, "readFounderReadinessMetricValue not found");
  assert.match(fnMatch[0], /const textValue = readFounderReadinessTextMetric\(content, label\);/);
  assert.match(fnMatch[0], /if \(textValue !== null\) \{\s*\n\s*return textValue;/);
});
