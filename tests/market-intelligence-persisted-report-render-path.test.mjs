import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReport } from "../app/dashboard/report-utils.ts";
import {
  isUniversalCustomerFacingSection,
  sanitizeMarketIntelligencePresentationText,
  stripReportPresentationArtifacts,
} from "../app/lib/report-engine/report-presentation-sanitizer.ts";
import { readMarketIntelligenceCanonicalState } from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #25B -- regression coverage for the dashboard report-detail page's
// render path (app/dashboard/[id]/page.tsx's ReportDetailPage) when loading
// an ALREADY-PERSISTED Market Intelligence report, i.e. exactly the
// scenario a user hits by opening a report that was generated before this
// session's edits and never regenerated.
//
// Investigation summary (see task write-up): a real, reproducing hang/500
// was found during this investigation, but it was traced to a self-inflicted
// artifact of the investigation itself (an un-gitignored backup copy of a
// stale .next build directory picked up by Tailwind v4's automatic content
// scanner) -- not to any application code path. Direct testing of the real
// production code below, against realistic persisted-report content and a
// generous wall-clock budget, found no hang, no exception, and no slow path
// anywhere in normalizeReport (the exact transform loadUserReport applies),
// readMarketIntelligenceCanonicalState, or the page's own
// visibleSections pipeline (isUniversalCustomerFacingSection ->
// stripReportPresentationArtifacts -> sanitizeMarketIntelligencePresentationText).
// This test pins that finding down so a future change to any of these
// functions that reintroduces a slow/hanging path on realistic persisted
// data is caught automatically.

const RENDER_PATH_BUDGET_MS = 2000;

function marketIntelligenceSection(field, title, content) {
  return { field, title, content };
}

// Mirrors real persisted-report defects Task #25 fixed (duplicate
// "[Unverified reference]" markers, malformed "[, R12]" fragments) so this
// same fixture also exercises the citation-cleanup path this render path
// depends on (sanitizeMarketIntelligencePresentationText / Task 22's
// citationBracketTagPattern) without assuming it silently no-ops.
function persistedMarketIntelligenceReportRow() {
  const longParagraph = (label) =>
    Array.from({ length: 40 }, (_, i) => `${label} sentence ${i + 1} about the target market and its dynamics.`).join(
      " "
    );

  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    title: "Market Analysis Report",
    prompt: "Should we enter the U.S. mid-market AI compliance SaaS category?",
    report_type: "Market Analysis",
    status: "completed",
    sections: [
      marketIntelligenceSection(
        "executiveSummary",
        "Executive Summary",
        `Bottom Line -- Decision: ENTER the market (see R1, R2). ${longParagraph(
          "Executive"
        )} Some claims lack a resolvable source [Unverified reference][Unverified reference]. Barriers include regulatory friction [, R12].`
      ),
      marketIntelligenceSection("marketOverview", "Market Overview", longParagraph("Overview")),
      marketIntelligenceSection("marketSize", "Market Size", longParagraph("Size")),
      marketIntelligenceSection("cagr", "CAGR", longParagraph("CAGR")),
      marketIntelligenceSection("marketSegmentation", "Market Segmentation", longParagraph("Segmentation")),
      marketIntelligenceSection("regionalAnalysis", "Regional Analysis", longParagraph("Regional")),
      marketIntelligenceSection("industryTrends", "Industry Trends", longParagraph("Trends")),
      marketIntelligenceSection("competitiveLandscape", "Competitive Landscape", longParagraph("Competitive")),
      marketIntelligenceSection("majorPlayers", "Major Players", longParagraph("Players")),
      marketIntelligenceSection("customerSegments", "Customer Segments", longParagraph("Customers")),
      marketIntelligenceSection("marketDrivers", "Market Drivers", longParagraph("Drivers")),
      marketIntelligenceSection(
        "barriers",
        "Barriers",
        `${longParagraph("Barriers")} Regulatory friction [, R12] remains a factor.`
      ),
      marketIntelligenceSection("opportunities", "Opportunities", longParagraph("Opportunities")),
      marketIntelligenceSection("threats", "Threats", longParagraph("Threats")),
      marketIntelligenceSection("tamSamSom", "TAM / SAM / SOM", longParagraph("Sizing")),
      marketIntelligenceSection("portersFiveForces", "Porter's Five Forces", longParagraph("Forces")),
      marketIntelligenceSection(
        "strategicRecommendations",
        "Strategic Recommendations",
        Array.from({ length: 6 }, (_, i) => `Action ${i + 1}: Execute strategic initiative number ${i + 1}.`).join(
          "\n"
        )
      ),
      marketIntelligenceSection(
        "sources",
        "Sources",
        "R1. Example Publisher, https://example.com/1\nR2. Example Publisher Two, https://example.com/2"
      ),
    ],
    // Simulates the actual Supabase JSONB round-trip -- reports.metadata
    // rarely carries a full marketIntelligenceCanonicalState (many
    // persisted reports predate Task #23/24, or were generated under a
    // degraded/no-graph path), only a status marker.
    metadata: JSON.parse(
      JSON.stringify({
        reportPlan: { mode: "market" },
        researchPlan: { steps: [] },
        reportLanguage: "English",
        marketIntelligenceCanonicalStateStatus: "unavailable_no_graph",
      })
    ),
  };
}

