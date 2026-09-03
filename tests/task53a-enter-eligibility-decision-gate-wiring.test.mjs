import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceGatedExecutiveDecision,
  resolveMarketIntelligenceEnterEligibility,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { resolveMarketIntelligenceExecutiveDecisionWithCanonicalState } from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import { localizeExecutiveDecision } from "../app/lib/report-engine/executive-decision-brief.ts";
import { mapExecutiveDecisionCodeToCanonicalDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// TASK #53A -- wire the Task #53 resolveMarketIntelligenceEnterEligibility
// resolver into the REAL canonical decision resolution layer
// (resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
// market-intelligence-canonical-state.ts) via a single new wrapper,
// resolveMarketIntelligenceGatedExecutiveDecision
// (market-intelligence-evidence-gaps.ts), which every UI/PDF surface now
// calls instead of the raw resolver.
//
// Import-graph note: evidence-gaps.ts already imports safely FROM
// canonical-state.ts (classifyStrategicRecommendationAction and several
// types); canonical-state.ts does not import evidence-gaps.ts anywhere.
// Adding the reverse-direction import (evidence-gaps.ts importing
// resolveMarketIntelligenceExecutiveDecisionWithCanonicalState FROM
// canonical-state.ts) keeps the dependency strictly one-directional --
// no cycle is introduced. The gate therefore lives in evidence-gaps.ts,
// never inside canonical-state.ts itself.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const dashboardIndexSource = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../app/dashboard/workspaces/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

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
    topRisks: ["Obtainable share has not been independently validated."],
    topReasons: ["Market sizing and competitive evidence are both resolved."],
    why: "Evidence supports conditional entry pending obtainable-share validation.",
    missingEvidence: ["Independent conversion data."],
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Run the paid pilot before committing further budget.",
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
    citationSources: [],
    ...overrides,
  };
}

const RESOLVED_EVIDENCE = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
const UNRESOLVED_EVIDENCE = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };

// --- A. candidate = ENTER (GO), ineligible -> final = MONITOR (CONDITIONAL_GO) ---

test("TASK #53A-A: a persisted GO decision with an unresolved decision-critical evidence gap is downgraded to MONITOR (CONDITIONAL_GO) by the gated resolver", () => {
  const state = buildCanonicalState({ decision: "GO", decisionCriticalEvidence: UNRESOLVED_EVIDENCE });
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [], "English");
  assert.equal(eligibility.eligible, false, "fixture sanity check: this state must be ineligible");

  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(state, "", "English");

  assert.equal(ungated.decisionLabel, localizeExecutiveDecision("GO", "English", "market"), "sanity: the raw resolver still reads GO");
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("CONDITIONAL_GO", "English", "market"));
  assert.equal(gated.canonicalDecision, mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO"));
  assert.equal(gated.confidenceScore, ungated.confidenceScore, "confidenceScore must pass through unchanged -- only the label/canonicalDecision axis is gated");
  assert.equal(gated.decisionSource, ungated.decisionSource);
  assert.equal(gated.language, ungated.language);
});

// --- B. candidate = ENTER (GO), eligible -> stays ENTER (GO) ---

test("TASK #53A-B: a persisted GO decision with every decision-critical pillar resolved is left completely unchanged by the gated resolver", () => {
  const state = buildCanonicalState({ decision: "GO", decisionCriticalEvidence: RESOLVED_EVIDENCE, confidence: 82 });
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [], "English");
  assert.equal(eligibility.eligible, true, "fixture sanity check: this state must be eligible");

  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(state, "", "English");

  assert.deepEqual(gated, ungated, "an eligible GO must pass through the gate byte-for-byte identical");
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("GO", "English", "market"));
});

// --- C. candidate = MONITOR (CONDITIONAL_GO) -> stays MONITOR, regardless of eligibility ---

test("TASK #53A-C: a persisted CONDITIONAL_GO (MONITOR) decision is never touched by the gate, even when the underlying evidence gaps would also be ineligible for ENTER", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", decisionCriticalEvidence: UNRESOLVED_EVIDENCE });
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(state, "", "English");
  assert.deepEqual(gated, ungated);
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("CONDITIONAL_GO", "English", "market"));
});

test("TASK #53A-C (continued): a persisted CONDITIONAL_GO decision is never touched by the gate even when every decision-critical pillar is resolved (eligibility only ever narrows GO, never widens MONITOR)", () => {
  const state = buildCanonicalState({ decision: "CONDITIONAL_GO", decisionCriticalEvidence: RESOLVED_EVIDENCE });
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(state, "", "English");
  assert.deepEqual(gated, ungated);
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("CONDITIONAL_GO", "English", "market"));
});

// --- D. existing AVOID (NO_GO) condition -> stays AVOID -----------------------

