"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  FileText,
  Folder,
  LayoutDashboard,
  UserRound,
} from "lucide-react";

const mobileNavigationItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    match: (pathname: string) => pathname === "/dashboard",
  },
  {
    label: "Reports",
    href: "/dashboard#reports",
    icon: FileText,
    match: (pathname: string) =>
      pathname.startsWith("/dashboard/") &&
      !pathname.startsWith("/dashboard/workspaces") &&
      !pathname.startsWith("/dashboard/settings") &&
      !pathname.startsWith("/dashboard/billing") &&
      !pathname.startsWith("/dashboard/usage"),
  },
  {
    label: "Workspace",
    href: "/dashboard#workspaces",
    icon: Folder,
    match: (pathname: string) => pathname.startsWith("/dashboard/workspaces"),
  },
  {
    label: "Advisor",
    href: "/chat",
    icon: Bot,
    match: (pathname: string) => pathname.startsWith("/chat"),
  },
  {
    label: "Account",
    href: "/dashboard/settings",
    icon: UserRound,
    match: (pathname: string) =>
      pathname.startsWith("/dashboard/settings") ||
      pathname.startsWith("/dashboard/billing") ||
      pathname.startsWith("/dashboard/usage"),
  },
];

function getMobileTitle(pathname: string) {
  if (pathname.startsWith("/chat")) {
    return "AI Advisor";
  }

  if (pathname.startsWith("/plan")) {
    return "Strategic Report";
  }

  if (pathname.startsWith("/dashboard/workspaces")) {
    return "Workspace";
  }

  if (pathname.startsWith("/dashboard/settings")) {
    return "Account";
  }

  if (pathname.startsWith("/dashboard/billing")) {
    return "Billing";
  }

  if (pathname.startsWith("/dashboard/usage")) {
    return "Usage";
  }

  if (pathname.startsWith("/dashboard/")) {
    return "Report";
  }

  return "Dashboard";
}

export function MobileHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-4 py-3 shadow-2xl shadow-black/25 backdrop-blur-2xl lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard"
          aria-label="Go to dashboard home"
          className="inline-flex items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-white text-xs font-black tracking-[0.12em] text-black shadow-lg shadow-white/10">
            ZX
          </span>
          <span>
            <span className="block text-sm font-bold tracking-[0.16em] text-white">
              ZERINIX
            </span>
            <span className="block text-[11px] text-zinc-500">
              Decision intelligence
            </span>
          </span>
        </Link>
        <div className="min-w-0 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs font-semibold text-zinc-300 shadow-lg shadow-black/10">
          {getMobileTitle(pathname)}
        </div>
      </div>
    </header>
  );
}

export function MobileBottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/90 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-black/50 backdrop-blur-2xl lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1 rounded-[1.45rem] border border-white/10 bg-white/[0.045] p-1.5 shadow-xl shadow-black/30 ring-1 ring-white/[0.025]">
        {mobileNavigationItems.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-[1.05rem] px-1 text-[10px] font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35 ${
                active
                  ? "bg-teal-200 text-black shadow-lg shadow-teal-950/20"
                  : "text-zinc-500 hover:bg-white/[0.065] hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobilePageContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`pb-28 lg:pb-0 ${className}`}>
      {children}
    </div>
  );
}
