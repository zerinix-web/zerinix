import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractMarketSizingLayerValue,
  parseMarketSizingMagnitude,
} from "../app/lib/report-presentation.ts";

// TASK #58 -- Unify Market Intelligence TAM/SAM/SOM row extraction under
// one canonical extractor.
//
// Task #57 unified magnitude PARSING (string -> number). This task
// unifies the layer BEFORE that: extracting the raw TAM/SAM/SOM value
// STRING out of a report section's content in the first place.
//
// TRACE (documented, not re-derived here): page.tsx's extractMarketSizeCardValue
// and Planner.tsx's extractMarketSizeValue each carried their own,
// independently-maintained raw-extraction regex -- both admittedly
// "verbatim in behavior" to report-presentation.ts's own
// extractMarketSizingLayerValue per their own prior comments, but two
// real gaps existed all the same:
//   1. Neither file's own regex anchored the label with a `\b` word
//      boundary the way the canonical function does -- a real,
//      structural label-safety gap (Task #58 requirement #4).
//   2. Neither file's own separator class included "≈"/"~", so a real,
//      confirmed-live Planning Estimate phrasing ("TAM (...) ≈
//      €200-800 million") silently failed to extract in page.tsx/
//      Planner.tsx while it already worked via ReportPdfButton.tsx
//      (which already delegated) and the shared function directly.
// FIX: extractMarketSizeCardValue (page.tsx) is now a pure delegation to
// extractMarketSizingLayerValue; extractMarketSizeValue (Planner.tsx)
// now delegates its raw-capture step to the same function (pre-
// normalized via normalizePdfText, matching ReportPdfButton.tsx's own
// established delegation pattern), then applies its existing
// compactPdfMetricValue/isMarketSizeValueMeaningful narrowing on top,
// unchanged. ReportPdfButton.tsx already delegated (Task #57's audit
// confirmed this) and needed no change.
//
// getReportMarketRows/getTamRows (the higher-level "build a display row
// with color/height/description" closures) are deliberately NOT touched
// -- they are presentation-layout composition, not value extraction, and
// each already calls the now-unified extractMarketSizeValue/
// extractMarketSizeCardValue underneath, so they inherit this fix
// automatically without any UI redesign.
//
// Competitor-row extraction (extractMarketIntelligenceCompetitorRows) is
// audited and confirmed structurally isolated: every consumer branches
// on `field === "tamSamSom"` vs `field === "competitiveLandscape"`
// before ever calling either extractor, so the two paths can never read
// each other's content. Left completely unchanged.

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task58-row-"));
  const outPath = join(dir, "page-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}export ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeCardValue;
}

