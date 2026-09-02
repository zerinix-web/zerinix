import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  buildMarketIntelligenceCanonicalState,
  classifyStrategicRecommendationAction,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import {
  extractRecommendationItems,
  extractRecommendationSignals,
} from "../app/lib/report-presentation.ts";

// TASK #31 -- Make Market Intelligence recommendation quality explicitly
// evidence-aware.
//
// ROOT CAUSE (confirmed via full audit of generation, extraction, and all
// 4 render sites -- page.tsx web, Planner.tsx web + PDF, ReportPdfButton.tsx
// PDF): Strategic Recommendations' own action cards were built purely
// from AI-generated prose with zero connection to the canonical decision
// or its underlying evidence pillars. The only decision-aware element on
// the whole section was the "Current Decision: X" badge drawn once above
// the card grid -- individual cards' own action text, budget, and KPI
// were never checked against the decision or against
// decisionCriticalEvidence. Confirmed live against the real
// 171cf10d-538a-4ad3-9ed9-b30e85914e85 report (MONITOR / 50% confidence /
// SOM unresolved, used throughout Tasks #29-#30): its own Action 3
// ("Integration Pilot Build") names a $150,000 budget and a 120-day KPI
// with no evidence tie at all -- fake precision presented as fact on a
// report whose canonical decision is a conditional pilot, not a green
// light.
//
// FIX: classifyStrategicRecommendationAction (market-intelligence-canonical-state.ts)
// is a pure, deterministic classification layer applied AFTER the
// existing extraction (report-presentation.ts's extraction itself is
// untouched). It assigns an actionType (validation/research/pilot/
// conditional_execution/scale) from the action's own language, then
// conservatively downgrades -- never upgrades -- that classification
// using the same canonical decision/evidence pillars every other MI
// surface already reads, and classifies every numeric budget/KPI/
// timeline figure by its own evidence basis (tied to a real Evidence Tie,
// already labeled a planning assumption, or -- the conservative default
// -- surfaced as one). Wired identically into all 4 render sites.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
    sourceTitle: `${name} source`,
    publisher: name,
    url,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

function decisionBriefFixture(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    confidenceFactors: ["verified market size unavailable"],
    why: "Evidence supports conditional entry pending SOM validation.",
    topReasons: ["Active vendor landscape", "Growing category"],
    topRisks: ["Incumbent concentration", "Procurement cycle length"],
    missingEvidence: ["Independent win-rate data"],
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
    ...overrides,
  };
}

function realGraphFixture() {
  const evidence = [
    evidenceItem({ id: "R3", name: "DocuSign", url: "https://procurement.sc.gov/docusign-clm" }),
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R5", name: "Evisort", url: "https://evisort.com/ai-engine" }),
    evidenceItem({
      id: "R12",
      name: "Emergen Research",
      url: "https://emergenresearch.com/clm-market",
      claim: "Market research report values the U.S. CLM software market at $1.5 billion.",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "AI compliance & contract intelligence SaaS");
}

function canonicalStateFor(decision, overrides = {}) {
  return buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: {
      marketSizingResolved: decision === "GO",
      competitiveEvidenceResolved: decision !== "NO_GO",
      obtainableShareResolved: decision === "GO",
    },
    decisionBrief: decisionBriefFixture({ decision, ...overrides }),
  });
}

function baseSignals(overrides = {}) {
  return {
    budget: "",
    metric: "",
    timeframe: "",
    owner: "",
    gate: "",
    activity: "",
    evidenceTie: "",
    ...overrides,
  };
}

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

// --- Structural audit: all 4 render sites are wired to the same function -

