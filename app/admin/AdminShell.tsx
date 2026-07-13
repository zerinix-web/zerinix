import Link from "next/link";
import type { ReactNode } from "react";
import {
  Bell,
  Settings,
  ShieldCheck,
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
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  hidePageHeader?: boolean;
}) {
  const admin = await requireAdminPage();
  const email = admin.user.email || "Admin user";
  const role = formatRole(admin.role);
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <main className="min-h-screen bg-[#030305] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.20),transparent_32%),radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.12),transparent_30%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />
      <div className="relative z-10 flex min-h-screen flex-col xl:flex-row">
        <aside className="border-b border-white/10 bg-black/70 px-4 py-4 backdrop-blur-2xl xl:sticky xl:top-0 xl:h-screen xl:w-80 xl:border-b-0 xl:border-r xl:px-5 xl:py-6">
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-3 shadow-2xl shadow-black/30 transition duration-300 hover:border-purple-300/25 hover:bg-white/[0.065]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[1.1rem] bg-gradient-to-br from-white to-purple-200 text-xs font-black tracking-[0.16em] text-black shadow-[0_0_42px_rgba(168,85,247,0.24)]">
              ZX
            </span>
            <span>
              <span className="block text-base font-bold tracking-[0.18em]">
                ZERINIX
              </span>
              <span className="text-xs text-zinc-500">Admin control plane</span>
            </span>
          </Link>

          <div className="mt-4 rounded-[1.5rem] border border-purple-300/15 bg-purple-400/[0.07] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-purple-200/20 bg-purple-200/10">
                <ShieldCheck className="h-5 w-5 text-purple-100" />
              </span>
              <div>
                <p className="text-sm font-semibold">Server protected</p>
                <p className="mt-1 text-xs text-purple-100/70">
                  Admin role required
                </p>
              </div>
            </div>
          </div>

          <AdminNavigation />
        </aside>

        <section className="flex-1 px-5 py-6 sm:px-8 xl:px-10 xl:py-8">
          <header className="mb-6 flex flex-col gap-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-3 shadow-2xl shadow-black/25 backdrop-blur-2xl lg:flex-row lg:items-center lg:justify-between">
            <AdminGlobalSearch />

            <div className="flex items-center gap-3">
              <Link
                href="/admin/logs"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-zinc-300 transition duration-300 hover:border-purple-300/30 hover:text-white"
                aria-label="Admin notifications"
              >
                <Bell className="h-4 w-4" />
              </Link>
              <Link
                href="/admin/settings"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-zinc-300 transition duration-300 hover:border-purple-300/30 hover:text-white"
                aria-label="Admin settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 transition duration-300 hover:border-purple-300/30">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-200 text-xs font-black tracking-[0.12em] text-black">
                    {initials}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-48 truncate text-sm font-semibold text-white">
                      {email}
                    </span>
                    <span className="text-xs text-zinc-500">{role}</span>
                  </span>
                </summary>
                <div className="absolute right-0 top-14 z-40 w-72 rounded-3xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-2xl">
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
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-8">
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
    <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-8 shadow-2xl shadow-black/25 backdrop-blur-xl">
      <p className="text-sm font-semibold text-white">{section}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
        This admin module is not configured yet. It is intentionally empty until
        the required backend source, permissions model, and audit flow are
        implemented.
      </p>
    </div>
  );
}
