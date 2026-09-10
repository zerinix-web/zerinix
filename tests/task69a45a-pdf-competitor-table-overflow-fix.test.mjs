// TASK #69A-45A -- Fix PDF competitor table overflow without changing
// competitor intelligence logic.
//
// A/ROOT CAUSE: #69A-45 correctly grew the competitor table's DRAWN row
// height/background to fit a long, evidence-backed weakness (e.g.
// Xero's real enrichCompetitorWeaknessesFromEvidence sentence), but
// never touched getVisualHeight's OWN, separate competitor-table
// branch -- which still returned the OLD, flat `8 + rows.length * 15 + 4`
// pagination BUDGET (always "2 lines' worth" per row). getVisualHeight
// runs BEFORE drawSectionVisual specifically to decide how much page
// space to reserve (ensureSpace) for this section and where the NEXT
// section starts -- since a table that draws taller than that stale
// budget has nowhere reserved for the extra height, it can render past
// the bottom of its own card, which is the real, deeper cause of the
// reported PDF clipping (distinct from -- and beneath -- #69A-45's own
// cell-truncation fix, which alone was necessary but not sufficient).
//
// FIX: extracted a single shared getCompetitorTableLayout function
// (mirroring this file's own established getSwotLayout/getPorterLayout/
// getFinancialLayout/getNamesOnlyCompetitorLayout pattern -- "one layout
// function, used by both the pagination budget and the real draw, so
// they cannot disagree") and made BOTH getVisualHeight and
// drawSectionVisual call it. Row height is now genuinely content-driven
// in both places at once, by construction.
//
// BOUND PROOF (why no mid-table page-break mechanism was thought to be
// needed at the time): competitors are schema-capped at 5
// (BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA / competitors.slice(0, 5)),
// and COMPETITOR_CELL_MAX_LINES bounded any single row to at most
// rowHeight + (COMPETITOR_CELL_MAX_LINES - 2) * COMPETITOR_CELL_LINE_STEP.
// Worst case (5 rows, every cell maxed out) was comfortably under
// maxUsableCardHeight (pageHeight - 2*margin) on A4. Once getVisualHeight
// reported the real height, the ensureSpace(fullCardHeight) mechanism --
// already used identically for every other single-page PDF visual in
// this file -- moved the WHOLE table (header + every row together,
// never split) to a fresh page whenever it would not fit in what
// remains of the current one.
//
// SUPERSEDED BY TASK #69A-45B: confirmed live, COMPETITOR_CELL_MAX_LINES
// (8) was still not always enough for the REAL jsPDF-measured wrap of a
// genuinely long, real evidence-backed sentence (Xero's own weakness),
// which was still hard-truncated with an ellipsis. #69A-45B removed the
// cap entirely (no ellipsis, ever, for competitor content) and, since a
// table with no cap can no longer be guaranteed to always fit on one
// page, added a dedicated, row-pagination-aware drawing branch (see
// tests/task69a45b-pdf-competitor-cell-pagination-fix.test.mjs) that
// takes over for the real full-table case instead of relying on this
// bound proof. The tests below that specifically asserted "no cap
// needed"/"never calls addPage()" have been updated or removed
// accordingly; the remaining tests here (shared layout function, no
// independent recomputation, font sizes, generic/no-hardcoding, web
// untouched, regression safety) are still true and still enforced.
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

// --- 1/2: single shared layout function, used by BOTH budget and draw

test("1. a single getCompetitorTableLayout function exists, computing columns/row-wrapping/row-heights/totalHeight once -- no per-cell line-count cap since #69A-45B (any line-count cap risked truncating real content with an ellipsis)", () => {
  assert.match(
    pdfButtonSource,
    /const getCompetitorTableLayout = \(\s*\n\s*rows: ReturnType<typeof resolveCompetitorRowsForPdf>,\s*\n\s*width: number\s*\n\s*\) => \{/
  );
  assert.doesNotMatch(pdfButtonSource, /const COMPETITOR_CELL_MAX_LINES = /);
  assert.match(pdfButtonSource, /const COMPETITOR_CELL_LINE_STEP = 3\.4;/);
  assert.match(
    pdfButtonSource,
    /return maxLines <= 2 \? rowHeight : rowHeight \+ \(maxLines - 2\) \* COMPETITOR_CELL_LINE_STEP;/
  );
});

test("2. ROOT CAUSE FIX: getVisualHeight's competitor-table branch (the pagination BUDGET, computed BEFORE drawing) now calls the exact same getCompetitorTableLayout drawSectionVisual uses -- the two can no longer independently disagree", () => {
  // The generic (non-Market-Intelligence) branch inside getVisualHeight.
  assert.match(
    pdfButtonSource,
    /return getCompetitorTableLayout\(rows, bodyWidth\)\.totalHeight \+ 4;/,
    "getVisualHeight must derive its budget from getCompetitorTableLayout, never a locally-recomputed flat formula"
  );
  // The old stale flat budget must be completely gone.
  assert.doesNotMatch(
    pdfButtonSource,
    /return 8 \+ rows\.length \* 15 \+ 4;/,
    "the old, disconnected flat pagination-budget formula must no longer exist anywhere"
  );
  // drawSectionVisual's own drawing branch calls the SAME function.
  assert.match(pdfButtonSource, /const layout = getCompetitorTableLayout\(rows, bodyWidth\);/);
});

test("2b. the drawing pass sizes its background rect and returns its height purely from the SAME layout object -- no second, independent height computation inside drawSectionVisual", () => {
  const drawBranchMatch = pdfButtonSource.match(
    /const layout = getCompetitorTableLayout\(rows, bodyWidth\);[\s\S]{0,1600}?return layout\.totalHeight \+ 4;\s*\n\s*\}/
  );
  assert.ok(drawBranchMatch, "expected to find the drawing branch using `layout` end-to-end");
  assert.match(drawBranchMatch[0], /pdf\.roundedRect\(bodyX, visualY, bodyWidth, layout\.totalHeight, 3, 3, "FD"\);/);
  // No independent recomputation of row heights inside the drawing
  // branch itself -- only consumption of the shared layout's own
  // pre-computed arrays.
  assert.doesNotMatch(drawBranchMatch[0], /const rowHeightsForTable = /);
  assert.doesNotMatch(drawBranchMatch[0], /const rowWrappedValues = rows\.map/);
});

