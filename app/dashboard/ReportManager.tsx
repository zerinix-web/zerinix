"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type { DashboardReport } from "./report-utils";

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

export default function ReportManager({ reports }: { reports: DashboardReport[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredReports = normalizedQuery
    ? reports.filter((report) =>
        `${report.title} ${report.type}`.toLowerCase().includes(normalizedQuery)
      )
    : reports;

  return (
    <>
      <div className="mt-8">
        <div className="relative max-w-2xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-200" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports..."
            className="w-full rounded-2xl border border-white/10 bg-zinc-950/80 py-4 pl-12 pr-4 text-sm text-white outline-none shadow-2xl shadow-black/20 transition placeholder:text-zinc-600 focus:border-teal-300/40 focus:bg-zinc-950"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredReports.map((report) => {
          const TypeIcon = report.type === "Market Analysis" ? BarChart3 : FileText;

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

      {reports.length > 0 && filteredReports.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/80 p-10 text-center shadow-2xl shadow-black/30">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Search className="h-6 w-6 text-teal-200" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-white">
            No reports found.
          </h2>
        </div>
      ) : null}
    </>
  );
}
