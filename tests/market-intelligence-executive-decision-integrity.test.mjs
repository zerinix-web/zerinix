import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assessMarketEntryConfidence,
  buildMarketExecutiveDecisionBrief,
} from "../app/lib/report-engine/market-intelligence-presentation.ts";

// P0 FIX #4 -- Market Intelligence executive decision integrity repair.
//
// ROOT CAUSE (confirmed via forensic trace, research/evidence -> synthesis
// -> normalization -> decision calculation -> report state -> presentation):
// assessMarketEntryConfidence's weighted blend
// (marketConfidence*0.4 + competitiveEvidence*0.25 + financialEvidence*0.2
// + productEvidence*0.15, weights UNCHANGED by this fix) is a COMPENSATORY
// average -- strong evidence in some dimensions can offset another
// dimension that has effectively NO real evidence at all, since
// evaluateMarketResearchCoverage (market-research-coverage.ts) gives
// financialEvidence/productEvidence a hard floor (22+) even when zero
// qualifying evidence exists for that dimension. Worse, `coverage` (this
// function's only input before this fix) is a generic evidence-count/
// diversity/freshness signal computed INDEPENDENTLY of, and materially
// WEAKER than, the strict graph-level derivation that decides what the
// report actually SHOWS a reader for market sizing (P0 FIX #1's
// graph.planningEstimate/graph.verifiedMarketSize) and competitors (P0 FIX
// #3's graph.vendorIntelligence.vendors/adjacentPlayers). A blended score
// crossing the ENTER/AVOID threshold never by itself proved those two
// decision-critical pillars were resolved -- reproducing the exact
// reported defect: Decision ENTER, Confidence 67%, while TAM/SAM/SOM,
// CAGR, and Major Players all independently read "Validation Needed".
//
// FIX: assessMarketEntryConfidence now optionally accepts a
// DecisionCriticalEvidenceState (market sizing resolved? competitive
// evidence resolved?), sourced in route.ts directly from the same
// canonical graph fields P0 FIX #1/#3 already established as
// authoritative. When the blended decision is a strong directional call
// (ENTER or AVOID) but either pillar is unresolved, the decision is
// downgraded to MONITOR -- the system's own pre-existing neutral/
// conditional state, never a new vocabulary token. confidence itself is
// left completely untouched (not clamped, not reweighted) -- only the
// DIRECTIONAL claim built on top of it is gated. identifyMarketInformationGaps
// now also names the SPECIFIC decision-critical pillar that blocked a
// strong decision, so "why was this gated" is never left implicit.

function fixtureCoverage(overrides = {}) {
  return {
    evidenceCount: 12,
    verifiedSources: 6,
    independentDomains: 5,
    competitorBreadth: 4,
    sourceTypeDiversity: 3,
    claimCoverage: 70,
    freshnessScore: 80,
    averageQuality: 75,
    verifiedMarketSizeAvailable: true,
    dimensions: {
      marketConfidence: 72,
      competitiveEvidence: 65,
      financialEvidence: 60,
      productEvidence: 55,
      executionReadiness: 999,
      founderReadiness: 999,
    },
    overallConfidence: 68,
    sourceClasses: ["market_research", "government_statistics"],
    ...overrides,
  };
}

const marketSections = {
  executiveSummary: "",
  marketOverview: "",
  opportunities: "The addressable buyer base is large and underserved, creating a real growth opening.",
  threats: "A well-funded incumbent could respond quickly if this segment proves attractive.",
  marketDrivers: "Regulatory tailwinds are pushing adoption forward across the sector.",
};

// --- CASE A: strong positive evidence + sufficient completeness ------------

test("CASE A: strong positive evidence with both decision-critical pillars resolved -- ENTER is allowed exactly per the existing >=65 threshold, unmodified", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      financialEvidence: 85,
      productEvidence: 80,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  });

  assert.equal(result.decision, "ENTER");
  assert.equal(result.evidenceGapBlocksStrongDecision, false);
  assert.ok(result.confidence >= 65);
});

// --- CASE B: apparently positive signals + critical evidence missing -------

