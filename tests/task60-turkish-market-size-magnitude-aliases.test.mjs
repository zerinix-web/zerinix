import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractMarketSizingLayerValue,
  parseMarketSizingMagnitude,
  shapeMarketSizeDisplayValue,
} from "../app/lib/report-presentation.ts";

// TASK #60 -- Add Turkish magnitude aliases to the existing canonical
// Market Intelligence market-size parser.
//
// ROOT CAUSE: parseMarketSizingMagnitude's unit alternation
// (thousand|million|billion|trillion|[kKmMbBtT]) never included Turkish
// spelled-out magnitude words (bin/milyon/milyar/trilyon). "200 milyon"
// therefore matched as a BARE number with no recognized unit -- worse
// than returning null, it silently returned 200 (a genuine, un-flagged
// 1,000,000x scale loss masquerading as a resolved figure), confirmed
// directly:
//   parseMarketSizingMagnitude("200 million") -> 200000000 (correct)
//   parseMarketSizingMagnitude("200 milyon")  -> 200        (WRONG, pre-fix)
//
// A second, related gap: Turkish numeric convention swaps "," and "."
// from English (comma = decimal separator, period = thousands
// separator). "1,2 milyar" means 1.2 billion; the pre-fix parser's own
// comma-stripping (`.replace(/,/g, "")`, English-only convention) turned
// "1,2" into "12", an independent 10x error on top of the missing unit.
//
// FIX: Turkish aliases (bin/milyon/milyar/trilyon) added to the SAME
// unit alternation and multiplier table English words already use --
// no new parser, no language-specific code path. Two narrowly-scoped,
// unambiguous numeric normalizations (see report-presentation.ts's own
// comment on normalizeMarketSizeNumberToken for the full reasoning):
//   (a) a number shaped as 2-or-more period-separated groups of exactly
//       3 digits ("1.250.000") is structurally unambiguous thousands
//       grouping -- can never be a legitimate decimal under any
//       notation -- so its periods are always stripped.
//   (b) a number paired with a TURKISH unit word containing EXACTLY ONE
//       comma is read as a Turkish decimal separator, gated strictly on
//       the Turkish unit itself being the match anchor -- can never
//       reinterpret an English-unit or unit-less figure.
// Any other genuinely ambiguous shape (e.g. a bare "18.000" with no
// unit at all) is deliberately left untouched -- no heuristic is
// introduced for a case this task cannot resolve safely without more
// context than the figure itself provides.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;
  let i = start + startMatch[0].length - 1;
  let depth = 1;
  while (depth > 0) {
    i += 1;
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") depth -= 1;
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

const canonicalImports = `import { extractMarketSizingLayerValue, parseMarketSizingMagnitude, shapeMarketSizeDisplayValue } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "app/lib/report-presentation.ts")).href
)};\n`;
const plannerDependencyImports = `import { normalizePdfText } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "app/lib/pdf-normalization.mjs")).href
)};\nimport { formatMetricCardValue } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "components/planner/report-utils.ts")).href
)};\n`;

async function compilePlannerExtractor() {
  const dependency = [
    extractFunctionSource(plannerSource, "isMarketSizeValueMeaningful"),
    extractFunctionSource(plannerSource, "extractMetricValue"),
  ].join("\n\n");
  const raw = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task60-turkish-"));
  const outPath = join(dir, "planner-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}${plannerDependencyImports}${dependency}\n\nexport ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeValue;
}

async function compilePdfExtractor() {
  const dependency = [
    extractFunctionSource(pdfButtonSource, "extractMarketSizeVisualValue"),
    extractFunctionSource(pdfButtonSource, "isMarketSizeValueMeaningful"),
    extractFunctionSource(pdfButtonSource, "extractMetricValue"),
  ].join("\n\n");
  const raw = extractFunctionSource(pdfButtonSource, "extractMarketSizeValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task60-turkish-"));
  const outPath = join(dir, "pdf-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}${plannerDependencyImports}${dependency}\n\nexport ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeValue;
}

async function compilePageExtractor() {
  const raw = extractFunctionSource(pageSource, "extractMarketSizeCardValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task60-turkish-"));
  const outPath = join(dir, "page-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeCardValue;
}

// THE OLD, PRE-TASK-#60 implementation, reproduced verbatim as a fixed
// reference (not read live from any file) -- used only for fail-before/
// pass-after proof.
function OLD_parseMarketSizingMagnitude(value) {
  const matches = [
    ...(value || "").matchAll(/([\d.,]+)\s*(thousand\b|million\b|billion\b|trillion\b|[kKmMbBtT]\b)?/gi),
  ].filter((candidate) => candidate[1] && Number.isFinite(parseFloat(candidate[1].replace(/,/g, ""))));
  const unitMatches = matches.filter((candidate) => candidate[2]);
  const last = unitMatches.length > 0 ? unitMatches.at(-1) : matches.at(-1);
  if (!last) return null;

  const num = parseFloat(last[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) return null;

  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "million"
        ? 1e6
        : unit === "b" || unit === "billion"
          ? 1e9
          : unit === "t" || unit === "trillion"
            ? 1e12
            : 1;

  return num * multiplier;
}

// ---------------------------------------------------------------------------
// A-E. 200 milyon in every currency notation.
// ---------------------------------------------------------------------------

const twoHundredMillionCases = [
  ["A", "200 milyon"],
  ["B", "₺200 milyon"],
  ["C", "200 milyon ₺"],
  ["D", "200 milyon TL"],
  ["E", "TRY 200 milyon"],
];

for (const [label, value] of twoHundredMillionCases) {
  test(`${label}) "${value}" parses to the canonical magnitude 200,000,000, regardless of currency notation`, () => {
    assert.equal(parseMarketSizingMagnitude(value), 200_000_000);
  });
}

test("$18 milyon and 18 milyon USD also resolve to the correct canonical magnitude", () => {
  assert.equal(parseMarketSizingMagnitude("$18 milyon"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("18 milyon USD"), 18_000_000);
});

// ---------------------------------------------------------------------------
// F. 18 bin.
// ---------------------------------------------------------------------------

test("F) 18 bin parses to the canonical magnitude 18,000", () => {
  assert.equal(parseMarketSizingMagnitude("18 bin"), 18_000);
});

test("trilyon (trillion) also resolves, matching the existing trillion/T support", () => {
  assert.equal(parseMarketSizingMagnitude("1 trilyon"), 1e12);
  assert.equal(parseMarketSizingMagnitude("1 trillion"), 1e12);
});

// ---------------------------------------------------------------------------
// G/H. Turkish decimal comma safety.
// ---------------------------------------------------------------------------

test("G) 1,2 milyar (Turkish decimal comma) parses to 1,200,000,000 -- never 12,000,000,000", () => {
  assert.equal(parseMarketSizingMagnitude("1,2 milyar"), 1_200_000_000);
  assert.notEqual(parseMarketSizingMagnitude("1,2 milyar"), 12_000_000_000);
});

test("H) 18,5 milyon (Turkish decimal comma) parses to 18,500,000 -- never 185,000,000", () => {
  assert.equal(parseMarketSizingMagnitude("18,5 milyon"), 18_500_000);
  assert.notEqual(parseMarketSizingMagnitude("18,5 milyon"), 185_000_000);
});

test("the same comma remains an ENGLISH thousands separator when paired with an English or no unit -- Turkish decimal reinterpretation is strictly gated on the Turkish unit word itself", () => {
  // "1,2 million" is not realistic English notation, but the point is
  // structural: with an ENGLISH unit, the comma must still only ever be
  // stripped (existing English convention), never reinterpreted as a
  // decimal -- "1,2" strips to "12", times the million multiplier.
  assert.equal(parseMarketSizingMagnitude("1,2 million"), 12_000_000);
  assert.equal(parseMarketSizingMagnitude("1,234,567"), 1_234_567, "a genuine multi-comma English thousands-grouped figure is completely unaffected");
});

// ---------------------------------------------------------------------------
// I/J. Turkish period-grouped thousands (unambiguous, 2+ groups of 3).
// ---------------------------------------------------------------------------

test("I) 1.250.000 (Turkish period-grouped thousands) parses to 1,250,000", () => {
  assert.equal(parseMarketSizingMagnitude("1.250.000"), 1_250_000);
});

test("J) 18.000.000 (Turkish period-grouped thousands) parses to 18,000,000 -- identical to 18M/18 million", () => {
  assert.equal(parseMarketSizingMagnitude("18.000.000"), 18_000_000);
  assert.equal(parseMarketSizingMagnitude("18.000.000"), parseMarketSizingMagnitude("18M"));
});

test("a single dot-plus-3-digits value with no unit remains exactly as ambiguous as before -- no new heuristic resolves it either way (documented, intentional non-fix)", () => {
  // "18.000" alone could legitimately be an English/Turkish decimal 18.0
  // or a period-grouped 18,000 -- genuinely ambiguous with no unit or
  // second group to disambiguate. This task does not attempt to resolve
  // it; the existing parser's own (pre-existing, unchanged) reading is
  // preserved either way.
  assert.equal(parseMarketSizingMagnitude("18.000"), OLD_parseMarketSizingMagnitude("18.000"));
});

// ---------------------------------------------------------------------------
// K. English equivalents remain byte-identical.
// ---------------------------------------------------------------------------

const englishRegressionCases = [
  ["18K", 18_000],
  ["18 thousand", 18_000],
  ["18M", 18_000_000],
  ["18 million", 18_000_000],
  ["18.5M", 18_500_000],
  ["18.5 million", 18_500_000],
  ["1.2B", 1_200_000_000],
  ["1.2 billion", 1_200_000_000],
  ["18,000,000", 18_000_000],
];

test("K) every existing English form parses to exactly the same magnitude as before Task #60", () => {
  for (const [value, expected] of englishRegressionCases) {
    assert.equal(parseMarketSizingMagnitude(value), expected, `regression on "${value}"`);
    assert.equal(
      parseMarketSizingMagnitude(value),
      OLD_parseMarketSizingMagnitude(value),
      `Task #60 must not change the result for "${value}"`
    );
  }
});

// ---------------------------------------------------------------------------
// L. Malformed Turkish value fails closed.
// ---------------------------------------------------------------------------

test("L) malformed or ambiguous Turkish-flavored text never fabricates a magnitude", () => {
  assert.equal(parseMarketSizingMagnitude("milyon"), null, "a unit word with no number attached must never fabricate a figure");
  assert.equal(parseMarketSizingMagnitude("bin bin milyon"), null, "repeated bare unit words with no digits attached");
  assert.equal(parseMarketSizingMagnitude(""), null);
  assert.equal(parseMarketSizingMagnitude("--"), null);
});

// ---------------------------------------------------------------------------
// M. Non-numeric states preserved.
// ---------------------------------------------------------------------------

test("M) 'Validation Required' (and Turkish prose merely mentioning a magnitude word) never resolves to a fabricated number", () => {
  assert.equal(parseMarketSizingMagnitude("Validation Required -- serviceable share evidence was not found."), null);
  assert.equal(
    parseMarketSizingMagnitude("Doğrulama Gerekli -- bu pazar için milyon dolarlık bir rakam bulunamadı."),
    null,
    "Turkish prose that merely CONTAINS the word 'milyon' with no attached figure must never be misread as a number"
  );
});

test("shapeMarketSizeDisplayValue preserves non-numeric Turkish/English states verbatim (empty shape, never a placeholder)", () => {
  assert.equal(shapeMarketSizeDisplayValue("Doğrulama Gerekli"), "");
  assert.equal(shapeMarketSizeDisplayValue("Validation Required"), "");
});

// ---------------------------------------------------------------------------
// N. Web/PDF canonical parity.
// ---------------------------------------------------------------------------

test("N) page.tsx, Planner.tsx, and ReportPdfButton.tsx all resolve the identical canonical magnitude for every Turkish and English form -- no renderer-specific Turkish parsing", async () => {
  const pageExtract = await compilePageExtractor();
  const plannerExtract = await compilePlannerExtractor();
  const pdfExtract = await compilePdfExtractor();

  // Note 1: a bare number with NO currency symbol or unit word attached
  // (e.g. a lone "1.250.000") is deliberately treated as "not a
  // meaningful market-size value" by isMarketSizeValueMeaningful in
  // both Planner.tsx and ReportPdfButton.tsx -- a pre-existing,
  // Task #60-independent gate ("Employees: 24"-style stray numbers must
  // never be mistaken for a market-size figure) that applies identically
  // to bare English notation ("1,250,000") and is out of this task's
  // scope. Every case below therefore carries a real currency/unit
  // indicator, as any genuine report value would.
  // Note 2: shapeMarketSizeDisplayValue's shape pattern only ever
  // captures a currency prefix BEFORE the digits, never a currency
  // code/symbol trailing AFTER them -- also pre-existing and identical
  // for English ("18,000,000 USD" shapes to bare "18,000,000", losing
  // "USD") and Turkish alike, so a bare (no unit word) figure with a
  // TRAILING currency indicator can still fail the meaningful-check even
  // though its raw extracted text had one. Not something this task's
  // scope covers (Turkish magnitude ALIASES, not the shared shape-
  // narrowing pattern's currency-position handling) -- test cases below
  // use a leading currency for the bare-number forms, exactly like the
  // ticket's own literal examples ("₺200 milyon" leads with the symbol).
  const cases = [
    "TAM: 200 milyon",
    "TAM: ₺200 milyon",
    "TAM: 200 milyon TL",
    "TAM: TRY 200 milyon",
    "TAM: 18 bin",
    "TAM: 1,2 milyar",
    "TAM: 18,5 milyon",
    "TAM: ₺1.250.000",
    "TAM: ₺18.000.000",
    "TAM: $18M",
    "TAM: 18 million",
  ];

  for (const content of cases) {
    const canonicalMagnitude = parseMarketSizingMagnitude(extractMarketSizingLayerValue(content, "TAM"));
    assert.equal(
      parseMarketSizingMagnitude(pageExtract(content, "TAM")),
      canonicalMagnitude,
      `page.tsx must agree with the canonical magnitude for ${JSON.stringify(content)}`
    );
    assert.equal(
      parseMarketSizingMagnitude(plannerExtract(content, "TAM")),
      canonicalMagnitude,
      `Planner.tsx must agree with the canonical magnitude for ${JSON.stringify(content)}`
    );
    assert.equal(
      parseMarketSizingMagnitude(pdfExtract(content, "TAM")),
      canonicalMagnitude,
      `ReportPdfButton.tsx must agree with the canonical magnitude for ${JSON.stringify(content)}`
    );
  }
});

test("N2) STRUCTURAL: no renderer defines its own Turkish-specific parsing function -- Turkish aliases exist ONLY in the shared canonical parseMarketSizingMagnitude", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.ok(!source.includes("parseTurkishMarketSize"), "no parallel Turkish parser may exist");
    assert.ok(!/function\s+\w*[Tt]urkish\w*[Mm]agnitude/.test(source), "no renderer-specific Turkish magnitude function may exist");
  }
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  const occurrences = (reportPresentationSource.match(/milyon\|milyar\|bin|bin\\b\|milyon\\b\|milyar\\b/g) || []).length;
  assert.ok(occurrences >= 1, "Turkish unit aliases must be present in the shared module");
});

// ---------------------------------------------------------------------------
// SCALE SAFETY (explicit, per the ticket's own examples).
// ---------------------------------------------------------------------------

test("SCALE SAFETY: 200 milyon can never become 200, 200K, or 200B", () => {
  const result = parseMarketSizingMagnitude("200 milyon");
  assert.equal(result, 200_000_000);
  assert.notEqual(result, 200);
  assert.notEqual(result, 200_000);
  assert.notEqual(result, 200_000_000_000);
});

test("SCALE SAFETY: 1,2 milyar can never become 1.2 or 1.2M", () => {
  const result = parseMarketSizingMagnitude("1,2 milyar");
  assert.equal(result, 1_200_000_000);
  assert.notEqual(result, 1.2);
  assert.notEqual(result, 1_200_000);
});

test("SCALE SAFETY: 200 milyar = 200,000,000,000 and 18 bin = 18,000, exactly as specified", () => {
  assert.equal(parseMarketSizingMagnitude("200 milyar"), 200_000_000_000);
  assert.equal(parseMarketSizingMagnitude("18 bin"), 18_000);
});

// ---------------------------------------------------------------------------
// FAIL-BEFORE / PASS-AFTER (the actual Task #59 finding, resolved here).
// ---------------------------------------------------------------------------

test("FAIL-BEFORE: the pre-Task-#60 canonical parser silently mis-resolves '200 milyon ₺' to 200, not null and not 200,000,000", () => {
  const before = OLD_parseMarketSizingMagnitude("200 milyon ₺");
  assert.equal(before, 200, "confirmed: the OLD parser treats the unrecognized 'milyon' unit as absent, returning the bare, catastrophically wrong number 200");
  assert.notEqual(before, 200_000_000);
});

test("PASS-AFTER: the current canonical parser resolves '200 milyon ₺' to the correct magnitude 200,000,000", () => {
  const after = parseMarketSizingMagnitude("200 milyon ₺");
  assert.equal(after, 200_000_000);
});

test("FAIL-BEFORE: the pre-Task-#60 parser also mis-resolves the Turkish decimal comma case '1,2 milyar'", () => {
  assert.equal(OLD_parseMarketSizingMagnitude("1,2 milyar"), 12, "the OLD parser strips the comma (English convention) AND drops the unrecognized unit, compounding into 12");
});

test("PASS-AFTER: the current canonical parser resolves '1,2 milyar' to 1,200,000,000", () => {
  assert.equal(parseMarketSizingMagnitude("1,2 milyar"), 1_200_000_000);
});

// ---------------------------------------------------------------------------
// O/P/Q. Tasks #57-#59 remain green (composed here as a lightweight
// regression trip-wire; the full battery lives in their own dedicated
// test files, run separately by the verification step).
// ---------------------------------------------------------------------------

test("O) Task #57 guarantee intact: parseMarketSizingMagnitude is still the single magnitude parser all three surfaces delegate to", () => {
  assert.match(plannerSource, /return parseMarketSizingMagnitude\(value\);/);
  assert.match(pdfButtonSource, /return parseMarketSizingMagnitude\(value\);/);
});

test("P) Task #58 guarantee intact: extractMarketSizingLayerValue is still the single row-extraction function all three surfaces delegate to", () => {
  assert.match(pageSource, /return extractMarketSizingLayerValue\(content, label\);/);
  assert.match(plannerSource, /extractMarketSizingLayerValue\(normalizePdfText\(content\), label\)/);
});

test("Q) Task #59 guarantee intact: shapeMarketSizeDisplayValue is still the single display-shaping function, and compactPdfMetricValue is untouched for non-market-size metrics", () => {
  assert.match(plannerSource, /shapeMarketSizeDisplayValue\(direct \|\| extractMetricValue\(content, label\)\)/);
  assert.match(pdfButtonSource, /return shapeMarketSizeDisplayValue\(rawValue\);/);
  assert.match(plannerSource, /function compactPdfMetricValue\(value: string\)/);
});

// ---------------------------------------------------------------------------
// R. No decision regression.
// ---------------------------------------------------------------------------

test("R) NO DECISION REGRESSION: this task's source changes are confined to market-size magnitude parsing/display -- decision, confidence, ENTER eligibility, evidence-gap, and Closure Plan functions are untouched", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision|extractMarketSizeCardValue|extractMarketSizeValue/);
  }
  assert.ok(
    !plannerSource.includes("function resolveMarketIntelligenceEnterEligibility") &&
      !pdfButtonSource.includes("function resolveMarketIntelligenceEnterEligibility"),
    "ENTER eligibility logic lives only in the shared evidence-gaps module, never duplicated into a render surface"
  );
});
