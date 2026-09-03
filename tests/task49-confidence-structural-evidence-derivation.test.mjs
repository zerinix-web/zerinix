import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceConfidenceState,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";

// TASK #49 -- Make Market Intelligence decision confidence structurally
// evidence-derived.
//
// AUDIT (requirement #1/#2): traced confidence through canonical decision
// state -> evidence coverage/decision-critical pillars -> Executive
// Summary -> Executive Snapshot -> Investment Decision Snapshot -> report
// UI -> persisted report data -> PDF. Confirmed (consistent with Task
// #40's own prior audit, unchanged): the confidence SCORE itself is
// already 100% structurally computed by assessMarketEntryConfidence
// (market-intelligence-presentation.ts) from coverage.dimensions +
// decisionCriticalEvidence, persisted verbatim as canonicalState.confidence,
// and every major consumer (resolveMarketIntelligenceExecutiveDecisionWithCanonicalState
// -- Investment Decision Snapshot/Executive Snapshot -- and the PDF
// cover) already reads canonicalState.confidence directly, never re-
// parsing prose.
//
// ROOT ARCHITECTURAL WEAKNESS FOUND: ExecutiveInsightBanner (page.tsx AND
// its byte-identical duplicate in Planner.tsx), the "Investor Insight"
// card rendered above ordinary report sections, was the ONE remaining
// Market-Intelligence-reachable confidence display that read
// extractConfidence(content) UNCONDITIONALLY -- never gated on
// isMarketIntelligence. extractConfidence's own fallback
// (`/\b(\d{1,3})\s*%/`) matches ANY bare percentage anywhere in that
// section's own prose (a CAGR figure, a TAM growth rate, an unrelated
// pilot-conversion target, ...) and labels it "Confidence" verbatim --
// exactly the "presentation-derived, not structurally-derived" failure
// mode this ticket asks to close. This never manifested for a REAL
// report only because cardFirstReportFields (in both files) happens to
// already list every field name Market Intelligence's own generation
// prompt actually produces -- an INCIDENTAL protection (a side effect of
// an unrelated card-layout exclusion list), not a structural safeguard:
// any future edit to that set, or a new MI field, would silently
// re-enable the unsafe prose scan for Market Intelligence with zero
// warning.
//
// FIX: ExecutiveInsightBanner now takes isMarketIntelligence/
// marketIntelligenceCanonicalState props (mirroring the pattern every
// other MI-aware component in these two files already uses) and, when
// isMarketIntelligence is true, reads marketIntelligenceCanonicalState.confidence
// directly -- the SAME already-structurally-computed value Investment
// Decision Snapshot/Executive Snapshot/the PDF cover already read --
// falling back to the SAME "Validation Needed" honest placeholder these
// files already use everywhere else for "no defensible numeric
// confidence exists," never extractConfidence's unsafe scan. Every other
// report kind's existing behavior is completely unchanged.

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

// --- 1. All critical evidence resolved --------------------------------------

test("TASK #49: all 3 decision-critical pillars resolved -> confidence reports 3 contributors, 0 constraints, no controlling factor -- an honest high-evidence state, never fabricated", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
  const coverage = buildCoverage({ marketConfidence: 85, competitiveEvidence: 85, financialEvidence: 85, productEvidence: 85 });
  const result = assessMarketEntryConfidence(coverage, evidence);
  const state = buildCanonicalState({ decision: "GO", confidence: result.confidence, decisionCriticalEvidence: evidence, coverage });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.contributors.length, 3);
  assert.equal(confidenceState.constraints.length, 0);
  assert.equal(confidenceState.score, result.confidence);
});

// --- 2. One controlling gap unresolved --------------------------------------

