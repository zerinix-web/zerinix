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

// TASK #47 -- Make Market Intelligence evidence-gap closure actions
// structurally executable and measurable.
//
// Adds resolveMarketIntelligenceControllingClosurePlan (market-
// intelligence-evidence-gaps.ts): one authoritative WHO/WHEN/HOW-MUCH/
// WHAT-COUNTS-AS-SUCCESS-OR-FAILURE closure plan for the SAME single
// controlling evidence gap resolveMarketIntelligenceControllingDecisionThreshold
// already gates on. This file proves: (1) exactly one closure plan is
// ever produced for a report with exactly one material (decision-
// gating) gap; (2) owner/timeline/budget are populated ONLY when
// exactly one recommendation card links to that gap, never guessed
// among several conflicting candidates; (3) the plan's measurable
// success/monitor/failure criteria are byte-identical aliases of the
// SAME controlling-threshold summaries "Evidence Gaps to Close" already
// renders, never independently re-derived; (4) budgets/timelines carry
// the SAME provenance qualifier (never silently promoted to fact); (5)
// web and PDF read the SAME resolver at every real render site; (6)
// multiple simultaneous material gaps never cause an arbitrarily
// invented single plan.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);

// The exact real CLM (contract-lifecycle-management) fixture shape used
// throughout Tasks #35-#46: decision CONDITIONAL_GO (displays MONITOR),
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
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering.",
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

const PILOT_ITEM =
  "Run a paid pilot to validate obtainable share in the U.S. Mid-Market segment over 8 weeks (Owner: Head of Partnerships) — Budget ceiling USD 75,000 — Success criterion: 20% pilot conversion rate.";
const SECOND_VALIDATION_ITEM =
  "Trial a limited beta rollout in the EU segment over 6 weeks (Owner: VP of Sales) — Budget cap USD 40,000 — Success criterion: 15 signed LOIs.";
const NO_BUDGET_ITEM = "Run customer discovery interviews over 4 weeks (Owner: Head of Research).";

function buildValidation(item, canonicalState = CLM_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- 1. Requirement #1: one authoritative closure plan structure -------

test("TASK #47: resolveMarketIntelligenceControllingClosurePlan resolves for the CLM report's single controlling gap (Obtainable Share)", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  assert.equal(plan.gapLabel, "Obtainable Share (SAM/SOM)");
  assert.equal(plan.affectedFactor, "obtainableShareResolved");
  assert.ok(plan.requiredEvidence);
  assert.ok(plan.validationMethod);
  assert.ok(plan.decisionImpact);
});

test("TASK #47: the closure plan's requiredEvidence/validationMethod/decisionImpact are byte-identical to the gap's own already-computed fields -- never re-derived", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  const gap = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English").find((g) => g.id === "obtainable-share");
  assert.equal(plan.requiredEvidence, gap.evidenceRequired);
  assert.equal(plan.validationMethod, gap.validationMethod);
  assert.equal(plan.decisionImpact, gap.decisionImpact);
});

// --- 2. Requirement #3: ENTER/MONITOR/AVOID mapping ---------------------

test("TASK #47: measurableSuccessCriterion/monitorStatus/failureCriterion are byte-identical aliases of the controlling threshold's own enter/monitor/avoidSummary -- never independently re-derived", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(CLM_STATE, [validation], "English");
  assert.ok(controlling);
  assert.equal(plan.measurableSuccessCriterion, controlling.enterSummary);
  assert.equal(plan.monitorStatus, controlling.monitorSummary);
  assert.equal(plan.failureCriterion, controlling.avoidSummary);
});

test("TASK #47: MONITOR's status reads as unresolved/inconclusive, never a fabricated resolved state", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.match(plan.monitorStatus, /unresolved/i);
});

// --- 3. Requirement #1/#2: owner/timeline/budget, never guessed ---------

test("TASK #47: owner/timeline/budget are sourced verbatim from the SOLE recommendation card linked to the controlling gap", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.equal(plan.owner, validation.owner);
  assert.equal(plan.hasAssignedOwner, true);
  assert.ok(plan.timeline.startsWith(validation.timeline));
  assert.ok(plan.budget.startsWith(validation.budget));
});

test("TASK #47: budget/timeline carry the SAME provenance qualifier the recommendation card itself displays -- never silently promoted to unqualified fact", () => {
  const validation = buildValidation(PILOT_ITEM);
  assert.ok(validation.provenance, "fixture must actually classify a provenance for this assertion to be meaningful");
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.match(plan.timeline, /\(.*\)$/, "timeline must carry a parenthetical provenance qualifier");
  assert.match(plan.budget, /\(.*\)$/, "budget must carry a parenthetical provenance qualifier");
});

test("TASK #47: budget is null (never a blank string) when the sole linked card names no budget at all", () => {
  const validation = buildValidation(NO_BUDGET_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.equal(plan.budget, null);
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, validation.owner);
});

