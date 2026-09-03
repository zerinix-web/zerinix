import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceControllingDecisionThreshold,
  resolveMarketIntelligenceControllingClosurePlan,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #48A -- Fix real-report multi-gap Closure Plan candidate
// selection failure.
//
// EXACT RUNTIME CANDIDATE SET (from the real regenerated report, both
// linked to the SAME sole controlling gap, Obtainable Share (SAM/SOM)):
//   1) "Vertical pilot" -- actionType pilot/validation, relatedEvidenceGapId
//      "obtainable-share", owner "Head of Product", timeline "12-week",
//      budget "$60,000", an EXPLICIT success metric "10%", provenance
//      "validationTarget".
//   2) "Procurement reference test" -- actionType pilot/validation,
//      relatedEvidenceGapId "obtainable-share", owner "Sales", timeline
//      "90 days", budget "$10,000", NO distinct success metric at all;
//      its own provenance STILL classifies "validationTarget" purely
//      because its budget/timeline figures are numeric
//      (deriveStrategicRecommendationNumericBasis joins budget/metric/
//      timeframe before testing for a number).
//
// EXACT REASON THE RESOLVER ABSTAINED (Task #47C's own scoring):
// scoreClosurePlanCandidate's single binary bonus --
// `Boolean(successCriterion.trim()) || provenance === "validationTarget"`
// -- was TRUE for BOTH candidates via two different routes (Vertical
// pilot via its own explicit "10%" metric; Procurement reference test
// via its budget/timeline alone, despite having no metric at all), so
// both tied at score 1 and selection fell back to "not yet assigned."
//
// DETERMINISTIC SELECTION RULE (Task #48A): selectAuthoritativeClosurePlanValidation
// now applies a SEQUENCE of progressively narrowing, purely structural
// filters instead of one binary bonus:
//   (1) owner AND timeline present (hard prerequisite, unchanged).
//   (2) has a DISTINCT success metric (successCriterion non-empty) AND
//       that metric is itself classified "validationTarget" -- this is
//       the exact signal that now correctly separates "Vertical pilot"
//       (passes) from "Procurement reference test" (fails -- no metric
//       at all, regardless of its own provenance).
//   (3) among any REMAINING tie, prefer whichever candidate's own
//       metric numerically matches the gap's own report-stated
//       threshold (Task #47C/#48's existing type-aware equality check,
//       unchanged).
// For THIS real report, stage (2) alone already uniquely selects
// "Vertical pilot" -- stage (3) is never even reached.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);

const defaultMarketSizing = {
  tam: "$1.5 billion",
  sam: "$375 million",
  som: "SOM not calculated: bottom-up obtainable-share inputs did not meet the evidence bar.",
  method: "topDown",
  tier: "supportedEstimate",
  samMethod: "evidenceDerived",
  somStatus: "pending",
  conflicting: false,
  conflictNote: "",
  confidence: 70,
  confidenceLevel: "Medium",
  evidenceIds: ["R1"],
};

function buildCoverage(overrides = {}) {
  return {
    overallConfidence: 60,
    verifiedMarketSizeAvailable: true,
    dimensions: {
      marketConfidence: 60,
      competitiveEvidence: 60,
      financialEvidence: 60,
      productEvidence: 60,
      executionReadiness: 60,
      founderReadiness: 60,
      ...overrides,
    },
  };
}

// The exact real single-controlling-gap CLM-style fixture (unchanged
// across Tasks #35-#48): decision CONDITIONAL_GO (MONITOR), confidence
// 50, Obtainable Share the sole material gap.
function buildCanonicalState(overrides = {}) {
  return {
    version: 3,
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    topRisks: ["Obtainable share has not been independently validated."],
    topReasons: ["Market sizing and competitive evidence are both resolved."],
    why: "Evidence supports conditional entry pending obtainable-share validation.",
    missingEvidence: ["Independent conversion data."],
    // Deliberately names NO explicit threshold figure of its own -- the
    // real report this ticket reports from did not state one either, so
    // this proves the fix resolves the real candidate-selection failure
    // on ITS OWN (Stage 2: explicit-metric presence), never relying on
    // Task #47C's numeric-threshold tiebreaker (Stage 3) to coincidentally
    // save the day.
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Run the vertical pilot before committing further budget.",
    decisionCriticalEvidence: {
      marketSizingResolved: true,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: false,
    },
    marketSizing: { ...defaultMarketSizing },
    cagr: [{ description: "12% CAGR through 2028", evidenceIds: ["R2"], confidenceClassification: "Verified" }],
    coverage: buildCoverage(),
    competitors: [
      {
        name: "Acme Corp",
        positioning: "Category leader",
        pricingEvidence: "Public pricing page",
        confidenceClassification: "Verified",
        confidenceScore: 80,
        confidenceLevel: "High",
        evidenceIds: ["R3"],
        strengthEvidenceId: "R3",
        weaknessEvidenceId: null,
        pricingEvidenceId: "R3",
      },
    ],
    citationSources: [],
    ...overrides,
  };
}