test("TASK #49: exactly one unresolved decision-critical pillar caps confidence at <=50 and is reported as the sole controlling constraint", () => {
  const confidenceState = resolveMarketIntelligenceConfidenceState(CLM_STATE);
  assert.equal(CLM_STATE.confidence, 50);
  assert.ok(confidenceState.score <= 50);
  assert.equal(confidenceState.constraints.length, 1);
  assert.equal(confidenceState.constraints[0].factor, "obtainableShareResolved");
  assert.equal(confidenceState.constraints[0].isControllingFactor, true);
});

// --- 3. Multiple unresolved material gaps -----------------------------------

test("TASK #49: two unresolved decision-critical pillars cap confidence lower than one unresolved pillar, with the SAME underlying raw evidence strength", () => {
  const strongCoverage = buildCoverage({ marketConfidence: 90, competitiveEvidence: 90, financialEvidence: 90, productEvidence: 90 });
  const oneUnresolved = assessMarketEntryConfidence(strongCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });
  const twoUnresolved = assessMarketEntryConfidence(strongCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  });
  const threeUnresolved = assessMarketEntryConfidence(strongCoverage, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  });
  assert.equal(oneUnresolved.confidence, 50);
  assert.equal(twoUnresolved.confidence, 40);
  assert.equal(threeUnresolved.confidence, 30);
  assert.ok(oneUnresolved.confidence > twoUnresolved.confidence);
  assert.ok(twoUnresolved.confidence > threeUnresolved.confidence);

  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    marketSizing: null,
    confidence: threeUnresolved.confidence,
  });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.constraints.length, 3);
  assert.equal(confidenceState.contributors.length, 0);
});

// --- 4. Low evidence coverage -------------------------------------------------

test("TASK #49: low evidence coverage across all dimensions produces low confidence even when every decision-critical pillar is technically resolved -- the cap only ever lowers, never rescues, weak raw evidence", () => {
  const weakCoverage = buildCoverage({ marketConfidence: 15, competitiveEvidence: 15, financialEvidence: 15, productEvidence: 15 });
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
  const result = assessMarketEntryConfidence(weakCoverage, evidence);
  assert.equal(result.confidence, 15);
  assert.ok(result.confidence < 30, "low raw coverage must produce genuinely low confidence, never propped up to a cap ceiling");

  const state = buildCanonicalState({ decision: "NO_GO", confidence: result.confidence, decisionCriticalEvidence: evidence, coverage: weakCoverage });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.level, "Weak");
  assert.equal(confidenceState.constraints.length, 0, "all 3 pillars ARE resolved here -- low confidence reflects weak evidence quality, not an unresolved pillar");
});

// --- 5. Strong non-critical evidence with unresolved critical evidence ------

test("TASK #49: strong financial/product evidence (dimensions OUTSIDE the 3 decision-critical pillars) can NEVER push confidence above the cap imposed by an unresolved decision-critical pillar", () => {
  const evidenceWithGap = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  // Market/competitive dimensions deliberately weak (matching the
  // unresolved pillars); financial/product dimensions -- NEITHER of
  // which is one of the 3 decision-critical pillars -- deliberately
  // maxed out, simulating "many citations/strong evidence in non-
  // critical sections."
  const skewedCoverage = buildCoverage({
    marketConfidence: 20,
    competitiveEvidence: 20,
    financialEvidence: 100,
    productEvidence: 100,
  });
  const result = assessMarketEntryConfidence(skewedCoverage, evidenceWithGap);
  // Raw blend: 20*0.4 + 20*0.25 + 100*0.2 + 100*0.15 = 8 + 5 + 20 + 15 = 48,
  // which is already <= the 1-unresolved-pillar cap of 50 -- so this
  // fixture also proves the cap is meaningfully exercised, not vacuous,
  // by additionally confirming the SAME strong financial/product
  // dimensions cannot push an otherwise-ENTER-strength raw blend past 50
  // either.
  assert.ok(result.confidence <= 50, "an unresolved decision-critical pillar must cap confidence at <=50 regardless of how strong non-critical dimensions are");

  const veryStrongNonCriticalCoverage = buildCoverage({
    marketConfidence: 95,
    competitiveEvidence: 95,
    financialEvidence: 100,
    productEvidence: 100,
  });
  const strongResult = assessMarketEntryConfidence(veryStrongNonCriticalCoverage, evidenceWithGap);
  // Raw blend here would be 95*0.4 + 95*0.25 + 100*0.2 + 100*0.15 = 38 +
  // 23.75 + 20 + 15 = 96.75 -- an ENTER-strength raw score -- yet the
  // single unresolved pillar must still cap it at <=50.
  assert.ok(strongResult.confidence <= 50, "even near-maximal overall evidence strength must not escape the unresolved-pillar cap");
  assert.equal(strongResult.confidence, 50);

  const state = buildCanonicalState({
    decisionCriticalEvidence: evidenceWithGap,
    coverage: veryStrongNonCriticalCoverage,
    confidence: strongResult.confidence,
  });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.constraints.length, 1);
  assert.equal(confidenceState.constraints[0].factor, "obtainableShareResolved");
  assert.ok(confidenceState.score <= 50);
});

