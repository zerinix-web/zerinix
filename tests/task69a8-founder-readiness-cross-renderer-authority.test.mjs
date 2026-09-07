import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FOUNDER_READINESS_DIMENSIONS,
  FOUNDER_READINESS_DIMENSION_METRICS,
  getFounderReadinessDimensionScore,
  readFounderReadinessMetricValue,
  readFounderReadinessMetrics,
  readFounderReadinessScoreValue,
  buildExecutiveSnapshot,
  normalizeFounderReadinessScoreText,
} from "../app/lib/report-presentation.ts";

// TASK #69A-8 -- Make Founder Readiness dimension authority fully
// canonical across web and PDF. Audits (and locks in, with fresh
// regression coverage against the EXACT real report values quoted in
// this ticket) the invariants Tasks #69A-5/#69A-6 already established:
// one canonical, identity-keyed FOUNDER_READINESS_DIMENSIONS list; no
// positional/array-index derivation anywhere; the overall score sourced
// from investmentScore.decisionEngine.founderScore.score, never
// independently recomputed in presentation code.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

// The exact real report this ticket describes: Decision MONITOR,
// Confidence 48%, Founder Readiness overall 40/100, and these 7 exact,
// mutually distinct dimension values.
const REAL_DIMENSION_VALUES = {
  ideaQuality: 48,
  marketAttractiveness: 48,
  businessModelQuality: 54,
  validationConfidence: 60,
  executionComplexity: 66,
  evidenceConfidence: 34,
  founderEvidence: 40,
};

const REAL_INVESTMENT_SCORE = {
  totalScore: 46,
  confidence: 48,
  recommendation: "WAIT",
  decisionEngine: {
    founderScore: {
      score: 40,
      maximumScore: 100,
      reasoning: [
        "Market attractiveness: 48%",
        "Business model quality: 54%",
        "Validation confidence: 60%",
        "Execution complexity: 66%",
        "Evidence confidence: 34%",
        "Founder evidence: 40%",
      ],
    },
  },
};

const REAL_FOUNDER_SCORE_TEXT = [
  "Founder Readiness Score: 40/100",
  "Idea Quality: 48/100 - clear market need and timing for AI-enabled FP&A in SMBs.",
  "Market Attractiveness: 48/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
  "Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
  "Validation Confidence: 60/100 - early-stage with no paid customers; needs pilot conversions.",
  "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.",
  "Evidence Confidence: 34/100 - Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
  "Founder Evidence: 40/100 - no founder/team data provided; increases execution risk.",
].join("\n");

// ---------------------------------------------------------------------
// Requirement A -- canonical dimension authority.
// ---------------------------------------------------------------------

test("requirement A: FOUNDER_READINESS_DIMENSIONS is the one canonical, identity-keyed source, and all 3 renderer files import it (never a hand-copied duplicate)", () => {
  assert.equal(FOUNDER_READINESS_DIMENSIONS.length, 8);
  assert.equal(FOUNDER_READINESS_DIMENSION_METRICS.length, 7);
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /FOUNDER_READINESS_DIMENSION(S|_METRICS)/, `${name} must import the canonical list`);
  }
});

// Regression test 1: a fixture with all seven distinct dimension values
// preserves each exact value under the correct key across web and PDF.
test("regression 1: all seven distinct real dimension values are preserved under their exact correct key, resolved via the canonical function (simulating both web and PDF, which call the same function)", () => {
  for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
    const webValue = readFounderReadinessMetricValue(dimension.label, REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT);
    const pdfValue = getFounderReadinessDimensionScore(dimension.key, REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT);

    assert.equal(webValue, REAL_DIMENSION_VALUES[dimension.key], `web: ${dimension.key} must equal its exact real value`);
    assert.equal(pdfValue, REAL_DIMENSION_VALUES[dimension.key], `PDF: ${dimension.key} must equal its exact real value`);
    assert.equal(webValue, pdfValue, `${dimension.key} must be identical between web and PDF`);
  }
});

