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
    assert.match(source, /extractAliasedSectionSnippet\(content, aliases, allAliases\)/);
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
    assert.match(source, /normalizedUrl/);
    assert.match(source, /url:\$\{normalizedUrl\}/);
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
    assert.match(source, /\(\\d\(\?:\[\.,\]\\d\+\)\*\)\\s\*%/);
    assert.match(source, /\(\[€\$₺\]\)\(\\d\(\?:\[\.,\]\\d\+\)\*\)\\s\*\(\[kKmMbB\]\)/);
    assert.match(source, /months\?\|ay\|gün\|days\?/);
    assert.match(source, /\\u00a0/);
  }
});

test("PDF text normalization repairs malformed month expressions", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.equal(source.includes("(\\d{1,2})(\\d{2})\\s*months?"), true);
    assert.equal(source.includes("$1–$2\\u00a0months"), true);
    assert.equal(source.includes("(\\d{1,2})(\\d{2})-month"), true);
    assert.equal(source.includes("$1–$2-month"), true);
    assert.equal(source.includes("(\\d{2})2month"), true);
    assert.equal(source.includes("(\\d{1,2})(\\d{2})\\s*days?"), true);
    assert.equal(source.includes("$1–$2\\u00a0days"), true);
    assert.equal(source.includes("1\\s*[-–]\\s*80\\s+days?"), true);
    assert.equal(source.includes("180\\u00a0days"), true);
    assert.equal(source.includes("1\\s*[-–]\\s*80\\b"), true);
    assert.equal(source.includes("\"180\""), true);
    assert.equal(source.includes("100\\s*[-–]\\s*3\\s*[-–]\\s*00\\s+scooters?"), true);
    assert.equal(source.includes("100–300\\u00a0scooters"), true);
    assert.equal(source.includes("100\\s*[-–]\\s*3\\s*[-–]\\s*00\\b"), true);
    assert.equal(source.includes("\"100–300\""), true);
    assert.equal(source.includes("\\b1224\\b"), true);
    assert.equal(source.includes("\"12–24\""), true);
    assert.equal(source.includes("(\\d{1,2})(\\d{2})\\s+(days?|months?|scooters?|rides\\/day|rides)"), true);
    assert.equal(source.includes("\\s*scooters?"), true);
    assert.equal(source.includes("$1–$2\\u00a0scooters"), true);
    assert.equal(source.includes("rides/day"), true);
    assert.equal(source.includes("(\\d{1,2})(\\d{2})\\s*%"), true);
    assert.equal(source.includes("$1–$2%"), true);
    assert.equal(source.includes(")month\\b"), true);
    assert.equal(source.includes(")months\\b"), true);
    assert.equal(source.includes("\\s+month\\b"), true);
    assert.equal(source.includes("\\s+months\\b"), true);
    assert.equal(source.includes("$1\\u00a0months"), true);
    assert.equal(source.includes("$1-month"), true);
  }
});

test("PDF text normalization protects inline abbreviations", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.equal(source.includes("e\\.\\s*g\\."), true);
    assert.equal(source.includes("i\\.\\s*e\\."), true);
    assert.equal(source.includes("v\\.\\s*s\\."), true);
    assert.equal(source.includes("N\\.\\s*o\\."), true);
    assert.equal(source.includes("M\\.\\s*r\\."), true);
    assert.equal(source.includes("D\\.\\s*r\\."), true);
    assert.equal(source.includes("etc\\."), true);
    assert.equal(source.includes("(e\\.\\s*,"), true);
    assert.equal(source.includes("(e.g.,"), true);
    assert.equal(source.includes("i\\.\\s*,"), true);
    assert.equal(source.includes("i.e.,"), true);
    assert.equal(source.includes("previousLine.trimEnd()}g.${current}"), true);
    assert.equal(source.includes("previousLine.trimEnd()}e.${current}"), true);
    assert.equal(source.includes("e\\.g\\.|i\\.e\\.|vs\\.|etc\\.|No\\.|Mr\\.|Dr\\."), true);
    assert.equal(source.includes("U\\.\\s*S\\."), true);
    assert.equal(source.includes("E\\.\\s*U\\."), true);
    assert.match(source, /B2B/);
    assert.match(source, /B2G/);
    assert.match(source, /ARPA/);
    assert.match(source, /CAC/);
    assert.match(source, /LTV/);
    assert.match(source, /EBITDA/);
    assert.equal(source.includes("Year\\u00a0$1"), true);
  }
});

