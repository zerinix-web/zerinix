import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BarChart3, FileText, FolderOpen, Plus } from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../../DashboardSidebar";
import ReportManager from "../../ReportManager";
import { getAuthenticatedUser, loadWorkspaceReports } from "../../report-utils";

export const dynamic = "force-dynamic";

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

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 py-5 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-2xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.052] sm:p-8 lg:p-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                  <Link href="/dashboard" className="transition hover:text-white">
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
                  Search, open and export the reports inside this workspace.
                </p>
              </div>

              <Link
                href={`/plan?workspaceId=${data.workspace.id}`}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Plus className="h-4 w-4" />
                Create New Report
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