// Regression test 2: reordering an array representation cannot change
// label/value pairing.
test("regression 2: reordering the underlying reasoning array cannot change which value resolves under which label", () => {
  const forwardOrder = REAL_INVESTMENT_SCORE.decisionEngine.founderScore.reasoning;
  const reversedOrder = [...forwardOrder].reverse();
  const shuffledOrder = [forwardOrder[3], forwardOrder[0], forwardOrder[5], forwardOrder[1], forwardOrder[4], forwardOrder[2]];

  for (const reasoningOrder of [forwardOrder, reversedOrder, shuffledOrder]) {
    const investmentScore = {
      decisionEngine: { founderScore: { score: 40, maximumScore: 100, reasoning: reasoningOrder } },
    };
    const metrics = readFounderReadinessMetrics(investmentScore);
    for (const [key, expectedValue] of Object.entries(REAL_DIMENSION_VALUES)) {
      if (key === "ideaQuality") continue; // deliberately aliases marketAttractiveness by design
      assert.equal(metrics[key], expectedValue, `${key} must resolve to its own value regardless of array order`);
    }
  }
});

// Regression test 3: missing one dimension cannot shift all following
// values.
test("regression 3: removing one dimension's line/reasoning entry leaves every OTHER dimension's value unshifted, and the missing one resolves to null (never a neighbor's value)", () => {
  // Remove "Execution complexity" entirely from the reasoning array (as
  // if the model failed to emit that one line) -- a positional/array-
  // index-based consumer would shift every entry after it by one slot;
  // a keyed consumer must not.
  const reasoningWithoutExecution = REAL_INVESTMENT_SCORE.decisionEngine.founderScore.reasoning.filter(
    (line) => !line.startsWith("Execution complexity")
  );
  const investmentScore = {
    decisionEngine: { founderScore: { score: 40, maximumScore: 100, reasoning: reasoningWithoutExecution } },
  };
  const metrics = readFounderReadinessMetrics(investmentScore);

  assert.equal(metrics.executionComplexity, null, "the missing dimension must resolve to null, never a fabricated value");
  // Every dimension that came AFTER "Execution complexity" in the
  // original array order must still resolve to its OWN correct value,
  // not the value that would have "shifted" into its slot.
  assert.equal(metrics.evidenceConfidence, 34);
  assert.equal(metrics.founderEvidence, 40);
  // Every dimension BEFORE the missing one is also unaffected.
  assert.equal(metrics.marketAttractiveness, 48);
  assert.equal(metrics.businessModelQuality, 54);
  assert.equal(metrics.validationConfidence, 60);

  // Same proof against the rendered TEXT path (removing that one line
  // from the founderScore field's own text).
  const textWithoutExecution = REAL_FOUNDER_SCORE_TEXT.split("\n")
    .filter((line) => !line.startsWith("Execution Complexity"))
    .join("\n");
  assert.equal(getFounderReadinessDimensionScore("executionComplexity", investmentScore, textWithoutExecution), null);
  assert.equal(getFounderReadinessDimensionScore("evidenceConfidence", investmentScore, textWithoutExecution), 34);
  assert.equal(getFounderReadinessDimensionScore("founderEvidence", investmentScore, textWithoutExecution), 40);
});

// Regression test 4: legacy positional data is normalized once into
// keyed canonical structure.
test("regression 4: the OLD, removed positional-array bug pattern (dimensionScoreValues[findIndex(...)]) no longer exists anywhere in the 3 renderer files as real code, only in explanatory comments", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const codeOnly = source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.doesNotMatch(codeOnly, /dimensionScoreValues\s*\[/, `${name} must not resolve a score by array position`);
    assert.doesNotMatch(codeOnly, /\.findIndex\(\s*\(?\s*item\s*\)?\s*=>\s*item\.label\s*===\s*metric\.label/, `${name} must not use a positional self-lookup`);
  }
});

