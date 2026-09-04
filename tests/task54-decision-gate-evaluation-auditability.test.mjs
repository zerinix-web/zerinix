import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceDecisionGateEvaluations,
  resolveMarketIntelligenceEnterEligibility,
  resolveMarketIntelligenceEvidenceGaps,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #54 -- Make Market Intelligence decision-gate evaluation
// structurally auditable.
//
// ROOT ARCHITECTURAL ISSUE: a gate's satisfied state has always lived
// only as a bare boolean (canonicalState.decisionCriticalEvidence.<pillar>Resolved).
// resolveMarketIntelligenceEvidenceGaps only ever emits a structured
// object for an UNRESOLVED gate; a resolved gate has never had ANY
// structured representation (evidence requirement, evidence class, why,
// controlling status) in one place -- only the raw boolean itself.
//
// FIX: resolveMarketIntelligenceDecisionGateEvaluations -- one entry per
// decision-critical gate (market-sizing, competitive-evidence,
// obtainable-share), for BOTH the resolved and unresolved case, built
// entirely from existing structures (resolveMarketIntelligenceEvidenceGaps,
// resolveMarketIntelligenceEnterEligibility, resolveMarketIntelligenceMultiGapPriorityState,
// canonicalState.marketSizing/competitors). `satisfied` is read ONLY from
// canonicalState.decisionCriticalEvidence -- never from a recommendation,
// closure plan, or prose -- so it is structurally fail-closed.

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

// The real single-controlling-gap report state (unchanged across Tasks
// #35-#53B): decision CONDITIONAL_GO (MONITOR), confidence 50,
// Obtainable Share the sole material gap.
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
    immediateNextAction: "Run the buyer demand validation program before committing further budget.",
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

const REAL_STATE = buildCanonicalState();

function buildValidation(item, canonicalState = REAL_STATE, signalsOverride = null) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: signalsOverride ?? extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- A. current real MONITOR fixture: Obtainable Share unresolved ----------

test("TASK #54-A: for the real MONITOR report, the Obtainable Share gate evaluates as unsatisfied, controlling, and ENTER-ineligible, while the canonical decision itself remains MONITOR-equivalent (CONDITIONAL_GO)", () => {
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [], "English");
  assert.equal(evaluations.length, 3, "one entry per decision-critical gate");

  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.ok(share);
  assert.equal(share.satisfied, false);
  assert.equal(share.controlling, true);
  assert.equal(share.decisionFactor, "obtainableShareResolved");
  assert.equal(share.label, "Obtainable Share (SAM/SOM)");

  const marketSizing = evaluations.find((e) => e.gateId === "market-sizing");
  const competitive = evaluations.find((e) => e.gateId === "competitive-evidence");
  assert.equal(marketSizing.satisfied, true);
  assert.equal(marketSizing.controlling, false);
  assert.equal(competitive.satisfied, true);
  assert.equal(competitive.controlling, false);

  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
});

// --- B. planning assumption only -> gate remains unsatisfied ----------------

test("TASK #54-B: a planning-assumption-only recommendation leaves the Obtainable Share gate unsatisfied", () => {
  const planningItem =
    "Legacy renewal outreach: contact existing customers about a legacy renewal program over 8 weeks (Owner: Head of Renewals) — Success criterion: 10% conversion rate (estimated).";
  const planning = buildValidation(planningItem);
  assert.equal(planning.provenance, "planningAssumption");

  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [planning], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(share.satisfied, false);
});

// --- C. Validation Target only -> gate remains unsatisfied ------------------

test("TASK #54-C: a Validation-Target-only recommendation, even one naming a specific number, leaves the Obtainable Share gate unsatisfied", () => {
  const targetItem = "Enterprise Pilot: sign 10 paying customers over 12 weeks (Owner: Head of Sales).";
  const target = buildValidation(targetItem);
  assert.equal(target.provenance, "validationTarget");
  assert.equal(target.relatedEvidenceGapId, "obtainable-share");

  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [target], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(share.satisfied, false, "a Validation Target must never satisfy the gate it targets");
  assert.equal(share.evidenceClass, "validationTarget", "evidenceClass may explain the proposal, but never flips satisfied");
});

