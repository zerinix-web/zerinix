import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceMultiGapPriorityState,
  resolveMarketIntelligenceEnterEligibility,
  resolveMarketIntelligenceDecisionGateEvaluations,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #55A -- Fix the real-report Closure Plan regression exposed
// alongside Task #55, without weakening the decision-transition
// architecture.
//
// ROOT CAUSE (confirmed live against a FOURTH real report, reproduced
// end to end below): the report has TWO simultaneously unresolved
// decision-critical gaps (Market Sizing AND Obtainable Share),
// Obtainable Share the controlling one. Task #54C's own multi-gap
// linkage fallback (resolveLinkedEvidenceGap) classifies ONLY
// `successCriterion` through the curated evidence-category vocabulary
// (Task #50) to disambiguate which of the 2+ unresolved gaps a
// candidate addresses when no numeric match is possible. The real
// "Pilot Action" (Owner: Head of BD, Timeline: 90 days, Budget:
// $50,000, Evidence tie: "mid-market price bands / ContractSafe /
// BindLegal pricing signals") names NO separate, distinct success
// metric at all -- its entire measurable signal lives in its Evidence
// Tie, a field Task #54C's fallback never examined. With
// successCriterion empty, resolveRecommendationEvidenceCategories
// returned an empty set, the fallback could not disambiguate between
// Market Sizing and Obtainable Share, and relatedEvidenceGapId stayed
// null -- exactly reproducing "Owner: Not yet assigned"/"No timeline
// committed yet." despite a fully real, complete, structurally linked
// candidate existing. Task #55 itself never touched this code path (it
// only added resolutionOutcome to a completely separate function) --
// this is a pre-existing Task #54C gap that this specific real report
// happened to expose.
//
// FIX: resolveLinkedEvidenceGap's multi-gap semantic-category fallback
// now classifies BOTH successCriterion AND evidenceTie together --
// evidenceTie is exactly as structured and explicitly labeled as
// successCriterion (both extracted by extractRecommendationSignals'
// identical "Label: value" parsing), so reading it is not a new prose-
// similarity engine, it is reading a second existing structured field.
// CAPTURE_RATE_EVIDENCE_PATTERN additionally gained "willingness-to-pay"/
// "pricing signal(s)"/"price band(s)" -- established, real-world
// market-validation vocabulary directly analogous to "paid pilot"/"win
// rate", already in that curated list. A candidate whose evidenceTie
// ALSO names nothing classifiable (e.g. the real report's second
// action, "SOM Validation Research": owner + timeline + budget only, no
// evidence tie) still correctly returns null -- this can never link two
// candidates to the same gap that don't both carry real, classifiable
// structured evidence, and never weakens the existing requirement that
// a link be structurally justified.

const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