test("CASE B (the reported production defect, reproduced): a blended score that crosses the ENTER threshold (financialEvidence/productEvidence sitting only at evaluateMarketResearchCoverage's own evidence-absent floor) is blocked from ENTER when market sizing could not be defensibly established at the graph level", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      // financialEvidence/productEvidence at evaluateMarketResearchCoverage's
      // own real floor (22) for a dimension with zero qualifying evidence.
      financialEvidence: 22,
      productEvidence: 22,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const blendedOnly = assessMarketEntryConfidence(coverage);
  assert.equal(blendedOnly.decision, "ENTER", "sanity check: the blend alone crosses 65 and would produce ENTER -- this is the bug being fixed");
  assert.ok(blendedOnly.confidence >= 65);

  const gated = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  });
  assert.equal(gated.decision, "MONITOR", "a strong ENTER must never be produced while market sizing remains unresolved at the graph level");
  assert.equal(gated.evidenceGapBlocksStrongDecision, true);
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): a SEPARATE real production report proved that
  // gating only the decision LABEL is not enough on its own -- it read
  // "MONITOR: 63%" while Market Size, CAGR, TAM/SAM/SOM, and the
  // competitor table were ALL "Validation Needed", which still reads as
  // reasonably confident despite missing most of the core evidence.
  // Confidence is now capped (not reweighted or clamped for the
  // GENERAL case -- only in this specific, narrow evidence-gap state)
  // to a ceiling that scales with how much decision-critical evidence
  // is actually missing: <=50 when exactly one of the two pillars is
  // unresolved (this case), <=30 when both are. It must still be
  // strictly lower than the raw blend whenever a gap exists, and must
  // never exceed the moderate-gap ceiling.
  assert.ok(gated.confidence < blendedOnly.confidence, "confidence must be reduced, not left at the same misleadingly-high number, when a decision-critical pillar is unresolved");
  assert.ok(gated.confidence <= 50, "one unresolved pillar must cap confidence at the moderate ceiling");
});

// --- CASE C: strong negative evidence + sufficient completeness ------------

test("CASE C: strong negative evidence with both decision-critical pillars resolved -- AVOID is allowed exactly per the existing <40 threshold, unmodified", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 15,
      competitiveEvidence: 20,
      financialEvidence: 25,
      productEvidence: 18,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const result = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  });

  assert.equal(result.decision, "AVOID");
  assert.equal(result.evidenceGapBlocksStrongDecision, false);
  assert.ok(result.confidence < 40);
});

// --- CASE D: negative-looking partial evidence + major evidence gaps -------

test("CASE D: a blend that would read as AVOID is NOT treated as a confident negative verdict when the underlying gap is missing evidence, not negative evidence -- it is gated to MONITOR instead", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 20,
      competitiveEvidence: 15,
      financialEvidence: 22,
      productEvidence: 22,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const blendedOnly = assessMarketEntryConfidence(coverage);
  assert.equal(blendedOnly.decision, "AVOID", "sanity check: the blend alone falls below 40 and would produce AVOID");

  const gated = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: true,
  });
  assert.equal(gated.decision, "MONITOR", "missing evidence must never be silently converted into a confident negative (AVOID) verdict");
  assert.equal(gated.evidenceGapBlocksStrongDecision, true);
});

// --- CASE E: mixed evidence -> neutral/conditional existing state ----------

test("CASE E: a blend that already lands in the MONITOR band is unaffected by the gate either way -- MONITOR is not itself further downgraded or re-labeled, and evidenceGapBlocksStrongDecision is false since no strong decision was ever at stake", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 55,
      competitiveEvidence: 50,
      financialEvidence: 45,
      productEvidence: 50,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const withoutGate = assessMarketEntryConfidence(coverage);
  assert.equal(withoutGate.decision, "MONITOR");

  const withGate = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: true,
  });
  assert.equal(withGate.decision, "MONITOR");
  assert.equal(withGate.evidenceGapBlocksStrongDecision, false, "the gate only ever fires for a directional ENTER/AVOID call, never to re-flag an already-neutral MONITOR");
});

// --- CASE H: legacy confidence > threshold but critical evidence incomplete

