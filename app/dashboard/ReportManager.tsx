"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDownUp,
  BarChart3,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  FileText,
  Filter,
  FolderOpen,
  LayoutGrid,
  Pin,
  Plus,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { DashboardReport } from "./report-utils";

type ReportSort = "newest" | "oldest" | "title" | "type";
type ReportTypeFilter = "all" | DashboardReport["type"];
type ReportStatusFilter = "all" | "completed" | "failed" | "other";
type ReportViewFilter = "active" | "archived";

const PINNED_REPORTS_KEY = "zerinix.workspace.pinnedReports";
const FAVORITE_REPORTS_KEY = "zerinix.workspace.favoriteReports";
const ARCHIVED_REPORTS_KEY = "zerinix.workspace.archivedReports";

function formatDate(value: string) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelativeDate(value: string) {
  if (!value) {
    return "No activity";
  }

  const createdAt = new Date(value).getTime();
  const distance = Date.now() - createdAt;
  const day = 1000 * 60 * 60 * 24;

  if (Number.isNaN(createdAt)) {
    return formatDate(value);
  }

  if (distance < day) {
    return "Today";
  }

  if (distance < day * 2) {
    return "Yesterday";
  }

  if (distance < day * 8) {
    return `${Math.floor(distance / day)} days ago`;
  }

  return formatDate(value);
}

function readStoredIds(key: string) {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const value = window.localStorage.getItem(key);
    const ids = value ? JSON.parse(value) : [];

    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function persistStoredIds(key: string, ids: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...ids]));
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function getReportStatusFilter(status: string): ReportStatusFilter {
  const normalized = status.toLowerCase();

  if (normalized === "completed") {
    return "completed";
  }

  if (normalized === "failed") {
    return "failed";
  }

  return "other";
}

function getReportIcon(type: DashboardReport["type"]) {
  return type === "Market Analysis" ? BarChart3 : FileText;
}

