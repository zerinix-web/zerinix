import Link from "next/link";
import {
  Bot,
  DollarSign,
  FileText,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { AdminAnimatedValue, type AdminAnimatedValueFormat } from "./AdminAnimatedValue";
import { AdminDateRangeControls } from "./AdminDateRangeControls";
import { AdminExports } from "./AdminExports";
import { AdminShell } from "./AdminShell";
import { AdminSystemHealth } from "./AdminSystemHealth";
import {
  loadAdminDashboardData,
  resolveAdminDateRange,
} from "./admin-data";

type Trend = {
  direction: "up" | "down" | "flat";
  label: string;
  period: "Last 24h" | "Last 7d";
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Not configured";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  if (!value) {
    return "No sign-in yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
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
    return "border-purple-300/25 bg-purple-400/10 text-purple-100";
  }

  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  animatedValue,
  valueFormat = "integer",
  animatedEmptyLabel,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
  accent: "green" | "blue" | "orange" | "purple";
  animatedValue?: number;
  valueFormat?: AdminAnimatedValueFormat;
  animatedEmptyLabel?: string;
  trend?: Trend;
}) {
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;
  const accentClasses = {
    green: "border-emerald-400/18 bg-emerald-400/10 text-emerald-200 group-hover:border-emerald-300/30",
    blue: "border-sky-400/18 bg-sky-400/10 text-sky-200 group-hover:border-sky-300/30",
    orange: "border-orange-400/18 bg-orange-400/10 text-orange-200 group-hover:border-orange-300/30",
    purple: "border-purple-400/20 bg-purple-400/10 text-purple-200 group-hover:border-purple-300/32",
  }[accent];

  return (
    <article className="group relative min-h-[10.25rem] overflow-hidden rounded-[1.35rem] border border-[#252b36] bg-[#151922] p-4.5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 ease-out hover:-translate-y-1 hover:border-[#343b49] hover:bg-[#181d27] hover:shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
      <div className="flex items-center justify-between gap-4">
        <span className={`flex h-10 w-10 items-center justify-center rounded-[1rem] border transition duration-300 group-hover:scale-105 ${accentClasses}`}>
          <Icon className="h-5 w-5" />
        </span>
        {trend ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${trendClass(trend.direction)}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            {trend.label}
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Live
          </span>
        )}
      </div>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-[2.15rem] font-semibold leading-none tracking-[-0.035em] text-white transition duration-300 group-hover:text-zinc-50">
        {typeof animatedValue === "number" ? (
          <AdminAnimatedValue
            value={animatedValue}
            format={valueFormat}
            emptyLabel={animatedEmptyLabel}
          />
        ) : (
          value
        )}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-zinc-500">{detail}</p>
      {trend ? (
        <p className="mt-2.5 text-[11px] font-medium text-zinc-600">{trend.period}</p>
      ) : null}
    </article>
  );
}

