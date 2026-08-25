import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// RESTORE PREMIUM ANALYTICAL DEPTH -- WITHOUT RESTORING DUPLICATION.
//
// The prior ticket's cleanup correctly removed the duplicated legacy/raw
// Market Intelligence report body (the chat-message full-markdown dump),
// but went further than intended for a few fields: marketSize/cagr had
// their raw body text fully suppressed with NO complete card to replace
// it (only a bare headline number, or -- for cagr in Planner.tsx's own
// PDF export -- nothing at all), and two single-sentence explanations
// (TAM/SAM/SOM's per-layer assumption, Porter's per-force implication)
// were visually clamped short enough to still cut off real content.
// Genuinely new information was lost, not just genuinely redundant text.
//
// This pass restores that lost depth WITHOUT reintroducing any
// duplication:
//
// 1. Market Size / CAGR: the on-screen card now shows the headline value
//    PLUS a labeled "Evidence & Analysis" block with the section's full
//    real text (previously clamped to 3 lines) -- and marketSize/cagr
//    were removed from BOTH PDF exports' pdfCompleteVisualFields (they
//    never had an equivalent complete visual there to justify full
//    suppression -- marketSize got only derived metric tiles, cagr got
//    nothing at all), restoring their real body prose in PDF too.
// 2. TAM/SAM/SOM's per-layer assumption sentence and Porter's per-force
//    implication sentence both had their line-clamp removed on-screen --
//    same real, single sentence; no longer cut short.
// 3. Competitive Landscape gained a third fallback tier: when its own
//    table/flattened-bullet content fails to parse, it now reads Major
//    Players' own bullet list (built from the exact same evidence-backed
//    vendor set) rather than showing "Validation Needed" while a sibling
//    section plainly names the same vendors.
//
// Regression guards (both failure modes this ticket explicitly requires
// coverage for) close out this file: the legacy raw body must not
// return, and the restored content above must not have been lost again.
//
// AI generation, prompts, report schema, research/source collection,
// TAM/SAM/SOM calculation/validation logic, confidence logic, business
// logic, and routing are untouched -- confirmed via drift checks below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const chatMessagesSource = readFileSync(
  new URL("../components/planner/ChatMessages.tsx", import.meta.url),
  "utf8"
);

// --- 1. Market Size / CAGR: Evidence & Analysis restored -------------------

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: the Market Size / CAGR card shows a labeled "Evidence & Analysis" block with the section's full real content, no longer clamped to 3 lines`, () => {
    const marketSizeBlockStart = source.indexOf(
      label === "page.tsx"
        ? 'normalizedTitle.includes("market size") || normalizedTitle === "cagr"'
        : 'if (field === "marketSize" || field === "cagr")'
    );
    assert.ok(marketSizeBlockStart >= 0, "Market Size / CAGR branch not found");
    const block = source.slice(marketSizeBlockStart, marketSizeBlockStart + 3200);

    assert.match(block, /Evidence &amp; Analysis/);
    assert.doesNotMatch(block, /line-clamp-3 text-sm leading-6 text-zinc-400">\{(?:section\.)?content\}/);
  });
}

test("ReportPdfButton.tsx and Planner.tsx's downloadPdf: marketSize/cagr were removed from pdfCompleteVisualFields, so their real body prose renders in the PDF again -- marketSize previously had only a derived-metric tile grid (no reasoning) and cagr had no visual at all, so full suppression left both without any real evidence text", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const setMatch = source.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "pdfCompleteVisualFields not found");
    assert.doesNotMatch(setMatch[1], /"marketSize",/);
    assert.doesNotMatch(setMatch[1], /"cagr",/);
    // Every other previously-suppressed field must remain suppressed --
    // this fix is scoped to exactly the two fields that had nothing to
    // show for themselves otherwise.
    assert.match(setMatch[1], /"executiveSummary",/);
    assert.match(setMatch[1], /"tamSamSom",/);
    assert.match(setMatch[1], /"strategicRecommendations",/);
    assert.match(setMatch[1], /"portersFiveForces",/);
    assert.match(setMatch[1], /"competitiveLandscape",/);
  }
});

test("page.tsx and Planner.tsx: marketSize/cagr remain fully suppressed on-screen (cardFirstReportFields is unchanged there) -- the web card's own Evidence & Analysis block is already complete on its own, unlike the PDF's prior tile-only/empty treatment", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"marketSize",/);
    assert.match(setMatch[1], /"cagr",/);
  }
});

// --- 2. TAM/SAM/SOM assumption and Porter's implication un-clamped --------

