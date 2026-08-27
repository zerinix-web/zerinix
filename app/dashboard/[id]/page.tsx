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
  MessageSquareText,
  Gauge,
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
import {
  CopySectionButton,
  MobileReportSection,
  RegenerateReportButton,
  ReportScrollProgress,
  ShareReportButton,
} from "./ReportViewerEnhancements";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  buildExecutiveSnapshot,
  getReportQualityBreakdown,
  getReportPresentationLabels,
  getSectionTakeaway,
  isExecutivePresentationSection,
  normalizeFounderReadinessScoreText,
  normalizeReportPresentationText,
  readFounderReadinessMetricValue,
  readFounderReadinessScoreValue,
  resolveCagrHeadlinePresentation,
  stripLeadingTakeawaySentence,
} from "@/app/lib/report-presentation";
import type {
  ReportBenchmarkFit,
  ReportBenchmarkScore,
  ReportInvestmentScore,
  ReportMetadata,
  ReportQualityScore,
  ReportValidationIntelligence,
} from "@/app/lib/report-investment-score";
import { readExecutiveDecisionIntelligenceSummary } from "@/app/lib/report-engine/executive-decision-intelligence-presentation";
import {
  getCanonicalDecisionLabel,
  resolveCanonicalDecisionFromReportText,
  resolveMarketIntelligenceExecutiveDecision,
} from "@/app/lib/report-engine/executive-decision-vocabulary";
import { localizedLabelVariants } from "@/app/lib/report-engine/executive-decision-brief";
import {
  detectPdfPresentationLocale,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
} from "@/app/lib/pdf-normalization.mjs";
import { getExecutiveRecommendationDisplayMetrics } from "@/app/lib/report-executive-recommendation.mjs";
import { createInsightSignature, describesSameInsight } from "@/app/lib/report-content-quality.mjs";
import {
  getEvidenceBadgeClass,
  getEvidenceLabel,
  inferEvidenceLevel,
  type EvidenceLevel,
  type EvidenceLocale,
} from "@/app/lib/report-evidence";
import { getResponseLanguage } from "@/app/lib/report-language";
import {
  buildLegalReportSections,
  formatLegalSourceContent,
  isLegalRenderableReport,
} from "@/app/lib/report-engine/legal-report-rendering";
import {
  isUniversalCustomerFacingSection,
  sanitizeMarketIntelligencePresentationText,
  stripReportPresentationArtifacts,
} from "@/app/lib/report-engine/report-presentation-sanitizer";

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
  return /^(sources|kaynaklar|verified sources|doğrulanmış kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(title.trim());
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
  { label: "Founder Readiness Score", aliases: ["Founder Readiness Score", "Kurucu Hazırlık Skoru", "Overall Score", "Genel Skor"] },
  { label: "Idea Quality", aliases: ["Idea Quality", "Fikir Kalitesi"] },
  { label: "Market Attractiveness", aliases: ["Market Attractiveness", "Pazar Çekiciliği"] },
  { label: "Business Model Quality", aliases: ["Business Model Quality", "İş Modeli Kalitesi"] },
  { label: "Validation Confidence", aliases: ["Validation Confidence", "Doğrulama Güveni"] },
  { label: "Execution Complexity", aliases: ["Execution Complexity", "executionComplexity", "Execution Difficulty", "executionDifficulty", "Execution", "Uygulama Karmaşıklığı", "Yürütme Karmaşıklığı", "Uygulama Zorluğu"] },
  { label: "Evidence Confidence", aliases: ["Evidence Confidence", "Kanıt Güveni"] },
  { label: "Founder Evidence", aliases: ["Founder Evidence", "Kurucu Kanıtı"] },
];

const founderScoreDimensionMetrics = founderScoreMetrics.filter(
  (metric) => metric.label !== "Founder Readiness Score"
);

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

// A labeled block (e.g. the text captured after "Top 3 Risks:") is often
// a multi-item bulleted/numbered list, not a single sentence -- too long
// for a compact KPI tile. Takes just the first real item, stripping its
// own bullet/number marker, rather than displaying the whole block
// verbatim or an arbitrary substring of it.
function takeFirstListItem(value: string) {
  const firstLine = value
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, "").replace(/^\(?\d{1,2}[).]\s*/, ""))
    .find(Boolean);

  return firstLine || value.trim();
}

// CRITICAL FIX -- confirmed live: TAM/SAM/SOM's own deterministic
// "Planning Estimate" backend (market-intelligence-graph.ts's
// buildPlanningEstimate) writes each layer as "TAM [Estimated]: $2.4M" --
// a bracketed classification tag sitting between the label and its colon
// that extractMetricValue's generic "label immediately followed by a
// colon" regex cannot see past. That silently read every Planning
// Estimate report as if TAM/SAM/SOM had never been stated at all: the
// card showed "Validation Needed" for a layer while the report's own text
// plainly stated a dollar figure two words later. Tries the existing
// "LABEL: value" extraction first (unchanged for the "verified figure"
// shape), then falls back to a pattern that tolerates an optional
// bracketed tag ([Estimated]/[Verified]/etc.) between the label and the
// colon -- never a new calculation, purely reading past a formatting
// detail the original regex didn't anticipate.
function extractMarketSizeCardValue(content: string, label: string) {
  const direct = extractMetricValueFromAliases(content, [label]);

  if (direct) {
    return direct;
  }

  // CRITICAL FIX -- confirmed live (second gap, beyond the [Estimated]
  // bracket tag above): the model's own natural prose also writes
  // "TAM (Total Addressable Market): USD 1.45B" -- a parenthetical
  // expansion of the label sitting between it and the colon, which
  // neither extractMetricValueFromAliases above nor the bracket-only
  // fallback below could see past, so the card fell back to "Validation
  // Needed" a second, different way even though the report's own text
  // plainly stated the figure. Strips "**" first (the model sometimes
  // bolds the label itself, e.g. "**TAM** (...)"), then tolerates an
  // optional "(...)" label expansion in addition to the existing
  // "[...]" tag, in either order.
  //
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure, UI/PDF canonical-data divergence): this exact
  // strategy is now also duplicated, verbatim in behavior, as the shared
  // extractMarketSizingLayerValue (report-presentation.ts) -- see that
  // function's own PARITY test for the proof the two stay identical.
  // Left as page.tsx's own copy (rather than delegated) to avoid
  // touching this file's extensively drift-tested internals; only
  // ReportPdfButton.tsx's independently-diverging extractor was the
  // actual source of the reported inconsistency and now calls the
  // shared function directly.
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content
    .replace(/\*\*/g, "")
    .match(
      new RegExp(`\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?[:\\-–—]\\s*([^\\n]*)`, "i")
    );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

// CRITICAL FIX -- do not reintroduce old fake-data behavior. TAM/SAM/SOM's
// bar widths were static, hardcoded percentages (100%/62%/28%) --
// identical for every report regardless of the actual figures -- rather
// than reflecting the real relationship between the three values. This
// parses the extracted value's number and unit (K/M/B/T or a spelled-out
// word) into a comparable magnitude so bar widths can be computed from
// what the report actually says.
//
// CRITICAL FIX -- confirmed live (root-cause pipeline repair): a range
// ("$2.1-2.8 billion") used to take its FIRST bound with a unit token
// required immediately adjacent to that first number -- since a shared
// trailing unit sits next to the SECOND number in this phrasing, the
// first number parsed with NO unit at all (e.g. magnitude 2.1 instead of
// 2,100,000,000). That silently broke the TAM >= SAM >= SOM nesting check
// against a correctly-parsed sibling layer, showing "Additional market
// validation is required" even though the report's own text was a
// complete, internally consistent, evidence-labeled estimate -- not a
// data problem, a parsing bug. Now takes the LAST number+unit found
// (matching the already-correct parseMarketSizeMagnitude used by the PDF
// exports/Planner.tsx for the identical field), which correctly resolves
// a shared trailing unit. Also matches the full unit word first so
// "thousand"/"trillion" (both starting with "t") can no longer collide.
function parseMonetaryMagnitude(value: string) {
  const matches = [...(value || "").matchAll(/([\d.,]+)\s*(thousand|million|billion|trillion|[kKmMbBtT])?/g)];
  const last = matches
    .filter((candidate) => candidate[1] && Number.isFinite(parseFloat(candidate[1].replace(/,/g, ""))))
    .at(-1);

  if (!last) {
    return null;
  }

  const num = parseFloat(last[1].replace(/,/g, ""));
  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "million"
        ? 1e6
        : unit === "b" || unit === "billion"
          ? 1e9
          : unit === "t" || unit === "trillion"
            ? 1e12
            : 1;

  return num * multiplier;
}

// tamSamSom's own prompt requires a "named scaling assumption" and
// calculation basis stated as prose next to each layer's own figure
// (e.g. "TAM (Germany, 2026) ~= EUR200-800 million [Estimated], based on
// population share of the OECD benchmark..."). This reads that real
// sentence back out -- the same "sentence containing the label" technique
// extractForceImplication uses for Porter's Five Forces -- rather than
// fabricating a generic assumption line when none exists.
function extractMarketSizeAssumption(content: string, label: string) {
  const match = content.match(new RegExp(`[^.\\n]*\\b${label}\\b[^.\\n]*\\.`, "i"));

  return match ? match[0].trim().replace(/^[-*•]\s+/, "") : "";
}

// tamSamSom's own prompt allows a transparent, benchmark-derived estimate
// when no verified local figure exists, explicitly requiring every such
// figure be labeled "[Estimated]" and "never presented as verified". This
// reads that real marker back out of the layer's own sentence, rather than
// assuming estimated status.
function isMarketSizeEstimated(content: string, label: string) {
  const sentence = extractMarketSizeAssumption(content, label);

  return /\[Estimated\]/i.test(sentence) || /\bPlanning Estimate\b/i.test(sentence);
}

const tamSamSomBarLabels = ["TAM", "SAM", "SOM"] as const;

// CRITICAL FIX -- confirmed live: the TAM/SAM/SOM per-layer bar visual
// (below) and the section-level evidence badge used two independent
// derivations that could disagree. The badge fell back to a naive
// keyword scan (inferEvidenceLevel) whose "value" input was the section's
// own static title whenever no metric line matched -- and the honest
// "insufficient evidence" notice copy itself (market-intelligence-graph.ts)
// contains the word "verified" ("A verified market-size figure ... could
// not be established"), which that keyword scan read as a positive
// signal and returned "Data Confirmed" even though TAM/SAM/SOM were all
// unresolved. Both now derive from this single, deterministic cascade so
// they can never diverge again: a layer only counts as resolved once
// every layer above it in the TAM >= SAM >= SOM hierarchy is also
// resolved, exactly mirroring the nesting rule the bar visual has always
// enforced.
function resolveTamSamSomCascade(content: string) {
  const values = tamSamSomBarLabels.map((label) => extractMarketSizeCardValue(content, label));
  const magnitudes = values.map((value) => parseMonetaryMagnitude(value));
  const tamResolved = magnitudes[0] !== null;
  const samResolved = tamResolved && magnitudes[1] !== null && magnitudes[1] <= (magnitudes[0] as number);
  const somResolved = samResolved && magnitudes[2] !== null && magnitudes[2] <= (magnitudes[1] as number);
  const allResolved = tamResolved && samResolved && somResolved;
  const anyEstimated =
    allResolved && tamSamSomBarLabels.some((label) => isMarketSizeEstimated(content, label));

  return { values, magnitudes, tamResolved, samResolved, somResolved, allResolved, anyEstimated };
}

// A section must never show "Data Confirmed" when TAM, SAM, or SOM is
// unresolved, pending its parent's validation, or only ever reached an
// [Estimated]/Planning Estimate figure -- a resolved-but-estimated stack
// is a planning estimate, not verified data, and must not read as
// confirmed either.
function getTamSamSomSectionEvidence(content: string): EvidenceLevel {
  const cascade = resolveTamSamSomCascade(content);

  if (!cascade.allResolved) {
    return "validationRequired";
  }

  return cascade.anyEstimated ? "benchmarkDerived" : "verified";
}

function formatMetricCardValue(value: string) {
  const cleanValue = value.trim().replace(/\*\*/g, "");

  if (!cleanValue) {
    return "";
  }

  return cleanValue
    .split(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|benchmark(?: source| comparison)?|raw benchmark context|explanation|justification|source)\b\s*[:\-–—=]/i)[0]
    .split(/\s+(?:based on|using|assuming|calculated from|derived from)\s+/i)[0]
    .split(/\s*[;|]\s*/)[0]
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .trim();
}

function cleanEvidenceMetadataForDisplay(content: string) {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      return !/^(?:[-*•]\s*)?(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=]/i.test(trimmed);
    })
    .map((line) =>
      line
        .replace(/\s*\|\s*(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=][^|\n]+/gi, "")
        .replace(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmarkSource|benchmark)\s*=\s*[^|;\n]+/gi, "")
        .replace(/\bplanning assumptions require validation\b[.;]?/gi, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getDashboardEvidenceLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return getEvidenceLabel(level, locale);
}

// PRODUCTION DATA PROVENANCE POLISH -- standardized to exactly three
// user-facing categories across Financial Dashboard, Unit Economics, and
// KPI Dashboard: Verified (falls through to getDashboardEvidenceLabel
// below), Derived (a value calculated only from verified data, e.g. ARR
// from a stated MRR -- never shown as Verified), and Benchmark /
// Assumption (a single, consolidated label -- the reader does not need
// to distinguish an industry benchmark from a planning assumption from
// an AI estimate to know the one thing that matters: this number was not
// supplied or derived from what was supplied). Distinct wording only,
// never a change to the underlying EvidenceLevel/[Verified]/[Estimated]/
// [Assumption] tag vocabulary the AI is prompted with and
// report-evidence-confidence.ts parses, which must stay exactly as-is.
const financialEvidenceBadgeLabels: Partial<Record<EvidenceLevel, Record<EvidenceLocale, string>>> = {
  // CRITICAL FIX -- "Verified" reads as an internal audit-tool label on
  // a financial metric card. This financial-only display wrapper (see
  // the comment above) already renames every non-verified tier; the
  // verified tier previously had no override and fell through to the
  // literal word. Naming it after the founder is also more informative
  // here specifically: a founder-stated financial figure (price,
  // investment, customer count) is what "verified" means in this
  // context, not third-party source verification.
  verified: {
    English: "Founder-Confirmed",
    Turkish: "Kurucu Onaylı",
    German: "Vom Gründer bestätigt",
    French: "Confirmé par le fondateur",
    Spanish: "Confirmado por el fundador",
  },
  derived: {
    English: "Derived",
    Turkish: "Türetilmiş",
    German: "Abgeleitet",
    French: "Dérivé",
    Spanish: "Derivado",
  },
  benchmarkDerived: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
  planningAssumption: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
  validationRequired: {
    English: "Benchmark / Assumption",
    Turkish: "Benchmark / Varsayım",
    German: "Benchmark / Annahme",
    French: "Référence / Hypothèse",
    Spanish: "Referencia / Supuesto",
  },
};

function getFinancialEvidenceBadgeLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return financialEvidenceBadgeLabels[level]?.[locale] ?? getDashboardEvidenceLabel(level, locale);
}

// CRITICAL FIX -- remove internal system language from user-facing
// Market Intelligence output. The bare "Verified"/"Estimated"/
// "Assumption"/"AI Analysis" evidence-tier words (report-evidence.ts)
// are a deliberate, tested, cross-report-kind taxonomy and are left
// exactly as-is there -- this is a Market-Intelligence-only display
// wrapper, the same established pattern as financialEvidenceBadgeLabels
// above, so Business Plan and Acquisition's section badges are
// unaffected.
const marketEvidenceBadgeLabels: Partial<Record<EvidenceLevel, Record<EvidenceLocale, string>>> = {
  verified: {
    English: "Data Confirmed",
    Turkish: "Veri Onaylandı",
    German: "Daten bestätigt",
    French: "Données confirmées",
    Spanish: "Datos confirmados",
  },
  derived: {
    English: "Derived",
    Turkish: "Türetilmiş",
    German: "Abgeleitet",
    French: "Dérivé",
    Spanish: "Derivado",
  },
  benchmarkDerived: {
    English: "Market Support",
    Turkish: "Pazar Desteği",
    German: "Marktunterstützung",
    French: "Support de marché",
    Spanish: "Respaldo de mercado",
  },
  planningAssumption: {
    English: "Key Assumption",
    Turkish: "Temel Varsayım",
    German: "Kernannahme",
    French: "Hypothèse clé",
    Spanish: "Suposición clave",
  },
  validationRequired: {
    English: "Validation Status",
    Turkish: "Doğrulama Durumu",
    German: "Validierungsstatus",
    French: "Statut de validation",
    Spanish: "Estado de validación",
  },
};

function getMarketEvidenceBadgeLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return marketEvidenceBadgeLabels[level]?.[locale] ?? getDashboardEvidenceLabel(level, locale);
}

// CRITICAL FIX -- do not present a planning assumption as actual
// performance. A founder-confirmed figure (evidence === "verified") is
// shown under its plain name; anything modeled or benchmark-derived is
// prefixed so the card title itself, not just the badge next to it,
// makes clear this is a scenario/estimate rather than a reported
// result. The prefix is chosen by what kind of figure it is: top-line
// revenue metrics read "Estimated", unit-economics ratios read
// "Planning", and forward-looking timing metrics (which are inherently
// scenario-dependent) read "Scenario".
function getFinancialMetricDisplayLabel(metricLabel: string, evidence: EvidenceLevel) {
  if (evidence === "verified") {
    return metricLabel;
  }

  const normalized = metricLabel.toLowerCase();
  if (/revenue|\barr\b|\bmrr\b/.test(normalized)) {
    return `Estimated ${metricLabel}`;
  }
  if (/runway|break-even|break even/.test(normalized)) {
    return `Scenario ${metricLabel}`;
  }
  return `Planning ${metricLabel}`;
}

