import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceControllingClosurePlan,
  resolveMarketIntelligenceEnterEligibility,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #53B -- Make Evidence Gap Closure Plan authoritative from the
// matching Strategic Recommendation.
//
// REAL-REPORT ROOT CAUSE: "Buyer Demand Validation" (Owner: Head of
// Market Research, Timeline: 90 days, Success criterion: 15%, Evidence
// tie: SUSB target lists) and a second, less complete procurement-
// validation action both link to the sole controlling gap, Obtainable
// Share (SAM/SOM) -- exactly the shape Task #48A already fixed once
// ("Vertical pilot" vs. "Procurement reference test"). Here, though,
// BOTH candidates independently classify `provenance: "validationTarget"`
// (Task 48A's own bug class, recurring for a different pair of actions),
// and neither candidate's own figure numerically matches this report's
// own stated Obtainable Share threshold (Task #47C's tiebreaker), so
// selectAuthoritativeClosurePlanValidation exhausted every existing
// stage and abstained to "Not yet assigned" / "No timeline committed
// yet" even though "Buyer Demand Validation" is obviously, structurally
// the more complete candidate.
//
// FIX: selectAuthoritativeClosurePlanValidation gains the ticket's own
// explicit, ordered priority list as two NEW structural-completeness
// stages -- "has a measurable success metric" (now independent of that
// metric's own provenance classification) and "has an evidence tie" --
// inserted between the existing owner+timeline hard prerequisite (Task
// #47A/#47B, unchanged) and the existing numeric-threshold tiebreaker
// (Task #47C, unchanged, still the final fallback stage). The Closure
// Plan model itself gains `evidenceTie`/`activity` fields, sourced ONLY
// from the same selected candidate, never fabricated.

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

// The real single-controlling-gap report state (unchanged across Tasks
// #35-#53A): decision CONDITIONAL_GO (MONITOR), confidence 50,
// Obtainable Share the sole material gap. Deliberately names NO explicit
// threshold figure of its own, so this proves the fix resolves the real
// candidate-selection failure on the NEW completeness stages alone,
// never relying on Task #47C's numeric-threshold tiebreaker to
// coincidentally save the day.
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
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Run the buyer demand validation program before committing further budget.",
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

// The exact real-report shape: "Buyer Demand Validation" carries all
// four structured fields (owner, timeline, success metric, evidence
// tie); the procurement-validation action carries only an owner and
// timeline, no distinct success metric and no evidence tie at all.
const BUYER_DEMAND_VALIDATION_ITEM =
  "Buyer Demand Validation: run customer discovery interviews to validate obtainable share among mid-market buyers over 90 days (Owner: Head of Market Research) — Success criterion: 15% buyer intent confirmation — Evidence tie: SUSB target lists.";
const PROCUREMENT_VALIDATION_ITEM =
  "Procurement Reference Validation: run a pilot to validate obtainable share via procurement reference calls over 90 days (Owner: Head of Procurement).";

function buildValidation(item, canonicalState = REAL_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity -----------------------------------------------------

test("TASK #53B (fixture sanity): both real-report actions structurally link to Obtainable Share (SAM/SOM)", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  assert.equal(buyerDemand.relatedEvidenceGapId, "obtainable-share");
  assert.equal(procurement.relatedEvidenceGapId, "obtainable-share");
});

test("TASK #53B (fixture sanity): 'Buyer Demand Validation' carries owner, timeline, a measurable success metric, and an evidence tie; the procurement action carries only owner and timeline", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  assert.equal(buyerDemand.owner, "Head of Market Research");
  assert.ok(buyerDemand.timeline);
  assert.match(buyerDemand.successCriterion, /15%/);
  assert.match(buyerDemand.evidenceTie, /SUSB target lists/);

  assert.equal(procurement.owner, "Head of Procurement");
  assert.ok(procurement.timeline);
  assert.equal(procurement.successCriterion, "", "fixture must reproduce the real report's own missing success metric");
  assert.equal(procurement.evidenceTie, "", "fixture must reproduce the real report's own missing evidence tie");
});

// --- A. linked recommendation with owner + timeline -> Closure Plan inherits both ---

test("TASK #53B-A: a single linked recommendation with owner + timeline is inherited directly by the Closure Plan", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyerDemand], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, "Head of Market Research");
  assert.ok(plan.timeline.startsWith(buyerDemand.timeline));
});

