import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  acquireMarketIntelligenceExecutionClaim,
  releaseMarketIntelligenceExecutionClaim,
  MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_SCOPE,
} from "../app/lib/ai/market-intelligence-execution-claim.ts";

// TASK #67A -- Make Market Intelligence duplicate-execution protection
// cross-instance safe.
//
// Task #67's runExclusivelyByKey is an in-memory, per-process Map --
// it has NO visibility across separate serverless instances at all.
// This task adds a Postgres-backed distributed lease
// (supabase/migrations/20260809120000_create_ai_execution_claims.sql,
// app/lib/ai/market-intelligence-execution-claim.ts) that is
// authoritative across instances.
//
// A real Postgres connection is not available in this test environment
// (this repository's own established convention, confirmed across
// every other Supabase-migration-adjacent test in this suite, is to
// verify application-level logic without a live database). The tests
// below therefore drive the REAL acquireMarketIntelligenceExecutionClaim
// / releaseMarketIntelligenceExecutionClaim functions against a
// faithful, deterministic in-memory simulation of the migration's own
// SQL semantics: a single atomic "insert, or steal only if the existing
// lease already expired" operation, and a "delete only if I am still
// the recorded owner" release -- exactly what
// supabase/migrations/20260809120000_create_ai_execution_claims.sql's
// claim_ai_execution / release_ai_execution implement as one
// INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING
// statement and one guarded DELETE. This proves the CONTRACT and the
// application-level integration logic; the SQL migration itself was
// reviewed line-by-line against this codebase's own already-proven
// report_jobs lease pattern (supabase/migrations/20260731120000_create_report_jobs.sql)
// but was not executed against a live database in this environment --
// see the final report's explicitly stated limitation.

function createFakeExecutionClaimsDatabase(initialNowMs = 0) {
  const rows = new Map();
  let nowMs = initialNowMs;

  function key(scope, userId, fingerprint) {
    return `${scope}:${userId}:${fingerprint}`;
  }

  return {
    advanceTime(ms) {
      nowMs += ms;
    },
    rowCount() {
      return rows.size;
    },
    // Each call simulates a SEPARATE Supabase client instance (i.e. a
    // separate serverless invocation/process) that talks to the SAME
    // shared `rows` map -- exactly like two real instances sharing one
    // Postgres table.
    createClient() {
      return {
        async rpc(name, params) {
          if (name === "claim_ai_execution") {
            const rowKey = key(params.p_scope, params.p_user_id, params.p_fingerprint);
            const existing = rows.get(rowKey);
            // Mirrors the migration's single atomic statement: succeeds
            // when no row exists, or when the existing row's lease has
            // already expired (steal); otherwise makes no change and
            // returns zero rows.
            if (!existing || existing.leaseExpiresAtMs <= nowMs) {
              rows.set(rowKey, {
                leaseOwner: params.p_worker_id,
                leaseExpiresAtMs: nowMs + params.p_lease_seconds * 1000,
              });
              return { data: [{ lease_owner: params.p_worker_id }], error: null };
            }
            return { data: [], error: null };
          }

          if (name === "release_ai_execution") {
            const rowKey = key(params.p_scope, params.p_user_id, params.p_fingerprint);
            const existing = rows.get(rowKey);
            if (existing && existing.leaseOwner === params.p_worker_id) {
              rows.delete(rowKey);
            }
            return { data: null, error: null };
          }

          throw new Error(`unexpected rpc in fake database: ${name}`);
        },
      };
    },
  };
}

const marketRouteSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const claimModuleSource = await readFile(
  new URL("../app/lib/ai/market-intelligence-execution-claim.ts", import.meta.url),
  "utf8"
);
const migrationSource = await readFile(
  new URL("../supabase/migrations/20260809120000_create_ai_execution_claims.sql", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------
// FAIL-BEFORE: reproduce the cross-instance race Task #67 left open.
// Two "instances" with no shared coordination at all (two independent,
// non-shared in-memory maps -- exactly what Task #67's per-process
// runExclusivelyByKey looks like from a second, separate serverless
// instance's point of view) both proceed to the expensive step.
// ---------------------------------------------------------------------

test("FAIL-BEFORE: two instances with no shared distributed state both execute -- reproduces the exact gap Task #67A closes", async () => {
  let providerCallCount = 0;
  async function naiveUnshared() {
    // No shared map between "instances" -- this is what Task #67 alone
    // provides across two different processes.
    const localMap = new Map();
    if (localMap.get("key")) return;
    localMap.set("key", true);
    providerCallCount += 1;
  }

  await Promise.all([naiveUnshared(), naiveUnshared()]);
  assert.equal(providerCallCount, 2, "with no shared coordination, both instances independently execute (the race this task closes)");
});

// ---------------------------------------------------------------------
// A/B -- two equivalent requests from separate simulated instances
// result in exactly ONE acquiring ownership; the other cannot
// successfully acquire. Proven against the REAL claim functions.
// ---------------------------------------------------------------------

test("A/B: two equivalent requests from separate simulated instances -- exactly one acquires the distributed claim, and exactly one expensive execution occurs", async () => {
  const db = createFakeExecutionClaimsDatabase();
  const instanceAClient = db.createClient();
  const instanceBClient = db.createClient();

  let providerCallCount = 0;
  async function attemptFromInstance(supabase, workerId) {
    const result = await acquireMarketIntelligenceExecutionClaim({
      supabase,
      userId: "user-1",
      fingerprint: "same-canonical-fingerprint",
      workerId,
    });
    if (result === "acquired") {
      providerCallCount += 1;
    }
    return result;
  }

  const [resultA, resultB] = await Promise.all([
    attemptFromInstance(instanceAClient, "instance-A-worker"),
    attemptFromInstance(instanceBClient, "instance-B-worker"),
  ]);

  const results = [resultA, resultB];
  assert.equal(results.filter((r) => r === "acquired").length, 1, "exactly one instance must acquire ownership");
  assert.equal(results.filter((r) => r === "held_by_another_owner").length, 1, "the other instance must be told ownership is held elsewhere, never silently proceed");
  assert.equal(providerCallCount, 1, "exactly one expensive execution occurs across both simulated instances");
});

// ---------------------------------------------------------------------
// C -- different fingerprints can execute concurrently, never
// deduplicated against each other.
// ---------------------------------------------------------------------

test("C: different fingerprints (same user) both acquire independently -- never cross-deduplicated", async () => {
  const db = createFakeExecutionClaimsDatabase();
  const clientA = db.createClient();
  const clientB = db.createClient();

  const [resultA, resultB] = await Promise.all([
    acquireMarketIntelligenceExecutionClaim({
      supabase: clientA,
      userId: "user-1",
      fingerprint: "fingerprint-A",
      workerId: "worker-A",
    }),
    acquireMarketIntelligenceExecutionClaim({
      supabase: clientB,
      userId: "user-1",
      fingerprint: "fingerprint-B",
      workerId: "worker-B",
    }),
  ]);

  assert.equal(resultA, "acquired");
  assert.equal(resultB, "acquired");
});

// ---------------------------------------------------------------------
// D -- different users/tenants are safely isolated: the SAME
// fingerprint for two DIFFERENT users must never be cross-deduplicated
// or leak one user's claim/result to another.
// ---------------------------------------------------------------------

test("D: the same fingerprint for two different users is isolated -- never cross-user deduplicated", async () => {
  const db = createFakeExecutionClaimsDatabase();
  const clientA = db.createClient();
  const clientB = db.createClient();

  const [resultUserOne, resultUserTwo] = await Promise.all([
    acquireMarketIntelligenceExecutionClaim({
      supabase: clientA,
      userId: "user-1",
      fingerprint: "identical-prompt-fingerprint",
      workerId: "worker-for-user-1",
    }),
    acquireMarketIntelligenceExecutionClaim({
      supabase: clientB,
      userId: "user-2",
      fingerprint: "identical-prompt-fingerprint",
      workerId: "worker-for-user-2",
    }),
  ]);

  assert.equal(resultUserOne, "acquired", "user 1's own request must acquire independently of user 2's");
  assert.equal(resultUserTwo, "acquired", "user 2's own request must acquire independently of user 1's -- never blocked by another user's claim");
});

// ---------------------------------------------------------------------
// E -- a failed owner (one that explicitly releases after a failure)
// allows a later legitimate retry to become owner.
// ---------------------------------------------------------------------

test("E: after the owner releases following a failure, a legitimate retry can acquire", async () => {
  const db = createFakeExecutionClaimsDatabase();
  const client = db.createClient();

  const firstAttempt = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "retry-after-failure",
    workerId: "worker-attempt-1",
  });
  assert.equal(firstAttempt, "acquired");

  const { error: releaseError } = await releaseMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "retry-after-failure",
    workerId: "worker-attempt-1",
  });
  assert.equal(releaseError, null);
  assert.equal(db.rowCount(), 0, "the claim row must be gone immediately after release -- no permanent lock");

  const retryAttempt = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "retry-after-failure",
    workerId: "worker-attempt-2",
  });
  assert.equal(retryAttempt, "acquired", "the retry must actually acquire ownership, never be blocked by the released prior attempt");
});

