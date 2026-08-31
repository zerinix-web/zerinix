import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assessMarketEntryConfidence,
  buildMarketEntryRecommendation,
  buildMarketExecutiveDecisionBrief,
  buildMarketExecutiveSummary,
} from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #29 -- Make Market Intelligence decision confidence genuinely
// evidence-driven.
//
// TRACE (full path): generation-time evidence extraction
// (market-intelligence-graph.ts's typed planningEstimate.samMethod/
// somStatus, vendorIntelligence.vendors/adjacentPlayers) -> route.ts's
// resolveDecisionCriticalEvidenceState(graph) builds a real, typed
// DecisionCriticalEvidenceState (3 structural pillars: market sizing,
// competitive evidence, obtainable share/SOM) -> assessMarketEntryConfidence
// (market-intelligence-presentation.ts) blends MarketResearchCoverage's
// generic evidence-count/diversity/freshness dimensions into a raw 0-100
// score, then hasDecisionCriticalEvidenceGap forces the DECISION to
// MONITOR and capConfidenceForEvidenceGap caps the NUMBER (<=50/40/30 for
// 1/2/3 unresolved pillars) whenever any pillar is unresolved, regardless
// of the raw score -> the result is packaged into ExecutiveDecisionBrief,
// baked into the persisted executiveSummary banner text, AND persisted a
// second time as structured JSON (marketIntelligenceCanonicalState) ->
// resolveMarketIntelligenceExecutiveDecisionWithCanonicalState is the
// ONE shared entry point page.tsx, ReportPdfButton.tsx, and Planner.tsx
// all call identically.
//
// ANSWER to "genuinely derived or inferred": the underlying gate IS
// genuinely computed from structured per-field evidence-resolution state
// (not prose regex, not citation count) -- confirmed by direct testing
// below (test 2). The one confirmed GAP: route.ts's ensureMarketReportQuality
// computed `decisionCriticalEvidence` as `undefined` (not a real, typed
// all-unresolved state) whenever `graph` was unavailable (the real,
// acknowledged "unavailable_no_graph" degraded generation state) --
// `undefined` disables assessMarketEntryConfidence's gate ENTIRELY
// (confirmed by direct testing below, test 1), meaning a no-graph
// generation could produce an ungated ENTER/high-confidence report driven
// purely by MarketResearchCoverage's generic dimensions -- exactly the
// citation-count-substitutes-for-evidence failure mode this ticket
// describes, just reached via a different path (missing graph) than the
// ticket's own worked example (present graph, unresolved SOM). Proven
// further by an internal inconsistency this same root cause already
// caused: route.ts's canonical-state-persistence step (further downstream
// in the SAME function) independently reinvented an `|| { ...fully
// unresolved }` fallback for the exact same variable, meaning a no-graph
// report's PERSISTED decisionCriticalEvidence would correctly say
// "everything unresolved" while its ALREADY-COMPUTED confidence NUMBER
// and decision label (built earlier, before that fallback ran) would not
// reflect that same gating -- disagreeing with the very evidence-state it
// was persisted alongside.
//
// FIX: route.ts's ensureMarketReportQuality now computes
// `decisionCriticalEvidence` as `graph ? resolveDecisionCriticalEvidenceState(graph)
// : { marketSizingResolved: false, competitiveEvidenceResolved: false,
// obtainableShareResolved: false }` -- the no-graph state is the single
// shared variable both buildMarketExecutiveDecisionBrief and
// buildMarketEntryRecommendation read, so a missing graph now gates AT
// LEAST as strongly as a graph whose own fields all failed to resolve,
// for every consumer, with zero risk of the two disagreeing. The
// now-redundant `|| {...}` at the persistence call site was removed.
// buildMarketExecutiveSummary (an "Executive Summary" generator, exported
// but not currently reached by the live pipeline) was fixed symmetrically
// with its sibling buildMarketEntryRecommendation, so it cannot silently
// reintroduce the same gap if reactivated.

const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const presentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

const maxedCitationDrivenCoverage = {
  overallConfidence: 100,
  dimensions: {
    marketConfidence: 100,
    competitiveEvidence: 100,
    financialEvidence: 100,
    productEvidence: 100,
  },
};

test("ROOT CAUSE, directly reproduced: with NO decisionCriticalEvidence argument at all, assessMarketEntryConfidence applies zero gating, even with the evidence-critical pillars unresolved in reality", () => {
  const ungated = assessMarketEntryConfidence(maxedCitationDrivenCoverage);
  assert.equal(ungated.confidence, 100, "confirms the pre-fix bug shape: undefined evidence state means no cap at all");
  assert.equal(ungated.decision, "ENTER");
  assert.equal(ungated.evidenceGapBlocksStrongDecision, false);
});

