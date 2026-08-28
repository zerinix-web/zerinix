import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractSectionMainExplanation,
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";

// TASK #10 -- Market Intelligence final presentation cleanup pass. Five
// distinct production defects, all presentation/content-integrity only --
// no evidence-validation threshold, confidence rule, or fallback value was
// loosened, forced, or fabricated by any of the fixes this file guards.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(`${repoRoot}app/dashboard/[id]/page.tsx`, "utf8");
const pdfSource = readFileSync(`${repoRoot}app/dashboard/[id]/ReportPdfButton.tsx`, "utf8");
const plannerSource = readFileSync(`${repoRoot}components/Planner.tsx`, "utf8");

// ---------------------------------------------------------------------------
// 1. Key Takeaway / body duplicate suppression -- the residual gap was in
// extractSectionMainExplanation (page.tsx/Planner.tsx's "explanation"
// paragraph, not the already-fixed bullets/PDF body path): it joined every
// non-bulleted LINE with a space BEFORE sentence-splitting, so a bare Turkish
// label line with no terminal punctuation ("Segmentasyon (kanıt destekli):")
// could get fused with unrelated later prose instead of being recognized as
// its own, already-shown takeaway sentence -- moved to report-presentation.ts
// and rewritten to split per LINE first, mirroring splitSentences' own fix.
// ---------------------------------------------------------------------------

test("DUP-T10-1: the exact reported Turkish label-line shape ('Segmentasyon (kanıt destekli):' followed by a bulleted list) is no longer duplicated -- the takeaway captures the label, and neither the bullets nor the explanation repeat it", () => {
  const content = [
    "Segmentasyon (kanıt destekli):",
    "- Kurumsal segment: büyük ölçekli şirketler için özel çözümler.",
    "- KOBİ segmenti: uygun maliyetli paketler talep ediyor.",
    "- Girişim segmenti: hızlı kurulum arıyor.",
  ].join("\n");

  const takeaway = getSectionTakeaway(content);
  assert.equal(takeaway, "Segmentasyon (kanıt destekli):");

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.doesNotMatch(stripped, /Segmentasyon \(kanıt destekli\)/);
  assert.match(stripped, /Kurumsal segment/);

  const explanation = extractSectionMainExplanation(content, takeaway);
  assert.doesNotMatch(explanation, /Segmentasyon \(kanıt destekli\)/);
});

test("DUP-T10-2: a bare label line followed by real prose (not bullets) no longer gets fused with that prose in extractSectionMainExplanation, so the label is correctly excluded without swallowing real content", () => {
  const content =
    "Bu pazar için materyal eğilimler:\n" +
    "Bulut tabanlı dağıtım artık standart hale geldi. Fiyatlandırma modelleri kullanım bazlı hale kayıyor. Entegrasyon ortaklıkları rekabet avantajı sağlıyor.";

  const takeaway = getSectionTakeaway(content);
  const explanation = extractSectionMainExplanation(content, takeaway);

  assert.doesNotMatch(explanation, /Bu pazar için materyal eğilimler/);
  assert.match(explanation, /Fiyatlandırma modelleri/);
  assert.match(explanation, /Entegrasyon ortaklıkları/);
});

test("DUP-T10-3 (no regression): extractSectionMainExplanation still returns every remaining sentence, uncapped, for ordinary English multi-sentence prose", () => {
  const content =
    "Enterprise buyers are consolidating vendor relationships. Mid-market adoption lags due to integration cost. A handful of regional players are closing the gap.";
  const takeaway = getSectionTakeaway(content);
  const explanation = extractSectionMainExplanation(content, takeaway);

  assert.match(explanation, /Mid-market adoption lags/);
  assert.match(explanation, /A handful of regional players/);
});

test("DUP-T10-4: source drift check -- extractSectionMainExplanation lives exactly once, in app/lib/report-presentation.ts, imported (not redefined) by both page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(source, /function extractSectionMainExplanation\(/);
  }
});

