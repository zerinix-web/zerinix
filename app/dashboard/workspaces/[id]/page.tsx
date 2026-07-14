import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Compass,
  FileText,
  Flag,
  FolderOpen,
  Lightbulb,
  Plus,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../../DashboardSidebar";
import ReportManager from "../../ReportManager";
import {
  getAuthenticatedUser,
  loadWorkspaceReports,
  type DashboardReport,
} from "../../report-utils";

export const dynamic = "force-dynamic";

function formatWorkspaceDate(value: string) {
  if (!value) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelativeWorkspaceDate(value: string) {
  if (!value) {
    return "No activity yet";
  }

  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return formatWorkspaceDate(value);
  }

  const distance = Date.now() - timestamp;
  const day = 1000 * 60 * 60 * 24;

  if (distance < day) {
    return "Today";
  }

  if (distance < day * 2) {
    return "Yesterday";
  }

  if (distance < day * 30) {
    return `${Math.floor(distance / day)} days ago`;
  }

  return formatWorkspaceDate(value);
}

function cleanWorkspaceText(value: string, maxLength = 150) {
  const cleaned = value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const clipped = cleaned.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");

  return `${clipped.slice(0, Math.max(80, lastSpace)).trim()}…`;
}

function getWorkspaceSection(
  report: DashboardReport,
  matchers: string[]
) {
  const normalizedMatchers = matchers.map((matcher) => matcher.toLowerCase());
  const section = report.sections.find((item) => {
    const field = item.field?.toLowerCase() || "";
    const title = item.title.toLowerCase();

    return normalizedMatchers.some(
      (matcher) => field.includes(matcher) || title.includes(matcher)
    );
  });

  return section?.content || "";
}

function extractWorkspaceMetric(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedLabel}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  return cleanWorkspaceText(match?.[1] || "", 170);
}

