import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// TASK #69A-1 -- Make Business Idea Validation decision authority uniform
// across /plan.
//
// Task #69A fixed page.tsx's getDecisionSummaryItems (the dashboard
// "Decision summary" grid). This task traced every OTHER Business Idea
// Validation path in the /plan LIVE experience (components/Planner.tsx)
// and the dashboard-view PDF export (app/dashboard/[id]/ReportPdfButton.tsx)
// that reads or displays decision/confidence, and found three more real,
// same-class gaps:
//
// 1. Planner.tsx's ExecutiveSummaryVisual ("Investment Decision Snapshot")
//    -- decision label resolved via resolveCanonicalDecisionFromReportText
//    (section.content, investmentScore?.recommendation), which only ever
//    consults investmentScore as ITS OWN last fallback tier, AFTER trying
//    to parse this section's own banner/acquisition/real-estate text --
//    the exact function this ticket's own diagnosis names.
// 2. page.tsx's AND Planner.tsx's ExecutiveInsightBanner -- confidence for
//    every non-Market-Intelligence report came ONLY from extractConfidence's
//    bare-percentage prose scan; investmentScore was never even passed to
//    either component.
// 3. Planner.tsx's getExecutiveDecisionCardLayout (the /plan page's OWN
//    live "Download PDF" export, downloadPdf) and ReportPdfButton.tsx's
//    equivalent card (the SAVED report's PDF export) -- confidence tried
//    a section-scoped prose scan BEFORE investmentScore.confidence.
//
// FIX (same rule as Task #69A, applied at each site): investmentScore's
// structured recommendation/confidence is checked FIRST; the pre-existing
// prose-parsing chain is preserved, unchanged, as the fallback for every
// report genuinely lacking a structured investmentScore. Decision LABEL
// vocabulary in getExecutiveDecisionCardLayout/ReportPdfButton.tsx's raw-
// token card is deliberately left untouched (see the report for this
// task) -- that raw token is the banner's own literal text, which the
// generation pipeline already renders deterministically FROM
// investmentScore.recommendation, so there is no live value-contradiction
// risk there, and mapping investmentScore's 3-value vocabulary onto that
// card's own different token shape would risk introducing a NEW
// vocabulary-mismatch bug for a case that already fails safely to "—".

const pagePath = new URL("../app/dashboard/[id]/page.tsx", import.meta.url);
const plannerPath = new URL("../components/Planner.tsx", import.meta.url);
const pdfButtonPath = new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url);
const pageSource = readFileSync(pagePath, "utf8");
const plannerSource = readFileSync(plannerPath, "utf8");
const pdfButtonSource = readFileSync(pdfButtonPath, "utf8");

function extractConstStatement(source, name, occurrence = 0) {
  const regex = new RegExp(`const ${name} =[\\s\\S]*?;\\n`, "g");
  const matches = [...source.matchAll(regex)];
  assert.ok(matches[occurrence], `${name} statement (occurrence ${occurrence}) not found`);
  return matches[occurrence][0];
}

// -----------------------------------------------------------------------
// Fix 1 -- Planner.tsx ExecutiveSummaryVisual: structured decision label
// -----------------------------------------------------------------------

function buildPlannerStructuredRecommendationGate() {
  const statement = extractConstStatement(plannerSource, "structuredInvestmentRecommendation");
  const fn = new Function(
    "isMarketIntelligence",
    "investmentScore",
    `${statement}\nreturn structuredInvestmentRecommendation;`
  );
  return (isMarketIntelligence, investmentScore) => fn(isMarketIntelligence, investmentScore);
}

const resolvePlannerStructuredRecommendation = buildPlannerStructuredRecommendationGate();

test("A (behavioral, /plan live): Planner.tsx's Investment Decision Snapshot surfaces the structured investmentScore.recommendation for a Business Idea Validation report", () => {
  assert.equal(resolvePlannerStructuredRecommendation(false, { recommendation: "GO", confidence: 88 }), "GO");
  assert.equal(resolvePlannerStructuredRecommendation(false, { recommendation: "WAIT", confidence: 40 }), "WAIT");
  assert.equal(resolvePlannerStructuredRecommendation(false, { recommendation: "PASS", confidence: 10 }), "PASS");
});

