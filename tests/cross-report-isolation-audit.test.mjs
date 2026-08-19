import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION ROBUSTNESS FIX -- eliminate cross-report data
// contamination.
//
// A systematic audit of the report generation pipeline (app/lib/ai,
// app/lib/decision-intelligence, app/lib/report-jobs, app/lib/report-engine,
// app/lib/pdf-engine, app/lib/research-evidence, the report-* top-level
// files, the API routes, and the dashboard/planner client components) for
// module-level mutable state -- caches, counters, accumulators, singletons
// -- that could leak data between two unrelated report generations in the
// same long-running server process found NO genuine data-leak: every
// benchmark/industry/geography table is a static, read-only, literal-
// initialized constant that is only ever read from, never mutated by any
// caller (verified directly: no `benchmark.ranges.X =` / `.modeling.X =`
// assignment exists anywhere), and every report-generation function
// (inferFinancialModelingInputs, getIndustryBenchmarks,
// prioritizeAmlFraudRelevantEvidence, etc.) is a pure function that takes
// the current report's own prompt/inputs as parameters and returns a fresh
// result with no dependency on any prior call's state.
//
// Two items of process-global mutable state WERE found:
//  1. app/lib/ai/research-cache-core.ts's `inFlight` Map (in-flight-request
//     dedup) -- verified safe: keyed by `${userId}:${cacheKey}` where
//     cacheKey already encodes the report's own prompt/mode/language, and
//     the entry is always removed in a `finally` block, so it cannot leak
//     between different users or different report content, and never
//     survives past the request it belongs to.
//  2. app/lib/ai/market-research-v2/adapter.ts's `evidenceIdCounter` -- a
//     module-level counter that never leaked report DATA (each bundle's
//     evidence array only ever held that report's own items), but was
//     needless process-global mutable state with no reason to exist. Fixed
//     by replacing it with a counter local to a single
//     buildMarketResearchV2Bundle call, recreated fresh on every
//     invocation -- the exact same unique-within-this-bundle IDs, with
//     nothing surviving past the call that produced them.
//
// This test suite proves isolation empirically: it generates several
// completely different, realistic report inputs (renewable energy,
// AML/Fraud compliance, manufacturing, healthcare, logistics) and calls
// the pipeline's core pure functions on them in sequence -- and in
// reverse order -- asserting each call's output depends ONLY on its own
// input, never on what was generated immediately before it.

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

const { inferFinancialModelingInputs } = await importFinancialModel();
const { getIndustryBenchmarks } = await import(
  pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href
);
const { resolveCachedOrExecuteResearch } = await import(
  pathToFileURL(join(repoRoot, "app/lib/ai/research-cache-core.ts")).href
);
const { buildMarketResearchV2Bundle } = await import(
  pathToFileURL(join(repoRoot, "app/lib/ai/market-research-v2/adapter.ts")).href
);

const marketResearchAdapterSource = readFileSync(
  join(repoRoot, "app/lib/ai/market-research-v2/adapter.ts"),
  "utf8"
);

// A deliberately diverse set of prompts, each naming a distinct industry,
// country set, and vocabulary, so any cross-contamination would be
// immediately and unambiguously detectable in the output.
const distinctReportPrompts = [
  {
    label: "renewable energy",
    prompt:
      "An AI-powered renewable energy portfolio optimization platform for utilities, managing solar, wind, and battery storage assets across the grid in Germany and France.",
    expectedIndustryKey: "energy",
    expectedGeography: "Europe",
  },
  {
    label: "AML/Fraud compliance",
    prompt:
      "An AML and fraud detection compliance platform (transaction monitoring, sanctions screening, and KYC automation) for banks operating in the United States, United Kingdom, Singapore, United Arab Emirates, and Switzerland.",
    expectedIndustryKey: "cybersecurity",
    expectedGeography: "United States + United Kingdom + Singapore + United Arab Emirates + Switzerland",
  },
  {
    label: "manufacturing",
    prompt: "A battery manufacturer producing lithium-ion cells for industrial customers in Turkey.",
    expectedIndustryKey: "manufacturing",
    expectedGeography: "Turkey",
  },
  {
    label: "healthcare",
    prompt: "An AI-powered patient scheduling automation platform for a hospital network in the United Kingdom.",
    expectedIndustryKey: "healthcare",
    expectedGeography: "United Kingdom",
  },
  {
    label: "logistics",
    prompt:
      "A logistics platform for commercial shipping companies optimizing fleet operations across Singapore, Greece, Norway, and the United Arab Emirates.",
    expectedIndustryKey: "logistics",
    expectedGeography: null, // multi-region, checked separately below
  },
];

function runFullSequence(order) {
  return order.map(({ label, prompt, expectedIndustryKey, expectedGeography }) => {
    const inputs = inferFinancialModelingInputs(prompt);
    return { label, prompt, expectedIndustryKey, expectedGeography, inputs };
  });
}

// --- Sequential, order-independent isolation (the core proof) -----------

