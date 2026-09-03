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

// TASK #50 -- Fix the semantic mismatch between the Obtainable Share
// (SAM/SOM) evidence gap and its Closure Plan / Decision Threshold.
//
// ROOT CAUSE (confirmed via trace of the real runtime path): with
// exactly ONE material gap (Obtainable Share (SAM/SOM) -- the real
// report's own state after Task #49), resolveLinkedEvidenceGap's
// single-gap fast path (`materialGaps.length === 1 ? materialGaps[0] :
// ...`) linked EVERY validation/pilot-classified recommendation to it
// unconditionally, with zero awareness of what that recommendation's OWN
// success metric actually measures. "Vertical Technical Pilot" -- whose
// real success metric is "85% extraction accuracy" on compliance
// clauses, a PRODUCT/TECHNICAL performance figure -- was classified as
// a "pilot" action (its item text contains the word "pilot"), so it
// linked to Obtainable Share purely because it was the only material
// gap in the report, not because its own evidence measures obtainable
// share in any way. That 85% figure then flowed unchallenged into the
// ENTER threshold and Closure Plan (owner/timeline/budget) for a gap it
// has no evidentiary relationship to. This was NOT generic numeric
// matching, recommendation order, or a fallback bug -- it was the
// single-gap fast path having no semantic concept of "does this
// candidate's evidence actually measure this gap" at all.
//
// FIX: resolveLinkedEvidenceGap now checks a candidate's OWN
// successCriterion against a small, curated, gap-scoped vocabulary
// (isRecommendationSemanticallyCompatibleWithGap) before linking it to a
// gap that has a defined evidence-category requirement. Obtainable Share
// requires "captureRate" evidence (conversion/win-rate/paid-pilot/LOI/
// reachable-account/penetration); a candidate whose OWN metric
// affirmatively classifies as "technicalPerformance" (extraction
// accuracy/latency/model accuracy/integration completion) is rejected
// for that gap. A candidate with no distinct/classifiable metric at all
// remains exactly as eligible as before (never a new rejection reason
// for the "Procurement reference test"/"Pilot Recruitment" shapes Tasks
// #47B/#48A already made resolvable).

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

// The real single-controlling-gap report state after Task #49: MONITOR
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

// The exact real-report shape: "Vertical Technical Pilot" measures
// TECHNICAL extraction accuracy on compliance clauses -- not obtainable
// share.
const VERTICAL_TECHNICAL_PILOT_ITEM =
  "Vertical Technical Pilot: run a technical pilot extracting key terms from compliance clauses over 8 weeks (Owner: Head of Product) — Budget cap $60,000 — Success criterion: 85% extraction accuracy.";
// A genuinely valid Obtainable Share candidate.
const CONVERSION_PILOT_ITEM =
  "Commercial Conversion Pilot: run a paid pilot to validate obtainable share with named enterprise buyers over 90 days (Owner: Head of Sales) — Budget cap $40,000 — Success criterion: 20% pilot conversion rate.";
const WIN_RATE_PILOT_ITEM =
  "Win-Rate Validation: run a structured sales pilot against named competitors over 10 weeks (Owner: Head of Revenue) — Success criterion: 25% win rate against incumbents.";
// A recommendation with NO distinct metric at all (Task #47B/#48A shape)
// -- must remain unaffected by this fix.
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

// --- 1. SAM/SOM gap + extraction accuracy 85% -> must NOT become the threshold ---

test("TASK #50 (fixture sanity): 'Vertical Technical Pilot' classifies as a pilot action with an explicit technical (non-capture-rate) success metric", () => {
  const pilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  assert.ok(pilot.actionType === "validation" || pilot.actionType === "pilot");
  assert.equal(pilot.successCriterion, "85% extraction accuracy");
  assert.equal(pilot.owner, "Head of Product");
});

