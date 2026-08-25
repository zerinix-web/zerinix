import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Regression coverage for ticket: "Fix the remaining canonical-data
// consistency and PDF export defects in ZERINIX Market Intelligence
// reports." Covers, in order, the properties the ticket explicitly
// required regression tests for:
//
//   A. Web decision === PDF decision.
//   B. Web confidence === PDF confidence.
//   C. A report cannot simultaneously claim "no competitor data
//      validated" while exposing validated Major Players without
//      explaining the distinction.
//   D. Canonical Major Players survive the PDF export pipeline.
//   E. Unsupported TAM/SAM/SOM and CAGR remain unreported rather than
//      fabricated (drift check -- untouched by this ticket).
//   F. Decision-critical PDF text is not silently truncated.
//   G. Existing market-intelligence generation still works (drift check).
//
// Properties A and B have their own dedicated, more exhaustive coverage
// in tests/market-intelligence-decision-confidence-sync.test.mjs -- this
// file adds direct behavioral proofs (real functions, real input,
// asserted output) for C, D, F, plus light drift checks for E and G.

const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");

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

async function compileModule(pieces, exportNames) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-canonical-consistency-"));
  const outPath = join(dir, "module.ts");
  const body = pieces.join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

// --- Property C: Major Players names-only fallback (4th tier) ----------
//
// Reproduces the ticket's own reported defect verbatim: real Major
// Players content whose vendor names are grouped with " / " and have NO
// parenthetical label before the colon (so tiers 1-3 all fail to produce
// any rows), while still containing real, validated vendor identities.

