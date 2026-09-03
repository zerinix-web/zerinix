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

// TASK #47C -- Trace and fix the REAL runtime Closure Plan linkage
// failure.
//
// PHASE 1 FINDING (root cause): Tasks #47A/#47B both assumed the real
// failure mode was "0 or a small number of linked candidates, one
// obviously weaker than the other." Tracing the ACTUAL generation
// contract (app/lib/report-engine/prompts/market.ts, the
// executiveDecisionBrief/CEO-summary prompt) shows the real shape is
// different: whenever the decision is anything short of a full ENTER,
// the prompt REQUIRES "First 90 Days" to contain "exactly three concrete
// actions with owners and clear proof points," each "bounded and
// reversible (validation, research, or a small gated pilot)," each
// naming "the budget or spend ceiling, the KPI that will be tracked, and
// the numeric or evidence-based success criterion." That means a real
// MONITOR report routinely produces THREE simultaneously-complete
// validation/pilot candidates (owner + timeline + a measurable target)
// -- not because they are bogus duplicates, but because the prompt
// itself mandates exactly that shape. resolveLinkedEvidenceGap (Task
// #38) links EVERY one of them to the sole controlling gap whenever
// exactly one material gap exists, regardless of which of the 3
// decision-critical pillars each action is actually advancing. Task
// #47B's scoring (owner + timeline + a measurable target) cannot tell
// these three apart -- they all score identically -- so it always
// abstained to the honest fallback, even when one of the three is
// unambiguously the report's OWN targeted action for Obtainable Share
// specifically (its own success criterion literally restates the SAME
// percentage the report's own decision brief already names for ENTER).
//
// WHY TASK #47A/#47B'S OWN TESTS FALSELY PASSED: every fixture in both
// files used at most TWO linked candidates, and never gave the report's
// own canonical whatWouldChangeThisDecision text a percentage that
// EXACTLY ONE of several tied candidates' own successCriterion also
// names -- so neither file ever exercised the specific 3-way-tie-with-
// one-numerically-grounded-winner shape a real "First 90 Days" section
// produces. Task #47A's own "two complete candidates -> honest fallback"
// test (since amended) coincidentally used a fixture where one candidate
// DID cite the gap's own stated percentage and the other did not --
// which, after this fix, correctly stops being an unresolvable tie.
//
// FIX: selectAuthoritativeClosurePlanValidation gains a genuinely
// structural (non-prose) tiebreaker, applied ONLY when 2+ candidates
// already tie at the highest completeness score: compare each tied
// candidate's OWN successCriterion against gap.successThreshold (Task
// #35's own extractNamedSuccessThreshold output -- a real percentage
// lifted verbatim from this report's own decision brief) using NUMERIC
// EQUALITY of the extracted percentage figures, never a word/keyword/gap-
// name comparison. When exactly one tied candidate's figure matches, it
// is unambiguously the action targeting THIS gap's own stated bar and
// becomes the winner; when the gap names no figure, or 0/2+ tied
// candidates share the matching figure, the tie remains genuinely
// unresolvable and the honest fallback is unchanged.

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

