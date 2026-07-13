import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bell,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
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
    <main className="min-h-screen bg-[#0b0b0f] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(124,58,237,0.035),transparent_24%),radial-gradient(circle_at_18%_14%,rgba(255,255,255,0.035),transparent_26%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0b0b0f]/95 via-[#0b0b0f]/65 to-transparent" />
      <div className="relative z-10 flex min-h-screen flex-col xl:flex-row">
        <aside className="border-b border-[#262626] bg-[#0f1117]/94 px-4 py-4 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04),20px_0_70px_rgba(0,0,0,0.22)] backdrop-blur-2xl xl:sticky xl:top-0 xl:h-screen xl:w-[16.5rem] xl:border-b-0 xl:border-r xl:px-4 xl:py-4">
          <Link
            href="/admin"
            className="flex h-16 items-center gap-3 rounded-[1.35rem] border border-[#262626] bg-white/[0.045] px-3.5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] transition duration-300 hover:border-purple-300/22 hover:bg-white/[0.065]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-[#7c3aed] text-[11px] font-black tracking-[0.16em] text-white shadow-[0_12px_34px_rgba(124,58,237,0.18)]">
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
          <header className="sticky top-3 z-30 mb-5 flex min-h-[4.25rem] flex-col gap-3 rounded-[1.35rem] border border-[#262626] bg-[#0f1117]/92 p-2.5 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl lg:flex-row lg:items-center lg:justify-between">
            {headerActions ? (
              <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h1 className="text-[1.65rem] font-semibold leading-none tracking-[-0.035em] text-white md:text-[2rem]">
                    {title}
                  </h1>
                  <p className="mt-1.5 text-[13px] text-zinc-500">{subtitle}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {headerActions}
                </div>
              </div>
            ) : (
              <AdminGlobalSearch />
            )}

            <div className="flex items-center gap-2">
              <Link
                href="/admin/logs"
                className="relative flex h-10 w-10 items-center justify-center rounded-[0.95rem] border border-[#262626] bg-white/[0.045] text-zinc-300 shadow-inner shadow-white/[0.025] transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/28 hover:bg-white/[0.075] hover:text-white"
                aria-label="Admin notifications"
              >
                <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-purple-300 shadow-[0_0_10px_rgba(216,180,254,0.45)]" />
                <Bell className="h-4 w-4" />
              </Link>
              <details className="group relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2.5 rounded-[0.95rem] border border-[#262626] bg-white/[0.045] px-2 shadow-inner shadow-white/[0.025] transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/28 hover:bg-white/[0.075]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7c3aed] text-[10px] font-black tracking-[0.12em] text-white">
                    {initials}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-44 truncate text-[13px] font-semibold text-white">
                      {email}
                    </span>
                    <span className="text-[11px] text-zinc-500">{role}</span>
                  </span>
                </summary>
                <div className="absolute right-0 top-14 z-40 w-72 rounded-[1.45rem] border border-[#262626] bg-[#0f1117]/98 p-4 shadow-2xl shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Signed in as
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold text-white">{email}</p>
                  <p className="mt-1 text-xs text-purple-100">{role}</p>
                  <div className="mt-4 grid gap-2">
                    <Link
                      href="/dashboard/settings"
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:border-purple-300/30 hover:text-white"
                    >
                      Account settings
                    </Link>
                    <Link
                      href="/admin/security"
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 transition hover:border-purple-300/30 hover:text-white"
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
          </header>

          {hidePageHeader ? null : (
            <div className="rounded-[2rem] border border-[#262626] bg-white/[0.045] p-6 shadow-2xl shadow-[0_28px_80px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-purple-200/80">
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
    <div className="mt-6 rounded-[1.75rem] border border-[#262626] bg-white/[0.045] p-8 shadow-2xl shadow-[0_24px_70px_rgba(0,0,0,0.26)] backdrop-blur-xl">
      <p className="text-sm font-semibold text-white">{section}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
        This admin module is not configured yet. It is intentionally empty until
        the required backend source, permissions model, and audit flow are
        implemented.
      </p>
    </div>
  );
}
