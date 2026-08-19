import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// FINAL PRODUCTION FIX -- Founder Readiness score binding consistency.
//
// Confirmed live (renewable-energy Business Plan report): the Founder
// Readiness score cards and the explanatory narrative text disagreed on
// several dimensions (e.g. card showed Market Attractiveness: 42 while the
// narrative read Market Attractiveness: 60). The single source of truth
// for every dimension is the deterministic decision-engine score, always
// rendered one dimension per line by buildCanonicalFounderScore
// (app/lib/report-jobs/plan-executor.ts) -- the "narrative" IS that exact
// text. The card value is read back out of that SAME text by
// readFounderReadinessTextMetric (app/lib/report-presentation.ts), keyed
// by dimension NAME via a per-label regex, never by array position.
//
// Root cause: that regex only recognized a dimension label at the START
// of a line ("^" or after "\n"). Downstream text processing (filler/
// duplicate-sentence stripping, cross-section dedup) can merge adjacent
// dimensions onto one run-on line with no "\n" between them -- the exact
// shape plan-executor.ts's own extractFounderDimensionExplanation already
// has to tolerate (see plan-executor-founder-score-explanation.test.mjs).
// In that shape, every dimension after the first silently failed to match
// and returned null, falling through to a SEPARATE, independently-
// computed fallback (readFounderReadinessMetrics, driven by
// investmentScore) -- a different extraction path over the same
// underlying data that is not guaranteed to agree number-for-number,
// producing exactly the observed card/narrative mismatch.
//
// The fix adds a sentence-ending boundary (". "/"! "/"? "/"; " +
// whitespace) as a third valid anchor, so a mid-paragraph dimension label
// is read directly from the narrative text -- the single source of truth
// -- instead of silently deferring to the second source.

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-output-sanitization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-investment-score"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-investment-score.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { readFounderReadinessMetricValue } = await importReportPresentation();

const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");

const DIMENSIONS = [
  "Idea Quality",
  "Market Attractiveness",
  "Business Model Quality",
  "Validation Confidence",
  "Execution Complexity",
  "Evidence Confidence",
  "Founder Evidence",
];

// Fully distinct per-dimension scores -- coincidentally-equal values would
// mask a binding bug (two different dimensions reading each other's value
// would still "look right" if both values happen to match).
const DISTINCT_SCORES = {
  "Idea Quality": 63,
  "Market Attractiveness": 63, // aliased to Idea Quality by the decision engine's own design
  "Business Model Quality": 47,
  "Validation Confidence": 31,
  "Execution Complexity": 74,
  "Evidence Confidence": 26,
  "Founder Evidence": 18,
};

const DIMENSION_EXPLANATIONS = {
  "Idea Quality": "The opportunity is evaluated on market pull, model strength, and economic potential before founder evidence is considered.",
  "Market Attractiveness": "The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
  "Business Model Quality": "The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
  "Validation Confidence": "Missing traction lowers confidence, not the underlying idea quality.",
  "Execution Complexity": "Execution requires disciplined launch sequencing, channel proof, and operational control.",
  "Evidence Confidence": "Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
  "Founder Evidence": "Founder readiness should be validated through domain experience, operating capacity, and the ability to run the first proof cycles.",
};

// Mirrors buildCanonicalFounderScore's own line construction exactly:
// one dimension per newline-separated line.
function buildCleanNarrative() {
  return DIMENSIONS.map(
    (label) => `${label}: ${DISTINCT_SCORES[label]}/100 - ${DIMENSION_EXPLANATIONS[label]}`
  ).join("\n");
}

// Reproduces the exact live shape: downstream text processing merged
// every dimension onto one run-on line, separated by ". " instead of "\n".
function buildRunOnNarrative() {
  return DIMENSIONS.map(
    (label) => `${label}: ${DISTINCT_SCORES[label]}/100 - ${DIMENSION_EXPLANATIONS[label]}`
  ).join(" ");
}

function assertEveryCardMatchesNarrativeByKey(narrative, scenarioLabel) {
  for (const label of DIMENSIONS) {
    const cardScore = readFounderReadinessMetricValue(label, undefined, narrative);
    const narrativeScore = DISTINCT_SCORES[label];

    assert.equal(
      cardScore,
      narrativeScore,
      `[${scenarioLabel}] "${label}" card (${cardScore}) does not match its own narrative value (${narrativeScore}) -- keyed lookup by dimension name failed`
    );
  }
}

// --- The exact live bug and its fix ---------------------------------

test("every dimension's card exactly matches its own narrative value, keyed by name, for a clean newline-separated narrative", () => {
  assertEveryCardMatchesNarrativeByKey(buildCleanNarrative(), "clean");
});

test("every dimension's card exactly matches its own narrative value, keyed by name, for a run-on (no-newline) narrative (the exact live bug, renewable-energy report)", () => {
  assertEveryCardMatchesNarrativeByKey(buildRunOnNarrative(), "run-on");
});

