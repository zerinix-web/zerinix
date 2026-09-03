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

// TASK #52 -- Make compound Market Intelligence decision thresholds
// structurally provenance-safe.
//
// ARCHITECTURAL WEAKNESS FOUND: a recommendation's own successCriterion
// is a single string carrying ONE card-level provenance
// (classifyStrategicRecommendationValidation, Task #38), even when that
// string bundles TWO structurally different sub-claims -- e.g. "at
// least 4 paid contracts within 9 months at average ACV above USD
// 25,000" combines a raw COUNT the pilot itself directly produces (paid
// contracts) with a PRICING/unit-economics figure (ACV) that is a
// modeled assumption layered ON TOP of that count, never something the
// pilot's own completion count measures. Task #51 correctly showed ONE
// provenance qualifier for the whole string, but a genuinely mixed claim
// was flattened to that single label -- "10 paying customers + USD 25k
// ACV" both reading as "Validation Target" even though the ACV figure
// is, by this report architecture's own established convention (Task
// #31: pricing/unit-economics figures are modeled assumptions), a
// PLANNING ASSUMPTION, not something a pilot's completion count proves.
//
// CANONICAL STRUCTURE IMPLEMENTED: MarketIntelligenceThresholdCriterion
// gained an ADDITIVE, optional `components: MarketIntelligenceThresholdComponent[]`
// breakdown (never removing or changing `.description`/`.provenance`/
// `.value` -- every existing consumer, including Closure Plan's own
// aliasing of enterSummary/avoidSummary, is unaffected for the common,
// single-component case). splitThresholdIntoComponents only splits out
// a separate clause when the string ALSO names a distinct pricing/unit-
// economics figure (ACV/deal size/contract value/price); a criterion
// with no such second figure returns ONE unsplit component, byte-
// identical to Task #51's own output. Each component's provenance is
// derived from THIS SAME card's already-classified provenance -- never
// stronger than what the card itself earned, and a pricing component is
// only ever narrowed FROM "validationTarget" DOWN to
// "planningAssumption" (never touched when the card is already
// "verifiedEvidence"/"benchmarkDerived", since a real citation or
// benchmark backing the WHOLE compound claim legitimately covers every
// clause of it).

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

// The real single-controlling-gap report state: MONITOR
// (CONDITIONAL_GO), 50% confidence, Obtainable Share the sole material
// gap.
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
    immediateNextAction: "Run the paid pilot before committing further budget.",
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

// The ticket's own real compound example.
const PAID_PILOT_ITEM =
  "Paid Pilot Program: run a paid pilot with named enterprise buyers over 9 months (Owner: Head of Sales) — Budget cap $75,000 — Success criterion: at least 4 paid contracts within 9 months at average ACV above USD 25,000.";
// A single-component (non-compound) recommendation, for backward-
// compatibility proof.
const SIMPLE_PILOT_ITEM =
  "Commercial Conversion Pilot: run a paid pilot to validate obtainable share with named enterprise buyers over 90 days (Owner: Head of Sales) — Success criterion: 20% pilot conversion rate.";
// An unrelated recommendation whose own numbers must never enter the
// controlling threshold (Task #50's semantic gate).
const UNRELATED_TECHNICAL_ITEM =
  "Vertical Technical Pilot: run a technical pilot extracting key terms from compliance clauses over 8 weeks (Owner: Head of Product) — Success criterion: 85% extraction accuracy.";

function buildValidation(item, canonicalState = REAL_STATE, signalsOverride = null) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: signalsOverride ?? extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- 1. Two-component threshold can carry two different provenance classes ---

test("TASK #52: the compound paid-pilot threshold splits into two components with DIFFERENT provenance -- count component stays validationTarget, pricing component narrows to planningAssumption", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  assert.equal(validation.provenance, "validationTarget");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation], "English");
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(enterCriterion);
  assert.ok(enterCriterion.components);
  assert.equal(enterCriterion.components.length, 2);

  const [countComponent, pricingComponent] = enterCriterion.components;
  assert.match(countComponent.text, /paid contracts/i);
  assert.equal(countComponent.provenance, "validationTarget");
  assert.match(pricingComponent.text, /ACV/i);
  assert.equal(pricingComponent.provenance, "planningAssumption");

  // Both provenance labels must be VISIBLE in the description text --
  // this is the exact ticket example.
  assert.match(enterCriterion.description, /paid contracts within 9 months \(Validation Target\)/);
  assert.match(enterCriterion.description, /ACV above USD 25,000 \(Planning Assumption\)/);
});

// --- 2. Verified + assumption stays mixed, not flattened ---

test("TASK #52: verified + assumption stays mixed -- a citation-backed card still narrows its OWN pricing component only when the card itself is 'validationTarget', never when it is already 'verifiedEvidence'", () => {
  const state = buildCanonicalState({
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
  });
  const validation = buildValidation(PAID_PILOT_ITEM, state, {
    ...extractRecommendationSignals(PAID_PILOT_ITEM),
    evidenceTie: "Confirmed by [R4].",
  });
  assert.equal(validation.provenance, "verifiedEvidence");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  // A real citation backing the WHOLE compound claim legitimately covers
  // every clause of it -- both components stay verifiedEvidence, never
  // arbitrarily downgraded.
  for (const component of enterCriterion.components) {
    assert.equal(component.provenance, "verifiedEvidence");
  }
});

