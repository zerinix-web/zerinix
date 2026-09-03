import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceControllingClosurePlan,
  resolveMarketIntelligenceGapClosurePlan,
  resolveMarketIntelligenceMultiGapPriorityState,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #48 -- Make Market Intelligence multi-gap evidence closure
// structurally authoritative.
//
// ROOT ARCHITECTURAL ISSUE (the documented note from Tasks #46/#47C):
// resolveLinkedEvidenceGap, resolveMarketIntelligenceControllingDecisionThreshold,
// and resolveMarketIntelligenceControllingClosurePlan all abstained
// entirely -- correctly, never guessing -- whenever 2+ material
// (decision-gating) evidence gaps were simultaneously unresolved. This
// left no defensible prioritized view at all for a multi-gap MONITOR
// report, even when the report's own structured data already
// distinguishes the gaps (one has a report-stated threshold and/or a
// structurally linked recommendation, the other has neither).
//
// FIX: resolveMarketIntelligenceMultiGapPriorityState ranks material
// gaps using ONLY two already-existing, already-structural signals, in a
// FIXED precedence (never an invented weighted score):
//   Tier "linkedRecommendation" (highest) -- a recommendation
//     structurally links to this specific gap (relatedEvidenceGapId,
//     via resolveLinkedEvidenceGap's Task #48 widening: a numeric,
//     type-aware match between the action's own successCriterion and
//     this gap's own report-stated successThreshold -- never a guess,
//     never prose/keyword matching).
//   Tier "reportStatedThreshold" -- no linked recommendation, but the
//     report's own decision brief names a real threshold for this gap
//     (gap.successThreshold, Task #35, now also wired to the market-
//     sizing gap via a DOLLAR-scoped extractor kept separate from
//     obtainable-share's PERCENTAGE-scoped one specifically so two
//     gaps mentioned in the SAME sentence can never collide on the same
//     first-matched figure).
//   Tier "unranked" -- neither.
// A gap reaching a strictly higher tier than every other material gap
// becomes PRIMARY; the rest become SECONDARY. 2+ gaps tying at the
// highest tier become explicitly CO-CONTROLLING (primaryGap stays
// null) -- never an arbitrary pick. Exactly one material gap is ALWAYS
// primary regardless of tier (byte-identical to Task #47C).

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);

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
    citationSources: [],
    ...overrides,
  };
}

function buildValidation(item, canonicalState) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- 1. One material gap -> existing behavior unchanged --------------------

test("TASK #48: with exactly one material gap, primaryGap is that gap and its closurePlan is BYTE-IDENTICAL to resolveMarketIntelligenceControllingClosurePlan's own direct output -- Task #47C behavior is completely unaffected", () => {
  const state = buildCanonicalState();
  const pilotItem =
    "Run a paid pilot to validate obtainable share over 90 days (Owner: Head of Sales) — Success criterion: 20% pilot conversion rate.";
  const validation = buildValidation(pilotItem, state);

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [validation], "English");
  const directClosurePlan = resolveMarketIntelligenceControllingClosurePlan(state, [validation], "English");

  assert.equal(priority.materialGaps.length, 1);
  assert.equal(priority.primaryGap.id, "obtainable-share");
  assert.equal(priority.secondaryGaps.length, 0);
  assert.equal(priority.coControllingGaps.length, 0);
  assert.deepEqual(priority.primaryClosurePlan, directClosurePlan);
  assert.equal(priority.prioritized.length, 1);
  assert.equal(priority.prioritized[0].status, "primary");
  assert.deepEqual(priority.prioritized[0].closurePlan, directClosurePlan);
});

// --- 2. Two gaps with a structurally stronger primary -----------------------

test("TASK #48: with two material gaps where only ONE has a report-stated threshold, that gap is PRIMARY and the other is SECONDARY -- never an arbitrary pick", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision: "An obtainable share above 15% would support ENTER; further diligence would be required before reconsidering.",
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state, "English");
  const marketSizingGap = gaps.find((g) => g.id === "market-sizing");
  const obtainableShareGap = gaps.find((g) => g.id === "obtainable-share");
  assert.equal(marketSizingGap.successThreshold, null, "fixture must genuinely leave market-sizing unranked");
  assert.equal(obtainableShareGap.successThreshold, "above 15%");

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [], "English");
  assert.equal(priority.materialGaps.length, 2);
  assert.ok(priority.primaryGap);
  assert.equal(priority.primaryGap.id, "obtainable-share");
  assert.equal(priority.secondaryGaps.length, 1);
  assert.equal(priority.secondaryGaps[0].id, "market-sizing");
  assert.equal(priority.coControllingGaps.length, 0);
});

// --- 3. Two genuinely equal/co-controlling gaps -----------------------------

