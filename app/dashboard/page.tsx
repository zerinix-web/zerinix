import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Clock3,
  FileText,
  Folder,
  MessageSquareText,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import { dashboardTheme } from "@/app/lib/ui/dashboard-theme";
import {
  getCanonicalDecisionLabel,
  resolveCanonicalDecisionFromReportText,
} from "@/app/lib/report-engine/executive-decision-vocabulary";
import {
  readMarketIntelligenceCanonicalState,
} from "@/app/lib/report-engine/market-intelligence-canonical-state";
import {
  resolveMarketIntelligenceGatedExecutiveDecision,
} from "@/app/lib/report-engine/market-intelligence-evidence-gaps";
import { detectPdfPresentationLocale } from "@/app/lib/pdf-normalization.mjs";
import {
  getUserPlanTier,
  loadUserUsageSummary,
} from "@/app/lib/ai/governance";
import DashboardSidebar from "./DashboardSidebar";
import WorkspaceManager from "./WorkspaceManager";
import {
  countUserCompletedReports,
  getAuthenticatedUser,
  loadUserReport,
  loadUserReportSummaries,
  loadUserWorkspaces,
  type DashboardReport,
  type DashboardWorkspace,
} from "./report-utils";
import MobileChatHome from "@/components/mobile/MobileChatHome";

export const dynamic = "force-dynamic";
const mobileChatHomeEnabled =
  process.env.NEXT_PUBLIC_MOBILE_CHAT_HOME_ENABLED?.trim().toLowerCase() !==
  "false";

function formatDashboardDate(value: string) {
  if (!value) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getFirstName(user: Awaited<ReturnType<typeof getAuthenticatedUser>>) {
  const metadata = user?.user_metadata || {};
  const displayName =
    typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name
      : typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name
        : "";
  const source = displayName || user?.email || "";
  const firstName = source
    .split("@")[0]
    .split(/[.\s_-]+/)
    .find(Boolean);

  return firstName
    ? `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`
    : "";
}

function getWorkspaceActivityDate(workspace: DashboardWorkspace) {
  return workspace.updatedAt || workspace.createdAt || "";
}

function getActiveWorkspace(workspaces: DashboardWorkspace[]) {
  return [...workspaces].sort((a, b) => {
    const bTime = new Date(getWorkspaceActivityDate(b)).getTime() || 0;
    const aTime = new Date(getWorkspaceActivityDate(a)).getTime() || 0;

    return bTime - aTime || b.reportCount - a.reportCount;
  })[0];
}

function cleanMobileDashboardText(value: string, maxLength = 132) {
  const cleaned = value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const clipped = cleaned.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");

  return `${clipped.slice(0, Math.max(72, lastSpace)).trim()}…`;
}

function getReportSectionContent(report: DashboardReport | undefined, matchers: string[]) {
  if (!report) {
    return "";
  }

  const normalizedMatchers = matchers.map((matcher) => matcher.toLowerCase());
  const section = report.sections.find((item) => {
    const field = item.field?.toLowerCase() || "";
    const title = item.title.toLowerCase();

    return normalizedMatchers.some(
      (matcher) => field.includes(matcher) || title.includes(matcher)
    );
  });

  return section?.content || "";
}

function extractDashboardMetric(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedLabel}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  return cleanMobileDashboardText(match?.[1] || "", 118);
}