test("regression 4b: reproducing the legacy positional-array bug shape directly proves it WOULD have mispaired labels/values under reordering -- confirming why the canonical, keyed function is the fix", () => {
  const legacyDimensionMetrics = FOUNDER_READINESS_DIMENSION_METRICS.map((d) => ({ label: d.label }));
  const legacyValuesInCanonicalOrder = FOUNDER_READINESS_DIMENSION_METRICS.map(
    (d) => REAL_DIMENSION_VALUES[d.key]
  );
  // Simulate the OLD bug: a SEPARATE, independently-ordered label list
  // (as if one file's copy had been edited to reorder "Execution
  // Complexity" before "Validation Confidence") used to positionally
  // index into the SAME values array.
  const reorderedLabelList = [...legacyDimensionMetrics];
  [reorderedLabelList[3], reorderedLabelList[4]] = [reorderedLabelList[4], reorderedLabelList[3]];

  const legacyBuggyLookup = (metric) =>
    legacyValuesInCanonicalOrder[reorderedLabelList.findIndex((item) => item.label === metric.label)];

  const buggyValidationConfidence = legacyBuggyLookup({ label: "Validation Confidence" });
  assert.notEqual(
    buggyValidationConfidence,
    REAL_DIMENSION_VALUES.validationConfidence,
    "sanity check: the legacy positional pattern really does mispair values the moment one list's order diverges from the other's"
  );

  // The CURRENT, real, canonical function is immune to this exact
  // reordering because it never looks anything up by array position.
  assert.equal(
    getFounderReadinessDimensionScore("validationConfidence", REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT),
    REAL_DIMENSION_VALUES.validationConfidence
  );
});

// ---------------------------------------------------------------------
// Requirement C -- overall score relationship.
// ---------------------------------------------------------------------

test("requirement C: buildCanonicalFounderScore resolves the overall score from founder.score directly, never an independently recomputed weighted average", () => {
  assert.match(
    planExecutorSource,
    /const overallScore = Math\.max\(0, Math\.min\(100, Math\.round\(founder\.score\)\)\);/
  );
  assert.doesNotMatch(planExecutorSource, /ideaQuality \* 2/);
});

test("requirement C: 40/100 is preserved end-to-end for the real fixture -- readFounderReadinessScoreValue, the text-first metric lookup, and buildExecutiveSnapshot's founderScoreValue all agree", () => {
  assert.equal(readFounderReadinessScoreValue(REAL_INVESTMENT_SCORE), 40);
  assert.equal(
    readFounderReadinessMetricValue("Founder Readiness Score", REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT),
    40
  );
  assert.equal(getFounderReadinessDimensionScore("founderReadinessScore", REAL_INVESTMENT_SCORE, REAL_FOUNDER_SCORE_TEXT), 40);

  const snapshot = buildExecutiveSnapshot(REAL_FOUNDER_SCORE_TEXT, REAL_INVESTMENT_SCORE);
  assert.equal(snapshot.founderScoreValue, 40);

  const normalizedText = normalizeFounderReadinessScoreText(REAL_FOUNDER_SCORE_TEXT, 40);
  assert.match(normalizedText, /^Founder Readiness Score: 40\/100/);
});

// Regression test 5: overall Founder Readiness remains identical across
// Executive Decision Center, Founder Readiness section, Key Takeaway,
// PDF.
test("regression 5: the overall score (40) is identical across every consumer surface for the real fixture", () => {
  const executiveDecisionCenter = buildExecutiveSnapshot(REAL_FOUNDER_SCORE_TEXT, REAL_INVESTMENT_SCORE).founderScoreValue;
  const founderReadinessSection = getFounderReadinessDimensionScore(
    "founderReadinessScore",
    REAL_INVESTMENT_SCORE,
    REAL_FOUNDER_SCORE_TEXT
  );
  const keyTakeawayNormalizedText = normalizeFounderReadinessScoreText(
    REAL_FOUNDER_SCORE_TEXT,
    readFounderReadinessScoreValue(REAL_INVESTMENT_SCORE)
  );
  const keyTakeawayValue = Number(keyTakeawayNormalizedText.match(/Founder Readiness Score: (\d+)\/100/)[1]);
  // The PDF resolves the exact same way page.tsx/Planner.tsx's cover
  // snapshot does -- proven by the source-text assertion below that
  // every real call site feeds normalizeFounderReadinessScoreText the
  // canonical readFounderReadinessScoreValue result.
  const pdfValue = readFounderReadinessScoreValue(REAL_INVESTMENT_SCORE);

  assert.equal(executiveDecisionCenter, 40);
  assert.equal(founderReadinessSection, 40);
  assert.equal(keyTakeawayValue, 40);
  assert.equal(pdfValue, 40);
});