export default function ReportManager({
  reports,
  workspaceName = "Workspace",
  workspaceId = "",
}: {
  reports: DashboardReport[];
  workspaceName?: string;
  workspaceId?: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ReportTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");
  const [viewFilter, setViewFilter] = useState<ReportViewFilter>("active");
  const [sort, setSort] = useState<ReportSort>("newest");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Starts empty (matching what the server renders) rather than reading
  // localStorage in the lazy initializer -- reading it there ran fine on
  // the client but returned an empty set on the server, so any returning
  // user with a pinned/favorited/archived report saw the list render
  // once unfiltered/unsorted, then immediately reorder/filter right
  // after hydration, on every load of this page. Read once after mount
  // instead, same as any other client-only data source.
  const [pinnedReportIds, setPinnedReportIds] = useState<Set<string>>(() => new Set());
  const [favoriteReportIds, setFavoriteReportIds] = useState<Set<string>>(() => new Set());
  const [archivedReportIds, setArchivedReportIds] = useState<Set<string>>(() => new Set());
  const [copiedReportId, setCopiedReportId] = useState("");

  useEffect(() => {
    // Intentional one-time sync from a genuinely external system
    // (localStorage, unreadable during SSR) on mount -- not a derived
    // value duplicating props/existing render state, which is what this
    // lint rule is meant to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPinnedReportIds(readStoredIds(PINNED_REPORTS_KEY));
    setFavoriteReportIds(readStoredIds(FAVORITE_REPORTS_KEY));
    setArchivedReportIds(readStoredIds(ARCHIVED_REPORTS_KEY));
  }, []);

  const reportCounts = useMemo(() => {
    const completed = reports.filter(
      (report) => report.status.toLowerCase() === "completed"
    ).length;
    const market = reports.filter((report) => report.type === "Market Analysis").length;
    const business = reports.filter((report) => report.type === "Business Plan").length;
    const archived = reports.filter((report) => archivedReportIds.has(report.id)).length;

    return { completed, market, business, archived };
  }, [archivedReportIds, reports]);

  const filteredReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return reports
      .filter((report) => {
        const isArchived = archivedReportIds.has(report.id);
        const isFavorite = favoriteReportIds.has(report.id);
        const searchText = `${report.title} ${report.type} ${report.status} ${report.prompt}`.toLowerCase();

        if (viewFilter === "active" && isArchived) {
          return false;
        }

        if (viewFilter === "archived" && !isArchived) {
          return false;
        }

        if (favoritesOnly && !isFavorite) {
          return false;
        }

        if (typeFilter !== "all" && report.type !== typeFilter) {
          return false;
        }

        if (statusFilter !== "all" && getReportStatusFilter(report.status) !== statusFilter) {
          return false;
        }

        return !normalizedQuery || searchText.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aPinned = pinnedReportIds.has(a.id) ? 1 : 0;
        const bPinned = pinnedReportIds.has(b.id) ? 1 : 0;

        if (aPinned !== bPinned) {
          return bPinned - aPinned;
        }

        if (sort === "title") {
          return a.title.localeCompare(b.title);
        }

        if (sort === "type") {
          return a.type.localeCompare(b.type) || b.createdAt.localeCompare(a.createdAt);
        }

        if (sort === "oldest") {
          return a.createdAt.localeCompare(b.createdAt);
        }

        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [
    archivedReportIds,
    favoriteReportIds,
    favoritesOnly,
    pinnedReportIds,
    query,
    reports,
    sort,
    statusFilter,
    typeFilter,
    viewFilter,
  ]);

  const recentActivity = useMemo(
    () =>
      [...reports]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 4),
    [reports]
  );

  function updatePinnedReports(reportId: string) {
    setPinnedReportIds((current) => {
      const next = toggleSetValue(current, reportId);
      persistStoredIds(PINNED_REPORTS_KEY, next);

      return next;
    });
  }

  function updateFavoriteReports(reportId: string) {
    setFavoriteReportIds((current) => {
      const next = toggleSetValue(current, reportId);
      persistStoredIds(FAVORITE_REPORTS_KEY, next);

      return next;
    });
  }

  function updateArchivedReports(reportId: string) {
    setArchivedReportIds((current) => {
      const next = toggleSetValue(current, reportId);
      persistStoredIds(ARCHIVED_REPORTS_KEY, next);

      return next;
    });
  }

  async function copyReportLink(reportId: string) {
    const url = `${window.location.origin}/dashboard/${reportId}`;

    await window.navigator.clipboard.writeText(url);
    setCopiedReportId(reportId);
    window.setTimeout(() => setCopiedReportId(""), 1600);
  }

  const hasFilters =
    query.trim() ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    viewFilter !== "active" ||
    favoritesOnly;
  const createReportHref = workspaceId
    ? `/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(workspaceId)}`
    : "/plan?new=1&mode=plan";

  return (
    <section className="mt-8">
      <div className="overflow-hidden rounded-[2.05rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                <Link
                  href="/dashboard"
                  className="rounded-md transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  Dashboard
                </Link>
                <span>/</span>
                <span className="text-zinc-300">{workspaceName}</span>
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                Report Management
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                Browse, organize and reopen reports.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                Designed for large workspaces: search by title or prompt, filter by
                type, pin critical reports and keep old material archived locally.
              </p>
            </div>

            <Link
              href={createReportHref}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Plus className="h-4 w-4" />
              Create Strategic Report
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total reports", reports.length],
              ["Completed", reportCounts.completed],
              ["Market analysis", reportCounts.market],
              ["Archived", reportCounts.archived],
            ].map(([label, value]) => (
              <div key={label} className="min-h-28 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-inner shadow-black/20 ring-1 ring-white/[0.015] transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.035]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-200" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reports by title, type or prompt..."
                className="min-h-14 w-full rounded-[1.35rem] border border-white/10 bg-black/35 py-4 pl-12 pr-4 text-sm text-white outline-none shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 placeholder:text-zinc-600 hover:bg-black/45 focus:border-teal-300/40 focus:bg-black/50 focus:ring-2 focus:ring-teal-200/10"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:flex">
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as ReportTypeFilter)}
                className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-zinc-200 shadow-lg shadow-black/10 outline-none ring-1 ring-white/[0.015] transition hover:bg-black/45 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                aria-label="Filter by report type"
              >
                <option value="all">All types</option>
                <option value="Business Plan">Business Plan</option>
                <option value="Market Analysis">Market Analysis</option>
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ReportStatusFilter)}
                className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-zinc-200 shadow-lg shadow-black/10 outline-none ring-1 ring-white/[0.015] transition hover:bg-black/45 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="other">Other</option>
              </select>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as ReportSort)}
                className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-zinc-200 shadow-lg shadow-black/10 outline-none ring-1 ring-white/[0.015] transition hover:bg-black/45 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                aria-label="Sort reports"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A-Z</option>
                <option value="type">Report type</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewFilter("active")}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 ${
                viewFilter === "active"
                  ? "border-teal-200/30 bg-teal-200/10 text-teal-100"
                  : "border-white/10 bg-white/[0.035] text-zinc-400 hover:text-white"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Active
            </button>
            <button
              type="button"
              onClick={() => setViewFilter("archived")}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 ${
                viewFilter === "archived"
                  ? "border-teal-200/30 bg-teal-200/10 text-teal-100"
                  : "border-white/10 bg-white/[0.035] text-zinc-400 hover:text-white"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30`}
            >
              <Archive className="h-3.5 w-3.5" />
              Archived
            </button>
            <button
              type="button"
              onClick={() => setFavoritesOnly((value) => !value)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 ${
                favoritesOnly
                  ? "border-teal-200/30 bg-teal-200/10 text-teal-100"
                  : "border-white/10 bg-white/[0.035] text-zinc-400 hover:text-white"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30`}
            >
              <Star className="h-3.5 w-3.5" />
              Favorites
            </button>
            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                  setViewFilter("active");
                  setFavoritesOnly(false);
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-semibold text-zinc-400 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                <span className="inline-flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-teal-200" />
                  {filteredReports.length} visible
                </span>
                <span className="inline-flex items-center gap-2">
                  <ArrowDownUp className="h-3.5 w-3.5 text-teal-200" />
                  {sort.replace("-", " ")}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {filteredReports.map((report) => {
                  const TypeIcon = getReportIcon(report.type);
                  const isPinned = pinnedReportIds.has(report.id);
                  const isFavorite = favoriteReportIds.has(report.id);
                  const isArchived = archivedReportIds.has(report.id);

                  return (
                    <article
                      key={report.id}
                      className="group relative min-h-[22rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065] hover:shadow-teal-950/10"
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-teal-300/5 blur-2xl transition duration-300 group-hover:bg-teal-300/10" />
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-white/10 bg-white/5 transition duration-300 group-hover:border-teal-300/25 group-hover:bg-teal-300/10">
                          <TypeIcon className="h-5 w-5 text-teal-200" />
                        </div>
                        <div className="flex items-center gap-2">
                          {isPinned ? (
                            <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-medium text-teal-100 shadow-sm shadow-teal-950/10 ring-1 ring-teal-200/10">
                              Pinned
                            </span>
                          ) : null}
                          <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-xs font-medium capitalize text-zinc-300 shadow-sm shadow-black/10">
                            {report.status}
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/dashboard/${report.id}`}
                        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                      >
                        <h3 className="mt-5 line-clamp-2 text-xl font-semibold tracking-tight text-white transition group-hover:text-teal-50">
                          {report.title}
                        </h3>
                        <div className="mt-4 grid gap-2 text-sm text-zinc-400">
                          <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 shadow-inner shadow-black/15">
                            <CalendarDays className="h-4 w-4 text-zinc-500" />
                            {formatDate(report.createdAt)}
                          </div>
                          <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 shadow-inner shadow-black/15">
                            <Sparkles className="h-4 w-4 text-teal-200" />
                            {report.type}
                          </div>
                        </div>
                      </Link>

                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                        <Link
                          href={`/dashboard/${report.id}`}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-300/15 bg-teal-300/[0.06] px-3 py-2 text-sm font-medium text-teal-100 shadow-lg shadow-teal-950/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          onClick={() => updatePinnedReports(report.id)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                          aria-label={isPinned ? "Unpin report" : "Pin report"}
                          title={isPinned ? "Unpin report" : "Pin report"}
                        >
                          <Pin className={`h-4 w-4 ${isPinned ? "fill-teal-200 text-teal-200" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateFavoriteReports(report.id)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                          aria-label={isFavorite ? "Remove favorite" : "Favorite report"}
                          title={isFavorite ? "Remove favorite" : "Favorite report"}
                        >
                          <Star className={`h-4 w-4 ${isFavorite ? "fill-teal-200 text-teal-200" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateArchivedReports(report.id)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                          aria-label={isArchived ? "Restore report" : "Archive report locally"}
                          title={isArchived ? "Restore report" : "Archive report locally"}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyReportLink(report.id)}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-zinc-300 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                          aria-label="Copy report link"
                          title="Copy report link"
                        >
                          {copiedReportId === report.id ? (
                            <Check className="h-4 w-4 text-teal-200" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {reports.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.045] p-10 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-teal-300/20 bg-teal-300/10">
                    <FileText className="h-6 w-6 text-teal-200" />
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold text-white">
                    No saved reports yet
                  </h2>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
                    Your first ZERINIX report will appear here once it is created.
                  </p>
                  <Link
                    href={createReportHref}
                    className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <Plus className="h-4 w-4" />
                    Create Strategic Report
                  </Link>
                </div>
              ) : null}

              {reports.length > 0 && filteredReports.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-white/[0.045] p-10 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-teal-300/20 bg-teal-300/10">
                    <Search className="h-6 w-6 text-teal-200" />
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold text-white">
                    No reports match this view
                  </h2>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
                    Try a broader search, switch report type, or clear filters to see
                    the full workspace.
                  </p>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
                <div className="flex items-center gap-3">
                  <Clock3 className="h-5 w-5 text-teal-200" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Recent activity
                    </p>
                    <h3 className="mt-1 font-semibold text-white">Latest reports</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {recentActivity.length ? (
                    recentActivity.map((report) => {
                      const TypeIcon = getReportIcon(report.type);

                      return (
                        <Link
                          key={`activity-${report.id}`}
                          href={`/dashboard/${report.id}`}
                          className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/25 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/25">
                            <TypeIcon className="h-4 w-4 text-teal-200" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-white">
                              {report.title}
                            </span>
                            <span className="mt-1 block text-xs text-zinc-500">
                              {formatRelativeDate(report.createdAt)}
                            </span>
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-zinc-500">
                      Activity appears here after reports are created.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
                <div className="flex items-center gap-3">
                  <FolderOpen className="h-5 w-5 text-teal-200" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Workspace system
                    </p>
                    <h3 className="mt-1 font-semibold text-white">Local organization</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-500">
                  Pins, favorites and archive views are private to this browser and do
                  not alter saved reports or workspace permissions.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
