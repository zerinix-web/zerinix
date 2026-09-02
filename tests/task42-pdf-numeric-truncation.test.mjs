import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #42 -- Eliminate unintended text truncation across Market
// Intelligence PDF output.
//
// ROOT CAUSE (confirmed via full lifecycle trace): extractMarketSizeAssumption
// and extractForceImplication (each duplicated identically across
// page.tsx, ReportPdfButton.tsx, and Planner.tsx) read a layer/force's
// own "assumption"/"implication" sentence back out of the report's raw
// text using a regex shaped `[^.\n]*\bLABEL\b[^.\n]*\.` -- a character
// class that excludes EVERY period, with no concept of a decimal point.
// For "TAM: $1.5B is the total addressable market...", the decimal point
// inside "$1.5B" itself was mistaken for the sentence's own terminating
// period, silently cutting the match down to the exact reported defect:
// "TAM: $1." -- discarding "5B is the total addressable market..."
// entirely, with no ellipsis or visual cue that anything was cut.
//
// The SAME vulnerable pattern shape also existed in
// extractRecommendationSignals' own "gate" (Decision Gate) extraction
// (app/lib/report-presentation.ts, a single shared module, not
// duplicated), which could equally truncate a real decimal figure named
// inside a recommendation's own gate condition.
//
// FIX: every one of these regexes now uses a locally-defined
// sentenceSafeSegmentPattern -- `(?:[^.\n]|(?<=\d)\.(?=\d))*` -- which
// treats a period as "safe to continue past" ONLY when it sits directly
// between two digits (a genuine decimal point, via lookbehind/lookahead).
// A real sentence-ending period (never preceded-and-followed by digits)
// still terminates the match exactly as before -- this never widens a
// match past a genuine sentence boundary, only stops it from stopping
// early at a number's own decimal point.

const readSourceFile = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");
const reportPresentationSource = readSourceFile("../app/lib/report-presentation.ts");

// Extracts the REAL, live sentenceSafeSegmentPattern string from a given
// source file (rather than reimplementing it), so the behavioral tests
// below exercise the actual production regex text, not a hand-copied
// approximation that could silently drift from what ships.
function extractSentenceSafeSegmentPattern(source, fileName) {
  const match = source.match(/const sentenceSafeSegmentPattern = "((?:[^"\\]|\\.)*)";/);
  assert.ok(match, `${fileName}: expected to find a sentenceSafeSegmentPattern declaration`);
  // The captured text is the RAW source between the quotes (e.g. the
  // literal 4 characters `\`, `\`, `n` as written in the .tsx file's own
  // JS string escaping) -- JSON.parse applies the exact same escaping
  // rules a JS string literal uses, unescaping it down to the real
  // pattern string (e.g. a single `\n`) the running code actually sees.
  return JSON.parse(`"${match[1]}"`);
}

function buildLabelSentenceRegex(pattern, label) {
  return new RegExp(`${pattern}\\b${label}\\b${pattern}\\.`, "i");
}

// --- Root cause: "$1.5B" cannot become "$1." -----------------------

for (const [fileLabel, source] of [
  ["page.tsx", dashboardReportSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
]) {
  const pattern = extractSentenceSafeSegmentPattern(source, fileLabel);

  test(`TASK #42 [${fileLabel}]: 'TAM: $1.5B is the total addressable market.' resolves to the COMPLETE sentence, never truncating to 'TAM: $1.'`, () => {
    const regex = buildLabelSentenceRegex(pattern, "TAM");
    const result = "TAM: $1.5B is the total addressable market for this segment.".match(regex)?.[0];
    assert.equal(result, "TAM: $1.5B is the total addressable market for this segment.");
    assert.notEqual(result, "TAM: $1.");
  });

  test(`TASK #42 [${fileLabel}]: a currency RANGE (e.g. "$2.1-2.8B") inside the sentence remains fully intact`, () => {
    const regex = buildLabelSentenceRegex(pattern, "TAM");
    const result = "TAM: $2.1-2.8B range applies across named enterprise segments.".match(regex)?.[0];
    assert.match(result, /\$2\.1-2\.8B/);
    assert.equal(result, "TAM: $2.1-2.8B range applies across named enterprise segments.");
  });

  test(`TASK #42 [${fileLabel}]: a percentage figure (e.g. "12.5%") inside the sentence remains fully intact`, () => {
    const regex = buildLabelSentenceRegex(pattern, "SOM");
    const result = "SOM is derived from a 12.5% obtainable-share assumption validated against named accounts.".match(regex)?.[0];
    assert.match(result, /12\.5%/);
    assert.doesNotMatch(result, /12\.$/);
  });

  test(`TASK #42 [${fileLabel}]: this pattern's fix does NOT widen the match past a genuine sentence boundary -- a real period (never preceded/followed by digits) still ends the match`, () => {
    const regex = buildLabelSentenceRegex(pattern, "TAM");
    const result = "The market is sized bottom-up. TAM: $1.5B applies here. A second, unrelated sentence follows.".match(regex)?.[0];
    assert.match(result, /TAM: \$1\.5B applies here\.$/);
    assert.doesNotMatch(result, /unrelated sentence/);
  });

  test(`TASK #42 [${fileLabel}]: a comparison operator (>=/<=) and threshold figure inside the sentence survive intact`, () => {
    const regex = buildLabelSentenceRegex(pattern, "SAM");
    const result = "SAM requires an obtainable share >= 5.5% to justify entry under this scenario.".match(regex)?.[0];
    assert.match(result, />= 5\.5%/);
  });
}

// --- STRUCTURAL AUDIT: no vulnerable pattern remains anywhere -------

test("STRUCTURAL AUDIT: the vulnerable raw '[^.\\n]*\\b...' pattern shape no longer appears in any of the 3 render sites", () => {
  const vulnerablePattern = /\[\^\.\\\\n\]\*\\\\b/;
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, vulnerablePattern, `${name}: the raw, decimal-unsafe pattern must not remain`);
  }
});