function EvidenceBadge({
  level,
  locale = "English",
  financial = false,
  market = false,
}: {
  level: EvidenceLevel;
  locale?: EvidenceLocale;
  financial?: boolean;
  market?: boolean;
}) {
  return (
    <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getEvidenceBadgeClass(level)}`}>
      {financial
        ? getFinancialEvidenceBadgeLabel(level, locale)
        : market
          ? getMarketEvidenceBadgeLabel(level, locale)
          : getDashboardEvidenceLabel(level, locale)}
    </span>
  );
}

function getDashboardMetricEvidence(label: string, value: string, content: string): EvidenceLevel {
  return inferEvidenceLevel({
    label,
    value,
    context: `${content}\n${extractMetricValue(content, "Evidence")}`,
  });
}

// P0 FIX -- confirmed live (source/evidence integrity repair): a Market
// Intelligence field like `cagr` can legitimately contain MULTIPLE
// independently-classified evidence items on separate lines (graph.cagr in
// market-intelligence-graph.ts computes confidenceClassification per item,
// e.g. one evidence sentence using "forecast" language classifies
// [Estimated] while another, differently-worded sentence about the SAME
// market classifies [Verified]). getDashboardMetricEvidence's own
// inferEvidenceLevel call scans the ENTIRE multi-line content for the word
// "verified" -- so whenever the headline value extracted by
// extractHeadlineCagrValue/extractHeadlineMonetaryValue happens to come
// from the [Estimated] line (array order is research-discovery order, not
// sorted by classification), the card still shows "Data Confirmed" purely
// because a DIFFERENT line elsewhere in the same field happens to be
// [Verified] -- a source that supports a DIFFERENT claim being used to
// confirm this one. Isolating evidence-level detection to the single line
// that actually contains the extracted headline value (falling back to the
// full content when no single line contains it, e.g. unstructured model
// prose with no graph-derived per-item tags) ties the badge to the exact
// claim actually displayed, never a claim merely present somewhere else in
// the same field.
function extractEvidenceLineForValue(content: string, value: string): string {
  if (!value) return content;
  const lines = (content || "").split("\n");
  const matchingLine = lines.find((line) => line.includes(value));
  return matchingLine ?? content;
}

function getDashboardSectionEvidence(section: { field?: string; title: string; content: string }): EvidenceLevel {
  const field = section.field?.toLowerCase() || "";
  const title = section.title.toLowerCase();

  if (field.includes("source") || title.includes("source") || title.includes("kaynak")) {
    return "verified";
  }

  // TAM/SAM/SOM gets its own canonical cascade-based derivation (see
  // resolveTamSamSomCascade's own comment) -- split out from the
  // "financial" branch below, which keeps its prior, unrelated Gross
  // Margin-based derivation unchanged for Business Plan's Financial
  // Dashboard section.
  if (field.includes("tam") || title.includes("tam / sam / som")) {
    return getTamSamSomSectionEvidence(section.content);
  }

  if (field.includes("financial") || title.includes("financial") || title.includes("finansal")) {
    return getDashboardMetricEvidence(
      section.title,
      extractMetricValue(section.content, "Gross Margin") || section.title,
      section.content
    );
  }

  if (field.includes("kpi") || title.includes("kpi")) {
    return "validationRequired";
  }

  if (field.includes("competitor") || title.includes("competitor") || title.includes("market") || title.includes("pazar")) {
    return "benchmarkDerived";
  }

  if (field.includes("executive") || title.includes("executive") || title.includes("summary")) {
    return getDashboardMetricEvidence(section.title, extractMetricValue(section.content, "Decision") || section.title, section.content);
  }

  return "planningAssumption";
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

// FINAL PREMIUM REPORT RESTORATION -- Market Drivers/Barriers/
// Opportunities/Threats/Customer Segments/Major Players have no separate
// "methodology" the way TAM/SAM/SOM's formulas or Strategic
// Recommendations' owner/budget do -- their generated content IS the
// primary insight, so it must be visible without opening Details, not
// collapsed away. Deliberately strict (no sentence-splitting fallback,
// unlike extractBullets): only lines that already carry a real bullet/
// numbered marker in the model's own output count as "multiple items" --
// never fabricated by chopping prose into fake list items. Capped
// generously (8, not the old 4) so a genuinely longer ranked list is
// never silently cut -- this card is now the section's ONLY presentation
// (no more "Details" underneath to fall back on for the rest).
function extractRealBulletLines(content: string, limit = 8) {
  return (content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, limit);
}

// The "main explanation" paragraph shown alongside the Key Takeaway --
// genuinely different text, not a restatement. getSectionTakeaway already
// returns the content's first sentence (normalized through its own,
// separate text-cleaning pipeline, and truncated with "..." past 220
// chars) -- a literal string-match-and-remove against that value would
// silently fail whenever either of those differ from this function's own
// cleaning, leaving the "removed" sentence back in and restating it here.
// Skipping by INDEX instead is robust regardless of any such mismatch:
// whenever a takeaway was found at all, it corresponds to this content's
// own first sentence, so the explanation simply starts one sentence later.
// Bullet-marked lines are excluded from the sentence pool -- those are
// surfaced separately by extractRealBulletLines, and including them here
// too would show the same list item twice. Deliberately UNCAPPED (no
// sentence-count or character-length ceiling): this card is now this
// section's complete, only presentation, so it must carry every remaining
// sentence, not a truncated teaser, or real analysis would be silently
// lost now that there is no "Details" disclosure left to fall back on.
function extractSectionMainExplanation(content: string, takeaway: string) {
  const cleaned = (content || "").replace(/\*\*/g, "").replace(/^#{1,6}\s+.*$/gm, "");
  const proseOnly = cleaned
    .split("\n")
    .filter((line) => !/^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .join(" ");
  const sentences = proseOnly
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/^[-*•]\s+/, ""))
    .filter((sentence) => sentence.length > 20);
  const startIndex = takeaway ? 1 : 0;

  return sentences.slice(startIndex).join(" ");
}

// CRITICAL FIX -- restore Market Intelligence's Market Metrics cards.
// marketSize/cagr are free-flowing analytical prose (their prompts never
// require a literal "Market Size:"/"CAGR:" label line the way
// tamSamSom's three sub-values do), so extractMetricValue's strict
// "Label: value" match would almost always come back empty here. These
// extractors instead find the first genuinely-present currency amount /
// percentage in the section's own content -- never a fabricated number,
// and the caller falls back to a premium "Validation Needed" empty state
// when nothing is found, per this ticket's explicit requirement not to
// paper over missing data with invented figures.
// CRITICAL FIX -- confirmed live (root-cause pipeline repair): this
// regex never recognized "£" (only €/$/₺), nor a spelled-out currency
// CODE ("USD 1.2 billion") -- a correctly-generated, correctly-sourced
// GBP or code-labeled figure would silently render "Validation Needed"
// purely because of currency notation, not because evidence was
// missing. Tolerates the same common codes already added for TAM/SAM/SOM
// elsewhere in this file.
// CRITICAL FIX -- confirmed live: a pricing/ARPA/per-customer dollar
// figure mentioned in marketSize's own free-flowing prose (e.g. "SMB
// customers typically pay $2K-$10K annually") was being grabbed as if it
// were the section's headline TOTAL MARKET SIZE figure -- this function
// used to match the FIRST dollar amount found anywhere in the content
// with no awareness of what that figure actually represents. A
// pricing/ARPA/ACV figure must never be classified or rendered as total
// market size. Any candidate whose immediate surrounding text names it
// as a pricing/per-customer/contract-value figure is now skipped; when
// every candidate is excluded (as in this exact reported case, where the
// only dollar figure present is an SMB ARPA assumption), the caller
// correctly falls back to its "Validation Needed" state, matching
// TAM/SAM/SOM's own already-correct behavior for the same report.
const marketSizeExclusionContext =
  /\b(?:ARPA|ACV|WTP|average revenue per (?:account|customer|user|buyer)|revenue per (?:account|customer|user|buyer)|per[\s-](?:customer|user|seat|account|buyer|month|mo)\b|\/\s*(?:user|month|mo|seat|customer|buyer)\b|pricing|price point|price range|subscription (?:price|fee|cost|tier)|contract value|\bACV\b|\bCAC\b|\bLTV\b|willing(?:ness)? to pay|customers?\s+(?:typically\s+)?(?:pay|spend|purchase)|SMBs?\s+(?:typically\s+)?(?:pay|spend|purchase)|buyers?\s+(?:typically\s+)?(?:pay|spend|purchase)|annual (?:revenue|spend|contract|purchase) per|per[\s-]buyer)\b/i;
// CRITICAL FIX -- confirmed live (root-cause repair, ticket 2): the
// negative exclusion list above is fundamentally open-ended -- it has to
// anticipate every possible way the model might describe a non-market-
// size figure (pricing, ARPA, ACV, willingness-to-pay, "per-buyer
// purchase", ...), and a live report still leaked a per-buyer figure
// worded in a way the exclusion list didn't yet cover. This is not a
// case that can be closed by continuing to add more exclusion keywords.
// A candidate figure is now REQUIRED to sit near genuine, positive
// market-sizing language ("market size", "total addressable market",
// "market is valued/worth/estimated at", "TAM of", ...) -- a small,
// closed vocabulary -- in addition to passing the exclusion check.
// Whenever this restored one canonical field: the graph-projection layer
// (market-intelligence-graph.ts) now deterministically sets marketSize
// itself whenever no verified figure exists (a computed planning
// estimate, or an explicit "unavailable" notice) -- this presentation-
// layer check only remains as defense-in-depth for the narrow residual
// case where the model's own raw prose is trusted verbatim (adjacent
// benchmarks exist but no computable estimate). Fails closed: if nothing
// passes BOTH checks, no figure is ever guessed.
const marketSizePositiveContext =
  /\b(?:market size|total addressable market|serviceable addressable market|serviceable obtainable market|addressable market|market (?:opportunity|value)|\bTAM\b|\bSAM\b|\bSOM\b|industry size|(?:is|was|remains)\s+(?:valued|worth|estimated|sized)\s+at)\b/i;

function extractHeadlineMonetaryValue(content: string) {
  const unitWord = "(?:thousand|million|billion|trillion)";
  const currencyToken = "(?:[€$₺£]|(?:USD|EUR|GBP|TRY|CAD|AUD|CHF|JPY)\\b)";
  const bound = `${currencyToken}\\s*\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT]\\b|\\s+${unitWord}\\b)?`;
  const pattern = new RegExp(
    `${bound}(?:\\s*[-–—]\\s*(?:${currencyToken}\\s*)?\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT]\\b|\\s+${unitWord}\\b)?)?`,
    "gi"
  );
  const text = content || "";

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    // Trailing window is deliberately short (just enough for a directly
    // attached qualifier like "$2K-$10K annually (ARPA)" or "$2K-$10K
    // per customer") -- a longer trailing window risked reaching into
    // the START of the NEXT, unrelated sentence (e.g. a genuine market-
    // size figure immediately followed by a separate sentence about
    // per-customer pricing) and excluding a perfectly valid market-size
    // figure because of context that describes a different number
    // entirely. The leading window stays generous since a pricing/ARPA
    // label almost always precedes the figure it describes.
    const exclusionWindow = text.slice(Math.max(0, matchIndex - 80), matchIndex + match[0].length + 20);

    if (marketSizeExclusionContext.test(exclusionWindow)) {
      continue;
    }

    // The positive-confirmation window is wider (market-sizing language
    // often opens the sentence, well before the figure itself: "The
    // total addressable market for X in the U.S. is estimated at $Y").
    const positiveWindow = text.slice(Math.max(0, matchIndex - 150), matchIndex + match[0].length + 60);

    if (!marketSizePositiveContext.test(positiveWindow)) {
      continue;
    }

    return match[0].replace(/\s+/g, " ").trim();
  }

  return "";
}

function extractHeadlineCagrValue(content: string) {
  const match = (content || "").match(
    /\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/
  );

  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

// CRITICAL FIX -- confirmed live (root-cause pipeline repair): none of
// the three competitor-row extraction tiers below validated that a
// captured "vendor" string actually LOOKS like a company/product name --
// so when the underlying competitiveLandscape text was un-gated model
// prose (e.g. the cache-degraded path where the deterministic,
// isImplausibleCompetitorName-filtered graph splice was unavailable), an
// entire evidence/citation sentence like "Pricing evidence: Westlaw Edge
// charges $89-$450/user/month..." could be captured whole as a "vendor
// name" -- a structural parsing failure, not a data problem. Mirrors
// vendor-discovery.ts's own isImplausibleCompetitorName heuristic
// (length/word-count bounds, markdown/parser-artifact characters,
// instruction-leading verbs) plus an explicit reject for the specific
// evidence/citation-label prefixes this exact failure mode produces
// (never a real company name). Applied as a per-row VENDOR-field gate
// only -- a row with an implausible vendor is dropped entirely (there is
// no real identity to attach the rest of the row to), but a row with a
// real vendor and only SOME missing attributes keeps its other real
// fields untouched, never destroyed wholesale for one missing attribute.
function isImplausibleCompetitorNameOnScreen(name: string) {
  const trimmed = (name || "").trim();

  if (!trimmed) return true;
  if (trimmed.length > 60) return true;
  if (trimmed.includes("...") || trimmed.includes("…")) return true;
  if (/[[\]{}`|]|https?:\/\/|www\.|\.(?:com|org|net|edu|gov|io)\b/i.test(trimmed)) return true;
  if (
    /^(?:conduct|analyz[e]?|generate|write|provide|summarize|summarise|explain|list|identify|assess|evaluate|create|perform|produce|research|describe|compare|review|investigate|determine|prepare|draft|compile|outline)\b/i.test(
      trimmed
    )
  )
    return true;
  if (
    /^(?:pricing evidence|market relevance|confidence|validation(?:\s+status)?|evidence|source|citation|methodology|assumption|coverage|note|reference)\s*:/i.test(
      trimmed
    )
  )
    return true;
  if (trimmed.split(/\s+/).length > 6) return true;

  return false;
}

// CRITICAL FIX -- restore Market Intelligence's structured visual
// presentation. Market Intelligence's competitiveLandscape content is a
// markdown table generated by market-intelligence-graph.ts with its own
// column set (Vendor / Category / Segment / Strengths / Weaknesses /
// Market Relevance) -- distinct from Business Plan/Acquisition's
// Company/Positioning/Threat table shape (see extractCompetitorRows-style
// helpers elsewhere), so this is a dedicated extractor rather than a
// forced reuse that would leave Company/Threat cells empty. Positional
// slicing (not .filter(Boolean) on data cells) keeps columns aligned even
// when a cell is legitimately empty.
// CRITICAL FIX -- confirmed live: app/lib/report-engine/markdown-table-
// flattening.ts's flattenMarkdownTables runs on every Market Intelligence
// field (including competitiveLandscape) before the deterministic graph
// projection is spliced back in; when that graph splice is unavailable
// for a given generation (e.g. a cached response with no preserved
// research graph), the flattened "- Vendor — Category: X; Strengths: Y;
// ..." bullet shape is what actually reaches this section's content --
// never restored back into a "| a | b | c |" table. The table-only parser
// below then saw zero table rows and reported "Validation Needed" even
// though the report plainly names real, evidence-backed vendors. This
// fallback reads that exact flattened shape (the same header vocabulary
// the deterministic table uses, now as "Header: Value" pairs instead of
// cells) so the premium card consumes the SAME underlying vendor data
// either way, without fabricating anything new.
function extractFlattenedMarketIntelligenceCompetitorRows(content: string) {
  const normalized = (content || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  const read = (fieldMap: Array<[string, string]>, keys: string[]) => {
    for (const [key, value] of fieldMap) {
      if (keys.some((k) => key.includes(k))) return value;
    }
    return "";
  };

  return bulletLines
    .map((line) => {
      const withoutBullet = line.replace(/^-\s+/, "");
      const emDashIndex = withoutBullet.indexOf(" — ");
      const vendor = (emDashIndex >= 0 ? withoutBullet.slice(0, emDashIndex) : withoutBullet).trim();
      const fieldsText = emDashIndex >= 0 ? withoutBullet.slice(emDashIndex + 3) : "";
      const fieldMap = fieldsText
        .split("; ")
        .map((pair): [string, string] | null => {
          const colonIndex = pair.indexOf(": ");
          return colonIndex < 0
            ? null
            : [pair.slice(0, colonIndex).trim().toLowerCase(), pair.slice(colonIndex + 2).trim()];
        })
        .filter((pair): pair is [string, string] => pair !== null);

      return {
        vendor,
        category: read(fieldMap, ["category"]),
        position: read(fieldMap, ["segment", "ai capability", "position", "positioning"]),
        strengths: read(fieldMap, ["strength"]),
        weaknesses: read(fieldMap, ["weakness"]),
        relevance: read(fieldMap, ["market relevance"]),
        validationStatus: read(fieldMap, ["confidence"]),
      };
    })
    // An implausible vendor string is treated as MISSING, not kept as a
    // fabricated identity -- any other real fields this row captured
    // (category/strengths/weaknesses/...) survive untouched; the row is
    // only dropped entirely when nothing real remains at all, per this
    // fix's "mark only the unsupported field unavailable, never destroy
    // the whole row" requirement.
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNameOnScreen(row.vendor) ? "" : row.vendor }))
    .filter((row) => row.vendor || row.strengths || row.weaknesses)
    .slice(0, 20);
}

// CRITICAL FIX -- confirmed live: Competitive Landscape's table has a
// narrow, brittle format requirement (an unbroken "| a | b | c |" block),
// while Major Players' bullet list (built from the exact same
// evidence-backed vendor set -- see market-intelligence-graph.ts's
// projectMarketIntelligenceGraphToReport, which always sets both fields
// from the same renderableVendors array together) tolerates almost any
// shape, since the generic bullet extractor used elsewhere just needs a
// line starting with "-". That asymmetry let a real, live contradiction
// through: Competitive Landscape showing "Validation Needed" while Major
// Players, immediately below, named real vendors (e.g. "Autodesk
// Construction Cloud") from that identical vendor set. This reads Major
// Players' own real bullet line shape ("- Vendor (Label): Classifications;
// target customer: X (ranking: N/100; overall score: N/100; confidence:
// N/100 Level; [ids])") as a last-resort source of the SAME authoritative
// vendor data, rather than a fabricated stand-in -- vendor/category/
// position map directly from real text; strengths/weaknesses/relevance
// stay empty since Major Players' own format never states them.
function extractMarketIntelligenceCompetitorRowsFromMajorPlayers(majorPlayersContent: string) {
  const normalized = (majorPlayersContent || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  return bulletLines
    .map((line) => {
      const match = line.match(/^-\s+(.+?)\s+\(([^)]+)\):\s*([^;]+);[^:]*:\s*([^(]+)\(([^)]*)\)/);

      if (!match) {
        return null;
      }

      const [, vendor, majorPlayerLabel, classifications, , metrics] = match;
      const confidenceMatch = metrics.match(/confidence[^:]*:\s*([^;]+)/i);

      return {
        vendor: vendor.trim(),
        category: majorPlayerLabel.trim(),
        position: classifications.trim(),
        strengths: "",
        weaknesses: "",
        relevance: "",
        validationStatus: confidenceMatch?.[1]?.trim() || "",
      };
    })
    .filter(
      (row): row is NonNullable<typeof row> =>
        row !== null && Boolean(row.vendor) && !isImplausibleCompetitorNameOnScreen(row.vendor)
    )
    .slice(0, 20);
}

// CRITICAL FIX -- confirmed live: real Major Players content can be
// grouped/prose bullets with no parenthetical label immediately after the
// name at all (e.g. "- Thomson Reuters / CoCounsel / Westlaw Edge:
// AI-powered legal research and contract platform..."), which fails the
// row extractor above at its very first capture boundary (it requires
// "Name (Label): ..."). That produced a real, live contradiction the
// ticket flagged: this section's own table said "no competitor data could
// be validated" while Major Players, immediately below, named real,
// validated vendors. This is a 4th, last-resort tier: it never fabricates
// category/position/strengths/weaknesses (an empty cell would misrepresent
// unknown structure as verified-absent) -- it extracts ONLY the plausible
// name segment(s) from each bullet, splitting a grouped "A / B / C" entry
// into separate candidate names, and returns names alone. Callers must
// render this as its own distinct state (validated identities, but not
// enough structure for a comparison matrix) rather than blending it into
// the full-row table.
function extractMarketIntelligenceCompetitorNamesOnly(majorPlayersContent: string) {
  const normalized = (majorPlayersContent || "").replace(/\*\*/g, "");
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\S/.test(line));

  const names: string[] = [];

  for (const line of bulletLines) {
    // Strip URLs before splitting on ":" -- a bare "https://" scheme's own
    // colon would otherwise be mistaken for the name/label separator,
    // leaving a bogus "https" candidate.
    const withoutBullet = line.replace(/^-\s+/, "").replace(/https?:\/\/\S+/gi, "");
    const nameSegment = withoutBullet.split(/\s*[:(]|\s+—\s+/)[0]?.trim() || "";

    if (!nameSegment) continue;

    // Grouped multi-brand entries ("Thomson Reuters / CoCounsel / Westlaw
    // Edge") are split into individual candidate names -- each one is
    // plausibility-checked on its own, since a group that fails as one
    // long string (too many words) is often several real, short names.
    const candidates = nameSegment
      .split(/\s*\/\s*|,\s*/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      // isImplausibleCompetitorNameOnScreen's evidence/label-phrase reject
      // ("market relevance:", "confidence:", ...) only fires when the
      // colon is still attached -- nameSegment already stripped it during
      // the name/label split above, so re-attach one here purely for this
      // check (never part of the stored name itself).
      if (!isImplausibleCompetitorNameOnScreen(`${candidate}:`) && !names.includes(candidate)) {
        names.push(candidate);
      }
    }
  }

  // CRITICAL FIX -- confirmed live: real Major Players content is not
  // always bulleted at all -- when the deterministic graph splice that
  // normally produces the "- Vendor (Label): ..." bulleted shape isn't
  // applied (e.g. a cached research bundle with no preserved graph),
  // whatever the model itself wrote for this field can be a single prose
  // paragraph naming vendors inline (e.g. "Evidence-supported major
  // players in this market include Procore, Autodesk Construction Cloud,
  // OpenSpace, and Buildots..."), with no bullet markers for the tier
  // above to split on at all -- reproducing the exact reported
  // contradiction (Competitive Landscape saying no data validated while
  // Major Players plainly names real vendors). Only tried when the
  // bulleted tier found nothing; extracts names from the SAME
  // "include/such as/like/named" list-introducing shape prose lists
  // almost always use, never fabricating category/position/strengths/
  // weaknesses here either.
  if (names.length === 0) {
    const proseWithoutUrls = normalized.replace(/https?:\/\/\S+/gi, "");
    const listMatch = proseWithoutUrls.match(
      /\b(?:include|includes|including|such as|like|named)\s+((?:[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})(?:\s*,\s*(?:and\s+)?[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})*(?:\s+and\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})?)/
    );

    if (listMatch?.[1]) {
      const candidates = listMatch[1]
        .split(/\s*,\s*|\s+and\s+/)
        .map((candidate) => candidate.replace(/^and\s+/i, "").trim())
        .filter(Boolean);

      for (const candidate of candidates) {
        if (!isImplausibleCompetitorNameOnScreen(`${candidate}:`) && !names.includes(candidate)) {
          names.push(candidate);
        }
      }
    }
  }

  return names.slice(0, 20);
}

function extractMarketIntelligenceCompetitorRowsFromTable(content: string) {
  const normalized = (content || "").replace(/\*\*/g, "");
  const tableRows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line));

  if (tableRows.length <= 1) {
    return [];
  }

  const headers = tableRows[0]
    .split("|")
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);

  const read = (cells: string[], keys: string[]) => {
    const index = headers.findIndex((header) => keys.some((key) => header.includes(key)));
    return index >= 0 ? cells[index] || "" : "";
  };

  return tableRows
    .slice(1)
    .map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => ({
      vendor: read(cells, ["vendor", "company", "competitor"]),
      category: read(cells, ["category"]),
      position: read(cells, ["segment", "ai capability", "position", "positioning"]),
      strengths: read(cells, ["strength"]),
      weaknesses: read(cells, ["weakness"]),
      relevance: read(cells, ["market relevance"]),
      // "Validation Status" reads the same Confidence classification
      // market-intelligence-graph.ts already computes per row (how many
      // independent sources back this entry) -- a distinct signal from
      // Market Relevance, never conflated with it.
      validationStatus: read(cells, ["confidence"]),
    }))
    // Defense-in-depth: the deterministic table is already filtered
    // server-side (isImplausibleCompetitorName), but this render-time
    // check never trusts that alone -- the same evidence-sentence-as-
    // vendor failure mode is possible here too if a model ever writes
    // its own "| a | b | c |" table without going through the graph.
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNameOnScreen(row.vendor) ? "" : row.vendor }))
    .filter((row) => row.vendor || row.strengths || row.weaknesses)
    .slice(0, 20);
}

