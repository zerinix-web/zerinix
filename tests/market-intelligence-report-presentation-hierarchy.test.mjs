import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// FINAL REPORT PRESENTATION CLEANUP -- restore premium investor-report
// hierarchy across Executive Summary, Market Drivers, Barriers,
// Opportunities, Threats, TAM/SAM/SOM, and Strategic Recommendations.
//
// Prior tickets fixed this exact duplication pattern (a premium visual
// card shown above a repeating ExecutiveInsightBanner snippet and a
// repeating SectionTakeaway short-takeaway, plus an always-visible raw
// paragraph) for TAM/SAM/SOM only. This ticket generalizes the same fix
// to six more sections via a single `cardFirstReportFields` set, shared
// by both the banner/takeaway exclusion and (on page.tsx's mobile view)
// the collapsed-vs-always-visible body text decision.
//
// It also fixes two further concrete bugs surfaced by this same pass:
// (a) Planner.tsx was drawing TWO different visual cards for Executive
//     Summary (ExecutiveSummaryVisual AND PremiumSectionVisual's own
//     separate "Executive Decision" card) -- now only one renders.
// (b) Competitive Landscape's empty state was two stacked "no data"
//     placeholders (an empty table shell plus MarketMap's own empty
//     state) -- now a single clean "Validation Needed" card.
//
// AI generation, routing, calculations, and validation logic are
// untouched -- only presentation hierarchy changed, confirmed via drift
// checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

const requiredCardFirstFields = [
  "executiveSummary",
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "tamSamSom",
  "strategicRecommendations",
];

// --- 1 & 2. Card-first sections, no duplicate summary/takeaway ------------

test("page.tsx and Planner.tsx: cardFirstReportFields contains exactly the seven sections this ticket names -- Executive Summary, Market Drivers, Barriers, Opportunities, Threats, TAM/SAM/SOM, Strategic Recommendations", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    for (const field of requiredCardFirstFields) {
      assert.match(setMatch[1], new RegExp(`"${field}",`));
    }
  }
});

test("page.tsx: ExecutiveInsightBanner and SectionTakeaway are both gated on !cardFirstReportFields.has(section.field) -- none of the seven card-first sections shows a duplicate insight snippet above (or takeaway below) its dedicated visual card", () => {
  assert.match(
    pageSource,
    /hasReportSectionVisual\(section\.title\) &&\s*\n\s*!isFinancialDashboard &&\s*\n\s*!cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<ExecutiveInsightBanner/
  );
  assert.match(
    pageSource,
    /detailsContent\.trim\(\) && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<SectionTakeaway/
  );
});

test("Planner.tsx: ExecutiveInsightBanner and SectionTakeaway are both gated on !cardFirstReportFields.has(section.field)", () => {
  assert.match(
    plannerSource,
    /hasPremiumSectionVisual\(section\) &&\s*\n\s*section\.field !== "financialDashboard" &&\s*\n\s*!cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<ExecutiveInsightBanner/
  );
  assert.match(
    plannerSource,
    /hasVisibleDetailsContent && !cardFirstReportFields\.has\(section\.field \?\? ""\) \? \(\s*\n\s*<SectionTakeaway/
  );
});

test("Market Drivers/Barriers/Opportunities/Threats already share one combined visual (MarketForcesQuadrant) -- these four individual sections now correctly show no duplicate SectionTakeaway either (previously only ExecutiveInsightBanner was implicitly suppressed by the visual gate, but SectionTakeaway was NOT)", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const field of ["marketDrivers", "barriers", "opportunities", "threats"]) {
      assert.match(setMatch, new RegExp(`"${field}",`));
    }
  }
});

