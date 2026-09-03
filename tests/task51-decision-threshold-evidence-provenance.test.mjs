import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceControllingDecisionThreshold,
  resolveMarketIntelligenceControllingClosurePlan,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #51 -- Make Market Intelligence decision thresholds evidence-
// qualified, not merely recommendation-derived.
//
// ROOT CAUSE / ARCHITECTURAL WEAKNESS FOUND: the STRUCTURED provenance
// tracking this ticket asks for already existed (Task #38/#39's own
// MarketIntelligenceThresholdCriterion.provenance field, populated
// verbatim from classifyStrategicRecommendationValidation's own
// verifiedEvidence/benchmarkDerived/planningAssumption/validationTarget
// classification -- never upgraded, never invented). The actual gap was
// in the VISIBLE TEXT a reader/renderer actually consumes:
// buildRecommendationEnterCriterion (Task #38) already appended its
// provenance label directly onto its own description ("...(Validation
// Target)."), but buildRecommendationAvoidCriterion's "Validation fails
// to meet the recommended target: X." sentence, and
// buildQuantifiedThresholdDescription's report-stated-threshold
// sentence ("...stated in this report's own decision brief."), never
// did -- even though both already carried the correct provenance value
// on their own structured object. A reader could see a report-stated
// PLANNING ASSUMPTION figure, or an AVOID-side recommendation-derived
// figure, with no visible qualifier at all, right next to an ENTER-side
// figure that DID show one -- inconsistent, and exactly the "presented
// as if verified" risk this task closes.
//
// FIX: both description builders now embed the SAME provenance label
// (via the existing localizeRecommendationProvenance) every
// recommendation-derived ENTER criterion already showed -- never a new,
// separately-worded label, never a new badge/UI element. This is a pure
// text-consistency fix; the underlying provenance VALUE was already
// correct and is completely unchanged.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
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

// The real single-controlling-gap report state: MONITOR
// (CONDITIONAL_GO), 50% confidence, Obtainable Share the sole material
// gap, Closure Plan correctly linked to a paid-pilot recommendation.
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

// The ticket's own real example: a compound paid-pilot target that is
// clearly a validation target (no citation backs it), not a verified
// fact.
const PAID_PILOT_ITEM =
  "Paid Pilot Program: run a paid pilot with named enterprise buyers over 9 months (Owner: Head of Sales) — Budget cap $75,000 — Success criterion: at least 4 paid contracts within 9 months at average ACV above USD 25,000.";

function buildValidation(item, canonicalState = REAL_STATE, signalsOverride = null) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: signalsOverride ?? extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- 1. Assumption-derived recommendation threshold stays assumption-qualified ---

test("TASK #51: the real report's own paid-pilot threshold (>=4 paid contracts... ACV >= USD 25k) is classified 'validationTarget' -- never silently upgraded to verified -- and that qualifier is VISIBLE in both ENTER and AVOID text", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");
  assert.equal(validation.provenance, "validationTarget", "no citation backs this figure -- must never classify as verifiedEvidence");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation], "English");
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(enterCriterion);
  assert.equal(enterCriterion.provenance, "validationTarget");
  assert.match(enterCriterion.description, /\(Validation Target\)/, "the ENTER description must visibly show the qualifier");
  assert.match(threshold.enterSummary, /\(Validation Target\)/);

  // AVOID's own recommendation-derived criterion must show the SAME
  // visible qualifier -- this is the concrete text-consistency gap this
  // task closes.
  const avoidCriterion = threshold.avoidConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.ok(avoidCriterion);
  assert.equal(avoidCriterion.provenance, "validationTarget");
  assert.match(avoidCriterion.description, /\(Validation Target\)/, "the AVOID description must ALSO visibly show the qualifier, not just ENTER");
});

test("TASK #51: a report-stated threshold resting on a disclosed planning assumption is now VISIBLY labeled '(Planning Assumption)' in its own description text, not only on the structured provenance field", () => {
  const assumptionState = buildCanonicalState({
    marketSizing: { ...defaultMarketSizing, samMethod: "defaultAssumption", somStatus: "calculated" },
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
  });
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(assumptionState);
  const reportCriterion = threshold.enterConditions.find((c) => c.dimension === "reportStatedThreshold");
  assert.ok(reportCriterion);
  assert.equal(reportCriterion.provenance, "planningAssumption");
  assert.match(reportCriterion.description, /\(.*Planning Assumption.*\)/, "the report-stated description must visibly show the planning-assumption qualifier");
});

// --- 2. Verified threshold stays verified ---