// The REAL runtime shape this ticket reports: a MONITOR (CONDITIONAL_GO)
// report whose OWN decision brief names a concrete ENTER-linked
// percentage ("at least 10%... within 90 days"), matching the ticket's
// own quoted "Validation target: >=10% conversion from RFP to paid pilot
// within 90 days."
function buildRealShapedCanonicalState(overrides = {}) {
  return {
    version: 3,
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    topRisks: ["Obtainable share has not been independently validated."],
    topReasons: ["Market sizing and competitive evidence are both resolved."],
    why: "Evidence supports conditional entry pending obtainable-share validation.",
    missingEvidence: ["Independent RFP-to-paid-pilot conversion data."],
    whatWouldChangeThisDecision:
      "A validated RFP-to-paid-pilot conversion rate of at least 10% within 90 days would support ENTER; further diligence on obtainable share would be required before reconsidering this position.",
    immediateNextAction: "Run the First 90 Days validation program before committing further budget.",
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

const REAL_STATE = buildRealShapedCanonicalState();

// The prompt-mandated "exactly three concrete First 90 Days actions,
// each bounded/reversible (validation, research, or a small gated
// pilot), each with an owner, a timeline, and a numeric success
// criterion" -- reproducing the REAL runtime shape, not a synthetic
// two-candidate fixture. Only ONE of the three (the pricing/RFP action)
// names the SAME percentage the report's own decision brief states.
const PRICING_RFP_ACTION =
  "Pricing & RFP Conversion Program: run a small gated pilot renegotiating RFP-to-paid-pilot pricing incentives in the U.S. Mid-Market segment over 90 days (Owner: Head of Pricing/Sales Ops) — Success criterion: at least 10% RFP-to-paid-pilot conversion within 90 days.";
const MARKET_SIZING_VALIDATION_ACTION =
  "Market Sizing Validation: run a small gated pilot survey to verify total addressable market figures over 60 days (Owner: Head of Market Research) — Success criterion: 3 independently verified market-size sources.";
const COMPETITIVE_BENCHMARK_ACTION =
  "Competitive Benchmarking Survey: run customer discovery interviews to verify adjacent vendor positioning over 45 days (Owner: Head of Insights) — Success criterion: 5 named competitors verified.";

function buildValidation(item, canonicalState = REAL_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity: reproduces the REAL 3-way-tie runtime shape ----------

test("TASK #47C (fixture sanity): all three First-90-Days actions structurally link to Obtainable Share and are equally complete (owner + timeline + measurable success criterion) -- the real tie condition", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);

  for (const validation of [pricing, sizing, competitive]) {
    assert.equal(validation.relatedEvidenceGapId, "obtainable-share");
    assert.ok(validation.owner, "each action must carry an owner for this to be a real tie");
    assert.ok(validation.timeline, "each action must carry a timeline for this to be a real tie");
    assert.ok(validation.successCriterion, "each action must carry a measurable success criterion for this to be a real tie");
  }
});

test("TASK #47C (fixture sanity): only the pricing/RFP action's own success criterion names the SAME percentage the report's own decision brief states for ENTER", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);
  const gap = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").find((g) => g.id === "obtainable-share");

  assert.equal(gap.successThreshold, "at least 10%");
  assert.match(pricing.successCriterion, /10%/);
  assert.doesNotMatch(sizing.successCriterion, /%/);
  assert.doesNotMatch(competitive.successCriterion, /%/);
});

// --- The actual regression: reproduces and proves the REAL failure --------

test("TASK #47C: reproduces the REAL 3-way tie and proves the fix -- with all three First-90-Days actions linked to Obtainable Share, the Closure Plan now resolves the pricing/RFP action's real owner and timeline instead of falling back to 'not yet assigned'", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);

  // Candidate order matches how extractRecommendationItems would list
  // them (array order), with the pricing/RFP action deliberately NOT
  // first, so this cannot be mistaken for an "arbitrary first
  // recommendation" selection.
  const plan = resolveMarketIntelligenceControllingClosurePlan(
    REAL_STATE,
    [sizing, competitive, pricing],
    "English"
  );

  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  assert.equal(plan.gapLabel, "Obtainable Share (SAM/SOM)");
  assert.equal(plan.hasAssignedOwner, true, "owner must resolve despite 3 equally-complete linked candidates");
  assert.equal(plan.owner, "Head of Pricing/Sales Ops");
  assert.notEqual(plan.owner, sizing.owner);
  assert.notEqual(plan.owner, competitive.owner);
  assert.ok(!/not yet assigned/i.test(plan.owner));
  assert.ok(!/no timeline committed/i.test(plan.timeline));
  assert.ok(plan.timeline.startsWith("90 days"));
});

test("TASK #47C: candidate order does not change the outcome -- the SAME action wins regardless of array position", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);

  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [pricing, sizing, competitive], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [competitive, sizing, pricing], "English");
  const planC = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [sizing, pricing, competitive], "English");

  for (const plan of [planA, planB, planC]) {
    assert.equal(plan.owner, "Head of Pricing/Sales Ops");
    assert.ok(plan.timeline.startsWith("90 days"));
  }
});

