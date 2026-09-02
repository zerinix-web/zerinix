import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionThresholds,
  resolveMarketIntelligenceDecisionThresholdState,
  buildMarketIntelligenceGapDrivenActions,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { classifyStrategicRecommendationAction } from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #37 -- Make Market Intelligence ENTER / MONITOR / AVOID decision
// thresholds structurally authoritative.
//
// This builds ONE canonical aggregate (resolveMarketIntelligenceDecisionThresholdState)
// on top of Task #36's already-tested per-gap threshold functions -- pure
// reshaping, zero new interpretation logic. These tests focus on the
// aggregate's own guarantees: it can never disagree with the canonical
// decision it was built from, ENTER is never fabricated from Strategic
// Recommendations' own planning-assumption signals, and every render
// surface reads the identical object.

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

// --- Unresolved SAM/SOM keeps the current report at MONITOR ---

test("REAL FIXTURE (MONITOR/50%, SAM/SOM unresolved): the canonical threshold state reports decision=CONDITIONAL_GO, with Obtainable Share as the sole unresolved decision-critical condition", () => {
  const state = buildCanonicalState();
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  assert.ok(thresholdState);
  assert.equal(thresholdState.decision, "CONDITIONAL_GO");
  assert.equal(thresholdState.unresolvedConditions.length, 1);
  assert.equal(thresholdState.unresolvedConditions[0].factor, "obtainableShareResolved");
  assert.equal(thresholdState.unresolvedConditions[0].label, "Obtainable Share (SAM/SOM)");
  assert.ok(thresholdState.controllingUnresolvedCondition);
  assert.equal(thresholdState.controllingUnresolvedCondition.factor, "obtainableShareResolved");
});

test("controllingUnresolvedCondition is null when zero or multiple decision-critical pillars are unresolved -- never a guess at which one matters most", () => {
  const resolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  assert.equal(resolveMarketIntelligenceDecisionThresholdState(resolvedState).controllingUnresolvedCondition, null);

  const multiUnresolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: true },
    marketSizing: null,
  });
  const multiThresholdState = resolveMarketIntelligenceDecisionThresholdState(multiUnresolvedState);
  assert.equal(multiThresholdState.unresolvedConditions.length, 2);
  assert.equal(multiThresholdState.controllingUnresolvedCondition, null);
});

// --- ENTER threshold cannot be fabricated from planning assumptions ---

test("ENTER threshold is NOT populated from a Strategic Recommendation's own planning-assumption signals -- the two pipelines are structurally independent", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering.",
  });

  // A Strategic Recommendation card proposing a numeric pilot-conversion
  // target, explicitly classified as a planning assumption (no real
  // citation backs it) -- exactly the kind of number this task forbids
  // turning into an ENTER threshold.
  const recommendationClassification = classifyStrategicRecommendationAction({
    item: "Run a pilot targeting a 20% conversion rate to validate obtainable share.",
    signals: {
      budget: "",
      metric: "20% conversion rate",
      timeframe: "90 days",
      owner: "Head of Sales",
      gate: "",
      activity: "pilot",
      evidenceTie: "internal planning assumption",
    },
    canonicalState: state,
  });
  assert.equal(recommendationClassification.numericBasis, "planning_assumption");

  // The canonical threshold state must remain completely unaffected by
  // that recommendation's own numbers -- it reads ONLY the decision
  // brief's whatWouldChangeThisDecision text, never Strategic
  // Recommendations' extracted signals.
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  const enterCondition = thresholdState.enterConditions.find((c) => c.factor === "obtainableShareResolved");
  assert.equal(enterCondition.isThresholdSupported, false);
  assert.doesNotMatch(enterCondition.description, /20%/);
});

test("ENTER condition IS supported only when this report's own decision brief explicitly links a real number to the ENTER token", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  const enterCondition = thresholdState.enterConditions.find((c) => c.factor === "obtainableShareResolved");
  assert.equal(enterCondition.isThresholdSupported, true);
  assert.match(enterCondition.description, /above 5%/i);
});

// --- Unsupported AVOID threshold remains explicitly unresolved ---

