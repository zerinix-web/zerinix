"use client";

import { memo, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Download,
  FileText,
  Gauge,
  Goal,
  Landmark,
  ListChecks,
  Palette,
  PieChart,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

type ReportSection = {
  title: string;
  icon: LucideIcon;
  content: string;
};

type MarketReport = {
  executiveSummary: string;
  marketAnalysis: string;
  targetAudience: string;
  revenueModel: string;
  risks: string;
  roadmap90Days: string;
  successScore: string;
  sources: string;
};

type PlanReport = {
  executiveSummary: string;
  businessModel: string;
  targetCustomer: string;
  revenueModel: string;
  roadmap90Days: string;
  risks: string;
  firstCustomerStrategy: string;
  kpiMetrics: string;
  successScore: string;
};

type MarketReportField = keyof MarketReport;
type PlanReportField = keyof PlanReport;

type ReportStreamEvent = Partial<MarketReport & PlanReport> & {
  done?: boolean;
};

const reportActions = [
  { label: "Competitor Analysis", icon: Search },
  { label: "Financial Plan", icon: PieChart },
  { label: "Brand Strategy", icon: Palette },
  { label: "Export PDF", icon: Download },
];

const reportFields: Array<{
  field: MarketReportField;
  title: string;
  icon: LucideIcon;
}> = [
  { field: "executiveSummary", title: "Executive Summary", icon: Sparkles },
  { field: "marketAnalysis", title: "Market Analysis", icon: BarChart3 },
  { field: "targetAudience", title: "Target Audience", icon: Users },
  { field: "revenueModel", title: "Revenue Model", icon: Landmark },
  { field: "risks", title: "Risks", icon: ShieldAlert },
  { field: "roadmap90Days", title: "90-Day Roadmap", icon: CalendarDays },
  { field: "successScore", title: "AI Success Score (0-100)", icon: Gauge },
];

const planReportFields: Array<{
  field: PlanReportField;
  title: string;
  icon: LucideIcon;
}> = [
  { field: "executiveSummary", title: "Executive Summary", icon: Sparkles },
  { field: "businessModel", title: "Business Model", icon: BriefcaseBusiness },
  { field: "targetCustomer", title: "Target Customer", icon: Users },
  { field: "revenueModel", title: "Revenue Model", icon: Landmark },
  { field: "roadmap90Days", title: "90-Day Roadmap", icon: CalendarDays },
  { field: "risks", title: "Risks", icon: ShieldAlert },
  { field: "firstCustomerStrategy", title: "First Customer Strategy", icon: Goal },
  { field: "kpiMetrics", title: "KPI Metrics", icon: ListChecks },
  { field: "successScore", title: "AI Success Score", icon: Gauge },
];

const emptyMarketReport: MarketReport = {
  executiveSummary: "",
  marketAnalysis: "",
  targetAudience: "",
  revenueModel: "",
  risks: "",
  roadmap90Days: "",
  successScore: "",
  sources: "",
};

const emptyPlanReport: PlanReport = {
  executiveSummary: "",
  businessModel: "",
  targetCustomer: "",
  revenueModel: "",
  roadmap90Days: "",
  risks: "",
  firstCustomerStrategy: "",
  kpiMetrics: "",
  successScore: "",
};

function sanitizeReportContent(content: string) {
  return content
    .replace(/\n\s*(?:sources|kaynaklar)\s*:[\s\S]*$/im, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^\s)]+\)/gi, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s),]+/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const ReportPanel = memo(function ReportPanel({
  reportData,
  reportFields,
  reportTitle,
  result,
}: {
  reportData: Partial<MarketReport & PlanReport> | null;
  reportFields: Array<{
    field: keyof (MarketReport & PlanReport);
    title: string;
    icon: LucideIcon;
  }>;
  reportTitle: string;
  result: string;
}) {
  const sections = useMemo<ReportSection[]>(() => {
    if (reportData) {
      return reportFields.map(({ field, title, icon }) => ({
        title,
        icon,
        content:
          sanitizeReportContent(reportData[field] || "") ||
          "Bu bölüm için AI çıktısı bekleniyor.",
      }));
    }

    return result
      ? [
          {
            title: "Executive Summary",
            icon: Sparkles,
            content: sanitizeReportContent(result),
          },
        ]
      : [];
  }, [reportData, reportFields, result]);

  if (!reportData && !result) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-3xl border border-white/10 bg-zinc-950/70 p-8 text-center shadow-2xl shadow-black/40">
        <div>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <FileText className="h-5 w-5 text-teal-200" />
          </div>
          <p className="mt-5 text-lg font-semibold text-white">
            AI raporu burada hazırlanacak.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            İş fikrini yaz ve ZERINIX rapor panelini oluştur.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="max-h-[80vh] overflow-y-auto pr-1">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
            ZERINIX REPORT
          </p>
          <h2 className="mt-2 text-3xl font-bold text-white">
            {reportTitle}
          </h2>
        </div>
        <div className="rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm text-teal-100">
          AI Ready
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((section) => {
          const Icon = section.icon;

          return (
            <article
              key={section.title}
              className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/30"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <Icon className="h-5 w-5 text-teal-200" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {section.title}
                  </h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-300">
                    {section.content}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {reportActions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              type="button"
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-zinc-800"
            >
              <Icon className="h-4 w-4 text-teal-200" />
              {action.label}
            </button>
          );
        })}
      </div>
    </section>
  );
});

