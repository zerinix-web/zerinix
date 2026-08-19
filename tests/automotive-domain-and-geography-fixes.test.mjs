import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION QUALITY FIX -- full end-to-end audit of a live
// automotive/procurement Business Plan report ("AI-powered procurement
// optimization platform for global automotive manufacturers... Germany,
// Japan, South Korea, Mexico, and the United States") surfaced 2 real,
// confirmed issues:
//
// 1. Industry misclassification: the business was classified as generic
//    "ai" ("AI software / automation") instead of "manufacturing", even
//    though "automotive manufacturers" appears twice in the prompt --
//    because "AI-powered"/"automatically" matched the generic ai/
//    automation catch, and the manufacturing pattern (which "automotive
//    manufacturers" itself matches) was positioned AFTER it in
//    firstMatching's first-match-wins array order. Same class of bug as
//    the earlier logistics/cybersecurity fix -- every specific industry
//    pattern (healthcare/hospitality/luxuryGoods/manufacturing/fitness/
//    agriculture) is now moved ahead of the generic ai/saas/cybersecurity
//    catches.
// 2. Geography loss: "Germany, Japan, South Korea, Mexico, and the United
//    States" resolved to "United States + Europe + global" -- Japan/
//    South Korea/Mexico had no region entry at all (silently dropped),
//    and "global" was incorrectly added as a co-equal region signal
//    purely because the prompt's own "for global automotive
//    manufacturers" used the word as an ambition descriptor, not a
//    geography signal.

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferIndustryKey, inferFinancialModelingInputs } = await importFinancialModel();

const automotivePrompt =
  "I want to build an AI-powered procurement optimization platform for global automotive manufacturers. The platform integrates with SAP, Oracle, and Microsoft Dynamics, predicts supplier risks, optimizes inventory, monitors ESG compliance, and automatically recommends sourcing decisions. Target customers are automotive manufacturers operating in Germany, Japan, South Korea, Mexico, and the United States.";

// --- Issue 1: industry classification -------------------------------

test("the exact live automotive-procurement prompt classifies as manufacturing, not generic 'ai' (the exact live bug)", () => {
  assert.equal(inferIndustryKey(automotivePrompt), "manufacturing");
});

test("specific industry patterns now win over the generic ai/automation catch when both are present, for every reordered category", () => {
  const cases = [
    ["An AI-powered patient scheduling automation platform for a hospital network.", "healthcare"],
    ["An AI-powered concierge automation platform for a hotel chain.", "hospitality"],
    ["An AI-powered booking automation platform for yacht charters.", "luxuryGoods"],
    ["An AI-powered automation platform for automotive manufacturers.", "manufacturing"],
    ["An AI-powered coaching automation platform for a gym chain.", "fitness"],
    ["An AI-powered automation platform for a vertical farm operator.", "agriculture"],
  ];

  for (const [prompt, expected] of cases) {
    assert.equal(inferIndustryKey(prompt), expected, `"${prompt}" should classify as ${expected}`);
  }
});

test("a prompt with no specific industry signal still falls back to generic 'ai' (no regression)", () => {
  assert.equal(
    inferIndustryKey("An AI-powered automation platform for small businesses."),
    "ai"
  );
});

test("genuine cybersecurity/fintech/logistics classification is unaffected by the reorder (no regression)", () => {
  assert.equal(inferIndustryKey("A cybersecurity platform for enterprise threat detection"), "cybersecurity");
  assert.equal(inferIndustryKey("A managed detection and response (MDR) service for SMBs"), "cybersecurity");
  assert.equal(inferIndustryKey("I am building a payments platform for small businesses"), "fintech");
  assert.equal(
    inferIndustryKey("An AI platform for fleet operations and shipping logistics."),
    "logistics"
  );
});

// --- Issue 2: geography -----------------------------------------------

test("the exact live automotive-procurement prompt preserves all five named countries (the exact live bug)", () => {
  const geography = inferFinancialModelingInputs(automotivePrompt).geography;
  const regions = new Set(geography.split(" + "));

  assert.notEqual(geography, "global");
  assert.notEqual(geography, "global markets");
  for (const expected of ["United States", "Europe", "Japan", "South Korea", "Mexico"]) {
    assert.ok(regions.has(expected), `"${expected}" missing from geography "${geography}"`);
  }
});

test("Japan, South Korea, and Mexico each resolve individually", () => {
  assert.equal(inferFinancialModelingInputs("A logistics platform for manufacturers in Japan.").geography, "Japan");
  assert.equal(
    inferFinancialModelingInputs("A logistics platform for manufacturers in South Korea.").geography,
    "South Korea"
  );
  assert.equal(inferFinancialModelingInputs("A logistics platform for manufacturers in Mexico.").geography, "Mexico");
});

test("'global' as an ambition descriptor is never added alongside specifically-named countries", () => {
  const geography = inferFinancialModelingInputs(
    "A platform for global manufacturers operating in Germany and Japan."
  ).geography;
  const regions = geography.split(" + ");

  assert.ok(!regions.includes("global"), `"global" should not appear alongside named countries in "${geography}"`);
  assert.deepEqual(new Set(regions), new Set(["Europe", "Japan"]));
});

test("'global'/'worldwide'/'international' still resolves correctly when it is the ONLY geography signal (no regression)", () => {
  assert.equal(inferFinancialModelingInputs("A platform for global logistics operators.").geography, "global");
  assert.equal(inferFinancialModelingInputs("A worldwide subscription service.").geography, "global");
});

test("previously-fixed geography scenarios (maritime multi-region, North America + Europe, bare US, unspecified default) are unaffected", () => {
  const maritimeGeo = inferFinancialModelingInputs(
    "shipping companies operating across Singapore, Greece, Norway, and the United Arab Emirates"
  ).geography;
  assert.deepEqual(
    new Set(maritimeGeo.split(" + ")),
    new Set(["Europe", "United Arab Emirates", "Singapore"])
  );

  const naEuropeGeo = inferFinancialModelingInputs(
    "clinics across North America and Europe"
  ).geography;
  assert.deepEqual(new Set(naEuropeGeo.split(" + ")), new Set(["North America", "Europe"]));

  assert.equal(
    inferFinancialModelingInputs("a SaaS platform for the United States market.").geography,
    "United States"
  );
  assert.equal(
    inferFinancialModelingInputs(
      "a warehouse automation software platform for mid-sized logistics companies."
    ).geography,
    "global markets"
  );
});