test("loading an already-persisted Market Intelligence report through the dashboard render path does not hang", () => {
  const row = persistedMarketIntelligenceReportRow();

  const start = Date.now();

  const report = normalizeReport(row);
  assert.equal(report.type, "Market Analysis");
  assert.equal(report.status, "completed");
  assert.ok(report.sections.length > 0, "normalizeReport must not drop every section for a persisted report");

  const canonicalState = readMarketIntelligenceCanonicalState(report.metadata);

  const storedReportSections = Array.from(
    new Map(report.sections.map((section) => [section.field || section.title, section])).values()
  );

  const visibleSections = storedReportSections
    .filter((section) => isUniversalCustomerFacingSection(section))
    .map((section) => ({
      ...section,
      content: sanitizeMarketIntelligencePresentationText(stripReportPresentationArtifacts(section.content)),
    }))
    .filter((section) => section.content.trim().length > 0);

  const elapsedMs = Date.now() - start;

  assert.ok(
    elapsedMs < RENDER_PATH_BUDGET_MS,
    `persisted-report render path took ${elapsedMs}ms, exceeding the ${RENDER_PATH_BUDGET_MS}ms regression budget`
  );
  assert.ok(visibleSections.length > 0, "the render path must still produce visible sections for a completed report");
  assert.equal(
    visibleSections.length,
    storedReportSections.length,
    "every universal customer-facing section of a completed report must survive the render path"
  );

  // Note: Task #25's citation-cleanup functions (neutralizeUnverifiableEvidenceReferences,
  // sanitizeCitationBracketSyntax, collapseAdjacentDuplicateCitationMarkers) run at
  // GENERATION time in app/api/market-analysis/route.ts, before content is persisted --
  // not in this dashboard render path (report-presentation-sanitizer.ts has no
  // dependency on evidence-reference-integrity.ts). This test's fixture intentionally
  // includes that raw, not-yet-cleaned text to prove its mere presence in stored
  // content cannot make the render path itself hang or throw; citation-cleanup
  // correctness itself is covered by
  // tests/market-intelligence-pdf-citation-and-recommendations-integrity.test.mjs.
  const executiveSummary = visibleSections.find((section) => section.field === "executiveSummary");
  assert.ok(executiveSummary, "executive summary section must survive the render path");

  const barriers = visibleSections.find((section) => section.field === "barriers");
  assert.ok(barriers, "barriers section must survive the render path");

  // canonicalState being null (degraded/no-graph persisted report) must not
  // throw or otherwise break the pipeline above -- asserting it resolved
  // without throwing is the point; a null value here is a valid, expected
  // outcome for reports generated before canonical-state existed.
  assert.ok(canonicalState === null || typeof canonicalState === "object");
});

test("loading an already-persisted report with a null/undefined metadata column does not hang", () => {
  const row = persistedMarketIntelligenceReportRow();
  row.metadata = null;

  const start = Date.now();
  const report = normalizeReport(row);
  const canonicalState = readMarketIntelligenceCanonicalState(report.metadata);
  const elapsedMs = Date.now() - start;

  assert.equal(canonicalState, null);
  assert.ok(elapsedMs < RENDER_PATH_BUDGET_MS, `took ${elapsedMs}ms with null metadata`);
});