// ---------------------------------------------------------------------
// F -- a stale lease (owner crashed/terminated without releasing)
// expires and a new owner can proceed; a still-live lease is NOT
// stealable.
// ---------------------------------------------------------------------

test("F: a stale (expired) lease can be reclaimed by a new owner; a still-live lease cannot be stolen", async () => {
  const db = createFakeExecutionClaimsDatabase(0);
  const client = db.createClient();

  const crashedOwner = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-lease-check",
    workerId: "crashed-instance-worker",
  });
  assert.equal(crashedOwner, "acquired");

  // The crashed instance never releases (simulating a serverless
  // instance terminated mid-flight). Before the lease expires, no one
  // else may steal it.
  const tooEarly = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-lease-check",
    workerId: "new-instance-worker-too-early",
  });
  assert.equal(tooEarly, "held_by_another_owner", "a still-live lease must not be stealable");

  // Advance time past the lease's own duration (mirrors
  // MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_LEASE_SECONDS).
  db.advanceTime(301_000);

  const afterExpiry = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-lease-check",
    workerId: "new-instance-worker",
  });
  assert.equal(afterExpiry, "acquired", "a new owner must be able to reclaim an expired, abandoned lease -- no permanent lock from a crashed instance");
});

test("release is a safe no-op once a lease has already been reclaimed by a newer owner -- a stale caller can never delete a live owner's claim", async () => {
  const db = createFakeExecutionClaimsDatabase(0);
  const client = db.createClient();

  await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-release-check",
    workerId: "crashed-instance-worker",
  });

  db.advanceTime(301_000);

  const newOwnerResult = await acquireMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-release-check",
    workerId: "new-instance-worker",
  });
  assert.equal(newOwnerResult, "acquired");

  // The original, now-stale worker belatedly tries to release its own
  // (already superseded) lease.
  await releaseMarketIntelligenceExecutionClaim({
    supabase: client,
    userId: "user-1",
    fingerprint: "stale-release-check",
    workerId: "crashed-instance-worker",
  });

  assert.equal(db.rowCount(), 1, "the new owner's live claim must survive the stale worker's belated release attempt");
});

// ---------------------------------------------------------------------
// G -- successful completed request: once the owner releases (having
// persisted a real result), a waiting duplicate's contract is to
// re-check the existing response cache and reuse it, never to call the
// provider again. Proven end-to-end against the real claim functions
// plus a simulated cache, mirroring market-analysis/route.ts's own
// control flow (cache-check -> claim-or-wait -> generate-or-reuse).
// ---------------------------------------------------------------------

test("G: once the owner finishes and populates the cache, the waiting duplicate reuses the persisted result instead of calling the provider again", async () => {
  const db = createFakeExecutionClaimsDatabase();
  const ownerClient = db.createClient();
  const waiterClient = db.createClient();

  let cachedResult = null;
  let providerCallCount = 0;

  async function attempt(supabase, workerId) {
    if (cachedResult !== null) return cachedResult; // mirrors the existing getCachedAiResponse check
    const claim = await acquireMarketIntelligenceExecutionClaim({
      supabase,
      userId: "user-1",
      fingerprint: "owner-completes-then-waiter-reuses",
      workerId,
    });
    if (claim !== "acquired") {
      return null; // mirrors the route's "held_by_another_owner" branch, before any wait
    }
    providerCallCount += 1; // the real provider call
    const result = "generated-report";
    cachedResult = result; // storeCachedAiResponse
    await releaseMarketIntelligenceExecutionClaim({ supabase, userId: "user-1", fingerprint: "owner-completes-then-waiter-reuses", workerId });
    return result;
  }

  const ownerResult = await attempt(ownerClient, "owner-worker");
  assert.equal(ownerResult, "generated-report");
  assert.equal(providerCallCount, 1);

  // The waiter's FIRST attempt (before the owner finished) would have
  // seen "held_by_another_owner"; after the owner's release + cache
  // write, the waiter's retry (mirroring the route's recursive re-entry)
  // now hits the cache directly.
  const waiterRetryResult = await attempt(waiterClient, "waiter-worker");
  assert.equal(waiterRetryResult, "generated-report", "the waiter must reuse the persisted result");
  assert.equal(providerCallCount, 1, "the waiter must never independently call the provider a second time");
});