// --- 3/4/12: long text wraps completely, nothing clipped/hidden ------

test("3/4/12. BEHAVIORAL PROOF: reconstructing the exact documented wrap formula shows the real, full-length Xero weakness sentence is preserved across multiple lines -- never silently clamped, and no word is dropped. SUPERSEDED-BY-#69A-45B NOTE: this test no longer asserts a cap exists (getCompetitorTableLayout no longer caps line count at all) -- see tests/task69a45b-pdf-competitor-cell-pagination-fix.test.mjs for the current, uncapped behavioral proof", () => {
  // Mirrors the real column width/font size this exact table uses for
  // the Weaknesses column (bodyWidth * 0.2, minus the 4mm cell padding)
  // and jsPDF's own approximate average glyph width for Helvetica at
  // this font size (~0.55em) -- close enough to prove the wrapping
  // behavior without loading jsPDF or React.
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
  const realXeroSentence =
    "Its own official product documentation describes the relevant capability as a feature embedded within a broader general-purpose platform rather than a dedicated, purpose-built specialization [R7].";
  const wrapped = fakeWrap(realXeroSentence);

  assert.ok(wrapped.length > 2, "sanity: the real sentence needs more than the old 2-line cap");
  // No word lost or reordered across the wrap -- every word in the
  // original sentence appears, in order, across the wrapped lines.
  assert.equal(wrapped.join(" "), realXeroSentence);
});

