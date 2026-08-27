import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolveCachedOrExecuteResearch } from "../app/lib/ai/research-cache-core.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// P0 PRODUCTION FIX -- Market Intelligence report generation timeout
// incident.
//
// CONFIRMED PRODUCTION EXECUTION TIMELINE (traced through the actual
// code, not guessed):
//
// frontend (Planner.tsx) -> POST /api/plan -> job row inserted -> the
// SAME serverless invocation's after() callback runs
// processReportJobQueue() IN-PROCESS (not a separate worker service) ->
// plan-executor.ts dispatches to market-analysis/route.ts's
// executeMarketAnalysisRequest, ALSO in-process (a synthetic in-memory
// Request object, never a real network hop) -> research (OpenAI web
// search, up to 120s outer cap) -> full-report synthesis (one large
// OpenAI call, up to 180s) -> post-processing (12s) -> persistence.
//
// ROOT CAUSE: every trigger path for this pipeline
// (app/api/plan/route.ts, app/api/report-jobs/[jobId]/route.ts's poll-
// triggered recovery, the daily cron's app/api/report-jobs/worker/route.ts)
// shares Vercel's maxDuration=300 with whatever work Next's after()
// defers into the SAME invocation -- it is not a genuinely separate,
// independently-budgeted process. The pipeline's own nested timeouts
// (research 120s + synthesis 180s + post-process 12s, +15s optional
// entity extraction) could already sum to ~312-327s in the NON-
// pathological case, exceeding 300s outright. When Vercel hard-kills the
// function at its maxDuration, that is NOT a catchable JS exception --
// app/lib/report-jobs/worker.ts's own try/catch/finally around the whole
// job never runs, so the job's status is never written past whatever its
// last progress update reached (typically "researching" or
// "generating"). Compounding this, BOTH the idempotency check in
// app/api/plan/route.ts and the recovery-trigger in
// app/api/report-jobs/[jobId]/route.ts only re-invoked the worker for
// jobs already in "queued"/"retry_wait" -- a job stuck in any ACTIVE
// status was echoed back with that same stale status, HTTP 200, forever.
// The only thing that could ever reclaim it was the once-daily 3am cron
// (vercel.json) -- up to ~24 hours "stuck" from a user's perspective.
//
// FIXES (this file's regression coverage maps 1:1 to each):
//  1. app/lib/report-jobs/worker.ts: a proactive top-level watchdog
//     deadline (JOB_PROCESSING_DEADLINE_MS) aborts the in-flight work
//     BEFORE Vercel's own hard kill, guaranteeing the job reaches
//     retry_wait/failed instead of being silently abandoned.
//  2. app/lib/report-jobs/worker.ts: two confirmed silent no-op bugs
//     fixed -- markTerminalFailure's lease-conditioned UPDATE could
//     match zero rows and report success with nothing written; the
//     transient-failure path's own fail_report_job RPC failure had no
//     fallback at all. Both now force a guaranteed terminal write.
//  3. app/api/report-jobs/[jobId]/route.ts: the recovery-trigger now
//     fires for ANY non-terminal status, not just queued/retry_wait --
//     the underlying claim_report_job_by_id RPC already safely no-ops
//     unless the job's lease has genuinely expired, so this closes the
//     "up to 24 hours stuck" gap down to one polling interval, using
//     entirely pre-existing, already-atomic database logic.
//  4. app/lib/ai/domain-research.ts / app/api/market-analysis/route.ts:
//     the research-phase and full-report-synthesis timeouts are
//     rebalanced downward so their sum reliably fits under the 300s
//     ceiling with real margin -- the degraded-evidence fallback and
//     every evidence-integrity guarantee are completely unchanged.
//  5. app/lib/ai/research-cache-core.ts: a genuine duplicate-expensive-
//     call race (two concurrent requests for the same identity could
//     both see an empty in-flight map before either registered) is
//     closed by registering the in-flight promise synchronously.
//  6. app/api/market-analysis/route.ts: the single-field regeneration
//     branch's OpenAI call had NO independent timeout at all (relying
//     solely on the incoming HTTP request's own abort behavior) -- now
//     bounded like every other external call.
//  7. components/Planner.tsx: the initial /api/plan enqueue fetch had no
//     bound of its own (only the SUBSEQUENT polling loop had a ceiling)
//     -- a fully-hung connection could strand the UI before polling
//     ever started. Now bounded, with a clear, recoverable error.

