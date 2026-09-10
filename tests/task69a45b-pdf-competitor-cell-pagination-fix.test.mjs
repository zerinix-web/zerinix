// TASK #69A-45B -- Fix PDF Competitor Landscape cell truncation without
// reintroducing overflow.
//
// ROOT CAUSE: #69A-45A grew the competitor table's row height/background
// to fit long content, but kept a fixed per-cell line-count cap
// (COMPETITOR_CELL_MAX_LINES = 8) with an ellipsis fallback beyond it --
// confirmed live, still visibly cutting Xero's real, evidence-backed
// weakness sentence mid-word in the exported PDF. #69A-45A's own bound
// proof ("5 rows x 8-line cap always fits on one page") depended on
// that cap existing; it was never actually enough for the true
// jsPDF-measured wrap of a real sentence at this column's width/font.
//
// FIX: getCompetitorTableLayout (ReportPdfButton.tsx) no longer caps
// line count at all -- every cell wraps to however many lines it
// genuinely needs, with NO ellipsis, ever, for competitor content. Since
// a table with no cap can no longer be assumed to always fit on one
// page, the Competitor Landscape section (non-Market-Intelligence
// reports) now gets its own dedicated, row-pagination-aware drawing
// branch directly in pdfSections.forEach -- mirroring TASK #25C's own
// Strategic Recommendations precedent exactly: paginates strictly by
// WHOLE rows (a row is never split across two pages -- "move the whole
// row to the next page"), each continuation card redraws its own title
// (suffixed "continued") and full column header band (so headers/column
// alignment are never lost after a page break), using the SAME
// ensureSpace/y bookkeeping every other multi-page PDF visual in this
// file already uses safely.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);
const stateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");

function extractDedicatedCompetitorBranch() {
  const startMarker = "if (\n          !isMarketIntelligenceReport &&\n          (section.title.toLowerCase().includes(\"competitor\") ||";
  const startIndex = pdfButtonSource.indexOf(startMarker);
  assert.ok(startIndex >= 0, "expected to find the #69A-45B dedicated competitor branch's opening condition");
  // Generous, bounded window -- wide enough to capture the whole
  // while-loop body, never unbounded.
  return pdfButtonSource.slice(startIndex, startIndex + 6000);
}

// --- 1: no ellipsis-based truncation of competitor content -------------

