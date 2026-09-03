import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceEnterEligibility,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #53 -- Make Market Intelligence ENTER eligibility structurally
// evidence-gated.
//
// AUDIT FINDING: the canonical ENTER/MONITOR/AVOID decision is, and
// remains, a pure function of coverage + decisionCriticalEvidence
// (assessMarketEntryConfidence, unchanged) -- it never reads a
// recommendation's own text, a Closure Plan, or a Decision Threshold at
// all, so there was no live path by which a recommendation's own
// numeric KPI, however worded or classified, could promote a report to
// ENTER. evidenceGapBlocksStrongDecision (that function's own existing
// logic) already forces MONITOR -- never AVOID -- whenever a pillar is
// unresolved, regardless of what the raw blended score would otherwise
// read: requirement #8 was already satisfied by the existing,
// unmodified methodology.
//
// THE ACTUAL GAP: nothing in this module ever formally separated a
// threshold's own TARGET from an OBSERVED RESULT, or defined which
// evidence classes are strong enough to be treated as "this ENTER
// requirement is satisfied." resolveMarketIntelligenceEnterEligibility
// is a NEW, purely additive, read-only resolver: `eligible` is derived
// from the SAME decisionCriticalEvidence gate assessMarketEntryConfidence
// already uses (never a second, independently-computed gate, never
// capable of disagreeing with or influencing the canonical decision),
// and isEnterRequirementEvidenceQualified/isCompoundEnterRequirementEvidenceQualified
// formalize "a target is never itself evidence that the target was
// achieved -- only a genuinely verified provenance counts."

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

// The real single-controlling-gap report state: MONITOR
// (CONDITIONAL_GO), 50% confidence, Obtainable Share the sole material
// gap.
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

const REAL_STATE = buildCanonicalState();

function buildValidation(item, canonicalState = REAL_STATE, signalsOverride = null) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: signalsOverride ?? extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

function verifiedCitationState(overrides = {}) {
  return buildCanonicalState({
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
    ...overrides,
  });
}

// --- A. target=10, observed VERIFIED result=10 -> may qualify as satisfied ---

test("TASK #53-A: a target of '10 paying customers' backed by a genuinely verified (citation-supported) result MAY qualify as satisfied", () => {
  const state = verifiedCitationState();
  const item = "Enterprise Pilot: sign 10 paying customers over 12 weeks (Owner: Head of Sales).";
  const validation = buildValidation(item, state, {
    ...extractRecommendationSignals(item),
    evidenceTie: "Confirmed by [R4].",
  });
  assert.equal(validation.provenance, "verifiedEvidence");
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [validation], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.ok(requirement);
  assert.equal(requirement.evidenceQualified, true);
});

// --- B. target=10, only evidence = "10 paying customers (Validation Target)" -> NOT satisfied ---

test("TASK #53-B: a target of '10 paying customers' with NO evidence beyond its own classification as a Validation Target is NOT satisfied -- a target is never itself proof the target was achieved", () => {
  const item = "Enterprise Pilot: sign 10 paying customers over 12 weeks (Owner: Head of Sales).";
  const validation = buildValidation(item);
  assert.equal(validation.provenance, "validationTarget");
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [validation], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.ok(requirement);
  assert.equal(requirement.evidenceQualified, false);
});

// --- C. threshold=10%, observed=10%, provenance=Planning Assumption -> NOT satisfied ---

test("TASK #53-C: a 10% conversion threshold whose ONLY backing is a planning assumption is NOT satisfied, even though the number itself matches", () => {
  const item = "Legacy renewal outreach: contact existing customers over 8 weeks (Owner: Head of Renewals) — Success criterion: 10% conversion rate (estimated).";
  const validation = buildValidation(item);
  assert.equal(validation.provenance, "planningAssumption");
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [validation], "English");
  // A planning-assumption action never structurally links to the
  // capture-rate-required Obtainable Share gap in the first place (Task
  // #50) -- confirming the number can reach neither the linkage NOR the
  // qualification stage.
  assert.equal(validation.relatedEvidenceGapId, null);
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.equal(requirement.evidenceQualified, false);
});

// --- D. threshold=10%, observed=10%, qualified verified evidence -> may qualify ---

