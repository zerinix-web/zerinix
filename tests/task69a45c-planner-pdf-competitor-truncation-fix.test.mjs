// TASK #69A-45C -- Fix the ACTUAL exported PDF Competitor Landscape
// truncation.
//
// ROOT CAUSE (the real one, distinct from #69A-45/#69A-45A/#69A-45B):
// ReportPdfButton.tsx's own generic competitor table was already fully
// fixed by those three prior tickets (no per-cell line cap, a
// dedicated row-pagination-aware drawing branch). But components/
// Planner.tsx's downloadPdf function is a COMPLETELY SEPARATE, parallel
// client-side PDF export implementation with its OWN independent
// competitor-table drawing code -- confirmed by direct inspection, it
// was never touched by any of those three tickets. Its own drawing
// branch (drawPdfVisual) still called
// `truncatePdfCellLines(pdf.splitTextToSize(value, width - 4), 2)` for
// EVERY non-company cell -- the exact, unmodified pre-#69A-45 pattern.
// This is exactly why a real exported PDF (from THIS component's own
// "Download PDF" button, not ReportPdfButton.tsx's) still showed
// QuickBooks/Xero's Positioning/Strengths/Weaknesses cells cut with an
// ellipsis after three rounds of fixes to a different file entirely.
//
// FIX: mirrors ReportPdfButton.tsx's own getCompetitorTableLayout
// exactly -- a single shared layout function (getCompetitorTableLayout,
// defined once, used by BOTH getPdfVisualHeight and drawPdfVisual) with
// NO per-cell line-count cap and NO ellipsis fallback of any kind. Since
// a table with no cap can no longer be assumed to always fit on one
// page, the Competitor Landscape section (non-Market-Intelligence
// reports) gets its own dedicated, row-pagination-aware branch directly
// in pdfSections.forEach, positioned right after the existing
// "strategicRecommendations" branch (TASK #25C) this file already uses
// as its own established precedent for exactly this class of fix.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);
const stateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");

function extractDedicatedCompetitorBranch() {
  const startMarker = "!isMarketIntelligence &&\n\t          (section.field === \"competitiveLandscape\" || section.field === \"competitorLandscape\")";
  const startIndex = plannerSource.indexOf(startMarker);
  assert.ok(startIndex >= 0, "expected to find Planner.tsx's own #69A-45C dedicated competitor branch condition");
  // Generous, bounded window -- wide enough to capture the whole
  // while-loop body, never unbounded.
  return plannerSource.slice(startIndex, startIndex + 6000);
}

// --- ROOT CAUSE PROOF: this really is a separate implementation --------

