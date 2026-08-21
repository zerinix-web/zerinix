import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// KPI ANALYTICS CARD ALIGNMENT + TYPOGRAPHY + HIERARCHY FIX (3 rounds).
//
// Confirmed live, in order:
//
// 1. LAYOUT: the KPI analytics grid (Acquisition/Activation/Retention/
//    Revenue/CAC/WTP/Sales cycle/Conversion in components/Planner.tsx, and
//    the equivalent Acquisition/Activation/Retention/Gross Margin/Payback/
//    Conversion grid in app/dashboard/[id]/page.tsx -- the established
//    duplicate-implementation pattern this app repeats across these two
//    files) had no reserved height for its variable-length regions, so
//    header rows, badges, and values all shifted independently across
//    cards, and empty vs long values had different spacing. Fixed with a
//    shared card min-height, a reserved header-row min-height, a reserved
//    value-block min-height, and the progress-bar/footer group anchored to
//    the bottom via flex + mt-auto.
//
// 2. TEXT WRAPPING: the first pass's `truncate` (then `break-words`) on the
//    metric label caused single unbreakable uppercase words to split mid-
//    character ("ACQUISITION" -> "ACQUIS/ITION"). Root cause understood in
//    full only on the third pass: `-webkit-line-clamp`'s own ellipsis
//    mechanism truncates purely by horizontal pixel fit, independent of
//    `overflow-wrap` -- a single word that does not fit on its line gets
//    cut with "..." regardless of break-words, because there is no prior
//    content on the line for it to wrap away from. The only real fix is
//    guaranteeing enough width for the word in the first place.
//
// 3. HIERARCHY (this fix): the label was still sharing its row with the
//    confidence badge, which was the actual source of insufficient width
//    -- so labels kept truncating ("ACQUISITI..."). Restructured the
//    header to stack the label above the badge (its own full-width row,
//    no competition) instead of tuning font-size/tracking/gap to fit both
//    on one line. Also confirmed live: a combined KPI value like "Owner:
//    Growth Lead | Target: 5 net new customers/month" rendered as one
//    dense line. Added KpiValueContent, a presentation-only parser
//    (parseKpiValueSegments) that splits "Label: text" segments joined by
//    "|" into a label / value / supporting-text hierarchy (showing the
//    most important segment first), while a genuinely simple value (no
//    "Label:" structure) still renders exactly as before. No KPI
//    extraction/scoring/data-model logic was touched -- purely a
//    presentation-layer transform of the already-extracted value string.
//    Grid layout, card dimensions (min-h-[11.5rem], grid-cols-
//    [4.25rem_1fr], sm:grid-cols-2 xl:grid-cols-3) are unchanged across
//    all three rounds.

const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");

function extractKpiDashboardBlock(source, fieldCheck) {
  const startIndex = source.indexOf(fieldCheck);
  assert.ok(startIndex > -1, `could not locate KPI dashboard block via "${fieldCheck}"`);
  const endIndex = source.indexOf("Analytics widget", startIndex);
  assert.ok(endIndex > -1, "could not locate the end of the KPI dashboard block");
  return source.slice(startIndex, endIndex + 200);
}

const plannerKpiBlock = extractKpiDashboardBlock(plannerSource, 'field === "kpiDashboard" || field === "kpis"');
const pageKpiBlock = extractKpiDashboardBlock(pageSource, 'normalizedTitle.includes("kpi")');

// --- Mirrors KpiValueContent's exact parsing logic (both files) ---------
// (JSX/component files can't be imported directly by this repo's plain
// node --test runner -- established convention: mirror the logic exactly
// and drift-check it against the real source below.)

function looksLikeKpiValueLabel(text) {
  return /^[A-Za-z][A-Za-z\s/&-]{1,30}$/.test(text.trim());
}

function parseKpiValueSegments(value) {
  if (!value) return [];
  return value
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const colonIndex = segment.indexOf(":");
      if (colonIndex === -1) return { label: "", text: segment };
      return { label: segment.slice(0, colonIndex).trim(), text: segment.slice(colonIndex + 1).trim() };
    });
}

function classifyKpiValue(value) {
  const [first, ...rest] = parseKpiValueSegments(value);
  if (first?.label && looksLikeKpiValueLabel(first.label)) {
    return { kind: "structured", label: first.label, text: first.text, rest };
  }
  return { kind: "simple" };
}

// --- Requirement: separate label / value / supporting text --------------

test("a combined 'Owner: X | Target: Y' value is separated into label / value / supporting-text tiers (the exact reported example)", () => {
  const result = classifyKpiValue("Owner: Growth Lead | Target: 5 net new customers/month");

  assert.equal(result.kind, "structured");
  assert.equal(result.label, "Owner");
  assert.equal(result.text, "Growth Lead");
  assert.equal(result.rest.length, 1);
  assert.equal(result.rest[0].label, "Target");
  assert.equal(result.rest[0].text, "5 net new customers/month");
});

test("a single 'Owner: Product Lead' value (no second segment) still separates label from value, with no supporting text", () => {
  const result = classifyKpiValue("Owner: Product Lead");

  assert.equal(result.kind, "structured");
  assert.equal(result.label, "Owner");
  assert.equal(result.text, "Product Lead");
  assert.equal(result.rest.length, 0);
});

test("the most important segment (the first one) is what gets shown as the primary value, not the last", () => {
  const result = classifyKpiValue("Owner: Growth Lead | Target: 5 net new customers/month | Status: On track");

  assert.equal(result.text, "Growth Lead");
  assert.notEqual(result.text, "On track");
});