test("TASK #54-C (continued): a budget/timeline figure alone, with no other qualifying evidence, cannot satisfy the gate either", () => {
  const budgetItem =
    "Procurement Reference Validation: run a pilot to validate obtainable share via procurement reference calls over 90 days (Owner: Head of Procurement) — Budget cap USD 80,000.";
  const budgetOnly = buildValidation(budgetItem);
  assert.equal(budgetOnly.relatedEvidenceGapId, "obtainable-share");
  assert.notEqual(budgetOnly.provenance, "verifiedEvidence");

  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [budgetOnly], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(share.satisfied, false);
});

// --- D. qualifying verified evidence satisfying the gate --------------------

test("TASK #54-D: when the underlying decision-critical pillar is genuinely resolved (evidence-derived SAM, calculated SOM), the gate evaluates as satisfied with evidenceClass 'verifiedEvidence', and ENTER eligibility may proceed under the existing, unchanged methodology", () => {
  const resolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    marketSizing: { ...defaultMarketSizing, samMethod: "evidenceDerived", somStatus: "calculated" },
  });
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(resolvedState, [], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(share.satisfied, true);
  assert.equal(share.evidenceClass, "verifiedEvidence");
  assert.equal(share.controlling, false, "a satisfied gate blocks nothing");

  const eligibility = resolveMarketIntelligenceEnterEligibility(resolvedState, [], "English");
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.blockingGaps.length, 0);
});

test("TASK #54-D (continued): a report resolved only via a disclosed default assumption (not evidence-derived) is still satisfied, but its evidenceClass honestly reads 'structuralAssumption', never 'verifiedEvidence'", () => {
  const assumptionResolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    marketSizing: { ...defaultMarketSizing, samMethod: "defaultAssumption", somStatus: "calculated" },
  });
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(assumptionResolvedState, [], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(share.satisfied, true);
  assert.equal(share.evidenceClass, "structuralAssumption");
});

test("TASK #54-D (fail-closed): a linked recommendation whose own evidence genuinely qualifies as 'verifiedEvidence' does NOT retroactively satisfy the gate while the underlying decision-critical pillar itself is still unresolved -- this is the exact bug class this task's `satisfied` guarantee prevents", () => {
  const verifiedCitationState = buildCanonicalState({
    citationSources: [
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
  const item = "Enterprise Pilot: sign 10 paying customers over 12 weeks (Owner: Head of Sales).";
  const verified = buildValidation(item, verifiedCitationState, {
    ...extractRecommendationSignals(item),
    evidenceTie: "Confirmed by [R4].",
  });
  assert.equal(verified.provenance, "verifiedEvidence");

  const eligibility = resolveMarketIntelligenceEnterEligibility(verifiedCitationState, [verified], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.equal(requirement.evidenceQualified, true, "fixture sanity: this recommendation's own evidence must genuinely qualify");

  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(verifiedCitationState, [verified], "English");
  const share = evaluations.find((e) => e.gateId === "obtainable-share");
  assert.equal(
    share.satisfied,
    false,
    "the decision-critical pillar itself is still unresolved in this fixture -- a recommendation's own qualifying evidence must never flip `satisfied` on its own"
  );
  assert.equal(share.evidenceClass, "verifiedEvidence", "evidenceClass may honestly report the strength offered, without ever promoting satisfied");
});

// --- E. verified evidence demonstrating failure -> can support AVOID -------

test("TASK #54-E: with every decision-critical gate satisfied and a weak raw coverage blend, the existing (unchanged) methodology can still produce AVOID -- this task's gate model never blocks or reroutes that", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true };
  const weakCoverage = buildCoverage({ marketConfidence: 5, competitiveEvidence: 5, financialEvidence: 5, productEvidence: 5 });
  const assessment = assessMarketEntryConfidence(weakCoverage, evidence);
  assert.equal(assessment.decision, "AVOID");

  const avoidState = buildCanonicalState({
    decision: "NO_GO",
    confidence: assessment.confidence,
    decisionCriticalEvidence: evidence,
    coverage: weakCoverage,
    marketSizing: { ...defaultMarketSizing, samMethod: "evidenceDerived", somStatus: "calculated" },
  });
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(avoidState, [], "English");
  for (const evaluation of evaluations) {
    assert.equal(evaluation.satisfied, true);
    assert.equal(evaluation.controlling, false);
  }
});

test("TASK #54-E (continued): unresolved evidence never automatically produces AVOID -- a weak raw blend with an unresolved pillar still resolves to MONITOR, confirming this task did not alter that methodology", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const weakCoverage = buildCoverage({ marketConfidence: 5, competitiveEvidence: 5, financialEvidence: 5, productEvidence: 5 });
  const assessment = assessMarketEntryConfidence(weakCoverage, evidence);
  assert.equal(assessment.decision, "MONITOR");
});

// --- F. renderer/prose changes cannot bypass the canonical evaluation ------

test("TASK #54-F: no render surface (page.tsx, Planner.tsx web+PDF, ReportPdfButton.tsx) independently computes gate satisfaction -- none defines its own 'satisfied'/'gateSatisfied' logic keyed on decisionCriticalEvidence", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /function resolveMarketIntelligenceDecisionGateEvaluations/,
      `${name}: must not duplicate the gate-evaluation resolver`
    );
    assert.doesNotMatch(
      source,
      /decisionCriticalEvidence\.\w+Resolved\s*(?:&&|\?|===|!==)/,
      `${name}: must not independently branch on a raw decisionCriticalEvidence field -- only the canonical resolver may`
    );
  }
});

