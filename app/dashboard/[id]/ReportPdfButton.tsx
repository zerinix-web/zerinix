"use client";

import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { Download } from "lucide-react";
import type { DashboardReport } from "../report-utils";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";

let pdfFontPromise: Promise<string> | null = null;

function isFailedReport(report: DashboardReport) {
  return (
    report.status.toLowerCase() !== "completed" ||
    report.sections.length === 0 ||
    report.sections.some((section) => isReportGenerationFailureText(section.content))
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function loadPdfFont() {
  pdfFontPromise ??= fetch("/fonts/Geist-Regular.ttf")
    .then((response) => {
      if (!response.ok) {
        throw new Error("PDF font could not be loaded.");
      }

      return response.arrayBuffer();
    })
    .then(arrayBufferToBase64);

  return pdfFontPromise;
}

function normalizePdfText(value: string) {
  return preservePdfInlineTokens(value
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\bEScooter\b/g, "E-Scooter")
    .replace(/([.!?])\s+\1/g, "$1")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function preservePdfInlineTokens(value: string) {
  return value
    .replace(/([€$₺])\s+(?=\d)/g, "$1")
    .replace(/([<>])\s+([€$₺]?\d)/g, "$1$2")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*months?\b/gi, "$1–$2\u00a0months")
    .replace(/\b(\d{1,2})(\d{2})\s*months?\b/gi, "$1–$2\u00a0months")
    .replace(/\b100\s*[-–]\s*3\s*[-–]\s*00\s+scooters?\b/gi, "100–300\u00a0scooters")
    .replace(/\b100\s*[-–]\s*3\s*[-–]\s*00\b/g, "100–300")
    .replace(/\b1\s*[-–]\s*80\s+days?\b/gi, "180\u00a0days")
    .replace(/\b1\s*[-–]\s*80\b/g, "180")
    .replace(/\b1224\b/g, "12–24")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*days?\b/gi, "$1–$2\u00a0days")
    .replace(/\b(\d{1,2})(\d{2})\s*days?\b/gi, "$1–$2\u00a0days")
    .replace(/\b(\d{1,2})(\d{2})\s+(days?|months?|scooters?|rides\/day|rides)\b/gi, "$1–$2\u00a0$3")
    .replace(/\b(\d{3})(\d{3})\s+(scooters?|rides\/day|rides)\b/gi, "$1–$2\u00a0$3")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:rides\/day|rides)\b/gi, "$1–$2\u00a0rides/day")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*scooters?\b/gi, "$1–$2\u00a0scooters")
    .replace(/\b(\d{1,2})(\d{2})\s*%\b/g, "$1–$2%")
    .replace(/\b(\d{1,2})(\d{2})-month\b/gi, "$1–$2-month")
    .replace(/\b(\d+(?:[.,]\d+)*)\s*-\s*month\b/gi, "$1-month")
    .replace(/\b(\d{2})2month\b/gi, "$1\u00a0month")
    .replace(/\b(\d+(?:[.,]\d+)*)month\b/gi, "$1-month")
    .replace(/\b(\d+(?:[.,]\d+)*)months\b/gi, "$1\u00a0months")
    .replace(/\b(\d+(?:[.,]\d+)*)\s+month\b/gi, "$1\u00a0month")
    .replace(/\b(\d+(?:[.,]\d+)*)\s+months\b/gi, "$1\u00a0months")
    .replace(/\b(\d+)(?=(?:municipal|public|private|corporate|enterprise|customer|customers|user|users|month|months|day|days|scooter|scooters)\b)/gi, "$1 ")
    .replace(/\b(minimum)(?=revenue\b)/gi, "$1 ")
    .replace(/\b(public)(?=sector\b)/gi, "$1 ")
    .replace(/\b(private)(?=sector\b)/gi, "$1 ")
    .replace(/\b(last)(?=mile\b)/gi, "$1-")
    .replace(/\b(third)(?=party\b)/gi, "$1-")
    .replace(/\b(one)(?=pager\b)/gi, "$1-")
    .replace(/\b(post)(?=\d{4}\b)/gi, "$1-")
    .replace(/(\d)\s+([kKmMbB%])/g, "$1$2")
    .replace(/(\d(?:[.,]\d+)*)\s*([kKmMbB])\b/g, "$1$2")
    .replace(/(\d(?:[.,]\d+)*)\s*%/g, "$1%")
    .replace(/([kKmMbB%])\s+([€$₺])/g, "$1$2")
    .replace(/([€$₺])(\d(?:[.,]\d+)*)\s*([kKmMbB])\b/g, "$1$2$3")
    .replace(/(\d(?:[.,]\d+)*)\s+(months?|ay|gün|days?|weeks?|hafta|years?|yıl|scooters?)\b/gi, "$1\u00a0$2")
    .replace(/\bYear\s+(\d+)\b/gi, "Year\u00a0$1")
    .replace(/\bYear(\d+)\b/gi, "Year\u00a0$1")
    .replace(/\bMonth\s+(\d+)\b/gi, "Month\u00a0$1")
    .replace(/\bMonth(\d+)\b/gi, "Month\u00a0$1")
    .replace(/\(e\.\s*,/gi, "(e.g.,")
    .replace(/\be\.\s*,/gi, "e.g.,")
    .replace(/\bi\.\s*,/gi, "i.e.,")
    .replace(/\be\.\s*g\./gi, "e.g.")
    .replace(/\bi\.\s*e\./gi, "i.e.")
    .replace(/\bv\.\s*s\./gi, "vs.")
    .replace(/\bN\.\s*o\./g, "No.")
    .replace(/\bM\.\s*r\./g, "Mr.")
    .replace(/\bD\.\s*r\./g, "Dr.")
    .replace(/\betc\./gi, "etc.")
    .replace(/\b(e\.g\.|i\.e\.|vs\.|etc\.|No\.|Mr\.|Dr\.)\s+(?=\S)/g, "$1\u00a0")
    .replace(/\bU\.\s*S\./gi, "U.S.")
    .replace(/\bE\.\s*U\./gi, "E.U.")
    .replace(/\bB\s*2\s*B\b/gi, "B2B")
    .replace(/\bB\s*2\s*G\b/gi, "B2G")
    .replace(/\bA\s*R\s*P\s*A\b/gi, "ARPA")
    .replace(/\bC\s*A\s*C\b/gi, "CAC")
    .replace(/\bL\s*T\s*V\b/gi, "LTV")
    .replace(/\bE\s*B\s*I\s*T\s*D\s*A\b/gi, "EBITDA")
    .replace(/(\d)\.\s*(\d)/g, "$1.$2")
    .replace(/(\d),\s*(\d{3})/g, "$1,$2");
}

function normalizeCitationKey(value: string) {
  return normalizePdfText(value)
    .toLowerCase()
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/[^a-z0-9ığüşöçİĞÜŞÖÇ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";

  return undefined;
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

  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const normalizedUrl = citation.url?.trim().toLowerCase().replace(/\/+$/, "");
    const key = normalizedUrl
      ? `url:${normalizedUrl}`
      : [
          "source",
          normalizeCitationKey(citation.organization),
          normalizeCitationKey(citation.sourceTitle),
          citation.publicationYear || "",
        ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...citation,
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
    });
  });

  return Array.from(unique.values());
}

function isSourceSectionTitle(title: string) {
  return /^(sources|references|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
    title.trim()
  );
}

