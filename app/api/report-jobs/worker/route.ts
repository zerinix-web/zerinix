import { after, NextResponse } from "next/server";
import { processReportJobQueue } from "@/app/lib/report-jobs/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedWorkerRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const suppliedWorkerSecret = request.headers.get("x-report-worker-secret") || "";
  const allowedSecrets = [
    process.env.REPORT_JOB_WORKER_SECRET,
    process.env.CRON_SECRET,
  ].filter((value): value is string => Boolean(value?.trim()));

  if (allowedSecrets.length === 0) {
    return (
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
    );
  }

  return allowedSecrets.some(
    (secret) => secret === bearer || secret === suppliedWorkerSecret
  );
}

async function runWorker(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await processReportJobQueue({
      defer: (task) => after(task),
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[report-jobs] worker invocation failed", error);
    return NextResponse.json(
      { error: "Report worker invocation failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
