import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  DollarSign,
  FileText,
  RefreshCw,
  Users,
} from "lucide-react";
import { AdminShell } from "./AdminShell";
import { loadAdminDashboardData } from "./admin-data";

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

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
}) {
  return (
    <article className="rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl transition hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065]">
      <div className="flex items-center justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
          <Icon className="h-5 w-5 text-teal-200" />
        </span>
        <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Live
        </span>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-2 text-sm leading-5 text-zinc-500">{detail}</p>
    </article>
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
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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

function MiniChart({
  title,
  data,
  valuePrefix = "",
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  valuePrefix?: string;
}) {
  const max = Math.max(1, ...data.map((item) => item.value));

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {data.length ? (
        <div className="mt-5 flex h-36 items-end gap-2" aria-label={`${title} chart`}>
          {data.map((item) => (
            <div key={`${title}:${item.label}`} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t-xl bg-teal-300/80 transition hover:bg-teal-200"
                style={{ height: `${Math.max(8, (item.value / max) * 100)}%` }}
                title={`${item.label}: ${valuePrefix}${formatNumber(Math.round(item.value))}`}
              />
              <span className="text-[10px] text-zinc-600">{item.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
          No data available
        </p>
      )}
    </div>
  );
}

function statusClass(status: string) {
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

export default async function AdminDashboardPage() {
  const data = await loadAdminDashboardData();
  const cards = [
    {
      label: "Total users",
      value: formatNumber(data.totalUsers),
      detail: "Supabase Auth users",
      icon: Users,
    },
    {
      label: "Active users",
      value: formatNumber(data.activeUsers),
      detail: "Users with at least one sign-in",
      icon: Activity,
    },
    {
      label: "Reports generated",
      value: formatNumber(data.reportsGenerated),
      detail: "Saved report records",
      icon: FileText,
    },
    {
      label: "AI conversations",
      value: formatNumber(data.aiConversations),
      detail: "Stored conversations",
      icon: Bot,
    },
    {
      label: "Total AI requests",
      value: formatNumber(data.usageSummary.totalRequests),
      detail: "Stored usage events",
      icon: Activity,
    },
    {
      label: "Token usage",
      value: formatNumber(data.usageSummary.totalTokens),
      detail: "Prompt and completion tokens",
      icon: Bot,
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
    },
  ];

  return (
    <AdminShell
      eyebrow="Admin"
      title="Control center"
      subtitle="Operational visibility for users, reports, AI usage, system health, and audited administration."
    >
      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">System Health</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Lightweight server-side checks with no secret exposure or paid provider calls.
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-zinc-300 transition hover:border-teal-300/30 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {data.systemStatus.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="font-medium text-white">{item.label}</p>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${statusClass(item.status)}`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-5 text-zinc-500">{item.detail}</p>
              <p className="mt-3 text-xs text-zinc-600">Last checked {formatDate(item.lastChecked)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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

      <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <Distribution title="User growth" data={data.userGrowth} />
        <Distribution title="Report type distribution" data={data.reportTypeDistribution} />
        <Distribution title="Subscription plan distribution" data={data.planDistribution} />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        <MiniChart title="New users over time" data={data.charts.userGrowth} />
        <MiniChart title="Active users over time" data={data.charts.activeUsers} />
        <MiniChart title="Reports generated over time" data={data.charts.reportsGenerated} />
        <MiniChart title="AI requests over time" data={data.charts.aiRequests} />
        <MiniChart title="Token usage over time" data={data.charts.tokenUsage} />
        <MiniChart title="Estimated AI cost over time" data={data.charts.estimatedAiCost} valuePrefix="$" />
        <MiniChart title="Revenue over time" data={data.charts.revenue} valuePrefix="$" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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

          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
              <Link href="/admin/logs" className="text-xs font-medium text-teal-100 transition hover:text-white">
                View all
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {data.recentActivity.length ? (
                data.recentActivity.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm">
                    <p className="font-medium text-white">{item.label}</p>
                    <p className="mt-1 text-zinc-500">{item.detail} · {formatDate(item.createdAt)}</p>
                    {item.href ? (
                      <a href={item.href} className="mt-2 inline-flex text-xs font-medium text-teal-100">
                        View related record
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                  No activity has been recorded yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl">
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