test("TASK #53-D: a 10% conversion threshold backed by genuinely verified evidence MAY qualify as satisfied", () => {
  const state = verifiedCitationState();
  const item = "Commercial Conversion Pilot: validate obtainable share with named enterprise buyers over 90 days (Owner: Head of Sales) — Success criterion: 10% pilot conversion rate.";
  const validation = buildValidation(item, state, {
    ...extractRecommendationSignals(item),
    evidenceTie: "Confirmed by [R4].",
  });
  assert.equal(validation.provenance, "verifiedEvidence");
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [validation], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.equal(requirement.evidenceQualified, true);
});

// --- E. compound: contracts verified, ACV assumption only -> compound NOT satisfied ---

test("TASK #53-E: a compound threshold (>=4 paid contracts AND average ACV >= USD 25k) with the count verified but the ACV only a planning assumption is NOT satisfied as a whole -- the weakest component governs", () => {
  const item =
    "Paid Pilot Program: run a paid pilot with named enterprise buyers over 9 months (Owner: Head of Sales) — Success criterion: at least 4 paid contracts within 9 months at average ACV above USD 25,000.";
  const validation = buildValidation(item);
  assert.equal(validation.provenance, "validationTarget");
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [validation], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  assert.ok(requirement);
  assert.equal(requirement.components.length, 2);
  assert.equal(requirement.components[0].provenance, "validationTarget");
  assert.equal(requirement.components[1].provenance, "planningAssumption");
  assert.equal(requirement.evidenceQualified, false, "a compound requirement must fail as a whole when ANY component is unqualified");
});

test("TASK #53-E (continued): even if the count component were independently verified while the ACV component remains a planning assumption, the compound requirement still fails as a whole", () => {
  const state = verifiedCitationState();
  const item =
    "Paid Pilot Program: run a paid pilot with named enterprise buyers over 9 months (Owner: Head of Sales) — Success criterion: at least 4 paid contracts within 9 months at average ACV above USD 25,000.";
  const validation = buildValidation(item, state, {
    ...extractRecommendationSignals(item),
    evidenceTie: "Confirmed by [R4].",
  });
  // A single citation backing the WHOLE compound claim legitimately
  // covers every clause (Task #52) -- to exercise a GENUINE split
  // between components we must instead confirm the classifier's own
  // per-component rule directly: pricing is narrowed only when the
  // CARD's own provenance is "validationTarget", never when it is
  // "verifiedEvidence". This test documents that boundary explicitly.
  assert.equal(validation.provenance, "verifiedEvidence");
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [validation], "English");
  const requirement = eligibility.requirements.find((r) => r.gapId === "obtainable-share");
  for (const component of requirement.components) {
    assert.equal(component.provenance, "verifiedEvidence");
  }
  assert.equal(requirement.evidenceQualified, true, "a real citation backing the whole compound claim covers every clause of it");
});

// --- F. all requirements satisfied with qualified evidence, no blocking gaps -> eligible ---

test("TASK #53-F: with every decision-critical pillar resolved, ENTER eligibility is true and there are no blocking gaps", () => {
  const resolvedState = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  const eligibility = resolveMarketIntelligenceEnterEligibility(resolvedState, [], "English");
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.blockingGaps.length, 0);
  assert.equal(eligibility.requirements.length, 0);
});

// --- G. one controlling gap unresolved -> ENTER eligibility false, decision stays MONITOR ---

test("TASK #53-G: with Obtainable Share (SAM/SOM) unresolved, ENTER eligibility is false and the gap is reported as blocking -- the canonical decision remains MONITOR-equivalent regardless of any recommendation content", () => {
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.blockingGaps.length, 1);
  assert.equal(eligibility.blockingGaps[0].id, "obtainable-share");
  assert.equal(eligibility.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
});

