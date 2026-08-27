import { after, NextResponse } from "next/server";
import { createAuthenticatedReportJobClient } from "@/app/lib/report-jobs/request-auth";
import { processReportJobQueue } from "@/app/lib/report-jobs/worker";

export const dynamic = "force-dynamic";
// P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
// timeout incident): this route's own after()-deferred recovery-trigger
// call below needs the same generous budget as its sibling long-running
// routes (app/api/plan/route.ts, app/api/report-jobs/worker/route.ts,
// both maxDuration=300) -- without an explicit override here it fell
// back to a much shorter platform default, making a hard-kill of the
// recovery attempt itself more likely than a genuine job execution.
export const maxDuration = 300;

type ReportJobRouteContext = {
  params: Promise<{ jobId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;

export async function GET(request: Request, context: ReportJobRouteContext) {
  const requestStartedAt = Date.now();
  const { jobId } = await context.params;
  const { supabase, user } = await createAuthenticatedReportJobClient(request);

  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!UUID_PATTERN.test(jobId)) {
    return NextResponse.json(
      { error: "Invalid report job id." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { data: job, error } = await supabase
    .from("report_jobs")
    .select(
      "id,status,progress,progress_stage,report_id,error_code,error_message,updated_at,lease_expires_at"
    )
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[report-jobs] status lookup failed", error);
    return NextResponse.json(
      { error: "Report status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!job) {
    return NextResponse.json(
      { error: "Report job not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
  // timeout incident): a job that dies mid-flight (Vercel hard-kills the
  // serverless function once it hits maxDuration, which is NOT a
  // catchable JS exception) is left parked at whatever ACTIVE status
  // (e.g. "researching"/"generating") its last progress write recorded,
  // with a lease that will simply expire -- this route previously only
  // re-triggered recovery for "queued"/"retry_wait", so a job stuck in
  // any active status was echoed back with this same stale status,
  // HTTP 200, forever. The only thing that could ever reclaim it was the
  // once-daily 3am cron (vercel.json), i.e. up to ~24 hours "stuck".
  //
  // The fix is NOT a new staleness heuristic here -- claim_report_job_by_id
  // (supabase/migrations/20260731170000_add_targeted_report_job_claim.sql)
  // already atomically reclaims a job in ANY active status once its
  // lease_expires_at has passed (and marks attempts-exhausted jobs
  // definitively "failed" right in that same statement), exactly like
  // the daily cron's untargeted claim_report_job already does. It was
  // simply never being called for anything but queued/retry_wait. Since
  // that RPC is a safe no-op whenever the job's lease has NOT actually
  // expired (a live worker is still genuinely processing it), it is safe
  // to attempt this recovery call on every poll regardless of status --
  // never a duplicate/competing execution, only a fast, cheap reclaim
  // check for a job that already died.
  if (!TERMINAL_JOB_STATUSES.includes(job.status as (typeof TERMINAL_JOB_STATUSES)[number])) {
    const workerPromise = processReportJobQueue({
      jobId,
      defer: (task) => after(task),
    });
    after(async () => {
      await workerPromise.catch((workerError) => {
        console.error("[report-jobs] polling recovery worker failed", workerError);
      });
    });
  }

  let report: { sections: unknown; metadata: unknown } | null = null;
  if (job.status === "completed" && job.report_id) {
    const reportLoadStartedAt = Date.now();
    const { data: completedReport, error: reportError } = await supabase
      .from("reports")
      .select("sections,metadata")
      .eq("id", job.report_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reportError) {
      console.warn("[report-jobs] completed report inline load failed", {
        jobId,
        reportId: job.report_id,
        error: reportError.message,
      });
    } else if (completedReport) {
      report = completedReport;
    }

    console.info("[report-jobs] completed status delivery timing", {
      jobId,
      statusLookupAndAuthMs: reportLoadStartedAt - requestStartedAt,
      reportLoadMs: Date.now() - reportLoadStartedAt,
      completionToDeliveryMs: job.updated_at
        ? Math.max(0, Date.now() - Date.parse(job.updated_at))
        : null,
    });
  }

  return NextResponse.json(
    {
      status: job.status,
      progress: job.progress,
      progressStage: job.progress_stage,
      reportId: job.report_id,
      report,
      updatedAt: job.updated_at,
      error: job.error_message || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
