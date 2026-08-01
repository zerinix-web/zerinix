import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planRoute = readFileSync("app/api/plan/route.ts", "utf8");
const planExecutor = readFileSync(
  "app/lib/report-jobs/plan-executor.ts",
  "utf8"
);
const worker = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const statusRoute = readFileSync(
  "app/api/report-jobs/[jobId]/route.ts",
  "utf8"
);
const workerRoute = readFileSync(
  "app/api/report-jobs/worker/route.ts",
  "utf8"
);
const planner = readFileSync("components/Planner.tsx", "utf8");
const targetedClaimMigration = readFileSync(
  "supabase/migrations/20260731170000_add_targeted_report_job_claim.sql",
  "utf8"
);

test("POST /api/plan enqueues idempotently without executing the AI pipeline", () => {
  assert.match(planRoute, /\.from\("report_jobs"\)/);
  assert.match(planRoute, /request_payload: requestPayload/);
  assert.match(planRoute, /idempotency_key: idempotencyKey/);
  assert.match(planRoute, /jobId: job\.id/);
  assert.match(planRoute, /status: job\.status/);
  assert.match(planRoute, /createError\?\.code === "23505"/);
  assert.doesNotMatch(planRoute, /executePlanRequest\(/);
  assert.doesNotMatch(planRoute, /runDomainAwareResearch\(/);
});

test("enqueue starts the worker before registering deferred completion", () => {
  assert.match(
    planRoute,
    /const workerPromise = processReportJobQueue\([\s\S]*?after\(async \(\) => \{[\s\S]*?await workerPromise\.catch/
  );
  assert.match(
    worker,
    /await updateProgress\(supabase, job\.id, workerId, "extracting", 5, "asset_extraction"\)/
  );
});

test("the worker leases jobs and reuses the unchanged plan executor", () => {
  assert.match(worker, /rpc\("claim_report_job"/);
  assert.match(worker, /rpc\("claim_report_job_by_id"/);
  assert.match(worker, /rpc\("renew_report_job_lease"/);
  assert.match(worker, /executePlanRequest\(executorRequest/);
  assert.match(worker, /rpc\("update_report_job_progress"/);
  assert.match(worker, /rpc\("complete_report_job"/);
  assert.match(worker, /rpc\("fail_report_job"/);
  assert.match(worker, /isTransientFailure/);
  assert.match(planExecutor, /generateRealEstateInvestmentReport/);
  assert.match(planExecutor, /runDomainAwareResearch/);
});

test("job status is owner-scoped and the worker endpoint requires a server secret", () => {
  assert.match(statusRoute, /\.eq\("user_id", user\.id\)/);
  assert.match(statusRoute, /progressStage: job\.progress_stage/);
  assert.match(statusRoute, /reportId: job\.report_id/);
  assert.match(statusRoute, /error: job\.error_message \|\| null/);
  assert.match(workerRoute, /REPORT_JOB_WORKER_SECRET/);
  assert.match(workerRoute, /CRON_SECRET/);
  assert.match(workerRoute, /processReportJobQueue/);
});

test("polling recovers an orphaned queued job using its exact id", () => {
  assert.match(statusRoute, /job\.status === "queued" \|\| job\.status === "retry_wait"/);
  assert.match(statusRoute, /processReportJobQueue\(\{\n\s+jobId,/);
  assert.match(statusRoute, /after\(async \(\) => \{/);
});

test("two consecutive report requests bind workers to their own created job ids", () => {
  assert.match(planRoute, /startReportWorker\(existingJob\.id\)/);
  assert.match(planRoute, /startReportWorker\(createdJob\.id\)/);
  assert.match(worker, /job_id: jobId/);
  assert.match(worker, /options\.jobId\n\s+\)/);
  assert.match(targetedClaimMigration, /where job\.id = job_id/);
});

test("multiple queued jobs are drained after the request-bound job completes", () => {
  assert.match(worker, /export async function processReportJobQueue/);
  assert.match(worker, /while \(true\)/);
  assert.match(worker, /requestedJobId = undefined/);
  assert.match(worker, /if \(!result\.processed\) \{\n\s+break;/);
});

test("worker restart can reclaim only an expired targeted lease", () => {
  assert.match(targetedClaimMigration, /job\.lease_expires_at <= now\(\)/);
  assert.match(targetedClaimMigration, /job\.attempt_count < job\.max_attempts/);
  assert.match(targetedClaimMigration, /started_at = coalesce\(job\.started_at, now\(\)\)/);
});

test("concurrent report creation cannot substitute or duplicate another job", () => {
  assert.match(targetedClaimMigration, /where job\.id = job_id/);
  assert.match(targetedClaimMigration, /for update skip locked/);
  assert.doesNotMatch(
    targetedClaimMigration,
    /order by coalesce\(job\.next_attempt_at, job\.created_at\)/
  );
});

test("a missing deployed targeted-claim RPC falls back to an exact-id atomic update", () => {
  assert.match(worker, /result\.error\.code !== "PGRST202"/);
  assert.match(worker, /claimReportJobByIdWithoutRpc/);
  assert.match(worker, /\.eq\("id", job\.id\)/);
  assert.match(worker, /\.eq\("status", job\.status\)/);
  assert.match(worker, /\.eq\("attempt_count", job\.attempt_count\)/);
  assert.match(worker, /lease_owner: workerId/);
});

test("Planner polls immediately, tolerates transient status failures, and consumes the completed report inline", () => {
  assert.match(planner, /enqueuePayload\.jobId/);
  assert.match(planner, /let pollDelayMs = 0/);
  assert.match(planner, /consecutivePollFailures > 5/);
  assert.match(planner, /statusResponse\.status === 429 \|\| statusResponse\.status >= 500/);
  assert.match(planner, /`\/api\/report-jobs\/\$\{encodeURIComponent\(jobId\)\}`/);
  assert.match(planner, /jobStatus\.status === "completed"/);
  assert.match(planner, /jobStatus\.status === "failed" \|\| jobStatus\.status === "cancelled"/);
  assert.match(planner, /completedReportPayload = jobStatus\.report \|\| null/);
  assert.match(planner, /\.from\("reports"\)/);
  assert.match(planner, /\.eq\("id", completedReportId\)/);
});

test("non-critical progress and conversation persistence never delay job completion", () => {
  assert.match(worker, /void updateProgress\(/);
  assert.match(worker, /non-blocking progress update failed/);
  assert.match(worker, /rpc\("complete_report_job"/);
  assert.match(worker, /options\.defer\(deferredAssistantPersistence\)/);
  assert.match(statusRoute, /report,\n\s+updatedAt: job\.updated_at,\n\s+error: job\.error_message \|\| null/);
  assert.match(planner, /void attributeReportUsage\(savedReportId, reportRequestId\)/);
});