function formatPdfCitationContent(content: string) {
  const citations = parseCitations(content);

  if (citations.length === 0) {
    return normalizePdfText(content);
  }

  return citations
    .slice(0, 8)
    .map((citation) => {
      const year = citation.publicationYear ? `\n  Year: ${citation.publicationYear}` : "";
      const confidence = citation.confidence ? `\n  Confidence: ${citation.confidence}` : "";
      const url = citation.url ? `\n  URL: ${citation.url}` : "";

      return [
        `• ${citation.sourceTitle}`,
        `  Publisher: ${citation.organization}`,
        year,
        confidence,
        url,
      ].join("\n");
    })
    .join("\n");
}

const founderRoadmapSteps = [
  "Tomorrow",
  "This Week",
  "30 Days",
  "90 Days",
  "180 Days",
  "12 Months",
];

const founderScoreMetrics = [
  "Overall Score",
  "Innovation",
  "Execution",
  "Competition",
  "Capital",
  "Revenue",
  "Risk",
];

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

function compactPdfMetricValue(value: string) {
  const cleanValue = formatMetricCardValue(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([kKmMbB%$])/g, "$1")
    .replace(/([kKmMbB%])\s+\$/g, "$1$")
    .trim();
  const numericMatch = cleanValue.match(
    /(?:[$€₺]\s*)?\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)?\s*(?:[$€₺])?/i
  );

  return numericMatch?.[0]?.replace(/\s+/g, " ").replace(/([kKmMbB%])\s+([$€₺])/g, "$1$2") || cleanValue.split(/\s{2,}/)[0] || "";
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

function extractMetricDetail(content: string, aliases: string[] | readonly string[]) {
  const lines = normalizePdfText(content).split("\n");
  const line = lines.find((candidate) =>
    aliases.some((alias) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(
        candidate.trim()
      )
    )
  );

  if (!line) {
    return "";
  }

  return line
    .replace(/^[-*•]\s*/, "")
    .replace(/\*\*/g, "")
    .split(/\s*\|\s*/)
    .slice(1)
    .join(" | ")
    .replace(/\bbenchmarkSource\b/gi, "source")
    .trim();
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
  const explicit = content.match(
    /\b(?:recommendation|decision|karar)\s*[:\-–—]\s*([A-Z][A-Z ]{1,34})\b/i
  );
  const explicitDecision = explicit?.[1]?.trim().replace(/\s+/g, " ").toUpperCase();

  if (explicitDecision && !["CONFIDENCE", "INVESTMENT", "MAIN RISK"].includes(explicitDecision)) {
    return explicitDecision;
  }

  const match = content.match(/\b(HOLD FOR VALIDATION|INVEST|REJECT|GO|PASS|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b/i);
  const recommendation = match?.[1]?.toUpperCase() || "";

  if (recommendation === "NO GO" || recommendation === "REJECT") {
    return "PASS";
  }

  return recommendation;
}

function formatDecisionLabel(decision: string) {
  const normalized = decision.trim().replace(/\s+/g, " ").toUpperCase();

  if (normalized === "HOLD FOR VALIDATION") {
    return "Hold for validation";
  }

  if (normalized === "PASS") {
    return "Reject";
  }

  if (normalized === "GO") {
    return "Invest";
  }

  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function extractFirstMetric(content: string, labels: string[]) {
  for (const label of labels) {
    const value = extractMetricValue(content, label);

    if (value) {
      return value;
    }
  }

  return "";
}

function extractDashboardList(content: string, labels: string[], limit: number) {
  const lines = normalizePdfText(content)
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, "").replace(/\*\*/g, ""))
    .filter(Boolean);
  const labelIndex = lines.findIndex((line) =>
    labels.some((label) => line.toLowerCase().startsWith(label.toLowerCase()))
  );

  if (labelIndex === -1) {
    return [];
  }

  return lines
    .slice(labelIndex + 1)
    .filter((line) => !/^(weaknesses|top risks|risks|next critical action|category scores|decision engine|financial modeling rules)\b/i.test(line))
    .slice(0, limit);
}

function extractSectionSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?${escapedTitle}(?:\\*\\*)?\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?(?:\\*\\*)?(?:Strengths|Weaknesses|Opportunities|Threats|Worst|Base|Best|Revenue|MRR|Monthly Revenue|Burn|Runway|Risk|Decision)(?:\\*\\*)?\\s*[:\\-–—]|$)`,
      "i"
    )
  );

  return match?.[1]?.trim() || "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const swotLabelAliases: Record<string, string[]> = {
  Strengths: ["Strengths", "Güçlü Yönler", "Güçlü Yanlar", "Avantajlar"],
  Weaknesses: ["Weaknesses", "Zayıf Yönler", "Zayıflıklar", "Eksikler"],
  Opportunities: ["Opportunities", "Fırsatlar"],
  Threats: ["Threats", "Tehditler"],
};

const scenarioLabelAliases: Record<string, string[]> = {
  Worst: ["Worst", "Worst Case", "Kötü", "Kötü Senaryo"],
  Base: ["Base", "Base Case", "Baz", "Baz Senaryo"],
  Best: ["Best", "Best Case", "İyi", "Iyi", "İyi Senaryo", "Iyi Senaryo"],
};

function extractAliasedSectionSnippet(
  content: string,
  labels: string[],
  stopLabels: string[] = labels
) {
  const normalizedContent = normalizePdfText(content);
  const labelPattern = labels.map(escapeRegExp).join("|");
  const stopPattern = stopLabels
    .filter((label) => !labels.includes(label))
    .map(escapeRegExp)
    .join("|");

  if (labelPattern) {
    const lineMatch = normalizedContent.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=${stopPattern ? `\\n\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${stopPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]` : "$"}|$)`,
        "i"
      )
    );

    if (lineMatch?.[1]?.trim()) {
      return lineMatch[1].trim();
    }

    if (stopPattern) {
      const inlineMatch = normalizedContent.match(
        new RegExp(
          `(?:${labelPattern})\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${stopPattern})\\s*(?:case|senaryo)?\\s*[:\\-–—]|$)`,
          "i"
        )
      );

      if (inlineMatch?.[1]?.trim()) {
        return inlineMatch[1].trim();
      }
    }
  }

  if (stopLabels !== labels) {
    return "";
  }

  for (const label of labels) {
    const snippet = extractSectionSnippet(content, label);

    if (snippet) {
      return snippet;
    }
  }

  return "";
}

function isOrphanBulletText(value: string) {
  return /^(swot analysis|strengths|weaknesses|opportunities|threats|güçlü yönler|güçlü yanlar|zayıf yönler|zayıflıklar|fırsatlar|tehditler)$/i.test(
    value.trim()
  ) || /^[a-zçğıöşü]\.$/i.test(value.trim()) || /^\d+[.)]?$/.test(value.trim()) || /^[€$₺.,()]$/.test(value.trim()) || /^\d+(?:[.,]\d+)?\s*(?:[kKmMbB%]|months?|ay|gün|days?)$/i.test(value.trim());
}

function containsOtherSwotLabel(value: string, currentLabel: string) {
  return Object.entries(swotLabelAliases).some(([label, aliases]) => {
    if (label === currentLabel) {
      return false;
    }

    return aliases.some((alias) =>
      new RegExp(`(?:^|\\b)${escapeRegExp(alias)}\\s*[:\\-–—]`, "i").test(value)
    );
  });
}

function cleanPdfContinuationFragment(value: string) {
  return preservePdfInlineTokens(value.trim().replace(/^[-*•]\s*/, ""));
}

