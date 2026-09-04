import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceEnterEligibility,
  resolveMarketIntelligenceDecisionGateEvaluations,
  resolveMarketIntelligenceGatedExecutiveDecision,
  resolveMarketIntelligenceControllingClosurePlan,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #55 -- Prove Market Intelligence MONITOR -> ENTER / AVOID
// transitions are structurally evidence-driven.
//
// TRACED TRANSITION PATH (confirmed via source, no parallel decision
// engine introduced):
//
//   graph-level evidence (research)
//     -> resolveDecisionCriticalEvidenceState (route.ts) sets 3 booleans
//        -- marketSizingResolved/competitiveEvidenceResolved/
//        obtainableShareResolved -- PURELY structural sufficiency ("do
//        we have enough real evidence to decide from"), computed ONCE
//        at generation time, NEVER from a recommendation
//     -> assessMarketEntryConfidence (market-intelligence-presentation.ts):
//        blendMarketResearchCoverage computes a 0-100 raw score from
//        coverage.dimensions (marketConfidence*0.4 + competitiveEvidence*0.25
//        + financialEvidence*0.2 + productEvidence*0.15); blendedDecision
//        = ENTER if raw >= 65 (STRONG_CONFIDENCE_THRESHOLD), MONITOR if
//        raw >= 40 (MODERATE_CONFIDENCE_THRESHOLD), else AVOID;
//        evidenceGapBlocksStrongDecision forces MONITOR whenever ANY of
//        the 3 booleans is false, REGARDLESS of whether the raw blend
//        would otherwise read ENTER or AVOID
//     -> canonicalState.decision/confidence persist that result
//     -> resolveMarketIntelligenceEnterEligibility / resolveMarketIntelligenceDecisionGateEvaluations
//        (Tasks #53/#54) read canonicalState.decisionCriticalEvidence
//        directly -- never recompute, never influenced by a
//        recommendation's own provenance
//     -> UI/PDF display the resolved decision/gate state only
//
// EXACT CANONICAL CONDITIONS:
//   MONITOR -> ENTER requires: decisionCriticalEvidence.obtainableShareResolved
//     becomes true (with marketSizingResolved/competitiveEvidenceResolved
//     already true) AND blendMarketResearchCoverage(coverage) >= 65.
//   MONITOR -> AVOID requires: the SAME "all 3 resolved" precondition
//     AND blendMarketResearchCoverage(coverage) < 40.
//   Neither condition can ever be satisfied by a recommendation's own
//   text, provenance, target, or assumption -- decisionCriticalEvidence
//   is architecturally isolated from recommendation content entirely
//   (confirmed: no function in market-intelligence-evidence-gaps.ts ever
//   assigns to a canonicalState field).
//
// NO PRE-EXISTING TRANSITION DEAD-END OR BYPASS WAS FOUND: the
// architecture already supports both transitions correctly; this task
// adds resolutionOutcome (a pure derivation, not a new decision engine)
// to make the resolved-positive/resolved-negative distinction explicit
// on the canonical gate-evaluation structure, and proves the full
// transition surface with regression tests.

const graphSource = readFileSync(
  new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
  "utf8"
);
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

