import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceConfidenceState,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";

// TASK #40 -- Make Market Intelligence confidence scoring structurally
// authoritative and explainable.
//
// AUDIT FINDING: the confidence SCORE was already 100% structurally
// computed (assessMarketEntryConfidence, market-intelligence-presentation.ts)
// -- never AI-generated or prose-inferred. This module does not change,
// or duplicate, that calculation; resolveMarketIntelligenceConfidenceState
// only adds a structured, reproducible EXPLANATION layer (contributors/
// constraints/rationale) on top of the SAME already-persisted score and
// decisionCriticalEvidence pillars.
//
// These tests verify: reproducibility from persisted structured state,
// no duplicate penalties, web/PDF parity, historical-report fallback,
// and that MONITOR/AVOID confidence is never a hardcoded constant.

const readSourceFile = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");
const evidenceGapsSource = readSourceFile("../app/lib/report-engine/market-intelligence-evidence-gaps.ts");

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

// --- Identical structured state -> identical confidence ---

test("resolveMarketIntelligenceConfidenceState is pure and deterministic -- identical canonical state always produces an identical result", () => {
  const state = buildCanonicalState();
  const a = resolveMarketIntelligenceConfidenceState(state, "English");
  const b = resolveMarketIntelligenceConfidenceState(state, "English");
  assert.deepEqual(a, b);
});

// --- Reproducibility: the persisted score is derivable from persisted structured inputs ---

test("REPRODUCIBILITY: recomputing assessMarketEntryConfidence from the canonical state's own persisted coverage + decisionCriticalEvidence reproduces the exact persisted confidence score", () => {
  const state = buildCanonicalState();
  const recomputed = assessMarketEntryConfidence(state.coverage, state.decisionCriticalEvidence);
  assert.equal(recomputed.confidence, state.confidence);
});

// --- Unresolved controlling factor lowers confidence ---

test("REAL FIXTURE (MONITOR, SAM/SOM unresolved): confidence state correctly reports the single controlling constraint and 2 of 3 contributors", () => {
  const state = buildCanonicalState();
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.ok(confidenceState);
  assert.equal(confidenceState.score, 50);
  assert.equal(confidenceState.decision, "CONDITIONAL_GO");
  assert.equal(confidenceState.contributors.length, 2);
  assert.equal(confidenceState.constraints.length, 1);
  assert.equal(confidenceState.constraints[0].factor, "obtainableShareResolved");
  assert.equal(confidenceState.constraints[0].isControllingFactor, true);
  assert.equal(confidenceState.provenance, "structural");
  assert.match(confidenceState.rationale, /2 of 3/);
  assert.match(confidenceState.rationale, /Obtainable Share \(SAM\/SOM\)/);
});

test("a report with ALL 3 pillars unresolved reports zero contributors, 3 constraints, and none marked as the sole controlling factor", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    marketSizing: null,
  });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.contributors.length, 0);
  assert.equal(confidenceState.constraints.length, 3);
  assert.ok(confidenceState.constraints.every((c) => c.isControllingFactor === false));
  assert.match(confidenceState.rationale, /3 pillars remain unresolved/);
});

// --- Resolving the controlling factor changes confidence appropriately ---

test("resolving the controlling factor (obtainableShareResolved: false -> true) with the SAME underlying coverage removes the confidence cap and raises the score", () => {
  const coverage = buildCoverage({ marketConfidence: 75, competitiveEvidence: 75, financialEvidence: 75, productEvidence: 75 });
  const unresolvedEvidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const resolvedEvidence = { ...unresolvedEvidence, obtainableShareResolved: true };

  const beforeResult = assessMarketEntryConfidence(coverage, unresolvedEvidence);
  const afterResult = assessMarketEntryConfidence(coverage, resolvedEvidence);

  // 1 unresolved pillar caps confidence at <=50 regardless of how strong
  // the raw blended evidence is.
  assert.ok(beforeResult.confidence <= 50);
  // Resolving it removes the cap entirely -- the SAME strong coverage
  // now reports its true (higher) raw blended score.
  assert.equal(afterResult.confidence, 75);
  assert.ok(afterResult.confidence > beforeResult.confidence);

  const beforeState = buildCanonicalState({ decisionCriticalEvidence: unresolvedEvidence, coverage, confidence: beforeResult.confidence, decision: "CONDITIONAL_GO" });
  const afterState = buildCanonicalState({ decisionCriticalEvidence: resolvedEvidence, coverage, confidence: afterResult.confidence, decision: "GO" });
  const beforeConfidenceState = resolveMarketIntelligenceConfidenceState(beforeState);
  const afterConfidenceState = resolveMarketIntelligenceConfidenceState(afterState);
  assert.equal(beforeConfidenceState.constraints.length, 1);
  assert.equal(afterConfidenceState.constraints.length, 0);
  assert.ok(afterConfidenceState.score > beforeConfidenceState.score);
});

