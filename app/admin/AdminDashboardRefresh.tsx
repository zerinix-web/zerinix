"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const REFRESH_GUARD_TIMEOUT_MS = 25_000;

export function AdminDashboardRefresh() {
  const router = useRouter();
  const timerRef = useRef<number | null>(null);
  const guardTimerRef = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  const [isPending, startTransition] = useTransition();

  const clearGuardTimer = useCallback(() => {
    if (guardTimerRef.current) {
      window.clearTimeout(guardTimerRef.current);
      guardTimerRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refreshDashboard = useCallback(() => {
    if (refreshingRef.current || document.visibilityState === "hidden") {
      return;
    }

    refreshingRef.current = true;
    clearGuardTimer();
    guardTimerRef.current = window.setTimeout(() => {
      refreshingRef.current = false;
      guardTimerRef.current = null;
      console.warn("[admin:auto-refresh] refresh guard released after timeout");
    }, REFRESH_GUARD_TIMEOUT_MS);

    startTransition(() => {
      router.refresh();
    });
  }, [clearGuardTimer, router]);

  useEffect(() => {
    if (!isPending) {
      refreshingRef.current = false;
      clearGuardTimer();
    }
  }, [clearGuardTimer, isPending]);

  useEffect(() => {
    const startTimer = () => {
      clearTimer();

      if (document.visibilityState === "hidden") {
        return;
      }

      timerRef.current = window.setInterval(refreshDashboard, AUTO_REFRESH_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }

      startTimer();
    };

    startTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimer();
      clearGuardTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearGuardTimer, clearTimer, refreshDashboard]);

  return (
    <button
      type="button"
      onClick={refreshDashboard}
      disabled={isPending}
      aria-busy={isPending}
      className="inline-flex h-9 items-center gap-2 rounded-[0.85rem] border border-white/10 bg-black/25 px-3 text-[11px] font-semibold text-zinc-300 transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/30 hover:bg-white/[0.065] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200/30 disabled:cursor-wait disabled:opacity-70"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
      Refresh
    </button>
  );
}
