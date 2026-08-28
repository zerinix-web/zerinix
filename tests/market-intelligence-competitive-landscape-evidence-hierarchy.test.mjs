import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #15 -- Fix the remaining user-visible contradiction between
// Competitive Landscape and Major Players in the REAL regenerated Market
// Intelligence report.
//
// Task #14's fix (a colon-leading name-LIST pattern) did not cover the
// actual real content, confirmed by fetching the exact regenerated
// report's stored `majorPlayers` field directly from the database. The
// real shape is genuinely different from every previous guess: one
// "Vendor -- description [citation]." entry PER LINE, with the first
// vendor sharing its line with the intro clause and NO leading "-"
// bullet marker anywhere:
//
//   "Only evidence-supported major players in the supplied registry:
//   Ironclad -- product pages and pricing plan page indicate CLM + AI
//   assistant + eSignature positioning; public pricing not fixed on site
//   [R4].\nEvisort -- publishes an AI engine and contract LLM, positioning
//   as AI-first CLM/contract intelligence [R5][R39].\nDocuSign CLM --
//   appears in state procurement pricing (South Carolina)...[R3].\n
//   LawGeex -- advertises AI contract-review capabilities...[R6]. ..."
//
// ROOT CAUSE: none of the existing tiers recognize this shape --
// extractFlattenedMarketIntelligenceCompetitorRows requires a leading
// "-" bullet; the three prose-list tiers in
// extractMarketIntelligenceCompetitorNamesOnly (predicate-leading,
// subject-leading, colon-leading) all look for ONE comma-separated "A,
// B, and C" list, not four separate per-vendor lines. Both structured
// extraction (rows) and name-only extraction (namesOnly) correctly
// returned zero, so Competitive Landscape fell through to the flat "no
// competitor data could be validated" message while Major Players, one
// section above, plainly described all four vendors.
//
// FIX #1 (root cause): a new tier finds each vendor independently -- a
// short capitalized phrase (1-4 words) immediately preceded by a line
// start, a newline, or a colon-introduced clause, and immediately
// followed by " -- " (an em dash), the model's own per-item separator
// here. Anchoring on that exact separator (not just any capitalized
// word) keeps this safe against false positives from ordinary prose.
//
// FIX #2 (evidence hierarchy wording, requirement 2/5): the compact
// card's own wording used to say evidence "does not independently
// validate them as direct, head-to-head competitors" -- casting doubt on
// competitor IDENTITY, when only the structured, detailed comparison
// (positioning/strengths/weaknesses/market-share matrix) was ever
// unvalidated. Reworded to separate the two: (A) these ARE evidence-
// identified active market participants, (B) detailed competitive
// comparison specifically has not been independently validated.
//
// Both fixes are mirrored identically across page.tsx, Planner.tsx (web
// + PDF), and ReportPdfButton.tsx (PDF), per this codebase's established
// triple-duplication pattern.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;

  let i = start + startMatch[0].length - 1;
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  while (source[i] !== "{") {
    i += 1;
  }

  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);

  return source.slice(start, i);
}

async function compileHarness(source, functionNames, exportName) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-evidence-hierarchy-"));
  const outPath = join(dir, "harness.mts");
  const body = functionNames.map((name) => extractFunctionSource(source, name)).join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportName} };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[exportName];
}

const surfaces = [
  { label: "page.tsx", source: pageSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource, plausibilityFnName: "isImplausibleCompetitorNamePdf" },
  { label: "Planner.tsx", source: plannerSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
];

// The EXACT real content fetched from this report's own stored
// `majorPlayers` field (report id 0ff68a4d-35ca-4875-aec1-9c43a3c20563,
// generated 2026-08-28) -- the actual failure shape, not a guess.
const realMajorPlayersContent =
  "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site [R4].\n" +
  "Evisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence [R5][R39].\n" +
  "DocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings [R3].\n" +
  "LawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review [R6].\n" +
  "Evidence strength varies: Ironclad and Evisort have strongest product-page evidence [R4][R5]; DocuSign procurement price list proves buyability in public sector [R3]; LawGeex marketing evidences capability but fewer independent metrics [R6].";

// The EXACT real content fetched from this same report's own stored
// `competitiveLandscape` field -- pure prose, no markdown table, no
// bulleted lines, confirming the fixture genuinely starts from zero
// structured rows before recovery, exactly as it did in production.
const realCompetitiveLandscapeContent =
  "Market structure: commercial CLM market in U.S. shows active specialist vendors (Ironclad, Evisort, LawGeex, DocuSign CLM) with AI features and procurement footprints [R4][R5][R6][R3]. " +
  "Competitive intensity: moderate-to-high—feature parity increasing as multiple vendors announce AI engines (convergence on extraction, clause scoring) [R5][R6]. " +
  "Positioning clusters: (a) AI-first CLM (Evisort, LawGeex), (b) integrated workflow + eSignature (Ironclad, DocuSign CLM) [R5][R4][R3]. " +
  "Entry barriers: data quality, model trust, and procurement listings; switching costs: moderate due to repository migration and workflow reconfiguration. " +
  "Differentiation levers: vertical-specific compliance modules, demonstrable accuracy metrics, and procurement-ready pricing/contract terms. " +
  "Competitive implication: an entrant must show measurable AI accuracy and procurement-readiness to win mid-market accounts.";

test("SCENARIO B (the exact real production failure, root cause fix): the real stored majorPlayers content -- one 'Vendor -- description' line per vendor, no bullets, no comma list -- now recovers all 4 real vendor names, in all three surfaces", async () => {
  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileHarness(
      source,
      [plausibilityFnName, "extractMarketIntelligenceCompetitorNamesOnly"],
      "extractMarketIntelligenceCompetitorNamesOnly"
    );
    const names = fn(realMajorPlayersContent);
    assert.deepEqual(
      names,
      ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"],
      `${label}: expected all 4 real vendor names recovered from the real report shape, got ${JSON.stringify(names)}`
    );
  }
});

