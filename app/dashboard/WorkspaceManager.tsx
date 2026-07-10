import Link from "next/link";
import {
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  Pencil,
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
  return (
    <>
      <form
        action={createWorkspace}
        className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/30 backdrop-blur-xl"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] border border-teal-300/20 bg-teal-300/10 shadow-lg shadow-teal-950/10">
            <FolderPlus className="h-5 w-5 text-teal-200" />
          </div>
          <input
            name="name"
            required
            placeholder="New workspace name"
            className="min-h-12 flex-1 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition duration-300 placeholder:text-zinc-600 focus:border-teal-300/40 focus:bg-black/50"
          />
          <button
            type="submit"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-xl shadow-white/10 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200"
          >
            <FolderPlus className="h-4 w-4" />
            Create Workspace
          </button>
        </div>
      </form>

      {workspaces.length === 0 ? (
        <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-10 text-center shadow-2xl shadow-black/30 backdrop-blur-xl">
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
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => {
          const isDeleteDisabled = workspace.reportCount > 0;
          const statusLabel = workspace.reportCount > 0 ? "Active" : "Ready";
          const activityDate = workspace.updatedAt || workspace.createdAt;

          return (
            <article
              key={workspace.id}
              className="group rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-white/10 bg-white/5 transition duration-300 group-hover:border-teal-300/25 group-hover:bg-teal-300/10">
                  <Folder className="h-5 w-5 text-teal-200" />
                </div>
                <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-100 shadow-lg shadow-teal-950/10">
                  {statusLabel}
                </span>
              </div>

              <h2 className="mt-5 line-clamp-2 text-xl font-semibold tracking-tight text-white">
                {workspace.name}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Reports
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {workspace.reportCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
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
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-teal-300/15 bg-teal-300/[0.06] px-3 py-2 text-sm font-medium text-teal-100 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10"
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
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-200 outline-none transition duration-300 focus:border-teal-300/40"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-zinc-200 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/10"
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
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 transition duration-300 hover:-translate-y-0.5 hover:border-red-300/30 hover:bg-red-950/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
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
    </>
  );
}