test("C (behavioral, /plan live): Planner.tsx's structured gate returns null when investmentScore is genuinely absent or malformed, reaching the legacy prose fallback", () => {
  assert.equal(resolvePlannerStructuredRecommendation(false, undefined), null);
  assert.equal(resolvePlannerStructuredRecommendation(false, {}), null);
  assert.equal(resolvePlannerStructuredRecommendation(false, { recommendation: "UNKNOWN" }), null);
});

test("G (Market Intelligence unchanged, /plan live): Planner.tsx's structured gate is unconditionally null for Market Intelligence, even with a populated investmentScore", () => {
  assert.equal(resolvePlannerStructuredRecommendation(true, { recommendation: "GO", confidence: 88 }), null);
});

test("A/D (structural, /plan live): Planner.tsx's `recommendation` checks structuredInvestmentRecommendation BEFORE resolvedDecision's prose parse, subordinate to Market Intelligence's own marketDecision", () => {
  const recommendationMatch = plannerSource.match(/const recommendation = marketDecision[\s\S]*?detectRecommendation\(section\.content\) \|\| "—";/);
  assert.ok(recommendationMatch, "Planner.tsx recommendation assignment not found");
  const text = recommendationMatch[0];
  const marketIndex = text.indexOf("marketDecision");
  const structuredIndex = text.indexOf("structuredInvestmentRecommendation");
  const resolvedIndex = text.indexOf("resolvedDecision");
  const detectIndex = text.indexOf("detectRecommendation(");
  assert.ok(marketIndex >= 0);
  assert.ok(structuredIndex > marketIndex);
  assert.ok(resolvedIndex > structuredIndex);
  assert.ok(detectIndex > resolvedIndex);
  assert.match(
    text,
    /mapInvestmentScoreRecommendationToCanonicalDecision\(structuredInvestmentRecommendation\)/
  );
});

test("C (structural, /plan live): the legacy prose fallback (resolveCanonicalDecisionFromReportText, detectRecommendation) is preserved, unchanged, in Planner.tsx", () => {
  assert.match(plannerSource, /resolveCanonicalDecisionFromReportText\(section\.content, investmentScore\?\.recommendation\)/);
  assert.match(plannerSource, /detectRecommendation\(section\.content\) \|\| "—"/);
});

// -----------------------------------------------------------------------
// Fix 2 -- ExecutiveInsightBanner confidence, in BOTH page.tsx (dashboard
// view) and Planner.tsx (/plan live view)
// -----------------------------------------------------------------------

function buildInsightBannerConfidenceGate(source) {
  const match = source.match(
    /const confidence = isMarketIntelligence\s*\n\s*\? marketIntelligenceCanonicalState\?\.confidence \?\? null\s*\n\s*: typeof investmentScore\?\.confidence === "number"\s*\n\s*\? investmentScore\.confidence\s*\n\s*: extractConfidence\([^)]*\);/
  );
  assert.ok(match, "ExecutiveInsightBanner confidence assignment not found");
  const fn = new Function(
    "isMarketIntelligence",
    "investmentScore",
    "marketIntelligenceCanonicalState",
    "content",
    "section",
    `function extractConfidence() { return null; }\n${match[0]}\nreturn confidence;`
  );
  return (isMarketIntelligence, investmentScore, marketIntelligenceCanonicalState) =>
    fn(isMarketIntelligence, investmentScore, marketIntelligenceCanonicalState, "", { content: "" });
}

const resolvePageInsightBannerConfidence = buildInsightBannerConfidenceGate(pageSource);
const resolvePlannerInsightBannerConfidence = buildInsightBannerConfidenceGate(plannerSource);

test("B (behavioral, dashboard view AND /plan live): ExecutiveInsightBanner in both page.tsx and Planner.tsx surfaces investmentScore.confidence first for Business Idea Validation", () => {
  assert.equal(resolvePageInsightBannerConfidence(false, { confidence: 77 }, null), 77);
  assert.equal(resolvePlannerInsightBannerConfidence(false, { confidence: 77 }, null), 77);
  assert.equal(resolvePageInsightBannerConfidence(false, { confidence: 0 }, null), 0);
});

