import { redirect } from "next/navigation";
import {
  Activity,
  Clock,
  Database,
  Gauge,
  PiggyBank,
  Zap,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import { isFounderAccount } from "@/app/lib/beta-access";
import {
  getUserPlanTier,
  loadAdminCostSummary,
  loadUserUsageSummary,
} from "@/app/lib/ai/governance";
import DashboardSidebar from "../DashboardSidebar";
import { getAuthenticatedUser } from "../report-utils";

export const dynamic = "force-dynamic";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export default async function UsageDashboardPage() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const isAdmin = isFounderAccount(user);
  const [planTier, summary, adminSummary] = await Promise.all([
    getUserPlanTier(supabase, user.id),
    loadUserUsageSummary(supabase, user.id),
    isAdmin ? loadAdminCostSummary(supabase) : Promise.resolve(null),
  ]);

  const cards = [
    {
      label: "Total AI Requests",
      value: formatNumber(summary.totalRequests),
      detail: `${planTier.toUpperCase()} plan`,
      icon: Activity,
    },
    {
      label: "Token Usage",
      value: formatNumber(summary.totalTokens),
      detail: `${formatNumber(summary.promptTokens)} in / ${formatNumber(summary.completionTokens)} out`,
      icon: Database,
    },
    {
      label: "Estimated OpenAI Cost",
      value: formatCurrency(summary.estimatedCostUsd),
      detail: "Based on recorded token usage",
      icon: PiggyBank,
    },
    {
      label: "Cache Hit Ratio",
      value: formatPercent(summary.cacheHitRatio),
      detail: "Identical prompts served from cache",
      icon: Zap,
    },
    {
      label: "Average Response Time",
      value: `${formatNumber(summary.averageResponseTimeMs)} ms`,
      detail: "Last 1,000 usage events",
      icon: Clock,
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-8 lg:p-10">
            <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
              AI OPERATIONS
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">
              Usage Intelligence
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
              Monitor request volume, token consumption, cache efficiency and
              estimated AI spend before ZERINIX scales into heavier production
              traffic.
            </p>
          </div>

          {summary.error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Usage telemetry is not available right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.label}
                  className="group rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="rounded-[1.05rem] border border-teal-300/20 bg-teal-300/10 p-3 shadow-lg shadow-teal-950/10">
                      <Icon className="h-5 w-5 text-teal-200" />
                    </div>
                    <Gauge className="h-4 w-4 text-zinc-600 transition duration-300 group-hover:text-teal-200" />
                  </div>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                    {card.value}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">
                    {card.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-white">
              Queue-Ready Architecture
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Fresh generations are tagged with queue-ready job descriptors in
              usage metadata, so long-running reports can later move to workers
              without changing the planner interface.
            </p>
          </div>

          {adminSummary ? (
            <div className="mt-8 rounded-[1.9rem] border border-teal-300/15 bg-teal-300/[0.035] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-200/75">
                    Admin Cost Control
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Daily AI Cost Dashboard
                  </h2>
                </div>
                <div className="rounded-2xl border border-teal-200/20 bg-black/35 px-4 py-3 text-right shadow-lg shadow-teal-950/10">
                  <p className="text-xs text-zinc-500">Today</p>
                  <p className="text-xl font-semibold text-teal-100">
                    {formatCurrency(adminSummary.totalDailyCostUsd)}
                  </p>
                </div>
              </div>

              {adminSummary.error ? (
                <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-950/20 p-4 text-sm text-amber-100">
                  Admin telemetry is limited right now. Please refresh the page or try again shortly.
                </p>
              ) : null}

              <div className="mt-5 grid gap-4 xl:grid-cols-3">
                <div className="rounded-3xl border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/10">
                  <p className="text-sm font-semibold text-white">Cost per mode</p>
                  <div className="mt-3 space-y-3">
                    {adminSummary.costPerMode.map((item) => (
                      <div key={item.mode} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-zinc-400">{item.mode}</span>
                        <span className="font-medium text-teal-100">
                          {formatCurrency(item.costUsd)} · {formatNumber(item.requests)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/10">
                  <p className="text-sm font-semibold text-white">Cost per user</p>
                  <div className="mt-3 space-y-3">
                    {adminSummary.costPerUser.map((item) => (
                      <div key={item.userId} className="flex items-center justify-between gap-4 text-sm">
                        <span className="max-w-40 truncate text-zinc-400">{item.userId}</span>
                        <span className="font-medium text-teal-100">
                          {formatCurrency(item.costUsd)} · {formatNumber(item.requests)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/10">
                  <p className="text-sm font-semibold text-white">Cache savings</p>
                  <p className="mt-3 text-3xl font-semibold text-teal-100">
                    {formatCurrency(adminSummary.cacheSavingsUsd)}
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Estimated avoided provider spend from cached responses.
                  </p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto rounded-3xl border border-white/10 bg-black/35">
                <div className="grid min-w-[760px] grid-cols-5 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  <span>Mode</span>
                  <span>Endpoint</span>
                  <span>Model</span>
                  <span>Tokens</span>
                  <span>Cost</span>
                </div>
                {adminSummary.mostExpensiveRequests.map((item) => (
                  <div key={`${item.createdAt}-${item.endpoint}-${item.costUsd}`} className="grid min-w-[760px] grid-cols-5 gap-3 border-b border-white/10 px-4 py-3 text-sm last:border-b-0">
                    <span className="text-white">{item.mode}</span>
                    <span className="text-zinc-400">{item.endpoint}</span>
                    <span className="text-zinc-400">{item.model}</span>
                    <span className="text-zinc-400">{formatNumber(item.totalTokens)}</span>
                    <span className="font-medium text-teal-100">{formatCurrency(item.costUsd)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
