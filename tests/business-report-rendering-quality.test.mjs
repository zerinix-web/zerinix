import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pdfSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const normalizationSource = readFileSync("app/lib/pdf-normalization.mjs", "utf8");

test("TAM SAM SOM cards are populated from normalized report values", () => {
  for (const source of [plannerSource, pdfSource]) {
    assert.match(source, /function extractMarketSizeValue/);
    assert.match(source, /extractMarketSizeValue\(`\$\{content\}\\n\$\{fullReportContent\}`, label\)/);
    assert.match(source, /[kKmMbBtT%]/);
  }
});

test("Executive Recommendation confidence supports score and conviction language", () => {
  for (const source of [plannerSource, pdfSource]) {
    assert.match(source, /score\|conviction/);
    assert.match(source, /medium\|moderate/);
    assert.match(source, /extractConfidence\(fullReportContent\)/);
    assert.match(source, /extractScore\(fullReportContent, "Investment Score"\)/);
  }
});

test("Business Idea is derived from business prompt or model content before ICP", () => {
  for (const source of [plannerSource, pdfSource]) {
    assert.match(source, /function getBusinessIdeaFromPrompt/);
    assert.match(source, /businessModel/);
    assert.match(source, /solution/);
    assert.match(source, /targetCustomer/);
    assert.match(source, /would you invest/);
  }

  assert.match(plannerSource, /sourcePrompt=\{lastRequest\?\.prompt\}/);
});

test("SWOT quadrants use SWOT extraction instead of empty section-local snippets", () => {
  assert.match(plannerSource, /extractSwotBullets\(section\.content, title\)/);

  for (const source of [plannerSource, pdfSource]) {
    assert.match(source, /extractKeywordInsight\(\s*fallbackContent/);
    assert.match(source, /Strengths/);
    assert.match(source, /Weaknesses/);
    assert.match(source, /Opportunities/);
    assert.match(source, /Threats/);
  }
});

test("Sources are structured, typed, and deduplicated before rendering", () => {
  for (const source of [plannerSource, pdfSource]) {
    assert.match(source, /sourceType/);
    assert.match(source, /normalizeSourceType/);
    assert.match(source, /Publisher not specified/);
    assert.match(source, /publicationYear/);
    assert.match(source, /confidence/);
    assert.doesNotMatch(source, /citation\.publicationYear \|\| "",\s*\]\.join/);
  }
});

test("PDF normalization removes malformed wording and broken numeric fragments", () => {
  assert.match(normalizationSource, /Planning inputs define/);
  assert.match(normalizationSource, /Market sources/);
  assert.match(normalizationSource, /Primary risk is detailed in the risk analysis/);
  assert.match(normalizationSource, /Validate the primary investment thesis/);
  assert.match(normalizationSource, /replace\(\/\(\\d\)\\\.\\s\+\(\\d\)/);
});