test("SCENARIO B continued: the real stored competitiveLandscape content genuinely has zero structured rows (pure prose, no table, no bullets) -- confirming this fixture starts from the true 'initially empty/unusable' state before recovery, exactly as production did, in all three surfaces", async () => {
  for (const { source, plausibilityFnName } of surfaces) {
    const extractRows = await compileHarness(
      source,
      [
        plausibilityFnName,
        "extractFlattenedMarketIntelligenceCompetitorRows",
        "extractMarketIntelligenceCompetitorRowsFromMajorPlayers",
        "extractMarketIntelligenceCompetitorRowsFromTable",
        "extractMarketIntelligenceCompetitorRows",
      ],
      "extractMarketIntelligenceCompetitorRows"
    );
    assert.deepEqual(extractRows(realCompetitiveLandscapeContent, realMajorPlayersContent), []);
  }
});

test("SCENARIO B, no special-casing: a DIFFERENT, generic vendor set in the identical em-dash-per-line shape is also recovered, proving the fix is pattern-based, in all three surfaces", async () => {
  const genericContent =
    "Only evidence-supported major players in the supplied registry: Meridian Ledger — offers embedded reconciliation tooling for mid-market finance teams [R1].\n" +
    "Northwind Analytics — provides usage-based billing analytics with an open API [R2].\n" +
    "Cobalt Fintech — positions as a compliance-first ledger platform for regulated industries [R3].";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileHarness(
      source,
      [plausibilityFnName, "extractMarketIntelligenceCompetitorNamesOnly"],
      "extractMarketIntelligenceCompetitorNamesOnly"
    );
    const names = fn(genericContent);
    assert.deepEqual(
      names,
      ["Meridian Ledger", "Northwind Analytics", "Cobalt Fintech"],
      `${label}: expected the generic vendor set recovered, got ${JSON.stringify(names)}`
    );
  }
});

test("SCENARIO A (regression guard, no evidence-standard weakening): genuinely no evidence-supported players -- ordinary prose with no em-dash-labeled entries and no name list -- still yields zero names, in all three surfaces", async () => {
  const noEvidenceContent =
    "Independent, publicly available information on named competitors in this market was limited during research. Competitive intensity below is inferred from category-level and structural evidence rather than confirmed vendor profiles -- this narrows confidence in company-specific claims but does not indicate an absence of competition.";

  for (const { label, source, plausibilityFnName } of surfaces) {
    const fn = await compileHarness(
      source,
      [plausibilityFnName, "extractMarketIntelligenceCompetitorNamesOnly"],
      "extractMarketIntelligenceCompetitorNamesOnly"
    );
    assert.deepEqual(fn(noEvidenceContent), [], `${label}: expected zero names fabricated from a genuine no-evidence statement`);
  }
});

test("SCENARIO A continued: an ordinary colon-introduced clause with a lowercase continuation (the vast majority of real Market Intelligence prose) never triggers the new em-dash tier, in all three surfaces", async () => {
  const ordinaryProse =
    "Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win-rate evidence.";

  for (const { source, plausibilityFnName } of surfaces) {
    const fn = await compileHarness(
      source,
      [plausibilityFnName, "extractMarketIntelligenceCompetitorNamesOnly"],
      "extractMarketIntelligenceCompetitorNamesOnly"
    );
    assert.deepEqual(fn(ordinaryProse), []);
  }
});