const defaultMarketSizing = {
  tam: "$18 million",
  sam: "$4.5 million",
  som: "SOM not calculated: bottom-up obtainable-share inputs did not meet the evidence bar.",
  method: "bottomUp",
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

// (A) The real report shape: TWO simultaneously unresolved gaps, Market
// Sizing AND Obtainable Share, Obtainable Share the controlling one,
// decision MONITOR / confidence 50%, matching Task #55's own verified
// baseline exactly.
function buildCanonicalState(overrides = {}) {
  return {
    version: 3,
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    topRisks: ["Obtainable share has not been independently validated."],
    topReasons: ["Competitive evidence is resolved."],
    why: "Evidence supports conditional entry pending obtainable-share and market-sizing validation.",
    missingEvidence: ["Independent conversion data."],
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Run the pilot before committing further budget.",
    decisionCriticalEvidence: {
      marketSizingResolved: false,
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

// (B/C/D) The exact real-report shape: 2+ recommendations exist,
// structurally linked to Obtainable Share -- "Pilot Action" (owner +
// timeline + budget + evidence tie, no distinct success metric) and
// "SOM Validation Research" (owner + timeline + budget only, no
// evidence tie, no metric).
const PILOT_ACTION_ITEM =
  "Pilot Action: run a paid pilot with named mid-market buyers to validate obtainable share over 90 days (Owner: Head of BD) — Budget cap $50,000 (estimated) — Evidence tie: mid-market price bands / ContractSafe / BindLegal pricing signals.";
const SOM_VALIDATION_RESEARCH_ITEM =
  "SOM Validation Research: run structured market research interviews to validate obtainable share over 120 days (Owner: Market Research) — Budget cap $25,000 (estimated).";

function buildValidation(item, canonicalState = REAL_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity ----------------------------------------------------

test("TASK #55A (fixture sanity): the real report has TWO simultaneously unresolved gaps, Obtainable Share the controlling one, decision MONITOR / confidence 50% -- matching Task #55's own verified baseline", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 2);
  assert.ok(materialGaps.some((g) => g.id === "obtainable-share"));
  assert.ok(materialGaps.some((g) => g.id === "market-sizing"));
});

test("TASK #55A (fixture sanity): 'Pilot Action' names no distinct success metric at all -- its only measurable signal lives in its Evidence Tie", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  assert.equal(pilot.successCriterion, "");
  assert.match(pilot.evidenceTie, /pricing signals/);
  assert.equal(pilot.owner, "Head of BD");
  assert.equal(pilot.timeline, "90 days");
  assert.match(pilot.budget, /\$50,000/);
});

test("TASK #55A (fixture sanity): 'SOM Validation Research' has owner/timeline/budget but no metric and no evidence tie -- genuinely unclassifiable", () => {
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  assert.equal(som.successCriterion, "");
  assert.equal(som.evidenceTie, "");
  assert.equal(som.owner, "Market Research");
  assert.equal(som.timeline, "120 days");
});

// --- B/C. multiple recommendations, 2+ structurally linked to Obtainable Share ---

test("TASK #55A-B/C: reproduces the REAL failure and proves the fix -- 'Pilot Action' structurally links to Obtainable Share via its Evidence Tie even with two simultaneously unresolved gaps and no distinct success metric", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  assert.equal(pilot.relatedEvidenceGapId, "obtainable-share");
});

test("TASK #55A: 'SOM Validation Research' (no classifiable metric OR evidence tie) correctly remains unlinked -- ambiguity between 2 unresolved gaps is never silently resolved by elimination or title-matching", () => {
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  assert.equal(som.relatedEvidenceGapId, null);
});

// --- D/E. the eligible linked pilot action wins the Closure Plan ------------

test("TASK #55A-D/E: the Closure Plan selects the eligible linked 'Pilot Action' and inherits its real owner/timeline/budget/evidence-tie -- never the shared unassigned fallback", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);

  const priorityState = resolveMarketIntelligenceMultiGapPriorityState(REAL_STATE, [pilot, som], "English");
  const shareEntry = priorityState.prioritized.find((entry) => entry.gap.id === "obtainable-share");
  assert.ok(shareEntry);
  assert.ok(shareEntry.closurePlan);

  assert.equal(shareEntry.closurePlan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.equal(shareEntry.closurePlan.owner, "Head of BD");
  assert.ok(!/not yet assigned/i.test(shareEntry.closurePlan.owner));
  assert.ok(shareEntry.closurePlan.timeline.startsWith("90 days"));
  assert.ok(!/no timeline committed/i.test(shareEntry.closurePlan.timeline));
  assert.match(shareEntry.closurePlan.budget, /\$50,000/);
  assert.match(shareEntry.closurePlan.evidenceTie, /pricing signals/);
});

test("TASK #55A-D/E: candidate order does not change the outcome", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  const planA = resolveMarketIntelligenceMultiGapPriorityState(REAL_STATE, [pilot, som], "English")
    .prioritized.find((e) => e.gap.id === "obtainable-share").closurePlan;
  const planB = resolveMarketIntelligenceMultiGapPriorityState(REAL_STATE, [som, pilot], "English")
    .prioritized.find((e) => e.gap.id === "obtainable-share").closurePlan;
  assert.equal(planA.owner, planB.owner);
  assert.equal(planA.timeline, planB.timeline);
});

// --- F. fallback remains correct when genuinely no eligible linked recommendation exists ---

