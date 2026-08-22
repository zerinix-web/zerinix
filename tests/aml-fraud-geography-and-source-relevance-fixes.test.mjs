import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- confirmed live in an AML/Fraud compliance
// Business Plan report:
//
// 1. Geography collapsing: the user explicitly provided United States,
//    United Kingdom, Singapore, United Arab Emirates, and Switzerland, but
//    downstream geography output (Financial Assumptions, benchmark
//    geography, roadmap/geography text) collapsed this to "United States +
//    United Kingdom + GCC / Middle East + Singapore" -- the UAE was
//    replaced with the broader "GCC / Middle East" region label, and
//    Switzerland was silently dropped entirely (no entry for it existed at
//    all). Root cause: inferFinancialModelingInputs's geography resolver
//    (app/lib/ai/financial-model.ts) had a single combined pattern mapping
//    "uae"/"united arab emirates" to the region label "GCC / Middle East"
//    instead of its own explicit country name, and had no pattern for
//    Switzerland whatsoever.
//
// 2. AML/Fraud source relevance: the same report's Sources page cited
//    unrelated generic federal sources (Office of Personnel Management,
//    Environmental Protection Agency, Foundations for Evidence-Based
//    Policymaking Act material) with no connection to anti-money-
//    laundering, KYC, sanctions, or fraud compliance. Root cause:
//    buildRealSourcesAssumptionsField (app/lib/report-jobs/plan-executor.ts)
//    rendered every item in the research evidence registry verbatim, with
//    no subject-matter relevance filter for regulated-compliance verticals.

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

async function importBenchmarkIntelligence() {
  const sourcePath = join(repoRoot, "app/lib/ai/benchmark-intelligence.ts");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-benchmark-intelligence-"));
  const outPath = join(dir, "benchmark-intelligence.ts");
  writeFileSync(outPath, readFileSync(sourcePath, "utf8"));
  return import(pathToFileURL(outPath).href);
}

const { inferFinancialModelingInputs } = await importFinancialModel();
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const amlFraudPrompt =
  "An AML/Fraud detection and KYC compliance platform for banks, serving financial institutions across the United States, United Kingdom, Singapore, United Arab Emirates, and Switzerland.";

// --- Issue 1: explicit-country geography preservation -------------------

test("the exact reported AML/Fraud prompt resolves every explicit country exactly, with no region-label collapse (the exact live bug)", () => {
  const geography = inferFinancialModelingInputs(amlFraudPrompt).geography;

  assert.equal(geography, "United States + United Kingdom + Singapore + United Arab Emirates + Switzerland");
});

test("UAE remains 'United Arab Emirates', never collapsed into 'GCC / Middle East'", () => {
  const geography = inferFinancialModelingInputs(
    "A compliance platform for the United Arab Emirates market."
  ).geography;

  assert.equal(geography, "United Arab Emirates");
  assert.notEqual(geography, "GCC / Middle East");
});

test("the bare 'UAE' abbreviation also resolves to the explicit country, not the region label", () => {
  assert.equal(
    inferFinancialModelingInputs("Expanding compliance operations into the UAE.").geography,
    "United Arab Emirates"
  );
});

test("Switzerland is never dropped when named alongside other countries", () => {
  const regions = new Set(
    inferFinancialModelingInputs(
      "A fintech platform operating in Switzerland and Germany."
    ).geography.split(" + ")
  );

  assert.ok(regions.has("Switzerland"), "Switzerland missing from combined geography");
});

test("Switzerland alone resolves to its own explicit 'Switzerland' value, not the 'global markets' default", () => {
  assert.equal(
    inferFinancialModelingInputs("A wealth management platform for Swiss private banks in Zurich.").geography,
    "Switzerland"
  );
});

test("the broader 'GCC / Middle East' region label is still used for genuinely regional Gulf signals that never name a specific country", () => {
  assert.equal(
    inferFinancialModelingInputs("A logistics platform for the GCC region, based in Dubai.").geography,
    "GCC / Middle East"
  );
});