test("TASK #48: with two material gaps that are EQUALLY unranked (no threshold, no linked recommendation for either), both are represented as CO-CONTROLLING -- never a guess between them", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering.",
  });
  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [], "English");

  assert.equal(priority.materialGaps.length, 2);
  assert.equal(priority.primaryGap, null);
  assert.equal(priority.secondaryGaps.length, 0);
  assert.equal(priority.coControllingGaps.length, 2);
  const coControllingIds = priority.coControllingGaps.map((g) => g.id).sort();
  assert.deepEqual(coControllingIds, ["market-sizing", "obtainable-share"]);
  for (const entry of priority.prioritized) {
    assert.equal(entry.status, "coControlling");
    assert.equal(entry.tier, "unranked");
  }
});

// --- 4. Primary gap linked to recommendation while secondary is not --------

test("TASK #48: when only the obtainable-share gap has a structurally linked recommendation, it becomes PRIMARY with a real owner/timeline; the unlinked market-sizing gap is SECONDARY with the honest 'not yet assigned' fallback", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision: "An obtainable share above 12% would support ENTER; further diligence would be required before reconsidering.",
  });
  const pilotItem =
    "Run a paid pilot to validate obtainable share over 90 days (Owner: Head of Sales) — Success criterion: obtainable share above 12%.";
  const validation = buildValidation(pilotItem, state);
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [validation], "English");
  assert.ok(priority.primaryGap);
  assert.equal(priority.primaryGap.id, "obtainable-share");
  assert.equal(priority.primaryClosurePlan.owner, "Head of Sales");
  assert.equal(priority.primaryClosurePlan.hasAssignedOwner, true);

  const secondaryEntry = priority.prioritized.find((entry) => entry.gap.id === "market-sizing");
  assert.equal(secondaryEntry.status, "secondary");
  assert.equal(secondaryEntry.closurePlan.hasAssignedOwner, false);
  assert.match(secondaryEntry.closurePlan.owner, /not yet assigned/i);
});

// --- 5. Both gaps linked to DIFFERENT recommendations -----------------------

test("TASK #48: when market-sizing and obtainable-share EACH have their own distinct, structurally linked recommendation, both resolve their OWN real owner/timeline -- never cross-contaminated, and (being equally well-supported) represented as CO-CONTROLLING rather than one arbitrarily outranking the other", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision:
      "A verified TAM above $2 billion and an obtainable share above 10% would together support ENTER; further diligence would be required before reconsidering.",
  });
  const marketSizingItem =
    "Commission a verified market-sizing pilot study to validate total addressable market over 60 days (Owner: Head of Market Research) — Success criterion: a verified TAM above $2 billion.";
  const obtainableShareItem =
    "Run a paid pilot to validate obtainable share over 90 days (Owner: Head of Sales) — Success criterion: obtainable share above 10%.";

  const sizingValidation = buildValidation(marketSizingItem, state);
  const shareValidation = buildValidation(obtainableShareItem, state);
  assert.equal(sizingValidation.relatedEvidenceGapId, "market-sizing");
  assert.equal(shareValidation.relatedEvidenceGapId, "obtainable-share");

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [sizingValidation, shareValidation], "English");
  assert.equal(priority.primaryGap, null);
  assert.equal(priority.coControllingGaps.length, 2);

  const sizingEntry = priority.prioritized.find((entry) => entry.gap.id === "market-sizing");
  const shareEntry = priority.prioritized.find((entry) => entry.gap.id === "obtainable-share");
  assert.equal(sizingEntry.status, "coControlling");
  assert.equal(shareEntry.status, "coControlling");
  assert.equal(sizingEntry.closurePlan.owner, "Head of Market Research");
  assert.equal(shareEntry.closurePlan.owner, "Head of Sales");
  assert.notEqual(sizingEntry.closurePlan.owner, shareEntry.closurePlan.owner);
  assert.ok(sizingEntry.closurePlan.timeline.startsWith("60 days"));
  assert.ok(shareEntry.closurePlan.timeline.startsWith("90 days"));
});

test("TASK #48: resolveMarketIntelligenceGapClosurePlan resolves each gap independently and never borrows a field from a DIFFERENT gap's recommendation", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision:
      "A verified TAM above $2 billion and an obtainable share above 10% would together support ENTER; further diligence would be required before reconsidering.",
  });
  const marketSizingItem =
    "Commission a verified market-sizing pilot study to validate total addressable market over 60 days (Owner: Head of Market Research) — Success criterion: a verified TAM above $2 billion.";
  const obtainableShareItem =
    "Run a paid pilot to validate obtainable share over 90 days (Owner: Head of Sales) — Success criterion: obtainable share above 10%.";
  const sizingValidation = buildValidation(marketSizingItem, state);
  const shareValidation = buildValidation(obtainableShareItem, state);
  const validations = [sizingValidation, shareValidation];

  const sizingPlan = resolveMarketIntelligenceGapClosurePlan(state, "market-sizing", validations, "English");
  const sharePlan = resolveMarketIntelligenceGapClosurePlan(state, "obtainable-share", validations, "English");
  assert.equal(sizingPlan.gapId, "market-sizing");
  assert.equal(sharePlan.gapId, "obtainable-share");
  assert.notEqual(sizingPlan.owner, sharePlan.owner);
  assert.notEqual(sizingPlan.timeline, sharePlan.timeline);
});

