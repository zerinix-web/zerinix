import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isShadowEvaluationEnabled,
  isShadowKillSwitchEngaged,
} from "../app/lib/decision-engine-v2/ab-readiness.ts";
import {
  runDecisionEngineV2ShadowMode,
  scheduleDecisionEngineV2ShadowMode,
} from "../app/lib/decision-engine-v2/shadow-mode.ts";
import { readShadowComparisonLog, shadowComparisonLogPath } from "../app/lib/decision-engine-v2/shadow-log.ts";
import { evidence, buildInput } from "./fixtures/decision-engine-v2-scenarios.mjs";

// Controlled production shadow observation -- proves:
//   1. The kill switch instantly disables evaluation ENTIRELY (not just
//      logging), and wins over every other enable signal.
//   2. Latency protection: scheduleDecisionEngineV2ShadowMode defers
//      execution so it structurally cannot delay the caller.
//   3. The latency budget causes an anomalously slow evaluation to skip
//      the (avoidable) comparison-building/logging work.
//   4. Zero new AI/search/database/external API calls exist anywhere in
//      the Decision Engine V2 source tree.

const ENV_VARS = [
  "ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH",
  "ZERINIX_DECISION_ENGINE_V2_AB_LOGGING",
  "ZERINIX_VERBOSE_LOGS",
  "NODE_ENV",
];

function withEnv(overrides, fn) {
  const originals = Object.fromEntries(ENV_VARS.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of ENV_VARS) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  }
}

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
    ],
    "Evaluate this market.",
    { marketOverview: "Demand is growing rapidly, with strong adoption across the segment." }
  );
}

