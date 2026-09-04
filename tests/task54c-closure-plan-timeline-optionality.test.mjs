import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveMarketIntelligenceEvidenceGaps,
  resolveMarketIntelligenceControllingClosurePlan,
  resolveMarketIntelligenceMultiGapPriorityState,
  resolveMarketIntelligenceEnterEligibility,
  classifyStrategicRecommendationValidation,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #54C -- Fix real-report Closure Plan fallback regression when
// linked recommendations exist.
//
// ROOT CAUSE (confirmed live against a THIRD real report): a genuine
// "First 90 Days"-style set of 3 validation/pilot actions -- Buyer
// Validation Program, Pricing & Willingness-to-Pay Test, Integration
// Gating Proof -- all structurally linked to the sole controlling gap
// (Obtainable Share (SAM/SOM)), each with a real owner and budget, but
// NONE naming a separate timeline at all. selectAuthoritativeClosurePlanValidation's
// own Stage 1 (since Task #47A) required owner AND timeline BOTH present
// as a single hard prerequisite -- with every candidate missing
// timeline, `eligible.length === 0` for every one of them, and
// selection abstained to "Not yet assigned"/"No timeline committed yet"
// even though 3 real owners were available.
//
// EXACT REJECTION CONDITION: `pool.filter((validation) => validation.owner.trim()
// && validation.timeline.trim())` evaluated to an empty array whenever
// EVERY linked candidate lacks a timeline, regardless of how complete
// they otherwise are.
//
// FIX: split the combined hard prerequisite. Owner alone remains the
// one genuine hard prerequisite (a Closure Plan naming no WHO at all
// has nothing meaningful to assign); timeline becomes a preference
// stage, ordered directly after owner, using the SAME
// narrowByStructuralCompleteness pattern every other completeness stage
// already uses -- it only narrows the pool when it actually
// distinguishes a candidate, never eliminates every candidate merely
// because none of them names one. resolveClosurePlanAssignment (Task
// #47) is completely unchanged: it already renders a missing timeline
// as the honest "No timeline committed yet." sentence for whichever
// candidate wins, so nothing new needs to be fabricated -- the fix is
// entirely in which candidate is ALLOWED to win, never in what text is
// shown for a field that candidate itself does not have.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);

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

// The real single-controlling-gap report state (unchanged across Tasks
// #35-#54B): decision CONDITIONAL_GO (MONITOR), confidence 50,
// Obtainable Share the sole material gap. Deliberately names no
// explicit threshold figure of its own, so the fix must resolve the
// real candidate-selection failure on the new timeline-optionality
// stage alone, never relying on Task #47C's numeric-threshold
// tiebreaker to coincidentally save the day.
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
    immediateNextAction: "Run the pricing and willingness-to-pay test before committing further budget.",
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

// The exact real-report shape: 3 linked validation actions, each with a
// real owner and budget, NONE naming a timeline at all.
const BUYER_VALIDATION_ITEM =
  "Buyer Validation Program: run structured buyer interviews and pilot outreach to validate obtainable share among target buyers (Owner: Head of Product) — Budget cap $75,000 (estimated).";
const PRICING_WTP_ITEM =
  "Pricing & Willingness-to-Pay Test: run a pricing and willingness-to-pay test with prospective buyers to validate obtainable share (Owner: Head of Commercial) — Budget cap $15,000 (estimated) — Success criterion: 15% pilot conversion rate — Evidence tie: buyer willingness-to-pay survey data.";
const INTEGRATION_GATING_ITEM =
  "Integration Gating Proof: run an integration gating proof-of-concept with named enterprise buyers to validate obtainable share (Owner: Head of Engineering) — Budget cap $50,000 (estimated) — Success criterion: 90% pilot-to-paid conversion following integration gating.";

function buildValidation(item, canonicalState = REAL_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

// --- Fixture sanity ----------------------------------------------------

test("TASK #54C (fixture sanity): all 3 real-report actions structurally link to Obtainable Share, each with a real owner, none with a timeline", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);

  for (const v of [buyer, pricing, integration]) {
    assert.equal(v.relatedEvidenceGapId, "obtainable-share");
    assert.ok(v.owner, "each action must carry a real owner for this to reproduce the real defect");
    assert.equal(v.timeline, "", "each action must carry NO timeline -- the exact real-report shape");
  }
  assert.equal(buyer.successCriterion, "", "the vague 'measurable validation criteria' phrasing yields no structured metric");
  assert.match(pricing.successCriterion, /15%/);
  assert.match(integration.successCriterion, /90%/);
  assert.match(pricing.evidenceTie, /willingness-to-pay/i);
  assert.equal(integration.evidenceTie, "");
});

