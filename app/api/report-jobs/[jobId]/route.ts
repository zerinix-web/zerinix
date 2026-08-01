import { after, NextResponse } from "next/server";
import { createAuthenticatedReportJobClient } from "@/app/lib/report-jobs/request-auth";
import { processReportJobQueue } from "@/app/lib/report-jobs/worker";

export const dynamic = "force-dynamic";

type ReportJobRouteContext = {
  params: Promise<{ jobId: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      "id,status,progress,progress_stage,report_id,error_code,error_message,updated_at"
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

  if (job.status === "queued" || job.status === "retry_wait") {
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