export default function Planner() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [marketReport, setMarketReport] = useState<MarketReport | null>(null);
  const [planReport, setPlanReport] = useState<PlanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  async function readStreamingResult(response: Response, fallbackMessage: string) {
    if (!response.ok || !response.body) {
      try {
        const data = await response.json();
        setResult(data.error || fallbackMessage);
      } catch {
        setResult(fallbackMessage);
      }

      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let frame: number | null = null;

    const scheduleResultUpdate = () => {
      if (frame !== null) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = null;
        setResult(output);
      });
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      output += decoder.decode(value, { stream: true });
      scheduleResultUpdate();
    }

    output += decoder.decode();
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }

    setResult(output || fallbackMessage);
  }

  async function readStreamingSectionJson(
    response: Response,
    onEvent: (event: ReportStreamEvent) => void,
    fallbackMessage: string,
    onFirstChunk?: () => void,
    fallbackField: keyof (MarketReport & PlanReport) = "executiveSummary"
  ) {
    if (!response.ok || !response.body) {
      try {
        const data = await response.json();
        onEvent({ [fallbackField]: data.error || fallbackMessage });
      } catch {
        onEvent({ [fallbackField]: fallbackMessage });
      }

      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let hasChunk = false;
    let buffer = "";

    const emitBufferedEvents = () => {
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
          continue;
        }

        try {
          const event = JSON.parse(trimmed) as ReportStreamEvent;

          if (!hasChunk && Object.values(event).some(Boolean)) {
            hasChunk = true;
            onFirstChunk?.();
          }

          onEvent(event);
        } catch {
          onEvent({ [fallbackField]: fallbackMessage });
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      emitBufferedEvents();
    }

    buffer += decoder.decode();
    emitBufferedEvents();

    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer.trim()) as ReportStreamEvent);
      } catch {
        onEvent({ [fallbackField]: fallbackMessage });
      }
    }
  }

  async function generatePlan() {
    setLoading(true);
    setResult("");
    setMarketReport(null);
    setPlanReport(emptyPlanReport);

    const reportOutput: PlanReport = { ...emptyPlanReport };
    let frame: number | null = null;
    let remainingSectionsStarted = false;
    let remainingSectionsPromise: Promise<void[]> = Promise.resolve([]);

    const renderReport = () => {
      setPlanReport({ ...reportOutput });
    };

    const scheduleReportRender = () => {
      if (frame !== null) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = null;
        renderReport();
      });
    };

    const streamField = async (
      field: PlanReportField,
      onFirstChunk?: () => void
    ) => {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, field }),
      });

      await readStreamingSectionJson(
        res,
        (event) => {
          const chunk = event[field];

          if (!chunk) {
            return;
          }

          reportOutput[field] += chunk;
          scheduleReportRender();
        },
        "Bu bölüm için AI çıktısı alınamadı.",
        onFirstChunk,
        field
      );
    };

    const startRemainingSections = () => {
      if (remainingSectionsStarted) {
        return;
      }

      remainingSectionsStarted = true;
      remainingSectionsPromise = Promise.all(
        planReportFields
          .slice(1)
          .map(({ field }) =>
            streamField(field).catch(() => {
              reportOutput[field] = "Bu bölüm için AI çıktısı alınamadı.";
              scheduleReportRender();
            })
          )
      );
    };

    try {
      await streamField("executiveSummary", startRemainingSections);
      startRemainingSections();
      await remainingSectionsPromise;

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      renderReport();
    } catch {
      setResult("Bir hata oluştu.");
      setPlanReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeMarket() {
    setAnalyzing(true);
    setResult("");
    setPlanReport(null);
    setMarketReport(emptyMarketReport);

    const reportOutput: MarketReport = { ...emptyMarketReport };
    let frame: number | null = null;
    let remainingSectionsStarted = false;
    let remainingSectionsPromise: Promise<void[]> = Promise.resolve([]);

    const renderReport = () => {
      setMarketReport({ ...reportOutput });
    };

    const scheduleReportRender = () => {
      if (frame !== null) {
        return;
      }

      frame = requestAnimationFrame(() => {
        frame = null;
        renderReport();
      });
    };

    const streamField = async (
      field: MarketReportField,
      onFirstChunk?: () => void
    ) => {
      const res = await fetch("/api/market-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, field }),
      });

      await readStreamingSectionJson(
        res,
        (event) => {
          const chunk = event[field];

          if (!chunk) {
            return;
          }

          reportOutput[field] += chunk;
          scheduleReportRender();
        },
        "Bu bölüm için AI çıktısı alınamadı.",
        onFirstChunk,
        field
      );
    };

    const startRemainingSections = () => {
      if (remainingSectionsStarted) {
        return;
      }

      remainingSectionsStarted = true;
      remainingSectionsPromise = Promise.all(
        reportFields
          .slice(1)
          .map(({ field }) =>
            streamField(field).catch(() => {
              reportOutput[field] = "Bu bölüm için AI çıktısı alınamadı.";
              scheduleReportRender();
            })
          )
      );
    };

    try {
      await streamField("executiveSummary", startRemainingSections);
      startRemainingSections();
      await remainingSectionsPromise;

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      renderReport();
    } catch {
      setResult("Pazar analizi sırasında bir hata oluştu.");
      setMarketReport(null);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white p-10">
      <div className="grid md:grid-cols-2 gap-8 mt-8">
        <div className="bg-zinc-900 rounded-3xl p-8">
          <p className="text-sm tracking-[6px] text-zinc-500 mb-6">
            ZERINIX PLANLAYICI
          </p>

          <h1 className="text-5xl font-bold leading-tight mb-8">
            Hedefini anlat,
            <br />
            ZERINIX yol haritanı hazırlasın.
          </h1>

          <p className="text-zinc-400 mb-6">
            İş fikrini, hedefini ve bütçeni yaz.
          </p>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-56 mt-8 rounded-2xl bg-zinc-800 p-5 outline-none resize-none"
            placeholder="Örneğin: ABD'de yapay zeka şirketi kurmak istiyorum."
          />

          <button
            onClick={generatePlan}
            disabled={loading}
            className="mt-6 w-full bg-white text-black py-4 rounded-2xl font-semibold disabled:opacity-60"
          >
            {loading ? "AI düşünüyor..." : "AI Plan Oluştur"}
          </button>

          <button
            onClick={analyzeMarket}
            disabled={analyzing}
            className="mt-4 w-full bg-zinc-700 text-white py-4 rounded-2xl font-semibold disabled:opacity-60"
          >
            {analyzing ? "Pazar analizi yapılıyor..." : "Pazar Analizi Yap"}
          </button>
        </div>

        <ReportPanel
          reportData={planReport || marketReport}
          reportFields={
            planReport
              ? planReportFields
              : (reportFields as Array<{
                  field: keyof (MarketReport & PlanReport);
                  title: string;
                  icon: LucideIcon;
                }>)
          }
          reportTitle={planReport ? "Business Plan Report" : "Business Intelligence Report"}
          result={result}
        />
      </div>
    </main>
  );
}