// --- A. multiple linked, owner-only (no timeline) -> must not become unassigned ---

test("TASK #54C-A: reproduces the REAL failure and proves the fix -- 3 recommendations linked to Obtainable Share, all with real owners and no timeline, no longer collapse the Closure Plan to 'Not yet assigned'", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");

  assert.ok(plan);
  assert.equal(plan.gapId, "obtainable-share");
  assert.equal(plan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.ok(!/not yet assigned/i.test(plan.owner));
});

test("TASK #54C-A: candidate order does not change the outcome", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);

  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [integration, buyer, pricing], "English");
  const planC = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [pricing, integration, buyer], "English");
  for (const plan of [planA, planB, planC]) {
    assert.equal(plan.owner, "Head of Commercial");
  }
});

// --- B. best linked candidate: owner + budget + metric, no timeline -> inherit, timeline stays unresolved ---

test("TASK #54C-B: the winning candidate (Pricing & Willingness-to-Pay Test -- the only one with BOTH a measurable success metric AND an evidence tie) has its real owner/budget/success-metric/evidence-tie inherited, while timeline remains honestly unresolved -- never fabricated", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");

  assert.equal(plan.owner, "Head of Commercial");
  assert.match(plan.timeline, /no timeline committed/i, "timeline must never be invented for a candidate that genuinely has none");
  assert.match(plan.budget, /\$15,000/, "budget must be inherited from the SAME winning candidate");
  assert.equal(plan.evidenceTie, "buyer willingness-to-pay survey data");
  assert.match(plan.measurableSuccessCriterion, /15%/);
});

// --- C. a weaker generic conditional action cannot outrank a validation/pilot action ---

test("TASK #54C-C: a generic conditional-execution action can never outrank a genuine validation/pilot action, even with a complete owner/timeline/metric profile", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  // Constructed directly (bypassing resolveLinkedEvidenceGap's own real
  // linkage gate, which already refuses to link a non-validation/pilot
  // action at all) to exercise selectAuthoritativeClosurePlanValidation's
  // OWN actionType stage directly, per its own documented defensive
  // purpose.
  const genericConditional = {
    ...buildValidation("Monitor obtainable share validation efforts and continue existing operations (Owner: Head of Operations) — Timeline: 90 days — Success criterion: 50% engagement rate."),
    actionType: "conditional_execution",
    relatedEvidenceGapId: "obtainable-share",
  };

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [genericConditional, pricing, buyer], "English");
  assert.notEqual(plan.owner, "Head of Operations");
});

// --- D. an unrelated recommendation with complete metadata cannot outrank a linked one ---

test("TASK #54C-D: an unrelated (research-type, unlinked) recommendation with a complete owner/timeline/metric profile can never outrank an explicitly linked recommendation that lacks a timeline", () => {
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const unrelated = buildValidation(
    "Commission a desk-research report benchmarking adjacent verticals over 3 months (Owner: Head of Strategy) — Success criterion: 5 comparable companies identified."
  );
  assert.equal(unrelated.relatedEvidenceGapId, null, "an unlinked research action must never structurally link to the gap");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [unrelated, pricing], "English");
  assert.equal(plan.owner, "Head of Commercial");
  assert.notEqual(plan.owner, "Head of Strategy");
});

// --- E. a linked candidate WITH a valid timeline is still inherited ------

test("TASK #54C-E: when the winning candidate DOES have a real timeline, it is inherited exactly as before -- this fix only ever relaxes a MISSING timeline, never ignores a present one", () => {
  const pricingWithTimeline = buildValidation(
    "Pricing & Willingness-to-Pay Test: run a pricing and willingness-to-pay test with prospective buyers to validate obtainable share over 90 days (Owner: Head of Commercial) — Budget cap $15,000 (estimated) — Success criterion: 15% pilot conversion rate — Evidence tie: buyer willingness-to-pay survey data."
  );
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  assert.ok(pricingWithTimeline.timeline, "fixture sanity: this variant must genuinely carry a timeline");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricingWithTimeline], "English");
  assert.equal(plan.owner, "Head of Commercial");
  assert.ok(plan.timeline.startsWith("90 days"));
});

// --- F. genuinely no qualifying linked recommendation -> unassigned fallback remains valid ---

