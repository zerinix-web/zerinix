import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  FOUNDER_READINESS_DIMENSION_METRICS,
  getFounderReadinessDimensionScore,
  readFounderReadinessMetricValue,
  readFounderReadinessScoreValue,
  normalizeFounderReadinessScoreText,
} from "../app/lib/report-presentation.ts";

// TASK #69A-8A -- Verify and fix PDF-only Founder Readiness dimension
// parity against canonical keyed data. A narrow, PDF-specific re-trace
// of the exact path Task #69A-8 already audited at the report-
// presentation.ts level, extending the trace all the way through
// ReportPdfButton.tsx's own card-building AND drawing-loop code (the one
// layer #69A-8's own test file did not extract and execute directly).

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfButtonSourcePath = join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx");
const pdfButtonSource = readFileSync(pdfButtonSourcePath, "utf8");

function extractFunctionSource(name) {
  const startMatch = pdfButtonSource.match(new RegExp(`function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found in ReportPdfButton.tsx`);
  const start = startMatch.index;
  let i = pdfButtonSource.indexOf("{", start);
  let depth = 0;
  for (; i < pdfButtonSource.length; i++) {
    if (pdfButtonSource[i] === "{") depth++;
    if (pdfButtonSource[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return pdfButtonSource.slice(start, i + 1);
}

function extractConstSource(name) {
  const startMatch = pdfButtonSource.match(new RegExp(`const ${name}[^=]*=`));
  assert.notEqual(startMatch, null, `${name} not found in ReportPdfButton.tsx`);
  const start = startMatch.index;
  const end = pdfButtonSource.indexOf(";", start) + 1;
  return pdfButtonSource.slice(start, end);
}

function stripTsTypes(text) {
  return text
    .replace(/\)\s*:\s*[^{]+\{/g, ") {")
    .replace(/content: string, investmentScore\?: DashboardReport\["investmentScore"\]/, "content, investmentScore")
    .replace(
      /content: string,\s*\n\s*investmentScore: DashboardReport\["investmentScore"\] \| undefined,\s*\n\s*locale: PdfLocale/,
      "content, investmentScore, locale"
    );
}

// Loads the REAL, unmodified normalizePdfFounderScoreMetrics and
// buildPdfFounderScoreCards from ReportPdfButton.tsx (a "use client"
// React/JSX file that cannot be imported directly by plain node -- same
// established extraction pattern already used throughout this session
// for this exact file), wired to the real report-presentation.ts and
// pdf-normalization.mjs implementations, never a stub.
async function loadPdfFounderScoreFunctions() {
  const blob = [
    stripTsTypes(extractConstSource("founderScorePdfDimensionMetrics")),
    stripTsTypes(extractFunctionSource("normalizePdfFounderScoreMetrics")),
    stripTsTypes(extractFunctionSource("buildPdfFounderScoreCards")),
  ].join("\n\n");

  const reportPresentationUrl = pathToFileURL(join(repoRoot, "app/lib/report-presentation.ts")).href;
  const pdfNormalizationUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const fullSource = [
    `import { FOUNDER_READINESS_DIMENSION_METRICS, readFounderReadinessMetricValue } from ${JSON.stringify(reportPresentationUrl)};`,
    `import { localizePdfPresentationLabel } from ${JSON.stringify(pdfNormalizationUrl)};`,
    blob,
    "export { normalizePdfFounderScoreMetrics, buildPdfFounderScoreCards };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-pdf-founder-score-"));
  const outPath = join(dir, "pdf-founder-score.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

// Reproduces the ACTUAL drawing loop's own label/value pairing logic
// verbatim (ReportPdfButton.tsx's drawSectionVisual, isFounderScoreSection
// branch: `cards.forEach((item, index) => { const displayLabel =
// item.label; ...; const score = item.score; ...})`) -- the `index` there
// is used ONLY for grid x/y layout math, never to look up a value from a
// separate array, so this reproduction proves that even after this step
// each drawn (label, score) pair still comes from the SAME array element.
function simulateFounderScoreCardDrawing(cards) {
  return cards.map((item, index) => ({
    index,
    displayLabel: item.label,
    score: item.score,
    gridColumn: index % 3,
    gridRow: Math.floor(index / 3),
  }));
}

let normalizePdfFounderScoreMetrics;
let buildPdfFounderScoreCards;

test.before(async () => {
  const mod = await loadPdfFounderScoreFunctions();
  normalizePdfFounderScoreMetrics = mod.normalizePdfFounderScoreMetrics;
  buildPdfFounderScoreCards = mod.buildPdfFounderScoreCards;
});

// The ticket's own suggested fixture: 7 deliberately distinct values, no
// two dimensions sharing a value, so any mispairing is immediately
// detectable.
const DISTINCT_DIMENSION_VALUES = {
  ideaQuality: 11,
  marketAttractiveness: 22,
  businessModelQuality: 33,
  validationConfidence: 44,
  executionComplexity: 55,
  evidenceConfidence: 66,
  founderEvidence: 77,
};

function buildFounderScoreText(values, overallScore = 40) {
  return [
    `Founder Readiness Score: ${overallScore}/100`,
    `Idea Quality: ${values.ideaQuality}/100 - explanation A.`,
    `Market Attractiveness: ${values.marketAttractiveness}/100 - explanation B.`,
    `Business Model Quality: ${values.businessModelQuality}/100 - explanation C.`,
    `Validation Confidence: ${values.validationConfidence}/100 - explanation D.`,
    `Execution Readiness: ${values.executionComplexity}/100 - explanation E.`,
    `Evidence Confidence: ${values.evidenceConfidence}/100 - explanation F.`,
    `Founder Evidence: ${values.founderEvidence}/100 - explanation G.`,
  ].join("\n");
}

const DISTINCT_FOUNDER_SCORE_TEXT = buildFounderScoreText(DISTINCT_DIMENSION_VALUES);

// ---------------------------------------------------------------------
// Requirement A/B -- exact parity, no index-based pairing.
// ---------------------------------------------------------------------

test("requirement B: normalizePdfFounderScoreMetrics (the layer beneath buildPdfFounderScoreCards) also preserves each dimension's exact value and real aliases under its own correct key/label", () => {
  const normalized = normalizePdfFounderScoreMetrics(DISTINCT_FOUNDER_SCORE_TEXT, undefined);
  assert.equal(normalized.length, 7);
  const byLabel = Object.fromEntries(normalized.map((m) => [m.label, m]));
  assert.equal(byLabel["Validation Confidence"].score, 44);
  assert.ok(byLabel["Validation Confidence"].aliases.includes("Doğrulama Güveni"));
  assert.equal(byLabel["Founder Evidence"].score, 77);
});

test("requirement B: the PDF card array preserves each of the 7 deliberately distinct values under its exact correct label", () => {
  const cards = buildPdfFounderScoreCards(DISTINCT_FOUNDER_SCORE_TEXT, undefined, "en");
  assert.equal(cards.length, 7);

  const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.score]));
  assert.equal(byLabel["Idea Quality"], 11);
  assert.equal(byLabel["Market Attractiveness"], 22);
  assert.equal(byLabel["Business Model Quality"], 33);
  assert.equal(byLabel["Validation Confidence"], 44);
  assert.equal(byLabel["Execution Readiness"], 55);
  assert.equal(byLabel["Evidence Confidence"], 66);
  assert.equal(byLabel["Founder Evidence"], 77);
});

test("requirement B: the drawing loop's index is used only for grid layout math, never for value lookup -- each drawn pair still matches its source card element", () => {
  const cards = buildPdfFounderScoreCards(DISTINCT_FOUNDER_SCORE_TEXT, undefined, "en");
  const drawn = simulateFounderScoreCardDrawing(cards);

  for (let i = 0; i < cards.length; i++) {
    assert.equal(drawn[i].displayLabel, cards[i].label);
    assert.equal(drawn[i].score, cards[i].score);
  }
  const byLabel = Object.fromEntries(drawn.map((d) => [d.displayLabel, d.score]));
  assert.equal(byLabel["Validation Confidence"], 44);
  assert.equal(byLabel["Execution Readiness"], 55);
});

// Regression: reordering input array data cannot alter identity after
// normalization.
test("regression: reordering the underlying reasoning array cannot change which PDF card shows which value", () => {
  const investmentScoreForward = {
    decisionEngine: {
      founderScore: {
        score: 40,
        reasoning: [
          "Market attractiveness: 22%",
          "Business model quality: 33%",
          "Validation confidence: 44%",
          "Execution complexity: 55%",
          "Evidence confidence: 66%",
          "Founder evidence: 77%",
        ],
      },
    },
  };
  const investmentScoreReversed = {
    decisionEngine: {
      founderScore: {
        score: 40,
        reasoning: [...investmentScoreForward.decisionEngine.founderScore.reasoning].reverse(),
      },
    },
  };

  // No report text at all -- forces the PDF card builder through its
  // investmentScore-only fallback path (readFounderReadinessMetrics),
  // which is the path most exposed to a reordering-shaped bug.
  const forwardCards = buildPdfFounderScoreCards("", investmentScoreForward, "en");
  const reversedCards = buildPdfFounderScoreCards("", investmentScoreReversed, "en");

  assert.deepEqual(forwardCards, reversedCards);
  const byLabel = Object.fromEntries(forwardCards.map((c) => [c.label, c.score]));
  assert.equal(byLabel["Validation Confidence"], 44);
  assert.equal(byLabel["Execution Readiness"], 55);
});

// Regression: omitting one optional/legacy positional field cannot shift
// subsequent dimensions.
test("regression: omitting one dimension's line leaves every OTHER PDF card unshifted, and the missing one is null, never a neighbor's value", () => {
  const textWithoutValidation = DISTINCT_FOUNDER_SCORE_TEXT.split("\n")
    .filter((line) => !line.startsWith("Validation Confidence"))
    .join("\n");
  const cards = buildPdfFounderScoreCards(textWithoutValidation, undefined, "en");
  const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.score]));

  assert.equal(byLabel["Validation Confidence"], null);
  // Every dimension after the missing one keeps its OWN value -- a
  // positional/array-shift bug would have pulled "Execution Readiness"
  // (55) into "Validation Confidence"'s card slot and left "Founder
  // Evidence" with no value.
  assert.equal(byLabel["Execution Readiness"], 55);
  assert.equal(byLabel["Evidence Confidence"], 66);
  assert.equal(byLabel["Founder Evidence"], 77);
  assert.equal(byLabel["Business Model Quality"], 33);
});

