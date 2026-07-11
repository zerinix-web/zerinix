import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CreditCard,
  FileText,
  Headphones,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Receipt,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Reports", href: "/admin/reports", icon: FileText },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: Receipt },
  { label: "Payments", href: "/admin/payments", icon: CreditCard },
  { label: "AI Usage", href: "/admin/ai-usage", icon: Activity },
  { label: "Usage & Quotas", href: "/admin/usage-quotas", icon: SlidersHorizontal },
  { label: "Support", href: "/admin/support", icon: Headphones },
  { label: "Logs", href: "/admin/logs", icon: BarChart3 },
  { label: "Security", href: "/admin/security", icon: LockKeyhole },
  { label: "API Management", href: "/admin/api-management", icon: KeyRound },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

export function AdminShell({
  children,
  eyebrow,
  title,
  subtitle,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.13),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col xl:flex-row">
        <aside className="border-b border-white/10 bg-black/75 px-4 py-4 backdrop-blur-2xl xl:sticky xl:top-0 xl:h-screen xl:w-80 xl:border-b-0 xl:border-r xl:px-5 xl:py-6">
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-3 shadow-2xl shadow-black/30 transition hover:border-teal-300/25 hover:bg-white/[0.065]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[1.1rem] bg-white text-xs font-black tracking-[0.16em] text-black">
              ZX
            </span>
            <span>
              <span className="block text-base font-bold tracking-[0.18em]">
                ZERINIX
              </span>
              <span className="text-xs text-zinc-500">Admin control plane</span>
            </span>
          </Link>

          <div className="mt-4 rounded-[1.5rem] border border-teal-300/15 bg-teal-300/[0.055] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                <ShieldCheck className="h-5 w-5 text-teal-200" />
              </span>
              <div>
                <p className="text-sm font-semibold">Server protected</p>
                <p className="mt-1 text-xs text-teal-100/65">
                  Admin role required
                </p>
              </div>
            </div>
          </div>

          <nav className="mt-5 flex gap-2 overflow-x-auto pb-2 xl:block xl:space-y-1 xl:overflow-visible xl:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-teal-300/25 hover:bg-white/[0.065] hover:text-white xl:w-full"
                >
                  <Icon className="h-4 w-4 text-teal-200" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="flex-1 px-5 py-6 sm:px-8 xl:px-10 xl:py-9">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-200/70">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400 md:text-base">
              {subtitle}
            </p>
          </div>

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