test("AVOID threshold remains explicitly 'requires validation' (named per decision type) when the report never states a downside figure", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  const avoidCondition = thresholdState.avoidConditions.find((c) => c.factor === "obtainableShareResolved");
  assert.equal(avoidCondition.isThresholdSupported, false);
  assert.match(avoidCondition.description, /AVOID threshold requires validation/i);
  // The ENTER-linked figure must never leak into the AVOID condition.
  assert.doesNotMatch(avoidCondition.description, /5%/);
});

test("the model supports a future report naming a real AVOID-linked figure with ZERO renderer changes -- the SAME extraction logic runs for NO_GO as for GO", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A win rate below 2% across three pilots would support AVOID.",
  });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  const avoidCondition = thresholdState.avoidConditions.find((c) => c.factor === "obtainableShareResolved");
  assert.equal(avoidCondition.isThresholdSupported, true);
  assert.match(avoidCondition.description, /below 2%/i);
});

// --- Renderer prose cannot override canonical thresholds ---

// TASK #39 -- requirement #7 introduced an `enterIfText` (and
// `monitorIfText`/`avoidIfText`) local variable on every render surface,
// resolving to EITHER gapAction.threshold.enterCondition.description
// (Task #36/#37's unchanged flat threshold) OR
// marketControllingDecisionThreshold's own enterSummary (Task #39's
// richer, multi-criterion model) -- never a third, independently
// re-derived source. This test now verifies BOTH halves of that same
// guarantee: the "ENTER IF" label is paired with `enterIfText` at its
// USAGE site, and `enterIfText` itself is only ever ASSIGNED from one of
// those two canonical sources, never from a prose-extraction helper.
test("STRUCTURAL AUDIT: the ENTER IF / MONITOR IF / AVOID IF values on every render surface trace ONLY to gapAction.threshold.*Condition.description or marketControllingDecisionThreshold's own summaries -- never a prose-extracted variable", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    // Usage site: "ENTER IF" paired with either the pre-#39 direct
    // reference, or the new enterIfText indirection variable.
    const hasJsxUsage =
      /ENTER IF<\/span>\s*—\s*\{gapAction\.threshold\.enterCondition\.description\}/.test(source) ||
      /ENTER IF<\/span>\s*—\s*\{enterIfText\}/.test(source);
    const hasTemplateUsage =
      /\$\{enterIfLabel\}[\s\S]{0,20}gapAction\.threshold\.enterCondition\.description/.test(source) ||
      /\$\{enterIfLabel\}[\s\S]{0,20}enterIfText/.test(source);
    assert.ok(
      hasJsxUsage || hasTemplateUsage,
      `${name}: expected an ENTER IF usage site paired with gapAction.threshold.enterCondition.description or enterIfText`
    );

    // Assignment site: if enterIfText exists, it must only ever be
    // assigned from the two canonical sources -- never a prose-scan
    // helper (extractMetricValueFromAliases/extractAliasedSectionSnippet).
    const enterIfTextAssignmentMatch = source.match(/const enterIfText = [\s\S]{0,220}?;/);
    if (enterIfTextAssignmentMatch) {
      const assignment = enterIfTextAssignmentMatch[0];
      assert.match(
        assignment,
        /marketControllingDecisionThreshold[!?]?\.enterSummary/,
        `${name}: enterIfText must read marketControllingDecisionThreshold's own enterSummary`
      );
      assert.match(
        assignment,
        /gapAction\.threshold\.enterCondition\.description/,
        `${name}: enterIfText must fall back to gapAction.threshold.enterCondition.description`
      );
      assert.doesNotMatch(
        assignment,
        /extractMetricValueFromAliases|extractAliasedSectionSnippet/,
        `${name}: enterIfText must never fall back to prose extraction`
      );
    }
  }
});

