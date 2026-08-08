import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

// Production-readiness audit finding (CRITICAL, fixed this pass):
// ReportManager.tsx read localStorage synchronously inside a useState
// lazy initializer. On the server that branch always returns an empty
// set (typeof window === "undefined"); on the client it returns the
// real pinned/favorited/archived ids. Any returning user with at least
// one such id saw the report list render unfiltered/unsorted, then
// visibly reorder/filter immediately after hydration, on every page
// load. Fixed by starting from an empty set (matching the server) and
// populating real values in a useEffect after mount.
test("ReportManager's localStorage-derived state starts empty (matching SSR) and is populated post-mount, not during the render pass", () => {
  const source = read("app/dashboard/ReportManager.tsx");

  for (const stateVar of ["pinnedReportIds", "favoriteReportIds", "archivedReportIds"]) {
    assert.match(
      source,
      new RegExp(`const \\[${stateVar}, set\\w+\\] = useState<Set<string>>\\(\\(\\) => new Set\\(\\)\\)`),
      `${stateVar} must start as an empty set, matching what the server renders`
    );
  }

  const archivedCallIndex = source.indexOf("readStoredIds(ARCHIVED_REPORTS_KEY)");
  const effectBody = source.slice(
    source.lastIndexOf("useEffect(() => {", archivedCallIndex),
    source.indexOf("}, []);", archivedCallIndex) + "}, []);".length
  );
  for (const [setter, key] of [
    ["setPinnedReportIds", "PINNED_REPORTS_KEY"],
    ["setFavoriteReportIds", "FAVORITE_REPORTS_KEY"],
    ["setArchivedReportIds", "ARCHIVED_REPORTS_KEY"],
  ]) {
    assert.match(
      effectBody,
      new RegExp(`${setter}\\(readStoredIds\\(${key}\\)\\)`),
      `the useEffect must call ${setter}(readStoredIds(${key})) once, after mount`
    );
  }
  assert.match(effectBody, /\}, \[\]\);$/, "the effect must run once on mount (empty dependency array)");

  // readStoredIds itself is unchanged (still safe to call server-side,
  // just no longer called from a render-path initializer) -- confirm
  // its window-guard is still intact as defense in depth.
  assert.match(source, /function readStoredIds\(key: string\) \{\s*\n\s*if \(typeof window === "undefined"\) \{/);
});

// Production-readiness audit finding (documentation gap, fixed this
// pass): CRON_SECRET / REPORT_JOB_WORKER_SECRET gate the only auth path
// for the nightly stuck-job-recovery cron (vercel.json -> POST
// /api/report-jobs/worker), but neither was documented in .env.example.
// A production deploy that didn't know to set one would have every
// cron invocation silently rejected with no automatic recovery path for
// jobs stuck outside of a client actively polling them.
test(".env.example documents every env var that gates the report-job worker cron's authorization", () => {
  const envExample = read(".env.example");
  assert.match(envExample, /^CRON_SECRET=/m);
  assert.match(envExample, /^REPORT_JOB_WORKER_SECRET=/m);

  const workerSource = read("app/api/report-jobs/worker/route.ts");
  assert.match(workerSource, /process\.env\.REPORT_JOB_WORKER_SECRET/);
  assert.match(workerSource, /process\.env\.CRON_SECRET/);
});

test("error.log (a tracked dev-session artifact, not a secret) is excluded from future commits", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /^error\.log$/m);
});

// Production-readiness audit finding (CRITICAL, fixed this pass): both
// ai_usage_events and ai_response_cache have a client-writable insert
// policy (auth.uid() = user_id) but no non-negativity constraint on
// their token/cost columns. app/lib/ai/governance.ts's monthly quota
// check sums ai_usage_events.total_tokens per user -- a single row
// inserted directly via the Supabase client with a large negative
// total_tokens drives that sum negative, making the computed remaining
// usage unbounded and bypassing the paid-tier AI cost quota for the
// rest of the billing month. Token/cost values can never legitimately
// be negative, so this constraint has zero effect on any real write.
test("ai_usage_events and ai_response_cache reject negative token/cost values at the database level", () => {
  const migration = read("supabase/migrations/20260808150000_add_ai_usage_nonnegative_constraints.sql");

  for (const table of ["ai_usage_events", "ai_response_cache"]) {
    for (const column of ["prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd"]) {
      assert.match(
        migration,
        new RegExp(`add constraint ${table}_${column}_nonnegative\\s*\\n\\s*check \\(${column} >= 0\\);`),
        `${table}.${column} must have a >= 0 check constraint`
      );
    }
  }

  // Guarded (idempotent, safe to re-run) like every other defensive
  // constraint addition in this migration history.
  assert.match(migration, /if not exists \(\s*\n\s*select 1 from pg_constraint/);
});