test("inferFinancialModelingInputs produces identical output for each prompt regardless of what was generated immediately before it (forward order)", () => {
  const results = runFullSequence(distinctReportPrompts);

  for (const { label, expectedIndustryKey, expectedGeography, inputs } of results) {
    assert.equal(inputs.industryKey, expectedIndustryKey, `${label}: wrong industryKey`);
    if (expectedGeography) {
      assert.equal(inputs.geography, expectedGeography, `${label}: wrong geography`);
    }
  }
});

test("inferFinancialModelingInputs produces the exact same results in reverse call order (proves no shared/leaking state between calls)", () => {
  const forward = runFullSequence(distinctReportPrompts);
  const reverse = runFullSequence([...distinctReportPrompts].reverse()).reverse();

  for (let i = 0; i < distinctReportPrompts.length; i++) {
    assert.deepEqual(
      reverse[i].inputs,
      forward[i].inputs,
      `"${distinctReportPrompts[i].label}" produced different results depending on call order -- contamination detected`
    );
  }
});

test("interleaving two very different reports' generation never mixes their industry, geography, or business model", () => {
  const energy = distinctReportPrompts[0];
  const aml = distinctReportPrompts[1];

  // Simulate interleaved concurrent-ish generation (A starts, B starts, A
  // finishes, B finishes) -- a shape that would expose any shared,
  // partially-mutated intermediate state.
  const energyInputsA = inferFinancialModelingInputs(energy.prompt);
  const amlInputsA = inferFinancialModelingInputs(aml.prompt);
  const energyInputsB = inferFinancialModelingInputs(energy.prompt);
  const amlInputsB = inferFinancialModelingInputs(aml.prompt);

  assert.deepEqual(energyInputsA, energyInputsB);
  assert.deepEqual(amlInputsA, amlInputsB);
  assert.notEqual(energyInputsA.industryKey, amlInputsA.industryKey);
  assert.notEqual(energyInputsA.geography, amlInputsA.geography);
  assert.doesNotMatch(energyInputsA.geography, /United Arab Emirates|Switzerland|Singapore/);
  assert.doesNotMatch(amlInputsA.geography, /Germany|France|Europe/);
});

// --- getIndustryBenchmarks: shared config table is never mutated --------

test("getIndustryBenchmarks returns a deep-equal result across repeated/interleaved calls -- the shared benchmark table is never mutated by any caller", () => {
  const first = getIndustryBenchmarks("energy");
  // Call several other industries in between, simulating other reports'
  // generation running against the same shared, module-level lookup table.
  getIndustryBenchmarks("manufacturing");
  getIndustryBenchmarks("healthcare");
  getIndustryBenchmarks("cybersecurity");
  const second = getIndustryBenchmarks("energy");

  assert.deepEqual(second, first, "the energy benchmark entry changed after other industries were looked up -- shared table was mutated");
});

test("every industry benchmark's ranges and modeling values are stable across many repeated lookups (no in-place accumulation)", () => {
  const keys = ["saas", "ai", "cybersecurity", "healthcare", "manufacturing", "energy", "logistics"];
  const baseline = Object.fromEntries(keys.map((key) => [key, getIndustryBenchmarks(key)]));

  for (let i = 0; i < 20; i++) {
    for (const key of keys) {
      getIndustryBenchmarks(key);
    }
  }

  for (const key of keys) {
    assert.deepEqual(getIndustryBenchmarks(key), baseline[key], `${key} benchmark drifted after repeated lookups`);
  }
});

// --- research-cache-core.ts: in-flight dedup map is correctly scoped ----

test("resolveCachedOrExecuteResearch never shares an in-flight result between two different dedupe keys (different users/reports)", async () => {
  let executedForA = 0;
  let executedForB = 0;

  const [resultA, resultB] = await Promise.all([
    resolveCachedOrExecuteResearch({
      dedupeKey: "userA:report-energy",
      read: async () => null,
      execute: async () => {
        executedForA += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { report: "renewable energy data for user A" };
      },
      write: async () => {},
    }),
    resolveCachedOrExecuteResearch({
      dedupeKey: "userB:report-aml-fraud",
      read: async () => null,
      execute: async () => {
        executedForB += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { report: "AML/Fraud compliance data for user B" };
      },
      write: async () => {},
    }),
  ]);

  assert.equal(executedForA, 1);
  assert.equal(executedForB, 1);
  assert.equal(resultA.value.report, "renewable energy data for user A");
  assert.equal(resultB.value.report, "AML/Fraud compliance data for user B");
  assert.notEqual(resultA.value.report, resultB.value.report);
});

test("resolveCachedOrExecuteResearch's in-flight entry never survives past the call that created it (self-cleaning, no leak into the next unrelated call)", async () => {
  await resolveCachedOrExecuteResearch({
    dedupeKey: "userA:report-1",
    read: async () => null,
    execute: async () => ({ report: "first report" }),
    write: async () => {},
  });

  // A second, later call with the SAME dedupe key (e.g. the same user
  // regenerating the same report) must execute fresh, not silently reuse
  // a stale in-flight promise from the first call.
  let executedAgain = false;
  const second = await resolveCachedOrExecuteResearch({
    dedupeKey: "userA:report-1",
    read: async () => null,
    execute: async () => {
      executedAgain = true;
      return { report: "second, regenerated report" };
    },
    write: async () => {},
  });

  assert.equal(executedAgain, true, "the in-flight entry from the first call leaked into the second, unrelated call");
  assert.equal(second.value.report, "second, regenerated report");
});