test("STRUCTURAL AUDIT: extractMarketSizeAssumption and extractForceImplication both use sentenceSafeSegmentPattern in all 3 render sites -- web and PDF can never structurally disagree on TAM/SAM/SOM or Porter's Five Forces assumption text", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const marketSizeFnMatch = source.match(/function extractMarketSizeAssumption\([\s\S]*?\n\}/);
    assert.ok(marketSizeFnMatch, `${name}: expected extractMarketSizeAssumption`);
    assert.match(marketSizeFnMatch[0], /sentenceSafeSegmentPattern/, `${name}: extractMarketSizeAssumption must use sentenceSafeSegmentPattern`);

    const forceFnMatch = source.match(/function extractForceImplication\([\s\S]*?\n\}/);
    assert.ok(forceFnMatch, `${name}: expected extractForceImplication`);
    assert.match(forceFnMatch[0], /sentenceSafeSegmentPattern/, `${name}: extractForceImplication must use sentenceSafeSegmentPattern`);
  }
});

test("STRUCTURAL AUDIT: all 3 render sites define an IDENTICAL sentenceSafeSegmentPattern -- web and PDF cannot disagree on where a sentence boundary actually is", () => {
  const patterns = [dashboardReportSource, pdfButtonSource, plannerSource].map((source, index) =>
    extractSentenceSafeSegmentPattern(source, ["page.tsx", "ReportPdfButton.tsx", "Planner.tsx"][index])
  );
  assert.equal(patterns[0], patterns[1]);
  assert.equal(patterns[1], patterns[2]);
});

// --- Recommendation budgets/gates do not lose numeric units ---------

test("TASK #42: extractRecommendationSignals' Decision Gate extraction preserves a full decimal figure named inside the gate condition, never truncating at the decimal point", () => {
  const signals = extractRecommendationSignals(
    "Run a mid-market pilot before committing further budget beyond $1.5M in this cycle."
  );
  assert.ok(signals.gate);
  assert.match(signals.gate, /\$1\.5M/);
  assert.doesNotMatch(signals.gate, /\$1$/);
});

test("TASK #42: extractRecommendationSignals' Decision Gate extraction preserves a full percentage figure named inside the gate condition", () => {
  const signals = extractRecommendationSignals(
    "Validate pricing before scaling further, targeting a 12.5% conversion lift across named accounts."
  );
  assert.ok(signals.gate);
  assert.match(signals.gate, /12\.5%/);
});

test("TASK #42: extractRecommendationSignals' budget/success-metric fields already preserve complete numeric units (regression check -- these were not part of the reported defect, confirmed still correct)", () => {
  const signals = extractRecommendationSignals(
    "Owner: Head of Sales; Budget cap: $75,000; Success criterion: 20% pilot conversion rate; before committing further budget beyond $75,000 in this cycle."
  );
  assert.equal(signals.budget, "$75,000");
  assert.equal(signals.metric, "20% pilot conversion rate");
});

// --- STRUCTURAL AUDIT: the shared extractRecommendationSignals fix ---

test("STRUCTURAL AUDIT: extractRecommendationSignals' gate regex no longer uses the vulnerable raw '[^.]*' shape", () => {
  const functionMatch = reportPresentationSource.match(/export function extractRecommendationSignals\([\s\S]*?\n\}/);
  assert.ok(functionMatch, "expected to find extractRecommendationSignals's own function body");
  assert.doesNotMatch(functionMatch[0], /\\b\[\^\.\]\*\//);
  assert.match(functionMatch[0], /\(\?<=\\d\)\\\.\(\?=\\d\)/);
});

// --- Long text may reflow, but numeric tokens cannot be partially clipped ---

test("TASK #42: a long, realistic assumption sentence with a decimal figure buried mid-sentence resolves completely -- reflow/length is not the concern this fix addresses, only mid-token clipping", () => {
  const pattern = extractSentenceSafeSegmentPattern(pdfButtonSource, "ReportPdfButton.tsx");
  const regex = buildLabelSentenceRegex(pattern, "TAM");
  const longSentence =
    "TAM (United States, 2026) is estimated at $1.5B, derived from a bottom-up analysis of named enterprise buyers benchmarked against three independently published industry reports covering the requested segment.";
  const result = longSentence.match(regex)?.[0];
  assert.equal(result, longSentence);
  assert.match(result, /\$1\.5B/);
});