// ---------------------------------------------------------------------------
// 2. Turkish report fallback-language consistency -- the TAM sizing-gap
// explanation (buildPlanningEstimate) was raw hardcoded English regardless
// of report language. Localized through the SAME marketGraphCopy mechanism
// every other fixed fallback string in this file already uses; the actual
// evidence-availability determination and every threshold are untouched --
// only the language of the explanation SENTENCE changed.
// ---------------------------------------------------------------------------

test("LANG-T10-1: the exact reported production defect -- a Turkish-language Market Intelligence report's TAM-unavailable explanation is now in Turkish, never the raw English fallback sentence", () => {
  const graph = buildMarketIntelligenceGraph(
    { evidence: [] },
    "Analyze the market for enterprise widgets in Germany",
    "Turkish"
  );

  assert.equal(graph.sizingGap?.missingIngredient, "everything");
  assert.doesNotMatch(
    graph.sizingGap.explanation,
    /A monetary TAM is therefore withheld/,
    "must never show the raw English fallback sentence in a Turkish report"
  );
  assert.match(graph.sizingGap.explanation, /parasal bir TAM belirtilmemektedir/);
});

test("LANG-T10-2 (no regression): the identical zero-evidence scenario in English still produces the original, byte-identical English explanation", () => {
  const graph = buildMarketIntelligenceGraph(
    { evidence: [] },
    "Analyze the market for enterprise widgets in Germany",
    "English"
  );

  assert.equal(
    graph.sizingGap.explanation,
    "ZERINIX searched for a direct market-size figure, an addressable buyer population, and comparable adjacent-market benchmarks for this exact request, but found no verifiable numeric evidence for any of them. A monetary TAM is therefore withheld until at least one of these evidence types becomes available."
  );
});

test("LANG-T10-3 (no evidence-standard weakening, regression guard): the language parameter changes ONLY the explanation's wording -- missingIngredient, attemptedTopDown/BottomUp/AdjacentProxy, and partialQuantity are identical across English and Turkish for the same zero-evidence input", () => {
  const english = buildMarketIntelligenceGraph({ evidence: [] }, "Analyze widgets", "English").sizingGap;
  const turkish = buildMarketIntelligenceGraph({ evidence: [] }, "Analyze widgets", "Turkish").sizingGap;

  assert.equal(english.missingIngredient, turkish.missingIngredient);
  assert.equal(english.attemptedTopDown, turkish.attemptedTopDown);
  assert.equal(english.attemptedBottomUp, turkish.attemptedBottomUp);
  assert.equal(english.attemptedAdjacentProxy, turkish.attemptedAdjacentProxy);
  assert.deepEqual(english.partialQuantity, turkish.partialQuantity);
});