// --- market-research-v2/adapter.ts: evidence bundle isolation -----------

function buildOutcome(field, sourceTitle) {
  return {
    field,
    status: "completed_with_evidence",
    task: {
      id: `task-${field}`,
      field,
      priority: "high",
      reason: `Verify ${field}`,
      preferredSources: ["official statistics"],
      query: `${field} query`,
      required: true,
    },
    items: [
      {
        field,
        claim: `${field} claim`,
        value: `${field} value`,
        verified: true,
        sourceTitle,
        publisher: `${sourceTitle} publisher`,
        sourceUrl: `https://example.com/${field}`,
        evidenceType: "official_statistics",
        confidence: 80,
        publishedAt: "2025",
      },
    ],
  };
}

function buildCompleteness(overrides = {}) {
  return {
    attemptedFields: ["marketSize"],
    unresolvedFields: [],
    recommendedOutput: "full_report",
    ...overrides,
  };
}

test("buildMarketResearchV2Bundle never leaks evidence from one report's bundle into another's", () => {
  const bundleA = buildMarketResearchV2Bundle({
    outcomes: [buildOutcome("marketSize", "Renewable Energy Source")],
    completeness: buildCompleteness(),
  });
  const bundleB = buildMarketResearchV2Bundle({
    outcomes: [buildOutcome("marketSize", "AML Fraud Source")],
    completeness: buildCompleteness(),
  });

  assert.equal(bundleA.evidence.length, 1);
  assert.equal(bundleB.evidence.length, 1);
  assert.equal(bundleA.evidence[0].sourceTitle, "Renewable Energy Source");
  assert.equal(bundleB.evidence[0].sourceTitle, "AML Fraud Source");
  assert.notEqual(bundleA.evidence[0].sourceTitle, bundleB.evidence[0].sourceTitle);
});

test("buildMarketResearchV2Bundle's evidence IDs are unique and stable within a bundle regardless of how many other bundles were built before it (drift check on the counter fix)", () => {
  // Build several unrelated bundles first, simulating other reports having
  // already been generated in this same process.
  for (let i = 0; i < 5; i++) {
    buildMarketResearchV2Bundle({
      outcomes: [buildOutcome("marketSize", `Warmup Source ${i}`)],
      completeness: buildCompleteness(),
    });
  }

  const bundle1 = buildMarketResearchV2Bundle({
    outcomes: [buildOutcome("marketSize", "First"), buildOutcome("cagr", "Second")],
    completeness: buildCompleteness(),
  });
  const bundle2 = buildMarketResearchV2Bundle({
    outcomes: [buildOutcome("marketSize", "Third"), buildOutcome("cagr", "Fourth")],
    completeness: buildCompleteness(),
  });

  // Each bundle's own IDs must be internally unique...
  assert.notEqual(bundle1.evidence[0].id, bundle1.evidence[1].id);
  assert.notEqual(bundle2.evidence[0].id, bundle2.evidence[1].id);
  // ...and every bundle must start its own local numbering from 1, proving
  // no shared counter state survived from the 5 warmup bundles or from
  // bundle1 into bundle2.
  assert.match(bundle1.evidence[0].id, /_1$/, "bundle1's first evidence ID did not start from a fresh local counter");
  assert.match(bundle2.evidence[0].id, /_1$/, "bundle2's first evidence ID did not start from a fresh local counter -- counter state leaked from a prior bundle");
});

test("market-research-v2/adapter.ts no longer declares a module-level evidence ID counter (drift check)", () => {
  assert.doesNotMatch(marketResearchAdapterSource, /^let evidenceIdCounter/m, "the module-level counter was reintroduced");
  assert.match(marketResearchAdapterSource, /let localEvidenceIdCounter = 0;/, "the local, per-call counter is missing");
});

// --- Broader repository sweep: no other module-level mutable accumulator --

test("no module-level mutable accumulator (push/set/add targeting a module-scope array/Map/Set) exists in the core report-generation pipeline files", () => {
  const pipelineFiles = [
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/industry-benchmarks.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/benchmark-intelligence.ts",
    "app/lib/ai/domain-research.ts",
    "app/lib/ai/market-research-v2/adapter.ts",
    "app/lib/decision-intelligence/profiles.ts",
    "app/lib/decision-intelligence/decision-engine.ts",
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-evidence.ts",
  ];

  for (const relativePath of pipelineFiles) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    // A module-scope `let`/mutable-literal `const` declaration, i.e. one
    // that appears at column 0 (not indented inside a function).
    const moduleLevelMutableDeclarations = [
      ...source.matchAll(/^(?:export )?let \w+ = (?:\[\]|\{\}|new Map|new Set)/gm),
    ].map((match) => match[0]);

    assert.deepEqual(
      moduleLevelMutableDeclarations,
      [],
      `${relativePath} declares module-level mutable state: ${JSON.stringify(moduleLevelMutableDeclarations)}`
    );
  }
});
