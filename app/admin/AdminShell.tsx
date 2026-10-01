import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import { requireAdminPage } from "./admin-data";
import { AdminGlobalSearch } from "./AdminGlobalSearch";
import { AdminNavigation } from "./AdminNavigation";

function formatRole(role: string) {
  return role
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export async function AdminShell({
  children,
  eyebrow,
  title,
  subtitle,
  hidePageHeader = false,
  headerActions,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  hidePageHeader?: boolean;
  headerActions?: ReactNode;
}) {
  const admin = await requireAdminPage();
  const email = admin.user.email || "Admin user";
  const role = formatRole(admin.role);
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <main className={dashboardTheme.page}>
      <div className={dashboardTheme.atmosphere} />
      <div className={dashboardTheme.grid} />
      <div className="relative z-10 flex min-h-screen flex-col xl:flex-row">
        <aside className={`${dashboardTheme.sidebar} xl:sticky xl:top-0 xl:h-screen xl:w-[16.5rem] xl:px-4 xl:py-4`}>
          <Link
            href="/admin"
            className={`flex h-16 items-center gap-3 rounded-[1.65rem] p-3 ${dashboardTheme.surface} ${dashboardTheme.hoverSurface}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[1.15rem] bg-white text-[11px] font-black tracking-[0.16em] text-black shadow-lg shadow-white/10">
              ZX
            </span>
            <span>
              <span className="block text-[14px] font-bold tracking-[0.18em]">
                ZERINIX
              </span>
              <span className="text-[10px] text-zinc-500">Admin panel</span>
            </span>
          </Link>

          <AdminNavigation />
        </aside>

        <section className="flex-1 px-4 py-4 sm:px-6 xl:px-7 xl:py-5 2xl:px-8">
          <header className={`sticky top-3 z-30 mb-6 rounded-[1.65rem] p-4 shadow-2xl shadow-black/25 ${dashboardTheme.surfaceStrong} xl:p-5`}>
            {headerActions ? (
              <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.3fr)_minmax(18rem,auto)] xl:items-center">
                <div className="min-w-0 space-y-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-purple-200/70">
                      {eyebrow}
                    </p>
                    <h1 className="mt-1.5 text-[1.75rem] font-semibold leading-none tracking-[-0.04em] text-white md:text-[2.15rem]">
                      {title}
                    </h1>
                    <p className="mt-2 max-w-md text-[13px] leading-5 text-zinc-500">{subtitle}</p>
                  </div>

                  <details className="group relative w-full max-w-sm">
                    <summary className={`flex cursor-pointer list-none items-center gap-3 rounded-[1.15rem] px-3 py-2.5 shadow-inner shadow-white/[0.025] ${dashboardTheme.innerSurface} ${dashboardTheme.hoverSurface}`}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black tracking-[0.12em] text-black">
                        {initials}
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block truncate text-[13px] font-semibold text-white">
                          {email}
                        </span>
                        <span className="text-[11px] text-zinc-500">{role}</span>
                      </span>
                    </summary>
                    <div className={`absolute left-0 top-14 z-40 w-72 rounded-[1.45rem] p-4 ${dashboardTheme.surfaceStrong}`}>
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        Signed in as
                      </p>
                      <p className="mt-2 truncate text-sm font-semibold text-white">{email}</p>
                      <p className="mt-1 text-xs text-teal-100">{role}</p>
                      <div className="mt-4 grid gap-2">
                        <Link
                          href="/dashboard/settings"
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:border-teal-300/30 hover:text-white"
                        >
                          Account settings
                        </Link>
                        <Link
                          href="/admin/security"
                          className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:border-teal-300/30 hover:text-white"
                        >
                          Security settings
                        </Link>
                        <form action={signOut}>
                          <button
                            type="submit"
                            className="w-full rounded-2xl border border-white/10 bg-white px-3 py-2 text-left text-sm font-semibold text-black transition hover:bg-zinc-200"
                          >
                            Sign out
                          </button>
                        </form>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="min-w-0">
                  <AdminGlobalSearch />
                </div>
                <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                  {headerActions}
                </div>
              </div>
            ) : (
              <AdminGlobalSearch />
            )}
          </header>

          {hidePageHeader ? null : (
            <div className={`rounded-[2rem] p-6 sm:p-8 ${dashboardTheme.surfaceStrong}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-200/80">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400 md:text-base">
                {subtitle}
              </p>
            </div>
          )}

          {children}
        </section>
      </div>
    </main>
  );
}

export function AdminComingSoon({ section }: { section: string }) {
  return (
    <div className={`mt-6 rounded-[1.75rem] p-8 ${dashboardTheme.surface}`}>
      <p className="text-sm font-semibold text-white">{section}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
        This admin module is not configured yet. It is intentionally empty until
        the required backend source, permissions model, and audit flow are
        implemented.
      </p>
    </div>
  );
}
