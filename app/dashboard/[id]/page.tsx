import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
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
  { label: "ARR", aliases: ["ARR", "Annual Recurring Revenue", "Revenue"] },
  { label: "MRR", aliases: ["MRR", "Monthly Recurring Revenue"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "Margin"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Burn"] },
  { label: "Runway", aliases: ["Runway"] },
  { label: "Payback", aliases: ["Payback", "Payback Period"] },
  { label: "EBITDA", aliases: ["EBITDA"] },
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
  { label: "Investment Needed", aliases: ["Investment Needed", "Investment"] },
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

const swotQuadrants = [
  { title: "Strengths", icon: CheckCircle2 },
  { title: "Weaknesses", icon: TriangleAlert },
  { title: "Opportunities", icon: Target },
  { title: "Threats", icon: TriangleAlert },
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`${escapedLabel}\\s*[:\\-–—]\\s*([^\\n|]+)`, "i")
  );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function extractMetricValueFromAliases(
  content: string,
  aliases: string[] | readonly string[]
) {
  for (const alias of aliases) {
    const value = extractMetricValue(content, alias);

    if (value) {
      return value;
    }
  }

  return "";
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

function extractConfidence(content: string) {
  const explicit = extractScore(content, "Confidence");

  if (explicit !== null) {
    return explicit;
  }

  const percentMatch = content.match(/\b(\d{1,3})\s*%/);
  const percent = Number(percentMatch?.[1] || NaN);

  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function extractSectionSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedTitle}\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:Strengths|Weaknesses|Opportunities|Threats|Worst|Base|Best|Revenue|MRR|Burn|Runway|Risk|Decision)\\s*[:\\-–—]|$)`,
      "i"
    )
  );

  return match?.[1]?.trim() || "";
}

function extractBullets(content: string, fallback: string) {
  const source = content || fallback;
  const bullets = source
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .slice(0, 3);

  return bullets.length > 0 ? bullets : [fallback];
}

function extractFirstInsight(content: string) {
  return (
    content
      .replace(/^#{1,6}\s+/gm, "")
      .split(/\n+/)
      .map((line) => line.trim().replace(/^[-*]\s+/, ""))
      .find((line) => line.length > 24) || ""
  );
}

function extractKeywordInsight(content: string, keywords: string[]) {
  const lines = content
    .replace(/^#{1,6}\s+/gm, "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 12);

  return (
    lines.find((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
    ) ||
    lines[0] ||
    ""
  );
}

function extractPercentScore(content: string, label: string) {
  const explicitScore = extractScore(content, label);

  if (explicitScore !== null) {
    return explicitScore;
  }

  const value = extractMetricValue(content, label);
  const percent = Number(value.match(/(\d{1,3})\s*%/)?.[1] || NaN);

  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function getDecisionClasses(decision: string) {
  if (decision === "GO" || decision === "RAISE" || decision === "BOOTSTRAP") {
    return "border-emerald-300/35 bg-emerald-300/15 text-emerald-100";
  }

  if (decision === "NO GO" || decision === "PIVOT") {
    return "border-red-300/30 bg-red-300/12 text-red-100";
  }

  if (decision === "WAIT") {
    return "border-amber-300/35 bg-amber-300/15 text-amber-100";
  }

  return "border-teal-200/30 bg-teal-200/12 text-teal-100";
}

function MiniProgressCircle({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const displayValue = value === null ? "TBD" : `${value}%`;
  const degrees = (value ?? 0) * 3.6;

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/30 p-4">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(rgb(94 234 212) ${degrees}deg, rgb(39 39 42) 0deg)`,
        }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white">
          {displayValue}
        </div>
      </div>
      {label ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
          {label}
        </p>
      ) : null}
    </div>
  );
}

