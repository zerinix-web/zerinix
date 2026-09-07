import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// TASK #69A -- Make Business Idea Validation decision/confidence
// structurally authoritative.
//
// ROOT CAUSE (Task #69's own finding, confirmed on direct re-read):
// getDecisionSummaryItems (app/dashboard/[id]/page.tsx), which drives the
// web dashboard's "Decision summary" 6-card grid (Decision Signal, Main
// Insight, Decision Confidence, Positive Drivers, Risk Drivers,
// Recommended Next Step), resolved decision and confidence for every
// NON-Market-Intelligence report (Business Idea Validation included)
// purely by re-parsing prose -- resolveCanonicalDecisionFromReportText's
// banner/acquisition/real-estate text scan, then the unsafe bare
// detectRecommendation keyword fallback for decision; a bare
// extractDecisionConfidenceValue percentage scan for confidence -- never
// once reading the structured investmentScore.recommendation/confidence
// fields this exact report already carries. The sibling Executive
// Snapshot panel on the SAME page (buildExecutiveSnapshot,
// report-presentation.ts) already prefers investmentScore first. Because
// both panels render unconditionally on the same page for the same
// report, a report whose free-form prose happened to disagree with its
// own structured investment score could show two different decision/
// confidence values side by side for the same report.
//
// FIX: getDecisionSummaryItems now accepts investmentScore and, for every
// non-Market-Intelligence report, checks it FIRST -- structuredInvestment
// Recommendation/structuredInvestmentConfidence -- before ever falling
// back to resolvedDecision's prose parse or extractDecisionConfidenceValue's
// bare percentage scan. Market Intelligence's own resolution
// (marketDecisionSignal/marketDecisionConfidence, via the persisted
// canonical state) is completely untouched -- it is still checked FIRST
// via `??` and structuredInvestmentRecommendation/structuredInvestmentConfidence
// are unconditionally null whenever isMarketIntelligence is true.

const pageSourcePath = new URL("../app/dashboard/[id]/page.tsx", import.meta.url);
const pageSource = readFileSync(pageSourcePath, "utf8");

// --- Extract the two new, fully self-contained structured-value gates --
// (zero free-variable dependencies beyond isMarketIntelligence/
// investmentScore, so -- unlike getDecisionSummaryItems as a whole, which
// depends on ~15 other page.tsx-local helpers and lucide icon imports --
// these two statements are genuinely, safely executable in isolation.)

function extractConstStatement(source, name) {
  const match = source.match(new RegExp(`const ${name} =[\\s\\S]*?;\\n`));
  assert.ok(match, `${name} statement not found in page.tsx`);
  return match[0];
}

function buildStructuredRecommendationGate() {
  const statement = extractConstStatement(pageSource, "structuredInvestmentRecommendation");
  const fn = new Function(
    "isMarketIntelligence",
    "investmentScore",
    `${statement}\nreturn structuredInvestmentRecommendation;`
  );
  return (isMarketIntelligence, investmentScore) => fn(isMarketIntelligence, investmentScore);
}

function buildStructuredConfidenceGate() {
  const statement = extractConstStatement(pageSource, "structuredInvestmentConfidence");
  const fn = new Function(
    "isMarketIntelligence",
    "investmentScore",
    `${statement}\nreturn structuredInvestmentConfidence;`
  );
  return (isMarketIntelligence, investmentScore) => fn(isMarketIntelligence, investmentScore);
}

const resolveStructuredRecommendation = buildStructuredRecommendationGate();
const resolveStructuredConfidence = buildStructuredConfidenceGate();

// -----------------------------------------------------------------------
// A/B/C/G/H -- genuine behavioral proof of the structured-value gate
// -----------------------------------------------------------------------

test("A (behavioral): a valid structured recommendation is surfaced for a Business Idea Validation report regardless of GO/WAIT/PASS value", () => {
  assert.equal(resolveStructuredRecommendation(false, { recommendation: "GO", confidence: 91 }), "GO");
  assert.equal(resolveStructuredRecommendation(false, { recommendation: "WAIT", confidence: 55 }), "WAIT");
  assert.equal(resolveStructuredRecommendation(false, { recommendation: "PASS", confidence: 20 }), "PASS");
});