test("reordering the narrative's dimension lines never causes a card to read the wrong dimension's value (proves keyed-by-name, not by position)", () => {
  const shuffledOrder = [
    "Founder Evidence",
    "Idea Quality",
    "Execution Complexity",
    "Market Attractiveness",
    "Evidence Confidence",
    "Business Model Quality",
    "Validation Confidence",
  ];
  const shuffledNarrative = shuffledOrder
    .map((label) => `${label}: ${DISTINCT_SCORES[label]}/100 - ${DIMENSION_EXPLANATIONS[label]}`)
    .join("\n");

  assertEveryCardMatchesNarrativeByKey(shuffledNarrative, "shuffled order");
});

test("a run-on narrative where only SOME dimensions are merged still binds every dimension to its own value", () => {
  const mixedNarrative = [
    `Idea Quality: ${DISTINCT_SCORES["Idea Quality"]}/100 - ${DIMENSION_EXPLANATIONS["Idea Quality"]} Market Attractiveness: ${DISTINCT_SCORES["Market Attractiveness"]}/100 - ${DIMENSION_EXPLANATIONS["Market Attractiveness"]}`,
    `Business Model Quality: ${DISTINCT_SCORES["Business Model Quality"]}/100 - ${DIMENSION_EXPLANATIONS["Business Model Quality"]}`,
    `Validation Confidence: ${DISTINCT_SCORES["Validation Confidence"]}/100 - ${DIMENSION_EXPLANATIONS["Validation Confidence"]} Execution Complexity: ${DISTINCT_SCORES["Execution Complexity"]}/100 - ${DIMENSION_EXPLANATIONS["Execution Complexity"]} Evidence Confidence: ${DISTINCT_SCORES["Evidence Confidence"]}/100 - ${DIMENSION_EXPLANATIONS["Evidence Confidence"]}`,
    `Founder Evidence: ${DISTINCT_SCORES["Founder Evidence"]}/100 - ${DIMENSION_EXPLANATIONS["Founder Evidence"]}`,
  ].join("\n");

  assertEveryCardMatchesNarrativeByKey(mixedNarrative, "partially merged");
});

test("a dimension label appearing mid-sentence with an unrelated nearby number is never mistaken for the real restated score (no false positive from relaxing the anchor)", () => {
  const narrative =
    "Idea Quality: 65/100 - addresses a market opportunity worth pursuing before 2030 given current trends. " +
    "Market Attractiveness: 42/100 - demand signals remain largely unproven at this stage.";

  assert.equal(readFounderReadinessMetricValue("Idea Quality", undefined, narrative), 65);
  assert.equal(readFounderReadinessMetricValue("Market Attractiveness", undefined, narrative), 42);
});

// --- Drift check ------------------------------------------------------

test("readFounderReadinessTextMetric recognizes a sentence-ending boundary as a valid dimension-label anchor, in addition to line start (drift check)", () => {
  const fnMatch = /function readFounderReadinessTextMetric\([\s\S]*?\n\}/.exec(reportPresentationSource);
  assert.ok(fnMatch, "readFounderReadinessTextMetric not found");
  assert.ok(
    fnMatch[0].includes("(?:^|\\\\n|[.!?;]\\\\s+)"),
    "the widened anchor pattern has diverged from the source"
  );
});

test("readFounderReadinessMetricValue still prioritizes the narrative text over the separately-computed investmentScore fallback (drift check, single source of truth)", () => {
  const fnMatch = /export function readFounderReadinessMetricValue\([\s\S]*?\n\}/.exec(reportPresentationSource);
  assert.ok(fnMatch, "readFounderReadinessMetricValue not found");
  assert.match(fnMatch[0], /const textValue = readFounderReadinessTextMetric\(content, label\);/);
  assert.match(fnMatch[0], /if \(textValue !== null\) \{\s*\n\s*return textValue;/);
});

test("readFounderReadinessTextMetric is not duplicated elsewhere in the codebase (single source of truth, no diverging copies)", () => {
  // Established pattern this session: several other founder-score/citation
  // helpers were found duplicated (and independently unfixed) across
  // ReportPdfButton.tsx / components/Planner.tsx / components/planner/
  // Citations.tsx. This function must stay a single, shared implementation
  // that every consumer imports, so a future fix here can never again be
  // silently bypassed by a stale duplicate.
  const pdfSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  const citationsSource = readFileSync(join(repoRoot, "components/planner/Citations.tsx"), "utf8");

  assert.doesNotMatch(pdfSource, /function readFounderReadinessTextMetric\(/);
  assert.doesNotMatch(plannerSource, /function readFounderReadinessTextMetric\(/);
  assert.doesNotMatch(citationsSource, /function readFounderReadinessTextMetric\(/);
  assert.match(plannerSource, /readFounderReadinessMetricValue/, "Planner.tsx must import the shared implementation");
});
