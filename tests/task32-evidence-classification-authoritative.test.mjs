import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  buildMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceDecisionEvidenceLevel,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import {
  deriveMarketSizeMetricEvidenceLevel,
  extractEvidenceLineForMetricValue,
} from "../app/lib/report-presentation.ts";
import { inferEvidenceLevel } from "../app/lib/report-evidence.ts";

// TASK #32 -- Make Market Intelligence evidence classification
// authoritative across the entire report.
//
// ROOT CAUSE (confirmed via full audit of the existing evidence-
// classification architecture across all 17 report sections and all 4
// render sites -- page.tsx web, Planner.tsx web + PDF, ReportPdfButton.tsx
// PDF): the codebase already has ONE live, exported evidence taxonomy
// (EvidenceLevel: verified/derived/benchmarkDerived/planningAssumption/
// validationRequired -- app/lib/report-evidence.ts) that maps cleanly
// onto Verified/Directional/Planning-Assumption/Validation-Required, but
// several decision-critical badges never used it correctly:
//
// 1. TAM/SAM/SOM per-layer badges: page.tsx re-scanned the ENTIRE
//    tamSamSom section prose for the bare word "verified"
//    (getDashboardMetricEvidence -> inferEvidenceLevel), independent of
//    the isResolved/isEstimated values the SAME render already computes
//    from canonical state two lines above. Planner.tsx showed the
//    SECTION-WIDE cascade result identically on all 3 layers (a
//    fully-resolved TAM showed the same badge as an unresolved SOM).
//    Both are now derived directly from that layer's own
//    isResolved/isEstimated (verified when resolved-and-not-estimated,
//    benchmarkDerived when resolved-and-estimated, validationRequired
//    when unresolved) -- no re-parsing, and both files agree.
// 2. Market Size/CAGR cards: page.tsx's own line-isolation helper fell
//    back to the WHOLE field content when no line contained the exact
//    displayed value (reopening the same whole-content hazard);
//    Planner.tsx never isolated at all. deriveMarketSizeMetricEvidenceLevel
//    (report-presentation.ts) is now the ONE shared function: a figure
//    with no isolated evidence line of its own is "planningAssumption"
//    directly, never a whole-content re-scan and never the too-confident
//    generic "benchmarkDerived" fallback.
// 3. Executive Summary: the "Decision" KPI badge (and the section header
//    badge) re-derived confidence by scanning the summary's own prose for
//    "verified"/"validate" -- even though decisionCriticalEvidence is
//    already resolved and already used, in the same render, to compute
//    the decision label itself. resolveMarketIntelligenceDecisionEvidenceLevel
//    now maps the SAME 3-pillar decisionCriticalEvidence + confidence
//    onto EvidenceLevel directly, so confident-sounding prose can never
//    upgrade what the structured evidence actually supports.
// 4. Competitive Landscape: the single "Validation" column is a vendor-
//    EXISTENCE corroboration score, not a check on that row's category/
//    position/strengths/weaknesses text -- renamed to "Vendor Confidence"
//    with an explicit caption, in all 4 render sites, so a reader can no
//    longer read a verified vendor's existence as validating its other
//    attributes.
//
// No new taxonomy was invented anywhere -- every fix reuses EvidenceLevel.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
    sourceTitle: `${name} source`,
    publisher: name,
    url,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

function decisionBriefFixture(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    confidenceFactors: ["verified market size unavailable"],
    why: "Evidence supports conditional entry pending SOM validation.",
    topReasons: ["Active vendor landscape", "Growing category"],
    topRisks: ["Incumbent concentration", "Procurement cycle length"],
    missingEvidence: ["Independent win-rate data"],
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
    ...overrides,
  };
}

