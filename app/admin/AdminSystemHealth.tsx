"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type SystemStatus = {
  label: string;
  status: "Healthy" | "Degraded" | "Down" | "Not Connected" | "Unknown";
  detail: string;
  lastChecked: string;
  lastSuccessfulCheck: string | null;
  responseTimeMs: number | null;
};

export type AdminSystemHealthProps = {
  initialStatuses: SystemStatus[];
};

function statusClass(status: SystemStatus["status"]) {
  if (status === "Healthy") {
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
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
  if (status === "Healthy") {
    return "bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.45)]";
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

function statusLabel(status: SystemStatus["status"]) {
  return status;
}

export function AdminSystemHealth({ initialStatuses }: AdminSystemHealthProps) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(
    initialStatuses.find((item) => item.lastChecked)?.lastChecked || ""
  );

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
    } catch {
      console.warn("[admin:system-health] refresh failed; keeping previous status");
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
    <section className="mt-5 h-full min-h-[21rem] rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl lg:col-span-2 min-[1440px]:col-span-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-white">System Status</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">Service health overview.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void refreshHealth();
          }}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-[0.85rem] border border-white/10 bg-black/25 px-3 text-[11px] text-zinc-300 transition duration-300 hover:-translate-y-0.5 hover:border-emerald-300/25 hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/30 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-5 overflow-hidden rounded-[1.15rem] border border-white/10 bg-black/25">
        {statuses.map((item) => (
          <div
            key={item.label}
            title={item.detail}
            className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 transition duration-200 last:border-b-0 hover:bg-white/[0.035]"
          >
            <div className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${dotClass(item.status)}`} />
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotClass(item.status)}`} />
                </span>
              <p className="truncate text-sm font-medium text-white">{item.label}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClass(item.status)}`}>
              {statusLabel(item.status)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-600">Last successful check {formatTime(lastRefresh)}</p>
    </section>
  );
}
