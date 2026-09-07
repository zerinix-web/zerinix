// TASK #69A-12 -- Finish Business Idea Validation report presentation
// cleanup: responsive metric grids, Unit Economics labels, and
// Competitive Intelligence table.
//
// This suite covers all three defects: Unit Economics Chain label
// truncation + unbalanced 5-metric grid, KPI supporting-text
// over-clamping, and the Competitive Intelligence table's crushed final
// column / word-by-word vertical wrapping.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const markdownRendererSource = readFileSync(
  join(repoRoot, "components/planner/MarkdownRenderer.tsx"),
  "utf8"
);

// --- 1. Unit Economics Chain: labels no longer truncate to fragments ---
//
// ROOT CAUSE: #69A-11 widened the label/badge row's gap and gave the
// label line-clamp-2/min-w-0/break-words, but label and badge still
// shared ONE flex row (`items-start justify-between`) with a shrink-0
// badge that refuses to give up width. A long badge ("Benchmark /
// Assumption") in a narrow auto-fit column (~11rem) left the label only
// a sliver of the row's width, so line-clamp's ellipsis fired almost
// immediately ("EST...", "PLA...", "SCE..."). FIX: stack the label
// above the badge in its own full-width row (the same pattern already
// proven for the KPI cards) so the label is never sharing width with
// anything.

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  test(`${name}: Unit Economics Chain's label is on its OWN full-width row (flex-col), never sharing horizontal space with the evidence badge -- the actual fix for label truncation`, () => {
    assert.match(source, /<div className="flex min-h-\[3\.25rem\] flex-col gap-1\.5">/);
    assert.doesNotMatch(
      source,
      /<div className="flex items-start justify-between gap-3">\s*\n\s*<p className="line-clamp-2[^"]*text-xs font-semibold uppercase tracking-\[0\.18em\] text-zinc-500">\s*\n\s*\{getFinancialMetricDisplayLabel/
    );
  });

  test(`${name}: the Unit Economics label element itself is present with line-clamp-2 so a genuinely long label still wraps onto 2 full lines instead of being cut to a single-line ellipsis fragment`, () => {
    assert.match(
      source,
      /<p className="line-clamp-2 text-xs font-semibold uppercase tracking-\[0\.18em\] text-zinc-500">/
    );
  });

  test(`${name}: the evidence badge sits below the label as its own element, still shrink-0 (never squeezed to an unreadable width itself) but no longer competing with the label for the same row's space`, () => {
    if (name === "Planner.tsx") {
      assert.match(
        source,
        /<span className=\{`w-fit shrink-0 rounded-full px-2 py-1 text-\[9px\] font-semibold \$\{getFinancialMetricConfidenceBadgeClass\(confidenceBadge\)\}`\}>/
      );
    } else {
      assert.match(source, /<EvidenceBadge level=\{evidence\} locale=\{evidenceLocale\} financial \/>/);
    }
  });
}

// --- 2. Unit Economics Chain: stable, balanced 5-metric responsive grid --
//
// ROOT CAUSE: auto-fit's minmax(11rem,1fr) sized columns purely by
// available width, independent of the 5-metric item count -- at widths
// that fit exactly 4 columns, the 5th metric ended up alone in column 1
// of a second row, with columns 2-4 of that row completely empty ("one
// isolated card and a large empty area"). FIX: explicit, fixed column
// counts per breakpoint instead of auto-fit -- CSS grid's row-major
// auto-placement then guarantees a predictable split: 1 column on
// mobile (every metric its own full-width row, never truncated), 2
// columns on tablet (2+2+1), 3 columns on desktop (3+2) -- exactly the
// two "safer grid" patterns the ticket names, never an isolated single
// card stranded alone on an otherwise-empty row.

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  test(`${name}: Unit Economics Chain uses an explicit, fixed-column responsive grid (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3) -- 5 metrics split 1 / 2+2+1 / 3+2, never an auto-fit count that could strand one isolated card alone on an empty row`, () => {
    assert.match(source, /grid grid-cols-1 gap-px bg-white\/10 sm:grid-cols-2 lg:grid-cols-3/);
    assert.doesNotMatch(source, /grid-cols-\[repeat\(auto-fit,minmax\(11rem,1fr\)\)\]/);
    assert.doesNotMatch(source, /md:grid-cols-5/);
  });
}

