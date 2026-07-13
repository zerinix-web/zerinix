"use client";

import { AreaChart, Clock, TrendingDown, TrendingUp } from "lucide-react";

type ChartPoint = {
  label: string;
  value: number;
};

type ChartConfig = {
  title: string;
  data: ChartPoint[];
  valuePrefix?: string;
  unavailableLabel?: string;
  periodLabel?: string;
  featured?: boolean;
};

export type AdminChartsProps = {
  charts: ChartConfig[];
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function calculateTrend(data: ChartPoint[]) {
  const current = data.at(-1)?.value ?? 0;
  const previous = data.at(-2)?.value ?? 0;

  if (previous === 0 && current === 0) {
    return { label: "0%", direction: "flat" as const };
  }

  if (previous === 0) {
    return { label: "+100%", direction: "up" as const };
  }

  const change = ((current - previous) / previous) * 100;
  const direction = change < 0 ? "down" : change > 0 ? "up" : "flat";

  return {
    label: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
    direction,
  };
}

function TrendPill({ data }: { data: ChartPoint[] }) {
  const trend = calculateTrend(data);
  const Icon = trend.direction === "down" ? TrendingDown : TrendingUp;
  const className =
    trend.direction === "down"
      ? "border-red-300/20 bg-red-950/20 text-red-100"
      : trend.direction === "up"
        ? "border-purple-300/25 bg-purple-400/10 text-purple-100"
        : "border-white/10 bg-white/[0.04] text-zinc-400";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {trend.label}
    </span>
  );
}

function AnalyticsChart({
  title,
  data,
  valuePrefix = "",
  unavailableLabel = "No data available",
  periodLabel = "Selected range",
  featured = false,
}: ChartConfig) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const latest = data.at(-1)?.value ?? 0;
  const points = data
    .map((item, index) => {
      const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
      const y = 100 - (item.value / max) * 82 - 8;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className={`group rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.26)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/20 hover:bg-white/[0.06] ${featured ? "md:col-span-2 2xl:col-span-2" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-zinc-500">{periodLabel}</p>
        </div>
        {data.length ? <TrendPill data={data} /> : null}
      </div>

      {data.length ? (
        <>
          <div className="mt-5 flex items-end justify-between gap-4">
            <p className="text-2xl font-semibold tracking-tight text-white">
              {valuePrefix}
              {formatNumber(latest)}
            </p>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-zinc-500">
              <Clock className="h-3.5 w-3.5" />
              Last point
            </div>
          </div>

          <div className={`${featured ? "h-52" : "h-36"} mt-5 rounded-2xl border border-white/10 bg-black/20 p-3`} aria-label={`${title} live analytics chart`}>
            <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" role="img">
              <defs>
                <linearGradient id={`${title.replace(/\W+/g, "-")}-area`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgb(192 132 252)" stopOpacity="0.34" />
                  <stop offset="100%" stopColor="rgb(192 132 252)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <polyline
                fill={`url(#${title.replace(/\W+/g, "-")}-area)`}
                points={`0,100 ${points} 100,100`}
              />
              <polyline
                fill="none"
                stroke="rgb(216 180 254)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                points={points}
              />
              {data.map((item, index) => {
                const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
                const y = 100 - (item.value / max) * 82 - 8;

                return (
                  <circle
                    key={`${title}:point:${item.label}`}
                    cx={x}
                    cy={y}
                    r="2.6"
                    className="fill-black stroke-purple-200"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            {data.map((item) => (
              <span key={`${title}:label:${item.label}`}>{item.label}</span>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-black/25 p-5 text-sm text-zinc-500">
          <AreaChart className="mb-3 h-5 w-5 text-zinc-600" />
          {unavailableLabel}
        </div>
      )}
    </article>
  );
}

export function AdminCharts({ charts }: AdminChartsProps) {
  return (
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {charts.map((chart, index) => (
        <AnalyticsChart key={chart.title} {...chart} featured={index === 0} />
      ))}
    </div>
  );
}

export default AdminCharts;