test("TASK #54C-F: when NO linked recommendation carries an owner at all, the honest 'not yet assigned' fallback remains valid -- owner alone is still the one genuine hard prerequisite", () => {
  const noOwnerA = buildValidation("Run structured buyer interviews to validate obtainable share.");
  const noOwnerB = buildValidation("Run a pricing willingness-to-pay survey to validate obtainable share.");
  assert.equal(noOwnerA.relatedEvidenceGapId, "obtainable-share");
  assert.equal(noOwnerA.owner, "");
  assert.equal(noOwnerB.owner, "");

  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [noOwnerA, noOwnerB], "English");
  assert.ok(plan);
  assert.equal(plan.hasAssignedOwner, false);
  assert.match(plan.owner, /not yet assigned/i);
  assert.match(plan.timeline, /no timeline committed/i);
});

test("TASK #54C-F (continued): zero linked recommendations at all keep the same honest fallback as before", () => {
  const unrelated = buildValidation("Commission a market-growth research report over 3 months.");
  assert.equal(unrelated.relatedEvidenceGapId, null);
  const plan = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [unrelated], "English");
  assert.equal(plan.hasAssignedOwner, false);
});

// --- G. web and PDF consume identical canonical closure-plan state --------

test("TASK #54C-G: web (page.tsx, Planner.tsx) and PDF (Planner.tsx, ReportPdfButton.tsx) all consume the SAME resolveMarketIntelligenceControllingClosurePlan result -- no renderer-specific candidate selection exists anywhere", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /function selectAuthoritativeClosurePlanValidation/, `${name}: must not duplicate the selector`);
    assert.doesNotMatch(source, /function resolveClosurePlanAssignment/, `${name}: must not duplicate the assignment resolver`);
  }
});

test("TASK #54C-G (continued): the resolved Closure Plan is byte-identical across repeated resolutions for the same candidate set -- deterministic, not renderer-dependent", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);
  const planA = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");
  const planB = resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");
  assert.deepEqual(planA, planB);
});

// --- H. decision remains MONITOR / 50%, ENTER remains fail-closed ---------

test("TASK #54C-H: canonical decision remains MONITOR-equivalent (CONDITIONAL_GO), confidence remains 50%, and Obtainable Share remains the sole controlling factor -- completely unaffected by this Closure Plan fix", () => {
  assert.equal(REAL_STATE.decision, "CONDITIONAL_GO");
  assert.equal(REAL_STATE.confidence, 50);
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(REAL_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 1);
  assert.equal(materialGaps[0].id, "obtainable-share");
});

test("TASK #54C-H: ENTER eligibility remains fail-closed -- a fully populated Closure Plan (real owner, budget, metric, evidence tie) never satisfies the underlying decision-critical gate on its own", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);
  resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");

  const eligibility = resolveMarketIntelligenceEnterEligibility(REAL_STATE, [buyer, pricing, integration], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.blockingGaps.length, 1);
  assert.equal(eligibility.blockingGaps[0].id, "obtainable-share");
});

// --- Purity / no fabrication -------------------------------------------

test("TASK #54C: resolveMarketIntelligenceControllingClosurePlan never mutates canonicalState or any validation object", () => {
  const buyer = buildValidation(BUYER_VALIDATION_ITEM);
  const pricing = buildValidation(PRICING_WTP_ITEM);
  const integration = buildValidation(INTEGRATION_GATING_ITEM);
  const before = JSON.stringify({ state: REAL_STATE, buyer, pricing, integration });
  resolveMarketIntelligenceControllingClosurePlan(REAL_STATE, [buyer, pricing, integration], "English");
  const after = JSON.stringify({ state: REAL_STATE, buyer, pricing, integration });
  assert.equal(before, after);
});

test("TASK #54C (drift check): selectAuthoritativeClosurePlanValidation's ONLY hard-filtering (length-reducing-to-zero-possible) stage is the owner check -- confirmed via source, timeline/metric/evidenceTie stages all use the narrow-only-if-distinguishing helper", () => {
  const fnSource = evidenceGapsSource.match(/function selectAuthoritativeClosurePlanValidation\([\s\S]*?\n\}/)[0];
  assert.match(fnSource, /if \(eligible\.length === 0\) return null;/);
  const timelineStage = fnSource.match(/narrowByStructuralCompleteness\(pool, \(validation\) => Boolean\(validation\.timeline\.trim\(\)\)\);/);
  assert.ok(timelineStage, "the timeline stage must use the same narrow-only-if-distinguishing helper as every other completeness preference");
});