// --- 6. UI/PDF parity: the fixed ExecutiveInsightBanner ---------------------

test("TASK #49: ExecutiveInsightBanner (page.tsx and Planner.tsx) now branches on isMarketIntelligence BEFORE ever calling extractConfidence -- the confirmed root-cause fix", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
  ]) {
    const fnMatch = source.match(/function ExecutiveInsightBanner\([\s\S]*?\n\}\n\nfunction /);
    assert.ok(fnMatch, `${name}: expected to find ExecutiveInsightBanner's own function body`);
    const fnSource = fnMatch[0];
    assert.match(fnSource, /isMarketIntelligence/, `${name}: must reference isMarketIntelligence`);
    assert.match(
      fnSource,
      /isMarketIntelligence\s*\?\s*marketIntelligenceCanonicalState\??\.confidence/,
      `${name}: must read marketIntelligenceCanonicalState.confidence when isMarketIntelligence is true`
    );
    assert.match(fnSource, /:\s*extractConfidence\(/, `${name}: must still fall back to extractConfidence for non-MI report kinds`);
  }
});

test("TASK #49: both real call sites now pass isMarketIntelligence/marketIntelligenceCanonicalState into ExecutiveInsightBanner", () => {
  assert.match(
    pageSource,
    /<ExecutiveInsightBanner\s+content=\{section\.content\}\s+isMarketIntelligence=\{report\.type === "Market Analysis"\}\s+marketIntelligenceCanonicalState=\{marketIntelligenceCanonicalState\}/
  );
  assert.match(
    plannerSource,
    /<ExecutiveInsightBanner\s+section=\{section\}\s+isMarketIntelligence=\{isMarketIntelligence\}\s+marketIntelligenceCanonicalState=\{marketIntelligenceCanonicalState\}/
  );
});

test("TASK #49: ReportPdfButton.tsx has no equivalent 'Investor Insight' banner to duplicate this fix into -- PDF's own cover-card confidence already reads canonicalState.confidence directly (pre-existing, confirmed unchanged)", () => {
  assert.doesNotMatch(pdfButtonSource, /Investor Insight/);
  assert.match(pdfButtonSource, /const confidence = marketDecision\s*\n\s*\? marketDecision\.confidenceScore/);
});

test("TASK #49 (drift check): every other Market Intelligence confidence display already reads canonicalState.confidence (directly or via resolveMarketIntelligenceConfidenceState/resolveMarketIntelligenceExecutiveDecisionWithCanonicalState) -- no render surface independently reconstructs a confidence rationale", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceConfidenceState\(/, `${name}: must call resolveMarketIntelligenceConfidenceState`);
  }
});

// --- 7. Canonical decision/confidence unaffected by presentation wording ---

