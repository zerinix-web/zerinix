import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// parseCitations/mergePdfSourceSections/stripMarketVerdictParagraph are
// module-private inside these large client-component files (not exported,
// heavy React/browser deps make them impractical to import directly), so
// this file follows the established pattern used throughout this test
// suite for such logic: static assertions against the real source text.
const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const dashboardPageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");

test("ReportPdfButton.tsx strips the closing verdict paragraph before it ever reaches citation-block parsing", () => {
  // Reproduces a real, live-verified P0 defect: buildMarketFinalVerdictParagraph's
  // "Final Investment Decision / The verdict is GO... The deciding factor
  // -- '...' -- outweighs..." narrative, appended to the Sources field,
  // got mangled by normalizePdfSourceContent's block-splitting (its own
  // dash-pattern heuristic treated "The deciding factor -- ..." as the
  // start of a new source block) into a fabricated citation entry --
  // Publisher: "The deciding factor", Confidence: "Validation Required".
  // Deterministic for every GO-decision Market Intelligence report, not
  // an edge case. Fixed by cutting the paragraph before
  // normalizePdfSourceContent runs at all, not just before parseCitations.
  assert.match(pdfButtonSource, /function stripMarketVerdictParagraph\(/);
  assert.match(pdfButtonSource, /"Final Investment Decision"/);

  const mergeFnMatch = pdfButtonSource.match(
    /function mergePdfSourceSections[\s\S]*?\n}\n/
  );
  assert.ok(mergeFnMatch, "mergePdfSourceSections function not found");
  const mergeFnBody = mergeFnMatch[0];

  const stripCallIndex = mergeFnBody.indexOf("stripMarketVerdictParagraph(mergedSourceContent)");
  const normalizeCallIndex = mergeFnBody.indexOf("normalizePdfSourceContent(");
  assert.ok(stripCallIndex !== -1, "mergePdfSourceSections must strip the verdict paragraph");
  assert.ok(
    stripCallIndex < normalizeCallIndex,
    "verdict-paragraph strip must run BEFORE normalizePdfSourceContent, not after"
  );
});

test("parseCitations also strips the verdict paragraph as defense in depth", () => {
  const parseFnMatch = pdfButtonSource.match(/function parseCitations\(rawContent[\s\S]*?\n\}/);
  assert.ok(parseFnMatch);
  assert.match(parseFnMatch[0], /stripMarketVerdictParagraph\(rawContent\)/);
});

test("mergePdfSourceSections skips the prose duplicate-line remover for the deterministic bibliography shape", () => {
  // removeDuplicatePdfExecutiveInsightText's exact-repeated-line removal
  // is correct for AI prose but wrongly deletes legitimate, correctly-
  // repeated structural fields (e.g. "Type: government/statistical
  // source" appearing across many distinct bibliography entries).
  assert.match(pdfButtonSource, /isDeterministicBibliography/);
  assert.match(pdfButtonSource, /Reference:\\s\*\\\[R\\d\+/);
});

test("the on-screen dashboard citation parser (page.tsx) has the same verdict-paragraph guard", () => {
  assert.match(dashboardPageSource, /function stripMarketVerdictParagraph\(/);
  const parseFnMatch = dashboardPageSource.match(/function parseCitations\(rawContent[\s\S]*?\n\}/);
  assert.ok(parseFnMatch, "page.tsx parseCitations not found");
  assert.match(parseFnMatch[0], /stripMarketVerdictParagraph\(rawContent\)/);
});

test("the Market Intelligence PDF cover no longer reuses the founder/business-plan executive snapshot for its tag, risk, and confidence panels", () => {
  // buildExecutiveSnapshot/getReportQualityBreakdown are Business-Idea-
  // Validation-shaped (CAC, founder score, financial consistency) and
  // read report.investmentScore/report.metadata.reportQuality, neither of
  // which Market Intelligence ever populates. Confirmed live: reusing
  // them put "Investor Ready" and a "CAC: Low / Capital efficiency: Low"
  // risk heatmap on a market-research report's cover page.
  // NOTE: superseded by the "FINAL CLEANUP" ticket's "Evidence" ->
  // "Validation" rename (the PDF summary tag text itself, not this guard's
  // point -- the cover still reads its own MI-specific isMarketIntelligenceReport
  // branch rather than falling through to the founder/business-plan snapshot).
  assert.match(pdfButtonSource, /isMarketIntelligenceReport\s*\?\s*\n?\s*localizePdfPresentationLabel\("Validation-Based"/);
  assert.match(pdfButtonSource, /marketConfidenceScore/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("Top Risks", pdfLocale\)/);
  assert.match(pdfButtonSource, /localizePdfPresentationLabel\("Confidence Factors", pdfLocale\)/);
});