// =============================================================================
// TASK #54C (SECOND FIX) -- the real runtime STILL failed after the fix
// above, confirmed live against a THIRD real report shape.
//
// SECOND ROOT CAUSE: the fix above only ever helps a candidate ALREADY
// linked (relatedEvidenceGapId already resolved) reach and win Closure
// Plan selection. The real report that still failed has TWO
// simultaneously unresolved decision-critical gaps (Market Sizing AND
// Obtainable Share), with Obtainable Share merely the CONTROLLING one
// among them -- resolveLinkedEvidenceGap's own MULTI-GAP path (Task
// #38) requires a candidate's own success-criterion figure to
// numerically equal a material gap's OWN report-stated threshold before
// it will ever link at all. When the report's own whatWouldChangeThisDecision
// text names NO explicit threshold for ANY material gap (gap.successThreshold
// is null for every one of them -- the common shape this whole file's
// own REAL_STATE fixture already deliberately reproduces), numeric
// matching is structurally IMPOSSIBLE for every candidate, so
// relatedEvidenceGapId never resolves for ANY of them, no matter how
// obviously relevant their own text is. This is a LINKAGE failure,
// upstream of and structurally distinct from the selection-layer fix
// above -- no amount of relaxing owner/timeline selection can recover a
// candidate that was never linked to the gap in the first place.
//
// EXACT REJECTION CONDITION: `if (!actionFigure) return null;` combined
// with `comparableThresholdFiguresMatch(actionFigure, null)` always
// being false (a gap with successThreshold: null can never numerically
// match anything) meant `numericMatches`/`semanticMatches` were empty
// for EVERY candidate whenever no material gap named an explicit
// figure.
//
// FIX: when numeric matching does not already produce a unique answer,
// resolveLinkedEvidenceGap now falls back to the SAME semantic-category
// vocabulary (Task #50's GAP_REQUIRED_EVIDENCE_CATEGORY/
// resolveRecommendationEvidenceCategories) the single-material-gap path
// already trusts -- requiring the candidate's own classified evidence
// category to EXCLUSIVELY identify exactly one material gap's own
// required category. Never a keyword/title scan; never guesses: a
// candidate with no classifiable category still correctly returns null.
// =============================================================================

const multiGapCoverage = {
  overallConfidence: 60,
  verifiedMarketSizeAvailable: false,
  dimensions: {
    marketConfidence: 60,
    competitiveEvidence: 60,
    financialEvidence: 60,
    productEvidence: 60,
    executionReadiness: 60,
    founderReadiness: 60,
  },
};

// The exact real report shape that escaped the first fix: TWO
// simultaneously unresolved decision-critical gaps (Market Sizing AND
// Obtainable Share), Obtainable Share the controlling one, neither gap
// naming an explicit numeric threshold anywhere in the decision brief.
const MULTI_GAP_STATE = buildCanonicalState({
  decisionCriticalEvidence: {
    marketSizingResolved: false,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  },
  coverage: multiGapCoverage,
});

// The exact real-report shape (minimized only after the failure was
// reproduced): "Proof-of-Value Integration Pilot" and "SOM & Channel
// Validation" carry real owners and budgets but no distinct,
// classifiable success metric at all; the third, unnamed action names a
// clear capture-rate criterion.
const PROOF_OF_VALUE_ITEM =
  "Proof-of-Value Integration Pilot: run an integration pilot with named enterprise buyers to validate obtainable share (Owner: Product Lead) — Budget cap $60,000 (estimated).";
const SOM_CHANNEL_ITEM =
  "SOM & Channel Validation: run channel-partner validation interviews to validate obtainable share (Owner: Head of Partnerships) — Budget cap $15,000 (estimated).";
const PAID_PILOT_COMMITMENT_ITEM =
  "Paid Pilot Commitment Test: run a paid pilot commitment test with named enterprise buyers to validate obtainable share (Owner: Head of Sales) — Success criterion: at least 20% willing to commit to a paid pilot at an average annual contract value of at least $10,000 each.";

test("TASK #54C-2 (fixture sanity): with TWO material gaps unresolved and NEITHER naming an explicit threshold, all 3 real-report actions still classify as validation-type, but only the one with a classifiable capture-rate criterion can structurally disambiguate which gap it addresses", () => {
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(MULTI_GAP_STATE, "English").filter((g) => g.decisionFactor !== null);
  assert.equal(materialGaps.length, 2);
  assert.ok(materialGaps.every((g) => g.successThreshold === null), "fixture sanity: neither gap states an explicit threshold");

  const proof = buildValidation(PROOF_OF_VALUE_ITEM, MULTI_GAP_STATE);
  const som = buildValidation(SOM_CHANNEL_ITEM, MULTI_GAP_STATE);
  const paid = buildValidation(PAID_PILOT_COMMITMENT_ITEM, MULTI_GAP_STATE);

  assert.equal(proof.actionType, "validation");
  assert.equal(som.actionType, "validation");
  assert.equal(paid.actionType, "validation");
  assert.equal(proof.successCriterion, "");
  assert.equal(som.successCriterion, "");
  assert.match(paid.successCriterion, /20%/);
});

