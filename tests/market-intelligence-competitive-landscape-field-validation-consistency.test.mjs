import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #13 -- Fix Market Intelligence competitor evidence and
// decision-state consistency.
//
// This file covers the two NEW defects found and fixed for this ticket
// (on top of Task #12's already-tested Major-Players-prose fallback):
//
// 1. Competitive Landscape's per-field cells (category/position/
//    strengths/weaknesses/relevance) fell back to a bare, unexplained
//    "-" whenever a real, validated competitor row had an unsupported
//    field -- most commonly the Major-Players-bulleted extraction tier
//    (extractMarketIntelligenceCompetitorRowsFromMajorPlayers), which by
//    design always leaves strengths/weaknesses/relevance empty (that
//    source format never states them). validationStatus, in the SAME
//    row, already correctly showed a semantic amber "Validation Needed"
//    badge instead of a dash -- every other field was missed. Fixed by
//    mirroring that exact pattern onto every remaining field, in
//    page.tsx, Planner.tsx (web) and, for the PDF drawers
//    (ReportPdfButton.tsx, Planner.tsx), by routing the equivalent
//    per-cell fallback through the SAME localizePdfPresentationLabel
//    helper every sibling "Validation Required" fallback in those files
//    already uses (it was hardcoding an unlocalized, inconsistently-cased
//    "Validation required" literal instead).
//
// 2. page.tsx's ReportSectionVisual had one decision-adjacent branch
//    (title matches "executive recommendation"/"yönetici tavsiyesi")
//    that called detectRecommendation(content) -- a bare
//    `\b(GO|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b` scan -- directly on
//    that section's own raw content, with NO isMarketIntelligence guard,
//    unlike every sibling MI-decision branch in the same file (which all
//    resolve exclusively through resolveMarketIntelligenceExecutiveDecision).
//    Current-generation MI reports never carry a section literally
//    titled "Executive Recommendation" (legacyMarketSectionToField remaps
//    it to strategicRecommendations at generation time), but a legacy/
//    stored report could, and this branch could then render a decision
//    disagreeing with the Decision Signal strip and Investment Decision
//    Snapshot shown elsewhere on the same page. Fixed by gating the
//    branch behind `!isMarketIntelligence`, matching the same
//    defense-in-depth policy already applied to
//    ExecutiveDecisionIntelligencePanel.
//
// Also included: structural regression coverage for two requirements
// this ticket explicitly calls out as "must remain true, not newly
// introduced" -- the Market Map's independence from the competitor
// table's own resolution state (scenario B), and that Competitive
// Landscape already reuses Major Players' validated evidence (scenario
// A), which Task #12 fixed and tested at the names-only tier; this file
// adds the structured-row-tier equivalent.

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

async function compileCompetitorRowsExtractor(source, plausibilityFnName) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-competitor-rows-"));
  const outPath = join(dir, "rows.mts");
  const harness = `
${extractFunctionSource(source, plausibilityFnName)}

${extractFunctionSource(source, "extractFlattenedMarketIntelligenceCompetitorRows")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRowsFromMajorPlayers")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRowsFromTable")}

${extractFunctionSource(source, "extractMarketIntelligenceCompetitorRows")}

export { extractMarketIntelligenceCompetitorRows };
`;
  writeFileSync(outPath, harness);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketIntelligenceCompetitorRows;
}

const surfaces = [
  { label: "page.tsx", source: pageSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource, plausibilityFnName: "isImplausibleCompetitorNamePdf" },
  { label: "Planner.tsx", source: plannerSource, plausibilityFnName: "isImplausibleCompetitorNameOnScreen" },
];

// The exact reported production shape: four real, evidence-backed
// vendors (Ironclad, Evisort, DocuSign CLM, LawGeex) written in Major
// Players' own deterministic bulleted format, with no markdown table and
// no flattened-bullet content in Competitive Landscape's own section --
// exercises the majorPlayers fallback tier specifically.
const majorPlayersBulletedContent = [
  "- Ironclad (Major Player): Contract Lifecycle Management, AI Review; target customer: Enterprise Legal Teams (ranking: 92/100; overall score: 90/100; confidence: 88/100 High)",
  "- Evisort (Major Player): AI Contract Analysis; target customer: Mid-Market Legal Teams (ranking: 85/100; overall score: 83/100; confidence: 80/100 High)",
  "- DocuSign CLM (Major Player): Contract Lifecycle Management; target customer: SMB and Enterprise (ranking: 80/100; overall score: 78/100; confidence: 75/100 Medium)",
  "- LawGeex (Major Player): AI Contract Review; target customer: Enterprise Legal Ops (ranking: 74/100; overall score: 72/100; confidence: 68/100 Medium)",
].join("\n");

