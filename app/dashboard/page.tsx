import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  Clock3,
  FileText,
  Folder,
  Plus,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "./DashboardSidebar";
import WorkspaceManager from "./WorkspaceManager";
import { getAuthenticatedUser, loadUserWorkspaces } from "./report-utils";

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

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const { workspaces, error } = await loadUserWorkspaces(supabase, user);
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
      value: String(totalReports),
      detail: "Saved intelligence assets",
      icon: FileText,
      tone: "white",
    },
    {
      label: "System Status",
      value: error ? "Review" : "Ready",
      detail: error ? "Workspace sync needs attention" : "Workspace sync healthy",
      icon: Activity,
      tone: error ? "amber" : "emerald",
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
                    Organize ZERINIX reports into focused workspaces and manage
                    business decisions through a structured intelligence system.
                  </p>
                </div>

                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200"
                >
                  <Plus className="h-4 w-4" />
                  Create New Report
                </Link>
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

          <WorkspaceManager workspaces={workspaces} />
        </section>
      </div>
    </main>
  );
}
