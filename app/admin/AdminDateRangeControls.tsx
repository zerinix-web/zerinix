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
    <section className="mt-6 rounded-[1.55rem] border border-white/10 bg-white/[0.055] p-5 shadow-[0_22px_90px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[1rem] border border-purple-300/20 bg-purple-400/10">
            <CalendarDays className="h-5 w-5 text-purple-100" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-white">Dashboard range</h2>
            <p className="mt-1 text-xs text-zinc-500">Every metric, table, and chart refreshes from this window.</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex rounded-[1.05rem] border border-white/10 bg-white/[0.045] p-1 shadow-inner shadow-white/[0.03]">
            {ranges.map((range) => (
              <button
                key={range.key}
                type="button"
                onClick={() => updateRange(range.key)}
                className={`rounded-[0.8rem] px-3.5 py-2 text-xs font-semibold transition duration-300 ${
                  activeRange === range.key
                    ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)]"
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
              className="h-10 rounded-[0.9rem] border border-white/10 bg-white/[0.045] px-3 text-xs text-white outline-none transition focus:border-purple-300/35"
            />
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 rounded-[0.9rem] border border-white/10 bg-white/[0.045] px-3 text-xs text-white outline-none transition focus:border-purple-300/35"
            />
            <button
              type="button"
              onClick={() => updateRange("custom", from, to)}
              className="h-10 rounded-[0.9rem] border border-purple-300/25 bg-purple-400/10 px-3.5 text-xs font-semibold text-purple-100 transition duration-300 hover:-translate-y-0.5 hover:bg-purple-400/15"
            >
              Apply custom
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