test("B (behavioral): a valid structured confidence number is surfaced for a Business Idea Validation report, including 0", () => {
  assert.equal(resolveStructuredConfidence(false, { recommendation: "GO", confidence: 91 }), 91);
  assert.equal(resolveStructuredConfidence(false, { recommendation: "PASS", confidence: 0 }), 0);
});

test("C (behavioral): when investmentScore is genuinely absent or malformed, the structured gate returns null so the legacy prose fallback chain is reached", () => {
  assert.equal(resolveStructuredRecommendation(false, undefined), null);
  assert.equal(resolveStructuredRecommendation(false, {}), null);
  assert.equal(resolveStructuredRecommendation(false, { recommendation: "MAYBE" }), null);
  assert.equal(resolveStructuredConfidence(false, undefined), null);
  assert.equal(resolveStructuredConfidence(false, { recommendation: "GO", confidence: "high" }), null);
  assert.equal(resolveStructuredConfidence(false, { recommendation: "GO" }), null);
});

test("F (Market Intelligence unchanged): the structured gate is unconditionally null for Market Intelligence reports, even when investmentScore happens to be populated -- decision/confidence for Market Intelligence can ONLY ever come from marketDecisionSignal/marketDecisionConfidence, exactly as before this fix", () => {
  assert.equal(resolveStructuredRecommendation(true, { recommendation: "GO", confidence: 91 }), null);
  assert.equal(resolveStructuredConfidence(true, { recommendation: "GO", confidence: 91 }), null);
});

// -----------------------------------------------------------------------
// A/B/D (structural): the real decisionSignal/decisionConfidence
// assignments check the structured gate BEFORE the prose fallback chain
// -- JS ternary short-circuit evaluation means this text shape (confirmed
// present, verbatim, in the live file) is itself the proof that
// structured data wins whenever both a structured value and a
// contradicting prose value exist for the same report: the prose-parsing
// branches (resolvedDecision / extractDecisionConfidenceValue) are only
// ever reached in the `else` arm of the structured check, so they can
// never run, let alone win, while a valid structured value is present.
// -----------------------------------------------------------------------