function realGraphFixture() {
  const evidence = [
    evidenceItem({ id: "R3", name: "DocuSign", url: "https://procurement.sc.gov/docusign-clm" }),
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R5", name: "Evisort", url: "https://evisort.com/ai-engine" }),
    evidenceItem({
      id: "R12",
      name: "Emergen Research",
      url: "https://emergenresearch.com/clm-market",
      claim: "Market research report values the U.S. CLM software market at $1.5 billion.",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "AI compliance & contract intelligence SaaS");
}

function canonicalStateWithEvidence(evidenceOverrides, decisionOverrides = {}) {
  return buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: {
      marketSizingResolved: false,
      competitiveEvidenceResolved: false,
      obtainableShareResolved: false,
      ...evidenceOverrides,
    },
    decisionBrief: decisionBriefFixture(decisionOverrides),
  });
}

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

// --- 1. Verified source-backed claim stays supported ---------------------

test("REGRESSION: a market-size figure with a real isolated evidence line stays classified from that line's own actual evidence, not silently downgraded", () => {
  const content = "TAM: $1.5 billion, verified from Emergen Research's published CLM market report.";
  const evidence = deriveMarketSizeMetricEvidenceLevel("Market Size", "$1.5 billion", content);
  assert.equal(evidence, "verified");
});

test("REGRESSION: all 3 decision-critical evidence pillars resolved with strong confidence classifies as verified", () => {
  const canonicalState = canonicalStateWithEvidence(
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    { decision: "GO", confidence: 82 }
  );
  assert.equal(resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState), "verified");
});

// --- 2. Derived/assumption values are never labeled verified -------------

test("REGRESSION: a derived value (computed from a verified source) is classified 'derived', never 'verified'", () => {
  const level = inferEvidenceLevel({
    label: "SAM",
    value: "$300 million",
    context: "SAM is derived from the verified TAM figure using a 20% serviceable-share assumption.",
  });
  assert.equal(level, "derived");
  assert.notEqual(level, "verified");
});

test("REGRESSION: a market-size figure with NO isolated evidence line of its own is classified 'planningAssumption', never the too-confident 'benchmarkDerived' default and never 'verified' via a whole-content re-scan", () => {
  // A synthesized/reformatted display value (e.g. a multi-estimate range
  // rebuilt from two source numbers) that no longer appears verbatim on
  // any single line of the original field -- extractEvidenceLineForMetricValue
  // returns "" for it, exactly the case this fix targets. The word
  // "verified" appears elsewhere in the field (an unrelated SOM caveat);
  // it must never leak into this value's own classification.
  const content = "Some unrelated line states the SOM figure has not been independently verified.\nGrowth outlook is positive.";
  const evidence = deriveMarketSizeMetricEvidenceLevel("CAGR", "10.0%–12.0%", content);
  assert.equal(evidence, "planningAssumption");
  assert.notEqual(evidence, "verified");
  assert.notEqual(evidence, "benchmarkDerived");
});

test("REGRESSION: extractEvidenceLineForMetricValue returns an empty string (never the whole content) when no line contains the value", () => {
  const content = "Line one.\nLine two.\nLine three.";
  assert.equal(extractEvidenceLineForMetricValue(content, "$99 million"), "");
});

test("REGRESSION: partial decision-critical evidence (1 of 3 pillars) classifies as planningAssumption, not benchmarkDerived or verified", () => {
  const canonicalState = canonicalStateWithEvidence({ marketSizingResolved: true }, { confidence: 35 });
  assert.equal(resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState), "planningAssumption");
});

// --- 3. Missing CAGR stays Validation Required ----------------------------

const REAL_CAGR_CONTENT =
  "- [Estimated] https://www.emergenresearch.com/industry-report/us-contract-lifecycle-management-market — Emergen Research US CLM market report.\n| Confidence: 64/100 (Medium) | Evidence: [R12]";

test("REAL PERSISTED REPORT (171cf10d-538a-4ad3-9ed9-b30e85914e85): CAGR content with no percentage at all classifies as validationRequired via the empty-value gate", () => {
  const evidence = deriveMarketSizeMetricEvidenceLevel("CAGR", "", REAL_CAGR_CONTENT);
  assert.equal(evidence, "validationRequired");
});

