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
  LayoutDashboard,
  LockKeyhole,
  Receipt,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

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
    <nav className="mt-5 flex gap-3 overflow-x-auto pb-2 xl:block xl:space-y-6 xl:overflow-visible xl:pb-0">
      {navGroups.map((group) => (
        <div key={group.label} className="min-w-max xl:min-w-0">
          <p className="mb-2.5 hidden px-3 text-[9px] font-semibold uppercase tracking-[0.26em] text-zinc-600 xl:block">
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
                  className={`group relative flex h-11 shrink-0 items-center gap-3 rounded-[1.05rem] px-3 text-[13px] font-medium transition duration-300 xl:w-full ${
                    active
                      ? "border border-purple-300/25 bg-[linear-gradient(135deg,rgba(168,85,247,0.18),rgba(255,255,255,0.055))] text-white shadow-[0_18px_60px_rgba(168,85,247,0.15)]"
                      : "border border-transparent text-zinc-400 hover:-translate-y-0.5 hover:border-white/10 hover:bg-white/[0.045] hover:text-white"
                  }`}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 hidden h-7 w-1 -translate-y-1/2 rounded-r-full bg-purple-300 shadow-[0_0_20px_rgba(216,180,254,0.6)] xl:block" />
                  ) : null}
                  <span
                    className={`flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-[0.85rem] transition duration-300 ${
                      active
                        ? "bg-purple-300 text-black"
                        : "bg-white/[0.045] text-purple-200 group-hover:bg-purple-300/10"
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
