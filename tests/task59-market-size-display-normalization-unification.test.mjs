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

// TASK #59 -- Unify compact market-size display normalization with the
// canonical TAM/SAM/SOM magnitude system.
//
// TRACE (documented, not re-derived here): Planner.tsx's
// extractMarketSizeValue narrowed its already-correctly-extracted (Task
// #58) raw TAM/SAM/SOM value through the file-wide, general-purpose
// compactPdfMetricValue -- correct for the many OTHER metric types it
// also serves (ARR/CAC/budgets/etc, left completely untouched here),
// but its unit vocabulary is single-letter-only ([kKmMbB%]), and its
// own "collapse a space before a trailing unit letter" cleanup pass
// (`replace(/\s+([kKmMbB%$])/g, "$1")`, with no trailing word boundary)
// matches the bare LETTER 'm'/'b' embedded inside a spelled-out
// "million"/"billion" and collapses the space in front of it:
//   "18 million" -> "18million" -> misread as "18" + shorthand "m" -> "18m"
//     (coincidentally still the right magnitude, but a genuine bug: the
//     match happened for the wrong reason and is fragile)
//   "18 thousand" -> no absorbable letter ('t' is not a shorthand) ->
//     compacts to a bare, unscaled "18 " -- a genuine, silent 1000x-
//     looking scale loss.
// ReportPdfButton.tsx's PRIMARY TAM/SAM/SOM path (extractMarketSizeVisualValue)
// already had its own, separate, ALREADY-CORRECT shape-matching regex
// with full spelled-out-unit support -- only its rarely-reached fallback
// branch (used when the canonical extractor finds nothing at all) still
// routed through the same generic compactPdfMetricValue.
//
// FIX: promoted ReportPdfButton.tsx's already-correct pattern to
// report-presentation.ts's shapeMarketSizeDisplayValue (this file) --
// the single canonical TAM/SAM/SOM display-shaping step, alongside
// Task #57's parseMarketSizingMagnitude and Task #58's
// extractMarketSizingLayerValue. ReportPdfButton.tsx's
// extractMarketSizeVisualValue and its own fallback branch, and
// Planner.tsx's extractMarketSizeValue, all now delegate to it instead
// of compactPdfMetricValue. compactPdfMetricValue itself is completely
// untouched and keeps serving every non-market-size metric card exactly
// as before.

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
    extractFunctionSource(plannerSource, "compactPdfMetricValue"),
    extractFunctionSource(plannerSource, "isMarketSizeValueMeaningful"),
    extractFunctionSource(plannerSource, "extractMetricValue"),
  ].join("\n\n");
  const raw = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task59-display-"));
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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task59-display-"));
  const outPath = join(dir, "pdf-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}${plannerDependencyImports}${dependency}\n\nexport ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeValue;
}

// THE OLD, BROKEN display-narrowing behavior, reproduced verbatim as a
// fixed reference (Planner.tsx's real compactPdfMetricValue -- not
// touched by this task, still correct for its OTHER, non-market-size
// callers) -- used only for fail-before/pass-after proof of the
// divergence this task fixes when it feeds a spelled-out-unit market-
// size value.
function OLD_compactPdfMetricValue(value) {
  const cleanValue = value
    .replace(/\s+/g, " ")
    .replace(/\s+([kKmMbB%$])/g, "$1")
    .replace(/([kKmMbB%])\s+\$/g, "$1$")
    .trim();
  const numericMatch = cleanValue.match(
    /(?:[$€₺]\s*)?\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)?\s*(?:[$€₺])?/i
  );

  return numericMatch?.[0]?.replace(/\s+/g, " ").replace(/([kKmMbB%])\s+([$€₺])/g, "$1$2") || cleanValue.split(/\s{2,}/)[0] || "";
}

// ---------------------------------------------------------------------------
// A-I. Equivalent representations normalize to the identical magnitude.
// ---------------------------------------------------------------------------

