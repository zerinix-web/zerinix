import Link from "next/link";
import { ArrowRight, BarChart3, FileText, Rocket, TriangleAlert } from "lucide-react";
import type { DashboardWorkspace } from "@/app/dashboard/report-utils";
import {
  ContinueActivitySection,
  RecentProjectsSection,
  type MobileHomeReportSummary,
} from "@/components/mobile/MobileHomeSections";
import {
  MOBILE_NAV_CLEARANCE,
  MOBILE_SAFE_AREA_TOP,
} from "@/components/MobileNavigation";

// Mobile Home: an executive command center, not a second AI chat entry
// point. Free-form advisory lives on the Ask tab (/chat), which is the only
// surface with the full toolset (attachments, report memory, model choice,
// saved sessions) -- Home previously shipped a strictly smaller copy of it.
//
// Every value rendered here is real data already loaded server-side by
// app/dashboard/page.tsx for the desktop dashboard; this component performs
// no fetching and invents no metric. Where a number would be guesswork it is
// omitted rather than faked: report status in this codebase normalizes to
// "completed" or "failed" only (see normalizeReportSummary), so there is no
// honest "in progress" state to show.
//
// Layout rules follow the conventions the rest of the app now uses: the
// header owns the top safe-area inset, the screen root reserves the fixed
// MobileBottomNavigation once via the shared clearance constant, and the page
// scrolls with the document -- no fixed-height shell, no inner scroller, no
// spacer elements, no negative margins, no device-specific offsets.

const ANALYSIS_ACTIONS = [
  {
    label: "Business Idea Validation",
    description: "Pressure-test and sharpen a new venture.",
    href: "/plan?new=1&mode=plan",
    icon: Rocket,
  },
  {
    label: "Market Intelligence",
    description: "Map the market, customers and competitors.",
    href: "/plan?new=1&mode=market",
    icon: BarChart3,
  },
  {
    // Strategic Advisory is the planner's third analysis mode. Its mode is
    // chosen in the planner itself (app/plan/page.tsx only preseeds "plan"
    // and "market"), so this links to the real entry point rather than a
    // query parameter that would do nothing.
    label: "Strategic Advisory",
    description: "Turn context into an executive decision.",
    href: "/plan?new=1",
    icon: FileText,
  },
];

function SummaryMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[1.35rem] font-semibold leading-none tracking-[-0.02em] text-white">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11px] font-medium text-zinc-500">{label}</p>
    </div>
  );
}