test("scenario A (structured-row tier): validated Major Players evidence in the deterministic bulleted format produces real Competitive Landscape rows -- not an empty table -- in all three surfaces", async () => {
  for (const { label, source, plausibilityFnName } of surfaces) {
    const extractRows = await compileCompetitorRowsExtractor(source, plausibilityFnName);
    const rows = extractRows("", majorPlayersBulletedContent);

    assert.equal(rows.length, 4, `${label}: expected 4 rows extracted from Major Players' bulleted evidence`);
    assert.deepEqual(
      rows.map((row) => row.vendor),
      ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"],
      `${label}: expected all 4 real vendor names to populate real rows, got ${JSON.stringify(rows.map((r) => r.vendor))}`
    );
    for (const row of rows) {
      assert.ok(row.category, `${label}: ${row.vendor} should have a populated category from Major Players' own label`);
      // This tier's own source format never states strengths/weaknesses/
      // relevance -- by design these stay empty rather than fabricated.
      // This is the exact shape the per-field "Validation Needed"
      // fallback (tested below) exists to handle.
      assert.equal(row.strengths, "", `${label}: strengths must stay empty, never fabricated, for this tier`);
      assert.equal(row.weaknesses, "", `${label}: weaknesses must stay empty, never fabricated, for this tier`);
      assert.equal(row.relevance, "", `${label}: relevance must stay empty, never fabricated, for this tier`);
    }
  }
});

test("scenario A regression guard: with no table, no flattened bullets, and no Major Players content at all, zero rows are fabricated, in all three surfaces", async () => {
  for (const { source, plausibilityFnName } of surfaces) {
    const extractRows = await compileCompetitorRowsExtractor(source, plausibilityFnName);
    assert.deepEqual(extractRows("", ""), []);
  }
});

test("fix: web competitor table cells (category/position/strengths/weaknesses) show 'Validation Needed' instead of a bare dash when a real, validated row has an unsupported field, in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(
      source,
      /\{row\.category \|\| "—"\}/,
      "row.category must no longer fall back to a bare, unexplained dash"
    );
    assert.doesNotMatch(source, /\{row\.position \|\| "—"\}/);
    assert.doesNotMatch(source, /\{row\.strengths \|\| "—"\}/);
    assert.doesNotMatch(source, /\{row\.weaknesses \|\| "—"\}/);

    assert.match(source, /\{row\.category \|\| "Validation Needed"\}/);
    assert.match(source, /\{row\.position \|\| "Validation Needed"\}/);
    assert.match(source, /\{row\.strengths \|\| "Validation Needed"\}/);
    assert.match(source, /\{row\.weaknesses \|\| "Validation Needed"\}/);
  }
});

test("fix: the Relevance cell mirrors validationStatus's own already-correct pattern -- a real value keeps its teal badge, a missing value shows the same amber 'Validation Needed' badge used for validationStatus, in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /\{row\.relevance \? \(\s*<span className="rounded-full border border-teal-200\/20 bg-teal-200\/10[^"]*"[^>]*>\s*\{row\.relevance\}/,
      "a real relevance value must still render in its existing teal badge, unchanged"
    );
    // Two occurrences expected: validationStatus's pre-existing fallback
    // and relevance's newly-added one, using the identical amber classes.
    const amberValidationNeededBadges = source.match(
      /className="rounded-full border border-amber-300\/20 bg-amber-300\/10 px-2\.5 py-1 text-xs font-semibold text-amber-200">\s*\n?\s*Validation Needed/g
    );
    assert.ok(
      amberValidationNeededBadges && amberValidationNeededBadges.length >= 2,
      "expected both validationStatus and relevance to share the same amber 'Validation Needed' badge when empty"
    );
  }
});

