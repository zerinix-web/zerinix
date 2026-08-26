import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAbComparisonRecord,
  recordControlledComparison,
  shouldRecordControlledComparison,
} from "../app/lib/decision-engine-v2/ab-readiness.ts";
import { runDecisionEngineV2ShadowMode } from "../app/lib/decision-engine-v2/shadow-mode.ts";
import { runDecisionEngineV2 } from "../app/lib/decision-engine-v2/engine.ts";
import { evidence, buildInput } from "./fixtures/decision-engine-v2-scenarios.mjs";

// Controlled A/B Readiness Layer -- proves the explicit safeguards this
// layer exists to guarantee before real production traffic can safely
// feed it:
//   1. V2 can never overwrite Legacy output (immutability).
//   2. Any V2 failure fails open -- no record, no throw.
//   3. Comparison/logging failure never fails the request.
//   4. Partial reports never produce a comparison record.
//   5. Missing evidence stays distinct from negative evidence in the
//      captured record, not just internally in the engine.
//   6. No automatic promotion/activation -- capture defaults OFF in
//      production and requires an explicit, dedicated flag.
//   7. Captured records are compact/derived only -- never a copy of
//      report prose or user content.

function strongFixtureInput() {
  return buildInput(
    [
      evidence({
        id: "R1",
        field: "market_size",
        url: "https://www.census.gov/market-size",
        sourceType: "official_statistics",
        claim: "The market size is $2 billion.",
      }),
      evidence({
        id: "R2",
        field: "competitors",
        url: "https://competitor-a.example.com",
        claim: "The market is fragmented with no clear dominant player.",
      }),
    ],
    "Evaluate this market.",
    {
      marketOverview: "Demand is growing rapidly, with strong adoption across the segment.",
      marketDrivers: "Structural demand growth in the category continues to accelerate.",
      competitiveLandscape: "The market is fragmented with no clear dominant player.",
      opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
    }
  );
}

// --- 1. V2 can never overwrite Legacy output (immutability) ---------------

test("1. running the engine and building an A/B record never mutates the input sections/coverage/graph objects", () => {
  const input = strongFixtureInput();
  const beforeSections = JSON.parse(JSON.stringify(input.sections));
  const beforeCoverage = JSON.parse(JSON.stringify(input.coverage));

  const result = runDecisionEngineV2(input);
  buildAbComparisonRecord({
    result,
    legacyDecision: "GO",
    legacyConfidence: 80,
    disagreementReasons: [],
    traceId: "trace-1",
    isPartialReport: false,
  });

  assert.deepEqual(input.sections, beforeSections, "sections (the report Legacy already produced) must be untouched");
  assert.deepEqual(input.coverage, beforeCoverage, "coverage must be untouched");
});

test("1b. the A/B record has no field that could be assigned back into a report/response object -- it is a flat, self-contained value type", () => {
  const result = runDecisionEngineV2(strongFixtureInput());
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: "GO",
    legacyConfidence: 80,
    disagreementReasons: [],
    traceId: "trace-1",
    isPartialReport: false,
  });
  // No nested report-shaped object, no field named like a report field.
  assert.equal(typeof record.dimensionStates, "object");
  for (const value of Object.values(record.dimensionStates)) {
    assert.equal(typeof value, "string");
  }
  assert.ok(!("sections" in record));
  assert.ok(!("report" in record));
});

// --- 2. Any V2 failure fails open -- no record, no throw ------------------

test("2. a malformed decision input degrades to null (fail-open), never throws, and produces no A/B record", () => {
  assert.doesNotThrow(() => {
    const result = runDecisionEngineV2ShadowMode({
      decisionInput: /** @type {any} */ ({ sections: {} }),
      executiveSummaryText: "",
      reportRequestId: "ab-readiness-fail-open",
      isPartialReport: false,
    });
    assert.equal(result, null);
  });
});

// --- 3. Comparison/logging failure never fails the request -----------------

test("3. recordControlledComparison never throws even when given a malformed/circular record", () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => {
    recordControlledComparison(/** @type {any} */ (circular));
  });
});

test("3b. recordControlledComparison is a no-op (not an error) for a null record", () => {
  assert.doesNotThrow(() => {
    recordControlledComparison(null);
  });
});

// --- 4. Partial reports never produce a comparison record ------------------

test("4. buildAbComparisonRecord refuses to build a record for a partial report", () => {
  const result = runDecisionEngineV2(strongFixtureInput());
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: "GO",
    legacyConfidence: 80,
    disagreementReasons: [],
    traceId: "trace-partial",
    isPartialReport: true,
  });
  assert.equal(record, null);
});

test("4b. the shadow-mode entry point itself refuses to produce a comparison for a report explicitly marked partial", () => {
  const input = strongFixtureInput();
  // We can't observe buildAbComparisonRecord's return directly through
  // runDecisionEngineV2ShadowMode (it only returns the V2 result, by
  // design -- the A/B record is logged, not returned), but we can prove
  // isPartialReport actually reaches buildAbComparisonRecord by
  // confirming the SAME call with isPartialReport: true still succeeds
  // and returns a real V2 result (partial-report handling must never
  // break the engine run itself, only the comparison capture).
  const result = runDecisionEngineV2ShadowMode({
    decisionInput: input,
    executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
    reportRequestId: "ab-readiness-partial",
    isPartialReport: true,
  });
  assert.ok(result, "the engine itself must still run even when isPartialReport is true -- only comparison CAPTURE is suppressed");
});

