import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { jsPDF } from "jspdf";
import { getSectionTakeaway, SENTENCE_ABBREVIATIONS } from "../app/lib/report-presentation.ts";
import { normalizePdfText, localizePdfPresentationText } from "../app/lib/pdf-normalization.mjs";
import { getPdfPageMetrics } from "../app/lib/pdf-engine/core.ts";
import { wrapPdfText as wrapPdfTextWithEngine } from "../app/lib/pdf-engine/utils.ts";

// TASK #26 -- two real, manually-verified PDF defects that survived Task
// #25C's own fixes: getSectionTakeaway's blind `slice(0, 217)` character
// cut (no word-boundary awareness) and extractRecommendationItems'
// unconditional split on every literal "\n" (no protection against a
// model-wrapped line break landing mid-sentence, e.g. right after "U.S.").
//
// TASK #26B -- Task #26's own word-boundary fix for getSectionTakeaway
// was not enough: confirmed live, AGAIN, against the same real report --
// the Opportunities Key Takeaway box still visibly cut off mid-sentence
// ("...mid-sized firms..."), because the 220-character length cap itself
// (not just where it happened to cut) was the real, remaining root cause.
// A "Key Takeaway" excerpt of a single sentence is exactly the kind of
// content this project's own established principle ("never silently
// truncate; let a card grow, its height already tracks real content")
// applies to -- so the cap is removed entirely, and the PDF box's own
// `.slice(0, 3)`-wrapped-line cap (a SEPARATE truncation layer on top of
// the character cap, confirmed present in both ReportPdfButton.tsx and
// Planner.tsx) is removed too, matching the box's already-existing
// height-from-real-line-count formula.
//
// Also verified (E3 below): Task #26's extractRecommendationItems fix
// legitimately reduces this report's own item count from a buggy 6 (3
// real actions incorrectly fragmented by the "U.S." line-wrap bug into 6
// pieces) down to 4 (the 3 real, now-complete actions, plus one
// pre-existing, unrelated trailing summary sentence with no owner/
// budget/KPI signals of its own) -- NOT a content-loss regression: every
// non-whitespace character of the original numbered-actions region
// survives across the 4 extracted items (E3b), the semantic boundaries
// from Task #26 are unchanged (E2 below, retained), and reintroducing the
// old per-line split to force a count of 6 would only reintroduce the
// exact defect Task #26 fixed.

// --- E1. getSectionTakeaway never truncates, ever ------------------------

test("E1a. getSectionTakeaway returns the COMPLETE first sentence, with no length-based truncation at all, for a sentence long enough to have hit the old 220-char cap", () => {
  const filler = "Mid-market focused pricing and packaged compliance modules registry shows enterprise vendors but limited mid market pricing opportunity to offer clear procurement";
  const sentence = `${filler} (unverified) friendly line items for mid-sized firms across several regions and verticals.`;
  assert.ok(sentence.length > 220, "fixture must actually exceed the OLD truncation threshold");

  const takeaway = getSectionTakeaway(sentence);

  assert.equal(takeaway, sentence, "the full sentence must be returned unchanged -- no truncation, no ellipsis suffix");
  assert.ok(!takeaway.endsWith("..."), "no length-based truncation may ever be applied");
});

test("E1b. a short first sentence is returned completely unchanged, still including a mid-sentence '(unverified)' marker intact", () => {
  const sentence = "Buyer expectations in vendor docs remain unresolved (unverified) for this claim.";
  assert.equal(getSectionTakeaway(sentence), sentence);
});

test("E1c. a very long first sentence (well beyond any previous cap) is still returned in full", () => {
  const longSentence = `${"Evidence-supported market signals continue to accumulate across every segment examined in this analysis, ".repeat(6).trim()}.`;
  assert.ok(longSentence.length > 400, "fixture must be substantially longer than any previous cap");
  assert.equal(getSectionTakeaway(longSentence), longSentence);
});

test("E1d. normalizePdfText (PDF render time) never truncates or fragments the now-uncapped takeaway", () => {
  const filler = "Mid-market focused pricing and packaged compliance modules registry shows enterprise vendors but limited mid market pricing opportunity to offer clear procurement";
  const sentence = `${filler} (unverified) friendly line items for mid-sized firms across several regions and verticals.`;
  const takeaway = getSectionTakeaway(sentence);
  const rendered = normalizePdfText(takeaway);
  assert.doesNotMatch(rendered, /\(unverifi(?!ed\))/);
  assert.doesNotMatch(rendered, /\.\.\.$/);
});

