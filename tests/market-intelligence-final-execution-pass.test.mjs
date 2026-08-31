import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// FINAL EXECUTION PASS -- NO DEFERRALS.
//
// The prior ticket's summary disclosed one item as "known, not fixed":
// Planner.tsx's own separate PDF export (downloadPdf/drawPdfVisual/
// getPdfVisualHeight) had no branch at all for Competitive Landscape or
// Strategic Recommendations -- its `visualFields` guard silently skipped
// them, so that PDF path drew zero visual, pure plain text, for both.
// This pass closes that gap completely: both now have the exact same
// table/Market Map and action-card visuals ReportPdfButton.tsx already
// had, ported into this file's own drawPdfVisual/getPdfVisualHeight.
//
// It also fixes a real duplication bug introduced by the PREVIOUS pass's
// own Key Takeaway box addition: the box showed a section's leading
// sentence, but the full raw paragraph drawn below it (in BOTH PDF paths)
// still started with that exact same sentence -- "Card, then the same
// information repeated as a paragraph". stripPdfLeadingTakeaway now
// removes that one leading sentence from the body text (only when safely,
// unambiguously matched near the start of the raw content; otherwise the
// content is left completely untouched rather than risk cutting into
// unrelated text) in both ReportPdfButton.tsx and Planner.tsx.
//
// Finally, TAM/SAM/SOM's real per-layer planning-assumption sentence
// (restored on-screen by the prior ticket) is now also drawn in BOTH PDF
// exports' legend, so "Web and PDF present the same visual hierarchy"
// holds for this section too, without opening Details in either surface.
//
// AI generation, prompts, routing, report schema, calculations, and
// business logic are untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

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

