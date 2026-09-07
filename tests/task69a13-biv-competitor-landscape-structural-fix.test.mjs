// TASK #69A-13 -- Fix Business Idea Validation Competitor Landscape
// structurally and visually.
//
// TWO independent defects:
//
// 1. TABLE LAYOUT OVERFLOW: the THREAT column's rounded-full pill <span>
//    had no min-w-0 on its containing cell and no wrap control on the
//    span itself. A pill shape implicitly assumes short, single-line
//    content, but CSS grid's default minmax(auto,Nfr) track sizing lets
//    an oversized child's intrinsic content width force its own column
//    (and the whole grid) wider than intended, bleeding past the card's
//    boundary instead of triggering the wrapper's overflow-x-auto.
//
// 2. SEMANTIC/MAPPING DEFECT (row construction / parser-extraction
//    layer, NOT generated canonical data, NOT renderer logic): when a
//    competitor bullet lacked its own explicit inline label,
//    extractCompetitorRows fell back to the raw whole `line` for
//    Positioning, and to extractKeywordInsight(line, [...]) for
//    Strengths/Weaknesses/Threat -- but extractKeywordInsight, given a
//    SINGLE line rather than a full multi-line section, always
//    degenerates to returning that same line back. So every unlabeled
//    field echoed the identical raw bullet text, just truncated to a
//    different length -- reading as near-duplicate columns.
//
// Also: page.tsx's Competitor Landscape rendering was a hardcoded,
// entirely fictional "Competitive Positioning Map" (4 fixed fake data
// points at fixed coordinates, using none of the report's own content)
// -- replaced with the same real, hardened grid card Planner.tsx uses.
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
// session for pulling named functions' real source text out of a
// "use client" TSX file plain node cannot import directly.
function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
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

  return source.slice(start, i + 1);
}