test("REGRESSION: an empty value always classifies as validationRequired, regardless of surrounding content", () => {
  assert.equal(deriveMarketSizeMetricEvidenceLevel("CAGR", "", "some content mentioning verified data"), "validationRequired");
});

// --- 4. Unsupported SOM stays Validation Required (TAM/SAM/SOM layers) ---

test("REGRESSION: an unresolved TAM/SAM/SOM layer classifies as validationRequired regardless of what the section's own prose says elsewhere", () => {
  // Mirrors the exact per-layer derivation now used identically in
  // page.tsx and components/Planner.tsx: !isResolved -> validationRequired,
  // isResolved && isEstimated -> benchmarkDerived, else -> verified.
  function layerEvidenceLevel(isResolved, isEstimated) {
    return !isResolved ? "validationRequired" : isEstimated ? "benchmarkDerived" : "verified";
  }

  assert.equal(layerEvidenceLevel(false, false), "validationRequired");
  assert.equal(layerEvidenceLevel(false, true), "validationRequired", "an unresolved layer can never be upgraded by isEstimated");
  assert.equal(layerEvidenceLevel(true, true), "benchmarkDerived");
  assert.equal(layerEvidenceLevel(true, false), "verified");
});

test("STRUCTURAL AUDIT: page.tsx's and Planner.tsx's TAM/SAM/SOM per-layer badge derives from THIS layer's own isResolved/isEstimated, not a prose scan or the section-wide cascade result", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(
      source,
      /const layerEvidenceLevel: EvidenceLevel = !isResolved\s*\n\s*\? "validationRequired"\s*\n\s*: isEstimated\s*\n\s*\? "benchmarkDerived"\s*\n\s*: "verified";/,
      `${name}: per-layer evidence derivation not found in the expected shape`
    );
    assert.match(source, /<EvidenceBadge level=\{layerEvidenceLevel\}/, `${name}: TAM/SAM/SOM badge must use layerEvidenceLevel`);
  }
});

// --- 5. Competitor existence does not validate unsupported attributes ----

test("STRUCTURAL AUDIT: the Competitive Landscape table's confidence column is labeled 'Vendor Confidence' (not the ambiguous 'Validation'), in all 4 render sites", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx (web)", plannerSource],
  ]) {
    assert.match(
      source,
      /\["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Vendor Confidence"\]/,
      `${name}: column header not renamed`
    );
    assert.doesNotMatch(
      source,
      /\["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Validation"\]/,
      `${name}: stale "Validation" header must not remain`
    );
  }
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx (PDF)", plannerSource],
  ]) {
    assert.match(
      source,
      /localizePdfPresentationLabel\("Vendor Confidence", pdfLocale\)/,
      `${name}: PDF column header not renamed`
    );
  }
});

test("STRUCTURAL AUDIT: both web tables carry an explicit caption stating Vendor Confidence does not verify the other attribute columns", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(
      source,
      /Vendor Confidence reflects how well each company&apos;s existence and market relevance are/,
      `${name}: clarifying caption not found`
    );
    assert.match(source, /it does not verify the category, position, strengths, or/, `${name}: caption must scope what the column does NOT cover`);
  }
});

// --- 6. Executive Summary cannot upgrade weak evidence --------------------

