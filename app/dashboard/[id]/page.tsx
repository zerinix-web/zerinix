import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  FileText,
  Plus,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../DashboardSidebar";
import { getAuthenticatedUser, loadUserReport } from "../report-utils";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "Tarih yok";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function ReportDetailPage({
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

  const report = await loadUserReport(supabase, user, id);

  if (!report) {
    notFound();
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
            <div>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
              <p className="mt-6 text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                ZERINIX REPORT
              </p>
              <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight text-white md:text-5xl">
                {report.title}
              </h1>
            </div>

            <Link
              href="/plan"
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
            >
              <Plus className="h-4 w-4" />
              Create New Report
            </Link>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Report Type</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.type}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Created</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">
                {formatDate(report.createdAt)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Status</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.status}</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {report.sections.map((section) => (
              <article
                key={section.title}
                className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/30"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                    <FileText className="h-5 w-5 text-teal-200" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">
                      {section.title}
                    </h2>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
                      {section.content}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