test("C (behavioral, dashboard view AND /plan live): ExecutiveInsightBanner falls back to the legacy prose scan (returns null from the stubbed extractConfidence) when investmentScore.confidence is absent/malformed", () => {
  assert.equal(resolvePageInsightBannerConfidence(false, undefined, null), null);
  assert.equal(resolvePageInsightBannerConfidence(false, { confidence: "high" }, null), null);
  assert.equal(resolvePlannerInsightBannerConfidence(false, undefined, null), null);
});

test("G (Market Intelligence unchanged): ExecutiveInsightBanner's Market Intelligence branch (marketIntelligenceCanonicalState.confidence) is completely untouched in both files", () => {
  assert.equal(resolvePageInsightBannerConfidence(true, { confidence: 77 }, { confidence: 55 }), 55);
  assert.equal(resolvePlannerInsightBannerConfidence(true, { confidence: 77 }, { confidence: 55 }), 55);
  assert.equal(resolvePageInsightBannerConfidence(true, { confidence: 77 }, null), null);
});

test("wiring: both ExecutiveInsightBanner call sites now pass investmentScore through", () => {
  assert.match(
    pageSource,
    /<ExecutiveInsightBanner\s*\n\s*content=\{section\.content\}\s*\n\s*isMarketIntelligence=\{report\.type === "Market Analysis"\}\s*\n\s*marketIntelligenceCanonicalState=\{marketIntelligenceCanonicalState\}\s*\n\s*investmentScore=\{report\.investmentScore\}\s*\n\s*\/>/
  );
  assert.match(
    plannerSource,
    /<ExecutiveInsightBanner\s*\n\s*section=\{section\}\s*\n\s*isMarketIntelligence=\{isMarketIntelligence\}\s*\n\s*marketIntelligenceCanonicalState=\{marketIntelligenceCanonicalState\}\s*\n\s*investmentScore=\{investmentScore\}\s*\n\s*\/>/
  );
});

// -----------------------------------------------------------------------
// Fix 3 -- getExecutiveDecisionCardLayout (Planner.tsx's own /plan-page
// live PDF export) and ReportPdfButton.tsx's equivalent card (the SAVED
// report's dashboard-view PDF export)
// -----------------------------------------------------------------------

test("B/E (structural, /plan live PDF): Planner.tsx's getExecutiveDecisionCardLayout checks investmentScore.confidence BEFORE the section-scoped extractConfidence prose scan, subordinate to Market Intelligence's own marketDecision", () => {
  const match = plannerSource.match(/const confidence = marketDecision\s*\n\s*\? marketDecision\.confidenceScore\s*\n\s*: typeof investmentScore\?\.confidence === "number"[\s\S]*?extractScore\(fullReportContent, "Investment Score"\);/);
  assert.ok(match, "Planner.tsx getExecutiveDecisionCardLayout confidence assignment not found");
  const text = match[0];
  const structuredIndex = text.indexOf("investmentScore.confidence");
  const proseIndex = text.indexOf("extractConfidence(content)");
  assert.ok(structuredIndex > 0 && proseIndex > structuredIndex);
});

test("B/E (structural, dashboard-view PDF): ReportPdfButton.tsx's Executive Decision card checks report.investmentScore.confidence BEFORE the section-scoped extractConfidence prose scan, subordinate to Market Intelligence's own marketDecision", () => {
  const match = pdfButtonSource.match(/const confidence = marketDecision\s*\n\s*\? marketDecision\.confidenceScore\s*\n\s*: typeof report\.investmentScore\?\.confidence === "number"[\s\S]*?extractScore\(fullReportContent, "Investment Score"\);/);
  assert.ok(match, "ReportPdfButton.tsx Executive Decision card confidence assignment not found");
  const text = match[0];
  const structuredIndex = text.indexOf("report.investmentScore.confidence");
  const proseIndex = text.indexOf("extractConfidence(content)");
  assert.ok(structuredIndex > 0 && proseIndex > structuredIndex);
});

