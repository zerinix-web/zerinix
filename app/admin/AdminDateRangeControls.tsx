"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";

const ranges = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "custom", label: "Custom" },
];

export function AdminDateRangeControls({
  activeRange,
  fromIso,
  toIso,
}: {
  activeRange: string;
  fromIso: string;
  toIso: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(fromIso.slice(0, 10));
  const [to, setTo] = useState(toIso.slice(0, 10));

  function updateRange(range: string, customFrom = from, customTo = to) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);

    if (range === "custom") {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.delete("from");
      params.delete("to");
    }

    router.push(`/admin?${params.toString()}`);
  }

  return (
    <section className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
            <CalendarDays className="h-5 w-5 text-teal-100" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Dashboard range</h2>
            <p className="text-xs text-zinc-500">Every metric, table, and chart refreshes from this window.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex rounded-2xl border border-white/10 bg-black/25 p-1">
            {ranges.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => updateRange(range.key)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  activeRange === range.key
                    ? "bg-white text-black"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white outline-none focus:border-teal-300/35"
            />
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white outline-none focus:border-teal-300/35"
            />
            <button
              type="button"
              onClick={() => updateRange("custom", from, to)}
              className="h-10 rounded-xl border border-teal-300/25 bg-teal-300/10 px-3 text-xs font-semibold text-teal-100 transition hover:bg-teal-300/15"
            >
              Apply custom
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