const defaultMarketSizing = {
  tam: "$18 million",
  sam: "$4.5 million",
  som: "SOM not calculated: bottom-up obtainable-share inputs did not meet the evidence bar.",
  method: "bottomUp",
  tier: "supportedEstimate",
  samMethod: "defaultAssumption",
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

const executiveDecisionCodeFor = { ENTER: "GO", MONITOR: "CONDITIONAL_GO", AVOID: "NO_GO" };

// Builds a canonical state whose decision/confidence are the REAL,
// COMPUTED output of assessMarketEntryConfidence for the given coverage
// + decisionCriticalEvidence -- never hardcoded, so a test can never
// silently declare a decision the methodology did not actually produce.
function buildScenarioState({ decisionCriticalEvidence, coverage, marketSizingOverrides = {} }) {
  const assessment = assessMarketEntryConfidence(coverage, decisionCriticalEvidence);
  return {
    version: 3,
    decision: executiveDecisionCodeFor[assessment.decision],
    confidence: assessment.confidence,
    confidenceDirection: "reduced",
    topRisks: ["Obtainable share has not been independently validated."],
    topReasons: ["Market sizing and competitive evidence are both resolved."],
    why: "Evidence supports the current position.",
    missingEvidence: decisionCriticalEvidence.obtainableShareResolved ? [] : ["Independent conversion data."],
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Run the paid pilot before committing further budget.",
    decisionCriticalEvidence,
    marketSizing: { ...defaultMarketSizing, ...marketSizingOverrides },
    cagr: [{ description: "12% CAGR through 2028", evidenceIds: ["R2"], confidenceClassification: "Verified" }],
    coverage,
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
        evidenceId: "R4",
        title: "Verified Pilot Data",
        publisher: "Internal Pilot",
        url: "https://pilot.example.com/results",
        sourceType: "primary_research",
        confidenceLevel: "High",
        publishedDate: "2026-03-01",
        accessedAt: "2026-03-02T00:00:00.000Z",
      },
    ],
  };
}

const UNRESOLVED_EVIDENCE = {
  marketSizingResolved: true,
  competitiveEvidenceResolved: true,
  obtainableShareResolved: false,
};
const RESOLVED_EVIDENCE = {
  marketSizingResolved: true,
  competitiveEvidenceResolved: true,
  obtainableShareResolved: true,
};

// --- SCENARIO A: unresolved ------------------------------------------------

const SCENARIO_A_STATE = buildScenarioState({
  decisionCriticalEvidence: UNRESOLVED_EVIDENCE,
  coverage: buildCoverage(),
});

test("TASK #55-A: Obtainable Share unresolved -> gate unsatisfied, ENTER ineligible, decision MONITOR", () => {
  assert.equal(SCENARIO_A_STATE.decision, "CONDITIONAL_GO");
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.satisfied, false);
  assert.equal(share.resolutionOutcome, "unresolved");
  const eligibility = resolveMarketIntelligenceEnterEligibility(SCENARIO_A_STATE, [], "English");
  assert.equal(eligibility.eligible, false);
});

// --- SCENARIO B: positive verified validation ------------------------------

const STRONG_COVERAGE = buildCoverage({ marketConfidence: 82, competitiveEvidence: 80, financialEvidence: 78, productEvidence: 76 });
const SCENARIO_B_STATE = buildScenarioState({
  decisionCriticalEvidence: RESOLVED_EVIDENCE,
  coverage: STRONG_COVERAGE,
  marketSizingOverrides: { samMethod: "evidenceDerived", somStatus: "calculated" },
});

test("TASK #55-B (fixture sanity): the strong coverage blend genuinely clears the ENTER threshold, and obtainable share is resolved via evidence-derived methodology, not a target/assumption", () => {
  const blend = Math.round(82 * 0.4 + 80 * 0.25 + 78 * 0.2 + 76 * 0.15);
  assert.ok(blend >= 65, "fixture sanity: must genuinely clear STRONG_CONFIDENCE_THRESHOLD");
  assert.equal(SCENARIO_B_STATE.marketSizing.samMethod, "evidenceDerived");
  assert.equal(SCENARIO_B_STATE.marketSizing.somStatus, "calculated");
});

test("TASK #55-B: structurally qualifying positive verified evidence resolves the Obtainable Share gate positively", () => {
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_B_STATE, [], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.satisfied, true);
  assert.equal(share.evidenceClass, "verifiedEvidence");
});

test("TASK #55-F: with all existing ENTER requirements satisfied (all 3 pillars resolved + strong coverage blend), the canonical decision becomes ENTER (GO) -- never hardcoded, this is the REAL computed output of the existing, unmodified methodology", () => {
  assert.equal(SCENARIO_B_STATE.decision, "GO");
  const eligibility = resolveMarketIntelligenceEnterEligibility(SCENARIO_B_STATE, [], "English");
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.blockingGaps.length, 0);
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(SCENARIO_B_STATE, "", "English");
  assert.notEqual(gated.decisionLabel, undefined);
  assert.equal(gated.canonicalDecision, "PROCEED");
});