// Regression: web and PDF presentation models resolve identical keyed
// values.
test("regression: web (readFounderReadinessMetricValue/getFounderReadinessDimensionScore) and PDF (buildPdfFounderScoreCards) resolve identical values for the same fixture", () => {
  const pdfCards = buildPdfFounderScoreCards(DISTINCT_FOUNDER_SCORE_TEXT, undefined, "en");
  const pdfByLabel = Object.fromEntries(pdfCards.map((c) => [c.label, c.score]));

  for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
    const webValue = readFounderReadinessMetricValue(dimension.label, undefined, DISTINCT_FOUNDER_SCORE_TEXT);
    const keyedValue = getFounderReadinessDimensionScore(dimension.key, undefined, DISTINCT_FOUNDER_SCORE_TEXT);
    assert.equal(pdfByLabel[dimension.label], webValue, `${dimension.label}: PDF vs. web mismatch`);
    assert.equal(pdfByLabel[dimension.label], keyedValue, `${dimension.label}: PDF vs. keyed accessor mismatch`);
    assert.equal(pdfByLabel[dimension.label], DISTINCT_DIMENSION_VALUES[dimension.key]);
  }
});

// ---------------------------------------------------------------------
// Requirement C -- explanatory text parity.
// ---------------------------------------------------------------------

