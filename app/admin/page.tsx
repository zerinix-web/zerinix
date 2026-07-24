import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CircleDollarSign,
  DollarSign,
  Gauge,
  TrendingDown,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { AdminAnimatedValue, type AdminAnimatedValueFormat } from "./AdminAnimatedValue";
import { AdminDashboardRefresh } from "./AdminDashboardRefresh";
import { AdminDateRangeControls } from "./AdminDateRangeControls";
import { AdminExports } from "./AdminExports";
import { AdminShell } from "./AdminShell";
import { AdminSystemHealth } from "./AdminSystemHealth";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import {
  loadAdminDashboardData,
  resolveAdminDateRange,
  type AdminActivityItem,
  type AdminChartSeries,
  type AdminDashboardData,
  type AdminMetricStatus,
} from "./admin-data";

type Trend = {
  direction: "up" | "down" | "flat";
  label: string;
  period: "Last 24h" | "Last 7d";
};

type Accent = "green" | "blue" | "purple" | "amber" | "rose";

const accentStyles: Record<Accent, { icon: string; line: string; text: string; glow: string }> = {
  green: {
    icon: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
    line: "#34d399",
    text: "text-emerald-200",
    glow: "from-emerald-300/16",
  },
  blue: {
    icon: "border-blue-300/20 bg-blue-300/10 text-blue-200",
    line: "#60a5fa",
    text: "text-blue-200",
    glow: "from-blue-300/16",
  },
  purple: {
    icon: "border-purple-300/20 bg-purple-300/10 text-purple-200",
    line: "#8b5cf6",
    text: "text-purple-200",
    glow: "from-purple-300/18",
  },
  amber: {
    icon: "border-amber-300/20 bg-amber-300/10 text-amber-200",
    line: "#fbbf24",
    text: "text-amber-200",
    glow: "from-amber-300/16",
  },
  rose: {
    icon: "border-rose-300/20 bg-rose-300/10 text-rose-200",
    line: "#fb7185",
    text: "text-rose-200",
    glow: "from-rose-300/16",
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Not Connected";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "Not Connected" : `${value.toFixed(1)}%`;
}

type OverviewCardStatus = Extract<AdminMetricStatus, "LIVE" | "NOT CONNECTED" | "NO DATA">;

function overviewCardStatus(status: AdminMetricStatus): OverviewCardStatus {
  if (status === "LIVE" || status === "ESTIMATED") {
    return "LIVE";
  }

  if (status === "NOT CONNECTED") {
    return "NOT CONNECTED";
  }

  return "NO DATA";
}

function statusClass(status: OverviewCardStatus) {
  if (status === "LIVE") {
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  }

  if (status === "NO DATA") {
    return "border-zinc-500/20 bg-zinc-500/10 text-zinc-300";
  }

  return "border-amber-300/20 bg-amber-950/25 text-amber-100";
}

function StatusBadge({ status }: { status: AdminMetricStatus }) {
  const normalizedStatus = overviewCardStatus(status);

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusClass(normalizedStatus)}`}>
      {normalizedStatus}
    </span>
  );
}

function calculateTrend(
  series: Array<{ label: string; value: number }>,
  period: Trend["period"] = "Last 7d"
): Trend {
  const current = series.at(-1)?.value ?? 0;
  const previous = series.at(-2)?.value ?? 0;

  if (previous === 0 && current === 0) {
    return { direction: "flat", label: "0%", period };
  }

  if (previous === 0) {
    return { direction: "up", label: "+100%", period };
  }

  const change = ((current - previous) / previous) * 100;

  return {
    direction: change < 0 ? "down" : change > 0 ? "up" : "flat",
    label: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
    period,
  };
}

function trendClass(direction: Trend["direction"]) {
  if (direction === "down") {
    return "border-red-300/20 bg-red-950/20 text-red-100";
  }

  if (direction === "up") {
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  }

  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function Sparkline({
  data,
  color,
  label,
}: {
  data: AdminChartSeries[];
  color: string;
  label: string;
}) {
  const visibleData = data.length ? data.slice(-8) : [];
  const max = Math.max(1, ...visibleData.map((item) => item.value));
  const points = visibleData
    .map((item, index) => {
      const x = visibleData.length === 1 ? 50 : (index / (visibleData.length - 1)) * 100;
      const y = 92 - (item.value / max) * 70;

      return `${x},${y}`;
    })
    .join(" ");

  if (!visibleData.length) {
    return (
      <div className="flex h-12 items-center justify-end text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
        No data
      </div>
    );
  }

  return (
    <svg className="h-12 w-full overflow-visible" viewBox="0 0 100 100" role="img" aria-label={label}>
      <polyline
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
        points={points}
      />
    </svg>
  );
}

function ExecutiveKpiCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  status,
  trend,
  sparkline,
  animatedValue,
  valueFormat = "compactCurrency",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  accent: Accent;
  status: AdminMetricStatus;
  trend?: Trend;
  sparkline: AdminChartSeries[];
  animatedValue?: number;
  valueFormat?: AdminAnimatedValueFormat;
}) {
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;
  const accentStyle = accentStyles[accent];

  return (
    <article className={`group relative flex h-[14.25rem] min-w-0 flex-col overflow-hidden rounded-[1.5rem] p-[1.375rem] transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/20 hover:shadow-2xl hover:shadow-black/45 ${dashboardTheme.surface}`}>
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${accentStyle.glow} to-transparent opacity-45 transition duration-300 group-hover:opacity-65`} />
      <div className="relative flex items-start justify-between gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border shadow-lg shadow-black/20 ${accentStyle.icon}`}>
          <Icon className="h-[1.125rem] w-[1.125rem]" />
        </span>
        <span className="opacity-55 transition duration-300 group-hover:opacity-85">
          <StatusBadge status={status} />
        </span>
      </div>
      <div className="relative mt-6 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <p className="mt-3 truncate text-[clamp(2.25rem,2.9vw,3rem)] font-semibold leading-none tracking-[-0.055em] text-white">
          {typeof animatedValue === "number" ? (
            <AdminAnimatedValue value={animatedValue} format={valueFormat} />
          ) : (
            value
          )}
        </p>
        <div className="mt-4 flex min-h-7 items-center justify-between gap-3">
          {trend ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${trendClass(trend.direction)}`}>
              <TrendIcon className="h-3.5 w-3.5" />
              {trend.label} {trend.period}
            </span>
          ) : (
            <span className="line-clamp-1 text-[11px] font-medium text-zinc-500">{detail}</span>
          )}
        </div>
      </div>
      <div className="relative mt-3">
        <Sparkline data={sparkline} color={accentStyle.line} label={`${label} sparkline`} />
      </div>
    </article>
  );
}

function ExecutiveLineChart({
  title,
  subtitle,
  series,
}: {
  title: string;
  subtitle: string;
  series: Array<{ label: string; data: AdminChartSeries[]; color: string; prefix?: string }>;
}) {
  const allValues = series.flatMap((item) => item.data.map((point) => point.value));
  const max = Math.max(1, ...allValues);
  const hasData = allValues.some((value) => value > 0);

  return (
    <section className={`min-w-0 flex h-full min-h-[23rem] flex-col rounded-[1.5rem] p-5 lg:col-span-8 min-[1440px]:col-span-7 ${dashboardTheme.surface}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {series.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className={`mt-6 min-h-0 flex-1 overflow-hidden rounded-[1.25rem] p-5 ${dashboardTheme.innerSurface}`}>
        {hasData ? (
          <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" role="img" aria-label={`${title} chart`}>
            {[20, 40, 60, 80].map((line) => (
              <line
                key={`executive-grid:${line}`}
                x1="0"
                x2="100"
                y1={line}
                y2={line}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="0.6"
              />
            ))}
            {series.map((item) => {
              const points = item.data
                .map((point, index) => {
                  const x = item.data.length === 1 ? 50 : (index / (item.data.length - 1)) * 100;
                  const y = 92 - (point.value / max) * 78;

                  return `${x},${y}`;
                })
                .join(" ");

              return (
                <polyline
                  key={item.label}
                  fill="none"
                  stroke={item.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.8"
                  points={points}
                />
              );
            })}
          </svg>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <BarChart3 className="h-7 w-7 text-zinc-600" />
            <p className="mt-4 text-sm font-medium text-zinc-300">No chart data available.</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-600">Connected revenue and usage sources will populate this view automatically.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function DonutChartCard({
  title,
  subtitle,
  data,
  status,
  className = "",
}: {
  title: string;
  subtitle: string;
  data: Array<{ label: string; value: number }>;
  status: AdminMetricStatus;
  className?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#8b5cf6", "#34d399", "#60a5fa", "#fbbf24", "#71717a"];
  let cursor = 0;
  const gradient =
    data.length && total > 0
      ? data
          .map((item, index) => {
            const start = cursor;
            const end = cursor + (item.value / total) * 100;
            cursor = end;

            return `${colors[index % colors.length]} ${start}% ${end}%`;
          })
          .join(", ")
      : "rgba(255,255,255,0.08) 0% 100%";

  return (
    <section className={`min-w-0 flex h-full min-h-[23rem] flex-col rounded-[1.5rem] p-5 ${className || "xl:col-span-5 2xl:col-span-2"} ${dashboardTheme.surface}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">{subtitle}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-6 flex flex-1 items-center justify-center">
        <div
          className="relative h-36 w-36 rounded-full border border-white/10 shadow-xl shadow-black/20"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-6 rounded-full border border-white/10 bg-black" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[1.45rem] font-semibold tracking-tight text-white">{formatNumber(total)}</span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Total</span>
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-2.5">
        {data.length ? (
          data.map((item, index) => (
            <div key={item.label} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                <span className="truncate capitalize">{item.label}</span>
              </span>
              <span className="font-medium text-white">{formatNumber(item.value)}</span>
            </div>
          ))
        ) : (
          <p className={`flex min-h-[7rem] items-center justify-center rounded-[1rem] p-4 text-center text-sm text-zinc-500 ${dashboardTheme.innerSurface}`}>
            {overviewCardStatus(status) === "NOT CONNECTED" ? "Connection not configured yet." : "No data available"}
          </p>
        )}
      </div>
    </section>
  );
}

function OpenAiAnalyticsSection({ data }: { data: AdminDashboardData }) {
  const aiStatus = data.sourceStatus.aiUsage;

  return (
    <section className={`min-w-0 flex h-full min-h-[21rem] flex-col rounded-[1.5rem] p-5 min-[1440px]:col-span-4 ${dashboardTheme.surface}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-white">OpenAI Model Usage</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">Token usage and model cost telemetry.</p>
        </div>
        <StatusBadge status={aiStatus} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["Tokens", formatCompactNumber(data.openAiAnalytics.totalTokens)],
          ["Input", formatCompactNumber(data.openAiAnalytics.inputTokens)],
          ["Output", formatCompactNumber(data.openAiAnalytics.outputTokens)],
          ["Avg input", formatCompactNumber(data.openAiAnalytics.averageInputTokens)],
          ["Avg output", formatCompactNumber(data.openAiAnalytics.averageOutputTokens)],
          ["Avg latency", `${formatCompactNumber(data.openAiAnalytics.averageResponseTimeMs)}ms`],
          ["Avg cost", formatCurrency(data.openAiAnalytics.averageCostPerRequest)],
          ["Avg report", formatCompactNumber(data.openAiAnalytics.averageReportSize)],
          ["Success", `${data.openAiAnalytics.successRate}%`],
          ["Cache efficiency", `${data.openAiAnalytics.cacheEfficiency}%`],
          ["Cache hits", formatCompactNumber(data.openAiAnalytics.cacheHits)],
          ["Cache misses", formatCompactNumber(data.openAiAnalytics.cacheMisses)],
          ["Token savings", formatCompactNumber(data.openAiAnalytics.estimatedTokenSavings)],
          ["Abuse blocked", formatCompactNumber(data.openAiAnalytics.blockedAbuseAttempts)],
          ["Blocked", formatCompactNumber(data.openAiAnalytics.blockedRequests)],
          ["Limits", formatCompactNumber(data.openAiAnalytics.limitReachedEvents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[1rem] border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">{label}</p>
            <p className="mt-1 text-sm font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      {data.openAiAnalytics.topAbuseReasons.length ? (
        <div className="mt-4 rounded-[1rem] border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">Top abuse reasons</p>
          <div className="mt-2 space-y-1.5">
            {data.openAiAnalytics.topAbuseReasons.map((item) => (
              <div key={item.reason} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-zinc-400">{item.reason}</span>
                <span className="font-semibold text-zinc-200">{formatCompactNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data.openAiAnalytics.operationCosts.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {data.openAiAnalytics.operationCosts.slice(0, 4).map((operation) => (
            <div key={operation.operationType} className="rounded-[1rem] border border-white/10 bg-black/20 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                {operation.operationType.replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(operation.costUsd)}</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {formatCompactNumber(operation.tokens)} tokens · {formatNumber(operation.requests)} calls
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5 flex-1 overflow-hidden rounded-[1.15rem] border border-white/10 bg-black/25">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(4rem,1fr)_minmax(4rem,0.8fr)_minmax(3rem,0.7fr)] gap-3 border-b border-white/10 bg-white/[0.025] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          <span>Model</span>
          <span>Usage</span>
          <span>Cost</span>
          <span>Change</span>
        </div>
        {data.openAiAnalytics.modelUsage.length ? (
          data.openAiAnalytics.modelUsage.slice(0, 5).map((model) => (
            <div key={model.model} className="grid grid-cols-[minmax(0,1.6fr)_minmax(4rem,1fr)_minmax(4rem,0.8fr)_minmax(3rem,0.7fr)] items-center gap-3 border-b border-white/10 px-4 py-3.5 text-[13px] transition duration-200 last:border-b-0 hover:bg-white/[0.035]">
              <span className="min-w-0 truncate break-words font-medium text-white">{model.model}</span>
              <span className="min-w-0 truncate whitespace-nowrap text-zinc-400">{formatCompactNumber(model.tokens)}</span>
              <span className="min-w-0 truncate whitespace-nowrap text-zinc-200">{formatCurrency(model.costUsd)}</span>
              <span className="whitespace-nowrap text-zinc-500">—</span>
            </div>
          ))
        ) : (
          <div className="flex h-full min-h-[11rem] items-center justify-center p-6 text-center text-sm text-zinc-500">
            No model usage data is available for this range.
          </div>
        )}
      </div>

      {data.openAiAnalytics.unknownModels.length ? (
        <div className="mt-4 rounded-[1rem] border border-amber-300/20 bg-amber-950/20 p-3">
          <p className="text-sm font-semibold text-amber-100">Unknown Models</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/70">
            Pricing metadata is missing for {data.openAiAnalytics.unknownModels.map((item) => item.model).join(", ")}.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function MostExpensiveReportsCard({ data }: { data: AdminDashboardData }) {
  const rows = data.topReports.mostExpensive;
  const status = rows.length ? ("LIVE" as const) : ("NO DATA" as const);

  return (
    <section className={`min-w-0 flex h-full min-h-[21rem] flex-col rounded-[1.5rem] p-5 min-[1440px]:col-span-4 ${dashboardTheme.surface}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-white">Most Expensive Reports</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">Report-level cost data when available.</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mt-5 flex-1 space-y-2.5">
        {rows.length ? (
          rows.slice(0, 5).map((row, index) => (
            <div key={row.title} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] border border-white/10 bg-black/20 px-3 py-3 text-sm transition duration-200 hover:bg-white/[0.035]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.8rem] border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-purple-200">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate break-words font-medium text-white">{row.title}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{row.detail}</p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-zinc-200">{formatCurrency(row.value)}</span>
            </div>
          ))
        ) : (
          <div className="flex min-h-[11rem] items-center justify-center rounded-[1.15rem] border border-white/10 bg-black/20 p-6 text-center text-sm leading-6 text-zinc-500">
            No report-level cost source is connected for this ranking yet.
          </div>
        )}
      </div>
    </section>
  );
}

function SubscriptionRevenueCard({ data }: { data: AdminDashboardData }) {
  return (
    <section className={`min-w-0 flex h-full min-h-[23rem] flex-col rounded-[1.5rem] p-5 lg:col-span-4 min-[1440px]:col-span-2 ${dashboardTheme.surface}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight text-white">Subscription Revenue</h2>
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">{data.dateRange.label}</p>
        </div>
        <StatusBadge status={data.sourceStatus.revenue} />
      </div>
      <p className="mt-7 whitespace-normal break-words text-[clamp(1.65rem,2.15vw,2.25rem)] font-semibold leading-none tracking-[-0.045em] text-white">
        {formatCurrency(data.financials.revenue)}
      </p>
      <div className="mt-7 min-h-[8rem] flex-1 rounded-[1.15rem] bg-black/15 p-3">
        <Sparkline data={data.charts.revenue} color="#60a5fa" label="Subscription revenue sparkline" />
      </div>
    </section>
  );
}

function AlertCenter({ alerts }: { alerts: AdminActivityItem[] }) {
  const visibleAlerts = alerts.length
    ? alerts
    : [
        {
          id: "alerts:no-data",
          label: "No active alerts",
          detail: "Connected monitoring sources have not reported an issue in this range.",
          severity: "success" as const,
          createdAt: new Date().toISOString(),
        },
      ];

  const gridClass =
    visibleAlerts.length > 1
      ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      : "max-w-2xl";

  return (
    <section className={`rounded-[1.35rem] p-5 ${dashboardTheme.surface}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-white">Alert Center</h2>
          <p className="mt-1 text-xs text-zinc-500">Cost, failures and platform risk signals.</p>
        </div>
        <AlertTriangle className="h-5 w-5 text-amber-200" />
      </div>
      <div className={`mt-5 ${gridClass}`}>
        {visibleAlerts.slice(0, 3).map((alert) => {
          const tone =
            alert.severity === "error"
              ? "border-red-300/20 bg-red-950/20"
              : alert.severity === "warning"
                ? "border-amber-300/20 bg-amber-950/20"
                : "border-emerald-300/20 bg-emerald-300/10";

          return (
            <Link
              key={alert.id}
              href={alert.href || "/admin"}
              className={`block rounded-[1rem] border p-3 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.06] ${tone}`}
            >
              <p className="text-sm font-semibold text-white">{alert.label}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{alert.detail}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const dateRange = resolveAdminDateRange({
    range: params.range,
    from: params.from,
    to: params.to,
  });
  const data = await loadAdminDashboardData({ range: dateRange });
  const profitSeries =
    data.financials.revenue === null
      ? []
      : data.charts.revenue.map((item, index) => ({
          label: item.label,
          value: Math.max(0, item.value - (data.charts.estimatedAiCost[index]?.value || 0)),
        }));
  const financialCards = [
    {
      label: "Total Revenue",
      value: formatCurrency(data.financials.revenue),
      detail: data.sourceDetails.revenue,
      icon: DollarSign,
      accent: "green" as const,
      status: data.sourceStatus.revenue,
      trend: data.financials.revenue === null ? undefined : calculateTrend(data.charts.revenue, "Last 7d"),
      sparkline: data.charts.revenue,
      animatedValue: data.financials.revenue ?? undefined,
      valueFormat: "compactCurrency" as const,
    },
    {
      label: "AI/API Cost",
      value: formatCurrency(data.financials.aiCost),
      detail: data.sourceDetails.aiUsage,
      icon: BrainCircuit,
      accent: "purple" as const,
      status: data.sourceStatus.aiUsage,
      trend: data.charts.estimatedAiCost.length ? calculateTrend(data.charts.estimatedAiCost, "Last 7d") : undefined,
      sparkline: data.charts.estimatedAiCost,
      animatedValue: data.financials.aiCost,
      valueFormat: "compactCurrency" as const,
    },
    {
      label: "Gross Profit",
      value: formatCurrency(data.financials.grossProfit),
      detail: data.financials.grossProfit === null ? data.financials.financialSourceDetail : "Revenue minus estimated AI/API cost.",
      icon: CircleDollarSign,
      accent: "green" as const,
      status: data.financials.grossProfit === null ? data.financials.financialSourceStatus : "ESTIMATED" as const,
      trend: profitSeries.length ? calculateTrend(profitSeries, "Last 7d") : undefined,
      sparkline: profitSeries,
      animatedValue: data.financials.grossProfit ?? undefined,
      valueFormat: "compactCurrency" as const,
    },
    {
      label: "Gross Margin",
      value: formatPercent(data.financials.grossMargin),
      detail: data.financials.grossMargin === null ? data.financials.financialSourceDetail : "Gross profit divided by revenue",
      icon: Gauge,
      accent: "blue" as const,
      status: data.financials.grossMargin === null ? data.financials.financialSourceStatus : "ESTIMATED" as const,
      sparkline: profitSeries,
    },
    {
      label: "Net Profit",
      value: formatCurrency(data.financials.netProfit),
      detail: data.financials.financialSourceStatus === "NOT CONNECTED"
        ? data.financials.financialSourceDetail
        : "Operating expense source required",
      icon: WalletCards,
      accent: "amber" as const,
      status: data.financials.netProfit === null ? data.financials.financialSourceStatus : "ESTIMATED" as const,
      sparkline: [],
    },
  ];
  return (
    <AdminShell
      eyebrow="CEO Control Center"
      title="CEO Dashboard"
      subtitle="Executive operating metrics, financial signals and platform health."
      hidePageHeader
      headerActions={
        <>
          <AdminDateRangeControls
            activeRange={data.dateRange.key}
            fromIso={data.dateRange.fromIso}
            toIso={data.dateRange.toIso}
            variant="inline"
          />
          <AdminDashboardRefresh />
          <AdminExports tables={data.exportTables} variant="button" />
        </>
      }
    >
      <div className="space-y-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {financialCards.map((card) => (
            <ExecutiveKpiCard key={card.label} {...card} />
          ))}
        </section>

        <section className="grid items-stretch gap-4 lg:grid-cols-12">
          <ExecutiveLineChart
            title="Revenue, AI Cost and Profit"
            subtitle={`${data.dateRange.label} financial trajectory`}
            series={[
              { label: "Revenue", data: data.charts.revenue, color: "#34d399" },
              { label: "AI Cost", data: data.charts.estimatedAiCost, color: "#8b5cf6" },
              { label: "Profit", data: profitSeries, color: "#60a5fa" },
            ]}
          />
          <DonutChartCard
            title="User Distribution"
            subtitle="Plan profile mix"
            data={data.planDistribution}
            status={data.sourceStatus.subscriptions}
            className="lg:col-span-4 min-[1440px]:col-span-3"
          />
          <SubscriptionRevenueCard data={data} />
        </section>

        <section className="grid items-stretch gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-12 [&>section]:mt-0">
          <OpenAiAnalyticsSection data={data} />
          <MostExpensiveReportsCard data={data} />
          <AdminSystemHealth initialStatuses={data.systemStatus} />
        </section>

        <AlertCenter alerts={data.alerts} />
      </div>
    </AdminShell>
  );
}