test("CASE H: confidence comfortably above the legacy ENTER threshold (67, matching the reported production figure) is still gated to MONITOR when competitive evidence could not be independently validated at the graph level", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      financialEvidence: 22,
      productEvidence: 22,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const gated = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: true,
  });
  assert.equal(gated.decision, "MONITOR");
  assert.equal(gated.evidenceGapBlocksStrongDecision, true);
});

// --- Section 8: do not destroy partial positive evidence -------------------

test("partial positive evidence is preserved, not converted to negative: market sizing resolved + competitive evidence missing still gates to MONITOR (not AVOID), and confidenceFactors/missingEvidence correctly separate what IS supported from what is genuinely missing", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 90,
      competitiveEvidence: 92,
      financialEvidence: 22,
      productEvidence: 22,
      executionReadiness: 0,
      founderReadiness: 0,
    },
    verifiedMarketSizeAvailable: true,
  });
  const brief = buildMarketExecutiveDecisionBrief(marketSections, "English", coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: true,
  });

  assert.equal(brief.decision, "CONDITIONAL_GO", "gated MONITOR maps to CONDITIONAL_GO, never the destructive NO_GO");
  assert.ok(
    brief.missingEvidence.some((line) => /competitor|competitive/i.test(line)),
    "the missing-evidence list must name the specific unresolved pillar (competitive evidence), not a generic caveat"
  );
  assert.ok(
    !brief.missingEvidence.some((line) => /market-size figure \(TAM\/SAM\/SOM\) could not be established/i.test(line)),
    "market sizing, which IS resolved in this fixture, must not also be listed as a gap"
  );
});

// --- Investment Score integrity (Section 5) --------------------------------

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");

test("Investment Score integrity: Market Intelligence never computes/fabricates an Investment Score -- the KPI card shows the existing '—' placeholder with a validation-required badge, exactly the honest unavailable state this ticket requires (drift check: this is pre-existing, correct behavior, not modified by this fix)", () => {
  assert.match(
    pageSource,
    /const score = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: investmentScore\?\.totalScore \?\?/
  );
  assert.match(pageSource, /value: score === null \? "—" : `\$\{score\}\/100`/);
});

// --- Web/PDF decision parity (Section 9) -----------------------------------

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