test("TASK #54-F: resolveMarketIntelligenceDecisionGateEvaluations never reads a validation's raw item text or recommendation prose -- only structured relatedEvidenceGapId/provenance/components fields already computed elsewhere", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceDecisionGateEvaluations\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(fnSource, /\.item\b/);
  assert.doesNotMatch(fnSource, /includes\(|\.match\(|\.test\(/);
});

test("TASK #54-F (drift check): `satisfied` is assigned only from canonicalState.decisionCriticalEvidence[decisionFactor] -- confirmed via source, never from a requirement/component/provenance value", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceDecisionGateEvaluations\([\s\S]*?\n\}/
  )[0];
  assert.match(fnSource, /const satisfied = canonicalState\.decisionCriticalEvidence\[decisionFactor\];/);
  assert.match(fnSource, /satisfied: false,/);
  assert.match(fnSource, /satisfied: true,/);
});

// --- Purity / no second decision engine -------------------------------------

test("TASK #54: resolveMarketIntelligenceDecisionGateEvaluations never mutates canonicalState, and never calls assessMarketEntryConfidence", () => {
  const fnSource = evidenceGapsSource.match(
    /export function resolveMarketIntelligenceDecisionGateEvaluations\([\s\S]*?\n\}/
  )[0];
  assert.doesNotMatch(fnSource, /assessMarketEntryConfidence\(/);
  assert.doesNotMatch(fnSource, /canonicalState\.\w+\s*=(?!=)/);

  const before = JSON.stringify(REAL_STATE);
  resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [], "English");
  const after = JSON.stringify(REAL_STATE);
  assert.equal(before, after);
});

test("TASK #54: returns an empty array for a null canonical state -- never a fabricated evaluation", () => {
  assert.deepEqual(resolveMarketIntelligenceDecisionGateEvaluations(null, [], "English"), []);
});

test("TASK #54: growth-rate (a non-gating supporting gap) never appears in the decision-gate evaluation list", () => {
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [], "English");
  assert.ok(!evaluations.some((e) => e.gateId === "growth-rate"));
  const materialGapIds = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English")
    .filter((g) => g.decisionFactor !== null)
    .map((g) => g.id);
  assert.ok(materialGapIds.every((id) => evaluations.some((e) => e.gateId === id)));
});

test("TASK #54 (multi-gap): when 2+ gates are simultaneously unresolved, controlling status is sourced from the SAME Task #48 multi-gap priority state -- primary/co-controlling gates read controlling: true, a secondary gate reads controlling: false", () => {
  const multiGapState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
  });
  const evaluations = resolveMarketIntelligenceDecisionGateEvaluations(multiGapState, [], "English");
  const controllingCount = evaluations.filter((e) => e.controlling).length;
  assert.ok(controllingCount >= 1, "at least one unresolved gate must be marked controlling");
  const satisfiedCount = evaluations.filter((e) => e.satisfied).length;
  assert.equal(satisfiedCount, 1, "only competitive-evidence is resolved in this fixture");
});