function ExecutiveSummaryVisual({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  if (!title.toLowerCase().includes("executive summary")) {
    return null;
  }

  const score =
    extractScore(content, "AI Investment Score") ??
    extractScore(content, "AI Founder Score") ??
    extractConfidence(content);
  const recommendation = detectRecommendation(content) || "REVIEW";
  const highlights = [
    extractKeywordInsight(content, ["market", "pazar", "tam", "sam", "som"]),
    extractKeywordInsight(content, ["revenue", "gelir", "pricing", "fiyat"]),
    extractKeywordInsight(content, ["risk", "risk", "threat", "tehdit"]),
  ].filter(Boolean);
  const kpis = [
    {
      label: "Investment Score",
      value: score === null ? "TBD" : `${score}/100`,
      accent: "from-teal-200/25 to-cyan-200/5",
    },
    {
      label: "Decision",
      value: recommendation,
      accent: "from-emerald-300/20 to-teal-300/5",
    },
    {
      label: "Market Signal",
      value: extractMetricValue(content, "Market") || extractMetricValue(content, "TAM") || "Review",
      accent: "from-sky-300/18 to-teal-300/5",
    },
    {
      label: "Risk Posture",
      value: extractMetricValue(content, "Risk") || extractMetricValue(content, "Main Risk") || "Tracked",
      accent: "from-amber-300/18 to-teal-300/5",
    },
  ];

  return (
    <div className="mb-5 overflow-hidden rounded-[2rem] border border-teal-200/15 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))]">
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.35fr]">
        <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-200/75">
            Executive Command View
          </p>
          <div className="mt-5 flex items-end gap-4">
            <div
              className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(rgb(94 234 212) ${(score ?? 0) * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
              }}
            >
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border border-white/10 bg-black/70">
                <span className="text-3xl font-semibold tracking-tight text-white">
                  {score === null ? "--" : score}
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Score</span>
              </div>
            </div>
            <div>
              <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.18em] ${getDecisionClasses(recommendation)}`}>
                {recommendation}
              </span>
              <p className="mt-3 text-sm leading-6 text-zinc-300">
                {extractFirstInsight(content) || "Executive signal is being assembled."}
              </p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className={`rounded-3xl border border-white/10 bg-gradient-to-br ${kpi.accent} p-4`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  {kpi.label}
                </p>
                <p className="mt-3 line-clamp-2 text-2xl font-semibold tracking-tight text-white">
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              Executive Highlights
            </p>
            <div className="mt-3 grid gap-2">
              {(highlights.length > 0 ? highlights : [extractFirstInsight(content)]).map((highlight) => (
                <div key={highlight} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-300">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                  <span className="line-clamp-2">{highlight}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutiveInsightBanner({
  content,
}: {
  content: string;
}) {
  const insight = extractFirstInsight(content);
  const confidence = extractConfidence(content);

  if (!insight) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.1),rgba(255,255,255,0.025))] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/80">
            Investor Insight
          </p>
          <p className="mt-2 line-clamp-2 max-w-4xl text-lg font-medium leading-7 text-white">
            {insight}
          </p>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-300">
          Confidence {confidence === null ? "TBD" : `${confidence}%`}
        </div>
      </div>
    </div>
  );
}

function GaugeCircle({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(rgb(94 234 212) ${score * 3.6}deg, rgb(39 39 42) 0deg)`,
        }}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black text-lg font-semibold text-white">
          {score}
        </div>
      </div>
      <p className="mt-3 text-center text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
        {label}
      </p>
    </div>
  );
}