function getDecisionSignal(report: DashboardReport | undefined) {
  if (!report) {
    return "No decision signal yet";
  }

  const recommendation = getReportSectionContent(report, [
    "executiverecommendation",
    "executive recommendation",
    "recommendation",
  ]);
  const summary = getReportSectionContent(report, [
    "executivesummary",
    "executive summary",
    "marketoverview",
    "market overview",
  ]);
  const content = `${recommendation}\n${summary}`;

  // CRITICAL ARCHITECTURE FIX -- centralize executive decision
  // vocabulary. Confirmed live: this shared reports list previously
  // showed each report kind's own raw decision word verbatim (Business
  // Plan's "GO"/"WAIT"/"PASS" next to Acquisition's "Proceed with
  // Conditions"/"Reject" next to Real Estate's "BUY"/"AVOID"), so the
  // same underlying call read as inconsistent wording across cards even
  // when nothing was actually wrong. Every report kind's own,
  // unmodified decision output is now translated into one canonical
  // 4-value vocabulary (see executive-decision-vocabulary.ts) before
  // display, so "same decision, same label" holds across every report
  // kind on this list. Falls back to the pre-existing text-extraction
  // heuristic only when no report kind's recognizable decision
  // vocabulary is present at all.
  // TASK #30 -- confirmed live (canonical-decision-pipeline audit):
  // resolveCanonicalDecisionFromReportText's own Tier 3
  // (extractExecutiveDecisionFromText) defaults to the "standard"
  // GO/CONDITIONAL_GO/NO_GO vocabulary -- Market Intelligence's real
  // banner text says "Decision: ENTER/MONITOR/AVOID (Confidence: NN%)",
  // which never matches those tokens, so `resolved` was always null for
  // an ENTER or MONITOR verdict here (AVOID happened to coincidentally
  // satisfy Real Estate's own "Decision: BUY|WAIT|AVOID" pattern a few
  // lines up in that same function, purely by accident of vocabulary
  // overlap -- never a real Market Intelligence code path). Every
  // Market-Intelligence report therefore fell all the way through to the
  // unscoped `keywordSignal` regex below, scanning the ENTIRE executive
  // summary/recommendation text for a bare "GO"/"REVIEW"/"HOLD"/etc.
  // token anywhere -- the exact "Go-to-Market" false-positive class of
  // bug already fixed on every other Market Intelligence surface, just
  // never closed on this dashboard home card. Market Intelligence now
  // resolves through the SAME canonical-state-first resolver every other
  // surface uses (web report page, PDF, Strategic Recommendations
  // badge), so this card can never show a decision that disagrees with,
  // or is independently re-derived from, the one canonical decision.
  if (report.type === "Market Analysis") {
    const canonicalState = readMarketIntelligenceCanonicalState(report.metadata);
    const locale = detectPdfPresentationLocale(content);
    const marketDecision = resolveMarketIntelligenceGatedExecutiveDecision(
      canonicalState,
      content,
      locale === "tr" ? "Turkish" : "English"
    );

    return marketDecision.decisionLabel !== "—"
      ? cleanMobileDashboardText(marketDecision.decisionLabel, 92)
      : `${report.type} ready for review`;
  }

  // CRITICAL FIX -- Market Intelligence must never fall back to
  // investmentScore.recommendation, a generic business-viability GO/
  // WAIT/PASS score computed by investment-score.ts that Market
  // Intelligence does not evaluate (it has its own, more conservative
  // ENTER/MONITOR/AVOID market-entry verdict instead) -- moot for this
  // report kind now that it returns above, kept here unchanged for
  // every other report kind.
  const resolved = resolveCanonicalDecisionFromReportText(content, report.investmentScore?.recommendation);
  if (resolved) {
    return getCanonicalDecisionLabel(resolved.decision, resolved.language);
  }

  const explicitSignal =
    extractDashboardMetric(recommendation, "Decision") ||
    extractDashboardMetric(recommendation, "Recommendation") ||
    extractDashboardMetric(recommendation, "Investment Recommendation");
  const keywordSignal = content.match(
    /\b(Proceed with Conditions|Pause Pending Review|Reject|Conditional Go|No[- ]Go|GO|NO GO|WAIT|PIVOT|VALIDATE|REVIEW|HOLD)\b/i
  )?.[1];

  return cleanMobileDashboardText(
    explicitSignal || keywordSignal || `${report.type} ready for review`,
    92
  );
}

function getRecommendedDashboardAction({
  activeWorkspace,
  latestCompletedReport,
  latestReport,
}: {
  activeWorkspace?: DashboardWorkspace;
  latestCompletedReport?: DashboardReport;
  latestReport?: DashboardReport;
}) {
  if (latestCompletedReport) {
    return {
      label: "Continue Analysis",
      href: `/chat?reportId=${encodeURIComponent(latestCompletedReport.id)}`,
      detail: "Use the latest report as advisor context.",
    };
  }

  if (latestReport?.status.toLowerCase() === "failed") {
    return {
      label: "Create New Report",
      href: activeWorkspace
        ? `/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(activeWorkspace.id)}`
        : "/plan?new=1&mode=plan",
      detail: "The latest report needs a clean follow-up run.",
    };
  }

  return {
    label: "Create Strategic Report",
    href: activeWorkspace
      ? `/plan?new=1&mode=plan&workspaceId=${encodeURIComponent(activeWorkspace.id)}`
      : "/plan?new=1&mode=plan",
    detail: "Start a decision report to build workspace memory.",
  };
}