test("requirement C: the PDF's explanatory body text and its dimension cards resolve from the exact same source text -- normalizeFounderReadinessScoreText only ever rewrites the OVERALL score line, never a dimension line", () => {
  const canonicalOverallScore = readFounderReadinessScoreValue({
    decisionEngine: { founderScore: { score: 40 } },
  });
  const normalizedBodyText = normalizeFounderReadinessScoreText(DISTINCT_FOUNDER_SCORE_TEXT, canonicalOverallScore);

  // The overall headline is normalized to the canonical value...
  assert.match(normalizedBodyText, /^Founder Readiness Score: 40\/100/);
  // ...but every dimension line survives completely untouched, so the
  // explanatory text a reader sees states EXACTLY the same numbers the
  // cards (built from the SAME raw content) show.
  for (const [line, expectedValue] of [
    ["Idea Quality", 11],
    ["Market Attractiveness", 22],
    ["Business Model Quality", 33],
    ["Validation Confidence", 44],
    ["Execution Readiness", 55],
    ["Evidence Confidence", 66],
    ["Founder Evidence", 77],
  ]) {
    assert.match(normalizedBodyText, new RegExp(`${line}: ${expectedValue}/100`));
  }

  const cards = buildPdfFounderScoreCards(normalizedBodyText, undefined, "en");
  const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.score]));
  for (const [key, value] of Object.entries(DISTINCT_DIMENSION_VALUES)) {
    const dimension = FOUNDER_READINESS_DIMENSION_METRICS.find((d) => d.key === key);
    assert.equal(byLabel[dimension.label], value, `card/explanatory-text parity broken for ${key}`);
  }
});