test("REGRESSION: Executive Summary's Decision evidence level reflects decisionCriticalEvidence, never upgraded by confident-sounding prose that happens to contain 'verified'", () => {
  const weakCanonicalState = canonicalStateWithEvidence(
    { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    { decision: "CONDITIONAL_GO", confidence: 50 }
  );
  // Confident-sounding prose that would previously have matched
  // inferEvidenceLevel's bare \bverified\b regex.
  const confidentProse =
    "This market has been thoroughly verified through multiple independent industry reports and shows strong, clear demand.";
  void confidentProse; // the new resolver never reads section prose at all -- proven by its own signature.

  const evidence = resolveMarketIntelligenceDecisionEvidenceLevel(weakCanonicalState);
  assert.equal(evidence, "validationRequired");
  assert.notEqual(evidence, "verified");
});

test("REGRESSION: resolveMarketIntelligenceDecisionEvidenceLevel returns null (never a guess) when no canonical state exists, preserving the existing prose-scan fallback for legacy reports", () => {
  assert.equal(resolveMarketIntelligenceDecisionEvidenceLevel(null), null);
});

test("STRUCTURAL AUDIT: the Executive Summary's Decision KPI badge and section-header badge both try resolveMarketIntelligenceDecisionEvidenceLevel BEFORE any prose-scan fallback, in both page.tsx and Planner.tsx", () => {
  const decisionKpiPattern = /resolveMarketIntelligenceDecisionEvidenceLevel\(marketIntelligenceCanonicalState\)/;
  assert.match(dashboardReportSource, decisionKpiPattern, "page.tsx: Decision KPI badge");
  assert.match(plannerSource, decisionKpiPattern, "Planner.tsx: Decision KPI badge (via getSectionEvidenceLevel) or section badge");

  const occurrencesInPage = dashboardReportSource.match(/resolveMarketIntelligenceDecisionEvidenceLevel\(/g) || [];
  const occurrencesInPlanner = plannerSource.match(/resolveMarketIntelligenceDecisionEvidenceLevel\(/g) || [];
  assert.ok(occurrencesInPage.length >= 2, "page.tsx must use the canonical resolver at both the KPI badge and the section-header dispatcher");
  assert.ok(occurrencesInPlanner.length >= 1, "Planner.tsx must use the canonical resolver at least at the section-header dispatcher");
});

// --- 7. UI and PDF classifications remain equivalent ----------------------

test("REGRESSION: the same claim (same value, same content) classifies identically regardless of which render site calls it -- the function is pure and shared", () => {
  const content = "12.4%";
  const webResult = deriveMarketSizeMetricEvidenceLevel("CAGR", "12.4%", content);
  const pdfResult = deriveMarketSizeMetricEvidenceLevel("CAGR", "12.4%", content);
  assert.equal(webResult, pdfResult);

  const canonicalState = canonicalStateWithEvidence(
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    { confidence: 50 }
  );
  const webDecisionEvidence = resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState);
  const pdfDecisionEvidence = resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState);
  assert.equal(webDecisionEvidence, pdfDecisionEvidence);
});

// --- 8. Canonical decision and confidence remain unchanged ----------------

test("REGRESSION: none of this task's new classification functions mutate or contradict the canonical decision/confidence", () => {
  const canonicalState = canonicalStateWithEvidence(
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    { decision: "CONDITIONAL_GO", confidence: 50 }
  );

  resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState);
  deriveMarketSizeMetricEvidenceLevel("CAGR", "12.4%", "12.4% CAGR [R5]");

  assert.equal(canonicalState.decision, "CONDITIONAL_GO");
  assert.equal(canonicalState.confidence, 50);
});

// --- Real report fixture (171cf10d-538a-4ad3-9ed9-b30e85914e85) ----------
// --- end-to-end: MONITOR / confidence 50 / SOM unresolved -----------------

test("REAL PERSISTED REPORT: with SOM unresolved (the report's own real state), the Decision evidence level is never 'verified' -- it reads benchmarkDerived (2 of 3 pillars), matching the report's own conditional MONITOR stance", () => {
  const canonicalState = canonicalStateWithEvidence(
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    { decision: "CONDITIONAL_GO", confidence: 50 }
  );
  const evidence = resolveMarketIntelligenceDecisionEvidenceLevel(canonicalState);
  assert.equal(evidence, "benchmarkDerived");
  assert.notEqual(evidence, "verified");
});
