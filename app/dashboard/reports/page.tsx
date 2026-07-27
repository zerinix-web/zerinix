import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import DashboardSidebar from "../DashboardSidebar";
import ReportManager from "../ReportManager";
import MobileReportsHome from "@/components/mobile/MobileReportsHome";
import {
  getAuthenticatedUser,
  loadUserReportPreviews,
  type DashboardReport,
} from "../report-utils";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login?next=/dashboard/reports");
  }

  const { reports, error } = await loadUserReportPreviews(supabase, user);
  const desktopReports: DashboardReport[] = reports.map((report) => ({
    id: report.id,
    workspaceId: report.workspaceId,
    title: report.title,
    prompt: report.summary,
    createdAt: report.createdAt,
    type:
      report.type === "Market Analysis"
        ? "Market Analysis"
        : "Business Plan",
    status: report.status,
    sections: [],
  }));

  return (
    <main className={dashboardTheme.page}>
      <div className={dashboardTheme.atmosphere} />
      <div className={dashboardTheme.grid} />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 lg:hidden">
          <MobileReportsHome reports={reports} hasError={Boolean(error)} />
        </section>

        <section className="hidden flex-1 px-4 pb-28 pt-5 sm:px-8 lg:block lg:px-10 lg:py-9">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-2xl sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
              Reports
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              Strategic report library
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
              Search, reopen and organize saved business intelligence reports.
            </p>
          </div>

          {error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Report history could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          <ReportManager reports={desktopReports} workspaceName="All reports" />
        </section>
      </div>
    </main>
  );
}
