import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceDecisionThresholds,
  resolveMarketIntelligenceDecisionThresholdState,
  classifyStrategicRecommendationValidation,
  localizeRecommendationProvenance,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";

// TASK #38 -- Structurally connect Strategic Recommendation metrics to
// Evidence Gaps and decision thresholds.
//
// classifyStrategicRecommendationValidation wraps Task #31's
// classifyStrategicRecommendationAction (never replaces or duplicates its
// classification logic) with: a finer provenance taxonomy, and a link to
// the SAME canonical evidence-gap/threshold objects Tasks #35-#37 already
// compute -- never a second, independently re-parsed prose-matching
// system. These tests focus on the linkage's own safety guarantees: it
// only ever fires when structurally unambiguous (exactly one material
// gap, an evidence-gathering action type), and a card's own free text
// has zero influence on WHICH gap it links to.

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
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
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
  };
}

const pilotSignals = {
  budget: "$75,000",
  metric: "20% pilot conversion rate",
  timeframe: "8 weeks",
  owner: "Head of Sales",
  gate: "",
  activity: "pilot",
  evidenceTie: "",
};

// --- Recommendation -> evidence-gap structural linkage ---

test("a validation/pilot-type recommendation links to the SAME single material evidence gap resolveMarketIntelligenceEvidenceGaps already produces", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Run an 8-week pilot with 20% target conversion rate to validate obtainable share.",
    signals: pilotSignals,
    canonicalState: state,
  });
  assert.ok(["validation", "pilot"].includes(validation.actionType));
  assert.equal(validation.relatedEvidenceGapId, "obtainable-share");
  assert.ok(validation.relatedDecisionThreshold);
  assert.equal(validation.relatedDecisionThreshold.gapId, "obtainable-share");
});

// --- Controlling-gap linkage ---

test("REAL FIXTURE (MONITOR/50%, SAM/SOM unresolved): the linked gap and threshold are identical to Task #37's own controllingUnresolvedCondition", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Run a pilot to validate obtainable share.",
    signals: pilotSignals,
    canonicalState: state,
  });
  const thresholdState = resolveMarketIntelligenceDecisionThresholdState(state);
  assert.equal(validation.relatedEvidenceGapId, thresholdState.controllingUnresolvedCondition.factor && "obtainable-share");
  assert.equal(thresholdState.controllingUnresolvedCondition.label, validation.relatedDecisionThreshold.gapLabel);
  assert.deepEqual(
    validation.relatedDecisionThreshold,
    resolveMarketIntelligenceDecisionThresholds(state).find((t) => t.gapId === "obtainable-share")
  );
});

test("no link when zero material gaps exist (fully resolved report) -- never fabricates a gap to link to", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
  });
  const validation = classifyStrategicRecommendationValidation({
    item: "Run a pilot.",
    signals: pilotSignals,
    canonicalState: state,
  });
  assert.equal(validation.relatedEvidenceGapId, null);
  assert.equal(validation.relatedDecisionThreshold, null);
});

test("no link when TWO OR MORE material gaps are unresolved -- never guesses which one a card relates to", () => {
  const state = buildCanonicalState({
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: true },
    marketSizing: null,
  });
  const validation = classifyStrategicRecommendationValidation({
    item: "Run a pilot.",
    signals: pilotSignals,
    canonicalState: state,
  });
  assert.equal(validation.relatedEvidenceGapId, null);
  assert.equal(validation.relatedDecisionThreshold, null);
});

test("no link for non-evidence-gathering action types (scale/research), even with exactly one material gap", () => {
  const state = buildCanonicalState();

  const researchValidation = classifyStrategicRecommendationValidation({
    item: "Commission a desk research report on the competitive landscape.",
    signals: { ...pilotSignals, activity: "research" },
    canonicalState: state,
  });
  assert.equal(researchValidation.actionType, "research");
  assert.equal(researchValidation.relatedEvidenceGapId, null);

  const scaleValidation = classifyStrategicRecommendationValidation({
    item: "Scale up nationally and hire a team of 20.",
    signals: { ...pilotSignals, activity: "scale" },
    canonicalState: state,
  });
  // MONITOR downgrades a raw "scale" classification to
  // "conditional_execution" (Task #31) -- neither is in the
  // evidence-gathering allowlist, so it must never link either.
  assert.notEqual(scaleValidation.actionType, "validation");
  assert.notEqual(scaleValidation.actionType, "pilot");
  assert.equal(scaleValidation.relatedEvidenceGapId, null);
});

// --- Planning target vs verified evidence distinction ---

test("a pilot/validation action's OWN unevidenced numeric target classifies as 'validationTarget', never silently presented as fact", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Run an 8-week pilot targeting a 20% conversion rate.",
    signals: pilotSignals, // evidenceTie is empty -- no citation backs this number
    canonicalState: state,
  });
  assert.equal(validation.numericBasis, "planning_assumption");
  assert.equal(validation.provenance, "validationTarget");
  assert.equal(localizeRecommendationProvenance(validation.provenance), "Validation Target");
});

test("a non-validation/pilot action's unevidenced numeric figure remains a plain 'planningAssumption' -- Task #31's original meaning is unchanged", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Continue day-to-day operations with existing budget allocation.",
    signals: { ...pilotSignals, activity: "conditional execution", evidenceTie: "" },
    canonicalState: state,
  });
  assert.notEqual(validation.actionType, "validation");
  assert.notEqual(validation.actionType, "pilot");
  assert.equal(validation.numericBasis, "planning_assumption");
  assert.equal(validation.provenance, "planningAssumption");
});