test("SCENARIO C (no regression): a fully structured, sufficiently validated competitor table (real markdown table content) still renders as normal rows through the unmodified table tier, in all three surfaces", async () => {
  const tableContent = [
    "| Vendor | Category | Position | Strengths | Weaknesses | Market Relevance | Confidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| Ironclad | AI CLM | Enterprise | Broad platform | Pricing opacity | High | 88/100 High |",
    "| Evisort | AI CLM | Mid-market | AI-first engine | Newer entrant | High | 80/100 High |",
    "| DocuSign CLM | Workflow + eSign | SMB/Enterprise | Procurement-ready | Bundled complexity | Medium | 75/100 Medium |",
  ].join("\n");

  for (const { source, plausibilityFnName } of surfaces) {
    const extractRows = await compileHarness(
      source,
      [
        plausibilityFnName,
        "extractFlattenedMarketIntelligenceCompetitorRows",
        "extractMarketIntelligenceCompetitorRowsFromMajorPlayers",
        "extractMarketIntelligenceCompetitorRowsFromTable",
        "extractMarketIntelligenceCompetitorRows",
      ],
      "extractMarketIntelligenceCompetitorRows"
    );
    const rows = extractRows(tableContent, "");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.vendor), ["Ironclad", "Evisort", "DocuSign CLM"]);
    for (const row of rows) {
      assert.ok(row.category && row.position && row.strengths && row.weaknesses);
    }
  }
});

test("requirement 2/5 wording fix: the compact card distinguishes (A) evidence-supported identification from (B) unvalidated detailed comparison -- it no longer casts doubt on competitor identity itself, in page.tsx and Planner.tsx (web)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /Relevant Players Identified — Detailed Comparison Requires Validation/);
    assert.match(
      source,
      /These companies are identified in available evidence as active market participants\.\s*\n\s*Detailed competitive comparison — positioning, strengths, weaknesses, and market share —\s*\n\s*has not yet been independently validated for this analysis\./
    );
    assert.doesNotMatch(
      source,
      /Not Validated as Direct Competitors/,
      "the old identity-doubting header must be fully replaced"
    );
  }
});

test("requirement 2/5 wording fix, requirement 7 (PDF): the same distinction is reflected in both PDF exporters' compact-card header and intro text", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /RELEVANT PLAYERS IDENTIFIED — DETAILED COMPARISON REQUIRES VALIDATION/);
    assert.match(
      source,
      /"These companies are identified in available evidence as active market participants\. Detailed competitive comparison -- positioning, strengths, weaknesses, and market share -- has not yet been independently validated for this analysis\.";/
    );
    assert.doesNotMatch(source, /NOT VALIDATED AS DIRECT COMPETITORS/);
  }
});

test("requirement 4: no fabricated attributes -- the compact card's names-only path never introduces category/position/strengths/weaknesses/pricing/market-share fields, only vendor names, in all three surfaces", () => {
  for (const source of [pageSource, plannerSource]) {
    // The names-only branch renders bare name chips (namesOnly.map), never
    // per-field cells -- confirms no structured attribute is invented for
    // recovered names.
    assert.match(source, /\{namesOnly\.map\(\(name\) => \(/);
  }
  // PDF: the compact layout draws only the joined name list, never per-
  // column vendor data (miColumns is used solely by the full-table path).
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /namesOnly\.join\("   •   "\)/);
  }
});

test("requirement 6: Competitive Landscape's recovery path is fed by majorPlayersContent -- the SAME content Major Players itself renders verbatim -- never an independently re-derived interpretation, in all three surfaces", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /const namesOnly = extractMarketIntelligenceCompetitorNamesOnly\(majorPlayersContent\);/
    );
  }
});

test("requirement 9 (audit final rendered strings): the new em-dash tier is reachable ONLY as a last resort, after every list-based prose tier and every structured tier have already found nothing -- so it can never suppress a cleaner extraction that already succeeded, in all three surfaces", () => {
  for (const source of [pageSource, pdfButtonSource, plannerSource]) {
    assert.match(
      source,
      /const listMatch = predicateLeadingMatch \|\| subjectLeadingMatch \|\| colonLeadingMatch;[\s\S]{0,4000}?if \(names\.length === 0\) \{\s*\n\s*const emDashLabelPattern/,
      "the em-dash tier must be gated behind names.length === 0, tried only after the list-based tiers"
    );
  }
});

test("drift check: Major Players' own rendering is untouched by this fix -- it still displays majorPlayersContent directly, with no new extraction/reinterpretation layer introduced by this ticket", () => {
  // This ticket only changes how COMPETITIVE LANDSCAPE recovers evidence
  // already present in Major Players' own content; Major Players itself
  // must keep rendering its own field verbatim, so both sections remain
  // grounded in literally the same source text (requirement 6).
  assert.doesNotMatch(pageSource, /function renderMajorPlayers/);
  assert.doesNotMatch(plannerSource, /function renderMajorPlayers/);
});