// TEMPORARY PROFILING INSTRUMENTATION -- added to diagnose the ~2.4s SSR
// response time, not permanent. Safe to delete this block and every
// `ssrTimings`/`markStart`/`markEnd`/`timed(...)` call site below without
// touching any business logic, UI, or API response shape: every wrapped
// call still does exactly what it did before, in the exact same order/
// concurrency, this only measures how long it takes and prints the result
// to the server console after the page has finished preparing its data.
type SsrTimings = Record<string, number>;

function markStart() {
  return performance.now();
}

function markEnd(timings: SsrTimings, label: string, start: number) {
  timings[label] = performance.now() - start;
}

async function timed<T>(
  timings: SsrTimings,
  label: string,
  promise: Promise<T>
): Promise<T> {
  const start = performance.now();
  const result = await promise;
  markEnd(timings, label, start);
  return result;
}

function printSsrTimings(timings: SsrTimings, totalMs: number) {
  const order = [
    "auth",
    "latest report summary",
    "latest report lookup",
    "reports",
    "completed count",
    "workspaces",
    "usage",
    "billing",
    "render data",
  ];
  const rows = order.filter((label) => label in timings);
  const labelWidth = Math.max(...rows.map((label) => label.length), "TOTAL".length);
  const lines = rows.map((label) => {
    const dots = ".".repeat(Math.max(3, labelWidth - label.length + 3));
    return `${label} ${dots} ${timings[label].toFixed(1)} ms`;
  });
  const totalDots = ".".repeat(Math.max(3, labelWidth - "TOTAL".length + 3));
  lines.push(`TOTAL ${totalDots} ${totalMs.toFixed(1)} ms`);
  console.log(["Dashboard SSR timings", ...lines].join("\n"));
}