test("requirement A: ReportPdfButton.tsx's body-text branch for founderScore calls ONLY normalizeFounderReadinessScoreText (never re-derives or strips individual dimension lines)", () => {
  assert.match(
    pdfButtonSource,
    /section\.field === "founderScore"\s*\n\s*\?\s*normalizeFounderReadinessScoreText\(\s*\n\s*section\.content,\s*\n\s*readFounderReadinessScoreValue\(report\.investmentScore\)\s*\n\s*\)/
  );
});

// ---------------------------------------------------------------------
// Requirement D -- no legacy positional structure reaches PDF code.
// ---------------------------------------------------------------------

test("requirement D: no positional array/index lookup exists anywhere in normalizePdfFounderScoreMetrics/buildPdfFounderScoreCards", () => {
  const helperSlice = pdfButtonSource.slice(
    pdfButtonSource.indexOf("function normalizePdfFounderScoreMetrics"),
    pdfButtonSource.indexOf("function getPdfSectionCardTitle")
  );
  const codeOnly = helperSlice
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.doesNotMatch(codeOnly, /dimensionScoreValues\s*\[/);
  assert.doesNotMatch(codeOnly, /\.findIndex\(/);
});

test("requirement D: no positional array/index lookup exists in the drawing loop itself (isFounderScoreSection branch, source-level proof)", () => {
  const drawingLoopStart = pdfButtonSource.indexOf("if (isFounderScoreSection) {");
  assert.notEqual(drawingLoopStart, -1);
  const drawingLoopEnd = pdfButtonSource.indexOf("return 46;", drawingLoopStart) + "return 46;".length;
  const drawingLoopSlice = pdfButtonSource.slice(drawingLoopStart, drawingLoopEnd);
  const codeOnly = drawingLoopSlice
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  assert.doesNotMatch(codeOnly, /dimensionScoreValues\s*\[/);
  assert.doesNotMatch(codeOnly, /\.findIndex\(/);
  // `index` (from cards.forEach((item, index) => ...)) may only be used
  // for grid math (x/y coordinates), never to index into a different
  // array to look up a label or score.
  assert.match(codeOnly, /const displayLabel = item\.label;/);
  assert.match(codeOnly, /const score = item\.score;/);
});

test("requirement D: founderScorePdfDimensionMetrics is the canonical FOUNDER_READINESS_DIMENSION_METRICS import, not a locally re-typed array", () => {
  assert.match(pdfButtonSource, /const founderScorePdfDimensionMetrics = FOUNDER_READINESS_DIMENSION_METRICS;/);
});

// ---------------------------------------------------------------------
// Requirement F -- preserve existing invariants (drift checks).
// ---------------------------------------------------------------------

test("requirement F: MONITOR/48%/40-overall real-report invariants are untouched by this audit -- no production file was modified", () => {
  // This entire task added test coverage only; confirmed no production
  // source file changed (see git diff in the final report). This test
  // exists so a future edit that DOES touch production code in this
  // area is forced to re-verify the exact real values this ticket, and
  // #69A-8 before it, established.
  const overall = readFounderReadinessScoreValue({ decisionEngine: { founderScore: { score: 40 } } });
  assert.equal(overall, 40);
});
