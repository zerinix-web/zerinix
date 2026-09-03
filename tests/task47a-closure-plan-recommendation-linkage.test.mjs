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

// TASK #47A -- Link the authoritative evidence-gap Closure Plan to the
// existing Strategic Recommendation action.
//
// AUDIT FINDING: Task #47's own resolveClosurePlanAssignment only ever
// populated owner/timeline/budget when EXACTLY ONE recommendation card
// linked to the controlling gap (relatedEvidenceGapId) -- 0 or 2+ linked
// cards both fell back to "Not yet assigned," treating a genuine
// conflict identically to "several validation/pilot actions all
// legitimately target the same controlling gap, one of them clearly the
// authoritative one." The real report's own Strategic Recommendations
// section names several such actions ("Pilot Recruitment," "Buyer
// Readiness Survey," ...) all validating Obtainable Share -- so Task
// #47's "exactly one" gate always fell back to the honest-but-wrong
// "Not yet assigned" placeholder even though "Pilot Recruitment" (owner,
// timeline, AND a measurable success criterion all present) is
// obviously more authoritative than "Buyer Readiness Survey" (owner
// only).
//
// FIX: selectAuthoritativeClosurePlanValidation (market-intelligence-
// evidence-gaps.ts) only changes what happens when 2+ candidates link to
// the SAME gap: a candidate qualifies as "closure-plan quality" only
// when it ALSO carries a non-empty owner, timeline, AND measurable
// success criterion (requirement #4's own bar); "directly validates the
// controlling gap" and "is classified as validation/pilot" are already
// guaranteed by relatedEvidenceGapId itself, so no new gap-linkage logic
// is introduced -- this is a pure, structured-field-only selection rule
// (never prose matching). When exactly one candidate clears that bar it
// becomes the sole source (never merged with any other card's fields);
// when zero or 2+ candidates clear it (a genuine tie or universal
// incompleteness), the resolver still returns the SAME honest "not yet
// assigned" fallback Task #47 already used -- never a guess.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);

// The exact real CLM (contract-lifecycle-management) fixture shape used
// throughout Tasks #35-#47: decision CONDITIONAL_GO (displays MONITOR),
// confidence 50, obtainableShareResolved false, controlling factor
// "Obtainable Share (SAM/SOM)".
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

// The real report's own two named actions -- "Pilot Recruitment" (full
// owner + timeline + measurable success criterion) and "Buyer Readiness
// Survey" (owner only, no timeline, no measurable success criterion).
const PILOT_RECRUITMENT_ITEM =
  "Pilot Recruitment: run a paid pilot to validate obtainable share in the U.S. Mid-Market segment over 6 months (Owner: Head of Commercial/Partnerships) — Success criterion: 30% pilot conversion rate.";
const BUYER_READINESS_SURVEY_ITEM =
  "Buyer Readiness Survey: run customer discovery interviews to validate obtainable share (Owner: Head of Insights).";
// A second "equally complete" candidate, used only to prove a genuine
// tie still falls back honestly rather than picking either one -- ALSO
// citing the report's own 30% figure (Task #47C's numeric tiebreaker
// must not fire when 2+ tied candidates share the SAME matching figure,
// only when exactly one does).
const COMPETING_FULL_ITEM =
  "Trial a limited beta rollout in the EU segment over 8 weeks (Owner: VP of Sales) — Success criterion: 30% signup conversion rate.";

function buildValidation(item, canonicalState = CLM_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity: both real-report items actually link to the controlling gap ---

test("TASK #47A (fixture sanity): both 'Pilot Recruitment' and 'Buyer Readiness Survey' structurally link to Obtainable Share via relatedEvidenceGapId, never by prose matching", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  assert.equal(pilot.relatedEvidenceGapId, "obtainable-share");
  assert.equal(survey.relatedEvidenceGapId, "obtainable-share");
  assert.equal(pilot.actionType, "validation");
  assert.equal(survey.actionType, "validation");
});

test("TASK #47A (fixture sanity): 'Pilot Recruitment' carries owner, timeline, and a measurable success criterion; 'Buyer Readiness Survey' carries only an owner", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  assert.ok(pilot.owner && pilot.timeline && pilot.successCriterion);
  assert.ok(survey.owner);
  assert.equal(survey.timeline, "");
  assert.equal(survey.successCriterion, "");
});

// --- 1. One linked recommendation -----------------------------------------

test("TASK #47A: with exactly one linked recommendation, the closure plan still inherits its owner/timeline directly (Task #47's original behavior, unchanged)", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, pilot.owner);
  assert.ok(plan.timeline.startsWith(pilot.timeline));
});

// --- 2. Multiple linked recommendations, one clearly stronger --------------

test("TASK #47A: with multiple linked recommendations where ONE is clearly the more complete closure candidate (owner + timeline + measurable success criterion), the Closure Plan inherits THAT action's owner/timeline rather than falling back to 'Not yet assigned'", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, "Head of Commercial/Partnerships");
  assert.ok(plan.timeline.startsWith(pilot.timeline));
  assert.notEqual(plan.owner, survey.owner, "the weaker, less-complete candidate must never be selected");
});

test("TASK #47A: candidate order in the recommendations array does not affect which one is selected -- the SAME authoritative candidate wins regardless of list order", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot, survey], "English");
  assert.equal(planA.owner, planB.owner);
  assert.equal(planA.timeline, planB.timeline);
});

// --- 3. No safe unique candidate -> fallback remains ------------------------