// Tries, in order: the real table, the flattened-bullet shape, then Major
// Players' own bullet list (see its own comment above) -- the first tier
// to produce any real rows wins. Every tier reads only content already
// present in the payload; none fabricates a vendor.
function extractMarketIntelligenceCompetitorRows(content: string, majorPlayersContent = "") {
  const tableRows = extractMarketIntelligenceCompetitorRowsFromTable(content);
  if (tableRows.length > 0) {
    return tableRows;
  }

  const flattenedRows = extractFlattenedMarketIntelligenceCompetitorRows(content);
  if (flattenedRows.length > 0) {
    return flattenedRows;
  }

  return extractMarketIntelligenceCompetitorRowsFromMajorPlayers(majorPlayersContent);
}

// CRITICAL FIX -- confirmed live (root-cause pipeline repair): a
// section-intro/label line the model writes before its real numbered
// actions (e.g. "First 90 Days (three actions with owners, budgets,
// KPIs, and success criteria):", closely echoing this field's own prompt
// wording -- a known LLM failure mode) or the deterministic "Market Entry
// Recommendation"/"Why Entry Is Not Recommended Now" heading route.ts
// appends were both being treated as if they were themselves real
// recommendation sentences, rendering a fake "Action" card with prompt/
// heading scaffolding instead of real content. Mirrors market-
// intelligence-presentation.ts's own isHeadingOnlyLine heuristic (a line
// ending in ":" is a label, not a sentence) plus an explicit reject for
// the two known deterministic heading strings.
function isRecommendationHeadingLine(item: string) {
  if (/:$/.test(item)) return true;
  if (/^(?:first\s+90\s*-?\s*days?|market entry recommendation|why entry is not recommended now)\b/i.test(item)) {
    return true;
  }

  return false;
}

// Strategic Recommendations is inherently a list -- each real recommendation
// line rendered as its own card, rather than one long paragraph block.
// Falls back to sentence-splitting (same convention as extractBullets
// below) when the content has no bullet/numbered markers.
function extractRecommendationItems(content: string) {
  const source = content || "";
  const bulletLines = source
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter((line) => line.length > 8 && !isRecommendationHeadingLine(line));

  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 8);
  }

  return source
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 8)
    .slice(0, 4);
}

// Best-effort inline signal extraction for a single recommendation line --
// strategicRecommendations' own prompt requires each First-90-Days action
// to name owners, a KPI, a success criterion, and a budget/spend ceiling
// as prose, not as machine-parseable "Owner: X" labels, so this surfaces
// only the signals that can be confidently read back out of that prose
// (an owner role/title, a timeframe, a percentage/numeric KPI) as small
// badges -- it never fabricates a value when the line does not genuinely
// contain one.
const recommendationOwnerRolePattern =
  "(?:CEO|CMO|CFO|COO|CTO|CPO|VP of \\w+|Head of \\w+|(?:regional|country|global) (?:GM|general manager)|product (?:lead|manager|owner)|growth (?:lead|manager)|sales (?:lead|manager)|marketing (?:lead|manager)|founder)";

function extractRecommendationSignals(line: string) {
  const timeframe = line.match(
    /\b\d+[\s-](?:day|days|week|weeks|month|months|gün|hafta|ay)\b|\bQ[1-4]\b|\b(?:this|next)\s+quarter\b/i
  )?.[0];
  // Budget (a spend ceiling) and success metric (a KPI/countable target)
  // are distinct signals strategicRecommendations' own prompt requires
  // separately -- kept apart here rather than one shared "metric" match,
  // so a line naming both (e.g. "$50K budget ... targeting 10 paying
  // pilots") surfaces both instead of only whichever pattern matched
  // first.
  const budget = line.match(/[€$₺]\s*\d+(?:[.,]\d+)*(?:\s*[kKmMbB])?/)?.[0];
  const metric =
    line.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] ||
    line.match(/\b\d+\s+(?:paying\s+)?(?:pilots?|customers?|interviews?|conversions?|sign-?ups?|users?|leads?|deals?)\b/i)?.[0];
  const owner =
    line.match(new RegExp(`\\b(?:owned by|led by|driven by|owner:)\\s+(?:the\\s+)?(${recommendationOwnerRolePattern})\\b`, "i"))?.[1] ||
    line.match(new RegExp(`\\b(${recommendationOwnerRolePattern})\\b`, "i"))?.[1];
  // Decision Gate -- the checkpoint that determines whether to continue,
  // e.g. "... before committing further budget"/"before scaling
  // further". strategicRecommendations' own prompt requires a "numeric
  // or evidence-based success criterion that determines whether to
  // continue" for each action, so this phrasing is a real, expected
  // shape -- never fabricated when absent.
  const gate = line.match(
    /\bbefore\s+(?:committing\s+(?:further\s+)?(?:budget|spend)|scaling(?:\s+further)?|the\s+next\s+decision|proceeding|expanding|the\s+next\s+phase)\b[^.]*/i
  )?.[0];

  return {
    timeframe: timeframe?.trim() || "",
    metric: metric?.trim() || "",
    budget: budget?.trim() || "",
    owner: owner?.trim() || "",
    gate: gate?.trim() || "",
  };
}

// CRITICAL FIX -- do not reintroduce old fake-data behavior. Porter's
// Five Forces' intensity bars were a static, hardcoded array
// ([72, 54, 66, 48, 60]) -- identical for every report regardless of the
// generated content, which the section's own prompt explicitly instructs
// to give "a qualitative assessment ... for each force". This reads that
// real qualitative assessment (high/moderate/low and their synonyms)
// back out of the text near each force's own name, scoped to a bounded
// window so an intensity word describing a DIFFERENT force can't bleed
// into this one's reading. Returns null (never a guessed number) when no
// such signal is present for that force.
const forceAliases: Record<string, string[]> = {
  Rivalry: ["rivalry", "competitive rivalry", "rekabet yoğunluğu"],
  Entrants: ["threat of (?:new )?entr(?:y|ants)", "new entrants", "barriers? to entry", "giriş engeli"],
  "Buyer Power": ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  Buyer: ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  "Supplier Power": ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  Supplier: ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  Substitutes: ["threat of substitutes?", "substitute products?", "ikame ürün"],
};

function extractForceIntensity(content: string, force: string) {
  const aliases = forceAliases[force] || [force];

  for (const alias of aliases) {
    const match = content.match(
      new RegExp(
        `(?:${alias})[^.\\n]{0,70}?\\b(high|strong|significant|intense|severe|yüksek|güçlü|moderate|medium|orta|low|weak|limited|minimal|düşük|zayıf)\\b`,
        "i"
      )
    );

    if (match) {
      const word = match[1].toLowerCase();

      if (/high|strong|significant|intense|severe|yüksek|güçlü/.test(word)) {
        return { level: "High", width: 82 };
      }
      if (/moderate|medium|orta/.test(word)) {
        return { level: "Moderate", width: 55 };
      }
      return { level: "Low", width: 28 };
    }
  }

  return null;
}