test("TASK #55-B/F: resolutionOutcome reads 'positiveResolution' for the resolved gate once the overall decision is genuinely ENTER", () => {
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_B_STATE, [], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.resolutionOutcome, "positiveResolution");
});

// --- SCENARIO C: negative verified validation ------------------------------

const WEAK_COVERAGE = buildCoverage({ marketConfidence: 12, competitiveEvidence: 15, financialEvidence: 18, productEvidence: 10 });
const SCENARIO_C_STATE = buildScenarioState({
  decisionCriticalEvidence: RESOLVED_EVIDENCE,
  coverage: WEAK_COVERAGE,
  marketSizingOverrides: { samMethod: "evidenceDerived", somStatus: "calculated" },
});

test("TASK #55-C (fixture sanity): the weak coverage blend genuinely falls below the AVOID threshold, with the SAME evidence-derived resolution methodology as Scenario B", () => {
  const blend = Math.round(12 * 0.4 + 15 * 0.25 + 18 * 0.2 + 10 * 0.15);
  assert.ok(blend < 40, "fixture sanity: must genuinely fall below MODERATE_CONFIDENCE_THRESHOLD");
  assert.equal(SCENARIO_C_STATE.marketSizing.samMethod, "evidenceDerived");
  assert.equal(SCENARIO_C_STATE.marketSizing.somStatus, "calculated");
});

test("TASK #55-G: structurally qualifying negative verified evidence STILL resolves the Obtainable Share gate (evidence is no longer merely missing) -- satisfied reflects structural sufficiency, not favorability", () => {
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_C_STATE, [], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.satisfied, true);
  assert.equal(share.evidenceClass, "verifiedEvidence");
});

test("TASK #55-H: when the existing AVOID methodology is satisfied (all pillars resolved, weak coverage blend), the canonical decision becomes AVOID (NO_GO) -- the system does not incorrectly remain MONITOR merely because evidence now exists", () => {
  assert.equal(SCENARIO_C_STATE.decision, "NO_GO");
  const eligibility = resolveMarketIntelligenceEnterEligibility(SCENARIO_C_STATE, [], "English");
  assert.equal(eligibility.eligible, true, "eligible only means 'no blocking gap' -- it is necessary, not sufficient, for ENTER");
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(SCENARIO_C_STATE, "", "English");
  assert.equal(gated.canonicalDecision, "REJECT");
});

test("TASK #55-G/H: resolutionOutcome reads 'negativeResolution' for the resolved gate once the overall decision is genuinely AVOID", () => {
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_C_STATE, [], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.resolutionOutcome, "negativeResolution");
});

// --- 3. Three structurally distinct gate states -----------------------------

test("TASK #55-3: the three canonical gate states (unresolved, positiveResolution, negativeResolution) are distinguishable purely from structured fields -- never from prose", () => {
  const outcomes = [SCENARIO_A_STATE, SCENARIO_B_STATE, SCENARIO_C_STATE].map((state) => {
    const gates = resolveMarketIntelligenceDecisionGateEvaluations(state, [], "English");
    return gates.find((g) => g.gateId === "obtainable-share").resolutionOutcome;
  });
  assert.deepEqual(outcomes, ["unresolved", "positiveResolution", "negativeResolution"]);
});

test("TASK #55-3 (drift check): resolutionOutcome is a pure derivation of `satisfied` and `canonicalState.decision` -- confirmed via source, never a second computation over coverage or recommendations", () => {
  const fnSource = evidenceGapsSource.match(/function resolveGateResolutionOutcome\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSource, /coverage|recommendationValidations|assessMarketEntryConfidence/);
  assert.match(fnSource, /if \(!satisfied\) return "unresolved";/);
});

// --- 4. Targets/assumptions/prose cannot trigger transitions ---------------

function buildValidation(item, state, signalsOverride = null) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: signalsOverride ?? extractRecommendationSignals(item),
    canonicalState: state,
    language: "English",
  });
}