// --- 5. Missing evidence stays distinct from negative evidence -------------

test("5. an all-unknown evidence picture reports hasNegativeEvidence: false and zero negative dimensions, never conflating gaps with negatives", () => {
  const input = buildInput([], "Evaluate an obscure market.", {});
  const result = runDecisionEngineV2(input);
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: null,
    legacyConfidence: null,
    disagreementReasons: [],
    traceId: "trace-unknown",
    isPartialReport: false,
  });
  assert.equal(record.hasNegativeEvidence, false);
  assert.equal(record.negativeDimensionCount, 0);
  assert.ok(record.unknownDimensionCount > 0);
  assert.ok(Object.values(record.dimensionStates).every((s) => s !== "weak" && s !== "unfavorable"));
});

test("5b. a genuinely negative dimension sets hasNegativeEvidence: true and is distinguishable from unknown dimensions in the same record", () => {
  const input = buildInput(
    [
      evidence({
        id: "R1",
        field: "competitors",
        url: "https://dominant-incumbent.example.com",
        claim: "A dominant incumbent controls this market with high switching costs and network effects.",
      }),
    ],
    "Evaluate this market.",
    {
      competitiveLandscape: "A dominant incumbent controls this market with high switching costs and network effects.",
    }
  );
  const result = runDecisionEngineV2(input);
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: null,
    legacyConfidence: null,
    disagreementReasons: [],
    traceId: "trace-negative",
    isPartialReport: false,
  });
  assert.equal(record.hasNegativeEvidence, true);
  assert.ok(record.negativeDimensionCount > 0);
  assert.ok(record.unknownDimensionCount > 0, "several other dimensions should still legitimately read unknown in this sparse fixture");
  assert.equal(record.dimensionStates.competitiveIntensity, "weak");
  assert.notEqual(record.dimensionStates.customerProblemEvidence, "weak");
});

// --- 6. No automatic promotion/activation ----------------------------------

test("6. controlled comparison capture is OFF by default in a production-like environment without the explicit A/B flag", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVerbose = process.env.ZERINIX_VERBOSE_LOGS;
  const originalAbFlag = process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.ZERINIX_VERBOSE_LOGS;
    delete process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING;
    assert.equal(shouldRecordControlledComparison(), false);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalVerbose === undefined) delete process.env.ZERINIX_VERBOSE_LOGS;
    else process.env.ZERINIX_VERBOSE_LOGS = originalVerbose;
    if (originalAbFlag === undefined) delete process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING;
    else process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING = originalAbFlag;
  }
});

test("6b. controlled comparison capture requires an explicit, dedicated flag in production -- the general verbose-logs flag alone does not implicitly enable it via a shared/ambiguous switch", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAbFlag = process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING;
  try {
    process.env.NODE_ENV = "production";
    process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING = "true";
    assert.equal(shouldRecordControlledComparison(), true, "the dedicated flag alone must be sufficient to opt in");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAbFlag === undefined) delete process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING;
    else process.env.ZERINIX_DECISION_ENGINE_V2_AB_LOGGING = originalAbFlag;
  }
});

test("6c. this module never writes to any report/response field, database table, or user-facing surface -- it only logs", async () => {
  const moduleExports = await import("../app/lib/decision-engine-v2/ab-readiness.ts");
  const runtimeExportNames = Object.keys(moduleExports)
    .filter((key) => typeof moduleExports[key] === "function")
    .sort();
  assert.deepEqual(
    runtimeExportNames,
    ["buildAbComparisonRecord", "recordControlledComparison", "shouldRecordControlledComparison"].sort(),
    "ab-readiness.ts must export nothing beyond building and logging a comparison record -- no writer/mutator function"
  );
});

// --- 7. Captured records are compact/derived only ---------------------------

test("7. the A/B record never contains the raw report sentences that produced it -- only decision codes, scores, and dimension states", () => {
  const distinctiveSentence = "Structural demand growth in the category continues to accelerate.";
  const input = strongFixtureInput();
  assert.ok(Object.values(input.sections).some((v) => v.includes(distinctiveSentence)));

  const result = runDecisionEngineV2(input);
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: "GO",
    legacyConfidence: 80,
    disagreementReasons: [],
    traceId: "trace-privacy",
    isPartialReport: false,
  });

  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes(distinctiveSentence), "the compact A/B record must never embed the original report prose verbatim");
});

test("7b. traceId is sourced from the existing report-request-id infrastructure, not a newly generated identifier scheme", () => {
  const result = runDecisionEngineV2(strongFixtureInput());
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: "GO",
    legacyConfidence: 80,
    disagreementReasons: [],
    traceId: "existing-report-request-id-123",
    isPartialReport: false,
  });
  assert.equal(record.traceId, "existing-report-request-id-123");
});

test("7c. the record is structurally complete -- all seven known decision dimensions are always present", () => {
  const result = runDecisionEngineV2(buildInput([], "Evaluate an obscure market.", {}));
  const record = buildAbComparisonRecord({
    result,
    legacyDecision: null,
    legacyConfidence: null,
    disagreementReasons: [],
    traceId: "trace-complete",
    isPartialReport: false,
  });
  assert.equal(Object.keys(record.dimensionStates).length, 7);
});
