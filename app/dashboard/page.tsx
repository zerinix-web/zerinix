import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "./DashboardSidebar";
import { getAuthenticatedUser, loadUserReports } from "./report-utils";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "Tarih yok";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

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

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => {
              const TypeIcon =
                report.type === "Market Analysis" ? BarChart3 : FileText;

              return (
                <Link
                  key={report.id}
                  href={`/dashboard/${report.id}`}
                  className="group rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/30 transition hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-zinc-900/90"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                      <TypeIcon className="h-5 w-5 text-teal-200" />
                    </div>
                    <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100">
                      {report.status}
                    </span>
                  </div>

                  <h2 className="mt-5 line-clamp-2 text-xl font-semibold tracking-tight text-white">
                    {report.title}
                  </h2>

                  <div className="mt-5 space-y-3 text-sm text-zinc-400">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-zinc-500" />
                      {formatDate(report.createdAt)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-teal-200" />
                      {report.type}
                    </div>
                  </div>

                  <p className="mt-5 text-sm font-medium text-teal-200 opacity-80 transition group-hover:opacity-100">
                    Raporu aç
                  </p>
                </Link>
              );
            })}
          </div>

          {reports.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/80 p-10 text-center shadow-2xl shadow-black/30">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <FileText className="h-6 w-6 text-teal-200" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-white">
                Henüz kayıtlı rapor yok
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
                İlk ZERINIX raporunu oluşturduğunda burada listelenecek.
              </p>
              <Link
                href="/plan"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
              >
                <Plus className="h-4 w-4" />
                Create New Report
              </Link>
            </div>
          ) : null}

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
