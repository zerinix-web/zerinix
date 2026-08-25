import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Globe2,
  Languages,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { BillingOverview } from "@/app/dashboard/billing/billing-data";
import type { UserSettingsProfile } from "@/app/dashboard/settings/settings-data";
import SignOutButton from "@/components/auth/SignOutButton";

type AccountRowProps = {
  icon: LucideIcon;
  title: string;
  detail: string;
  href?: string;
  external?: boolean;
  badge?: string;
};

function AccountRow({
  icon: Icon,
  title,
  detail,
  href,
  external = false,
  badge,
}: AccountRowProps) {
  const content = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem] border border-white/10 bg-black/30 shadow-inner shadow-black/20">
        <Icon className="h-[1.125rem] w-[1.125rem] text-teal-200" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-1 block truncate text-xs text-zinc-500">
          {detail}
        </span>
      </span>
      {href ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
      ) : badge ? (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-zinc-500">
          {badge}
        </span>
      ) : null}
    </>
  );
  const className =
    "flex min-h-[4.5rem] items-center gap-3 border-b border-white/[0.07] px-4 py-3.5 last:border-b-0 transition active:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-200/30";

  if (href) {
    return (
      <Link
        href={href}
        className={className}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "ZX";
  const words = source
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "ZX";
}

function usagePercent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export default function MobileAccountHome({
  settings,
  billing,
  reportCount,
  hasDataError = false,
}: {
  settings: UserSettingsProfile;
  billing: BillingOverview;
  reportCount: number;
  hasDataError?: boolean;
}) {
  const displayName = settings.displayName || "ZERINIX Member";
  const currentPlan =
    billing.plans.find((plan) => plan.current)?.name ||
    `${billing.planTier.slice(0, 1).toUpperCase()}${billing.planTier.slice(1)}`;
  const aiUsagePercent = usagePercent(
    billing.usage.aiChatsUsed,
    billing.usage.limits.aiChats
  );
  const hasActivity =
    reportCount > 0 ||
    billing.usage.aiChatsUsed > 0 ||
    billing.usage.reportsUsed > 0 ||
    billing.usage.marketAnalysisUsed > 0;

  return (
    <div className="relative min-h-[calc(100dvh-4.5rem)] overflow-hidden px-4 pb-[calc(8.75rem+env(safe-area-inset-bottom))] pt-7 text-white lg:hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(45,212,191,0.12),transparent_29%),radial-gradient(circle_at_8%_42%,rgba(255,255,255,0.04),transparent_25%)]" />

      <div className="relative mx-auto max-w-xl">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.23em] text-teal-200/70">
            Your workspace
          </p>
          <h1 className="mt-3 text-[2rem] font-semibold tracking-[-0.045em]">
            Account
          </h1>
        </header>

        <section className="relative mt-6 overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_10%,rgba(45,212,191,0.12),transparent_36%)]" />
          <div className="relative flex items-center gap-4">
            <div className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center overflow-hidden rounded-[1.4rem] border border-teal-200/20 bg-teal-200/[0.09] text-lg font-bold tracking-[0.08em] text-teal-100 shadow-xl shadow-teal-950/20">
              {settings.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                getInitials(displayName, settings.email)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold tracking-[-0.025em] text-white">
                {displayName}
              </h2>
              <p className="mt-1 truncate text-sm text-zinc-400">
                {settings.email}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-500">
                {settings.emailVerified ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-200" />
                ) : (
                  <Clock3 className="h-3.5 w-3.5 text-amber-200" />
                )}
                {settings.emailVerified
                  ? "Verified account"
                  : "Email verification pending"}
              </p>
            </div>
          </div>
        </section>

        {hasDataError ? (
          <div
            role="status"
            className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-950/20 px-4 py-3 text-sm leading-6 text-amber-100/80"
          >
            Some usage details are temporarily unavailable. Your account remains
            secure.
          </div>
        ) : null}

        <section className="mt-6">
          <Link
            href="/dashboard"
            className="flex min-h-[4.25rem] items-center gap-3 rounded-[1.4rem] border border-white/10 bg-white/[0.05] px-4 py-3 shadow-lg shadow-black/20 ring-1 ring-white/[0.02] transition active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-200/30"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem] border border-teal-200/20 bg-teal-200/10 shadow-inner shadow-black/20">
              <LayoutDashboard className="h-[1.125rem] w-[1.125rem] text-teal-200" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">
                Go to Dashboard
              </span>
              <span className="mt-1 block truncate text-xs text-zinc-500">
                Reports, workspaces and analytics
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
          </Link>
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Plan
            </h2>
            <WalletCards className="h-4 w-4 text-teal-200" />
          </div>
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.05] p-5 shadow-xl shadow-black/25 ring-1 ring-white/[0.02]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-zinc-500">Current plan</p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white">
                  {currentPlan}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {billing.subscriptionStatus}
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/[0.09]">
                <Sparkles className="h-5 w-5 text-teal-200" />
              </span>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">
                  {billing.usage.remaining.aiChats} AI credits remaining
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {billing.usage.aiChatsUsed} of{" "}
                  {billing.usage.limits.aiChats} used this month
                </p>
              </div>
              <p className="text-xs font-semibold text-teal-100">
                {aiUsagePercent}%
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-teal-200 transition-[width] duration-500"
                style={{ width: `${aiUsagePercent}%` }}
              />
            </div>

            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-5 flex min-h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-4 text-sm font-semibold text-zinc-500"
            >
              Upgrade plan
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                Coming soon
              </span>
            </button>
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Usage
          </h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {[
              {
                label: "Reports",
                value: String(reportCount),
                detail: "created",
                icon: FileText,
              },
              {
                label: "AI usage",
                value: String(billing.usage.aiChatsUsed),
                detail: "this month",
                icon: Bot,
              },
              {
                label: "Research",
                value: "—",
                detail: "not enabled",
                icon: Globe2,
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.label}
                  className="min-w-0 rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-3.5 shadow-lg shadow-black/20 ring-1 ring-white/[0.02]"
                >
                  <Icon className="h-4 w-4 text-teal-200" />
                  <p className="mt-4 text-xl font-semibold text-white">
                    {item.value}
                  </p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-zinc-300">
                    {item.label}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-zinc-600">
                    {item.detail}
                  </p>
                </article>
              );
            })}
          </div>

          {!hasActivity ? (
            <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-zinc-500">
              Your account activity will appear here after your first
              conversation or report.
            </div>
          ) : null}
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Settings
          </h2>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
            <AccountRow
              icon={UserRound}
              title="Profile settings"
              detail={settings.displayName || "Add your display name"}
            />
            <AccountRow
              icon={Bell}
              title="Notifications"
              detail={settings.notificationPreference}
            />
            <AccountRow
              icon={Languages}
              title="Language"
              detail={settings.preferredLanguage}
            />
            <AccountRow
              icon={LockKeyhole}
              title="Security"
              detail={
                settings.emailVerified
                  ? "Email verified"
                  : "Verification pending"
              }
            />
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Support
          </h2>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.045] shadow-xl shadow-black/20 ring-1 ring-white/[0.02]">
            <AccountRow
              icon={CircleHelp}
              title="Help"
              detail="Get help with your ZERINIX workspace"
              href="mailto:admin@zerinix.com?subject=ZERINIX%20Help"
              external
            />
            <AccountRow
              icon={MessageCircle}
              title="Contact support"
              detail="admin@zerinix.com"
              href="mailto:admin@zerinix.com?subject=ZERINIX%20Support"
              external
            />
            <AccountRow
              icon={FileText}
              title="Terms"
              detail="Terms of service"
              badge="Soon"
            />
            <AccountRow
              icon={ShieldCheck}
              title="Privacy"
              detail="Privacy policy"
              badge="Soon"
            />
          </div>
        </section>

        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Session
          </h2>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-red-300/15 bg-red-950/10 shadow-xl shadow-black/20 ring-1 ring-red-200/[0.03]">
            <SignOutButton className="flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-red-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-200/30 disabled:cursor-not-allowed disabled:opacity-60">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem] border border-red-300/20 bg-red-300/10 shadow-inner shadow-black/20">
                <LogOut className="h-[1.125rem] w-[1.125rem] text-red-200" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">
                  Sign out
                </span>
                <span className="mt-1 block truncate text-xs text-zinc-500">
                  {settings.email}
                </span>
              </span>
            </SignOutButton>
          </div>
        </section>

        <div className="mt-7 flex items-center justify-center gap-2 text-[11px] text-zinc-600">
          <Mail className="h-3.5 w-3.5" />
          Secure account data managed by ZERINIX
        </div>
      </div>
    </div>
  );
}