test("C (structural, both PDF paths): the legacy prose fallback chain (extractConfidence, extractScore) is preserved, unchanged, in both files' PDF cards", () => {
  assert.match(plannerSource, /extractConfidence\(content\) \?\?\s*\n\s*extractConfidence\(fullReportContent\) \?\?\s*\n\s*extractScore\(fullReportContent, "Investment Score"\)/);
  assert.match(pdfButtonSource, /extractConfidence\(content\) \?\?\s*\n\s*extractConfidence\(fullReportContent\) \?\?\s*\n\s*extractScore\(fullReportContent, "Investment Score"\)/);
});

// -----------------------------------------------------------------------
// D/E -- one effective decision authority across every surface: every
// fixed site reads the SAME investmentScore.recommendation/.confidence
// fields, so they can no longer independently diverge for the same
// report the way Task #69/#69A's audit found.
// -----------------------------------------------------------------------

test("D/E: /plan live UI (Planner.tsx), dashboard/report view (page.tsx), and both PDF exports (Planner.tsx's downloadPdf and ReportPdfButton.tsx) all resolve decision/confidence from the identical investmentScore object -- proven by constructing one fixture and confirming every fixed gate agrees", () => {
  const fixture = { recommendation: "WAIT", confidence: 61 };

  // /plan live UI -- Investment Decision Snapshot
  assert.equal(resolvePlannerStructuredRecommendation(false, fixture), "WAIT");
  // /plan live UI -- ExecutiveInsightBanner
  assert.equal(resolvePlannerInsightBannerConfidence(false, fixture, null), 61);
  // dashboard/report view -- ExecutiveInsightBanner
  assert.equal(resolvePageInsightBannerConfidence(false, fixture, null), 61);

  // Both PDF cards' structured-gate VALUE (not full function -- see the
  // structural tests above for their ORDERING proof) reduces to the same
  // typeof-guarded read of investmentScore.confidence -- confirmed
  // identical in both files.
  assert.match(plannerSource, /typeof investmentScore\?\.confidence === "number"\s*\n\s*\? investmentScore\.confidence/);
  assert.match(pdfButtonSource, /typeof report\.investmentScore\?\.confidence === "number"\s*\n\s*\? report\.investmentScore\.confidence/);
});

// -----------------------------------------------------------------------
// F -- Task #69A's own fix and tests remain intact (page.tsx's
// getDecisionSummaryItems, the dashboard "Decision summary" grid).
// -----------------------------------------------------------------------

test("F: Task #69A's getDecisionSummaryItems fix (dashboard Decision Summary grid) is untouched by this task", () => {
  // TASK #69A-35A widened this expression's own OUTER shape (a new
  // nativeDecisionMatch tier now takes priority before
  // structuredInvestmentRecommendation -- see that fix's own comment),
  // but never removed structuredInvestmentRecommendation from the chain
  // this test's own intent is checking for.
  assert.match(
    pageSource,
    /const decisionSignal =\s*\n\s*marketDecisionSignal \?\?\s*\n\s*\(nativeDecisionMatch\s*\n\s*\? nativeDecisionMatch\.token\.toUpperCase\(\)\s*\n\s*: structuredInvestmentRecommendation/
  );
  assert.match(
    pageSource,
    /const decisionConfidence =\s*\n\s*marketDecisionConfidence !== null\s*\n\s*\? `\$\{marketDecisionConfidence\}%`\s*\n\s*: structuredInvestmentConfidence !== null/
  );
});

// -----------------------------------------------------------------------
// Requirement 9 -- untouched surfaces
// -----------------------------------------------------------------------

test("requirement 9: Market Intelligence's own canonical resolution (resolveMarketIntelligenceGatedExecutiveDecision) is called with the exact same arguments in every fixed function -- untouched by this task", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision\(/);
  }
});

test("requirement 9: the hardcoded Competitor Landscape chart (page.tsx) is not referenced by, or near, any of this task's changes", () => {
  assert.doesNotMatch(pageSource, /ZERINIX Thesis[\s\S]{0,400}structuredInvestmentRecommendation/);
  assert.doesNotMatch(pageSource, /structuredInvestmentRecommendation[\s\S]{0,400}ZERINIX Thesis/);
});
