import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  FileText,
  FolderOpen,
  MessageCircle,
  Plus,
} from "lucide-react";
import type {
  DashboardReport,
  DashboardWorkspace,
} from "@/app/dashboard/report-utils";

export type MobileWorkspaceConversation = {
  id: string;
  title: string;
  updatedAt: string;
};

function formatDate(value: string) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) return "No activity yet";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function MobileWorkspaceDetail({
  workspace,
  reports,
  conversations,
  hasDataError = false,
}: {
  workspace: DashboardWorkspace;
  reports: DashboardReport[];
  conversations: MobileWorkspaceConversation[];
  hasDataError?: boolean;
}) {
  const recentReports = [...reports]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);
  const active = reports.length > 0;
  const lastActivity =
    recentReports[0]?.createdAt || workspace.updatedAt || workspace.createdAt;

  return (
    <div className="relative min-h-[calc(100dvh-4.5rem)] overflow-hidden px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-5 text-white lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.12),transparent_29%),radial-gradient(circle_at_8%_42%,rgba(255,255,255,0.04),transparent_25%)]" />

      <div className="relative mx-auto max-w-xl">
        <Link
          href="/dashboard/workspaces"
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-sm font-semibold text-zinc-300 shadow-lg shadow-black/15 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
        >
          <ArrowLeft className="h-4 w-4" />
          Workspaces
        </Link>

        <header className="mt-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.21em] text-teal-200/70">
            <FolderOpen className="h-4 w-4" />
            Workspace
          </div>
          <h1 className="mt-3 break-words text-[2rem] font-semibold tracking-[-0.045em]">
            {workspace.name}
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-6 text-zinc-400">
            Reports and decision history organized in one strategic context.
          </p>
          <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-zinc-300">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                active ? "bg-teal-200" : "bg-zinc-600"
              }`}
            />
            {active ? "Active workspace" : "Ready for analysis"}
          </span>
        </header>

        {hasDataError ? (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-950/20 px-4 py-3 text-sm leading-6 text-amber-100/80"
          >
            Some workspace activity is temporarily unavailable. Your saved data
            remains safe.
          </div>
        ) : null}

        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Workspace information
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <article className="rounded-[1.35rem] border border-white/10 bg-white/[0.05] p-4 shadow-lg shadow-black/20">
              <FileText className="h-4 w-4 text-teal-200" />
              <p className="mt-4 text-2xl font-semibold text-white">
                {reports.length}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Saved reports</p>
            </article>
            <article className="rounded-[1.35rem] border border-white/10 bg-white/[0.05] p-4 shadow-lg shadow-black/20">
              <Clock3 className="h-4 w-4 text-teal-200" />
              <p className="mt-4 text-sm font-semibold leading-6 text-white">
                {formatDate(lastActivity)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Last activity</p>
            </article>
          </div>
          <Link
            href={`/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(
              workspace.id
            )}`}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-xl shadow-white/10 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <Plus className="h-4 w-4" />
            Create Strategic Report
          </Link>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Recent reports
            </h2>
            <span className="text-xs text-zinc-600">
              {recentReports.length} shown
            </span>
          </div>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/20">
            {recentReports.length ? (
              recentReports.map((report) => (
                <Link
                  key={report.id}
                  href={`/dashboard/${report.id}`}
                  prefetch={false}
                  className="flex min-h-[4.75rem] items-center gap-3 border-b border-white/[0.07] px-4 py-3.5 last:border-b-0 transition active:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-200/30"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30">
                    <FileText className="h-4 w-4 text-teal-200" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {report.title}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {report.type} · {formatDate(report.createdAt)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </Link>
              ))
            ) : (
              <div className="px-5 py-9 text-center">
                <FileText className="mx-auto h-6 w-6 text-teal-200" />
                <p className="mt-3 text-sm font-semibold text-white">
                  No reports in this workspace
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Create a report to start its strategic history.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Recent conversations
          </h2>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Conversation history is currently account-level and is not yet
            assigned to individual workspaces.
          </p>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/20">
            {conversations.length ? (
              conversations.map((conversation) => (
                <div
                  key={conversation.id}
                  className="flex min-h-[4.5rem] items-center gap-3 border-b border-white/[0.07] px-4 py-3.5 last:border-b-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30">
                    <MessageCircle className="h-4 w-4 text-teal-200" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">
                      {conversation.title}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      Updated {formatDate(conversation.updatedAt)}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center">
                <MessageCircle className="mx-auto h-6 w-6 text-teal-200" />
                <p className="mt-3 text-sm font-semibold text-white">
                  No recent conversations
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  Conversations will appear after you use the AI Assistant.
                </p>
              </div>
            )}
          </div>
          <Link
            href="/chat"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-zinc-300 transition active:scale-[0.98]"
          >
            Open AI Assistant
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