test("TASK #53A-D: a persisted NO_GO (AVOID) decision is left completely unchanged by the gated resolver", () => {
  const state = buildCanonicalState({ decision: "NO_GO", decisionCriticalEvidence: UNRESOLVED_EVIDENCE, confidence: 20 });
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(state, "", "English");
  assert.deepEqual(gated, ungated);
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("NO_GO", "English", "market"));
});

// --- legacy fallback: no canonical state -> pass through unchanged -----------

test("TASK #53A: a null canonical state (legacy banner-parse fallback) is passed through unchanged -- there is nothing to gate without decision-critical evidence to evaluate", () => {
  const content = "Executive Decision: ENTER. Confidence: High.";
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(null, content, "English");
  const ungated = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(null, content, "English");
  assert.deepEqual(gated, ungated);
});

// --- E. UI/PDF cannot bypass the gated decision -------------------------------

test("TASK #53A-E: no UI/PDF render surface calls the raw, ungated resolveMarketIntelligenceExecutiveDecisionWithCanonicalState directly -- every surface calls the gated wrapper", () => {
  for (const [name, source] of [
    ["app/dashboard/page.tsx", dashboardIndexSource],
    ["app/dashboard/workspaces/[id]/page.tsx", workspaceSource],
    ["app/dashboard/[id]/page.tsx", pageSource],
    ["components/Planner.tsx", plannerSource],
    ["app/dashboard/[id]/ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/,
      `${name}: must not call the ungated resolver directly -- it must call resolveMarketIntelligenceGatedExecutiveDecision instead`
    );
    assert.match(
      source,
      /resolveMarketIntelligenceGatedExecutiveDecision\(/,
      `${name}: must call the gated wrapper to resolve the Market Intelligence decision`
    );
  }
});

test("TASK #53A-E (continued): no render surface duplicates the eligibility check itself -- eligibility is only ever computed inside evidence-gaps.ts", () => {
  for (const [name, source] of [
    ["app/dashboard/page.tsx", dashboardIndexSource],
    ["app/dashboard/workspaces/[id]/page.tsx", workspaceSource],
    ["app/dashboard/[id]/page.tsx", pageSource],
    ["components/Planner.tsx", plannerSource],
    ["app/dashboard/[id]/ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /function resolveMarketIntelligenceEnterEligibility/, `${name}: must not duplicate the eligibility resolver`);
    assert.doesNotMatch(source, /function resolveMarketIntelligenceGatedExecutiveDecision/, `${name}: must not duplicate the gate itself`);
  }
});

// --- F. a Validation Target numerically matching the ENTER threshold cannot cause ENTER ---

test("TASK #53A-F: even a canonical state whose persisted decision reads GO while its own decision-critical evidence is unresolved (the only shape a Validation-Target-only 'satisfied' gap could ever produce) cannot surface as ENTER through the real gated pipeline", () => {
  // This mirrors Task #53's own finding: a Validation Target can never
  // itself resolve obtainableShareResolved to true (only genuinely
  // verified evidence can, per isEnterRequirementEvidenceQualified) --
  // so the ONLY way a GO decision and an unresolved pillar can coexist
  // in canonical state at all is exactly this fixture shape. The gated
  // resolver must still catch it.
  const state = buildCanonicalState({
    decision: "GO",
    decisionCriticalEvidence: UNRESOLVED_EVIDENCE,
    topReasons: ["10% conversion (Validation Target) numerically matches the stated ENTER threshold."],
  });
  const gated = resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  assert.notEqual(gated.decisionLabel, localizeExecutiveDecision("GO", "English", "market"));
  assert.equal(gated.decisionLabel, localizeExecutiveDecision("CONDITIONAL_GO", "English", "market"));
  assert.equal(gated.canonicalDecision, mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO"));
});

// --- purity / no second decision engine ---------------------------------------

test("TASK #53A: resolveMarketIntelligenceGatedExecutiveDecision never mutates its canonicalState argument", () => {
  const state = buildCanonicalState({ decision: "GO", decisionCriticalEvidence: UNRESOLVED_EVIDENCE });
  const before = JSON.stringify(state);
  resolveMarketIntelligenceGatedExecutiveDecision(state, "", "English");
  const after = JSON.stringify(state);
  assert.equal(before, after);
});

test("TASK #53A (drift check): resolveMarketIntelligenceGatedExecutiveDecision only ever narrows GO -- it never branches on CONDITIONAL_GO or NO_GO, confirmed via source", () => {
  const evidenceGapsSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
    "utf8"
  );
  const fnSource = evidenceGapsSource.match(/export function resolveMarketIntelligenceGatedExecutiveDecision\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /canonicalState\.decision !== "GO"/);
  assert.doesNotMatch(fnSource, /"CONDITIONAL_GO"\s*===|===\s*"CONDITIONAL_GO"/);
  assert.doesNotMatch(fnSource, /"NO_GO"\s*===|===\s*"NO_GO"/);
  assert.doesNotMatch(fnSource, /assessMarketEntryConfidence\(/);
});
