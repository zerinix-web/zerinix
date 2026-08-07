"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import type { DashboardWorkspace } from "./report-utils";
import {
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
} from "./actions";

function formatWorkspaceDate(value: string) {
  if (!value) {
    return "No updates yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export default function WorkspaceManager({
  workspaces,
}: {
  workspaces: DashboardWorkspace[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "reports">("recent");
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return workspaces
      .filter((workspace) =>
        normalizedQuery
          ? workspace.name.toLowerCase().includes(normalizedQuery)
          : true
      )
      .sort((a, b) => {
        if (sort === "name") {
          return a.name.localeCompare(b.name);
        }

        if (sort === "reports") {
          return b.reportCount - a.reportCount || a.name.localeCompare(b.name);
        }

        return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
      });
  }, [query, sort, workspaces]);

  return (
    <section id="workspaces" className="mt-8 scroll-mt-24">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
            Workspaces
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">
            Organize reports by venture, market or decision.
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-zinc-500">
          Each workspace keeps related reports together so strategy work stays
          easy to scan and reopen.
        </p>
      </div>

      <form
        action={createWorkspace}
        className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.052]"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] border border-teal-300/20 bg-teal-300/10 shadow-lg shadow-teal-950/10">
            <FolderPlus className="h-5 w-5 text-teal-200" />
          </div>
          <input
            name="name"
            required
            placeholder="New workspace name"
            className="min-h-12 flex-1 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition duration-300 placeholder:text-zinc-600 focus:border-teal-300/40 focus:bg-black/50 focus:ring-2 focus:ring-teal-200/10"
          />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-xl shadow-white/10 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <FolderPlus className="h-4 w-4" />
            Create Workspace
          </button>
        </div>
      </form>

      {workspaces.length > 0 ? (
        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-200" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspaces..."
              className="min-h-14 w-full rounded-[1.35rem] border border-white/10 bg-white/[0.045] py-4 pl-12 pr-4 text-sm text-white outline-none shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 placeholder:text-zinc-600 hover:bg-white/[0.055] focus:border-teal-300/40 focus:bg-white/[0.065] focus:ring-2 focus:ring-teal-200/10"
            />
          </div>
          <label className="flex min-h-14 items-center gap-2 rounded-[1.35rem] border border-white/10 bg-white/[0.045] px-4 text-sm text-zinc-400 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:bg-white/[0.055]">
            <ArrowDownUp className="h-4 w-4 text-teal-200" />
            <span className="sr-only">Sort workspaces</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="min-h-12 rounded-lg bg-transparent text-sm text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
              <option value="recent">Recently updated</option>
              <option value="name">Name A-Z</option>
              <option value="reports">Most reports</option>
            </select>
          </label>
        </div>
      ) : null}

      {workspaces.length === 0 ? (
        <div className="mt-6 rounded-[1.85rem] border border-dashed border-white/10 bg-white/[0.04] p-10 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-teal-300/20 bg-teal-300/10">
            <Inbox className="h-6 w-6 text-teal-200" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
            Empty Workspace System
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Create your first workspace
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-500">
            Start with a focused workspace for a venture, market, customer
            segment or investment theme. Reports created in ZERINIX will stay
            organized here.
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredWorkspaces.map((workspace) => {
          const isDeleteDisabled = workspace.reportCount > 0;
          const statusLabel = workspace.reportCount > 0 ? "Active" : "Ready";
          const activityDate = workspace.updatedAt || workspace.createdAt;

          return (
            <article
              key={workspace.id}
              className="group relative min-h-[25.5rem] overflow-hidden rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065] hover:shadow-teal-950/10"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-teal-300/5 blur-2xl transition duration-300 group-hover:bg-teal-300/10" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-white/10 bg-white/5 transition duration-300 group-hover:border-teal-300/25 group-hover:bg-teal-300/10">
                  <Folder className="h-5 w-5 text-teal-200" />
                </div>
                <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100 shadow-lg shadow-teal-950/10 ring-1 ring-teal-200/10">
                  {statusLabel}
                </span>
              </div>

              <h2 className="mt-5 line-clamp-2 text-xl font-semibold tracking-tight text-white">
                {workspace.name}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 shadow-inner shadow-black/15">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Reports
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {workspace.reportCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3 shadow-inner shadow-black/15">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Updated
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-zinc-200">
                    {formatWorkspaceDate(activityDate)}
                  </p>
                </div>
              </div>

              <Link
                href={`/dashboard/workspaces/${workspace.id}`}
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-300/15 bg-teal-300/[0.06] px-3 py-2 text-sm font-medium text-teal-100 shadow-lg shadow-teal-950/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <FileText className="h-4 w-4" />
                Open workspace
              </Link>

              <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
                <form action={renameWorkspace} className="flex gap-2">
                  <input
                    type="hidden"
                    name="workspace_id"
                    value={workspace.id}
                  />
                  <input
                    name="name"
                    defaultValue={workspace.name}
                    required
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-200 outline-none transition duration-300 hover:bg-black/45 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                  />
                  <button
                    type="submit"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-zinc-200 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                    aria-label="Rename workspace"
                  >
                    <Pencil className="h-4 w-4 text-teal-200" />
                  </button>
                </form>

                <form action={deleteWorkspace}>
                  <input
                    type="hidden"
                    name="workspace_id"
                    value={workspace.id}
                  />
                  <button
                    type="submit"
                    disabled={isDeleteDisabled}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 transition duration-300 hover:-translate-y-0.5 hover:border-red-300/30 hover:bg-red-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                  >
                    <Trash2 className="h-4 w-4 text-red-200" />
                    {isDeleteDisabled ? "Delete disabled while reports exist" : "Delete workspace"}
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </div>

      {workspaces.length > 0 && filteredWorkspaces.length === 0 ? (
        <div className="mt-6 rounded-[1.85rem] border border-dashed border-white/10 bg-white/[0.04] p-10 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-teal-300/20 bg-teal-300/10">
            <Search className="h-6 w-6 text-teal-200" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">
            No workspaces found
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-500">
            Try another name or clear the search field to see every workspace.
          </p>
        </div>
      ) : null}
    </section>
  );
}