// --- No hardcoding / no arbitrary selection ---------------------------------

test("TASK #47C: when NO candidate's success criterion names the report's own stated percentage, the tie remains genuinely unresolvable -- never falls back to picking the first/any candidate", () => {
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);
  // Neither of these two names any percentage at all -- a genuine tie
  // with no numeric signal to break it.
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [sizing, competitive], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.match(plan.owner, /not yet assigned/i);
});

test("TASK #47C: when the report's own decision brief names NO percentage at all, the tiebreaker never fires and the tie falls back honestly, even with a clear owner+timeline candidate present", () => {
  const noThresholdState = buildRealShapedCanonicalState({
    whatWouldChangeThisDecision: "Further diligence on obtainable share would be required before reconsidering this position.",
  });
  const gap = resolveMarketIntelligenceEvidenceGaps(noThresholdState, "English").find((g) => g.id === "obtainable-share");
  assert.equal(gap.successThreshold, null, "fixture must genuinely name no threshold for this test to be meaningful");

  const pricing = buildValidation(PRICING_RFP_ACTION, noThresholdState);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION, noThresholdState);
  const plan = resolveMarketIntelligenceControllingClosurePlan(noThresholdState, [pricing, sizing], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
});

test("TASK #47C: the resolved owner/timeline are byte-identical to the winning action's own already-extracted signals -- never fabricated, never hardcoded", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [sizing, competitive, pricing], "English");
  const realSignals = extractRecommendationSignals(PRICING_RFP_ACTION);
  assert.equal(plan.owner, realSignals.owner);
  assert.ok(plan.timeline.startsWith(realSignals.timeframe));
});

// --- Preserved: canonical decision, controlling factor, validation target --

test("TASK #47C: decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share remains the sole controlling factor after the fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #47C: the validation target ('at least 10%... within 90 days') remains verbatim and unchanged in the closure plan's measurable success criterion after the tiebreaker fix", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [sizing, competitive, pricing], "English");
  assert.match(plan.measurableSuccessCriterion, /10%/);

  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(
    REAL_STATE,
    [sizing, competitive, pricing],
    "English"
  );
  assert.equal(plan.measurableSuccessCriterion, controlling.enterSummary);
  assert.equal(plan.monitorStatus, controlling.monitorSummary);
  assert.equal(plan.failureCriterion, controlling.avoidSummary);
});

test("TASK #47C: no unrelated recommendation (Market Sizing Validation, Competitive Benchmarking Survey) is ever selected as the authoritative closure-plan source", () => {
  const pricing = buildValidation(PRICING_RFP_ACTION);
  const sizing = buildValidation(MARKET_SIZING_VALIDATION_ACTION);
  const competitive = buildValidation(COMPETITIVE_BENCHMARK_ACTION);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [sizing, competitive, pricing], "English");
  assert.notEqual(plan.owner, "Head of Market Research");
  assert.notEqual(plan.owner, "Head of Insights");
});

// --- Web/PDF parity ----------------------------------------------------------

test("TASK #47C: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan result -- no duplicate recommendation-normalization, gap-resolution, or closure-plan pipeline exists per surface", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared resolver`);
    // No render surface may define its own second implementation of the
    // selection/tiebreaker logic this file introduces.
    assert.doesNotMatch(source, /function selectAuthoritativeClosurePlanValidation/, `${name}: must not duplicate the selector`);
    assert.doesNotMatch(source, /function scoreClosurePlanCandidate/, `${name}: must not duplicate the scorer`);
  }
  const plannerOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingClosurePlan\(/g) || []).length;
  assert.equal(plannerOccurrences, 2, "Planner.tsx must call the resolver from both its web JSX and its own PDF-drawing function, both delegating to the SAME shared resolver");
});

test("TASK #47C/#48A (drift check): the numeric tiebreaker lives inside the single shared resolver module, is a pure numeric-equality check, and never inspects a validation's raw item text", () => {
  const fnSource = evidenceGapsSource.match(/function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /extractComparableThresholdFigure\(/);
  assert.match(fnSource, /gapSuccessThreshold/);
  assert.doesNotMatch(fnSource, /\.item\b/);
});