// TASK #38 -- all 4 render sites now call classifyStrategicRecommendationValidation
// (market-intelligence-evidence-gaps.ts) instead of calling
// classifyStrategicRecommendationAction directly. This is a pure wrap,
// not a replacement: classifyStrategicRecommendationValidation's very
// first line calls classifyStrategicRecommendationAction internally and
// spreads its ENTIRE result onto the returned object unchanged (see
// tests/task38-recommendation-evidence-linkage.test.mjs), so every
// actionType/numericBasis/downgradeReason assertion elsewhere in THIS
// file (which calls classifyStrategicRecommendationAction directly, not
// through a render site) still exercises the exact same classification
// logic this task originally verified -- only the render-site CALL SITE
// name changed, to add the gap-linkage/provenance layer Task #38
// requires.
test("STRUCTURAL AUDIT: all 4 render sites import and call classifyStrategicRecommendationValidation (which itself wraps classifyStrategicRecommendationAction unchanged)", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const callSites = source.match(/classifyStrategicRecommendationValidation\(/g) || [];
    assert.ok(callSites.length >= 1, `${name}: expected at least one classifyStrategicRecommendationValidation( call site`);
  }
  // Planner.tsx has 2 call sites (web PremiumSectionVisual + PDF
  // computeRecommendationCardLayout) -- both must exist so web and PDF
  // can never classify a card differently.
  const plannerCallSites = plannerSource.match(/classifyStrategicRecommendationValidation\(/g) || [];
  assert.equal(plannerCallSites.length, 2, "Planner.tsx must classify identically in both its web and PDF render paths");
});

test("STRUCTURAL AUDIT: the PDF layout function computes the effective gate (model gate or downgrade reason) BEFORE the height math that depends on it, in both PDF files", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    const layoutFnMatch = /const computeRecommendationCardLayout = \(item: string, cardWidth: number\) => \{[\s\S]*?\n\s{6}\};/.exec(
      source
    );
    assert.ok(layoutFnMatch, `${name}: computeRecommendationCardLayout not found`);
    const body = layoutFnMatch[0];
    // TASK #38 -- renamed call site (classifyStrategicRecommendationValidation
    // wraps classifyStrategicRecommendationAction unchanged; see this
    // file's own STRUCTURAL AUDIT test above for the full comment).
    const classifyIndex = body.indexOf("const classification = classifyStrategicRecommendationValidation(");
    const gateReservedIndex = body.indexOf("const gateReservedHeight =");
    assert.ok(classifyIndex >= 0, `${name}: classification call missing from layout function`);
    assert.ok(gateReservedIndex >= 0, `${name}: gateReservedHeight declaration missing`);
    assert.ok(
      classifyIndex < gateReservedIndex,
      `${name}: classification must be computed before gateReservedHeight is derived from the effective gate`
    );
  }
});

// --- Behavioral: actionType classification + conservative downgrading ---

test("REGRESSION: MONITOR (CONDITIONAL_GO) cannot produce an unconditional scale action -- always downgraded to conditional execution", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 55 });
  const scaleVariants = [
    "Launch nationally across all 50 states and hire a team of 20 sales reps immediately.",
    "Scale up marketing spend to capture the full addressable market this quarter.",
    "Begin a nationwide rollout of the product to every existing customer segment.",
  ];

  for (const item of scaleVariants) {
    const signals = baseSignals();
    const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
    assert.notEqual(result.actionType, "scale", `expected downgrade for: ${item}`);
    assert.equal(result.actionType, "conditional_execution");
    assert.equal(result.wasDowngraded, true);
    assert.match(result.downgradeReason, /MONITOR/i);
  }
});

test("REGRESSION: MONITOR does not downgrade genuinely bounded actions (pilot, validation, research, conditional execution) -- conservatism only ever narrows scale", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 55 });
  const boundedVariants = [
    { item: "Run a controlled pilot with 3 mid-market accounts before expanding further.", expected: "pilot" },
    { item: "Validate the pricing hypothesis through 10 customer discovery interviews.", expected: "validation" },
    { item: "Research the procurement pathway used by comparable state agencies.", expected: "research" },
  ];

  for (const { item, expected } of boundedVariants) {
    const signals = baseSignals();
    const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
    assert.equal(result.actionType, expected, `expected ${expected} for: ${item}`);
    assert.equal(result.wasDowngraded, false);
  }
});

test("REGRESSION: AVOID (NO_GO) cannot produce a market-entry action -- pilot, conditional execution, and scale are all downgraded to research", () => {
  const canonicalState = canonicalStateFor("NO_GO", { confidence: 12 });
  const executionFramedVariants = [
    "Run a controlled pilot with 3 mid-market accounts before expanding further.",
    "Assign an owner to manage rollout before the next board decision.",
    "Scale up marketing spend to capture the full addressable market this quarter.",
  ];

  for (const item of executionFramedVariants) {
    const signals = baseSignals();
    const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
    assert.equal(result.actionType, "research", `expected research downgrade for: ${item}`);
    assert.equal(result.wasDowngraded, true);
    assert.match(result.downgradeReason, /AVOID/i);
    assert.notEqual(result.actionType, "pilot");
    assert.notEqual(result.actionType, "scale");
  }
});

