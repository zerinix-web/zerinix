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

// TASK #47B -- Fix the real-report Closure Plan -> Strategic
// Recommendation linkage failure.
//
// ROOT CAUSE: Task #47A's own "closure-plan quality" bar required a
// linked candidate to carry a non-empty owner AND timeline AND a
// SEPARATE, explicitly-labeled successCriterion string (signals.metric,
// via a "Success criterion:"/"Success metric:" label -- report-
// presentation.ts). The REAL regenerated report's own "Pilot
// Recruitment" recommendation -- Owner: Head of Commercial/
// Partnerships, Timeline: 6 months -- never carries a SEPARATE success-
// metric label at all; its ONLY numeric content is the "6 months"
// timeframe itself, which classifyStrategicRecommendationValidation
// (Task #38) already correctly classifies as `provenance:
// "validationTarget"` via deriveStrategicRecommendationNumericBasis
// (which joins budget/metric/timeframe BEFORE testing for a numeric
// figure) -- but Task #47A's selection bar never consulted `provenance`,
// only the separate (here, empty) `successCriterion` string. So the one
// obviously-dominant candidate never qualified, and selection always
// fell back to "Not yet assigned," even next to a clearly weaker
// "Buyer Readiness Survey" card (owner only, no timeline at all).
//
// WHY TASK #47A's OWN TESTS FALSELY PASSED: every Task #47A fixture that
// exercised the "one clearly stronger candidate" path
// (PILOT_RECRUITMENT_ITEM) artificially included an explicit
// "-- Success criterion: 30% pilot conversion rate." clause that the
// REAL report's own generation output does not actually produce for
// this action -- so the fixture accidentally satisfied a bar the real
// data never does, and no test ever exercised "owner + timeline present,
// no separate success-criterion label" as the winning candidate.
//
// FIX: scoreClosurePlanCandidate now requires only owner+timeline to
// consider a candidate at all (the two fields the Closure Plan actually
// inherits), then ranks candidates that also carry a measurable target
// -- EITHER a distinct successCriterion string OR a `provenance:
// "validationTarget"` classification already attached to the SAME
// owner/timeline/budget figures -- above ones that carry neither. This
// file reproduces the REAL "Pilot Recruitment" vs "Buyer Readiness
// Survey" shape (no explicit Success criterion label on either card,
// matching the real report exactly) and proves it now resolves a
// non-empty owner and timeline.

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

function buildCanonicalState(overrides = {}) {
  return {
    version: 3,
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    topRisks: ["A material risk."],
    topReasons: ["A material reason."],
    why: "Evidence supports conditional entry pending further validation.",
    missingEvidence: ["Independent win-rate data."],
    whatWouldChangeThisDecision:
      "A validated SOM above 30% obtainable share would support ENTER; further diligence would be required before reconsidering.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
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
    citationSources: [
      {
        evidenceId: "R1",
        title: "Market Sizing Report",
        publisher: "Research Co",
        url: "https://research.example.com/report",
        sourceType: "market research",
        confidenceLevel: "High",
        publishedDate: "2026-01-01",
        accessedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

const CLM_STATE = buildCanonicalState();

// The REAL report's own two named actions, reproduced with NO separate
// "Success criterion:"/"Success metric:" label on either -- this is the
// exact real shape that caused Task #47A's fix to still fail live.
// "Pilot Recruitment" names its target only via the timeframe itself
// ("6 months"); "Buyer Readiness Survey" names no timeframe at all.
const REAL_PILOT_RECRUITMENT_ITEM =
  "Pilot Recruitment: recruit paying pilot design partners to validate obtainable share in the U.S. Mid-Market segment over 6 months (Owner: Head of Commercial/Partnerships).";
const REAL_BUYER_READINESS_SURVEY_ITEM =
  "Buyer Readiness Survey: run customer discovery interviews to validate obtainable share (Owner: Head of Insights).";

function buildValidation(item, canonicalState = CLM_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity: reproduces the exact real-report shape ---------------

test("TASK #47B (fixture sanity): the real-shaped 'Pilot Recruitment' item has NO separate success-criterion label -- its only numeric content is the timeframe itself", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  assert.equal(pilot.relatedEvidenceGapId, "obtainable-share");
  assert.equal(pilot.actionType, "validation");
  assert.equal(pilot.owner, "Head of Commercial/Partnerships");
  assert.equal(pilot.timeline, "6 months");
  assert.equal(pilot.successCriterion, "", "fixture must reproduce the real report's own empty success-criterion field");
  assert.equal(pilot.provenance, "validationTarget", "the bare timeframe figure must still classify as a validation target");
});

test("TASK #47B (fixture sanity): the real-shaped 'Buyer Readiness Survey' item carries an owner but no timeline at all", () => {
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);
  assert.equal(survey.relatedEvidenceGapId, "obtainable-share");
  assert.equal(survey.owner, "Head of Insights");
  assert.equal(survey.timeline, "");
});

// --- The actual regression: this is the exact real-report failure ---------

test("TASK #47B: reproduces the REAL end-to-end failure and proves the fix -- with 'Pilot Recruitment' (owner + timeline, no separate success metric) and 'Buyer Readiness Survey' (owner only) both linked to the controlling gap, the Closure Plan now resolves Pilot Recruitment's real owner and timeline instead of falling back to 'not yet assigned'", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);

  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");

  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  // This is the literal defect this ticket reports: before the fix,
  // hasAssignedOwner was always false and owner/timeline were always the
  // generic fallback sentences for this exact real-report shape.
  assert.equal(plan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.equal(plan.owner, "Head of Commercial/Partnerships");
  assert.notEqual(plan.owner, "Head of Insights", "the weaker owner-only candidate must never be selected over the more complete one");
  assert.ok(!/not yet assigned/i.test(plan.owner), "owner must be a real name, not the fallback sentence");
  assert.ok(!/no timeline committed/i.test(plan.timeline), "timeline must be a real figure, not the fallback sentence");
  assert.ok(plan.timeline.startsWith("6 months"));
  assert.match(plan.timeline, /\(Validation Target\)$/, "timeline must still carry its real provenance qualifier");
});

test("TASK #47B: candidate order does not change the outcome for the real-report shape", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot, survey], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  assert.equal(planA.owner, planB.owner);
  assert.equal(planA.timeline, planB.timeline);
  assert.equal(planA.owner, "Head of Commercial/Partnerships");
});