const statusRouteSource = readFileSync(
  join(repoRoot, "app/api/report-jobs/[jobId]/route.ts"),
  "utf8"
);
const marketRouteSource = readFileSync(
  join(repoRoot, "app/api/market-analysis/route.ts"),
  "utf8"
);
const domainResearchSource = readFileSync(join(repoRoot, "app/lib/ai/domain-research.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// ===========================================================================
// A. Job terminal-state guarantee -- the top-level watchdog (real
//    behavioral test, not just a static pin)
// ===========================================================================

// Builds a real, runnable copy of processNextReportJob with exactly two
// dependencies faked: createServiceRoleClient (needs real Supabase
// credentials this test environment doesn't have) and executePlanRequest
// (the actual 9800+ line report-generation pipeline -- faked here to
// simulate a hang, which is the exact production failure mode). Every
// other import (field labels, schema validators, the 6 disabled-by-
// default report-engine modules) is the REAL module -- none of them run
// in this scenario anyway, since the fake executePlanRequest never
// resolves before the watchdog fires. The only textual rewrite beyond
// the two import specifiers is JOB_PROCESSING_DEADLINE_MS itself, scaled
// down from 280_000 to a few milliseconds so the test doesn't take
// minutes to run -- this exercises the exact same deadline-timer/abort/
// catch-block wiring the real 280_000ms deadline uses, just faster.
async function importWorkerWithFakes({ deadlineMs, executePlanRequestSource }) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-worker-timeout-"));

  const fakeAdminPath = join(dir, "fake-admin.mts");
  writeFileSync(
    fakeAdminPath,
    `
export const __rpcCalls = [];
export let __fakeSupabase = null;
export function __setFakeSupabase(client) { __fakeSupabase = client; }
export function createServiceRoleClient() {
  if (!__fakeSupabase) throw new Error("test fake supabase not configured");
  return __fakeSupabase;
}
`
  );

  const fakePlanExecutorPath = join(dir, "fake-plan-executor.mts");
  writeFileSync(fakePlanExecutorPath, executePlanRequestSource);

  let source = readFileSync(join(repoRoot, "app/lib/report-jobs/worker.ts"), "utf8");
  // "server-only" is a bare-specifier, side-effect-only import that only
  // exists to fail the build if this module is ever bundled client-side
  // -- it is not resolvable from a temp directory outside node_modules'
  // normal resolution chain, and has no runtime behavior worth testing.
  source = source.replace('import "server-only";', "");
  source = source.replace(
    '"@/app/lib/supabase/admin"',
    JSON.stringify(pathToFileURL(fakeAdminPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-jobs/plan-executor"',
    JSON.stringify(pathToFileURL(fakePlanExecutorPath).href)
  );
  const deadlineMarker = "const JOB_PROCESSING_DEADLINE_MS = 280_000;";
  if (!source.includes(deadlineMarker)) {
    throw new Error("JOB_PROCESSING_DEADLINE_MS marker not found -- worker.ts may have changed");
  }
  source = source.replace(deadlineMarker, `const JOB_PROCESSING_DEADLINE_MS = ${deadlineMs};`);

  const outPath = join(dir, "worker.mts");
  writeFileSync(outPath, source);

  const workerModule = await import(pathToFileURL(outPath).href);
  const adminModule = await import(pathToFileURL(fakeAdminPath).href);
  return { workerModule, adminModule };
}

// A minimal, chainable fake of the report_jobs table update surface --
// only what markTerminalFailure's two update statements (the lease-
// conditioned primary write and the unconditional fallback) actually
// call: .from().update().eq()...(.gt())?...select()?.
function buildFakeReportJobsTable({ updateResponses }) {
  const updateCalls = [];
  let callIndex = 0;
  return {
    from: (table) => {
      if (table !== "report_jobs") {
        throw new Error(`Unexpected table in test: ${table}`);
      }
      return {
        update: (fields) => {
          const call = { fields, filters: {} };
          updateCalls.push(call);
          const builder = {
            eq: (column, value) => {
              call.filters[column] = value;
              return builder;
            },
            neq: (column, value) => {
              call.filters[`${column}__neq`] = value;
              return builder;
            },
            gt: (column, value) => {
              call.filters[`${column}__gt`] = value;
              return builder;
            },
            select: async () => {
              const response = updateResponses[Math.min(callIndex, updateResponses.length - 1)];
              callIndex += 1;
              return response;
            },
            // markTerminalFailure's fallback path does not chain
            // .select() after the unconditional update -- support being
            // awaited directly too.
            then: (resolve) => {
              const response = updateResponses[Math.min(callIndex, updateResponses.length - 1)];
              callIndex += 1;
              resolve(response);
            },
          };
          return builder;
        },
      };
    },
    updateCalls,
  };
}

function buildFakeSupabase({ jobRow, failRpcResponse, reportJobsTable }) {
  const rpcCalls = [];
  const table = reportJobsTable || buildFakeReportJobsTable({ updateResponses: [{ data: [], error: null }] });
  const supabase = {
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      if (name === "claim_report_job") {
        return { data: [jobRow], error: null };
      }
      if (name === "renew_report_job_lease") {
        return { error: null };
      }
      if (name === "fail_report_job") {
        return failRpcResponse || { data: [{ status: "retry_wait" }], error: null };
      }
      if (name === "update_report_job_progress") {
        return { error: null };
      }
      if (name === "complete_report_job") {
        return { error: null };
      }
      throw new Error(`Unexpected RPC in test: ${name}`);
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: jobRow.user_id } }, error: null }),
      },
    },
    from: table.from,
  };
  return { supabase, rpcCalls, table };
}

const baseJobRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  status: "claimed",
  progress: 5,
  request_payload: { analysisMode: "market", reportRequestId: "test-request-id" },
  attempt_count: 1,
  max_attempts: 3,
  next_attempt_at: null,
  lease_owner: "some-worker",
  lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
  started_at: new Date().toISOString(),
};

// A fake executePlanRequest that properly honors AbortSignal (exactly
// like the real fetch/OpenAI SDK calls at the bottom of this same call
// chain do) but otherwise never resolves on its own -- simulating the
// real production failure mode: a slow/stuck provider or model call that
// would otherwise run past Vercel's own hard maxDuration kill.
const hangingExecutePlanRequestSource = `
export async function executePlanRequest(request, _context) {
  return new Promise((_resolve, reject) => {
    const signal = request.signal;
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
      { once: true }
    );
  });
}
`;

// A single shared import of the (fake-wired) worker module purely to
// reach its exported isTransientFailure classifier -- worker.ts cannot
// be imported directly by plain Node (it starts with `import
// "server-only"`, a bare specifier Next.js resolves specially at build
// time and which is not an installed package here), so every real
// import of it in this file goes through importWorkerWithFakes.
const { workerModule: sharedWorkerModule } = await importWorkerWithFakes({
  deadlineMs: 999_999_999,
  executePlanRequestSource: `export async function executePlanRequest() { throw new Error("not used in this test"); }`,
});
const { isTransientFailure } = sharedWorkerModule;