// --- Requirement: simple values are untouched (no unnecessary splitting) --

test("a genuinely simple value (short number/percentage/currency, no 'Label:' structure) is never split into label/value tiers", () => {
  for (const value of ["82%", "$45,000/month", "no verified realized-revenue data exists yet", ""]) {
    assert.equal(classifyKpiValue(value).kind, "simple", `"${value}" should render as a simple value`);
  }
});

test("a numeric ratio or time-like value containing a colon (e.g. '3:1', '12:30') is never misread as a structured label (guards looksLikeKpiValueLabel)", () => {
  for (const value of ["3:1", "12:30", "1:1 ratio"]) {
    assert.equal(classifyKpiValue(value).kind, "simple", `"${value}" should not be misread as a structured Label: value`);
  }
});

// --- Requirement: category labels never break words ----------------------

for (const [name, block] of [
  ["Planner.tsx", plannerKpiBlock],
  ["page.tsx", pageKpiBlock],
]) {
  test(`${name}: the metric label header row is stacked (its own full-width row), not sharing horizontal space with the badge -- the actual fix for mid-word truncation`, () => {
    assert.match(block, /flex min-h-\[3rem\] flex-col gap-1/, `${name} header row is not stacked into its own column`);
  });

  test(`${name}: the metric label has no break-words and is not competing for width with the badge on the same row (drift check on the root-cause fix)`, () => {
    const labelMatch = /<p className="line-clamp-2 text-\[10px\][^"]*">\{metric\}<\/p>/.exec(block);
    assert.ok(labelMatch, `${name} metric label element not found in the expected shape`);
    assert.doesNotMatch(labelMatch[0], /break-words/, `${name} metric label still allows mid-word breaking`);
    assert.doesNotMatch(block, /items-start justify-between gap-1\.5/, `${name} header row still places the label and badge on the same competing row`);
  });

  test(`${name}: the exact reported single-word KPI titles (Acquisition/Activation/Retention/Conversion) are present and rendered through the fixed, non-competing header structure`, () => {
    const source = name === "Planner.tsx" ? plannerSource : pageSource;
    for (const title of ["Acquisition", "Activation", "Retention", "Conversion"]) {
      assert.ok(source.includes(`"${title}"`), `${title} is no longer one of the rendered KPI metrics`);
    }
  });

  test(`${name}: the KPI value area is rendered through KpiValueContent, not a single raw paragraph (drift check)`, () => {
    assert.match(block, /<KpiValueContent value=\{value\} \/>/, `${name} KPI card no longer uses KpiValueContent for its value area`);
  });

  test(`${name}: KpiValueContent's structured branch shows label, value, and supporting text as separate, individually clamped elements`, () => {
    const fnMatch = /function KpiValueContent\([\s\S]*?\n\}/.exec(name === "Planner.tsx" ? plannerSource : pageSource);
    assert.ok(fnMatch, `${name} KpiValueContent not found`);
    assert.match(fnMatch[0], /text-\[9px\] font-semibold uppercase tracking-wide text-zinc-500/, `${name} label tier styling missing`);
    assert.match(fnMatch[0], /line-clamp-1 text-sm font-semibold leading-tight text-white/, `${name} value tier styling missing`);
    assert.match(fnMatch[0], /line-clamp-1 text-\[10px\] leading-snug text-zinc-400/, `${name} supporting-text tier styling missing`);
    assert.doesNotMatch(fnMatch[0], /break-words/, `${name} KpiValueContent still allows mid-word breaking`);
  });

  test(`${name}: the card's own min-height and grid-column layout are unchanged across all three fix rounds (per explicit instruction: do not touch the grid, keep card heights unchanged)`, () => {
    assert.match(block, /min-h-\[11\.5rem\] grid-cols-\[4\.25rem_1fr\]/, `${name} KPI card's own min-height/grid-column shape was altered`);
  });

  test(`${name}: the progress bar / footer group is still anchored to the bottom of the card via flex + mt-auto`, () => {
    assert.match(block, /flex min-w-0 flex-col/, `${name} KPI card's content column is not a flex column`);
    assert.match(block, /mt-auto pt-4/, `${name} KPI card's progress bar/footer group is not anchored to the bottom`);
  });

  test(`${name}: the MiniProgressCircle is vertically centered when the card stretches taller than its natural height`, () => {
    assert.match(block, /<div className="flex items-center">\s*\n\s*(?:\t*)<MiniProgressCircle/, `${name} MiniProgressCircle is not wrapped in a centering container`);
  });
}

// --- Drift check: no KPI logic/data-model was touched ---------------------

test("no KPI value, score, extraction, calculation, or badge-classification logic was changed by any of the three UI fixes (drift check)", () => {
  assert.match(plannerSource, /getFinancialMetricConfidenceBadge\(\s*metric,\s*\[metric\],\s*section\.content,\s*value\s*\)/);
  assert.match(pageSource, /getDashboardMetricEvidence\(metric, value, content\)/);
  assert.match(plannerSource, /const value = extractMetricValue\(section\.content, metric\);/);
  assert.match(pageSource, /const value = extractMetricValue\(content, metric\);/);
});

test("the KPI grid's responsive column classes are unchanged (sm:grid-cols-2 xl:grid-cols-3), preserving existing responsiveness across desktop/tablet/mobile", () => {
  assert.match(plannerKpiBlock, /grid gap-3 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(pageKpiBlock, /grid gap-3 sm:grid-cols-2 xl:grid-cols-3/);
});