test("region labels are never used as a replacement for any of the 5 explicit countries, in any order", () => {
  const geography = inferFinancialModelingInputs(
    "A KYC platform for Switzerland, United Arab Emirates, Singapore, United Kingdom, and United States clients."
  ).geography;
  const regions = new Set(geography.split(" + "));

  for (const country of ["United States", "United Kingdom", "Singapore", "United Arab Emirates", "Switzerland"]) {
    assert.ok(regions.has(country), `${country} missing from "${geography}"`);
  }
  assert.ok(!regions.has("GCC / Middle East"), `"GCC / Middle East" should not appear when UAE was named explicitly, got "${geography}"`);
});

test("previously-fixed multi-region geography scenarios are unaffected (no regression)", () => {
  const naEuropeGeo = inferFinancialModelingInputs("clinics across North America and Europe").geography;
  assert.deepEqual(new Set(naEuropeGeo.split(" + ")), new Set(["North America", "Europe"]));

  // An explicitly named country (Greece) is no longer collapsed into the
  // "Europe" region label -- see the CRITICAL PRODUCTION FIX that gave
  // Germany/France/Italy/Spain/Greece/Norway/Netherlands/Saudi Arabia/
  // Qatar their own regionPatterns entries.
  assert.equal(inferFinancialModelingInputs("A SaaS platform for clinics in Greece.").geography, "Greece");
  assert.equal(inferFinancialModelingInputs("A fintech platform for small businesses in Singapore.").geography, "Singapore");
});

// --- Financial calculations / scoring must not change (explicit constraint) --

test("the United Arab Emirates geography multiplier is unchanged from its prior 'GCC / Middle East' value (financial calculations must not change)", () => {
  const multiplierMatch = /function geographyMultiplier\([\s\S]*?\n\}/.exec(financialModelSource);
  assert.ok(multiplierMatch, "geographyMultiplier not found");
  assert.match(multiplierMatch[0], /if \(geography === "GCC \/ Middle East"\) return 0\.06;/);
  assert.match(multiplierMatch[0], /if \(geography === "United Arab Emirates"\) return 0\.06;/);
});

test("createBenchmarkIntelligenceScore's geographyFit still scores the AML/Fraud prompt's combined geography the same as before the fix (scoring methodology must not change)", async () => {
  const { createBenchmarkIntelligenceScore } = await importBenchmarkIntelligence();
  const geography = inferFinancialModelingInputs(amlFraudPrompt).geography;

  const financialModel = {
    benchmarkFit: { fit: "Strong Fit", validationGaps: [] },
    metrics: {
      arpa: { value: 500, confidence: "High" },
      grossMargin: { value: 0.7 },
      cac: { value: 1000 },
      ltv: { value: 5000 },
      cacPayback: { value: 6 },
    },
    inputs: { businessModel: "subscription software", geography },
    benchmark: { ranges: { cac: { low: 100, high: 2000 }, ltv: { low: 1000, high: 10000 }, grossMargin: { low: 0.5, high: 0.9 }, cacPayback: { low: 3, high: 12 } } },
  };

  const score = createBenchmarkIntelligenceScore(financialModel);
  assert.ok(score.overallFit > 0, "expected a computed overall fit score");
});

// --- Existing test updated as a direct consequence of this fix (drift check) --

test("financial-model.ts's regionPatterns keep Singapore ordered before UAE/GCC/Switzerland (drift check on expected join order)", () => {
  const patternsMatch = /const regionPatterns: Array<\[RegExp, string\]> = \[[\s\S]*?\];/.exec(financialModelSource);
  assert.ok(patternsMatch, "regionPatterns array not found");
  const singaporeIndex = patternsMatch[0].indexOf('"Singapore"');
  const uaeIndex = patternsMatch[0].indexOf('"United Arab Emirates"');
  const switzerlandIndex = patternsMatch[0].indexOf('"Switzerland"');
  assert.ok(singaporeIndex > -1 && uaeIndex > -1 && switzerlandIndex > -1, "one or more country patterns missing");
  assert.ok(singaporeIndex < uaeIndex, "Singapore must be ordered before United Arab Emirates");
  assert.ok(singaporeIndex < switzerlandIndex, "Singapore must be ordered before Switzerland");
});