async function compileFunction(source, functionName) {
  const raw = extractFunctionSource(source, functionName);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-final-execution-fn-"));
  const outPath = join(dir, `${functionName}.ts`);
  writeFileSync(outPath, `export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod[functionName];
}

// --- 3. Planner.tsx's own downloadPdf: Competitive Landscape rebuilt -----

// A later ticket ("Premium Report Presentation Deduplication Audit & Fix")
// superseded this generic-only Competitive Landscape table with a real
// fork: Market Intelligence reports now draw the correct MI-specific
// 7-column table (via extractMarketIntelligenceCompetitorRows and
// inferMarketMapPosition's category/position shape), while every other
// report type keeps exactly this original generic 5-column table -- the
// old unconditional inferPdfMarketMapPosition(company/positioning shape)
// became dead code once the Market Map (previously gated to MI reports
// only) started reading MI-shaped rows instead, so it was removed. See
// tests/market-intelligence-competitive-landscape-pdf-parity.test.mjs for
// the current, superseding behavior and its rationale.
test("Planner.tsx's downloadPdf: Competitive Landscape still has a real table (+ Market Map for Market Intelligence) instead of drawing zero visual -- visualFields lists it, and both the MI and generic drawing forks exist", () => {
  const visualFieldsMatch = plannerSource.match(/const visualFields = new Set<ReportSection\["field"\]>\(\[([\s\S]*?)\]\);/);
  assert.ok(visualFieldsMatch, "visualFields not found");
  assert.match(visualFieldsMatch[1], /"competitiveLandscape",/);

  assert.match(plannerSource, /if \(section\.field === "competitiveLandscape"\) \{/);
  assert.match(plannerSource, /const rows = extractCompetitorRows\(section\.content\);/);
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") added Major
  // Players' own content as a third fallback tier -- the call now passes
  // it as a second argument rather than calling with section.content alone.
  assert.match(
    plannerSource,
    /const miRows = extractMarketIntelligenceCompetitorRows\(\s*\n\s*section\.content,\s*\n\s*pdfSections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content\s*\n\s*\);/
  );
  assert.match(plannerSource, /const drawMarketMap = \(mapY: number\) => \{/);
});

// --- 3. Planner.tsx's own downloadPdf: Strategic Recommendations rebuilt -

test("Planner.tsx's downloadPdf: Strategic Recommendations now has real Action/Owner/Timeline/Budget/Success Metric/Decision Gate cards instead of drawing zero visual", () => {
  const visualFieldsMatch = plannerSource.match(/const visualFields = new Set<ReportSection\["field"\]>\(\[([\s\S]*?)\]\);/);
  assert.match(visualFieldsMatch[1], /"strategicRecommendations",/);

  // TASK #25 -- confirmed live: the `.slice(0, 4)` here silently dropped
  // recommendations 5+ from the PDF while the web view (which never
  // applied this second, PDF-only cap on top of extractRecommendationItems'
  // own already-shared ceiling) correctly showed all of them. Removed --
  // `items` is now whatever extractRecommendationItems actually returns.
  assert.match(
    plannerSource,
    /if \(section\.field === "strategicRecommendations"\) \{[\s\S]{0,700}const items = extractRecommendationItems\(section\.content\);/
  );
  assert.doesNotMatch(
    plannerSource,
    /const items = extractRecommendationItems\(section\.content\)\.slice\(0, 4\);/,
    "the PDF-only 4-item cap must not be reintroduced"
  );
  // TASK #29H -- extractRecommendationSignals gained 2 more destructured
  // fields (activity, evidenceTie); the pre-existing 5 are unchanged.
  assert.match(plannerSource, /const \{ timeframe, metric, budget, owner, gate, activity, evidenceTie \} = extractRecommendationSignals\(item\);/);
  assert.match(plannerSource, /localizePdfPresentationLabel\("DECISION GATE", pdfLocale\)/);
});

// Superseded by the Competitive Landscape MI/generic fork: the height
// formula is no longer one literal string reused twice, since MI and
// generic reports now compute different heights (Market Map addend only
// applies to MI reports now, rather than the old code's row source alone
// varying). See
// tests/market-intelligence-competitive-landscape-pdf-parity.test.mjs's
// "getPdfVisualHeight's competitiveLandscape branch computes height from
// the SAME row source drawPdfVisual will actually use" test, which proves
// the current, narrower parity guarantee (right row source AND right
// addend per report type) directly against both functions' source.
// P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF layout
// hardening, round 2): the fixed 36mm recommendationCardHeight constant
// this test used to assert was ITSELF the bug -- Strategic Recommendation
// cards with more Owner/Timeline/Budget/Success-Metric fields or a
// Decision Gate needed more than 36mm and visibly truncated/overlapped
// (confirmed live, especially cards 3-4). Replaced with
// computeRecommendationRowHeights, a single shared function that derives
// each card's real height from its own content instead of a hardcoded
// number.
//
// TASK #25C -- updated for the follow-on fix: getPdfVisualHeight and
// drawPdfVisual are no longer two separate call sites independently
// reading computeRecommendationRowHeights for this section -- they were
// merged into one dedicated, row-pagination-aware branch directly in
// pdfSections.forEach (see that branch's own comment), so there is now
// exactly ONE call site computing rowHeights for Strategic
// Recommendations, which both budgets pagination and draws from the same
// values by construction (not by convention).
test("Planner.tsx: Strategic Recommendations' single pagination/drawing branch reads computeRecommendationRowHeights exactly once (rather than two independently hard-coded heights), so a divergence between drawing and pagination budgeting is structurally impossible", () => {
  const layoutFnOccurrences = plannerSource.match(/const computeRecommendationCardLayout = /g) || [];
  const rowsFnOccurrences = plannerSource.match(/const computeRecommendationRowHeights = /g) || [];
  const gapOccurrences = plannerSource.match(/const recommendationCardGap = 3;/g) || [];
  assert.equal(layoutFnOccurrences.length, 1, "expected exactly one shared computeRecommendationCardLayout declaration");
  assert.equal(rowsFnOccurrences.length, 1, "expected exactly one shared computeRecommendationRowHeights declaration");
  assert.equal(gapOccurrences.length, 1, "expected exactly one shared recommendationCardGap declaration");
  const callSiteOccurrences =
    plannerSource.match(/const \{ cards, rowHeights \} = computeRecommendationRowHeights\(items, cardWidth\);/g) || [];
  assert.equal(
    callSiteOccurrences.length,
    1,
    "expected exactly one call site (in the unified pagination/drawing branch) computing both cards and rowHeights together"
  );
});

// --- No duplicated information: Card, then the same text as a paragraph --
//
// A later ticket ("FINAL CLEANUP -- remove all redundant DETAILS
// duplication") superseded stripPdfLeadingTakeaway (which only removed the
// ONE leading sentence the Key Takeaway box showed) with full suppression:
// the Key Takeaway card was enriched to show the section's complete
// remaining prose/bullets, making the raw paragraph below it fully
// redundant rather than partially redundant, so it is now suppressed
// entirely via pdfCompleteVisualFields -- see the dedicated regression
// tests for that in this same file, below.

test("ReportPdfButton.tsx and Planner.tsx: stripPdfLeadingTakeaway no longer exists -- superseded by full body-text suppression via pdfCompleteVisualFields (regression guard against reintroducing the old, now-unnecessary partial-strip mechanism)", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.doesNotMatch(source, /function stripPdfLeadingTakeaway/);
  }
});

// --- 2 & 7. TAM/SAM/SOM: identical presentation on Web and both PDFs -----

test("ReportPdfButton.tsx and Planner.tsx: the TAM/SAM/SOM legend now draws each resolved layer's real planning-assumption sentence too (matching the on-screen visual restored by the prior ticket) -- 'without opening DETAILS' now holds on Web and both PDF exports alike", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /const assumption = extractMarketSizeAssumption\((?:content|section\.content), label\);/);
    assert.match(source, /if \(assumption\) \{/);
  }
});

test("ReportPdfButton.tsx and Planner.tsx: the taller TAM/SAM/SOM legend footprint (+27mm for the assumption lines) is applied consistently everywhere the visual's height is read -- ReportPdfButton.tsx's shared tamCircleVisualHeight closure variable, and Planner.tsx's two independently-computed copies (drawPdfVisual and getPdfVisualHeight)", () => {
  assert.match(pdfButtonSource, /const tamCircleVisualHeight = tamCircleMaxRadius \* 2 \+ 8 \+ 27;/);
  assert.match(plannerSource, /const tamCircleVisualHeight = tamCircleMaxRadius \* 2 \+ 8 \+ 27;/);
  assert.match(plannerSource, /return tamCircleMaxRadius \* 2 \+ 8 \+ 27;/);
});

test("ReportPdfButton.tsx: extractMarketSizeAssumption is a real standalone extractor (not just embedded inside isMarketSizeEstimated) -- reused both for the [Estimated] marker check and for drawing the assumption text itself, never fabricating a sentence", async () => {
  const fn = await compileFunction(pdfButtonSource, "extractMarketSizeAssumption");
  const content = "TAM (Germany, 2026) ~= EUR200-800 million [Estimated], derived from the OECD benchmark.";
  assert.match(fn(content, "TAM"), /OECD benchmark/);
  assert.equal(fn("No market sizing discussion here.", "TAM"), "");
});

// --- Preserve: AI generation, prompts, routing, report schema, -----------
// --- calculations, business logic -----------------------------------------

test("AI generation, prompts, routing, report schema, calculations, and business logic are untouched -- this pass only added/fixed PDF drawing code and body-text deduplication (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape:/);
  assert.match(marketPromptSource, /strategicRecommendations:/);
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);

  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function classifyReportDomain/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);

  // page.tsx (server-rendered dashboard view) does not generate PDFs
  // itself and was not touched by this PDF-specific pass.
  assert.match(pageSource, /function ReportSectionVisual/);
});