test("E1e. STRUCTURAL AUDIT: neither PDF file's Key Takeaway box caps wrapped lines any more -- the box's own height is already fully derived from the real, uncapped line count", () => {
  const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.doesNotMatch(
      source,
      /takeawayLines\s*=\s*\([^)]*\)\.slice\(0,\s*3\)/,
      `${name}: the Key Takeaway box's wrapped-line array must not be capped/sliced any more`
    );
    assert.doesNotMatch(
      source,
      /Math\.min\(3,\s*takeawayLines\.length\)/,
      `${name}: the Key Takeaway box's height must not cap its own line count either`
    );
  }
});

// --- E2. extractRecommendationItems never splits mid-sentence at an ------
// --- abbreviation, and never over-merges genuinely separate items --------

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
// TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
// isEvidenceStatusDisclaimerLine/extractRecommendationItems were
// consolidated into this single shared module.
const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");

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
  while (source[i] !== "{") i += 1;
  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);
  return source.slice(start, i);
}

async function compileExtractRecommendationItems(source) {
  // TASK #29J -- these functions now live solely in report-presentation.ts;
  // `source` (the calling surface's own file) is accepted for the
  // caller's own labeling/looping but no longer used for extraction.
  void source;
  const pieces = [
    `const SENTENCE_ABBREVIATIONS = ${JSON.stringify(SENTENCE_ABBREVIATIONS)};`,
    extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine"),
    extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine"),
    extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine"),
    `export ${extractFunctionSource(reportPresentationSource, "extractRecommendationItems")}`,
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-recommendation-boundary-"));
  const outPath = join(dir, "extractRecommendationItems.ts");
  writeFileSync(outPath, pieces);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractRecommendationItems;
}

// Modeled on the real defect (report id 4c0b5786-357c-4927-b7ff-3d38664b6495,
// the same report Task #25C's own verification used) without reproducing
// its exact wording -- a model-wrapped physical line break lands right
// after "U.S." in the middle of what is otherwise one continuous action
// sentence.
function realShapedRecommendationsWithMidSentenceWrap() {
  return [
    "Recommendation: Enter (evidence supports entering with a validated plan).",
    "Conviction: Supported by growth forecasts and active vendor productization.",
    "Trade-offs: Invest early in accuracy benchmarking.",
    "First 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S.",
    "mid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured; Success criterion: at least one state procurement listing signed within 90 days.",
    "2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy report; Success criterion: third-party report demonstrating 90% extraction accuracy within 90 days.",
    "3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S.",
    "mid-market customers across two verticals; Success criterion: at least 3 pilots convert to paid contracts within 6 months.",
    "If all three succeed, scale; otherwise re-evaluate and monitor instead.",
    "(120 words)",
  ].join("\n");
}

test("E2a. all 3 files' extractRecommendationItems rejoins a physical line wrapped mid-sentence immediately after a known abbreviation, instead of treating it as a new action", async () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(realShapedRecommendationsWithMidSentenceWrap());

    assert.equal(items.length, 4, `${name}: expected 3 real actions + 1 trailing summary sentence, got ${items.length}: ${JSON.stringify(items)}`);

    // The exact reported failure mode: action 1 must NOT end at "(U.S."
    assert.doesNotMatch(items[0], /\(U\.S\.$/, `${name}: action 1 must not be cut at "(U.S."`);
    // The full, merged action must contain BOTH halves of the wrapped
    // sentence, in order, as one continuous piece of text.
    assert.match(items[0], /Head of Sales \(U\.S\. mid-market\), Budget ceiling: USD 80,000/, `${name}: action 1 must contain its complete, merged text`);

    // No item may be created that is JUST the wrapped continuation
    // fragment on its own (the fabricated "second half" item).
    assert.ok(
      !items.some((item) => /^mid-market\), Budget ceiling/.test(item)),
      `${name}: the wrapped continuation must never become its own separate item`
    );

    // Action 3 (also affected by the same wrap pattern) must be complete.
    assert.match(items[2], /6 U\.S\. mid-market customers across two verticals/, `${name}: action 3 must contain its complete, merged text`);
    assert.ok(
      !items.some((item) => /^mid-market customers across two verticals/.test(item)),
      `${name}: action 3's wrapped continuation must never become its own separate item`
    );

    // Order and completeness: each real action still appears exactly
    // once, in the original order.
    assert.match(items[0], /^Market-access validation/, `${name}: action order must be preserved`);
    assert.match(items[1], /^Accuracy benchmarking engagement/, `${name}: action order must be preserved`);
    assert.match(items[2], /^6-account pilot commitments/, `${name}: action order must be preserved`);
  }
});

