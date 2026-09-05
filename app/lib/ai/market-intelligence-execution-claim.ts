import type { SupabaseClient } from "@supabase/supabase-js";

// No "server-only" import on purpose, matching this codebase's own
// established convention (see research-cache-core.ts's identical
// rationale): every function here takes its SupabaseClient as an
// explicit parameter rather than constructing one itself, holds no
// secret/server-only global, and this module is only ever imported by
// already server-only API route files -- keeping it import-clean lets
// it be exercised directly by `node --test` without a Next.js build.
//
// TASK #67A -- distributed, cross-instance-safe execution-ownership
// primitive for expensive AI/provider work. Complements (does not
// replace) Task #67's same-process runExclusivelyByKey guard: that
// in-memory guard is a cheap, fast first layer for the common case of
// two requests landing in the SAME warm serverless instance within
// microseconds of each other, but it releases as soon as the guarded
// function RETURNS (which, for a streamed report, happens before the
// underlying generation actually finishes in the background) -- it is
// not, by itself, authoritative for the full duration of the real work,
// and it has no visibility across separate instances at all. This
// module is the AUTHORITATIVE layer: a Postgres-backed lease
// (see supabase/migrations/20260809120000_create_ai_execution_claims.sql)
// that is acquired before starting the expensive work and released only
// once that work genuinely finishes, success or failure -- visible and
// race-free across every serverless instance, not just the current
// process.
//
// Scope is deliberately narrow: this file only defines the generic
// acquire/release primitives (scope, user, fingerprint, worker id, lease
// duration) and the Market Intelligence full-report constants that use
// them today. It does not implement polling/retry orchestration --
// callers own that, since the right retry shape (e.g. also re-checking
// an existing response cache) is caller-specific.

export const MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_SCOPE =
  "market_intelligence_full_report";

// Comfortably above worker.ts's own JOB_PROCESSING_DEADLINE_MS (280s,
// the hard ceiling for one full report-generation attempt, research
// included) so a genuinely still-working owner's lease never expires
// out from under it mid-generation, while still being bounded (never
// permanent) so a crashed/orphaned owner's claim is reclaimable shortly
// after its worst-case runtime, not indefinitely.
export const MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_LEASE_SECONDS = 300;

// Bounded wait budget for a request that lost the claim race: total
// ~24s (8 x 3s) of polling before giving up and returning a
// deterministic "try again" response, letting report_jobs' own
// existing exponential-backoff retry mechanism handle any longer tail
// -- never an unbounded/indefinite wait inside one request.
export const MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_POLL_ATTEMPTS = 8;
export const MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_POLL_DELAY_MS = 3_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Postgres error code for insufficient_privilege. The two RPCs below are
// granted only to the elevated database role the report-job worker
// authenticates as (see the migration) -- the real production path
// always reaches this module through that trusted, worker-owned
// connection (threaded through plan-executor.ts into
// executeMarketAnalysisRequest), but market-analysis/route.ts's own
// standalone POST handler falls back to the regular per-user client
// when invoked directly (documented elsewhere as a defensive backstop,
// not reachable by any current production UI). That regular client
// structurally cannot call these RPCs at all -- a permission error
// there does NOT mean "another instance owns this fingerprint", and
// treating it as such would make that backstop path permanently return
// "already in progress" for every request. Only THIS specific error is
// treated as "proceed without the distributed claim for this attempt"
// (falling back to Task #67's same-process guard alone, i.e. exactly
// the protection level that existed before this task); every other RPC
// error still fails closed.
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";

export type MarketIntelligenceExecutionClaimResult =
  | "acquired"
  | "held_by_another_owner"
  | "unavailable_proceed_without_claim";

async function callClaimRpc(
  supabase: SupabaseClient,
  scope: string,
  userId: string,
  fingerprint: string,
  workerId: string,
  leaseSeconds: number
): Promise<MarketIntelligenceExecutionClaimResult> {
  const { data, error } = await supabase.rpc("claim_ai_execution", {
    p_scope: scope,
    p_user_id: userId,
    p_fingerprint: fingerprint,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    if (error.code === POSTGRES_INSUFFICIENT_PRIVILEGE) {
      return "unavailable_proceed_without_claim";
    }
    // Fail closed on any other error (network blip, unexpected
    // exception, RPC genuinely missing, etc.): never silently let two
    // instances both believe they own execution just because the
    // coordination check itself failed.
    return "held_by_another_owner";
  }

  const claimed = Array.isArray(data) ? data.length > 0 : Boolean(data);
  return claimed ? "acquired" : "held_by_another_owner";
}

export async function acquireMarketIntelligenceExecutionClaim(input: {
  supabase: SupabaseClient;
  userId: string;
  fingerprint: string;
  workerId: string;
}): Promise<MarketIntelligenceExecutionClaimResult> {
  return callClaimRpc(
    input.supabase,
    MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_SCOPE,
    input.userId,
    input.fingerprint,
    input.workerId,
    MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_LEASE_SECONDS
  );
}

// Releasing must never throw and must never block the response that
// already has a real result (success or a legitimately handled
// failure) -- any release error is logged by the caller, not raised.
export async function releaseMarketIntelligenceExecutionClaim(input: {
  supabase: SupabaseClient;
  userId: string;
  fingerprint: string;
  workerId: string;
}): Promise<{ error: string | null }> {
  const { error } = await input.supabase.rpc("release_ai_execution", {
    p_scope: MARKET_INTELLIGENCE_FULL_REPORT_CLAIM_SCOPE,
    p_user_id: input.userId,
    p_fingerprint: input.fingerprint,
    p_worker_id: input.workerId,
  });

  return { error: error ? error.message : null };
}