// --- 6. No fabricated owner/timeline/budget ---------------------------------

test("TASK #48: with two material gaps and NO recommendations at all, every closure plan honestly reports 'not yet assigned' / 'no timeline committed' / null budget -- never fabricated", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
  });
  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [], "English");
  assert.equal(priority.materialGaps.length, 2);
  for (const entry of priority.prioritized) {
    assert.ok(entry.closurePlan);
    assert.equal(entry.closurePlan.hasAssignedOwner, false);
    assert.match(entry.closurePlan.owner, /not yet assigned/i);
    assert.match(entry.closurePlan.timeline, /no timeline committed/i);
    assert.equal(entry.closurePlan.budget, null);
  }
});

test("TASK #48: an unrelated (research-type) recommendation present alongside 2 material gaps never gets linked and never contributes a fabricated owner to either gap's closure plan", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
  });
  const researchItem = "Commission a desk-research report benchmarking adjacent markets over 3 months (Owner: Head of Strategy).";
  const validation = buildValidation(researchItem, state);
  assert.equal(validation.relatedEvidenceGapId, null);

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [validation], "English");
  for (const entry of priority.prioritized) {
    assert.equal(entry.closurePlan.hasAssignedOwner, false);
    assert.notEqual(entry.closurePlan.owner, "Head of Strategy");
  }
});

// --- 7. Web/PDF parity -------------------------------------------------------

test("TASK #48: page.tsx, Planner.tsx (web + PDF), and ReportPdfButton.tsx all consume the SAME resolveMarketIntelligenceMultiGapPriorityState result -- no renderer independently determines which gap controls", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceMultiGapPriorityState\(/, `${name}: must call the shared multi-gap priority resolver`);
    assert.doesNotMatch(
      source,
      /function resolveGapPriorityTier|function resolveMarketIntelligenceMultiGapPriorityState/,
      `${name}: must not duplicate the priority resolver`
    );
  }
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceMultiGapPriorityState\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function");
});

test("TASK #48 (drift check): resolveMarketIntelligenceMultiGapPriorityState is defined as a pure reshape of resolveMarketIntelligenceEvidenceGaps/resolveMarketIntelligenceGapClosurePlan/resolveMarketIntelligenceControllingClosurePlan -- no second, independently derived priority/gap-detection logic", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceMultiGapPriorityState\([\s\S]*?\n\}/
  )[0];
  assert.match(fnSource, /resolveMarketIntelligenceEvidenceGaps\(/);
  assert.match(fnSource, /resolveMarketIntelligenceControllingClosurePlan\(/);
  assert.match(fnSource, /resolveMarketIntelligenceGapClosurePlan\(/);
});

// --- 8. Real current Market Intelligence report fixture unchanged ----------

test("TASK #48: the real current MI report fixture (MONITOR / Obtainable Share (SAM/SOM) / Head of Sales / 90 days / USD 150,000 / 3 pilots) resolves exactly as before -- single material gap, primary unconditionally, real owner/timeline/budget inherited structurally", () => {
  const state = buildCanonicalState();
  const item =
    "Run a paid pilot program to secure 3 signed pilots within 90 days (Owner: Head of Sales) — Budget cap USD 150,000.";
  const validation = buildValidation(item, state);
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");

  const priority = resolveMarketIntelligenceMultiGapPriorityState(state, [validation], "English");
  assert.equal(state.decision, "CONDITIONAL_GO");
  assert.equal(priority.materialGaps.length, 1);
  assert.equal(priority.primaryGap.id, "obtainable-share");
  assert.equal(priority.primaryGap.label, "Obtainable Share (SAM/SOM)");
  assert.equal(priority.primaryClosurePlan.owner, "Head of Sales");
  assert.ok(priority.primaryClosurePlan.timeline.startsWith("90 days"));
  assert.ok(priority.primaryClosurePlan.budget.startsWith("USD 150,000"));
});

// --- Canonical methodology preserved -----------------------------------------

test("TASK #48: canonical ENTER/MONITOR/AVOID methodology, confidence, and TAM/SAM/SOM fields are never touched by the priority resolver -- it only reshapes already-computed gap/closure-plan data", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
  });
  const before = JSON.parse(JSON.stringify(state));
  resolveMarketIntelligenceMultiGapPriorityState(state, [], "English");
  assert.deepEqual(state, before);
});

test("TASK #48 (drift check): resolveMarketIntelligenceMultiGapPriorityState never calls assessMarketEntryConfidence or mutates decisionCriticalEvidence -- confirmed via source", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceMultiGapPriorityState\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(fnSource, /assessMarketEntryConfidence\(/);
  assert.doesNotMatch(fnSource, /decisionCriticalEvidence\s*[.=]/);
});