test("PARITY: page.tsx and ReportPdfButton.tsx both resolve the Market Intelligence decision through the SAME resolveMarketIntelligenceExecutiveDecision call against the SAME canonical executiveSummary text this fix's gate writes into -- neither surface independently reconstructs a stronger decision from prose (drift check: this shared architecture is untouched by this fix)", () => {
  // TASK #24 -- both surfaces now call
  // resolveMarketIntelligenceGatedExecutiveDecision, which
  // prefers a persisted canonical decision and falls back to this exact
  // same resolveMarketIntelligenceExecutiveDecision (still the shared
  // vocabulary function underneath, confirmed exported unmodified) for
  // every report without one -- the parity guarantee is unchanged.
  assert.match(pageSource, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
  assert.match(pdfButtonSource, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(vocabularySource, /export function resolveMarketIntelligenceExecutiveDecision\(/);
});

// --- Decision Engine V2 shadow safety (Section 6/11) -----------------------

const routeSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);

test("DRIFT CHECK: Decision Engine V2 shadow-mode wiring (scheduleDecisionEngineV2ShadowMode) is untouched and remains diagnostic-only -- this fix never activates V2, never changes its kill switch, and never routes production output through it", () => {
  assert.match(routeSource, /scheduleDecisionEngineV2ShadowMode/);
});

// --- Structural pins for the new gate itself --------------------------------

const presentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

test("route.ts: resolveDecisionCriticalEvidenceState derives all three pillars from the canonical graph fields P0 FIX #1 (planningEstimate/verifiedMarketSize) and P0 FIX #3 (vendorIntelligence.vendors/adjacentPlayers) already established as authoritative -- never from `coverage`", () => {
  assert.match(
    routeSource,
    /marketSizingResolved:\s*\n\s*graph\.planningEstimate !== null \|\| graph\.verifiedMarketSize\.length > 0,/
  );
  assert.match(
    routeSource,
    /competitiveEvidenceResolved:\s*\n\s*graph\.vendorIntelligence\.vendors\.length > 0 \|\|\s*\n\s*graph\.vendorIntelligence\.adjacentPlayers\.length > 0,/
  );
});

// P0 PRODUCTION FIX -- confirmed live (Task #11, decision-vs-evidence
// consistency repair): the exact reported defect -- "Decision: ENTER" next
// to "Confidence: Validation Required" while the report's own text says
// SOM/obtainable share is unresolved -- was possible because
// marketSizingResolved only checked whether a TOTAL market-size figure
// existed, never whether the planning estimate's own SOM/obtainable-share
// step actually resolved. obtainableShareResolved closes that gap as a
// THIRD, independent pillar.
test("route.ts: resolveDecisionCriticalEvidenceState derives obtainableShareResolved from the planning estimate's own samMethod/somStatus -- trivially true when no planning estimate was attempted at all, false when one was attempted and SOM/obtainable-share did not resolve OR SAM itself was only a default assumption (Task #21: samMethod must be the genuine 'evidenceDerived' state, not merely 'not blocked')", () => {
  assert.match(
    routeSource,
    /obtainableShareResolved:\s*\n\s*graph\.planningEstimate === null \|\|\s*\n\s*\(graph\.planningEstimate\.samMethod === "evidenceDerived" &&\s*\n\s*graph\.planningEstimate\.somStatus === "calculated"\),/
  );
});

test("market-intelligence-presentation.ts: hasDecisionCriticalEvidenceGap now checks all three pillars (marketSizingResolved, competitiveEvidenceResolved, obtainableShareResolved) -- a report can no longer show a strong ENTER/AVOID merely because the two ORIGINAL pillars happen to be resolved while SOM/obtainable-share specifically is not", () => {
  assert.match(
    presentationSource,
    /return \(\s*\n\s*!state\.marketSizingResolved \|\| !state\.competitiveEvidenceResolved \|\| !state\.obtainableShareResolved\s*\n\s*\);/
  );
});

test("CASE I (the exact reported production defect): TAM/SAM resolved and competitive evidence resolved, but the planning estimate's own SOM/obtainable-share step is unresolved -- a strong ENTER must be gated to MONITOR even though both of the original two pillars are individually fine", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      financialEvidence: 85,
      productEvidence: 80,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const blendedOnly = assessMarketEntryConfidence(coverage);
  assert.equal(blendedOnly.decision, "ENTER", "sanity check: the blend alone crosses 65 and would produce an unconditional ENTER -- this is the bug being fixed");

  const gated = assessMarketEntryConfidence(coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });
  assert.equal(gated.decision, "MONITOR", "a strong ENTER must never be produced while SOM/obtainable-share remains unresolved, even with market sizing and competitive evidence both individually resolved");
  assert.equal(gated.evidenceGapBlocksStrongDecision, true);
  assert.ok(gated.confidence <= 50, "exactly one unresolved pillar caps confidence at the moderate ceiling");
  assert.ok(gated.confidence < blendedOnly.confidence);
});

test("CASE I continued: the MONITOR downgrade for an unresolved obtainableShareResolved pillar is not silent -- Strategic Recommendations' missing-evidence list correctly names SOM/obtainable-share as the reason, and does NOT also claim market sizing or competitive evidence are gaps when they are genuinely resolved", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      financialEvidence: 85,
      productEvidence: 80,
      executionReadiness: 0,
      founderReadiness: 0,
    },
    verifiedMarketSizeAvailable: true,
  });
  const brief = buildMarketExecutiveDecisionBrief(marketSections, "English", coverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });

  assert.equal(brief.decision, "CONDITIONAL_GO", "gated MONITOR maps to CONDITIONAL_GO, never the destructive NO_GO");
  assert.ok(
    brief.missingEvidence.some((line) => /SOM|obtainable/i.test(line)),
    "the missing-evidence list must name the specific unresolved pillar (SOM/obtainable share), not leave the MONITOR downgrade unexplained"
  );
  assert.ok(
    !brief.missingEvidence.some((line) => /market-size figure \(TAM\/SAM\/SOM\) could not be established/i.test(line)),
    "market sizing, which IS resolved in this fixture, must not also be listed as a gap"
  );
  assert.ok(
    !brief.missingEvidence.some((line) => /No named competitor or adjacent-market player could be independently validated/i.test(line)),
    "competitive evidence, which IS resolved in this fixture, must not also be listed as a gap"
  );
});