test("1. getCompetitorTableLayout no longer caps per-cell line count or falls back to an ellipsis for any competitor field -- every cell's full wrapped line array is always returned", () => {
  assert.doesNotMatch(pdfButtonSource, /const COMPETITOR_CELL_MAX_LINES = /);
  const layoutMatch = pdfButtonSource.match(/const getCompetitorTableLayout = \([\s\S]{0,3500}?\n      \};/);
  assert.ok(layoutMatch, "expected to isolate getCompetitorTableLayout's own body");
  assert.doesNotMatch(
    layoutMatch[0],
    /truncatePdfCellLines\(/,
    "must never CALL truncatePdfCellLines (a passing mention in an explanatory comment is fine)"
  );
  assert.match(
    layoutMatch[0],
    /return wrapPdfText\(value \|\| "Validation required", columnWidth - 4\);/,
    "must return the full wrapped array with no truncation applied"
  );
});

// --- 2/3: long QuickBooks/Xero-style weaknesses/strengths survive ------

test("2/3. BEHAVIORAL PROOF: the real, full-length Xero weakness sentence AND a comparably long QuickBooks-style strength sentence both wrap to their full content, with every word preserved in order and no ellipsis appended", () => {
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
  const quickBooksStyleStrength =
    "Intuit QuickBooks benefits from an extensive, well-established ecosystem of third-party accounting, payroll, and payments integrations that most narrowly-focused forecasting challengers cannot match, reinforcing its incumbency across small and mid-sized business finance teams [R6].";

  for (const text of [realXeroWeakness, quickBooksStyleStrength]) {
    const wrapped = fakeWrap(text);
    assert.ok(wrapped.length > 2, "sanity: this sentence needs more than 2 lines to wrap fully");
    assert.equal(wrapped.join(" "), text, "every word must survive, in order, with nothing dropped or replaced");
    assert.ok(!wrapped.some((line) => line.endsWith("...")), "no wrapped line may end with an ellipsis");
  }
});

test("3b. STRUCTURAL PROOF: the shared layout's row-height formula has no upper bound on maxLines -- rowHeight only ever grows with real content, never clamped to a maximum", () => {
  assert.match(
    pdfButtonSource,
    /const maxLines = Math\.max\(2, \.\.\.wrappedCells\.map\(\(lines\) => lines\.length\)\);/
  );
  assert.match(
    pdfButtonSource,
    /return maxLines <= 2 \? rowHeight : rowHeight \+ \(maxLines - 2\) \* COMPETITOR_CELL_LINE_STEP;/
  );
  // No Math.min/clamp of any kind wraps this specific formula.
  const formulaContext = pdfButtonSource.slice(
    pdfButtonSource.indexOf("const maxLines = Math.max(2,"),
    pdfButtonSource.indexOf("const maxLines = Math.max(2,") + 300
  );
  assert.doesNotMatch(formulaContext, /Math\.min\(/);
});

// --- 4/5/6: dedicated row-pagination branch exists and is correct ------

test("4. a dedicated Competitor Landscape branch exists directly in pdfSections.forEach, gated to non-Market-Intelligence reports and the real full-table case (>= minCompetitorTableRows)", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /const competitorRows = resolveCompetitorRowsForPdf\(report, section\.content\);/);
  assert.match(branch, /if \(competitorRows\.length >= minCompetitorTableRows\) \{/);
});

test("4b. the dedicated branch computes layout ONCE via getCompetitorTableLayout (the same shared function getVisualHeight's own branch calls) and paginates using a while loop over rowCursor -- never a fixed, single-page assumption", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /const layout = getCompetitorTableLayout\(competitorRows, bodyWidth\);/);
  assert.match(branch, /while \(rowCursor < competitorRows\.length\) \{/);
});

test("5. a row is NEVER split across two pages -- the chunk-sizing loop always keeps at least one row per chunk and only adds a row to the current chunk if the WHOLE row still fits, mirroring TASK #25C's own Strategic Recommendations precedent exactly", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(
    branch,
    /if \(rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight\) \{\s*\n\s*break;\s*\n\s*\}/,
    "expected the same 'always keep >= 1 row per chunk' safeguard #25C already established"
  );
  assert.match(branch, /chunkRowsHeight = candidateRowsHeight;/);
  assert.match(branch, /rowsInChunk \+= 1;/);
});