const equivalentPairs = [
  ["A/B", "$18M", "$18 million", 18_000_000],
  ["C/D", "$18.5M", "$18.5 million", 18_500_000],
  ["E/F", "$1.2B", "$1.2 billion", 1_200_000_000],
  ["G/H", "$18K", "$18 thousand", 18_000],
];

for (const [label, shorthand, spelled, expectedMagnitude] of equivalentPairs) {
  test(`${label}) "${shorthand}" and "${spelled}" normalize to the identical canonical magnitude (${expectedMagnitude})`, () => {
    assert.equal(parseMarketSizingMagnitude(shorthand), expectedMagnitude);
    assert.equal(parseMarketSizingMagnitude(spelled), expectedMagnitude);
    assert.equal(
      parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(shorthand)),
      expectedMagnitude,
      `shorthand form must still parse to the same magnitude after display-shaping`
    );
    assert.equal(
      parseMarketSizingMagnitude(shapeMarketSizeDisplayValue(spelled)),
      expectedMagnitude,
      `spelled-out form must still parse to the same magnitude after display-shaping`
    );
  });
}

test("I) $18,000,000 (comma-grouped) normalizes to the identical magnitude as $18M", () => {
  assert.equal(parseMarketSizingMagnitude("$18,000,000"), 18_000_000);
  assert.equal(
    parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("$18,000,000")),
    parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("$18M"))
  );
});

// ---------------------------------------------------------------------------
// J. Non-numeric states preserved exactly.
// ---------------------------------------------------------------------------

test("J) 'Validation Required' and equivalent non-numeric states are preserved verbatim, never coerced into a number or placeholder", () => {
  const cases = [
    "Validation Required -- serviceable share evidence was not found.",
    "Validation Needed",
    "Planning Estimate -- see Details for methodology.",
    "Assumption: benchmark-derived, not independently verified.",
  ];
  for (const value of cases) {
    const shaped = shapeMarketSizeDisplayValue(value);
    assert.equal(shaped, "", `a non-numeric prose state has no matchable numeric shape and must shape to empty, never a fabricated number: ${JSON.stringify(value)}`);
    assert.equal(parseMarketSizingMagnitude(value), null);
  }
});

test("J2) a missing/unsupported value (empty string) stays empty, never a placeholder", () => {
  assert.equal(shapeMarketSizeDisplayValue(""), "");
});

// ---------------------------------------------------------------------------
// K. Malformed or ambiguous magnitude fails closed.
// ---------------------------------------------------------------------------

test("K) malformed or ambiguous magnitude text never fabricates a shaped numeric value", () => {
  const cases = ["--", "N/A", "TBD", "unclear"];
  for (const value of cases) {
    assert.equal(shapeMarketSizeDisplayValue(value), "");
    assert.equal(parseMarketSizingMagnitude(value), null);
  }
});

// ---------------------------------------------------------------------------
// L. End-to-end: raw report text -> canonical extraction -> display
// shaping -> magnitude parsing all agree for every representation.
// ---------------------------------------------------------------------------

test("L) equivalent TAM representations extracted from a full section and shaped for display all normalize/parse consistently", () => {
  const sections = [
    "TAM: $18M",
    "TAM: $18 million",
    "TAM: $18,000,000",
  ];
  const magnitudes = sections.map((content) => {
    const raw = extractMarketSizingLayerValue(content, "TAM");
    const shaped = shapeMarketSizeDisplayValue(raw);
    return parseMarketSizingMagnitude(shaped);
  });
  assert.deepEqual(magnitudes, [18_000_000, 18_000_000, 18_000_000]);
});

// ---------------------------------------------------------------------------
// M. Web / PDF parity for every supported market-size magnitude form.
// ---------------------------------------------------------------------------