export default function MobileHomeDashboard({
  workspaces,
  recentReports,
  completedReports,
  reportsNeedingAttention,
}: {
  workspaces: DashboardWorkspace[];
  recentReports: MobileHomeReportSummary[];
  completedReports: number;
  reportsNeedingAttention: number;
}) {
  const projectCount = workspaces.length;
  const hasAnyActivity =
    projectCount > 0 || completedReports > 0 || recentReports.length > 0;

  // Home scrolls with the document, exactly like every other mobile screen
  // (Account, Reports, Projects, Workspace detail).
  //
  // The shell that shipped before this -- a viewport-height column with an
  // inner scroll container -- could not work in the current native WebView.
  // Capacitor still runs contentInset "automatic", so UIKit, not WebKit,
  // applies the safe-area insets: the document is pushed down by the status
  // bar and the visible region is shorter than 100dvh by the top and bottom
  // insets combined, while env() still reports 0. A viewport-height shell
  // therefore ended below the visible region, so the SCROLLER-S OWN VIEWPORT,
  // not its content, sat off screen behind the fixed navigation. Scrolling
  // could never bring that strip up; only UIScrollView-s rubber-band shifts the whole
  // document, which is exactly why forcing the scroll revealed the last card
  // and releasing snapped it away again. Padding could not rescue it either:
  // WebKit excludes a scroll container-s own bottom padding from its
  // scrollable overflow, so that padding added no scroll range at all.
  //
  // Document scrolling has neither problem. UIKit-s contentInset.bottom is
  // part of the scroll view-s range, so the end of the document is always
  // reachable, and the clearance below is ordinary in-flow padding on a
  // growing block, which does count towards the document-s scroll height.
  //
  // The earlier belief that an ancestor clipped the document was wrong: `main`
  // is min-h-screen with auto height, so it grows with its content and its
  // overflow-hidden never triggers vertically -- which is why the four sibling
  // screens under that identical ancestor chain scroll to their end on this
  // same device. Home is now structurally identical to them, down to the
  // `section.flex-1` wrapper in app/dashboard/page.tsx.
  return (
    <div
      className={`relative min-h-dvh overflow-hidden text-white lg:hidden ${MOBILE_NAV_CLEARANCE}`}
    >
      <header
        className={`flex items-center gap-2.5 border-b border-white/[0.06] bg-black/40 px-4 pb-2.5 backdrop-blur-2xl ${MOBILE_SAFE_AREA_TOP}`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-[0.85rem] bg-white text-[10px] font-black tracking-[0.1em] text-black shadow-md shadow-white/5">
          ZX
        </span>
        <p className="text-[13px] font-bold leading-tight tracking-[0.14em] text-white">
          ZERINIX
        </p>
      </header>

      <div className="px-4 pb-6 pt-6">
        <section aria-label="Overview">
          <h1 className="max-w-[17rem] text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.04em] text-white">
            Your decision workspace
          </h1>
          <p className="mt-2 max-w-[19rem] text-[13px] leading-[1.45] text-zinc-400">
            Active projects, reports and analysis — ready to turn into
            decisions.
          </p>

          <div className="mt-5 rounded-[1.4rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_12px_32px_rgba(0,0,0,0.24)]">
            {hasAnyActivity ? (
              <>
                <div className="flex items-start gap-6">
                  {projectCount > 0 ? (
                    <SummaryMetric
                      value={projectCount}
                      label={projectCount === 1 ? "Project" : "Projects"}
                    />
                  ) : null}
                  {completedReports > 0 ? (
                    <SummaryMetric
                      value={completedReports}
                      label={completedReports === 1 ? "Report ready" : "Reports ready"}
                    />
                  ) : null}
                  {reportsNeedingAttention > 0 ? (
                    <SummaryMetric
                      value={reportsNeedingAttention}
                      label="Need attention"
                    />
                  ) : null}
                </div>

                {reportsNeedingAttention > 0 ? (
                  <Link
                    href="/dashboard/reports"
                    className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3.5 text-[12.5px] font-semibold text-amber-100 transition active:bg-amber-300/[0.12]"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">View priorities</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                ) : completedReports > 0 ? (
                  <Link
                    href="/dashboard/reports"
                    className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-[12.5px] font-semibold text-zinc-200 transition active:bg-white/[0.07]"
                  >
                    <span className="truncate">Browse reports</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
                  </Link>
                ) : null}
              </>
            ) : (
              <p className="text-[12.5px] leading-5 text-zinc-500">
                No analyses yet. Start with a validation, market study or
                advisory below — your projects and reports will collect here.
              </p>
            )}
          </div>
        </section>

        <section aria-label="Start an analysis" className="mt-7">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Start an analysis
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {ANALYSIS_ACTIONS.map((action) => {
              const Icon = action.icon;

              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex min-h-[6.5rem] flex-col items-start justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] p-2.5 text-left shadow-[0_12px_30px_rgba(0,0,0,0.22)] transition duration-200 active:-translate-y-0.5 active:scale-[0.97] active:border-teal-200/20 active:bg-white/[0.06]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-teal-200/15 bg-teal-200/[0.08] text-teal-100 transition duration-200 group-active:border-teal-200/30">
                    <Icon className="h-[0.9rem] w-[0.9rem]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold leading-[1.2] text-zinc-100">
                      {action.label}
                    </span>
                    <span className="mt-1 block overflow-hidden text-[10.5px] leading-[1.35] text-zinc-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                      {action.description}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <RecentProjectsSection workspaces={workspaces} />
        <ContinueActivitySection reports={recentReports} />
      </div>
    </div>
  );
}