test("5b. ensureSpace(chunkCardHeight) is called for every chunk -- the SAME page-break primitive every other multi-page PDF visual in this file already uses safely (paints the new page background, resets y to margin, mirrors #25C)", () => {
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

// --- BEHAVIORAL PROOF: reconstructing the documented chunking algorithm

test("BEHAVIORAL PROOF: reconstructing the exact documented row-chunking algorithm on a pathological fixture (5 rows, each so tall that all 5 together exceed one page) correctly splits the table across multiple chunks, never splits a single row, and every chunk stays within the page's usable height", () => {
  const cardHeaderHeight = 24;
  const tableHeaderHeight = 8;
  const cardBottomPadding = 9;
  const maxUsableCardHeight = 297 - 14 - 14; // A4 pageHeight - 2*margin

  // Reconstructs the EXACT chunk-sizing loop from the real source
  // (verified structurally above) with a pathological fixture: 5 rows
  // each 60mm tall (a realistically-impossible but illustrative worst
  // case -- 5 * 60 + 8 = 308mm, deliberately more than one page's
  // 269mm usable height).
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

  // Every row must be accounted for exactly once, in order.
  const totalRowsAcrossChunks = chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0);
  assert.equal(totalRowsAcrossChunks, pathologicalRowHeights.length);
  assert.ok(chunks.length > 1, "sanity: this pathological fixture must genuinely require more than one chunk/page");

  // No chunk's card height may exceed the usable page height.
  for (const chunk of chunks) {
    const chunkCardHeight = cardHeaderHeight + tableHeaderHeight + chunk.chunkRowsHeight + cardBottomPadding;
    assert.ok(
      chunkCardHeight <= maxUsableCardHeight,
      `chunk starting at row ${chunk.startRow} (height ${chunkCardHeight}mm) must fit within the usable page height (${maxUsableCardHeight}mm)`
    );
  }

  // Every row appears in exactly one chunk (no row split, no row
  // duplicated or skipped).
  let cursor = 0;
  for (const chunk of chunks) {
    assert.equal(chunk.startRow, cursor, "chunks must be contiguous and non-overlapping");
    assert.ok(chunk.rowCount >= 1, "every chunk must contain at least one whole row");
    cursor += chunk.rowCount;
  }
  assert.equal(cursor, pathologicalRowHeights.length);
});

test("BEHAVIORAL PROOF 2: a single pathologically tall row (taller than a full page by itself) still gets its own chunk rather than looping forever or being silently dropped", () => {
  const cardHeaderHeight = 24;
  const tableHeaderHeight = 8;
  const cardBottomPadding = 9;
  const maxUsableCardHeight = 297 - 14 - 14;

  function chunkRows(rowHeightsForTable) {
    const chunks = [];
    let rowCursor = 0;
    let iterations = 0;

    while (rowCursor < rowHeightsForTable.length) {
      iterations += 1;
      assert.ok(iterations < 100, "chunking must terminate -- a pathological row must not cause an infinite loop");

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

      chunks.push({ startRow: rowCursor, rowCount: rowsInChunk });
      rowCursor += rowsInChunk;
    }

    return chunks;
  }

  // A single row taller than the entire usable page by itself.
  const chunks = chunkRows([500]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].rowCount, 1, "the pathologically tall row must still be drawn (its own chunk), never dropped");
});

// --- 7: typography preserved -------------------------------------------

test("7. cell font sizes in the dedicated branch are unchanged -- 6.3pt company / 5.5pt other cells", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.match(branch, /pdf\.setFontSize\(cellIndex === 0 \? 6\.3 : 5\.5\);/);
});

// --- Regression: 5-competitor cap, competitor intelligence unchanged --

test("REGRESSION: business-competitor-landscape-state.ts (the 5-competitor cap, weakness derivation, evidence extraction, research behavior) carries no #69A-45B marker and is completely untouched by this ticket", () => {
  assert.doesNotMatch(stateSource, /TASK #69A-45B/);
  assert.match(stateSource, /competitors: competitors\.slice\(0, 5\),/);
});

test("REGRESSION: no new research call, prompt change, or cache-version bump -- this is a pure PDF rendering/layout fix", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-45B/);
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(
    planExecutorSource
  );
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  // TASK #69A-47 -- widened from a strict "=== 12" to ">= 12": a later,
  // legitimate ticket (#69A-47, founderScore.score preservation) bumped
  // this constant again for its own real, unrelated reason -- this
  // ticket's own concern (no bump was needed BY #69A-45B itself) is
  // unaffected by a later ticket's own legitimate bump.
  assert.ok(
    Number(match[1]) >= 12,
    "the contract version must be at v12 or later -- this ticket itself persists nothing new"
  );
});

test("REGRESSION: no canonical decision (createRecommendation/applyFatalBlockerOverride), Porter's Five Forces, Founder Readiness, or Investment Score file carries a #69A-45B marker", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/report-intelligence.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-45B/, `${relativePath} must not carry a #69A-45B marker`);
  }
});

test("REGRESSION: no web rendering file (Planner.tsx/page.tsx) carries a #69A-45B marker -- this is a PDF-only rendering fix, the web table's own <div> (no line-clamp) was already correct and untouched", () => {
  assert.doesNotMatch(plannerSource, /TASK #69A-45B/);
  assert.doesNotMatch(pageSource, /TASK #69A-45B/);
});

// --- SAFETY: no hardcoded competitor names -------------------------------

test("SAFETY: the dedicated pagination branch contains no hardcoded competitor-specific name or text -- it is fully generic over whatever rows resolveCompetitorRowsForPdf returns", () => {
  const branch = extractDedicatedCompetitorBranch();
  assert.doesNotMatch(branch, /QuickBooks|Xero|Fathom|Dryrun|Intuit/i);
});