test("TASK #55A-F: when NEITHER candidate has any classifiable evidence at all (no metric, no evidence tie), the honest unassigned fallback remains valid -- ambiguity is never resolved by guessing", () => {
  const somOnlyItem =
    "Market Sizing Refresh: commission a market-sizing refresh over 60 days (Owner: Head of Strategy) — Budget cap $10,000 (estimated).";
  const pilotOnlyGeneric =
    "General Validation Pilot: run a validation pilot with prospective buyers over 90 days (Owner: Head of Sales) — Budget cap $30,000 (estimated).";
  const a = buildValidation(somOnlyItem);
  const b = buildValidation(pilotOnlyGeneric);
  assert.equal(a.relatedEvidenceGapId, null, "no classifiable signal at all -- must remain genuinely ambiguous between the 2 unresolved gaps");
  assert.equal(b.relatedEvidenceGapId, null);

  const priorityState = resolveMarketIntelligenceMultiGapPriorityState(REAL_STATE, [a, b], "English");
  const shareEntry = priorityState.prioritized.find((entry) => entry.gap.id === "obtainable-share");
  assert.ok(shareEntry);
  assert.ok(shareEntry.closurePlan);
  assert.equal(shareEntry.closurePlan.hasAssignedOwner, false);
  assert.match(shareEntry.closurePlan.owner, /not yet assigned/i);
  assert.match(shareEntry.closurePlan.timeline, /no timeline committed/i);
});

test("TASK #55A-F (continued): zero linked recommendations at all keep the same honest fallback", () => {
  const unrelated = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelated.relatedEvidenceGapId, null);
});

// --- Structural safety: evidence-tie-only linkage never mislinks an unrelated gap ---

test("TASK #55A: an action whose evidence tie classifies as market-size (not capture-rate) links to Market Sizing, never to Obtainable Share -- the fallback disambiguates correctly, never defaults to the controlling gap", () => {
  const marketSizeItem =
    "TAM Verification Pilot: run a pilot to validate market sizing with named enterprise buyers over 60 days (Owner: Head of Research) — Evidence tie: total addressable market benchmark data.";
  const validation = buildValidation(marketSizeItem);
  assert.equal(validation.relatedEvidenceGapId, "market-sizing");
  assert.notEqual(validation.relatedEvidenceGapId, "obtainable-share");
});

test("TASK #55A (drift check): the semantic-category fallback classifies successCriterion AND evidenceTie together -- confirmed via source", () => {
  const fnSource = evidenceGapsSource.match(/function resolveLinkedEvidenceGap\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /const classifiableText = \[successCriterion, evidenceTie\]\.filter\(Boolean\)\.join\(" "\);/);
  assert.doesNotMatch(fnSource, /\.item\b/, "must never read the raw item/title text");
});

test("TASK #55A (drift check): CAPTURE_RATE_EVIDENCE_PATTERN's new terms are narrow and curated, not a broad prose scan", () => {
  const patternSource = evidenceGapsSource.match(/const CAPTURE_RATE_EVIDENCE_PATTERN =[\s\S]*?;/)[0];
  assert.match(patternSource, /willingness/i);
  assert.match(patternSource, /pricing\\s\+signals/);
  assert.match(patternSource, /price\\s\+bands/);
});

// --- G. Task #55 transition tests remain unchanged and green ---------------

test("TASK #55A-G: Task #55's MONITOR/ENTER/AVOID architecture is completely untouched -- ENTER eligibility remains fail-closed for the real, unresolved multi-gap fixture", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [pilot, som], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.blockingGaps.length, 2);
});

test("TASK #55A-G: gate evaluation resolutionOutcome (Task #55) is unaffected by this Closure Plan linkage fix -- Obtainable Share still reads 'unresolved'", () => {
  const pilot = buildValidation(PILOT_ACTION_ITEM);
  const som = buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  const gates = resolveMarketIntelligenceDecisionGateEvaluations(REAL_STATE, [pilot, som], "English");
  const share = gates.find((g) => g.gateId === "obtainable-share");
  assert.equal(share.satisfied, false);
  assert.equal(share.resolutionOutcome, "unresolved");
});

test("TASK #55A-G: decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50%, unaffected by this Closure Plan linkage fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
});

// --- Web/PDF consume the same canonical object ------------------------------

test("TASK #55A: no render surface independently determines candidate linkage -- no duplication of resolveLinkedEvidenceGap anywhere", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /function resolveLinkedEvidenceGap/, `${name}: must not duplicate the linkage resolver`);
  }
});

// --- Purity -------------------------------------------------------------

test("TASK #55A: resolveLinkedEvidenceGap classification never mutates canonicalState", () => {
  const before = JSON.stringify(REAL_STATE);
  buildValidation(PILOT_ACTION_ITEM);
  buildValidation(SOM_VALIDATION_RESEARCH_ITEM);
  const after = JSON.stringify(REAL_STATE);
  assert.equal(before, after);
});