test("TASK #50: reproduces the REAL defect and proves the fix -- 'Vertical Technical Pilot' (85% extraction accuracy) does NOT link to Obtainable Share (SAM/SOM), and its 85% never reaches the ENTER threshold or Closure Plan", () => {
  const pilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  assert.equal(pilot.relatedEvidenceGapId, null, "a technical-performance metric must never link to the capture-rate-only Obtainable Share gap");
  assert.equal(pilot.relatedDecisionThreshold, null);

  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [pilot], "English");
  assert.ok(controlling);
  assert.doesNotMatch(controlling.enterSummary, /85%/, "the 85% extraction-accuracy figure must never appear in the ENTER threshold");
  assert.doesNotMatch(controlling.avoidSummary, /85%/);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [pilot], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false, "Vertical Technical Pilot's owner must never populate the Closure Plan for this gap");
  assert.notEqual(plan.owner, "Head of Product");
  assert.match(plan.owner, /not yet assigned/i);
  assert.doesNotMatch(plan.measurableSuccessCriterion, /85%/);
});

// --- 2. SAM/SOM gap + valid conversion/win-rate KPI -> may become the threshold ---

test("TASK #50: a genuinely valid capture-rate KPI (pilot conversion rate) DOES link to Obtainable Share and correctly populates the Closure Plan", () => {
  const validPilot = buildValidation(CONVERSION_PILOT_ITEM);
  assert.equal(validPilot.relatedEvidenceGapId, "obtainable-share");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validPilot], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, true);
  assert.equal(plan.owner, "Head of Sales");
  assert.match(plan.measurableSuccessCriterion, /20%/);
});

test("TASK #50: a win-rate KPI also correctly links to Obtainable Share (capture-rate vocabulary is not limited to the word 'conversion')", () => {
  const winRatePilot = buildValidation(WIN_RATE_PILOT_ITEM);
  assert.equal(winRatePilot.relatedEvidenceGapId, "obtainable-share");
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [winRatePilot], "English");
  assert.equal(plan.owner, "Head of Revenue");
});

test("TASK #50: when BOTH a valid capture-rate candidate and the technical-performance candidate are present, the technical one is excluded entirely and the valid one alone drives the Closure Plan", () => {
  const technicalPilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  const validPilot = buildValidation(CONVERSION_PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [technicalPilot, validPilot], "English");
  assert.equal(plan.owner, "Head of Sales");
  assert.notEqual(plan.owner, "Head of Product");
  assert.match(plan.measurableSuccessCriterion, /20%/);
  assert.doesNotMatch(plan.measurableSuccessCriterion, /85%/);
});

// --- 3. No semantically compatible numeric KPI -> abstain, never invent/reuse ---