test("LANG-T10-4: source drift check -- the 4 TAM gap explanation branches read from marketGraphCopy (tamGapPricingMissingTemplate/tamGapBuyerPopulationMissing/tamGapTopDownFigureMissing/tamGapEverythingMissing) instead of raw hardcoded English strings, and all 5 supported languages have real translations for each", () => {
  const graphSource = readFileSync(`${repoRoot}app/lib/ai/market-intelligence-graph.ts`, "utf8");

  assert.match(graphSource, /const gapCopy = marketGraphCopy\[copyLanguage\(language\)\];/);
  assert.match(graphSource, /gapCopy\.tamGapPricingMissingTemplate/);
  assert.match(graphSource, /gapCopy\.tamGapBuyerPopulationMissing/);
  assert.match(graphSource, /gapCopy\.tamGapTopDownFigureMissing/);
  assert.match(graphSource, /gapCopy\.tamGapEverythingMissing/);

  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    const graph = buildMarketIntelligenceGraph({ evidence: [] }, "Analyze widgets", language);
    assert.ok(
      graph.sizingGap.explanation && graph.sizingGap.explanation.length > 40,
      `${language} must have a real, non-empty translated explanation`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Long cover-card text truncation (Main Risk / Next Action) --
// ReportPdfButton.tsx's cover KPI grid still hard-capped wrapped value text
// at 2 lines even after widening conciseCoverText's own pre-wrap budget,
// which is only enough text to fill ~1 line at this card's actual width.
// Planner.tsx's equivalent card silently dropped overflow with no ellipsis
// at all (a blunter version of the same "never silently hide text" defect).
// ---------------------------------------------------------------------------

test("TRUNC-T10-1: ReportPdfButton.tsx's cover KPI grid value cells now allow up to 5 wrapped lines (not 2) before truncatePdfCellLines' own graceful ellipsis kicks in, matching conciseCoverText's own worst-case wrap count at this card's width", () => {
  assert.match(
    pdfSource,
    /wrapPdfText\(conciseCoverText\(value\), cardWidth - 8\),\s*\n\s*5\s*\n\s*\);/
  );
});

test("TRUNC-T10-2 (no regression): the cover KPI grid's card height formula still scales with however many value lines actually render, so a taller (up to 5-line) card is never clipped by its own container", () => {
  assert.match(pdfSource, /const height = Math\.max\(18, 7 \+ labelLines\.length \* 3\.1 \+ valueLines\.length \* 4\.2\);/);
});

test("TRUNC-T10-3: Planner.tsx's cover metric cards no longer silently drop wrapped text beyond 2 lines with zero visual indication -- an explicit '...' ellipsis is now appended, matching every other truncation point in this file", () => {
  const idx = plannerSource.indexOf("const rawValueLines = pdf.splitTextToSize(value, metricCardWidth - 10)");
  assert.notEqual(idx, -1, "the new rawValueLines computation must exist");
  const window_ = plannerSource.slice(idx, idx + 500);

  assert.match(window_, /const valueLines = rawValueLines\.slice\(0, 2\);/);
  assert.match(
    window_,
    /valueLines\[valueLines\.length - 1\] = `\$\{valueLines\[valueLines\.length - 1\]\.replace\(\/\[\.,;:\]\*\$\/, ""\)\}\.\.\.`;/
  );
});

// ---------------------------------------------------------------------------
// 4. Long Strategic Recommendation cards (actions 3 and 4 specifically) --
// both PDF exports used one FIXED 36mm card height regardless of actual
// action-text/field/gate content. Row 2 (cards 3-4) had nothing drawn after
// it to visually mask its own overflow the way row 1 (cards 1-2) did,
// exposing the truncation/overlap only on cards 3-4 in production.
// ---------------------------------------------------------------------------

test("REC-T10-1: both PDF exports replaced the fixed recommendationCardHeight constant with a shared computeRecommendationCardLayout/computeRecommendationRowHeights pair that derives each card's real height from its own action-text line count, field-row count, and Decision Gate presence", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.doesNotMatch(source, /const recommendationCardHeight = 36;/);
    assert.match(source, /const computeRecommendationCardLayout = /);
    assert.match(source, /const computeRecommendationRowHeights = /);
  }
});

test("REC-T10-2: both PDF exports' drawing and pagination-budgeting code paths for Strategic Recommendations call the SAME computeRecommendationRowHeights function (structurally impossible for the two to disagree, unlike the old constant which was merely conventionally kept in sync)", () => {
  for (const source of [pdfSource, plannerSource]) {
    const occurrences = source.match(/computeRecommendationRowHeights\(items, cardWidth\)/g) || [];
    assert.equal(occurrences.length, 2, "expected exactly 2 call sites: drawing and pagination budgeting");
  }
});

test("REC-T10-3 (no regression): a card's height is never less than the original 36mm minimum, and Decision Gate presence still reserves real space at the bottom of the card rather than being silently dropped", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /const recommendationCardMinHeight = 36;/);
    assert.match(source, /const gateReservedHeight = gate \? 9 : 0;/);
  }
});