test("a numeric figure genuinely tied to a real citation classifies as 'verifiedEvidence' -- never confused with a planning target", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Confirmed by internal pilot data [R4].",
    signals: { ...pilotSignals, evidenceTie: "Confirmed by [R4]." },
    canonicalState: state,
  });
  assert.equal(validation.numericBasis, "evidence");
  assert.equal(validation.provenance, "verifiedEvidence");
});

test("a card with no numeric content at all gets a null provenance -- nothing to classify, never forced into one of the 4 buckets", () => {
  const state = buildCanonicalState();
  const validation = classifyStrategicRecommendationValidation({
    item: "Coordinate with legal on contract terms.",
    signals: { budget: "", metric: "", timeframe: "", owner: "Legal", gate: "", activity: "", evidenceTie: "" },
    canonicalState: state,
  });
  assert.equal(validation.numericBasis, "none");
  assert.equal(validation.provenance, null);
});

// --- No fragile prose matching ---

test("the linkage is driven ONLY by actionType + material-gap count -- changing the recommendation's own wording never changes which gap it links to", () => {
  const state = buildCanonicalState();
  const withMentionOfGap = classifyStrategicRecommendationValidation({
    item: "Run a pilot specifically to validate Obtainable Share (SAM/SOM).",
    signals: pilotSignals,
    canonicalState: state,
  });
  const withUnrelatedWording = classifyStrategicRecommendationValidation({
    item: "Run a pilot to see what happens with completely unrelated wording about widgets.",
    signals: pilotSignals,
    canonicalState: state,
  });
  assert.equal(withMentionOfGap.relatedEvidenceGapId, withUnrelatedWording.relatedEvidenceGapId);
  assert.equal(withMentionOfGap.relatedEvidenceGapId, "obtainable-share");
});

test("STRUCTURAL AUDIT: resolveLinkedEvidenceGap's own module never keyword-scans recommendation item/action text (no .includes/.match against `item` or `signals.activity` inside the linkage logic)", () => {
  const evidenceGapsSource = readSourceFile("../app/lib/report-engine/market-intelligence-evidence-gaps.ts");
  const linkageFunctionMatch = evidenceGapsSource.match(
    /function resolveLinkedEvidenceGap\([\s\S]*?\n\}/
  );
  assert.ok(linkageFunctionMatch, "expected to find resolveLinkedEvidenceGap's own function body");
  assert.doesNotMatch(linkageFunctionMatch[0], /item\.|item,|\.includes\(|\.match\(/);
});

// --- Missing threshold case ---

test("a null canonicalState still classifies provenance from numericBasis alone, with relatedEvidenceGapId/relatedDecisionThreshold both null", () => {
  const validation = classifyStrategicRecommendationValidation({
    item: "Run an 8-week pilot targeting a 20% conversion rate.",
    signals: pilotSignals,
    canonicalState: null,
  });
  assert.equal(validation.evidenceBasis, "unavailable");
  assert.equal(validation.relatedEvidenceGapId, null);
  assert.equal(validation.relatedDecisionThreshold, null);
  // Provenance can still be computed (validation/pilot -> validationTarget)
  // purely from actionType + numericBasis, neither of which requires
  // canonical state.
  assert.equal(validation.provenance, "validationTarget");
});

// --- Web/PDF parity ---

test("STRUCTURAL AUDIT: all 4 render sites (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx PDF) call classifyStrategicRecommendationValidation, never the bare Task #31 classifier, for Market Intelligence cards", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /classifyStrategicRecommendationValidation\(/, `${name}: must call classifyStrategicRecommendationValidation`);
  }
  const plannerCallSites = plannerSource.match(/classifyStrategicRecommendationValidation\(/g) || [];
  assert.ok(plannerCallSites.length >= 2, "Planner.tsx must call it from both its web and PDF render paths");
});

test("STRUCTURAL AUDIT: the gap-link badge (→ gapLabel) on every render surface traces to classification.relatedEvidenceGapId/relatedDecisionThreshold, never a separately re-derived value", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /classification(?:\?)?\.relatedEvidenceGapId/, `${name}: must gate the gap badge on classification.relatedEvidenceGapId`);
    assert.match(source, /classification\.relatedDecisionThreshold/, `${name}: must display classification.relatedDecisionThreshold's own gapLabel`);
  }
});

test("resolveMarketIntelligenceEvidenceGaps and resolveMarketIntelligenceDecisionThresholds remain fully independent of, and unaffected by, classifyStrategicRecommendationValidation -- calling the new function never mutates canonical state or prior results", () => {
  const state = buildCanonicalState();
  const gapsBefore = resolveMarketIntelligenceEvidenceGaps(state);
  const thresholdsBefore = resolveMarketIntelligenceDecisionThresholds(state);
  classifyStrategicRecommendationValidation({ item: "Run a pilot.", signals: pilotSignals, canonicalState: state });
  const gapsAfter = resolveMarketIntelligenceEvidenceGaps(state);
  const thresholdsAfter = resolveMarketIntelligenceDecisionThresholds(state);
  assert.deepEqual(gapsBefore, gapsAfter);
  assert.deepEqual(thresholdsBefore, thresholdsAfter);
});
