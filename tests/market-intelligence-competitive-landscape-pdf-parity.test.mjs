import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// COMPETITIVE LANDSCAPE PDF/WEB PARITY FIX.
//
// Both PDF export paths (ReportPdfButton.tsx and Planner.tsx's own
// downloadPdf) drew the Competitive Landscape table using the GENERIC,
// Business-Plan-shaped extractCompetitorRows for every report type,
// including Market Intelligence -- even though the on-screen web view
// (and this exact PDF file's own already-existing
// extractMarketIntelligenceCompetitorRows helper, used elsewhere) had
// long used the correct MI-specific 11-column extractor.
//
// Two concrete, confirmed bugs this caused for MI reports' PDF exports:
//   1. The generic extractor's "positioning" column only ever captured
//      the real table's "Category" cell (findIndex on
//      ["position","category","konum"] matches "Category" first), so
//      Segment/AI Capability/Key Use Cases/Pricing Model were silently
//      dropped from the PDF entirely.
//   2. The generic extractor's "threat" column actually resolved to the
//      real table's "Confidence" cell (findIndex on
//      ["threat","risk","market relevance","confidence"] matches
//      "Confidence" before "Market Relevance", since Confidence appears
//      earlier in the real 11-column header order) -- so the PDF's
//      "Threat" column silently displayed Confidence data, contradicting
//      the on-screen Competitive Landscape state and substantially
//      duplicating the Strengths/Weaknesses text's own nearby signal.
//
// Fix: both PDF paths now fork on isMarketIntelligenceReport/
// isMarketIntelligence -- MI reports draw a real 7-column table (Vendor/
// Category/Position/Strengths/Weaknesses/Relevance/Validation) built from
// extractMarketIntelligenceCompetitorRows, with its own Market Map using
// the category/position row shape; every other report type keeps the
// exact original 5-column generic table and NO Market Map (matching prior
// behavior, since the Market Map was already gated to MI reports only).
//
// AI generation, prompts, schema, research, calculations, confidence
// logic, and business logic are untouched -- this is presentation-layer
// only (drift-checked at the bottom).

const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

// A faithful, standalone reference implementation of
// extractMarketIntelligenceCompetitorRows' real 11-column read() logic,
// used to prove the REQUIRED BEHAVIOR against a realistic table (not just
// that the source text exists) -- paired with the regex assertions below
// confirming both files contain this exact column-key mapping, so a
// behavioral drift in either file would fail here.
function extractMiRowsReference(content) {
  const normalized = (content || "").replace(/\*\*/g, "");
  const tableRows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line));

  if (tableRows.length <= 1) {
    return [];
  }

  const headers = tableRows[0]
    .split("|")
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);

  const read = (cells, keys) => {
    const index = headers.findIndex((header) => keys.some((key) => header.includes(key)));
    return index >= 0 ? cells[index] || "" : "";
  };

  return tableRows
    .slice(1)
    .map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => ({
      vendor: read(cells, ["vendor", "company", "competitor"]),
      category: read(cells, ["category"]),
      position: read(cells, ["segment", "ai capability", "position", "positioning"]),
      strengths: read(cells, ["strength"]),
      weaknesses: read(cells, ["weakness"]),
      relevance: read(cells, ["market relevance"]),
      validationStatus: read(cells, ["confidence"]),
    }))
    .filter((row) => row.vendor || row.strengths || row.weaknesses)
    .slice(0, 20);
}

// The real 11-column header market-intelligence-graph.ts produces
// (confirmed via direct grep of app/lib/ai/market-intelligence-graph.ts).
const realMarketIntelligenceTable = `| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Validation Count | Confidence | Market Relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Acme AI | Acme Corp | Enterprise Platform | Enterprise | Predictive Analytics | Forecasting, Reporting | Subscription | Deep integrations | Limited SMB tooling | 4 | High | 88 |
`;

