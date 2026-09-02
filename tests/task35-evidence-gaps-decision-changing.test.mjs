import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionChangeState,
  resolveMarketIntelligenceDecisionChangeQuestion,
  selectTopMarketIntelligenceEvidenceGaps,
  buildMarketIntelligenceGapDrivenActions,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";

// TASK #35 -- Make Market Intelligence evidence gaps explicitly
// decision-changing and actionable.
//
// Every gap this module produces is derived ONLY from the SAME 3-pillar
// decisionCriticalEvidence (marketSizingResolved/competitiveEvidenceResolved/
// obtainableShareResolved) and canonicalState.cagr every other Market
// Intelligence surface already treats as authoritative -- these tests
// construct canonical-state fixtures directly (rather than the full
// generation pipeline) so every pillar combination can be tested in
// isolation, exactly as market-intelligence-evidence-gaps.ts itself
// consumes them.

const readSourceFile = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

const defaultMarketSizing = {
  tam: "$1.2 billion",
  sam: "$300 million",
  som: "$15 million",
  method: "topDown",
  tier: "supportedEstimate",
  samMethod: "evidenceDerived",
  somStatus: "calculated",
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
      obtainableShareResolved: true,
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

// --- Requirement #2/#8: unresolved material evidence produces a structured gap ---

test("unresolved market-sizing pillar produces a fully structured market-sizing gap", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    marketSizing: null,
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "market-sizing");
  assert.ok(gap);
  assert.equal(gap.decisionFactor, "marketSizingResolved");
  assert.equal(gap.isPlanningAssumption, false);
  assert.ok(gap.whyItMatters.length > 0);
  assert.ok(gap.currentStatus.length > 0);
  assert.ok(gap.evidenceRequired.length > 0);
  assert.ok(gap.validationMethod.length > 0);
  assert.ok(gap.decisionImpact.length > 0);
});

test("unresolved competitive-evidence pillar produces a fully structured competitive-evidence gap", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: true },
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "competitive-evidence");
  assert.ok(gap);
  assert.equal(gap.decisionFactor, "competitiveEvidenceResolved");
  assert.match(gap.evidenceRequired, /competitor|adjacent player/i);
  assert.match(gap.validationMethod, /discovery|directories|analyst/i);
});

test("every decision-critical pillar resolved and real CAGR evidence present -- zero gaps produced (an empty result is a genuine, not a missing, signal)", () => {
  const state = buildCanonicalState();
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  assert.deepEqual(gaps, []);
});

// --- Requirement #5: TAM/SAM/SOM discipline -- obtainable-share gap ---

test("obtainable-share gap reuses the model's own real, non-fabricated SOM-pending explanation as currentStatus, and never fabricates an obtainable-share number", () => {
  const somPendingExplanation =
    "SOM not calculated: bottom-up obtainable-share inputs did not meet the evidence bar.";
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    marketSizing: { ...defaultMarketSizing, samMethod: "evidenceDerived", somStatus: "pending", som: somPendingExplanation },
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "obtainable-share");
  assert.ok(gap);
  assert.equal(gap.currentStatus, somPendingExplanation);
  assert.doesNotMatch(gap.currentStatus, /^\$[\d,.]+/, "must never read as a fabricated dollar figure");
});

test("obtainable-share gap marks isPlanningAssumption=true when SAM itself is a disclosed default assumption, never presenting it as verified market evidence", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    marketSizing: { ...defaultMarketSizing, samMethod: "defaultAssumption", somStatus: "calculated" },
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "obtainable-share");
  assert.ok(gap);
  assert.equal(gap.isPlanningAssumption, true);
  assert.match(gap.currentStatus, /disclosed default share assumption/i);
});

// --- Requirement #2: gaps do not fabricate unsupported numeric thresholds ---

test("successThreshold is null when the report's own decision brief names no explicit numeric bar -- never invented", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering.",
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "obtainable-share");
  assert.equal(gap.successThreshold, null);
});

test("successThreshold is sourced VERBATIM from the report's own whatWouldChangeThisDecision text when it names one -- never invented independently", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "obtainable-share");
  assert.ok(gap.successThreshold);
  assert.ok(
    state.whatWouldChangeThisDecision.includes(gap.successThreshold),
    "successThreshold must be a verbatim substring of the report's own real text"
  );
});

// --- Requirement #2: planning thresholds remain explicitly assumptions ---

test("the growth-rate (CAGR) gap is explicitly marked a planning assumption when zero qualifying evidence exists, and never gates the canonical decision", () => {
  const state = buildCanonicalState({ cagr: [] });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const gap = gaps.find((g) => g.id === "growth-rate");
  assert.ok(gap);
  assert.equal(gap.isPlanningAssumption, true);
  assert.equal(gap.decisionFactor, null, "CAGR is not one of the 3 real gating pillars -- must never be presented as one");
});