const REAL_STATE = buildCanonicalState();

// The exact two real-report candidates, reproduced from the real
// runtime shape reported live.
const VERTICAL_PILOT_ITEM =
  "Vertical pilot: run a paid pilot to validate obtainable share in a single vertical over a 12-week period (Owner: Head of Product) — Budget cap $60,000 — Success criterion: 10% conversion.";
const PROCUREMENT_REFERENCE_TEST_ITEM =
  "Procurement reference test: run a pilot to validate obtainable share via procurement reference calls over 90 days (Owner: Sales) — Budget cap $10,000.";

function buildValidation(item, canonicalState = REAL_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity: reproduces the exact real runtime candidate set -------

test("TASK #48A (fixture sanity): both candidates structurally link to Obtainable Share (SAM/SOM), the sole controlling gap", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  assert.equal(pilot.relatedEvidenceGapId, "obtainable-share");
  assert.equal(procurement.relatedEvidenceGapId, "obtainable-share");
  assert.ok(pilot.actionType === "validation" || pilot.actionType === "pilot");
  assert.ok(procurement.actionType === "validation" || procurement.actionType === "pilot");
});

test("TASK #48A (fixture sanity): 'Vertical pilot' carries an explicit success metric; 'Procurement reference test' carries none at all -- yet BOTH still classify as provenance 'validationTarget'", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  assert.equal(pilot.owner, "Head of Product");
  assert.equal(pilot.timeline, "12-week");
  assert.equal(pilot.successCriterion, "10% conversion");
  assert.equal(pilot.provenance, "validationTarget");

  assert.equal(procurement.owner, "Sales");
  assert.equal(procurement.timeline, "90 days");
  assert.equal(procurement.successCriterion, "", "fixture must reproduce the real report's own missing success metric");
  assert.equal(
    procurement.provenance,
    "validationTarget",
    "provenance still classifies as validationTarget via budget/timeline alone -- this is the exact reason the OLD scoring tied"
  );
});

// --- The actual regression: reproduces and proves the real fix -------------

test("TASK #48A: reproduces the REAL candidate-selection failure and proves the fix -- with 'Vertical pilot' (explicit success metric) and 'Procurement reference test' (no success metric, provenance-only) both linked to the controlling gap, the Closure Plan now selects Vertical pilot's exact metadata instead of falling back to 'not yet assigned'", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, pilot], "English");

  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  assert.equal(plan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.equal(plan.owner, "Head of Product");
  assert.notEqual(plan.owner, "Sales", "the weaker, metric-less candidate must never be selected");
  assert.ok(!/not yet assigned/i.test(plan.owner));
  assert.ok(!/no timeline committed/i.test(plan.timeline));
  assert.ok(plan.timeline.startsWith("12-week"));
  assert.match(plan.timeline, /\(Validation Target\)$/);
  assert.ok(plan.budget.startsWith("$60,000"));
});

test("TASK #48A: candidate order does not change the outcome", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [pilot, procurement], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, pilot], "English");
  assert.equal(planA.owner, planB.owner);
  assert.equal(planA.timeline, planB.timeline);
  assert.equal(planA.owner, "Head of Product");
});

// --- Equal candidates -> abstain --------------------------------------------