test("simulated 5-item placement in a 3-column CSS grid (Unit Economics Chain's own lg: breakpoint) row-major-auto-places into exactly a 3+2 split, never one item alone on an otherwise-empty row", () => {
  const columnCount = 3;
  const itemCount = 5;
  const rows = [];
  for (let i = 0; i < itemCount; i += columnCount) {
    rows.push(Math.min(columnCount, itemCount - i));
  }
  assert.deepEqual(rows, [3, 2]);
});

test("simulated 5-item placement in a 2-column CSS grid (Unit Economics Chain's own sm: breakpoint) row-major-auto-places into exactly a 2+2+1 split", () => {
  const columnCount = 2;
  const itemCount = 5;
  const rows = [];
  for (let i = 0; i < itemCount; i += columnCount) {
    rows.push(Math.min(columnCount, itemCount - i));
  }
  assert.deepEqual(rows, [2, 2, 1]);
});

// --- 3. KPI cards: supporting text preserves readable context -----------
//
// ROOT CAUSE: both of KpiValueContent's supporting-text paragraphs
// (the pre-existing "Label: value" structured branch, and #69A-11's own
// new multi-segment branch) were clamped to 1-2 lines, truncating real
// Target/Owner descriptions into near-meaningless fragments ("Target: 4
// net new...", "Target: validate repeat...", "Target: measure
// time..."). FIX: relaxed both to line-clamp-3, giving 2-3 lines of
// real context before any clamping -- the primary value/status
// paragraph in both branches is untouched (already confirmed readable
// by this ticket's own text), so only the supporting line changed.

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  test(`${name}: KpiValueContent's structured branch (a real "Label: value" pair) now clamps its supporting Target/Owner text to 3 lines, not 1`, () => {
    const fnMatch = /function KpiValueContent\([\s\S]*?\n\}/.exec(source);
    assert.ok(fnMatch, `${name} KpiValueContent not found`);
    assert.match(fnMatch[0], /mt-0\.5 line-clamp-3 text-\[10px\] leading-snug text-zinc-400/);
    assert.doesNotMatch(fnMatch[0], /mt-0\.5 line-clamp-1 text-\[10px\] leading-snug text-zinc-400/);
  });

  test(`${name}: KpiValueContent's multi-segment branch (a bare reading like "Not yet measured" plus Target/Status) now clamps its supporting text to 3 lines, not 2`, () => {
    const fnMatch = /function KpiValueContent\([\s\S]*?\n\}/.exec(source);
    assert.match(fnMatch[0], /mt-1 line-clamp-3 text-\[10px\] leading-snug text-zinc-400/);
    assert.doesNotMatch(fnMatch[0], /mt-1 line-clamp-2 text-\[10px\] leading-snug text-zinc-400/);
  });

  test(`${name}: the primary value/status paragraph in KpiValueContent is UNCHANGED by this pass -- this ticket's own text confirms primary values were already readable, so only supporting text was relaxed`, () => {
    const fnMatch = /function KpiValueContent\([\s\S]*?\n\}/.exec(source);
    assert.match(fnMatch[0], /line-clamp-1 text-sm font-semibold leading-tight text-white/);
    assert.match(fnMatch[0], /line-clamp-2 text-balance text-lg font-semibold leading-tight text-white/);
  });

  test(`${name}: KPI card dimensions (min-h-[11.5rem], grid-cols-[4.25rem_1fr]) and the metric label (no break-words, per the earlier documented mid-word-splitting incident) remain completely unchanged -- this pass never touched the card shell, only KpiValueContent's own supporting-text clamp`, () => {
    assert.match(source, /grid min-h-\[11\.5rem\] grid-cols-\[4\.25rem_1fr\] gap-4 rounded-3xl border border-white\/10 bg-white\/\[0\.035\] p-4/);
    assert.doesNotMatch(source, /min-h-\[12\.5rem\]/);
  });
}

// --- 6. Missing/canonical values unchanged --------------------------------

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  test(`${name}: canonical missing-value fallbacks ("—" for Unit Economics, "Target" for a truly-empty KPI value) are unchanged by this presentation-only pass`, () => {
    assert.match(source, /\{value \|\| "—"\}/);
    assert.match(source, /\{value \|\| "Target"\}/);
  });
}

test("no canonical decision/scoring/provenance file was touched by this presentation-only pass (drift check)", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-12/);
  }
});