function extractWorkspaceInsight(content: string, keywords: string[]) {
  const lines = content
    .replace(/^#{1,6}\s+/gm, "")
    .split(/\n+/)
    .map((line) => cleanWorkspaceText(line.replace(/^[-*•]\s+/, ""), 180))
    .filter((line) => line.length > 18);

  return (
    lines.find((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
    ) ||
    lines[0] ||
    ""
  );
}

function detectWorkspaceSignal(report: DashboardReport) {
  const recommendation = getWorkspaceSection(report, [
    "executiverecommendation",
    "executive recommendation",
    "recommendation",
  ]);
  const summary = getWorkspaceSection(report, [
    "executivesummary",
    "executive summary",
    "marketoverview",
    "market overview",
  ]);
  const content = `${recommendation}\n${summary}`;
  const decisionMatch = content.match(/\b(GO|NO GO|WAIT|PIVOT|VALIDATE|REVIEW|HOLD)\b/i);
  const metricSignal =
    extractWorkspaceMetric(recommendation, "Decision") ||
    extractWorkspaceMetric(recommendation, "Recommendation") ||
    extractWorkspaceMetric(recommendation, "Investment Recommendation");

  return cleanWorkspaceText(metricSignal || decisionMatch?.[1] || `${report.type} signal`, 70);
}

function getWorkspaceIntelligence(reports: DashboardReport[]) {
  const sortedReports = [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const completedReports = sortedReports.filter(
    (report) => report.status.toLowerCase() === "completed"
  );
  const latestReport = sortedReports[0];
  const latestCompletedReport = completedReports[0] || latestReport;
  const latestRecommendation = latestCompletedReport
    ? getWorkspaceSection(latestCompletedReport, [
        "executiverecommendation",
        "executive recommendation",
        "recommendation",
      ])
    : "";
  const latestSummary = latestCompletedReport
    ? getWorkspaceSection(latestCompletedReport, [
        "executivesummary",
        "executive summary",
        "marketoverview",
        "market overview",
      ])
    : "";
  const strategicFocus =
    cleanWorkspaceText(latestCompletedReport?.prompt || "", 150) ||
    cleanWorkspaceText(latestCompletedReport?.title || "", 150) ||
    "Create a strategic report to establish this workspace context.";
  const recommendedNextAction =
    extractWorkspaceMetric(latestRecommendation, "Next Critical Action") ||
    extractWorkspaceMetric(latestRecommendation, "Next Action") ||
    extractWorkspaceInsight(`${latestRecommendation}\n${latestSummary}`, [
      "next",
      "validate",
      "pilot",
      "launch",
      "action",
    ]) ||
    (reports.length
      ? "Review the latest report and create a follow-up analysis for unresolved decisions."
      : "Create the first strategic report to start the decision memory.");
  const decisionSignals = completedReports.slice(0, 3).map((report) => ({
    id: report.id,
    title: report.title,
    type: report.type,
    signal: detectWorkspaceSignal(report),
    createdAt: report.createdAt,
  }));
  const recentActivity = sortedReports.slice(0, 5).map((report) => ({
    id: report.id,
    title: report.title,
    type: report.type,
    status: report.status,
    createdAt: report.createdAt,
  }));

  return {
    strategicFocus,
    recentActivityDate: latestReport?.createdAt || "",
    recommendedNextAction: cleanWorkspaceText(recommendedNextAction, 180),
    decisionSignals,
    recentActivity,
  };
}

export default async function WorkspaceReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const data = await loadWorkspaceReports(supabase, user, id);

  if (!data) {
    notFound();
  }

  const completedReports = data.reports.filter(
    (report) => report.status.toLowerCase() === "completed"
  ).length;
  const marketReports = data.reports.filter(
    (report) => report.type === "Market Analysis"
  ).length;
  const businessReports = data.reports.filter(
    (report) => report.type === "Business Plan"
  ).length;
  const workspaceStats = [
    {
      label: "Total Reports",
      value: data.reports.length,
      icon: FolderOpen,
    },
    {
      label: "Completed",
      value: completedReports,
      icon: FileText,
    },
    {
      label: "Market Analysis",
      value: marketReports,
      icon: BarChart3,
    },
    {
      label: "Business Plans",
      value: businessReports,
      icon: FileText,
    },
  ];
  const intelligence = getWorkspaceIntelligence(data.reports);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 pt-5 pb-28 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-2xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.052] sm:p-8 lg:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                  <Link
                    href="/dashboard"
                    className="rounded-md transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                  >
                    Dashboard
                  </Link>
                  <span>/</span>
                  <span className="text-zinc-300">Workspaces</span>
                  <span>/</span>
                  <span className="text-zinc-300">{data.workspace.name}</span>
                </div>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-medium text-zinc-400 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Workspaces
                </Link>
                <p className="mt-6 text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                  WORKSPACE
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] text-white md:text-5xl">
                  {data.workspace.name}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-400">
                  Review strategic reports, decision signals and follow-up activity for this workspace.
                </p>
              </div>

              <Link
                href={`/plan?new=1&mode=plan&workspaceId=${data.workspace.id}`}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Plus className="h-4 w-4" />
                Create Strategic Report
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {workspaceStats.map((stat) => {
                const Icon = stat.icon;

                return (
                  <div
                    key={stat.label}
                    className="min-h-28 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-inner shadow-black/20 ring-1 ring-white/[0.015] transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.035]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        {stat.label}
                      </p>
                      <Icon className="h-4 w-4 text-teal-200" />
                    </div>
                    <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                      {stat.value}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <div className="overflow-hidden rounded-[2.05rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl">
              <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.018))] p-5 sm:p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                      Workspace Intelligence
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                      Company Decision Intelligence Hub
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                      Derived from saved reports in this workspace. ZERINIX uses this view to keep strategic context visible without changing report content.
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold text-teal-100">
                    <Compass className="h-3.5 w-3.5" />
                    Decision memory v1
                  </span>
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
                <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                      <FolderOpen className="h-4 w-4 text-teal-100" />
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                      Overview
                    </p>
                  </div>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-white">
                    {data.reports.length}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Reports stored in this workspace.
                  </p>
                </article>

                <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                      <Clock3 className="h-4 w-4 text-teal-100" />
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                      Recent Activity
                    </p>
                  </div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-white">
                    {formatRelativeWorkspaceDate(intelligence.recentActivityDate)}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Latest report movement.
                  </p>
                </article>

                <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                      <Lightbulb className="h-4 w-4 text-teal-100" />
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                      Strategic Focus
                    </p>
                  </div>
                  <p className="mt-4 text-sm font-medium leading-6 text-white">
                    {intelligence.strategicFocus}
                  </p>
                </article>
              </div>
            </div>

            <aside className="rounded-[2.05rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                  <Flag className="h-5 w-5 text-teal-100" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                    Decision Overview
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
                    Recent signals
                  </h2>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {intelligence.decisionSignals.length ? (
                  intelligence.decisionSignals.map((signal) => (
                    <Link
                      key={`signal-${signal.id}`}
                      href={`/dashboard/${signal.id}`}
                      className="block rounded-2xl border border-white/10 bg-black/30 p-4 shadow-lg shadow-black/15 transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/25 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {signal.title}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {signal.type} · {formatRelativeWorkspaceDate(signal.createdAt)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-medium text-teal-100">
                          {signal.signal}
                        </span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/25 p-4 text-sm leading-6 text-zinc-500">
                    Decision signals will appear after completed reports are saved in this workspace.
                  </p>
                )}
              </div>

              <div className="mt-5 rounded-[1.35rem] border border-teal-300/15 bg-teal-300/[0.06] p-4 shadow-lg shadow-teal-950/10">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-100" />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-100">
                    Recommended next action
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-200">
                  {intelligence.recommendedNextAction}
                </p>
              </div>
            </aside>
          </section>

          <section className="mt-6 rounded-[2.05rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                  Strategic Activity
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">
                  Recent workspace timeline
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-zinc-500">
                A chronological view of report activity that forms this workspace decision memory.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {intelligence.recentActivity.length ? (
                intelligence.recentActivity.map((activity, index) => (
                  <Link
                    key={`workspace-activity-${activity.id}`}
                    href={`/dashboard/${activity.id}`}
                    className="group grid gap-4 rounded-[1.35rem] border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/15 transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/25 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-teal-100">
                        {index + 1}
                      </span>
                      <span className="hidden h-10 w-px bg-white/10 sm:block" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white group-hover:text-teal-50">
                        {activity.title}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {activity.type} · {activity.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Activity className="h-4 w-4 text-teal-200" />
                      {formatRelativeWorkspaceDate(activity.createdAt)}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-black/25 p-8 text-center">
                  <Activity className="mx-auto h-8 w-8 text-teal-200" />
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    No strategic activity yet
                  </h3>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-500">
                    Create a strategic report to start building this workspace decision history.
                  </p>
                </div>
              )}
            </div>
          </section>

          {data.error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Workspace reports could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          <ReportManager
            reports={data.reports}
            workspaceId={data.workspace.id}
            workspaceName={data.workspace.name}
          />
        </section>
      </div>
    </main>
  );
}
