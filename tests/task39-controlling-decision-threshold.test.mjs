import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionThresholds,
  resolveMarketIntelligenceControllingDecisionThreshold,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";

// TASK #39 -- Make Market Intelligence ENTER / MONITOR / AVOID decision
// thresholds structurally measurable and authoritative.
//
// resolveMarketIntelligenceControllingDecisionThreshold builds a richer,
// multi-criterion model for the single controlling evidence gap by
// reshaping/extending Task #36-#38's already-tested outputs -- zero new
// numeric fabrication. These tests focus on: every criterion traces to
// real structured data (never generated prose), ENTER never activates
// without real evidence, AVOID gets a defensible qualitative rule even
// with zero numeric data, and the canonical decision/confidence/
// controlling factor never move.

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

const pilotItem = "Run an 8-week pilot targeting a 20% conversion rate to validate obtainable share.";
const pilotSignals = {
  budget: "$75,000",
  metric: "20% pilot conversion rate",
  timeframe: "8 weeks",
  owner: "Head of Sales",
  gate: "",
  activity: "pilot",
  evidenceTie: "",
};

// --- ENTER/MONITOR/AVOID thresholds come from structured state ---

test("REAL FIXTURE (MONITOR/50%, SAM/SOM unresolved): the controlling threshold's conditions all trace to real structured fields, never generated prose", () => {
  const state = buildCanonicalState();
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state);
  assert.ok(threshold);
  assert.equal(threshold.controllingFactor, "Obtainable Share (SAM/SOM)");
  assert.equal(threshold.affectedFactor, "obtainableShareResolved");
  assert.equal(threshold.gapId, "obtainable-share");
  assert.equal(threshold.currentThresholdState, state.marketSizing.som);
  assert.ok(threshold.requiredEvidence.length > 0);
  assert.ok(threshold.enterConditions.length >= 1);
  assert.ok(threshold.monitorConditions.length >= 1);
  assert.ok(threshold.avoidConditions.length >= 1);
  // Every criterion is one of the model's own recognized dimensions --
  // never an ad hoc, unlabeled string.
  for (const criterion of [...threshold.enterConditions, ...threshold.monitorConditions, ...threshold.avoidConditions]) {
    assert.ok(
      ["controllingEvidenceGap", "reportStatedThreshold", "recommendationValidationTarget"].includes(criterion.dimension)
    );
  }
});

test("resolveMarketIntelligenceControllingDecisionThreshold only ever resolves for the SAME single-controlling-gap state Task #37/#38 already require -- null for 0 or 2+ material gaps", () => {
  const resolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  assert.equal(resolveMarketIntelligenceControllingDecisionThreshold(resolvedState), null);

  const multiUnresolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: true },
    marketSizing: null,
  });
  assert.equal(resolveMarketIntelligenceControllingDecisionThreshold(multiUnresolvedState), null);

  assert.equal(resolveMarketIntelligenceControllingDecisionThreshold(null), null);
});

// --- Unresolved controlling evidence keeps MONITOR ---

test("MONITOR condition is tied directly to Obtainable Share (SAM/SOM) staying unresolved, and always resolves (never fabricated)", () => {
  const state = buildCanonicalState();
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state);
  assert.equal(threshold.monitorConditions.length, 1);
  assert.equal(threshold.monitorConditions[0].dimension, "controllingEvidenceGap");
  assert.match(threshold.monitorSummary, /Obtainable Share \(SAM\/SOM\)/);
  assert.match(threshold.monitorSummary, /unresolved/i);
  assert.equal(threshold.monitorConditions[0].provenance, null);
});

// --- ENTER does not activate without required evidence ---

test("ENTER never activates (no quantified criterion) when neither the report's own text nor a linked recommendation names a real target", () => {
  const state = buildCanonicalState();
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, []);
  // Only the always-present, purely qualitative structural criterion --
  // no numeric/provenance-bearing criterion was fabricated.
  assert.equal(threshold.enterConditions.length, 1);
  assert.equal(threshold.enterConditions[0].dimension, "controllingEvidenceGap");
  assert.equal(threshold.enterConditions[0].provenance, null);
  assert.doesNotMatch(threshold.enterSummary, /\d+%/);
});

