import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Gauge,
  History,
  ReceiptText,
  ShieldCheck,
  WalletCards,
  XCircle,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../DashboardSidebar";
import { getAuthenticatedUser } from "../report-utils";
import {
  confirmDowngrade,
  openCustomerPortal,
  requestCancellation,
  startPlanChange,
} from "./actions";
import { loadBillingOverview } from "./billing-data";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "Not configured";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((used / limit) * 100));
}

function UsageBar({
  label,
  used,
  limit,
  remaining,
}: {
  label: string;
  used: number;
  limit: number;
  remaining: number;
}) {
  const percent = usagePercent(used, limit);
  const quotaLabel = limit > 0 ? String(limit) : "Unlimited";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 transition focus-within:border-teal-300/25">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {used} used · {limit > 0 ? `${remaining} remaining` : "No monthly cap"}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-zinc-300">
          {quotaLabel}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-300 to-cyan-100"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing_notice?: string; billing_error?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login?next=/dashboard/billing");
  }

  const [{ billing_notice: notice, billing_error: error }, billing] = await Promise.all([
    searchParams,
    loadBillingOverview(supabase, user),
  ]);
  const currentPlan = billing.plans.find((plan) => plan.current);
  const stripeMissing = billing.stripe.server.missing;
  const billingConfigured = billing.stripe.server.configured;
  const billingActionsAvailable = billingConfigured && billing.stripe.server.enabled;
  const billingUnavailableMessage =
    "Secure billing actions are disabled until Stripe is configured for this environment.";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.055),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] opacity-35" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 pt-6 pb-28 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.35rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 backdrop-blur-2xl">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),transparent_38%),radial-gradient(circle_at_85%_20%,rgba(45,212,191,0.16),transparent_34%)]" />
              <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold tracking-[0.24em] text-teal-100 shadow-lg shadow-teal-950/20">
                    <WalletCards className="h-3.5 w-3.5" />
                    BILLING
                  </div>
                  <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                    Subscription and usage controls.
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
                    Review your current plan, monthly AI usage, quota remaining,
                    payment readiness and subscription actions in one secure place.
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5 xl:min-w-80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Current plan
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-3xl font-semibold capitalize text-white">
                        {billing.planTier}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {billing.subscriptionStatus}
                      </p>
                    </div>
                    <BadgeCheck className="h-8 w-8 text-teal-200" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {notice ? (
            <div className="mt-6 rounded-3xl border border-teal-300/20 bg-teal-300/10 p-5 text-sm leading-6 text-teal-50">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-3xl border border-red-300/20 bg-red-950/30 p-5 text-sm leading-6 text-red-100">
              Billing action could not be completed. Please try again shortly.
            </div>
          ) : null}

          {!billingConfigured ? (
            <div className="mt-6 rounded-[1.75rem] border border-amber-300/20 bg-amber-950/20 p-5 shadow-2xl shadow-black/20">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <AlertTriangle className="h-6 w-6 shrink-0 text-amber-200" />
                <div>
                  <h2 className="text-xl font-semibold text-white">
                    Billing not configured
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-amber-100/80">
                    Stripe checkout is disabled until the required server-side
                    configuration is present. No payment, upgrade, downgrade or
                    cancellation will be executed in this state.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {stripeMissing.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-amber-300/20 bg-black/25 px-3 py-1 text-xs font-medium text-amber-100"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-4">
            {[
              {
                label: "Subscription",
                value: billing.subscriptionStatus,
                detail: currentPlan?.name || "Free",
                icon: CheckCircle2,
              },
              {
                label: "Renewal date",
                value: formatDate(billing.renewalDate),
                detail: "Current billing period",
                icon: CalendarDays,
              },
              {
                label: "AI cost",
                value: formatCurrency(billing.usage.estimatedAiCostUsd),
                detail: "Stored usage events only",
                icon: Gauge,
              },
              {
                label: "Payment method",
                value: billing.paymentMethod ? "Configured" : "Not configured",
                detail: "No card details are stored client-side",
                icon: CreditCard,
              },
            ].map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.label}
                  className="rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      {card.label}
                    </p>
                    <Icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-white">
                    {card.value}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-zinc-500">
                    {card.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                    Usage summary
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Current billing-period usage.
                  </h2>
                </div>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-medium text-zinc-400">
                  {formatDate(billing.billingPeriod.start)} — {formatDate(billing.billingPeriod.end)}
                </span>
              </div>

              {billing.usageError ? (
                <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100">
                  Usage data could not be loaded right now. Please refresh the page or try again shortly.
                </div>
              ) : null}

              <div className="mt-5 grid gap-3">
                <UsageBar
                  label="AI Chat"
                  used={billing.usage.aiChatsUsed}
                  limit={billing.usage.limits.aiChats}
                  remaining={billing.usage.remaining.aiChats}
                />
                <UsageBar
                  label="AI Plan reports"
                  used={billing.usage.reportsUsed}
                  limit={billing.usage.limits.reports}
                  remaining={billing.usage.remaining.reports}
                />
                <UsageBar
                  label="Market Analysis"
                  used={billing.usage.marketAnalysisUsed}
                  limit={billing.usage.limits.marketAnalysis}
                  remaining={billing.usage.remaining.marketAnalysis}
                />
              </div>
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                Secure actions
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                Manage subscription.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Every action is validated on the server. ZERINIX never accepts a
                customer, price or subscription owner directly from the browser.
              </p>
              {!billingActionsAvailable ? (
                <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100/85">
                  {billingUnavailableMessage}
                </div>
              ) : null}
              <form action={openCustomerPortal} className="mt-5">
                <button
                  type="submit"
                  disabled={!billingActionsAvailable}
                  aria-disabled={!billingActionsAvailable}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-200/30 disabled:cursor-not-allowed disabled:border disabled:border-white/10 disabled:bg-white/10 disabled:text-zinc-500"
                >
                  {billingActionsAvailable ? "Open customer portal" : "Customer portal unavailable"}
                </button>
              </form>

              <details className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-white">
                  Downgrade plan
                </summary>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  Downgrading can reduce monthly AI report and chat quotas. Confirm
                  only after saving any report work you need.
                </p>
                <form action={confirmDowngrade} className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <select
                    name="plan"
                    defaultValue="free"
                    disabled={!billingActionsAvailable}
                    className="min-h-11 rounded-2xl border border-white/10 bg-black/40 px-4 text-sm text-zinc-200 outline-none focus:border-teal-300/40 disabled:cursor-not-allowed disabled:text-zinc-600"
                    aria-label="Downgrade target plan"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!billingActionsAvailable}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/15 focus:outline-none focus:ring-2 focus:ring-amber-200/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-zinc-500"
                  >
                    {billingActionsAvailable ? "Confirm downgrade" : "Downgrade unavailable"}
                  </button>
                </form>
              </details>

              <details className="mt-3 rounded-2xl border border-red-300/20 bg-red-950/20 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-white">
                  Cancel subscription
                </summary>
                <p className="mt-3 text-sm leading-6 text-red-100/80">
                  Cancellation may remove paid quota at the end of the billing
                  period. This action is disabled until Stripe is configured.
                </p>
                <form action={requestCancellation} className="mt-4">
                  <button
                    type="submit"
                    disabled={!billingActionsAvailable}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-300/25 bg-red-300/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-300/15 focus:outline-none focus:ring-2 focus:ring-red-200/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-zinc-500"
                  >
                    {billingActionsAvailable ? "Request cancellation" : "Cancellation unavailable"}
                  </button>
                </form>
              </details>
            </section>
          </div>

          <section className="mt-6 rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                  Plans
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  Choose the right operating tier.
                </h2>
              </div>
              <Link
                href="/dashboard/usage"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-teal-300/25 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                View usage details
                <ArrowRight className="h-4 w-4 text-teal-200" />
              </Link>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {billing.plans.map((plan) => {
                const planSelectable =
                  billingActionsAvailable &&
                  plan.supportedBySchema &&
                  plan.priceState.configured &&
                  !plan.current;

                return (
                <article
                  key={plan.id}
                  className={`rounded-[1.5rem] border p-5 transition ${
                    plan.current
                      ? "border-teal-300/30 bg-teal-300/10"
                      : "border-white/10 bg-black/25"
                  } ${planSelectable ? "hover:border-teal-300/20 hover:bg-white/[0.04]" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-500">
                        {plan.description}
                      </p>
                    </div>
                    {plan.current ? <CheckCircle2 className="h-5 w-5 text-teal-200" /> : null}
                  </div>
                  <p className="mt-5 text-2xl font-semibold text-white">
                    {plan.priceState.label}
                  </p>
                  {!billingActionsAvailable ? (
                    <p className="mt-2 text-xs leading-5 text-amber-100/80">
                      Billing actions are disabled in this environment.
                    </p>
                  ) : !plan.supportedBySchema ? (
                    <p className="mt-2 text-xs leading-5 text-amber-100/80">
                      Not configured in the current billing schema.
                    </p>
                  ) : !plan.priceState.configured ? (
                    <p className="mt-2 text-xs leading-5 text-amber-100/80">
                      Stripe price is not configured for this plan.
                    </p>
                  ) : null}
                  <form action={startPlanChange} className="mt-5">
                    <input type="hidden" name="plan" value={plan.id} />
                    <button
                      type="submit"
                      disabled={!planSelectable}
                      aria-disabled={!planSelectable}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-200/30 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
                    >
                      {plan.current
                        ? "Current plan"
                        : planSelectable
                          ? "Select plan"
                          : "Unavailable"}
                    </button>
                  </form>
                </article>
                );
              })}
            </div>
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <ReceiptText className="h-5 w-5 text-teal-200" />
                <h2 className="text-xl font-semibold text-white">Invoices</h2>
              </div>
              {billing.invoices.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-6 text-sm leading-6 text-zinc-500">
                  No invoices are available yet. Invoice history will appear here
                  after Stripe billing is configured and the first invoice is issued.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {billing.invoices.map((invoice) => (
                    <a
                      key={invoice.id}
                      href={invoice.hostedInvoiceUrl || invoice.invoicePdfUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm transition hover:border-teal-300/20 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                    >
                      <span>
                        <span className="block font-semibold text-white">
                          {invoice.status}
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          {formatDate(invoice.createdAt)}
                        </span>
                      </span>
                      <span className="font-semibold text-teal-100">
                        {formatCurrency(invoice.totalCents / 100)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-teal-200" />
                <h2 className="text-xl font-semibold text-white">Billing history</h2>
              </div>
              {billing.billingHistory.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-6 text-sm leading-6 text-zinc-500">
                  No billing events have been recorded yet.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {billing.billingHistory.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-black/25 p-4"
                    >
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="mt-6 rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                <ShieldCheck className="h-5 w-5 text-teal-200" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Security posture
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Server-side billing controls.
                </h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    ["Authenticated user required", true],
                    ["Stripe secret kept server-side", true],
                    ["Webhook signature helper available", true],
                    ["Stripe checkout configured", billingConfigured],
                    ["Publishable Stripe key configured", billing.stripe.publishable.configured],
                    ["Team plan schema support", false],
                  ].map(([label, ok]) => (
                    <div
                      key={String(label)}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-300"
                    >
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-teal-200" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-200" />
                      )}
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
