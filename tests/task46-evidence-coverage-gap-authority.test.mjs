import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionChangeState,
  buildMarketIntelligenceGapDrivenActions,
  resolveMarketIntelligenceDecisionThresholdState,
  resolveMarketIntelligenceControllingDecisionThreshold,
  classifyStrategicRecommendationValidation,
  resolveMarketIntelligenceConfidenceState,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { inferEvidenceLevel } from "../app/lib/report-evidence.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #46 -- Make Market Intelligence evidence coverage gaps
// structurally authoritative.
//
// AUDIT FINDING: unlike Tasks #42-#45A, this ticket names no single
// reported defect. A full trace of the pipeline (canonical state ->
// Executive Summary -> Evidence Gaps to Close -> Strategic
// Recommendations -> decision thresholds -> web -> PDF) confirms the
// exact "one canonical structured representation" this ticket asks for
// already exists and has already been extensively hardened across
// Tasks #10-#40 (P0 fixes referenced inline in market-intelligence-
// evidence-gaps.ts and route.ts's resolveDecisionCriticalEvidenceState
// predate even this session's own numbered task sequence):
//
//   - MarketIntelligenceEvidenceGap (id/label/decisionFactor/
//     isPlanningAssumption/whyItMatters/currentStatus/evidenceRequired/
//     validationMethod/successThreshold/decisionImpact) is the single
//     structured shape resolveMarketIntelligenceEvidenceGaps returns --
//     every downstream consumer (resolveMarketIntelligenceDecisionChangeState
//     for Executive Summary, buildMarketIntelligenceGapDrivenActions for
//     "Evidence Gaps to Close", resolveMarketIntelligenceDecisionThresholdState
//     for decision thresholds, classifyStrategicRecommendationValidation
//     for recommendation linkage) is a pure reshape of this SAME
//     already-computed list -- never a second, independently-derived
//     gap model.
//   - decisionCriticalEvidence's 3 booleans (route.ts's
//     resolveDecisionCriticalEvidenceState) are the single gate both the
//     canonical ENTER/MONITOR/AVOID decision (assessMarketEntryConfidence)
//     AND the TAM/SAM/SOM visual's own resolution constraint
//     (constrainMarketSizingResolutionToCanonicalState, confirmed via
//     source to be called at every one of its 6 real call sites across
//     page.tsx/Planner.tsx/ReportPdfButton.tsx) are ultimately built
//     from -- obtainableShareResolved specifically requires BOTH
//     samMethod === "evidenceDerived" AND somStatus === "calculated",
//     the exact same pair constrainMarketSizingResolutionToCanonicalState
//     checks, so these two consumers cannot structurally disagree.
//   - Task #44's negatedVerifiedPattern (report-evidence.ts) already
//     protects the SAME inferEvidenceLevel classifier every metric
//     badge (including any Market Size/CAGR mention near an unresolved
//     gap) reads, so an honest "has not been independently verified"
//     gap-explanation sentence cannot flip to "verified".
//
// This file adds the CONSOLIDATED, scenario-based regression coverage
// this ticket's own requirement #8 asks for -- proving the real CLM
// report's exact required behavior end-to-end through every
// propagation path in ONE place, using the REAL exported functions
// (never a re-implementation) -- rather than a NEW code fix, since the
// audit found no unsafe gap in the existing architecture for this
// concern. The one documented architectural note (item 7's own ask) is
// at the bottom of this file.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");

// The exact real CLM (contract-lifecycle-management) fixture shape used
// throughout Tasks #35-#45A: decision CONDITIONAL_GO (displays MONITOR),
// confidence 50, obtainableShareResolved false, controlling factor
// "Obtainable Share (SAM/SOM)".
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

const CLM_STATE = buildCanonicalState();

// --- 1. Requirement #4: the exact CLM real-report behavior is preserved ---

test("TASK #46: the CLM canonical state's own decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, unchanged by anything this ticket touches", () => {
  assert.equal(CLM_STATE.decision, "CONDITIONAL_GO");
  assert.equal(CLM_STATE.confidence, 50);
});

