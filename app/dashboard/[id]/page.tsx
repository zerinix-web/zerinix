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
} from "@/app/lib/report-presentation";
import type {
  ReportBenchmarkFit,
  ReportBenchmarkScore,
  ReportInvestmentScore,
  ReportQualityScore,
} from "@/app/lib/report-investment-score";
import {
  detectPdfPresentationLocale,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
} from "@/app/lib/pdf-normalization.mjs";
import {
  getEvidenceBadgeClass,
  getEvidenceLabel,
  inferEvidenceLevel,
  type EvidenceLevel,
} from "@/app/lib/report-evidence";

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

function getDashboardEvidenceLabel(level: EvidenceLevel) {
  return getEvidenceLabel(level, "Turkish");
}

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  return (
    <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${getEvidenceBadgeClass(level)}`}>
      {getDashboardEvidenceLabel(level)}
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

function getDashboardSectionEvidence(section: { field?: string; title: string; content: string }): EvidenceLevel {
  const field = section.field?.toLowerCase() || "";
  const title = section.title.toLowerCase();

  if (field.includes("source") || title.includes("source") || title.includes("kaynak")) {
    return "verified";
  }

  if (field.includes("tam") || title.includes("tam / sam / som") || field.includes("financial") || title.includes("financial") || title.includes("finansal")) {
    return getDashboardMetricEvidence(
      section.title,
      extractMetricValue(section.content, "Gross Margin") || extractMetricValue(section.content, "TAM") || section.title,
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

function getExecutiveHighlights(content: string) {
  const candidates = [
    extractKeywordInsight(content, ["decision", "recommendation", "karar", "tavsiye"]),
    extractKeywordInsight(content, ["opportunity", "market", "pazar", "tam", "sam", "som"]),
    extractKeywordInsight(content, ["risk", "threat", "tehdit"]),
    extractKeywordInsight(content, ["next action", "critical action", "action", "validate", "aksiyon", "doğrula"]),
    extractKeywordInsight(content, ["validation", "evidence", "confidence", "doğrulama", "kanıt", "güven"]),
    extractFirstInsight(content),
  ];
  const seen = new Set<string>();

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

      seen.add(fingerprint);
      return true;
    })
    .slice(0, 5);
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
  sections: Array<{ field?: string; title: string; content: string }>
) {
  const fullContent = sections.map((section) => `${section.title}\n${section.content}`).join("\n\n");
  const executiveRecommendation = getSectionContentByFieldOrTitle(sections, [
    "executiverecommendation",
    "executive recommendation",
    "recommendation",
  ]);
  const executiveSummary = getSectionContentByFieldOrTitle(sections, [
    "executivesummary",
    "executive summary",
  ]);
  const marketOpportunity = getSectionContentByFieldOrTitle(sections, [
    "marketopportunity",
    "market opportunity",
    "marketoverview",
    "market overview",
  ]);
  const risks = getSectionContentByFieldOrTitle(sections, ["risk", "threat"]);
  const decisionSignal =
    detectRecommendation(`${executiveRecommendation}\n${executiveSummary}\n${fullContent}`) ||
    extractMetricValue(executiveRecommendation, "Decision") ||
    extractMetricValue(executiveRecommendation, "Recommendation") ||
    "Review required";
  const nextStep =
    extractMetricValue(executiveRecommendation, "Next Critical Action") ||
    extractMetricValue(executiveRecommendation, "Next Action") ||
    extractMetricValue(fullContent, "Next Critical Action") ||
    extractMetricValue(fullContent, "Next Action") ||
    extractKeywordInsight(executiveRecommendation || executiveSummary || fullContent, [
      "next",
      "validate",
      "launch",
      "pilot",
      "action",
    ]);
  const mainInsight =
    extractMetricValue(executiveSummary, "Main Insight") ||
    extractKeywordInsight(executiveSummary || marketOpportunity || fullContent, [
      "market",
      "opportunity",
      "revenue",
      "growth",
      "customer",
    ]);
  const mainRisk =
    extractMetricValue(executiveRecommendation, "Main Risk") ||
    extractMetricValue(risks, "Main Risk") ||
    extractKeywordInsight(risks || fullContent, ["risk", "threat", "regulation", "competition"]);
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
      value: cleanDecisionSummaryText(decisionSignal, "Review required"),
      detail: cleanDecisionSummaryText(
        extractMetricValue(executiveRecommendation, "Decision Rationale") ||
          extractMetricValue(executiveRecommendation, "Recommendation") ||
          extractMetricValue(executiveRecommendation, "Summary") ||
          executiveRecommendation ||
          executiveSummary,
        "Review the decision evidence before moving forward."
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
      value: cleanDecisionSummaryText(decisionConfidence, "Review required"),
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
    "Review required";
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
    quality: cleanDecisionSummaryText(quality, "Review required"),
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
  sections: Array<{ field?: string; title: string; content: string }>
) {
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
  investmentScore,
}: {
  title: string;
  content: string;
  investmentScore?: ReportInvestmentScore;
}) {
  if (!title.toLowerCase().includes("executive summary")) {
    return null;
  }

  const score =
    investmentScore?.totalScore ??
    extractScore(content, "AI Investment Score") ??
    extractConfidence(content);
  const recommendation = investmentScore?.recommendation || detectRecommendation(content) || "REVIEW";
  const highlights = getExecutiveHighlights(content);
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
      label: "Market Signal",
      value: extractMetricValue(content, "Market") || extractMetricValue(content, "TAM") || "Review",
      accent: "from-sky-300/18 to-teal-300/5",
      evidence: "benchmarkDerived" as EvidenceLevel,
    },
    {
      label: "Risk Posture",
      value: extractMetricValue(content, "Risk") || extractMetricValue(content, "Main Risk") || "Tracked",
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
                  <EvidenceBadge level={kpi.evidence} />
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
  investmentScore,
}: {
  title: string;
  content: string;
  investmentScore?: ReportInvestmentScore;
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
	                  <div className="mt-2 flex justify-center">
	                    <EvidenceBadge level={getDashboardMetricEvidence(bar.label, value, content)} />
	                  </div>
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
	          {flow.map((metric) => {
	            const value = formatMetricCardValue(extractMetricValue(content, metric));
	            const evidence = getDashboardMetricEvidence(metric, value, content);

	            return (
	              <div key={metric} className="bg-zinc-950/80 p-4">
	                <div className="flex items-start justify-between gap-2">
	                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
	                  <EvidenceBadge level={evidence} />
	                </div>
	                <p className="mt-3 truncate whitespace-nowrap text-lg font-semibold text-white">
	                  {value || "—"}
	                </p>
	              </div>
	            );
	          })}
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
	            const evidence = getDashboardMetricEvidence(metric.label, value, content);

	            return (
              <div key={metric.label} className="flex min-h-32 min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-black/35 p-3.5 shadow-xl shadow-black/20">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 min-w-0 break-words text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                    {metric.label}
                  </p>
	                  <EvidenceBadge level={evidence} />
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
	        {kpiMetrics.map((metric) => {
	          const value = extractMetricValue(content, metric);
	          const evidence = getDashboardMetricEvidence(metric, value, content);

	          return (
	          <div key={metric} className="grid grid-cols-[4.25rem_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
	            <MiniProgressCircle label="" value={extractPercentScore(content, metric)} />
	            <div className="min-w-0">
	              <div className="flex items-start justify-between gap-2">
	                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">{metric}</p>
	                <EvidenceBadge level={evidence} />
	              </div>
	              <p className="mt-2 line-clamp-2 text-xl font-semibold text-white">
	                {value || "Target"}
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
	          );
	        })}
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
    normalizedTitle.includes("founder readiness") ||
    normalizedTitle.includes("kurucu skoru") ||
    normalizedTitle.includes("kurucu hazırlık") ||
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

function SnapshotGauge({
  label,
  value,
  display,
}: {
  label: string;
  value: number | null;
  display: string;
}) {
  const safeValue = value ?? 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(rgb(94 234 212) ${safeValue * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-zinc-950 text-[11px] font-semibold text-white">
            {value === null ? "--" : value}
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
}: {
  section: { field?: string; title: string; content: string };
  investmentScore?: ReportInvestmentScore;
  reportQuality?: ReportQualityScore;
}) {
  if (!isExecutivePresentationSection(section)) {
    return null;
  }

  const snapshot = buildExecutiveSnapshot(section.content, investmentScore, reportQuality);
  const labels = getReportPresentationLabels(section.content);
  const reportQualityBreakdown = getReportQualityBreakdown(
    reportQuality,
    labels.reportQuality === "Rapor Kalitesi"
  );
  const groups = [
    { label: labels.why, items: snapshot.why },
    { label: labels.mainRisks, items: snapshot.risks },
    { label: labels.nextActions, items: snapshot.actions },
  ];
  const metrics = [
    { label: labels.financialQuality, value: snapshot.financialQuality },
    { label: labels.reportQuality, value: snapshot.reportQuality },
    { label: labels.mainRisk, value: snapshot.mainRisk },
    { label: labels.nextAction, value: snapshot.nextAction },
  ];

  return (
    <div className="mb-5 rounded-[1.75rem] border border-teal-200/15 bg-[linear-gradient(135deg,rgba(94,234,212,0.09),rgba(255,255,255,0.025))] p-4 shadow-inner shadow-teal-950/10">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-teal-200/75">
            {labels.executiveSnapshot}
          </p>
          <h4 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {labels.decision}: {snapshot.decision}
          </h4>
        </div>
        <span className="w-fit rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-semibold text-zinc-200">
          {labels.confidence}: {snapshot.confidence}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <SnapshotGauge
          label={labels.confidenceGauge}
          value={snapshot.confidenceScore}
          display={snapshot.confidence}
        />
        <SnapshotGauge
          label={labels.founderScoreGauge}
          value={snapshot.founderScoreValue}
          display={snapshot.founderScore}
        />
        <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {labels.riskLevel}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${getRiskIndicatorClass(snapshot.riskLevel)}`}>
              {snapshot.riskLevel}
            </span>
            <p className="line-clamp-2 text-sm leading-5 text-zinc-300">{snapshot.mainRisk}</p>
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
            {snapshot.confidenceRadar.map((dimension) => (
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

function parseCitations(content: string): CitationData[] {
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

function CitationCard({ citation }: { citation: CitationData }) {
  const domain = getCitationDomain(citation.url, citation.organization);

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
            <span className="text-zinc-500">Confidence</span>
            <span className="ml-2 text-zinc-200">{citation.confidence}</span>
          </p>
        ) : null}
        {citation.sourceType ? (
          <p>
            <span className="text-zinc-500">Type</span>
            <span className="ml-2 text-zinc-200">{citation.sourceType}</span>
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
          Not verified
        </p>
      )}
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
          key={`${getCitationDomain(citation.url, citation.organization)}-${citation.sourceTitle}-${citation.publicationYear || ""}-${citation.url || ""}-${index}`}
          citation={citation}
        />
      ))}
    </div>
  );
}

