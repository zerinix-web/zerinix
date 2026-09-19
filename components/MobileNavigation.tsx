"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bot,
  FileText,
  Folder,
  Home,
  UserRound,
} from "lucide-react";
import { dictionaries, type AppDictionary } from "@/app/lib/i18n/dictionaries";

// TASK -- Mobile V1 Home: the bottom-nav labels for this first tab and
// the "Ask" tab use their own dedicated `nav.mobileHome`/`nav.mobileAsk`
// dictionary keys (added alongside the existing ones, every existing key
// left untouched) rather than reusing `nav.dashboard`/`nav.advisor` --
// those two ARE also read by the desktop sidebar
// (app/dashboard/DashboardSidebar.tsx), so changing their VALUE to
// "Home"/"Ask" would have silently relabeled the desktop sidebar too.
// The destination routes/match logic are completely unchanged.
function getMobileNavigationItems(labels: AppDictionary["nav"]) {
  return [
  {
    label: labels.mobileHome,
    href: "/dashboard",
    icon: Home,
    match: (pathname: string) => pathname === "/dashboard",
  },
  {
    label: labels.reports,
    href: "/dashboard/reports",
    icon: FileText,
    match: (pathname: string) =>
      pathname.startsWith("/dashboard/reports") ||
      (pathname.startsWith("/dashboard/") &&
        !pathname.startsWith("/dashboard/workspaces") &&
        !pathname.startsWith("/dashboard/settings") &&
        !pathname.startsWith("/dashboard/billing") &&
        !pathname.startsWith("/dashboard/usage") &&
        !pathname.startsWith("/dashboard/advisor")),
  },
  {
    label: labels.workspace,
    href: "/dashboard/workspaces",
    icon: Folder,
    match: (pathname: string) => pathname.startsWith("/dashboard/workspaces"),
  },
  {
    label: labels.mobileAsk,
    href: "/dashboard/advisor",
    icon: Bot,
    match: (pathname: string) =>
      pathname.startsWith("/chat") || pathname.startsWith("/dashboard/advisor"),
  },
  {
    label: labels.account,
    href: "/dashboard/settings",
    icon: UserRound,
    match: (pathname: string) =>
      pathname.startsWith("/dashboard/settings") ||
      pathname.startsWith("/dashboard/billing") ||
      pathname.startsWith("/dashboard/usage"),
  },
  ];
}

function getMobileTitle(pathname: string, labels: AppDictionary["nav"]) {
  if (pathname.startsWith("/chat")) {
    return labels.advisor;
  }

  if (pathname.startsWith("/plan")) {
    return labels.createStrategicReport;
  }

  if (pathname.startsWith("/dashboard/workspaces")) {
    return labels.workspace;
  }

  if (pathname.startsWith("/dashboard/reports")) {
    return labels.reports;
  }

  if (pathname.startsWith("/dashboard/advisor")) {
    return labels.advisor;
  }

  if (pathname.startsWith("/dashboard/settings")) {
    return labels.account;
  }

  if (pathname.startsWith("/dashboard/billing")) {
    return labels.billing;
  }

  if (pathname.startsWith("/dashboard/usage")) {
    return labels.usage;
  }

  if (pathname.startsWith("/dashboard/")) {
    return labels.reports;
  }

  return labels.dashboard;
}

export function MobileHeader({
  labels,
}: {
  labels?: AppDictionary;
}) {
  const pathname = usePathname();
  const activeLabels = labels || dictionaries.en;

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
              {activeLabels.common.brandSubtitle}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            aria-label="Go to dashboard home"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs font-semibold text-zinc-300 shadow-lg shadow-black/10 transition hover:border-teal-300/25 hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/35"
          >
            {getMobileTitle(pathname, activeLabels.nav)}
          </Link>
        </div>
      </div>
    </header>
  );
}

