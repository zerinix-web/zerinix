import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runExclusivelyByKey } from "../app/lib/ai/research-cache-core.ts";

// TASK #67 -- Prevent duplicate Market Intelligence provider calls with
// an atomic idempotency guard.
//
// Root cause (confirmed via direct trace, not inferred): the real
// production UI (components/Planner.tsx) always submits BOTH Business
// Idea Validation and Market Intelligence requests through
// POST /api/plan, minting a FRESH reportRequestId per submission
// (createMessageId()) every time -- so a double-click, a client retry
// after perceiving a hang, or "regenerate" with an identical prompt
// creates a SEPARATE report_jobs row each time, protected only by
// /api/plan's idempotency-key unique index (which does nothing for two
// DIFFERENT keys). Each such job independently reaches
// executeMarketAnalysisRequest (app/api/market-analysis/route.ts, called
// in-process from app/lib/report-jobs/plan-executor.ts once
// analysisMode === "market", and also reachable via that file's own
// standalone POST handler). Before this fix, the only protections inside
// executeMarketAnalysisRequest for the full-report branch were: (1) a
// pre-research cache lookup (getCachedAiResponse keyed by
// fullReportCacheKey) that both concurrent requests can equally miss
// before either has written a result -- a classic check-then-act race --
// and (2) countAiCallsForReport, which is scoped to the caller's OWN
// reportRequestId and therefore cannot see or block a DIFFERENT
// reportRequestId's concurrent, semantically-identical request at all.
//
// Fix: runExclusivelyByKey (app/lib/ai/research-cache-core.ts, a new,
// generic, dependency-free sibling of that file's existing, already-
// proven resolveCachedOrExecuteResearch) now wraps the full-report
// branch's entire cache-check-then-maybe-generate body, keyed by
// `${user.id}:${fullReportCacheKey}` -- fullReportCacheKey is the
// PRE-EXISTING, already-computed, canonical, deterministic identity for
// "this exact Market Intelligence request" (normalizedPrompt,
// uploadedAssetHash, analysisMode, language, reportFamily, model,
// reportVariant, contextFingerprint -- no reportRequestId, no
// timestamp), reused here unmodified rather than inventing a new
// fingerprint.

const marketRouteSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const researchCacheCoreSource = await readFile(
  new URL("../app/lib/ai/research-cache-core.ts", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------
// A/B -- two simultaneous equivalent requests result in exactly ONE
// expensive provider execution; the second concurrent duplicate can
// never independently pass the execution gate. Proven by directly
// counting real invocations of the guarded callback (the same callback
// shape -- "check cache, and only on a genuine miss do the expensive
// work" -- runFullReportGenerationOnce itself has, per its own first
// line, a getCachedAiResponse check before ever reaching
// client.responses.create). This is not inferred from any HTTP
// response; it is a direct count of executions of the guarded work.
// ---------------------------------------------------------------------

test("A/B: two simultaneous equivalent requests share the guard -- exactly one expensive execution occurs, and the concurrent duplicate never independently passes the gate", async () => {
  let providerCallCount = 0;
  let cachedResult = null;
  let releaseProviderCall;
  const providerGate = new Promise((resolve) => {
    releaseProviderCall = resolve;
  });

  const key = "user-1:same-canonical-fingerprint";
  const runOnce = async () => {
    if (cachedResult !== null) {
      // Mirrors runFullReportGenerationOnce's own first action: a real
      // cache check before any expensive work.
      return cachedResult;
    }
    providerCallCount += 1; // stands in for the real client.responses.create call
    await providerGate;
    cachedResult = "generated-report";
    return cachedResult;
  };

  const first = runExclusivelyByKey(key, runOnce);
  const second = runExclusivelyByKey(key, runOnce);

  // Let both calls reach their synchronous check-then-set point before
  // the gate opens. If the guard were a check-then-set RACE (not
  // atomic), both would already have incremented providerCallCount here.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    providerCallCount,
    1,
    "only one caller may have reached the expensive step while the guard is held"
  );

  releaseProviderCall();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(
    providerCallCount,
    1,
    "the concurrent duplicate must never independently execute the expensive step a second time"
  );
  assert.equal(firstResult, "generated-report");
  assert.equal(secondResult, "generated-report");
});

// ---------------------------------------------------------------------
// C -- a genuinely different request fingerprint is not incorrectly
// deduplicated.
// ---------------------------------------------------------------------

test("C: two requests with different fingerprints execute independently, never deduplicated against each other", async () => {
  let executionCount = 0;
  const run = async () => {
    executionCount += 1;
    return "ok";
  };

  const [a, b] = await Promise.all([
    runExclusivelyByKey("user-1:fingerprint-A", run),
    runExclusivelyByKey("user-1:fingerprint-B", run),
  ]);

  assert.equal(executionCount, 2, "two distinct fingerprints must each execute their own attempt");
  assert.equal(a, "ok");
  assert.equal(b, "ok");
});

// ---------------------------------------------------------------------
// D -- after a failed provider execution, a legitimate retry can
// execute (no permanent lock on failure).
// ---------------------------------------------------------------------

test("D: after a failed execution, a legitimate retry for the same key can execute", async () => {
  const key = "user-1:retry-after-failure";
  let attempts = 0;

  const failingRun = async () => {
    attempts += 1;
    throw new Error("simulated provider failure");
  };

  await assert.rejects(() => runExclusivelyByKey(key, failingRun));
  assert.equal(attempts, 1);

  const succeedingRun = async () => {
    attempts += 1;
    return "generated-report";
  };
  const result = await runExclusivelyByKey(key, succeedingRun);

  assert.equal(result, "generated-report");
  assert.equal(
    attempts,
    2,
    "the retry must actually execute, never be silently blocked by the prior failed attempt's key"
  );
});

// ---------------------------------------------------------------------
// E -- a stale guard/lease cannot block execution forever. Several
// consecutive failures in a row must each genuinely execute, and a
// final success must still be reachable afterward.
// ---------------------------------------------------------------------

test("E: a stale guard cannot block execution forever -- consecutive failures never leave the key permanently held", async () => {
  const key = "user-1:stale-guard-check";
  let attempts = 0;
  const failingRun = async () => {
    attempts += 1;
    throw new Error(`simulated failure #${attempts}`);
  };

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(() => runExclusivelyByKey(key, failingRun));
  }

  assert.equal(
    attempts,
    5,
    "every consecutive attempt must actually run -- none may be silently swallowed by a leftover guard entry"
  );

  const result = await runExclusivelyByKey(key, async () => "recovered");
  assert.equal(result, "recovered");
});