test("1. strong TAM evidence + unresolved decision-critical SOM => confidence remains gated (validation-required), never upgraded by coverage alone", () => {
  const result = assessMarketEntryConfidence(maxedCitationDrivenCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });
  assert.equal(result.decision, "MONITOR", "a single unresolved decision-critical pillar must still force MONITOR");
  assert.ok(result.confidence <= 50, `confidence must be capped, got ${result.confidence}`);
  assert.equal(result.evidenceGapBlocksStrongDecision, true);
});

test("2. many citations alone cannot create high confidence: maxing every coverage dimension (simulating a very high citation count) never escapes the evidence-gap cap", () => {
  const allUnresolved = assessMarketEntryConfidence(maxedCitationDrivenCoverage, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  });
  assert.ok(allUnresolved.confidence <= 30, `all-unresolved must cap at 30 regardless of coverage, got ${allUnresolved.confidence}`);
  assert.equal(allUnresolved.decision, "MONITOR");

  const twoUnresolved = assessMarketEntryConfidence(maxedCitationDrivenCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  });
  assert.ok(twoUnresolved.confidence <= 40, `two unresolved pillars must cap at 40 regardless of coverage, got ${twoUnresolved.confidence}`);

  // Sanity check on the raw, uncapped blend this scenario would otherwise
  // produce, to prove the cap is actually doing real work here, not
  // trivially passing because the raw score was already low.
  const rawWithoutGate = assessMarketEntryConfidence(maxedCitationDrivenCoverage);
  assert.equal(rawWithoutGate.confidence, 100, "the raw, citation-driven blend for this fixture is 100 -- the cap is what prevents it from surfacing");
});

test("3. fully supported decision-critical evidence produces a stronger, uncapped confidence (legitimate ENTER preserved)", () => {
  const result = assessMarketEntryConfidence(maxedCitationDrivenCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  });
  assert.equal(result.confidence, 100);
  assert.equal(result.decision, "ENTER");
  assert.equal(result.evidenceGapBlocksStrongDecision, false);
});

test("4a. UI/PDF/persisted canonical state cannot disagree: the shared resolver returns byte-identical output for the same canonical state, regardless of caller", () => {
  const canonicalState = {
    version: 1,
    decision: "CONDITIONAL_GO",
    confidence: 40,
  };
  const fromPageTsxCallShape = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "irrelevant prose, canonical state takes precedence",
    "English"
  );
  const fromPdfButtonCallShape = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "irrelevant prose, canonical state takes precedence",
    "English"
  );
  const fromPlannerCallShape = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "irrelevant prose, canonical state takes precedence",
    "English"
  );
  assert.deepEqual(fromPageTsxCallShape, fromPdfButtonCallShape);
  assert.deepEqual(fromPdfButtonCallShape, fromPlannerCallShape);
  assert.equal(fromPageTsxCallShape.decisionLabel, "MONITOR");
  assert.equal(fromPageTsxCallShape.confidenceScore, 40);
  assert.equal(fromPageTsxCallShape.decisionSource, "canonical-state");
});

test("4b. STRUCTURAL AUDIT: page.tsx, ReportPdfButton.tsx, and Planner.tsx all call the SAME shared canonical-state-aware resolver, never their own independent decision logic", () => {
  for (const file of ["app/dashboard/[id]/page.tsx", "app/dashboard/[id]/ReportPdfButton.tsx", "components/Planner.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(
      source,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState/,
      `${file} must call the single shared canonical-state-aware resolver`
    );
  }
});