test("TASK #47A: when TWO linked recommendations are EQUALLY complete (a genuine tie), the closure plan does not arbitrarily pick either one -- it keeps the honest 'not yet assigned' fallback", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const competing = buildValidation(COMPETING_FULL_ITEM);
  assert.ok(competing.owner && competing.timeline && competing.successCriterion, "fixture must actually be equally complete for this test to be meaningful");

  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot, competing], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.notEqual(plan.owner, pilot.owner);
  assert.notEqual(plan.owner, competing.owner);
  assert.equal(plan.budget, null);
});

test("TASK #47A: when every linked recommendation is equally incomplete (no candidate has owner+timeline+success criterion together), the closure plan keeps the honest fallback rather than picking the 'least incomplete' one", () => {
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  const anotherPartial = buildValidation(
    "Run structured competitor discovery interviews to validate obtainable share over 3 months."
  );
  assert.equal(anotherPartial.relatedEvidenceGapId, "obtainable-share");
  assert.equal(anotherPartial.owner, "");

  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, anotherPartial], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
});

test("TASK #47A: zero linked recommendations still fall back to the same honest sentence as before", () => {
  const unrelated = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelated.relatedEvidenceGapId, null);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [unrelated], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.match(plan.owner, /not yet assigned/i);
  assert.match(plan.timeline, /no timeline committed/i);
});

// --- 4. Owner/timeline inherited structurally, never by prose matching -----

test("TASK #47A: the inherited owner is byte-identical to the selected recommendation's own already-extracted signal -- never re-derived or reworded", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  assert.equal(plan.owner, extractRecommendationSignals(PILOT_RECRUITMENT_ITEM).owner);
});

test("TASK #47A: the inherited timeline carries the SAME provenance qualifier the recommendation card itself displays -- never a bare, unqualified figure", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  assert.ok(pilot.provenance, "fixture must actually classify a provenance for this assertion to be meaningful");
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [survey, pilot], "English");
  assert.match(plan.timeline, /\(.*\)$/);
});

test("TASK #47A/#47B: selection never inspects the recommendation's own free-text item string -- only structured relatedEvidenceGapId/owner/timeline/successCriterion/provenance fields", () => {
  const selectorSource = evidenceGapsSource.match(
    /function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/
  )[0];
  const scoringSource = evidenceGapsSource.match(/function scoreClosurePlanCandidate\([\s\S]*?\n\}/)[0];
  for (const source of [selectorSource, scoringSource]) {
    assert.doesNotMatch(source, /\.item\b/, "must never read a validation's raw item text");
    assert.doesNotMatch(source, /includes\(|match\(|test\(/, "must never do substring/regex prose matching");
  }
  assert.match(scoringSource, /\.owner\.trim\(\)/);
  assert.match(scoringSource, /\.timeline\.trim\(\)/);
  assert.match(scoringSource, /\.successCriterion\.trim\(\)/);
  assert.match(scoringSource, /\.provenance\s*===\s*"validationTarget"/);
});

// --- 5. Validation target / canonical methodology unchanged ---------------

test("TASK #47A: the canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share remains the controlling factor -- unchanged by this ticket", () => {
  assert.equal(CLM_STATE.decision, "CONDITIONAL_GO");
  assert.equal(CLM_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #47A: the closure plan's ENTER/MONITOR/AVOID criteria remain byte-identical aliases of the controlling threshold's own summaries -- the selection-rule change never touches this mapping", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const survey = buildValidation(BUYER_READINESS_SURVEY_ITEM);
  const validations = [survey, pilot];
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, validations, "English");
  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(CLM_STATE, validations, "English");
  assert.equal(plan.measurableSuccessCriterion, controlling.enterSummary);
  assert.equal(plan.monitorStatus, controlling.monitorSummary);
  assert.equal(plan.failureCriterion, controlling.avoidSummary);
});

test("TASK #47A: the 30% obtainable-share validation target named in this report's own decision brief is still surfaced verbatim in the closure plan's measurable success criterion -- never invented, never dropped by the selection-rule change", () => {
  const pilot = buildValidation(PILOT_RECRUITMENT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [pilot], "English");
  assert.match(plan.measurableSuccessCriterion, /30\s?%/);
});

test("TASK #47A: a linked recommendation whose action type is 'scale' can never become the authoritative closure-plan candidate merely by having complete fields -- resolveLinkedEvidenceGap (Task #38) already refuses to link non-validation/pilot actions, so this selection rule never sees one", () => {
  const scaleItem = "Scale the go-to-market team nationally over 6 months (Owner: Head of Sales) — Success criterion: $2M ARR.";
  const scaleValidation = buildValidation(scaleItem);
  assert.notEqual(scaleValidation.actionType, "validation");
  assert.notEqual(scaleValidation.actionType, "pilot");
  assert.equal(scaleValidation.relatedEvidenceGapId, null);
});

// --- 6. Web/PDF parity ------------------------------------------------------

test("TASK #47A: no render surface re-implements its own recommendation-to-gap selection logic -- page.tsx, Planner.tsx (web + PDF), and ReportPdfButton.tsx all consume resolveMarketIntelligenceControllingClosurePlan's own resolved output, never re-deriving owner/timeline themselves", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared resolver`);
    assert.doesNotMatch(
      source,
      /marketControllingClosurePlan\s*=\s*\{[\s\S]{0,200}owner:/,
      `${name}: must not hand-construct its own closure-plan object`
    );
  }
});

test("TASK #47A: resolveMarketIntelligenceControllingClosurePlan's own owner/timeline/budget selection now depends on selectAuthoritativeClosurePlanValidation -- confirmed via source, so web and PDF cannot structurally diverge on which candidate is authoritative", () => {
  const fnSource = evidenceGapsSource.match(/function resolveClosurePlanAssignment\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /selectAuthoritativeClosurePlanValidation\(/);
});
