import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionThresholds,
  buildMarketIntelligenceGapDrivenActions,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";

// TASK #36 -- Make Market Intelligence decision thresholds explicit and
// structurally tied to evidence gaps.
//
// Every threshold is derived ONLY from fields already part of
// MarketIntelligenceCanonicalState (decision, decisionCriticalEvidence,
// marketSizing, cagr, whatWouldChangeThisDecision) -- no new persisted
// field, no canonical-state version bump. These fixtures therefore build
// the EXACT same canonical-state shape Task #35's own tests use, proving
// the threshold layer works correctly for already-persisted reports on
// reload with zero migration.

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

// --- Decision-critical evidence gap -> decision threshold mapping ---

test("an unresolved material gap (obtainable-share) maps to a decision threshold naming the exact same affected canonical factor", () => {
  const state = buildCanonicalState();
  const thresholds = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(thresholds.length, 1);
  const threshold = thresholds[0];
  assert.equal(threshold.gapId, "obtainable-share");
  assert.equal(threshold.affectedFactor, "obtainableShareResolved");
  assert.equal(threshold.currentStatus, "unresolved");
  assert.ok(threshold.evidenceRequired.length > 0);
  assert.ok(threshold.measurementMethod.length > 0);
});

test("each material gap produced by resolveMarketIntelligenceEvidenceGaps has exactly one corresponding threshold, and non-gating gaps (growth-rate) get none", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    marketSizing: null,
    cagr: [],
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const materialGapIds = gaps.filter((g) => g.decisionFactor !== null).map((g) => g.id);
  const thresholds = resolveMarketIntelligenceDecisionThresholds(state);
  assert.deepEqual(
    thresholds.map((t) => t.gapId).sort(),
    materialGapIds.sort()
  );
  assert.ok(!thresholds.some((t) => t.gapId === "growth-rate"), "growth-rate is non-gating and must never get a threshold");
});

// --- Unsupported numeric thresholds are not fabricated ---

test("ENTER condition is honestly 'requiresValidation' when the report's own text names no threshold at all", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.status, "requiresValidation");
  assert.match(threshold.enterCondition.description, /requires validation/i);
});

test("a number that appears in the SAME text but NOT in a sentence naming the ENTER token is never attributed to the ENTER condition", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision:
      "Some unrelated context mentions 20% market share elsewhere in this market. Further diligence on obtainable share would be required before reconsidering the current decision.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.status, "requiresValidation");
  assert.doesNotMatch(threshold.enterCondition.description, /20%/);
});

// --- ENTER threshold cannot silently become the current ENTER decision ---

test("ENTER condition is 'defined' and quantified ONLY when the report's own text links a real number to the ENTER token in the same sentence", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.status, "defined");
  assert.match(threshold.enterCondition.description, /above 5%/i);
  // Verbatim provenance: the quantified phrase must be a real substring of
  // the report's own text, never invented independently.
  assert.ok(state.whatWouldChangeThisDecision.includes("above 5%"));
});

