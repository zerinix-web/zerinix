import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { AdminShell } from "../AdminShell";
import { loadAdminReports, resolveAdminDateRange } from "../admin-data";

type ReportsPageProps = {
  searchParams: Promise<{
    q?: string;
    type?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
};

function formatDate(value: string) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatDateInput(value: string) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const search = String(params.q || "").trim();
  const reportType = String(params.type || "").trim();
  const dateRange = resolveAdminDateRange({
    range: params.range,
    from: params.from,
    to: params.to,
  });
  const result = await loadAdminReports({
    search,
    reportType,
    dateRange,
  });

  return (
    <AdminShell
      eyebrow="Admin / Reports"
      title="Reports"
      subtitle="Review generated reports, ownership, status, and attributed AI usage from production records."
    >
      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
        <form action="/admin/reports" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_9rem_9rem_auto]">
          <label className="relative">
            <span className="sr-only">Search reports</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search by title or owner email"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
            />
          </label>
          <label>
            <span className="sr-only">Report type</span>
            <select
              name="type"
              defaultValue={reportType}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
            >
              <option value="">All report types</option>
              {result.reportTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Date range</span>
            <select
              name="range"
              defaultValue={dateRange.key}
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
            >
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <input
            type="date"
            name="from"
            defaultValue={formatDateInput(dateRange.fromIso)}
            className="h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
          />
          <input
            type="date"
            name="to"
            defaultValue={formatDateInput(dateRange.toIso)}
            className="h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
          />
          <button
            type="submit"
            className="h-12 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/25 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 text-sm text-zinc-500">
          <span>{result.reports.length} reports</span>
          <span>{result.detail}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-white/10 bg-black/25 text-xs uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="px-5 py-4">Report title</th>
                <th className="px-5 py-4">Report type</th>
                <th className="px-5 py-4">Owner email</th>
                <th className="px-5 py-4">Creation date</th>
                <th className="px-5 py-4">AI cost</th>
                <th className="px-5 py-4">Total tokens</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {result.reports.map((report) => (
                <tr key={report.id} className="text-zinc-300">
                  <td className="px-5 py-4">
                    <span className="block max-w-md truncate font-medium text-white">{report.title}</span>
                    <span className="text-xs text-zinc-500">{report.id}</span>
                  </td>
                  <td className="px-5 py-4">{report.reportType}</td>
                  <td className="px-5 py-4">{report.ownerEmail}</td>
                  <td className="px-5 py-4">{formatDate(report.createdAt)}</td>
                  <td className="px-5 py-4">{formatCurrency(report.aiCostUsd)}</td>
                  <td className="px-5 py-4">{report.totalTokens.toLocaleString("en-US")}</td>
                  <td className="px-5 py-4 capitalize">{report.status}</td>
                  <td className="px-5 py-4">
                    <Link
                      href={`/dashboard/${report.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-xs font-medium text-white transition hover:border-teal-300/30"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-teal-200" />
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!result.reports.length ? (
          <div className="p-8">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-6 text-sm text-zinc-400">
              No reports match the selected filters.
            </div>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