test("reference: extractMarketIntelligenceCompetitorRows' real column-key mapping correctly separates Position (Segment/AI Capability) from Relevance (Market Relevance) from Validation (Confidence) -- never collapsing Position into Category alone, and never conflating Relevance with Confidence", () => {
  const rows = extractMiRowsReference(realMarketIntelligenceTable);
  assert.equal(rows.length, 1);
  const [row] = rows;

  assert.equal(row.vendor, "Acme AI");
  assert.equal(row.category, "Enterprise Platform");
  // Position reads the FIRST matching column by header order -- "Segment"
  // appears before "AI Capability" in the real header, so Position
  // captures "Enterprise" here (still a real, non-Category-collapsed
  // signal distinct from what the old generic extractor produced).
  assert.equal(row.position, "Enterprise");
  assert.equal(row.strengths, "Deep integrations");
  assert.equal(row.weaknesses, "Limited SMB tooling");
  // Market Relevance and Confidence are DIFFERENT real columns and must
  // resolve to their own distinct values, not the same cell.
  assert.equal(row.relevance, "88");
  assert.equal(row.validationStatus, "High");
  assert.notEqual(row.relevance, row.validationStatus);
});

for (const [label, source] of [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["Planner.tsx", plannerSource],
]) {
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") split the
  // table-only parsing into its own extractMarketIntelligenceCompetitorRowsFromTable
  // function, and added a majorPlayersContent parameter to the main
  // extractMarketIntelligenceCompetitorRows for a third fallback tier --
  // the 11-column key mapping itself, asserted below, is unaffected.
  test(`${label}: extractMarketIntelligenceCompetitorRows exists with the exact real 11-column key mapping (vendor/category/position/strengths/weaknesses/relevance/validationStatus)`, () => {
    assert.match(source, /function extractMarketIntelligenceCompetitorRowsFromTable\(content: string\)/);
    assert.match(source, /function extractMarketIntelligenceCompetitorRows\(content: string, majorPlayersContent = ""\)/);
    assert.match(source, /vendor: read\(cells, \["vendor", "company", "competitor"\]\),/);
    assert.match(source, /category: read\(cells, \["category"\]\),/);
    assert.match(source, /position: read\(cells, \["segment", "ai capability", "position", "positioning"\]\),/);
    assert.match(source, /strengths: read\(cells, \["strength"\]\),/);
    assert.match(source, /weaknesses: read\(cells, \["weakness"\]\),/);
    assert.match(source, /relevance: read\(cells, \["market relevance"\]\),/);
    assert.match(source, /validationStatus: read\(cells, \["confidence"\]\),/);
  });

  test(`${label}: inferMarketIntelligenceMarketMapPosition/inferMarketMapPosition (the category/position-shaped Market Map inference) exists`, () => {
    assert.match(
      source,
      /function infer(?:MarketIntelligenceMarketMapPosition|MarketMapPosition)\(row: \{\s*category: string;\s*position: string/
    );
  });
}

// --- ReportPdfButton.tsx: drawSectionVisual forks on isMarketIntelligenceReport

test("ReportPdfButton.tsx: the competitor-table drawing branch forks on isMarketIntelligenceReport BEFORE falling back to the generic extractCompetitorRows path, so MI reports never reach the generic 5-column table", () => {
  const block = pdfButtonSource.slice(
    pdfButtonSource.indexOf('if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {'),
    pdfButtonSource.indexOf('if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {') + 15000
  );
  const miForkIndex = block.indexOf("if (isMarketIntelligenceReport) {");
  const miExtractorIndex = block.indexOf("extractMarketIntelligenceCompetitorRows(\n              content,");
  const genericExtractorIndex = block.indexOf("extractCompetitorRows(content)");

  assert.ok(miForkIndex >= 0, "expected an isMarketIntelligenceReport fork");
  assert.ok(miExtractorIndex > miForkIndex, "MI extractor must be used inside the MI fork");
  assert.ok(genericExtractorIndex > miExtractorIndex, "generic extractor must remain as the non-MI fallback, after the MI branch");
});

// CRITICAL FIX -- root-cause repair (ticket: "Fix the remaining
// canonical-data consistency and PDF export defects"): a 4th, names-only
// fallback tier was added for when Major Players names real vendors that
// don't fit the strict row shape (see
// extractMarketIntelligenceCompetitorNamesOnly's own comment) -- both the
// drawing branch and this height branch now compute `namesOnly`/
// `namesLayout` identically before falling through to the flat
// row-count-based height for the ordinary rows>0 (or no-names) case, so
// the two windows below check for the new namesOnly wiring plus the
// still-present flat-height fallback, rather than requiring them to sit
// immediately adjacent the way they did before this tier existed.
// P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF layout
// hardening, round 2): a 5th tier (sparse structured rows, below
// minCompetitorTableRows) was added alongside the names-only fallback --
// see compactCompetitorState's own comment on drawSectionVisual for the
// full root cause. The height branch must compute from the exact same
// tiers the drawing branch uses, or pagination and drawing disagree.
test("ReportPdfButton.tsx: getVisualHeight's competitor-table branch computes height from the SAME row source AND the SAME names-only/sparse fallbacks the drawing branch will actually use for each report type (isMarketIntelligenceReport gates the row source, both fallback tiers, and the Market Map height addend)", () => {
  const heightBlock = pdfButtonSource.slice(
    pdfButtonSource.lastIndexOf('if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {'),
    // TASK #45 -- widened from 2400: the getVisualHeight return line grew
    // a short explanatory comment when its header-height budget was
    // split between the empty state (8) and the real full-table state
    // (12, to fit the new Vendor Confidence scoping caption).
    pdfButtonSource.lastIndexOf('if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {') + 3000
  );
  assert.match(
    heightBlock,
    /if \(isMarketIntelligenceReport\) \{\s*\n\s*const rows = extractMarketIntelligenceCompetitorRows\(\s*\n\s*section\.content,\s*\n\s*pdfSections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content\s*\n\s*\);/
  );
  assert.match(
    heightBlock,
    /if \(rows\.length === 0\) \{\s*\n\s*const namesOnly = extractMarketIntelligenceCompetitorNamesOnly\(/
  );
  assert.match(
    heightBlock,
    /return getNamesOnlyCompetitorLayout\(namesOnly, bodyWidth, adjacentPlayersOnlyIntro\)\.totalHeight \+ 8 \+ 50;/
  );
  assert.match(
    heightBlock,
    /\} else if \(rows\.length < minCompetitorTableRows\) \{\s*\n\s*return \(\s*\n\s*getNamesOnlyCompetitorLayout\(\s*\n\s*rows\.map\(\(row\) => row\.vendor \|\| "Vendor"\),\s*\n\s*bodyWidth,\s*\n\s*sparseCompetitorTableIntro\s*\n\s*\)\.totalHeight/,
    "the sparse-rows tier must use the same sparseCompetitorTableIntro-based layout"
  );
  // TASK #45 -- the full-table state's header height grew from 8 to 12
  // (both here and in the matching drawing branch) to fit the new
  // "Vendor Confidence... does not verify..." scoping caption; the
  // genuinely-empty state (rows.length === 0, falling through to this
  // same return) still uses the original 8, since it draws no caption
  // or columns at all.
  assert.match(heightBlock, /return \(rows\.length === 0 \? 8 : 12\) \+ Math\.max\(1, rows\.length\) \* 15 \+ 4 \+ 8 \+ 50;/);
  assert.match(heightBlock, /const rows = extractCompetitorRows\(section\.content\);\s*\n\s*if \(rows\.length === 0\) \{\s*\n\s*return 8 \+ 15 \+ 4;\s*\n\s*\}/);
  assert.match(
    heightBlock,
    /if \(rows\.length < minCompetitorTableRows\) \{\s*\n\s*return getNamesOnlyCompetitorLayout\(\s*\n\s*rows\.map\(\(row\) => row\.company \|\| "Company"\),\s*\n\s*bodyWidth,\s*\n\s*sparseCompetitorTableIntro\s*\n\s*\)\.totalHeight;\s*\n\s*\}/
  );
  assert.match(heightBlock, /return 8 \+ rows\.length \* 15 \+ 4;/);
});

test("ReportPdfButton.tsx: the old generic company/positioning-shaped inferMarketMapPosition (the function this fix made unreachable, since the Market Map now always reads MI rows) was removed rather than left as dead code", () => {
  assert.doesNotMatch(pdfButtonSource, /function inferMarketMapPosition\(row: \{ company: string; positioning: string \}\)/);
});

// --- Planner.tsx: downloadPdf forks on isMarketIntelligence -------------

test("Planner.tsx's downloadPdf: the competitor-table drawing branch (drawPdfVisual, field === \"competitiveLandscape\") forks on isMarketIntelligence BEFORE falling back to the generic extractCompetitorRows path", () => {
  const block = plannerSource.slice(
    plannerSource.indexOf('if (section.field === "competitiveLandscape") {\n          const marketMapGap = 8;'),
    // TASK #45 -- widened from 13000: this block grew a new
    // vendorConfidenceScopeCaption constant and its own drawing/height
    // logic (the PDF-carried "Vendor Confidence... does not verify..."
    // scoping caption, mirroring ReportPdfButton.tsx's identical fix).
    plannerSource.indexOf('if (section.field === "competitiveLandscape") {\n          const marketMapGap = 8;') + 14000
  );
  const miForkIndex = block.indexOf("if (isMarketIntelligence) {");
  const miExtractorIndex = block.indexOf("extractMarketIntelligenceCompetitorRows(\n              section.content,");
  const genericExtractorIndex = block.indexOf("extractCompetitorRows(section.content)");

  assert.ok(miForkIndex >= 0, "expected an isMarketIntelligence fork");
  assert.ok(miExtractorIndex > miForkIndex, "MI extractor must be used inside the MI fork");
  assert.ok(genericExtractorIndex > miExtractorIndex, "generic extractor must remain as the non-MI fallback, after the MI branch");
});

// CRITICAL FIX -- root-cause repair (ticket: "Fix the remaining
// canonical-data consistency and PDF export defects"): mirrors
// ReportPdfButton.tsx's own names-only fallback tier fix above.
// P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF layout
// hardening, round 2): mirrors ReportPdfButton.tsx's own updated test --
// a 5th tier (sparse structured rows) was added alongside the names-only
// fallback.
test("Planner.tsx's downloadPdf: getPdfVisualHeight's competitiveLandscape branch computes height from the SAME row source AND the SAME names-only/sparse fallbacks drawPdfVisual will actually use for each report type", () => {
  const heightBlock = plannerSource.slice(
    plannerSource.indexOf('if (section.field === "competitiveLandscape") {\n          // Row source'),
    // TASK #45 -- widened from 2400: the return line grew a short
    // explanatory comment when its header-height budget was split
    // between the empty state (competitorHeaderHeight) and the real
    // full-table state (miCompetitorHeaderHeight, to fit the new
    // Vendor Confidence scoping caption).
    plannerSource.indexOf('if (section.field === "competitiveLandscape") {\n          // Row source') + 3000
  );
  assert.match(
    heightBlock,
    /if \(isMarketIntelligence\) \{\s*\n\s*const rows = extractMarketIntelligenceCompetitorRows\(\s*\n\s*section\.content,\s*\n\s*pdfSections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content\s*\n\s*\);/
  );
  assert.match(
    heightBlock,
    /if \(rows\.length === 0\) \{\s*\n\s*const namesOnly = extractMarketIntelligenceCompetitorNamesOnly\(/
  );
  assert.match(
    heightBlock,
    /return getNamesOnlyCompetitorLayout\(namesOnly, bodyWidth, adjacentPlayersOnlyIntro\)\.totalHeight \+ 8 \+ 50;/
  );
  assert.match(
    heightBlock,
    /\} else if \(rows\.length < minCompetitorTableRows\) \{\s*\n\s*return \(\s*\n\s*getNamesOnlyCompetitorLayout\(\s*\n\s*rows\.map\(\(row\) => row\.vendor \|\| "Vendor"\),\s*\n\s*bodyWidth,\s*\n\s*sparseCompetitorTableIntro\s*\n\s*\)\.totalHeight/,
    "the sparse-rows tier must use the same sparseCompetitorTableIntro-based layout"
  );
  // TASK #45 -- the full-table state's header height grew from
  // competitorHeaderHeight(8) to miCompetitorHeaderHeight(12) to fit
  // the new "Vendor Confidence... does not verify..." scoping caption;
  // the genuinely-empty state (rows.length === 0, falling through to
  // this same return) still uses the original competitorHeaderHeight,
  // since it draws no caption or columns at all.
  assert.match(heightBlock, /return \(rows\.length === 0 \? competitorHeaderHeight : miCompetitorHeaderHeight\) \+ Math\.max\(1, rows\.length\) \* competitorRowHeight \+ 4 \+ 8 \+ 50;/);
  assert.match(heightBlock, /const rows = extractCompetitorRows\(section\.content\);\s*\n\s*if \(rows\.length === 0\) \{\s*\n\s*return competitorHeaderHeight \+ competitorRowHeight \+ 4;\s*\n\s*\}/);
  assert.match(
    heightBlock,
    /if \(rows\.length < minCompetitorTableRows\) \{\s*\n\s*return getNamesOnlyCompetitorLayout\(\s*\n\s*rows\.map\(\(row\) => row\.company \|\| "Company"\),\s*\n\s*bodyWidth,\s*\n\s*sparseCompetitorTableIntro\s*\n\s*\)\.totalHeight;\s*\n\s*\}/
  );
  assert.match(heightBlock, /return competitorHeaderHeight \+ rows\.length \* competitorRowHeight \+ 4;/);
});

test("Planner.tsx: the old generic company/positioning-shaped inferPdfMarketMapPosition (the function this fix made unreachable) was removed rather than left as dead code", () => {
  assert.doesNotMatch(plannerSource, /function inferPdfMarketMapPosition\(row: \{ company: string; positioning: string \}\)/);
});

// --- Non-MI reports: generic table completely unchanged -----------------

test("both PDF paths preserve the exact original 5-column generic table (Company/Positioning/Strengths/Weaknesses/Threat) and no Market Map for non-MI reports -- this fix only adds a new MI-only branch, it never modifies Business Plan/Acquisition's existing presentation", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(
      source,
      /Positioning", pdfLocale\), width: (?:body|visual)Width \* 0\.27 \},\s*\n\s*\{ label: localizePdfPresentationLabel\("Strengths", pdfLocale\), width: (?:body|visual)Width \* 0\.2 \},\s*\n\s*\{ label: localizePdfPresentationLabel\("Weaknesses", pdfLocale\), width: (?:body|visual)Width \* 0\.2 \},\s*\n\s*\{ label: localizePdfPresentationLabel\("Threat", pdfLocale\), width: (?:body|visual)Width \* 0\.14 \},/
    );
  }
});

// --- Drift check: AI generation/prompts/schema/business logic untouched -

test("AI generation, prompts, report schema, calculations, and business logic are untouched -- this pass only forked PDF presentation drawing logic (drift check)", () => {
  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketGraphSource,
    /\| Vendor \| Parent Company \| Category \| Segment \| AI Capability \| Key Use Cases \| Pricing Model \| Strengths \| Weaknesses \| Validation Count \| Confidence \| Market Relevance \|/
  );

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);
});