test("ROOT CAUSE PROOF: Planner.tsx's downloadPdf defines its own resolveCompetitorRowsForDownloadPdf/getPdfVisualHeight/drawPdfVisual -- a genuinely separate PDF export path from ReportPdfButton.tsx's resolveCompetitorRowsForPdf/getVisualHeight/drawSectionVisual, confirming this was never touched by #69A-45/#69A-45A/#69A-45B", () => {
  assert.match(plannerSource, /function resolveCompetitorRowsForDownloadPdf\(/);
  assert.match(plannerSource, /const getPdfVisualHeight = \(section: ReportSection\) => \{/);
  assert.match(plannerSource, /const drawPdfVisual = \(section: ReportSection, sectionY: number\) => \{/);
  // Confirms these are genuinely distinct identifiers from
  // ReportPdfButton.tsx's own equivalents (no accidental shared import).
  assert.doesNotMatch(plannerSource, /function resolveCompetitorRowsForPdf\(/);
  assert.match(pdfButtonSource, /function resolveCompetitorRowsForPdf\(/);
});

// --- 1: no ellipsis-based truncation of competitor content -------------

test("1. Planner.tsx's own getCompetitorTableLayout has no per-cell line-count cap and never calls truncatePdfCellLines -- every cell's full wrapped line array is always returned", () => {
  const layoutMatch = plannerSource.match(/const getCompetitorTableLayout = \([\s\S]{0,3500}?\n      \};/);
  assert.ok(layoutMatch, "expected to isolate Planner.tsx's own getCompetitorTableLayout body");
  assert.doesNotMatch(
    layoutMatch[0],
    /truncatePdfCellLines\(/,
    "must never CALL truncatePdfCellLines (a passing mention in an explanatory comment is fine)"
  );
  assert.match(
    layoutMatch[0],
    /return pdf\.splitTextToSize\(value \|\| "Validation required", columnWidth - 4\) as string\[\];/,
    "must return the full wrapped array with no truncation applied"
  );
});

test("1b. the OLD hard 2-line truncation call for the generic (non-MI) competitor table is completely gone from Planner.tsx", () => {
  assert.doesNotMatch(
    plannerSource,
    /truncatePdfCellLines\(pdf\.splitTextToSize\(value \|\| "Validation required", width - 4\) as string\[\], 2\)/,
    "the old flat 2-line truncation call must be gone from the generic (non-MI) competitor table"
  );
});

test("1c. Planner.tsx's Market-Intelligence-only competitor table (a separate, untouched code path with its own columns/Market Map) still exists unchanged -- this ticket scoped its fix to the generic Business Plan/Acquisition table only", () => {
  assert.match(
    plannerSource,
    /truncatePdfCellLines\(pdf\.splitTextToSize\(value \|\| localizePdfPresentationLabel\("Validation Required", pdfLocale\), width - 4\) as string\[\], 2\)/,
    "the MI-only competitor table's own truncation must remain untouched -- out of scope for this fix"
  );
});

// --- 2/3: long QuickBooks/Xero-style positioning/strengths/weaknesses --

test("2/3. BEHAVIORAL PROOF: the real, full-length Xero weakness sentence AND comparably long QuickBooks-style positioning/strengths sentences all wrap to their full content, with every word preserved in order and no ellipsis appended", () => {
  const columnWidth = 180 * 0.2 - 4;
  const fontSizePt = 5.5;
  const avgCharWidthMm = fontSizePt * 0.55 * 0.3528;
  const charsPerLine = Math.max(10, Math.floor(columnWidth / avgCharWidthMm));
  const fakeWrap = (text) => {
    const words = text.split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > charsPerLine && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const realXeroWeakness =
    "Its own official product documentation describes the relevant capability as a feature embedded within a broader general-purpose platform rather than a dedicated, purpose-built specialization [R7].";
  const quickBooksStylePositioning =
    "Intuit QuickBooks positions itself as the dominant, all-in-one small business accounting platform, bundling invoicing, payroll, and now AI-assisted forecasting directly into its existing Online and Enterprise Suite subscription tiers rather than as a standalone specialist tool [R6].";
  const quickBooksStyleStrength =
    "Intuit QuickBooks benefits from an extensive, well-established ecosystem of third-party accounting, payroll, and payments integrations that most narrowly-focused forecasting challengers cannot match, reinforcing its incumbency across small and mid-sized business finance teams.";

  for (const text of [realXeroWeakness, quickBooksStylePositioning, quickBooksStyleStrength]) {
    const wrapped = fakeWrap(text);
    assert.ok(wrapped.length > 2, "sanity: this sentence needs more than 2 lines to wrap fully");
    assert.equal(wrapped.join(" "), text, "every word must survive, in order, with nothing dropped or replaced");
    assert.ok(!wrapped.some((line) => line.endsWith("...")), "no wrapped line may end with an ellipsis");
  }
});

test("3b. STRUCTURAL PROOF: Planner.tsx's row-height formula has no upper bound on maxLines -- rowHeight only ever grows with real content, never clamped to a maximum", () => {
  assert.match(
    plannerSource,
    /const maxLines = Math\.max\(2, \.\.\.wrappedCells\.map\(\(lines\) => lines\.length\)\);/
  );
  assert.match(
    plannerSource,
    /return maxLines <= 2 \? competitorRowHeight : competitorRowHeight \+ \(maxLines - 2\) \* competitorLineStep;/
  );
});

// --- 4/5/6: dedicated row-pagination branch exists and is correct ------

test("4. a dedicated Competitor Landscape branch exists directly in Planner.tsx's pdfSections.forEach, gated to non-Market-Intelligence reports and the real full-table case (>= minCompetitorTableRows)", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /const competitorRows = resolveCompetitorRowsForDownloadPdf\(/);
  assert.match(branch, /if \(competitorRows\.length >= minCompetitorTableRows\) \{/);
});

test("4b. the dedicated branch computes layout ONCE via the shared getCompetitorTableLayout and paginates using a while loop over rowCursor -- never a fixed, single-page assumption", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /const layout = getCompetitorTableLayout\(competitorRows, bodyWidth\);/);
  assert.match(branch, /while \(rowCursor < competitorRows\.length\) \{/);
});

test("5. a row is NEVER split across two pages -- the chunk-sizing loop always keeps at least one row per chunk and only adds a row to the current chunk if the WHOLE row still fits, mirroring this file's OWN 'strategicRecommendations' precedent exactly", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(
    branch,
    /if \(rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight\) \{\s*\n\s*break;\s*\n\s*\}/,
    "expected the same 'always keep >= 1 row per chunk' safeguard this file's Strategic Recommendations branch already established"
  );
  assert.match(branch, /chunkRowsHeight = candidateRowsHeight;/);
  assert.match(branch, /rowsInChunk \+= 1;/);
});

test("5b. ensureSpace(chunkCardHeight) is called for every chunk -- the SAME page-break primitive every other multi-page PDF visual in this file already uses safely", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /ensureSpace\(chunkCardHeight\);/);
});

test("6. each continuation chunk redraws its OWN title (suffixed 'continued'/'devamı') AND its own full column header band -- headers and column alignment are never lost after a page break", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(
    branch,
    /const chunkTitle = isFirstCompetitorChunk\s*\n\s*\? displaySectionTitle\s*\n\s*: `\$\{displaySectionTitle\}\$\{pdfLocale === "tr" \? " devamı" : " continued"\}`;/
  );
  assert.match(
    branch,
    /layout\.columns\.forEach\(\(column\) => \{\s*\n\s*pdf\.text\(column\.label\.toUpperCase\(\), tableX \+ 2, tableTopY \+ 5\.2, \{ maxWidth: column\.width - 4 \}\);/,
    "every chunk (including continuation chunks) must redraw the column header band"
  );
});

test("6b. the TOC entry is pushed exactly once, only for the FIRST chunk -- a continuation page never adds a duplicate table-of-contents entry for the same section", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(
    branch,
    /if \(isFirstCompetitorChunk\) \{\s*\n\s*tocEntries\.push\(\{/
  );
});

test("6c. every cell's FULL wrapped line array (layout.rowWrappedValues, no truncation) is what actually gets drawn -- no re-slicing at the drawing call site itself", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /layout\.rowWrappedValues\[rowIndex\]\.forEach\(\(lines, cellIndex\) => \{/);
  assert.match(
    branch,
    /pdf\.text\(lines, cellX \+ 2, rowY \+ 4\.7, \{\s*\n\s*lineHeightFactor: 1\.1,\s*\n\s*maxWidth: width - 4,\s*\n\s*\}\);/
  );
});

test("6d. row/column drawing never uses coordinates outside the reserved card frame -- borders (pdf.line) span exactly bodyX to bodyX + bodyWidth, matching the roundedRect background's own width, so a row can never visually overlap into an adjacent card or off the page edge", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /pdf\.line\(bodyX, rowY, bodyX \+ bodyWidth, rowY\);/);
  assert.match(
    branch,
    /pdf\.roundedRect\(bodyX, tableTopY, bodyWidth, layout\.headerHeight \+ chunkRowsHeight, 3, 3, "FD"\);/
  );
});

// --- BEHAVIORAL PROOF: reconstructing the documented chunking algorithm

test("BEHAVIORAL PROOF: reconstructing the exact documented row-chunking algorithm on a pathological fixture (5 rows, each so tall that all 5 together exceed one page) correctly splits the table across multiple chunks, never splits a single row, and every chunk stays within the page's usable height", () => {
  const cardHeaderHeight = 25; // Planner.tsx's own constant (distinct from ReportPdfButton.tsx's 24)
  const tableHeaderHeight = 8;
  const cardBottomPadding = 11; // Planner.tsx's own constant (distinct from ReportPdfButton.tsx's 9)
  const maxUsableCardHeight = 297 - 14 - 14; // A4 pageHeight - 2*margin

  function chunkRows(rowHeightsForTable) {
    const chunks = [];
    let rowCursor = 0;

    while (rowCursor < rowHeightsForTable.length) {
      let rowsInChunk = 0;
      let chunkRowsHeight = 0;

      for (let candidate = rowCursor; candidate < rowHeightsForTable.length; candidate += 1) {
        const candidateRowsHeight = chunkRowsHeight + rowHeightsForTable[candidate];
        const candidateCardHeight = cardHeaderHeight + tableHeaderHeight + candidateRowsHeight + cardBottomPadding;

        if (rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight) {
          break;
        }

        chunkRowsHeight = candidateRowsHeight;
        rowsInChunk += 1;
      }

      chunks.push({ startRow: rowCursor, rowCount: rowsInChunk, chunkRowsHeight });
      rowCursor += rowsInChunk;
    }

    return chunks;
  }

  const pathologicalRowHeights = [60, 60, 60, 60, 60];
  const chunks = chunkRows(pathologicalRowHeights);

  const totalRowsAcrossChunks = chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0);
  assert.equal(totalRowsAcrossChunks, pathologicalRowHeights.length);
  assert.ok(chunks.length > 1, "sanity: this pathological fixture must genuinely require more than one chunk/page");

  for (const chunk of chunks) {
    const chunkCardHeight = cardHeaderHeight + tableHeaderHeight + chunk.chunkRowsHeight + cardBottomPadding;
    assert.ok(
      chunkCardHeight <= maxUsableCardHeight,
      `chunk starting at row ${chunk.startRow} (height ${chunkCardHeight}mm) must fit within the usable page height (${maxUsableCardHeight}mm)`
    );
  }

  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.startRow, cursor, "chunks must be contiguous and non-overlapping");
    assert.ok(chunk.rowCount >= 1, "every chunk must contain at least one whole row");
    cursor += chunk.rowCount;
  }
  assert.equal(cursor, pathologicalRowHeights.length);
});

// --- 7: typography preserved -------------------------------------------

test("7. cell font sizes in the dedicated branch are unchanged -- 6.3pt company / 5.5pt other cells", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /pdf\.setFontSize\(cellIndex === 0 \? 6\.3 : 5\.5\);/);
});