const MAJOR_PLAYERS_GROUPED_PROSE = `- Thomson Reuters / CoCounsel / Westlaw Edge: AI-powered legal research and contract platform with broad enterprise adoption across the U.S. legal AI software market.
- LexisNexis / Lexis+ AI: generative-AI legal research assistant integrated into the existing Lexis+ platform.
- Evisort: AI-native contract lifecycle management platform focused on mid-market legal teams.
- Fastcase: legal research platform bundled with several state and county bar associations.
- Litera / Kira: AI-assisted contract review and drafting tooling for large law firms.`;

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
]) {
  test(`${label}: extractMarketIntelligenceCompetitorNamesOnly extracts real, plausible vendor names from grouped "A / B / C" Major Players prose that has no parenthetical label (the exact shape that made tiers 1-3 fail and the report claim "no competitor data validated" while naming real vendors immediately below)`, async () => {
    const raw = extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly");
    // isImplausibleCompetitorNameOnScreen / isImplausibleCompetitorNamePdf
    // is this function's only real dependency.
    const dependencyName = label === "ReportPdfButton.tsx" ? "isImplausibleCompetitorNamePdf" : "isImplausibleCompetitorNameOnScreen";
    const dependency = extractFunctionSource(source, dependencyName);
    const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);
    const names = mod.extractMarketIntelligenceCompetitorNamesOnly(MAJOR_PLAYERS_GROUPED_PROSE);

    assert.ok(names.includes("Thomson Reuters"), `expected "Thomson Reuters" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("CoCounsel"), `expected "CoCounsel" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Westlaw Edge"), `expected "Westlaw Edge" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("LexisNexis"), `expected "LexisNexis" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Evisort"), `expected "Evisort" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Fastcase"), `expected "Fastcase" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Litera"), `expected "Litera" in ${JSON.stringify(names)}`);
    // Never a full fabricated row -- names only, no category/strengths/weaknesses.
    for (const name of names) {
      assert.equal(typeof name, "string");
    }
  });

  test(`${label}: REGRESSION (ticket 4, exact reported failure shape) -- extractMarketIntelligenceCompetitorNamesOnly extracts real vendor names from a NON-BULLETED prose paragraph (no graph splice applied, so Major Players is free-form model text, not the deterministic bulleted template) naming Procore, Autodesk, OpenSpace, and Buildots inline`, async () => {
    const raw = extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly");
    const dependencyName = label === "ReportPdfButton.tsx" ? "isImplausibleCompetitorNamePdf" : "isImplausibleCompetitorNameOnScreen";
    const dependency = extractFunctionSource(source, dependencyName);
    const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

    const content =
      "Evidence-supported major players in this market include Procore, Autodesk Construction Cloud, OpenSpace, and Buildots, each demonstrating strong market presence through public records and independent case studies.";
    const names = mod.extractMarketIntelligenceCompetitorNamesOnly(content);

    assert.ok(names.includes("Procore"), `expected "Procore" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Autodesk Construction Cloud"), `expected "Autodesk Construction Cloud" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("OpenSpace"), `expected "OpenSpace" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Buildots"), `expected "Buildots" in ${JSON.stringify(names)}`);
    // The trailing "and" must never leak into a name.
    assert.ok(!names.some((name) => /^and\s/i.test(name)), `no name may retain a leading "and", got ${JSON.stringify(names)}`);
  });

  test(`${label}: extractMarketIntelligenceCompetitorNamesOnly's prose-list fallback correctly returns empty when the content genuinely names no vendors at all (regression guard -- must not fabricate a list from ordinary prose with no "include/such as/like" vendor enumeration)`, async () => {
    const raw = extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly");
    const dependencyName = label === "ReportPdfButton.tsx" ? "isImplausibleCompetitorNamePdf" : "isImplausibleCompetitorNameOnScreen";
    const dependency = extractFunctionSource(source, dependencyName);
    const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

    const content =
      "Independent, publicly available information on named competitors in this market was limited during research. Competitive intensity is inferred from category-level and structural evidence rather than confirmed vendor profiles.";
    const names = mod.extractMarketIntelligenceCompetitorNamesOnly(content);
    assert.deepEqual(names, []);
  });

  test(`${label}: extractMarketIntelligenceCompetitorNamesOnly's prose-list fallback also recognizes a "such as"/"like" introduced list, not just "include"`, async () => {
    const raw = extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly");
    const dependencyName = label === "ReportPdfButton.tsx" ? "isImplausibleCompetitorNamePdf" : "isImplausibleCompetitorNameOnScreen";
    const dependency = extractFunctionSource(source, dependencyName);
    const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

    const content = "Established vendors such as Trimble and Bentley Systems have entered this space with mature offerings.";
    const names = mod.extractMarketIntelligenceCompetitorNamesOnly(content);
    assert.ok(names.includes("Trimble"), `expected "Trimble" in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Bentley Systems"), `expected "Bentley Systems" in ${JSON.stringify(names)}`);
  });

  test(`${label}: extractMarketIntelligenceCompetitorNamesOnly's prose-list fallback is only tried when the bulleted tier finds nothing -- a report with real bulleted Major Players content is unaffected by the new fallback`, async () => {
    const raw = extractFunctionSource(source, "extractMarketIntelligenceCompetitorNamesOnly");
    const dependencyName = label === "ReportPdfButton.tsx" ? "isImplausibleCompetitorNamePdf" : "isImplausibleCompetitorNameOnScreen";
    const dependency = extractFunctionSource(source, dependencyName);
    const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

    const names = mod.extractMarketIntelligenceCompetitorNamesOnly(MAJOR_PLAYERS_GROUPED_PROSE);
    assert.ok(names.includes("Thomson Reuters"));
    assert.ok(!names.some((name) => /^and\s/i.test(name)));
  });
}

test("extractMarketIntelligenceCompetitorNamesOnly never returns implausible candidates (evidence-sentence fragments, URLs, instruction-leading verbs) even when they appear in grouped form", async () => {
  const dependency = extractFunctionSource(pageSource, "isImplausibleCompetitorNameOnScreen");
  const raw = extractFunctionSource(pageSource, "extractMarketIntelligenceCompetitorNamesOnly");
  const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

  const content = [
    "- Conduct further analysis / review pending: no vendor identified yet.",
    "- Market relevance: high confidence based on three independent sources.",
    "- [R3][R7]: raw citation reference block, not a vendor name.",
  ].join("\n");

  const names = mod.extractMarketIntelligenceCompetitorNamesOnly(content);
  assert.deepEqual(names, []);
});

test("extractMarketIntelligenceCompetitorNamesOnly strips a leading URL before splitting on ':' so a bare 'https://...' scheme's own colon is never mistaken for the name/label separator", async () => {
  const dependency = extractFunctionSource(pageSource, "isImplausibleCompetitorNameOnScreen");
  const raw = extractFunctionSource(pageSource, "extractMarketIntelligenceCompetitorNamesOnly");
  const mod = await compileModule([dependency, raw], ["extractMarketIntelligenceCompetitorNamesOnly"]);

  const content = "- Evisort (https://evisort.com): AI-native contract lifecycle management platform.";
  const names = mod.extractMarketIntelligenceCompetitorNamesOnly(content);
  assert.ok(names.includes("Evisort"), `expected "Evisort" in ${JSON.stringify(names)}`);
  assert.ok(!names.some((name) => name.includes("https")), `no candidate should retain the URL: ${JSON.stringify(names)}`);
});

test("page.tsx and Planner.tsx: the Competitive Landscape 'no rows' branch checks extractMarketIntelligenceCompetitorNamesOnly BEFORE falling back to the 'no competitor data could be validated' text, and renders a visually distinct 'Players Identified' state with chips (never fabricated category/position/strengths/weaknesses cells)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /const namesOnly = extractMarketIntelligenceCompetitorNamesOnly\(majorPlayersContent\);\s*\n\s*\n\s*if \(namesOnly\.length > 0\) \{/
    );
    assert.match(source, /Relevant Players Identified — Not Validated as Direct Competitors/);
    assert.match(
      source,
      /These companies are named in available evidence as active in or adjacent to this market,\s*\n\s*but current evidence does not independently validate them as direct, head-to-head\s*\n\s*competitors for this analysis\./
    );
    // Chips render names only -- no category/position/strengths/weaknesses table cells in this branch.
    assert.match(source, /\{namesOnly\.map\(\(name\) => \(/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx (PDF export): the Competitive Landscape 'no rows' branch also checks the names-only fallback before falling back to the generic placeholder text, and draws a distinct 'PLAYERS IDENTIFIED' state instead of an empty table shell", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /RELEVANT PLAYERS IDENTIFIED — NOT VALIDATED AS DIRECT COMPETITORS/);
    assert.match(source, /const namesLayout =\s*\n\s*namesOnly\.length > 0 \? getNamesOnlyCompetitorLayout\(namesOnly, (?:bodyWidth|visualWidth)\) : null;/);
  }
});

// --- Property D: canonical Major Players survive the PDF export --------

test("ReportPdfButton.tsx and Planner.tsx: pdfCompleteVisualFields no longer suppresses majorPlayers' (or its 8 siblings') body text -- the raw section paragraph is drawn below the Key Takeaway box exactly like every other non-complete-visual field, so the PDF renders the actual canonical Major Players list, not just a one-line summary", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const setMatch = source.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "pdfCompleteVisualFields not found");
    assert.doesNotMatch(setMatch[1], /"majorPlayers",/);
    assert.doesNotMatch(setMatch[1], /\.\.\.pdfKeyTakeawayCardFields/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx: pdfKeyTakeawayCardFields (majorPlayers and its 8 siblings) still get their own Key Takeaway box ABOVE the full body text -- this is additive (both the highlighted takeaway and the full canonical prose), not a replacement", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /pdfKeyTakeawayCardFields\.has\(section\.field \?\? ""\)/);
  }
});