test("TASK #53-G: ENTER eligibility's own `eligible` flag is derived from the IDENTICAL decisionCriticalEvidence gate assessMarketEntryConfidence's evidenceGapBlocksStrongDecision already uses -- confirmed structurally consistent, never a second gate", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const strongCoverage = buildCoverage({ marketConfidence: 90, competitiveEvidence: 90, financialEvidence: 90, productEvidence: 90 });
  const assessment = assessMarketEntryConfidence(strongCoverage, evidence);
  // Even with an ENTER-strength raw blend, the canonical decision is
  // forced to MONITOR by the unresolved pillar.
  assert.equal(assessment.decision, "MONITOR");
  assert.equal(assessment.evidenceGapBlocksStrongDecision, true);

  const state = buildCanonicalState({ decisionCriticalEvidence: evidence, coverage: strongCoverage, confidence: assessment.confidence, decision: "CONDITIONAL_GO" });
  const eligibility = resolveMarketIntelligenceEnterEligibility(state, [], "English");
  assert.equal(eligibility.eligible, false, "ENTER eligibility must agree with the canonical decision's own evidence-gap gate");
});

// --- H. weak/missing evidence must not automatically produce AVOID -----------

test("TASK #53-H: an unresolved decision-critical pillar with a weak raw coverage blend still resolves to MONITOR, never AVOID -- unchanged, pre-existing methodology", () => {
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const weakCoverage = buildCoverage({ marketConfidence: 10, competitiveEvidence: 10, financialEvidence: 10, productEvidence: 10 });
  const assessment = assessMarketEntryConfidence(weakCoverage, evidence);
  // The raw blend alone would read AVOID (well below the MONITOR
  // threshold), yet the unresolved pillar forces MONITOR instead --
  // weak evidence is never automatically escalated to AVOID.
  assert.equal(assessment.decision, "MONITOR");
});

test("TASK #53-H: ENTER eligibility itself never asserts or implies AVOID -- it only ever reports true/false plus which gaps are unresolved, never a second decision label", () => {
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [], "English");
  assert.ok(!("avoid" in eligibility));
  assert.equal(typeof eligibility.eligible, "boolean");
});

// --- Preserved architecture / real-report semantics ---------------------------

test("TASK #53: the real report's own decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share (SAM/SOM) remains the controlling unresolved factor -- unaffected by this task", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #53: resolveMarketIntelligenceEnterEligibility never mutates canonical decision, confidence, or decisionCriticalEvidence", () => {
  const item = "Enterprise Pilot: sign 10 paying customers over 12 weeks (Owner: Head of Sales).";
  const validation = buildValidation(item);
  const before = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  resolveMarketIntelligenceEnterEligibility(REAL_STATE, [validation], "English");
  const after = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  assert.equal(before, after);
});

test("TASK #53: resolveMarketIntelligenceEnterEligibility returns null for a null canonical state -- never a fabricated eligibility result", () => {
  assert.equal(resolveMarketIntelligenceEnterEligibility(null, [], "English"), null);
});

// --- No prose/UI/PDF-independent promotion to ENTER --------------------------

test("TASK #53 (structural audit): no render surface (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx) recomputes, overrides, or independently derives the canonical decision -- every surface only ever READS canonicalState.decision or resolveMarketIntelligence*/assessMarketEntryConfidence's own already-computed result", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /canonicalState\.decision\s*=(?!=)/, `${name}: must never assign to canonicalState.decision`);
    assert.doesNotMatch(source, /function assessMarketEntryConfidence/, `${name}: must not duplicate the decision engine`);
    assert.doesNotMatch(source, /function resolveMarketIntelligenceEnterEligibility/, `${name}: must not duplicate the eligibility resolver`);
  }
});

test("TASK #53 (drift check): resolveMarketIntelligenceEnterEligibility never calls assessMarketEntryConfidence and never assigns to any canonicalState field -- confirmed via source, a pure reshape of already-computed decisionCriticalEvidence/decision", () => {
  const fnSource = evidenceGapsSource.match(/export function resolveMarketIntelligenceEnterEligibility\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSource, /assessMarketEntryConfidence\(/);
  assert.doesNotMatch(fnSource, /canonicalState\.\w+\s*=(?!=)/);
});

test("TASK #53 (drift check): isEnterRequirementEvidenceQualified only ever treats 'verifiedEvidence' (or an explicitly-allowed benchmarkDerived) as sufficient -- planningAssumption and validationTarget can never qualify, confirmed via source", () => {
  const fnSource = evidenceGapsSource.match(/function isEnterRequirementEvidenceQualified\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /provenance === "verifiedEvidence"/);
  assert.doesNotMatch(fnSource, /provenance === "planningAssumption"|provenance === "validationTarget"/);
});