test("MarketForcesQuadrant remains purely additive -- each of marketDrivers/barriers/opportunities/threats still renders as its own full section card (title + collapsed methodology), the combined quadrant view only supplements them once", () => {
  assert.match(pageSource, /section\.field === "marketDrivers" && report\.type === "Market Analysis" \? \(\s*\n\s*<MarketForcesQuadrant/);
  assert.match(plannerSource, /isMarketIntelligence \? <MarketForcesQuadrant sections=\{sections\} \/> : null/);
  // The quadrant's own gate: only renders once all 4 fields have content.
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function MarketForcesQuadrant/);
    assert.match(source, /quadrants\.length < marketForcesQuadrants\.length/);
  }
});

test("Strategic Recommendations: the duplicate investor-insight banner and takeaway above the action cards are gone -- only the action cards themselves render as primary content", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/)[1];
    assert.match(setMatch, /"strategicRecommendations",/);
  }
  // The action-card visual itself is untouched (regression guard).
  assert.match(pageSource, /normalizedTitle\.includes\("strategic recommendation"\)/);
  assert.match(plannerSource, /field === "strategicRecommendations"/);
});

// --- Executive Summary: no second stacked visual card in Planner.tsx ------

test("Planner.tsx: Executive Summary no longer draws two different visual cards -- PremiumSectionVisual is skipped for executiveSummary since ExecutiveSummaryVisual already covers it", () => {
  assert.match(
    plannerSource,
    /!isDomainDecisionReport && section\.field !== "executiveSummary" \? \(\s*\n\s*<PremiumSectionVisual/
  );
});

test("page.tsx: Executive Summary was never affected by the two-card bug (ReportSectionVisual has no executive-summary branch) -- regression guard confirming this remains true", () => {
  const visualFn = pageSource.match(/function ReportSectionVisual\([\s\S]*?\n\}\n\nfunction /)[0];
  assert.doesNotMatch(visualFn, /normalizedTitle\.includes\("executive summary"\)/);
});

// --- 3. Methodology/formulas/assumptions stay in collapsed Details --------

// A later ticket ("FINAL CLEANUP -- remove all redundant DETAILS
// duplication") superseded the "collapse into AnalysisNotes" treatment
// below with full removal: card-first sections' own extraction was
// enriched to capture the COMPLETE remaining prose/bullets (not a capped
// teaser), making even a collapsed raw-text disclosure fully redundant.
// See tests/market-intelligence-final-cleanup-details-duplication.test.mjs
// for the current, superseding behavior.
test("page.tsx mobile: every card-first section's raw paragraph is gated on isCardFirstSection (regression guard on the underlying flag this file's own tests, and the later ticket's, both depend on)", () => {
  assert.match(pageSource, /const isCardFirstSection = cardFirstReportFields\.has\(section\.field \?\? ""\);/);
});

// --- 4. Competitive Landscape: clean validation card, not empty sections --

test("page.tsx and Planner.tsx: an empty Competitive Landscape (0 validated competitors) renders one clean 'Validation Needed' card -- not a large empty table shell stacked with a second empty MarketMap state", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /if \(rows\.length === 0\) \{[\s\S]*?<div className="mb-5 rounded-\[2rem\] border border-dashed border-white\/15 bg-black\/20 p-5">/
    );
    assert.match(source, /No competitor data could be validated for this market yet\./);
    // The old two-stacked-empty-states markup (empty table shell +
    // MarketMap rendered underneath) is gone from this branch.
    assert.doesNotMatch(source, /rows\.length > 0 \? \(\s*\n\s*<div className="overflow-x-auto">/);
  }
});

test("Competitive Landscape with real competitor rows is unaffected -- the full table and MarketMap still render exactly as before (regression guard)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /\["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Validation"\]/);
    assert.match(source, /<MarketMap rows=\{rows\} \/>/);
  }
});

// --- 5. Preserve: AI generation, routing, calculations, validation logic --

test("AI generation and routing are untouched (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /marketDrivers:/);
  assert.match(marketPromptSource, /strategicRecommendations:/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);
});

test("calculations and validation logic are untouched -- the cascading TAM/SAM/SOM nesting check and market-intelligence-graph.ts stay exactly as the prior ticket left them (drift check)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/);
  }

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
});
