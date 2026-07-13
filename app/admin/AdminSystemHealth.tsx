"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type SystemStatus = {
  label: string;
  status: "Operational" | "Degraded" | "Down" | "Not configured" | "Unknown";
  detail: string;
  lastChecked: string;
  lastSuccessfulCheck: string | null;
  responseTimeMs: number | null;
};

export type AdminSystemHealthProps = {
  initialStatuses: SystemStatus[];
};

function statusClass(status: SystemStatus["status"]) {
  if (status === "Operational") {
    return "border-teal-300/20 bg-teal-300/10 text-teal-100";
  }

  if (status === "Degraded" || status === "Unknown") {
    return "border-amber-300/20 bg-amber-950/20 text-amber-100";
  }

  if (status === "Down") {
    return "border-red-300/20 bg-red-950/20 text-red-100";
  }

  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function dotClass(status: SystemStatus["status"]) {
  if (status === "Operational") {
    return "bg-teal-300 shadow-[0_0_18px_rgba(45,212,191,0.5)]";
  }

  if (status === "Degraded" || status === "Unknown") {
    return "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.42)]";
  }

  if (status === "Down") {
    return "bg-red-300 shadow-[0_0_18px_rgba(252,165,165,0.42)]";
  }

  return "bg-zinc-500";
}

function formatTime(value: string | null) {
  if (!value) {
    return "No successful check";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatResponseTime(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return `${Math.max(0, Math.round(value))} ms`;
}

export function AdminSystemHealth({ initialStatuses }: AdminSystemHealthProps) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString());

  const refreshHealth = useCallback(async () => {
    setRefreshing(true);

    try {
      const response = await fetch("/api/admin/health", {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { status?: SystemStatus[] };

      if (Array.isArray(payload.status)) {
        setStatuses(payload.status);
        setLastRefresh(new Date().toISOString());
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  return (
    <section className="mt-5 rounded-[1.55rem] border border-white/10 bg-white/[0.055] p-5 shadow-[0_22px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-white">System Health</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Auto-refreshes every 60 seconds using cached server-side checks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refreshHealth();
          }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.95rem] border border-white/10 bg-white/[0.045] px-3.5 text-xs text-zinc-300 transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/30 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {statuses.map((item) => (
          <div key={item.label} className="rounded-[1.2rem] border border-white/10 bg-white/[0.045] p-4 transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/18 hover:bg-white/[0.07]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${dotClass(item.status)}`} />
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotClass(item.status)}`} />
                </span>
                <p className="text-sm font-medium text-white">{item.label}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] ${statusClass(item.status)}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{item.detail}</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
                <p className="text-zinc-600">Response</p>
                <p className="mt-1 font-medium text-zinc-300">{formatResponseTime(item.responseTimeMs)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
                <p className="text-zinc-600">Success</p>
                <p className="mt-1 font-medium text-zinc-300">{formatTime(item.lastSuccessfulCheck)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-600">Last successful dashboard check {formatTime(lastRefresh)}</p>
    </section>
  );
}