function flushImmediates() {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- 1. Kill switch -------------------------------------------------------

test("1. kill switch OFF, no other flag set, non-production: evaluation is enabled by the dev-mode default", () => {
  withEnv({ ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: undefined, ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: undefined, NODE_ENV: "development" }, () => {
    assert.equal(isShadowKillSwitchEngaged(), false);
    assert.equal(isShadowEvaluationEnabled(), true);
  });
});

test("1b. kill switch ON overrides the dedicated A/B logging flag being ON -- kill switch always wins", () => {
  withEnv(
    { ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: "true", ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: "true", NODE_ENV: "production" },
    () => {
      assert.equal(isShadowKillSwitchEngaged(), true);
      assert.equal(isShadowEvaluationEnabled(), false, "the kill switch must disable evaluation even though the enable flag is also set");
    }
  );
});

test("1c. kill switch ON overrides dev-mode default too -- an operator can force shadow evaluation off everywhere, including local dev", () => {
  withEnv(
    { ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: "true", ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: undefined, NODE_ENV: "development" },
    () => {
      assert.equal(isShadowEvaluationEnabled(), false);
    }
  );
});

test("1d. kill switch ON causes runDecisionEngineV2ShadowMode to skip evaluation entirely -- no computation, no return value, no log entries", () => {
  withEnv({ ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: "true" }, () => {
    const traceId = `kill-switch-test-${Math.random()}`;
    const result = runDecisionEngineV2ShadowMode({
      decisionInput: strongFixtureInput(),
      executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
      reportRequestId: traceId,
      isPartialReport: false,
    });
    assert.equal(result, null, "the kill switch must produce a null result, identical in shape to any other disabled/failed path");
    const entries = readShadowComparisonLog().filter((e) => e.reportRequestId === traceId);
    assert.equal(entries.length, 0, "a killed evaluation must leave no trace in the log");
  });
});

test("1e. default production environment (no flags set at all) disables evaluation -- REQUIREMENT 10", () => {
  withEnv(
    {
      ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: undefined,
      ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: undefined,
      NODE_ENV: "production",
    },
    () => {
      assert.equal(isShadowEvaluationEnabled(), false);
    }
  );
});

test("1f. PRE-COMMIT AUDIT FIX: general-purpose verbose logging alone in production must NOT enable shadow evaluation -- only the dedicated flag may", () => {
  withEnv(
    {
      ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: undefined,
      ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: undefined,
      ZERINIX_VERBOSE_LOGS: "true",
      NODE_ENV: "production",
    },
    () => {
      assert.equal(
        isShadowEvaluationEnabled(),
        false,
        "an operator turning on ZERINIX_VERBOSE_LOGS in production for an unrelated reason must not silently also activate Decision Engine V2 evaluation"
      );
    }
  );
});

test("1g. the dedicated flag still works correctly even when general verbose logging is also on", () => {
  withEnv(
    {
      ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: undefined,
      ZERINIX_DECISION_ENGINE_V2_AB_LOGGING: "true",
      ZERINIX_VERBOSE_LOGS: "true",
      NODE_ENV: "production",
    },
    () => {
      assert.equal(isShadowEvaluationEnabled(), true);
    }
  );
});

// --- 2. Latency protection: deferred scheduling ----------------------------

test("2. scheduleDecisionEngineV2ShadowMode returns immediately (void) and does not run the evaluation synchronously", async () => {
  const traceId = `schedule-defer-test-${Math.random()}`;
  const returnValue = scheduleDecisionEngineV2ShadowMode({
    decisionInput: strongFixtureInput(),
    executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
    reportRequestId: traceId,
    isPartialReport: false,
  });
  assert.equal(returnValue, undefined, "scheduling must return void -- nothing for the caller to wait on or use");

  // Immediately after the call, on the SAME synchronous tick, nothing
  // should have run yet -- this is the actual latency-protection
  // property: a caller enqueueing a response right after this call site
  // is never blocked by the evaluation itself.
  const entriesBeforeFlush = readShadowComparisonLog().filter((e) => e.reportRequestId === traceId);
  assert.equal(entriesBeforeFlush.length, 0, "evaluation must not have run synchronously");

  await flushImmediates();

  const entriesAfterFlush = readShadowComparisonLog().filter((e) => e.reportRequestId === traceId);
  assert.equal(entriesAfterFlush.length, 1, "evaluation must still complete on a later tick -- deferred, not dropped");
});

test("2b. scheduleDecisionEngineV2ShadowMode does not even schedule a callback when disabled -- zero event-loop cost, not just zero logging", async () => {
  const traceId = `schedule-disabled-test-${Math.random()}`;
  await withEnv({ ZERINIX_DECISION_ENGINE_V2_SHADOW_KILL_SWITCH: "true" }, async () => {
    scheduleDecisionEngineV2ShadowMode({
      decisionInput: strongFixtureInput(),
      executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
      reportRequestId: traceId,
      isPartialReport: false,
    });
    await flushImmediates();
    await flushImmediates();
  });
  const entries = readShadowComparisonLog().filter((e) => e.reportRequestId === traceId);
  assert.equal(entries.length, 0, "a disabled evaluation must never appear in the log, even after flushing pending ticks");
});

// --- 3. Latency budget ------------------------------------------------------

test("3. an evaluation that exceeds the latency budget skips the comparison record but still returns the computed result", () => {
  const traceId = `latency-budget-test-${Math.random()}`;
  const realPerformanceNow = performance.now;
  let call = 0;
  // shadow-mode.ts measures elapsed time via performance.now() (a
  // dedicated timer used nowhere else in this codebase, specifically so
  // it can be mocked here without affecting the many incidental
  // Date.now() calls elsewhere in the computation graph). First call
  // (start) returns a fixed time; the second (immediately after
  // runDecisionEngineV2) returns a time far enough in the future to
  // exceed MAX_SHADOW_EVALUATION_MS, deterministically simulating a
  // pathologically slow evaluation without the computation actually
  // needing to be slow.
  performance.now = () => {
    call += 1;
    return call === 1 ? 1_000_000 : 1_000_000 + 10_000;
  };
  let result;
  try {
    result = runDecisionEngineV2ShadowMode({
      decisionInput: strongFixtureInput(),
      executiveSummaryText: "Executive Decision: ENTER (Confidence: 70%)",
      reportRequestId: traceId,
      isPartialReport: false,
    });
  } finally {
    performance.now = realPerformanceNow;
  }
  assert.ok(result, "the already-computed result must still be returned -- the budget only skips ADDITIONAL work, not the evaluation itself");
  const entries = readShadowComparisonLog().filter((e) => e.reportRequestId === traceId);
  assert.equal(entries.length, 0, "a budget-exceeding evaluation must not produce a full comparison record");
});

// --- 4. No new AI/search/database/external API calls -----------------------

test("4. no fetch/HTTP client/AI SDK/search provider/database call exists anywhere in the Decision Engine V2 source tree", () => {
  const decisionEngineV2Dir = join(import.meta.dirname, "..", "app", "lib", "decision-engine-v2");
  const files = [
    "types.ts",
    "evidence-signals.ts",
    "dimensions.ts",
    "engine.ts",
    "shadow-mode.ts",
    "shadow-log.ts",
    "ab-readiness.ts",
  ];
  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /\baxios\b/,
    /\bhttp\.request\s*\(/,
    /\bhttps\.request\s*\(/,
    /\bsupabase\s*\./i,
    /\bopenai\b/i,
    /\banthropic\b/i,
    /\btavily\b/i,
    /\.query\s*\(/,
    /\.insert\s*\(/,
    /\.update\s*\(/,
  ];
  for (const file of files) {
    const source = readFileSync(join(decisionEngineV2Dir, file), "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${file} must not contain ${pattern} -- Decision Engine V2 must never make a new AI/search/database call`);
    }
  }
});

test("4b. shadow-log.ts and ab-readiness.ts write only to the local filesystem or the existing operational logger -- no network client is imported", () => {
  const decisionEngineV2Dir = join(import.meta.dirname, "..", "app", "lib", "decision-engine-v2");
  for (const file of ["shadow-log.ts", "ab-readiness.ts"]) {
    const source = readFileSync(join(decisionEngineV2Dir, file), "utf8");
    const importLines = source.split("\n").filter((line) => line.trim().startsWith("import"));
    for (const line of importLines) {
      assert.ok(
        /node:fs|node:path|@\/app\/lib\/security\/logging|@\/app\/lib\/report-engine\/executive-decision-brief|\.\/types\.ts/.test(line),
        `unexpected import in ${file}: ${line.trim()}`
      );
    }
  }
});

test("shadowComparisonLogPath stays under the local .next directory, never a remote or configurable-to-remote destination", () => {
  assert.ok(shadowComparisonLogPath().includes(`${join(".next", "decision-engine-v2")}`));
});