test("TASK #51: a citation-backed recommendation figure is classified 'verifiedEvidence' and its ENTER/AVOID text is never mislabeled as an assumption or validation target", () => {
  const state = buildCanonicalState({
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
  const validation = buildValidation(PAID_PILOT_ITEM, state, {
    ...extractRecommendationSignals(PAID_PILOT_ITEM),
    evidenceTie: "Confirmed by [R4].",
  });
  assert.equal(validation.provenance, "verifiedEvidence");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(state, [validation]);
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(enterCriterion.provenance, "verifiedEvidence");
  assert.match(enterCriterion.description, /\(Verified Evidence\)/);
  assert.doesNotMatch(enterCriterion.description, /Planning Assumption|Validation Target/);

  const avoidCriterion = threshold.avoidConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(avoidCriterion.provenance, "verifiedEvidence");
  assert.match(avoidCriterion.description, /\(Verified Evidence\)/);
});

// --- 3. Unrelated numeric recommendation cannot become the controlling threshold ---

test("TASK #51: an unrelated technical recommendation's own numeric KPI can never become the Obtainable Share threshold -- Task #50's semantic gate remains intact", () => {
  const technicalItem =
    "Vertical Technical Pilot: run a technical pilot extracting key terms from compliance clauses over 8 weeks (Owner: Head of Product) — Success criterion: 85% extraction accuracy.";
  const technical = buildValidation(technicalItem);
  assert.equal(technical.relatedEvidenceGapId, null, "a technical-performance metric must never link to the capture-rate-only Obtainable Share gap");

  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [technical]);
  assert.doesNotMatch(threshold.enterSummary, /85%/);
  assert.doesNotMatch(threshold.avoidSummary, /85%/);
});

test("TASK #51: a research-type recommendation with an unrelated dollar figure can never become the controlling threshold either", () => {
  const researchItem = "Commission a desk-research report on adjacent verticals over 3 months (Owner: Head of Strategy) — Budget cap $500,000.";
  const research = buildValidation(researchItem);
  assert.equal(research.relatedEvidenceGapId, null, "a research action type never links to any gap");
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [research]);
  assert.doesNotMatch(threshold.enterSummary, /\$500,000/);
});

// --- 4. Closure Plan and Decision Threshold identical in KPI + value + provenance ---

test("TASK #51: Closure Plan's measurableSuccessCriterion/failureCriterion are BYTE-IDENTICAL to the Decision Threshold's own enterSummary/avoidSummary -- including the visible provenance qualifier -- never independently reconstructed", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validation]);
  assert.equal(plan.measurableSuccessCriterion, threshold.enterSummary);
  assert.equal(plan.failureCriterion, threshold.avoidSummary);
  assert.equal(plan.monitorStatus, threshold.monitorSummary);
  assert.match(plan.measurableSuccessCriterion, /\(Validation Target\)/);
  assert.match(plan.failureCriterion, /\(Validation Target\)/);
});

test("TASK #51: Closure Plan's own owner/timeline/budget provenance suffix matches the SAME provenance value used in the Decision Threshold's ENTER criterion", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const threshold = resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validation]);
  const enterCriterion = threshold.enterConditions.find((c) => c.dimension === "recommendationValidationTarget");
  assert.equal(enterCriterion.provenance, validation.provenance);
  assert.match(plan.timeline, /\(Validation Target\)$/);
  assert.match(plan.budget, /\(Validation Target\)$/);
});

// --- 5. UI/PDF parity -------------------------------------------------------

test("TASK #51: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan/resolveMarketIntelligenceControllingDecisionThreshold results -- no renderer independently parses prose to construct its own threshold or provenance label", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceControllingDecisionThreshold\(/, `${name}: must call the shared threshold resolver`);
    assert.match(source, /resolveMarketIntelligenceControllingClosurePlan\(/, `${name}: must call the shared closure-plan resolver`);
  }
  const plannerThresholdOccurrences = (plannerSource.match(/resolveMarketIntelligenceControllingDecisionThreshold\(/g) || []).length;
  assert.ok(plannerThresholdOccurrences >= 2, "Planner.tsx must call the threshold resolver from both its web and PDF paths");
});

// --- 6. MONITOR/50% real-report behavior unchanged --------------------------

test("TASK #51: canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50, and Obtainable Share (SAM/SOM) remains the sole controlling factor -- unaffected by the provenance-text fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
  assert.equal(materialGaps[0].label, "Obtainable Share (SAM/SOM)");
});

test("TASK #51: resolving the controlling decision threshold and closure plan never mutates canonical decision, confidence, or decisionCriticalEvidence", () => {
  const validation = buildValidation(PAID_PILOT_ITEM);
  const before = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  resolveMarketIntelligenceControllingDecisionThreshold(REAL_STATE, [validation]);
  resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [validation]);
  const after = JSON.stringify({
    decision: REAL_STATE.decision,
    confidence: REAL_STATE.confidence,
    decisionCriticalEvidence: REAL_STATE.decisionCriticalEvidence,
  });
  assert.equal(before, after);
});