// --- 3. Validation target + planning assumption stays mixed ------------------

test("TASK #52: the mixed validationTarget/planningAssumption split survives into BOTH the ENTER and AVOID descriptions -- never flattened to a single label on either side", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation], "English");

  const avoidCriterion = threshold.avoidConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(avoidCriterion);
  assert.equal(avoidCriterion.components.length, 2);
  assert.equal(avoidCriterion.components[0].provenance, "validationTarget");
  assert.equal(avoidCriterion.components[1].provenance, "planningAssumption");
  assert.match(avoidCriterion.description, /\(Validation Target\)/);
  assert.match(avoidCriterion.description, /\(Planning Assumption\)/);
});

// --- 4. Missing provenance fails safely --------------------------------------

test("TASK #52: when the card itself has no classifiable provenance at all, no components are ever fabricated -- the criterion is simply omitted, never a guessed/partial breakdown", () => {
  const noNumberItem = "Run informal check-ins with existing customers (Owner: Head of Support).";
  const validation = buildValidation(noNumberItem);
  assert.equal(validation.provenance, null);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(enterCriterion, undefined, "no recommendation-derived criterion should exist when provenance cannot be established");
});

// --- 5. Unrelated recommendation numbers remain excluded ---------------------

test("TASK #52: an unrelated technical recommendation's own numbers can never enter the Obtainable Share threshold or its components -- Task #50's semantic gate remains intact", () => {
  const unrelated = buildValidation(UNRELATED_TECHNICAL_ITEM);
  assert.equal(unrelated.relatedEvidenceGapId, null);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [unrelated]);
  assert.doesNotMatch(threshold.enterSummary, /85%/);
  assert.doesNotMatch(threshold.avoidSummary, /85%/);
});

// --- 6. Closure Plan and Decision Threshold use identical canonical components ---

test("TASK #52: Closure Plan's measurableSuccessCriterion/failureCriterion are BYTE-IDENTICAL to the Decision Threshold's own enterSummary/avoidSummary, including the per-component provenance breakdown -- never independently reconstructed", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validation]);
  assert.equal(plan.measurableSuccessCriterion, threshold.enterSummary);
  assert.equal(plan.failureCriterion, threshold.avoidSummary);
  assert.match(plan.measurableSuccessCriterion, /\(Validation Target\)/);
  assert.match(plan.measurableSuccessCriterion, /\(Planning Assumption\)/);
});

// --- 7. UI/PDF parity ---------------------------------------------------------

test("TASK #52: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan/resolveMarketIntelligenceControllingDecisionThreshold results -- no renderer independently splits or re-parses compound thresholds, and no per-component UI/PDF code was needed since the qualified text renders through the SAME existing string fields", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingDecisionThreshold\(/, `${name}: must call the shared threshold resolver`);
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared closure-plan resolver`);
    assert.doesNotMatch(source, /function splitThresholdIntoComponents/, `${name}: must not duplicate the compound-splitting logic`);
    assert.doesNotMatch(source, /function classifyThresholdComponentProvenance/, `${name}: must not duplicate the component classifier`);
  }
});

// --- 8. Single-component thresholds remain backward compatible --------------

test("TASK #52: a single-component (non-compound) threshold produces a length-1 components array and byte-identical description text to Task #51's own output", () => {
  const validation = buildValidation(SIMPLE_PILOT_ITEM);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(enterCriterion);
  assert.equal(enterCriterion.components.length, 1);
  assert.equal(enterCriterion.components[0].text, validation.successCriterion);
  assert.equal(enterCriterion.components[0].provenance, validation.provenance);
  assert.equal(enterCriterion.description, `${validation.successCriterion} (${enterCriterion.provenance === "validationTarget" ? "Validation Target" : enterCriterion.provenance}).`);
});

// --- 9. Real-report MONITOR/50% behavior unchanged ---------------------------

test("TASK #52: canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share (SAM/SOM) remains the sole controlling factor -- unaffected by the compound-threshold fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
  assert.equal(materialGaps[0].label, "Obtainable Share (SAM/SOM)");
});

test("TASK #52: resolving the controlling decision threshold and closure plan never mutates canonical decision, confidence, or decisionCriticalEvidence", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const before = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validation]);
  const after = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  assert.equal(before, after);
});

test("TASK #52 (drift check): the component classifier never upgrades a component past its own card's provenance -- pricing is only ever narrowed FROM validationTarget, never assigned a stronger tier than the card itself carries", () => {
  const fnSource = evidenceGapsSource.match(/function classifyThresholdComponentProvenance\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /if \(cardProvenance !== "validationTarget"\) return cardProvenance;/);
  assert.match(fnSource, /"planningAssumption"/);
  assert.doesNotMatch(fnSource, /"verifiedEvidence"|"benchmarkDerived"/);
});