// --- Issue 2: AML/Fraud source relevance ---------------------------------

// Mirrors plan-executor.ts's exact implementation (heavy Supabase/auth
// dependencies prevent clean direct import -- established convention for
// this file elsewhere in this suite).
const amlFraudComplianceSignals =
  /\b(anti[\s-]?money[\s-]?laundering|money laundering|\baml\b|\bkyc\b|know your customer|sanctions screening|sanctions compliance|transaction monitoring|financial crime|fraud detection|fraud prevention|fraud compliance)\b/i;
const amlRelevantAuthoritySignals =
  /\b(fatf|financial action task force|fincen|financial crimes enforcement network|\bfca\b|financial conduct authority|\bmas\b|monetary authority of singapore|\bocc\b|comptroller of the currency|ffiec|federal financial institutions examination council|\bbis\b|bank for international settlements|wolfsberg)\b/i;
const amlIrrelevantGenericSourceSignals =
  /\b(office of personnel management|\bopm\b|environmental protection agency|\bepa\b|evidence[\s-]based policymaking|foundations for evidence)\b/i;

function isAmlFraudComplianceReport(normalizedBusinessIdea) {
  return amlFraudComplianceSignals.test(normalizedBusinessIdea);
}

function prioritizeAmlFraudRelevantEvidence(evidence) {
  const sourceText = (item) => `${item.sourceTitle} ${item.publisher} ${item.url}`;
  const relevant = [];
  const rest = [];

  for (const item of evidence) {
    if (amlRelevantAuthoritySignals.test(sourceText(item))) {
      relevant.push(item);
    } else if (!amlIrrelevantGenericSourceSignals.test(sourceText(item))) {
      rest.push(item);
    }
  }

  return [...relevant, ...rest];
}

function evidenceItem(overrides) {
  return {
    id: "R1",
    field: "compliance",
    claim: "",
    value: "",
    sourceTitle: "",
    publisher: "",
    url: "",
    publishedDate: "",
    ...overrides,
  };
}

test("AML/Fraud report detection matches the exact reported prompt", () => {
  assert.equal(isAmlFraudComplianceReport(amlFraudPrompt.toLowerCase()), true);
});

test("AML/Fraud source sets reject unrelated generic government-policy sources (the exact live bug)", () => {
  const evidence = [
    evidenceItem({ id: "R1", sourceTitle: "General Records Schedules", publisher: "Office of Personnel Management (OPM)", url: "https://opm.gov/records" }),
    evidenceItem({ id: "R2", sourceTitle: "Environmental Compliance Handbook", publisher: "Environmental Protection Agency (EPA)", url: "https://epa.gov/handbook" }),
    evidenceItem({ id: "R3", sourceTitle: "Foundations for Evidence-Based Policymaking Act guidance", publisher: "OMB", url: "https://omb.gov/evidence-act" }),
    evidenceItem({ id: "R4", sourceTitle: "AML Guidance for Financial Institutions", publisher: "FinCEN", url: "https://fincen.gov/guidance" }),
  ];

  const filtered = prioritizeAmlFraudRelevantEvidence(evidence);
  const ids = filtered.map((item) => item.id);

  assert.ok(!ids.includes("R1"), "OPM source should have been rejected");
  assert.ok(!ids.includes("R2"), "EPA source should have been rejected");
  assert.ok(!ids.includes("R3"), "Evidence Act source should have been rejected");
  assert.ok(ids.includes("R4"), "FinCEN source should be preserved");
});

