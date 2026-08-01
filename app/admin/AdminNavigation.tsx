"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  CreditCard,
  FileText,
  Headphones,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  Receipt,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";

const navGroups = [
  {
    label: "Command",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "AI CEO", href: "/admin/ai-ceo", icon: Bot },
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Reports", href: "/admin/reports", icon: FileText },
    ],
  },
  {
    label: "Revenue",
    items: [
      { label: "Subscriptions", href: "/admin/subscriptions", icon: Receipt },
      { label: "Payments", href: "/admin/payments", icon: CreditCard },
      { label: "Financial Dashboard", href: "/admin/financial-dashboard", icon: Landmark },
      { label: "AI Usage", href: "/admin/ai-usage", icon: Activity },
      { label: "Usage & Quotas", href: "/admin/usage-quotas", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Support", href: "/admin/support", icon: Headphones },
      { label: "Logs", href: "/admin/logs", icon: BarChart3 },
      { label: "Security", href: "/admin/security", icon: LockKeyhole },
      { label: "API Management", href: "/admin/api-management", icon: KeyRound },
      { label: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav className="mt-5 flex gap-3 overflow-x-auto pb-2 xl:block xl:space-y-5 xl:overflow-visible xl:pb-0">
      {navGroups.map((group) => (
        <div key={group.label} className="min-w-max xl:min-w-0">
          <p className="mb-2 hidden px-3 text-[9px] font-semibold uppercase tracking-[0.24em] text-zinc-500/75 xl:block">
            {group.label}
          </p>
          <div className="flex gap-2 xl:block xl:space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex h-[2.65rem] shrink-0 items-center gap-2.5 rounded-[1rem] px-2.5 text-[13px] font-medium transition duration-300 xl:w-full ${
                    active
                      ? "border border-teal-300/25 bg-teal-300/[0.055] text-white shadow-xl shadow-teal-950/10"
                      : `border border-transparent text-zinc-400 ${dashboardTheme.hoverSurface} hover:text-white`
                  }`}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 hidden h-7 w-1 -translate-y-1/2 rounded-r-full bg-teal-300 shadow-[0_0_18px_rgba(45,212,191,0.45)] xl:block" />
                  ) : null}
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-[0.75rem] transition duration-300 ${
                      active
                        ? "border border-teal-200/20 bg-teal-200/10 text-teal-200"
                        : "border border-white/10 bg-black/25 text-zinc-300 group-hover:border-teal-200/25 group-hover:bg-teal-200/10 group-hover:text-teal-200"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