// --- Web rendering / competitor intelligence untouched -----------------

test("REGRESSION: business-competitor-landscape-state.ts (competitor scoring/evidence extraction/weakness derivation/research behavior) carries no #69A-45C marker and is completely untouched by this ticket", () => {
  assert.doesNotMatch(stateSource, /TASK #69A-45C/);
});

test("REGRESSION: no new research call, prompt change, or cache-version bump -- this is a pure PDF rendering/layout fix", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-45C/);
});

test("REGRESSION: no canonical decision (createRecommendation/applyFatalBlockerOverride), Porter's Five Forces, Founder Readiness, or Investment Score file carries a #69A-45C marker", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/report-intelligence.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-45C/, `${relativePath} must not carry a #69A-45C marker`);
  }
});

test("REGRESSION: page.tsx (a separate web-rendering file, not a PDF export path) carries no #69A-45C marker -- this ticket is scoped to Planner.tsx's downloadPdf only", () => {
  assert.doesNotMatch(pageSource, /TASK #69A-45C/);
});

test("REGRESSION: Planner.tsx's own WEB rendering of the competitor table (the on-screen <div>, not downloadPdf) is completely untouched -- still has no line-clamp, confirming this fix is PDF-export-only", () => {
  const webTableMatch = plannerSource.match(
    /if \(field === "competitorAnalysis" \|\| field === "competitorLandscape"\)[\s\S]{0,3000}/
  );
  assert.ok(webTableMatch, "expected to find Planner.tsx's own web competitor table render");
  assert.doesNotMatch(webTableMatch[0], /line-clamp/);
});

// --- SAFETY: no hardcoded competitor names -------------------------------

test("SAFETY: the dedicated pagination branch and shared layout function contain no hardcoded competitor-specific name or text -- fully generic over whatever rows resolveCompetitorRowsForDownloadPdf returns", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.doesNotMatch(branch, /QuickBooks|Xero|Fathom|Dryrun|Intuit/i);

  const layoutMatch = plannerSource.match(/const getCompetitorTableLayout = \([\s\S]{0,3500}?\n      \};/);
  assert.ok(layoutMatch);
  assert.doesNotMatch(layoutMatch[0], /QuickBooks|Xero|Fathom|Dryrun|Intuit/i);
});
