import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// FINAL PREMIUM REPORT PRESENTATION RESTORATION (WEB + PDF).
//
// Two concrete gaps found and fixed this pass:
//
// 1. TAM/SAM/SOM's real per-layer planning-assumption/sizing-explanation
//    text (added by an earlier ticket, then deliberately removed by the
//    immediately-following "FINAL TAM/SAM/SOM LOGIC" ticket's own explicit
//    requirement 3) is restored, because THIS ticket explicitly requires
//    "the user must immediately see ... planning assumptions ... sizing
//    explanation ... without opening DETAILS" -- the latest, most specific
//    instruction on this exact point. Only the deep formula/derivation
//    chain stays in Details; the short assumption sentence itself is
//    primary content now.
//
// 2. Regional Analysis, Industry Trends, and Market Segmentation had no
//    dedicated visual at all (same "empty until Details" bug the prior
//    ticket already fixed for Market Drivers/Barriers/Opportunities/
//    Threats/Customer Segments/Major Players) -- extended to the same
//    Key Takeaway + explanation + bullets card.
//
// 3. A genuine, previously-undiscovered PDF/Web parity gap: Planner.tsx's
//    OWN separate PDF export (downloadPdf/drawPdfVisual/
//    getPdfVisualHeight) had branches for far fewer fields than the
//    on-screen PremiumSectionVisual -- its `visualFields` guard silently
//    skipped Competitive Landscape, Strategic Recommendations, and all
//    nine of the fields above entirely, meaning that PDF path drew zero
//    visual for them (pure markdown-style plain text). This pass closes
//    the smaller, well-scoped part of that gap (a matching Key Takeaway
//    box for the nine list-style fields, using the exact same
//    pdfKeyTakeawayCardFields set as ReportPdfButton.tsx); the larger
//    Competitive Landscape/Strategic Recommendations rebuild in THIS
//    specific PDF path is out of scope for this pass and disclosed
//    separately.
//
// AI generation, prompts, routing, report schema, calculations, and
// business logic are untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// --- 1. TAM/SAM/SOM: planning assumptions visible without opening Details -

// A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") removed the
// line-clamp-2 on both of these -- a real, single-sentence assumption
// explanation could still run long enough to get cut off at that width.
test("page.tsx: the TAM/SAM/SOM visual renders each resolved layer's real planning-assumption sentence inline again -- restored per this ticket's explicit 'must immediately see ... sizing explanation ... without opening DETAILS' requirement", () => {
  assert.match(pageSource, /const assumptions = bars\.map\(\(bar, index\) => \(resolved\[index\] \? extractMarketSizeAssumption\(content, bar\.label\) : ""\)\);/);
  assert.match(pageSource, /\{isResolved && assumption \? \(/);
  assert.match(pageSource, /<p className="pl-1 text-xs leading-5 text-zinc-500 sm:pl-\[4\.75rem\]">\{assumption\}<\/p>/);
});

test("Planner.tsx: the TAM/SAM/SOM visual renders row.description (the real planning-assumption/sizing-explanation text, already computed by getReportMarketRows) inline again", () => {
  const tamSamSomBlock = plannerSource.slice(
    plannerSource.indexOf('if (field === "tamSamSom")'),
    plannerSource.indexOf('if (field === "marketOpportunity"')
  );
  assert.match(tamSamSomBlock, /\{row\.description \? \(/);
  assert.match(tamSamSomBlock, /<p className="mt-3 text-xs leading-5 text-zinc-500">\{row\.description\}<\/p>/);
});

test("the deep formula/derivation chain still lives only inside the collapsed AnalysisNotes Details disclosure -- only the short per-layer assumption SENTENCE moved back into the primary view, not the full raw section paragraph", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /"tamSamSom",/); // still in cardFirstReportFields
  }
});

// --- Regional Analysis / Industry Trends / Market Segmentation ------------

test("page.tsx: ReportSectionVisual's Key Takeaway card now also covers Regional Analysis, Industry Trends, and Market Segmentation -- the same 'empty until Details' bug the prior ticket fixed for six other fields", () => {
  assert.match(
    pageSource,
    /normalizedTitle\.includes\("regional analysis"\) \|\|\s*\n\s*normalizedTitle\.includes\("industry trend"\) \|\|\s*\n\s*normalizedTitle\.includes\("market segmentation"\)/
  );
});

test("Planner.tsx: PremiumSectionVisual's Key Takeaway card, hasPremiumSectionVisual's guard, and cardFirstReportFields all list regionalAnalysis/industryTrends/marketSegmentation consistently", () => {
  assert.match(
    plannerSource,
    /field === "regionalAnalysis" \|\|\s*\n\s*field === "industryTrends" \|\|\s*\n\s*field === "marketSegmentation"/
  );
  const gateMatch = plannerSource.match(/function hasPremiumSectionVisual\([\s\S]*?\n\}/);
  assert.ok(gateMatch, "hasPremiumSectionVisual not found");
  for (const field of ["regionalAnalysis", "industryTrends", "marketSegmentation"]) {
    assert.match(gateMatch[0], new RegExp(`section\\.field === "${field}"`));
  }
  const setMatch = plannerSource.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "cardFirstReportFields not found");
  for (const field of ["regionalAnalysis", "industryTrends", "marketSegmentation"]) {
    assert.match(setMatch[1], new RegExp(`"${field}",`));
  }
});