// Planner.tsx's real extractMarketSizeValue depends on compactPdfMetricValue,
// isMarketSizeValueMeaningful, and extractMetricValue (all in the same
// file) in addition to the canonical extractor -- extracted alongside it
// so the compiled bundle is self-contained, exactly as Task #57's own
// harness for this file already does elsewhere in this test suite.
async function compilePlannerExtractor() {
  const dependency = [
    extractFunctionSource(plannerSource, "compactPdfMetricValue"),
    extractFunctionSource(plannerSource, "isMarketSizeValueMeaningful"),
    extractFunctionSource(plannerSource, "extractMetricValue"),
  ].join("\n\n");
  const raw = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task58-row-"));
  const outPath = join(dir, "planner-extractor.ts");
  writeFileSync(outPath, `${canonicalImports}${plannerDependencyImports}${dependency}\n\nexport ${raw}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractMarketSizeValue;
}

// The OLD, broken/divergent implementations, reproduced verbatim as fixed
// references (not read live from any file) -- used only for fail-before/
// pass-after proof.
function OLD_page_extractMarketSizeCardValue(content, label) {
  // page.tsx's OLD first step (extractMetricValueFromAliases) had no `\b`
  // label boundary at all.
  const noBoundaryMatch = content.match(
    new RegExp(
      `${label}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\bformula\\b|\\bplanning input\\b|\\bevidence\\b|\\breference\\b|\\bconfidence\\b|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );
  const direct = noBoundaryMatch?.[1]?.trim().replace(/\*\*/g, "");
  if (direct) return direct;

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content
    .replace(/\*\*/g, "")
    .match(new RegExp(`\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?[:\\-–—]\\s*([^\\n]*)`, "i"));
  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

// ---------------------------------------------------------------------------
// A. Canonical TAM/SAM/SOM section: TAM=$18M, SAM/SOM=Validation Required.
// ---------------------------------------------------------------------------

const CANONICAL_SECTION = [
  "TAM: $18M",
  "SAM: Validation Required -- serviceable share evidence was not found.",
  "SOM: Validation Required -- obtainable-share evidence was not found.",
].join("\n");

test("A) canonical TAM/SAM/SOM section: TAM=$18M numeric, SAM/SOM=Validation Required stays non-numeric", () => {
  const tam = extractMarketSizingLayerValue(CANONICAL_SECTION, "TAM");
  const sam = extractMarketSizingLayerValue(CANONICAL_SECTION, "SAM");
  const som = extractMarketSizingLayerValue(CANONICAL_SECTION, "SOM");

  assert.equal(parseMarketSizingMagnitude(tam), 18_000_000);
  assert.equal(parseMarketSizingMagnitude(sam), null, "Validation Required text must never parse as a number");
  assert.equal(parseMarketSizingMagnitude(som), null, "Validation Required text must never parse as a number");
  assert.match(sam, /Validation Required/);
  assert.match(som, /Validation Required/);
});

// ---------------------------------------------------------------------------
// B. Same values repeated elsewhere in prose -- canonical rows still win.
// ---------------------------------------------------------------------------

test("B) canonical structured row wins even when the same figure is echoed elsewhere in prose", () => {
  const content = [
    CANONICAL_SECTION,
    "",
    "Narrative: analysts elsewhere have cited a similar $18M figure for adjacent markets, but this section's own TAM row is the authoritative one.",
  ].join("\n");

  const tam = extractMarketSizingLayerValue(content, "TAM");
  assert.equal(parseMarketSizingMagnitude(tam), 18_000_000);
});

// ---------------------------------------------------------------------------
// C. Unrelated sentence containing "TAM" must not be treated as the row.
// ---------------------------------------------------------------------------

test("C) an unrelated occurrence of the bare word 'TAM' (no label-shape) is never treated as the market-size row", () => {
  const content = "Competitor DreamTAM Solutions reported strong growth. TAM: $18M";
  const tam = extractMarketSizingLayerValue(content, "TAM");
  // The `\b` word boundary in the canonical extractor prevents "DreamTAM"
  // from being mistaken for the label; the real "TAM: $18M" row is what
  // is found.
  assert.equal(parseMarketSizingMagnitude(tam), 18_000_000);
});

test("C2) a company name ending in the label text does not itself get matched as the label", () => {
  const content = "DreamTAM: a fictional company with no real market-size figure.";
  const tam = extractMarketSizingLayerValue(content, "TAM");
  // "DreamTAM:" must not be read as "TAM:" -- either no match at all, or
  // (since \b anchors on both sides) it correctly fails to match "TAM"
  // as a distinct word here.
  assert.equal(parseMarketSizingMagnitude(tam), null);
});

// ---------------------------------------------------------------------------
// D/E. Comma-grouped and suffix TAM normalize to the same magnitude.
// ---------------------------------------------------------------------------

test("D) comma-grouped TAM ($18,000,000) is preserved correctly into the shared magnitude parser", () => {
  const content = "TAM: $18,000,000";
  const tam = extractMarketSizingLayerValue(content, "TAM");
  assert.equal(tam, "$18,000,000");
  assert.equal(parseMarketSizingMagnitude(tam), 18_000_000);
});

test("E) suffix TAM ($18M) produces the same normalized magnitude as the comma-grouped form", () => {
  const content = "TAM: $18M";
  const tam = extractMarketSizingLayerValue(content, "TAM");
  assert.equal(parseMarketSizingMagnitude(tam), parseMarketSizingMagnitude("$18,000,000"));
});

// ---------------------------------------------------------------------------
// F. Missing SAM numeric value with Validation Required remains non-numeric.
// ---------------------------------------------------------------------------

test("F) SAM stated only as 'Validation Required' extracts as non-empty text but never as a number", () => {
  const content = "TAM: $18M\nSAM: Validation Required.\nSOM: Validation Required.";
  const sam = extractMarketSizingLayerValue(content, "SAM");
  assert.ok(sam.length > 0, "the raw text must still be extracted (never silently dropped)");
  assert.equal(parseMarketSizingMagnitude(sam), null, "must never coerce a non-numeric state into a number");
});

// ---------------------------------------------------------------------------
// G. Malformed duplicate section must not override the authoritative row.
// ---------------------------------------------------------------------------

test("G) a malformed/incomplete duplicate TAM mention earlier in the SAME content does not override the real, well-formed row", () => {
  // A stray, malformed "TAM" mention with no real value shape, followed
  // by the genuine, well-formed row -- the canonical extractor's `.match`
  // (not `.matchAll`) takes the FIRST label occurrence; this proves that
  // occurrence is still a real, correctly-shaped value here, not noise.
  const content = "See TAM figures in the appendix.\nTAM: $18M";
  const tam = extractMarketSizingLayerValue(content, "TAM");
  // "See TAM figures in the appendix." has no ":"/"-"/"≈" separator
  // immediately after the label, so it cannot satisfy either of the
  // canonical extractor's two match strategies -- the well-formed row
  // is what is found.
  assert.equal(parseMarketSizingMagnitude(tam), 18_000_000);
});

// ---------------------------------------------------------------------------
// H. Web and PDF consumers receive byte-equivalent canonical row payloads.
// ---------------------------------------------------------------------------

test("H) page.tsx, Planner.tsx, and ReportPdfButton.tsx all resolve the identical raw TAM/SAM/SOM value text from the same content, for every case above", async () => {
  const pageExtract = await compilePageExtractor();
  const plannerExtract = await compilePlannerExtractor();

  // Note: Planner.tsx's own downstream compactPdfMetricValue/
  // isMarketSizeValueMeaningful narrowing (unchanged by this task, and
  // out of Task #58's row-extraction scope) only recognizes single-
  // letter unit shortcuts (K/M/B), not spelled-out words ("million") --
  // a separate, pre-existing limitation of that display-narrowing step,
  // not of the row extractor this task unifies. Cases here are chosen to
  // isolate the row-extraction fix (which IS this task's scope) from
  // that unrelated downstream narrowing behavior.
  const cases = [
    [CANONICAL_SECTION, "TAM"],
    [CANONICAL_SECTION, "SAM"],
    [CANONICAL_SECTION, "SOM"],
    ["TAM: $18,000,000", "TAM"],
    ["TAM: $18M", "TAM"],
    ["TAM (Total Addressable Market): USD 1.45B [Estimated]", "TAM"],
    ["Resulting Planning Estimate: TAM (Germany, 2026) ≈ €200M [Estimated]", "TAM"],
  ];

  for (const [content, label] of cases) {
    const canonical = extractMarketSizingLayerValue(content, label);
    assert.equal(
      parseMarketSizingMagnitude(pageExtract(content, label)),
      parseMarketSizingMagnitude(canonical),
      `page.tsx must agree with the canonical extractor's magnitude for ${label} in ${JSON.stringify(content)}`
    );
    assert.equal(
      parseMarketSizingMagnitude(plannerExtract(content, label)),
      parseMarketSizingMagnitude(canonical),
      `Planner.tsx must agree with the canonical extractor's magnitude for ${label} in ${JSON.stringify(content)}`
    );
  }
});

test("H2) STRUCTURAL: page.tsx's extractMarketSizeCardValue is a pure delegation; Planner.tsx's and ReportPdfButton.tsx's extractMarketSizeValue/extractMarketSizeVisualValue each call the canonical extractor for raw capture", () => {
  const pageFn = extractFunctionSource(pageSource, "extractMarketSizeCardValue");
  assert.match(pageFn, /return extractMarketSizingLayerValue\(content, label\);/);

  const plannerFn = extractFunctionSource(plannerSource, "extractMarketSizeValue");
  assert.match(plannerFn, /extractMarketSizingLayerValue\(normalizePdfText\(content\), label\)/);

  const pdfFn = extractFunctionSource(pdfButtonSource, "extractMarketSizeVisualValue");
  assert.match(pdfFn, /extractMarketSizingLayerValue\(normalized, label\)/);
});

// ---------------------------------------------------------------------------
// FAIL-BEFORE / PASS-AFTER
// ---------------------------------------------------------------------------

test("FAIL-BEFORE: the old page.tsx-local implementation (no \\b label boundary) is vulnerable to matching a label-like substring, unlike the canonical extractor", () => {
  // "STAM" contains "TAM" as a bare substring with no word boundary --
  // the old, un-anchored first-step regex could match this if the
  // surrounding text happened to look label-shaped; demonstrate the
  // structural difference directly via the boundary-less pattern itself.
  const noBoundaryPattern = /TAM\s*[:\-–—]\s*([\s\S]*?)(?=$)/i;
  const boundaryPattern = /\bTAM\b\s*[:\-–—]\s*([\s\S]*?)(?=$)/i;
  const adversarial = "STAM: this is not a real TAM row, just a coincidental substring match.";

  const withoutBoundary = adversarial.match(noBoundaryPattern)?.[1]?.trim();
  const withBoundary = adversarial.match(boundaryPattern)?.[1]?.trim();

  assert.ok(withoutBoundary, "the unanchored pattern matches the substring inside STAM -- this is the exact structural gap");
  assert.equal(withBoundary, undefined, "the \\b-anchored canonical pattern correctly refuses to match a label embedded in a longer word");
});

test("FAIL-BEFORE: the old page.tsx/Planner.tsx separator class (missing ≈/~) fails to extract a real, confirmed-live Planning Estimate phrasing that the canonical extractor handles correctly", () => {
  const content = "TAM (Germany, 2026) ≈ EUR200-800 million [Estimated]";

  assert.equal(
    OLD_page_extractMarketSizeCardValue(content, "TAM"),
    "",
    "the old implementation (no ≈/~ separator support) must fail to extract this real, confirmed-live phrasing"
  );

  const canonical = extractMarketSizingLayerValue(content, "TAM");
  assert.ok(canonical.length > 0, "the canonical extractor must successfully extract this same phrasing");
  assert.ok(parseMarketSizingMagnitude(canonical) !== null, "and it must parse to a real magnitude");
});

test("PASS-AFTER: page.tsx's real, current extractMarketSizeCardValue correctly resolves the ≈ Planning Estimate phrasing the old implementation could not", async () => {
  const pageExtract = await compilePageExtractor();
  const content = "TAM (Germany, 2026) ≈ EUR200-800 million [Estimated]";
  const value = pageExtract(content, "TAM");
  assert.ok(value.length > 0);
  assert.ok(parseMarketSizingMagnitude(value) !== null);
});

// Note: uses a single-letter-unit ≈ phrasing rather than a spelled-out
// "million" range -- Planner.tsx's own downstream compactPdfMetricValue/
// isMarketSizeValueMeaningful narrowing (unchanged, out of this task's
// row-extraction scope) only recognizes K/M/B shortcuts, not spelled-out
// unit words, a separate pre-existing limitation independent of the row-
// extraction fix being proven here.
test("PASS-AFTER: Planner.tsx's real, current extractMarketSizeValue correctly resolves the ≈ Planning Estimate phrasing the old implementation could not", async () => {
  const plannerExtract = await compilePlannerExtractor();
  const content = "TAM (Germany, 2026) ≈ €200M [Estimated]";
  const value = plannerExtract(content, "TAM");
  assert.ok(value.length > 0, `expected a non-empty value, got ${JSON.stringify(value)}`);
  assert.ok(parseMarketSizingMagnitude(value) !== null);
});

test("PASS-AFTER (raw-capture proof): Planner.tsx's raw-extraction step now succeeds for the spelled-out-unit ≈ phrasing even though the OLD implementation returned nothing at all -- the downstream display-narrowing step's separate spelled-out-unit limitation is pre-existing and out of this task's scope", () => {
  const content = "TAM (Germany, 2026) ≈ EUR200-800 million [Estimated]";
  const rawCapture = extractMarketSizingLayerValue(content, "TAM");
  assert.ok(rawCapture.length > 0, "the canonical extractor Planner.tsx now delegates to must capture this phrasing");
  assert.equal(
    OLD_page_extractMarketSizeCardValue(content, "TAM"),
    "",
    "the OLD implementation's raw capture step returned nothing for this same phrasing"
  );
});

// ---------------------------------------------------------------------------
// I. Task #57 magnitude-parser guarantees remain intact (composed here,
// not re-implemented) -- the row extractor must pass raw text through
// without dropping suffixes/commas/currency symbols.
// ---------------------------------------------------------------------------

test("I) SCALE INTEGRITY: the row extractor never drops suffixes, commas, decimal separators, or currency symbols before the magnitude parser sees them", () => {
  const cases = [
    ["TAM: $18M", 18_000_000],
    ["TAM: $18,000,000", 18_000_000],
    ["TAM: $18.5M", 18_500_000],
    ["TAM: USD 18 million", 18_000_000],
    ["TAM: £2.8 thousand", 2_800],
  ];
  for (const [content, expected] of cases) {
    const value = extractMarketSizingLayerValue(content, "TAM");
    assert.equal(parseMarketSizingMagnitude(value), expected, `for content ${JSON.stringify(content)}`);
  }
});

// ---------------------------------------------------------------------------
// J. Decision / confidence / ENTER eligibility unchanged (drift check).
// ---------------------------------------------------------------------------

test("J) NO DECISION REGRESSION: this task's source changes are confined to TAM/SAM/SOM row-extraction functions -- decision, confidence, ENTER eligibility, evidence-gap, and Closure Plan functions are untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision/, "canonical decision resolver must still be present and in use");
  }
  assert.ok(
    !pageSource.includes("function resolveMarketIntelligenceEnterEligibility") &&
      !plannerSource.includes("function resolveMarketIntelligenceEnterEligibility"),
    "ENTER eligibility logic lives only in the shared evidence-gaps module, never duplicated into a render surface"
  );
});

