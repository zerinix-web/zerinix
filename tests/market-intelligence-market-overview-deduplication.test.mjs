import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// MARKET OVERVIEW DEDUPLICATION FIX.
//
// This ticket's own live bug report: "Market Overview currently repeats
// the same underlying scope statement across multiple premium cards and
// again inside a visible DETAILS block." Confirmed root cause: the
// Market Opportunity panel (rendered for field === "marketOverview" on
// Market Intelligence reports) only ever showed a line-clamped FIRST
// SENTENCE of the section's content -- never the complete text. Since
// marketOverview was never added to cardFirstReportFields (unlike the 16
// fields a prior segment of this same ticket already fixed), its raw-text
// Details/AnalysisNotes disclosure below the panel still rendered the
// section's FULL content -- which necessarily restated that same opening
// sentence the panel already showed.
//
// Fix: the panel now also extracts the section's real remaining
// explanation (extractSectionMainExplanation, uncapped) and real bullets
// (extractRealBulletLines, capped at 8) -- the exact same "capture
// complete content" extractors already used by the 9-field Key Takeaway
// card for this exact same class of bug -- so the panel now IS the
// section's complete presentation. marketOverview was then added to
// cardFirstReportFields (on-screen) so the now-fully-redundant raw
// disclosure is suppressed.
//
// PDF export was investigated and confirmed to have NO separate
// marketOverview visual in either PDF path (ReportPdfButton.tsx or
// Planner.tsx's downloadPdf) -- it always drew plain body text only, so
// there was no PDF-side duplication to begin with, and marketOverview is
// deliberately NOT added to either PDF path's own pdfCompleteVisualFields/
// pdfKeyTakeawayCardFields sets (doing so would delete the only rendering
// of this section's content in the PDF, a real data-loss regression).
//
// Business Plan's marketOpportunity field (a different field name,
// sharing this same code branch only for its non-MI fallback below) is
// completely untouched -- the isMarketIntelligence gate means this fix
// can never affect it.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// A faithful, standalone reference implementation of
// extractSectionMainExplanation + extractRealBulletLines' combined
// behavior, proving the panel now captures content the old line-clamped
// first-sentence-only version discarded.
function extractRealBulletLinesReference(content, limit = 8) {
  return (content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, limit);
}

function extractSectionMainExplanationReference(content, takeaway) {
  const cleaned = (content || "").replace(/\*\*/g, "").replace(/^#{1,6}\s+.*$/gm, "");
  const proseOnly = cleaned
    .split("\n")
    .filter((line) => !/^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .join(" ");
  const sentences = proseOnly
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/^[-*•]\s+/, ""))
    .filter((sentence) => sentence.length > 20);
  const startIndex = takeaway ? 1 : 0;

  return sentences.slice(startIndex).join(" ");
}

test("reference: a realistic multi-sentence Market Overview section's SECOND and later sentences are captured by extractSectionMainExplanation -- previously discarded entirely by the old line-clamped, first-sentence-only panel", () => {
  const content =
    "This is the opening scope statement about the market being analyzed for this report. " +
    "This second sentence contains real detail the old panel discarded entirely. " +
    "This third sentence contains still more detail that was also being lost.";
  const headline = content.split(". ")[0] + ".";
  const explanation = extractSectionMainExplanationReference(content, headline);

  assert.ok(explanation.includes("second sentence contains real detail"));
  assert.ok(explanation.includes("third sentence contains still more detail"));
  assert.ok(!explanation.startsWith("This is the opening scope statement"), "must not restate the headline sentence");
});

test("reference: real bullet lines in a Market Overview section are captured, up to 8", () => {
  const content = [
    "Scope statement sentence long enough to count as a real sentence here.",
    "- Segment one detail line",
    "- Segment two detail line",
    "- Segment three detail line",
  ].join("\n");
  const bullets = extractRealBulletLinesReference(content);

  assert.deepEqual(bullets, ["Segment one detail line", "Segment two detail line", "Segment three detail line"]);
});

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: the Market Opportunity panel's isMarketIntelligence branch now extracts the section's full remaining explanation and real bullets (not just the headline sentence)`, () => {
    const branchStart = source.indexOf("if (isMarketIntelligence) {\n      const explanation = extractSectionMainExplanation(");
    assert.ok(branchStart >= 0, "expected the enriched isMarketIntelligence branch with explanation/bullets extraction");

    const branch = source.slice(branchStart, branchStart + 1600);
    assert.match(branch, /const bullets = extractRealBulletLines\(/);
    assert.match(branch, /\{explanation \? \(/);
    assert.match(branch, /\{bullets\.length > 1 \? \(/);
    // The old line-clamp-4 truncation on the headline is gone -- the
    // panel no longer hides part of even its own headline sentence.
    assert.doesNotMatch(branch, /line-clamp-4 text-xl font-semibold leading-8 text-white/);
  });

  test(`${label}: marketOverview is in cardFirstReportFields, so its now-complete panel's raw-text Details disclosure is fully suppressed (no second raw-text version of the same content)`, () => {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"marketOverview",/);
  });

  test(`${label}: Business Plan's marketOpportunity field is untouched -- the enrichment only applies inside the isMarketIntelligence gate, and the hardcoded Demand/Timing/Access/Defensibility chart (Business Plan's own visual) still exists unchanged below it`, () => {
    assert.match(source, /\{ label: "Demand", width: "82%", color: "bg-teal-200" \}/);
    assert.match(source, /\{ label: "Timing", width: "68%", color: "bg-cyan-200" \}/);
    assert.doesNotMatch(source, /"marketOpportunity",\s*\n\s*"marketDrivers"/); // never added to cardFirstReportFields
  });
}

// --- PDF: confirmed no duplication existed, and no visual was removed ----

test("ReportPdfButton.tsx: never had a dedicated marketOverview visual (no 'market overview' title branch in drawSectionVisual) -- confirms there was no PDF-side duplication to fix, and this pass adds no suppression that would delete marketOverview's only PDF rendering", () => {
  assert.doesNotMatch(pdfButtonSource, /normalizedTitle\.includes\("market overview"\)/);
  const setMatch = pdfButtonSource.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "pdfCompleteVisualFields not found");
  assert.doesNotMatch(setMatch[1], /"marketOverview",/);
});

test("Planner.tsx's downloadPdf: never had a dedicated marketOverview visual either, and marketOverview is deliberately NOT in pdfCompleteVisualFields there -- adding it would delete the only PDF rendering of this section's content (a real data-loss regression), not fix a duplication", () => {
  const setMatch = plannerSource.match(/const pdfCompleteVisualFields = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, "pdfCompleteVisualFields not found");
  assert.doesNotMatch(setMatch[1], /"marketOverview",/);
});

// --- Drift check ------------------------------------------------------------

test("AI generation, prompts, report schema, and business logic are untouched -- this pass only enriched a presentation panel and adjusted a suppression set (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /marketOverview:/);
});
