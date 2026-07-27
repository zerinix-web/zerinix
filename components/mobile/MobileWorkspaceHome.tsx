"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Clock3,
  Folder,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { createWorkspace } from "@/app/dashboard/actions";
import type { DashboardWorkspace } from "@/app/dashboard/report-utils";

function formatActivityDate(value: string) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    return "No activity yet";
  }

  const distance = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (distance < day) return "Today";
  if (distance < day * 2) return "Yesterday";
  if (distance < day * 7) return `${Math.floor(distance / day)} days ago`;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function CreateWorkspaceForm({
  onCancel,
}: {
  onCancel?: () => void;
}) {
  return (
    <form
      action={createWorkspace}
      className="mt-5 rounded-[1.5rem] border border-teal-200/15 bg-teal-200/[0.055] p-4 shadow-xl shadow-teal-950/15"
    >
      <label className="text-xs font-semibold uppercase tracking-[0.17em] text-teal-100/70">
        Workspace name
        <input
          name="name"
          required
          autoFocus
          maxLength={80}
          placeholder="e.g. AI Accounting SaaS"
          className="mt-3 min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm font-medium text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-200/35 focus:ring-2 focus:ring-teal-200/10"
        />
      </label>
      <div className="mt-3 flex gap-2">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-zinc-300 transition active:scale-[0.98]"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black shadow-lg shadow-white/10 transition active:scale-[0.98]"
        >
          <FolderPlus className="h-4 w-4" />
          Create
        </button>
      </div>
    </form>
  );
}

export default function MobileWorkspaceHome({
  workspaces,
  hasError = false,
}: {
  workspaces: DashboardWorkspace[];
  hasError?: boolean;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const activeWorkspaceCount = workspaces.filter(
    (workspace) => workspace.reportCount > 0
  ).length;

  return (
    <div className="relative min-h-[calc(100dvh-4.5rem)] overflow-hidden px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-7 text-white lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.12),transparent_29%),radial-gradient(circle_at_8%_42%,rgba(255,255,255,0.04),transparent_25%)]" />

      <div className="relative mx-auto max-w-xl">
        <header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.23em] text-teal-200/70">
                Decision memory
              </p>
              <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.045em]">
                Workspaces
              </h1>
              <p className="mt-2 max-w-sm text-[15px] leading-6 text-zinc-400">
                Organize strategic reports around each business, market, or
                decision.
              </p>
            </div>
            {workspaces.length > 0 && !hasError ? (
              <button
                type="button"
                onClick={() => setShowCreateForm((visible) => !visible)}
                aria-label="Create workspace"
                aria-expanded={showCreateForm}
                className="mt-7 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] text-teal-200 shadow-lg shadow-black/20 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
              >
                <FolderPlus className="h-5 w-5" />
              </button>
            ) : null}
          </div>

          {workspaces.length > 0 && !hasError ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-200" />
              {activeWorkspaceCount} active · {workspaces.length} total
            </div>
          ) : null}
        </header>

        {showCreateForm && workspaces.length > 0 ? (
          <CreateWorkspaceForm onCancel={() => setShowCreateForm(false)} />
        ) : null}

        {hasError ? (
          <section
            role="alert"
            className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.045] px-6 py-10 text-center shadow-2xl shadow-black/30"
          >
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
              <RefreshCw className="h-5 w-5 text-teal-200" />
            </span>
            <h2 className="mt-5 text-xl font-semibold text-white">
              Workspaces are temporarily unavailable
            </h2>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-zinc-400">
              Your workspace data is safe. Please try loading it again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 min-h-12 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition active:scale-[0.98]"
            >
              Try again
            </button>
          </section>
        ) : workspaces.length === 0 ? (
          <section className="mt-8 rounded-[1.75rem] border border-dashed border-white/15 bg-white/[0.04] px-6 py-12 text-center shadow-2xl shadow-black/30 ring-1 ring-white/[0.02]">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-teal-200/20 bg-teal-200/[0.08]">
              <Folder className="h-7 w-7 text-teal-200" />
            </span>
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">
              No workspace yet
            </h2>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-zinc-400">
              Create your first workspace to organize strategic analysis.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 transition active:scale-[0.98]"
            >
              <FolderPlus className="h-4 w-4" />
              Create Workspace
            </button>
            {showCreateForm ? (
              <CreateWorkspaceForm onCancel={() => setShowCreateForm(false)} />
            ) : null}
          </section>
        ) : (
          <section className="mt-7" aria-label="Your workspaces">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.19em] text-zinc-500">
              Your workspaces
            </p>
            <div className="space-y-3">
              {workspaces.map((workspace) => {
                const activityDate =
                  workspace.updatedAt || workspace.createdAt;
                const active = workspace.reportCount > 0;

                return (
                  <Link
                    key={workspace.id}
                    href={`/dashboard/workspaces/${workspace.id}`}
                    prefetch={false}
                    className="group block rounded-[1.6rem] border border-white/10 bg-white/[0.05] p-5 shadow-xl shadow-black/25 ring-1 ring-white/[0.025] transition duration-200 active:scale-[0.985] active:border-teal-200/25 active:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
                  >
                    <article>
                      <div className="flex items-start gap-4">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                          <Folder className="h-5 w-5 text-teal-200" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-3">
                            <h2 className="truncate text-[1.05rem] font-semibold text-white">
                              {workspace.name}
                            </h2>
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  active ? "bg-teal-200" : "bg-zinc-600"
                                }`}
                              />
                              {active ? "Active" : "Ready"}
                            </span>
                          </span>
                          <span className="mt-2 block text-sm text-zinc-400">
                            {workspace.reportCount}{" "}
                            {workspace.reportCount === 1 ? "report" : "reports"}
                          </span>
                        </span>
                      </div>

                      <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-xs text-zinc-500">
                        <Clock3 className="h-3.5 w-3.5 text-teal-200/70" />
                        Last activity {formatActivityDate(activityDate)}
                        <span className="ml-auto inline-flex items-center gap-1.5 font-semibold text-zinc-300">
                          Open
                          <ArrowRight className="h-4 w-4 transition group-active:translate-x-0.5 group-active:text-teal-200" />
                        </span>
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
