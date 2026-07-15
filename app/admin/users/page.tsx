import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { AdminShell } from "../AdminShell";
import { loadAdminUsers } from "../admin-data";

type UsersPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

function formatDate(value: string) {
  if (!value) {
    return "No activity";
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

function pageHref(page: number, search: string) {
  const params = new URLSearchParams();

  params.set("page", String(page));

  if (search) {
    params.set("q", search);
  }

  return `/admin/users?${params.toString()}`;
}

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page || 1) || 1);
  const search = String(params.q || "").trim();
  const result = await loadAdminUsers({ page, search });

  return (
    <AdminShell
      eyebrow="Admin / Users"
      title="Users"
      subtitle="Search users, inspect usage, manage account status, and change plans through audited server-side actions."
    >
      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
        <form action="/admin/users" className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search users</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search by email or display name"
              className="h-12 w-full rounded-2xl border border-white/10 bg-black/35 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/35 focus:ring-2 focus:ring-teal-300/10"
            />
          </label>
          <button
            type="submit"
            className="h-12 rounded-2xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200"
          >
            Search
          </button>
        </form>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/25 backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1360px] text-left text-sm">
            <thead className="border-b border-white/10 bg-black/25 text-xs uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="px-5 py-4">Email</th>
                <th className="px-5 py-4">Role</th>
                <th className="px-5 py-4">Plan</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Reports</th>
                <th className="px-5 py-4">Total tokens</th>
                <th className="px-5 py-4">Total AI cost</th>
                <th className="px-5 py-4">Registration date</th>
                <th className="px-5 py-4">Last activity</th>
                <th className="px-5 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {result.users.map((user) => (
                <tr key={user.id} className="text-zinc-300">
                  <td className="px-5 py-4">
                    <span className="block font-medium text-white">{user.email}</span>
                    <span className="text-xs text-zinc-500">
                      {user.displayName || "No display name"}
                    </span>
                  </td>
                  <td className="px-5 py-4 capitalize">{user.role}</td>
                  <td className="px-5 py-4 capitalize">{user.plan}</td>
                  <td className="px-5 py-4 capitalize">{user.accountStatus}</td>
                  <td className="px-5 py-4">{user.reportCount}</td>
                  <td className="px-5 py-4">{user.totalTokens.toLocaleString("en-US")}</td>
                  <td className="px-5 py-4">{formatCurrency(user.estimatedAiCostUsd)}</td>
                  <td className="px-5 py-4">{formatDate(user.registeredAt)}</td>
                  <td className="px-5 py-4">{formatDate(user.lastSignInAt)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-xs font-medium text-white transition hover:border-teal-300/30"
                      >
                        <Eye className="h-3.5 w-3.5 text-teal-200" />
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!result.users.length ? (
          <div className="p-8">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-6 text-sm text-zinc-400">
              No users match this search.
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {result.page} of {result.totalPages} · {result.totalUsers} users
          </span>
          <div className="flex gap-2">
            <Link
              href={pageHref(Math.max(1, result.page - 1), result.search)}
              aria-disabled={result.page <= 1}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-zinc-300 transition hover:border-teal-300/30 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
            <Link
              href={pageHref(Math.min(result.totalPages, result.page + 1), result.search)}
              aria-disabled={result.page >= result.totalPages}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-zinc-300 transition hover:border-teal-300/30 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
