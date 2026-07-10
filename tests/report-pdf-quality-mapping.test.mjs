import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pdfSurfaceFiles = [
  "components/Planner.tsx",
  "app/dashboard/[id]/ReportPdfButton.tsx",
];

test("PDF SWOT rendering falls back to full report content", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /swotLabelAliases/);
    assert.match(source, /extractSwotBullets\(content, label, fullReportContent\)/);
    assert.match(source, /extractKeywordInsight\(\s*fallbackContent/);
  }
});

test("PDF scenario rendering supports distinct English and Turkish case labels", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /scenarioLabelAliases/);
    assert.match(source, /Kötü/);
    assert.match(source, /Baz/);
    assert.match(source, /İyi/);
    assert.match(source, /extractScenarioSnippet\(/);
  }
});

test("PDF financial metrics can resolve gross margin from the complete report", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /fullReportContent/);
    assert.match(source, /const metricContent = `\$\{content\}\\n\$\{fullReportContent\}`/);
    assert.match(source, /Gross Margin/);
  }
});

test("PDF citations deduplicate source entries while preserving metadata", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /const unique = new Map<string, CitationData>\(\)/);
    assert.match(source, /publicationYear/);
    assert.match(source, /confidence/);
    assert.match(source, /sourceTitle/);
    assert.match(source, /organization/);
  }
});

test("PDF text normalization protects decimals currencies and measurements", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /function preservePdfInlineTokens/);
    assert.match(source, /\(\\d\)\\.\\s\*\(\\d\)/);
    assert.match(source, /\[€\$₺\]/);
    assert.match(source, /months\?\|ay\|gün\|days\?/);
    assert.match(source, /\\u00a0/);
  }
});

test("PDF text normalization protects inline abbreviations", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.equal(source.includes("e\\.\\s*g\\."), true);
    assert.equal(source.includes("i\\.\\s*e\\."), true);
    assert.match(source, /B2B/);
    assert.match(source, /EBITDA/);
    assert.equal(source.includes("Year\\u00a0$1"), true);
  }
});

test("PDF bullet wrapping removes orphan SWOT heading bullets", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /function isOrphanBulletText/);
    assert.match(source, /isOrphanBulletText\(withoutBullet\)/);
    assert.match(source, /güçlü yönler\|güçlü yanlar\|zayıf yönler/);
  }
});