function shouldJoinPdfLineFragment(previousLine: string, currentLine: string) {
  const previous = previousLine.trim();
  const current = cleanPdfContinuationFragment(currentLine);

  if (!previous || !current) {
    return false;
  }

  return (
    /(?:[€$₺]?\d+(?:[.,]\d+)*[.,]|[€$₺]?\d+)$/.test(previous) &&
      /^(?:\d+(?:[.,]\d+)?(?:[kKmMbB%])?|[kKmMbB%]|months?|days?|ay|gün|scooters?)\b/i.test(current)
  ) || (
    /\b(?:e|i|v|N|M|D)\.$/.test(previous) && /^(?:g|e|s|o|r)\.$/i.test(current)
  ) || (
    /(?:\(|\b)(?:e|i)\.$/i.test(previous) && /^,\s*\S/.test(current)
  ) || (
    /\b(?:e\.g\.|i\.e\.|vs\.|etc\.|No\.|Mr\.|Dr\.)$/i.test(previous) && /^[.,)]$/.test(current)
  ) || (
    /[€$₺(]$/.test(previous) && /^\d/.test(current)
  ) || (
    /[a-zçğıöşü]$/i.test(previous) && /^(?:municipal|permit|sector|revenue|market|customer|customers|user|users|month|months|scooters?|pilot|validation)\b/i.test(current)
  ) || /^[.,)]$/.test(current);
}

function joinPdfLineFragment(previousLine: string, currentLine: string) {
  const current = cleanPdfContinuationFragment(currentLine);

  if (/(?:\(|\b)e\.$/i.test(previousLine.trim()) && /^,\s*\S/.test(current)) {
    return preservePdfInlineTokens(`${previousLine.trimEnd()}g.${current}`);
  }

  if (/(?:\(|\b)i\.$/i.test(previousLine.trim()) && /^,\s*\S/.test(current)) {
    return preservePdfInlineTokens(`${previousLine.trimEnd()}e.${current}`);
  }

  const separator =
    /(?:[€$₺]?\d+(?:[.,]\d+)*[.,]|[€$₺(]|\b(?:e|i|v|N|M|D)\.)$/i.test(previousLine.trim()) ||
    /^[.,)]/.test(current)
      ? ""
      : " ";

  return preservePdfInlineTokens(`${previousLine.trimEnd()}${separator}${current}`);
}

function repairPdfLineFragments(lines: string[]) {
  return lines.reduce<string[]>((repaired, line) => {
    const withoutBullet = cleanPdfContinuationFragment(line);

    if (repaired.length > 0 && shouldJoinPdfLineFragment(repaired[repaired.length - 1], line)) {
      repaired[repaired.length - 1] = joinPdfLineFragment(repaired[repaired.length - 1], line);
      return repaired;
    }

    if (isOrphanBulletText(withoutBullet)) {
      return repaired;
    }

    if (repaired[repaired.length - 1]?.trim() === line.trim()) {
      return repaired;
    }

    repaired.push(line);
    return repaired;
  }, []);
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
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line) && !isOrphanBulletText(line))
    .slice(0, 2);

  if (bullets.length > 0) {
    return bullets;
  }

  return source
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line && !new RegExp(`^${fallback}$`, "i").test(line) && !isOrphanBulletText(line))
    .slice(0, 2);
}

function extractSwotBullets(content: string, label: string, fallbackContent = content) {
  const aliases = swotLabelAliases[label] || [label];
  const allSwotAliases = Object.values(swotLabelAliases).flat();
  const snippet = extractAliasedSectionSnippet(content, aliases, allSwotAliases);
  const direct = extractBullets(snippet, label).filter(
    (bullet) => !containsOtherSwotLabel(bullet, label)
  );

  if (direct.length > 0) {
    return direct;
  }

  for (const alias of aliases) {
    const labelPattern = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*[:\\-–—]\\s*([^\\n]+)`,
      "i"
    );
    const inline = content.match(labelPattern)?.[1]?.trim() || "";

    if (inline && !new RegExp(`^${alias}$`, "i").test(inline)) {
      return extractBullets(inline, label).filter(
        (bullet) => !containsOtherSwotLabel(bullet, label)
      );
    }
  }

  const fallbackSnippet =
    extractAliasedSectionSnippet(fallbackContent, aliases, allSwotAliases) ||
    extractKeywordInsight(
      fallbackContent,
      label === "Strengths"
        ? ["strength", "advantage", "moat", "positive", "güçlü", "avantaj"]
        : label === "Weaknesses"
          ? ["weakness", "constraint", "cost", "capital", "margin pressure", "zayıf", "maliyet"]
          : label === "Opportunities"
            ? ["opportunity", "underserved", "growth", "demand", "gap", "fırsat"]
            : ["threat", "risk", "regulation", "competition", "substitute", "tehdit"]
    );

  return extractBullets(fallbackSnippet, label)
    .filter((bullet) => !containsOtherSwotLabel(bullet, label))
    .slice(0, 2);
}

function extractScenarioSnippet(content: string, scenario: string) {
  const aliases = scenarioLabelAliases[scenario] || [scenario];
  const allAliases = Object.values(scenarioLabelAliases).flat();
  const sectionSnippet = extractAliasedSectionSnippet(content, aliases, allAliases);

  if (sectionSnippet) {
    return sectionSnippet;
  }

  for (const alias of aliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stopLabels = allAliases
      .filter((candidate) => candidate !== alias)
      .map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    const inlineMatch = normalizePdfText(content).match(
      new RegExp(
        `${escapedAlias}\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${stopLabels})\\s*(?:case|senaryo)?\\s*[:\\-–—]|$)`,
        "i"
      )
    );

    if (inlineMatch?.[1]?.trim()) {
      return inlineMatch[1].trim();
    }
  }

  return "";
}

function extractShortDescription(content: string, aliases: string[] | readonly string[]) {
  const detail = extractMetricDetail(content, aliases)
    .replace(/\b(?:formula|assumptions?|benchmark|source|confidence)\s*[:=]\s*/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  if (detail) {
    return detail;
  }

  const raw = normalizePdfText(extractMetricValueFromAliases(content, aliases));

  return raw
    .split(/\b(?:formula|assumptions?|confidence|benchmark(?: source| comparison)?|explanation|justification|source)\b\s*[:\-–—]/i)
    .slice(1)
    .join(" ")
    .replace(/\s*\|\s*/g, " ")
    .trim();
}

function extractKpiValue(content: string, label: string) {
  return (
    compactPdfMetricValue(extractMetricValue(content, label)) ||
    compactPdfMetricValue(extractKeywordInsight(content, [label])) ||
    ""
  );
}

function extractKpiTarget(content: string, label: string) {
  const snippet = extractSectionSnippet(content, label) || extractKeywordInsight(content, [label]);
  const target = snippet.match(/\btarget\s*[:\-–—]\s*([^.;\n|]+)/i)?.[1]?.trim();

  return target ? compactPdfMetricValue(target) || target : "";
}

function extractKpiStatus(content: string, label: string) {
  const snippet = extractSectionSnippet(content, label) || extractKeywordInsight(content, [label]);
  const status = snippet.match(/\bstatus\s*[:\-–—]\s*([^.;\n|]+)/i)?.[1]?.trim();

  if (status) {
    return status;
  }

  return (extractScore(content, label) ?? 0) >= 70 ? "On track" : "Watch";
}

function extractKeywordInsight(content: string, keywords: string[]) {
  const lines = normalizePdfText(content)
    .replace(/^#{1,6}\s+/gm, "")
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter((line) => line.length > 12);

  return (
    lines.find((line) =>
      keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
    ) ||
    lines[0] ||
    ""
  );
}

function removeDuplicateVisualText(title: string, content: string) {
  const normalizedTitle = title.toLowerCase();

  if (normalizedTitle.includes("tam / sam / som")) {
    return "";
  }

  if (normalizedTitle.includes("financial dashboard")) {
    return "";
  }

  if (normalizedTitle.includes("swot")) {
    return "";
  }

  return normalizePdfText(content);
}

function dedupePdfSections<T extends { title: string; content: string }>(sections: T[]) {
  const seen = new Set<string>();

  return sections.filter((section) => {
    const key = section.title.trim().toLowerCase().replace(/\s+/g, " ");

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergePdfSourceSections<T extends { title: string; content: string }>(sections: T[]) {
  const sourceSections = sections.filter((section) => isSourceSectionTitle(section.title));
  const nonSourceSections = sections.filter(
    (section) => !sourceSections.includes(section)
  );
  const mergedSourceContent = sourceSections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");

  if (!mergedSourceContent) {
    return nonSourceSections;
  }

  return [
    ...nonSourceSections,
    {
      ...sourceSections[0],
      title: "Sources",
      content: mergedSourceContent,
    },
  ];
}

function createFileName(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${slug || "zerinix-report"}.pdf`;
}