test("no growth-rate gap is produced when real, qualifying CAGR evidence exists", () => {
  const state = buildCanonicalState({
    cagr: [{ description: "x", evidenceIds: ["R9"], confidenceClassification: "Verified" }],
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  assert.equal(gaps.find((g) => g.id === "growth-rate"), undefined);
});

// --- Requirement #3: MONITOR explains what specifically prevents ENTER ---

test("MONITOR (CONDITIONAL_GO): question asks what prevents ENTER, and the one unresolved pillar is named as the sole blocker", () => {
  const state = buildCanonicalState({
    decision: "CONDITIONAL_GO",
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
  });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.ok(changeState);
  assert.match(changeState.question, /prevents ENTER/i);
  assert.equal(changeState.materialGaps.length, 1);
  assert.equal(changeState.materialGaps[0].id, "obtainable-share");
  assert.match(changeState.materialGaps[0].decisionImpact, /only unresolved decision-critical factor/i);
});

test("MONITOR with 2 unresolved pillars: decisionImpact honestly states 'one of 2', never claims either alone is sufficient", () => {
  const state = buildCanonicalState({
    decision: "CONDITIONAL_GO",
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    marketSizing: null,
  });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.equal(changeState.materialGaps.length, 2);
  for (const gap of changeState.materialGaps) {
    assert.match(gap.decisionImpact, /one of 2 unresolved decision-critical factors/i);
  }
});

// --- Requirement #3: ENTER exposes downgrade/invalidation evidence ---

test("ENTER (GO) with an unresolved pillar (degraded/legacy edge case): decisionImpact honestly frames it as a downgrade/revisit risk, never a contradiction of the current decision", () => {
  const state = buildCanonicalState({
    decision: "GO",
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: true },
  });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.match(changeState.question, /invalidate or downgrade/i);
  assert.equal(changeState.materialGaps.length, 1);
  assert.match(changeState.materialGaps[0].decisionImpact, /although the current decision is/i);
});

test("ENTER (GO) with every pillar resolved but no CAGR evidence: the non-gating growth-rate gap surfaces as a supporting downgrade-risk signal, never as a material/gating one", () => {
  const state = buildCanonicalState({ decision: "GO", cagr: [] });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.equal(changeState.materialGaps.length, 0);
  assert.equal(changeState.supportingGaps.length, 1);
  assert.equal(changeState.supportingGaps[0].id, "growth-rate");
});

// --- Requirement #3: AVOID exposes reconsideration evidence where applicable ---

test("AVOID (NO_GO) with an unresolved pillar (edge case): question asks what could justify reconsideration, and the gap frames resolution as a prerequisite, not a guarantee", () => {
  const state = buildCanonicalState({
    decision: "NO_GO",
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    marketSizing: null,
  });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.match(changeState.question, /justify reconsideration/i);
  assert.equal(changeState.materialGaps.length, 1);
  assert.match(changeState.materialGaps[0].decisionImpact, /prerequisite for reconsidering/i);
});

test("AVOID (NO_GO) with every decision-critical pillar resolved (the expected case, since a strong AVOID requires resolved evidence): materialGaps is honestly empty, never a fabricated reconsideration path", () => {
  const state = buildCanonicalState({ decision: "NO_GO" });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.equal(changeState.materialGaps.length, 0);
});

// --- selectTopMarketIntelligenceEvidenceGaps: Executive Summary "avoid clutter" ---

test("selectTopMarketIntelligenceEvidenceGaps prioritizes material (decision-gating) gaps over supporting ones, capped at maxCount", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    marketSizing: null,
    cagr: [],
  });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  assert.equal(gaps.length, 4);
  const top = selectTopMarketIntelligenceEvidenceGaps(gaps, 2);
  assert.equal(top.length, 2);
  assert.ok(top.every((g) => g.decisionFactor !== null));
});

test("selectTopMarketIntelligenceEvidenceGaps falls back to supporting gaps only when no material gap exists", () => {
  const state = buildCanonicalState({ cagr: [] });
  const gaps = resolveMarketIntelligenceEvidenceGaps(state);
  const top = selectTopMarketIntelligenceEvidenceGaps(gaps, 2);
  assert.equal(top.length, 1);
  assert.equal(top[0].id, "growth-rate");
});

// --- Requirement #6: Strategic Recommendations map to material gaps ---

test("buildMarketIntelligenceGapDrivenActions follows gap -> validation action -> measurable result -> decision consequence, and only for material (decision-gating) gaps", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    cagr: [],
  });
  const actions = buildMarketIntelligenceGapDrivenActions(state);
  assert.equal(actions.length, 1, "the non-gating growth-rate gap must not produce a decision-changing action");
  const somAction = actions[0];
  assert.equal(somAction.gapId, "obtainable-share");
  assert.ok(somAction.action.length > 0);
  assert.ok(somAction.measurableResult.length > 0);
  assert.ok(somAction.decisionConsequence.length > 0);
  assert.match(somAction.action, /pilot|letter of intent|comparable-company/i);
});