export default async function DashboardPage() {
  const ssrStart = markStart();
  const timings: SsrTimings = {};

  const supabase = await createClient();
  const authStart = markStart();
  const user = await getAuthenticatedUser(supabase);
  markEnd(timings, "auth", authStart);

  if (!user) {
    redirect("/login");
  }

  // loadUserReportSummaries fetches every field the dashboard list/stats
  // views need EXCEPT `sections` -- the full section content for a user's
  // entire report history was being fetched and normalized on every
  // dashboard load even though only one report's content (the latest
  // completed one, for the decision-signal card below) is ever read from
  // it. That report's real content is fetched separately, by id, once we
  // know which report it is -- see latestCompletedReport below. The list
  // itself is also now bounded (DASHBOARD_RECENT_REPORTS_LIMIT, see
  // report-utils.ts) instead of scanning a user's entire report history
  // on every load; the two account-wide totals the page displays (total
  // report count, completed count) are sourced independently below so
  // neither depends on the bounded list being complete.
  const [
    { workspaces, error },
    { reports, error: reportsError },
    planTier,
    usage,
    completedReportsCount,
  ] = await Promise.all([
    timed(timings, "workspaces", loadUserWorkspaces(supabase, user)),
    timed(timings, "reports", loadUserReportSummaries(supabase, user)),
    timed(timings, "billing", getUserPlanTier(supabase, user.id)),
    timed(timings, "usage", loadUserUsageSummary(supabase, user.id)),
    timed(timings, "completed count", countUserCompletedReports(supabase, user)),
  ]);
  const renderDataStart = markStart();
  const totalReports = workspaces.reduce(
    (total, workspace) => total + workspace.reportCount,
    0
  );
  const activeWorkspaces = workspaces.filter(
    (workspace) => workspace.reportCount > 0
  ).length;
  const recentReports = reports.slice(0, 4);
  const completedReports = completedReportsCount;
  const activeWorkspace = getActiveWorkspace(workspaces);
  const activeWorkspaceReports = activeWorkspace
    ? reports.filter((report) => report.workspaceId === activeWorkspace.id)
    : reports;
  const activeWorkspaceContext =
    cleanMobileDashboardText(activeWorkspaceReports[0]?.prompt || "", 132) ||
    cleanMobileDashboardText(activeWorkspaceReports[0]?.title || "", 132) ||
    "Create a strategic report to establish this workspace context.";
  const latestReport = recentReports[0];
  const lastReportTime = latestReport?.createdAt || "";
  // Only the id is needed from the summary list to know WHICH report is
  // latest-completed; its real section content (for the decision-signal
  // card just below) is fetched with a single targeted query for that one
  // report, not carried along for the whole list.
  const latestReportSummaryStart = markStart();
  const latestCompletedReportSummary = reports.find(
    (report) => report.status.toLowerCase() === "completed"
  );
  markEnd(timings, "latest report summary", latestReportSummaryStart);
  const latestCompletedReport = latestCompletedReportSummary
    ? (await timed(
        timings,
        "latest report lookup",
        loadUserReport(supabase, user, latestCompletedReportSummary.id)
      )) || undefined
    : undefined;
  if (!latestCompletedReportSummary) {
    timings["latest report lookup"] = 0;
  }
  const firstName = getFirstName(user);
  const decisionSignal = getDecisionSignal(latestCompletedReport);
  const recommendedAction = getRecommendedDashboardAction({
    activeWorkspace,
    latestCompletedReport,
    latestReport,
  });
  const mobileMetrics = [
    { label: "Reports", value: String(totalReports || reports.length) },
    { label: "Workspaces", value: String(workspaces.length) },
    { label: "Completed", value: String(completedReports) },
    { label: "Runs", value: formatCompactNumber(usage.totalRequests) },
  ];
  const planLabel = `${planTier.charAt(0).toUpperCase()}${planTier.slice(1)} plan`;
  const usageEfficiency =
    usage.totalRequests > 0
      ? `${formatCompactNumber(Math.round(usage.totalTokens / usage.totalRequests))} avg tokens`
      : "No platform usage yet";
  const dashboardStats = [
    {
      label: "Last Report",
      value: formatDashboardDate(lastReportTime),
      detail: latestReport ? latestReport.title : "Create your first strategic report",
      icon: Clock3,
      tone: "teal",
      href: latestReport ? `/dashboard/${latestReport.id}` : "/plan?new=1&mode=plan",
    },
    {
      label: "Total Reports",
      value: String(totalReports || reports.length),
      detail: `${completedReports} completed`,
      icon: FileText,
      tone: "white",
      href: "/dashboard#reports",
    },
    {
      label: "AI Spend",
      value: formatCurrency(usage.estimatedCostUsd),
      detail: "Based on stored usage records",
      icon: Activity,
      tone: usage.error ? "amber" : "emerald",
      href: "/dashboard/usage",
    },
    {
      label: "Active Workspaces",
      value: String(activeWorkspaces),
      detail: `${workspaces.length} total workspaces`,
      icon: Folder,
      tone: "zinc",
      href: "/dashboard#workspaces",
    },
  ];
  // "render data" is the pure synchronous derivation work between the
  // parallel data fetches finishing and JSX being returned (array
  // filters/maps, string formatting, etc.) -- everything measured above
  // since renderDataStart, minus the two latest-report steps that are
  // timed separately (they overlap the same span but aren't "rendering").
  const renderDataElapsed =
    markStart() -
    renderDataStart -
    (timings["latest report summary"] || 0) -
    (timings["latest report lookup"] || 0);
  timings["render data"] = renderDataElapsed;
  printSsrTimings(timings, markStart() - ssrStart);
  return (
    <main className={dashboardTheme.page}>
      <div className={dashboardTheme.atmosphere} />
      <div className={dashboardTheme.grid} />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar showMobileNavigation={!mobileChatHomeEnabled} />

        {mobileChatHomeEnabled ? (
          <MobileChatHome featureFlagEnabled={mobileChatHomeEnabled} />
        ) : null}

        <section
          className={`flex-1 px-4 pt-5 pb-28 sm:px-8 lg:px-10 lg:py-9 ${
            mobileChatHomeEnabled ? "hidden lg:block" : ""
          }`}
        >
          <div className="space-y-4 lg:hidden">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-100">
                <Sparkles className="h-3.5 w-3.5" />
                Executive Workspace
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white">
                {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Your strategic reports, workspaces and AI spend are ready for review.
              </p>
            </div>

            <Link
              href={activeWorkspace ? `/dashboard/workspaces/${activeWorkspace.id}` : "/plan?new=1&mode=plan"}
              className="block rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Folder className="h-5 w-5 text-teal-200" />
                </div>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-medium text-zinc-400">
                  Active workspace
                </span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
                {activeWorkspace?.name || "Create your first workspace"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {activeWorkspaceContext}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
                <span className="text-sm text-zinc-500">
                  {activeWorkspace
                    ? `${activeWorkspace.reportCount} reports · ${formatDashboardDate(getWorkspaceActivityDate(activeWorkspace))}`
                    : "No workspace activity yet"}
                </span>
                <ArrowRight className="h-4 w-4 text-teal-200" />
              </div>
            </Link>

            <div className="grid gap-4">
              <Link
                href={latestCompletedReport ? `/dashboard/${latestCompletedReport.id}` : "/plan?new=1&mode=plan"}
                className="block rounded-[1.75rem] border border-white/10 bg-black/30 p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] transition duration-300 hover:border-teal-300/20 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                    <MessageSquareText className="h-4 w-4 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                      Decision Signal
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {latestCompletedReport?.title || "No completed report yet"}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xl font-semibold leading-7 text-white">
                  {decisionSignal}
                </p>
              </Link>

              <Link
                href={recommendedAction.href}
                className="block rounded-[1.75rem] border border-teal-300/20 bg-teal-300/[0.08] p-5 shadow-2xl shadow-teal-950/10 ring-1 ring-teal-200/10 transition duration-300 hover:border-teal-300/35 hover:bg-teal-300/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-100/75">
                      Recommended Next Action
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                      {recommendedAction.label}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {recommendedAction.detail}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-200 text-black">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            </div>

            <section className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                    Recent Reports
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-white">
                    Latest decision assets
                  </h2>
                </div>
                <Link
                  href="/plan?new=1&mode=plan"
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-white px-3 text-xs font-semibold text-black"
                >
                  New
                </Link>
              </div>
              <div className="mt-4 space-y-3">
                {recentReports.length ? (
                  recentReports.slice(0, 3).map((report) => {
                    const Icon = report.type === "Market Analysis" ? BarChart3 : FileText;

                    return (
                      <Link
                        key={`mobile-report-${report.id}`}
                        href={`/dashboard/${report.id}`}
                        className="flex min-h-20 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 shadow-lg shadow-black/10 transition duration-300 hover:border-teal-300/25 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                          <Icon className="h-4 w-4 text-teal-200" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">
                            {report.title}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500">
                            {report.type} · {formatDashboardDate(report.createdAt)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium capitalize text-zinc-300">
                          {report.status}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-black/25 p-5 text-sm leading-6 text-zinc-500">
                    No reports yet. Create a strategic report to start your decision history.
                  </p>
                )}
              </div>
            </section>

            <section className="overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3">
                {mobileMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="w-32 rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-4 shadow-xl shadow-black/20 ring-1 ring-white/[0.025]"
                  >
                    <p className="text-2xl font-semibold text-white">{metric.value}</p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                      {metric.label}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="hidden lg:block">
          <div className="overflow-hidden rounded-[2.35rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-2xl transition duration-500 hover:border-teal-300/15 hover:bg-white/[0.052]">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.1),transparent_34%),radial-gradient(circle_at_85%_20%,rgba(45,212,191,0.16),transparent_32%),radial-gradient(circle_at_12%_90%,rgba(255,255,255,0.045),transparent_28%)]" />
              <div className="relative">
                <div className="max-w-5xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold tracking-[0.24em] text-teal-100 shadow-lg shadow-teal-950/20 ring-1 ring-teal-200/10">
                    <Sparkles className="h-3.5 w-3.5" />
                    PERSONAL EXECUTIVE WORKSPACE
                  </div>
                  <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
                    {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-zinc-400">
                    Your decision intelligence workspace is organized around reports,
                    AI spend, active workspaces and the next strategic action.
                  </p>
                  <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Latest report
                      </p>
                      <p className="mt-2 truncate text-sm font-semibold text-white">
                        {latestReport?.title || "No report yet"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatDashboardDate(lastReportTime)}
                      </p>
                    </div>
                    <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Active workspace
                      </p>
                      <p className="mt-2 truncate text-sm font-semibold text-white">
                        {activeWorkspace?.name || "No active workspace"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {activeWorkspace
                          ? `${activeWorkspace.reportCount} reports`
                          : "Create a report to start"}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/plan?new=1&mode=plan"
                    className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <Plus className="h-4 w-4" />
                    Create Strategic Report
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="relative mt-8 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
                {["Strategic reports", "Decision workspaces", "PDF export"].map((item) => (
                  <div key={item} className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-400 shadow-lg shadow-black/10 ring-1 ring-white/[0.02]">
                    <BadgeCheck className="h-4 w-4 text-teal-200" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dashboardStats.map((stat) => {
              const Icon = stat.icon;
              const cardClass =
                "group relative min-h-[12.25rem] overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-teal-300/20 hover:bg-white/[0.065] hover:shadow-teal-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30";
              const accentClass =
                stat.tone === "emerald"
                  ? "border-emerald-300/20 bg-emerald-300/10"
                  : stat.tone === "amber"
                    ? "border-amber-300/20 bg-amber-300/10"
                    : stat.tone === "white"
                      ? "border-white/15 bg-white/[0.06]"
                      : stat.tone === "teal"
                        ? "border-teal-300/20 bg-teal-300/10"
                        : "border-zinc-400/15 bg-white/[0.04]";
              const cardContent = (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60" />
                  <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-teal-300/5 blur-2xl transition duration-300 group-hover:bg-teal-300/10" />
                  <div className="flex items-center justify-between gap-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-[1.05rem] border shadow-lg shadow-black/20 ring-1 ring-white/[0.025] ${accentClass}`}>
                      <Icon className="h-5 w-5 text-teal-200" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 shadow-sm shadow-black/10 transition duration-300 group-hover:border-teal-300/20 group-hover:text-teal-100">
                      Live
                    </span>
                  </div>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-zinc-500">
                    {stat.detail}
                  </p>
                </>
              );

              if (stat.href) {
                return (
                  <Link key={stat.label} href={stat.href} className={cardClass}>
                    {cardContent}
                  </Link>
                );
              }

              return (
                <article
                  key={stat.label}
                  className={cardClass}
                >
                  {cardContent}
                </article>
              );
            })}
          </div>

          {error ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Workspace data could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          {reportsError ? (
            <div className="mt-6 rounded-3xl border border-amber-300/20 bg-amber-950/20 p-5 text-sm leading-6 text-amber-100">
              Report history could not be loaded right now. Please refresh the page or try again shortly.
            </div>
          ) : null}

          <div className="mt-8 grid gap-5 2xl:grid-cols-[1.05fr_0.95fr]">
            <section id="reports" className="scroll-mt-6 rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                    Recent reports
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-white">
                    Continue the latest decisions.
                  </h2>
                </div>
                <Link
                  href="/plan?new=1&mode=plan"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-teal-300/15 bg-teal-300/[0.06] px-4 py-2 text-sm font-medium text-teal-100 shadow-lg shadow-teal-950/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/30 hover:bg-teal-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <Plus className="h-4 w-4" />
                  Create strategic report
                </Link>
              </div>

              <div className="mt-5 space-y-3">
                {recentReports.length ? (
                  recentReports.map((report) => {
                    const Icon = report.type === "Market Analysis" ? BarChart3 : FileText;

                    return (
                      <Link
                        key={report.id}
                        href={`/dashboard/${report.id}`}
                        className="group flex min-h-[5.75rem] flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-lg shadow-black/10 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.055] hover:shadow-teal-950/10 sm:flex-row sm:items-center"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                          <Icon className="h-5 w-5 text-teal-200" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-white">
                            {report.title}
                          </span>
                          <span className="mt-1 block text-sm text-zinc-500">
                            {report.type} · {formatDashboardDate(report.createdAt)}
                          </span>
                        </span>
                        <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium capitalize text-zinc-300 shadow-sm shadow-black/10">
                          {report.status}
                        </span>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/25 p-7 text-sm leading-6 text-zinc-500 shadow-inner shadow-black/20">
                    No reports yet. Create a strategic report to build
                    your first saved intelligence asset.
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-1">
              <Link
                href="/dashboard/billing"
                className="block min-h-[15rem] rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/15 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                    <WalletCards className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Subscription
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold capitalize tracking-[-0.02em] text-white">
                      {planLabel}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Billing is not connected yet. Your current limits are
                      applied through the ZERINIX usage governance system.
                    </p>
                  </div>
                </div>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-teal-100">
                  Manage billing
                  <ArrowRight className="h-4 w-4" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Usage state
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {usage.error ? "Needs review" : "Healthy"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Efficiency
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {usageEfficiency}
                    </p>
                  </div>
                </div>
              </Link>

              <div className="min-h-[15rem] rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.055] sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                    <Settings className="h-5 w-5 text-teal-200" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                      Settings
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white">
                      Account controls
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Authentication, saved reports and workspace data are
                      protected by Supabase. Advanced account settings will
                      appear here as billing and team features come online.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/usage"
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-200 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/25 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <TrendingUp className="h-4 w-4 text-teal-200" />
                  View usage details
                </Link>
              </div>
            </section>
          </div>

          <WorkspaceManager workspaces={workspaces} />
          </div>
        </section>
      </div>
    </main>
  );
}