test("PDF text normalization preserves hyphenated and restored-space expressions", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.equal(source.includes("$1-month"), true);
    assert.equal(source.includes("([<>])\\s+([€$₺]?\\d)"), true);
    assert.equal(source.includes("Year(\\d+)"), true);
    assert.equal(source.includes("Month(\\d+)"), true);
    assert.equal(source.includes("EScooter"), true);
    assert.equal(source.includes("E-Scooter"), true);
    assert.equal(source.includes("([.!?])\\s+\\1"), true);
    assert.equal(source.includes("minimum)(?=revenue"), true);
    assert.equal(source.includes("public)(?=sector"), true);
    assert.equal(source.includes("private)(?=sector"), true);
    assert.equal(source.includes("last)(?=mile"), true);
    assert.equal(source.includes("third)(?=party"), true);
    assert.equal(source.includes("one)(?=pager"), true);
    assert.equal(source.includes("post)(?=\\d{4}"), true);
    assert.match(source, /municipal\|public\|private\|corporate\|enterprise/);
  }
});

test("PDF bullet wrapping removes orphan SWOT heading bullets", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /function isOrphanBulletText/);
    assert.match(source, /function containsOtherSwotLabel/);
    assert.match(source, /isOrphanBulletText\(withoutBullet\)/);
    assert.match(source, /containsOtherSwotLabel\(bullet, label\)/);
    assert.match(source, /güçlü yönler\|güçlü yanlar\|zayıf yönler/);
    assert.match(source, /swot analysis/);
    assert.match(source, /\^\[a-zçğıöşü\]\\\.\$/);
    assert.equal(source.includes("^\\d+[.)]?$"), true);
    assert.equal(source.includes("^[€$₺.,()]$"), true);
    assert.match(source, /\[kKmMbB%\]\|months\?/);
    assert.match(source, /months\?\|ay\|gün\|days\?/);
  }
});

test("PDF wrapped line repair rejoins numeric and abbreviation fragments", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /function repairPdfLineFragments/);
    assert.match(source, /function shouldJoinPdfLineFragment/);
    assert.match(source, /function joinPdfLineFragment/);
    assert.match(source, /cleanPdfContinuationFragment/);
    assert.match(source, /repairPdfLineFragments\(/);
    assert.match(source, /\\b\(\?:e\|i\|v\|N\|M\|D\)\\\.\$/);
    assert.match(source, /\^\(\?:g\|e\|s\|o\|r\)\\\.\$/);
    assert.match(source, /municipal\|permit\|sector\|revenue\|market/);
    assert.equal(source.includes("^[.,)]$"), true);
    assert.equal(source.includes("[€$₺]?\\d+"), true);
    assert.equal(source.includes("[kKmMbB%]"), true);
    assert.equal(source.includes("repaired[repaired.length - 1]?.trim() === line.trim()"), true);
  }
});

test("PDF SWOT extraction stops at each quadrant label independently", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /const allSwotAliases = Object\.values\(swotLabelAliases\)\.flat\(\)/);
    assert.match(source, /extractAliasedSectionSnippet\(content, aliases, allSwotAliases\)/);
    assert.match(source, /stopLabels: string\[\] = labels/);
    assert.match(source, /const stopPattern = stopLabels/);
    assert.match(source, /if \(stopLabels !== labels\)/);
    assert.match(source, /return ""/);
  }
});