export default function ReportPdfButton({ report }: { report: DashboardReport }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const failedReport = isFailedReport(report);

  const [fontBase64, setFontBase64] = useState("");

  useEffect(() => {
    let mounted = true;

    loadPdfFont()
      .then((loadedFont) => {
        if (mounted) {
          setFontBase64(loadedFont);
        }
      })
      .catch((fontError) => {
        console.error(fontError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function downloadPdf() {
    if (failedReport) {
      setError("Report generation failed. PDF export is available only after a report completes successfully.");
      return;
    }

    if (exporting) {
      return;
    }

    if (!fontBase64) {
      setError("PDF font is still loading. Please try again in a few seconds.");
      return;
    }

    setExporting(true);
    setError("");

    try {
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      const bodyX = margin + 20;
      const bodyWidth = contentWidth - 28;
      const bodyLineHeight = 5.25;
      const cardHeaderHeight = 24;
      const cardBottomPadding = 9;
      const businessIdea = normalizePdfText(report.prompt || report.title);
      const fullReportContent = report.sections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      const tocEntries: Array<{ title: string; page: number }> = [];
      let y = margin;

      pdf.addFileToVFS("Geist-Regular.ttf", fontBase64);
      pdf.addFont("Geist-Regular.ttf", "Geist", "normal");
      pdf.setFont("Geist", "normal");
      pdf.setCharSpace(0);

      const paintPage = () => {
        pdf.setFillColor("#000000");
        pdf.rect(0, 0, pageWidth, pageHeight, "F");
        pdf.setDrawColor("#0f766e");
        pdf.setLineWidth(0.15);

        for (let gridX = 0; gridX <= pageWidth; gridX += 18) {
          pdf.line(gridX, 0, gridX, pageHeight);
        }

        for (let gridY = 0; gridY <= pageHeight; gridY += 18) {
          pdf.line(0, gridY, pageWidth, gridY);
        }
      };

      const ensureSpace = (height: number) => {
        if (y + height <= pageHeight - margin) {
          return;
        }

        drawFooter();
        pdf.addPage();
        paintPage();
        y = margin;
      };

      const drawFooter = () => {
        const currentPage = pdf.getCurrentPageInfo().pageNumber;

        pdf.setFillColor("#000000");
        pdf.rect(margin, pageHeight - 11, contentWidth, 8, "F");
        pdf.setDrawColor("#27272a");
        pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);
        pdf.setFontSize(7);
        pdf.setTextColor("#71717a");
        pdf.text("ZERINIX CONFIDENTIAL INVESTOR REPORT", margin, pageHeight - 5);
        pdf.text(
          `Page ${currentPage} / ${pdf.getNumberOfPages()}`,
          pageWidth - margin - 28,
          pageHeight - 5
        );
      };

      const drawLogoMark = (x: number, logoY: number, size = 13) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#14b8a6");
        pdf.roundedRect(x, logoY, size, size, 3, 3, "FD");
        pdf.setFontSize(size * 0.52);
        pdf.setTextColor("#ccfbf1");
        pdf.text("Z", x + size * 0.34, logoY + size * 0.68);
      };

      const drawTag = (label: string, x: number, tagY: number, width: number) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(x, tagY, width, 10, 5, 5, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor("#ccfbf1");
        pdf.text(label, x + 4, tagY + 6.4, { maxWidth: width - 8 });
      };

      const splitPdfReadableLines = (content: string, width: number) =>
        repairPdfLineFragments(
          content.split("\n").flatMap((rawLine) => {
            const line = normalizePdfText(rawLine);

            if (!line) {
              return [""];
            }

            const withoutBullet = line.replace(/^[-*•]\s+/, "").trim();

            if (isOrphanBulletText(withoutBullet)) {
              return [];
            }

            const isBullet = /^[-*•]\s+/.test(line);
            const availableWidth = isBullet ? width - 4 : width;
            const wrapped = pdf.splitTextToSize(line, availableWidth) as string[];

            return wrapped.map((wrappedLine, index) =>
              isBullet && index > 0 ? `  ${wrappedLine}` : wrappedLine
            );
          })
        );

      const drawCoverPage = () => {
        const investmentScore =
          extractScore(fullReportContent, "Total Investment Score") ??
          extractScore(fullReportContent, "Investment Score") ??
          extractScore(fullReportContent, "AI Investment Score") ??
          extractScore(fullReportContent, "Overall Score");
        const confidence = extractConfidence(fullReportContent);
        const recommendation = detectRecommendation(fullReportContent) || "WAIT";
        const valuation = extractFirstMetric(fullReportContent, [
          "Estimated Valuation",
          "Valuation",
          "Enterprise Value",
        ]);
        const fundingStage = extractFirstMetric(fullReportContent, [
          "Funding Stage",
          "Stage",
        ]);
        const nextAction =
          extractFirstMetric(fullReportContent, ["Next Critical Action", "Next Action"]) ||
          "Use the detailed recommendation section.";
        const strengths = extractDashboardList(
          fullReportContent,
          ["Top 3 Strengths", "Strengths"],
          3
        );
        const risks = extractDashboardList(
          fullReportContent,
          ["Top 3 Risks", "Top Risks", "Risks"],
          3
        );
        const recommendationFill =
          recommendation === "GO"
            ? "#064e3b"
            : recommendation === "PASS"
              ? "#7f1d1d"
              : "#713f12";
        const recommendationText =
          recommendation === "GO"
            ? "#bbf7d0"
            : recommendation === "PASS"
              ? "#fecaca"
              : "#fde68a";

        paintPage();
        pdf.setFillColor("#020617");
        pdf.setDrawColor("#134e4a");
        pdf.roundedRect(margin, 18, contentWidth, pageHeight - 36, 8, 8, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin, 18, 2, pageHeight - 36, "F");

        drawLogoMark(margin + 12, 28, 14);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX INVESTOR INTELLIGENCE", margin + 31, 37);

        pdf.setFontSize(24);
        pdf.setTextColor("#ffffff");
        const coverTitle = pdf.splitTextToSize(normalizePdfText(report.title), contentWidth - 24);
        pdf.text(coverTitle, margin + 12, 51, {
          lineHeightFactor: 1.08,
          maxWidth: contentWidth - 24,
        });

        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text(businessIdea, margin + 12, 78, {
          maxWidth: contentWidth - 24,
        });

        drawTag("Investor Ready", margin + 12, 90, 36);
        drawTag(report.type, margin + 52, 90, 42);

        const scoreX = margin + 12;
        const scoreY = 112;
        const scoreSize = 58;
        pdf.setFillColor("#030712");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(scoreX, scoreY, scoreSize, scoreSize, 7, 7, "FD");
        pdf.setDrawColor("#134e4a");
        pdf.circle(scoreX + 29, scoreY + 28, 20, "S");
        pdf.setDrawColor("#5eead4");
        pdf.setLineWidth(1.1);
        pdf.circle(scoreX + 29, scoreY + 28, 14, "S");
        pdf.setLineWidth(0.15);
        pdf.setFontSize(24);
        pdf.setTextColor("#ffffff");
        pdf.text(String(investmentScore ?? "--"), scoreX + 20, scoreY + 31);
        pdf.setFontSize(6.5);
        pdf.setTextColor("#99f6e4");
        pdf.text("INVESTMENT SCORE", scoreX + 12, scoreY + 43);

        pdf.setFillColor(recommendationFill);
        pdf.setDrawColor("#334155");
        pdf.roundedRect(scoreX + 66, scoreY, contentWidth - 102, 26, 5, 5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor(recommendationText);
        pdf.text("RECOMMENDATION", scoreX + 72, scoreY + 8);
        pdf.setFontSize(18);
        pdf.text(recommendation, scoreX + 72, scoreY + 20);

        const kpis = [
          ["Confidence", confidence === null ? "—" : `${confidence}%`],
          ["Estimated Valuation", valuation || "From report model"],
          ["Funding Stage", fundingStage || report.type],
          ["Status", report.status],
        ];

        kpis.forEach(([label, value], index) => {
          const cardWidth = (contentWidth - 86) / 2;
          const cardX = scoreX + 66 + (index % 2) * (cardWidth + 4);
          const cardY = scoreY + 32 + Math.floor(index / 2) * 20;
          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(cardX, cardY, cardWidth, 16, 3, 3, "FD");
          pdf.setFontSize(7.5);
          pdf.setTextColor("#71717a");
          pdf.text(label.toUpperCase(), cardX + 4, cardY + 5.5, { maxWidth: cardWidth - 8 });
          pdf.setFontSize(9.5);
          pdf.setTextColor("#f4f4f5");
          pdf.text(value, cardX + 4, cardY + 11.8, { maxWidth: cardWidth - 8 });
        });

        const drawInsightPanel = (
          title: string,
          items: string[],
          x: number,
          panelY: number,
          panelWidth: number,
          accent: string
        ) => {
          pdf.setFillColor("#0a0a0a");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(x, panelY, panelWidth, 46, 4, 4, "FD");
          pdf.setFillColor(accent);
          pdf.rect(x, panelY, 1.5, 46, "F");
          pdf.setFontSize(8);
          pdf.setTextColor("#ccfbf1");
          pdf.text(title.toUpperCase(), x + 5, panelY + 7);
          pdf.setFontSize(6.6);
          pdf.setTextColor("#d4d4d8");
          (items.length ? items : ["See detailed section analysis."]).slice(0, 3).forEach((item, index) => {
            pdf.setFillColor(accent);
            pdf.circle(x + 5, panelY + 15 + index * 9, 1, "F");
            pdf.text(item, x + 9, panelY + 16.2 + index * 9, {
              maxWidth: panelWidth - 14,
            });
          });
        };

        drawInsightPanel("Top 3 Strengths", strengths, margin + 12, 186, (contentWidth - 31) / 2, "#14b8a6");
        drawInsightPanel("Top 3 Risks", risks, margin + 21 + (contentWidth - 31) / 2, 186, (contentWidth - 31) / 2, "#f97316");

        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(margin + 12, 241, contentWidth - 24, 22, 5, 5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor("#99f6e4");
        pdf.text("NEXT CRITICAL ACTION", margin + 18, 249);
        pdf.setFontSize(9);
        pdf.setTextColor("#f8fafc");
        pdf.text(nextAction, margin + 18, 257, { maxWidth: contentWidth - 36 });

        drawFooter();
      };

      drawCoverPage();
      pdf.addPage();
      const tocPage = pdf.getNumberOfPages();
      paintPage();
      drawFooter();
      pdf.addPage();
      paintPage();
      y = margin;

      pdf.setFontSize(10);
      pdf.setTextColor("#5eead4");
      drawLogoMark(margin, y - 6, 10);
      pdf.text("ZERINIX REPORT", margin + 14, y);

      pdf.setFontSize(21);
      pdf.setTextColor("#ffffff");
      const titleLines = pdf.splitTextToSize(normalizePdfText(report.title), contentWidth - 38);
      pdf.text(titleLines, margin, y + 11, {
        lineHeightFactor: 1.18,
        maxWidth: contentWidth - 38,
      });

      pdf.setFillColor("#042f2e");
      pdf.setDrawColor("#115e59");
      pdf.roundedRect(pageWidth - margin - 32, y + 1, 32, 10, 5, 5, "FD");
      pdf.setFontSize(8);
      pdf.setTextColor("#ccfbf1");
      pdf.text(report.status, pageWidth - margin - 25, y + 7.3, {
        maxWidth: 22,
      });

      y += 28 + Math.max(0, titleLines.length - 1) * 7;

      const meta = `${report.type} - ${
        report.createdAt
          ? new Date(report.createdAt).toLocaleDateString("en-US")
          : "No date"
      }`;
      pdf.setFontSize(8.5);
      pdf.setTextColor("#a1a1aa");
      pdf.text(meta, margin, y, { maxWidth: contentWidth });
      y += 9;

      const summaryCards = [
        `${report.sections.length} Sections`,
        report.type,
        "Investor Ready",
      ];

      summaryCards.forEach((label, index) => {
        const cardWidth = (contentWidth - 8) / 3;
        const cardX = margin + index * (cardWidth + 4);

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(cardX, y, cardWidth, 12, 3, 3, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor(index === 2 ? "#ccfbf1" : "#a1a1aa");
        pdf.text(label, cardX + 4, y + 7.5, { maxWidth: cardWidth - 8 });
      });

      y += 18;

      const getTamRows = (content: string, width: number) =>
        ([
          ["TAM", "#134e4a"],
          ["SAM", "#115e59"],
          ["SOM", "#5eead4"],
        ] as const).map(([label, color]) => {
          const value = compactPdfMetricValue(extractMetricValue(content, label));
          const snippet = extractSectionSnippet(content, label);
          const description = normalizePdfText(snippet.replace(value, ""))
            .replace(new RegExp(`^${label}\\s*[:\\-–—]?`, "i"), "")
            .trim();
          const descriptionLines = description
            ? (pdf.splitTextToSize(description, width - 8) as string[])
            : [];
          const rowHeight = Math.max(15, 13 + descriptionLines.length * 4.4);

          return { label, color, value, descriptionLines, rowHeight };
        });

      const getTamVisualHeight = (content: string, width: number) =>
        getTamRows(content, width).reduce((height, row, index) => {
          return height + row.rowHeight + (index === 0 ? 0 : 3);
        }, 0);

      const getSwotLayout = (content: string, width: number) => {
        const quadrants = [
          ["Strengths", "#042f2e"],
          ["Weaknesses", "#18181b"],
          ["Opportunities", "#0f3f3a"],
          ["Threats", "#1c1917"],
        ] as const;
        const gap = 3;
        const boxWidth = (width - gap) / 2;
        const items = quadrants.map(([label, color]) => {
          const bulletLines = extractSwotBullets(content, label, fullReportContent)
            .slice(0, 3)
            .map((bullet) => pdf.splitTextToSize(`• ${bullet}`, boxWidth - 6) as string[]);
          const textLineCount = Math.max(1, bulletLines.reduce((count, lines) => count + lines.length, 0));
          const boxHeight = Math.max(29, 11 + textLineCount * 4.2);

          return { label, color, bulletLines, boxHeight };
        });
        const firstRowHeight = Math.max(items[0]?.boxHeight ?? 29, items[1]?.boxHeight ?? 29);
        const secondRowHeight = Math.max(items[2]?.boxHeight ?? 29, items[3]?.boxHeight ?? 29);

        return {
          gap,
          boxWidth,
          items,
          rowHeights: [firstRowHeight, secondRowHeight],
          totalHeight: firstRowHeight + gap + secondRowHeight,
        };
      };

      const getFinancialLayout = (content: string, width: number) => {
        const metricContent = `${content}\n${fullReportContent}`;
        const labels = getFinancialDashboardMetrics(metricContent);
        const columns = 3;
        const itemWidth = (width - (columns - 1) * 3) / columns;
        const itemHeight = 18;
        const items = labels
          .map((item) => {
            const value = formatMetricCardValue(extractMetricValueFromAliases(metricContent, item.aliases));
            const compactValue = compactPdfMetricValue(value);
            const description = extractShortDescription(metricContent, item.aliases);
            const descriptionLines = description
              ? (pdf.splitTextToSize(`${item.label}: ${description}`, width - 6) as string[])
              : [];

            return {
              label: item.label,
              aliases: item.aliases,
              value,
              compactValue,
              descriptionLines,
              height: itemHeight,
            };
          })
          .filter((item) => item.compactValue);
        const rowHeights = items.reduce<number[]>((rows, item, index) => {
          const rowIndex = Math.floor(index / columns);
          rows[rowIndex] = Math.max(rows[rowIndex] ?? 0, item.height);
          return rows;
        }, []);

        return {
          columns,
          itemWidth,
          items,
          rowHeights,
          detailLines: items.flatMap((item) => item.descriptionLines),
          gridHeight:
            rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
            Math.max(0, rowHeights.length - 1) * 3,
          totalHeight:
            rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
            Math.max(0, rowHeights.length - 1) * 3 +
            (items.some((item) => item.descriptionLines.length > 0)
              ? 9 + items.flatMap((item) => item.descriptionLines).length * 3.6
              : 0),
        };
      };

      const drawSectionVisual = (title: string, content: string, sectionY: number) => {
        const normalizedTitle = title.toLowerCase();
        const visualY = sectionY + 19;
        const drawSingleLine = (
          text: string,
          x: number,
          lineY: number,
          maxWidth: number,
          size: number,
          minSize = 5.4,
          truncate = true
        ) => {
          let fontSize = size;

          pdf.setFontSize(fontSize);
          while (fontSize > minSize && pdf.getTextWidth(text) > maxWidth) {
            fontSize -= 0.35;
            pdf.setFontSize(fontSize);
          }

          const safeText =
            truncate && pdf.getTextWidth(text) > maxWidth
              ? `${text.slice(0, Math.max(4, Math.floor(text.length * (maxWidth / Math.max(pdf.getTextWidth(text), 1))) - 1))}…`
              : text;

          pdf.text(safeText, x, lineY);
        };

        if (normalizedTitle.includes("tam / sam / som")) {
          const rows = getTamRows(content, bodyWidth);
          let rowY = visualY;

          rows.forEach(({ label, color, value, descriptionLines, rowHeight }, index) => {
            pdf.setFillColor("#101113");
            pdf.setDrawColor(color);
            pdf.roundedRect(bodyX, rowY, bodyWidth, rowHeight, 3, 3, "FD");
            pdf.setFillColor(color);
            pdf.roundedRect(bodyX + 3, rowY + 2, 13, 5, 2.5, 2.5, "F");
            pdf.setFontSize(6.4);
            pdf.setTextColor(index === 2 ? "#000000" : "#ccfbf1");
            pdf.text(label, bodyX + 5, rowY + 5.4);
            pdf.setTextColor("#ccfbf1");
            drawSingleLine(value || "—", bodyX + 20, rowY + 5.7, bodyWidth - 24, 8.2, 4.2, false);

            if (descriptionLines.length > 0) {
              pdf.setFontSize(5.6);
              pdf.setTextColor("#a1a1aa");
              pdf.text(descriptionLines, bodyX + 3, rowY + 12.5, {
                lineHeightFactor: 1.18,
                maxWidth: bodyWidth - 6,
              });
            }

            rowY += rowHeight + 3;
          });
          return getTamVisualHeight(content, bodyWidth);
        }

        if (normalizedTitle.includes("swot")) {
          const swotLayout = getSwotLayout(content, bodyWidth);

          swotLayout.items.forEach(({ label, color, bulletLines }, index) => {
            const rowIndex = Math.floor(index / 2);
            const x = bodyX + (index % 2) * (swotLayout.boxWidth + swotLayout.gap);
            const boxY = visualY + (rowIndex === 0 ? 0 : swotLayout.rowHeights[0] + swotLayout.gap);
            const boxHeight = swotLayout.rowHeights[rowIndex];

            pdf.setFillColor(color);
            pdf.setDrawColor("#334155");
            pdf.roundedRect(x, boxY, swotLayout.boxWidth, boxHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(7.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(label.toUpperCase(), x + 3, boxY + 5);
            pdf.setFontSize(6.2);
            pdf.setTextColor("#d4d4d8");
            let bulletY = boxY + 10;
            bulletLines.forEach((lines) => {
              pdf.text(lines, x + 3, bulletY, {
                lineHeightFactor: 1.14,
                maxWidth: swotLayout.boxWidth - 6,
              });
              bulletY += lines.length * 4.2;
            });
          });

          return swotLayout.totalHeight;
        }

        if (normalizedTitle.includes("founder score")) {
          const labels = founderScoreMetrics.slice(0, 6);
          const itemWidth = (bodyWidth - 10) / 3;

          labels.forEach((label, index) => {
            const x = bodyX + (index % 3) * (itemWidth + 5);
            const itemY = visualY + Math.floor(index / 3) * 15;
            const score = extractScore(content, label) ?? [76, 68, 61, 58, 64, 72][index] ?? 60;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 12, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(String(score), x + 4.2, itemY + 7.8);
            pdf.setFontSize(6.5);
            pdf.setTextColor("#e4e4e7");
            pdf.text(label, x + 14, itemY + 5, { maxWidth: itemWidth - 17 });
            pdf.setTextColor("#71717a");
            pdf.text("Score", x + 14, itemY + 8.8);
          });

          return 31;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          const selected = detectRecommendation(content) || "REVIEW";
          const decisionLabel = formatDecisionLabel(selected);
          const confidence = extractConfidence(content);
          const investmentRecommendation =
            extractMetricValue(content, "Investment Recommendation") ||
            extractMetricValue(content, "Recommendation") ||
            selected;
          const mainRisk = extractMetricValue(content, "Main Risk");
          const nextAction =
            extractMetricValue(content, "Next Critical Action") ||
            extractMetricValue(content, "Next Action");

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 52, 26, 5, 5, "FD");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#134e4a");
          pdf.text("RECOMMENDATION", bodyX + 5, visualY + 6);
          pdf.setFontSize(13);
          pdf.setTextColor("#000000");
          drawSingleLine(decisionLabel, bodyX + 5, visualY + 16, 42, 11, 6.5);

          pdf.setFillColor("#27272a");
          pdf.roundedRect(bodyX, visualY + 31, 52, 4, 2, 2, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            bodyX,
            visualY + 31,
            (52 * (confidence ?? 50)) / 100,
            4,
            2,
            2,
            "F"
          );

          const recItems = [
            ["Confidence", confidence === null ? "—" : `${confidence}%`],
            ["Investment Recommendation", investmentRecommendation || "—"],
            ["Main Risk", mainRisk || "See risk section"],
            ["Next Action", nextAction || "Validate critical proof point"],
          ];

          recItems.forEach(([label, value], index) => {
            const itemX = bodyX + 60 + (index % 2) * ((bodyWidth - 64) / 2 + 2);
            const itemY = visualY + Math.floor(index / 2) * 17;
            const itemWidth = (bodyWidth - 68) / 2;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, 15, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#71717a");
            pdf.text(label.toUpperCase(), itemX + 2, itemY + 3.2);
            pdf.setTextColor("#e4e4e7");
            pdf.setFontSize(6);
            drawSingleLine(value, itemX + 2, itemY + 7.8, itemWidth - 4, 6);
          });

          return 48;
        }

        if (normalizedTitle.includes("roadmap")) {
          const stepWidth = (bodyWidth - 10) / 6;
          founderRoadmapSteps.forEach((step, index) => {
            const x = bodyX + index * (stepWidth + 2);
            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, stepWidth, 9, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(step, x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
          });
          return 12;
        }

        if (normalizedTitle.includes("porter")) {
          const forces = ["Rivalry", "Entrants", "Buyer", "Supplier", "Substitutes"];
          const centerX = bodyX + bodyWidth * 0.32;
          const centerY = visualY + 22;

          pdf.setDrawColor("#115e59");
          pdf.circle(centerX, centerY, 20, "S");
          pdf.circle(centerX, centerY, 13, "S");
          pdf.circle(centerX, centerY, 6, "S");
          pdf.setFillColor("#5eead4");
          pdf.circle(centerX, centerY, 2.2, "F");

          forces.forEach((force, index) => {
            const angle = -Math.PI / 2 + (index * 2 * Math.PI) / forces.length;
            const dotX = centerX + Math.cos(angle) * 20;
            const dotY = centerY + Math.sin(angle) * 20;
            const cardX = bodyX + bodyWidth * 0.58;
            const cardY = visualY + index * 8;
            const score = [72, 54, 66, 48, 60][index];

            pdf.setDrawColor("#5eead4");
            pdf.line(centerX, centerY, dotX, dotY);
            pdf.setFillColor("#0f766e");
            pdf.circle(dotX, dotY, 1.8, "F");

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(cardX, cardY, bodyWidth * 0.38, 6, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#e4e4e7");
            pdf.text(force, cardX + 2, cardY + 4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(cardX + 22, cardY + 2.2, bodyWidth * 0.24, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(cardX + 22, cardY + 2.2, (bodyWidth * 0.24 * score) / 100, 1.4, 0.7, 0.7, "F");
          });

          return 46;
        }

        if (
          normalizedTitle.includes("financial dashboard") ||
          normalizedTitle.includes("founder score") ||
          normalizedTitle.includes("scenario") ||
          normalizedTitle.includes("porter") ||
          normalizedTitle.includes("kpi") ||
          normalizedTitle.includes("unit economics")
        ) {
          const financialLayout = normalizedTitle.includes("financial dashboard")
            ? getFinancialLayout(content, bodyWidth)
            : null;
          const labels = normalizedTitle.includes("founder score")
            ? founderScoreMetrics
            : normalizedTitle.includes("scenario")
              ? ["Worst", "Base", "Best"]
              : normalizedTitle.includes("porter")
                ? ["Rivalry", "Entrants", "Buyer", "Substitutes"]
                : normalizedTitle.includes("kpi")
                  ? ["Acquisition", "Activation", "Retention", "Revenue"]
                  : normalizedTitle.includes("risk")
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : normalizedTitle.includes("unit economics")
                      ? ["Gross Margin", "CAC", "LTV", "Payback"]
                      : financialLayout?.items ?? [];
          const isFinancialDashboard = normalizedTitle.includes("financial dashboard");
          const isKpiDashboard = normalizedTitle.includes("kpi");
          const isScenario = normalizedTitle.includes("scenario");
          const isUnitEconomics = normalizedTitle.includes("unit economics");
          const metricContent = `${content}\n${fullReportContent}`;
          const columns = isFinancialDashboard ? 3 : labels.length > 6 ? 4 : labels.length;
          const itemWidth = isFinancialDashboard && financialLayout
            ? financialLayout.itemWidth
            : (bodyWidth - (columns - 1) * 3) / columns;

          labels.forEach((item, index) => {
            const label = typeof item === "string" ? item : item.label;
            const aliases = typeof item === "string" ? [item] : item.aliases;
            const x = bodyX + (index % columns) * (itemWidth + 3);
            const rowIndex = Math.floor(index / columns);
            const priorRowHeight = isFinancialDashboard && financialLayout
              ? financialLayout.rowHeights.slice(0, rowIndex).reduce((sum, height) => sum + height, 0)
              : 0;
            const itemHeight = isFinancialDashboard && financialLayout
              ? financialLayout.rowHeights[rowIndex]
              : isKpiDashboard ? 23 : isScenario ? 20 : isUnitEconomics ? 14 : 10;
            const itemY = isFinancialDashboard && financialLayout
              ? visualY + priorRowHeight + rowIndex * 3
              : visualY + rowIndex * (itemHeight + 3);
            const score = extractScore(metricContent, label) ?? [42, 62, 84, 56][index] ?? 60;
            const value = typeof item !== "string" && "value" in item
              ? item.value
              : formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
            const compactValue = compactPdfMetricValue(value);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(label, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
            if (isFinancialDashboard && value) {
              pdf.setTextColor("#f4f4f5");
              drawSingleLine(compactValue || "—", x + 2, itemY + 11.7, itemWidth - 4, 8.8, 4.2, false);
              return;
            }
            if (isUnitEconomics) {
              drawSingleLine(compactValue || "—", x + 2, itemY + 8.8, itemWidth - 4, 7.2, 4.2, false);
              return;
            }
            if (isKpiDashboard) {
              const kpiValue = extractKpiValue(content, label) || `${score}%`;
              const target = extractKpiTarget(content, label);
              const status = extractKpiStatus(content, label);
              pdf.setTextColor("#f4f4f5");
              drawSingleLine(kpiValue, x + 2, itemY + 8.4, itemWidth - 4, 7.5, 4.2, false);
              pdf.setFontSize(5.3);
              pdf.setTextColor("#a1a1aa");
              pdf.text(`Target: ${target || kpiValue || "—"}`, x + 2, itemY + 12.1, { maxWidth: itemWidth - 4 });
              pdf.text(`Status: ${status}`, x + 2, itemY + 15.5, { maxWidth: itemWidth - 4 });
              pdf.setFillColor("#27272a");
              pdf.roundedRect(x + 2, itemY + 18.8, itemWidth - 4, 1.5, 0.7, 0.7, "F");
              pdf.setFillColor("#5eead4");
              pdf.roundedRect(x + 2, itemY + 18.8, Math.max(3, ((itemWidth - 4) * score) / 100), 1.5, 0.7, 0.7, "F");
              return;
            }
            if (isScenario) {
              const snippet = extractScenarioSnippet(content, label) || extractKeywordInsight(content, [label]);
              pdf.setTextColor("#f4f4f5");
              pdf.setFontSize(6);
              pdf.text(pdf.splitTextToSize(snippet || "Scenario path under review.", itemWidth - 4).slice(0, 2), x + 2, itemY + 8.1, {
                lineHeightFactor: 1.12,
                maxWidth: itemWidth - 4,
              });
              pdf.setFillColor("#27272a");
              pdf.roundedRect(x + 2, itemY + 15, itemWidth - 4, 1.4, 0.7, 0.7, "F");
              pdf.setFillColor(index === 0 ? "#fca5a5" : index === 1 ? "#fde68a" : "#5eead4");
              pdf.roundedRect(x + 2, itemY + 15, Math.max(3, ((itemWidth - 4) * ([42, 66, 84][index] || score)) / 100), 1.4, 0.7, 0.7, "F");
              return;
            }
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 7, itemWidth - 4, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(
              x + 2,
              itemY + 7,
              Math.max(3, ((itemWidth - 4) * score) / 100),
              1.4,
              0.7,
              0.7,
              "F"
            );
          });

          if (isFinancialDashboard) {
            if (financialLayout && financialLayout.detailLines.length > 0) {
              const detailsY = visualY + financialLayout.gridHeight + 7;

              pdf.setFillColor("#101113");
              pdf.setDrawColor("#27272a");
              pdf.roundedRect(bodyX, detailsY - 4, bodyWidth, financialLayout.detailLines.length * 3.6 + 8, 2.5, 2.5, "FD");
              pdf.setFontSize(6);
              pdf.setTextColor("#5eead4");
              pdf.text("METRIC DETAILS", bodyX + 3, detailsY);
              pdf.setFontSize(5.5);
              pdf.setTextColor("#a1a1aa");
              pdf.text(financialLayout.detailLines, bodyX + 3, detailsY + 4, {
                lineHeightFactor: 1.1,
                maxWidth: bodyWidth - 6,
              });
            }

            return financialLayout?.totalHeight ?? 0;
          }

          if (isKpiDashboard) {
            return 52;
          }

          if (isScenario) {
            return 26;
          }

          if (isUnitEconomics) {
            return 18;
          }

          return labels.length > 6 ? 38 : 22;
        }

        return 0;
      };

      const getVisualHeight = (section: DashboardReport["sections"][number]) => {
        const normalizedTitle = section.title.toLowerCase();

        if (normalizedTitle.includes("financial dashboard")) {
          return getFinancialLayout(section.content, bodyWidth).totalHeight;
        }

        if (normalizedTitle.includes("swot")) {
          return getSwotLayout(section.content, bodyWidth).totalHeight;
        }

        if (normalizedTitle.includes("porter")) {
          return 46;
        }

        if (normalizedTitle.includes("founder score")) {
          return 34;
        }

        if (normalizedTitle.includes("tam / sam / som")) {
          return getTamVisualHeight(section.content, bodyWidth);
        }

        if (normalizedTitle.includes("scenario")) {
          return 26;
        }

        if (normalizedTitle.includes("kpi")) {
          return 52;
        }

        if (normalizedTitle.includes("unit economics")) {
          return 18;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          return 48;
        }

        return /founder score|scenario|roadmap|porter|kpi|risk|unit economics/i.test(section.title)
          ? 22
          : 0;
      };

      const drawTableOfContents = () => {
        paintPage();
        drawLogoMark(margin, 24, 13);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX REPORT", margin + 17, 33);
        pdf.setFontSize(26);
        pdf.setTextColor("#ffffff");
        pdf.text("Table of Contents", margin, 54);
        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text("Click a section title to jump directly to that page.", margin, 64);

        let tocY = 82;
        tocEntries.slice(0, 18).forEach((entry, index) => {
          if (tocY > pageHeight - 26) {
            return;
          }

          pdf.setFillColor(index % 2 === 0 ? "#09090b" : "#050505");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin, tocY - 6, contentWidth, 12, 3, 3, "FD");
          pdf.setFontSize(8.5);
          pdf.setTextColor("#f4f4f5");
          pdf.textWithLink(normalizePdfText(entry.title), margin + 6, tocY + 1.5, {
            pageNumber: entry.page,
          });
          pdf.setTextColor("#5eead4");
          pdf.text(String(entry.page), pageWidth - margin - 10, tocY + 1.5);
          tocY += 14;
        });

        drawFooter();
      };

      dedupePdfSections(mergePdfSourceSections(report.sections)).forEach((section) => {
        const visualHeight = getVisualHeight(section);
        const sectionBodyContent = isSourceSectionTitle(section.title)
          ? formatPdfCitationContent(section.content)
          : removeDuplicateVisualText(section.title, section.content);
        const bodyLines = splitPdfReadableLines(sectionBodyContent, bodyWidth);
        const hasBodyText = sectionBodyContent.trim().length > 0;
        const safeBodyLines = bodyLines.length > 0 ? bodyLines : [""];
        let lineIndex = 0;

        while (lineIndex < safeBodyLines.length) {
          const activeVisualHeight = lineIndex === 0 ? visualHeight : 0;
          const bodyTextHeight = hasBodyText ? bodyLineHeight : 0;
          const minimumCardHeight =
            cardHeaderHeight + activeVisualHeight + bodyTextHeight + cardBottomPadding + 3;

          ensureSpace(minimumCardHeight);

          if (lineIndex === 0) {
            tocEntries.push({
              title: section.title,
              page: pdf.getCurrentPageInfo().pageNumber,
            });
          }

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - activeVisualHeight - cardBottomPadding;
          const maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight +
              activeVisualHeight +
              (hasBodyText ? lines.length * bodyLineHeight : 0) +
              cardBottomPadding
          );

          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin, y, contentWidth, cardHeight, 5, 5, "FD");

          pdf.setFillColor("#111113");
          pdf.roundedRect(margin, y, contentWidth, 18, 5, 5, "F");

          pdf.setFillColor("#18181b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin + 4, y + 5, 11, 11, 3, 3, "FD");

          pdf.setDrawColor("#99f6e4");
          pdf.circle(margin + 9.5, y + 10.5, 2.9, "S");
          pdf.line(margin + 9.5, y + 7.8, margin + 9.5, y + 13.2);
          pdf.line(margin + 6.8, y + 10.5, margin + 12.2, y + 10.5);

          pdf.setFillColor("#5eead4");
          pdf.rect(margin, y + 5, 1, cardHeight - 10, "F");

          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          pdf.text(`${section.title}${isContinued ? " continued" : ""}`, bodyX, y + 12.5, {
            maxWidth: bodyWidth,
          });

          const drawnVisualHeight =
            activeVisualHeight > 0 && !isContinued
              ? drawSectionVisual(section.title, section.content, y)
              : 0;

          if (hasBodyText) {
            pdf.setFontSize(8.8);
            pdf.setTextColor("#d4d4d8");
            pdf.text(lines, bodyX, y + 24 + drawnVisualHeight, {
              lineHeightFactor: 1.3,
              maxWidth: bodyWidth,
            });
          }

          lineIndex += lines.length;
          y += cardHeight + 5;
        }
      });

      drawFooter();
      const finalPage = pdf.getCurrentPageInfo().pageNumber;
      pdf.setPage(tocPage);
      drawTableOfContents();
      const totalPages = pdf.getNumberOfPages();

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        pdf.setPage(pageNumber);
        drawFooter();
      }

      pdf.setPage(finalPage);

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const isSafari =
        /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
        navigator.vendor.includes("Apple");

      if (isSafari) {
        const openedWindow = window.open(url, "_blank");

        if (!openedWindow) {
          URL.revokeObjectURL(url);
          setError("Safari blocked the PDF tab. Please allow pop-ups and try again.");
          return;
        }

        window.setTimeout(() => URL.revokeObjectURL(url), 300000);
      } else {
        const link = document.createElement("a");

        link.href = url;
        link.download = createFileName(report.title);
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      }
    } catch (downloadError) {
      console.error(downloadError);
      setError("PDF could not be created. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={downloadPdf}
        disabled={exporting || failedReport}
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-teal-200/30 bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/30 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-4 w-4 text-black" />
        {exporting ? "Preparing PDF..." : "Download PDF"}
      </button>
      {error ? (
        <p className="mt-3 max-w-xs text-sm leading-6 text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