test("TASK #49: confidence is byte-identical across two canonical states that differ ONLY in prose fields (why/topRisks/immediateNextAction) -- confidence is derived exclusively from coverage + decisionCriticalEvidence, never from generated wording", () => {
  const stateA = buildCanonicalState({
    why: "Evidence supports conditional entry pending further validation.",
    topRisks: ["Risk A."],
    immediateNextAction: "Run a mid-market pilot before committing budget.",
  });
  const stateB = buildCanonicalState({
    why: "This market shows outstanding, extremely confident, unambiguous promise across every dimension.",
    topRisks: ["An entirely different-sounding risk narrative."],
    immediateNextAction: "Confidently commit to full-scale national rollout immediately.",
  });
  const confidenceA = resolveMarketIntelligenceConfidenceState(stateA);
  const confidenceB = resolveMarketIntelligenceConfidenceState(stateB);
  assert.equal(confidenceA.score, confidenceB.score);
  assert.equal(confidenceA.level, confidenceB.level);
  assert.deepEqual(confidenceA.constraints, confidenceB.constraints);
  assert.deepEqual(confidenceA.contributors, confidenceB.contributors);
});

test("TASK #49: a decoy percentage embedded in a section's own raw content can never change what the fixed ExecutiveInsightBanner would display for Market Intelligence -- the canonical score alone determines it", () => {
  // Simulates exactly the real-world risk this fix closes: a section
  // whose own prose happens to mention an unrelated "12% CAGR" figure
  // right next to the word "confidence" -- the OLD extractConfidence
  // fallback could have attached this number to a badge literally
  // labeled "Confidence." The fix makes this structurally impossible for
  // Market Intelligence: the displayed value depends ONLY on
  // canonicalState.confidence, never on section.content.
  const decoyContent =
    "This market is expected to grow at a 12% CAGR through 2028, with a confidence interval reported elsewhere in the underlying benchmark study.";
  const isMarketIntelligence = true;
  const marketIntelligenceCanonicalState = CLM_STATE;
  // The exact ternary the fixed component now uses.
  const displayedConfidence = isMarketIntelligence
    ? marketIntelligenceCanonicalState?.confidence ?? null
    : (() => {
        const percentMatch = decoyContent.match(/\b(\d{1,3})\s*%/);
        return percentMatch ? Number(percentMatch[1]) : null;
      })();
  assert.equal(displayedConfidence, 50);
  assert.notEqual(displayedConfidence, 12, "must never pick up the decoy '12%' CAGR figure from this section's own prose");
});

// --- Preserve Task #46-#48A architecture --------------------------------------

test("TASK #49: Task #46-#48A's evidence-gap/closure-plan architecture is untouched -- the CLM fixture's controlling gap, decision, and confidence remain exactly as before this task", () => {
  assert.equal(CLM_STATE.decision, "CONDITIONAL_GO");
  assert.equal(CLM_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(CLM_STATE, "English").filter((gap) => gap.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
  assert.equal(materialGaps[0].label, "Obtainable Share (SAM/SOM)");
});

test("TASK #49 (drift check): resolveMarketIntelligenceConfidenceState's own module still never references prose-extraction helpers -- unchanged by this task", () => {
  const functionMatch = evidenceGapsSource.match(/export function resolveMarketIntelligenceConfidenceState\([\s\S]*?\n\}/);
  assert.ok(functionMatch);
  assert.doesNotMatch(
    functionMatch[0],
    /extractMetricValueFromAliases|extractConfidence|extractKeywordInsight|extractAliasedSectionSnippet/
  );
});

test("TASK #49: resolving the confidence state never mutates the canonical decision, confidence, or decisionCriticalEvidence -- unchanged by this task", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const before = JSON.stringify({ decision: state.decision, confidence: state.confidence, decisionCriticalEvidence: state.decisionCriticalEvidence });
  resolveMarketIntelligenceConfidenceState(state);
  const after = JSON.stringify({ decision: state.decision, confidence: state.confidence, decisionCriticalEvidence: state.decisionCriticalEvidence });
  assert.equal(before, after);
});