function LineChartCard({
  title,
  data,
  periodLabel,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  periodLabel: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const latest = data.at(-1)?.value ?? 0;
  const points = data
    .map((item, index) => {
      const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
      const y = 100 - (item.value / max) * 78 - 10;

      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="rounded-[1.35rem] border border-[#252b36] bg-[#151922] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl xl:col-span-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-1 text-xs text-zinc-500">{periodLabel}</p>
        </div>
        <div className="rounded-full border border-purple-400/18 bg-purple-400/10 px-3 py-1 text-xs font-semibold text-purple-100">
          {formatNumber(latest)}
        </div>
      </div>
      <div className="mt-5 h-[21rem] overflow-hidden rounded-[1.1rem] border border-[#252b36] bg-[#10141c] p-4">
        {data.length ? (
          <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" role="img" aria-label={`${title} chart`}>
            <defs>
              <linearGradient id="admin-user-growth-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(168 85 247)" stopOpacity="0.24" />
                <stop offset="100%" stopColor="rgb(168 85 247)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[24, 48, 72].map((line) => (
              <line
                key={`growth-grid:${line}`}
                x1="0"
                x2="100"
                y1={line}
                y2={line}
                stroke="rgba(255,255,255,0.055)"
                strokeWidth="0.6"
              />
            ))}
            <polyline fill="url(#admin-user-growth-area)" points={`0,100 ${points} 100,100`} />
            <polyline
              fill="none"
              stroke="rgb(168 85 247)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              points={points}
            />
            {data.map((item, index) => {
              const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
              const y = 100 - (item.value / max) * 78 - 10;

              return (
                <circle
                  key={`growth-point:${item.label}`}
                  cx={x}
                  cy={y}
                  r="2.6"
                  className="fill-[#10141c] stroke-purple-300"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">No data available</div>
        )}
      </div>
    </section>
  );
}

function DonutChartCard({
  title,
  data,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#c084fc", "#8b5cf6", "#a78bfa", "#6d28d9", "#ddd6fe"];
  let cursor = 0;
  const gradient = data.length && total > 0
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
    <section className="rounded-[1.35rem] border border-[#252b36] bg-[#151922] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl xl:col-span-3">
      <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-5 flex items-center justify-center">
        <div
          className="relative h-40 w-40 rounded-full border border-[#2a303b] shadow-[0_22px_80px_rgba(0,0,0,0.22)]"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="absolute inset-7 rounded-full border border-[#2a303b] bg-[#151922]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tracking-tight text-white">{formatNumber(total)}</span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Total</span>
          </div>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {data.length ? (
          data.map((item, index) => (
            <div key={item.label} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-zinc-300">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="font-medium text-purple-100">{formatNumber(item.value)}</span>
            </div>
          ))
        ) : (
          <p className="rounded-[1rem] border border-white/10 bg-white/[0.045] p-4 text-sm text-zinc-500">
            Not configured
          </p>
        )}
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
  const cards = [
    {
      label: "Total users",
      value: formatNumber(data.totalUsers),
      detail: "Supabase Auth users",
      icon: Users,
      accent: "green" as const,
      animatedValue: data.totalUsers,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.userGrowth, "Last 24h"),
    },
    {
      label: "Generated Reports",
      value: formatNumber(data.reportsGenerated),
      detail: "Saved report records",
      icon: FileText,
      accent: "blue" as const,
      animatedValue: data.reportsGenerated,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.reportsGenerated, "Last 24h"),
    },
    {
      label: "AI Conversations",
      value: formatNumber(data.aiConversations),
      detail: "Stored conversations",
      icon: Bot,
      accent: "orange" as const,
      animatedValue: data.aiConversations,
      valueFormat: "integer" as const,
    },
    {
      label: "Total Revenue",
      value: formatCurrency(data.monthlyRecurringRevenue),
      detail: "Payment provider not connected",
      icon: DollarSign,
      accent: "purple" as const,
    },
  ];

  return (
    <AdminShell
      eyebrow="Admin"
      title="Dashboard"
      subtitle="System overview and statistics"
      hidePageHeader
      headerActions={
        <>
          <AdminDateRangeControls
            activeRange={data.dateRange.key}
            fromIso={data.dateRange.fromIso}
            toIso={data.dateRange.toIso}
            variant="inline"
          />
          <AdminExports tables={data.exportTables} variant="button" />
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <LineChartCard
          title="User Growth"
          data={data.charts.userGrowth}
          periodLabel={data.dateRange.label}
        />
        <DonutChartCard title="Report Distribution" data={data.reportTypeDistribution} />
        <DonutChartCard title="Subscription Plans" data={data.planDistribution} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_0.85fr] [&>section]:mt-0">
        <div className="rounded-[1.35rem] border border-[#252b36] bg-[#151922] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-white">Recent users</h2>
              <p className="mt-1 text-xs text-zinc-500">Latest accounts from Supabase Auth.</p>
            </div>
            <Link href="/admin/users" className="rounded-full border border-purple-400/18 bg-purple-400/10 px-3 py-1 text-xs font-semibold text-purple-100 transition hover:bg-purple-400/15">
              Manage
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] border-separate border-spacing-y-2 text-left text-[13px]">
              <thead className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Reports</th>
                  <th className="px-3 py-2">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {data.recentUsers.map((user) => (
                  <tr key={user.id} className="group text-zinc-300 transition">
                    <td className="rounded-l-[0.95rem] border-y border-l border-[#252b36] bg-[#111620] px-3 py-3 transition group-hover:border-[#343b49] group-hover:bg-[#181d27]">
                      <span className="block font-medium text-white">{user.email}</span>
                      <span className="text-xs text-zinc-500">
                        {user.displayName || "No display name"}
                      </span>
                    </td>
                    <td className="border-y border-[#252b36] bg-[#111620] px-3 py-3 transition group-hover:border-[#343b49] group-hover:bg-[#181d27]">
                      <span className="rounded-full border border-purple-400/18 bg-purple-400/10 px-2.5 py-1 text-xs font-medium capitalize text-purple-100">
                        {user.plan}
                      </span>
                    </td>
                    <td className="border-y border-[#252b36] bg-[#111620] px-3 py-3 transition group-hover:border-[#343b49] group-hover:bg-[#181d27]">
                      <span className="rounded-full border border-[#2a303b] bg-[#1a1f29] px-2.5 py-1 text-xs font-medium capitalize text-zinc-300">
                        {user.accountStatus}
                      </span>
                    </td>
                    <td className="border-y border-[#252b36] bg-[#111620] px-3 py-3 transition group-hover:border-[#343b49] group-hover:bg-[#181d27]">{formatNumber(user.reportCount)}</td>
                    <td className="rounded-r-[0.95rem] border-y border-r border-[#252b36] bg-[#111620] px-3 py-3 transition group-hover:border-[#343b49] group-hover:bg-[#181d27]">{formatDate(user.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recentUsers.length ? (
              <p className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm text-zinc-500">
                No users found yet.
              </p>
            ) : null}
          </div>
        </div>

        <AdminSystemHealth initialStatuses={data.systemStatus} />
      </div>
    </AdminShell>
  );
}
