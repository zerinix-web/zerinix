"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  FileSearch,
  FileText,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  MobileReportPreview,
  MobileReportType,
} from "@/app/dashboard/report-utils";

type MobileReportFilter = "All" | MobileReportType;

const reportFilters: MobileReportFilter[] = [
  "All",
  "Business Plan",
  "Market Analysis",
  "Strategic Report",
];

function formatReportDate(value: string) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getSummaryPreview(report: MobileReportPreview) {
  const summary = report.summary
    .replace(/[`#*_>[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!summary) {
    return `${report.type} prepared for executive review.`;
  }

  return summary.length > 150 ? `${summary.slice(0, 147).trim()}…` : summary;
}

function getReportIcon(type: MobileReportType) {
  if (type === "Market Analysis") return BarChart3;
  if (type === "Strategic Report") return Sparkles;
  return FileText;
}

function getStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();

  if (normalized === "completed") return "Ready";
  if (normalized === "failed") return "Needs attention";
  if (normalized === "processing" || normalized === "pending") {
    return "Processing";
  }

  return status.trim() || "Saved";
}

function MobileReportsError() {
  return (
    <section
      role="alert"
      className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.045] px-6 py-10 text-center shadow-2xl shadow-black/35 ring-1 ring-white/[0.025]"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
        <RefreshCw className="h-5 w-5 text-teal-200" />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-white">
        Reports are temporarily unavailable
      </h2>
      <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-zinc-400">
        Your reports are safe. Please try loading the library again.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </button>
    </section>
  );
}

export default function MobileReportsHome({
  reports,
  hasError = false,
}: {
  reports: MobileReportPreview[];
  hasError?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] =
    useState<MobileReportFilter>("All");
  const deferredQuery = useDeferredValue(query);
  const filteredReports = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesType =
        activeFilter === "All" || report.type === activeFilter;
      const matchesQuery =
        !normalizedQuery ||
        report.title.toLowerCase().includes(normalizedQuery) ||
        report.type.toLowerCase().includes(normalizedQuery);

      return matchesType && matchesQuery;
    });
  }, [activeFilter, deferredQuery, reports]);

  return (
    <div className="relative min-h-[calc(100dvh-4.5rem)] overflow-hidden px-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-7 text-white lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.11),transparent_28%),radial-gradient(circle_at_8%_38%,rgba(255,255,255,0.04),transparent_25%)]" />

      <div className="relative mx-auto max-w-xl">
        <header>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
            <ShieldCheck className="h-4 w-4" />
            Decision intelligence
          </div>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.045em] text-white">
            Reports
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-6 text-zinc-400">
            Your strategic insights and business analyses
          </p>
        </header>

        {hasError ? (
          <MobileReportsError />
        ) : (
          <>
            <div className="relative mt-7">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reports"
                aria-label="Search reports by title or report type"
                autoComplete="off"
                className="min-h-13 w-full rounded-2xl border border-white/10 bg-white/[0.055] py-3.5 pl-12 pr-4 text-[15px] text-white shadow-xl shadow-black/20 outline-none ring-1 ring-white/[0.025] transition placeholder:text-zinc-500 focus:border-teal-200/35 focus:bg-white/[0.07] focus:ring-2 focus:ring-teal-200/10"
              />
            </div>

            <div
              aria-label="Report filters"
              className="-mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {reportFilters.map((filter) => {
                const active = filter === activeFilter;

                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveFilter(filter)}
                    className={`min-h-11 shrink-0 snap-start rounded-full border px-4 py-2.5 text-xs font-semibold transition duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35 ${
                      active
                        ? "border-teal-200/30 bg-teal-200 text-black shadow-lg shadow-teal-950/25"
                        : "border-white/10 bg-white/[0.045] text-zinc-300 shadow-sm shadow-black/15"
                    }`}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>

            {reports.length === 0 ? (
              <section className="mt-8 rounded-[1.75rem] border border-dashed border-white/15 bg-white/[0.04] px-6 py-12 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.02]">
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-teal-200/20 bg-teal-200/[0.08] shadow-lg shadow-teal-950/20">
                  <FileText className="h-7 w-7 text-teal-200" />
                </span>
                <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-white">
                  No reports yet
                </h2>
                <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-zinc-400">
                  Generate your first strategic report from a conversation.
                </p>
                <Link
                  href="/plan?new=1&mode=plan"
                  className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Plus className="h-4 w-4" />
                  Create Report
                </Link>
              </section>
            ) : filteredReports.length === 0 ? (
              <section className="mt-8 rounded-[1.75rem] border border-dashed border-white/15 bg-white/[0.04] px-6 py-10 text-center">
                <FileSearch className="mx-auto h-7 w-7 text-teal-200" />
                <h2 className="mt-4 text-lg font-semibold text-white">
                  No matching reports
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Try another title or choose a different report type.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setActiveFilter("All");
                  }}
                  className="mt-5 min-h-11 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98]"
                >
                  Clear search
                </button>
              </section>
            ) : (
              <section className="mt-6" aria-label="Saved reports">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {filteredReports.length}{" "}
                    {filteredReports.length === 1 ? "report" : "reports"}
                  </p>
                  <Link
                    href="/plan?new=1&mode=plan"
                    aria-label="Create report"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.055] text-teal-200 shadow-lg shadow-black/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
                  >
                    <Plus className="h-[1.125rem] w-[1.125rem]" />
                  </Link>
                </div>

                <div className="space-y-3">
                  {filteredReports.map((report) => {
                    const Icon = getReportIcon(report.type);
                    const status = getStatusLabel(report.status);
                    const failed =
                      report.status.trim().toLowerCase() === "failed";

                    return (
                      <Link
                        key={report.id}
                        href={`/dashboard/${report.id}`}
                        prefetch={false}
                        className="group block overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.05] p-5 shadow-xl shadow-black/25 ring-1 ring-white/[0.025] transition duration-200 active:scale-[0.985] active:border-teal-200/25 active:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
                      >
                        <article>
                          <div className="flex items-start gap-4">
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30 shadow-inner shadow-black/20">
                              <Icon className="h-5 w-5 text-teal-200" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-200/75">
                                  {report.type}
                                </span>
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      failed
                                        ? "bg-amber-300"
                                        : "bg-teal-200"
                                    }`}
                                  />
                                  {status}
                                </span>
                              </span>
                              <h2 className="mt-2 line-clamp-2 text-[1.05rem] font-semibold leading-6 tracking-[-0.02em] text-white">
                                {report.title}
                              </h2>
                            </span>
                          </div>

                          <p className="mt-4 line-clamp-3 text-sm leading-[1.65] text-zinc-400">
                            {getSummaryPreview(report)}
                          </p>

                          <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4 text-xs text-zinc-500">
                            <span>{formatReportDate(report.createdAt)}</span>
                            {report.confidence !== undefined ? (
                              <>
                                <span className="h-1 w-1 rounded-full bg-zinc-700" />
                                <span className="text-zinc-300">
                                  {report.confidence}% confidence
                                </span>
                              </>
                            ) : null}
                            <ArrowRight className="ml-auto h-4 w-4 text-zinc-500 transition duration-200 group-active:translate-x-0.5 group-active:text-teal-200" />
                          </div>
                        </article>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