test("TASK #54C-2: reproduces the REAL second failure and proves the fix -- with two simultaneously unresolved gaps and no report-stated threshold anywhere, the capture-rate-classifiable candidate still structurally links to Obtainable Share, and the Closure Plan resolves its real owner instead of falling back to 'Not yet assigned'", () => {
  const proof = buildValidation(PROOF_OF_VALUE_ITEM, MULTI_GAP_STATE);
  const som = buildValidation(SOM_CHANNEL_ITEM, MULTI_GAP_STATE);
  const paid = buildValidation(PAID_PILOT_COMMITMENT_ITEM, MULTI_GAP_STATE);

  assert.equal(paid.relatedEvidenceGapId, "obtainable-share", "the classifiable candidate must structurally link despite no numeric match being possible");
  assert.equal(proof.relatedEvidenceGapId, null, "an unclassifiable candidate must never be guessed into a specific gap among several");
  assert.equal(som.relatedEvidenceGapId, null, "an unclassifiable candidate must never be guessed into a specific gap among several");

  const priorityState = resolveMarketIntelligenceMultiGapPriorityState(MULTI_GAP_STATE, [proof, som, paid], "English");
  const shareEntry = priorityState.prioritized.find((entry) => entry.gap.id === "obtainable-share");
  assert.ok(shareEntry);
  assert.ok(shareEntry.closurePlan);
  assert.equal(shareEntry.closurePlan.hasAssignedOwner, true, "owner must resolve, not fall back to 'Not yet assigned'");
  assert.equal(shareEntry.closurePlan.owner, "Head of Sales");
  assert.ok(!/not yet assigned/i.test(shareEntry.closurePlan.owner));
  assert.match(shareEntry.closurePlan.timeline, /no timeline committed/i, "the winning candidate's own missing timeline is never fabricated");
});

test("TASK #54C-2: an unclassifiable candidate (no distinct success metric) can never be linked to a specific gap merely because it is the ONLY candidate present -- ambiguity with 2+ unresolved gaps is never silently resolved by elimination", () => {
  const proof = buildValidation(PROOF_OF_VALUE_ITEM, MULTI_GAP_STATE);
  assert.equal(proof.relatedEvidenceGapId, null);
});

test("TASK #54C-2 (drift check): the semantic-category fallback never fires when the numeric-match path already found a unique answer -- the existing, more precise mechanism from Task #47C/#48 is tried first and preserved unchanged", () => {
  const fnSource = evidenceGapsSource.match(/function resolveLinkedEvidenceGap\([\s\S]*?\n\}/)[0];
  const numericIdx = fnSource.indexOf("extractComparableThresholdFigure(successCriterion)");
  const categoryIdx = fnSource.indexOf("GAP_REQUIRED_EVIDENCE_CATEGORY[gap.id]");
  assert.notEqual(numericIdx, -1);
  assert.notEqual(categoryIdx, -1);
  assert.ok(numericIdx < categoryIdx, "numeric matching must be attempted before the semantic-category fallback");
});

test("TASK #54C-2 (drift check): the semantic-category fallback never reads a validation's raw item text -- only the already-extracted, structured successCriterion field, exactly like every other semantic check in this file", () => {
  const fnSource = evidenceGapsSource.match(/function resolveLinkedEvidenceGap\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fnSource, /\.item\b/);
});

test("TASK #54C-2: decision remains MONITOR-equivalent, confidence remains 50%, and ENTER eligibility remains fail-closed for the multi-gap fixture -- this linkage fix never touches the decision layer", () => {
  assert.equal(MULTI_GAP_STATE.decision, "CONDITIONAL_GO");
  assert.equal(MULTI_GAP_STATE.confidence, 50);
  const proof = buildValidation(PROOF_OF_VALUE_ITEM, MULTI_GAP_STATE);
  const som = buildValidation(SOM_CHANNEL_ITEM, MULTI_GAP_STATE);
  const paid = buildValidation(PAID_PILOT_COMMITMENT_ITEM, MULTI_GAP_STATE);
  const eligibility = resolveMarketIntelligenceEnterEligibility(MULTI_GAP_STATE, [proof, som, paid], "English");
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.blockingGaps.length, 2);
});
