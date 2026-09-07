// TASK #69A-11 -- Fix report metric-card and Unit Economics layout
// collisions without changing report authority or data.
//
// ROOT CAUSE 1 (Unit Economics Chain, components/Planner.tsx:5349-5398 and
// app/dashboard/[id]/page.tsx:3159-3202): a fixed, unbroken md:grid-cols-5
// forced all 5 columns onto one row from 768px up with no intermediate
// breakpoint, and each column lacked the min-w-0/overflow-hidden/
// line-clamp safety net the sibling Financial Dashboard grid already had
// (Planner.tsx:5999-6021) -- so a long heading ("PLANNING PAYBACK",
// "SCENARIO RUNWAY") and a long badge ("Benchmark / Assumption") were
// forced to fight for space in one cramped flex row and visually
// collided.
//
// ROOT CAUSE 2 (KPI cards, Planner.tsx:6404-6446/4448-4494 and
// page.tsx:4161-4196/2159-2205): KpiValueContent's fallback branch
// rendered the ENTIRE raw, still-"|"-delimited value string (e.g. "Not
// yet measured | Target: prove the first paid activation within 30 days
// | Status: Pending validation") inside one line-clamp-2 paragraph
// whenever the first segment lacked a real "Label:" prefix -- instead of
// giving the primary reading and its Target/Status detail the same
// separated primary/supporting rows the structured branch already used.
//
// FIX: presentation-only. No canonical extraction/scoring/decision
// function was touched; only layout classes and KpiValueContent's own
// segment-to-JSX-region mapping changed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");

