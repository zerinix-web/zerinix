import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Plus,
  Settings,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "./DashboardSidebar";
import ReportManager from "./ReportManager";
import { getAuthenticatedUser, loadUserReports } from "./report-utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const { reports, error } = await loadUserReports(supabase, user);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                USER DASHBOARD
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
                Rapor Merkezi
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                ZERINIX ile oluşturduğun iş planlarını ve pazar analizlerini tek
                premium çalışma alanında yönet.
              </p>
            </div>

            <Link
              href="/plan"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
            >
              <Plus className="h-4 w-4" />
              Create New Report
            </Link>
          </div>

          {error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Supabase raporları şu anda okunamadı: {error}
            </div>
          ) : null}

          <ReportManager reports={reports} />

          <div
            id="settings"
            className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/60 p-5"
          >
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-teal-200" />
              <h2 className="text-lg font-semibold text-white">Settings</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Hesap ve çalışma alanı ayarları sonraki sürümde burada yönetilecek.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
