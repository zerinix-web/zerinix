"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, FileText, UserPlus } from "lucide-react";

type ActivityItem = {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "success" | "warning" | "error";
  createdAt: string;
  href?: string;
};

type NotificationSummary = {
  generatedAt: string;
  newUsers: ActivityItem[];
  reports: ActivityItem[];
  failedJobs: ActivityItem[];
};

export function AdminRealtimeNotifications({
  initialSummary,
  rangeKey,
  fromIso,
  toIso,
}: {
  initialSummary: NotificationSummary;
  rangeKey: string;
  fromIso: string;
  toIso: string;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [status, setStatus] = useState<"ready" | "refreshing" | "error">("ready");

  const refresh = useCallback(async () => {
    setStatus("refreshing");

    try {
      const params = new URLSearchParams({
        range: rangeKey,
        from: fromIso,
        to: toIso,
      });
      const response = await fetch(`/api/admin/notifications?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Notifications unavailable");
      }

      const payload = (await response.json()) as { notifications?: NotificationSummary };

      if (payload.notifications) {
        setSummary(payload.notifications);
      }

      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [fromIso, rangeKey, toIso]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const groups = [
    {
      label: "New users",
      count: summary.newUsers.length,
      href: "/admin/users",
      icon: UserPlus,
      className: "border-purple-300/25 bg-purple-400/10 text-purple-100",
    },
    {
      label: "Reports",
      count: summary.reports.length,
      href: "/admin/reports",
      icon: FileText,
      className: "border-sky-300/20 bg-sky-950/20 text-sky-100",
    },
    {
      label: "Failed jobs",
      count: summary.failedJobs.length,
      href: "/admin/logs",
      icon: AlertTriangle,
      className: "border-red-300/20 bg-red-950/20 text-red-100",
    },
  ];

  return (
    <section className="mt-5 rounded-[1.55rem] border border-white/10 bg-white/[0.055] p-5 shadow-[0_22px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-[1rem] border border-purple-300/20 bg-purple-400/10">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-purple-300/35" />
            <Bell className="relative h-5 w-5 text-purple-100" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-white">Realtime notifications</h2>
            <p className="mt-1 text-xs text-zinc-500">
              New users, reports, and failed jobs refresh every 60 seconds.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1 text-[11px] text-zinc-500">
          {status === "refreshing" ? "Refreshing..." : status === "error" ? "Retrying" : "Live"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
        {groups.map((group) => {
          const Icon = group.icon;

          return (
            <Link
              key={group.label}
              href={group.href}
              className="rounded-[1.2rem] border border-white/10 bg-white/[0.045] p-4 transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/28 hover:bg-white/[0.07]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-[0.95rem] border ${group.className}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-2xl font-semibold tracking-tight text-white">{group.count}</span>
              </div>
              <p className="mt-4 text-sm font-medium text-white">{group.label}</p>
              <p className="mt-1 text-xs text-zinc-500">Open related records</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