test("route.ts: both assessMarketEntryConfidence call sites (the post-generation banner and the pre-generation model context) are gated by the SAME resolveDecisionCriticalEvidenceState, so the model is never pre-conditioned on a stronger verdict than the final report will display", () => {
  assert.match(routeSource, /assessMarketEntryConfidence\(coverage, decisionCriticalEvidence\)/);
  assert.match(
    routeSource,
    /assessMarketEntryConfidence\(\s*\n\s*marketCoverageResult\.coverage,\s*\n\s*resolveDecisionCriticalEvidenceState\(marketIntelligenceGraph\)\s*\n\s*\)/
  );
});

test("DRIFT CHECK: the weighted-blend formula and its ENTER/MONITOR/AVOID thresholds are byte-identical to before this fix -- the decision LABEL logic is still a pure gate, never reweighted", () => {
  assert.match(
    presentationSource,
    /marketConfidence \* 0\.4 \+\s*\n\s*competitiveEvidence \* 0\.25 \+\s*\n\s*financialEvidence \* 0\.2 \+\s*\n\s*productEvidence \* 0\.15/
  );
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): blendedDecision is now explicitly computed from
  // rawConfidence (the UNCAPPED blend), not the possibly-capped
  // `confidence` this test previously pinned by name -- this is
  // deliberate: it guarantees the label-gating logic (this exact
  // ternary, thresholds unchanged) can never be affected by the
  // separate confidence-number cap added below it.
  // TASK #29B -- 65/40 extracted into named constants
  // (STRONG_CONFIDENCE_THRESHOLD/MODERATE_CONFIDENCE_THRESHOLD), reused
  // by the new per-factor confidence-level derivation -- the literal
  // shape changed, the thresholds and branches did not.
  assert.match(presentationSource, /const STRONG_CONFIDENCE_THRESHOLD = 65;/);
  assert.match(presentationSource, /const MODERATE_CONFIDENCE_THRESHOLD = 40;/);
  assert.match(
    presentationSource,
    /rawConfidence >= STRONG_CONFIDENCE_THRESHOLD\s*\n\s*\? "ENTER"\s*\n\s*: rawConfidence >= MODERATE_CONFIDENCE_THRESHOLD\s*\n\s*\? "MONITOR"\s*\n\s*: "AVOID";/
  );
});