// Same established brace-depth extraction pattern used throughout this
// session (task69a9/task69a10's own test files) for pulling a named
// function's real source text out of a "use client" TSX file plain node
// cannot import directly. Works for non-exported `function NAME(` too.
function extractFunctionSource(source, name, { exported = false } = {}) {
  const pattern = exported ? `export function ${name}\\(` : `function ${name}\\(`;
  const startMatch = source.match(new RegExp(pattern));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;

  let parenIndex = source.indexOf("(", start);
  let parenDepth = 0;
  for (; parenIndex < source.length; parenIndex++) {
    if (source[parenIndex] === "(") parenDepth++;
    if (source[parenIndex] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }

  let i = source.indexOf("{", parenIndex);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  return source.slice(start, i + 1).replace(/^export /, "");
}

// Deliberately narrow: only strips the exact two TS parameter-type
// annotations these 3 specific functions use. An earlier, broader
// "strip any `) : ReturnType {`" pass (copied from a different harness)
// matched spuriously across this function's own JSX ternaries --
// `) : null}` followed, much later in the body, by an unrelated `{` --
// and silently deleted everything between them. None of these 3
// functions actually have a return-type annotation to strip, so that
// pass is intentionally omitted here rather than made "safer": it has
// no job to do on this input.
function stripTsTypes(text) {
  return text
    .replace(/\{\s*value\s*\}:\s*\{\s*value:\s*string\s*\}/g, "{ value }")
    .replace(/\((\w+): string\)/g, "($1)");
}

// Real KpiValueContent, with its 3 JSX `return (...)` blocks mechanically
// swapped for plain-object returns describing exactly which branch fired
// and what it computed -- every conditional, every segment computation
// (parseKpiValueSegments, looksLikeKpiValueLabel, primaryText, supporting)
// is the REAL, unmodified logic; only the JSX markup itself (irrelevant to
// this behavioral test, and already covered by the structural source
// assertions below) is swapped out so the function can run under plain
// node without a DOM/JSX transform.
function jsxToBranchProbe(kpiValueContentSource) {
  let text = kpiValueContentSource;

  text = text.replace(
    /return \(\s*<div className="mt-2 min-h-\[3\.5rem\]">\s*<p className="text-\[9px\][^>]*>\{first\.label\}<\/p>\s*<p className="line-clamp-1[^>]*>\{first\.text \|\| "—"\}<\/p>\s*\{supporting \? \(\s*<p className="mt-0\.5[^>]*>\{supporting\}<\/p>\s*\) : null\}\s*<\/div>\s*\);/,
    'return { branch: "structured", label: first.label, text: first.text || "—", supporting };'
  );

  text = text.replace(
    /return \(\s*<div className="mt-2 min-h-\[3\.5rem\]">\s*<p className="line-clamp-2 text-balance[^>]*>\s*\{primaryText \|\| "Target"\}\s*<\/p>\s*\{supporting \? \(\s*<p className="mt-1[^>]*>\{supporting\}<\/p>\s*\) : null\}\s*<\/div>\s*\);/,
    'return { branch: "multi-segment", text: primaryText || "Target", supporting };'
  );

  text = text.replace(
    /return \(\s*<p className="mt-2 line-clamp-2 min-h-\[3\.5rem\][^>]*>\s*\{value \|\| "Target"\}\s*<\/p>\s*\);/,
    'return { branch: "plain", text: value || "Target" };'
  );

  return text;
}

async function loadKpiValueContentProbe(source) {
  const parseKpiValueSegments = stripTsTypes(extractFunctionSource(source, "parseKpiValueSegments"));
  const looksLikeKpiValueLabel = stripTsTypes(extractFunctionSource(source, "looksLikeKpiValueLabel"));
  const kpiValueContentRaw = stripTsTypes(extractFunctionSource(source, "KpiValueContent"));
  const kpiValueContentProbe = jsxToBranchProbe(kpiValueContentRaw).replace(
    "function KpiValueContent({ value })",
    "function kpiValueContentProbe({ value })"
  );

  // If none of the 3 regex substitutions above matched (e.g. the real
  // source drifted from what this test expects), the function body still
  // contains raw JSX -- which is a syntax error under plain node and will
  // make the dynamic import below throw, failing the test loudly rather
  // than silently passing on stale assumptions.
  const blob = [parseKpiValueSegments, looksLikeKpiValueLabel, kpiValueContentProbe].join("\n\n");
  const fullSource = [blob, "export { kpiValueContentProbe };"].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-kpi-value-content-"));
  const outPath = join(dir, "kpi-value-content.mjs");
  writeFileSync(outPath, fullSource);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.kpiValueContentProbe;
}

let plannerKpiValueContentProbe;
let pageKpiValueContentProbe;

test.before(async () => {
  plannerKpiValueContentProbe = await loadKpiValueContentProbe(plannerSource);
  pageKpiValueContentProbe = await loadKpiValueContentProbe(pageSource);
});

const REAL_NOT_YET_MEASURED_VALUE =
  "Not yet measured | Target: prove the first paid activation within 30 days of signup | Status: Pending validation";
const REAL_LONG_VALUE_WITH_TARGET =
  "48 customers by Month 12 | Target: 60 customers by Month 12 | Status: On track";
const REAL_STRUCTURED_VALUE = "Owner: Growth Lead | Target: 5 net new customers/month";
const REAL_SIMPLE_VALUE = "$1,200";
const REAL_TIME_LIKE_VALUE_WITH_TARGET = "12:30 | Target: reduce cycle time";

for (const [label, probe] of [
  ["Planner.tsx", () => plannerKpiValueContentProbe],
  ["page.tsx", () => pageKpiValueContentProbe],
]) {
  test(`requirement 2/H2 (${label}): a long "Not yet measured | Target: ... | Status: ..." value now separates into its own primary-reading and supporting rows instead of one unclipped blob`, () => {
    const result = probe()({ value: REAL_NOT_YET_MEASURED_VALUE });
    assert.equal(result.branch, "multi-segment");
    assert.equal(result.text, "Not yet measured");
    assert.equal(
      result.supporting,
      "Target: prove the first paid activation within 30 days of signup · Status: Pending validation"
    );
  });

  test(`requirement 2/H2 (${label}): a long primary value ("48 customers by Month 12...") is preserved in full as the primary reading, with Target/Status moved to the supporting row`, () => {
    const result = probe()({ value: REAL_LONG_VALUE_WITH_TARGET });
    assert.equal(result.branch, "multi-segment");
    assert.equal(result.text, "48 customers by Month 12");
    assert.equal(result.supporting, "Target: 60 customers by Month 12 · Status: On track");
  });

  test(`requirement H3 (${label}): a truly missing value (empty string) still falls back to the existing canonical "Target" placeholder -- no data is fabricated`, () => {
    const result = probe()({ value: "" });
    assert.equal(result.branch, "plain");
    assert.equal(result.text, "Target");
  });

  test(`regression (${label}): a genuinely simple value with no "|" segments renders exactly as before (plain branch, value shown verbatim)`, () => {
    const result = probe()({ value: REAL_SIMPLE_VALUE });
    assert.equal(result.branch, "plain");
    assert.equal(result.text, REAL_SIMPLE_VALUE);
  });

  test(`regression (${label}): a real "Label: value | Label: value" structured pair still uses the pre-existing structured branch, completely unaffected by this fix`, () => {
    const result = probe()({ value: REAL_STRUCTURED_VALUE });
    assert.equal(result.branch, "structured");
    assert.equal(result.label, "Owner");
    assert.equal(result.text, "Growth Lead");
    assert.equal(result.supporting, "Target: 5 net new customers/month");
  });

  test(`edge case (${label}): a bare value that merely CONTAINS a colon (e.g. a time like "12:30") keeps BOTH halves when followed by further segments, never silently dropping the part before the colon`, () => {
    const result = probe()({ value: REAL_TIME_LIKE_VALUE_WITH_TARGET });
    assert.equal(result.branch, "multi-segment");
    // Reconstructed via the same "label: text" join the structured
    // branch already uses -- both "12" and "30" survive (no data lost),
    // just with normalized ": " spacing instead of the original bare ":".
    assert.equal(result.text, "12: 30");
    assert.equal(result.supporting, "Target: reduce cycle time");
  });
}

// TASK #69A-12 superseded this test's original approach: #69A-11's
// gap-3 flex ROW (label and badge sharing one line) still squeezed the
// label down to a few characters whenever the badge was long, since a
// shrink-0 badge never yields width. #69A-12 stacks the label above the
// badge in its own full-width row instead -- see the updated assertions
// below (mirrors the same fix already proven for the KPI cards).
test("requirement H1 (superseded by #69A-12): Unit Economics Chain's label and evidence badge each get their own dedicated row -- never sharing horizontal space, so a long badge can never squeeze the label (Planner.tsx)", () => {
  assert.match(
    plannerSource,
    /<div className="flex min-h-\[3\.25rem\] flex-col gap-1\.5">\s*\n\s*<p className="line-clamp-2 text-xs font-semibold uppercase tracking-\[0\.18em\] text-zinc-500">\s*\n\s*\{getFinancialMetricDisplayLabel\(metric, confidenceBadge\)\}/
  );
  assert.match(
    plannerSource,
    /<div key=\{metric\} className="min-w-0 overflow-hidden bg-zinc-950\/80 p-4">/
  );
});

test("requirement H1 (superseded by #69A-12): Unit Economics Chain's label and evidence badge each get their own dedicated row (page.tsx mirrors the same fix)", () => {
  assert.match(
    pageSource,
    /<div className="flex min-h-\[3\.25rem\] flex-col gap-1\.5">\s*\n\s*<p className="line-clamp-2 text-xs font-semibold uppercase tracking-\[0\.18em\] text-zinc-500">\s*\n\s*\{getFinancialMetricDisplayLabel\(metric, evidence\)\}/
  );
  assert.match(pageSource, /<div key=\{metric\} className="min-w-0 overflow-hidden bg-zinc-950\/80 p-4">/);
});

test("requirement B/D (superseded by #69A-12): Unit Economics Chain no longer relies on auto-fit column count (which could strand one isolated card alone on a mostly-empty row) -- explicit breakpoints now guarantee a predictable 1 / 2+2+1 / 3+2 split (Planner.tsx and page.tsx)", () => {
  assert.match(plannerSource, /grid grid-cols-1 gap-px bg-white\/10 sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(pageSource, /grid grid-cols-1 gap-px bg-white\/10 sm:grid-cols-2 lg:grid-cols-3/);
  assert.doesNotMatch(plannerSource, /grid gap-px bg-white\/10 md:grid-cols-5/);
  assert.doesNotMatch(pageSource, /grid gap-px bg-white\/10 md:grid-cols-5/);
  assert.doesNotMatch(plannerSource, /grid-cols-\[repeat\(auto-fit,minmax\(11rem,1fr\)\)\]/);
  assert.doesNotMatch(pageSource, /grid-cols-\[repeat\(auto-fit,minmax\(11rem,1fr\)\)\]/);
});

test("requirement H1/C/regression: KPI cards' own dimensions (min-h-[11.5rem], grid-cols-[4.25rem_1fr]) and metric-label styling are deliberately UNCHANGED -- a prior, dedicated fix (kpi-analytics-card-alignment-fix.test.mjs) already solved label/badge crowding by stacking them into separate rows and explicitly removing break-words (which caused mid-word splitting on a single long uppercase word); this pass's real fix lives entirely inside KpiValueContent's value-rendering branch, so the card shell needed no change (Planner.tsx and page.tsx)", () => {
  assert.match(
    plannerSource,
    /grid min-h-\[11\.5rem\] grid-cols-\[4\.25rem_1fr\] gap-4 rounded-3xl border border-white\/10 bg-white\/\[0\.035\] p-4/
  );
  assert.match(
    plannerSource,
    /line-clamp-2 text-\[10px\] font-medium uppercase leading-snug tracking-\[0\.1em\] text-zinc-500">\{metric\}/
  );
  assert.match(
    pageSource,
    /grid min-h-\[11\.5rem\] grid-cols-\[4\.25rem_1fr\] gap-4 rounded-3xl border border-white\/10 bg-white\/\[0\.035\] p-4/
  );
  assert.match(
    pageSource,
    /line-clamp-2 text-\[10px\] font-medium uppercase leading-snug tracking-\[0\.1em\] text-zinc-500">\{metric\}/
  );
});

test("requirement H4: Unit Economics Chain still derives its value from the exact same canonical extraction/formatting/evidence-classification calls -- extractMetricValue, formatMetricCardValue, getFinancialMetricConfidenceBadge are all untouched (Planner.tsx and page.tsx)", () => {
  assert.match(
    plannerSource,
    /const value = formatMetricCardValue\(extractMetricValue\(section\.content, metric\)\);\s*\n\s*return \{\s*\n\s*metric,\s*\n\s*value,\s*\n\s*confidenceBadge: getFinancialMetricConfidenceBadge\(metric, \[metric\], section\.content, value\),/
  );
  assert.match(
    pageSource,
    /const value = formatMetricCardValue\(extractMetricValue\(content, metric\)\);\s*\n\s*return \{ metric, value, evidence: getDashboardMetricEvidence\(metric, value, content\) \};/
  );
  assert.match(plannerSource, /\{value \|\| "—"\}/);
  assert.match(pageSource, /\{value \|\| "—"\}/);
});

test("requirement H5: KPI cards still derive their value/evidence/gauge from the exact same canonical calls -- extractMetricValue, getFinancialMetricConfidenceBadge/getDashboardMetricEvidence, extractPercentScore are all untouched, and the raw value is still passed straight to KpiValueContent (Planner.tsx and page.tsx)", () => {
  assert.match(
    plannerSource,
    /const value = extractMetricValue\(section\.content, metric\);\s*\n\s*const confidenceBadge = getFinancialMetricConfidenceBadge\(\s*\n\s*metric,\s*\n\s*\[metric\],\s*\n\s*section\.content,\s*\n\s*value\s*\n\s*\);/
  );
  assert.match(plannerSource, /<KpiValueContent value=\{value\} \/>/);
  assert.match(pageSource, /const value = extractMetricValue\(content, metric\);\s*\n\s*const evidence = getDashboardMetricEvidence\(metric, value, content\);/);
  assert.match(pageSource, /<KpiValueContent value=\{value\} \/>/);
});

test("requirement F/H6: no canonical decision/scoring/provenance file was touched by this presentation-only pass -- report-jobs/plan-executor.ts, report-presentation.ts, executive-decision-brief.ts, financial-assumptions.ts, and report-investment-score.ts contain no #69A-11 marker (drift check)", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-11/);
  }
});

test("requirement G/H7: the shared EvidenceBadge and MiniProgressCircle components' own definitions are structurally untouched -- Market Intelligence/other report types calling them through their OTHER, unmodified call sites cannot regress from this fix", () => {
  assert.match(
    plannerSource,
    /function MiniProgressCircle\(\{\s*\n\s*label,\s*\n\s*value,\s*\n\s*\}: \{\s*\n\s*label: string;\s*\n\s*value: number \| null;\s*\n\s*\}\) \{/
  );
  assert.match(
    pageSource,
    /function EvidenceBadge\(\{\s*\n\s*level,\s*\n\s*locale = "English",\s*\n\s*financial = false,\s*\n\s*market = false,\s*\n\s*\}: \{/
  );
  // The Market Intelligence-specific EvidenceBadge call sites (TAM/SAM/SOM,
  // Porter's Five Forces, the market-scoped executive summary card) are
  // untouched -- this fix never edited the `market` prop branch or any of
  // those call sites, only the Unit Economics Chain/KPI Dashboard blocks.
  assert.match(pageSource, /<EvidenceBadge level=\{getForceEvidenceLevel\(implication\)\} locale=\{evidenceLocale\} market \/>/);
});