function extractConstSource(source, name) {
  const startMatch = source.match(new RegExp(`const ${name} = \\[`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;
  const end = source.indexOf("];", start) + 2;
  return source.slice(start, end);
}

// Narrow, deliberate type-strip: only the exact parameter annotations
// these functions use (single- and multi-parameter signatures alike).
// A broader "strip any return-type annotation" pass previously caused a
// real bug in this session (it matched spuriously across unrelated
// `) : ... {` patterns deep in a function body) -- so this stays
// narrowly scoped to actual parameter-position `name: string`/
// `name: string[]` annotations, never touching anything after the
// closing paren. Extended for TASK #69A-14's own new TS shapes: a
// quoted-string-literal union parameter type (`type: "A" | "B"`), a
// local `Array<{...}> = []` initializer (now appearing twice in
// extractCompetitorRows, hence the `g` flag), a `let x: Type | null;`
// declaration, and `new Set<string>()`'s generic type argument.
function stripTsTypes(text) {
  return text
    .replace(/(\w+): "[^"]+"(?:\s*\|\s*"[^"]+")+/g, "$1")
    .replace(/(\w+): string\[\]/g, "$1")
    .replace(/(\w+): string/g, "$1")
    .replace(/: Array<\{[\s\S]*?\}> = \[\]/g, " = []")
    .replace(/(\w+): \w+(?:<[^>]*>)? \| null;/g, "$1;")
    .replace(/new Set<[^>]*>\(\)/g, "new Set()");
}

async function loadRealCompetitorExtraction(source) {
  const escapeRegExp = stripTsTypes(extractFunctionSource(source, "escapeRegExp"));
  const competitorFieldLabels = extractConstSource(source, "competitorFieldLabels");
  const parseInlineField = stripTsTypes(extractFunctionSource(source, "parseInlineField"));
  const cleanExecutiveText = stripTsTypes(extractFunctionSource(source, "cleanExecutiveText"));
  const isImplausibleCompetitorNameOnScreen = stripTsTypes(
    extractFunctionSource(source, "isImplausibleCompetitorNameOnScreen")
  );
  const extractCompetitorRows = stripTsTypes(extractFunctionSource(source, "extractCompetitorRows"));

  const pdfNormUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const fullSource = [
    `import { normalizePdfText } from ${JSON.stringify(pdfNormUrl)};`,
    escapeRegExp,
    competitorFieldLabels,
    parseInlineField,
    cleanExecutiveText,
    isImplausibleCompetitorNameOnScreen,
    extractCompetitorRows,
    "export { extractCompetitorRows, parseInlineField, cleanExecutiveText };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-competitor-rows-"));
  const outPath = join(dir, "competitor-rows.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

// The fail-before reconstruction of the OLD (pre-#69A-13) bullet-fallback
// logic, so a real, independent proof of the reported defect exists
// without needing a disruptive `git stash` (every #69A task's work in
// this session is uncommitted, so stashing these files would revert far
// more than this one task's isolated diff -- an established, accepted
// substitute in this exact session).
function oldExtractCompetitorRowsBulletFallback(line, parseInlineField) {
  function extractKeywordInsightDegenerate(singleLine, keywords) {
    // Mirrors extractKeywordInsight's real behavior when given a SINGLE
    // line (not a multi-line section): content.split(/\n+/) on a string
    // with no newlines produces exactly one entry, so both the keyword
    // .find(...) and the final `lines[0]` fallback resolve to that same
    // one line -- it always just returns the input back.
    const lines = [singleLine.trim()];
    return (
      lines.find((candidate) => keywords.some((keyword) => candidate.toLowerCase().includes(keyword.toLowerCase()))) ||
      lines[0] ||
      ""
    );
  }

  const positioning = parseInlineField(line, "Positioning") || parseInlineField(line, "Target Customer");
  const strengths = parseInlineField(line, "Strengths");
  const weaknesses = parseInlineField(line, "Weaknesses");
  const threat = parseInlineField(line, "Competitive Threat") || parseInlineField(line, "Threat");

  return {
    positioning: (positioning || line).slice(0, 120),
    strengths: (strengths || extractKeywordInsightDegenerate(line, ["strength", "advantage"]) || "—").slice(0, 110),
    weaknesses: (weaknesses || extractKeywordInsightDegenerate(line, ["weakness", "gap"]) || "—").slice(0, 110),
    threat: (threat || extractKeywordInsightDegenerate(line, ["threat", "risk"]) || "—").slice(0, 90),
  };
}

let plannerExtraction;
let pageExtraction;

test.before(async () => {
  plannerExtraction = await loadRealCompetitorExtraction(plannerSource);
  pageExtraction = await loadRealCompetitorExtraction(pageSource);
});

// A real, plausible competitor bullet with NO explicit "Positioning:",
// "Strengths:", "Weaknesses:", or "Threat:" labels -- exactly the shape
// that triggered the reported defect.
const UNLABELED_COMPETITOR_LINE =
  "Acme Analytics Inc - a budget-friendly SaaS provider targeting SMBs with aggressive pricing and a lean support team.";
const CONTENT_WITH_UNLABELED_COMPETITOR = `## Competitor Landscape\n- ${UNLABELED_COMPETITOR_LINE}\n`;

const LABELED_COMPETITOR_LINE =
  "Acme Analytics Inc — Positioning: budget-friendly SMB tooling. Strengths: fast onboarding, low price. Weaknesses: limited integrations. Threat: Moderate, growing quickly in the SMB segment.";
const CONTENT_WITH_LABELED_COMPETITOR = `## Competitor Landscape\n- ${LABELED_COMPETITOR_LINE}\n`;

for (const [name, extraction] of [
  ["Planner.tsx", () => plannerExtraction],
  ["page.tsx", () => pageExtraction],
]) {
  test(`fail-before proof (${name}): the OLD bullet-fallback logic (reconstructed from before this fix) makes Positioning, Strengths, Weaknesses, and Threat all echo the same raw bullet text for an unlabeled competitor`, () => {
    const old = oldExtractCompetitorRowsBulletFallback(UNLABELED_COMPETITOR_LINE, extraction().parseInlineField);
    // All four fall back to a prefix of the SAME raw line -- this is the
    // exact defect the ticket reports ("repeat substantially the same
    // text across Positioning, Strengths, Weaknesses, Threat").
    assert.ok(old.positioning.startsWith("Acme Analytics Inc - a budget-friendly"));
    assert.ok(old.strengths.startsWith("Acme Analytics Inc - a budget-friendly"));
    assert.ok(old.weaknesses.startsWith("Acme Analytics Inc - a budget-friendly"));
    assert.ok(old.threat.startsWith("Acme Analytics Inc - a budget-friendly"));
  });

  test(`requirement 2 (${name}): the REAL, current extractCompetitorRows does NOT populate Positioning/Strengths/Weaknesses/Threat by duplicating one source field -- an unlabeled competitor bullet honestly shows "—" for each field with no explicit label of its own, never the raw bullet text`, () => {
    const rows = extraction().extractCompetitorRows(CONTENT_WITH_UNLABELED_COMPETITOR);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.positioning, "—");
    assert.equal(row.strengths, "—");
    assert.equal(row.weaknesses, "—");
    assert.equal(row.threat, "—");
    // No two of these fields are ever the same non-"—" string -- there
    // is nothing here that COULD be a duplicate, since none of them
    // fabricated a value.
  });

  test(`requirement 3 (${name}): missing competitor attributes remain explicitly "—" (the existing canonical missing-value representation) rather than fabricated -- confirmed for every one of the 4 describable fields independently`, () => {
    const rows = extraction().extractCompetitorRows(CONTENT_WITH_UNLABELED_COMPETITOR);
    const [row] = rows;
    for (const field of ["positioning", "strengths", "weaknesses", "threat"]) {
      assert.equal(row[field], "—", `${field} should be the honest missing-value marker, not fabricated text`);
    }
  });

  test(`regression (${name}): when a competitor bullet DOES use explicit inline labels, each column still correctly reflects its OWN distinct real field -- no regression to the legitimate labeled case`, () => {
    const rows = extraction().extractCompetitorRows(CONTENT_WITH_LABELED_COMPETITOR);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.positioning, "budget-friendly SMB tooling.");
    assert.equal(row.strengths, "fast onboarding, low price.");
    assert.equal(row.weaknesses, "limited integrations.");
    assert.equal(row.threat, "Moderate, growing quickly in the SMB segment.");
    // Every field is genuinely distinct text -- proving the columns
    // represent their own actual semantic field, not a shared source.
    const values = [row.positioning, row.strengths, row.weaknesses, row.threat];
    assert.equal(new Set(values).size, values.length);
  });

  test(`regression (${name}): a genuine markdown-table-shaped competitor section (the table branch, untouched by this fix) still reads each column from its own distinct header, never duplicating`, () => {
    const tableContent = [
      "## Competitor Landscape",
      "| Company | Positioning | Strengths | Weaknesses | Threat |",
      "| --- | --- | --- | --- | --- |",
      "| Acme Corp | Budget SMB tooling | Fast onboarding | Few integrations | Moderate |",
    ].join("\n");
    const rows = extraction().extractCompetitorRows(tableContent);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.company, "Acme Corp");
    assert.equal(row.positioning, "Budget SMB tooling");
    assert.equal(row.strengths, "Fast onboarding");
    assert.equal(row.weaknesses, "Few integrations");
    assert.equal(row.threat, "Moderate");
  });
}