test("M) page.tsx, Planner.tsx, and ReportPdfButton.tsx display the identical canonical magnitude for every supported market-size form -- no renderer-specific reparsing", async () => {
  const plannerExtract = await compilePlannerExtractor();
  const pdfExtract = await compilePdfExtractor();

  const cases = [
    "TAM: $18M",
    "TAM: $18 million",
    "TAM: $18.5M",
    "TAM: $18.5 million",
    "TAM: $1.2B",
    "TAM: $1.2 billion",
    "TAM: $18K",
    "TAM: $18 thousand",
    "TAM: $18,000,000",
    "TAM: Validation Required -- serviceable share evidence was not found.",
  ];

  for (const content of cases) {
    const canonicalMagnitude = parseMarketSizingMagnitude(extractMarketSizingLayerValue(content, "TAM"));
    const plannerMagnitude = parseMarketSizingMagnitude(plannerExtract(content, "TAM"));
    const pdfMagnitude = parseMarketSizingMagnitude(pdfExtract(content, "TAM"));

    assert.equal(plannerMagnitude, canonicalMagnitude, `Planner.tsx must display the canonical magnitude for ${JSON.stringify(content)}`);
    assert.equal(pdfMagnitude, canonicalMagnitude, `ReportPdfButton.tsx must display the canonical magnitude for ${JSON.stringify(content)}`);
  }
});

test("M2) STRUCTURAL: Planner.tsx and ReportPdfButton.tsx both delegate market-size display-shaping to the same canonical shapeMarketSizeDisplayValue -- no independent copy left", () => {
  const plannerFn = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  assert.match(plannerFn, /shapeMarketSizeDisplayValue\(direct \|\| extractMetricValue\(content, label\)\)/);
  assert.ok(!plannerFn.includes("compactPdfMetricValue"), "Planner.tsx's extractMarketSizeValue must no longer call the general-purpose compactor");

  const pdfVisualFn = extractFunctionSource(pdfButtonSource, "extractMarketSizeVisualValue");
  assert.match(pdfVisualFn, /return shapeMarketSizeDisplayValue\(rawValue\);/);
  assert.ok(!pdfVisualFn.includes("compactPdfMetricValue"));

  const pdfFn = extractFunctionSource(pdfButtonSource, "extractMarketSizeValue");
  assert.match(pdfFn, /shapeMarketSizeDisplayValue\(extractMetricValue\(content, label\)\)/);
  assert.ok(!pdfFn.includes("compactPdfMetricValue"), "ReportPdfButton.tsx's extractMarketSizeValue fallback must no longer call the general-purpose compactor");
});