test("REGRESSION: AVOID leaves genuine validation/research actions untouched -- the market can still be re-examined, just never executed on", () => {
  const canonicalState = canonicalStateFor("NO_GO", { confidence: 12 });
  const item = "Research the procurement pathway used by comparable state agencies.";
  const result = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState });
  assert.equal(result.actionType, "research");
  assert.equal(result.wasDowngraded, false);
});

test("REGRESSION: missing critical evidence forces validation-first recommendations -- a scale action is downgraded whenever any decision-critical evidence pillar is unresolved, even under ENTER", () => {
  const item = "Scale up marketing spend to capture the full addressable market this quarter.";

  // ENTER (GO) but decisionCriticalEvidence has a gap (obtainableShareResolved: false).
  const enterWithGap = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({ decision: "GO", confidence: 82 }),
  });
  const resultWithGap = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState: enterWithGap });
  assert.equal(resultWithGap.actionType, "conditional_execution");
  assert.equal(resultWithGap.wasDowngraded, true);
  assert.match(resultWithGap.downgradeReason, /evidence/i);

  // No canonical state at all (legacy report) -- conservative default.
  const resultNoState = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState: null });
  assert.equal(resultNoState.actionType, "conditional_execution");
  assert.equal(resultNoState.wasDowngraded, true);
  assert.equal(resultNoState.evidenceBasis, "unavailable");
});

test("REGRESSION: ENTER (GO) keeps a scale classification only when every decision-critical evidence pillar is resolved AND confidence clears the strong threshold", () => {
  const item = "Scale up marketing spend to capture the full addressable market this quarter.";
  const strongEnter = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture({ decision: "GO", confidence: 82 }),
  });
  const result = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState: strongEnter });
  assert.equal(result.actionType, "scale");
  assert.equal(result.wasDowngraded, false);
  assert.equal(result.evidenceBasis, "canonical-state");

  // Same evidence pillars, but confidence below the strong threshold --
  // still downgraded, since "genuinely warrants it" requires both.
  const weakEnter = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture({ decision: "GO", confidence: 60 }),
  });
  const weakResult = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState: weakEnter });
  assert.equal(weakResult.actionType, "conditional_execution");
  assert.equal(weakResult.wasDowngraded, true);
});

// --- Behavioral: numeric-precision / planning-assumption discipline -----

test("REGRESSION: an unsupported numeric budget/KPI/timeline (no evidence tie, no explicit label) is marked a planning assumption, never presented as an unqualified fact", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Integration Pilot Build -- Owner: Head of Product; Budget ceiling: $150,000.";
  const signals = baseSignals({ budget: "$150,000", metric: "≥30% reduction", timeframe: "120 days", evidenceTie: "" });
  const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
  assert.equal(result.numericBasis, "planning_assumption");
});

test("REGRESSION: a numeric figure already explicitly labeled a planning assumption by the model is respected, not double-flagged incorrectly", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Run a $50,000 (Planning Assumption) pilot campaign.";
  const signals = baseSignals({ budget: "$50,000 (Planning Assumption)", evidenceTie: "" });
  const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
  assert.equal(result.numericBasis, "planning_assumption");
});

// TASK #33 -- confirmed live (source-provenance audit): a non-empty
// Evidence Tie previously upgraded any number to "evidence" basis with
// zero check that it names a real, resolvable citation. The real
// 171cf10d... report's own evidenceTie ("signed SOWs and pilot KPIs") is
// FUTURE evidence to be collected, not a citation to anything that
// exists yet -- treating it as sufficient let a recommendation's budget
// look externally sourced merely because the action named what evidence
// it intends to gather. Corrected: descriptive evidenceTie text with no
// resolvable citation marker now stays "planning_assumption"; see the
// next test for the genuine positive case (a citation that actually
// resolves in the canonical source registry).
test("REGRESSION: an Evidence Tie that is descriptive future-validation text (no resolvable citation) does NOT upgrade a number to 'evidence' -- it remains a planning assumption", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.";
  const signals = baseSignals({
    budget: "$75,000",
    metric: "≥6 signed paid trials within 90 days",
    timeframe: "90 days",
    evidenceTie: "signed SOWs and pilot KPIs",
  });
  const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
  assert.equal(result.numericBasis, "planning_assumption");
  assert.notEqual(result.numericBasis, "evidence");
});

