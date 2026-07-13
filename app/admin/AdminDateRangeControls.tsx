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
  variant = "section",
}: {
  activeRange: string;
  fromIso: string;
  toIso: string;
  variant?: "section" | "inline";
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

  const controls = (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="flex rounded-[0.95rem] border border-[#2a303b] bg-[#1a1f29] p-1 shadow-inner shadow-white/[0.025]">
        {ranges.map((range) => (
          <button
            key={range.key}
            type="button"
            onClick={() => updateRange(range.key)}
            className={`rounded-[0.72rem] px-3 py-1.5 text-[11px] font-semibold transition duration-300 ${
              activeRange === range.key
                ? "bg-[#f5f7fb] text-black shadow-[0_10px_30px_rgba(255,255,255,0.10)]"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className={`${variant === "inline" && activeRange !== "custom" ? "hidden" : "flex"} flex-wrap items-center gap-2`}>
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-9 rounded-[0.8rem] border border-[#2a303b] bg-[#1a1f29] px-2.5 text-[11px] text-white outline-none transition focus:border-purple-300/35"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-9 rounded-[0.8rem] border border-[#2a303b] bg-[#1a1f29] px-2.5 text-[11px] text-white outline-none transition focus:border-purple-300/35"
        />
        <button
          type="button"
          onClick={() => updateRange("custom", from, to)}
          className="h-9 rounded-[0.8rem] border border-purple-400/20 bg-purple-400/10 px-3 text-[11px] font-semibold text-purple-100 transition duration-300 hover:-translate-y-0.5 hover:bg-purple-400/15"
        >
          Apply custom
        </button>
      </div>
    </div>
  );

  if (variant === "inline") {
    return controls;
  }

  return (
    <section className="mt-6 rounded-[1.55rem] border border-[#252b36] bg-[#151922] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
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

        {controls}
      </div>
    </section>
  );
}