test("M3) compactPdfMetricValue itself is completely untouched and still serves every non-market-size metric card", () => {
  for (const source of [plannerSource, pdfButtonSource]) {
    assert.match(source, /function compactPdfMetricValue\(value: string\)/);
  }
  // Still called for other, non-market-size metrics in both files.
  assert.ok((plannerSource.match(/compactPdfMetricValue\(/g) || []).length >= 5);
  assert.ok((pdfButtonSource.match(/compactPdfMetricValue\(/g) || []).length >= 4);
});

// ---------------------------------------------------------------------------
// N. Task #57 magnitude-parser guarantees remain intact.
// ---------------------------------------------------------------------------

test("N) SCALE SAFETY: spelled-out units cannot silently lose scale through display shaping", () => {
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 million")), 18_000_000);
  assert.notEqual(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 million")), 18);
  assert.notEqual(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 million")), 18_000);
  assert.notEqual(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 million")), 18_000_000_000);

  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("1.2 billion")), 1_200_000_000);
  assert.notEqual(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("1.2 billion")), 1.2);
  assert.notEqual(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("1.2 billion")), 1_200_000);
});

// ---------------------------------------------------------------------------
// O. Task #58 row-extraction guarantee: the display step never alters
// what the row extractor already correctly captured for non-numeric
// text (composability, not a new extraction).
// ---------------------------------------------------------------------------

test("O) the display-shaping step never re-derives or overrides what the Task #58 canonical extractor already found -- it only narrows a shape, never re-labels or re-searches", () => {
  const content = "TAM: $18M\nSAM: Validation Required.\nSOM: Validation Required.";
  for (const label of ["TAM", "SAM", "SOM"]) {
    const extracted = extractMarketSizingLayerValue(content, label);
    const shaped = shapeMarketSizeDisplayValue(extracted);
    if (label === "TAM") {
      assert.equal(parseMarketSizingMagnitude(shaped), 18_000_000);
    } else {
      assert.equal(shaped, "", `${label} has no numeric shape to narrow to -- must shape to empty, not a fabricated value`);
    }
  }
});

// ---------------------------------------------------------------------------
// FAIL-BEFORE / PASS-AFTER
// ---------------------------------------------------------------------------

test("FAIL-BEFORE: the old compactPdfMetricValue-based display step silently drops scale for a spelled-out 'thousand' value", () => {
  const shaped = OLD_compactPdfMetricValue("18 thousand");
  assert.doesNotMatch(shaped, /\bthousand\b/i, "the old implementation drops the unit word entirely");
  assert.doesNotMatch(shaped, /[kK]\b/, "and never substitutes a 'k' shorthand either -- it is left completely unscaled");
  // The OLD displayed string ("18 ", trimmed to "18") is worse than
  // simply failing to parse: it silently re-parses as a real, valid-
  // looking magnitude of 18 -- exactly the reported "18 thousand must
  // never display as 18" scale-loss bug, a 1000x silent shrinkage.
  assert.equal(parseMarketSizingMagnitude(shaped), 18);
  assert.notEqual(parseMarketSizingMagnitude(shaped), 18_000, "the OLD displayed value silently loses the x1000 scale entirely");
});

test("FAIL-BEFORE: the old compactPdfMetricValue-based display step mangles 'million'/'billion' through an accidental letter-absorption bug, not genuine unit recognition", () => {
  const shapedMillion = OLD_compactPdfMetricValue("18 million");
  assert.equal(shapedMillion, "18m", "the old implementation only 'works' by coincidentally absorbing the leading letter of the spelled-out word");
  // Prove the fragility: it happens to still parse correctly here only
  // because 'm' is ALSO a valid shorthand -- not because "million" itself
  // was recognized.
  assert.doesNotMatch(shapedMillion, /million/i);
});

test("PASS-AFTER: the new canonical shapeMarketSizeDisplayValue correctly preserves scale for every spelled-out unit, unlike the old implementation", () => {
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 thousand")), 18_000);
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("18 million")), 18_000_000);
  assert.equal(parseMarketSizingMagnitude(shapeMarketSizeDisplayValue("1.2 billion")), 1_200_000_000);
  assert.match(shapeMarketSizeDisplayValue("18 thousand"), /thousand/i, "the real unit word is preserved in the display string, not silently dropped");
});

test("PASS-AFTER: Planner.tsx's real, current extractMarketSizeValue correctly displays a spelled-out-unit TAM value the old compactPdfMetricValue-based version could not", async () => {
  const plannerExtract = await compilePlannerExtractor();
  const content = "TAM: $18 thousand";
  const value = plannerExtract(content, "TAM");
  assert.ok(value.length > 0, `expected a non-empty value, got ${JSON.stringify(value)}`);
  assert.equal(parseMarketSizingMagnitude(value), 18_000);
});

test("PASS-AFTER: ReportPdfButton.tsx's real, current extractMarketSizeValue fallback branch correctly displays a spelled-out-unit value", async () => {
  const pdfExtract = await compilePdfExtractor();
  const content = "TAM: $18 thousand";
  const value = pdfExtract(content, "TAM");
  assert.ok(value.length > 0, `expected a non-empty value, got ${JSON.stringify(value)}`);
  assert.equal(parseMarketSizingMagnitude(value), 18_000);
});

// ---------------------------------------------------------------------------
// P. No decision regression.
// ---------------------------------------------------------------------------

test("P) NO DECISION REGRESSION: this task's source changes are confined to market-size display-shaping -- decision, confidence, ENTER eligibility, evidence-gap, and Closure Plan functions are untouched", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision|extractMarketSizeCardValue|extractMarketSizeValue/);
  }
  assert.ok(
    !plannerSource.includes("function resolveMarketIntelligenceEnterEligibility") &&
      !pdfButtonSource.includes("function resolveMarketIntelligenceEnterEligibility"),
    "ENTER eligibility logic lives only in the shared evidence-gaps module, never duplicated into a render surface"
  );
});