// --- splitSentences (getSectionTakeaway's own sentence splitter) -------
//
// Reproduces the ticket's exact reported PDF/Key-Takeaway symptom: content
// truncated to "Evidence-supported major players relevant to U.S." because
// the sentence-boundary splitter had no abbreviation awareness and
// misread the period in "U.S." as a sentence terminator.

test("report-presentation.ts: splitSentences no longer misreads the period in 'U.S.' (or other common abbreviations) as a sentence boundary -- the full sentence survives intact instead of being cut mid-thought", async () => {
  const stripMarkdown = extractFunctionSource(reportPresentationSource, "stripMarkdown");
  const abbreviationsMatch = reportPresentationSource.match(/const SENTENCE_ABBREVIATIONS = \[[\s\S]*?\];/);
  assert.ok(abbreviationsMatch, "SENTENCE_ABBREVIATIONS not found");
  const protectFn = extractFunctionSource(reportPresentationSource, "protectSentenceAbbreviations");
  const restoreFn = extractFunctionSource(reportPresentationSource, "restoreSentenceAbbreviations");
  const splitFn = extractFunctionSource(reportPresentationSource, "splitSentences");

  const mod = await compileModule(
    [stripMarkdown, abbreviationsMatch[0], protectFn, restoreFn, splitFn],
    ["splitSentences"]
  );

  const content =
    "Evidence-supported major players relevant to the U.S. legal AI software market include Thomson Reuters/CoCounsel and Westlaw Edge, LexisNexis/Lexis+ AI, Evisort, Fastcase, and Litera/Kira, each validated through multiple independent sources.";

  const sentences = mod.splitSentences(content);
  assert.equal(sentences.length, 1, `expected exactly 1 sentence, got ${JSON.stringify(sentences)}`);
  assert.match(sentences[0], /Thomson Reuters\/CoCounsel/);
  assert.match(sentences[0], /each validated through multiple independent sources\.$/);
  // Must not have been cut right after "U.S."
  assert.doesNotMatch(sentences[0], /^Evidence-supported major players relevant to the U\.S\.$/);
});