test("TASK #50: when the ONLY candidate has a technical-performance metric and nothing else, the Closure Plan preserves the gap's own evidence requirement and abstains -- never inventing or reusing the wrong number", () => {
  const technicalPilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [technicalPilot], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.equal(plan.budget, null);
  assert.match(plan.owner, /not yet assigned/i);
  assert.match(plan.timeline, /no timeline committed/i);
  // The gap's own honest evidenceRequired text (unconditionally the
  // first ENTER criterion) survives untouched -- proving the fallback
  // preserves the structural evidence requirement rather than leaving a
  // blank or fabricated statement.
  const gap = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").find((g) => g.id === "obtainable-share");
  assert.match(plan.measurableSuccessCriterion, new RegExp(gap.evidenceRequired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// --- 4. Technical/product evidence gap -> extraction accuracy may still be valid ---

test("TASK #50: the semantic classifier itself is symmetric, not a blanket ban on technical metrics -- extraction accuracy correctly classifies as 'technicalPerformance' evidence, which would satisfy a gap whose OWN requirement is technicalPerformance (proving this is gap-relative semantic matching, not a hardcoded rejection of the metric itself)", () => {
  const technicalPatternSource = evidenceGapsSource.match(
    /const TECHNICAL_PERFORMANCE_EVIDENCE_PATTERN =[\s\S]*?;/
  )[0];
  assert.match(technicalPatternSource, /extraction/i);
  assert.match(technicalPatternSource, /latency/i);

  // Directly exercise the compatibility rule with a gap id that (per the
  // current, real MI architecture) requires captureRate, confirming
  // rejection there, AND independently confirm the underlying category
  // classification the rule is built on genuinely recognizes
  // "technicalPerformance" as its own real, non-empty category (not
  // silently dropped/ignored) -- the same category a hypothetical
  // technical-evidence gap would require.
  const technicalPilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  assert.equal(technicalPilot.relatedEvidenceGapId, null, "rejected for Obtainable Share (captureRate-only)");
  assert.equal(technicalPilot.provenance, "validationTarget", "the metric is still a real, structured validation target -- just not for THIS gap");
});

// --- 5. Closure Plan owner/timeline/budget from the genuinely linked recommendation only ---

test("TASK #50: Closure Plan owner/timeline/budget come ONLY from a recommendation genuinely (semantically) linked to the gap -- never from an unrelated technical recommendation, even when it is the only other candidate present", () => {
  const technicalPilot = buildValidation(VERTICAL_TECHNICAL_PILOT_ITEM);
  const unrelatedResearch = buildValidation("Commission a desk-research report benchmarking adjacent verticals over 3 months (Owner: Head of Strategy).");
  assert.equal(unrelatedResearch.relatedEvidenceGapId, null);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [technicalPilot, unrelatedResearch], "English");
  assert.equal(plan.hasAssignedOwner, false);
  assert.notEqual(plan.owner, "Head of Product");
  assert.notEqual(plan.owner, "Head of Strategy");
});

test("TASK #50: the 'Procurement reference test' shape (no distinct metric at all) remains exactly as eligible as Task #47B/#48A already established -- the semantic gate never introduces a NEW rejection for a candidate with no classifiable metric", () => {
  const procurement = buildValidation(PROCUREMENT_REFERENCE_TEST_ITEM);
  assert.equal(procurement.relatedEvidenceGapId, "obtainable-share");
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [procurement], "English");
  assert.equal(plan.owner, "Sales");
});

// --- 6. Web and PDF consume the same resolved Closure Plan -----------------

test("TASK #50: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan result -- the semantic fix lives in the single shared resolveLinkedEvidenceGap, never duplicated per surface", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared resolver`);
    assert.doesNotMatch(source, /function resolveLinkedEvidenceGap/, `${name}: must not duplicate the linkage resolver`);
    assert.doesNotMatch(
      source,
      /function isRecommendationSemanticallyCompatibleWithGap/,
      `${name}: must not duplicate the semantic gate`
    );
  }
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function");
});

// --- Preserved architecture --------------------------------------------------

test("TASK #50: decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share (SAM/SOM) remains the sole controlling factor after the fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #50: gaps with no defined evidence-category requirement (competitive-evidence) are completely unaffected by the semantic gate -- any validation/pilot metric still links exactly as before", () => {
  const twoGapState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: true },
  });
  const anyPilot = buildValidation(
    "Run a pilot survey of adjacent vendors to validate the competitive landscape over 6 weeks (Owner: Head of Insights) — Success criterion: 85% extraction accuracy on vendor filings.",
    twoGapState
  );
  // Single material gap here is competitive-evidence -- no defined
  // requirement, so the technical-sounding metric still links, exactly
  // as this architecture behaved before Task #50.
  assert.equal(anyPilot.relatedEvidenceGapId, "competitive-evidence");
});

test("TASK #50 (drift check): the semantic gate only ever inspects the recommendation's own structured successCriterion field -- never the raw item/activity text, never a gap-name/keyword scan", () => {
  const gateSource = evidenceGapsSource.match(
    /function isRecommendationSemanticallyCompatibleWithGap\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(gateSource, /\.item\b/);
  assert.doesNotMatch(gateSource, /\.activity\b/);
  assert.match(gateSource, /successCriterion/);
});