test("buildMarketIntelligenceGapDrivenActions never fabricates an action for a fully-resolved report", () => {
  const state = buildCanonicalState();
  assert.deepEqual(buildMarketIntelligenceGapDrivenActions(state), []);
});

// --- Requirement #7: web and PDF must consume the SAME structured state ---

test("resolveMarketIntelligenceEvidenceGaps is pure and deterministic -- the same canonical state always produces identical gaps, so web and PDF can never structurally disagree", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    marketSizing: null,
  });
  const gapsA = resolveMarketIntelligenceEvidenceGaps(state, "English");
  const gapsB = resolveMarketIntelligenceEvidenceGaps(state, "English");
  assert.deepEqual(gapsA, gapsB);
});

test("STRUCTURAL AUDIT: every render surface (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) calls resolveMarketIntelligenceDecisionChangeState for Executive Summary -- never independently re-derives gap state from prose", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceDecisionChangeState\(/, `${name}: must call resolveMarketIntelligenceDecisionChangeState`);
  }
  // Planner.tsx renders both its own web card AND its own PDF -- both
  // paths must call it independently.
  const plannerCallSites = plannerSource.match(/resolveMarketIntelligenceDecisionChangeState\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

test("STRUCTURAL AUDIT: every render surface calls buildMarketIntelligenceGapDrivenActions for Strategic Recommendations -- gap-driven actions are never reconstructed independently per surface", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /buildMarketIntelligenceGapDrivenActions\(/, `${name}: must call buildMarketIntelligenceGapDrivenActions`);
  }
  const plannerCallSites = plannerSource.match(/buildMarketIntelligenceGapDrivenActions\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

// --- Requirement: canonical decision/confidence remains unchanged by presentation logic ---

test("resolving evidence gaps, decision-change state, and gap-driven actions never mutates the canonical decision or confidence", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 42 });
  const before = JSON.stringify({ decision: state.decision, confidence: state.confidence });
  resolveMarketIntelligenceEvidenceGaps(state);
  resolveMarketIntelligenceDecisionChangeState(state);
  buildMarketIntelligenceGapDrivenActions(state);
  const after = JSON.stringify({ decision: state.decision, confidence: state.confidence });
  assert.equal(before, after);
});

test("null canonicalState produces empty/null results everywhere -- never fabricates a gap for a legacy report with no canonical state", () => {
  assert.deepEqual(resolveMarketIntelligenceEvidenceGaps(null), []);
  assert.equal(resolveMarketIntelligenceDecisionChangeState(null), null);
  assert.deepEqual(buildMarketIntelligenceGapDrivenActions(null), []);
  assert.equal(typeof resolveMarketIntelligenceDecisionChangeQuestion("CONDITIONAL_GO"), "string");
});

// --- Requirement #7 (Task #34 regression): Sources remains hidden from presentation ---

test("Sources remains hidden from presentation on all 4 render surfaces -- unchanged by this task", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /resolveMarketIntelligenceSourcesForDisplay\(/, `${name}: Sources must remain hidden from presentation`);
  }
});

// --- Provenance remains internally preserved ---

test("provenance (citationSources, decisionCriticalEvidence, marketSizing.evidenceIds) remains fully intact and untouched after gap resolution", () => {
  const state = buildCanonicalState();
  const beforeCitations = JSON.stringify(state.citationSources);
  const beforeEvidence = JSON.stringify(state.decisionCriticalEvidence);
  resolveMarketIntelligenceEvidenceGaps(state);
  resolveMarketIntelligenceDecisionChangeState(state);
  buildMarketIntelligenceGapDrivenActions(state);
  assert.equal(JSON.stringify(state.citationSources), beforeCitations);
  assert.equal(JSON.stringify(state.decisionCriticalEvidence), beforeEvidence);
  assert.ok(state.citationSources.length > 0);
  assert.equal(state.citationSources[0].evidenceId, "R1");
});

// --- Real report pattern (MONITOR/50%, SOM unresolved -- the CLM fixture used throughout this session) ---

test("REAL REPORT PATTERN (MONITOR/50%, SOM unresolved): produces exactly one material gap explaining what specifically prevents ENTER", () => {
  const somPendingExplanation =
    "SOM not calculated: bottom-up obtainable-share inputs did not meet the evidence bar for this market.";
  const state = buildCanonicalState({
    decision: "CONDITIONAL_GO",
    confidence: 50,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    marketSizing: { ...defaultMarketSizing, samMethod: "evidenceDerived", somStatus: "pending", som: somPendingExplanation },
  });
  const changeState = resolveMarketIntelligenceDecisionChangeState(state);
  assert.equal(changeState.materialGaps.length, 1);
  assert.equal(changeState.materialGaps[0].id, "obtainable-share");
  assert.equal(changeState.materialGaps[0].currentStatus, somPendingExplanation);

  const actions = buildMarketIntelligenceGapDrivenActions(state);
  const somAction = actions.find((a) => a.gapId === "obtainable-share");
  assert.ok(somAction);
  assert.match(somAction.decisionConsequence, /only unresolved decision-critical factor/i);
});