function ReportSectionVisual({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("tam / sam / som")) {
    const bars = [
      { label: "TAM", aliases: ["TAM"], width: "100%", color: "from-teal-200 to-cyan-100" },
      { label: "SAM", aliases: ["SAM"], width: "62%", color: "from-teal-400 to-teal-200" },
      { label: "SOM", aliases: ["SOM"], width: "28%", color: "from-emerald-400 to-teal-300" },
    ];

    return (
      <div className="mb-5 space-y-3 rounded-3xl border border-white/10 bg-white/[0.025] p-4">
        {bars.map((bar) => {
          const value = extractMetricValueFromAliases(content, bar.aliases);

          return (
            <div key={bar.label} className="grid grid-cols-[3rem_1fr] items-center gap-3">
              <p className="text-xs font-semibold tracking-[0.2em] text-zinc-400">{bar.label}</p>
              <div className="h-9 rounded-full bg-zinc-900 p-1">
                <div
                  className={`flex h-full items-center justify-between rounded-full bg-gradient-to-r ${bar.color} px-4 text-xs font-semibold text-black`}
                  style={{ width: bar.width }}
                >
                  <span>{bar.label}</span>
                  {value ? <span className="truncate pl-3">{value}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (normalizedTitle.includes("swot")) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {swotQuadrants.map(({ title: quadrantTitle, icon: Icon }) => {
          const snippet = extractSectionSnippet(content, quadrantTitle);
          const bullets = extractBullets(snippet, quadrantTitle);

          return (
            <div key={quadrantTitle} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                  <Icon className="h-4 w-4 text-teal-100" />
                </div>
                <p className="text-sm font-semibold text-white">{quadrantTitle}</p>
              </div>
              <ul className="mt-4 space-y-2">
                {bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2 text-sm leading-6 text-zinc-300">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  if (normalizedTitle.includes("financial dashboard")) {
    const benchmarkRows = [
      { metric: "Gross Margin", benchmark: "70%+ SaaS", status: "Quality" },
      { metric: "CAC", benchmark: "Payback-led", status: "Efficiency" },
      { metric: "Runway", benchmark: "18+ months", status: "Resilience" },
      { metric: "Payback", benchmark: "<12 months", status: "Velocity" },
    ];

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.12),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.015))]">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-200/75">
              Bloomberg-Style Financial Console
            </p>
            <p className="mt-2 text-sm text-zinc-400">
              Unit economics, runway and investor-readiness signals.
            </p>
          </div>
          <span className="w-fit rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-xs font-semibold text-teal-100">
            Live model
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {financialDashboardMetrics.map((metric, index) => {
            const value = extractMetricValueFromAliases(content, metric.aliases);

            return (
              <div key={metric.label} className="rounded-3xl border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                    {metric.label}
                  </p>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                    index % 3 === 0
                      ? "bg-teal-200 text-black"
                      : index % 3 === 1
                        ? "bg-amber-300/15 text-amber-200"
                        : "bg-white/10 text-zinc-300"
                  }`}>
                    {index % 3 === 0 ? "On track" : index % 3 === 1 ? "Watch" : "Model"}
                  </span>
                </div>
                <p className="mt-3 min-h-8 line-clamp-2 text-2xl font-semibold tracking-tight text-white">
                  {value || "TBD"}
                </p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-teal-200/80"
                    style={{ width: `${[78, 64, 72, 58, 70, 50, 66, 62, 54, 60, 48][index] || 60}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-teal-200/70">Investor KPI</p>
              </div>
            );
          })}
        </div>
        <div className="m-4 mt-0 overflow-hidden rounded-3xl border border-white/10 bg-black/35">
          <div className="grid grid-cols-4 border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            <span>Metric</span>
            <span>Current</span>
            <span>Benchmark</span>
            <span>Status</span>
          </div>
          {benchmarkRows.map((row) => (
            <div key={row.metric} className="grid grid-cols-4 gap-3 border-b border-white/10 px-4 py-3 text-sm last:border-b-0">
              <span className="font-medium text-white">{row.metric}</span>
              <span className="text-zinc-300">{extractMetricValue(content, row.metric) || "TBD"}</span>
              <span className="text-teal-100/80">{row.benchmark}</span>
              <span className="text-zinc-400">{row.status}</span>
            </div>
          ))}
        </div>
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
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scoredMetrics.map(({ metric, score }) => (
          <GaugeCircle key={metric} label={metric} score={score} />
        ))}
      </div>
    );
  }

  if (normalizedTitle.includes("scenario")) {
    const scenarioMetrics = ["Revenue", "MRR", "Burn", "Runway", "Risk", "Decision"];

    return (
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {["Worst", "Base", "Best"].map((scenario) => {
          const snippet = extractSectionSnippet(content, scenario);

          return (
            <div key={scenario} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <p className="text-lg font-semibold text-white">{scenario}</p>
              <div className="mt-4 space-y-2">
                {scenarioMetrics.map((metric) => (
                  <div key={metric} className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
                    <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">{metric}</span>
                    <span className="max-w-40 text-right text-sm font-medium text-zinc-200">
                      {extractMetricValue(snippet, metric) || "TBD"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (normalizedTitle.includes("executive recommendation") || normalizedTitle.includes("yönetici tavsiyesi")) {
    const selected = detectRecommendation(content);
    const decisions = ["GO", "NO GO", "WAIT", "PIVOT", "RAISE", "BOOTSTRAP"];
    const recommendationMetrics = [
      ["Confidence", extractConfidence(content) ? `${extractConfidence(content)}%` : "TBD"],
      ["Investment Needed", extractMetricValue(content, "Investment Needed") || "TBD"],
      ["Next Action", extractMetricValue(content, "Next Action") || extractMetricValue(content, "Next Critical Action") || "TBD"],
      ["Main Risk", extractMetricValue(content, "Main Risk") || "TBD"],
    ];

    return (
      <div className="mb-5 rounded-[2rem] border border-teal-200/20 bg-teal-200/[0.06] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
              Executive Recommendation
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-white">
              {selected || "TBD"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {decisions.map((decision) => {
              const active = selected === decision;

              return (
                <span
                  key={decision}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold tracking-[0.14em] ${
                    active
                      ? "border-teal-200/60 bg-teal-200 text-black"
                      : "border-white/10 bg-black/20 text-zinc-500"
                  }`}
                >
                  {decision}
                </span>
              );
            })}
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {recommendationMetrics.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("roadmap") || normalizedTitle.includes("yol haritası")) {
    return (
      <div className="mb-5 overflow-x-auto rounded-3xl border border-white/10 bg-white/[0.025] p-4">
        <div className="grid min-w-[780px] grid-cols-6 gap-3">
        {founderRoadmapSteps.map((step, index) => (
          <div key={step} className="relative rounded-2xl border border-white/10 bg-black/30 p-4">
            {index < founderRoadmapSteps.length - 1 ? (
              <div className="absolute left-[calc(100%-0.25rem)] top-1/2 hidden h-px w-4 bg-teal-200/40 md:block" />
            ) : null}
            <div className="flex flex-col gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="text-sm font-semibold text-white">{step}</p>
              <p className="text-xs leading-5 text-zinc-500">Milestone</p>
            </div>
          </div>
        ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("porter")) {
    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-5">
        {["Rivalry", "Entrants", "Buyer Power", "Supplier Power", "Substitutes"].map((force, index) => (
          <div key={force} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
            <p className="text-sm font-semibold text-white">{force}</p>
            <p className="mt-3 text-lg tracking-[0.08em] text-teal-200">
              {"★★★★★".slice(0, Math.max(2, 5 - (index % 3)))}
              <span className="text-zinc-700">{"★★★★★".slice(Math.max(2, 5 - (index % 3)))}</span>
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-teal-200/75" style={{ width: `${[72, 54, 66, 48, 60][index]}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">Force intensity</p>
          </div>
        ))}
      </div>
    );
  }

  if (normalizedTitle.includes("kpi")) {
    const kpiMetrics = ["Acquisition", "Activation", "Retention", "Gross Margin", "Payback", "Conversion"];

    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpiMetrics.map((metric) => (
          <div key={metric} className="grid grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
            <MiniProgressCircle label="" value={extractPercentScore(content, metric)} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
              <p className="mt-2 line-clamp-2 text-xl font-semibold text-white">
                {extractMetricValue(content, metric) || "Target"}
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-teal-200/80"
                  style={{ width: `${extractPercentScore(content, metric) ?? 66}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Analytics widget</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function hasReportSectionVisual(title: string) {
  const normalizedTitle = title.toLowerCase();

  return (
    normalizedTitle.includes("executive summary") ||
    normalizedTitle.includes("tam / sam / som") ||
    normalizedTitle.includes("swot") ||
    normalizedTitle.includes("financial dashboard") ||
    normalizedTitle.includes("founder score") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("scenario") ||
    normalizedTitle.includes("executive recommendation") ||
    normalizedTitle.includes("yönetici tavsiyesi") ||
    normalizedTitle.includes("roadmap") ||
    normalizedTitle.includes("yol haritası") ||
    normalizedTitle.includes("porter") ||
    normalizedTitle.includes("kpi")
  );
}

function getReportArticleClass(title: string) {
  const normalizedTitle = title.toLowerCase();
  const base =
    "relative overflow-hidden rounded-[1.75rem] border p-5 shadow-xl shadow-black/30";

  if (normalizedTitle.includes("executive summary")) {
    return `${base} border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.12),transparent_34%),rgba(0,0,0,0.62)]`;
  }

  if (normalizedTitle.includes("financial dashboard") || normalizedTitle.includes("kpi")) {
    return `${base} border-white/10 bg-[linear-gradient(135deg,rgba(10,10,10,0.92),rgba(20,83,75,0.16))]`;
  }

  if (normalizedTitle.includes("swot") || normalizedTitle.includes("porter") || normalizedTitle.includes("scenario")) {
    return `${base} border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.72),rgba(0,0,0,0.48))]`;
  }

  if (
    normalizedTitle.includes("executive recommendation") ||
    normalizedTitle.includes("yönetici tavsiyesi") ||
    normalizedTitle.includes("founder score") ||
    normalizedTitle.includes("kurucu skoru")
  ) {
    return `${base} border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.08),rgba(0,0,0,0.66))]`;
  }

  return `${base} border-white/10 bg-black/45`;
}

function AnalysisNotes({
  children,
  compact,
}: {
  children: ReactNode;
  compact: boolean;
}) {
  if (!compact) {
    return <>{children}</>;
  }

  return (
    <details className="group rounded-2xl border border-white/10 bg-black/25 p-4">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 transition hover:text-zinc-300">
        Full analysis notes
      </summary>
      <div className="mt-4 border-t border-white/10 pt-4">
        {children}
      </div>
    </details>
  );
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
                className={getReportArticleClass(section.title)}
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
                      <ExecutiveSummaryVisual
                        title={section.title}
                        content={section.content}
                      />
                      {hasReportSectionVisual(section.title) && !section.title.toLowerCase().includes("executive summary") ? (
                        <ExecutiveInsightBanner content={section.content} />
                      ) : null}
                      <ReportSectionVisual
                        title={section.title}
                        content={section.content}
                      />
                      <AnalysisNotes compact={hasReportSectionVisual(section.title)}>
                        <ReportText content={section.content} />
                      </AnalysisNotes>
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