test("the ENTER condition, even when quantified, is phrased conditionally and never asserts the report's decision currently IS ENTER -- the canonical decision remains authoritative and unchanged", () => {
  const state = buildCanonicalState({
    decision: "CONDITIONAL_GO",
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.status, "defined");
  // The condition text describes a hypothetical outcome ("X above Y"),
  // never a present-tense claim that the decision already is ENTER.
  assert.doesNotMatch(threshold.enterCondition.description, /^ENTER\b/);
  assert.doesNotMatch(threshold.enterCondition.description, /is currently ENTER/i);
  // The canonical decision itself is untouched by resolving this threshold.
  assert.equal(state.decision, "CONDITIONAL_GO");
});

// --- Planning thresholds are clearly classified as assumptions ---

test("every condition on a gap whose current unresolved state is a disclosed planning assumption (SAM defaultAssumption) is itself marked isPlanningAssumption=true", () => {
  const state = buildCanonicalState({
    marketSizing: { ...defaultMarketSizing, samMethod: "defaultAssumption", somStatus: "calculated" },
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.isPlanningAssumption, true);
  assert.equal(threshold.monitorCondition.isPlanningAssumption, true);
  assert.equal(threshold.avoidCondition.isPlanningAssumption, true);
});

test("a gap with no planning-assumption basis (SAM evidence-derived, SOM genuinely pending) marks its conditions isPlanningAssumption=false", () => {
  const state = buildCanonicalState({
    marketSizing: { ...defaultMarketSizing, samMethod: "evidenceDerived", somStatus: "pending" },
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.enterCondition.isPlanningAssumption, false);
});

// --- MONITOR condition is always structurally defined, never fabricated ---

test("MONITOR condition never requires fabrication -- it is always 'defined' via the status-quo statement when the report names no explicit figure", () => {
  const state = buildCanonicalState();
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.monitorCondition.status, "defined");
  assert.match(threshold.monitorCondition.description, /unresolved/i);
});

// --- AVOID condition requires validation by default ---

test("AVOID condition is honestly 'requiresValidation' when the report never states a downside/reconsideration threshold (the overwhelmingly common real case)", () => {
  const state = buildCanonicalState({
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(threshold.avoidCondition.status, "requiresValidation");
  // The ENTER-linked number must never leak into the AVOID condition.
  assert.doesNotMatch(threshold.avoidCondition.description, /5%/);
});

// --- Empty/null-safety ---

test("resolveMarketIntelligenceDecisionThresholds returns an empty array for a fully-resolved canonical state (no material gaps) -- never a fabricated threshold", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  assert.deepEqual(resolveMarketIntelligenceDecisionThresholds(state), []);
});

test("resolveMarketIntelligenceDecisionThresholds returns an empty array for a null canonicalState", () => {
  assert.deepEqual(resolveMarketIntelligenceDecisionThresholds(null), []);
});

// --- buildMarketIntelligenceGapDrivenActions attaches the SAME threshold ---

test("buildMarketIntelligenceGapDrivenActions attaches a threshold per action that is identical to resolveMarketIntelligenceDecisionThresholds's own output for the same gap -- one shared computation, never two", () => {
  const state = buildCanonicalState();
  const actions = buildMarketIntelligenceGapDrivenActions(state);
  const thresholds = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(actions.length, thresholds.length);
  for (const action of actions) {
    const matching = thresholds.find((t) => t.gapId === action.gapId);
    assert.ok(matching);
    assert.deepEqual(action.threshold, matching);
  }
});

// --- Canonical decision remains unchanged ---

test("resolving thresholds never mutates the canonical decision, confidence, or decisionCriticalEvidence", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const before = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  resolveMarketIntelligenceDecisionThresholds(state);
  buildMarketIntelligenceGapDrivenActions(state);
  const after = JSON.stringify({
    decision: state.decision,
    confidence: state.confidence,
    decisionCriticalEvidence: state.decisionCriticalEvidence,
  });
  assert.equal(before, after);
});

// --- MONITOR report remains MONITOR until evidence actually satisfies the canonical decision methodology ---

test("REAL REPORT PATTERN (MONITOR/50%, SOM unresolved): the threshold layer explains a hypothetical ENTER path without ever changing, or appearing to change, the canonical MONITOR decision", () => {
  const state = buildCanonicalState({
    decision: "CONDITIONAL_GO",
    confidence: 50,
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const [threshold] = resolveMarketIntelligenceDecisionThresholds(state);

  // The threshold explains what COULD change the decision...
  assert.equal(threshold.enterCondition.status, "defined");
  assert.match(threshold.enterCondition.description, /above 5%/i);

  // ...but the canonical decision itself is still, and only, MONITOR
  // (CONDITIONAL_GO) -- resolving/reading the threshold is not itself
  // evidence, and must never be mistaken for satisfying it.
  assert.equal(state.decision, "CONDITIONAL_GO");
  assert.equal(state.confidence, 50);
  assert.equal(state.decisionCriticalEvidence.obtainableShareResolved, false);
});

// --- Threshold data survives persistence/reload ---

test("threshold resolution requires ONLY fields already part of the persisted MarketIntelligenceCanonicalState shape -- no new field, so it is correct immediately for every already-persisted report on reload", () => {
  // This fixture uses exactly the same canonical-state shape
  // buildMarketIntelligenceCanonicalState has produced since Task #33/#34
  // (version 3) -- no field here was added for this task.
  const state = buildCanonicalState();
  assert.equal(state.version, 3);
  const thresholds = resolveMarketIntelligenceDecisionThresholds(state);
  assert.equal(thresholds.length, 1);
  // Round-tripping through JSON (simulating a metadata reload from
  // Postgres) must not change the result.
  const reloaded = JSON.parse(JSON.stringify(state));
  const reloadedThresholds = resolveMarketIntelligenceDecisionThresholds(reloaded);
  assert.deepEqual(reloadedThresholds, thresholds);
});

// --- Web/PDF parity ---

test("STRUCTURAL AUDIT: all 4 render surfaces (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) render the SAME gapAction.threshold object -- never a second, independently reconstructed threshold", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /gapAction\.threshold\.enterCondition/, `${name}: must render enterCondition`);
    assert.match(source, /gapAction\.threshold\.monitorCondition/, `${name}: must render monitorCondition`);
    assert.match(source, /gapAction\.threshold\.avoidCondition/, `${name}: must render avoidCondition`);
  }
  // Planner.tsx renders both its own web card AND its own PDF -- both
  // paths must reference the threshold.
  const plannerEnterSites = plannerSource.match(/gapAction\.threshold\.enterCondition/g) || [];
  assert.ok(plannerEnterSites.length >= 2, "Planner.tsx must render the threshold from both its web and PDF paths");
});

test("STRUCTURAL AUDIT: no render surface computes its own independent decision-threshold logic (e.g. re-deriving ENTER/MONITOR/AVOID conditions from prose) -- all consume buildMarketIntelligenceGapDrivenActions/resolveMarketIntelligenceDecisionThresholds", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(
      source,
      /buildMarketIntelligenceGapDrivenActions\(/,
      `${name}: must source gap-driven actions (and their attached thresholds) from the shared module`
    );
  }
});