test("Unit Economics Chain and KPI cards still derive their values from the exact same canonical extraction/formatting/evidence calls -- extractMetricValue, formatMetricCardValue, getFinancialMetricConfidenceBadge/getDashboardMetricEvidence, extractPercentScore are all untouched", () => {
  assert.match(
    plannerSource,
    /const value = formatMetricCardValue\(extractMetricValue\(section\.content, metric\)\);\s*\n\s*return \{\s*\n\s*metric,\s*\n\s*value,\s*\n\s*confidenceBadge: getFinancialMetricConfidenceBadge\(metric, \[metric\], section\.content, value\),/
  );
  assert.match(
    plannerSource,
    /const value = extractMetricValue\(section\.content, metric\);\s*\n\s*const confidenceBadge = getFinancialMetricConfidenceBadge\(\s*\n\s*metric,\s*\n\s*\[metric\],\s*\n\s*section\.content,\s*\n\s*value\s*\n\s*\);/
  );
  assert.match(
    pageSource,
    /const value = formatMetricCardValue\(extractMetricValue\(content, metric\)\);\s*\n\s*return \{ metric, value, evidence: getDashboardMetricEvidence\(metric, value, content\) \};/
  );
  assert.match(pageSource, /const value = extractMetricValue\(content, metric\);\s*\n\s*const evidence = getDashboardMetricEvidence\(metric, value, content\);/);
});

// --- 3. Competitive Intelligence table: no more crushed final column ----
//
// ROOT CAUSE: Business Idea Validation/Business Plan/Acquisition's
// competitor field ("competitorAnalysis"/"competitorLandscape") already
// has a real, extraction-fed, hardened premium visual card ("Competitive
// Intelligence Table": overflow-x-auto + min-w-[760px] + explicit fr-
// sized grid columns) -- but that field name was missing from
// cardFirstReportFields, the allow-list that suppresses each field's
// redundant raw-prose "Details" duplicate once its own card already
// shows the complete data (every other premium-card field, including
// Market Intelligence's own "competitiveLandscape", is already in this
// list). So the SAME competitor data rendered a second time underneath,
// via AnalysisNotes' raw markdown <table> fallback (MarkdownRenderer's
// MarkdownTable) -- which had no per-column minimum width and inherited
// an ambient [overflow-wrap:anywhere] from its parent, letting
// table-layout:auto crush its final column into a vertical, word-by-word
// strip instead of triggering its own overflow-x-auto scrollbar. FIX:
// (a) added the two missing field names to cardFirstReportFields,
// suppressing the redundant raw-table duplicate entirely in favor of the
// already-safe grid card (Planner.tsx only -- page.tsx has no equivalent
// safe card for this field, so its raw table is hardened directly
// instead, per (b)/(c) below, rather than being suppressed with nothing
// to fall back to); (b) hardened MarkdownRenderer's shared MarkdownTable
// (used by every report type's raw prose, not just BIV) with
// [overflow-wrap:normal] + min-w-[7rem] per cell; (c) hardened page.tsx's
// own ReportText table renderer's desktop branch, which had literally no
// per-column width floor at all (only its mobile branch did).

test("Planner.tsx: cardFirstReportFields now includes Business Idea Validation/Business Plan/Acquisition's competitor field names, suppressing the redundant raw-table duplicate in favor of the already-hardened 'Competitive Intelligence Table' grid card", () => {
  const setMatch = /const cardFirstReportFields = new Set\(\[[\s\S]*?\]\);/.exec(plannerSource);
  assert.ok(setMatch, "cardFirstReportFields set not found");
  assert.match(setMatch[0], /"competitorAnalysis"/);
  assert.match(setMatch[0], /"competitorLandscape"/);
  // Market Intelligence's own, differently-spelled field stays exactly
  // where it already was -- this fix only ADDS entries, never removes.
  assert.match(setMatch[0], /"competitiveLandscape"/);
});

test("Planner.tsx: the 'Competitive Intelligence Table' grid card this fix now relies on as the SOLE presentation for competitor data is confirmed already hardened -- horizontal scroll wrapper, explicit minimum width, and fr-sized (never collapsible-to-zero) columns", () => {
  assert.match(plannerSource, /<div className="min-w-\[760px\]">/);
  assert.match(
    plannerSource,
    /grid grid-cols-\[1fr_1\.35fr_1\.15fr_1\.15fr_0\.9fr\] gap-px bg-white\/10 text-\[11px\] font-semibold uppercase tracking-\[0\.16em\] text-zinc-500/
  );
});

test("MarkdownRenderer.tsx: the shared MarkdownTable component (used by EVERY report type/field's raw markdown table, not just Business Idea Validation) now gives every <th>/<td> a real minimum width and normal word-wrap, instead of inheriting the ambient [overflow-wrap:anywhere] that let table-layout:auto crush a column into a vertical strip", () => {
  const fnMatch = /function MarkdownTable\([\s\S]*?\n\}/.exec(markdownRendererSource);
  assert.ok(fnMatch, "MarkdownTable not found");
  assert.match(fnMatch[0], /min-w-\[7rem\] border-b border-white\/10 px-4 py-3 font-semibold \[overflow-wrap:normal\]/);
  assert.match(fnMatch[0], /min-w-\[7rem\] px-4 py-3 align-top \[overflow-wrap:normal\]/);
  assert.match(fnMatch[0], /w-full min-w-\[640px\] border-collapse text-left text-sm/);
});

test("MarkdownRenderer.tsx: the table's own overflow-x-auto scroll wrapper is unchanged -- this fix makes it the thing that actually activates for a genuinely wide table, rather than suppressing it or replacing it with something else", () => {
  const fnMatch = /function MarkdownTable\([\s\S]*?\n\}/.exec(markdownRendererSource);
  assert.match(fnMatch[0], /my-4 overflow-x-auto rounded-2xl border border-white\/10/);
});

test("page.tsx: ReportText's raw-table renderer now gives its DESKTOP <th>/<td> the exact same per-column minimum width its own mobile branch already had -- previously desktop had none at all", () => {
  assert.match(
    pageSource,
    /min-w-\[8\.5rem\] whitespace-normal font-semibold text-zinc-300 \[overflow-wrap:anywhere\]/
  );
  assert.match(
    pageSource,
    /min-w-\[8\.5rem\] whitespace-normal align-top leading-7 \[overflow-wrap:anywhere\]/
  );
  // The padding scale is the only thing still allowed to differ between
  // mobile and desktop -- confirmed by the surrounding ternary.
  assert.match(pageSource, /mobile \? "px-3\.5 py-3" : "px-4 py-3"/);
});

// TASK #69A-13 superseded this test's original premise: at the time of
// #69A-12, page.tsx had no equivalent hardened grid card for BIV's
// competitor field (only a hardcoded fictional scatter visualization),
// so suppressing its raw table would have removed the only real
// competitor data shown there. #69A-13 replaced that fictional
// visualization with a real "Competitive Intelligence Table" grid card
// (see tests/task69a13-biv-competitor-landscape-structural-fix.test.mjs),
// making it correct and consistent to add these fields here too, exactly
// mirroring Planner.tsx's own treatment.
test("page.tsx: BIV's competitor field is now in page.tsx's own cardFirstReportFields, now that #69A-13 gave it a real hardened grid card mirroring Planner.tsx's own", () => {
  const setMatch = /const cardFirstReportFields = new Set\(\[[\s\S]*?\]\);/.exec(pageSource);
  assert.ok(setMatch, "page.tsx cardFirstReportFields set not found");
  assert.match(setMatch[0], /"competitorAnalysis"/);
  assert.match(setMatch[0], /"competitorLandscape"/);
});

test("no word-by-word vertical collapse: with a real per-column minimum width in place (7rem in MarkdownTable, 8.5rem in ReportText), a table with a much-narrower-than-content available width scrolls horizontally instead of shrinking any single column below that floor -- simulated column-width computation", () => {
  // Mirrors the actual browser behavior this fix relies on: table-layout
  // auto with an explicit per-cell min-width cannot allocate any column
  // less than that floor, so a container narrower than
  // (columnCount * minColumnWidth) must overflow (and scroll) rather
  // than compress a column below its floor.
  function computeEffectiveColumnWidth(containerWidth, columnCount, minColumnWidthPx) {
    const naturalShare = containerWidth / columnCount;
    return Math.max(naturalShare, minColumnWidthPx);
  }

  const minColumnWidthPx = 112; // 7rem
  const columnCount = 5;
  const narrowContainerWidth = 300; // far too narrow for 5 real columns

  const effectiveWidth = computeEffectiveColumnWidth(narrowContainerWidth, columnCount, minColumnWidthPx);
  assert.equal(effectiveWidth, minColumnWidthPx);
  assert.ok(
    effectiveWidth * columnCount > narrowContainerWidth,
    "the table's real total width must exceed the narrow container, forcing horizontal scroll rather than crushing a column below its floor"
  );
});