// Porter's Five Forces' own prompt requires "a qualitative assessment
// and ONE MARKET IMPLICATION for each force" -- this reads that real
// sentence back out of the generated text (the same sentence
// extractForceIntensity reads the intensity word from) to show as the
// card's investor interpretation, rather than only a bare intensity
// label. Returns "" (never a fabricated implication) when the force
// isn't discussed in its own sentence.
function extractForceImplication(content: string, force: string) {
  const aliases = forceAliases[force] || [force];

  for (const alias of aliases) {
    const match = content.match(new RegExp(`[^.\\n]*\\b(?:${alias})\\b[^.\\n]*\\.`, "i"));

    if (match) {
      return match[0].trim().replace(/^[-*•]\s+/, "");
    }
  }

  return "";
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

// CRITICAL FIX -- confirmed live: Market Intelligence's deterministic
// Executive Decision banner has real, clearly labeled Why/Top 3 Risks/
// Immediate Next Action/What Evidence Is Missing fields -- the generic
// keyword search above (built for Business Plan's free-flowing prose)
// ignores that structure entirely, and its own fallback
// (extractKeywordInsight's `lines[0]`, used whenever a keyword isn't
// found anywhere in the section) can surface a completely unrelated
// opening line as if it were "the risk" or "the next action". Sources
// highlights from the SAME locale-agnostic labeled fields the PDF's own
// Executive Decision card already reads, never a keyword scan of
// arbitrary prose.
function getMarketIntelligenceExecutiveHighlights(content: string) {
  const candidates = [
    extractMetricValueFromAliases(content, localizedLabelVariants("why")),
    takeFirstListItem(extractMetricValueFromAliases(content, localizedLabelVariants("topRisks"))),
    extractMetricValueFromAliases(content, localizedLabelVariants("immediateNextAction")),
    takeFirstListItem(extractMetricValueFromAliases(content, localizedLabelVariants("missingEvidence"))),
  ];

  return dedupeHighlightCandidates(candidates);
}

// CRITICAL FIX -- confirmed live (production report on a real market):
// the exact-fingerprint check below (strip a small decision-word
// stoplist, then require byte-identical normalized text) only ever
// caught two candidates that were nearly IDENTICAL already -- it could
// not recognize the same underlying insight restated with different
// wording, e.g. "risk" and "opportunity" -shaped extraction both landing
// on essentially the same "Platform module commoditization --
// Autodesk/Procore embedding AI features reduces..." claim with a
// different lead-in phrase or punctuation. Now also runs
// describesSameInsight (report-content-quality.mjs) -- the same
// containment/Jaccard token-overlap semantic-similarity check the
// report's own cross-section paragraph dedup already uses -- against
// every PREVIOUSLY ACCEPTED candidate, so a near-identical restatement is
// collapsed into the first (fuller-context) occurrence instead of
// appearing twice. Genuinely distinct risks/opportunities (low token
// overlap) are always kept; nothing is dropped merely for sharing a topic
// or a common word.
function dedupeHighlightCandidates(candidates: string[]) {
  const seen = new Set<string>();
  const acceptedSignatures: ReturnType<typeof createInsightSignature>[] = [];

  return candidates
    .map((highlight) => highlight.trim())
    .filter((highlight) => {
      if (!highlight) {
        return false;
      }

      const fingerprint = highlight
        .toLowerCase()
        .replace(/[*_`#>-]/g, "")
        .replace(/\b(?:decision|opportunity|risk|action|validation|karar|fırsat|risk|aksiyon|doğrulama)\b/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

      if (!fingerprint || seen.has(fingerprint)) {
        return false;
      }

      const signature = createInsightSignature(highlight);
      if (acceptedSignatures.some((previous) => describesSameInsight(signature, previous))) {
        return false;
      }

      seen.add(fingerprint);
      acceptedSignatures.push(signature);
      return true;
    })
    .slice(0, 5);
}

function getExecutiveHighlights(content: string) {
  const candidates = [
    extractKeywordInsight(content, ["decision", "recommendation", "karar", "tavsiye"]),
    extractKeywordInsight(content, ["opportunity", "market", "pazar", "tam", "sam", "som"]),
    extractKeywordInsight(content, ["risk", "threat", "tehdit"]),
    extractKeywordInsight(content, ["next action", "critical action", "action", "validate", "aksiyon", "doğrula"]),
    extractKeywordInsight(content, ["validation", "evidence", "confidence", "doğrulama", "kanıt", "güven"]),
    extractFirstInsight(content),
  ];

  return dedupeHighlightCandidates(candidates);
}

function getSectionContentByFieldOrTitle(
  sections: Array<{ field?: string; title: string; content: string }>,
  matchers: string[]
) {
  const normalizedMatchers = matchers.map((matcher) => matcher.toLowerCase());
  const section = sections.find((item) => {
    const field = item.field?.toLowerCase() || "";
    const title = item.title.toLowerCase();

    return normalizedMatchers.some(
      (matcher) => field.includes(matcher) || title.includes(matcher)
    );
  });

  return section?.content || "";
}

function cleanDecisionSummaryText(value: string, fallback: string) {
  const cleaned = sanitizeAiResponseText(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return fallback;
  }

  const firstSentence = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 18);
  const candidate = firstSentence || cleaned;

  if (candidate.length <= 170) {
    return candidate;
  }

  const clipped = candidate.slice(0, 171);
  const lastSpace = clipped.lastIndexOf(" ");

  return `${clipped.slice(0, Math.max(80, lastSpace)).trim()}…`;
}

function extractDecisionConfidenceValue(content: string) {
  const direct =
    extractMetricValue(content, "Confidence") ||
    extractMetricValue(content, "Decision Confidence") ||
    extractMetricValue(content, "Güven") ||
    extractMetricValue(content, "Karar Güveni");
  const percent = direct.match(/\d{1,3}\s*%/)?.[0] || content.match(/(?:Confidence|Güven)\s*[:\-–—]\s*(\d{1,3}\s*%)/i)?.[1];

  return percent || direct || "";
}

function extractDecisionDriverList(content: string, labels: string[]) {
  const normalized = sanitizeAiResponseText(content);

  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = normalized.match(
      new RegExp(
        `${escapedLabel}\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:Positive signals|Risk signals|Pozitif sinyaller|Risk sinyalleri|Decision|Karar|Confidence|Güven)\\s*[:\\-–—]|$)`,
        "i"
      )
    );
    const bullets = match?.[1]
      ?.split("\n")
      .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
      .filter((line) => line.length > 6);

    if (bullets && bullets.length > 0) {
      return bullets.slice(0, 3).join(" ");
    }
  }

  return "";
}

function getDecisionSummaryItems(
  sections: Array<{ field?: string; title: string; content: string }>,
  isMarketIntelligence = false
) {
  const fullContent = sections.map((section) => `${section.title}\n${section.content}`).join("\n\n");
  const executiveSummary = getSectionContentByFieldOrTitle(sections, [
    "executivesummary",
    "executive summary",
  ]);
  // Legacy reports (generated before the single Executive Decision layer)
  // carried a dedicated "Executive Recommendation" field; new reports
  // merge that content into Executive Summary. Trying the old field name
  // first, then falling back to the merged field, renders both
  // generations correctly from the same code path.
  const executiveRecommendation =
    getSectionContentByFieldOrTitle(sections, [
      "executiverecommendation",
      "executive recommendation",
      "recommendation",
    ]) || executiveSummary;
  const marketOpportunity = getSectionContentByFieldOrTitle(sections, [
    "marketopportunity",
    "market opportunity",
    "marketoverview",
    "market overview",
  ]);
  const risks = getSectionContentByFieldOrTitle(sections, ["risk", "threat"]);
  // CRITICAL ARCHITECTURE FIX -- centralize executive decision
  // vocabulary. The canonical resolver (executive-decision-vocabulary.ts)
  // tries, in order: Acquisition's own literal call phrase, Real
  // Estate's labeled BUY/WAIT/AVOID line, then the shared Executive
  // Decision layer's deterministic "Decision: TOKEN" line (it matches
  // English GO/CONDITIONAL GO/NO-GO, Turkish EVET/KOŞULLU EVET/HAYIR,
  // and the German/French/Spanish equivalents alike) -- so every report
  // kind's own, unmodified decision output renders as the same 4-value
  // label here. detectRecommendation's legacy PASS/HOLD/VALIDATE/REJECT
  // heuristic is kept only as a fallback for reports generated before
  // any of these formats existed.
  const dashboardLocale = detectPdfPresentationLocale(fullContent);
  // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
  // decision consistency bug"). Market Intelligence resolves through
  // resolveMarketIntelligenceExecutiveDecision -- the ONE canonical
  // decision source for this report kind -- scoped to just the executive
  // summary content, never the fullContent-wide detectRecommendation
  // fallback below. That bare keyword scan (`\b(GO|NO GO|WAIT|...)\b`)
  // matches the "GO" inside "Go-to-Market", a phrase virtually every
  // Market Intelligence report mentions somewhere across its full text,
  // fabricating a "GO" verdict on this top-of-page decision strip
  // regardless of the report's real, conservative recommendation.
  const marketDecisionSignal = isMarketIntelligence
    ? resolveMarketIntelligenceExecutiveDecision(
        executiveSummary || executiveRecommendation,
        dashboardLocale === "tr" ? "Turkish" : "English"
      ).decisionLabel
    : null;
  const resolvedDecision = isMarketIntelligence
    ? null
    : resolveCanonicalDecisionFromReportText(
        `${executiveRecommendation}\n${executiveSummary}\n${fullContent}`
      );
  const decisionSignal =
    marketDecisionSignal ??
    (resolvedDecision
      ? getCanonicalDecisionLabel(
          resolvedDecision.decision,
          dashboardLocale === "tr" ? "Turkish" : resolvedDecision.language
        )
      : detectRecommendation(`${executiveRecommendation}\n${executiveSummary}\n${fullContent}`) ||
        extractMetricValue(executiveRecommendation, "Decision") ||
        extractMetricValue(executiveRecommendation, "Recommendation") ||
        "—");
  // CRITICAL FIX -- confirmed live: for Market Intelligence, "Next
  // Action"/"Main Risk" previously fell back to a bare keyword scan
  // across fullContent (the ENTIRE report) whenever no literal "Next
  // Action:"/"Main Risk:" label was found in the narrower executive
  // fields -- risking a completely unrelated sentence from elsewhere in
  // the report being surfaced as if it were the next action or main
  // risk. Market Intelligence's deterministic Executive Decision banner
  // has real, clearly labeled "Immediate Next Action"/"Top 3 Risks"
  // fields (locale-agnostic lookup, matching the PDF's own Executive
  // Decision card) -- read first, before ever falling through to the
  // generic scan.
  const marketNextAction = isMarketIntelligence
    ? extractMetricValueFromAliases(executiveSummary || fullContent, localizedLabelVariants("immediateNextAction"))
    : "";
  const nextStep =
    marketNextAction ||
    extractMetricValue(executiveRecommendation, "Next Critical Action") ||
    extractMetricValue(executiveRecommendation, "Next Action") ||
    extractMetricValue(fullContent, "Next Critical Action") ||
    extractMetricValue(fullContent, "Next Action") ||
    (isMarketIntelligence
      ? ""
      : extractKeywordInsight(executiveRecommendation || executiveSummary || fullContent, [
          "next",
          "validate",
          "launch",
          "pilot",
          "action",
        ]));
  const mainInsight =
    extractMetricValue(executiveSummary, "Main Insight") ||
    extractKeywordInsight(executiveSummary || marketOpportunity || fullContent, [
      "market",
      "opportunity",
      "revenue",
      "growth",
      "customer",
    ]);
  const marketMainRisk = isMarketIntelligence
    ? takeFirstListItem(extractMetricValueFromAliases(executiveSummary || fullContent, localizedLabelVariants("topRisks")))
    : "";
  const mainRisk =
    marketMainRisk ||
    extractMetricValue(executiveRecommendation, "Main Risk") ||
    extractMetricValue(risks, "Main Risk") ||
    (isMarketIntelligence
      ? ""
      : extractKeywordInsight(risks || fullContent, ["risk", "threat", "regulation", "competition"]));
  const decisionConfidence = extractDecisionConfidenceValue(executiveRecommendation || fullContent);
  const positiveDrivers = extractDecisionDriverList(executiveRecommendation || fullContent, [
    "Positive signals",
    "Pozitif sinyaller",
  ]);
  const riskDrivers = extractDecisionDriverList(executiveRecommendation || fullContent, [
    "Risk signals",
    "Risk sinyalleri",
  ]);

  return [
    {
      label: "Decision Signal",
      value: cleanDecisionSummaryText(decisionSignal, dashboardLocale === "tr" ? "Karar bekleniyor" : "Decision pending"),
      detail: cleanDecisionSummaryText(
        extractMetricValue(executiveRecommendation, "Decision Rationale") ||
          extractMetricValue(executiveRecommendation, "Recommendation") ||
          extractMetricValue(executiveRecommendation, "Summary") ||
          executiveRecommendation ||
          executiveSummary,
        dashboardLocale === "tr"
          ? "İlerlemeden önce karar gerekçesini inceleyin."
          : "Review the decision evidence before moving forward."
      ),
      icon: Sparkles,
      evidence: getDashboardMetricEvidence("Decision Signal", decisionSignal, `${executiveRecommendation}\n${executiveSummary}`),
    },
    {
      label: "Main Insight",
      value: cleanDecisionSummaryText(mainInsight, "Primary market signal requires review."),
      detail: cleanDecisionSummaryText(mainRisk, "Risk profile is detailed in the report."),
      icon: Target,
      evidence: "benchmarkDerived" as EvidenceLevel,
    },
    {
      label: "Decision Confidence",
      value: cleanDecisionSummaryText(decisionConfidence, "—"),
      detail: "Confidence reflects market, model, financial, validation, and execution drivers.",
      icon: Gauge,
      evidence: getDashboardMetricEvidence("Decision Confidence", decisionConfidence, executiveRecommendation || fullContent),
    },
    {
      label: "Positive Drivers",
      value: cleanDecisionSummaryText(positiveDrivers, "Positive signals require validation."),
      detail: "Factors increasing decision confidence.",
      icon: CheckCircle2,
      evidence: "benchmarkDerived" as EvidenceLevel,
    },
    {
      label: "Risk Drivers",
      value: cleanDecisionSummaryText(riskDrivers, "Risk signals require review."),
      detail: "Factors reducing decision confidence.",
      icon: TriangleAlert,
      evidence: "validationRequired" as EvidenceLevel,
    },
    {
      label: "Recommended Next Step",
      value: cleanDecisionSummaryText(nextStep, "Create a follow-up validation plan."),
      detail: "Use the full report context to continue the decision file.",
      icon: Flag,
      evidence: "planningAssumption" as EvidenceLevel,
    },
  ];
}

function getReportIntelligenceOverview(
  sections: Array<{ field?: string; title: string; content: string }>
) {
  const fullContent = sections.map((section) => `${section.title}\n${section.content}`).join("\n\n");
  const executiveRecommendation = getSectionContentByFieldOrTitle(sections, [
    "executiverecommendation",
    "executive recommendation",
    "recommendation",
  ]);
  const intelligenceContent = executiveRecommendation || fullContent;
  const quality =
    extractMetricValue(intelligenceContent, "Report Quality") ||
    extractMetricValue(intelligenceContent, "Rapor Kalitesi") ||
    "—";
  const qualityScore =
    extractMetricValue(intelligenceContent, "Quality Score") ||
    extractMetricValue(intelligenceContent, "Kalite Skoru") ||
    "";
  const confidenceSummary =
    extractMetricValue(intelligenceContent, "Confidence Summary") ||
    extractMetricValue(intelligenceContent, "Güven Özeti") ||
    extractKeywordInsight(intelligenceContent, ["report findings", "rapor bulguları", "confidence"]);
  const strengths = extractDecisionDriverList(intelligenceContent, ["Strengths", "Güçlü Yönler"]);
  const risks = extractDecisionDriverList(intelligenceContent, ["Weaknesses", "Zayıf Yönler", "Risks", "Riskler"]);
  const warnings = extractDecisionDriverList(intelligenceContent, [
    "Consistency Warnings",
    "Tutarlılık Uyarıları",
  ]);

  return {
    quality: cleanDecisionSummaryText(quality, "—"),
    qualityScore: cleanDecisionSummaryText(qualityScore, "Quality score requires review."),
    strengths: cleanDecisionSummaryText(strengths, "Strengths require validation."),
    risks: cleanDecisionSummaryText(risks || warnings, "Risks require review."),
    confidenceSummary: cleanDecisionSummaryText(
      confidenceSummary,
      "Confidence summary requires review."
    ),
  };
}

function extractFirstLineByPatterns(content: string, patterns: RegExp[]) {
  return sanitizeAiResponseText(content)
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .find((line) => patterns.some((pattern) => pattern.test(line))) || "";
}

function stripValidationLabel(value: string) {
  return value
    .replace(/^(?:Priority|Öncelik)\s+\d+\s*[:\-–—]\s*/i, "")
    .replace(/^(?:Experiment|Deney|Success|Başarı|Risk|Status|Durum)\s*[:\-–—]\s*/i, "")
    .trim();
}

function getValidationIntelligenceOverview(
  sections: Array<{ field?: string; title: string; content: string }>,
  validationIntelligence?: ReportValidationIntelligence
) {
  if (validationIntelligence) {
    const topAssumption =
      [...validationIntelligence.assumptions].sort((a, b) => a.priority - b.priority)[0];

    return {
      score: `${validationIntelligence.overallScore}/100 • ${validationIntelligence.confidenceLevel}`,
      topAssumption: topAssumption?.assumption || validationIntelligence.summary,
      experiment: topAssumption?.experiment || validationIntelligence.recommendedSequence[0] || "Run the highest-priority validation experiment.",
      successCriteria: topAssumption?.successMetric || "Define success criteria before scaling.",
    };
  }

  const validationContent =
    getSectionContentByFieldOrTitle(sections, [
      "validationplan",
      "validation plan",
      "doğrulama planı",
      "roadmap306090",
      "30-60-90 day roadmap",
      "30-60-90 günlük yol haritası",
    ]) ||
    sections.map((section) => `${section.title}\n${section.content}`).join("\n\n");
  const score =
    extractMetricValue(validationContent, "Validation Score") ||
    extractMetricValue(validationContent, "Doğrulama Skoru") ||
    "Not Started";
  const topAssumption = stripValidationLabel(
    extractFirstLineByPatterns(validationContent, [/^(?:Priority|Öncelik)\s+1\s*[:\-–—]/i])
  );
  const experiment = stripValidationLabel(
    extractFirstLineByPatterns(validationContent, [/^(?:Experiment|Deney)\s*[:\-–—]/i])
  );
  const successCriteria = stripValidationLabel(
    extractFirstLineByPatterns(validationContent, [/^(?:Success|Başarı)\s*[:\-–—]/i])
  );

  return {
    score: cleanDecisionSummaryText(score, "Not Started"),
    topAssumption: cleanDecisionSummaryText(topAssumption, "Customer demand requires validation."),
    experiment: cleanDecisionSummaryText(experiment, "Run the highest-priority validation experiment."),
    successCriteria: cleanDecisionSummaryText(successCriteria, "Define success criteria before scaling."),
  };
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
  // CRITICAL ARCHITECTURE FIX -- also recognize the centralized
  // executive decision vocabulary's own codes and rendered labels
  // (executive-decision-vocabulary.ts), so the "Decision" KPI card's
  // color coding still applies now that its value is the canonical
  // label ("Proceed with Conditions") rather than each report kind's
  // own raw word.
  if (decision === "GO" || decision === "RAISE" || decision === "BOOTSTRAP" || decision === "PROCEED" || decision === "Proceed") {
    return "border-emerald-300/35 bg-emerald-300/15 text-emerald-100";
  }

  if (decision === "NO GO" || decision === "PIVOT" || decision === "REJECT" || decision === "Reject") {
    return "border-red-300/30 bg-red-300/12 text-red-100";
  }

  if (
    decision === "WAIT" ||
    decision === "PAUSE_PENDING_REVIEW" ||
    decision === "Pause Pending Review" ||
    decision === "PROCEED_WITH_CONDITIONS" ||
    decision === "Proceed with Conditions"
  ) {
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

// A real word/phrase label ("Owner", "Target"), not a bare number or time-
// like fragment ("3", "12:30") that a naive colon-split would otherwise
// misread as a label -- keeps the structured-value rendering below from
// firing on a value that merely happens to contain a colon.
function looksLikeKpiValueLabel(text: string) {
  return /^[A-Za-z][A-Za-z\s/&-]{1,30}$/.test(text.trim());
}

// KPI values extracted from report text sometimes arrive as multiple
// "Label: text" fragments joined with "|" (e.g. "Owner: Growth Lead |
// Target: 5 net new customers/month") rather than a single short metric.
// Presentation-only parsing of the already-extracted value string -- the
// underlying extraction/data model is untouched.
function parseKpiValueSegments(value: string) {
  if (!value) return [];

  return value
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const colonIndex = segment.indexOf(":");
      if (colonIndex === -1) {
        return { label: "", text: segment };
      }
      return {
        label: segment.slice(0, colonIndex).trim(),
        text: segment.slice(colonIndex + 1).trim(),
      };
    });
}

// FINAL KPI UI POLISH -- confirmed live: a combined value like "Owner:
// Growth Lead | Target: 5 net new customers/month" rendered as one dense,
// hard-to-scan line. Separates it into label / value / supporting-text
// tiers (showing the most important segment first, per requirement) while
// leaving a genuinely simple value (a short number/percentage with no
// "Label:" structure) rendered exactly as before.
function KpiValueContent({ value }: { value: string }) {
  const segments = parseKpiValueSegments(value);
  const [first, ...rest] = segments;

  if (first?.label && looksLikeKpiValueLabel(first.label)) {
    const supporting = rest
      .map((segment) => (segment.label ? `${segment.label}: ${segment.text}` : segment.text))
      .join(" · ");

    return (
      <div className="mt-2 min-h-[3.5rem]">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500">{first.label}</p>
        <p className="line-clamp-1 text-sm font-semibold leading-tight text-white">{first.text || "—"}</p>
        {supporting ? (
          <p className="mt-0.5 line-clamp-1 text-[10px] leading-snug text-zinc-400">{supporting}</p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="mt-2 line-clamp-2 min-h-[3.5rem] max-w-full text-balance text-lg font-semibold leading-tight text-white">
      {value || "Target"}
    </p>
  );
}

function ExecutiveSummaryVisual({
  title,
  content,
  investmentScore,
  isMarketIntelligence = false,
}: {
  title: string;
  content: string;
  investmentScore?: ReportInvestmentScore;
  isMarketIntelligence?: boolean;
}) {
  if (!title.toLowerCase().includes("executive summary") && !title.toLowerCase().includes("yönetici özeti")) {
    return null;
  }

  const evidenceLocale = getResponseLanguage(detectPdfPresentationLocale(content));

  // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
  // decision consistency bug"). Market Intelligence never computes an
  // "AI Investment Score" (investment-score.ts's founder-viability
  // metric, per the report-isolation policy: MI "must never mention a
  // founder ... or any startup-readiness concept") -- it must always show
  // "--" here, never fall through to extractConfidence(content)'s bare
  // percentage scan, which can attach an unrelated "NN%" mentioned
  // anywhere in the executive summary's own prose (e.g. a market-share or
  // CAGR figure) as if it were an investment score.
  const score = isMarketIntelligence
    ? null
    : investmentScore?.totalScore ??
      extractScore(content, "AI Investment Score") ??
      extractConfidence(content);
  // CRITICAL ARCHITECTURE FIX -- centralize executive decision
  // vocabulary (see executive-decision-vocabulary.ts). Every report
  // kind's own, unmodified decision output is translated into the same
  // 4-value label here, instead of showing each report kind's raw word
  // ("GO"/"Proceed with Conditions"/"BUY") verbatim on this KPI card.
  //
  // CRITICAL FIX -- confirmed live (root-cause repair): Market
  // Intelligence now resolves through resolveMarketIntelligenceExecutiveDecision
  // (the ONE canonical decision/confidence source for this report kind),
  // never resolveCanonicalDecisionFromReportText's own detectRecommendation
  // fallback -- that bare keyword scan (`\b(GO|NO GO|WAIT|...)\b`) can
  // match the "GO" inside "Go-to-Market", a phrase virtually every Market
  // Intelligence executive summary mentions when discussing entry
  // strategy, fabricating a "GO" verdict regardless of the report's real,
  // conservative recommendation.
  const marketDecision = isMarketIntelligence
    ? resolveMarketIntelligenceExecutiveDecision(content, evidenceLocale)
    : null;
  const resolvedDecision = isMarketIntelligence
    ? null
    : resolveCanonicalDecisionFromReportText(content, investmentScore?.recommendation);
  const recommendation = marketDecision
    ? marketDecision.decisionLabel
    : resolvedDecision
      ? getCanonicalDecisionLabel(resolvedDecision.decision, evidenceLocale)
      : detectRecommendation(content) || "—";
  const highlights = isMarketIntelligence
    ? getMarketIntelligenceExecutiveHighlights(content)
    : getExecutiveHighlights(content);
  const kpis = [
    {
      label: "Investment Score",
      value: score === null ? "—" : `${score}/100`,
      accent: "from-teal-200/25 to-cyan-200/5",
      evidence: getDashboardMetricEvidence("Investment Score", score === null ? "" : `${score}`, content),
    },
    {
      label: "Decision",
      value: recommendation,
      accent: "from-emerald-300/20 to-teal-300/5",
      evidence: getDashboardMetricEvidence("Decision", recommendation, content),
    },
    {
      // CRITICAL FIX -- confirmed live: Market Intelligence's deterministic
      // Executive Decision banner has no "Market:"/"TAM:" labeled line at
      // all -- this generic Business-Plan-shaped extraction (any line
      // starting with "Market"/"TAM" anywhere in the whole executive
      // summary) risked matching an unrelated clause in free-flowing MI
      // prose rather than a genuine market signal. There is no reliable
      // canonical "Market Signal" source in the deterministic banner, so
      // Market Intelligence now shows the neutral placeholder directly
      // instead of guessing from arbitrary prose. Business Plan/Acquisition
      // are completely untouched.
      label: "Market Signal",
      value: isMarketIntelligence
        ? "—"
        : extractMetricValue(content, "Market") || extractMetricValue(content, "TAM") || "Review",
      accent: "from-sky-300/18 to-teal-300/5",
      evidence: "benchmarkDerived" as EvidenceLevel,
    },
    {
      // CRITICAL FIX -- confirmed live: same generic risk here. Market
      // Intelligence reads its real "Top 3 Risks" list from the
      // deterministic banner (locale-agnostic label lookup, matching the
      // same extraction the PDF's own Executive Decision card already
      // uses), taking only the first named risk for this compact KPI
      // value, rather than an unlabeled "any line starting with Risk"
      // scan of the whole summary.
      label: "Risk Posture",
      value: isMarketIntelligence
        ? takeFirstListItem(extractMetricValueFromAliases(content, localizedLabelVariants("topRisks"))) || "Tracked"
        : extractMetricValue(content, "Risk") || extractMetricValue(content, "Main Risk") || "Tracked",
      accent: "from-amber-300/18 to-teal-300/5",
      evidence: "validationRequired" as EvidenceLevel,
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
                <div className="mt-2">
                  <EvidenceBadge level={kpi.evidence} locale={evidenceLocale} market={isMarketIntelligence} />
                </div>
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
          {/* P0 PRODUCTION FIX -- confirmed live (Market Intelligence
              production presentation hardening): a bare "—" reads as an
              unexplained gap rather than a stated evidence state -- this
              codebase's own dominant convention for "no defensible
              numeric confidence exists" is "Validation Needed" (used
              throughout this file for TAM/SAM/SOM, Competitive
              Landscape, etc.), never a fabricated number. */}
          {confidence === null ? "Confidence: Validation Needed" : `Confidence ${confidence}%`}
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
  investmentScore,
  isMarketIntelligence = false,
  majorPlayersContent = "",
}: {
  title: string;
  content: string;
  investmentScore?: ReportInvestmentScore;
  isMarketIntelligence?: boolean;
  // Competitive Landscape's own table and Major Players' bullet list are
  // built from the exact same evidence-backed vendor set (see
  // extractMarketIntelligenceCompetitorRows' own comment) -- passed
  // through so this card can fall back to Major Players' data when its
  // own table content fails to parse, rather than showing "Validation
  // Needed" while a sibling section plainly names the same vendors.
  majorPlayersContent?: string;
}) {
  const normalizedTitle = title.toLowerCase();
  const evidenceLocale = getResponseLanguage(detectPdfPresentationLocale(content));

  if (normalizedTitle.includes("tam / sam / som")) {
    const bars = [
      { label: "TAM", aliases: ["TAM"], color: "from-teal-200 to-cyan-100" },
      { label: "SAM", aliases: ["SAM"], color: "from-teal-400 to-teal-200" },
      { label: "SOM", aliases: ["SOM"], color: "from-emerald-400 to-teal-300" },
    ];
    // CRITICAL FIX -- do not reintroduce old fake-data behavior. These bar
    // widths used to be static, hardcoded percentages (100%/62%/28%) --
    // identical for every report regardless of the real figures. Widths
    // are now computed from each bar's own extracted value (via
    // parseMonetaryMagnitude), scaled relative to the largest of the
    // three -- TAM is expected to be the largest by definition, so it
    // naturally lands near 100% while SAM/SOM reflect their real,
    // reported proportion of it. A bar with no extractable value shows
    // its own premium "Validation Needed" state instead of a fake bar.
    // CRITICAL FIX -- TAM/SAM/SOM must always be logically nested
    // (TAM >= SAM >= SOM). Each bar previously showed its own extracted
    // value fully independently, which could produce an investor-facing
    // contradiction: TAM "Validation Needed" while SAM/SOM still showed
    // calculated numbers with no verified anchor to size them against. A
    // layer's value is now only ever displayed once every layer above it
    // in the hierarchy is ALSO resolved and correctly nested -- a layer
    // blocked by an unresolved parent shows "Pending <Parent> Validation"
    // instead of a bare "Validation Needed", so the reader can see exactly
    // which upstream figure is holding it back. A layer that has its own
    // value but fails the nesting check against an otherwise-resolved
    // parent (e.g. a SAM larger than its own TAM) falls back to the
    // generic "Validation Needed" -- that is this layer's own data
    // problem, not a cascade from above. Shared with the section-level
    // evidence badge (see resolveTamSamSomCascade's own comment) so the
    // two can never disagree.
    const { values, magnitudes, tamResolved, samResolved, somResolved } = resolveTamSamSomCascade(content);
    const maxMagnitude = Math.max(0, ...magnitudes.filter((magnitude): magnitude is number => magnitude !== null));
    const resolved = [tamResolved, samResolved, somResolved];
    const pendingLabels: Array<string | null> = [
      null,
      !tamResolved ? "Pending TAM Validation" : null,
      !samResolved ? "Pending SAM Validation" : null,
    ];
    // Planning Estimate -- when the model used tamSamSom's benchmark-
    // derived estimate path (all three figures marked [Estimated] rather
    // than verified), each resolved layer gets a clear, non-fabricated
    // "Planning Estimate / Not Verified" tag instead of silently
    // presenting an estimate as a verified figure.
    const estimated = bars.map((bar, index) => resolved[index] && isMarketSizeEstimated(content, bar.label));
    // The reader must see WHY a resolved figure is what it is -- a short,
    // real planning-assumption sentence per layer (the specific scaling
    // basis tamSamSom's own prompt requires stating), not just the bare
    // number. This is the sizing explanation itself, distinct from
    // methodology: the full derivation/formula chain still lives only in
    // this section's own expandable Details disclosure below the visual.
    const assumptions = bars.map((bar, index) => (resolved[index] ? extractMarketSizeAssumption(content, bar.label) : ""));
    // Only remaining explanatory line for this section -- shown when at
    // least one layer is still unresolved (a fully-nested stack needs no
    // extra caveat). The deep formula/calculation derivation still lives
    // only in this section's own expandable Details/Methodology
    // disclosure below the visual, never inline here.
    const hasUnresolvedLayer = resolved.some((isResolved) => !isResolved);

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
          {bars.map((bar, index) => {
            const value = values[index];
            const magnitude = magnitudes[index];
            const isResolved = resolved[index];
            const width = isResolved && magnitude !== null ? `${Math.max(8, (magnitude / maxMagnitude) * 100)}%` : null;
            const isEstimated = estimated[index];
            const assumption = assumptions[index];

            return (
              <div key={bar.label} className="space-y-2">
                <div className="grid items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(7rem,auto)]">
                  <div className="rounded-2xl border border-white/10 bg-black/35 p-3 text-center">
                    <p className="text-xs font-semibold tracking-[0.2em] text-zinc-400">{bar.label}</p>
                    <div className="mt-2 flex justify-center">
                      <EvidenceBadge level={getDashboardMetricEvidence(bar.label, isResolved ? value : "", content)} locale={evidenceLocale} market={isMarketIntelligence} />
                    </div>
                  </div>
                  {width ? (
                    <div className="h-14 rounded-2xl border border-white/10 bg-zinc-950 p-1.5">
                      <div
                        className={`h-full rounded-[1.1rem] bg-gradient-to-r ${bar.color} shadow-lg shadow-teal-950/20`}
                        style={{ width }}
                      />
                    </div>
                  ) : (
                    <div className="flex h-14 items-center rounded-2xl border border-dashed border-white/15 bg-black/20 px-4">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                      <span className="ml-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
                        {pendingLabels[index] || "Validation Needed"}
                      </span>
                    </div>
                  )}
                  {isResolved ? (
                    <div className="min-w-0 space-y-1 text-left sm:text-right">
                      <p className="whitespace-normal rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm font-semibold text-white [overflow-wrap:anywhere] sm:truncate sm:whitespace-nowrap">
                        {formatMetricCardValue(value)}
                      </p>
                      {isEstimated ? (
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200/80">
                          Planning Estimate / Not Verified
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {/* CRITICAL FIX -- confirmed live: line-clamp-2 could still
                    cut off a real, single-sentence methodology/assumption
                    explanation when it ran long (e.g. a stated formula or
                    scaling basis) -- removed so the full sentence the
                    report actually generated is always visible, never a
                    fabricated addition. */}
                {isResolved && assumption ? (
                  <p className="pl-1 text-xs leading-5 text-zinc-500 sm:pl-[4.75rem]">{assumption}</p>
                ) : null}
              </div>
            );
          })}
        </div>
        {hasUnresolvedLayer ? (
          <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-zinc-400">
            Additional market validation is required before sizing can be confirmed.
          </p>
        ) : null}
      </div>
    );
  }

  // FINAL PREMIUM REPORT RESTORATION -- Market Drivers/Barriers/
  // Opportunities/Threats/Customer Segments/Major Players have no
  // separate "methodology" the way TAM/SAM/SOM or Strategic
  // Recommendations do; their generated content IS the primary insight.
  // This card keeps it visible without opening Details -- Key Takeaway
  // (one highlighted line), a genuinely different main explanation
  // (never a restatement of the takeaway), and real bullet points only
  // when the model's own output actually used a list. Never a blank
  // card: falls back to a premium Validation Needed state when nothing
  // could be extracted at all.
  if (
    normalizedTitle.includes("market driver") ||
    normalizedTitle.includes("barrier") ||
    normalizedTitle.includes("opportunities") ||
    normalizedTitle.includes("threat") ||
    normalizedTitle.includes("customer segment") ||
    normalizedTitle.includes("major player") ||
    normalizedTitle.includes("regional analysis") ||
    normalizedTitle.includes("industry trend") ||
    normalizedTitle.includes("market segmentation")
  ) {
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
    // quality failure): this card was the ONE place in the web
    // dashboard that never received the earlier PDF fix
    // (stripLeadingTakeawaySentence, wired into ReportPdfButton.tsx's
    // sectionBodyContent). extractSectionMainExplanation already
    // excludes bulleted lines from its OWN sentence pool and correctly
    // skips the content's first SENTENCE by index when a takeaway
    // exists (see its own comment -- left completely untouched here,
    // still fed the original `content`) -- but extractRealBulletLines
    // has no dedup awareness at all, so a numbered/bulleted first item
    // (the exact reported production shape, "1) Integration-first
    // add-on products...") rendered once as the Key Takeaway and again
    // as the FIRST bullet in the list underneath it. Only the bullets
    // extractor is given the takeaway-stripped content; feeding it to
    // extractSectionMainExplanation too would double-skip a sentence
    // (its own index-1 skip, on top of the sentence stripping already
    // having removed index 0) and silently drop real prose.
    const takeaway = getSectionTakeaway(content);
    const contentWithoutTakeawayDuplication = stripLeadingTakeawaySentence(content, takeaway);
    const explanation = extractSectionMainExplanation(content, takeaway);
    const bullets = extractRealBulletLines(contentWithoutTakeawayDuplication);

    if (!takeaway && !explanation && bullets.length === 0) {
      return (
        <div className="mb-5 rounded-[2rem] border border-dashed border-white/15 bg-black/20 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {title}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
              Validation Needed
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            No {title.toLowerCase()} data could be established for this market yet.
          </p>
        </div>
      );
    }

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          {getReportPresentationLabels(content).keyTakeaway}
        </p>
        {takeaway ? (
          <p className="mt-3 text-lg font-medium leading-7 text-white">{takeaway}</p>
        ) : null}
        {explanation ? (
          <p className="mt-3 text-sm leading-6 text-zinc-400">{explanation}</p>
        ) : null}
        {bullets.length > 1 ? (
          <ul className="mt-4 space-y-2 border-t border-white/10 pt-4">
            {bullets.map((bullet, index) => (
              <li key={index} className="flex gap-2 text-sm leading-6 text-zinc-300">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (normalizedTitle.includes("market opportunity") || normalizedTitle.includes("market overview") || normalizedTitle.includes("market analysis")) {
    const opportunity = extractFirstInsight(content);

    // CRITICAL FIX -- do not reintroduce old fake-data behavior. The
    // Demand/Timing/Access/Defensibility bars below are static, hardcoded
    // percentages -- never derived from this section's actual content --
    // left as-is for Business Plan (out of this fix's scope), but Market
    // Intelligence gets only the honest opportunity panel, full width.
    // Market Intelligence's real market-size/CAGR/indicator figures get
    // their own dedicated, data-driven Market Metrics cards instead (see
    // the "market metrics" title branch below).
    //
    // CRITICAL FIX -- confirmed live: this panel used to show only a
    // line-clamped first sentence, so marketOverview's raw-text Details
    // disclosure below it repeated that same scope statement in full --
    // the exact duplication this ticket's bug report described. Now
    // captures the section's COMPLETE content (headline sentence + the
    // real remaining explanation + any real bullets), the same "capture
    // everything, then suppress the raw duplicate" pattern already used
    // for the Key Takeaway card above -- reusing the same extractors, no
    // new calculation. marketOverview is now safe to add to
    // cardFirstReportFields below.
    if (isMarketIntelligence) {
      const explanation = extractSectionMainExplanation(content, opportunity);
      const bullets = extractRealBulletLines(content);

      return (
        <div className="mb-5 rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.055] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Market Opportunity
          </p>
          <p className="mt-3 text-xl font-semibold leading-8 text-white">
            {opportunity || "Opportunity signal is being evaluated."}
          </p>
          {explanation ? (
            <p className="mt-3 text-sm leading-6 text-teal-50/80">{explanation}</p>
          ) : null}
          {bullets.length > 1 ? (
            <ul className="mt-4 space-y-2 border-t border-teal-200/15 pt-4">
              {bullets.map((bullet, index) => (
                <li key={index} className="flex gap-2 text-sm leading-6 text-teal-50/75">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }

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

  // CRITICAL FIX -- restore Market Intelligence's Market Metrics cards.
  // marketSize and cagr are the two headline market-indicator sections
  // Market Intelligence generates outside of tamSamSom (which already has
  // its own visual above) -- each renders as its own stat card with the
  // real extracted figure, or a premium "Validation Needed" state (never
  // a fabricated number or a plain paragraph) when no figure is present
  // in the generated content, exactly as the generation prompt's own
  // "never invent a value" directive already requires.
  if (normalizedTitle.includes("market size") || normalizedTitle === "cagr" || normalizedTitle.includes("cagr")) {
    const isCagr = normalizedTitle === "cagr" || normalizedTitle.includes("cagr");
    // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): when
    // the evidence names more than one materially different growth-rate
    // figure for what the report presents as one requested market (e.g.
    // 7.0% on one sourced base, 9.8% on a differently-scoped one),
    // extractHeadlineCagrValue's plain first-match regex (unchanged --
    // still used for the single-estimate case, and still the source of
    // truth ReportPdfButton.tsx mirrors) would silently promote whichever
    // number happens to appear first as if it were the one authoritative
    // figure. resolveCagrHeadlinePresentation (report-presentation.ts)
    // detects genuine disagreement and reports an honest range instead --
    // never averaging, never fabricating a scope explanation the evidence
    // never stated.
    const cagrPresentation = isCagr ? resolveCagrHeadlinePresentation(content) : null;
    const value = isCagr
      ? cagrPresentation!.isMultiEstimate
        ? cagrPresentation!.displayValue
        : extractHeadlineCagrValue(content)
      : extractHeadlineMonetaryValue(content);
    // CRITICAL FIX -- confirmed live: this card previously classified
    // ANY extracted figure as "verified" (Data Confirmed) by default,
    // only downgrading it when the content contained the literal
    // "[Estimated]"/"tahmini" tag -- a figure hedged in prose ("could not
    // be independently verified", "requires validation", an assumption
    // or benchmark) with no literal tag still rendered as confirmed
    // evidence. Reuses the SAME canonical evidence classifier TAM/SAM/SOM
    // already uses correctly (getDashboardMetricEvidence ->
    // inferEvidenceLevel), whose default for ambiguous/unlabeled context
    // is "benchmarkDerived", never "verified" -- an assumption, proxy, or
    // derived planning input can no longer be promoted to confirmed
    // market evidence just because no explicit "[Estimated]" tag happens
    // to be present.
    //
    // P0 FIX -- a multi-item field (e.g. cagr with one [Verified] and one
    // [Estimated] line) must not let a DIFFERENT line confirm this one --
    // see extractEvidenceLineForValue's own comment.
    // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): a
    // range built from two genuinely disagreeing estimates can never
    // classify as "verified" ("Data Confirmed") -- no single evidence
    // line supports a two-number range, so scanning either underlying
    // line for "[Verified]" (extractEvidenceLineForValue's own line-match
    // would fail to find any line containing this range value and fall
    // back to the whole field anyway) would let a downstream summary
    // strengthen what is honestly a directional, multi-sourced read.
    // Forced to "benchmarkDerived" ("Market Support") -- an existing,
    // already-correct evidence tier for exactly this shape, never a new
    // one, and never "validationRequired" either: real, sourced evidence
    // for the range DOES exist, it just does not agree on one figure.
    const evidence =
      isCagr && cagrPresentation?.isMultiEstimate
        ? ("benchmarkDerived" as const)
        : getDashboardMetricEvidence(
            isCagr ? "CAGR" : "Market Size",
            value,
            extractEvidenceLineForValue(content, value)
          );

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.1),transparent_30%),rgba(255,255,255,0.025)] p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {isCagr ? "CAGR" : "Market Size"}
          </p>
          {value ? <EvidenceBadge level={evidence} locale={evidenceLocale} market /> : null}
        </div>
        {value ? (
          <>
            <p className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{value}</p>
            {/* CRITICAL FIX -- confirmed live: this evidence paragraph used
                to be clamped to 3 lines, silently hiding most of the
                section's real reasoning/evidence now that its raw-text
                Details disclosure is fully suppressed (marketSize/cagr are
                in cardFirstReportFields) -- the card became a bare number
                with no supporting analysis. Restyled as a distinct,
                labeled evidence block (never re-fabricated; the same real
                content, just no longer visually cut off) rather than a
                clamped leftover. */}
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-200/60">
                Evidence &amp; Analysis
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-400">{content}</p>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/20 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                Validation Needed
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              A defensible figure could not be established for this scope. See the analysis below for
              what would close the gap.
            </p>
          </div>
        )}
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
    const flowMetrics = flow.map((metric) => {
      const value = formatMetricCardValue(extractMetricValue(content, metric));
      return { metric, value, evidence: getDashboardMetricEvidence(metric, value, content) };
    });
    const hasVerifiedEvidence = flowMetrics.some((item) => item.evidence === "verified");

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.025))]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Unit Economics Chain
          </p>
        </div>
        {!hasVerifiedEvidence ? (
          <div className="border-b border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">No founder-confirmed financial data available.</span>{" "}
              The figures below are AI planning scenarios based on industry benchmarks and planning
              assumptions, not confirmed business performance.
            </p>
          </div>
        ) : null}
        <div className="grid gap-px bg-white/10 md:grid-cols-5">
          {flowMetrics.map(({ metric, value, evidence }) => (
            <div key={metric} className="bg-zinc-950/80 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  {getFinancialMetricDisplayLabel(metric, evidence)}
                </p>
                <EvidenceBadge level={evidence} locale={evidenceLocale} financial />
              </div>
              <p className="mt-3 break-words text-lg font-semibold leading-6 text-white sm:truncate sm:whitespace-nowrap">
                {value || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // CRITICAL FIX -- restore Market Intelligence's structured visual
  // presentation. Market Intelligence's own field/title is "Competitive
  // Landscape" -- distinct from Business Plan/Acquisition's "Competitor
  // Landscape" title the branch below matches -- so this report kind's
  // competitor data has always fallen through to plain text here. A
  // dedicated, data-driven table (see extractMarketIntelligenceCompetitorRows'
  // own comment for why it isn't a reuse of the branch below) restores the
  // structured presentation without touching the existing Business
  // Plan/Acquisition visual.
  if (normalizedTitle.includes("competitive landscape")) {
    const rows = extractMarketIntelligenceCompetitorRows(content, majorPlayersContent);

    // No competitor data validated at all -- a large empty table shell
    // (header row with nothing under it) stacked on top of MarketMap's
    // own separate "Validation Needed" box was two empty states for the
    // same problem. Show one clean validation card instead, matching the
    // same premium empty-state language used elsewhere (TAM/SAM/SOM,
    // Market Metrics), and skip MarketMap entirely -- it has nothing to
    // plot with zero rows.
    if (rows.length === 0) {
      // CRITICAL FIX -- confirmed live: before claiming "no competitor
      // data could be validated," check whether Major Players actually
      // names real, plausible vendors that just don't fit the strict
      // row shape (see extractMarketIntelligenceCompetitorNamesOnly's own
      // comment) -- this is what let the report say "no competitor data
      // validated" one section above Major Players naming real vendors
      // like Thomson Reuters/CoCounsel, LexisNexis/Lexis+ AI, Evisort,
      // Fastcase, and Litera/Kira. Never fabricates category/position/
      // strengths/weaknesses to fill the full table -- shows a distinct,
      // honest third state instead.
      const namesOnly = extractMarketIntelligenceCompetitorNamesOnly(majorPlayersContent);

      if (namesOnly.length > 0) {
        return (
          <div className="mb-5 rounded-[2rem] border border-dashed border-white/15 bg-black/20 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
              Competitive Landscape
            </p>
            <div className="mt-4 flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-sky-300" />
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-200">
                Relevant Players Identified — Not Validated as Direct Competitors
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              These companies are named in available evidence as active in or adjacent to this market,
              but current evidence does not independently validate them as direct, head-to-head
              competitors for this analysis.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {namesOnly.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-100"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="mb-5 rounded-[2rem] border border-dashed border-white/15 bg-black/20 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Competitive Landscape
          </p>
          <div className="mt-4 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
              Validation Needed
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            No competitor data could be validated for this market yet.
          </p>
        </div>
      );
    }

    return (
      <div className="mb-5 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
        <div className="border-b border-white/10 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            Competitive Landscape
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Vendors, category, position, strengths, weaknesses, market relevance and validation status
            from the generated analysis.
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1020px]">
            <div className="grid grid-cols-[0.85fr_0.75fr_0.85fr_1fr_1fr_0.75fr_0.85fr] gap-px bg-white/10 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {["Vendor", "Category", "Position", "Strengths", "Weaknesses", "Relevance", "Validation"].map(
                (label) => (
                  <div key={label} className="bg-zinc-950/80 px-4 py-3">
                    {label}
                  </div>
                )
              )}
            </div>
            <div className="grid gap-px bg-white/10">
              {rows.map((row, index) => (
                <div
                  key={`${row.vendor}-${index}`}
                  className="grid grid-cols-[0.85fr_0.75fr_0.85fr_1fr_1fr_0.75fr_0.85fr] bg-black/35 text-sm leading-6 text-zinc-300"
                >
                  <div className="px-4 py-4 font-semibold text-white">{row.vendor || "—"}</div>
                  <div className="px-4 py-4">{row.category || "—"}</div>
                  <div className="px-4 py-4">{row.position || "—"}</div>
                  <div className="px-4 py-4">{row.strengths || "—"}</div>
                  <div className="px-4 py-4">{row.weaknesses || "—"}</div>
                  <div className="px-4 py-4">
                    <span className="rounded-full border border-teal-200/20 bg-teal-200/10 px-2.5 py-1 text-xs font-semibold text-teal-100">
                      {row.relevance || "—"}
                    </span>
                  </div>
                  <div className="px-4 py-4">
                    {row.validationStatus ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-zinc-300">
                        {row.validationStatus}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-200">
                        Validation Needed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <MarketMap rows={rows} />
      </div>
    );
  }

  if (normalizedTitle.includes("strategic recommendation")) {
    const items = extractRecommendationItems(content);

    return (
      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
          Strategic Recommendations
        </p>
        {items.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {items.map((item, index) => {
              const { timeframe, metric, budget, owner, gate } = extractRecommendationSignals(item);
              const fields = [
                { label: "Owner", value: owner },
                { label: "Timeline", value: timeframe },
                { label: "Budget", value: budget },
                { label: "Success Metric", value: metric },
              ].filter((field) => field.value);

              return (
                <div key={index} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-teal-200/30 bg-teal-200/10 text-xs font-semibold text-teal-100">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Action</p>
                      <p className="mt-1 text-sm leading-6 text-zinc-300">{item}</p>
                    </div>
                  </div>
                  {fields.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                      {fields.map((field) => (
                        <div key={field.label}>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                            {field.label}
                          </p>
                          <p className="mt-1 truncate text-xs font-semibold text-teal-100">{field.value}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {gate ? (
                    <div className={fields.length > 0 ? "mt-3" : "mt-3 border-t border-white/10 pt-3"}>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        Decision Gate
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-amber-200">{gate}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-zinc-400">{content}</p>
        )}
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
              <p className="mt-2 max-w-24 rounded-full border border-white/10 bg-black/65 px-2 py-1 text-center text-[11px] font-semibold leading-4 text-zinc-200 sm:max-w-none sm:whitespace-nowrap sm:text-xs">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("financial dashboard")) {
    const dashboardMetrics = getFinancialDashboardMetrics(content).map((metric) => {
      const value = formatMetricCardValue(extractMetricValueFromAliases(content, metric.aliases));
      return { metric, value, evidence: getDashboardMetricEvidence(metric.label, value, content) };
    });
    const hasVerifiedEvidence = dashboardMetrics.some((item) => item.evidence === "verified");

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
          {/* CRITICAL FIX -- do not present AI benchmark estimates as
              confirmed business performance. This badge used to read
              "Live model" unconditionally, regardless of whether any
              metric below was ever confirmed by the founder -- implying
              real, current business data even when every figure is a
              modeled industry-benchmark estimate. It now honestly
              reflects which case applies. */}
          <span
            className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
              hasVerifiedEvidence
                ? "border-teal-200/20 bg-teal-200/10 text-teal-100"
                : "border-amber-300/25 bg-amber-300/10 text-amber-100"
            }`}
          >
            {hasVerifiedEvidence ? "Includes confirmed figures" : "Modeled estimate"}
          </span>
        </div>
        {!hasVerifiedEvidence ? (
          <div className="border-b border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">No founder-confirmed financial data available.</span>{" "}
              The figures below are AI planning scenarios based on industry benchmarks and planning
              assumptions, not confirmed business performance.
            </p>
          </div>
        ) : null}
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardMetrics.map(({ metric, value, evidence }) => {
            // CRITICAL FIX -- do not present AI benchmark estimates as
            // confirmed business performance. This fill used to be a
            // hardcoded, metric-unrelated array with no connection to the
            // card it decorated -- a purely cosmetic "progress" bar that
            // could read as a meaningful confidence/completion indicator
            // even for a 100% benchmark-derived figure. It now tracks the
            // metric's own real evidence tier instead of an arbitrary
            // per-index number.
            const evidenceFillPercent: Record<EvidenceLevel, number> = {
              verified: 100,
              derived: 85,
              benchmarkDerived: 55,
              planningAssumption: 40,
              validationRequired: 25,
            };
            return (
              <div key={metric.label} className="flex min-h-32 min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-3.5 shadow-xl shadow-black/20">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    {getFinancialMetricDisplayLabel(metric.label, evidence)}
                  </p>
                  <EvidenceBadge level={evidence} locale={evidenceLocale} financial />
                </div>
                <div className="mt-4 min-w-0">
                  <p className="break-words text-[clamp(1.15rem,2.2vw,1.65rem)] font-semibold leading-tight tracking-tight text-white sm:truncate sm:whitespace-nowrap">
                    {value || "—"}
                  </p>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${evidence === "verified" ? "bg-teal-200/80" : "bg-amber-300/60"}`}
                      style={{ width: `${evidenceFillPercent[evidence]}%` }}
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

  if (
    normalizedTitle.includes("founder score") ||
    normalizedTitle.includes("founder readiness") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("kurucu hazırlık")
  ) {
    const founderScoreLocale = detectPdfPresentationLocale(content);
    const scoredMetrics = founderScoreDimensionMetrics
      .map((metric) => ({
        metric: localizePdfPresentationLabel(metric.label, founderScoreLocale),
        score: readFounderReadinessMetricValue(metric.label, investmentScore, content),
      }))
      .filter((item): item is { metric: string; score: number } => item.score !== null);

    if (scoredMetrics.length === 0) {
      return null;
    }

    return (
      <div className="mb-5 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
          {founderScoreLocale === "tr" ? "Kurucu Hazırlık Boyutları" : "Founder Readiness Dimensions"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scoredMetrics.map(({ metric, score }) => (
            <GaugeCircle key={metric} label={metric} score={score} />
          ))}
        </div>
      </div>
    );
  }

  // Acquisition Due Diligence's "ROI / IRR Scenarios" title also contains
  // "scenario" -- excluded here so it never renders the generic
  // Business-Plan Worst/Base/Best widget below, which searches for
  // Revenue/MRR/Burn/Runway metrics under "Worst"/"Base"/"Best" headers
  // that this section's own downside/base/upside ROI/IRR content was
  // never asked to use, and would render mostly empty. Falls through to
  // `return null`, so the section's real text content still renders via
  // the surrounding ReportText block.
  if (normalizedTitle.includes("scenario") && !normalizedTitle.includes("roi") && !normalizedTitle.includes("irr")) {
    const scenarioMetrics = isMobilityReportContent(content)
      ? ["Revenue", "Monthly Revenue", "Burn", "Runway", "Risk", "Decision"]
      : ["Revenue", "MRR", "Burn", "Runway", "Risk", "Decision"];
    const styles = {
      Worst: "border-red-300/20 bg-red-300/[0.055]",
      Base: "border-teal-200/20 bg-teal-200/[0.055]",
      Best: "border-emerald-300/20 bg-emerald-300/[0.06]",
    } as const;
    const hasVerifiedEvidence = scenarioMetrics.some((metric) => {
      const value = extractMetricValue(content, metric);
      return getDashboardMetricEvidence(metric, value, content) === "verified";
    });

    return (
      <div className="mb-5 space-y-4">
        {!hasVerifiedEvidence ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-5 py-3">
            <p className="text-xs leading-5 text-amber-100/90">
              <span className="font-semibold">Scenario analysis is modeled, not measured.</span>{" "}
              Baseline financial evidence has not been provided, so the Worst / Base / Best figures
              below are industry-benchmark projections and planning assumptions, not confirmed
              business performance.
            </p>
          </div>
        ) : null}
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
    const recommendationLocale = detectPdfPresentationLocale(content);
    const recommendationDisplayMetrics = getExecutiveRecommendationDisplayMetrics(
      content,
      recommendationLocale
    );
    const recommendationMetrics = [
      ["Confidence", extractConfidence(content) ? `${extractConfidence(content)}%` : "—"],
      ["Investment Needed", recommendationDisplayMetrics.investmentNeeded],
      ["Next Action", recommendationDisplayMetrics.nextAction],
      ["Main Risk", recommendationDisplayMetrics.mainRisk],
    ];

    return (
      <div className="mb-5 rounded-[2.25rem] border border-teal-200/20 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_30%),rgba(94,234,212,0.06)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
              Executive Recommendation
            </p>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
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

  // Acquisition Due Diligence's own "Post-Merger Integration Roadmap
  // (30/60/90 Days)" section title also contains "roadmap"/"yol
  // haritası" -- excluded here so it never renders the generic
  // Business-Plan founder-roadmap widget below (fixed "Tomorrow / This
  // Week / 30 Days / 90 Days / 180 Days / 12 Months" timeline plus a
  // hardcoded "Validate demand / Protect runway / Refine ICP / Measure
  // conversion" checklist -- startup-validation phrasing that has no
  // place in an M&A integration plan). Falling through to `return null`
  // below is correct: the section's real text content still renders via
  // the surrounding ReportText block regardless of this visual widget.
  const isPostMergerRoadmap =
    normalizedTitle.includes("post-merger") || normalizedTitle.includes("birleşme sonrası");

  if (!isPostMergerRoadmap && (normalizedTitle.includes("roadmap") || normalizedTitle.includes("yol haritası"))) {
    return (
      <div className="mb-5 touch-pan-x overflow-x-auto overscroll-x-contain rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(94,234,212,0.08),rgba(255,255,255,0.02))] p-4 [-webkit-overflow-scrolling:touch] [scrollbar-color:rgba(94,234,212,0.3)_transparent] [scrollbar-width:thin] sm:p-5">
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
                className="absolute max-w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/70 px-2 py-1 text-center text-[11px] font-semibold leading-4 text-teal-100 sm:max-w-none sm:px-3 sm:text-xs"
                style={{ left: positions[index][0], top: positions[index][1] }}
              >
                {force}
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {forces.map((force) => {
            const intensity = extractForceIntensity(content, force);
            const implication = extractForceImplication(content, force);

            return (
              <div key={force} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-sm font-semibold text-white">{force}</p>
                {intensity ? (
                  <>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-teal-200/75"
                        style={{ width: `${intensity.width}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">{intensity.level} intensity</p>
                  </>
                ) : (
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
                    Not specified
                  </p>
                )}
                {/* CRITICAL FIX -- confirmed live: line-clamp-3 could cut
                    off a real, single-sentence force implication at this
                    card's narrow width -- removed so the full sentence the
                    report actually generated is always visible. */}
                {implication ? (
                  <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
                    {implication}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (normalizedTitle.includes("kpi")) {
    const kpiMetrics = ["Acquisition", "Activation", "Retention", "Gross Margin", "Payback", "Conversion"];

    return (
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
	        {kpiMetrics.map((metric) => {
	          const value = extractMetricValue(content, metric);
	          const evidence = getDashboardMetricEvidence(metric, value, content);

	          return (
	          <div key={metric} className="grid min-h-[11.5rem] grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
	            <div className="flex items-center">
	              <MiniProgressCircle label="" value={extractPercentScore(content, metric)} />
	            </div>
	            <div className="flex min-w-0 flex-col">
	              <div className="flex min-h-[3rem] flex-col gap-1">
	                <p className="line-clamp-2 text-[10px] font-medium uppercase leading-snug tracking-[0.1em] text-zinc-500">{metric}</p>
	                <EvidenceBadge level={evidence} locale={evidenceLocale} financial />
	              </div>
	              <KpiValueContent value={value} />
	              <div className="mt-auto pt-4">
	                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
	                  <div
	                    className="h-full rounded-full bg-teal-200/80"
                    style={{ width: `${extractPercentScore(content, metric) ?? 66}%` }}
                  />
                </div>
	                <p className="mt-2 text-xs text-zinc-500">Analytics widget</p>
	              </div>
	            </div>
	          </div>
	          );
	        })}
      </div>
    );
  }

  return null;
}

// Positions a vendor on the "Enterprise <-> SME focus" and "Broad
// platform <-> Specialized solution" axes using ONLY keywords already
// present in that vendor's own generated category/position/strengths/
// weaknesses text -- never a fabricated coordinate. A vendor is placed
// only when BOTH axes have a detectable signal; a vendor with signal on
// just one axis (or neither) is omitted from the map entirely rather
// than guessing the other coordinate, per this ticket's own "do not
// fabricate placement" requirement. It still appears in the competitor
// table above regardless.
function inferMarketMapPosition(row: {
  category: string;
  position: string;
  strengths: string;
  weaknesses: string;
}) {
  // Deliberately reads only category/position, not strengths/weaknesses --
  // confirmed live, a weakness like "Limited enterprise features" false-
  // positived the word "enterprise" as if it were this vendor's target
  // segment, when it actually describes the OPPOSITE (a gap in enterprise
  // capability). category/position state the vendor's actual market
  // focus directly, without that negation risk.
  const text = `${row.category} ${row.position}`.toLowerCase();

  let x: number | null = null;
  if (/\benterprise\b/.test(text)) {
    x = 78;
  } else if (/\b(?:sme|smb|small business|mid-market|midmarket|small and medium)\b/.test(text)) {
    x = 22;
  }

  let y: number | null = null;
  if (/\b(?:platform|suite|end-to-end|broad(?:-based)?)\b/.test(text)) {
    y = 22;
  } else if (/\b(?:specialized|specialised|niche|point solution|focused|narrow)\b/.test(text)) {
    y = 78;
  }

  return x !== null && y !== null ? { x, y } : null;
}

function MarketMap({
  rows,
}: {
  rows: Array<{ vendor: string; category: string; position: string; strengths: string; weaknesses: string }>;
}) {
  const placements = rows
    .map((row) => {
      const coordinates = inferMarketMapPosition(row);
      return coordinates ? { vendor: row.vendor || "Vendor", ...coordinates } : null;
    })
    .filter((placement): placement is { vendor: string; x: number; y: number } => placement !== null);

  return (
    <div className="border-t border-white/10 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">Market Map</p>
      {placements.length >= 2 ? (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            Positioning inferred from each vendor&rsquo;s own generated description -- vendors without a clear
            signal on both axes are omitted rather than guessed.
          </p>
          <div className="relative mt-5 h-64 rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(94,234,212,0.07))]">
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
            <div className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
            <span className="absolute left-2 top-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Broad platform
            </span>
            <span className="absolute bottom-2 left-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Specialized
            </span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Enterprise
            </span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              SME
            </span>
            {placements.map((placement) => (
              <div
                key={placement.vendor}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${placement.x}%`, top: `${placement.y}%` }}
              >
                <div className="h-3 w-3 rounded-full bg-teal-200 shadow-[0_0_16px_rgba(94,234,212,0.6)]" />
                <p className="mt-2 max-w-24 rounded-full border border-white/10 bg-black/70 px-2 py-1 text-center text-[10px] font-semibold leading-4 text-teal-100 sm:max-w-none sm:whitespace-nowrap">
                  {placement.vendor}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Validation Needed</p>
          <p className="mt-2 text-sm text-zinc-400">
            Not enough competitors have a clear category or positioning signal on both axes to plot a reliable
            market map yet.
          </p>
        </div>
      )}
    </div>
  );
}

// Market Metrics dashboard -- combines real signals already generated
// across several Market Intelligence sections (marketSize, cagr,
// customerSegments, threats) into one premium tile grid, rather than
// leaving each as a separate full-width card. Every tile is read from
// real content: Market Growth is a directional word (Growing/Declining)
// only when the generated text actually says so; Adoption Signal reads
// customerSegments' own "adoption maturity" language (its prompt
// explicitly asks for it); Risk Level reads a qualitative risk word near
// "risk" in threats, the same bounded-window technique
// extractForceIntensity already uses for Porter's Five Forces. A tile
// with no detectable signal shows "Validation Needed", never a
// fabricated value.
function extractMarketGrowthTrend(marketSizeContent: string, cagrContent: string) {
  const combined = `${marketSizeContent} ${cagrContent}`;
  if (/\b(?:growing|growth|expand(?:ing)?|increasing|accelerating)\b/i.test(combined)) {
    return "Growing";
  }
  if (/\b(?:declin(?:e|ing)|shrink(?:ing)?|contracting|slowing)\b/i.test(combined)) {
    return "Declining";
  }
  return "";
}

function extractAdoptionSignal(customerSegmentsContent: string) {
  return (
    customerSegmentsContent.match(/adoption\s+(?:maturity|stage|signal)[^.\n]*\./i)?.[0]?.trim() ||
    customerSegmentsContent.match(/\b(?:early adopters?|early majority|late majority|mainstream adoption)\b[^.\n]*\./i)?.[0]?.trim() ||
    ""
  );
}

function extractRiskLevel(threatsContent: string) {
  const match = threatsContent.match(/\b(high|significant|severe|moderate|medium|low|limited|minimal)\b[^.\n]{0,40}\brisk\b/i);
  if (!match) return "";
  const word = match[1].toLowerCase();
  if (/high|significant|severe/.test(word)) return "High";
  if (/moderate|medium/.test(word)) return "Moderate";
  return "Low";
}

function MarketMetricsDashboard({
  sections,
}: {
  sections: Array<{ field?: string; title: string; content: string }>;
}) {
  const findContent = (field: string) => sections.find((section) => section.field === field)?.content || "";
  const marketSizeContent = findContent("marketSize");
  const cagrContent = findContent("cagr");
  const customerSegmentsContent = findContent("customerSegments");
  const threatsContent = findContent("threats");

  // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair):
  // resolveCagrHeadlinePresentation (report-presentation.ts, the ONE
  // canonical source both this tile and ReportPdfButton.tsx's identical
  // tile read) reports an honest range instead of picking whichever
  // figure appears first when the evidence names more than one
  // materially different growth-rate estimate.
  const tiles = [
    { label: "Market Growth Signal", value: extractMarketGrowthTrend(marketSizeContent, cagrContent) },
    {
      label: "CAGR",
      value: (() => {
        const cagrPresentation = resolveCagrHeadlinePresentation(cagrContent);
        return cagrPresentation.isMultiEstimate ? cagrPresentation.displayValue : extractHeadlineCagrValue(cagrContent);
      })(),
    },
    { label: "Customer Segment", value: extractFirstInsight(customerSegmentsContent) },
    { label: "Adoption Signal", value: extractAdoptionSignal(customerSegmentsContent) },
    { label: "Risk Level", value: extractRiskLevel(threatsContent) },
  ];

  if (tiles.every((tile) => !tile.value)) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
        Market Metrics
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{tile.label}</p>
            {tile.value ? (
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">{tile.value}</p>
            ) : (
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-amber-200">
                Validation Needed
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// CRITICAL FIX -- restore Market Intelligence's SWOT-equivalent
// four-quadrant visual. Market Intelligence has no single "swotAnalysis"
// field the way Business Plan does -- it generates four SEPARATE, real
// sections instead (marketDrivers/barriers/opportunities/threats). This
// combines those four already-generated sections into one 2x2 grid for
// at-a-glance scanning, using each field's own real title (never
// relabeled as "Strengths"/"Weaknesses", which would misrepresent
// market-level analysis as company-level SWOT). Purely additive: each
// field still renders as its own full section exactly as before: this
// component only supplements them with a combined summary view, and
// only renders once ALL FOUR fields have real content -- never a
// partial/broken-looking 1-3 cell grid.
const marketForcesQuadrants: ReadonlyArray<{ field: string; icon: LucideIcon }> = [
  { field: "marketDrivers", icon: TrendingUp },
  { field: "barriers", icon: Flag },
  { field: "opportunities", icon: Target },
  { field: "threats", icon: TriangleAlert },
];

function MarketForcesQuadrant({
  sections,
}: {
  sections: Array<{ field?: string; title: string; content: string }>;
}) {
  const quadrants = marketForcesQuadrants
    .map(({ field, icon }) => {
      const section = sections.find((candidate) => candidate.field === field);
      return section && section.content.trim()
        ? { title: section.title, icon, bullets: extractBullets(section.content, section.title) }
        : null;
    })
    .filter((quadrant): quadrant is { title: string; icon: LucideIcon; bullets: string[] } => Boolean(quadrant));

  if (quadrants.length < marketForcesQuadrants.length) {
    return null;
  }

  return (
    <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
        Market Forces at a Glance
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {quadrants.map(({ title: quadrantTitle, icon: Icon, bullets }) => (
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
        ))}
      </div>
    </div>
  );
}

function hasReportSectionVisual(title: string) {
  const normalizedTitle = title.toLowerCase();
  // Mirrors the same acquisition-specific exclusions ReportSectionVisual
  // itself applies (see its own comments) -- otherwise this gate opens an
  // empty visual wrapper for a section whose content function correctly
  // renders nothing.
  const isPostMergerRoadmap =
    normalizedTitle.includes("post-merger") || normalizedTitle.includes("birleşme sonrası");
  const isRoiIrrScenario = normalizedTitle.includes("roi") || normalizedTitle.includes("irr");

  return (
    normalizedTitle.includes("executive summary") ||
    normalizedTitle.includes("market opportunity") ||
    normalizedTitle.includes("market overview") ||
    normalizedTitle.includes("market analysis") ||
    normalizedTitle.includes("business model") ||
    normalizedTitle.includes("competitor") ||
    normalizedTitle.includes("competitive landscape") ||
    normalizedTitle.includes("strategic recommendation") ||
    normalizedTitle.includes("market size") ||
    normalizedTitle === "cagr" ||
    normalizedTitle.includes("cagr") ||
    normalizedTitle.includes("tam / sam / som") ||
    normalizedTitle.includes("swot") ||
    normalizedTitle.includes("financial dashboard") ||
    normalizedTitle.includes("financial assumptions") ||
    normalizedTitle.includes("founder score") ||
    normalizedTitle.includes("founder readiness") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("kurucu hazırlık") ||
    (normalizedTitle.includes("scenario") && !isRoiIrrScenario) ||
    normalizedTitle.includes("executive recommendation") ||
    normalizedTitle.includes("yönetici tavsiyesi") ||
    (!isPostMergerRoadmap && (normalizedTitle.includes("roadmap") || normalizedTitle.includes("yol haritası"))) ||
    normalizedTitle.includes("porter") ||
    normalizedTitle.includes("pricing") ||
    normalizedTitle.includes("go-to-market") ||
    normalizedTitle.includes("sales strategy") ||
    normalizedTitle.includes("entry strategy") ||
    normalizedTitle.includes("unit economics") ||
    normalizedTitle.includes("kpi")
  );
}

// FINAL REPORT PRESENTATION CLEANUP -- these fields already get their own
// premium visual card (ExecutiveSummaryVisual, MarketForcesQuadrant plus
// each field's own Key-Takeaway/explanation/bullets card, the TAM/SAM/SOM
// bars, the Porter's Five Forces radar, or the Strategic Recommendation
// action cards), so the generic ExecutiveInsightBanner/SectionTakeaway
// snippets would only repeat the same summary a second (or third) time.
// Full raw text/methodology stays available for all of them, but only
// inside the collapsed AnalysisNotes disclosure -- never as a second
// always-visible summary.
const cardFirstReportFields = new Set([
  "executiveSummary",
  "marketOverview",
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "customerSegments",
  "majorPlayers",
  "regionalAnalysis",
  "industryTrends",
  "marketSegmentation",
  "tamSamSom",
  "strategicRecommendations",
  "portersFiveForces",
  "marketSize",
  "cagr",
  "competitiveLandscape",
]);

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
    normalizedTitle.includes("founder readiness") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("kurucu hazırlık")
  ) {
    return `${base} border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.08),rgba(0,0,0,0.66))]`;
  }

  return `${base} border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.48))]`;
}

function AnalysisNotes({
  children,
  compact,
  label = "Details",
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

function getRiskIndicatorClass(level: string) {
  if (level === "High") {
    return "border-red-300/25 bg-red-300/10 text-red-100";
  }

  if (level === "Medium") {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }

  return "border-teal-300/25 bg-teal-300/10 text-teal-100";
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency hardening): `value ?? 0` treated a genuinely UNKNOWN
// confidence (null, when no defensible numeric score exists) as the
// NUMBER 0 for the ring-fill computation -- structurally the same as a
// real, confirmed 0% score, not "we don't know." The center digit
// already correctly showed "--", but the ring itself was computed as if
// a real 0% value existed, which is exactly the "implies a numeric
// score exists" incoherence this fix removes: an unknown confidence now
// renders as a flat, neutral ring (no fill fraction of ANY kind, real
// or fabricated) rather than a value-derived one that merely happens to
// be empty at 0%.
function SnapshotGauge({
  label,
  value,
  display,
}: {
  label: string;
  value: number | null;
  display: string;
}) {
  const hasNoScore = value === null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
          style={{
            background: hasNoScore
              ? "rgba(255,255,255,0.08)"
              : `conic-gradient(rgb(94 234 212) ${value * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-zinc-950 text-[11px] font-semibold text-white">
            {hasNoScore ? "--" : value}
          </div>
        </div>
        <p className="min-w-0 text-sm font-semibold text-zinc-200">{display}</p>
      </div>
    </div>
  );
}

function ExecutiveSnapshotPanel({
  section,
  investmentScore,
  reportQuality,
  isMarketIntelligence = false,
}: {
  section: { field?: string; title: string; content: string };
  investmentScore?: ReportInvestmentScore;
  reportQuality?: ReportQualityScore;
  isMarketIntelligence?: boolean;
}) {
  if (!isExecutivePresentationSection(section)) {
    return null;
  }

  const snapshot = buildExecutiveSnapshot(section.content, investmentScore, reportQuality);
  // CRITICAL FIX -- remove internal system language from user-facing
  // Market Intelligence output. "Confidence Radar" reads as an internal
  // diagnostic instrument name, and its dimensions (Market/Financial/
  // Execution readiness) are drawn from investmentScore.decisionEngine
  // -- the generic founder-viability score Market Intelligence does not
  // evaluate, so the label itself is doubly misleading for this report
  // kind. Only the label text is overridden here for Market
  // Intelligence; getReportPresentationLabels itself (shared with
  // Business Plan and Acquisition) and the underlying snapshot
  // computation are untouched.
  const isMarketIntelligenceTurkish = detectPdfPresentationLocale(section.content) === "tr";
  const labels = {
    ...getReportPresentationLabels(section.content),
    ...(isMarketIntelligence
      ? {
          confidence: isMarketIntelligenceTurkish ? "Planlama Güveni" : "Planning Confidence",
          confidenceRadar: isMarketIntelligenceTurkish ? "Karar Faktörleri" : "Decision Factors",
        }
      : {}),
  };
  // CRITICAL FIX -- one of buildConfidenceRadar's 5 dimensions is
  // literally labeled "Evidence"/"Kanıt" (it scores competitive-evidence
  // strength for Business Plan/Acquisition's founder-viability score).
  // Renaming that shared dimension label itself would touch other report
  // kinds, so only Market Intelligence's rendered copy of the array is
  // remapped here; the underlying score computation is untouched.
  const confidenceRadarDimensions = isMarketIntelligence
    ? snapshot.confidenceRadar.map((dimension) =>
        dimension.label === "Evidence" || dimension.label === "Kanıt"
          ? { ...dimension, label: isMarketIntelligenceTurkish ? "Pazar Sinyalleri" : "Market Signals" }
          : dimension
      )
    : snapshot.confidenceRadar;
  const reportQualityBreakdown = getReportQualityBreakdown(
    reportQuality,
    labels.reportQuality === "Rapor Kalitesi"
  );
  // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
  // decision consistency bug"). Confirmed live: buildExecutiveSnapshot's
  // generic decision/confidence fallback (used whenever
  // resolveCanonicalDecisionFromReportText fails to find the
  // deterministic banner -- e.g. this report's own legacy
  // pre-Executive-Decision-layer executiveSummary) is built on two unsafe
  // full-content scans: extractDecision's fallback matches ANY standalone
  // GO/WAIT/PASS/... keyword in the ENTIRE report (every Market
  // Intelligence report mentions "Go-to-Market" -- \bGO\b matches the
  // "GO" inside it, since a hyphen is a non-word boundary), and separately
  // maps a matched "PASS" token to "GO" -- backwards. extractConfidence's
  // bare percentage fallback can likewise attach an unrelated "NN%"
  // mentioned near the word "confidence" anywhere in ordinary prose. This
  // is what let a report whose real recommendation was "MONITOR FOR A
  // STAGED U.S. ..." render as "GO"/"30%" wherever that generic fallback
  // was reached with more than just this section's own text. Market
  // Intelligence now resolves decision AND confidence together from ONE
  // canonical function (executive-decision-vocabulary.ts) that never
  // falls through to either unsafe scan: the deterministic banner if
  // present (with confidence read only from that SAME matched line), else
  // the raw "Decision:"/"Recommendation:" labeled text verbatim (never
  // re-scanned for a keyword, never remapped), else an honest "—" with no
  // numeric confidence at all. Business Plan/Acquisition's own generic
  // buildExecutiveSnapshot values are completely untouched.
  const marketDecision = isMarketIntelligence
    ? resolveMarketIntelligenceExecutiveDecision(
        section.content,
        isMarketIntelligenceTurkish ? "Turkish" : "English"
      )
    : null;
  const snapshotDecision = marketDecision ? marketDecision.decisionLabel : snapshot.decision;
  const snapshotConfidenceScore = marketDecision ? marketDecision.confidenceScore : snapshot.confidenceScore;
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // presentation hardening): a bare "—" here read as an unexplained gap
  // in both the header badge ("Confidence: —") and the Confidence Gauge
  // label right below it -- this file's own dominant, already-
  // established convention for "no defensible numeric confidence
  // exists" is "Validation Needed" (TAM/SAM/SOM, Competitive Landscape,
  // etc.), never a fabricated number.
  const snapshotConfidenceDisplay = marketDecision
    ? marketDecision.confidenceScore !== null
      ? `${marketDecision.confidenceScore}%`
      : isMarketIntelligenceTurkish
        ? "Doğrulama Gerekli"
        : "Validation Needed"
    : snapshot.confidence;
  // CRITICAL FIX -- Executive Decision Center. The Founder Readiness
  // gauge reads investmentScore.decisionEngine, the founder-viability
  // score Market Intelligence never computes (report-isolation policy:
  // MI's own prompts "must never mention a founder ... or any
  // startup-readiness concept") -- so it always showed an empty/
  // meaningless gauge for this report kind. Replaced with a Market
  // Signal gauge for MI, reusing the SAME already-computed "Market"
  // confidenceRadar dimension shown a few lines below (not a new
  // calculation) -- a real, MI-appropriate figure instead of a
  // structurally-inapplicable one. Business Plan/Acquisition's founder
  // gauge is completely untouched.
  const marketSignalDimension = isMarketIntelligence
    ? confidenceRadarDimensions.find((dimension) => dimension.label === "Market" || dimension.label === "Pazar") ?? null
    : null;
  // CRITICAL FIX -- confirmed live: this panel's own "Main Risk"/"Next
  // Action" tiles and Risk Level badge were never covered by the decision/
  // confidence fix above -- they still read buildExecutiveSnapshot's
  // generic fallback (investmentScore is always empty for MI, so mainRisk
  // fell to normalizedRiskBullets[0] -- an unbounded full-content bullet
  // scan -- and riskLevel to inferRiskLevel's founder/business-plan
  // keyword presence-check, e.g. "cac"/"funding"). That let this card's
  // "Main Risk" silently disagree with the "Risk Posture" tile a few
  // lines above it in ExecutiveSummaryVisual, which correctly reads the
  // SAME deterministic banner's "Top 3 Risks" field -- two tiles on the
  // same report answering the same question with different text. Now
  // reads the identical canonical alias fields ExecutiveSummaryVisual's
  // Risk Posture tile and getMarketIntelligenceExecutiveHighlights already
  // use, so Main Risk/Next Action can never diverge from them again. Risk
  // Level's severity word is read from that SAME resolved risk sentence
  // (extractRiskLevel, already used identically for Market Metrics'
  // Threats-derived tile) rather than a fabricated classification --
  // falls back to the generic snapshot value only if the banner truly has
  // neither field (never invents a severity that isn't in the text).
  const marketMainRisk = isMarketIntelligence
    ? takeFirstListItem(extractMetricValueFromAliases(section.content, localizedLabelVariants("topRisks"))) ||
      snapshot.mainRisk
    : snapshot.mainRisk;
  const marketNextAction = isMarketIntelligence
    ? extractMetricValueFromAliases(section.content, localizedLabelVariants("immediateNextAction")) ||
      snapshot.nextAction
    : snapshot.nextAction;
  const marketRiskLevel = isMarketIntelligence
    ? (() => {
        const severity = extractRiskLevel(marketMainRisk);
        if (severity === "High") return "High";
        if (severity === "Moderate") return "Medium";
        if (severity === "Low") return "Low";
        return snapshot.riskLevel;
      })()
    : snapshot.riskLevel;
  const groups = [
    { label: labels.why, items: snapshot.why },
    { label: labels.mainRisks, items: snapshot.risks },
    { label: labels.nextActions, items: snapshot.actions },
  ];
  const metrics = [
    { label: labels.financialQuality, value: snapshot.financialQuality },
    { label: labels.reportQuality, value: snapshot.reportQuality },
    { label: labels.mainRisk, value: marketMainRisk },
    { label: labels.nextAction, value: marketNextAction },
  ];

  return (
    <div className="mb-5 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.09),rgba(255,255,255,0.025))] p-4 shadow-inner shadow-teal-950/10">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {labels.executiveSnapshot}
          </p>
          <h4 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {labels.decision}: {snapshotDecision}
          </h4>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-200">
          {labels.confidence}: {snapshotConfidenceDisplay}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <SnapshotGauge
          label={labels.confidenceGauge}
          value={snapshotConfidenceScore}
          display={snapshotConfidenceDisplay}
        />
        {isMarketIntelligence ? (
          <SnapshotGauge
            label={isMarketIntelligenceTurkish ? "Pazar Sinyali" : "Market Signal"}
            value={marketSignalDimension?.score ?? null}
            display={
              marketSignalDimension?.score === null || marketSignalDimension?.score === undefined
                ? isMarketIntelligenceTurkish
                  ? "Doğrulama Gerekli"
                  : "Validation Needed"
                : `${marketSignalDimension.score}%`
            }
          />
        ) : (
          <SnapshotGauge
            label={labels.founderScoreGauge}
            value={snapshot.founderScoreValue}
            display={snapshot.founderScore}
          />
        )}
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {labels.riskLevel}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${getRiskIndicatorClass(marketRiskLevel)}`}>
              {marketRiskLevel}
            </span>
            <p className="line-clamp-2 text-sm leading-5 text-zinc-300">{marketMainRisk}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {metric.label}
            </p>
            <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-zinc-200">
              {metric.value}
            </p>
          </div>
        ))}
      </div>
      {reportQualityBreakdown.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.reportQuality}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {reportQualityBreakdown.map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-100">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.riskHeatmap}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {snapshot.riskHeatmap.map((risk) => (
              <div key={risk.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
                <span className="text-xs text-zinc-300">{risk.label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getRiskIndicatorClass(risk.level)}`}>
                  {risk.level}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
            {labels.confidenceRadar}
          </p>
          <div className="mt-3 space-y-2">
            {confidenceRadarDimensions.map((dimension) => (
              <div key={dimension.label} className="grid grid-cols-[5.75rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                <span className="text-xs text-zinc-400">{dimension.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-teal-200"
                    style={{ width: `${dimension.score ?? 0}%` }}
                  />
                </span>
                <span className="text-right text-xs font-semibold text-zinc-300">
                  {dimension.score === null ? "--" : dimension.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {group.label}
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
              {group.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span className="line-clamp-3">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExecutiveDecisionIntelligencePanel({ metadata }: { metadata?: ReportMetadata }) {
  const summary = readExecutiveDecisionIntelligenceSummary(metadata);

  if (!summary) {
    return null;
  }

  const badges = [
    summary.qualityPassed === null ? null : { label: "Quality", value: summary.qualityPassed ? "Passed" : "Flagged" },
    summary.consistencyPassed === null
      ? null
      : { label: "Consistency", value: summary.consistencyPassed ? "Passed" : "Flagged" },
    summary.reproducibility.present
      ? {
          label: "Reproducibility",
          value: summary.reproducibility.status === "fingerprinted" ? "Fingerprinted" : "Insufficient data",
        }
      : null,
    summary.version.present ? { label: "Schema", value: summary.version.reportSchemaVersion ?? "" } : null,
  ].filter((badge): badge is { label: string; value: string } => badge !== null);

  return (
    <div className="mb-5 rounded-[1.75rem] border border-sky-200/15 bg-[linear-gradient(135deg,rgba(125,211,252,0.09),rgba(255,255,255,0.025))] p-4 shadow-inner shadow-sky-950/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-sky-200/75">
        Executive Decision Intelligence
      </p>
      {summary.verdict ? (
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">
          {stripReportPresentationArtifacts(summary.verdict)}
        </h4>
      ) : null}
      {summary.recommendation ? (
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          {stripReportPresentationArtifacts(summary.recommendation)}
        </p>
      ) : null}
      {summary.aggregateConfidence !== null ? (
        <p className="mt-2 text-xs font-semibold text-zinc-400">
          Aggregate confidence: {summary.aggregateConfidence}/100
        </p>
      ) : null}
      {badges.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              key={badge.label}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-200"
            >
              {badge.label}: {badge.value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getBenchmarkFitLocale(source = "") {
  return /[çğıöşüÇĞİÖŞÜ]|\b(ve|için|pazar|müşteri|yatırım|doğrulama)\b/i.test(source)
    ? "tr"
    : "en";
}

function localizeBenchmarkFitValue(value = "", locale: "en" | "tr") {
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

function BenchmarkIntelligencePanel({
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

function SectionTakeaway({ content }: { content: string }) {
  const takeaway = getSectionTakeaway(content);
  const labels = getReportPresentationLabels(content);

  if (!takeaway) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-200/70">
        {labels.keyTakeaway}
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-300">{takeaway}</p>
    </div>
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
  sourceType?: "Verified source" | "Company reference" | "Industry reference" | "Planning assumption";
};

function normalizeCitationKey(value: string) {
  return sanitizeAiResponseText(value)
    .toLowerCase()
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCitationDomain(url?: string, organization = "") {
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  }

  return sanitizeAiResponseText(organization)
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|company|publisher|organization)\b\.?/g, "")
    .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, ".")
    .replace(/^\.+|\.+$/g, "");
}

function normalizeCitationConfidence(value: string): CitationData["confidence"] | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === "high" || normalized === "strong") {
    return "High";
  }

  if (normalized === "medium" || normalized === "moderate") {
    return "Medium";
  }

  if (normalized === "low") {
    return "Low";
  }

  return undefined;
}

function normalizeSourceType(value: string): CitationData["sourceType"] {
  if (/\b(assumption|planning input|estimate|ai assumption|market-derived|model-derived|needs validation)\b/i.test(value)) {
    return "Planning assumption";
  }

  if (/\b(company|official website|website|pricing page|annual report|investor relations|press release|case study|customer story)\b/i.test(value)) {
    return "Company reference";
  }

  if (/\b(industry|market report|research|benchmark|government|statistics|statista|euromonitor|gartner|forrester|mckinsey|bcg|deloitte|pwc|oecd|world bank|imf|eurostat|tüik|tuik|association)\b/i.test(value)) {
    return "Industry reference";
  }

  return "Verified source";
}

function normalizeCitationUrl(value = "") {
  const normalized = sanitizeAiResponseText(value).trim();

  if (
    !normalized ||
    /^[-–—]+$/.test(normalized) ||
    /^(?:not verified|url doğrulanmadı|n\/?a|not available|none|null|undefined)$/i.test(normalized)
  ) {
    return "";
  }

  return /^https?:\/\//i.test(normalized) ? normalized : "";
}

// Mirrors ReportPdfButton.tsx's own guard: market-analysis/route.ts
// appends buildMarketFinalVerdictParagraph's closing narrative ("Final
// Investment Decision" / "The verdict is GO at 66% confidence. The
// deciding factor -- '...' -- outweighs the identified risks...") to the
// Sources field. Its own "X -- Y -- Z" dash structure matches the
// citationMatch fallback below and mints a fabricated source card
// (Publisher: "The deciding factor") on the on-screen report -- the same
// generated-prose-as-source defect confirmed live in the exported PDF,
// on this on-screen path too since it has no shape guard on the
// "organization" capture group at all. Cut the paragraph off before
// citation parsing ever sees it, in every language it's written in.
const marketVerdictParagraphHeadings = [
  "Final Investment Decision",
  "Nihai Yatırım Kararı",
  "Endgültige Investitionsentscheidung",
  "Décision d'investissement finale",
  "Decisión de inversión final",
];

function stripMarketVerdictParagraph(content: string): string {
  let cutIndex = content.length;
  for (const heading of marketVerdictParagraphHeadings) {
    const index = content.indexOf(heading);
    if (index !== -1 && index < cutIndex) {
      cutIndex = index;
    }
  }
  return content.slice(0, cutIndex).trimEnd();
}

function parseCitations(rawContent: string): CitationData[] {
  const content = stripMarketVerdictParagraph(rawContent);
  if (/\bsource\s+unavailable\b/i.test(content)) {
    return [];
  }

  const fallbackConfidence = normalizeCitationConfidence(
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low)\b/i)?.[1] || ""
  );

  const citations = content
    .split("\n")
    .map((rawLine) => {
      const url = normalizeCitationUrl(
        rawLine.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() ||
          rawLine.match(/\bhttps?:\/\/[^\s)]+/i)?.[0]?.trim() ||
          ""
      );
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
        sourceType: normalizeSourceType(line),
      };
    })
    .filter((citation): citation is CitationData => Boolean(citation));
  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const domain = getCitationDomain(citation.url, citation.organization);
    const titleKey = normalizeCitationKey(citation.sourceTitle);
    const publisherKey = normalizeCitationKey(citation.organization);
    const key = domain && titleKey
      ? `domain-title-publisher:${domain}|${titleKey}|${publisherKey}`
      : [
          "source",
          domain || "no-domain",
          publisherKey,
          titleKey,
        ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...existing,
      ...citation,
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
    });
  });

  return Array.from(unique.values());
}

// CRITICAL FIX -- remove internal system language from user-facing
// Market Intelligence output. A raw "Verified source"/"Not verified"
// classifier readout on every source card reads as an internal
// research-database entry, not a premium executive report's own
// citation list. Only Market Intelligence's source list is reworded
// (around "market validation status," per the requesting ticket's own
// vocabulary) -- Business Plan and Acquisition, which also render this
// component, keep the existing wording unchanged.
function CitationCard({ citation, market = false }: { citation: CitationData; market?: boolean }) {
  const domain = getCitationDomain(citation.url, citation.organization);
  const sourceTypeLabel =
    market && (citation.sourceType || "Verified source") === "Verified source"
      ? "Validated Source"
      : citation.sourceType;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 shadow-lg shadow-black/15 ring-1 ring-white/[0.02] transition duration-300 hover:border-teal-200/20 hover:bg-white/[0.035]">
      <p className="text-sm font-semibold leading-6 text-white">{citation.sourceTitle}</p>
      <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
        {domain ? (
          <p>
            <span className="text-zinc-500">Domain</span>
            <span className="ml-2 text-zinc-200">{domain}</span>
          </p>
        ) : null}
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
            <span className="text-zinc-500">{market ? "Validation status" : "Confidence"}</span>
            <span className="ml-2 text-zinc-200">{citation.confidence}</span>
          </p>
        ) : null}
        {sourceTypeLabel ? (
          <p>
            <span className="text-zinc-500">Type</span>
            <span className="ml-2 text-zinc-200">{sourceTypeLabel}</span>
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
      ) : (
        <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs text-zinc-500">
          {market ? "Not yet validated" : "Not verified"}
        </p>
      )}
    </div>
  );
}

function CitationList({
  content,
  mobile = false,
  market = false,
}: {
  content: string;
  mobile?: boolean;
  market?: boolean;
}) {
  const citations = parseCitations(content);

  if (citations.length === 0) {
    return <ReportText content={content} mobile={mobile} />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {citations.map((citation, index) => (
        <CitationCard
          key={`${getCitationDomain(citation.url, citation.organization)}-${citation.sourceTitle}-${citation.publicationYear || ""}-${citation.url || ""}-${index}`}
          citation={citation}
          market={market}
        />
      ))}
    </div>
  );
}

function ReportText({
  content,
  mobile = false,
}: {
  content: string;
  mobile?: boolean;
}) {
  const blocks = normalizeReportPresentationText(
    cleanEvidenceMetadataForDisplay(sanitizeAiResponseText(content))
  )
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div
      className={
        mobile
          ? "space-y-5 text-[15.5px] leading-7 text-zinc-300 [hyphens:auto] [overflow-wrap:anywhere]"
          : "space-y-6 text-[15px] leading-8 text-zinc-300 md:text-base md:leading-8"
      }
    >
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const isList = lines.every((line) => /^[-*]\s+/.test(line));
        const isNumberedList =
          mobile &&
          lines.every((line) => /^\d+[.)]\s+/.test(line));
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
              className={`max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-black/55 text-sm leading-7 text-teal-100 shadow-inner shadow-black/40 ring-1 ring-white/[0.02] [-webkit-overflow-scrolling:touch] ${
                mobile ? "touch-pan-x p-3.5" : "p-4"
              }`}
            >
              <code>{code}</code>
            </pre>
          );
        }

        if (isList) {
          return (
            <ul
              key={`list-${blockIndex}`}
              className={`rounded-2xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 shadow-inner shadow-black/15 ${
                mobile ? "space-y-3.5 p-3.5" : "space-y-3 p-4"
              }`}
            >
              {lines.map((line, lineIndex) => (
                <li key={`line-${blockIndex}-${lineIndex}-${line}`} className="flex gap-3 leading-7">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-200/80" />
                  <span className="min-w-0">{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol
              key={`ordered-list-${blockIndex}`}
              className="space-y-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3.5 text-zinc-300 shadow-inner shadow-black/15"
            >
              {lines.map((line, lineIndex) => {
                const marker = line.match(/^(\d+)[.)]\s+/)?.[1] || String(lineIndex + 1);

                return (
                  <li
                    key={`ordered-line-${blockIndex}-${lineIndex}-${line}`}
                    className="flex items-start gap-3 leading-7"
                  >
                    <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-teal-200/20 bg-teal-200/10 px-1 text-[11px] font-semibold text-teal-100">
                      {marker}
                    </span>
                    <span className="min-w-0">
                      {renderInlineMarkdown(line.replace(/^\d+[.)]\s+/, ""))}
                    </span>
                  </li>
                );
              })}
            </ol>
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
            <div
              key={`table-${blockIndex}`}
              className={`max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-black/25 shadow-xl shadow-black/15 ring-1 ring-white/[0.02] [-webkit-overflow-scrolling:touch] ${
                mobile
                  ? "touch-pan-x [scrollbar-color:rgba(94,234,212,0.3)_transparent] [scrollbar-width:thin]"
                  : ""
              }`}
            >
              <table
                className={`w-full border-collapse text-left text-sm ${
                  mobile ? "min-w-[36rem]" : "min-w-[42rem]"
                }`}
              >
                <thead className="bg-white/[0.07] text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <tr>
                    {headerRow?.map((cell, cellIndex) => (
                      <th
                        key={`header-${blockIndex}-${cellIndex}-${cell}`}
                        className={`font-semibold text-zinc-300 ${
                          mobile
                            ? "min-w-[8.5rem] whitespace-normal px-3.5 py-3 [overflow-wrap:anywhere]"
                            : "px-4 py-3"
                        }`}
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-zinc-300">
                  {bodyRows.map((row, rowIndex) => (
                    <tr key={`${row.join("-")}-${rowIndex}`} className="transition hover:bg-white/[0.025]">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${cell}-${cellIndex}`}
                          className={`align-top leading-7 ${
                            mobile
                              ? "whitespace-normal px-3.5 py-3 [overflow-wrap:anywhere]"
                              : "px-4 py-3"
                          }`}
                        >
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
            <h3
              key={`h3-${blockIndex}`}
              className={`font-semibold tracking-[-0.015em] text-white ${
                mobile ? "pt-3 text-lg leading-7" : "pt-4 text-lg"
              }`}
            >
              {renderInlineMarkdown(block.slice(4))}
            </h3>
          );
        }

        if (block.startsWith("## ")) {
          return (
            <h2
              key={`h2-${blockIndex}`}
              className={`font-semibold tracking-[-0.02em] text-white ${
                mobile ? "pt-3 text-xl leading-7" : "pt-4 text-xl"
              }`}
            >
              {renderInlineMarkdown(block.slice(3))}
            </h2>
          );
        }

        return (
          <p
            key={`p-${blockIndex}`}
            className={`max-w-4xl whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere] ${
              mobile ? "text-pretty" : ""
            }`}
          >
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

  const { data: workspace } = report.workspaceId
    ? await supabase
        .from("report_workspaces")
        .select("id,name")
        .eq("user_id", user.id)
        .eq("id", report.workspaceId)
        .maybeSingle()
    : { data: null };

  const storedReportSections = Array.from(
    new Map(report.sections.map((section) => [section.field || section.title, section])).values()
  );
  const isLegalReport = isLegalRenderableReport(report);
  const reportLocale = detectPdfPresentationLocale(
    report.prompt || storedReportSections.map((section) => section.content).join("\n")
  );
  const reportEvidenceLocale = getResponseLanguage(reportLocale);
  const uniqueReportSections = isLegalReport
    ? buildLegalReportSections(storedReportSections, reportLocale, report.prompt)
        .map((section) =>
          section.field === "legalSources"
            ? {
                ...section,
                content: formatLegalSourceContent(section.content, reportLocale),
              }
            : section
        )
        .filter((section) => section.content.trim())
    : storedReportSections;
  // CRITICAL FIX -- apply presentation sanitization to ALL report
  // surfaces. Confirmed live: buildLegalReportSections above can
  // reconstruct a FRESH "legalSources" section from the report's own
  // citation content -- entirely after normalizeReport already excluded
  // the original "sources"/"externalEvidence" fields -- so this dashboard
  // viewer's own local isSourceSectionTitle-based split still surfaced a
  // dedicated "Sources" appendix built from that reconstructed content.
  // Uses the same canonical isUniversalCustomerFacingSection check
  // ReportPdfButton.tsx's own late-stage filter uses, so the two surfaces
  // can never drift out of sync again on what counts as a sources/
  // evidence section -- and sourceSections is now always empty rather
  // than a rendered "Research Appendix": the requirement is to remove the
  // section entirely, not relocate it. stripReportPresentationArtifacts
  // is the final defensive pass against any other internal artifact
  // buildLegalReportSections' reconstruction might reintroduce.
  const isMarketIntelligenceReport = report.type === "Market Analysis";
  const visibleSections = uniqueReportSections
    .filter((section) => isUniversalCustomerFacingSection(section))
    .map((section) => ({
      ...section,
      content: isMarketIntelligenceReport
        ? sanitizeMarketIntelligencePresentationText(stripReportPresentationArtifacts(section.content))
        : stripReportPresentationArtifacts(section.content),
    }))
    .filter((section) => section.content.trim().length > 0);
  const sourceSections: typeof uniqueReportSections = [];
  const getReportSectionKey = (section: (typeof report.sections)[number]) =>
    `${report.id}:${section.field || section.title}`;
  const decisionSummaryItems = getDecisionSummaryItems(visibleSections, isMarketIntelligenceReport);
  const decisionSignalItem =
    decisionSummaryItems.find((item) => item.label === "Decision Signal") ||
    decisionSummaryItems[0];
  const mainInsightItem =
    decisionSummaryItems.find((item) => item.label === "Main Insight") ||
    decisionSummaryItems[1];
  const nextStepItem =
    decisionSummaryItems.find((item) => item.label === "Recommended Next Step") ||
    decisionSummaryItems[2];
  const reportIntelligenceOverview = getReportIntelligenceOverview(visibleSections);
  const validationIntelligenceOverview = getValidationIntelligenceOverview(
    visibleSections,
    report.metadata?.validationIntelligence
  );
  const continueAnalysisHref = `/chat?reportId=${encodeURIComponent(report.id)}`;
  const regenerateMode = report.type === "Market Analysis" ? "market" : "plan";
  const regenerateParams = new URLSearchParams({
    new: "1",
    mode: regenerateMode,
    reportId: report.id,
  });

  if (report.workspaceId) {
    regenerateParams.set("workspaceId", report.workspaceId);
  }

  const regenerateReportHref = `/plan?${regenerateParams.toString()}`;
  const workspaceHref = workspace?.id
    ? `/dashboard/workspaces/${workspace.id}`
    : "/dashboard#workspaces";
  const workspaceName = typeof workspace?.name === "string" ? workspace.name : "Workspace";
  const executiveSummaryIndex = visibleSections.findIndex((section) =>
    section.title.toLowerCase().includes("executive summary")
  );

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-black text-white lg:min-h-screen lg:overflow-hidden">
      <ReportScrollProgress />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 pt-5 pb-[calc(10rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-10 lg:py-8">
          <div className="space-y-5 lg:hidden">
            <div className="rounded-[2rem] border border-white/[0.12] bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.03] backdrop-blur-2xl">
              <Link
                href="/dashboard"
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-sm font-medium text-zinc-400 shadow-lg shadow-black/10 transition duration-300 hover:border-teal-200/25 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
              >
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/70">
                Mobile Report Reader
              </p>
              <h1 className="mt-2 text-pretty text-3xl font-semibold leading-[1.15] tracking-[-0.035em] text-white [overflow-wrap:anywhere]">
                {report.title}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1">
                  {report.type}
                </span>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 capitalize">
                  {report.status}
                </span>
                <Link
                  href={workspaceHref}
                  className="rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1 text-teal-100"
                >
                  {workspaceName}
                </Link>
              </div>
            </div>

            <section className="overflow-hidden rounded-[2rem] border border-teal-200/20 bg-teal-200/[0.055] shadow-2xl shadow-black/30 ring-1 ring-teal-200/10 backdrop-blur-xl">
              <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.02))] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-100/75">
                  Decision Snapshot
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {decisionSignalItem?.value || "—"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {decisionSignalItem?.detail || "Review the decision evidence before moving forward."}
                </p>
              </div>
              <div className="grid gap-3 p-4">
                <div className="rounded-[1.35rem] border border-white/10 bg-black/30 p-4 shadow-lg shadow-black/15">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">
                    Main Insight
                  </p>
                  <p className="mt-2 text-base font-semibold leading-6 text-white">
                    {mainInsightItem?.value || "Primary insight requires review."}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    {mainInsightItem?.detail || "Risk profile is detailed in the report."}
                  </p>
                </div>
                <Link
                  href={continueAnalysisHref}
                  className="rounded-[1.35rem] border border-teal-300/20 bg-teal-300/[0.1] p-4 shadow-lg shadow-teal-950/10 transition duration-300 hover:border-teal-300/35 hover:bg-teal-300/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-100/75">
                        Recommended Next Action
                      </p>
                      <p className="mt-2 text-xl font-semibold leading-7 text-white">
                        {nextStepItem?.value || "Continue analysis"}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {nextStepItem?.detail || "Use this report as advisor context."}
                      </p>
                    </div>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-200 text-black">
                      <MessageSquareText className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              </div>
            </section>

            <div className="grid gap-3">
              <Link
                href={continueAnalysisHref}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20"
              >
                <MessageSquareText className="h-4 w-4" />
                Continue Analysis
              </Link>
              <div className="pointer-events-auto relative z-40 grid gap-3 sm:grid-cols-2">
                <RegenerateReportButton href={regenerateReportHref} />
                <ShareReportButton title={report.title} />
                <ReportPdfButton report={report} />
              </div>
            </div>

            {visibleSections.length > 0 ? (
              <nav
                aria-label="Report sections"
                className="touch-pan-x overflow-x-auto overscroll-x-contain rounded-[1.35rem] border border-white/[0.12] bg-white/[0.045] p-2 shadow-xl shadow-black/20 ring-1 ring-white/[0.03] [-webkit-overflow-scrolling:touch] [scrollbar-color:rgba(94,234,212,0.3)_transparent] [scrollbar-width:thin]"
              >
                <div className="flex min-w-max gap-2">
                  {visibleSections.map((section, index) => (
                    <a
                      key={`mobile-nav-${getReportSectionKey(section)}`}
                      href={`#mobile-report-section-${index + 1}`}
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-teal-200/30 hover:bg-teal-200/10 hover:text-teal-100"
                    >
                      <span className="text-zinc-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {section.title}
                    </a>
                  ))}
                  {sourceSections.length > 0 ? (
                    <a
                      href="#mobile-report-sources"
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-2 text-xs font-semibold text-teal-100"
                    >
                      Sources
                    </a>
                  ) : null}
                </div>
              </nav>
            ) : null}

            <section className="space-y-4">
              {visibleSections.length === 0 ? (
                <div className="rounded-[1.55rem] border border-dashed border-white/10 bg-black/35 p-6 text-center shadow-inner shadow-black/25">
                  <FileText className="mx-auto h-7 w-7 text-teal-200" />
                  <h2 className="mt-4 text-xl font-semibold text-white">
                    No report sections saved yet
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    This report shell exists, but no readable analysis sections were saved.
                  </p>
                </div>
              ) : (
                visibleSections.map((section, index) => {
                  const isFinancialDashboard = section.title
                    .toLowerCase()
                    .includes("financial dashboard");
                  const detailsContent = isFinancialDashboard
                    ? ""
                    : section.field === "founderScore"
                      ? normalizeFounderReadinessScoreText(
                          section.content,
                          readFounderReadinessScoreValue(report.investmentScore)
                        )
                      : section.content;
                  // Card-first sections (see cardFirstReportFields) already
                  // surface their COMPLETE content via a dedicated visual card
                  // -- the raw paragraph below it would only repeat what the
                  // card already fully communicates, so it renders neither
                  // expanded nor collapsed for these sections (matching the
                  // desktop treatment). Every other section type is
                  // unchanged.
                  const isCardFirstSection = cardFirstReportFields.has(section.field ?? "");

                  return (
                    <div
                      id={`mobile-report-section-${index + 1}`}
                      key={`mobile-${getReportSectionKey(section)}`}
                      className="scroll-mt-24"
                    >
                      <MobileReportSection
                        title={section.title}
                        eyebrow={`Section ${String(index + 1).padStart(2, "0")}`}
                        defaultOpen={index === executiveSummaryIndex || index === 0}
                      >
                        <div className="min-w-0 space-y-5">
                          <div className="min-w-0 [&>*]:max-w-full">
                            {!isLegalReport ? (
                              <ReportSectionVisual
                                title={section.title}
                                content={section.content}
                                investmentScore={report.investmentScore}
                                isMarketIntelligence={report.type === "Market Analysis"}
                                majorPlayersContent={
                                  visibleSections.find((entry) => entry.field === "majorPlayers")?.content
                                }
                              />
                            ) : null}
                          </div>
                          {detailsContent.trim() && !isCardFirstSection ? (
                            <div className="min-w-0 rounded-[1.25rem] border border-white/[0.12] bg-black/30 p-3.5 shadow-inner shadow-black/20">
                              <ReportText content={detailsContent} mobile />
                            </div>
                          ) : null}
                          <CopySectionButton content={section.content} />
                        </div>
                      </MobileReportSection>
                    </div>
                  );
                })
              )}

              {sourceSections.length > 0 ? (
                <div id="mobile-report-sources" className="scroll-mt-24">
                  <MobileReportSection
                    title="Sources"
                    eyebrow="Research Appendix"
                  >
                    <div className="min-w-0 space-y-5">
                      {sourceSections.map((section) => (
                        <CitationList
                          key={`mobile-source-${getReportSectionKey(section)}`}
                          content={section.content}
                          market={report.type === "Market Analysis"}
                          mobile
                        />
                      ))}
                      <CopySectionButton
                        content={sourceSections.map((section) => section.content).join("\n\n")}
                        label="Copy sources"
                      />
                    </div>
                  </MobileReportSection>
                </div>
              ) : null}
            </section>
          </div>

          <div className="hidden lg:block">
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
                <ShareReportButton title={report.title} />
                <ReportPdfButton report={report} />
                <Link
                  href={continueAnalysisHref}
                  className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-white/10 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-zinc-200 hover:shadow-2xl hover:shadow-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <MessageSquareText className="h-4 w-4" />
                  Continue Analysis
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
	              <div className="flex items-center gap-3">
	                <Sparkles className="h-5 w-5 text-teal-200" />
	                <p className="text-sm text-zinc-500">Report Type</p>
	              </div>
	              <div className="mt-3">
	                <EvidenceBadge level="planningAssumption" locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
	              </div>
	              <p className="mt-3 text-lg font-semibold text-white">{report.type}</p>
            </div>
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
	              <div className="flex items-center gap-3">
	                <CalendarDays className="h-5 w-5 text-teal-200" />
	                <p className="text-sm text-zinc-500">Created</p>
	              </div>
	              <div className="mt-3">
	                <EvidenceBadge level="verified" locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
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
	              <div className="mt-3">
	                <EvidenceBadge level="verified" locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
	              </div>
	              <p className="mt-3 text-lg font-semibold text-white">{report.status}</p>
            </div>
            <Link
              href={workspaceHref}
              className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30"
            >
	              <div className="flex items-center gap-3">
	                <BookOpen className="h-5 w-5 text-teal-200" />
	                <p className="text-sm text-zinc-500">Workspace</p>
	              </div>
	              <div className="mt-3">
	                <EvidenceBadge level="verified" locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
	              </div>
	              <p className="mt-3 line-clamp-2 text-lg font-semibold text-white">
                {workspaceName}
              </p>
            </Link>
          </div>

          {!isLegalReport ? <>
          <section className="mt-6 overflow-hidden rounded-[2.15rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] p-5 sm:p-6">
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                REPORT INTELLIGENCE
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight text-white">
                    {reportIntelligenceOverview.quality}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    {reportIntelligenceOverview.confidenceSummary}
                  </p>
                </div>
                <div className="rounded-2xl border border-teal-200/20 bg-teal-200/10 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-100/70">
                    Quality Score
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {reportIntelligenceOverview.qualityScore}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
              <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-teal-200" />
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                    Strengths
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {reportIntelligenceOverview.strengths}
                </p>
              </article>
              <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3">
                  <TriangleAlert className="h-5 w-5 text-amber-200" />
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-100/75">
                    Risks
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {reportIntelligenceOverview.risks}
                </p>
              </article>
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-[2.15rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-xl">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] p-5 sm:p-6">
              <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                VALIDATION INTELLIGENCE
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight text-white">
                    {validationIntelligenceOverview.score}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                    Convert the highest-risk assumptions into experiments before scaling capital or acquisition.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
              <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3">
                  <Target className="h-5 w-5 text-teal-200" />
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                    Top Assumption
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {validationIntelligenceOverview.topAssumption}
                </p>
              </article>
              <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3">
                  <Gauge className="h-5 w-5 text-teal-200" />
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                    Experiment
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {validationIntelligenceOverview.experiment}
                </p>
              </article>
              <article className="rounded-[1.55rem] border border-white/10 bg-black/30 p-5 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-teal-200" />
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
                    Success Criteria
                  </p>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  {validationIntelligenceOverview.successCriteria}
                </p>
              </article>
            </div>
          </section>
          </> : null}

          <section className="mt-6 overflow-hidden rounded-[2.15rem] border border-teal-200/15 bg-teal-200/[0.045] shadow-2xl shadow-black/35 ring-1 ring-teal-200/5 backdrop-blur-xl">
            <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.02))] p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.35em] text-teal-300/70">
                  DECISION INTELLIGENCE
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  Decision summary
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Review the decision signal, main insight and next step before moving into the full report.
                </p>
              </div>
            </div>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
              {decisionSummaryItems.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.label}
                    className="min-h-[13rem] rounded-[1.55rem] border border-white/10 bg-black/35 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02]"
                  >
	                    <div className="flex items-center gap-3">
	                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
	                        <Icon className="h-4 w-4 text-teal-100" />
	                      </span>
	                      <div className="min-w-0">
	                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-200/70">
	                          {item.label}
	                        </p>
	                        <div className="mt-2">
	                          <EvidenceBadge level={item.evidence} locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
	                        </div>
	                      </div>
	                    </div>
                    <p className="mt-4 break-words text-xl font-semibold leading-7 tracking-tight text-white [overflow-wrap:anywhere]">
                      {item.value}
                    </p>
                    <p className="mt-3 break-words text-sm leading-6 text-zinc-400 [overflow-wrap:anywhere]">
                      {item.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

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

                <div className="space-y-8 xl:max-w-5xl">
                  {!isLegalReport ? (
                    <BenchmarkIntelligencePanel
                      benchmarkFit={report.metadata?.benchmarkFit}
                      benchmarkScore={report.metadata?.benchmarkScore}
                      sourceText={`${report.title}\n${report.prompt}\n${uniqueReportSections
                        .map((section) => `${section.title}\n${section.content}`)
                        .join("\n\n")}`}
                    />
                  ) : null}

                  {visibleSections.map((section, index) => {
                    const Icon = getSectionIcon(section.title);
                    const isFinancialDashboard = section.title
                      .toLowerCase()
                      .includes("financial dashboard");
                    const detailsContent = isFinancialDashboard
                      ? ""
                      : normalizeReportPresentationText(
                          section.field === "founderScore"
                            ? normalizeFounderReadinessScoreText(
                                section.content,
                                readFounderReadinessScoreValue(report.investmentScore)
                              )
                            : section.content
                        );
                    const presentationLabels = getReportPresentationLabels(section.content);

                    return (
                      <details
                        id={`report-section-${index + 1}`}
                        key={getReportSectionKey(section)}
                        open
                        className={`${getReportArticleClass(section.title)} group scroll-mt-8`}
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/30 to-transparent" />
                        <summary className="flex cursor-pointer list-none flex-col gap-4 rounded-[1.35rem] transition duration-300 hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 sm:flex-row sm:items-start [&::-webkit-details-marker]:hidden">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-inner shadow-white/5">
                            <Icon className="h-5 w-5 text-teal-200" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	                              <div>
	                                <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
	                                  {reportLocale === "tr" ? "Bölüm" : "Section"} {String(index + 1).padStart(2, "0")}
	                                </span>
	                                {!isLegalReport ? (
	                                  <div className="mt-2">
	                                    <EvidenceBadge level={getDashboardSectionEvidence(section)} locale={reportEvidenceLocale} market={report.type === "Market Analysis"} />
	                                  </div>
	                                ) : null}
	                                <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white">
	                                  {section.title}
	                                </h2>
                              </div>
                              <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-zinc-300 ring-1 ring-white/[0.02] transition duration-300 group-hover:border-teal-200/30 group-hover:text-teal-100">
                                <span className="group-open:hidden">Expand</span>
                                <span className="hidden group-open:inline">Collapse</span>
                              </span>
                            </div>
                          </div>
                        </summary>
                        <div className="mt-5 border-t border-white/10 pt-6">
                          <div className="mb-5 flex justify-end">
                            <CopySectionButton content={section.content} />
                          </div>
                              {isLegalReport ? (
                                detailsContent.trim() ? <ReportText content={detailsContent} /> : null
                              ) : <>
                              <ExecutiveSummaryVisual
                                title={section.title}
                                content={section.content}
                                investmentScore={report.investmentScore}
                                isMarketIntelligence={report.type === "Market Analysis"}
                              />
                              <ExecutiveSnapshotPanel
                                section={section}
                                investmentScore={report.investmentScore}
                                reportQuality={report.metadata?.reportQuality}
                                isMarketIntelligence={report.type === "Market Analysis"}
                              />
                              {/* CRITICAL FIX -- confirmed live: the Executive Decision
                                  System's explainability/verdict metadata was never
                                  gated to exclude Market Intelligence, even though EDS
                                  is deliberately scoped to Business Idea Validation only
                                  (see app/api/plan/route.ts's isSupportedExecutiveDecisionSystemContext)
                                  and MI has its own separate, already-canonical decision
                                  resolver (resolveMarketIntelligenceExecutiveDecision).
                                  If EDS metadata were ever present on an MI report, this
                                  panel would render a second, uncoordinated "verdict" a
                                  reader could see disagree with the Decision shown two
                                  panels above it -- gated here as defense in depth,
                                  matching the report-isolation policy already enforced
                                  for every other MI-inapplicable construct (founder
                                  score, investment score, etc.). */}
                              {report.type !== "Market Analysis" ? (
                                <ExecutiveDecisionIntelligencePanel metadata={report.metadata} />
                              ) : null}
                              {section.field === "marketSize" && report.type === "Market Analysis" ? (
                                <MarketMetricsDashboard sections={visibleSections} />
                              ) : null}
                              {section.field === "marketDrivers" && report.type === "Market Analysis" ? (
                                <MarketForcesQuadrant sections={visibleSections} />
                              ) : null}
                              {hasReportSectionVisual(section.title) &&
                              !isFinancialDashboard &&
                              !cardFirstReportFields.has(section.field ?? "") ? (
                                <ExecutiveInsightBanner content={section.content} />
                              ) : null}
                              <ReportSectionVisual
                                title={section.title}
                                content={section.content}
                                investmentScore={report.investmentScore}
                                isMarketIntelligence={report.type === "Market Analysis"}
                                majorPlayersContent={
                                  visibleSections.find((entry) => entry.field === "majorPlayers")?.content
                                }
                              />
                              {/* Card-first sections (see cardFirstReportFields) already
                                  surface their COMPLETE content via a dedicated visual
                                  card (ExecutiveSummaryVisual, MarketForcesQuadrant, the
                                  TAM/SAM/SOM bars, Porter's radar, the Recommendation
                                  cards, ...) -- each card's own extraction now captures
                                  the section's full remaining prose/bullets, not just a
                                  teaser, so a generic SectionTakeaway or a raw-text
                                  "Details" disclosure underneath would only repeat what
                                  the card already fully communicates. Neither renders
                                  for these sections; every other section keeps both,
                                  unchanged. */}
                              {detailsContent.trim() && !cardFirstReportFields.has(section.field ?? "") ? (
                                <SectionTakeaway content={detailsContent} />
                              ) : null}
                              {detailsContent.trim() && !cardFirstReportFields.has(section.field ?? "") ? (
                                <AnalysisNotes
                                  compact
                                  label={isFinancialDashboard ? "Metric Details" : presentationLabels.details}
                                >
                                  <ReportText content={detailsContent} />
                                </AnalysisNotes>
                              ) : null}
                              </>}
                        </div>
                      </details>
                    );
                  })}

                  {sourceSections.length > 0 ? (
                    <details
                      id="report-sources"
                      open
                      className="group scroll-mt-8 rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.045] p-5 shadow-xl shadow-black/30 ring-1 ring-teal-200/5 sm:p-6"
                    >
                      <summary className="flex cursor-pointer list-none flex-col gap-4 rounded-[1.35rem] transition duration-300 hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200/30 sm:flex-row sm:items-start [&::-webkit-details-marker]:hidden">
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
                                {reportLocale === "tr" ? "Kaynaklar" : "Sources"}
                              </h2>
                            </div>
                            <span className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-zinc-300 ring-1 ring-white/[0.02] transition duration-300 group-hover:border-teal-200/30 group-hover:text-teal-100">
                              <span className="group-open:hidden">Expand</span>
                              <span className="hidden group-open:inline">Collapse</span>
                            </span>
                          </div>
                        </div>
                      </summary>
                      <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                            <div className="flex justify-end">
                              <CopySectionButton
                                content={sourceSections.map((section) => section.content).join("\n\n")}
                                label="Copy sources"
                              />
                            </div>
                            {sourceSections.map((section) => (
                              <div
                                key={getReportSectionKey(section)}
                                className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0"
                              >
                                <CitationList
                                  content={section.content}
                                  market={report.type === "Market Analysis"}
                                />
                              </div>
                            ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          </div>
        </section>
      </div>
    </main>
  );
}
