import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  FileText,
  Flag,
  Gauge,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../DashboardSidebar";
import { getAuthenticatedUser, loadUserReport } from "../report-utils";
import ReportPdfButton from "./ReportPdfButton";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "Tarih yok";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSourceSectionTitle(title: string) {
  return /^(sources|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(title.trim());
}

function getSectionIcon(title: string): LucideIcon {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("market") || normalizedTitle.includes("pazar")) {
    return BarChart3;
  }

  if (normalizedTitle.includes("customer") || normalizedTitle.includes("audience") || normalizedTitle.includes("müşteri")) {
    return Target;
  }

  if (normalizedTitle.includes("revenue") || normalizedTitle.includes("financial") || normalizedTitle.includes("pricing") || normalizedTitle.includes("gelir")) {
    return TrendingUp;
  }

  if (normalizedTitle.includes("risk")) {
    return TriangleAlert;
  }

  if (normalizedTitle.includes("roadmap") || normalizedTitle.includes("strategy") || normalizedTitle.includes("plan")) {
    return Flag;
  }

  if (normalizedTitle.includes("score") || normalizedTitle.includes("kpi")) {
    return Gauge;
  }

  if (isSourceSectionTitle(title)) {
    return BookOpen;
  }

  return FileText;
}

const financialDashboardMetrics = [
  "Revenue",
  "Expenses",
  "Gross Margin",
  "CAC",
  "LTV",
  "Payback Period",
  "Burn Rate",
  "Runway",
  "EBITDA",
  "Break-even Month",
  "Investment Needed",
];

const founderScoreMetrics = [
  "Overall Score",
  "Innovation",
  "Market Timing",
  "Competition",
  "Capital Intensity",
  "Execution Difficulty",
  "Revenue Potential",
  "Risk Level",
];