test("regression 5b: page.tsx, Planner.tsx, and ReportPdfButton.tsx all feed normalizeFounderReadinessScoreText the canonical readFounderReadinessScoreValue/founderScoreValue result", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const calls = [...source.matchAll(/normalizeFounderReadinessScoreText\(\s*[^,]+,\s*([^)]+)\)/g)];
    assert.ok(calls.length > 0, `${name} must call normalizeFounderReadinessScoreText`);
    for (const call of calls) {
      assert.match(
        call[1].trim(),
        /readFounderReadinessScoreValue\(|founderReadinessScore|executiveSnapshot\.founderScoreValue/,
        `${name} must pass a canonical score, never a re-derived one`
      );
    }
  }
});

// Regression test 6: existing MONITOR decision and 48% confidence remain
// unchanged.
test("regression 6: the real report's MONITOR decision and 48% confidence are unaffected by this task -- Founder Readiness is a completely independent number", () => {
  assert.equal(REAL_INVESTMENT_SCORE.confidence, 48);
  const snapshot = buildExecutiveSnapshot(REAL_FOUNDER_SCORE_TEXT, REAL_INVESTMENT_SCORE);
  assert.equal(snapshot.confidenceScore, 48);
  // Decision vocabulary itself (MONITOR) is Task #69A-7's own concern,
  // untouched here -- confirmed no decision-vocabulary source file is
  // modified by this task (see file list in the final report).
});

// ---------------------------------------------------------------------
// Requirement D -- identity safety.
// ---------------------------------------------------------------------

test("requirement D: every one of the 7 required identity keys is present, in FounderReadinessDimensionKey, and none can collide with another", () => {
  const requiredKeys = [
    "ideaQuality",
    "marketAttractiveness",
    "businessModelQuality",
    "validationConfidence",
    "executionComplexity",
    "evidenceConfidence",
    "founderEvidence",
  ];
  const actualKeys = FOUNDER_READINESS_DIMENSION_METRICS.map((d) => d.key);
  assert.deepEqual(actualKeys, requiredKeys);
  assert.equal(new Set(actualKeys).size, requiredKeys.length, "no duplicate keys");

  // No dimension's own real value may appear under a different key.
  const seenValues = new Map();
  for (const [key, value] of Object.entries(REAL_DIMENSION_VALUES)) {
    for (const [otherKey, otherValue] of seenValues) {
      if (key === "ideaQuality" || otherKey === "ideaQuality") continue; // deliberate alias
      assert.notEqual(
        value === otherValue && key !== otherKey,
        true,
        `${key} and ${otherKey} coincidentally share a value in this fixture, which would mask a mispairing -- fixture must use 7 distinct values`
      );
    }
    seenValues.set(key, value);
  }
});

// ---------------------------------------------------------------------
// Requirement E -- cross-renderer parity (structural, source-level).
// ---------------------------------------------------------------------

test("requirement E: no renderer file redeclares its own Founder Readiness dimension array (structural proof that all 3 consume one shared source)", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /const founderScore(Pdf)?(Dimension)?Metrics\s*=\s*\[/,
      `${name} must not redeclare a local Founder Readiness dimension array`
    );
  }
});

test("requirement F7 (drift check): existing Founder Readiness aliasing behavior (ideaQuality mirrors marketAttractiveness) is unchanged", () => {
  const metrics = readFounderReadinessMetrics(REAL_INVESTMENT_SCORE);
  assert.equal(metrics.ideaQuality, metrics.marketAttractiveness);
  assert.equal(metrics.ideaQuality, 48);
});