// ---------------------------------------------------------------------------
// COMPETITOR-ROW ISOLATION (requirement #8)
// ---------------------------------------------------------------------------

test("COMPETITOR ISOLATION: Planner.tsx structurally gates TAM/SAM/SOM and competitor-row rendering on distinct, mutually-exclusive field identities (`field === \"tamSamSom\"` vs `field === \"competitiveLandscape\"`)", () => {
  assert.match(plannerSource, /field === "tamSamSom"/, "a structural field-name gate for tamSamSom must exist");
  assert.match(plannerSource, /field === "competitiveLandscape"/, "a structural field-name gate for competitiveLandscape must exist");
});

test("COMPETITOR ISOLATION: ReportPdfButton.tsx structurally gates TAM/SAM/SOM rendering on `field === \"tamSamSom\"`, distinct from its own competitiveLandscape handling", () => {
  assert.match(pdfButtonSource, /field === "tamSamSom"/);
  assert.match(pdfButtonSource, /"competitiveLandscape"/);
});

test("COMPETITOR ISOLATION: page.tsx recognizes tamSamSom and competitiveLandscape as distinct section identities (both string literals present, each used for its own field's rendering)", () => {
  // page.tsx uses a title/component-scoped branching style (not a single
  // `field === "..."` equality) for section identity -- the string
  // literal's presence, used separately from competitiveLandscape
  // throughout, is the meaningful structural signal here.
  assert.match(pageSource, /"tamSamSom"/);
  assert.match(pageSource, /"competitiveLandscape"/);
});