test("DRIFT CHECK: confidence is capped ONLY in the two narrow evidence-gap states, and only after blendedDecision/evidenceGapBlocksStrongDecision have already been computed from the raw, uncapped score -- the cap can never influence which decision branch is chosen", () => {
  assert.match(presentationSource, /function capConfidenceForEvidenceGap\(/);
  const blendedDecisionIndex = presentationSource.indexOf("const blendedDecision: MarketEntryDecision =");
  const evidenceGapIndex = presentationSource.indexOf("const evidenceGapBlocksStrongDecision =");
  const confidenceCapIndex = presentationSource.indexOf("const confidence = capConfidenceForEvidenceGap(");
  assert.ok(blendedDecisionIndex > -1 && evidenceGapIndex > -1 && confidenceCapIndex > -1);
  assert.ok(
    blendedDecisionIndex < confidenceCapIndex && evidenceGapIndex < confidenceCapIndex,
    "the decision/gate must be computed BEFORE the confidence cap is applied, so the cap can never feed back into which decision is chosen"
  );
});

test("DRIFT CHECK: assessMarketEntryConfidence remains fully backward-compatible -- called with no second argument (every pre-existing caller), the gate never fires and behavior is byte-identical to before this fix", () => {
  const coverage = fixtureCoverage({
    dimensions: {
      marketConfidence: 95,
      competitiveEvidence: 90,
      financialEvidence: 22,
      productEvidence: 22,
      executionReadiness: 0,
      founderReadiness: 0,
    },
  });
  const result = assessMarketEntryConfidence(coverage);
  assert.equal(result.decision, "ENTER");
  assert.equal(result.evidenceGapBlocksStrongDecision, false);
});

test("DRIFT CHECK: P0 FIX #1 (TAM/SAM/SOM), #2 (CAGR), and #3 (Competitive Landscape/Major Players) canonical logic is untouched by this pass", () => {
  const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
  assert.match(reportPresentationSource, /export function resolveMarketSizingCascade\(/);
  assert.match(
    pdfButtonSource,
    /const cascade = constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveMarketSizingCascade\(magnitudes\),\s*\n\s*readMarketIntelligenceCanonicalState\(report\.metadata\)\s*\n\s*\);/
  );

  assert.match(routeSource, /if \(field === "cagr"\) \{/);
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );

  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  assert.match(graphSource, /adjacentPlayersAlongsideValidatedVendors/);

  const vendorDiscoverySource = readFileSync("app/lib/ai/vendor-discovery.ts", "utf8");
  assert.match(vendorDiscoverySource, /official_product_page_plus_independent_source/);
});

// ===========================================================================
// TASK #12 -- the exact reported symptom ("Decision: ENTER the U.S." next to
// "Confidence: Validation Required", with the report's own text explicitly
// stating SOM is unresolved) still reproduced after the Task #11 fix above.
// End-to-end verification (assessMarketEntryConfidence ->
// buildMarketExecutiveDecisionBrief -> formatExecutiveDecisionBrief ->
// resolveMarketIntelligenceExecutiveDecision) confirmed the GATE ITSELF is
// fully correct and round-trips cleanly whenever it runs (a MONITOR banner
// is written and re-parsed as MONITOR with a real, capped confidence
// number) -- the residual gap is a SEPARATE, ungated code path in this same
// route: a "single-field" request (field !== "fullReport") generates and
// caches its response with NO downstream processing at all -- no
// ensureMarketReportQuality, no assessMarketEntryConfidence, no canonical
// banner -- since it never builds the evidence graph the gate depends on.
// Every OTHER report field is safely self-contained, but executiveSummary
// specifically encodes the cross-field go/no-go decision, so it cannot be
// safely regenerated in isolation. Fixed by refusing that one specific
// request shape outright rather than rebuilding the graph/coverage
// pipeline inside the narrower single-field path.
// ===========================================================================

test("route.ts: a single-field request for executiveSummary (not the full report) is rejected outright, rather than silently generating/caching an ungated decision with no evidence-gap gate at all", () => {
  assert.match(
    routeSource,
    /if \(!isFullReportRequest && reportField === "executiveSummary"\) \{\s*\n\s*return NextResponse\.json\(/
  );
});

test("route.ts: the single-field executiveSummary guard sits AFTER the AI_TEST_MODE mock branch, so deterministic test-mode mocks (which never leak a real, ungated decision) are completely unaffected", () => {
  const testModeIndex = routeSource.indexOf("if (isAiTestMode()) {");
  const guardIndex = routeSource.indexOf('if (!isFullReportRequest && reportField === "executiveSummary") {');
  assert.ok(testModeIndex > -1 && guardIndex > -1);
  assert.ok(guardIndex > testModeIndex, "the guard must only apply to real (non-test-mode) requests");
});

test("route.ts: the single-field executiveSummary guard never fires for a full-report request -- isFullReportRequest sets reportField to \"executiveSummary\" internally too, so the guard must explicitly exclude that case, not just check the field name", () => {
  assert.match(routeSource, /const reportField = isFullReportRequest \? "executiveSummary" : requestedField;/);
  // The guard's own condition (already asserted above) requires
  // !isFullReportRequest -- re-asserted here as an explicit regression
  // guard against a future edit accidentally dropping that clause, which
  // would break full-report generation entirely.
  assert.match(routeSource, /!isFullReportRequest && reportField === "executiveSummary"/);
});

test("route.ts: every OTHER single-field market report request (e.g. tamSamSom, competitiveLandscape, majorPlayers) is untouched by this guard -- only executiveSummary is refused, since only it encodes the cross-field decision", () => {
  const guardIndex = routeSource.indexOf('if (!isFullReportRequest && reportField === "executiveSummary") {');
  assert.ok(guardIndex > -1);
  const guardBlock = routeSource.slice(guardIndex, guardIndex + 400);
  assert.doesNotMatch(guardBlock, /tamSamSom|competitiveLandscape|majorPlayers/);
});