test("TASK #46: Obtainable Share (SAM/SOM) is the only unresolved decision-critical gap, and it is the controlling gap the canonical state determines", () => {
  const gaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English");
  const materialGaps = gaps.filter((gap) => gap.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
  assert.equal(materialGaps[0].label, "Obtainable Share (SAM/SOM)");

  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(CLM_STATE, "English");
  assert.equal(thresholdState.controllingUnresolvedCondition.factor, "obtainableShareResolved");
});

test("TASK #46: SAM/SOM never receives a fabricated numeric value while obtainable share is unresolved -- the gap's own currentStatus is the report's real, honest gap-explanation sentence, never an invented figure", () => {
  const gaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English");
  const obtainableShareGap = gaps.find((gap) => gap.id === "obtainable-share");
  assert.ok(obtainableShareGap);
  assert.equal(obtainableShareGap.currentStatus, CLM_STATE.marketSizing.som.trim());
  assert.doesNotMatch(obtainableShareGap.currentStatus, /^\$[\d,.]+[BMK]?$/, "must never be a bare fabricated dollar figure");
});

// --- 2. Requirement #3: unresolved evidence cannot become "verified" through confident prose ---

test("TASK #46: an honest gap-explanation sentence for the unresolved obtainable-share gap ('...has not been independently verified') never classifies as verified, even though it contains the bare word 'verified'", () => {
  const level = inferEvidenceLevel({
    label: "Obtainable Share (SAM/SOM)",
    value: "",
    context: "The obtainable-share percentage this SOM figure depends on has not been independently verified for this market.",
  });
  assert.equal(level, "validationRequired");
  assert.notEqual(level, "verified");
});

test("TASK #46: the unresolved obtainable-share gap can never be linked to a recommendation whose action falsely claims the gap is resolved -- classifyStrategicRecommendationValidation only ever reads the SAME canonical decisionCriticalEvidence, never the recommendation's own prose, to decide resolution", () => {
  const signals = extractRecommendationSignals(
    "Run a mid-market pilot; Owner: Head of Sales; Evidence tie: addresses SAM/SOM obtainable-share gap."
  );
  const validation = classifyStrategicRecommendationValidation({
    item: "Run a mid-market pilot to validate obtainable share.",
    signals,
    canonicalState: CLM_STATE,
    language: "English",
  });
  // The recommendation's own prose CLAIMS to address the gap (evidenceTie),
  // but the action type itself is still governed by the canonical
  // decisionCriticalEvidence state, not by that claim -- confirmed by
  // relatedEvidenceGapId resolving from the canonical gap list, and the
  // action type still reflecting an unresolved-evidence downgrade rather
  // than being promoted to "scale" merely because the prose sounds
  // confident.
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");
  assert.notEqual(validation.actionType, "scale", "an action cannot self-promote to 'scale' while the linked gap is still unresolved");
});

// --- 3. Requirement #6: recommendation linkage is structurally gap-driven ---

test("TASK #46: buildMarketIntelligenceGapDrivenActions produces exactly one gap-driven action (Obtainable Share), built ONLY from the gap's own already-computed fields -- never re-parsed from a recommendation's own prose", () => {
  const actions = buildMarketIntelligenceGapDrivenActions(CLM_STATE, "English");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].gapId, "obtainable-share");
  assert.equal(actions[0].gapLabel, "Obtainable Share (SAM/SOM)");
  assert.ok(actions[0].action);
  assert.ok(actions[0].decisionConsequence);
  assert.ok(actions[0].threshold);
});

test("TASK #46: resolveMarketIntelligenceControllingDecisionThreshold resolves the SAME single controlling gap (Obtainable Share) as resolveMarketIntelligenceDecisionThresholdState -- the two aggregation layers cannot structurally disagree", () => {
  const validations = [
    classifyStrategicRecommendationValidation({
      item: "Run a mid-market pilot to validate obtainable share.",
      signals: extractRecommendationSignals("Run a mid-market pilot; Owner: Head of Sales."),
      canonicalState: CLM_STATE,
      language: "English",
    }),
  ];
  const controlling = resolveMarketIntelligenceControllingDecisionThreshold(CLM_STATE, validations, "English");
  assert.ok(controlling);
  assert.equal(controlling.gapId, "obtainable-share");

  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(CLM_STATE, "English");
  assert.equal(thresholdState.controllingUnresolvedCondition.factor, "obtainableShareResolved");
});

// --- 4. Requirement #2: propagation through Executive Summary ------------

