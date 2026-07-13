import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePdfText,
  repairPdfLineFragments,
} from "../app/lib/pdf-normalization.mjs";

const pdfSurfaceFiles = [
  "components/Planner.tsx",
  "app/dashboard/[id]/ReportPdfButton.tsx",
];
const pdfNormalizerFile = "app/lib/pdf-normalization.mjs";
const pdfNormalizerSource = readFileSync(pdfNormalizerFile, "utf8");

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
  assert.match(pdfNormalizerSource, /function preservePdfInlineTokens/);
  assert.match(pdfNormalizerSource, /\(\\d\)\\.\\s\*\(\\d\)/);
  assert.match(pdfNormalizerSource, /\[€\$₺\]/);
  assert.match(pdfNormalizerSource, /\(\\d\(\?:\[\.,\]\\d\+\)\*\)\\s\*%/);
  assert.match(pdfNormalizerSource, /\(\[€\$₺\]\)\(\\d\(\?:\[\.,\]\\d\+\)\*\)\\s\*\(\[kKmMbB\]\)/);
  assert.match(pdfNormalizerSource, /months\?\|ay\|gün\|days\?/);
  assert.match(pdfNormalizerSource, /\\u00a0/);
});

test("PDF text normalization repairs malformed month expressions", () => {
  assert.equal(pdfNormalizerSource.includes("(\\d{2})(\\d{2})\\s*months?"), true);
  assert.equal(pdfNormalizerSource.includes("$1–$2\\u00a0months"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{1,2})(\\d{2})-month"), true);
  assert.equal(pdfNormalizerSource.includes("$1–$2-month"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{2})2month"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{2})(\\d{2})\\s*days?"), true);
  assert.equal(pdfNormalizerSource.includes("$1–$2\\u00a0days"), true);
  assert.equal(pdfNormalizerSource.includes("1\\s*[-–]\\s*80\\s+days?"), true);
  assert.equal(pdfNormalizerSource.includes("180\\u00a0days"), true);
  assert.equal(pdfNormalizerSource.includes("1\\s*[-–]\\s*80\\b"), true);
  assert.equal(pdfNormalizerSource.includes("\"180\""), true);
  assert.equal(pdfNormalizerSource.includes("100\\s*[-–]\\s*3\\s*[-–]\\s*00\\s+scooters?"), true);
  assert.equal(pdfNormalizerSource.includes("100–300\\u00a0scooters"), true);
  assert.equal(pdfNormalizerSource.includes("100\\s*[-–]\\s*3\\s*[-–]\\s*00\\b"), true);
  assert.equal(pdfNormalizerSource.includes("\"100–300\""), true);
  assert.equal(pdfNormalizerSource.includes("\\b1224\\b"), true);
  assert.equal(pdfNormalizerSource.includes("\"12–24\""), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{2})(\\d{2})\\s+(days?|months?|scooters?|rides\\/day|rides)"), true);
  assert.equal(pdfNormalizerSource.includes("\\s*scooters?"), true);
  assert.equal(pdfNormalizerSource.includes("$1–$2\\u00a0scooters"), true);
  assert.equal(pdfNormalizerSource.includes("rides/day"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{1,2})(\\d{2})\\s*%"), true);
  assert.equal(pdfNormalizerSource.includes("$1–$2%"), true);
  assert.equal(pdfNormalizerSource.includes(")month\\b"), true);
  assert.equal(pdfNormalizerSource.includes(")months\\b"), true);
  assert.equal(pdfNormalizerSource.includes("\\s+month\\b"), true);
  assert.equal(pdfNormalizerSource.includes("\\s+months\\b"), true);
  assert.equal(pdfNormalizerSource.includes("$1\\u00a0months"), true);
  assert.equal(pdfNormalizerSource.includes("$1-month"), true);
});

test("PDF text normalization protects inline abbreviations", () => {
  assert.equal(pdfNormalizerSource.includes("e\\.\\s*g\\."), true);
  assert.equal(pdfNormalizerSource.includes("i\\.\\s*e\\."), true);
  assert.equal(pdfNormalizerSource.includes("v\\.\\s*s\\."), true);
  assert.equal(pdfNormalizerSource.includes("N\\.\\s*o\\."), true);
  assert.equal(pdfNormalizerSource.includes("M\\.\\s*r\\."), true);
  assert.equal(pdfNormalizerSource.includes("D\\.\\s*r\\."), true);
  assert.equal(pdfNormalizerSource.includes("etc\\."), true);
  assert.equal(pdfNormalizerSource.includes("(e\\.\\s*,"), true);
  assert.equal(pdfNormalizerSource.includes("(e.g.,"), true);
  assert.equal(pdfNormalizerSource.includes("i\\.\\s*,"), true);
  assert.equal(pdfNormalizerSource.includes("i.e.,"), true);
  assert.equal(pdfNormalizerSource.includes("previousLine.trimEnd()}g.${current}"), true);
  assert.equal(pdfNormalizerSource.includes("previousLine.trimEnd()}e.${current}"), true);
  assert.equal(pdfNormalizerSource.includes("e\\.g\\.|i\\.e\\.|vs\\.|etc\\.|No\\.|Mr\\.|Dr\\."), true);
  assert.equal(pdfNormalizerSource.includes("U\\.\\s*S\\."), true);
  assert.equal(pdfNormalizerSource.includes("E\\.\\s*U\\."), true);
  assert.match(pdfNormalizerSource, /B2B/);
  assert.match(pdfNormalizerSource, /B2G/);
  assert.match(pdfNormalizerSource, /ARPA/);
  assert.match(pdfNormalizerSource, /CAC/);
  assert.match(pdfNormalizerSource, /LTV/);
  assert.match(pdfNormalizerSource, /EBITDA/);
  assert.equal(pdfNormalizerSource.includes("Year\\u00a0$1"), true);
});

test("PDF text normalization preserves hyphenated and restored-space expressions", () => {
  assert.equal(pdfNormalizerSource.includes("$1-month"), true);
  assert.equal(pdfNormalizerSource.includes("([<>])\\s+([€$₺]?\\d)"), true);
  assert.equal(pdfNormalizerSource.includes("Year(\\d+)"), true);
  assert.equal(pdfNormalizerSource.includes("Month(\\d+)"), true);
  assert.equal(pdfNormalizerSource.includes("EScooter"), true);
  assert.equal(pdfNormalizerSource.includes("E-Scooter"), true);
  assert.equal(pdfNormalizerSource.includes("([.!?])\\s+\\1"), true);
  assert.equal(pdfNormalizerSource.includes("minimum)(?=revenue"), true);
  assert.equal(pdfNormalizerSource.includes("public)(?=sector"), true);
  assert.equal(pdfNormalizerSource.includes("private)(?=sector"), true);
  assert.equal(pdfNormalizerSource.includes("last)(?=mile"), true);
  assert.equal(pdfNormalizerSource.includes("third)(?=party"), true);
  assert.equal(pdfNormalizerSource.includes("one)(?=pager"), true);
  assert.equal(pdfNormalizerSource.includes("well)(?=funded"), true);
  assert.equal(pdfNormalizerSource.includes("post)(?=\\d{4}"), true);
  assert.match(pdfNormalizerSource, /municipal\|public\|private\|corporate\|enterprise/);
});

test("PDF OCR normalizer covers final production token examples", () => {
  assert.equal(pdfNormalizerSource.includes("Year(\\d+)"), true);
  assert.equal(pdfNormalizerSource.includes("Month(\\d+)"), true);
  assert.equal(pdfNormalizerSource.includes("last)(?=mile"), true);
  assert.equal(pdfNormalizerSource.includes("public)(?=sector"), true);
  assert.equal(pdfNormalizerSource.includes("minimum)(?=revenue"), true);
  assert.equal(pdfNormalizerSource.includes("one)(?=pager"), true);
  assert.equal(pdfNormalizerSource.includes("post)(?=\\d{4}"), true);
  assert.equal(pdfNormalizerSource.includes("well)(?=funded"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d+(?:[.,]\\d+)*)month"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d+(?:[.,]\\d+)*)months"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d+)(?=(?:municipal"), true);
  assert.equal(pdfNormalizerSource.includes("(\\d{1,2})(\\d{2})-month"), true);
  assert.equal(pdfNormalizerSource.includes("100\\s*[-–]\\s*3\\s*[-–]\\s*00"), true);
  assert.equal(pdfNormalizerSource.includes("1\\s*[-–]\\s*80\\s+days?"), true);
});

test("PDF OCR normalizer fixes final production artifact list", () => {
  const normalize = (value) => normalizePdfText(value).replace(/\u00a0/g, " ");

  assert.equal(normalize("lastmile delivery"), "last-mile delivery");
  assert.equal(normalize("publicsector procurement"), "public sector procurement");
  assert.equal(normalize("minimumrevenue guarantee"), "minimum revenue guarantee");
  assert.equal(normalize("wellfunded incumbent"), "well-funded incumbent");
  assert.equal(normalize("onepager brief"), "one-pager brief");
  assert.equal(normalize("thirdparty operator"), "third-party operator");
  assert.equal(normalize("EScooter permits"), "E-Scooter permits");
  assert.equal(normalize("post2026 regulation"), "post-2026 regulation");
  assert.equal(normalize("3month pilot"), "3-month pilot");
  assert.equal(normalize("12month runway"), "12-month runway");
  assert.equal(normalize("1224 month validation"), "12–24 months validation");
  assert.equal(normalize("1224-month contract"), "12–24-month contract");
  assert.equal(normalize("50müşteri"), "50 müşteri");
  assert.equal(normalize("10müşteri"), "10 müşteri");
  assert.equal(normalize("22Müşteri"), "22 Müşteri");
  assert.equal(normalize("KPI value 30b"), "KPI value 30B");
  assert.equal(
    normalize("fiyat sıkıştırma by yerel danışmanlar"),
    "yerel danışmanların fiyat baskısı"
  );
});

test("PDF bullet wrapping removes orphan SWOT heading bullets", () => {
  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /function isOrphanBulletText/);
    assert.match(source, /function containsOtherSwotLabel/);
    assert.match(source, /repairPdfLineFragments\([\s\S]*isOrphanBulletText/);
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
  assert.match(pdfNormalizerSource, /function repairPdfLineFragments/);
  assert.match(pdfNormalizerSource, /function shouldJoinPdfLineFragment/);
  assert.match(pdfNormalizerSource, /function joinPdfLineFragment/);
  assert.match(pdfNormalizerSource, /cleanPdfContinuationFragment/);
  assert.match(pdfNormalizerSource, /\\b\(\?:e\|i\|v\|N\|M\|D\)\\\.\$/);
  assert.match(pdfNormalizerSource, /\^\(\?:g\|e\|s\|o\|r\)\\\.\$/);
  assert.match(pdfNormalizerSource, /municipal\|permit\|sector\|revenue\|market/);
  assert.equal(pdfNormalizerSource.includes("^[.,)]$"), true);
  assert.equal(pdfNormalizerSource.includes("[€$₺]?\\d+"), true);
  assert.equal(pdfNormalizerSource.includes("[kKmMbB%]"), true);
  assert.equal(pdfNormalizerSource.includes("repaired[repaired.length - 1]?.trim() === line.trim()"), true);

  for (const file of pdfSurfaceFiles) {
    const source = readFileSync(file, "utf8");

    assert.match(source, /from "@\/app\/lib\/pdf-normalization\.mjs"/);
    assert.match(source, /repairPdfLineFragments\(/);
    assert.doesNotMatch(source, /function normalizePdfText/);
    assert.doesNotMatch(source, /function preservePdfInlineTokens/);
  }
});

test("PDF final rendered text path applies shared OCR normalization before orphan filtering", () => {
  const renderTextPath = (content) =>
    repairPdfLineFragments(
      content.split("\n").flatMap((rawLine) => {
        const line = normalizePdfText(rawLine);
        return line ? [line] : [""];
      }),
      (value) =>
        /^(swot analysis|strengths|weaknesses|opportunities|threats|güçlü yönler|güçlü yanlar|zayıf yönler|zayıflıklar|fırsatlar|tehditler)$/i.test(
          value.trim()
        ) ||
        /^[a-zçğıöşü]\.$/i.test(value.trim()) ||
        /^\d+[.)]?$/.test(value.trim()) ||
        /^[€$₺.,()]$/.test(value.trim()) ||
        /^\d+(?:[.,]\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)$/i.test(value.trim())
    )
      .join("\n")
      .replace(/\u00a0/g, " ");

  const output = renderTextPath([
    "Year1 and Month12 include lastmile publicsector minimumrevenue wellfunded onepager post2026 terms.",
    "2municipal pilots need 3month validation, 12month runway and 14months follow-up.",
    "Planning range is 1224-month, fleet is 100–3–00, and permitting takes 1–80 days.",
    "• Payback: 4.",
    "• 6months",
    "• Revenue $2.",
    "• 6M",
    "(e.",
    "• , tighter vehicle requirements)",
  ].join("\n"));

  assert.match(output, /Year 1/);
  assert.match(output, /Month 12/);
  assert.match(output, /last-mile/);
  assert.match(output, /public sector/);
  assert.match(output, /minimum revenue/);
  assert.match(output, /well-funded/);
  assert.match(output, /one-pager/);
  assert.match(output, /post-2026/);
  assert.match(output, /2 municipal/);
  assert.match(output, /3-month/);
  assert.match(output, /12-month/);
  assert.match(output, /14 months/);
  assert.match(output, /12–24-month/);
  assert.match(output, /100–300/);
  assert.match(output, /180 days/);
  assert.match(output, /Payback: 4\.6 months/);
  assert.match(output, /Revenue \$2\.6M/);
  assert.match(output, /\(e\.g\., tighter vehicle requirements\)/);
  assert.doesNotMatch(output, /4\.\n6/);
  assert.doesNotMatch(output, /\$2\.\n6M/);
  assert.doesNotMatch(output, /e\.\ng\./);
});

test("PDF wrapped line repair rejoins isolated OCR continuation words", () => {
  const output = repairPdfLineFragments([
    "last",
    "mile",
    "well",
    "funded",
    "minimum",
    "revenue",
    "one",
    "pager",
    "third",
    "party",
  ]).join("\n");

  assert.match(output, /last-mile/);
  assert.match(output, /well-funded/);
  assert.match(output, /minimum revenue/);
  assert.match(output, /one-pager/);
  assert.match(output, /third-party/);
  assert.doesNotMatch(output, /\nmile\b/);
  assert.doesNotMatch(output, /\nfunded\b/);
  assert.doesNotMatch(output, /\nrevenue\b/);
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