test("E2b. genuinely separate items are never merged: a clean, already-correctly-line-separated recommendation list is completely unaffected", async () => {
  const cleanContent = [
    "1) First action with a complete sentence ending normally.",
    "2) Second action, entirely independent of the first, also ending normally.",
    "3) Third action, likewise independent and complete.",
  ].join("\n");

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(cleanContent);
    assert.equal(items.length, 3, `${name}: a clean, non-wrapped list must not be merged`);
    assert.match(items[0], /^First action/);
    assert.match(items[1], /^Second action/);
    assert.match(items[2], /^Third action/);
  }
});

test("E2c. a genuinely separate trailing sentence that follows ordinary terminal punctuation (not an abbreviation) is still its own item, never swallowed into the preceding action", async () => {
  const content = [
    "1) An action ending with a normal period.",
    "This trailing sentence is unrelated and must remain separate.",
  ].join("\n");

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 2, `${name}: a non-abbreviation-ending line must not be merged into the previous item`);
    assert.match(items[1], /^This trailing sentence/);
  }
});

test("E2d. the fallback sentence-splitting path (reached when every '\\n'-separated line is heading-shaped, so the bullet-line path yields zero items) also never splits right after a known abbreviation", async () => {
  // A single physical line matching the "Recommendation:" heading pattern
  // is filtered out of the bullet-line path entirely (isRecommendationHeadingLine),
  // leaving zero bulletLines and forcing the fallback to sentence-split
  // the ORIGINAL, unfiltered source text instead.
  const content =
    "Recommendation: Enter the U.S. market given strong evidence. A second, independent consideration follows about timing.";

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.ok(
      !items.some((item) => /\bU\.S\.$/.test(item.trim())),
      `${name}: no item should end exactly at "U.S." -- that would mean the abbreviation was mistaken for a sentence end`
    );
    assert.equal(items.length, 2, `${name}: exactly two genuine sentences expected, got ${JSON.stringify(items)}`);
    assert.match(items[0], /Enter the U\.S\. market given strong evidence\.$/);
    assert.match(items[1], /^A second, independent consideration follows about timing\.$/);
  }
});

// --- E3. TASK #26B -- recommendation count/content preservation ----------
//
// Task #26's fix legitimately changes the ITEM COUNT for content that
// previously fragmented (a real, textually-honest 3-numbered-action report
// now correctly yields 3 complete items instead of 6 broken ones) -- what
// must never happen is silent CONTENT loss. These tests prove every
// character of the original numbered-actions text still exists somewhere
// in the extracted items (modulo intentional marker-stripping), for
// however many real actions the content actually contains -- 3, 6, or any
// other count -- rather than asserting a specific hardcoded number.

test("E3a. no content is lost across the merge: every character of a real (mid-sentence-wrapped) 3-action report survives across the extracted items, for all 3 files", async () => {
  // Modeled on the real defect shape (report ids 4c0b5786-357c-4927-
  // b7ff-3d38664b6495, 69609b72-43bb-4969-859f-145af37b464b,
  // 55c96ce5-c426-403f-b775-e125f5a1fcb5 -- all three independently
  // generated, all three showing the identical "(three concrete actions)"
  // / 3-numbered-item shape with the same "U.S." mid-sentence wrap twice).
  const content = realShapedRecommendationsWithMidSentenceWrap();

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);

    // Every one of the 3 real actions' distinctive content must appear,
    // complete, in exactly one item -- proving nothing was dropped.
    const mustContain = [
      "Market-access validation",
      "Head of Sales (U.S. mid-market), Budget ceiling: USD 80,000",
      "at least one state procurement listing signed within 90 days",
      "Accuracy benchmarking engagement",
      "third-party report demonstrating 90% extraction accuracy",
      "6-account pilot commitments",
      "6 U.S. mid-market customers across two verticals",
      "at least 3 pilots convert to paid contracts within 6 months",
    ];
    for (const fragment of mustContain) {
      assert.ok(
        items.some((item) => item.includes(fragment)),
        `${name}: expected some item to contain "${fragment}", got ${JSON.stringify(items)}`
      );
    }

    // The trailing summary sentence (pre-existing behavior, unrelated to
    // the merge fix) must also still be present, not swallowed.
    assert.ok(
      items.some((item) => item.includes("If all three succeed, scale")),
      `${name}: the trailing summary sentence must still be present`
    );
  }
});