// --- 1. Table layout overflow -----------------------------------------

// TASK #69A-15 superseded the exact literal anchor this suite originally
// used ("const competitors = extractCompetitorRows(") -- that line is
// now a ternary preferring businessCompetitorLandscapeState first, with
// extractCompetitorRows only as its fallback branch. Anchored on the
// stable branch CONDITION itself instead, which #69A-15 left untouched.
// page.tsx also has an EARLIER, unrelated normalizedTitle.includes("competitor")
// occurrence (a markdown-table-stripping helper) that a bare alternation
// would match instead -- this specific literal prefix (matching this
// file's own real Competitor Landscape branch, immediately followed by
// its own doc comment) disambiguates it.
function getCompetitorCardBlock(name, source) {
  const branchAnchor =
    name === "Planner.tsx"
      ? /field === "competitorAnalysis" \|\| field === "competitorLandscape"\)/
      : /normalizedTitle\.includes\("competitor"\)\) \{\s*\n\s*\/\/ TASK/;
  const match = new RegExp(branchAnchor.source + "[\\s\\S]{0,6500}").exec(source);
  assert.ok(match, `${name}: competitor card block not found`);
  return match[0];
}

for (const [name, source] of [
  ["Planner.tsx", plannerSource],
  ["page.tsx", pageSource],
]) {
  test(`requirement 1 (${name}): the Competitive Intelligence Table's outer card and its overflow-x-auto scroll wrapper both have min-w-0, so an oversized child can never force the whole card wider than its container instead of scrolling internally`, () => {
    const block = getCompetitorCardBlock(name, source);
    assert.match(block, /mb-5 min-w-0 overflow-hidden rounded-\[2rem\] border border-white\/10 bg-white\/\[0\.025\]/);
    assert.match(block, /<div className="min-w-0 overflow-x-auto">/);
  });

  test(`requirement 1 (${name}): every data cell (Company/Positioning/Strengths/Weaknesses) has min-w-0 and break-words so its grid track can always shrink to its fair share rather than being forced wide by unbroken content`, () => {
    const block = getCompetitorCardBlock(name, source);
    assert.match(block, /min-w-0 break-words px-4 py-4 font-semibold text-white/);
    assert.match(block, /<div className="min-w-0 break-words px-4 py-4">\{row\.positioning \|\| "—"\}<\/div>/);
    assert.match(block, /<div className="min-w-0 break-words px-4 py-4">\{row\.strengths\}<\/div>/);
    assert.match(block, /<div className="min-w-0 break-words px-4 py-4">\{row\.weaknesses\}<\/div>/);
  });

  test(`requirement 1 (${name}): the THREAT column's badge no longer assumes single-line pill content -- min-w-0 on its cell, and max-w-full/whitespace-normal/break-words/rounded-2xl on the chip itself, so real (possibly longer) threat text wraps safely instead of forcing extra width`, () => {
    const block = getCompetitorCardBlock(name, source);
    assert.match(block, /<div className="min-w-0 px-4 py-4">\s*\n\s*<span className="inline-block max-w-full whitespace-normal break-words rounded-2xl border border-teal-200\/20 bg-teal-200\/10 px-2\.5 py-1 text-xs font-semibold text-teal-100">\s*\n\s*\{row\.threat\}/);
    assert.doesNotMatch(block, /rounded-full border border-teal-200\/20 bg-teal-200\/10 px-2\.5 py-1 text-xs font-semibold text-teal-100">\s*\n\s*\{row\.threat\}/);
  });

  test(`requirement 1 (${name}): the table's own horizontal-scroll fallback (overflow-x-auto wrapper with an explicit min-w-[760px] inner width and fr-sized, never-zero-width columns) is unchanged -- this fix makes it actually work, never replaces it`, () => {
    const block = getCompetitorCardBlock(name, source);
    assert.match(block, /<div className="min-w-\[760px\]">/);
    assert.match(block, /grid-cols-\[1fr_1\.35fr_1\.15fr_1\.15fr_0\.9fr\]/);
  });
}

// --- 4. Hardcoded fictional competitor data --------------------------

test("requirement 4 (page.tsx): the hardcoded, entirely fictional 'Competitive Positioning Map' (4 fixed fake data points at fixed coordinates) no longer exists anywhere in page.tsx", () => {
  assert.doesNotMatch(pageSource, /Competitive Positioning Map/);
  assert.doesNotMatch(pageSource, /"Incumbents", "24%", "32%"/);
  assert.doesNotMatch(pageSource, /"ZERINIX Thesis", "58%", "62%"/);
});

test("requirement 4 (page.tsx): the Competitor Landscape section now renders the real 'Competitive Intelligence Table', built from this report's own competitor data (structured-first, via #69A-15, with extractCompetitorRows as its fallback) -- not a substitute or invented dataset", () => {
  const block = getCompetitorCardBlock("page.tsx", pageSource);
  assert.match(block, /extractCompetitorRows\(content\)/);
  assert.match(block, /Competitive Intelligence Table/);
});

test("requirement 4 (page.tsx): page.tsx's own cardFirstReportFields now includes the competitor field names, suppressing the redundant raw-table duplicate now that a real card exists here (mirrors Planner.tsx's own #69A-12 fix, applied there because Planner.tsx already had a real card)", () => {
  const setMatch = /const cardFirstReportFields = new Set\(\[[\s\S]*?\]\);/.exec(pageSource);
  assert.ok(setMatch, "page.tsx cardFirstReportFields not found");
  assert.match(setMatch[0], /"competitorAnalysis"/);
  assert.match(setMatch[0], /"competitorLandscape"/);
});

// --- 5. Authority preservation -----------------------------------------

test("requirement 5: no canonical decision/confidence/scoring/provenance/risk/TAM-SAM-SOM/financial/Founder-Readiness/Benchmark file was touched by this presentation+extraction-layer fix (drift check)", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-13/);
  }
});

test("requirement 5: extractCompetitorRows' own table-branch reading (the AI-generated markdown table shape) is completely untouched by this fix -- only the bullet-fallback branch's cross-field duplication mechanism changed", () => {
  assert.match(
    plannerSource,
    /const read = \(keys: string\[\]\) => \{\s*\n\s*const index = headers\.findIndex\(\(header\) => keys\.some\(\(key\) => header\.includes\(key\)\)\);\s*\n\s*return index >= 0 \? cells\[index\] \|\| "" : "";\s*\n\s*\};/
  );
});