test("ENTER gains a real, sourced criterion when the report's own decision brief names a threshold linked to the ENTER token", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state);
  assert.equal(threshold.enterConditions.length, 2);
  const reportCriterion = threshold.enterConditions.find((c) => c.dimension === "reportStatedThreshold");
  assert.ok(reportCriterion);
  assert.match(reportCriterion.value, /above 5%/i);
  assert.equal(reportCriterion.provenance, "validationTarget");
  assert.match(threshold.enterSummary, /above 5%/i);
});

// --- Recommendation validation targets can feed thresholds structurally ---

test("a linked Strategic Recommendation's structured validation target feeds the ENTER criterion when the report's own text names no threshold -- reused verbatim, never re-parsed from prose", () => {
  const state = buildCanonicalState(); // no ENTER-linked figure in whatWouldChangeThisDecision
  const validation = classifyStrategicRecommendationValidation({
    item: pilotItem,
    signals: pilotSignals,
    canonicalState: state,
  });
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const recommendationCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(recommendationCriterion);
  assert.equal(recommendationCriterion.value, validation.successCriterion);
  assert.equal(recommendationCriterion.provenance, validation.provenance);
  assert.match(threshold.enterSummary, /20% pilot conversion rate/);
});

test("a linked recommendation's validation target is IGNORED once the report's own decision brief already names a real ENTER threshold -- the report's own figure always takes priority, never a second conflicting number", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const validation = classifyStrategicRecommendationValidation({
    item: pilotItem,
    signals: pilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.equal(threshold.enterConditions.length, 2);
  assert.ok(threshold.enterConditions.some((c) => c.dimension === "reportStatedThreshold"));
  assert.ok(!threshold.enterConditions.some((c) => c.dimension === "recommendationValidationTarget"));
});

test("an UNLINKED recommendation (different/no gap, e.g. a research action) never feeds the controlling threshold", () => {
  const state = buildCanonicalState();
  const researchValidation = classifyStrategicRecommendationValidation({
    item: "Commission a desk research report on the competitive landscape.",
    signals: { ...pilotSignals, activity: "research" },
    canonicalState: state,
  });
  assert.equal(researchValidation.relatedEvidenceGapId, null);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [researchValidation]);
  assert.equal(threshold.enterConditions.length, 1);
  assert.ok(!threshold.enterConditions.some((c) => c.dimension === "recommendationValidationTarget"));
});

// --- Negative validation can structurally support AVOID ---

test("AVOID always carries a defensible qualitative rule (never 'requires validation' alone) even with zero numeric data, and never fabricates a percentage", () => {
  const state = buildCanonicalState();
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, []);
  assert.equal(threshold.avoidConditions.length, 1);
  assert.equal(threshold.avoidConditions[0].dimension, "controllingEvidenceGap");
  assert.match(threshold.avoidSummary, /cannot be resolved to a defensible, viable estimate/i);
  assert.doesNotMatch(threshold.avoidSummary, /\d+%/);
});

test("AVOID gains a real negation criterion from a linked recommendation's own validation target when the report names no AVOID-linked figure", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: pilotItem,
    signals: pilotSignals,
    canonicalState: state,
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const negationCriterion = threshold.avoidConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(negationCriterion);
  assert.match(negationCriterion.description, /fails to meet/i);
  assert.equal(negationCriterion.value, validation.successCriterion);
  assert.equal(negationCriterion.provenance, validation.provenance);
});

test("AVOID gains a real criterion from the report's own AVOID-linked figure when one exists -- the model supports it with zero renderer changes", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A win rate below 2% across three pilots would support AVOID.",
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state);
  const reportCriterion = threshold.avoidConditions.find((c) => c.dimension === "reportStatedThreshold");
  assert.ok(reportCriterion);
  assert.match(reportCriterion.value, /below 2%/i);
});

// --- Assumptions are not treated as verified evidence ---