test("A1 (job terminal-state guarantee / model timeout): a hung executePlanRequest is proactively aborted by the internal deadline and the job is scheduled for retry, never left stuck", async () => {
  const { workerModule, adminModule } = await importWorkerWithFakes({
    deadlineMs: 30,
    executePlanRequestSource: hangingExecutePlanRequestSource,
  });
  const { supabase, rpcCalls } = buildFakeSupabase({ jobRow: baseJobRow });
  adminModule.__setFakeSupabase(supabase);

  const startedAt = Date.now();
  const result = await workerModule.processNextReportJob({});
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.processed, true);
  assert.equal(result.status, "retry_wait", "a deadline-exceeded job must be scheduled for retry, not left in its active status");
  assert.ok(elapsedMs < 5_000, `the watchdog must fire quickly, not hang -- took ${elapsedMs}ms`);

  const failCall = rpcCalls.find((call) => call.name === "fail_report_job");
  assert.ok(failCall, "fail_report_job RPC must have been called");
  assert.equal(failCall.params.error_code, "REPORT_JOB_TRANSIENT_FAILURE");
  assert.match(failCall.params.error_message, /timed out|processing deadline/i);
});

test("A2 (job terminal-state guarantee, attempts exhausted): once fail_report_job itself reports the job as definitively failed (attempts exhausted -- the real SQL RPC's own behavior), the worker's return value reflects that terminal state, never a silent retry loop", async () => {
  const { workerModule, adminModule } = await importWorkerWithFakes({
    deadlineMs: 30,
    executePlanRequestSource: hangingExecutePlanRequestSource,
  });
  const exhaustedJobRow = { ...baseJobRow, attempt_count: 3, max_attempts: 3 };
  const { supabase, rpcCalls } = buildFakeSupabase({
    jobRow: exhaustedJobRow,
    // Mirrors claim_report_job_by_id's own real SQL behavior once
    // attempt_count >= max_attempts: the job is marked "failed", not
    // "retry_wait".
    failRpcResponse: { data: [{ status: "failed" }], error: null },
  });
  adminModule.__setFakeSupabase(supabase);

  const result = await workerModule.processNextReportJob({});

  assert.equal(result.status, "failed");
  const failCall = rpcCalls.find((call) => call.name === "fail_report_job");
  assert.ok(failCall);
});

test("A3 (silent no-op fix): markTerminalFailure's lease-conditioned write matching ZERO rows (a legitimately expired/reclaimed lease) forces an unconditional fallback write instead of silently reporting success with nothing recorded", async () => {
  const { workerModule, adminModule } = await importWorkerWithFakes({
    deadlineMs: 30,
    // A non-transient error routes straight to markTerminalFailure,
    // never fail_report_job.
    executePlanRequestSource: `export async function executePlanRequest() { throw new Error("Report failed Executive Report Quality Validator: not retryable"); }`,
  });
  const reportJobsTable = buildFakeReportJobsTable({
    updateResponses: [
      { data: [], error: null }, // primary lease-conditioned write matches zero rows
      { data: null, error: null }, // forced fallback write succeeds
    ],
  });
  const { supabase } = buildFakeSupabase({ jobRow: baseJobRow, reportJobsTable });
  adminModule.__setFakeSupabase(supabase);

  const result = await workerModule.processNextReportJob({});

  assert.equal(result.status, "failed");
  assert.equal(reportJobsTable.updateCalls.length, 2, "the fallback write must actually have been attempted, not skipped");
  assert.equal(reportJobsTable.updateCalls[0].fields.status, "failed");
  assert.equal(reportJobsTable.updateCalls[1].filters["status__neq"], "completed", "the fallback must never be allowed to clobber a legitimately completed report");
});

test("A4 (silent no-op fix): a transient failure whose own fail_report_job RPC call fails (e.g. the lease already expired) still reaches a real terminal write via the markTerminalFailure fallback, instead of vanishing with only a console.error", async () => {
  const { workerModule, adminModule } = await importWorkerWithFakes({
    deadlineMs: 30,
    executePlanRequestSource: hangingExecutePlanRequestSource,
  });
  const reportJobsTable = buildFakeReportJobsTable({
    updateResponses: [{ data: [], error: null }, { data: null, error: null }],
  });
  const { supabase, rpcCalls } = buildFakeSupabase({
    jobRow: baseJobRow,
    failRpcResponse: { data: null, error: { message: "job lease is missing, expired, or owned by another worker" } },
    reportJobsTable,
  });
  adminModule.__setFakeSupabase(supabase);

  const result = await workerModule.processNextReportJob({});

  assert.equal(result.status, "failed", "must fall back to a real terminal write, never an unrecorded failure");
  const failCall = rpcCalls.find((call) => call.name === "fail_report_job");
  assert.ok(failCall, "fail_report_job must still have been attempted first");
  assert.ok(reportJobsTable.updateCalls.length >= 1, "the markTerminalFailure fallback must have actually written something");
});