const founderRoadmapSteps = [
  "Tomorrow",
  "This Week",
  "30 Days",
  "90 Days",
  "180 Days",
  "12 Months",
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`${escapedLabel}\\s*[:\\-–—]\\s*([^\\n|]+)`, "i")
  );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function extractScore(content: string, label: string) {
  const value = extractMetricValue(content, label);
  const scoreMatch = value.match(/\b(\d{1,3})\b/);
  const fallbackMatch = content.match(
    new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]{0,30}(\\d{1,3})`, "i")
  );
  const rawScore = Number(scoreMatch?.[1] || fallbackMatch?.[1] || NaN);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  return Math.max(0, Math.min(100, rawScore));
}

function detectRecommendation(content: string) {
  const match = content.match(/\b(GO|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b/i);

  return match?.[1]?.toUpperCase() || "";
}

function ReportSectionVisual({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("financial dashboard")) {
    return (
      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {financialDashboardMetrics.map((metric) => {
          const value = extractMetricValue(content, metric);

          return (
            <div key={metric} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                {metric}
              </p>
              {value ? (
                <p className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                  {value}
                </p>
              ) : (
                <div className="mt-3 h-1.5 rounded-full bg-zinc-800">
                  <div className="h-full w-2/5 rounded-full bg-teal-200/70" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (normalizedTitle.includes("founder score") || normalizedTitle.includes("kurucu skoru")) {
    const scoredMetrics = founderScoreMetrics
      .map((metric) => ({ metric, score: extractScore(content, metric) }))
      .filter((item): item is { metric: string; score: number } => item.score !== null);

    if (scoredMetrics.length === 0) {
      return null;
    }

    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {scoredMetrics.map(({ metric, score }) => (
          <div key={metric} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-200">{metric}</p>
              <p className="text-sm font-semibold text-teal-100">{score}/100</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-gradient-to-r from-teal-300 to-white" style={{ width: `${score}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (normalizedTitle.includes("scenario")) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {["Worst Case", "Base Case", "Best Case"].map((scenario, index) => (
          <div key={scenario} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <p className="text-sm font-semibold text-white">{scenario}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-teal-200/80" style={{ width: `${[34, 62, 88][index]}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (normalizedTitle.includes("executive recommendation") || normalizedTitle.includes("yönetici tavsiyesi")) {
    const selected = detectRecommendation(content);
    const decisions = ["GO", "NO GO", "WAIT", "PIVOT", "RAISE", "BOOTSTRAP"];

    return (
      <div className="mb-5 flex flex-wrap gap-2">
        {decisions.map((decision) => {
          const active = selected === decision;

          return (
            <span
              key={decision}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.14em] ${
                active
                  ? "border-teal-200/60 bg-teal-200 text-black"
                  : "border-white/10 bg-white/[0.035] text-zinc-500"
              }`}
            >
              {decision}
            </span>
          );
        })}
      </div>
    );
  }

  if (normalizedTitle.includes("roadmap") || normalizedTitle.includes("yol haritası")) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-6">
        {founderRoadmapSteps.map((step, index) => (
          <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-200 text-[11px] font-bold text-black">
                {index + 1}
              </span>
              <p className="text-xs font-semibold text-white">{step}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={part} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return part;
  });
}

function ReportText({ content }: { content: string }) {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 text-[15px] leading-8 text-zinc-300">
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const isList = lines.every((line) => /^[-*]\s+/.test(line));
        const isTable = lines.length > 1 && lines.every((line) => line.startsWith("|") && line.includes("|"));

        if (isList) {
          return (
            <ul key={`list-${blockIndex}`} className="space-y-2.5 text-zinc-300">
              {lines.map((line) => (
                <li key={line} className="flex gap-3">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (isTable) {
          const rows = lines
            .filter((line) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
            .map((line) =>
              line
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((cell) => cell.trim())
            );
          const [headerRow, ...bodyRows] = rows;

          return (
            <div key={`table-${blockIndex}`} className="overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-white/[0.06] text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <tr>
                    {headerRow?.map((cell) => (
                      <th key={cell} className="px-4 py-3 font-semibold">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-zinc-300">
                  {bodyRows.map((row, rowIndex) => (
                    <tr key={`${row.join("-")}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${cell}-${cellIndex}`} className="px-4 py-3 align-top">
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.startsWith("### ")) {
          return (
            <h3 key={`h3-${blockIndex}`} className="pt-2 text-base font-semibold text-white">
              {renderInlineMarkdown(block.slice(4))}
            </h3>
          );
        }

        if (block.startsWith("## ")) {
          return (
            <h2 key={`h2-${blockIndex}`} className="pt-2 text-lg font-semibold text-white">
              {renderInlineMarkdown(block.slice(3))}
            </h2>
          );
        }

        return (
          <p key={`p-${blockIndex}`} className="max-w-4xl whitespace-pre-wrap break-words text-zinc-300">
            {renderInlineMarkdown(block)}
          </p>
        );
      })}
    </div>
  );
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const report = await loadUserReport(supabase, user, id);

  if (!report) {
    notFound();
  }

  const visibleSections = report.sections.filter(
    (section) => !isSourceSectionTitle(section.title)
  );
  const sourceSections = report.sections.filter(
    (section) => isSourceSectionTitle(section.title) && section.content.trim()
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-5 border-b border-white/10 pb-8 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Link>
              <p className="mt-6 text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                ZERINIX REPORT
              </p>
              <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight text-white md:text-5xl">
                {report.title}
              </h1>
            </div>

            <div className="flex flex-row items-center gap-3 md:shrink-0">
              <ReportPdfButton report={report} />
              <Link
                href="/plan"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
              >
                <Plus className="h-4 w-4" />
                Create New Report
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Report Type</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.type}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Created</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">
                {formatDate(report.createdAt)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Status</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.status}</p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/70 shadow-2xl shadow-black/50">
            <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5 sm:p-7">
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                ZERINIX EXECUTIVE REPORT
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                {report.type}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Structured analysis prepared for founder-level decision making.
              </p>
            </div>

            <div className="space-y-5 p-4 sm:p-5">
            {visibleSections.map((section, index) => {
              const Icon = getSectionIcon(section.title);

              return (
              <article
                key={section.title}
                className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/45 p-5 shadow-xl shadow-black/30"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/30 to-transparent" />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-white/5">
                    <Icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h2 className="text-xl font-semibold tracking-tight text-white">
                        {section.title}
                      </h2>
                      <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                        Section {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <ReportSectionVisual
                        title={section.title}
                        content={section.content}
                      />
                      <ReportText content={section.content} />
                    </div>
                  </div>
                </div>
              </article>
              );
            })}
            </div>

            {sourceSections.length > 0 ? (
              <div className="border-t border-white/10 p-4 sm:p-5">
                <article className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.045] p-5 shadow-xl shadow-black/30">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                      <BookOpen className="h-5 w-5 text-teal-100" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
                        Research Appendix
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">
                        Sources
                      </h2>
                      <div className="mt-4 space-y-5">
                        {sourceSections.map((section) => (
                          <div
                            key={section.title}
                            className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0"
                          >
                            <ReportText content={section.content} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
