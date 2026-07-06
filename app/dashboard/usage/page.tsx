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
import {
  getUserPlanTier,
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

  const [planTier, summary] = await Promise.all([
    getUserPlanTier(supabase, user.id),
    loadUserUsageSummary(supabase, user.id),
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
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.07),transparent_28%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="border-b border-white/10 pb-8">
            <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
              AI OPERATIONS
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white md:text-5xl">
              Usage Intelligence
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Monitor request volume, token consumption, cache efficiency and
              estimated AI spend before ZERINIX scales into heavier production
              traffic.
            </p>
          </div>

          {summary.error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Usage telemetry is not available yet: {summary.error}
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.label}
                  className="rounded-3xl border border-white/10 bg-zinc-950/70 p-6 shadow-2xl shadow-black/30"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="rounded-2xl border border-teal-300/20 bg-teal-300/10 p-3">
                      <Icon className="h-5 w-5 text-teal-200" />
                    </div>
                    <Gauge className="h-4 w-4 text-zinc-600" />
                  </div>
                  <p className="mt-5 text-sm font-medium text-zinc-400">
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

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-semibold text-white">
              Queue-Ready Architecture
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Fresh generations are tagged with queue-ready job descriptors in
              usage metadata, so long-running reports can later move to workers
              without changing the planner interface.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