test("STRUCTURAL AUDIT: no render surface computes controllingFactorText/marketDecisionThresholdState from prose extraction helpers (extractMetricValueFromAliases, extractAliasedSectionSnippet)", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const controllingBlocks = source.match(/const (?:marketDecisionThresholdState|controllingFactorText)[\s\S]{0,400}?;/g) || [];
    assert.ok(controllingBlocks.length > 0, `${name}: expected controllingFactorText/marketDecisionThresholdState to be computed`);
    for (const block of controllingBlocks) {
      assert.doesNotMatch(
        block,
        /extractMetricValueFromAliases|extractAliasedSectionSnippet/,
        `${name}: controlling-factor computation must never fall back to prose extraction, found in: ${block}`
      );
    }
  }
});

// --- Web and PDF use the same structured threshold state ---

test("STRUCTURAL AUDIT: all 3 files (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) call resolveMarketIntelligenceDecisionThresholdState", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceDecisionThresholdState\(/, `${name}: must call resolveMarketIntelligenceDecisionThresholdState`);
  }
  // Planner.tsx renders both its own web card AND its own PDF -- both
  // paths must call it independently.
  const plannerCallSites = plannerSource.match(/resolveMarketIntelligenceDecisionThresholdState\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

test("resolveMarketIntelligenceDecisionThresholdState is pure and deterministic -- identical canonical state always produces an identical aggregate, so web and PDF can never structurally disagree", () => {
  const state = buildCanonicalState();
  const a = resolveMarketIntelligenceDecisionThresholdState(state, "English");
  const b = resolveMarketIntelligenceDecisionThresholdState(state, "English");
  assert.deepEqual(a, b);
});

// --- Canonical MONITOR/50% remains unchanged for the current fixture ---

test("resolving the aggregate threshold state never mutates the canonical decision, confidence, or decisionCriticalEvidence", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const before = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  resolveMarketIntelligenceDecisionThresholdState(state);
  buildMarketIntelligenceGapDrivenActions(state);
  resolveMarketIntelligenceDecisionThresholds(state);
  resolveMarketIntelligenceEvidenceGaps(state);
  const after = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  assert.equal(before, after);
  // The aggregate's own copy of the decision must also match exactly --
  // it can never disagree with the canonical state it was derived from.
  assert.equal(resolveMarketIntelligenceDecisionThresholdState(state).decision, state.decision);
});

// --- Structured model shape (requirement #2) ---

test("evidenceRequirements is broader than unresolvedConditions -- it includes non-gating gaps (growth-rate) that unresolvedConditions correctly excludes", () => {
  const state = buildCanonicalState({ cagr: [] });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  assert.equal(thresholdState.unresolvedConditions.length, 1);
  assert.equal(thresholdState.evidenceRequirements.length, 2);
  assert.ok(thresholdState.evidenceRequirements.some((c) => c.factor === null && c.label.match(/Growth Rate|CAGR/i)));
  assert.ok(!thresholdState.unresolvedConditions.some((c) => c.factor === null));
});

test("every condition array carries condition/factor, required evidence, current status, isDecisionCritical, and isThresholdSupported", () => {
  const state = buildCanonicalState();
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  for (const list of [thresholdState.enterConditions, thresholdState.monitorConditions, thresholdState.avoidConditions, thresholdState.unresolvedConditions, thresholdState.evidenceRequirements]) {
    assert.ok(list.length > 0);
    for (const condition of list) {
      assert.ok("factor" in condition);
      assert.ok(typeof condition.requiredEvidence === "string" && condition.requiredEvidence.length > 0);
      assert.ok(typeof condition.currentStatus === "string" && condition.currentStatus.length > 0);
      assert.equal(typeof condition.isDecisionCritical, "boolean");
      assert.equal(typeof condition.isThresholdSupported, "boolean");
    }
  }
});

test("null canonicalState produces a null aggregate -- never a fabricated threshold state", () => {
  assert.equal(resolveMarketIntelligenceDecisionThresholdState(null), null);
});

test("a fully-resolved canonical state produces empty enter/monitor/avoid/unresolved condition arrays -- never a fabricated blocking condition", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  assert.deepEqual(thresholdState.enterConditions, []);
  assert.deepEqual(thresholdState.monitorConditions, []);
  assert.deepEqual(thresholdState.avoidConditions, []);
  assert.deepEqual(thresholdState.unresolvedConditions, []);
  assert.equal(thresholdState.controllingUnresolvedCondition, null);
});