test("AML/Fraud source sets prefer directly relevant regulatory/compliance authorities, ordered first", () => {
  const evidence = [
    evidenceItem({ id: "R1", sourceTitle: "General guidance", publisher: "Some Ministry", url: "https://ministry.gov/guidance" }),
    evidenceItem({ id: "R2", sourceTitle: "Wolfsberg Group AML Principles", publisher: "Wolfsberg Group", url: "https://wolfsberg-group.org/principles" }),
    evidenceItem({ id: "R3", sourceTitle: "FATF Recommendations", publisher: "Financial Action Task Force", url: "https://fatf-gafi.org/recommendations" }),
  ];

  const filtered = prioritizeAmlFraudRelevantEvidence(evidence);

  assert.deepEqual(filtered.map((item) => item.id), ["R2", "R3", "R1"]);
});

test("every named AML-relevant authority (FATF, FinCEN, FCA, MAS, OCC, FFIEC, BIS, Wolfsberg) is recognized as relevant", () => {
  const authorities = [
    "FATF", "FinCEN", "FCA", "MAS", "OCC", "FFIEC", "BIS", "Wolfsberg Group",
  ];

  for (const publisher of authorities) {
    const evidence = [evidenceItem({ id: "R1", publisher })];
    const filtered = prioritizeAmlFraudRelevantEvidence(evidence);
    assert.equal(filtered.length, 1, `${publisher} should be recognized and preserved`);
  }
});

test("sources are never fabricated -- filtering only reorders/removes real evidence, never adds new entries", () => {
  const evidence = [
    evidenceItem({ id: "R1", publisher: "FinCEN" }),
    evidenceItem({ id: "R2", publisher: "Some Regulator" }),
  ];
  const filtered = prioritizeAmlFraudRelevantEvidence(evidence);

  assert.ok(filtered.length <= evidence.length, "filtering must never increase the evidence count");
  for (const item of filtered) {
    assert.ok(evidence.includes(item), "every filtered item must be a real, original evidence object");
  }
});

test("a source that is not on the explicit irrelevant list is preserved even if not a named AML authority (no over-filtering)", () => {
  const evidence = [
    evidenceItem({ id: "R1", sourceTitle: "State banking regulator bulletin", publisher: "State Department of Financial Services", url: "https://dfs.example.gov/bulletin" }),
  ];

  const filtered = prioritizeAmlFraudRelevantEvidence(evidence);
  assert.deepEqual(filtered.map((item) => item.id), ["R1"]);
});

test("non-AML/Fraud reports are never filtered (do not change unrelated research behavior)", () => {
  assert.equal(isAmlFraudComplianceReport("a coffee shop chain expanding across Europe"), false);
  assert.equal(isAmlFraudComplianceReport("a real estate investment platform for commercial property"), false);
});

// --- Drift checks -----------------------------------------------------

test("plan-executor.ts wires the AML/Fraud source filter into buildRealSourcesAssumptionsField, gated by prompt detection (drift check)", () => {
  const fnMatch = /function buildRealSourcesAssumptionsField\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildRealSourcesAssumptionsField not found");
  assert.match(fnMatch[0], /isAmlFraudComplianceReport\(normalizedBusinessIdea\)/);
  assert.match(fnMatch[0], /prioritizeAmlFraudRelevantEvidence\(research\.evidence\)/);
});

test("plan-executor.ts never fabricates a source in the AML/Fraud filter -- prioritizeAmlFraudRelevantEvidence only reorders/drops real evidence (drift check)", () => {
  const fnMatch = /function prioritizeAmlFraudRelevantEvidence\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "prioritizeAmlFraudRelevantEvidence not found");
  assert.doesNotMatch(fnMatch[0], /new\s+\{|push\(\{/, "the filter must never construct new evidence objects");
});

test("all three buildRealSourcesAssumptionsField call sites pass the report's normalizedBusinessIdea (drift check, no regression path left unfixed)", () => {
  const callSites = (planExecutorSource.match(/buildRealSourcesAssumptionsField\(\s*[\s\S]*?\);/g) || [])
    .filter((call) => !call.includes("research: DomainResearchBundle"));
  assert.equal(callSites.length, 3, `expected 3 call sites, found ${callSites.length}`);

  for (const call of callSites) {
    assert.match(call, /normalizedBusinessIdea/, `call site missing normalizedBusinessIdea: ${call}`);
  }
});