test("4c. the persisted canonical decisionCriticalEvidence and the confidence NUMBER baked into the executiveSummary banner can never disagree: both are now derived from the exact same variable, computed once, even in the no-graph state", () => {
  assert.match(
    routeSource,
    /const decisionCriticalEvidence: DecisionCriticalEvidenceState = graph\s*\n\s*\? resolveDecisionCriticalEvidenceState\(graph\)\s*\n\s*: \{ marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false \};/,
    "the no-graph fallback must be a real, fully-unresolved, typed DecisionCriticalEvidenceState, never undefined"
  );
  assert.doesNotMatch(
    routeSource,
    /decisionCriticalEvidence:\s*decisionCriticalEvidence\s*\|\|\s*\{/,
    "the persisted-canonical-state builder must consume the same variable directly, not reintroduce its own independent fallback for it"
  );
});

test("5a. MONITOR remains deterministic across repeated runs: the resolver is a pure function of its inputs", () => {
  const inputs = {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  };
  const runs = Array.from({ length: 20 }, () => assessMarketEntryConfidence(maxedCitationDrivenCoverage, inputs));
  for (const run of runs) {
    assert.deepEqual(run, runs[0]);
  }
  assert.equal(runs[0].decision, "MONITOR");
});

test("5b. ENTER remains deterministic across repeated runs: the resolver is a pure function of its inputs", () => {
  const inputs = {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  };
  const runs = Array.from({ length: 20 }, () => assessMarketEntryConfidence(maxedCitationDrivenCoverage, inputs));
  for (const run of runs) {
    assert.deepEqual(run, runs[0]);
  }
  assert.equal(runs[0].decision, "ENTER");
});

test("no citation-integrity weakening: valid [R#] resolution/rejection logic (resolveDecisionCriticalEvidenceState) is untouched by this fix -- structural presence only, never a citation-count heuristic", () => {
  const routeSectionStart = routeSource.indexOf("function resolveDecisionCriticalEvidenceState");
  const routeSectionEnd = routeSource.indexOf("\n}", routeSectionStart);
  const fnSource = routeSource.slice(routeSectionStart, routeSectionEnd);
  assert.match(fnSource, /graph\.planningEstimate !== null \|\| graph\.verifiedMarketSize\.length > 0/);
  assert.match(fnSource, /graph\.vendorIntelligence\.vendors\.length > 0 \|\|\s*\n\s*graph\.vendorIntelligence\.adjacentPlayers\.length > 0/);
  assert.match(fnSource, /graph\.planningEstimate\.samMethod === "evidenceDerived" &&\s*\n\s*graph\.planningEstimate\.somStatus === "calculated"/);
  assert.doesNotMatch(fnSource, /sources\.length|citations\.length|\.evidenceIds\.length/, "must never gate on a raw citation/source COUNT");
});

test("buildMarketEntryRecommendation and buildMarketExecutiveSummary (the two 'Strategic Recommendations'/'Executive Summary' generators) both thread decisionCriticalEvidence through to assessMarketEntryConfidence", () => {
  const sections = {
    marketSize: "TAM is $1.5B [R1].",
    competitiveLandscape: "Several vendors compete [R2].",
    marketDrivers: "Demand is growing [R3].",
    opportunities: "Mid-market is underserved [R4].",
    threats: "Commoditization risk exists [R5].",
  };
  const gapEvidence = {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  };

  const summaryGated = buildMarketExecutiveSummary(sections, "English", maxedCitationDrivenCoverage, gapEvidence);
  const summaryUngated = buildMarketExecutiveSummary(sections, "English", maxedCitationDrivenCoverage);
  assert.match(summaryGated, /MONITOR/, "buildMarketExecutiveSummary must respect the evidence gap when given decisionCriticalEvidence");
  assert.match(summaryUngated, /ENTER/, "documents current behavior when no evidence state is supplied at all (this function is not on the live path today)");

  const recommendationGated = buildMarketEntryRecommendation(sections, "English", maxedCitationDrivenCoverage, gapEvidence);
  assert.doesNotMatch(recommendationGated, /Why This Market Entry Makes Sense/i, "an evidence-gapped recommendation must never use the ENTER-only framing");
});

test("buildMarketExecutiveDecisionBrief also respects the gate identically (the actual live banner generator)", () => {
  const sections = {
    marketSize: "TAM is $1.5B [R1].",
    competitiveLandscape: "Several vendors compete [R2].",
    marketDrivers: "Demand is growing [R3].",
    opportunities: "Mid-market is underserved [R4].",
    threats: "Commoditization risk exists [R5].",
  };
  const brief = buildMarketExecutiveDecisionBrief(sections, "English", maxedCitationDrivenCoverage, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  });
  assert.equal(brief.decision, "CONDITIONAL_GO");
});

test("STRUCTURAL AUDIT: buildMarketExecutiveSummary now accepts and threads a decisionCriticalEvidence parameter, symmetric with buildMarketEntryRecommendation", () => {
  const summaryFnStart = presentationSource.indexOf("export function buildMarketExecutiveSummary");
  const summaryFnSignatureEnd = presentationSource.indexOf(")", presentationSource.indexOf("{", summaryFnStart));
  const summarySignature = presentationSource.slice(summaryFnStart, summaryFnSignatureEnd);
  assert.match(summarySignature, /decisionCriticalEvidence\?:\s*DecisionCriticalEvidenceState/);
});