// --- B. multiple linked actions -> deterministic best-action selection ---

test("TASK #53B-B: reproduces the REAL candidate-selection failure and proves the fix -- with 'Buyer Demand Validation' (owner, timeline, success metric, evidence tie) and the procurement action (owner, timeline only) both linked to the controlling gap, the Closure Plan resolves Buyer Demand Validation's real owner and timeline instead of falling back to 'not yet assigned'", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, buyerDemand], "English");

  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  assert.equal(plan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.equal(plan.owner, "Head of Market Research");
  assert.notEqual(plan.owner, "Head of Procurement", "the less complete candidate must never be selected over the more complete one");
  assert.ok(!/not yet assigned/i.test(plan.owner));
  assert.ok(!/no timeline committed/i.test(plan.timeline));
  assert.equal(plan.evidenceTie, "SUSB target lists");
});

test("TASK #53B-B: candidate order does not change the outcome", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyerDemand, procurement], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, buyerDemand], "English");
  assert.equal(planA.owner, planB.owner);
  assert.equal(planA.timeline, planB.timeline);
  assert.equal(planA.evidenceTie, planB.evidenceTie);
  assert.equal(planA.owner, "Head of Market Research");
});

test("TASK #53B-B: a candidate missing only its success metric (owner + timeline present) is preferred over an actionType mismatch, but still loses to a fully complete candidate -- the completeness cascade narrows one stage at a time", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  const unrelated = buildValidation("Commission a desk-research report benchmarking adjacent verticals over 3 months (Owner: Head of Strategy).");
  assert.equal(unrelated.relatedEvidenceGapId, null);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [unrelated, procurement, buyerDemand], "English");
  assert.equal(plan.owner, "Head of Market Research");
  assert.notEqual(plan.owner, "Head of Strategy");
  assert.notEqual(plan.owner, "Head of Procurement");
});

// --- C. linked action missing one field -> preserve available fields, never invent ---

test("TASK #53B-C: the selected action's own missing field (no budget named at all) is never fabricated -- the Closure Plan's budget stays null while owner/timeline/evidence tie still populate", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  assert.equal(buyerDemand.budget, "", "fixture must genuinely name no budget for this test to be meaningful");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyerDemand], "English");
  assert.equal(plan.budget, null, "no budget must ever be invented");
  assert.equal(plan.owner, "Head of Market Research");
  assert.ok(plan.timeline.startsWith("90 days"));
  assert.equal(plan.evidenceTie, "SUSB target lists");
});

test("TASK #53B-C: a selected action with no evidence tie at all leaves the Closure Plan's evidenceTie null, never invented from another candidate or fabricated text", () => {
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement], "English");
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, "Head of Procurement");
  assert.equal(plan.evidenceTie, null);
});

// --- D. no linked recommendation -> explicit unassigned fallback remains allowed ---

test("TASK #53B-D: zero linked recommendations keep the honest 'not yet assigned' fallback, including a null evidenceTie", () => {
  const unrelated = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelated.relatedEvidenceGapId, null);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [unrelated], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.match(plan.owner, /not yet assigned/i);
  assert.match(plan.timeline, /no timeline committed/i);
  assert.equal(plan.evidenceTie, null);
  assert.equal(plan.activity, null);
});

// --- E. web/PDF use the same canonical closure-plan data --------------------

test("TASK #53B-E: page.tsx, Planner.tsx (web), Planner.tsx (PDF), and ReportPdfButton.tsx (PDF) all render the SAME closurePlan.evidenceTie field -- no renderer independently infers or reconstructs it from prose", () => {
  assert.match(pageSource, /gapClosurePlan\.evidenceTie/);
  assert.match(plannerSource, /gapClosurePlan\.evidenceTie/);
  assert.match(plannerSource, /closurePlan\.evidenceTie/);
  assert.match(pdfButtonSource, /closurePlan\.evidenceTie/);
});

test("TASK #53B-E: no render surface defines its own selectAuthoritativeClosurePlanValidation or resolveClosurePlanAssignment -- every surface consumes the single shared resolver's output", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /function selectAuthoritativeClosurePlanValidation/, `${name}: must not duplicate the selector`);
    assert.doesNotMatch(source, /function resolveClosurePlanAssignment/, `${name}: must not duplicate the assignment resolver`);
  }
});