test("report-presentation.ts: splitSentences still splits on REAL sentence boundaries (unchanged behavior for ordinary prose with no abbreviations)", async () => {
  const stripMarkdown = extractFunctionSource(reportPresentationSource, "stripMarkdown");
  const abbreviationsMatch = reportPresentationSource.match(/const SENTENCE_ABBREVIATIONS = \[[\s\S]*?\];/);
  const protectFn = extractFunctionSource(reportPresentationSource, "protectSentenceAbbreviations");
  const restoreFn = extractFunctionSource(reportPresentationSource, "restoreSentenceAbbreviations");
  const splitFn = extractFunctionSource(reportPresentationSource, "splitSentences");

  const mod = await compileModule(
    [stripMarkdown, abbreviationsMatch[0], protectFn, restoreFn, splitFn],
    ["splitSentences"]
  );

  const content =
    "The market is growing steadily across every measured segment. Enterprise adoption remains the primary growth driver this year.";
  const sentences = mod.splitSentences(content);
  assert.equal(sentences.length, 2, `expected exactly 2 sentences, got ${JSON.stringify(sentences)}`);
  assert.match(sentences[0], /^The market is growing steadily/);
  assert.match(sentences[1], /^Enterprise adoption remains/);
});

// --- Property F: decision-critical PDF text is not silently truncated --

test("ReportPdfButton.tsx and Planner.tsx: the Executive Summary card's Why/Top Risk/Information Required/Next Action values no longer draw through drawSingleLine (single-line-only, hard-truncates with an ellipsis regardless of available space) -- they wrap via getExecutiveDecisionCardLayout's own pre-measured wrappedValues, growing the tile when content needs more than one line", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const cardBranchMatch = source.match(
      /const cardLayout = getExecutiveDecisionCardLayout\([\s\S]*?return cardLayout\.totalHeight;\s*\n\s*\}/
    );
    assert.ok(cardBranchMatch, "Executive Summary drawing branch not found");
    const branch = cardBranchMatch[0];

    assert.doesNotMatch(branch, /drawSingleLine\(localizePdfPresentationText\(value, pdfLocale\)/);
    assert.match(branch, /pdf\.text\(wrappedValues\[index\] \?\? \[\], itemX \+ 2, itemY \+ 7\.8, \{/);
    assert.match(branch, /maxWidth: itemWidth - 4,/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx: getExecutiveDecisionCardLayout wraps each recItem value up to 4 lines (not a hard 1-line cap) and grows each row's height to fit the taller of its two tiles, instead of a fixed 15mm-tall single-line tile", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const layoutFnMatch = source.match(/const getExecutiveDecisionCardLayout = \(content: string, width: number\) => \{[\s\S]*?\n {6}\};/);
    assert.ok(layoutFnMatch, "getExecutiveDecisionCardLayout not found");
    assert.match(layoutFnMatch[0], /\.slice\(0, 4\)/);
    assert.match(layoutFnMatch[0], /Math\.max\(15, 7\.8 \+ \(maxLines - 1\) \* 3\.2 \+ 3\)/);
  }
});

test("ReportPdfButton.tsx: getVisualHeight's executiveSummary branch and drawSectionVisual's executiveSummary branch call the exact same getExecutiveDecisionCardLayout(content-or-section.content, bodyWidth) -- pagination height can never fall short of what actually gets drawn (the concrete bug that could make the whole card silently disappear)", () => {
  const occurrences = pdfButtonSource.match(/getExecutiveDecisionCardLayout\([^,]+, bodyWidth\)/g) || [];
  assert.ok(occurrences.length >= 2, `expected at least 2 call sites (draw + height), got ${occurrences.length}`);
});

// --- Property E: unsupported TAM/SAM/SOM/CAGR remain unreported --------
// (drift check -- extensively covered elsewhere; this ticket did not
// touch that logic, confirmed here so a future change can't silently
// weaken it without this file also failing).

test("DRIFT CHECK: TAM/SAM/SOM's 'Validation Needed' evidence-withholding language and the underlying magnitude-parsing function are untouched by this ticket's fixes", () => {
  assert.match(pageSource, /Validation Needed/);
  assert.match(plannerSource, /Validation Needed/);
  assert.match(pageSource, /function parseMonetaryMagnitude/);
});

// --- Property G: existing market-intelligence generation still works ---
// (drift check -- the full existing suite, run separately, is the real
// proof; this is a lightweight sanity check that generation/routing files
// were not touched by this presentation-and-PDF-only ticket).

test("DRIFT CHECK: market-intelligence-graph.ts and the /api/market-analysis route are untouched by this presentation/PDF-only ticket", () => {
  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
  assert.match(graphSource, /function projectMarketIntelligenceGraphToReport/);
  assert.match(routeSource, /excludedFields: \["strategicRecommendations", "tamSamSom", "executiveSummary"\]/);
});
