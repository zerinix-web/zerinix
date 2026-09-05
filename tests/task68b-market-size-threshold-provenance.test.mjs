import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyStrategicRecommendationValidation,
  resolveMarketIntelligenceControllingDecisionThreshold,
  resolveMarketIntelligenceGapClosurePlan,
  resolveMarketIntelligenceConfidenceState,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #68B -- Fix Market Size decision-threshold semantic leakage and
// closure-plan authority.
//
// ROOT CAUSE (confirmed live against the exact real report shape the
// ticket describes): a "Quantitative Demand Survey" recommendation
// genuinely IS the action meant to resolve the sole material
// market-sizing gap -- its relatedEvidenceGapId correctly resolves to
// "market-sizing", and its owner/budget correctly belong to that gap's
// Closure Plan. The bug is one layer further down, inside
// buildControllingThresholdForGap (market-intelligence-evidence-gaps.ts):
// that recommendation's own `successCriterion` field is the bare string
// "40%" -- extracted from its "KPI: response rate >= 40%" clause because
// the card's real "Success: ..." sentence carries no "criterion:"/
// "metric:" label extractRecommendationSignals recognizes, so the
// label-based extractor falls back to the FIRST bare percentage on the
// whole card (the survey's own response-rate KPI, not its
// willingness-to-pay finding). buildControllingThresholdForGap then took
// that bare "40%" and rendered it, unchallenged, as the Market Size
// ENTER/AVOID decision threshold and, downstream, as the Closure Plan's
// measurableSuccessCriterion/failureCriterion -- semantic provenance
// leakage from "this action's own execution-quality KPI" into "evidence
// that Market Size has been resolved".
//
// FIX: a narrow, additive semantic gate (isMarketSizeCompatibleThresholdMetric,
// backed by MARKET_SIZE_RESOLUTION_METRIC_PATTERN /
// VALIDATION_PROCESS_ACTIVITY_METRIC_PATTERN) used ONLY when
// buildControllingThresholdForGap considers linking a validation into the
// market-sizing gap's OWN enter/avoid criteria. A candidate's
// successCriterion must affirmatively name real market-sizing-evidence
// vocabulary (TAM/SAM/SOM, buyer population, pricing/ACV signals,
// willingness-to-pay, ...) AND must not itself be a bare
// validation-process/activity metric (response rate, sample size,
// interview/pilot count, completion rate, ...). This never touches
// relatedEvidenceGapId, isRecommendationSemanticallyCompatibleWithGap
// (Task #50's own, deliberately neutral-on-no-match gate), or the
// Closure Plan's owner/timeline/budget/activity resolution
// (resolveClosurePlanAssignment) -- only the enter/avoid criteria
// (and, downstream, measurableSuccessCriterion/failureCriterion, which
// alias controllingThreshold.enterSummary/avoidSummary) are affected.
// When no semantically compatible number exists, the pre-existing
// qualitative fallback (buildControllingGapCriterion, always the first
// enterConditions/avoidConditions entry) is what remains -- never a
// fabricated replacement number.

const MARKET_SIZING_ONLY_STATE = {
  version: 3,
  decision: "MONITOR",
  confidence: 50,
  confidenceDirection: "reduced",
  topRisks: ["Market size is not yet independently verified."],
  topReasons: ["A named competitor has been identified via domain-fallback evidence."],
  why: "Evidence supports monitoring pending market-sizing validation.",
  missingEvidence: ["Buyer-population and pricing evidence for sizing."],
  whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
  immediateNextAction: "Commission bottom-up sizing research.",
  decisionCriticalEvidence: {
    marketSizingResolved: false,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  },
  marketSizing: {
    tam: "Additional market validation is required before sizing can be confirmed.",
    sam: "Additional market validation is required before sizing can be confirmed.",
    som: "Additional market validation is required before sizing can be confirmed.",
    method: "unresolved",
    tier: "directional",
    samMethod: "blocked",
    somStatus: "pending",
    conflicting: false,
    conflictNote: "",
    confidence: 40,
    confidenceLevel: "Low",
    evidenceIds: [],
  },
  cagr: [],
  coverage: {
    overallConfidence: 50,
    verifiedMarketSizeAvailable: false,
    dimensions: {
      marketConfidence: 40,
      competitiveEvidence: 48,
      financialEvidence: 40,
      productEvidence: 45,
      executionReadiness: 45,
      founderReadiness: 45,
    },
  },
  competitors: [],
};