// ---------------------------------------------------------------------------
// 5. Evidence-insufficient Competitive Landscape rendering -- a sparse
// structured table (1-2 validated rows, below a reasonable minimum) fell
// straight into the full multi-column table branch, rendering a
// mostly-empty spacious grid that read as broken. Named competitors are
// never hidden (Task #9's principle) -- shown compactly instead, with an
// honest explanation that structured comparison DATA (not competitor
// identity) is what's insufficient. Applied consistently to both the
// Market-Intelligence-specific and generic (Business Plan/Acquisition)
// competitor tables, in both PDF exports.
// ---------------------------------------------------------------------------

test("COMPLAND-T10-1: both PDF exports now gate the full competitor table on a real minimum row count (minCompetitorTableRows = 3), not a bare 'greater than zero' check", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /const minCompetitorTableRows = 3;/);
  }
});

test("COMPLAND-T10-2: a sparse Market-Intelligence competitor table (1-2 real rows) renders the compact 'LIMITED STRUCTURED COMPARISON DATA' card (reusing named vendors, never hiding them) instead of a mostly-empty 7-column grid, in both PDF exports", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /COMPETITORS IDENTIFIED — LIMITED STRUCTURED COMPARISON DATA/);
    assert.match(
      source,
      /miRows\.length > 0 && miRows\.length < minCompetitorTableRows/,
      "the sparse-rows branch must fire only below the minimum, never for a genuinely full table"
    );
    assert.match(
      source,
      /getNamesOnlyCompetitorLayout\(\s*\n\s*miRows\.map\(\(row\) => row\.vendor \|\| "Vendor"\),/,
      "the sparse card must surface the real validated vendor names, never hide them"
    );
  }
});

test("COMPLAND-T10-3: the generic (Business Plan/Acquisition) competitor table has the identical sparse-row compact state, and its self-referential 'see the Competitive Landscape section' placeholder (a residual copy-paste bug distinct from this ticket, found while fixing this) is gone", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.doesNotMatch(source, /See the Competitive Landscape section for full competitor detail\./);
    assert.match(
      source,
      /rows\.length < minCompetitorTableRows\) \{\s*\n\s*const sparseLayout = getNamesOnlyCompetitorLayout\(\s*\n\s*rows\.map\(\(row\) => row\.company \|\| "Company"\),/
    );
  }
});

test("COMPLAND-T10-4 (no evidence-standard weakening, regression guard): a genuinely empty competitor table (0 rows, no adjacent names either) still shows the flat 'no competitor data' message -- the sparse-row fix must not paper over a real absence of evidence", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /No competitor data could be validated for this market yet\./);
  }
});

test("COMPLAND-T10-5: the sparse-table intro text and the adjacent-players-only intro text both frame the gap as unvalidated DETAILED COMPARISON, not unvalidated competitor identity (TASK #15: the old adjacent-players wording cast doubt on identity itself, contradicting Major Players' own more confident language for the same evidence-supported vendors)", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /const adjacentPlayersOnlyIntro =/);
    assert.match(source, /const sparseCompetitorTableIntro =/);

    const adjacentIdx = source.indexOf("const adjacentPlayersOnlyIntro =");
    const sparseIdx = source.indexOf("const sparseCompetitorTableIntro =");
    const adjacentText = source.slice(adjacentIdx, adjacentIdx + 400);
    const sparseText = source.slice(sparseIdx, sparseIdx + 800);

    assert.match(adjacentText, /identified in available evidence as active market participants/);
    assert.match(adjacentText, /Detailed competitive comparison/);
    assert.doesNotMatch(
      adjacentText,
      /does not independently validate them as direct/,
      "must not cast doubt on competitor identity -- only on detailed comparison data"
    );
    assert.match(sparseText, /validated, named competitors/);
  }
});
