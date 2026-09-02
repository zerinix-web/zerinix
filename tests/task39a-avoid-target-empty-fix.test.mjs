import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyStrategicRecommendationValidation,
  resolveMarketIntelligenceControllingDecisionThreshold,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";

// TASK #39A -- Fix the empty AVOID threshold target in Market
// Intelligence.
//
// ROOT CAUSE (confirmed via trace): classifyStrategicRecommendationAction's
// numericBasis (and therefore classifyStrategicRecommendationValidation's
// own provenance) is derived from budget/metric/timeframe TOGETHER
// (deriveStrategicRecommendationNumericBasis joins all three before
// testing for a numeric figure) -- a card whose BUDGET or TIMELINE is
// numeric, but whose own KPI/success-metric field is empty, still gets a
// real (non-null) provenance classification even though
// validation.successCriterion (== signals.metric) is "". Task #39's
// resolveMarketIntelligenceControllingDecisionThreshold only checked
// `validation.provenance` truthiness before reusing
// validation.successCriterion inside a sentence template
// ("Validation fails to meet the recommended target: ${target}.") --
// producing the reported "...recommended target: ." with a dangling
// colon and nothing after it.
//
// FIX: the linkedValidation selection itself now also requires a
// genuinely non-empty successCriterion, AND (defense-in-depth)
// buildRecommendationEnterCriterion/buildRecommendationAvoidCriterion
// each independently return null rather than construct a criterion
// around an empty target -- so no future call site, however it selects
// a validation, can reintroduce this defect.

const readSourceFile = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

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
    coverage: {
      overallConfidence: 60,
      dimensions: {
        marketConfidence: 60,
        competitiveEvidence: 60,
        financialEvidence: 60,
        productEvidence: 60,
        executionReadiness: 60,
        founderReadiness: 60,
      },
    },
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

// Reproduces the exact reported defect: a pilot/validation card whose
// BUDGET is numeric but whose own KPI/success-metric field is empty.
const emptyMetricPilotItem = "Run an 8-week pilot to validate obtainable share.";
const emptyMetricPilotSignals = {
  budget: "$75,000",
  metric: "", // <-- empty: this is the exact reported reproduction case
  timeframe: "8 weeks",
  owner: "Head of Sales",
  gate: "",
  activity: "pilot",
  evidenceTie: "",
};

const populatedMetricPilotItem = "Run an 8-week pilot targeting a 20% conversion rate to validate obtainable share.";
const populatedMetricPilotSignals = {
  ...emptyMetricPilotSignals,
  metric: "20% pilot conversion rate",
};

// --- Reproduction: confirm the underlying data shape that caused the bug ---

test("REPRODUCTION: a pilot card with a numeric budget but an empty success metric still receives a real (non-null) provenance -- proving why a naive `provenance truthy` check alone is insufficient", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  assert.ok(validation.provenance, "provenance must be non-null for this reproduction to be valid");
  assert.equal(validation.successCriterion, "", "successCriterion must be genuinely empty for this reproduction to be valid");
});

// --- Missing AVOID target: omit the clause entirely ---

test("a linked recommendation with an empty success metric contributes NO recommendationValidationTarget criterion to AVOID -- the clause is omitted, never rendered with a blank target", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.ok(!threshold.avoidConditions.some((c) => c.dimension === "recommendationValidationTarget"));
  // Only the always-present, purely qualitative structural criterion
  // remains.
  assert.equal(threshold.avoidConditions.length, 1);
});

test("a linked recommendation with an empty success metric contributes NO recommendationValidationTarget criterion to ENTER either -- the same fix applies symmetrically", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.ok(!threshold.enterConditions.some((c) => c.dimension === "recommendationValidationTarget"));
  assert.equal(threshold.enterConditions.length, 1);
});

// --- No dangling colon / no "target: ." anywhere in the rendered summaries ---

test("avoidSummary/enterSummary/monitorSummary never contain a dangling colon or an empty target, even for the exact reported reproduction case", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  for (const summary of [threshold.enterSummary, threshold.monitorSummary, threshold.avoidSummary]) {
    assert.doesNotMatch(summary, /:\s*\.\s*$/, `summary must never end with a dangling "colon + period": "${summary}"`);
    assert.doesNotMatch(summary, /:\s*$/, `summary must never end with a bare colon: "${summary}"`);
    assert.doesNotMatch(summary, /recommended target:\s*\./i, `summary must never contain the reported "recommended target: ." defect: "${summary}"`);
  }
});

test("REGRESSION: the exact reported sentence never appears verbatim for the reproduction case", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.equal(
    threshold.avoidSummary,
    "Validation demonstrates Obtainable Share (SAM/SOM) cannot be resolved to a defensible, viable estimate."
  );
});

// --- Populated AVOID target: still renders correctly when real data exists ---

test("a linked recommendation WITH a real, non-empty success metric still contributes a proper recommendationValidationTarget criterion to AVOID -- the fix never over-corrects into omitting valid data", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: populatedMetricPilotItem,
    signals: populatedMetricPilotSignals,
    canonicalState: state,
  });
  assert.equal(validation.successCriterion, "20% pilot conversion rate");
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const criterion = threshold.avoidConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(criterion);
  assert.match(criterion.description, /fails to meet the recommended target: 20% pilot conversion rate\./);
  assert.equal(threshold.avoidConditions.length, 2);
  assert.match(threshold.avoidSummary, /20% pilot conversion rate/);
});

test("a linked recommendation WITH a real, non-empty success metric still contributes a proper recommendationValidationTarget criterion to ENTER", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: populatedMetricPilotItem,
    signals: populatedMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const criterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(criterion);
  assert.match(criterion.description, /^20% pilot conversion rate \(/);
});

// --- Whitespace-only target is treated the same as empty ---

test("a whitespace-only success metric is treated the same as empty -- never rendered as a target", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: { ...emptyMetricPilotSignals, metric: "   " },
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.ok(!threshold.avoidConditions.some((c) => c.dimension === "recommendationValidationTarget"));
  assert.ok(!threshold.enterConditions.some((c) => c.dimension === "recommendationValidationTarget"));
});

// --- Does not change canonical decision / confidence / controlling factor ---

test("the fix never changes the canonical decision, confidence, or controlling factor for the real fixture", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.equal(state.decision, "CONDITIONAL_GO");
  assert.equal(state.confidence, 50);
  assert.equal(threshold.controllingFactor, "Obtainable Share (SAM/SOM)");
  // ENTER/MONITOR conditions themselves are untouched by this fix.
  assert.equal(threshold.enterConditions.length, 1);
  assert.match(threshold.monitorSummary, /Obtainable Share \(SAM\/SOM\)/);
});

// --- Web/PDF parity: the fix lives in the one shared function every surface reads ---

test("STRUCTURAL AUDIT: no render surface (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) constructs its own 'recommended target' sentence -- the fix in the shared resolver automatically covers all 4 surfaces and persisted/reloaded reports", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /recommended target/i, `${name}: must not independently construct a "recommended target" sentence`);
    assert.doesNotMatch(source, /successCriterion/, `${name}: must not read successCriterion directly to build threshold text`);
  }
});

test("web and PDF resolve an identical, dangling-colon-free result for the same inputs -- pure and deterministic", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: emptyMetricPilotItem,
    signals: emptyMetricPilotSignals,
    canonicalState: state,
  });
  const webResult = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation], "English");
  const pdfResult = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation], "English");
  assert.deepEqual(webResult, pdfResult);
  assert.doesNotMatch(pdfResult.avoidSummary, /:\s*\.\s*$/);
});