function buildValidation(item, canonicalState = MARKET_SIZING_ONLY_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// The exact real-report shape the ticket describes: a demand survey
// whose "Success:" sentence uses no recognized label, so the extractor's
// bare-percentage fallback captures the survey's own response-rate KPI
// ("40%") rather than its willingness-to-pay finding ("30%").
const SURVEY_ACTION_ITEM =
  "Quantitative Demand Survey (Owner: Market Intelligence) — Budget cap $25,000 (estimated) — KPI: response rate >= 40% — Success: at least 30% of surveyed buyers indicate willingness-to-pay for modular AI compliance at more than $15k/year — Evidence tie: validate TAM.";

const GENUINE_SIZING_ACTION_ITEM =
  "Validate the bottom-up market-sizing inputs (buyer population and pricing) over 8 weeks (Owner: Head of Strategy) — Budget cap $25,000 (estimated) — Success criterion: verified TAM within 20% confidence interval.";

test("fixture sanity: the survey recommendation correctly links to the sole material market-sizing gap", () => {
  const validation = buildValidation(SURVEY_ACTION_ITEM);
  assert.equal(validation.actionType, "validation");
  assert.equal(validation.relatedEvidenceGapId, "market-sizing");
  assert.equal(validation.successCriterion, "40%");
});

test("A: the survey's response-rate 40% remains on the recommendation card but does not appear as the Market Size ENTER/AVOID threshold", () => {
  const validation = buildValidation(SURVEY_ACTION_ITEM);
  // Requirement #6: the KPI must remain available on the recommendation
  // itself (kpi/successCriterion are the same underlying field by design).
  assert.equal(validation.kpi, "40%");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(
    MARKET_SIZING_ONLY_STATE,
    [validation],
    "English"
  );
  assert.ok(threshold);
  assert.doesNotMatch(threshold.enterSummary, /40%/);
  assert.doesNotMatch(threshold.avoidSummary, /40%/);
  // Requirement #8: the qualitative evidence-based threshold survives.
  assert.match(threshold.enterSummary, /independently verified total market size/i);
  assert.match(threshold.avoidSummary, /cannot be resolved to a defensible, viable estimate/i);
});

test("B: a genuine, structurally classified market-sizing metric can still propagate into the ENTER threshold", () => {
  const validation = buildValidation(GENUINE_SIZING_ACTION_ITEM);
  assert.equal(validation.relatedEvidenceGapId, "market-sizing");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(
    MARKET_SIZING_ONLY_STATE,
    [validation],
    "English"
  );
  assert.match(threshold.enterSummary, /verified TAM within 20% confidence interval/);
});

test("C: buyer-population/pricing evidence remains an allowed Market Size resolution criterion", () => {
  const pricingItem =
    "Validate enterprise pricing signals through structured buyer interviews (Owner: Head of Strategy) — Budget cap $12,000 (estimated) — Success criterion: verified annual contract value bands across 10+ regulated buyers.";
  const validation = buildValidation(pricingItem);
  assert.equal(validation.relatedEvidenceGapId, "market-sizing");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(
    MARKET_SIZING_ONLY_STATE,
    [validation],
    "English"
  );
  assert.match(threshold.enterSummary, /verified annual contract value bands/);
});

test("D: activity/process metrics (sample size, interview count, pilot count, response rate, completion rate) cannot independently satisfy Market Size ENTER eligibility", () => {
  const activityItems = [
    ["sample size", "Validate demand via customer interviews (Owner: Research) — Budget cap $10,000 (estimated) — Success criterion: sample size of 50 respondents."],
    ["interview count", "Validate demand via structured interviews (Owner: Research) — Budget cap $10,000 (estimated) — Success criterion: interview count of 25 completed."],
    ["pilot count", "Validate willingness via a pilot program (Owner: Research) — Budget cap $10,000 (estimated) — Success criterion: pilot count of 5 accounts."],
    ["response rate", "Validate demand via a survey (Owner: Research) — Budget cap $10,000 (estimated) — Success criterion: response rate of 40%."],
    ["completion rate", "Validate demand via a survey (Owner: Research) — Budget cap $10,000 (estimated) — Success criterion: completion rate of 60%."],
  ];

  for (const [label, item] of activityItems) {
    const validation = buildValidation(item);
    const threshold = resolveMarketIntelligenceControllingDecisionThreshold(
      MARKET_SIZING_ONLY_STATE,
      [validation],
      "English"
    );
    assert.doesNotMatch(
      threshold.enterSummary,
      /sample size|interview count|pilot count|response rate|completion rate/i,
      `${label} leaked into the Market Size ENTER threshold`
    );
    assert.match(threshold.enterSummary, /independently verified total market size/i, `${label} case lost its qualitative fallback`);
  }
});

test("E: the Closure Plan still inherits the survey's real owner/budget/activity even though its KPI is excluded from the threshold", () => {
  const validation = buildValidation(SURVEY_ACTION_ITEM);
  const plan = resolveMarketIntelligenceGapClosurePlan(
    MARKET_SIZING_ONLY_STATE,
    "market-sizing",
    [validation],
    "English"
  );
  assert.ok(plan);
  assert.equal(plan.owner, "Market Intelligence");
  assert.match(plan.budget ?? "", /\$25,000/);
  assert.doesNotMatch(plan.owner, /not yet assigned/i);
  // Requirement #7/#9: the invalid 40% must not contaminate the success/
  // failure criteria either, since those alias the same enter/avoid summaries.
  assert.doesNotMatch(plan.measurableSuccessCriterion, /40%/);
  assert.doesNotMatch(plan.failureCriterion, /40%/);
});

test("F: a missing authoritative timeline remains missing -- never invented", () => {
  const validation = buildValidation(SURVEY_ACTION_ITEM);
  assert.equal(validation.timeline, "");
  const plan = resolveMarketIntelligenceGapClosurePlan(
    MARKET_SIZING_ONLY_STATE,
    "market-sizing",
    [validation],
    "English"
  );
  assert.match(plan.timeline, /no timeline committed/i);
});

test("G: Task #68A competitor-evidence behavior is unaffected -- competitive-evidence linkage is untouched by this fix", () => {
  const competitorItem =
    "Validate the competitive landscape via structured competitor discovery over 6 weeks (Owner: Head of Market Research) — Budget cap $15,000 (estimated) — Success criterion: at least 2 named competitors independently confirmed via the competitive landscape review.";
  const twoGapState = {
    ...MARKET_SIZING_ONLY_STATE,
    decisionCriticalEvidence: {
      marketSizingResolved: false,
      competitiveEvidenceResolved: false,
      obtainableShareResolved: true,
    },
  };
  const validation = classifyStrategicRecommendationValidation({
    item: competitorItem,
    signals: extractRecommendationSignals(competitorItem),
    canonicalState: twoGapState,
    language: "English",
  });
  assert.equal(validation.relatedEvidenceGapId, "competitive-evidence");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(twoGapState, [validation], "English");
  // Only 1 material gap resolves through the sole-controlling-gap path;
  // with 2 material gaps here it correctly returns null (unchanged,
  // pre-existing multi-gap behavior) -- confirming this fix introduces
  // no new single-gap assumption for competitive-evidence.
  assert.equal(threshold, null);
});

test("H: decision and confidence for the real fixture are unaffected by this fix", () => {
  const validation = buildValidation(SURVEY_ACTION_ITEM);
  // Threshold-building runs after decision/confidence are already
  // resolved from canonicalState directly -- this fix touches neither.
  assert.equal(MARKET_SIZING_ONLY_STATE.decision, "MONITOR");
  const confidenceState = resolveMarketIntelligenceConfidenceState(MARKET_SIZING_ONLY_STATE);
  assert.equal(confidenceState.score, 50);
  // Building the threshold must not mutate or otherwise affect confidence.
  resolveMarketIntelligenceControllingDecisionThreshold(MARKET_SIZING_ONLY_STATE, [validation], "English");
  assert.equal(MARKET_SIZING_ONLY_STATE.decision, "MONITOR");
  assert.equal(resolveMarketIntelligenceConfidenceState(MARKET_SIZING_ONLY_STATE).score, 50);
});

test("drift check: the Task #68B semantic gate is scoped to gap.id === 'market-sizing' only, inside buildControllingThresholdForGap's linkedValidation resolution", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
    "utf8"
  );
  const fixIndex = source.indexOf("TASK #68B");
  assert.notEqual(fixIndex, -1, "Task #68B fix marker not found");
  assert.match(source.slice(fixIndex, fixIndex + 4000), /function isMarketSizeCompatibleThresholdMetric/);

  const usageIndex = source.indexOf("const linkedValidation");
  assert.notEqual(usageIndex, -1, "linkedValidation resolution not found");
  assert.match(
    source.slice(usageIndex, usageIndex + 500),
    /gap\.id !== "market-sizing" \|\| isMarketSizeCompatibleThresholdMetric/
  );
});