// --- Strong evidence can produce a high-confidence ENTER ---

test("strong evidence across all pillars and dimensions produces a high-confidence ENTER (GO) decision, computed by the SAME unchanged formula", () => {
  const coverage = buildCoverage({ marketConfidence: 85, competitiveEvidence: 85, financialEvidence: 85, productEvidence: 85 });
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
  const result = assessMarketEntryConfidence(coverage, evidence);
  assert.equal(result.decision, "ENTER");
  assert.equal(result.confidence, 85);
  assert.ok(result.confidence >= 65, "a genuine ENTER-band confidence must be a real 'high confidence' by this report's own Strong threshold");

  const state = buildCanonicalState({ decision: "GO", confidence: result.confidence, decisionCriticalEvidence: evidence, coverage });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.level, "Strong");
  assert.equal(confidenceState.contributors.length, 3);
  assert.equal(confidenceState.constraints.length, 0);
});

// --- AVOID confidence reflects real evidence strength, never a hardcoded number ---
//
// ARCHITECTURAL NOTE (confirmed via audit, unchanged per this task's own
// "do not change ENTER/MONITOR/AVOID methodology" instruction): under
// the existing, unmodified assessMarketEntryConfidence formula, an AVOID
// decision requires the RAW blended score itself to fall below 40, and
// capConfidenceForEvidenceGap only ever LOWERS confidence, never raises
// it -- so a "high-confidence AVOID" (>=65%) is not reachable without
// changing the decision methodology, which this task explicitly forbids.
// What IS verified here, and what genuinely matters for requirement #5,
// is that AVOID confidence is never a single hardcoded number regardless
// of decision direction -- it moves continuously with the underlying
// evidence, exactly like ENTER/MONITOR.
test("AVOID confidence varies with the strength of the underlying (weak) evidence -- never hardcoded to one fixed number for every AVOID report", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
  const weakerCoverage = buildCoverage({ marketConfidence: 10, competitiveEvidence: 10, financialEvidence: 10, productEvidence: 10 });
  const lessWeakCoverage = buildCoverage({ marketConfidence: 35, competitiveEvidence: 35, financialEvidence: 35, productEvidence: 35 });

  const weakerResult = assessMarketEntryConfidence(weakerCoverage, evidence);
  const lessWeakResult = assessMarketEntryConfidence(lessWeakCoverage, evidence);

  assert.equal(weakerResult.decision, "AVOID");
  assert.equal(lessWeakResult.decision, "AVOID");
  assert.notEqual(weakerResult.confidence, lessWeakResult.confidence);
  assert.ok(lessWeakResult.confidence > weakerResult.confidence);

  const state = buildCanonicalState({ decision: "NO_GO", confidence: lessWeakResult.confidence, decisionCriticalEvidence: evidence, coverage: lessWeakCoverage });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  assert.equal(confidenceState.constraints.length, 0, "all 3 pillars resolved -- the low confidence here reflects weak overall evidence, not an unresolved pillar");
  assert.equal(confidenceState.contributors.length, 3);
});

// --- MONITOR is not automatically hardcoded to 50% ---

test("MONITOR confidence differs structurally by how many decision-critical pillars are unresolved (1 -> <=50, 2 -> <=40) -- never a fixed 50 for every MONITOR report", () => {
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
  assert.equal(oneUnresolved.decision, "MONITOR");
  assert.equal(twoUnresolved.decision, "MONITOR");
  assert.equal(oneUnresolved.confidence, 50);
  assert.equal(twoUnresolved.confidence, 40);
  assert.notEqual(oneUnresolved.confidence, twoUnresolved.confidence);
});