test("REGRESSION: an Evidence Tie naming a citation that actually resolves in the canonical source registry DOES count as 'evidence'", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.ok(canonicalState.citationSources.some((source) => source.evidenceId === "R4"), "sanity check: R4 must be a real known citation in this fixture");
  const item = "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.";
  const signals = baseSignals({
    budget: "$75,000",
    metric: "≥6 signed paid trials within 90 days",
    timeframe: "90 days",
    evidenceTie: "Ironclad pricing page [R4]",
  });
  const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
  assert.equal(result.numericBasis, "evidence");
});

test("REGRESSION: an Evidence Tie naming a citation id that does NOT exist in the canonical source registry (a dangling reference) does not count as 'evidence'", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.ok(!canonicalState.citationSources.some((source) => source.evidenceId === "R999"), "sanity check: R999 must not be a real known citation in this fixture");
  const item = "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.";
  const signals = baseSignals({
    budget: "$75,000",
    evidenceTie: "supported by [R999]",
  });
  const result = classifyStrategicRecommendationAction({ item, signals, canonicalState });
  assert.equal(result.numericBasis, "planning_assumption");
});

test("REGRESSION: an action with no numeric budget/KPI/timeline at all is neither evidence-tied nor a planning assumption -- 'none'", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Interview procurement stakeholders to understand the buying process.";
  const result = classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState });
  assert.equal(result.numericBasis, "none");
});

// --- UI/PDF consistency and canonical-decision preservation -------------

test("REGRESSION: web (page.tsx / Planner.tsx) and PDF (ReportPdfButton.tsx / Planner.tsx PDF) classify the exact same card identically, since all 4 call the same pure function with the same inputs", () => {
  const canonicalState = canonicalStateFor("NO_GO", { confidence: 10 });
  const item = "Launch nationally across all 50 states and hire a team of 20 sales reps immediately.";
  const signals = baseSignals({ budget: "$500,000" });

  const webResult = classifyStrategicRecommendationAction({ item, signals, canonicalState, language: "English" });
  const pdfResult = classifyStrategicRecommendationAction({ item, signals, canonicalState, language: "English" });

  assert.deepEqual(webResult, pdfResult);
});

test("REGRESSION: classification never mutates or contradicts the canonical decision itself -- it only reclassifies the ACTION, the decision/confidence stay exactly as canonical state states", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 50 });
  const item = "Scale up marketing spend to capture the full addressable market this quarter.";
  classifyStrategicRecommendationAction({ item, signals: baseSignals(), canonicalState });

  assert.equal(canonicalState.decision, "CONDITIONAL_GO");
  assert.equal(canonicalState.confidence, 50);
});

// --- Real persisted report (171cf10d-538a-4ad3-9ed9-b30e85914e85) -------
// --- verbatim strategicRecommendations content, used throughout Tasks ---
// --- #29-#30: MONITOR / 50% confidence / SOM unresolved ------------------