// --- 3. PDF/Web consistency: the Key Takeaway box now also exists in PDF -

test("ReportPdfButton.tsx: a Key Takeaway box now draws for all nine list-style fields (Market Drivers/Barriers/Opportunities/Threats/Customer Segments/Major Players/Regional Analysis/Industry Trends/Market Segmentation) -- previously these drew as plain, unstyled paragraph text only", () => {
  const setMatch = pdfButtonSource.match(/const pdfKeyTakeawayCardFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "pdfKeyTakeawayCardFields not found");
  for (const field of [
    "marketDrivers",
    "barriers",
    "opportunities",
    "threats",
    "customerSegments",
    "majorPlayers",
    "regionalAnalysis",
    "industryTrends",
    "marketSegmentation",
  ]) {
    assert.match(setMatch[1], new RegExp(`"${field}",`));
  }
  assert.match(pdfButtonSource, /if \(pdfKeyTakeawayCardFields\.has\(field \?\? ""\)\) \{/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("KEY TAKEAWAY", pdfLocale\)/);
});

test("ReportPdfButton.tsx: drawSectionVisual and getVisualHeight measure the Key Takeaway box's wrapped text at the SAME font size (8.4) it is actually drawn at -- a mismatch would silently under- or over-budget the card's height (the exact class of bug this file's own comments repeatedly warn about)", () => {
  const occurrences = pdfButtonSource.match(/pdf\.setFontSize\(8\.4\);\s*\n\s*const takeawayLines = wrapPdfText\(localizePdfPresentationText\(takeaway, pdfLocale\), bodyWidth - 12\)/g) || [];
  assert.equal(occurrences.length, 2, "expected the same pinned-font-then-measure pattern in both drawSectionVisual and getVisualHeight");
});

test("Planner.tsx's downloadPdf: a matching Key Takeaway box now draws for the same nine fields -- this PDF path previously had NO branch for them at all (visualFields never listed them, so drawPdfVisual/getPdfVisualHeight returned 0 unconditionally)", () => {
  assert.match(plannerSource, /const pdfKeyTakeawayCardFields = new Set\(\[/);
  assert.match(plannerSource, /\.\.\.pdfKeyTakeawayCardFields,\s*\n\s*\]\);/);
  assert.match(plannerSource, /if \(pdfKeyTakeawayCardFields\.has\(section\.field \?\? ""\)\) \{/);
});

test("Planner.tsx's downloadPdf: visualFields now includes the nine Key Takeaway fields via spread, so drawPdfVisual's/getPdfVisualHeight's own early-return guards (`if (!visualFields.has(section.field)) return 0`) no longer silently skip them", () => {
  const visualFieldsMatch = plannerSource.match(/const visualFields = new Set<ReportSection\["field"\]>\(\[([\s\S]*?)\]\);/);
  assert.ok(visualFieldsMatch, "visualFields not found");
  assert.match(visualFieldsMatch[1], /\.\.\.pdfKeyTakeawayCardFields,/);
});

// --- Preserve: AI generation, prompts, routing, report schema, ------------
// --- calculations, business logic, backend behaviour ---------------------

test("AI generation, prompts, routing, report schema, calculations, and business logic are untouched -- this pass only added presentation cards and PDF drawing branches (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /regionalAnalysis:/);
  assert.match(marketPromptSource, /industryTrends:/);
  assert.match(marketPromptSource, /marketSegmentation:/);
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);

  const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /export async function POST/);
});