test("MONITOR confidence is never bumped UP to a cap ceiling when the raw evidence is already weaker than that ceiling -- caps only ever lower, never raise, the score", () => {
  const weakCoverage = buildCoverage({ marketConfidence: 30, competitiveEvidence: 30, financialEvidence: 30, productEvidence: 30 });
  const result = assessMarketEntryConfidence(weakCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });
  assert.equal(result.decision, "MONITOR");
  assert.equal(result.confidence, 30, "raw 30 stays 30 -- the <=50 cap for 1 unresolved pillar must never raise a genuinely weaker score up to 50");
  assert.notEqual(result.confidence, 50);
});

// --- No duplicate penalty for the same evidence gap ---

test("no duplicate penalty for the same evidence gap: constraints has exactly one entry per unresolved pillar, matching resolveMarketIntelligenceEvidenceGaps' own deduplicated material-gap list 1:1", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    marketSizing: null,
  });
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(state).filter((gap) => gap.decisionFactor !== null);

  assert.equal(confidenceState.constraints.length, materialGaps.length);
  assert.deepEqual(
    confidenceState.constraints.map((c) => c.factor).sort(),
    materialGaps.map((g) => g.decisionFactor).sort()
  );
  // Each factor appears exactly once -- never "SOM" and "Obtainable
  // Share" and "controlling factor" as three separate line items for
  // the same underlying gap.
  const factors = confidenceState.constraints.map((c) => c.factor);
  assert.equal(new Set(factors).size, factors.length);
});

// --- Historical report fallback ---

test("a null canonicalState (historical/degraded report) produces a null confidence state -- never a fabricated one", () => {
  assert.equal(resolveMarketIntelligenceConfidenceState(null), null);
});

// --- Persisted/reloaded parity ---

test("round-tripping the canonical state through JSON (simulating a metadata reload from Postgres) produces an identical confidence state", () => {
  const state = buildCanonicalState();
  const before = resolveMarketIntelligenceConfidenceState(state);
  const reloaded = JSON.parse(JSON.stringify(state));
  const after = resolveMarketIntelligenceConfidenceState(reloaded);
  assert.deepEqual(before, after);
});

// --- No prose-derived confidence calculation ---

test("STRUCTURAL AUDIT: resolveMarketIntelligenceConfidenceState's own module never references prose-extraction helpers (extractMetricValueFromAliases, extractConfidence, extractKeywordInsight)", () => {
  const functionMatch = evidenceGapsSource.match(/export function resolveMarketIntelligenceConfidenceState\([\s\S]*?\n\}/);
  assert.ok(functionMatch, "expected to find resolveMarketIntelligenceConfidenceState's own function body");
  assert.doesNotMatch(
    functionMatch[0],
    /extractMetricValueFromAliases|extractConfidence|extractKeywordInsight|extractAliasedSectionSnippet/
  );
});

test("STRUCTURAL AUDIT: no render surface independently reconstructs a confidence rationale -- all read marketConfidenceState.rationale/level from the one shared resolver", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceConfidenceState\(/, `${name}: must call resolveMarketIntelligenceConfidenceState`);
    assert.match(source, /marketConfidenceState[!?]?\.rationale/, `${name}: must read marketConfidenceState.rationale`);
  }
  const plannerCallSites = plannerSource.match(/resolveMarketIntelligenceConfidenceState\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

// --- Preserve existing semantics: confidence is about evidence, not success probability ---

test("the SAME confidence explanation function makes no reference to business success/failure probability -- only evidence-pillar resolution", () => {
  const state = buildCanonicalState();
  const confidenceState = resolveMarketIntelligenceConfidenceState(state);
  for (const text of [confidenceState.rationale, ...confidenceState.contributors.map((c) => c.description), ...confidenceState.constraints.map((c) => c.description)]) {
    assert.doesNotMatch(text, /succeed|success probability|will fail|likely to fail/i);
  }
});

// --- Canonical decision/score never mutated by resolving the explanation ---

test("resolving the confidence state never mutates the canonical decision, confidence, or decisionCriticalEvidence", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", confidence: 50 });
  const before = JSON.stringify({ decision: state.decision, confidence: state.confidence, decisionCriticalEvidence: state.decisionCriticalEvidence });
  resolveMarketIntelligenceConfidenceState(state);
  const after = JSON.stringify({ decision: state.decision, confidence: state.confidence, decisionCriticalEvidence: state.decisionCriticalEvidence });
  assert.equal(before, after);
});
