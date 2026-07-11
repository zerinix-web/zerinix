import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  Bot,
  DollarSign,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { AdminAnimatedValue, type AdminAnimatedValueFormat } from "./AdminAnimatedValue";
import { AdminDateRangeControls } from "./AdminDateRangeControls";
import { AdminExports } from "./AdminExports";
import { AdminRealtimeNotifications } from "./AdminRealtimeNotifications";
import { AdminShell } from "./AdminShell";
import { AdminSystemHealth } from "./AdminSystemHealth";
import {
  loadAdminDashboardData,
  resolveAdminDateRange,
  type AdminActivityItem,
} from "./admin-data";

const AdminCharts = dynamic(
  () => import("./AdminCharts"),
  {
    loading: () => (
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`admin-chart-loading:${index}`}
            className="h-64 animate-pulse rounded-[1.4rem] border border-white/10 bg-white/[0.045]"
          />
        ))}
      </div>
    ),
  }
);

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

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "Estimate unavailable";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
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

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "Unknown time";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days}d ago`;
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
    return "border-teal-300/20 bg-teal-300/10 text-teal-100";
  }

  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function activityPresentation(item: AdminActivityItem) {
  if (item.label.includes("registered")) {
    return {
      Icon: UserPlus,
      type: "User",
      className: "border-teal-300/20 bg-teal-300/10 text-teal-100",
    };
  }

  if (item.label.includes("Report")) {
    return {
      Icon: FileText,
      type: "Report",
      className: "border-sky-300/20 bg-sky-950/20 text-sky-100",
    };
  }

  if (item.label.includes("conversation")) {
    return {
      Icon: MessageSquare,
      type: "AI",
      className: "border-violet-300/20 bg-violet-950/20 text-violet-100",
    };
  }

  if (item.label.includes("failed")) {
    return {
      Icon: XCircle,
      type: "Error",
      className: "border-red-300/20 bg-red-950/20 text-red-100",
    };
  }

  return {
    Icon: ShieldCheck,
    type: "Audit",
    className: "border-amber-300/20 bg-amber-950/20 text-amber-100",
  };
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  animatedValue,
  valueFormat = "integer",
  animatedEmptyLabel,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
  animatedValue?: number;
  valueFormat?: AdminAnimatedValueFormat;
  animatedEmptyLabel?: string;
  trend?: Trend;
}) {
  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <article className="group rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl transition duration-300 ease-out hover:-translate-y-1 hover:border-teal-300/25 hover:bg-white/[0.07] hover:shadow-[0_28px_100px_rgba(20,184,166,0.12)]">
      <div className="flex items-center justify-between gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 transition duration-300 group-hover:scale-105 group-hover:border-teal-200/35">
          <Icon className="h-5 w-5 text-teal-200" />
        </span>
        {trend ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${trendClass(trend.direction)}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            {trend.label}
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Live
          </span>
        )}
      </div>
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white transition duration-300 group-hover:text-teal-50">
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
      <p className="mt-2 text-sm leading-5 text-zinc-500">{detail}</p>
      {trend ? (
        <p className="mt-3 text-xs font-medium text-zinc-600">{trend.period}</p>
      ) : null}
    </article>
  );
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function buildExecutiveSummary(input: {
  newUsersToday: number;
  reportsToday: number;
  aiCostToday: number | null;
  activeAlerts: number;
}) {
  const cost = input.aiCostToday === null ? "cost data is not available" : `${formatCompactCurrency(input.aiCostToday)} in estimated AI cost`;
  const alertCopy = input.activeAlerts
    ? `${input.activeAlerts} active alert${input.activeAlerts === 1 ? "" : "s"} need review`
    : "no active critical alerts are visible";

  return `AI executive summary: today shows ${input.newUsersToday} new user${input.newUsersToday === 1 ? "" : "s"}, ${input.reportsToday} report${input.reportsToday === 1 ? "" : "s"}, ${cost}, and ${alertCopy}.`;
}

function ExecutiveOverview({
  newUsersToday,
  reportsToday,
  aiCostToday,
  activeAlerts,
}: {
  newUsersToday: number;
  reportsToday: number;
  aiCostToday: number | null;
  activeAlerts: number;
}) {
  const summary = buildExecutiveSummary({
    newUsersToday,
    reportsToday,
    aiCostToday,
    activeAlerts,
  });

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.05] p-5 shadow-[0_28px_120px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-7">
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] xl:items-end">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-100">
            <Sparkles className="h-3.5 w-3.5" />
            Executive Overview
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-5xl">
            {getGreeting()}, Admin.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400">
            {summary}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              label: "New users today",
              value: newUsersToday,
              format: "integer" as const,
            },
            {
              label: "Reports today",
              value: reportsToday,
              format: "integer" as const,
            },
            {
              label: "AI cost today",
              value: aiCostToday ?? 0,
              format: "compactCurrency" as const,
              emptyLabel: aiCostToday === null ? "Not configured" : undefined,
            },
            {
              label: "Active alerts",
              value: activeAlerts,
              format: "integer" as const,
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4 shadow-inner shadow-white/[0.02] transition duration-300 hover:border-teal-300/25 hover:bg-black/35"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                {item.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
                <AdminAnimatedValue
                  value={item.value}
                  format={item.format}
                  emptyLabel={item.emptyLabel}
                />
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Distribution({
  title,
  data,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.26)] backdrop-blur-xl transition duration-300 hover:border-teal-300/20 hover:bg-white/[0.06]">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-5 space-y-4">
        {data.length ? (
          data.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-300">{item.label}</span>
                <span className="font-medium text-teal-100">{formatNumber(item.value)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-teal-300"
                  style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
            Not configured
          </p>
        )}
      </div>
    </div>
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
  const lastUserGrowthPoint = data.charts.userGrowth.at(-1);
  const lastReportPoint = data.charts.reportsGenerated.at(-1);
  const activeAlerts =
    data.systemStatus.filter((item) => item.status === "Degraded" || item.status === "Down").length +
    data.recentErrors.length;
  const cards = [
    {
      label: "Total users",
      value: formatNumber(data.totalUsers),
      detail: "Supabase Auth users",
      icon: Users,
      animatedValue: data.totalUsers,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.userGrowth, "Last 24h"),
    },
    {
      label: "Active users",
      value: formatNumber(data.activeUsers),
      detail: "Users with at least one sign-in",
      icon: Activity,
      animatedValue: data.activeUsers,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.activeUsers, "Last 24h"),
    },
    {
      label: "Reports generated",
      value: formatNumber(data.reportsGenerated),
      detail: "Saved report records",
      icon: FileText,
      animatedValue: data.reportsGenerated,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.reportsGenerated, "Last 24h"),
    },
    {
      label: "AI conversations",
      value: formatNumber(data.aiConversations),
      detail: "Stored conversations",
      icon: Bot,
      animatedValue: data.aiConversations,
      valueFormat: "integer" as const,
    },
    {
      label: "Total AI requests",
      value: formatNumber(data.usageSummary.totalRequests),
      detail: "Stored usage events",
      icon: Activity,
      animatedValue: data.usageSummary.totalRequests,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.aiRequests, "Last 24h"),
    },
    {
      label: "Token usage",
      value: formatNumber(data.usageSummary.totalTokens),
      detail: "Prompt and completion tokens",
      icon: Bot,
      animatedValue: data.usageSummary.totalTokens,
      valueFormat: "integer" as const,
      trend: calculateTrend(data.charts.tokenUsage),
    },
    {
      label: "Monthly recurring revenue",
      value: formatCurrency(data.monthlyRecurringRevenue),
      detail: "Payment provider not connected",
      icon: DollarSign,
    },
    {
      label: "AI/API cost",
      value: formatCurrency(data.aiApiCost),
      detail: "From stored usage records",
      icon: Activity,
      animatedValue: data.aiApiCost,
      valueFormat: "compactCurrency" as const,
      trend: calculateTrend(data.charts.estimatedAiCost),
    },
  ];
  const chartConfigs = [
    { title: "New users over time", data: data.charts.userGrowth },
    { title: "Active users over time", data: data.charts.activeUsers },
    { title: "Reports generated over time", data: data.charts.reportsGenerated },
    { title: "AI requests over time", data: data.charts.aiRequests },
    { title: "Token usage over time", data: data.charts.tokenUsage },
    { title: "AI cost over time", data: data.charts.estimatedAiCost, valuePrefix: "$" },
    {
      title: "Revenue over time",
      data: data.charts.revenue,
      valuePrefix: "$",
      unavailableLabel: "Awaiting Stripe",
    },
  ];

  return (
    <AdminShell
      eyebrow="Admin"
      title="Control center"
      subtitle="Operational visibility for users, reports, AI usage, system health, and audited administration."
      hidePageHeader
    >
      <ExecutiveOverview
        newUsersToday={lastUserGrowthPoint?.value ?? 0}
        reportsToday={lastReportPoint?.value ?? 0}
        aiCostToday={data.costControl.estimatedCostToday}
        activeAlerts={activeAlerts}
      />

      <AdminDateRangeControls
        activeRange={data.dateRange.key}
        fromIso={data.dateRange.fromIso}
        toIso={data.dateRange.toIso}
      />

      <AdminRealtimeNotifications
        initialSummary={data.notifications}
        rangeKey={data.dateRange.key}
        fromIso={data.dateRange.fromIso}
        toIso={data.dateRange.toIso}
      />

      <AdminSystemHealth initialStatuses={data.systemStatus} />

      <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-white">Executive financial overview</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Revenue cards remain visible but disabled until Stripe production billing is configured.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.revenueOverview.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{item.label}</p>
              <p className="mt-3 text-xl font-semibold text-white">{item.value}</p>
              <p className="mt-2 text-sm text-zinc-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-white">AI Cost Control</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Estimated from stored usage events and centralized server-side model pricing.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Tokens today", formatNumber(data.costControl.totalTokensToday)],
            ["Tokens this month", formatNumber(data.costControl.totalTokensThisMonth)],
            ["Cost today", formatCurrency(data.costControl.estimatedCostToday)],
            ["Cost this month", formatCurrency(data.costControl.estimatedCostThisMonth)],
            ["Avg cost / conversation", formatCurrency(data.costControl.averageCostPerConversation)],
            ["Avg cost / report", formatCurrency(data.costControl.averageCostPerReport)],
            ["Failed AI requests", formatNumber(data.costControl.failedAiRequests)],
            ["Cost trend", formatPercent(data.costControl.costTrendPercent)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-3 text-xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Distribution
            title="Highest-usage users"
            data={data.costControl.highestUsageUsers.map((item) => ({
              label: item.userId.slice(0, 8),
              value: item.tokens,
            }))}
          />
          <Distribution
            title="Highest-cost routes"
            data={data.costControl.highestCostRoutes.map((item) => ({
              label: item.route,
              value: item.costUsd,
            }))}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Distribution title="User growth" data={data.userGrowth} />
        <Distribution title="Report type distribution" data={data.reportTypeDistribution} />
        <Distribution title="Subscription plan distribution" data={data.planDistribution} />
      </div>

      <div className="mt-5">
        <AdminCharts charts={chartConfigs} />
      </div>

      <AdminExports tables={data.exportTables} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-white">Recent users</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="py-3">Email</th>
                  <th className="py-3">Plan</th>
                  <th className="py-3">Status</th>
                  <th className="py-3">Reports</th>
                  <th className="py-3">Last sign-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {data.recentUsers.map((user) => (
                  <tr key={user.id} className="text-zinc-300">
                    <td className="py-3 pr-4">
                      <span className="block font-medium text-white">{user.email}</span>
                      <span className="text-xs text-zinc-500">
                        {user.displayName || "No display name"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 capitalize">{user.plan}</td>
                    <td className="py-3 pr-4 capitalize">{user.accountStatus}</td>
                    <td className="py-3 pr-4">{formatNumber(user.reportCount)}</td>
                    <td className="py-3">{formatDate(user.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recentUsers.length ? (
              <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                No users found yet.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-white">AI usage summary</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["Requests", data.usageSummary.totalRequests],
                ["Tokens", data.usageSummary.totalTokens],
                ["Cache hits", data.usageSummary.cacheHits],
                ["Failures", data.usageSummary.failedRequests],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {formatNumber(Number(value))}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
              <Link href="/admin/logs" className="text-xs font-medium text-teal-100 transition hover:text-white">
                View all
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {data.recentActivity.length ? (
                data.recentActivity.map((item) => {
                  const activity = activityPresentation(item);
                  const Icon = activity.Icon;
                  const content = (
                    <>
                      <div className="flex items-start gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${activity.className}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-white">{item.label}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${activity.className}`}>
                              {activity.type}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-zinc-500">{item.detail}</p>
                          <p className="mt-2 text-xs text-zinc-600">
                            {formatRelativeTime(item.createdAt)} · {formatDate(item.createdAt)}
                          </p>
                        </div>
                      </div>
                      {item.href ? (
                        <span className="mt-3 inline-flex text-xs font-medium text-teal-100">
                          View related record
                        </span>
                      ) : null}
                    </>
                  );

                  return item.href ? (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="block rounded-2xl border border-white/10 bg-black/25 p-4 text-sm transition duration-300 hover:border-teal-300/25 hover:bg-white/[0.05]"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm">
                      {content}
                    </div>
                  );
                })
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                  No activity has been recorded yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-200" />
              <h2 className="text-lg font-semibold text-white">Failed jobs / recent errors</h2>
            </div>
            <div className="mt-4 space-y-3">
              {data.recentErrors.length ? (
                data.recentErrors.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-amber-300/15 bg-amber-950/15 p-4 text-sm">
                    <p className="font-medium text-amber-100">{item.endpoint}</p>
                    <p className="mt-1 text-zinc-500">{item.status} · {formatDate(item.createdAt)}</p>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                  No failed usage events recorded.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