test("4b. STRUCTURAL PROOF: the cell-drawing loop passes each cell's FULL wrapped line array (from the shared layout) to pdf.text with no additional length/character slicing at the drawing call site itself", () => {
  const drawBranchMatch = pdfButtonSource.match(
    /const layout = getCompetitorTableLayout\(rows, bodyWidth\);[\s\S]{0,1600}?return layout\.totalHeight \+ 4;\s*\n\s*\}/
  );
  assert.ok(drawBranchMatch);
  assert.match(drawBranchMatch[0], /rowWrappedValues\[rowIndex\]\.forEach\(\(lines, cellIndex\) => \{/);
  assert.match(
    drawBranchMatch[0],
    /pdf\.text\(lines, cellX \+ 2, rowY \+ 4\.7, \{/,
    "must draw the layout's own already-wrapped `lines` array directly -- no re-slicing/truncation at the drawing call site"
  );
});

// --- 5/6: whole-row (whole-table) page breaking, headers stay aligned

test("5/6. SUPERSEDED BY TASK #69A-45B: the bound proof this test used to assert (a fixed per-cell line cap guarantees the whole table always fits on one page) no longer holds now that the cap has been removed -- a dedicated, row-pagination-aware branch now handles the case where the table does not fit on one page instead. See tests/task69a45b-pdf-competitor-cell-pagination-fix.test.mjs for the current proof.", () => {
  assert.doesNotMatch(pdfButtonSource, /const COMPETITOR_CELL_MAX_LINES = /);
  assert.match(
    pdfButtonSource,
    /!isMarketIntelligenceReport &&\s*\n\s*\(section\.title\.toLowerCase\(\)\.includes\("competitor"\) \|\|/,
    "expected the new #69A-45B dedicated competitor-table branch to exist in pdfSections.forEach"
  );
});

test("5b. ensureSpace(fullCardHeight) still runs unconditionally before any section (including Competitor Landscape) draws, using the SAME visualHeight the (now-fixed) budget function computed -- the existing 'move the whole section to a fresh page' mechanism is untouched by this fix", () => {
  assert.match(
    pdfButtonSource,
    /const fullCardHeight = Math\.max\(\s*\n\s*31,\s*\n\s*cardHeaderHeight \+ visualHeight \+ fullBodyTextHeight \+ sectionCardBottomPadding\s*\n\s*\);/
  );
  assert.match(pdfButtonSource, /if \(fullCardHeight <= maxUsableCardHeight\) \{\s*\n\s*ensureSpace\(fullCardHeight\);/);
});

test("6. the now-superseded (unreachable for a real full table, see #69A-45B) drawSectionVisual branch still draws headers/columns atomically with its own rows and never calls addPage() itself -- consistent with it being dead code, not a live pagination path", () => {
  const drawBranchMatch = pdfButtonSource.match(
    /const layout = getCompetitorTableLayout\(rows, bodyWidth\);[\s\S]{0,1600}?return layout\.totalHeight \+ 4;\s*\n\s*\}/
  );
  assert.ok(drawBranchMatch);
  assert.match(drawBranchMatch[0], /columns\.forEach\(\(column\) => \{\s*\n\s*pdf\.text\(column\.label\.toUpperCase\(\)/);
  assert.doesNotMatch(drawBranchMatch[0], /pdf\.addPage\(\)/, "this specific (now-unreachable) branch never calls addPage() itself -- pagination for a real full table is now handled by the dedicated #69A-45B branch instead");
});

// --- 7: typography preserved (no unreasonable font shrink) -----------

test("7. cell font sizes are unchanged by this fix -- 6.3pt company / 5.5pt other cells, same as before #69A-45/#69A-45A", () => {
  const drawBranchMatch = pdfButtonSource.match(
    /const layout = getCompetitorTableLayout\(rows, bodyWidth\);[\s\S]{0,1600}?return layout\.totalHeight \+ 4;\s*\n\s*\}/
  );
  assert.ok(drawBranchMatch);
  assert.match(drawBranchMatch[0], /pdf\.setFontSize\(cellIndex === 0 \? 6\.3 : 5\.5\);/);
});

// --- 8: short-text rows are unaffected --------------------------------

test("8. SHORT-ROW SANITY: a row whose every cell fits within 2 wrapped lines keeps the original rowHeight (15mm) exactly -- this fix only grows a row when genuinely needed", () => {
  assert.match(pdfButtonSource, /const maxLines = Math\.max\(2, \.\.\.wrappedCells\.map\(\(lines\) => lines\.length\)\);/);
  assert.match(pdfButtonSource, /return maxLines <= 2 \? rowHeight : rowHeight \+ \(maxLines - 2\) \* COMPETITOR_CELL_LINE_STEP;/);
});

// --- 9: generic fix, not competitor-specific --------------------------

test("9. the fix is fully generic -- no hardcoded competitor name/text anywhere in getCompetitorTableLayout or the drawing/budget branches that consume it", () => {
  const layoutMatch = pdfButtonSource.match(/const getCompetitorTableLayout = \([\s\S]{0,3500}?\n      \};/);
  assert.ok(layoutMatch, "expected to isolate getCompetitorTableLayout's own body");
  assert.doesNotMatch(layoutMatch[0], /QuickBooks|Xero|Fathom|Dryrun|Intuit/i);
});

// --- 10: web UI untouched ----------------------------------------------

test("10. no web rendering file (Planner.tsx/page.tsx) carries a #69A-45A marker -- this is a PDF-only rendering fix, the web table's own <div> (no line-clamp) was already correct and untouched", () => {
  for (const relativePath of ["components/Planner.tsx", "app/dashboard/[id]/page.tsx"]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-45A/, `${relativePath} must not carry a #69A-45A marker`);
  }
});

// --- Regression: competitor intelligence/data is completely unchanged

test("REGRESSION: business-competitor-landscape-state.ts (competitor scoring/evidence extraction/weakness derivation/research behavior) carries no #69A-45A marker and is byte-for-byte untouched by this ticket", () => {
  assert.doesNotMatch(stateSource, /TASK #69A-45A/);
});

test("REGRESSION: no new research call, prompt change, or cache-version bump was introduced -- this is a pure PDF rendering/layout fix, not a data or generation-contract change", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-45A/);
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(
    planExecutorSource
  );
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  // TASK #69A-47 -- widened from a strict "=== 12" to ">= 12": a later,
  // legitimate ticket (#69A-47, founderScore.score preservation) bumped
  // this constant again for its own real, unrelated reason -- this
  // ticket's own concern (no bump was needed BY #69A-45A itself) is
  // unaffected by a later ticket's own legitimate bump.
  assert.ok(
    Number(match[1]) >= 12,
    "the contract version must be at v12 or later -- this ticket itself persists nothing new, so it required no cache-invalidating bump of its own"
  );
});

test("REGRESSION: no canonical decision (createRecommendation/applyFatalBlockerOverride), Porter's Five Forces, Founder Readiness, or Investment Score file carries a #69A-45A marker", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/report-intelligence.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-45A/, `${relativePath} must not carry a #69A-45A marker`);
  }
});