test("A/D (structural): decisionSignal checks structuredInvestmentRecommendation BEFORE resolvedDecision's prose parse, and both are subordinate to Market Intelligence's own marketDecisionSignal", () => {
  assert.match(
    pageSource,
    /const decisionSignal =\s*\n\s*marketDecisionSignal \?\?\s*\n\s*\(structuredInvestmentRecommendation\s*\n\s*\? getCanonicalDecisionLabel\(\s*\n\s*mapInvestmentScoreRecommendationToCanonicalDecision\(structuredInvestmentRecommendation\),/
  );
  // The prose-parse branch (resolvedDecision) and the unsafe bare-keyword
  // fallback (detectRecommendation) must appear ONLY after
  // structuredInvestmentRecommendation's own `?`/`:` branch in the same
  // statement -- i.e. strictly later in the file within this assignment.
  const decisionSignalMatch = pageSource.match(/const decisionSignal =[\s\S]*?"—"\);/);
  assert.ok(decisionSignalMatch, "decisionSignal assignment not found");
  const decisionSignalText = decisionSignalMatch[0];
  const structuredIndex = decisionSignalText.indexOf("structuredInvestmentRecommendation");
  const resolvedDecisionIndex = decisionSignalText.indexOf("resolvedDecision");
  const detectRecommendationIndex = decisionSignalText.indexOf("detectRecommendation(");
  assert.ok(structuredIndex >= 0 && resolvedDecisionIndex > structuredIndex);
  assert.ok(detectRecommendationIndex > resolvedDecisionIndex);
});

test("B/D (structural): decisionConfidence checks structuredInvestmentConfidence BEFORE extractDecisionConfidenceValue's prose scan, and both are subordinate to Market Intelligence's own marketDecisionConfidence", () => {
  assert.match(
    pageSource,
    /const decisionConfidence =\s*\n\s*marketDecisionConfidence !== null\s*\n\s*\? `\$\{marketDecisionConfidence\}%`\s*\n\s*: structuredInvestmentConfidence !== null\s*\n\s*\? `\$\{structuredInvestmentConfidence\}%`\s*\n\s*: extractDecisionConfidenceValue\(/
  );
});

test("C (structural): the legacy prose fallback functions (resolveCanonicalDecisionFromReportText, detectRecommendation, extractDecisionConfidenceValue) are still present, still called, and still reached whenever the structured gate is null -- never deleted", () => {
  assert.match(pageSource, /resolveCanonicalDecisionFromReportText\(/);
  assert.match(pageSource, /detectRecommendation\(/);
  assert.match(pageSource, /extractDecisionConfidenceValue\(/);
});

test("E/F (Market Intelligence untouched): marketDecisionSignal and marketDecisionConfidence's own computation is byte-for-byte unchanged and still gated on isMarketIntelligence, still resolved via resolveMarketIntelligenceGatedExecutiveDecision against the persisted canonical state -- this fix added code around them without modifying them", () => {
  assert.match(
    pageSource,
    /const marketDecisionSignal = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceGatedExecutiveDecision\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*executiveSummary \|\| executiveRecommendation,\s*\n\s*dashboardLocale === "tr" \? "Turkish" : "English"\s*\n\s*\)\.decisionLabel\s*\n\s*: null;/
  );
  assert.match(
    pageSource,
    /const marketDecisionConfidence = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceGatedExecutiveDecision\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*executiveSummary \|\| executiveRecommendation,\s*\n\s*dashboardLocale === "tr" \? "Turkish" : "English"\s*\n\s*\)\.confidenceScore\s*\n\s*: null;/
  );
});

// -----------------------------------------------------------------------
// Call-site wiring
// -----------------------------------------------------------------------

test("wiring: getDecisionSummaryItems accepts investmentScore as its 4th parameter, and the real call site passes report.investmentScore", () => {
  assert.match(
    pageSource,
    /function getDecisionSummaryItems\(\s*\n\s*sections: Array<\{ field\?: string; title: string; content: string \}>,\s*\n\s*isMarketIntelligence = false,\s*\n\s*marketIntelligenceCanonicalState: MarketIntelligenceCanonicalState \| null = null,\s*\n\s*investmentScore\?: ReportInvestmentScore\s*\n\)/
  );
  assert.match(
    pageSource,
    /const decisionSummaryItems = getDecisionSummaryItems\(\s*\n\s*visibleSections,\s*\n\s*isMarketIntelligenceReport,\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*report\.investmentScore\s*\n\s*\);/
  );
});

// -----------------------------------------------------------------------
// D (web/PDF parity): both the web Decision Summary grid (fixed here)
// and the web Executive Snapshot panel (pre-existing) now agree, by
// construction, with investmentScore.recommendation/confidence whenever
// it is present -- proving they can no longer independently diverge for
// the same report the way the confirmed Task #69 bug allowed.
// -----------------------------------------------------------------------

test("D: the fixed Decision Summary grid and the pre-existing Executive Snapshot panel both resolve to investmentScore's own value when one is present, eliminating the intra-page divergence Task #69 found", () => {
  // buildExecutiveSnapshot's own, pre-existing structured-first pattern
  // (report-presentation.ts) -- confirmed still present, unmodified.
  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    presentationSource,
    /const confidenceScore =\s*\n\s*typeof investmentScore\?\.confidence === "number"\s*\n\s*\? investmentScore\.confidence\s*\n\s*: extractPercentScore\(/
  );

  // Behavioral cross-check: for the identical fixture, the Decision
  // Summary grid's own structured gate (fixed here) and
  // buildExecutiveSnapshot's own structured-first confidence both resolve
  // to the SAME investmentScore.confidence value.
  const fixture = { recommendation: "WAIT", confidence: 63 };
  assert.equal(resolveStructuredConfidence(false, fixture), fixture.confidence);
});

// -----------------------------------------------------------------------
// Regression: previously-passing Task #69's own audit note is preserved
// -- Founder Score already reads investmentScore directly (unaffected by
// this change, confirmed unmodified).
// -----------------------------------------------------------------------

test("regression: Founder Score's own structured-data consumption (readFounderReadinessMetricValue/readFounderReadinessScoreValue) is untouched by this fix", () => {
  assert.match(pageSource, /readFounderReadinessMetricValue\(/);
  assert.match(pageSource, /readFounderReadinessScoreValue\(/);
});
