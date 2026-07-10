import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/75 p-6 shadow-2xl shadow-black/35 sm:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-medium text-zinc-400 transition duration-200 hover:border-teal-300/25 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Workspaces
                </Link>
                <p className="mt-6 text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                  WORKSPACE
                </p>
                <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
                  {data.workspace.name}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                  Search, open and export the reports inside this workspace.
                </p>
              </div>

              <Link
                href="/plan"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-white/5 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200"
              >
                <Plus className="h-4 w-4" />
                Create New Report
              </Link>
            </div>
          </div>

          {data.error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Workspace reports could not be loaded right now: {data.error}
            </div>
          ) : null}

          <ReportManager reports={data.reports} />
        </section>
      </div>
    </main>
  );
}
