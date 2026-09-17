"use client";

// Focused, presentation-only building blocks for the mobile Home screen
// (components/mobile/MobileHomeDashboard.tsx). Both components below only
// ever render REAL data
// passed in as props (workspaces/reports already loaded server-side by
// app/dashboard/page.tsx for the desktop dashboard) and link to routes
// that already exist (/dashboard/workspaces, /dashboard/workspaces/[id],
// /dashboard/reports, /dashboard/[id]) -- no new data fetching, no new
// business logic, no fabricated placeholder content.

import Link from "next/link";
import { ArrowRight, Clock3, FileText, Folder, FolderOpen } from "lucide-react";
import type { DashboardWorkspace } from "@/app/dashboard/report-utils";

// Deliberately NOT the full DashboardReport shape (which also carries
// sections/metadata/investmentScore -- a much larger payload than a
// mobile "continue where you left off" card needs). app/dashboard/page.tsx
// derives this from the SAME already-loaded report summaries it uses for
// the desktop dashboard, so this is a presentation-layer projection of
// real data, never a second report query.
export type MobileHomeReportSummary = {
  id: string;
  workspaceId: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
};

function formatRelativeActivityDate(value: string) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    return "No activity yet";
  }

  const distanceMs = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (distanceMs < day) return "Today";
  if (distanceMs < day * 2) return "Yesterday";
  if (distanceMs < day * 7) return `${Math.floor(distanceMs / day)}d ago`;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function getReportStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();

  if (normalized === "completed") return "Ready";
  if (normalized === "failed") return "Needs attention";
  if (normalized === "processing" || normalized === "pending") {
    return "Processing";
  }

  return status.trim() || "Saved";
}

export function RecentProjectsSection({
  workspaces,
  focusable = true,
}: {
  workspaces: DashboardWorkspace[];
  // Lets a caller pull these links out of the tab order when the section is
  // rendered but visually hidden (for example behind aria-hidden rather than
  // display:none), so a keyboard user cannot tab into invisible content.
  // Defaults to focusable, which is what the mobile Home dashboard needs.
  focusable?: boolean;
}) {
  const recentWorkspaces = [...workspaces]
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )
    .slice(0, 4);
  const linkTabIndex = focusable ? undefined : -1;

  return (
    <section aria-label="Recent projects" className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Recent Projects
        </p>
        {workspaces.length > 0 ? (
          <Link
            href="/dashboard/workspaces"
            tabIndex={linkTabIndex}
            className="text-[12px] font-semibold text-teal-200/80 transition active:text-teal-100"
          >
            See All
          </Link>
        ) : null}
      </div>

      {recentWorkspaces.length === 0 ? (
        <div className="flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-zinc-500">
            <FolderOpen className="h-4 w-4" />
          </span>
          <p className="text-[12.5px] leading-5 text-zinc-500">
            Your projects will appear here once you start an analysis.
          </p>
        </div>
      ) : (
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {recentWorkspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/dashboard/workspaces/${workspace.id}`}
              tabIndex={linkTabIndex}
              className="group flex min-h-[5.75rem] w-[9.5rem] shrink-0 snap-start flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5 shadow-[0_10px_26px_rgba(0,0,0,0.2)] transition duration-200 active:-translate-y-0.5 active:scale-[0.99] active:border-teal-200/20 active:bg-white/[0.06]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] text-zinc-400 transition duration-200 group-active:border-teal-200/20 group-active:text-teal-100">
                <Folder className="h-[0.95rem] w-[0.95rem]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold text-zinc-100">
                  {workspace.name}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">
                  {workspace.reportCount}{" "}
                  {workspace.reportCount === 1 ? "report" : "reports"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function ContinueActivitySection({
  reports,
  focusable = true,
}: {
  reports: MobileHomeReportSummary[];
  focusable?: boolean;
}) {
  const linkTabIndex = focusable ? undefined : -1;
  const recentReports = [...reports]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, 3);

  // Nothing real to show yet -- omit the section entirely rather than
  // render an empty/fabricated "continue" state for a user with no
  // report history at all.
  if (recentReports.length === 0) {
    return null;
  }

  return (
    <section aria-label="Continue where you left off" className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Continue Where You Left Off
        </p>
        <Link
          href="/dashboard/reports"
          tabIndex={linkTabIndex}
          className="text-[12px] font-semibold text-teal-200/80 transition active:text-teal-100"
        >
          See All
        </Link>
      </div>

      <div className="space-y-2.5">
        {recentReports.map((report) => (
          <Link
            key={report.id}
            href={`/dashboard/${report.id}`}
            tabIndex={linkTabIndex}
            className="group flex min-h-[4.5rem] w-full items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition duration-200 active:-translate-y-0.5 active:scale-[0.99] active:border-teal-200/20 active:bg-white/[0.055]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-zinc-400 transition duration-200 group-active:border-teal-200/20 group-active:text-teal-100">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-zinc-100">
                {report.title}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Clock3 className="h-3 w-3" />
                {formatRelativeActivityDate(report.createdAt)}
                <span aria-hidden="true">·</span>
                {getReportStatusLabel(report.status)}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition duration-200 group-active:translate-x-0.5 group-active:text-zinc-300" />
          </Link>
        ))}
      </div>
    </section>
  );
}
