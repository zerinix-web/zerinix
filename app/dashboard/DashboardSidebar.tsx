import Link from "next/link";
import {
  Activity,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";

export default function DashboardSidebar() {
  const items = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "New Report", href: "/plan", icon: Plus },
    { label: "Usage", href: "/dashboard/usage", icon: Activity },
  ];

  return (
    <aside className="flex border-b border-white/10 bg-black/85 px-4 py-4 backdrop-blur-2xl lg:sticky lg:top-0 lg:min-h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:border-white/10 lg:px-5 lg:py-6">
      <div className="hidden lg:block">
        <Link
          href="/"
          className="group flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3 transition duration-200 hover:border-teal-300/25 hover:bg-teal-300/[0.06]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black tracking-[0.12em] text-black">
            ZX
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold tracking-[0.14em] text-white">
              ZERINIX
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              AI operating system
            </span>
          </span>
          <ChevronRight className="ml-auto h-4 w-4 text-zinc-700 transition group-hover:text-teal-200" />
        </Link>

        <div className="mt-4 rounded-3xl border border-teal-300/15 bg-teal-300/[0.055] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
              <ShieldCheck className="h-5 w-5 text-teal-200" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Secure workspace</p>
              <p className="mt-1 text-xs text-teal-100/65">Reports and AI history</p>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 items-center gap-2 overflow-x-auto scrollbar-thin lg:mt-8 lg:block lg:space-y-2">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300 transition duration-200 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10 hover:text-white lg:w-full"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-black/25 transition group-hover:border-teal-200/25 group-hover:bg-teal-200/10">
                <Icon className="h-4 w-4 text-teal-200" />
              </span>
              <span>{item.label}</span>
              <ChevronRight className="ml-auto hidden h-4 w-4 text-zinc-700 transition group-hover:text-teal-200 lg:block" />
            </Link>
          );
        })}
      </nav>

      <form action={signOut} className="ml-2 lg:ml-0 lg:mt-6">
        <button
          type="submit"
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-300 transition duration-200 hover:border-red-300/30 hover:bg-red-950/30 hover:text-white lg:w-full"
        >
          <LogOut className="h-4 w-4 text-red-200" />
          Logout
        </button>
      </form>
    </aside>
  );
}
