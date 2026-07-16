import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Clock3,
  FileText,
  Folder,
  MessageSquareText,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import {
  getUserPlanTier,
  loadUserUsageSummary,
} from "@/app/lib/ai/governance";
import DashboardSidebar from "./DashboardSidebar";
import WorkspaceManager from "./WorkspaceManager";
import {
  getAuthenticatedUser,
  loadUserReports,
  loadUserWorkspaces,
  type DashboardReport,
  type DashboardWorkspace,
} from "./report-utils";

export const dynamic = "force-dynamic";

function formatDashboardDate(value: string) {
  if (!value) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getFirstName(user: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  const metadata = user?.user_metadata || {};
  const displayName =
    typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name
      : typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name
        : "";
  const source = displayName || user?.email || "";
  const firstName = source
    .split("@")[0]
    .split(/[.\s_-]+/)
    .find(Boolean);

  return firstName
    ? `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`
    : "Founder";
}

function getWorkspaceActivityDate(workspace: DashboardWorkspace) {
  return workspace.updatedAt || workspace.createdAt || "";
}

function getActiveWorkspace(workspaces: DashboardWorkspace[]) {
  return [...workspaces].sort((a, b) => {
    const bTime = new Date(getWorkspaceActivityDate(b)).getTime() || 0;
    const aTime = new Date(getWorkspaceActivityDate(a)).getTime() || 0;

    return bTime - aTime || b.reportCount - a.reportCount;
  })[0];
}

function cleanMobileDashboardText(value: string, maxLength = 132) {
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

  return `${clipped.slice(0, Math.max(72, lastSpace)).trim()}…`;
}

function getReportSectionContent(report: DashboardReport | undefined, matchers: string[]) {
  if (!report) {
    return "";
  }

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

function extractDashboardMetric(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedLabel}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  return cleanMobileDashboardText(match?.[1] || "", 118);
}

function getDecisionSignal(report: DashboardReport | undefined) {
  if (!report) {
    return "No decision signal yet";
  }

  const recommendation = getReportSectionContent(report, [
    "executiverecommendation",
    "executive recommendation",
    "recommendation",
  ]);
  const summary = getReportSectionContent(report, [
    "executivesummary",
    "executive summary",
    "marketoverview",
    "market overview",
  ]);
  const content = `${recommendation}\n${summary}`;
  const explicitSignal =
    extractDashboardMetric(recommendation, "Decision") ||
    extractDashboardMetric(recommendation, "Recommendation") ||
    extractDashboardMetric(recommendation, "Investment Recommendation");
  const keywordSignal = content.match(/\b(GO|NO GO|WAIT|PIVOT|VALIDATE|REVIEW|HOLD)\b/i)?.[1];

  return cleanMobileDashboardText(
    explicitSignal || keywordSignal || `${report.type} ready for review`,
    92
  );
}

function getRecommendedDashboardAction({
  activeWorkspace,
  latestCompletedReport,
  latestReport,
}: {
  activeWorkspace?: DashboardWorkspace;
  latestCompletedReport?: DashboardReport;
  latestReport?: DashboardReport;
}) {
  if (latestCompletedReport) {
    return {
      label: "Continue Analysis",
      href: `/chat?reportId=${encodeURIComponent(latestCompletedReport.id)}`,
      detail: "Use the latest report as advisor context.",
    };
  }

  if (latestReport?.status.toLowerCase() === "failed") {
    return {
      label: "Create New Report",
      href: activeWorkspace
        ? `/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(activeWorkspace.id)}`
        : "/plan?new=1&mode=plan",
      detail: "The latest report needs a clean follow-up run.",
    };
  }

  return {
    label: "Create Strategic Report",
    href: activeWorkspace
      ? `/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(activeWorkspace.id)}`
      : "/plan?new=1&mode=plan",
    detail: "Start a decision report to build workspace memory.",
  };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const [{ workspaces, error }, { reports, error: reportsError }, planTier, usage] =
    await Promise.all([
      loadUserWorkspaces(supabase, user),
      loadUserReports(supabase, user),
      getUserPlanTier(supabase, user.id),
      loadUserUsageSummary(supabase, user.id),
    ]);
  const totalReports = workspaces.reduce(
    (total, workspace) => total + workspace.reportCount,
    0
  );
  const activeWorkspaces = workspaces.filter(
    (workspace) => workspace.reportCount > 0
  ).length;
  const recentReports = reports.slice(0, 4);
  const completedReports = reports.filter(
    (report) => report.status.toLowerCase() === "completed"
  ).length;
  const activeWorkspace = getActiveWorkspace(workspaces);
  const activeWorkspaceReports = activeWorkspace
    ? reports.filter((report) => report.workspaceId === activeWorkspace.id)
    : reports;
  const activeWorkspaceContext =
    cleanMobileDashboardText(activeWorkspaceReports[0]?.prompt || "", 132) ||
    cleanMobileDashboardText(activeWorkspaceReports[0]?.title || "", 132) ||
    "Create a strategic report to establish this workspace context.";
  const latestReport = recentReports[0];
  const lastReportTime = latestReport?.createdAt || "";
  const latestCompletedReport = reports.find(
    (report) => report.status.toLowerCase() === "completed"
  );
  const firstName = getFirstName(user);
  const decisionSignal = getDecisionSignal(latestCompletedReport);
  const recommendedAction = getRecommendedDashboardAction({
    activeWorkspace,
    latestCompletedReport,
    latestReport,
  });
  const mobileMetrics = [
    { label: "Reports", value: String(reports.length || totalReports) },
    { label: "Workspaces", value: String(workspaces.length) },
    { label: "Completed", value: String(completedReports) },
    { label: "Runs", value: formatCompactNumber(usage.totalRequests) },
  ];
  const planLabel = `${planTier.charAt(0).toUpperCase()}${planTier.slice(1)} plan`;
  const usageEfficiency =
    usage.totalRequests > 0
      ? `${formatCompactNumber(Math.round(usage.totalTokens / usage.totalRequests))} avg tokens`
      : "No platform usage yet";
  const dashboardStats = [
    {
      label: "Last Report",
      value: formatDashboardDate(lastReportTime),
      detail: latestReport ? latestReport.title : "Create your first strategic report",
      icon: Clock3,
      tone: "teal",
      href: latestReport ? `/dashboard/${latestReport.id}` : "/plan?new=1&mode=plan",
    },
    {
      label: "Total Reports",
      value: String(reports.length || totalReports),
      detail: `${completedReports} completed`,
      icon: FileText,
      tone: "white",
      href: "/dashboard#reports",
    },
    {
      label: "AI Spend",
      value: formatCurrency(usage.estimatedCostUsd),
      detail: "Based on stored usage records",
      icon: Activity,
      tone: usage.error ? "amber" : "emerald",
      href: "/dashboard/usage",
    },
    {
      label: "Active Workspaces",
      value: String(activeWorkspaces),
      detail: `${workspaces.length} total workspaces`,
      icon: Folder,
      tone: "zinc",
      href: "/dashboard#workspaces",
    },
  ];
  const quickActions = [
    {
      title: "Create Strategic Report",
      description: "Choose a decision goal and generate a professional analysis.",
      href: "/plan?new=1&mode=plan",
      icon: Plus,
      primary: true,
    },
    {
      title: "Reports & Workspaces",
      description: "Review saved analysis and organize decisions.",
      href: "/dashboard#reports",
      icon: Folder,
    },
    {
      title: "Strategic Advisory",
      description: "Pressure-test decisions after reviewing reports.",
      href: "/chat",
      icon: MessageSquareText,
    },
  ];

  return (
    <main className={dashboardTheme.page}>
      <div className={dashboardTheme.atmosphere} />
      <div className={dashboardTheme.grid} />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 pt-5 pb-28 sm:px-8 lg:px-10 lg:py-9">
          <div className="space-y-4 lg:hidden">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-100">
                <Sparkles className="h-3.5 w-3.5" />
                Executive Workspace
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white">
                Welcome back, {firstName}.
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Your strategic reports, workspaces and AI spend are ready for review.
              </p>
            </div>

            <Link
              href={activeWorkspace ? `/dashboard/workspaces/${activeWorkspace.id}` : "/plan?new=1&mode=plan"}
              className="block rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Folder className="h-5 w-5 text-teal-200" />
                </div>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-medium text-zinc-400">
                  Active workspace
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
                {activeWorkspace?.name || "Create your first workspace"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {activeWorkspaceContext}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                <span className="text-sm text-zinc-500">
                  {activeWorkspace
                    ? `${activeWorkspace.reportCount} reports · ${formatDashboardDate(getWorkspaceActivityDate(activeWorkspace))}`
                    : "No workspace activity yet"}
                </span>
                <ArrowRight className="h-4 w-4 text-teal-200" />
              </div>
            </Link>

            <div className="grid gap-4">
              <Link
                href={latestCompletedReport ? `/dashboard/${latestCompletedReport.id}` : "/plan?new=1&mode=plan"}
                className="block rounded-[1.75rem] border border-white/10 bg-black/30 p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] transition duration-300 hover:border-teal-300/20 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                    <MessageSquareText className="h-4 w-4 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                      Decision Signal
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {latestCompletedReport?.title || "No completed report yet"}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xl font-semibold leading-7 text-white">
                  {decisionSignal}
                </p>
              </Link>

              <Link
                href={recommendedAction.href}
                className="block rounded-[1.75rem] border border-teal-300/20 bg-teal-300/[0.08] p-5 shadow-2xl shadow-teal-950/10 ring-1 ring-teal-200/10 transition duration-300 hover:border-teal-300/35 hover:bg-teal-300/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
                      Recommended Next Action
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                      {recommendedAction.label}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {recommendedAction.detail}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-200 text-black">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            </div>

            <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                    Recent Reports
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-white">
                    Latest decision assets
                  </h2>
                </div>
                <Link
                  href="/plan?new=1&mode=plan"
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-white px-3 text-xs font-semibold text-black"
                >
                  New
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {recentReports.length ? (
                  recentReports.slice(0, 3).map((report) => {
                    const Icon = report.type === "Market Analysis" ? BarChart3 : FileText;

                    return (
                      <Link
                        key={`mobile-report-${report.id}`}
                        href={`/dashboard/${report.id}`}
                        className="flex min-h-20 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 shadow-lg shadow-black/10 transition duration-300 hover:border-teal-300/25 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                          <Icon className="h-4 w-4 text-teal-200" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">
                            {report.title}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500">
                            {report.type} · {formatDashboardDate(report.createdAt)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium capitalize text-zinc-300">
                          {report.status}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/25 p-5 text-sm leading-6 text-zinc-500">
                    No reports yet. Create a strategic report to start your decision history.
                  </p>
                )}
              </div>
            </section>

            <section className="overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3">
                {mobileMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="w-32 rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-4 shadow-xl shadow-black/20 ring-1 ring-white/[0.025]"
                  >
                    <p className="text-2xl font-semibold text-white">{metric.value}</p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                      {metric.label}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="hidden lg:block">
          <div className="overflow-hidden rounded-[2.35rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-2xl transition duration-500 hover:border-teal-300/15 hover:bg-white/[0.052]">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.1),transparent_34%),radial-gradient(circle_at_85%_20%,rgba(45,212,191,0.16),transparent_32%),radial-gradient(circle_at_12%_90%,rgba(255,255,255,0.045),transparent_28%)]" />
              <div className="relative flex flex-col gap-10 xl:flex-row xl:items-stretch xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold tracking-[0.24em] text-teal-100 shadow-lg shadow-teal-950/20 ring-1 ring-teal-200/10">
                    <Sparkles className="h-3.5 w-3.5" />
                    PERSONAL EXECUTIVE WORKSPACE
                  </div>
                  <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
                    Welcome back, {firstName}.
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-400">
                    Your decision intelligence workspace is organized around reports,
                    AI spend, active workspaces and the next strategic action.
                  </p>
                  <div className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Latest report
                      </p>
                      <p className="mt-2 truncate text-sm font-semibold text-white">
                        {latestReport?.title || "No report yet"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatDashboardDate(lastReportTime)}
                      </p>
                    </div>
                    <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Active workspace
                      </p>
                      <p className="mt-2 truncate text-sm font-semibold text-white">
                        {activeWorkspace?.name || "No active workspace"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {activeWorkspace
                          ? `${activeWorkspace.reportCount} reports`
                          : "Create a report to start"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px] xl:max-w-[560px]">
                  {quickActions.map((action) => {
                    const Icon = action.icon;

                    return (
                      <Link
                        key={action.title}
                        href={action.href}
                        className={
                          action.primary
                            ? "group min-h-36 rounded-[1.35rem] bg-white p-4 text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-1 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                            : "group min-h-36 rounded-[1.35rem] border border-white/10 bg-black/25 p-4 text-white shadow-xl shadow-black/15 ring-1 ring-white/[0.025] transition duration-300 hover:-translate-y-1 hover:border-teal-300/25 hover:bg-white/[0.065] hover:shadow-2xl hover:shadow-teal-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={
                              action.primary
                                ? "flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-white"
                                : "flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 text-teal-200"
                            }
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <ArrowRight className="h-4 w-4 opacity-45 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                        </div>
                        <p className="mt-4 text-sm font-semibold tracking-tight">{action.title}</p>
                        <p
                          className={
                            action.primary
                              ? "mt-1 text-xs leading-5 text-zinc-700"
                              : "mt-1 text-xs leading-5 text-zinc-500"
                          }
                        >
                          {action.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="relative mt-8 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
                {["Strategic reports", "Decision workspaces", "PDF export"].map((item) => (
                  <div key={item} className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-400 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                    <BadgeCheck className="h-4 w-4 text-teal-200" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dashboardStats.map((stat) => {
              const Icon = stat.icon;
              const cardClass =
                "group relative min-h-[12.25rem] overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065] hover:shadow-teal-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30";
              const accentClass =
                stat.tone === "emerald"
                  ? "border-emerald-300/20 bg-emerald-300/10"
                  : stat.tone === "amber"
                    ? "border-amber-300/20 bg-amber-300/10"
                    : stat.tone === "white"
                      ? "border-white/15 bg-white/[0.06]"
                      : stat.tone === "teal"
                        ? "border-teal-300/20 bg-teal-300/10"
                        : "border-zinc-400/15 bg-white/[0.04]";
              const cardContent = (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60" />
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-teal-300/5 blur-2xl transition duration-300 group-hover:bg-teal-300/10" />
                  <div className="flex items-center justify-between gap-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-[1.05rem] border shadow-lg shadow-black/20 ring-1 ring-white/[0.025] ${accentClass}`}>
                      <Icon className="h-5 w-5 text-teal-200" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 shadow-sm shadow-black/10 transition duration-300 group-hover:border-teal-300/20 group-hover:text-teal-100">
                      Live
                    </span>
                  </div>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-zinc-500">
                    {stat.detail}
                  </p>
                </>
              );

              if (stat.href) {
                return (
                  <Link key={stat.label} href={stat.href} className={cardClass}>
                    {cardContent}
                  </Link>
                );
              }

              return (
                <article
                  key={stat.label}
                  className={cardClass}
                >
                  {cardContent}
                </article>
              );
            })}
          </div>

          {error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Workspace data could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          {reportsError ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Report history could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          <div className="mt-8 grid gap-5 2xl:grid-cols-[1.05fr_0.95fr]">
            <section id="reports" className="scroll-mt-6 rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                    Recent reports
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">
                    Continue the latest decisions.
                  </h2>
                </div>
                <Link
                  href="/plan?new=1&mode=plan"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-teal-300/15 bg-teal-300/[0.06] px-4 py-2 text-sm font-medium text-teal-100 shadow-lg shadow-teal-950/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <Plus className="h-4 w-4" />
                  Create strategic report
                </Link>
              </div>

              <div className="mt-5 space-y-3">
                {recentReports.length ? (
                  recentReports.map((report) => {
                    const Icon = report.type === "Market Analysis" ? BarChart3 : FileText;

                    return (
                      <Link
                        key={report.id}
                        href={`/dashboard/${report.id}`}
                        className="group flex min-h-[5.75rem] flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.055] hover:shadow-teal-950/10 sm:flex-row sm:items-center"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                          <Icon className="h-5 w-5 text-teal-200" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-white">
                            {report.title}
                          </span>
                          <span className="mt-1 block text-sm text-zinc-500">
                            {report.type} · {formatDashboardDate(report.createdAt)}
                          </span>
                        </span>
                        <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium capitalize text-zinc-300 shadow-sm shadow-black/10">
                          {report.status}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/25 p-7 text-sm leading-6 text-zinc-500 shadow-inner shadow-black/20">
                    No reports yet. Create a strategic report to build
                    your first saved intelligence asset.
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-1">
              <Link
                href="/dashboard/billing"
                className="block min-h-[15rem] rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/15 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                    <WalletCards className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Subscription
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold capitalize tracking-[-0.02em] text-white">
                      {planLabel}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Billing is not connected yet. Your current limits are
                      applied through the ZERINIX usage governance system.
                    </p>
                  </div>
                </div>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-teal-100">
                  Manage billing
                  <ArrowRight className="h-4 w-4" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Usage state
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {usage.error ? "Needs review" : "Healthy"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Efficiency
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {usageEfficiency}
                    </p>
                  </div>
                </div>
              </Link>

              <div className="min-h-[15rem] rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.055] sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                    <Settings className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Settings
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white">
                      Account controls
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Authentication, saved reports and workspace data are
                      protected by Supabase. Advanced account settings will
                      appear here as billing and team features come online.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/usage"
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <TrendingUp className="h-4 w-4 text-teal-200" />
                  View usage details
                </Link>
              </div>
            </section>
          </div>

          <WorkspaceManager workspaces={workspaces} />
          </div>
        </section>
      </div>
    </main>
  );
}
