import Link from "next/link";
import {
  Activity,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";

export default function DashboardSidebar() {
  const items = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "New Report", href: "/plan", icon: Plus },
    { label: "Usage", href: "/dashboard/usage", icon: Activity },
    { label: "Settings", href: "/dashboard#settings", icon: Settings },
  ];

  return (
    <aside className="flex border-b border-white/10 bg-black/80 px-4 py-4 backdrop-blur-xl lg:min-h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <div className="hidden lg:block">
        <Link href="/" className="text-2xl font-bold tracking-[0.12em] text-white">
          ZERINIX
        </Link>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          AI işletim sistemi
        </p>
      </div>

      <nav className="flex flex-1 items-center gap-2 overflow-x-auto lg:mt-10 lg:block lg:space-y-2">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-teal-300/30 hover:bg-teal-300/10 hover:text-white"
            >
              <Icon className="h-4 w-4 text-teal-200" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={signOut} className="ml-2 lg:ml-0 lg:mt-6">
        <button
          type="submit"
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-red-300/30 hover:bg-red-950/30 hover:text-white"
        >
          <LogOut className="h-4 w-4 text-red-200" />
          Logout
        </button>
      </form>
    </aside>
  );
}