test("fix: the Market Intelligence PDF competitor table's per-cell fallback routes through the same localizePdfPresentationLabel helper every sibling fallback in the file already uses, instead of a hardcoded, unlocalized 'Validation required' literal, in ReportPdfButton.tsx and Planner.tsx", () => {
  // Scoped deliberately to the MI-specific row-drawing block (identified
  // by its own values tuple, which includes relevance/validationStatus --
  // fields only Market Intelligence's competitor shape has). The generic
  // Business Plan/Acquisition competitor table (row.company/positioning/
  // threat) is a different report kind entirely and out of scope for this
  // Market-Intelligence-only ticket; it is deliberately NOT asserted on
  // here.
  for (const source of [pdfButtonSource, plannerSource]) {
    const miRowsBlockMatch = source.match(
      /const values = \[row\.vendor, row\.category, row\.position, row\.strengths, row\.weaknesses, row\.relevance, row\.validationStatus\];[\s\S]{0,600}/
    );
    assert.ok(miRowsBlockMatch, "expected to find the Market Intelligence competitor row-drawing block");
    const miRowsBlock = miRowsBlockMatch[0];

    assert.doesNotMatch(
      miRowsBlock,
      /\|\|\s*"Validation required"/,
      "the MI PDF competitor cell fallback must not hardcode an unlocalized literal"
    );
    assert.match(
      miRowsBlock,
      /value \|\| localizePdfPresentationLabel\("Validation Required", pdfLocale\)/,
      "the MI PDF competitor cell fallback must reuse the shared localized label helper"
    );
  }
});

test("scenario B: the Market Map's own validation threshold is structurally independent from the competitor table's row count, in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    const marketMapSource = extractFunctionSource(source, "MarketMap");

    // MarketMap computes its own placements from the rows it's given and
    // gates ONLY on how many of those rows have a plottable signal on
    // both axes -- never on whether the table itself found any rows at
    // all (that's the competitor table's own, separate empty-state,
    // handled entirely before MarketMap is ever rendered).
    assert.match(marketMapSource, /placements\.length >= 2/);
    assert.doesNotMatch(
      marketMapSource,
      /rows\.length === 0/,
      "MarketMap must not gate its own rendering on the raw row count -- only on its own placements"
    );

    // The Competitive Landscape section renders <MarketMap rows={rows} />
    // unconditionally whenever it has already decided to render the real
    // table (rows.length > 0) -- not behind any additional market-map-
    // specific precondition that could hide validated competitors.
    assert.match(source, /<MarketMap rows=\{rows\} \/>/);
  }
});

test("fix: page.tsx's legacy 'Executive Recommendation' visual no longer independently re-derives a decision for Market Intelligence reports", () => {
  assert.match(
    pageSource,
    /!isMarketIntelligence &&\s*\n\s*\(normalizedTitle\.includes\("executive recommendation"\) \|\| normalizedTitle\.includes\("yönetici tavsiyesi"\)\)/,
    "the executive-recommendation branch must be gated behind !isMarketIntelligence"
  );
});

test("scenario E, drift check: Planner.tsx's equivalent Executive Summary decision computation already resolves Market Intelligence exclusively through resolveMarketIntelligenceExecutiveDecision, never falling through to detectRecommendation for MI (pre-existing, correct -- confirms no equivalent gap exists there)", () => {
  assert.match(
    plannerSource,
    /const marketDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecision\(section\.content, evidenceLocale\)\s*\n\s*: null;/
  );
  assert.match(
    plannerSource,
    /const recommendation = marketDecision\s*\n\s*\? marketDecision\.decisionLabel/,
    "recommendation must prefer the canonical marketDecision before ever reaching detectRecommendation"
  );
});

test("scenario E, drift check: ReportPdfButton.tsx's cover badge label draws the canonical marketDecisionText for Market Intelligence, never the generic detectRecommendation-derived recommendation variable", () => {
  assert.match(
    pdfButtonSource,
    /const marketDecisionText = marketDecision \? marketDecision\.decisionLabel : "";/
  );
  assert.match(pdfButtonSource, /\?\s*marketDecisionText\s*\n/);
});