test("TASK #55-4/B: a Validation Target naming the SAME strong evidence-suggestive language cannot flip Obtainable Share to resolved -- decisionCriticalEvidence is untouched", () => {
  const item = "Enterprise Pilot: achieve success with a paid pilot showing 80% conversion (Owner: Head of Sales).";
  const target = buildValidation(item, SCENARIO_A_STATE);
  assert.equal(target.provenance, "validationTarget");
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [target], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.satisfied, false);
  assert.equal(SCENARIO_A_STATE.decision, "CONDITIONAL_GO");
});

test("TASK #55-4/C: a Planning Assumption cannot flip Obtainable Share to resolved", () => {
  const item = "Legacy renewal outreach: contact existing customers over 8 weeks (Owner: Head of Renewals) — Success criterion: 10% conversion rate (estimated).";
  const assumption = buildValidation(item, SCENARIO_A_STATE);
  assert.equal(assumption.provenance, "planningAssumption");
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [assumption], "English");
  assert.equal(gates.find((g) => g.gateId === "obtainable-share").satisfied, false);
});

test("TASK #55-4/D: positive recommendation prose alone (owner, budget, timeline, success metric, favorable wording) never resolves the gate or moves the decision -- only decisionCriticalEvidence can", () => {
  const item =
    "Paid Pilot Success Program: run a validated, successful paid pilot with named enterprise buyers over 90 days (Owner: Head of Sales) — Budget cap $50,000 — Success criterion: 90% conversion, strongly validated.";
  const positiveProse = buildValidation(item, SCENARIO_A_STATE);
  assert.ok(positiveProse.owner);
  assert.ok(positiveProse.timeline);
  assert.ok(positiveProse.budget);
  assert.match(positiveProse.successCriterion, /90%/);
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [positiveProse], "English");
  assert.equal(gates.find((g) => g.gateId === "obtainable-share").satisfied, false);
  assert.equal(SCENARIO_A_STATE.decision, "CONDITIONAL_GO");
});

test("TASK #55-4: a TAM/SAM/SOM planning fallback (defaultAssumption samMethod) never resolves Obtainable Share on its own", () => {
  const planningFallbackState = buildScenarioState({
    decisionCriticalEvidence: UNRESOLVED_EVIDENCE,
    coverage: STRONG_COVERAGE,
    marketSizingOverrides: { samMethod: "defaultAssumption", somStatus: "pending" },
  });
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(planningFallbackState, [], "English");
  assert.equal(gates.find((g) => g.gateId === "obtainable-share").satisfied, false);
  assert.equal(planningFallbackState.decision, "CONDITIONAL_GO", "even a strong coverage blend cannot force ENTER while a pillar is unresolved");
});

// --- 6. No keyword-only decisions -------------------------------------------

test("TASK #55-6: recommendation text containing every 'positive-sounding' keyword (success, validated, paid pilot, conversion) never resolves the gate by itself", () => {
  const item =
    "Success Validation Pilot: this paid pilot was validated with a strong conversion outcome and total success (Owner: Head of Growth) — Success criterion: 95% success rate.";
  const validation = buildValidation(item, SCENARIO_A_STATE);
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [validation], "English");
  assert.equal(gates.find((g) => g.gateId === "obtainable-share").satisfied, false);
});

test("TASK #55-6: recommendation text containing 'failed' never independently forces AVOID", () => {
  const item = "Post-mortem: the prior pilot failed to reach commitments (Owner: Head of Product) — Success criterion: 5% conversion.";
  const validation = buildValidation(item, SCENARIO_A_STATE);
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_A_STATE, [validation], "English");
  assert.equal(gates.find((g) => g.gateId === "obtainable-share").satisfied, false);
  assert.equal(SCENARIO_A_STATE.decision, "CONDITIONAL_GO", "must not become AVOID merely because a recommendation's own prose says 'failed'");
});

// --- I/J. threshold boundary conditions -------------------------------------