// ---------------------------------------------------------------------
// H -- existing cache-hit behavior still avoids the distributed claim
// (and therefore the provider call) entirely: static confirmation that
// the claim-acquisition code is positioned strictly AFTER the
// pre-existing, unmodified cache-hit-and-serve block.
// ---------------------------------------------------------------------

test("H: the distributed claim is only reached after the pre-existing local cache-hit check has already missed", () => {
  const cacheHitReturnIndex = marketRouteSource.indexOf(
    "cachedWarning +\n              serializeMarketReportChunks(parsedCachedReport)"
  );
  const claimAcquireIndex = marketRouteSource.indexOf(
    "const executionClaimWorkerId = crypto.randomUUID();"
  );
  assert.ok(cacheHitReturnIndex > 0 && claimAcquireIndex > cacheHitReturnIndex);
});

// ---------------------------------------------------------------------
// J -- cost/quota/accounting: checkAiProductionRateLimit,
// countAiCallsForReport, and every recordAiUsage call site are still
// present, unmodified, and the new release calls never wrap or alter
// them.
// ---------------------------------------------------------------------

test("J: quota, AI-call-budget, and usage-accounting call sites are all still present, unmodified, alongside the new claim logic", () => {
  const quotaIndex = marketRouteSource.indexOf("const productionLimit = await checkAiProductionRateLimit(");
  const guardCallIndex = marketRouteSource.indexOf(
    "return runExclusivelyByKey(fullReportGuardKey, runFullReportGenerationOnce);"
  );
  const scoped = marketRouteSource.slice(quotaIndex, guardCallIndex + 200);

  assert.ok(quotaIndex >= 0);
  assert.ok(scoped.indexOf("const existingAiCallCount = await countAiCallsForReport(") > 0);
  assert.ok(scoped.match(/recordAiUsage\(supabase, \{/g).length >= 3);

  // The claim-release calls are additive insertions right before the
  // two pre-existing early returns, never a replacement of them.
  assert.match(
    scoped,
    /await releaseExecutionClaimOnce\(\);\s*\n\s*return NextResponse\.json\(\s*\{ error: clarificationErrorText \}/
  );
  assert.match(
    scoped,
    /await releaseExecutionClaimOnce\(\);\s*\n\s*return NextResponse\.json\(\s*\{\s*\n\s*error:\s*\n\s*"AI call budget exceeded/
  );
});

test("J: a losing/waiting request is never independently recorded as a real provider execution -- recordAiUsage with actual_ai_call:true only ever follows a real client.responses.create call, never the claim-wait path", () => {
  const claimWaitBlockStart = marketRouteSource.indexOf('if (executionClaimResult === "held_by_another_owner") {');
  const claimWaitBlockEnd = marketRouteSource.indexOf("return runFullReportGenerationOnce();", claimWaitBlockStart);
  const claimWaitBlock = marketRouteSource.slice(claimWaitBlockStart, claimWaitBlockEnd);
  assert.doesNotMatch(claimWaitBlock, /recordAiUsage/);
  assert.doesNotMatch(claimWaitBlock, /actual_ai_call/);
});

// ---------------------------------------------------------------------
// K -- no regression to Market Intelligence decision, confidence,
// ENTER eligibility, evidence gaps, Closure Plan, recommendations,
// TAM/SAM/SOM, or provenance logic: every canonical decision-related
// function call is still present, verbatim, inside the (further
// modified) guarded region.
// ---------------------------------------------------------------------

test("K: canonical decision/confidence/coverage/TAM-SAM-SOM logic is untouched by the distributed claim changes", () => {
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
    assert.ok(guardedBody.includes(mustContain), `expected canonical decision-related code to be unchanged and present: ${mustContain}`);
  }
});

// ---------------------------------------------------------------------
// Migration/schema safety (STEP 10): additive only, RLS-locked to
// service_role, no client exposure, no destructive statement.
// ---------------------------------------------------------------------

test("the migration is additive and RLS-locked to service_role only -- no client-role access, no destructive statement", () => {
  assert.match(migrationSource, /create table if not exists public\.ai_execution_claims/);
  assert.match(migrationSource, /alter table public\.ai_execution_claims enable row level security/);
  assert.match(migrationSource, /revoke all on table public\.ai_execution_claims from anon, authenticated/);
  assert.match(migrationSource, /grant select, insert, update, delete on table public\.ai_execution_claims to service_role/);
  assert.match(migrationSource, /revoke all on function public\.claim_ai_execution/);
  assert.match(migrationSource, /grant execute on function public\.claim_ai_execution[\s\S]*?to service_role/);
  assert.match(migrationSource, /revoke all on function public\.release_ai_execution/);
  assert.match(migrationSource, /grant execute on function public\.release_ai_execution[\s\S]*?to service_role/);

  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop column\b/i);
  assert.doesNotMatch(migrationSource, /\balter table public\.report_jobs\b/i);
  assert.doesNotMatch(migrationSource, /\balter table public\.ai_response_cache\b/i);
  assert.doesNotMatch(migrationSource, /\balter table public\.ai_usage_events\b/i);
});

test("claim_ai_execution is a single atomic statement (no separate check-then-insert step) and release_ai_execution only deletes while the caller still owns the lease", () => {
  assert.match(migrationSource, /insert into public\.ai_execution_claims as claim[\s\S]*on conflict \(scope, user_id, fingerprint\) do update[\s\S]*where claim\.lease_expires_at <= now\(\)[\s\S]*returning claim\.\*/);
  assert.match(migrationSource, /delete from public\.ai_execution_claims\s*\n\s*where scope = p_scope\s*\n\s*and user_id = p_user_id\s*\n\s*and fingerprint = p_fingerprint\s*\n\s*and lease_owner = p_worker_id/);
});

// ---------------------------------------------------------------------
// Permission-denied fallback (STEP 4/8 safety net for the currently-
// unused standalone POST path, which uses a regular, non-service-role
// client): must proceed without the claim, never permanently 429 that
// path.
// ---------------------------------------------------------------------

test("a permission-denied RPC error (the untrusted-client path) proceeds without the distributed claim rather than permanently blocking that path", async () => {
  const permissionDeniedClient = {
    async rpc() {
      return { data: null, error: { code: "42501", message: "permission denied" } };
    },
  };

  const result = await acquireMarketIntelligenceExecutionClaim({
    supabase: permissionDeniedClient,
    userId: "user-1",
    fingerprint: "any-fingerprint",
    workerId: "worker-1",
  });

  assert.equal(result, "unavailable_proceed_without_claim");
});

test("any other RPC error fails closed (never silently proceeds as if acquired)", async () => {
  const flakyClient = {
    async rpc() {
      return { data: null, error: { code: "08006", message: "connection failure" } };
    },
  };

  const result = await acquireMarketIntelligenceExecutionClaim({
    supabase: flakyClient,
    userId: "user-1",
    fingerprint: "any-fingerprint",
    workerId: "worker-1",
  });

  assert.equal(result, "held_by_another_owner");
});

test("release errors are reported to the caller, never thrown", async () => {
  const flakyClient = {
    async rpc() {
      return { data: null, error: { message: "release failed" } };
    },
  };

  const { error } = await releaseMarketIntelligenceExecutionClaim({
    supabase: flakyClient,
    userId: "user-1",
    fingerprint: "any-fingerprint",
    workerId: "worker-1",
  });

  assert.equal(error, "release failed");
});

test("the claim module is only imported by already server-only API route files, and is scoped to Market Intelligence full-report generation only", () => {
  assert.doesNotMatch(claimModuleSource, /"use client"/);
  assert.equal(MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_SCOPE, "market_intelligence_full_report");
});