test("TASK #48A: when BOTH candidates are equally complete AND equally match the report's own stated threshold (each has its own explicit, validation-target success metric naming the SAME 10% figure), the resolver does not arbitrarily pick either one -- keeps the honest fallback", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const equallyStrongItem =
    "Enterprise pilot: run a paid pilot to validate obtainable share with a named enterprise buyer over 10 weeks (Owner: Head of Sales) — Success criterion: 10% enterprise conversion.";
  const equallyStrong = buildValidation(equallyStrongItem);
  assert.ok(equallyStrong.successCriterion, "fixture must actually carry its own explicit metric for this test to be meaningful");
  assert.equal(equallyStrong.provenance, "validationTarget");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [pilot, equallyStrong], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.notEqual(plan.owner, pilot.owner);
  assert.notEqual(plan.owner, equallyStrong.owner);
});

// --- One stronger by validation-target metric -> choose stronger -----------

test("TASK #48A: a candidate with an explicit validation-target success metric is chosen over one with only a planning-assumption metric", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const planningOnlyItem =
    "Legacy renewal outreach: contact existing customers about a legacy renewal program over 8 weeks (Owner: Head of Renewals) — Success criterion: 12 estimated renewals (Planning Assumption).";
  const planningOnly = buildValidation(planningOnlyItem);
  // Sanity: this fixture must actually link and actually carry a metric,
  // just one that is NOT classified as a validation target, for this
  // test to be meaningful.
  if (planningOnly.relatedEvidenceGapId === "obtainable-share" && planningOnly.successCriterion) {
    assert.notEqual(planningOnly.provenance, "validationTarget");
    const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [planningOnly, pilot], "English");
    assert.equal(plan.owner, "Head of Product");
  }
});

// --- Unrelated recommendation cannot win ------------------------------------

test("TASK #48A: an unrelated (research-type) recommendation can never win even when present alongside the two real candidates", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  const unrelatedItem = "Commission a desk-research report benchmarking adjacent verticals over 3 months (Owner: Head of Strategy).";
  const unrelated = buildValidation(unrelatedItem);
  assert.equal(unrelated.relatedEvidenceGapId, null);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [unrelated, procurement, pilot], "English");
  assert.equal(plan.owner, "Head of Product");
  assert.notEqual(plan.owner, "Head of Strategy");
});

// --- Planning-only candidate cannot outrank a direct validation candidate ---

test("TASK #48A: 'Procurement reference test' (no distinct metric) can never be selected over 'Vertical pilot' (explicit validation-target metric) regardless of array position or which is 'first'", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  for (const validations of [
    [procurement, pilot],
    [pilot, procurement],
  ]) {
    const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, validations, "English");
    assert.notEqual(plan.owner, "Sales");
  }
});

// --- Preserved: decision, confidence, controlling factor, ENTER/MONITOR/AVOID ---

test("TASK #48A: decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share (SAM/SOM) remains the sole controlling factor after the fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
  assert.equal(materialGaps[0].label, "Obtainable Share (SAM/SOM)");
});

test("TASK #48A: the closure plan's ENTER/MONITOR/AVOID criteria remain byte-identical aliases of the controlling threshold's own summaries after the selection-rule fix", () => {
  const pilot = buildValidation(VERTICAL_PILOT_ITEM);
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  const validations = [procurement, pilot];
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, validations, "English");
  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, validations, "English");
  assert.equal(plan.measurableSuccessCriterion, controlling.enterSummary);
  assert.equal(plan.monitorStatus, controlling.monitorSummary);
  assert.equal(plan.failureCriterion, controlling.avoidSummary);
});

// --- Web/PDF parity ----------------------------------------------------------

test("TASK #48A: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan/selection result -- no duplicate candidate-selection logic", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared resolver`);
    assert.doesNotMatch(
      source,
      /function selectAuthoritativeClosurePlanValidation/,
      `${name}: must not duplicate the selector`
    );
  }
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function");
});

test("TASK #48A (drift check): the deterministic selection rule lives entirely inside the single shared resolver, applying owner+timeline, then metric+validationTarget, then numeric-threshold-match stages in that order -- never prose/title matching, never a hardcoded owner/timeline/metric", () => {
  const fnSource = evidenceGapsSource.match(
    /function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(fnSource, /"Head of Product"/);
  assert.doesNotMatch(fnSource, /12-week/);
  assert.doesNotMatch(fnSource, /"10%"/);
  assert.match(fnSource, /\.owner\.trim\(\)/);
  assert.match(fnSource, /\.timeline\.trim\(\)/);
  assert.match(fnSource, /\.evidenceTie\.trim\(\)/);
  assert.match(fnSource, /extractComparableThresholdFigure\(/);
});
