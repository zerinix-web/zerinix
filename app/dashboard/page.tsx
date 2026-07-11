import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Clock3,
  FileText,
  Folder,
  Gauge,
  Plus,
  Settings,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
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
  const latestWorkspaceUpdate = workspaces
    .map((workspace) => workspace.updatedAt || workspace.createdAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const recentReports = reports.slice(0, 4);
  const completedReports = reports.filter(
    (report) => report.status.toLowerCase() === "completed"
  ).length;
  const dashboardStats = [
    {
      label: "Workspaces",
      value: String(workspaces.length),
      detail: `${activeWorkspaces} active`,
      icon: Folder,
      tone: "teal",
    },
    {
      label: "Reports",
      value: String(reports.length || totalReports),
      detail: `${completedReports} completed`,
      icon: FileText,
      tone: "white",
    },
    {
      label: "AI Requests",
      value: formatNumber(usage.totalRequests),
      detail: `${formatNumber(usage.totalTokens)} tokens recorded`,
      icon: Gauge,
      tone: "teal",
    },
    {
      label: "Estimated AI Cost",
      value: formatCurrency(usage.estimatedCostUsd),
      detail: "Based on stored usage records",
      icon: Activity,
      tone: usage.error ? "amber" : "emerald",
    },
    {
      label: "Latest Activity",
      value: formatDashboardDate(latestWorkspaceUpdate || ""),
      detail: latestWorkspaceUpdate ? "Last workspace update" : "Create your first report",
      icon: Clock3,
      tone: "zinc",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 backdrop-blur-2xl">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%)]" />
              <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold tracking-[0.24em] text-teal-100 shadow-lg shadow-teal-950/20">
                    <Sparkles className="h-3.5 w-3.5" />
                    USER DASHBOARD
                  </div>
                  <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                    Workspace Center
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
                    Organize reports, reopen recent decisions, track usage and
                    keep every business workspace moving from idea to execution.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/plan"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200"
                  >
                    <Plus className="h-4 w-4" />
                    Create New Report
                  </Link>
                  <Link
                    href="/chat"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-5 py-3 text-sm font-semibold text-white transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-white/[0.075]"
                  >
                    <Sparkles className="h-4 w-4 text-teal-200" />
                    Open AI Chat
                  </Link>
                </div>
              </div>

              <div className="relative mt-8 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
                {["Workspace reports", "Live sync", "PDF export"].map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-400">
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

              return (
                <article
                  key={stat.label}
                  className="group rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-[1.05rem] border ${accentClass}`}>
                      <Icon className="h-5 w-5 text-teal-200" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 transition duration-300 group-hover:text-teal-100">
                      Live
                    </span>
                  </div>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-zinc-500">
                    {stat.detail}
                  </p>
                </article>
              );
            })}
          </div>

          {error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Workspace data could not be loaded right now: {error}
            </div>
          ) : null}

          {reportsError ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Report history could not be loaded right now: {reportsError}
            </div>
          ) : null}

          <div className="mt-8 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                    Recent reports
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Continue where the work is warm.
                  </h2>
                </div>
                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-teal-300/15 bg-teal-300/[0.06] px-4 py-2 text-sm font-medium text-teal-100 transition hover:border-teal-300/30 hover:bg-teal-300/10"
                >
                  <Plus className="h-4 w-4" />
                  New report
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
                        className="group flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-teal-300/25 hover:bg-white/[0.055] sm:flex-row sm:items-center"
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
                        <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium capitalize text-zinc-300">
                          {report.status}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-6 text-sm leading-6 text-zinc-500">
                    No reports yet. Create an AI Plan or Market Analysis to build
                    your first saved intelligence asset.
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-5">
              <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                    <WalletCards className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Subscription
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold capitalize text-white">
                      {planTier} plan
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Billing is not connected yet. Your current limits are
                      applied through the ZERINIX usage governance system.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                    <Settings className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Settings
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-white">
                      Account controls
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Authentication, saved reports and workspace data are
                      protected by Supabase. Advanced account settings will
                      appear here as billing and team features come online.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <WorkspaceManager workspaces={workspaces} />
        </section>
      </div>
    </main>
  );
}