const REAL_STRATEGIC_RECOMMENDATIONS_CONTENT =
  "Decision: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.\n" +
  "Rationale: growing U.S.\n" +
  "CLM market with AI tailwinds ([Estimated] USD 1.5B baseline) but high incumbent strength and missing obtainable-share evidence create execution risk [R21][R4][R5][R3].\n" +
  "First 90 Days (three concrete actions): 1) Account Validation Sprint — Owner: Head of Sales; Budget ceiling: $75,000; Geography/segment: U.S.\n" +
  "mid-market (250–2,500 employees) manufacturing and tech; KPI: 50 target accounts contacted; Success criterion: ≥6 signed paid trials (pilot contracts) within 90 days.\n" +
  "Evidence to collect: signed SOWs and pilot KPIs.\n" +
  "2) Pricing & Procurement Discovery — Owner: Head of BD/Govt Contracts; Budget ceiling: $20,000; Target: 3 state procurement offices or GSA discussions; KPI: documented realized per-user/module pricing and procurement terms within 60 days; Success criterion: at least one comparable public price schedule or procurement pathway secured.\n" +
  "3) Integration Pilot Build — Owner: Head of Product; Budget ceiling: $150,000; Scope: one pre-integrated connector (Salesforce + DocuSign) for pilot accounts; KPI: pilot shows ≥30% contract-processing time reduction and legal sign-off on output accuracy within 120 days.\n" +
  "If all three succeed, recommend phased entry; if SOM evidence remains absent or pilot conversion <20%, pause.\n" +
  "Evidence cited: [R21][R3][R4][R5][R2].\n" +
  "Market Entry Recommendation\n" +
  "- Why: Cost/productivity pressure to reduce external legal spend and speed contracts — vendor TCO claims and buyer guides support strong demand [R37][R22].\n" +
  "- Where: Requested geography is the United States (primary).\n" +
  "- When: after closing the highest-impact validation gap identified above.\n" +
  "- How: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.";

test("REAL PERSISTED REPORT (171cf10d-538a-4ad3-9ed9-b30e85914e85): none of this MONITOR report's real First-90-Days actions classify as an unconditional scale action", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", {
    confidence: 50,
    topRisks: ["Incumbent concentration", "Missing obtainable-share evidence"],
  });
  const items = extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);
  assert.equal(items.length, 6, `expected exactly 6 items, got ${items.length}`);

  const actionItems = items.slice(2, 5); // Account Validation Sprint, Pricing & Procurement Discovery, Integration Pilot Build
  for (const item of actionItems) {
    const signals = extractRecommendationSignals(item);
    const classification = classifyStrategicRecommendationAction({ item, signals, canonicalState });
    assert.notEqual(classification.actionType, "scale", `unexpected scale classification for: ${item}`);
  }
});

// TASK #33 -- confirmed live: Action 1's "signed SOWs and pilot KPIs" is
// FUTURE evidence to be collected, not a citation to anything that
// exists -- it names no [R#] at all, so it can never resolve against
// the canonical source registry. Both actions now correctly read as
// planning assumptions; see tests/task33-source-provenance-authoritative.test.mjs
// for the corresponding genuine-citation positive case.
test("REAL PERSISTED REPORT: Action 1's descriptive (non-citation) evidence tie and Action 3's untied $150,000 budget/120-day KPI are BOTH marked planning assumptions -- neither is a real citation", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 50 });
  const items = extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);

  const action1Signals = extractRecommendationSignals(items[2]);
  assert.equal(action1Signals.evidenceTie, "signed SOWs and pilot KPIs");
  const action1Classification = classifyStrategicRecommendationAction({ item: items[2], signals: action1Signals, canonicalState });
  assert.equal(action1Classification.numericBasis, "planning_assumption");

  const action3Signals = extractRecommendationSignals(items[4]);
  assert.equal(action3Signals.evidenceTie, "", "Action 3 names no evidence tie in the real report");
  assert.equal(action3Signals.budget, "$150,000");
  const action3Classification = classifyStrategicRecommendationAction({ item: items[4], signals: action3Signals, canonicalState });
  assert.equal(action3Classification.numericBasis, "planning_assumption");
});

test("REAL PERSISTED REPORT: Action 3 ('Integration Pilot Build') classifies as a pilot action and is not downgraded, since a bounded pilot is appropriate under MONITOR", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 50 });
  const items = extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);
  const action3Signals = extractRecommendationSignals(items[4]);
  const classification = classifyStrategicRecommendationAction({ item: items[4], signals: action3Signals, canonicalState });

  assert.equal(classification.actionType, "pilot");
  assert.equal(classification.wasDowngraded, false);
});

test("REAL PERSISTED REPORT: canonical decision (CONDITIONAL_GO / MONITOR, confidence 50) is completely unaffected by this task's classification layer", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 50 });
  const items = extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);
  for (const item of items.slice(2, 5)) {
    const signals = extractRecommendationSignals(item);
    classifyStrategicRecommendationAction({ item, signals, canonicalState });
  }

  assert.equal(canonicalState.decision, "CONDITIONAL_GO");
  assert.equal(canonicalState.confidence, 50);
});