// Safe-area ownership for every mobile screen that sits under the fixed
// MobileBottomNavigation. Exported from this file because this is where the
// navigation itself is defined, so the reserved height can never drift from
// the thing it reserves for.
//
// Rules, applied exactly once each:
//   - MOBILE_SAFE_AREA_TOP goes on a screen's topmost element. These routes
//     render no shared header (DashboardSidebar only renders MobileHeader
//     when showMobileNavigation is set, which these pages do not do), so the
//     screen root is the top boundary and owns the status-bar inset.
//   - MOBILE_NAV_CLEARANCE goes on the same screen root. 4.75rem is this
//     navigation's own composition below (pt-2 + p-1.5 twice + min-h-14),
//     and the env() term is the home-indicator inset the navigation itself
//     adds -- so the screen reserves the real height, never a guess.
//   - The navigation's own pb-[max(0.65rem,env(safe-area-inset-bottom))]
//     below is the ONLY place the bottom inset is consumed for the bar.
//
// On web and desktop every env() term resolves to 0, so spacing collapses
// back to the plain rem values.
// The arithmetic lives HERE, in the declaration, and --zx-status-bar supplies
// only a terminal length. The reverse -- a --zx-safe-area-top variable holding
// calc(1.25rem + var(--zx-status-bar)), consumed as pt-[var(--zx-safe-area-top)]
// -- is what shipped before, and it computed to 0px on a physical iPhone while
// the same expression written literally computed to 82px (see app/globals.css).
// The inset itself is still defined once, centrally; only the addition moved.
export const MOBILE_SAFE_AREA_TOP = "pt-[calc(1.25rem+var(--zx-status-bar))]";
// Mirrors the navigation's real height exactly: 4.75rem of rows/padding plus
// --zx-home-indicator, which is the very same max(0.65rem, env(...)) the bar
// applies to itself below. One definition, so the reservation cannot drift
// from the bar it reserves for, on any device.
export const MOBILE_NAV_CLEARANCE =
  "pb-[calc(4.75rem+var(--zx-home-indicator))]";
// The tail of a scroll container whose last card should come to rest CLEAR of
// the bar rather than flush against its top edge: the same reservation plus a
// 1.5rem reading gap. Two rules govern it, both learned from device
// measurements:
//   - It goes on an in-flow CHILD of the scroller, never on the scroll
//     container itself: WebKit leaves a scroll container's own padding-bottom
//     out of its scrollable overflow, so there it adds no reachable range.
//   - The calc() lives in the class; --zx-home-indicator supplies only a
//     terminal length. A calc()-valued custom property consumed through var()
//     computes to 0 on iOS WebKit (see app/globals.css).
// Written out in full because Tailwind only sees literal class strings; a
// composed template literal would never be generated. Tests pin it to
// MOBILE_NAV_CLEARANCE so the two can never drift apart.
export const MOBILE_SCROLLER_TAIL =
  "pb-[calc(1.5rem+4.75rem+var(--zx-home-indicator))]";

export function MobileBottomNavigation({
  labels,
}: {
  labels?: AppDictionary["nav"];
}) {
  const pathname = usePathname();
  const mobileNavigationItems = getMobileNavigationItems(labels || dictionaries.en.nav);

  return (
    <nav
      aria-label="Mobile navigation"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-black/75 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.35)] backdrop-blur-2xl lg:hidden"
    >
      <div className="pointer-events-auto mx-auto grid max-w-md grid-cols-5 gap-1 rounded-[1.45rem] border border-white/[0.08] bg-white/[0.035] p-1.5 shadow-xl shadow-black/25 ring-1 ring-white/[0.02]">
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
                  ? "border border-teal-200/25 bg-teal-200/[0.12] text-teal-100 shadow-[0_0_16px_-6px_rgba(45,212,191,0.45)]"
                  : "border border-transparent text-zinc-500 active:bg-white/[0.06] active:text-white"
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
    <div className={`${MOBILE_NAV_CLEARANCE} lg:pb-0 ${className}`}>
      {children}
    </div>
  );
}