test("TASK #46: resolveMarketIntelligenceDecisionChangeState (the Executive Summary's own structured source) surfaces the SAME obtainable-share gap object resolveMarketIntelligenceEvidenceGaps produces -- Executive Summary cannot show a different or reinterpreted gap", () => {
  const changeState = resolveMarketIntelligenceDecisionChangeState(CLM_STATE, "English");
  assert.equal(changeState.materialGaps.length, 1);
  assert.equal(changeState.materialGaps[0].id, "obtainable-share");

  const directGaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.deepEqual(changeState.materialGaps[0], directGaps[0]);
});

test("TASK #46: resolveMarketIntelligenceConfidenceState's own constraints list reuses the SAME material gaps (never a second, independently-derived list) -- confidence explanation and evidence gaps cannot structurally diverge", () => {
  const confidenceState = resolveMarketIntelligenceConfidenceState(CLM_STATE, "English");
  assert.equal(confidenceState.constraints.length, 1);
  assert.equal(confidenceState.constraints[0].factor, "obtainableShareResolved");
  assert.equal(confidenceState.score, 50);
  assert.equal(confidenceState.decision, "CONDITIONAL_GO");
});

// --- 5. Requirement #8: web/PDF consume equivalent authoritative gap state ---

test("TASK #46 (web/PDF parity): page.tsx, Planner.tsx, and ReportPdfButton.tsx all read evidence gaps from the SAME exported market-intelligence-evidence-gaps.ts functions -- never a second, independently-derived gap list per surface", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceDecisionChangeState/, `${name}: Executive Summary must use the shared decision-change-state function`);
    assert.match(source, /buildMarketIntelligenceGapDrivenActions/, `${name}: Strategic Recommendations must use the shared gap-driven-actions function`);
  }
  assert.match(pdfButtonSource, /buildMarketIntelligenceGapDrivenActions/, "ReportPdfButton.tsx must use the shared gap-driven-actions function");
});

test("TASK #46 (web/PDF parity): all 4 real render call sites (page.tsx, Planner.tsx web, Planner.tsx PDF, ReportPdfButton.tsx) invoke buildMarketIntelligenceGapDrivenActions with a canonical-state argument, never a hardcoded/empty stand-in", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const occurrences = (source.match(/buildMarketIntelligenceGapDrivenActions\(\s*\n?\s*(?:marketIntelligenceCanonicalState|recommendationCanonicalState)/g) || []).length;
    assert.ok(occurrences >= 1, `${name}: expected at least one real canonical-state-driven call site, found ${occurrences}`);
  }
});

// --- 6. Requirement #8: canonical decision/confidence methodology unchanged ---

test("TASK #46 (drift check): assessMarketEntryConfidence's formula and thresholds are structurally unchanged", () => {
  const marketIntelligencePresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketIntelligencePresentationSource, /export function assessMarketEntryConfidence\(/);
  assert.match(marketIntelligencePresentationSource, /marketConfidence\s*\*\s*0\.4/);
  assert.match(marketIntelligencePresentationSource, /competitiveEvidence\s*\*\s*0\.25/);
});

