"use client";

// Extracted verbatim from components/Planner.tsx as an incremental
// modularization step: a self-contained "Benchmark Intelligence
// panel" responsibility. getBenchmarkFitLocale/localizeBenchmarkFitValue
// are only ever used by BenchmarkIntelligencePanel itself (both call
// sites lived inside this same cluster in Planner.tsx), so only
// BenchmarkIntelligencePanel is exported. No hooks, no dependency on
// Planner's own component state -- only its own props plus the
// already-imported localizePdfPresentationText utility.

import { localizePdfPresentationText } from "@/app/lib/pdf-normalization.mjs";
import type { PdfLocale } from "@/app/lib/pdf-engine/core";
import type { ReportBenchmarkFit, ReportBenchmarkScore } from "@/app/lib/report-investment-score";

function getBenchmarkFitLocale(source = "") {
  return /[çğıöşüÇĞİÖŞÜ]|\b(ve|için|pazar|müşteri|yatırım|doğrulama)\b/i.test(source)
    ? "tr"
    : "en";
}

function localizeBenchmarkFitValue(value = "", locale: PdfLocale) {
  if (locale !== "tr") {
    return value;
  }

  return localizePdfPresentationText(value, "tr")
    .replace(/\bStrong Fit\b/g, "Güçlü Uyum")
    .replace(/\bModerate Fit\b/g, "Orta Uyum")
    .replace(/\bNeeds Validation\b/g, "Doğrulama Gerekli")
    .replace(/\bHigh\b/g, "Yüksek")
    .replace(/\bMedium\b/g, "Orta")
    .replace(/\bLow\b/g, "Düşük")
    .replace(/\bNo direct customer, revenue, retention, or acquisition evidence was provided in the request\./g, "İstekte doğrudan müşteri, gelir, elde tutma veya edinim kanıtı sağlanmadı.")
    .replace(/\bBenchmark confidence is low for this business model and requires primary validation\./g, "Bu iş modeli için benchmark güveni düşük; birincil doğrulama gerektiriyor.")
    .replace(/\bBusiness model signal is broad, so benchmark selection may need refinement\./g, "İş modeli sinyali geniş; benchmark seçimi netleştirme gerektirebilir.")
    .replace(/\bBenchmark fit is based on detected industry, business model, geography, pricing model, and whether the prompt includes validation evidence\. It does not change financial calculations or scoring\./g, "Benchmark uyumu; tespit edilen sektör, iş modeli, coğrafya, fiyatlandırma modeli ve doğrulama kanıtına göre değerlendirilir. Finansal hesaplamaları veya skorlamayı değiştirmez.");
}

export function BenchmarkIntelligencePanel({
  benchmarkFit,
  benchmarkScore,
  sourceText,
}: {
  benchmarkFit?: ReportBenchmarkFit;
  benchmarkScore?: ReportBenchmarkScore;
  sourceText: string;
}) {
  if (!benchmarkFit && !benchmarkScore) {
    return null;
  }

  const locale = getBenchmarkFitLocale(sourceText);
  const labels =
    locale === "tr"
      ? {
          eyebrow: "Benchmark Zekası",
          title: "Benchmark Intelligence",
          overallFit: "Genel Uyum",
          industryFit: "Sektör Uyumu",
          businessModelFit: "İş Modeli Uyumu",
          geographyFit: "Coğrafya Uyumu",
          pricingFit: "Fiyatlandırma Uyumu",
          financialFit: "Finansal Uyum",
          fitLevel: "Uyum Seviyesi",
          industry: "Sektör",
          businessModel: "İş Modeli",
          confidence: "Benchmark Güveni",
          validationGaps: "Doğrulama Boşlukları",
          rationale: "Gerekçe",
          noGaps: "Belirgin doğrulama boşluğu yok.",
        }
      : {
          eyebrow: "Benchmark Intelligence",
          title: "Benchmark fit",
          overallFit: "Overall Fit",
          industryFit: "Industry Fit",
          businessModelFit: "Business Model Fit",
          geographyFit: "Geography Fit",
          pricingFit: "Pricing Fit",
          financialFit: "Financial Fit",
          fitLevel: "Fit Level",
          industry: "Industry",
          businessModel: "Business Model",
          confidence: "Benchmark Confidence",
          validationGaps: "Validation Gaps",
          rationale: "Rationale",
          noGaps: "No material validation gaps detected.",
        };
  const gaps = benchmarkFit?.validationGaps?.length ? benchmarkFit.validationGaps : [labels.noGaps];
  const summaryItems = [
    ...(benchmarkScore
      ? [
          { label: labels.overallFit, value: `${benchmarkScore.overallFit}/100` },
          { label: labels.industryFit, value: `${benchmarkScore.dimensions.industryFit}/100` },
          { label: labels.businessModelFit, value: `${benchmarkScore.dimensions.businessModelFit}/100` },
          { label: labels.geographyFit, value: `${benchmarkScore.dimensions.geographyFit}/100` },
          { label: labels.pricingFit, value: `${benchmarkScore.dimensions.pricingFit}/100` },
          { label: labels.financialFit, value: `${benchmarkScore.dimensions.financialBenchmarkFit}/100` },
          { label: labels.confidence, value: benchmarkScore.confidence || "—" },
        ]
      : [
          { label: labels.fitLevel, value: benchmarkFit?.fit || "—" },
          { label: labels.industry, value: benchmarkFit?.industry || "—" },
          { label: labels.businessModel, value: benchmarkFit?.businessModel || "—" },
          { label: labels.confidence, value: benchmarkFit?.confidence || "—" },
        ]),
  ];

  return (
    <section className="rounded-[2rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.075),rgba(255,255,255,0.025))] p-5 shadow-xl shadow-black/25 ring-1 ring-teal-200/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
            {labels.eyebrow}
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {labels.title}
          </h3>
        </div>
        <span className="w-fit rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1.5 text-xs font-semibold text-teal-100">
          {localizeBenchmarkFitValue(benchmarkScore ? `${benchmarkScore.overallFit}/100` : benchmarkFit?.fit || "—", locale)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {summaryItems.map((item) => (
          <div key={item.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {item.label}
            </p>
            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-zinc-100">
              {localizeBenchmarkFitValue(item.value, locale)}
            </p>
          </div>
        ))}
      </div>
      {benchmarkScore ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {locale === "tr" ? "En Büyük Boşluklar" : "Largest gaps"}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-zinc-300">
              {benchmarkScore.deviations
                .filter((deviation) => deviation.status !== "Within Benchmark")
                .slice(0, 3)
                .map((deviation) => (
                  <li key={`${deviation.metric}-${deviation.status}`} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-teal-300" />
                    <span>
                      {localizeBenchmarkFitValue(
                        `${deviation.metric}: ${deviation.userValue} vs ${deviation.benchmarkRange} (${deviation.status})`,
                        locale
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {locale === "tr" ? "Önerilen Aksiyonlar" : "Recommended actions"}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-zinc-300">
              {benchmarkScore.actions.slice(0, 3).map((action) => (
                <li key={action} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-teal-300" />
                  <span>{localizeBenchmarkFitValue(action, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {!benchmarkScore ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {labels.validationGaps}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
              {gaps.slice(0, 3).map((gap) => (
                <li key={gap} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span>{localizeBenchmarkFitValue(gap, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {labels.rationale}
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {localizeBenchmarkFitValue(benchmarkFit?.rationale || benchmarkFit?.benchmarkBasis || "—", locale)}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