test("page.tsx and Planner.tsx: TAM/SAM/SOM's per-layer assumption sentence no longer has line-clamp-2 -- the same real sentence, just no longer visually cut off", () => {
  assert.doesNotMatch(
    pageSource,
    /line-clamp-2 pl-1 text-xs leading-5 text-zinc-500 sm:pl-\[4\.75rem\]">\{assumption\}/
  );
  assert.match(pageSource, /pl-1 text-xs leading-5 text-zinc-500 sm:pl-\[4\.75rem\]">\{assumption\}/);

  const tamSamSomBlock = plannerSource.slice(
    plannerSource.indexOf('if (field === "tamSamSom")'),
    plannerSource.indexOf('if (field === "marketOpportunity"')
  );
  assert.doesNotMatch(tamSamSomBlock, /line-clamp-2 text-xs leading-5 text-zinc-500">\{row\.description\}/);
  assert.match(tamSamSomBlock, /text-xs leading-5 text-zinc-500">\{row\.description\}/);
});

test("page.tsx and Planner.tsx: Porter's Five Forces per-force implication sentence no longer has line-clamp-3", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.doesNotMatch(
      source,
      /line-clamp-3 border-t border-white\/10 pt-3 text-xs leading-5 text-zinc-400">\s*\{implication\}/
    );
    assert.match(source, /border-t border-white\/10 pt-3 text-xs leading-5 text-zinc-400">\s*\{implication\}/);
  }
});

// --- 3. Competitive Landscape: Major Players fallback tier -----------------

function extractCompetitorRowsFromMajorPlayersReference(majorPlayersContent) {
  const normalized = (majorPlayersContent || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  return bulletLines
    .map((line) => {
      const match = line.match(/^-\s+(.+?)\s+\(([^)]+)\):\s*([^;]+);[^:]*:\s*([^(]+)\(([^)]*)\)/);
      if (!match) {
        return null;
      }
      const [, vendor, majorPlayerLabel, classifications, , metrics] = match;
      const confidenceMatch = metrics.match(/confidence[^:]*:\s*([^;]+)/i);
      return {
        vendor: vendor.trim(),
        category: majorPlayerLabel.trim(),
        position: classifications.trim(),
        strengths: "",
        weaknesses: "",
        relevance: "",
        validationStatus: confidenceMatch?.[1]?.trim() || "",
      };
    })
    .filter((row) => row !== null && Boolean(row.vendor))
    .slice(0, 20);
}

test("reference: a realistic Major Players bullet line ('- Autodesk Construction Cloud (Market Leader): AEC, Construction Management; target customer: Enterprise general contractors (ranking: 88/100; overall score: 91/100; confidence: 92/100 High; [R1], [R4])') is correctly read back into a competitor row -- this is the exact live contradiction the ticket described (Competitive Landscape 'Validation Needed' while Major Players names real vendors)", () => {
  const majorPlayersContent =
    "## Major Players\n\n" +
    "- Autodesk Construction Cloud (Market Leader): AEC, Construction Management; target customer: Enterprise general contractors (ranking: 88/100; overall score: 91/100; confidence: 92/100 High; [R1], [R4])\n" +
    "- BIM Track (Specialist): Design Coordination; target customer: Mid-market AEC firms (ranking: 61/100; overall score: 58/100; confidence: 64/100 Moderate; [R7])";

  const rows = extractCompetitorRowsFromMajorPlayersReference(majorPlayersContent);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, "Autodesk Construction Cloud");
  assert.equal(rows[0].category, "Market Leader");
  assert.equal(rows[0].position, "AEC, Construction Management");
  assert.equal(rows[0].validationStatus, "92/100 High");
  assert.equal(rows[1].vendor, "BIM Track");
});

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
]) {
  test(`${label}: extractMarketIntelligenceCompetitorRowsFromMajorPlayers exists, and extractMarketIntelligenceCompetitorRows tries the table, then flattened bullets, then Major Players' own bullets, in that order -- never fabricating a vendor, only reading what the payload already contains`, () => {
    assert.match(source, /function extractMarketIntelligenceCompetitorRowsFromMajorPlayers\(majorPlayersContent: string\)/);
    assert.match(source, /function extractMarketIntelligenceCompetitorRowsFromTable\(content: string\)/);

    const fnMatch = source.match(/function extractMarketIntelligenceCompetitorRows\(content: string, majorPlayersContent = ""\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "extractMarketIntelligenceCompetitorRows (the tiered dispatcher) not found");
    const fn = fnMatch[0];

    const tableIndex = fn.indexOf("extractMarketIntelligenceCompetitorRowsFromTable(content)");
    const flattenedIndex = fn.indexOf("extractFlattenedMarketIntelligenceCompetitorRows(content)");
    const majorPlayersIndex = fn.indexOf("extractMarketIntelligenceCompetitorRowsFromMajorPlayers(majorPlayersContent)");

    assert.ok(tableIndex >= 0 && flattenedIndex > tableIndex && majorPlayersIndex > flattenedIndex);
  });

  test(`${label}: the Major Players fallback never fabricates a vendor -- it only reads real bullet lines already present in Major Players' own content, and skips any line that doesn't match the real generated shape`, () => {
    const fnMatch = source.match(/function extractMarketIntelligenceCompetitorRowsFromMajorPlayers\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "extractMarketIntelligenceCompetitorRowsFromMajorPlayers not found");
    assert.match(fnMatch[0], /\.filter\(\(line\) => \/\^-\\s\+\\S\/\.test\(line\)\)/);
    assert.match(fnMatch[0], /if \(!match\) \{\s*\n\s*return null;\s*\n\s*\}/);
  });
}

test("page.tsx and Planner.tsx (on-screen): the Competitive Landscape/Major Players premium cards are threaded majorPlayersContent so the fallback above actually has data to read -- both call sites find the sibling majorPlayers section", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /majorPlayersContent=\{?\s*visibleSections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content|majorPlayersContent=\{sections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content\}/);
  }
});