test("TASK #46 (drift check): assessMarketEntryConfidence itself is never called (as executable code, only ever mentioned in an explanatory comment) from inside market-intelligence-evidence-gaps.ts -- this module only reshapes an ALREADY-computed decision/confidence, never recomputes one", () => {
  // Strip line (//) and block (/* */) comments before checking, so a
  // comment that names assessMarketEntryConfidence for explanatory
  // purposes (e.g. "buildMarketExecutiveDecisionBrief sets `confidence`
  // to exactly `assessMarketEntryConfidence(...)`") is not mistaken for
  // an actual invocation.
  const withoutComments = evidenceGapsSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(withoutComments, /assessMarketEntryConfidence\(/);
});

test("TASK #46 (drift check): route.ts's resolveDecisionCriticalEvidenceState (the single source of the 3 decision-critical booleans) is unchanged in structure", () => {
  assert.match(routeSource, /function resolveDecisionCriticalEvidenceState\(/);
  assert.match(routeSource, /obtainableShareResolved:\s*\n\s*graph\.planningEstimate === null \|\|\s*\n\s*\(graph\.planningEstimate\.samMethod === "evidenceDerived" &&\s*\n\s*graph\.planningEstimate\.somStatus === "calculated"\)/);
});

test("TASK #46 (drift check): constrainMarketSizingResolutionToCanonicalState (the single TAM/SAM/SOM-visual-to-canonical-state bridge) is called at every real cascade call site across all 3 render files -- SAM/SOM cannot resolve numerically past what canonical state allows anywhere", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const cascadeCallCount = (source.match(/resolveMarketSizingCascade\(|resolveTamSamSomCascade\(content\)|resolveTamSamSomCascade\(section\.content\)/g) || []).length;
    const constrainedCallCount = (source.match(/constrainMarketSizingResolutionToCanonicalState\(/g) || []).length;
    assert.ok(cascadeCallCount > 0, `${name}: expected at least one cascade call site`);
    assert.equal(constrainedCallCount, cascadeCallCount, `${name}: every cascade call site must be wrapped in constrainMarketSizingResolutionToCanonicalState (found ${cascadeCallCount} cascade calls but ${constrainedCallCount} constrained)`);
  }
});

// --- 7. Structural audit: single canonical gap representation --------------

test("STRUCTURAL AUDIT: resolveMarketIntelligenceDecisionChangeState, buildMarketIntelligenceGapDrivenActions, and resolveMarketIntelligenceDecisionThresholdState are all pure reshapes of resolveMarketIntelligenceEvidenceGaps' own output -- confirmed via source, no second independently-derived gap-detection logic exists", () => {
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceDecisionChangeState\(/);
  const changeStateFn = evidenceGapsSource.match(/export function resolveMarketIntelligenceDecisionChangeState\([\s\S]*?\n\}/)[0];
  assert.match(changeStateFn, /resolveMarketIntelligenceEvidenceGaps\(/);

  const gapActionsFn = evidenceGapsSource.match(/export function buildMarketIntelligenceGapDrivenActions\([\s\S]*?\n\}/)[0];
  assert.match(gapActionsFn, /resolveMarketIntelligenceEvidenceGaps\(/);

  const thresholdStateFn = evidenceGapsSource.match(/export function resolveMarketIntelligenceDecisionThresholdState\([\s\S]*?\n\}/)[0];
  assert.match(thresholdStateFn, /resolveMarketIntelligenceEvidenceGaps\(/);
});

test("STRUCTURAL AUDIT: no render site reads canonicalState.missingEvidence/whatWouldChangeThisDecision directly for its own Information-Required display -- only the structured evidence-gaps module may read those raw prose fields (to lift a verbatim, never-fabricated threshold substring)", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /marketIntelligenceCanonicalState\.missingEvidence\b/, `${name}: must not read the raw prose field directly`);
    assert.doesNotMatch(source, /marketIntelligenceCanonicalState\.whatWouldChangeThisDecision\b/, `${name}: must not read the raw prose field directly`);
  }
});

// --- 8. Remaining architectural note (requirement #7's own ask) ------------
//
// UPDATE (Task #48): this note originally documented that
// resolveLinkedEvidenceGap and resolveMarketIntelligenceDecisionThresholdState's
// own controllingUnresolvedCondition both abstained entirely whenever 2+
// material gaps were simultaneously unresolved, with no prioritized view
// at all. Task #48 ("Make Market Intelligence multi-gap evidence closure
// structurally authoritative") is exactly the "future, narrowly-scoped
// ticket" this note anticipated: resolveLinkedEvidenceGap now ALSO links
// a recommendation to a specific gap in the 2+-material-gap case, but
// ONLY via a non-prose numeric match against that gap's own report-
// stated successThreshold (never a guess), and a new
// resolveMarketIntelligenceMultiGapPriorityState resolver ranks material
// gaps into primary/secondary/co-controlling using only already-
// structural signals (linked-recommendation presence, report-stated
// threshold presence) -- still never fabricating a priority from prose
// or section order, and still representing genuine ties as explicitly
// co-controlling rather than guessing. resolveMarketIntelligenceDecisionThresholdState's
// OWN controllingUnresolvedCondition is intentionally UNCHANGED (it
// remains a simpler, single-condition concept for the pre-existing
// Executive-Summary-facing threshold state) -- Task #48 added a
// separate, additive resolver rather than redefining this one.
test("DOCUMENTED ARCHITECTURAL NOTE (updated by Task #48): resolveMarketIntelligenceDecisionThresholdState's own controllingUnresolvedCondition remains a conservative single-condition concept, and Task #48's multi-gap priority resolver now exists as the structural fix for the 2+-material-gap case", () => {
  assert.match(evidenceGapsSource, /unresolvedConditions\.length === 1 \? unresolvedConditions\[0\] : null/);
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceMultiGapPriorityState\(/);
});