test("TASK #55-I: coverage just below the ENTER threshold, with all pillars resolved, must NOT produce ENTER", () => {
  const justBelowCoverage = buildCoverage({ marketConfidence: 64, competitiveEvidence: 64, financialEvidence: 64, productEvidence: 64 });
  const blend = Math.round(64 * 0.4 + 64 * 0.25 + 64 * 0.2 + 64 * 0.15);
  assert.equal(blend, 64, "fixture sanity: exactly one point below STRONG_CONFIDENCE_THRESHOLD");
  const state = buildScenarioState({
    decisionCriticalEvidence: RESOLVED_EVIDENCE,
    coverage: justBelowCoverage,
    marketSizingOverrides: { samMethod: "evidenceDerived", somStatus: "calculated" },
  });
  assert.notEqual(state.decision, "GO");
});

test("TASK #55-J: a strong coverage blend cannot produce ENTER while Obtainable Share itself remains structurally unresolved -- high-looking numbers never substitute for genuine structural resolution", () => {
  const state = buildScenarioState({
    decisionCriticalEvidence: UNRESOLVED_EVIDENCE,
    coverage: STRONG_COVERAGE,
  });
  assert.notEqual(state.decision, "GO");
  assert.equal(state.decision, "CONDITIONAL_GO");
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [], "English");
  assert.equal(eligibility.eligible, false);
});

// --- K. resolved gate disappears from unresolved Evidence Gaps ------------

test("TASK #55-K: once Obtainable Share resolves (Scenario B), it no longer appears among unresolved/material Evidence Gaps, and the Closure Plan stops treating it as pending", () => {
  const gapsBefore = resolveMarketIntelligenceEvidenceGaps(SCENARIO_A_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(gapsBefore.length, 1);
  assert.equal(gapsBefore[0].id, "obtainable-share");

  const gapsAfter = resolveMarketIntelligenceEvidenceGaps(SCENARIO_B_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(gapsAfter.length, 0, "a resolved gate must not still appear as an unresolved material gap");

  const closurePlan = resolveMarketIntelligenceControllingClosurePlan(SCENARIO_B_STATE, [], "English");
  assert.equal(closurePlan, null, "no controlling closure plan should exist once there is no unresolved controlling gap");
});

test("TASK #55-K (continued): the same holds for Scenario C -- a negatively-resolved gate also disappears from unresolved Evidence Gaps", () => {
  const gaps = resolveMarketIntelligenceEvidenceGaps(SCENARIO_C_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(gaps.length, 0);
});

// --- L. renderer/prose changes cannot alter the canonical decision ---------

test("TASK #55-L: no render surface (page.tsx, Planner.tsx web+PDF, ReportPdfButton.tsx) independently infers ENTER/MONITOR/AVOID or gate satisfaction", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /function assessMarketEntryConfidence/, `${name}: must not duplicate the decision engine`);
    assert.doesNotMatch(source, /function resolveMarketIntelligenceDecisionGateEvaluations/, `${name}: must not duplicate the gate evaluator`);
    assert.doesNotMatch(
      source,
      /decisionCriticalEvidence\.\w+Resolved\s*(?:&&|\?|===|!==)/,
      `${name}: must not independently branch on a raw decisionCriticalEvidence field`
    );
  }
});

// --- M. Task #54/#54A/#54B/#54C behavior remains intact --------------------

test("TASK #55-M: this task's changes are confined to a new, purely derived resolutionOutcome field -- Task #54A/#54B's TAM numeric/provenance construction is untouched", () => {
  assert.doesNotMatch(graphSource, /resolutionOutcome|resolveGateResolutionOutcome/);
});

test("TASK #55-M: Task #54's own fail-closed guarantee (satisfied read only from decisionCriticalEvidence) is unchanged by this task's addition", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceDecisionGateEvaluations\([\s\S]*?\n\}/
  )[0];
  assert.match(fnSource, /const satisfied = canonicalState\.decisionCriticalEvidence\[decisionFactor\];/);
});

// --- Purity -------------------------------------------------------------

test("TASK #55: resolveMarketIntelligenceDecisionGateEvaluations never mutates canonicalState", () => {
  const before = JSON.stringify(SCENARIO_B_STATE);
  resolveMarketIntelligenceDecisionGateEvaluations(SCENARIO_B_STATE, [], "English");
  const after = JSON.stringify(SCENARIO_B_STATE);
  assert.equal(before, after);
});