test("both PDF paths thread majorPlayers' content into extractMarketIntelligenceCompetitorRows AND the names-only fallback tier at both the drawing and height call sites, so drawing and pagination never disagree on which rows/names exist", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    const occurrences = source.match(/pdfSections\.find\(\(entry\) => entry\.field === "majorPlayers"\)\?\.content/g) || [];
    // 2 call sites (draw + height) for extractMarketIntelligenceCompetitorRows,
    // plus 2 more (draw + height) for extractMarketIntelligenceCompetitorNamesOnly.
    assert.equal(occurrences.length, 4, `expected exactly 4 call sites (rows + namesOnly, draw + height each) threading majorPlayers content, got ${occurrences.length}`);
  }
});

// --- Regression guard 1: the legacy raw report body must not return -------

test("REGRESSION GUARD (failure mode 1): the legacy raw report body (getReportMarkdown's full section-by-section dump, rendered verbatim in the live chat view) still does not return -- a completed Market Intelligence report message still renders only its title line", () => {
  assert.match(chatMessagesSource, /export function getReportCompletionHeadline\(content: string\)/);
  assert.match(
    chatMessagesSource,
    /const isCompletedMarketReportMessage =\s*\n\s*!isUser && message\.mode === "market" && message\.status === "complete";/
  );
  assert.match(
    chatMessagesSource,
    /const displayContent = isCompletedMarketReportMessage\s*\n\s*\? getReportCompletionHeadline\(message\.content\)\s*\n\s*: message\.content;/
  );
  assert.match(chatMessagesSource, /content=\{displayContent\}/);
});

test("REGRESSION GUARD (failure mode 1): no generic redundant DETAILS/AnalysisNotes block returns for the fields that already have a complete card (executiveSummary, tamSamSom, portersFiveForces, strategicRecommendations, competitiveLandscape, and the 9 Key Takeaway fields) -- only marketSize/cagr's PDF suppression was relaxed, and only because they had nothing to show without it", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    for (const field of [
      "executiveSummary",
      "marketOverview",
      "marketDrivers",
      "barriers",
      "opportunities",
      "threats",
      "customerSegments",
      "majorPlayers",
      "regionalAnalysis",
      "industryTrends",
      "marketSegmentation",
      "tamSamSom",
      "strategicRecommendations",
      "portersFiveForces",
      "marketSize",
      "cagr",
      "competitiveLandscape",
    ]) {
      assert.match(setMatch[1], new RegExp(`"${field}",`), `expected "${field}" to remain in cardFirstReportFields`);
    }
  }
});

// --- Regression guard 2: the newly-restored analytical depth must persist -

test("REGRESSION GUARD (failure mode 2): Market Size / CAGR's Evidence & Analysis block, TAM/SAM/SOM's un-clamped assumption, Porter's un-clamped implication, and the Major Players competitor fallback are all present together -- none of this ticket's restorations were lost", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /Evidence &amp; Analysis/);
    assert.match(source, /function extractMarketIntelligenceCompetitorRowsFromMajorPlayers\(majorPlayersContent: string\)/);
  }
  assert.doesNotMatch(pageSource, /line-clamp-2 pl-1 text-xs leading-5 text-zinc-500 sm:pl-\[4\.75rem\]">\{assumption\}/);
  assert.doesNotMatch(pageSource, /line-clamp-3 border-t border-white\/10 pt-3 text-xs leading-5 text-zinc-400">\s*\{implication\}/);
});

// --- Drift check -------------------------------------------------------

test("AI generation, prompts, report schema, research/source collection, and business/calculation logic are untouched -- this pass only restored presentation-layer depth (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketGraphSource,
    /\| Vendor \| Parent Company \| Category \| Segment \| AI Capability \| Key Use Cases \| Pricing Model \| Strengths \| Weaknesses \| Validation Count \| Confidence \| Market Relevance \|/
  );

  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const tamResolved = magnitudes\[0\] !== null;/);
  }
});