test("TASK #53B-E: web and PDF resolve byte-identical Closure Plan output for the same candidate set", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const procurement = buildValidation(PROCUREMENT_VALIDATION_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, buyerDemand], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement, buyerDemand], "English");
  assert.deepEqual(planA, planB);
});

// --- F. decision/confidence/ENTER eligibility remain unchanged --------------

test("TASK #53B-F: canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share remains the sole controlling factor after the fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #53B-F: ENTER eligibility is unaffected by the Closure Plan candidate-selection fix -- it remains false while Obtainable Share is unresolved, regardless of which recommendation the Closure Plan selects", () => {
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.blockingGaps.length, 1);
  assert.equal(eligibility.blockingGaps[0].id, "obtainable-share");
});

test("TASK #53B-F: assessMarketEntryConfidence's own MONITOR/ENTER/AVOID methodology is untouched by this ticket -- unresolved evidence still forces MONITOR, never AVOID, from a weak raw blend", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const weakCoverage = buildCoverage({ marketConfidence: 10, competitiveEvidence: 10, financialEvidence: 10, productEvidence: 10 });
  const assessment = assessMarketEntryConfidence(weakCoverage, evidence);
  assert.equal(assessment.decision, "MONITOR");
});

// --- Preserved: Task #47A/#47B/#47C/#48A tie-abstention behavior ------------

test("TASK #53B (regression guard): when two candidates are equally complete on EVERY dimension (owner, timeline, success metric, evidence tie all present and no gap-stated threshold to break the tie), the resolver still abstains honestly -- the new completeness stages never invent a winner out of a genuine tie", () => {
  const buyerDemand = buildValidation(BUYER_DEMAND_VALIDATION_ITEM);
  const equallyComplete = buildValidation(
    "Enterprise Pilot Validation: run a paid pilot to validate obtainable share with named enterprise buyers over 90 days (Owner: Head of Sales) — Success criterion: 20% enterprise conversion — Evidence tie: named enterprise buyer list."
  );
  assert.ok(equallyComplete.owner && equallyComplete.timeline && equallyComplete.successCriterion && equallyComplete.evidenceTie);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyerDemand, equallyComplete], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.notEqual(plan.owner, buyerDemand.owner);
  assert.notEqual(plan.owner, equallyComplete.owner);
});

test("TASK #53B/#54C (drift check): the deterministic selection cascade applies actionType, then owner (hard prerequisite), then timeline (preference), then success metric, then evidence tie, then the numeric-threshold tiebreaker, in that exact order, confirmed via source", () => {
  const fnSource = evidenceGapsSource.match(/function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/)[0];
  const actionTypeIdx = fnSource.indexOf('validation.actionType === "validation"');
  const ownerIdx = fnSource.indexOf("pool.filter((validation) => validation.owner.trim())");
  const timelineIdx = fnSource.indexOf('narrowByStructuralCompleteness(pool, (validation) => Boolean(validation.timeline.trim()))');
  const metricIdx = fnSource.indexOf("narrowByStructuralCompleteness(pool, hasStructuredSuccessMetric)");
  const evidenceTieIdx = fnSource.indexOf("validation.evidenceTie.trim()");
  const numericIdx = fnSource.indexOf("comparableThresholdFiguresMatch(gapFigure");
  for (const idx of [actionTypeIdx, ownerIdx, timelineIdx, metricIdx, evidenceTieIdx, numericIdx]) {
    assert.notEqual(idx, -1);
  }
  assert.ok(actionTypeIdx < ownerIdx);
  assert.ok(ownerIdx < timelineIdx);
  assert.ok(timelineIdx < metricIdx);
  assert.ok(metricIdx < evidenceTieIdx);
  assert.ok(evidenceTieIdx < numericIdx);
});

test("TASK #54C (drift check): owner alone is the hard prerequisite -- confirmed via source, the selector no longer requires `validation.timeline.trim()` as part of the SAME eligibility filter as owner", () => {
  const fnSource = evidenceGapsSource.match(/function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSource, /validation\.owner\.trim\(\)\s*&&\s*validation\.timeline\.trim\(\)/);
  assert.match(fnSource, /pool\.filter\(\(validation\) => validation\.owner\.trim\(\)\)/);
});

test("TASK #53B (drift check): the success-metric stage no longer requires provenance === 'validationTarget' -- confirmed via source, since that requirement is exactly what caused this real-report failure", () => {
  const fnSource = evidenceGapsSource.match(/function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSource, /provenance === "validationTarget"/);
});
