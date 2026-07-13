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
import { CopySectionButton, ReportScrollProgress } from "./ReportViewerEnhancements";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
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
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
];

const mobilityFinancialDashboardMetrics = [
  { label: "Yearly Revenue", aliases: ["Yearly Revenue", "Annual Revenue", "ARR", "Revenue"] },
  { label: "Monthly Revenue", aliases: ["Monthly Revenue", "MRR"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "Margin"] },
  { label: "Rider CAC", aliases: ["Rider CAC", "CAC", "Customer Acquisition Cost"] },
  { label: "Rider LTV", aliases: ["Rider LTV", "LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Monthly Burn", "Burn"] },
  { label: "Runway", aliases: ["Runway"] },
  { label: "Payback", aliases: ["Payback", "Payback Period", "CAC Payback"] },
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
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
    new RegExp(
      `${escapedLabel}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|\\bformula\\b|\\bplanning input\\b|\\bevidence\\b|\\breference\\b|\\bconfidence\\b|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
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

function formatMetricCardValue(value: string) {
  const cleanValue = value.trim().replace(/\*\*/g, "");

  if (!cleanValue) {
    return "";
  }

  return cleanValue
    .split(/\b(?:formula|assumptions?|confidence|benchmark(?: source| comparison)?|explanation|justification|source)\b\s*[:\-–—]/i)[0]
    .split(/\s+(?:based on|using|assuming|calculated from|derived from)\s+/i)[0]
    .split(/\s*[;|]\s*/)[0]
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .trim();
}

function isMobilityReportContent(content: string) {
  return /\b(scooter|micromobility|micro mobility|shared mobility|bike sharing|bikeshare|per-ride|urban riders|commuters|fleet utilization|rental)\b/i.test(
    content
  );
}

function getFinancialDashboardMetrics(content: string) {
  return isMobilityReportContent(content)
    ? mobilityFinancialDashboardMetrics
    : financialDashboardMetrics;
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
      `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escapedTitle}(?:\\*\\*)?\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:Strengths|Weaknesses|Opportunities|Threats|Worst|Base|Best|Revenue|MRR|Monthly Revenue|Burn|Runway|Risk|Decision)(?:\\*\\*)?\\s*[:\\-–—]|$)`,
      "i"
    )
  );

  return match?.[1]?.trim() || "";
}

function extractBullets(content: string, fallback: string) {
  const source = content || "";
  const bullets = source
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .replace(new RegExp(`^${fallback}\\s*[:\\-–—]\\s*`, "i"), "")
        .trim()
    )
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line))
    .slice(0, 3);

  if (bullets.length > 0) {
    return bullets;
  }

  return source
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line))
    .slice(0, 2);
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
  const displayValue = value === null ? "—" : `${value}%`;
  const degrees = (value ?? 0) * 3.6;

  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-black/30 p-4 shadow-lg shadow-black/15 ring-1 ring-white/[0.02]">
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
      value: score === null ? "—" : `${score}/100`,
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
    <div className="mb-6 overflow-hidden rounded-[2.25rem] border border-teal-200/15 bg-[radial-gradient(circle_at_20%_10%,rgba(94,234,212,0.22),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(20,184,166,0.12),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.075),rgba(255,255,255,0.018))] shadow-2xl shadow-teal-950/10 ring-1 ring-teal-200/10">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-teal-200/75">
              Executive Summary
            </p>
            <h4 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Investment Decision Snapshot
            </h4>
          </div>
          <span className={`w-fit rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.18em] ${getDecisionClasses(recommendation)}`}>
            {recommendation}
          </span>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.35fr]">
        <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-200/75">
            AI Investment Score
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
                className={`min-h-32 rounded-3xl border border-white/10 bg-gradient-to-br ${kpi.accent} p-4 shadow-xl shadow-black/15 ring-1 ring-white/[0.02]`}
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
          <div className="mt-4 rounded-3xl border border-white/10 bg-black/30 p-4 shadow-inner shadow-black/25">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
              Executive Highlights
            </p>
            <div className="mt-3 grid gap-2">
              {(highlights.length > 0 ? highlights : [extractFirstInsight(content)]).map((highlight) => (
                <div key={highlight} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-300 shadow-sm shadow-black/10">
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
    <div className="mb-6 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.1),rgba(255,255,255,0.025))] p-4 shadow-xl shadow-black/15 ring-1 ring-teal-200/5">
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
          Confidence {confidence === null ? "—" : `${confidence}%`}
        </div>
      </div>
    </div>
  );
}

function GaugeCircle({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-lg shadow-black/15 ring-1 ring-white/[0.02]">
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
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.12),transparent_30%),rgba(255,255,255,0.025)] p-5">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
              Market Sizing Blocks
            </p>
            <p className="mt-2 text-sm text-zinc-400">TAM, SAM and SOM shown as investable opportunity layers.</p>
          </div>
          <div className="hidden h-16 w-16 rounded-full border border-teal-200/20 bg-teal-200/10 sm:block" />
        </div>
        <div className="space-y-4">
          {bars.map((bar) => {
            const value = extractMetricValueFromAliases(content, bar.aliases);

            return (
              <div key={bar.label} className="grid items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(7rem,auto)]">
                <div className="rounded-2xl border border-white/10 bg-black/35 p-3 text-center">
                  <p className="text-xs font-semibold tracking-[0.2em] text-zinc-400">{bar.label}</p>
                </div>
                <div className="h-14 rounded-2xl border border-white/10 bg-zinc-950 p-1.5">
                  <div
                    className={`h-full rounded-[1.1rem] bg-gradient-to-r ${bar.color} shadow-lg shadow-teal-950/20`}
                    style={{ width: bar.width }}
                  />
                </div>
                {value ? (
                  <p className="min-w-0 truncate whitespace-nowrap rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-right text-sm font-semibold text-white">
                    {formatMetricCardValue(value)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("market opportunity") || normalizedTitle.includes("market overview") || normalizedTitle.includes("market analysis")) {
    const opportunity = extractFirstInsight(content);
    const chartBars = [
      { label: "Demand", width: "82%", color: "bg-teal-200" },
      { label: "Timing", width: "68%", color: "bg-cyan-200" },
      { label: "Access", width: "56%", color: "bg-emerald-300" },
      { label: "Defensibility", width: "48%", color: "bg-amber-200" },
    ];

    return (
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.055] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Market Opportunity Chart
          </p>
          <p className="mt-3 line-clamp-3 text-xl font-semibold leading-8 text-white">
            {opportunity || "Opportunity signal is being evaluated."}
          </p>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-black/35 p-5">
          <div className="space-y-4">
            {chartBars.map((bar) => (
              <div key={bar.label}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">{bar.label}</span>
                  <span className="text-zinc-400">{bar.width}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${bar.color}`} style={{ width: bar.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("swot")) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {swotQuadrants.map(({ title: quadrantTitle, icon: Icon }) => {
          const snippet = extractSectionSnippet(content, quadrantTitle);
          const bullets = extractBullets(snippet || content, quadrantTitle);

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

  if (normalizedTitle.includes("business model")) {
    const blocks = [
      ["Value", extractKeywordInsight(content, ["value", "değer", "problem"])],
      ["Delivery", extractKeywordInsight(content, ["delivery", "product", "platform", "ürün"])],
      ["Revenue", extractKeywordInsight(content, ["revenue", "gelir", "subscription"])],
      ["Moat", extractKeywordInsight(content, ["moat", "defensible", "advantage", "rekabet"])],
    ];

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.045),rgba(94,234,212,0.05))] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Operating Model Canvas
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {blocks.map(([label, value], index) => (
            <div key={label} className="relative rounded-3xl border border-white/10 bg-black/35 p-4">
              <span className="absolute right-4 top-4 text-3xl font-semibold text-white/5">
                {index + 1}
              </span>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-200">{value || "Defined in analysis"}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("pricing")) {
    const tiers = [
      ["Entry", extractKeywordInsight(content, ["entry", "starter", "low", "başlangıç"])],
      ["Core", extractKeywordInsight(content, ["core", "standard", "main", "ana"])],
      ["Premium", extractKeywordInsight(content, ["premium", "enterprise", "high", "kurumsal"])],
    ];

    return (
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {tiers.map(([label, value], index) => (
          <div
            key={label}
            className={`rounded-[2rem] border p-5 ${
              index === 1
                ? "border-teal-200/30 bg-teal-200/[0.07]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Pricing Tier
            </p>
            <p className="mt-3 text-2xl font-semibold text-white">{label}</p>
            <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">{value || "Pricing signal"}</p>
          </div>
        ))}
      </div>
    );
  }

  if (normalizedTitle.includes("go-to-market") || normalizedTitle.includes("sales strategy") || normalizedTitle.includes("entry strategy")) {
    const stages = ["Audience", "Channel", "Conversion", "Expansion"];

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-black/35 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Go-To-Market Motion
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {stages.map((stage, index) => (
            <div key={stage} className="relative rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              {index < stages.length - 1 ? (
                <div className="absolute left-[calc(100%-0.25rem)] top-1/2 hidden h-px w-5 bg-teal-200/40 md:block" />
              ) : null}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="mt-4 text-sm font-semibold text-white">{stage}</p>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">
                {extractKeywordInsight(content, [stage]) || "Execution lever"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("unit economics") || normalizedTitle.includes("financial assumptions")) {
    const flow = isMobilityReportContent(content)
      ? ["Revenue", "Rider CAC", "Rider LTV", "Payback", "Runway"]
      : ["Revenue", "CAC", "LTV", "Payback", "Runway"];

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.025))]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Unit Economics Chain
          </p>
        </div>
        <div className="grid gap-px bg-white/10 md:grid-cols-5">
          {flow.map((metric) => (
            <div key={metric} className="bg-zinc-950/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
              <p className="mt-3 truncate whitespace-nowrap text-lg font-semibold text-white">
                {formatMetricCardValue(extractMetricValue(content, metric)) || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("competitor")) {
    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Competitive Positioning Map
        </p>
        <div className="relative mt-5 h-64 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(94,234,212,0.07))]">
          <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
          {[
            ["Incumbents", "24%", "32%"],
            ["Specialists", "70%", "30%"],
            ["ZERINIX Thesis", "58%", "62%"],
            ["Low-end", "28%", "75%"],
          ].map(([label, left, top], index) => (
            <div key={label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left, top }}>
              <div className={`h-4 w-4 rounded-full ${index === 2 ? "bg-teal-200" : "bg-white/35"}`} />
              <p className="mt-2 whitespace-nowrap rounded-full border border-white/10 bg-black/65 px-2 py-1 text-xs font-semibold text-zinc-200">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("financial dashboard")) {
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
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {getFinancialDashboardMetrics(content).map((metric, index) => {
            const value = formatMetricCardValue(
              extractMetricValueFromAliases(content, metric.aliases)
            );

            return (
              <div key={metric.label} className="flex min-h-32 min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-3.5 shadow-xl shadow-black/20">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    {metric.label}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${
                    index % 3 === 0
                      ? "bg-teal-200 text-black"
                      : index % 3 === 1
                        ? "bg-amber-300/15 text-amber-200"
                        : "bg-white/10 text-zinc-300"
                  }`}>
                    {index % 3 === 0 ? "On track" : index % 3 === 1 ? "Watch" : "Model"}
                  </span>
                </div>
                <div className="mt-4 min-w-0">
                  <p className="truncate whitespace-nowrap text-[clamp(1.15rem,2.2vw,1.65rem)] font-semibold leading-tight tracking-tight text-white">
                    {value || "—"}
                  </p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-teal-200/80"
                      style={{ width: `${[78, 64, 72, 58, 70, 50, 66, 62, 54, 60, 48][index] || 60}%` }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-teal-200/70">Investor KPI</p>
              </div>
            );
          })}
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
    const scenarioMetrics = isMobilityReportContent(content)
      ? ["Revenue", "Monthly Revenue", "Burn", "Runway", "Risk", "Decision"]
      : ["Revenue", "MRR", "Burn", "Runway", "Risk", "Decision"];
    const styles = {
      Worst: "border-red-300/20 bg-red-300/[0.055]",
      Base: "border-teal-200/20 bg-teal-200/[0.055]",
      Best: "border-emerald-300/20 bg-emerald-300/[0.06]",
    } as const;

    return (
      <div className="mb-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
        {["Worst", "Base", "Best"].map((scenario) => {
          const snippet = extractSectionSnippet(content, scenario);

          return (
            <div key={scenario} className={`rounded-3xl border p-4 ${styles[scenario as keyof typeof styles]}`}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold text-white">{scenario}</p>
                <span className="h-3 w-3 rounded-full bg-current text-teal-200" />
              </div>
              <div className="mt-4 space-y-2">
                {scenarioMetrics.map((metric) => (
                  <div key={metric} className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
                    <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">{metric}</span>
                    <span className="max-w-40 text-right text-sm font-medium text-zinc-200">
                      {extractMetricValue(snippet, metric) || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-black/35 p-5">
          <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            <span>Risk</span>
            <span>Return</span>
          </div>
          <div className="relative h-44 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(248,113,113,0.16),rgba(94,234,212,0.14))]">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
            <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
            {[
              { label: "Worst", left: "22%", top: "68%", color: "bg-red-300" },
              { label: "Base", left: "50%", top: "42%", color: "bg-teal-200" },
              { label: "Best", left: "76%", top: "22%", color: "bg-emerald-300" },
            ].map((point) => (
              <div key={point.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: point.left, top: point.top }}>
                <div className={`h-4 w-4 rounded-full ${point.color} shadow-lg shadow-black`} />
                <p className="mt-2 rounded-full bg-black/60 px-2 py-1 text-xs font-semibold text-white">{point.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("executive recommendation") || normalizedTitle.includes("yönetici tavsiyesi")) {
    const selected = detectRecommendation(content);
    const decisions = ["GO", "NO GO", "WAIT", "PIVOT", "RAISE", "BOOTSTRAP"];
    const recommendationMetrics = [
      ["Confidence", extractConfidence(content) ? `${extractConfidence(content)}%` : "—"],
      ["Investment Needed", extractMetricValue(content, "Investment Needed") || "—"],
      ["Next Action", extractMetricValue(content, "Next Action") || extractMetricValue(content, "Next Critical Action") || "—"],
      ["Main Risk", extractMetricValue(content, "Main Risk") || "—"],
    ];

    return (
      <div className="mb-5 rounded-[2.25rem] border border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_30%),rgba(94,234,212,0.06)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
              Executive Recommendation
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-white">
              {selected || "Review"}
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
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Confidence Meter</p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-teal-200" style={{ width: `${extractConfidence(content) ?? 50}%` }} />
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Next Actions Checklist</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {["Validate demand", "Protect runway", "Refine ICP", "Measure conversion"].map((action) => (
                <div key={action} className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="h-4 w-4 rounded-full border border-teal-200/40 bg-teal-200/10" />
                  {action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("roadmap") || normalizedTitle.includes("yol haritası")) {
    return (
      <div className="mb-5 overflow-x-auto rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.02))] p-5">
        <div className="relative grid min-w-[840px] grid-cols-6 gap-4">
        <div className="absolute left-8 right-8 top-8 h-px bg-gradient-to-r from-teal-200/10 via-teal-200/50 to-teal-200/10" />
        {founderRoadmapSteps.map((step, index) => (
          <div key={step} className="relative rounded-[1.4rem] border border-white/10 bg-black/45 p-4">
            <div className="flex flex-col gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-200 text-xs font-bold text-black">
                {index + 1}
              </span>
              <p className="text-sm font-semibold text-white">{step}</p>
              <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                {index < 2 ? "Priority" : index < 4 ? "Build" : "Scale"}
              </span>
            </div>
          </div>
        ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("porter")) {
    const forces = ["Rivalry", "Entrants", "Buyer Power", "Supplier Power", "Substitutes"];

    return (
      <div className="mb-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative flex min-h-72 items-center justify-center rounded-[2rem] border border-white/10 bg-[radial-gradient(circle,rgba(94,234,212,0.12),transparent_58%)]">
          <div className="absolute h-56 w-56 rounded-full border border-teal-200/10" />
          <div className="absolute h-40 w-40 rounded-full border border-teal-200/15" />
          <div className="absolute h-24 w-24 rounded-full border border-teal-200/20" />
          <div className="h-4 w-4 rounded-full bg-teal-200 shadow-[0_0_32px_rgba(94,234,212,0.55)]" />
          {forces.map((force, index) => {
            const positions = [
              ["50%", "8%"],
              ["82%", "30%"],
              ["70%", "78%"],
              ["30%", "78%"],
              ["18%", "30%"],
            ];

            return (
              <div
                key={force}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs font-semibold text-teal-100"
                style={{ left: positions[index][0], top: positions[index][1] }}
              >
                {force}
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {forces.map((force, index) => (
            <div key={force} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
              <p className="text-sm font-semibold text-white">{force}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-teal-200/75" style={{ width: `${[72, 54, 66, 48, 60][index]}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">Force intensity</p>
            </div>
          ))}
        </div>
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
    normalizedTitle.includes("market opportunity") ||
    normalizedTitle.includes("market overview") ||
    normalizedTitle.includes("market analysis") ||
    normalizedTitle.includes("business model") ||
    normalizedTitle.includes("competitor") ||
    normalizedTitle.includes("tam / sam / som") ||
    normalizedTitle.includes("swot") ||
    normalizedTitle.includes("financial dashboard") ||
    normalizedTitle.includes("financial assumptions") ||
    normalizedTitle.includes("founder score") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("scenario") ||
    normalizedTitle.includes("executive recommendation") ||
    normalizedTitle.includes("yönetici tavsiyesi") ||
    normalizedTitle.includes("roadmap") ||
    normalizedTitle.includes("yol haritası") ||
    normalizedTitle.includes("porter") ||
    normalizedTitle.includes("pricing") ||
    normalizedTitle.includes("go-to-market") ||
    normalizedTitle.includes("sales strategy") ||
    normalizedTitle.includes("entry strategy") ||
    normalizedTitle.includes("unit economics") ||
    normalizedTitle.includes("kpi")
  );
}

function getReportArticleClass(title: string) {
  const normalizedTitle = title.toLowerCase();
  const base =
    "relative overflow-hidden rounded-[1.85rem] border p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] transition duration-300 hover:-translate-y-0.5 hover:border-teal-300/20 hover:shadow-2xl hover:shadow-black/45 sm:p-6";

  if (normalizedTitle.includes("executive summary")) {
    return `${base} border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.13),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(0,0,0,0.64))]`;
  }

  if (normalizedTitle.includes("financial dashboard") || normalizedTitle.includes("kpi")) {
    return `${base} border-white/10 bg-[linear-gradient(135deg,rgba(10,10,10,0.92),rgba(20,83,75,0.17))]`;
  }

  if (normalizedTitle.includes("swot") || normalizedTitle.includes("porter") || normalizedTitle.includes("scenario") || normalizedTitle.includes("market")) {
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

  return `${base} border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.48))]`;
}

function AnalysisNotes({
  children,
  compact,
  label = "Full analysis notes",
}: {
  children: ReactNode;
  compact: boolean;
  label?: string;
}) {
  if (!compact) {
    return <>{children}</>;
  }

  return (
    <details className="group rounded-2xl border border-white/10 bg-black/25 p-4 shadow-inner shadow-black/25 ring-1 ring-white/[0.015] transition duration-300 open:bg-black/35">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 transition hover:text-zinc-300">
        <span>{label}</span>
        <span className="text-[10px] tracking-[0.16em] text-teal-200/60 transition group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-4 border-t border-white/10 pt-4">
        {children}
      </div>
    </details>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  const renderTextPart = (part: string, partKey: string) =>
    part.split(/(\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?)/g).map((segment, segmentIndex) => {
      const isNumberToken = /^\$?\d+(?:[.,]\d+)*(?:\.\d+)?\s?(?:k|K|m|M|b|B|%|months?|days?)?$/.test(
        segment
      );

      return (
        <span
          key={`${partKey}-${segmentIndex}`}
          className={isNumberToken ? "whitespace-nowrap" : undefined}
        >
          {segment}
        </span>
      );
    });

  return parts.map((part, partIndex) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`strong-${partIndex}-${part}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return renderTextPart(part, `${partIndex}-${part}`);
  });
}

type CitationData = {
  sourceTitle: string;
  organization: string;
  publicationYear?: string;
  confidence?: "High" | "Medium" | "Low";
  url?: string;
};

function normalizeCitationConfidence(value: string): CitationData["confidence"] | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === "high") {
    return "High";
  }

  if (normalized === "medium") {
    return "Medium";
  }

  if (normalized === "low") {
    return "Low";
  }

  return undefined;
}

function parseCitations(content: string): CitationData[] {
  if (/\bsource\s+unavailable\b/i.test(content)) {
    return [];
  }

  const fallbackConfidence = normalizeCitationConfidence(
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low)\b/i)?.[1] || ""
  );

  return content
    .split("\n")
    .map((rawLine) => {
      const url =
        rawLine.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() ||
        rawLine.match(/\bhttps?:\/\/[^\s)]+/i)?.[0]?.trim();
      const line = rawLine
        .replace(/^[-*•]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
        .replace(/\bhttps?:\/\/[^\s)]+/gi, "")
        .trim();

      return { line, url };
    })
    .map(({ line, url }): CitationData | null => {
      const citationMatch = line.match(
        /^([^—–|-]{2,80})\s*[—–-]\s*(.+?)(?:\s*\((\d{4})\))?(?:\s*[.;:]?\s*)?$/
      );

      if (!citationMatch) {
        return null;
      }

      const organization = citationMatch[1].trim();
      const sourceTitle = citationMatch[2]
        .replace(/\bconfidence\s*[:\-–—]\s*(high|medium|low)\b/i, "")
        .trim();
      const publicationYear = citationMatch[3]?.trim();

      if (!organization || !sourceTitle || /\bsource\s+unavailable\b/i.test(sourceTitle)) {
        return null;
      }

      return {
        sourceTitle,
        organization,
        ...(publicationYear ? { publicationYear } : {}),
        ...(fallbackConfidence ? { confidence: fallbackConfidence } : {}),
        ...(url ? { url } : {}),
      };
    })
    .filter((citation): citation is CitationData => Boolean(citation));
}

function CitationCard({ citation }: { citation: CitationData }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 shadow-lg shadow-black/15 ring-1 ring-white/[0.02] transition duration-300 hover:border-teal-200/20 hover:bg-white/[0.035]">
      <p className="text-sm font-semibold leading-6 text-white">{citation.sourceTitle}</p>
      <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
        <p>
          <span className="text-zinc-500">Publisher</span>
          <span className="ml-2 text-zinc-200">{citation.organization}</span>
        </p>
        {citation.publicationYear ? (
          <p>
            <span className="text-zinc-500">Year</span>
            <span className="ml-2 text-zinc-200">{citation.publicationYear}</span>
          </p>
        ) : null}
        {citation.confidence ? (
          <p>
            <span className="text-zinc-500">Confidence</span>
            <span className="ml-2 text-zinc-200">{citation.confidence}</span>
          </p>
        ) : null}
      </div>
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block truncate rounded-xl border border-teal-200/10 bg-teal-200/[0.045] px-3 py-2 text-xs text-teal-200/80 underline-offset-4 transition hover:border-teal-200/25 hover:text-teal-100 hover:underline"
        >
          {citation.url}
        </a>
      ) : null}
    </div>
  );
}

function CitationList({ content }: { content: string }) {
  const citations = parseCitations(content);

  if (citations.length === 0) {
    return <ReportText content={content} />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {citations.map((citation, index) => (
        <CitationCard
          key={`${citation.organization}-${citation.sourceTitle}-${citation.publicationYear || ""}-${citation.url || ""}-${index}`}
          citation={citation}
        />
      ))}
    </div>
  );
}

function ReportText({ content }: { content: string }) {
  const blocks = sanitizeAiResponseText(content)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6 text-[15px] leading-8 text-zinc-300 md:text-base md:leading-8">
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const isList = lines.every((line) => /^[-*]\s+/.test(line));
        const isTable = lines.length > 1 && lines.every((line) => line.startsWith("|") && line.includes("|"));
        const isCodeBlock = block.startsWith("```") && block.endsWith("```");

        if (isCodeBlock) {
          const code = block
            .replace(/^```[\w-]*\n?/, "")
            .replace(/\n?```$/, "")
            .trim();

          return (
            <pre
              key={`code-${blockIndex}-${code.slice(0, 24)}`}
              className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-black/55 p-4 text-sm leading-7 text-teal-100 shadow-inner shadow-black/40 ring-1 ring-white/[0.02]"
            >
              <code>{code}</code>
            </pre>
          );
        }

        if (isList) {
          return (
            <ul key={`list-${blockIndex}`} className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-zinc-300 shadow-inner shadow-black/15">
              {lines.map((line, lineIndex) => (
                <li key={`line-${blockIndex}-${lineIndex}-${line}`} className="flex gap-3 leading-7">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span className="min-w-0">{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</span>
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
            <div key={`table-${blockIndex}`} className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-black/25 shadow-xl shadow-black/15 ring-1 ring-white/[0.02]">
              <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                <thead className="bg-white/[0.07] text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <tr>
                    {headerRow?.map((cell, cellIndex) => (
                      <th key={`header-${blockIndex}-${cellIndex}-${cell}`} className="px-4 py-3 font-semibold text-zinc-300">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-zinc-300">
                  {bodyRows.map((row, rowIndex) => (
                    <tr key={`${row.join("-")}-${rowIndex}`} className="transition hover:bg-white/[0.025]">
                      {row.map((cell, cellIndex) => (
                        <td key={`${cell}-${cellIndex}`} className="px-4 py-3 align-top leading-7">
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
            <h3 key={`h3-${blockIndex}`} className="pt-4 text-lg font-semibold tracking-[-0.015em] text-white">
              {renderInlineMarkdown(block.slice(4))}
            </h3>
          );
        }

        if (block.startsWith("## ")) {
          return (
            <h2 key={`h2-${blockIndex}`} className="pt-4 text-xl font-semibold tracking-[-0.02em] text-white">
              {renderInlineMarkdown(block.slice(3))}
            </h2>
          );
        }

        return (
          <p key={`p-${blockIndex}`} className="max-w-4xl whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]">
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

  const uniqueReportSections = Array.from(
    new Map(report.sections.map((section) => [section.field || section.title, section])).values()
  );
  const visibleSections = uniqueReportSections.filter(
    (section) => !isSourceSectionTitle(section.title)
  );
  const sourceSections = uniqueReportSections.filter(
    (section) => isSourceSectionTitle(section.title) && section.content.trim()
  );
  const getReportSectionKey = (section: (typeof report.sections)[number]) =>
    `${report.id}:${section.field || section.title}`;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <ReportScrollProgress />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 py-5 sm:px-8 lg:px-10 lg:py-8">
          <div className="overflow-hidden rounded-[2.15rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/35 ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:border-teal-300/15 hover:bg-white/[0.048] sm:p-7">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm font-medium text-zinc-400 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/25 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Link>
                <p className="mt-6 text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                  ZERINIX REPORT
                </p>
                <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-[-0.035em] text-white md:text-5xl">
                  {report.title}
                </h1>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center md:shrink-0">
                <ReportPdfButton report={report} />
                <Link
                  href="/plan"
                  className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <Plus className="h-4 w-4" />
                  Create New Report
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Report Type</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.type}</p>
            </div>
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Created</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">
                {formatDate(report.createdAt)}
              </p>
            </div>
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-teal-200" />
                <p className="text-sm text-zinc-500">Status</p>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{report.status}</p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-[2.15rem] border border-white/10 bg-zinc-950/70 shadow-2xl shadow-black/50 ring-1 ring-white/[0.025]">
            <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] p-5 sm:p-7">
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                ZERINIX EXECUTIVE REPORT
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                {report.type}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                Structured analysis prepared for founder-level decision making.
              </p>
            </div>

            {visibleSections.length === 0 ? (
              <div className="p-5 sm:p-7">
                <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-black/35 p-8 text-center shadow-inner shadow-black/25">
                  <FileText className="mx-auto h-8 w-8 text-teal-200" />
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    No report sections saved yet
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
                    This report shell exists, but no readable analysis sections were saved.
                    Create a new report when you are ready to generate the full memo.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
                <aside className="xl:sticky xl:top-8 xl:self-start">
                  <nav className="rounded-[1.55rem] border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] backdrop-blur-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/75">
                          Contents
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {visibleSections.length} sections
                        </p>
                      </div>
                      <FileText className="h-5 w-5 text-teal-200" />
                    </div>
                    <div className="mt-4 max-h-[60vh] space-y-1 overflow-y-auto pr-1 [scrollbar-color:rgba(94,234,212,0.35)_transparent] [scrollbar-width:thin]">
                      {visibleSections.map((section, index) => (
                        <a
                          key={`toc-${getReportSectionKey(section)}`}
                          href={`#report-section-${index + 1}`}
                          className="group flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.06] hover:text-white"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-zinc-500 group-hover:border-teal-200/30 group-hover:text-teal-100">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="line-clamp-2">{section.title}</span>
                        </a>
                      ))}
                      {sourceSections.length > 0 ? (
                        <a
                          href="#report-sources"
                          className="group flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.06] hover:text-white"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-200/20 bg-teal-200/10 text-[11px] text-teal-100">
                            Ref
                          </span>
                          <span>Sources</span>
                        </a>
                      ) : null}
                    </div>
                  </nav>
                </aside>

                <div className="space-y-6">
                  {visibleSections.map((section, index) => {
                    const Icon = getSectionIcon(section.title);
                    const isFinancialDashboard = section.title
                      .toLowerCase()
                      .includes("financial dashboard");
                    const detailsContent = isFinancialDashboard ? "" : section.content;

                    return (
                      <article
                        id={`report-section-${index + 1}`}
                        key={getReportSectionKey(section)}
                        className={`${getReportArticleClass(section.title)} scroll-mt-8`}
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/30 to-transparent" />
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-white/5">
                            <Icon className="h-5 w-5 text-teal-200" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                                  Section {String(index + 1).padStart(2, "0")}
                                </span>
                                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white">
                                  {section.title}
                                </h2>
                              </div>
                              <CopySectionButton content={section.content} />
                            </div>
                            <div className="mt-5 border-t border-white/10 pt-5">
                              <ExecutiveSummaryVisual
                                title={section.title}
                                content={section.content}
                              />
                              {hasReportSectionVisual(section.title) &&
                              !section.title.toLowerCase().includes("executive summary") &&
                              !isFinancialDashboard ? (
                                <ExecutiveInsightBanner content={section.content} />
                              ) : null}
                              <ReportSectionVisual
                                title={section.title}
                                content={section.content}
                              />
                              {detailsContent.trim() ? (
                                <AnalysisNotes
                                  compact={hasReportSectionVisual(section.title)}
                                  label={isFinancialDashboard ? "Metric Details" : "Full analysis notes"}
                                >
                                  <ReportText content={detailsContent} />
                                </AnalysisNotes>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}

                  {sourceSections.length > 0 ? (
                    <article
                      id="report-sources"
                    className="scroll-mt-8 rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.045] p-5 shadow-xl shadow-black/30 ring-1 ring-teal-200/5 sm:p-6"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
                          <BookOpen className="h-5 w-5 text-teal-100" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
                                Research Appendix
                              </p>
                              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">
                                Sources
                              </h2>
                            </div>
                            <CopySectionButton
                              content={sourceSections.map((section) => section.content).join("\n\n")}
                              label="Copy sources"
                            />
                          </div>
                          <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                            {sourceSections.map((section) => (
                              <div
                                key={getReportSectionKey(section)}
                                className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0"
                              >
                                <CitationList content={section.content} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </article>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
