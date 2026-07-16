import Link from "next/link";
import {
  Activity,
  Bot,
  ChevronRight,
  FileText,
  Folder,
  LayoutDashboard,
  LogOut,
  Plus,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import {
  MobileBottomNavigation,
  MobileHeader,
} from "@/components/MobileNavigation";
import { getRequestDictionary } from "@/app/lib/i18n/server";

export default async function DashboardSidebar() {
  const { locale, dictionary } = await getRequestDictionary();
  const navigationGroups = [
    {
      label: dictionary.nav.commandCenter,
      items: [{ label: dictionary.nav.dashboard, href: "/dashboard", icon: LayoutDashboard }],
    },
    {
      label: dictionary.nav.intelligence,
      items: [
        { label: dictionary.nav.createStrategicReport, href: "/plan?new=1&mode=plan", icon: Plus },
        { label: dictionary.nav.reports, href: "/dashboard#reports", icon: FileText },
        { label: dictionary.nav.workspaces, href: "/dashboard#workspaces", icon: Folder },
      ],
    },
    {
      label: dictionary.nav.advisor,
      items: [{ label: dictionary.nav.strategicAdvisory, href: "/chat", icon: Bot }],
    },
    {
      label: dictionary.nav.operations,
      items: [
        { label: dictionary.nav.billing, href: "/dashboard/billing", icon: WalletCards },
        { label: dictionary.nav.usage, href: "/dashboard/usage", icon: Activity },
      ],
    },
    {
      label: dictionary.nav.accountGroup,
      items: [{ label: dictionary.nav.account, href: "/dashboard/settings", icon: UserRound }],
    },
  ];

  return (
    <>
      <MobileHeader
        locale={locale}
        labels={dictionary}
      />
      <MobileBottomNavigation labels={dictionary.nav} />
      <aside className={`hidden ${dashboardTheme.sidebar} lg:sticky lg:top-0 lg:flex lg:min-h-screen lg:w-72 lg:flex-col lg:px-5 lg:py-6`}>
      <div className="hidden lg:block">
        <Link
          href="/dashboard"
          aria-label="Go to dashboard home"
          className="group flex items-center gap-3 rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-3 shadow-xl shadow-black/20 ring-1 ring-white/[0.025] transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.065] hover:shadow-2xl hover:shadow-teal-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[1.15rem] bg-white text-sm font-black tracking-[0.12em] text-black shadow-lg shadow-white/10">
            ZX
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold tracking-[0.14em] text-white">
              ZERINIX
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              {dictionary.common.brandSubtitle}
            </span>
          </span>
          <ChevronRight className="ml-auto h-4 w-4 text-zinc-700 transition group-hover:text-teal-200" />
        </Link>

        <div className="mt-4 rounded-[1.65rem] border border-teal-300/15 bg-teal-300/[0.055] p-4 shadow-xl shadow-teal-950/10 ring-1 ring-teal-200/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] border border-teal-200/20 bg-teal-200/10">
              <ShieldCheck className="h-5 w-5 text-teal-200" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {dictionary.common.secureWorkspace}
              </p>
              <p className="mt-1 text-xs text-teal-100/65">
                {dictionary.common.reportsAndDecisions}
              </p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 items-center gap-2 overflow-x-auto scrollbar-thin lg:mt-8 lg:block lg:space-y-5" aria-label="Dashboard navigation">
        {navigationGroups.map((group) => (
          <div key={group.label} className="contents lg:block lg:space-y-2">
            <p className="hidden px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-600 lg:block">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex min-h-12 shrink-0 items-center gap-3 rounded-[1.15rem] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300 shadow-sm shadow-black/10 ring-1 ring-white/[0.015] transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.065] hover:text-white hover:shadow-lg hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/40 lg:w-full"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-black/25 shadow-inner shadow-white/[0.02] transition duration-300 group-hover:border-teal-200/25 group-hover:bg-teal-200/10">
                    <Icon className="h-4 w-4 text-teal-200" />
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                  <ChevronRight className="ml-auto hidden h-4 w-4 text-zinc-700 transition group-hover:text-teal-200 lg:block" />
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <form action={signOut} className="ml-2 lg:ml-0 lg:mt-6">
        <button
          type="submit"
          className="flex min-h-12 items-center gap-3 rounded-[1.15rem] border border-white/10 bg-zinc-950/80 px-4 py-3 text-sm font-medium text-zinc-300 shadow-sm shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-red-300/30 hover:bg-red-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/30 lg:w-full"
        >
          <LogOut className="h-4 w-4 text-red-200" />
          <span className="whitespace-nowrap">{dictionary.common.logout}</span>
        </button>
      </form>
      </aside>
    </>
  );
}