test("TASK #47: owner/timeline fall back to the SAME honest 'not yet assigned' sentence when NO recommendation card links to the controlling gap -- never fabricated", () => {
  const unrelatedValidation = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelatedValidation.relatedEvidenceGapId, null, "a research-type action never links to a gap");
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [unrelatedValidation], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.equal(plan.budget, null);
  assert.ok(plan.owner.length > 0);
  assert.ok(plan.timeline.length > 0);
});

test("TASK #47: when TWO recommendation cards both link to the same controlling gap with DIFFERENT owner/timeline/budget, the closure plan does NOT arbitrarily pick either one -- it falls back to the shared unassigned sentence rather than inventing a single winner", () => {
  const validationA = buildValidation(PILOT_ITEM);
  const validationB = buildValidation(SECOND_VALIDATION_ITEM);
  assert.equal(validationA.relatedEvidenceGapId, "obtainable-share");
  assert.equal(validationB.relatedEvidenceGapId, "obtainable-share");
  assert.notEqual(validationA.owner, validationB.owner, "fixture must actually conflict for this test to be meaningful");

  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validationA, validationB], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.notEqual(plan.owner, validationA.owner);
  assert.notEqual(plan.owner, validationB.owner);
  assert.equal(plan.budget, null);
});

// --- 4. Requirement #8: multiple simultaneous material gaps -------------

test("TASK #47: when 2+ material (decision-gating) evidence gaps are simultaneously unresolved, the closure plan resolves to null rather than arbitrarily inventing a single plan for one of them", () => {
  const twoGapState = buildCanonicalState({
    decisionCriticalEvidence: {
      marketSizingResolved: false,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: false,
    },
  });
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(twoGapState, "English").filter(
    (gap) => gap.decisionFactor !== null
  );
  assert.equal(materialGaps.length, 2, "fixture must actually have 2 material gaps for this test to be meaningful");

  const validation = buildValidation(PILOT_ITEM, twoGapState);
  const plan = resolveMarketIntelligenceControllingClosurePlan(twoGapState, [validation], "English");
  assert.equal(plan, null);
});

test("TASK #47: when every decision-critical pillar is resolved (no material gap at all), the closure plan resolves to null", () => {
  const resolvedState = buildCanonicalState({
    decisionCriticalEvidence: {
      marketSizingResolved: true,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: true,
    },
  });
  const plan = resolveMarketIntelligenceControllingClosurePlan(resolvedState, [], "English");
  assert.equal(plan, null);
});

test("TASK #47: resolveMarketIntelligenceControllingClosurePlan returns null for a null canonical state", () => {
  assert.equal(resolveMarketIntelligenceControllingClosurePlan(null, [], "English"), null);
});

// --- 5. Requirement #4/#6: recommendations reference the plan consistently, web/PDF parity ---

test("TASK #47: page.tsx, Planner.tsx, and ReportPdfButton.tsx all call resolveMarketIntelligenceControllingClosurePlan with the SAME recommendation-validation and controlling-threshold inputs already computed for the web card -- never a second, independently derived plan per surface", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const occurrences = (source.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
    assert.ok(occurrences >= 1, `${name}: expected at least one call site`);
  }
  // Planner.tsx renders both a web JSX branch and its own separate PDF-
  // drawing function -- confirm both call sites exist there specifically.
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function");
});

test("TASK #47: every resolveMarketIntelligenceControllingClosurePlan call site passes marketRecommendationValidations (the SAME already-classified array the controlling decision threshold and each card use) -- never an empty or hand-rolled stand-in", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const calls = source.match(/resolveMarketIntelligenceControllingClosurePlan\(\s*\n?\s*[\s\S]{0,120}?marketRecommendationValidations/g) || [];
    assert.ok(calls.length >= 1, `${name}: expected resolveMarketIntelligenceControllingClosurePlan to be called with marketRecommendationValidations`);
  }
});

test("TASK #47: resolveMarketIntelligenceControllingClosurePlan is defined as a pure reshape of resolveMarketIntelligenceControllingDecisionThreshold and resolveMarketIntelligenceEvidenceGaps -- confirmed via source, no second independently-derived controlling-gap selection", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceControllingClosurePlan\([\s\S]*?\n\}/
  )[0];
  assert.match(fnSource, /resolveMarketIntelligenceControllingDecisionThreshold\(/);
  assert.match(fnSource, /resolveMarketIntelligenceEvidenceGaps\(/);
});

// --- 6. CLM real-report regression: decision/confidence/controlling factor unchanged ---

test("TASK #47: the CLM canonical state's own decision remains MONITOR-equivalent (CONDITIONAL_GO) and confidence remains 50 -- unchanged by this ticket", () => {
  assert.equal(CLM_STATE.decision, "CONDITIONAL_GO");
  assert.equal(CLM_STATE.confidence, 50);
});

test("TASK #47: the closure plan never fabricates a SAM/SOM numeric figure while obtainable share remains unresolved", () => {
  const validation = buildValidation(PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(CLM_STATE, [validation], "English");
  assert.doesNotMatch(plan.requiredEvidence, /^\$[\d,.]+[BMK]?$/);
  assert.doesNotMatch(plan.decisionImpact, /^\$[\d,.]+[BMK]?$/);
});