test("a report-stated threshold resting on a disclosed planning assumption (SAM defaultAssumption) is classified 'planningAssumption', never 'verifiedEvidence'", () => {
  const state = buildCanonicalState({
    marketSizing: { ...defaultMarketSizing, samMethod: "defaultAssumption", somStatus: "calculated" },
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state);
  const reportCriterion = threshold.enterConditions.find((c) => c.dimension === "reportStatedThreshold");
  assert.equal(reportCriterion.provenance, "planningAssumption");
});

test("a linked recommendation's own unevidenced pilot target is classified 'validationTarget', never silently upgraded to 'verifiedEvidence'", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: pilotItem,
    signals: pilotSignals, // evidenceTie empty -- no real citation backs this
    canonicalState: state,
  });
  assert.equal(validation.provenance, "validationTarget");
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const criterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(criterion.provenance, "validationTarget");
});

test("a linked recommendation's citation-backed figure is classified 'verifiedEvidence' and feeds the threshold as such", () => {
  const state = buildCanonicalState({
    citationSources: [
      ...buildCanonicalState().citationSources,
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
  const validation = classifyStrategicRecommendationValidation({
    item: pilotItem,
    signals: { ...pilotSignals, evidenceTie: "Confirmed by [R4]." },
    canonicalState: state,
  });
  assert.equal(validation.provenance, "verifiedEvidence");
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const criterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(criterion.provenance, "verifiedEvidence");
});

// --- Existing canonical decision remains unchanged ---

test("resolving the controlling decision threshold never mutates canonical decision, confidence, or decisionCriticalEvidence", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const before = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  const validation = classifyStrategicRecommendationValidation({ item: pilotItem, signals: pilotSignals, canonicalState: state });
  resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const after = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  assert.equal(before, after);
});

test("REAL FIXTURE: decision stays CONDITIONAL_GO (MONITOR), confidence stays 50, controlling factor stays Obtainable Share (SAM/SOM) after resolving the richer threshold model", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({ item: pilotItem, signals: pilotSignals, canonicalState: state });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  assert.equal(state.decision, "CONDITIONAL_GO");
  assert.equal(state.confidence, 50);
  assert.equal(threshold.controllingFactor, "Obtainable Share (SAM/SOM)");
  assert.deepEqual(
    resolveMarketIntelligenceEvidenceGaps(state).filter((g) => g.decisionFactor !== null).map((g) => g.id),
    ["obtainable-share"]
  );
  assert.deepEqual(
    resolveMarketIntelligenceDecisionThresholds(state).map((t) => t.gapId),
    ["obtainable-share"]
  );
});

// --- Web and PDF use identical threshold state ---

test("resolveMarketIntelligenceControllingDecisionThreshold is pure and deterministic -- identical inputs always produce an identical result, so web and PDF can never structurally disagree", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({ item: pilotItem, signals: pilotSignals, canonicalState: state });
  const a = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation], "English");
  const b = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation], "English");
  assert.deepEqual(a, b);
});

test("STRUCTURAL AUDIT: all 3 files (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) call resolveMarketIntelligenceControllingDecisionThreshold and read its enterSummary/monitorSummary/avoidSummary", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingDecisionThreshold\(/, `${name}: must call resolveMarketIntelligenceControllingDecisionThreshold`);
    assert.match(source, /marketControllingDecisionThreshold[!?]?\.enterSummary/, `${name}: must read enterSummary`);
    assert.match(source, /marketControllingDecisionThreshold[!?]?\.monitorSummary/, `${name}: must read monitorSummary`);
    assert.match(source, /marketControllingDecisionThreshold[!?]?\.avoidSummary/, `${name}: must read avoidSummary`);
  }
  const plannerCallSites = plannerSource.match(/resolveMarketIntelligenceControllingDecisionThreshold\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

test("STRUCTURAL AUDIT: every render surface falls back to the unchanged Task #36/#37 flat threshold when the controlling model does not match the current gap -- never leaves the UI blank", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /gapAction\.threshold\.enterCondition\.description/,
      `${name}: must retain the Task #36/#37 fallback for non-controlling gaps`
    );
  }
});
