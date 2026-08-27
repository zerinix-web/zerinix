import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { extractMarketSizingLayerValue } from "../app/lib/report-presentation.ts";

const routeSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

test("tamSamSom is excluded from cross-section paragraph dedup, alongside strategicRecommendations", () => {
  // Reproduces a real, live-observed defect: tamSamSom's opening sentence
  // legitimately restates the same verified market-size figure marketSize
  // already states (the prompt requires citing that figure's benchmark
  // before deriving TAM/SAM/SOM from it). Cross-section dedup judged that
  // restatement a duplicate "insight" of marketSize's own sentence and
  // replaced the ENTIRE tamSamSom section with a bare "See Market Size for
  // the established premise" cross-reference, discarding the section's
  // real SAM/SOM breakdown.
  // Later tickets extended this exclusion list twice more, for the
  // identical reason each time: executiveSummary ("MARKET INTELLIGENCE --
  // ROOT-CAUSE DATA PIPELINE REPAIR", its own fixed-count "What Evidence
  // Is Missing" list was being silently emptied), then competitiveLandscape/
  // majorPlayers (a production report's Major Players section collapsing
  // into a circular "See Competitive Landscape for the established
  // premise" cross-reference) -- the assertion below allows the original
  // two-field list or either extended variant.
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom"(?:,\s*"executiveSummary")?(?:,\s*"competitiveLandscape",\s*"majorPlayers")?(?:,\s*"cagr")?,?\s*\]/
  );
});

test("projectMarketIntelligenceGraphToReport no longer overwrites tamSamSom with the bare marketSize line when a verified market size exists", () => {
  // Reproduces a second, distinct defect on the same field: when a
  // verified market-size figure was found, the graph projection replaced
  // BOTH marketSize and tamSamSom with the identical raw sizing line --
  // discarding the model's own real TAM/SAM/SOM derivation (which its
  // prompt explicitly instructs it to build FROM that verified figure)
  // and leaving nothing for the PDF's TAM/SAM/SOM chart to parse as three
  // nested values, rendering "Could not be calculated" even though real
  // evidence to derive from existed.
  const verifiedBranch = graphSource.match(
    /if \(graph\.verifiedMarketSize\.length > 0\) \{[\s\S]*?\n {2}\} else if \(graph\.planningEstimate\)/
  );
  assert.ok(verifiedBranch, "verifiedMarketSize branch not found");
  assert.match(verifiedBranch[0], /projection\.marketSize = sizing;/);
  assert.doesNotMatch(
    verifiedBranch[0],
    /projection\.tamSamSom = sizing;/,
    "tamSamSom must not be overwritten with the bare marketSize line"
  );
});

test("extractMarketSizeVisualValue recognizes a value embedded in prose, not just a dedicated 'LABEL: value' line", () => {
  const match = pdfButtonSource.match(/function extractMarketSizeVisualValue\([\s\S]*?\n\}/);
  assert.ok(match, "extractMarketSizeVisualValue not found");
  const [signatureLine, ...rest] = match[0].split("\n");
  const jsSignature = signatureLine
    .replace(/:\s*[^,)]+(?=[,)])/g, "")
    .replace(/\)\s*:\s*[^{]+\{/, ") {");
  const fn = new Function(
    "normalizePdfText",
    "escapeRegExp",
    "extractMarketSizingLayerValue",
    `${[jsSignature, ...rest].join("\n")}\nreturn extractMarketSizeVisualValue;`
  )(
    (value) => value,
    (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    extractMarketSizingLayerValue
  );

  // Reproduces a real, live-observed defect: a genuine, correctly nested
  // Planning Estimate paragraph ("Resulting Planning Estimate: TAM
  // (Germany, 2026) ~= EUR200-800 million [Estimated]; SAM (...) ~=
  // EUR50-200 million [Estimated]; SOM (...) ~= EUR5-20 million
  // [Estimated].") never matched the old line-start-only pattern, so the
  // PDF's TAM/SAM/SOM chart fell back to "Could not be calculated"
  // despite the model having produced exactly what its prompt asked for.
  const prose =
    'Resulting Planning Estimate: TAM (Germany, 2026) ≈ €200–€800 million [Estimated]; SAM (serviceable inventory-drone market) ≈ €50–€200 million [Estimated]; SOM (obtainable first-mover share in 2–3 years) ≈ €5–€20 million [Estimated].';

  assert.match(fn(prose, "TAM"), /200.*800.*million/);
  assert.match(fn(prose, "SAM"), /50.*200.*million/);
  assert.match(fn(prose, "SOM"), /5.*20.*million/);
});

test("extractMarketSizeVisualValue still matches the original dedicated-line shape (no regression)", () => {
  const match = pdfButtonSource.match(/function extractMarketSizeVisualValue\([\s\S]*?\n\}/);
  const [signatureLine, ...rest] = match[0].split("\n");
  const jsSignature = signatureLine
    .replace(/:\s*[^,)]+(?=[,)])/g, "")
    .replace(/\)\s*:\s*[^{]+\{/, ") {");
  const fn = new Function(
    "normalizePdfText",
    "escapeRegExp",
    "extractMarketSizingLayerValue",
    `${[jsSignature, ...rest].join("\n")}\nreturn extractMarketSizeVisualValue;`
  )(
    (value) => value,
    (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    extractMarketSizingLayerValue
  );

  const content = "TAM: $2.1B\nSAM: $800M\nSOM: $120M";
  assert.equal(fn(content, "TAM"), "$2.1B");
  assert.equal(fn(content, "SAM"), "$800M");
  assert.equal(fn(content, "SOM"), "$120M");
});

test("extractMarketSizeVisualValue does not match a bare label mention with no value attached", () => {
  const match = pdfButtonSource.match(/function extractMarketSizeVisualValue\([\s\S]*?\n\}/);
  const [signatureLine, ...rest] = match[0].split("\n");
  const jsSignature = signatureLine
    .replace(/:\s*[^,)]+(?=[,)])/g, "")
    .replace(/\)\s*:\s*[^{]+\{/, ") {");
  const fn = new Function(
    "normalizePdfText",
    "escapeRegExp",
    "extractMarketSizingLayerValue",
    `${[jsSignature, ...rest].join("\n")}\nreturn extractMarketSizeVisualValue;`
  )(
    (value) => value,
    (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    extractMarketSizingLayerValue
  );

  assert.equal(fn("TAM / SAM / SOM\nCould not be calculated.", "TAM"), "");
});