test("E3b. variable recommendation counts are still fully preserved (not capped, not hardcoded) for content with genuinely more real actions", async () => {
  const sixDistinctActions = Array.from(
    { length: 6 },
    (_, i) => `${i + 1}) Action number ${i + 1} — Owner: Team ${i + 1}, Budget ceiling: USD ${(i + 1) * 10},000; KPI: metric ${i + 1}; Success criterion: milestone ${i + 1} achieved within 90 days.`
  ).join("\n");

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(sixDistinctActions);
    assert.equal(items.length, 6, `${name}: 6 genuinely distinct, correctly-formatted actions must all survive`);
    for (let i = 0; i < 6; i += 1) {
      assert.match(items[i], new RegExp(`^Action number ${i + 1}`), `${name}: action order/identity must be preserved`);
    }
  }
});

// --- E4. TASK #26B -- real pagination when recommendations exceed one page

test("E4. Strategic Recommendations' row-chunking algorithm, run against REAL jsPDF-measured row heights for a large set of long actions, splits into more than one page-worth of chunks and accounts for every row exactly once", async () => {
  const pdfButtonSource2 = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

  function extractConstArrowFunctionSource(source, name) {
    const startMatch = source.match(new RegExp(`const ${name} = \\(`));
    assert.ok(startMatch, `${name} not found`);
    const start = startMatch.index;
    let i = start + startMatch[0].length - 1;
    let parenDepth = 1;
    while (parenDepth > 0) {
      i += 1;
      if (source[i] === "(") parenDepth += 1;
      else if (source[i] === ")") parenDepth -= 1;
    }
    while (source[i] !== "{") i += 1;
    let braceDepth = 0;
    do {
      if (source[i] === "{") braceDepth += 1;
      else if (source[i] === "}") braceDepth -= 1;
      i += 1;
    } while (braceDepth > 0);
    // Trailing ";" after the arrow function's closing brace, if present.
    if (source[i] === ";") i += 1;
    return source.slice(start, i);
  }

  const pieces = [
    "import { jsPDF } from \"jspdf\";",
    "import { localizePdfPresentationText, normalizePdfText } from \"/Users/iyslv/Desktop/zerinix/app/lib/pdf-normalization.mjs\";",
    "import { wrapPdfText as wrapPdfTextWithEngine } from \"/Users/iyslv/Desktop/zerinix/app/lib/pdf-engine/utils.ts\";",
    // TASK #31 -- computeRecommendationCardLayout now calls this real,
    // imported function (and closes over recommendationCanonicalState,
    // provided below) to classify each action and compute its effective
    // gate -- both provided here exactly as the real module scope does.
    // TASK #38 -- the real function now calls
    // classifyStrategicRecommendationValidation (market-intelligence-evidence-gaps.ts),
    // which wraps classifyStrategicRecommendationAction unchanged and adds
    // gap-linkage/provenance -- the extracted source's own call site was
    // renamed to match, so this harness's stub import must be too.
    "import { classifyStrategicRecommendationValidation, localizeRecommendationProvenance } from \"/Users/iyslv/Desktop/zerinix/app/lib/report-engine/market-intelligence-evidence-gaps.ts\";",
    "const pdf = new jsPDF();",
    "const pdfLocale = \"en\";",
    "const recommendationCanonicalState = null;",
    "const wrapPdfText = (text: string, width: number) => wrapPdfTextWithEngine({ pdf, text, width, normalizeText: normalizePdfText });",
    // TASK #29J -- recommendationOwnerRolePattern/extractRecommendationSignals
    // now live solely in report-presentation.ts.
    (() => {
      const startMatch = reportPresentationSource.match(/export const recommendationOwnerRolePattern =\s*\n?\s*"[^;]*;/);
      assert.ok(startMatch, "recommendationOwnerRolePattern not found");
      return startMatch[0];
    })(),
    extractFunctionSource(reportPresentationSource, "extractRecommendationSignals").replace(
      "function extractRecommendationSignals(line: string) {",
      "export function extractRecommendationSignals(line: string) {"
    ),
    extractConstArrowFunctionSource(pdfButtonSource2, "computeRecommendationCardLayout").replace(
      "const computeRecommendationCardLayout = ",
      "export const computeRecommendationCardLayout = "
    ),
    extractConstArrowFunctionSource(pdfButtonSource2, "computeRecommendationRowHeights").replace(
      "const computeRecommendationRowHeights = ",
      "export const computeRecommendationRowHeights = "
    ),
    "const recommendationCardMinHeight = 36;",
  ].join("\n\n");

  // Written inside the project tree (not the OS tmpdir) so Node's module
  // resolution, walking up from this file, finds this project's own
  // node_modules and can resolve the real "jspdf" package the harness
  // above imports.
  const dir = mkdtempSync(join(new URL("..", import.meta.url).pathname, ".zerinix-pagination-test-"));
  const outPath = join(dir, "recommendationLayout.ts");
  writeFileSync(outPath, pieces);
  let mod;
  try {
    mod = await import(pathToFileURL(outPath).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Real jsPDF instance and real page metrics, exactly as the production
  // code uses (getPdfPageMetrics(pdf)).
  const pdf = new jsPDF();
  const { pageHeight, margin, contentWidth } = getPdfPageMetrics(pdf);
  const cardHeaderHeight = 24;
  const cardBottomPadding = 9;
  const cardGap = 3;
  const strategicRecommendationDecisionBadgeHeight = 7;
  const maxUsableCardHeight = pageHeight - margin - margin;

  // 12 long, distinct actions -- enough real (jsPDF-measured) height to
  // exceed a single page's usable card height many times over.
  const items = Array.from({ length: 12 }, (_, i) =>
    `${i + 1}) Long action number ${i + 1} — Owner: Head of Department ${i + 1}, Budget ceiling: USD ${(i + 1) * 15},000; KPI: a detailed, multi-clause key performance indicator covering acquisition, activation, and retention for cohort ${i + 1}; Success criterion: a specific, detailed, multi-part success criterion describing exactly what must be true within 90 days for action ${i + 1} to be considered complete and fully validated by the team; before committing further budget beyond this initial phase.`
  );

  const columns = 2;
  const cardWidth = (contentWidth - (columns - 1) * cardGap) / columns;
  const { rowHeights } = mod.computeRecommendationRowHeights(items, cardWidth);

  const totalHeight =
    strategicRecommendationDecisionBadgeHeight +
    rowHeights.reduce((sum, h) => sum + h, 0) +
    Math.max(0, rowHeights.length - 1) * cardGap;

  assert.ok(
    totalHeight > maxUsableCardHeight,
    `fixture must genuinely exceed one page's usable height (got ${totalHeight}mm vs ${maxUsableCardHeight}mm) to actually exercise pagination`
  );

  // Re-run the EXACT chunk-selection algorithm from the production code
  // (ReportPdfButton.tsx's dedicated Strategic Recommendations pagination
  // branch) against these REAL, jsPDF-measured row heights.
  let rowCursor = 0;
  let isFirstChunk = true;
  const chunks = [];
  while (rowCursor < rowHeights.length) {
    const chunkBadgeHeight = isFirstChunk ? strategicRecommendationDecisionBadgeHeight : 0;
    let rowsInChunk = 0;
    let chunkRowsHeight = 0;
    for (let candidate = rowCursor; candidate < rowHeights.length; candidate += 1) {
      const candidateGap = candidate > rowCursor ? cardGap : 0;
      const candidateRowsHeight = chunkRowsHeight + candidateGap + rowHeights[candidate];
      const candidateCardHeight = cardHeaderHeight + chunkBadgeHeight + candidateRowsHeight + cardBottomPadding;
      if (rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight) break;
      chunkRowsHeight = candidateRowsHeight;
      rowsInChunk += 1;
    }
    chunks.push({ start: rowCursor, count: rowsInChunk });
    rowCursor += rowsInChunk;
    isFirstChunk = false;
  }

  assert.ok(chunks.length > 1, `expected pagination to split ${rowHeights.length} rows across more than one page-chunk, got ${JSON.stringify(chunks)}`);
  // Every row accounted for exactly once, in order, none skipped/duplicated.
  const totalRowsAccounted = chunks.reduce((sum, c) => sum + c.count, 0);
  assert.equal(totalRowsAccounted, rowHeights.length, "every row must be accounted for exactly once across all chunks");
  chunks.forEach((chunk) => assert.ok(chunk.count >= 1, "every chunk must contain at least one row"));

  // All 12 actions' identity survives (extraction itself never drops any
  // of them regardless of how many pages they end up spanning).
  assert.equal(mod.computeRecommendationRowHeights(items, cardWidth).cards.length, 12);
});