function ReportText({ content }: { content: string }) {
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

  const { data: workspace } = report.workspaceId
    ? await supabase
        .from("report_workspaces")
        .select("id,name")
        .eq("user_id", user.id)
        .eq("id", report.workspaceId)
        .maybeSingle()
    : { data: null };

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
  const decisionSummaryItems = getDecisionSummaryItems(visibleSections);
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
  const validationIntelligenceOverview = getValidationIntelligenceOverview(visibleSections);
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
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <ReportScrollProgress />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-4 pt-5 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:px-8 lg:px-10 lg:py-8">
          <div className="space-y-4 lg:hidden">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 ring-1 ring-white/[0.025] backdrop-blur-2xl">
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
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white">
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

            <section className="overflow-hidden rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.055] shadow-2xl shadow-black/30 ring-1 ring-teal-200/10 backdrop-blur-xl">
              <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.02))] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-100/75">
                  Decision Snapshot
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                  {decisionSignalItem?.value || "Review required"}
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
                className="overflow-x-auto rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-2 shadow-xl shadow-black/20 ring-1 ring-white/[0.025]"
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

            <section className="space-y-3">
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
                        <div className="space-y-4">
                          <ReportSectionVisual
                            title={section.title}
                            content={section.content}
                            investmentScore={report.investmentScore}
                          />
                          {detailsContent.trim() ? (
                            <div className="rounded-[1.25rem] border border-white/10 bg-black/25 p-4">
                              <ReportText content={detailsContent} />
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
                    <div className="space-y-4">
                      {sourceSections.map((section) => (
                        <CitationList
                          key={`mobile-source-${getReportSectionKey(section)}`}
                          content={section.content}
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
	                <EvidenceBadge level="planningAssumption" />
	              </div>
	              <p className="mt-3 text-lg font-semibold text-white">{report.type}</p>
            </div>
            <div className="min-h-[8.5rem] rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/20 ring-1 ring-white/[0.02] transition duration-300 hover:-translate-y-0.5 hover:border-teal-200/20 hover:bg-white/[0.045]">
	              <div className="flex items-center gap-3">
	                <CalendarDays className="h-5 w-5 text-teal-200" />
	                <p className="text-sm text-zinc-500">Created</p>
	              </div>
	              <div className="mt-3">
	                <EvidenceBadge level="verified" />
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
	                <EvidenceBadge level="verified" />
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
	                <EvidenceBadge level="verified" />
	              </div>
	              <p className="mt-3 line-clamp-2 text-lg font-semibold text-white">
                {workspaceName}
              </p>
            </Link>
          </div>

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
	                          <EvidenceBadge level={item.evidence} />
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
                  <BenchmarkIntelligencePanel
                    benchmarkFit={report.metadata?.benchmarkFit}
                    benchmarkScore={report.metadata?.benchmarkScore}
                    sourceText={`${report.title}\n${report.prompt}\n${uniqueReportSections
                      .map((section) => `${section.title}\n${section.content}`)
                      .join("\n\n")}`}
                  />

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
	                                  Section {String(index + 1).padStart(2, "0")}
	                                </span>
	                                <div className="mt-2">
	                                  <EvidenceBadge level={getDashboardSectionEvidence(section)} />
	                                </div>
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
                              <ExecutiveSummaryVisual
                                title={section.title}
                                content={section.content}
                                investmentScore={report.investmentScore}
                              />
                              <ExecutiveSnapshotPanel
                                section={section}
                                investmentScore={report.investmentScore}
                                reportQuality={report.metadata?.reportQuality}
                              />
                              {hasReportSectionVisual(section.title) &&
                              !section.title.toLowerCase().includes("executive summary") &&
                              !isFinancialDashboard ? (
                                <ExecutiveInsightBanner content={section.content} />
                              ) : null}
                              <ReportSectionVisual
                                title={section.title}
                                content={section.content}
                                investmentScore={report.investmentScore}
                              />
                              {detailsContent.trim() ? (
                                <>
                                  <SectionTakeaway content={detailsContent} />
                                  <AnalysisNotes
                                    compact
                                    label={isFinancialDashboard ? "Metric Details" : presentationLabels.details}
                                  >
                                    <ReportText content={detailsContent} />
                                  </AnalysisNotes>
                                </>
                              ) : null}
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
                                Sources
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
                                <CitationList content={section.content} />
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