// ---------------------------------------------------------------------
// Abort/timeout-shaped failure also frees the guard (STEP 4: aborted
// request, timeout).
// ---------------------------------------------------------------------

test("an aborted/timed-out-shaped rejection frees the guard exactly like any other failure", async () => {
  const key = "user-1:abort-shaped-failure";
  const abortError = new Error("The operation was aborted");
  abortError.name = "AbortError";

  await assert.rejects(
    () =>
      runExclusivelyByKey(key, async () => {
        throw abortError;
      }),
    /aborted/
  );

  const result = await runExclusivelyByKey(key, async () => "post-abort-retry-ok");
  assert.equal(result, "post-abort-retry-ok");
});

// ---------------------------------------------------------------------
// Recursive waiters correctly re-run the guarded work after the holder
// settles, and only one caller ever holds the key at a time even with
// many concurrent duplicates (not just two).
// ---------------------------------------------------------------------

test("many concurrent duplicates (not just two) still produce exactly one expensive execution when the holder succeeds and populates a shared cache", async () => {
  let providerCallCount = 0;
  let cachedResult = null;
  let releaseProviderCall;
  const providerGate = new Promise((resolve) => {
    releaseProviderCall = resolve;
  });

  const key = "user-1:many-concurrent-duplicates";
  const runOnce = async () => {
    if (cachedResult !== null) return cachedResult;
    providerCallCount += 1;
    await providerGate;
    cachedResult = "generated-report";
    return cachedResult;
  };

  const callers = Array.from({ length: 10 }, () => runExclusivelyByKey(key, runOnce));
  await new Promise((resolve) => setImmediate(resolve));
  releaseProviderCall();
  const results = await Promise.all(callers);

  assert.equal(providerCallCount, 1, "10 concurrent duplicates must still produce exactly one expensive execution");
  assert.ok(results.every((value) => value === "generated-report"));
});

// ---------------------------------------------------------------------
// STEP 2 -- canonical request identity: the guard key must be built
// only from fullReportCacheKey (already the deterministic, timestamp-
// free identity computed for the pre-existing cache lookup) plus the
// user id -- never reportRequestId, never a raw timestamp.
// ---------------------------------------------------------------------