// --- Owner/timeline inherited structurally, never fabricated ---------------

test("TASK #47B: the resolved owner is byte-identical to the winning recommendation's own already-extracted signal", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  assert.equal(plan.owner, extractRecommendationSignals(REAL_PILOT_RECRUITMENT_ITEM).owner);
});

test("TASK #47B: a candidate with neither owner nor timeline (a pure research action never links to the gap at all) cannot become the authoritative source even if present in the list", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  const unrelated = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelated.relatedEvidenceGapId, null);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot, unrelated], "English");
  assert.equal(plan.owner, "Head of Commercial/Partnerships");
});

// --- No safe candidate still falls back honestly ---------------------------

test("TASK #47B: when NEITHER real-report candidate carries both an owner and a timeline (Buyer Readiness Survey alone), the closure plan keeps the honest fallback -- never guesses", () => {
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey], "English");
  // A LONE linked candidate is still used regardless of completeness
  // (Task #47's original behavior) -- confirm it inherits the owner it
  // does have rather than being blocked by the scoring bar, which only
  // applies when there are 2+ candidates to choose between.
  assert.equal(plan.owner, "Head of Insights");
  assert.match(plan.timeline, /no timeline committed/i);
});

// --- Canonical methodology preserved ---------------------------------------

test("TASK #47B: canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share remains the sole controlling factor", () => {
  assert.equal(CLM_STATE.decision, "CONDITIONAL_GO");
  assert.equal(CLM_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #47B: the closure plan's ENTER/MONITOR/AVOID criteria remain byte-identical aliases of the controlling threshold's own summaries after the fix", () => {
  const pilot = buildValidation(REAL_PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(REAL_BUYER_READINESS_SURVEY_ITEM);
  const validations = [survey, pilot];
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, validations, "English");
  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(CLM_STATE, validations, "English");
  assert.equal(plan.measurableSuccessCriterion, controlling.enterSummary);
  assert.equal(plan.monitorStatus, controlling.monitorSummary);
  assert.equal(plan.failureCriterion, controlling.avoidSummary);
});

// --- Web/PDF parity ----------------------------------------------------------

test("TASK #47B: page.tsx, Planner.tsx (web + PDF), and ReportPdfButton.tsx all still consume the SAME resolveMarketIntelligenceControllingClosurePlan output -- no surface re-derives its own owner/timeline resolution", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared resolver`);
  }
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function");
});

test("TASK #47B/#48A (drift check): the candidate-selection logic is a pure structured-field check with no prose/keyword matching", () => {
  const selectorSource = evidenceGapsSource.match(
    /function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(selectorSource, /\.item\b/);
  assert.doesNotMatch(selectorSource, /includes\(|\.match\(|\.test\(/);
  assert.match(selectorSource, /validation\.provenance === "validationTarget"/);
});