test("isTransientFailure classifies the watchdog's own deadline-exceeded message, and real provider/network failures, as transient -- but a genuine validation failure as non-transient", () => {
  assert.equal(
    isTransientFailure(new Error("Report job exceeded its internal processing deadline of 280 seconds (timed out).")),
    true
  );
  assert.equal(isTransientFailure(new Error("fetch failed")), true);
  assert.equal(isTransientFailure({ code: "ECONNRESET", message: "socket hang up" }), true);
  assert.equal(isTransientFailure({ status: 503, message: "Service Unavailable" }), true);
  assert.equal(isTransientFailure(new Error("Too many requests")), true);
  assert.equal(
    isTransientFailure(new Error("Report failed Executive Report Quality Validator: missing required field")),
    false
  );
});

// ===========================================================================
// B. Stale/expired-lease jobs are recovered on the very next poll, not the
//    once-daily cron (static pin -- the underlying claim RPC's own
//    correctness is already covered by tests/report-jobs-queue.test.mjs's
//    "worker restart can reclaim only an expired targeted lease" and
//    "concurrent report creation cannot substitute or duplicate another
//    job" tests against the real SQL migration)
// ===========================================================================

test("B1: the polling route's recovery trigger fires for every non-terminal status, and the route has the same maxDuration as its sibling long-running routes", () => {
  assert.match(statusRouteSource, /export const maxDuration = 300;/);
  assert.match(statusRouteSource, /const TERMINAL_JOB_STATUSES = \["completed", "failed", "cancelled"\] as const;/);
  assert.match(
    statusRouteSource,
    /if \(!TERMINAL_JOB_STATUSES\.includes\(job\.status as \(typeof TERMINAL_JOB_STATUSES\)\[number\]\)\) \{/
  );
  // The lease field is now selected so it's available for observability/
  // future staleness diagnostics even though the recovery decision itself
  // is delegated entirely to the already-atomic claim RPC.
  assert.match(statusRouteSource, /lease_expires_at/);
});

// ===========================================================================
// C. No duplicate expensive execution -- the research-cache race fix
//    (real behavioral test against the actual resolveCachedOrExecuteResearch)
// ===========================================================================

test("C1: two near-simultaneous calls for the same dedupeKey execute the expensive work exactly once, not twice (the exact race this production incident's client retries could trigger)", async () => {
  let executeCallCount = 0;
  let readCallCount = 0;
  const input = {
    dedupeKey: "same-report-identity",
    read: async () => {
      readCallCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return null; // cache miss both times
    },
    execute: async () => {
      executeCallCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { evidence: ["real research result"] };
    },
    write: async () => {},
  };

  const [first, second] = await Promise.all([
    resolveCachedOrExecuteResearch(input),
    resolveCachedOrExecuteResearch(input),
  ]);

  assert.equal(executeCallCount, 1, "the expensive execute() must run exactly once across both concurrent callers");
  assert.deepEqual(first.value, { evidence: ["real research result"] });
  assert.deepEqual(second.value, { evidence: ["real research result"] });
  const sources = [first.source, second.source].sort();
  assert.deepEqual(sources, ["generated", "in_flight"]);
  assert.ok(readCallCount >= 1);
});

test("C2: a genuine cache hit is still honored -- a later call for the same key after the first has written its result reads from cache, not a fresh execute()", async () => {
  let executeCallCount = 0;
  let cachedValue = null;
  const input = {
    dedupeKey: "cache-hit-key",
    read: async () => cachedValue,
    execute: async () => {
      executeCallCount += 1;
      return { evidence: ["fresh result"] };
    },
    write: async (value) => {
      cachedValue = value;
    },
  };

  const first = await resolveCachedOrExecuteResearch(input);
  assert.equal(first.source, "generated");
  assert.equal(executeCallCount, 1);

  const second = await resolveCachedOrExecuteResearch(input);
  assert.equal(second.source, "cache");
  assert.equal(executeCallCount, 1, "a genuine cache hit must never re-trigger execute()");
});

// ===========================================================================
// D. Rebalanced timeouts fit under the 300s ceiling; every external call
//    this incident touched has a bounded, deterministic timeout
// ===========================================================================

test("D1: the full-report synthesis timeout, the research phase's outer cap, and the optional entity-extraction step now sum to comfortably under 300s (previously ~312-327s, already exceeding it)", () => {
  const synthesisMatch = marketRouteSource.match(/const FULL_REPORT_OPENAI_TIMEOUT_MS = (\d+)_(\d+);/);
  const researchMatch = domainResearchSource.match(/const hardTimeoutMs = (\d+)_(\d+);/);
  const postProcessMatch = marketRouteSource.match(/const FULL_REPORT_POST_PROCESS_TIMEOUT_MS = (\d+)_(\d+);/);
  assert.ok(synthesisMatch, "FULL_REPORT_OPENAI_TIMEOUT_MS not found");
  assert.ok(researchMatch, "hardTimeoutMs not found");
  assert.ok(postProcessMatch, "FULL_REPORT_POST_PROCESS_TIMEOUT_MS not found");

  const synthesisMs = Number(`${synthesisMatch[1]}${synthesisMatch[2]}`);
  const researchMs = Number(`${researchMatch[1]}${researchMatch[2]}`);
  const postProcessMs = Number(`${postProcessMatch[1]}${postProcessMatch[2]}`);
  const optionalEntityExtractionMs = 15_000;

  const worstCaseTotalMs = synthesisMs + researchMs + postProcessMs + optionalEntityExtractionMs;
  const vercelMaxDurationMs = 300_000;
  const requiredMarginMs = 20_000;

  assert.ok(
    worstCaseTotalMs + requiredMarginMs <= vercelMaxDurationMs,
    `worst-case pipeline duration ${worstCaseTotalMs}ms leaves less than the required ${requiredMarginMs}ms margin under the ${vercelMaxDurationMs}ms Vercel maxDuration ceiling`
  );
});

test("D2: market-analysis/route.ts declares a defensive maxDuration matching its sibling long-running routes", () => {
  assert.match(marketRouteSource, /export const maxDuration = 300;/);
});

test("D3 (provider timeout / model timeout, every external call bounded): the single-field regeneration branch's OpenAI call -- previously bound only by the incoming request's own signal, with no independent deadline -- now uses a real, cleaned-up AbortController timeout", () => {
  assert.match(marketRouteSource, /const SINGLE_FIELD_OPENAI_TIMEOUT_MS = 60_000;/);
  assert.match(
    marketRouteSource,
    /const fieldAbort = createReportAbortSignal\(req\.signal, SINGLE_FIELD_OPENAI_TIMEOUT_MS\);/
  );
  assert.match(marketRouteSource, /\{ signal: fieldAbort\.signal \}\)/);
  assert.match(marketRouteSource, /fieldAbort\.cleanup\(\);/);
});

test("D4 (frontend/report polling termination, proven loading-state gap closed): the initial /api/plan enqueue fetch now has its own bounded timeout, in addition to the pre-existing overall polling-loop ceiling", () => {
  assert.match(plannerSource, /const PLAN_ENQUEUE_REQUEST_TIMEOUT_MS = 30_000;/);
  assert.match(plannerSource, /const planFetchAbortController = new AbortController\(\);/);
  assert.match(plannerSource, /signal: planFetchAbortController\.signal,/);
  assert.match(plannerSource, /clearTimeout\(planFetchTimeoutId\);/);
  // The pre-existing overall ceiling (added in an earlier session) must
  // still be present and untouched -- this fix is additive, not a
  // replacement.
  assert.match(plannerSource, /const maxReportPollWaitMs = 8 \* 60 \* 1000;/);
});