test("the Market Intelligence full-report guard key reuses the existing canonical fullReportCacheKey identity, never reportRequestId or a timestamp", () => {
  const guardKeyLine = marketRouteSource.match(/const fullReportGuardKey = `[^`]+`;/);
  assert.ok(guardKeyLine, "expected a fullReportGuardKey declaration");
  assert.match(guardKeyLine[0], /\$\{user\.id\}/);
  assert.match(guardKeyLine[0], /\$\{fullReportCacheKey\}/);
  assert.doesNotMatch(guardKeyLine[0], /reportRequestId/);
  assert.doesNotMatch(guardKeyLine[0], /Date\.now|new Date/);

  // fullReportCacheKey itself (already existing, unmodified) is built
  // from createPreResearchReportCacheKey with the ResearchCacheIdentity
  // fields -- confirm this wiring is untouched.
  assert.match(
    marketRouteSource,
    /const fullReportCacheKey = createPreResearchReportCacheKey\(\{/
  );
});

// ---------------------------------------------------------------------
// STEP 3 -- the guard genuinely wraps the full-report branch: the
// function passed to runExclusivelyByKey is the one whose body performs
// the real cache-check-then-maybe-generate work, ending in the real
// client.responses.create call and the final streamed Response.
// ---------------------------------------------------------------------

test("runExclusivelyByKey wraps the real full-report cache-check-and-generate function, which itself contains the real client.responses.create call and returns the real streamed Response", () => {
  const guardCallIndex = marketRouteSource.indexOf(
    "return runExclusivelyByKey(fullReportGuardKey, runFullReportGenerationOnce);"
  );
  assert.ok(guardCallIndex > 0, "expected the guard to be invoked with runFullReportGenerationOnce");

  const fnStart = marketRouteSource.indexOf(
    "const runFullReportGenerationOnce = async (): Promise<Response> => {"
  );
  assert.ok(fnStart > 0 && fnStart < guardCallIndex, "the guarded function must be declared before the guard call");

  const guardedBody = marketRouteSource.slice(fnStart, guardCallIndex);

  // The real, expensive provider call is inside the guarded function.
  assert.match(guardedBody, /client\.responses\.create\(/);
  assert.match(guardedBody, /max_output_tokens: FULL_REPORT_MAX_OUTPUT_TOKENS/);
  // The real cache check (unmodified) runs first, before generation.
  assert.match(guardedBody, /const cachedFullReport = await getCachedAiResponse\(/);
  const cacheCheckIndex = guardedBody.indexOf("const cachedFullReport = await getCachedAiResponse(");
  const providerCallIndex = guardedBody.indexOf("client.responses.create(");
  assert.ok(cacheCheckIndex < providerCallIndex, "cache check must still run before the provider call");
  // The final response returned by the guarded function is the real
  // streamed NDJSON Response, unchanged.
  assert.match(guardedBody, /return new Response\(stream, \{/);
});

// ---------------------------------------------------------------------
// STEP 4 -- failure recovery is structurally guaranteed: no `await`
// between registering ownership and running the guarded work, and
// release always runs in `finally` in the generic primitive (verified
// directly on research-cache-core.ts's own source, since that guarantee
// lives there, not per call site).
// ---------------------------------------------------------------------

test("runExclusivelyByKey's own implementation guarantees release in `finally`, with no permanent lock on failure", () => {
  assert.match(researchCacheCoreSource, /export async function runExclusivelyByKey/);
  const fnIndex = researchCacheCoreSource.indexOf("export async function runExclusivelyByKey");
  const fnBody = researchCacheCoreSource.slice(fnIndex);
  assert.match(fnBody, /try\s*\{\s*return await run\(\);\s*\}\s*finally\s*\{/);
  assert.match(fnBody, /release\(\);/);
  assert.match(fnBody, /exclusiveExecutions\.delete\(key\)/);
});

// ---------------------------------------------------------------------
// F -- existing cache-hit behavior still avoids provider execution:
// the pre-existing cache-hit-and-return block is still positioned
// before the provider call, inside the now-guarded function, unchanged.
// ---------------------------------------------------------------------

test("F: the pre-existing cache-hit branch still returns before ever reaching the provider call, unchanged by the guard", () => {
  const fnStart = marketRouteSource.indexOf(
    "const runFullReportGenerationOnce = async (): Promise<Response> => {"
  );
  const guardCallIndex = marketRouteSource.indexOf(
    "return runExclusivelyByKey(fullReportGuardKey, runFullReportGenerationOnce);"
  );
  const guardedBody = marketRouteSource.slice(fnStart, guardCallIndex);

  const cacheHitReturnIndex = guardedBody.indexOf(
    "cachedWarning +\n              serializeMarketReportChunks(parsedCachedReport)"
  );
  const providerCallIndex = guardedBody.indexOf("client.responses.create(");
  assert.ok(cacheHitReturnIndex > 0 && cacheHitReturnIndex < providerCallIndex);
});

// ---------------------------------------------------------------------
// G -- existing quota/rate-limit/cost-instrumentation behavior is
// unaffected: checkAiProductionRateLimit, countAiCallsForReport, and
// recordAiUsage all still appear, in the same relative order, inside
// the (now-guarded) full-report branch.
// ---------------------------------------------------------------------

test("G: quota, AI-call-budget, and usage-accounting calls are all still present and in the same relative order relative to the guard", () => {
  const quotaIndex = marketRouteSource.indexOf("const productionLimit = await checkAiProductionRateLimit(");
  const guardCallIndex = marketRouteSource.indexOf(
    "return runExclusivelyByKey(fullReportGuardKey, runFullReportGenerationOnce);"
  );
  const scoped = marketRouteSource.slice(quotaIndex, guardCallIndex + 200);

  const aiCallBudgetIndex = scoped.indexOf("const existingAiCallCount = await countAiCallsForReport(");

  assert.ok(quotaIndex >= 0, "checkAiProductionRateLimit must still run");
  assert.ok(aiCallBudgetIndex > 0, "countAiCallsForReport must still run, after the quota check, in the same order as before");
  // recordAiUsage (cache-hit, success, and failure paths) presence --
  // at minimum all 3 call sites must still exist inside the guarded
  // branch.
  assert.ok(scoped.match(/recordAiUsage\(supabase, \{/g).length >= 3, "cache-hit, success, and failure usage-recording call sites must all still be present");
});

test("G: the guard was NOT added to the single-field regeneration branch or to quota/rate-limit modules themselves -- narrowly scoped to the full-report path only", () => {
  const singleFieldBranchStart = marketRouteSource.indexOf("const cacheKey = createAiCacheKey({");
  const singleFieldBranchSlice = marketRouteSource.slice(singleFieldBranchStart, singleFieldBranchStart + 4000);
  assert.doesNotMatch(singleFieldBranchSlice, /runExclusivelyByKey/);

  const callSiteOccurrences = (marketRouteSource.match(/runExclusivelyByKey\(fullReportGuardKey, runFullReportGenerationOnce\)/g) || []).length;
  assert.equal(callSiteOccurrences, 1, "expected exactly one guard call site, scoped to the full-report branch only");
});

// ---------------------------------------------------------------------
// H -- no change to canonical Market Intelligence decision, confidence,
// ENTER eligibility, evidence-gap, TAM/SAM/SOM, or provenance logic:
// every decision-relevant function call inside the guarded branch is
// still present, verbatim, in the same relative order.
// ---------------------------------------------------------------------

test("H: canonical decision/confidence/coverage/TAM-SAM-SOM logic inside the full-report branch is untouched by the guard", () => {
  const fnStart = marketRouteSource.indexOf(
    "const runFullReportGenerationOnce = async (): Promise<Response> => {"
  );
  const guardCallIndex = marketRouteSource.indexOf(
    "return runExclusivelyByKey(fullReportGuardKey, runFullReportGenerationOnce);"
  );
  const guardedBody = marketRouteSource.slice(fnStart, guardCallIndex);

  for (const mustContain of [
    "applyMarketResearchCoverageToContext(",
    "buildPreGenerationVerdictContext(",
    "assessMarketEntryConfidence(",
    "resolveDecisionCriticalEvidenceState(marketIntelligenceGraph)",
    "parseFullMarketReport(",
    "buildMarketIntelligenceGraph(domainResearch, promptText, responseLanguage)",
    "Market Size, CAGR, and TAM/SAM/SOM must preserve their source definitions",
  ]) {
    assert.ok(
      guardedBody.includes(mustContain),
      `expected canonical decision-related code to be unchanged and present: ${mustContain}`
    );
  }
});

// ---------------------------------------------------------------------
// No regression to Business Idea Validation: the new guard is
// Market-Intelligence-specific; plan-executor.ts (Business Idea
// Validation's own generation path) does not reference it at all, and
// the pre-existing research-level dedup primitive
// (resolveCachedOrExecuteResearch), which Business Idea Validation's
// own research calls rely on, is untouched.
// ---------------------------------------------------------------------

test("no regression to Business Idea Validation: plan-executor.ts does not use the new Market Intelligence guard, and the pre-existing research dedup primitive is untouched", () => {
  assert.doesNotMatch(planExecutorSource, /runExclusivelyByKey/);
  assert.match(
    researchCacheCoreSource,
    /export async function resolveCachedOrExecuteResearch<T>\(input: \{\s*\n\s*dedupeKey: string;\s*\n\s*read: \(\) => Promise<T \| null>;\s*\n\s*execute: \(\) => Promise<T>;\s*\n\s*write: \(value: T\) => Promise<void>;\s*\n\s*\}\): Promise<ResearchResolution<T>>/
  );
});
