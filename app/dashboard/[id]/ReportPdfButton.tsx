"use client";

import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { Download } from "lucide-react";
import type { DashboardReport } from "../report-utils";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";
import {
  detectPdfPresentationLocale,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
  localizePdfReportSections,
  normalizePdfCanonicalTamSamSomContent,
  normalizePdfFinancialSectionContent,
  normalizePdfTamSamSomBodyContent,
  normalizePdfTamSamSomOwnershipContent,
  normalizePdfText,
  normalizePdfSourceContent,
  normalizePdfSourceDomain,
  repairPdfLineFragments,
} from "@/app/lib/pdf-normalization.mjs";

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
  sourceType?: "Verified source" | "Company reference" | "Industry reference" | "Planning assumption";
};

function normalizeCitationConfidence(value: string): CitationData["confidence"] | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === "high" || normalized === "strong") return "High";
  if (normalized === "medium" || normalized === "moderate") return "Medium";
  if (normalized === "low") return "Low";

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

function getCitationDomain(url?: string, organization = "") {
  if (url) {
    return normalizePdfSourceDomain(url);
  }

  return normalizePdfSourceDomain(
    normalizePdfText(organization)
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|company|publisher|organization)\b\.?/g, "")
  );
}

function getCitationSourceName(citation: Pick<CitationData, "sourceTitle" | "organization" | "url">) {
  return (
    getCitationDomain(citation.url, citation.organization) ||
    citation.organization ||
    citation.sourceTitle ||
    "Source"
  );
}

function getPdfCitationSourceTypeLabel(citation: CitationData) {
  if (citation.sourceType === "Company reference") {
    return "Official company website";
  }

  if (citation.sourceType === "Industry reference") {
    return "Industry reference";
  }

  if (citation.sourceType === "Planning assumption") {
    return "Planning assumption";
  }

  return "Verified source";
}

function getPdfCitationTrustLabel(citation: CitationData) {
  if (!citation.url || citation.sourceType === "Planning assumption") {
    return "Reference";
  }

  return "Verified source";
}

function dedupePdfCitations(citations: CitationData[]) {
  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const domain = getCitationDomain(citation.url, citation.organization);
    const publisherKey = normalizeCitationKey(citation.organization);
    const sourceNameKey = normalizeCitationKey(getCitationSourceName(citation));
    const key = [
      domain || "no-domain",
      publisherKey || "unknown-publisher",
      sourceNameKey || "unknown-source",
    ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...existing,
      ...citation,
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
    });
  });

  return Array.from(unique.values());
}

function getFinalDedupePdfSources(citations: CitationData[]) {
  const unique = new Map<
    string,
    {
      sourceName: string;
      sourceType: string;
      trustLabel: string;
    }
  >();

  dedupePdfCitations(citations).forEach((citation) => {
    const domain = getCitationDomain(citation.url, citation.organization);
    const domainNameKey = normalizeCitationKey(domain.split(".")[0] || "");
    const sourceName = getCitationSourceName(citation);
    const sourceNameKey = normalizeCitationKey(sourceName);
    const rawPublisherKey = normalizeCitationKey(citation.organization);
    const publisherKey =
      domainNameKey &&
      (!rawPublisherKey ||
        rawPublisherKey === "publisher not specified" ||
        rawPublisherKey === domainNameKey ||
        rawPublisherKey.startsWith(`${domainNameKey} `) ||
        sourceNameKey === domainNameKey)
        ? domainNameKey
        : rawPublisherKey || "unknown-publisher";
    const displayKey = sourceNameKey || domainNameKey || "unknown-source";
    const key = [
      domain || "no-domain",
      publisherKey,
      displayKey,
    ].join("|");
    const fallbackDisplayKey = `display:${domain || "no-domain"}|${displayKey}`;

    if (!unique.has(key) && !unique.has(fallbackDisplayKey)) {
      unique.set(key, {
        sourceName,
        sourceType: getPdfCitationSourceTypeLabel(citation),
        trustLabel: getPdfCitationTrustLabel(citation),
      });
      unique.set(fallbackDisplayKey, unique.get(key)!);
    }
  });

  return Array.from(new Set(unique.values()));
}

function normalizeCitationUrl(value = "") {
  const normalized = normalizePdfText(value).trim();

  if (
    !normalized ||
    /^[-–—]+$/.test(normalized) ||
    /^(?:not verified|url doğrulanmadı|n\/?a|not available|none|null|undefined)$/i.test(normalized)
  ) {
    return "";
  }

  return /^https?:\/\//i.test(normalized) ? normalized : "";
}

function looksLikePromptOrInstruction(value: string) {
  return /\b(based on the entire report|would you invest|should i invest|what do you think|section to generate|report quality rules|write only|business idea\s*\/\s*goal|system prompt|internal instruction|validation prompt)\b/i.test(
    value
  );
}

function getFirstReadableSentence(value: string) {
  const cleaned = normalizePdfText(value)
    .replace(/[#*_`>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || looksLikePromptOrInstruction(cleaned)) {
    return "";
  }

  const sentence = cleaned.match(/^(.{32,220}?[.!?])\s/)?.[1] || cleaned.slice(0, 180);

  return looksLikePromptOrInstruction(sentence) ? "" : sentence.trim();
}

function getBusinessIdeaFromPrompt(value: string) {
  const cleaned = normalizePdfText(value)
    .replace(/^[-*•]\s*/, "")
    .replace(/\?+$/g, "")
    .trim();

  if (!cleaned || looksLikePromptOrInstruction(cleaned)) {
    return "";
  }

  if (/\b(who is|what is|why|how|would|should|can you|tell me|analyze|compare)\b/i.test(cleaned)) {
    return "";
  }

  return cleaned.slice(0, 180);
}

function deriveBusinessDescriptionFromSections(
  report: DashboardReport,
  sections = report.sections
) {
  const promptDescription = getBusinessIdeaFromPrompt(report.prompt);

  if (promptDescription) {
    return promptDescription;
  }

  const priorityFields = [
    "businessModel",
    "solution",
    "executiveSummary",
    "marketOverview",
    "marketOpportunity",
    "targetCustomer",
  ];
  const prioritySections = priorityFields
    .map((field) => sections.find((section) => section.field === field))
    .filter((section): section is DashboardReport["sections"][number] => Boolean(section));
  const remainingSections = sections.filter(
    (section) => !prioritySections.includes(section)
  );

  for (const section of [...prioritySections, ...remainingSections]) {
    const sentence = getFirstReadableSentence(section.content);

    if (sentence) {
      return sentence;
    }
  }

  return looksLikePromptOrInstruction(report.title)
    ? "Analyzed business/company profile"
    : normalizePdfText(report.title || "Analyzed business/company profile");
}

function parseCitations(content: string): CitationData[] {
  if (/\bsource\s+unavailable\b/i.test(content)) {
    return [];
  }

  const fallbackConfidence = normalizeCitationConfidence(
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i)?.[1] || ""
  );
  const entries: CitationData[] = [];
  let current: Partial<CitationData> = {};
  const flushCurrent = () => {
    if (current.sourceTitle || current.organization || current.url) {
      entries.push({
        sourceTitle: current.sourceTitle || current.organization || "Untitled source",
        organization: current.organization || "Publisher not specified",
        ...(current.publicationYear ? { publicationYear: current.publicationYear } : {}),
        ...(current.confidence || fallbackConfidence
          ? { confidence: current.confidence || fallbackConfidence }
          : {}),
        ...(current.url ? { url: current.url } : {}),
        ...(current.sourceType ? { sourceType: current.sourceType } : { sourceType: "Verified source" }),
      });
    }
    current = {};
  };

  content
    .split("\n")
    .forEach((rawLine) => {
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

      if (!line) {
        return;
      }

      const metadataMatch = line.match(
        /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type)\s*[:\-–—]\s*(.+)$/i
      );
      if (metadataMatch) {
        const key = metadataMatch[1].toLowerCase();
        const value = metadataMatch[2].trim();

        if ((key === "title" || key === "source") && current.sourceTitle) {
          flushCurrent();
        }

        if (key === "title" || key === "source") {
          current.sourceTitle = value;
        } else if (key === "publisher" || key === "organization") {
          current.organization = value;
        } else if (key === "year" || key === "publication year") {
          current.publicationYear = value.match(/\b(19|20)\d{2}\b/)?.[0];
        } else if (key === "url") {
          const normalizedUrl = normalizeCitationUrl(url || value);
          if (normalizedUrl) current.url = normalizedUrl;
        } else if (key === "confidence") {
          current.confidence = normalizeCitationConfidence(value);
        } else {
          current.sourceType = normalizeSourceType(value);
        }
        if (url) current.url = url;
        return;
      }

      const citationMatch = line.match(
        /^([^—–|-]{2,80})\s*[—–-]\s*(.+?)(?:\s*\((\d{4})\))?(?:\s*[.;:]?\s*)?$/
      );

      if (!citationMatch) {
        return;
      }

      flushCurrent();
      const organization = citationMatch[1].trim();
      const sourceTitle = citationMatch[2]
        .replace(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i, "")
        .trim();
      const publicationYear = citationMatch[3]?.trim();

      if (!organization || !sourceTitle || /\bsource\s+unavailable\b/i.test(sourceTitle)) {
        return;
      }

      entries.push({
        sourceTitle,
        organization,
        ...(publicationYear ? { publicationYear } : {}),
        ...(fallbackConfidence ? { confidence: fallbackConfidence } : {}),
        ...(url ? { url } : {}),
        sourceType: normalizeSourceType(line),
      });
    });
  flushCurrent();

  const unique = new Map<string, CitationData>();

  entries.forEach((citation) => {
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

function isSourceSectionTitle(title: string) {
  return /^(sources(?:\s+continued)?|references|kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
    title.trim()
  );
}

function formatPdfCitationContent(content: string) {
  const sourceContent = normalizePdfSourceContent(
    normalizePdfFinancialSectionContent(content, {
      field: "sourcesAssumptions",
      title: "Sources / Assumptions",
    })
  );
  const citations = parseCitations(sourceContent);
  const methodologyBlock = [
    "Methodology & Assumptions",
    "Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.",
  ].join("\n");

  if (citations.length === 0) {
    return methodologyBlock;
  }

  const finalDedupeSources = getFinalDedupePdfSources(citations);
  const sourceLines = finalDedupeSources
    .slice(0, 8)
    .map((source) =>
      [
        `• ${source.sourceName}`,
        `  Source type: ${source.sourceType}`,
        `  ${source.trustLabel}`,
      ].join("\n")
    )
    .join("\n");

  return `${sourceLines}\n\n${methodologyBlock}`;
}

const founderRoadmapSteps = [
  "Tomorrow",
  "This Week",
  "30 Days",
  "90 Days",
  "180 Days",
  "12 Months",
];

const roadmapStepAliases: Record<string, string[]> = {
  Tomorrow: ["Tomorrow", "Immediate Actions", "Today", "First 24 Hours"],
  "This Week": ["This Week", "Next 7 Days", "Week 1"],
  "30 Days": ["30 Days", "Next 30 Days"],
  "90 Days": ["90 Days", "Next 90 Days"],
  "180 Days": ["180 Days", "6 Months", "Next 6 Months"],
  "12 Months": ["12 Months", "Next 12 Months", "Year 1"],
};

const competitorFieldLabels = [
  "Company",
  "Competitor",
  "Positioning",
  "Strengths",
  "Weaknesses",
  "Competitive Threat",
  "Threat",
  "Target Customer",
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

function extractMarketSizeVisualValue(content: string, label: string) {
  const escapedLabel = escapeRegExp(label);
  const line = normalizePdfText(content)
    .split("\n")
    .find((item) => new RegExp(`^\\s*${escapedLabel}\\s*[:\\-–—]`, "i").test(item.trim()));
  const value = line?.match(
    new RegExp(`^\\s*${escapedLabel}\\s*[:\\-–—]\\s*((?:[<>~≈]?\\s*)?[€$₺]?\\s*\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT%])?)`, "i")
  )?.[1];

  return value ? compactPdfMetricValue(value) : "";
}

function isMobilityReportContent(content: string) {
  return /\b(scooter|micromobility|micro mobility|shared mobility|bike sharing|bikeshare|per-ride|urban riders|commuters|fleet utilization|rental|rider cac|rider ltv|active riders|yearly revenue|monthly revenue)\b/i.test(
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

  const scoreMatch = content.match(/\b(?:score|conviction)\s*(?:of|:)?\s*(\d{1,3})\s*\/\s*100\b/i);
  const score = Number(scoreMatch?.[1] || NaN);

  if (Number.isFinite(score)) {
    return Math.max(0, Math.min(100, score));
  }

  const percentMatch = content.match(/\b(\d{1,3})\s*%/);
  const percent = Number(percentMatch?.[1] || NaN);

  if (Number.isFinite(percent)) {
    return Math.max(0, Math.min(100, percent));
  }

  if (/\b(high|strong)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 80;
  }

  if (/\b(medium|moderate)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 60;
  }

  if (/\b(low|weak)\s+(?:confidence|conviction)\b/i.test(content)) {
    return 35;
  }

  return null;
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

function cleanPdfExecutiveText(value: string, maxLength = 130) {
  const cleaned = normalizePdfText(value)
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, maxLength).replace(/\s+\S*$/, "");

  return `${truncated || cleaned.slice(0, maxLength)}…`;
}

function parseInlineCompetitorField(line: string, label: string) {
  const stopLabels = competitorFieldLabels
    .filter((item) => item !== label)
    .map(escapeRegExp)
    .join("|");
  const match = line.match(
    new RegExp(`${escapeRegExp(label)}\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s+(?:${stopLabels})\\s*[:\\-–—]|$)`, "i")
  );

  return match?.[1]?.trim() || "";
}

function extractCompetitorRows(content: string) {
  const normalized = normalizePdfText(content).replace(/\*\*/g, "");
  const rows: Array<{
    company: string;
    positioning: string;
    strengths: string;
    weaknesses: string;
    threat: string;
  }> = [];
  const tableRows = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line));

  if (tableRows.length > 1) {
    const headers = tableRows[0].split("|").map((cell) => cell.trim().toLowerCase()).filter(Boolean);

    tableRows.slice(1).forEach((row) => {
      const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
      const read = (keys: string[]) => {
        const index = headers.findIndex((header) => keys.some((key) => header.includes(key)));
        return index >= 0 ? cells[index] || "" : "";
      };

      rows.push({
        company: cleanPdfExecutiveText(read(["company", "competitor", "rakip"]), 44),
        positioning: cleanPdfExecutiveText(read(["position", "konum"]), 88),
        strengths: cleanPdfExecutiveText(read(["strength", "güç"]), 76),
        weaknesses: cleanPdfExecutiveText(read(["weakness", "zayıf"]), 76),
        threat: cleanPdfExecutiveText(read(["threat", "risk"]), 64),
      });
    });

    return rows.filter((row) => row.company || row.positioning || row.strengths || row.weaknesses || row.threat).slice(0, 4);
  }

  normalized
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter((line) => line.length > 14)
    .forEach((line) => {
      const company =
        parseInlineCompetitorField(line, "Company") ||
        parseInlineCompetitorField(line, "Competitor") ||
        line.match(/^([A-Z0-9][A-Za-z0-9 .&()/-]{1,42})\s*[:—–-]\s+/)?.[1]?.trim() ||
        "";
      const positioning = parseInlineCompetitorField(line, "Positioning") || parseInlineCompetitorField(line, "Target Customer");
      const strengths = parseInlineCompetitorField(line, "Strengths");
      const weaknesses = parseInlineCompetitorField(line, "Weaknesses");
      const threat = parseInlineCompetitorField(line, "Competitive Threat") || parseInlineCompetitorField(line, "Threat");

      if (company || positioning || strengths || weaknesses || threat) {
        rows.push({
          company: cleanPdfExecutiveText(company || "Market participant", 44),
          positioning: cleanPdfExecutiveText(positioning || line, 88),
          strengths: cleanPdfExecutiveText(strengths || "Validation required", 76),
          weaknesses: cleanPdfExecutiveText(weaknesses || "Validation required", 76),
          threat: cleanPdfExecutiveText(threat || "Validation required", 64),
        });
      }
    });

  return rows.slice(0, 4);
}

function extractRoadmapAction(content: string, step: string) {
  const aliases = roadmapStepAliases[step] || [step];
  const allAliases = Object.values(roadmapStepAliases).flat();
  const snippet =
    extractAliasedSectionSnippet(content, aliases, allAliases) ||
    aliases.map((alias) => extractKeywordInsight(content, [alias])).find(Boolean) ||
    "";
  const bullet = extractBullets(snippet, step)[0] || snippet;

  return cleanPdfExecutiveText(bullet || "Validation required", 92);
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
  const financialContent = normalizePdfFinancialSectionContent(content, { title });

  if (!financialContent) {
    return "";
  }

  const normalizedTitle = title.toLowerCase();

  if (isTamSamSomTitle(title)) {
    return "";
  }

  if (normalizedTitle.includes("swot")) {
    return "";
  }

  return removeDuplicatePdfExecutiveInsightText(
    normalizePdfTamSamSomOwnershipContent(financialContent, { title })
  );
}

function isTamSamSomTitle(title: string) {
  return /\btam\b[\s/|,·-]*\bsam\b[\s/|,·-]*\bsom\b/i.test(title);
}

function removeDuplicatePdfExecutiveInsightText(content: string) {
  const seenLines = new Set<string>();
  const seenSentences = new Set<string>();

  return normalizePdfText(content)
    .replace(
      /(^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:AI\s+)?Executive Insight(?:\*\*)?\s*[:\-–—]\s*/gi,
      "$1"
    )
    .replace(
      /\b([A-Z][A-Za-z /-]{1,40}\s*[:\-–—]\s*)((?:[€$₺]?\d+(?:[.,]\d+)*\s*[kKmMbBtT%]?)(?:\s+(?:months?|days?|ay|gün))?)\s+\2\b/gi,
      "$1$2"
    )
    .replace(/\b([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+\1\b/gi, "$1")
    .split("\n")
    .filter((line) => {
      const key = line.replace(/^[-*•]\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
      const sentenceKey = key.replace(/[.!?]+$/g, "");

      if (sentenceKey.length >= 32 && seenSentences.has(sentenceKey)) {
        return false;
      }

      if (key.length < 24 || !seenLines.has(key)) {
        if (key.length >= 24) {
          seenLines.add(key);
        }
        if (sentenceKey.length >= 32) {
          seenSentences.add(sentenceKey);
        }
        return true;
      }

      return false;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getPdfSectionDedupeKey(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey) {
    return fieldKey;
  }

  const titleKey = normalizePdfText(section.title).toLowerCase().replace(/\s+/g, " ").trim();

  if (isTamSamSomTitle(section.title)) {
    return "tam-sam-som";
  }

  return titleKey || normalizePdfText(section.content).toLowerCase().slice(0, 180);
}

function isLegacyTamSamSomSection(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
    return false;
  }

  const title = normalizePdfText(section.title).toLowerCase();
  const content = normalizePdfText(section.content);
  const explicitMetricLines = content
    .split("\n")
    .filter((line) => /^(?:[-*•]\s*)?(?:tam|sam|som)\s*[:\-–—]/i.test(line.trim())).length;

  return (
    /\bmarket\s+sizing\b|\bmarket\s+size\b|\btam\s*\/\s*sam\s*\/\s*som\b/i.test(title) ||
    explicitMetricLines >= 2
  );
}

function isTamSamSomDuplicateFragment(section: { field?: string; title: string; content: string }) {
  const fieldKey = section.field?.trim().toLowerCase();

  if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
    return false;
  }

  const title = normalizePdfText(section.title).toLowerCase().replace(/\s+/g, " ").trim();
  const content = normalizePdfText(section.content);
  const titleIsMetricFragment = /^(tam|sam|som)(?:\s+(?:analysis|overview|market|section))?$/i.test(title);
  const hasMetricLine = content
    .split("\n")
    .some((line) => /^(?:[-*•]\s*)?(?:tam|sam|som)\s*[:\-–—]/i.test(line.trim()));
  const isMarketSizingInsight =
    /\b(?:ai\s+)?executive insight\b/i.test(content) &&
    /\b(?:tam|sam|som|market sizing|market size)\b/i.test(`${title}\n${content}`);

  return titleIsMetricFragment || (hasMetricLine && isMarketSizingInsight);
}

function normalizeSavedPdfSectionsBeforeRender<T extends { field?: string; title: string; content: string }>(
  sections: T[]
) {
  const canonicalTamSamSomIndex = sections.findIndex((section) => isTamSamSomTitle(section.title));

  if (canonicalTamSamSomIndex === -1) {
    return sections;
  }

  let keptCanonicalTamSamSom = false;

  return sections.filter((section) => {
    const isCanonicalTamSamSom = isTamSamSomTitle(section.title);
    const normalizedTitle = normalizePdfText(section.title);
    const normalizedContent = normalizePdfText(section.content);
    const titleContainsMarketSizingTerm = /\b(?:tam|sam|som)\b/i.test(normalizedTitle);
    const contentContainsSizingMetric = /^(?:[-*•]\s*)?(?:tam|sam|som)\s*[:\-–—]/im.test(
      normalizedContent
    );
    const contentContainsSizingInsight =
      /\b(?:ai\s+)?executive insight\b/i.test(normalizedContent) &&
      /\b(?:tam|sam|som|market sizing|market size)\b/i.test(`${normalizedTitle}\n${normalizedContent}`);

    if (isCanonicalTamSamSom) {
      if (keptCanonicalTamSamSom) {
        return false;
      }

      keptCanonicalTamSamSom = true;
      return true;
    }

    return !(titleContainsMarketSizingTerm || contentContainsSizingMetric || contentContainsSizingInsight);
  });
}

function dedupePdfSections<T extends { field?: string; title: string; content: string }>(sections: T[]) {
  const seen = new Set<string>();
  const seenContent = new Set<string>();
  const hasCanonicalTamSamSom = sections.some(
    (section) => section.field?.trim().toLowerCase() === "tamsamsom"
  );
  let hasTamSamSom = false;

  return sections.filter((section) => {
    const fieldKey = section.field?.trim().toLowerCase();
    const isCanonicalTamSamSom = fieldKey === "tamsamsom";
    const isTamSamSomSection = isCanonicalTamSamSom || isTamSamSomTitle(section.title);

    if (hasCanonicalTamSamSom && isTamSamSomSection && !isCanonicalTamSamSom) {
      return false;
    }

    if (isTamSamSomSection) {
      if (hasTamSamSom) {
        return false;
      }

      hasTamSamSom = true;
    }

    if (hasTamSamSom && isTamSamSomDuplicateFragment(section)) {
      return false;
    }

    if (isLegacyTamSamSomSection(section)) {
      return false;
    }

    const key = getPdfSectionDedupeKey(section);
    const normalizedContent = normalizePdfTamSamSomOwnershipContent(section.content, section);
    const contentKey = removeDuplicatePdfExecutiveInsightText(normalizedContent)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 360);

    if (!key || seen.has(key) || (contentKey && seenContent.has(contentKey))) {
      return false;
    }

    seen.add(key);
    if (contentKey) {
      seenContent.add(contentKey);
    }
    return true;
  }).map((section) => {
    const fieldKey = section.field?.trim().toLowerCase();

    if (fieldKey === "tamsamsom" || isTamSamSomTitle(section.title)) {
      return {
        ...section,
        field: "tamSamSom",
        title: "TAM / SAM / SOM",
        content: normalizePdfCanonicalTamSamSomContent(section.content),
      };
    }

    return section;
  });
}

function mergePdfSourceSections<T extends { field?: string; title: string; content: string }>(sections: T[]) {
  const sourceSections = sections.filter(
    (section) => section.field === "sources" || section.field === "sourcesAssumptions" || isSourceSectionTitle(section.title)
  );
  const nonSourceSections = sections.filter(
    (section) => !sourceSections.includes(section)
  );
  const mergedSourceContent = sourceSections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");
  const normalizedSourceContent = normalizePdfSourceContent(mergedSourceContent);

  if (!normalizedSourceContent) {
    return nonSourceSections;
  }

  return [
    ...nonSourceSections,
    {
      ...sourceSections[0],
      field: "sources",
      title: "Sources",
      content: removeDuplicatePdfExecutiveInsightText(normalizedSourceContent),
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
      const normalizedSections = dedupeReportSections(
        normalizeSavedPdfSectionsBeforeRender(report.sections)
      );
      const basePdfSections = dedupeReportSections(
        dedupePdfSections(mergePdfSourceSections(normalizedSections))
      );
      const pdfLocale = detectPdfPresentationLocale(
        [report.title, report.type, report.prompt, ...basePdfSections.map((section) => `${section.title}\n${section.content}`)]
          .filter(Boolean)
          .join("\n\n")
      );
      const pdfSections = localizePdfReportSections(basePdfSections, pdfLocale);
      const localizedReportTitle = localizePdfPresentationLabel(report.title, pdfLocale);
      const businessIdea = deriveBusinessDescriptionFromSections(report, pdfSections);
      const fullReportContent = basePdfSections
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

      const drawFooter = (includePageCounter = false) => {
        const currentPage = pdf.getCurrentPageInfo().pageNumber;

        pdf.setFillColor("#000000");
        pdf.rect(0, pageHeight - 13, pageWidth, 13, "F");
        pdf.setDrawColor("#27272a");
        pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

        if (!includePageCounter) {
          return;
        }

        pdf.setFontSize(7);
        pdf.setTextColor("#71717a");
        pdf.text(
          pdfLocale === "tr"
            ? `Sayfa ${currentPage} / ${pdf.getNumberOfPages()}`
            : `Page ${currentPage} / ${pdf.getNumberOfPages()}`,
          pageWidth - margin - 22,
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

            const isBullet = /^[-*•]\s+/.test(line);
            const isSourceMetaLine = /^(?:Domain|Publisher|Year|Confidence|Type|URL)\s*:/i.test(line);
            const availableWidth = isBullet || isSourceMetaLine ? width - 4 : width;
            const wrapped = pdf.splitTextToSize(line, availableWidth) as string[];

            return wrapped.map((wrappedLine, index) => {
              if (isSourceMetaLine) {
                return `${index > 0 ? "    " : "  "}${wrappedLine}`;
              }

              return isBullet && index > 0 ? `  ${wrappedLine}` : wrappedLine;
            });
          }),
          isOrphanBulletText
        );

      const wrapPdfText = (text: string, width: number) =>
        pdf.splitTextToSize(normalizePdfText(text), width) as string[];

      const conciseCoverText = (text: string, maxLength = 94) => {
        const normalized = normalizePdfText(text)
          .replace(/^[-*•]\s+/, "")
          .replace(/^(strengths?|risks?|top\s+\d+\s+\w+)\s*[:\-–—]\s*/i, "")
          .trim();
        const firstThought = normalized
          .split(/\s+(?:because|due to|as a result|which means|therefore)\s+/i)[0]
          .split(/[.;]\s+/)[0]
          .trim();
        const candidate = firstThought || normalized;

        if (candidate.length <= maxLength) {
          return candidate;
        }

        const clipped = candidate.slice(0, maxLength + 1);
        const lastSpace = clipped.lastIndexOf(" ");

        return `${clipped.slice(0, Math.max(32, lastSpace)).trim()}…`;
      };

      const conciseFundingStage = (value: string) => {
        const normalized = normalizePdfText(value).trim();
        const stageMatch = normalized.match(
          /\b(pre[-\s]?seed|seed|series\s+[a-c]|growth|expansion|bootstrap(?:ped)?|mvp|pilot|validation|scale[-\s]?up|pre[-\s]?revenue)\b/i
        );

        if (stageMatch?.[0]) {
          return stageMatch[0].replace(/\s+/g, " ");
        }

        return conciseCoverText(normalized, 34)
          .split(/\s+/)
          .slice(0, 5)
          .join(" ");
      };

      const getExecutiveSummaryPreview = (content: string, decision: string) => {
        const cleaned = normalizePdfText(content)
          .split("\n")
          .map((line) =>
            line
              .replace(/^[-*•]\s+/, "")
              .replace(/^#{1,6}\s+/, "")
              .replace(/\*\*/g, "")
              .trim()
          )
          .filter((line) => line && !/^executive summary\b/i.test(line))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const sentences = cleaned
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim())
          .filter(Boolean);
        const decisionSentence =
          sentences.find((sentence) =>
            /\b(invest|recommend|go|wait|pass|validate|hold|risk|opportunity|priority)\b/i.test(sentence)
          ) ||
          sentences[0] ||
          `${formatDecisionLabel(decision)} pending the validation priorities detailed in the Executive Summary.`;

        return conciseCoverText(decisionSentence, 150);
      };

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
        const executiveSummaryContent =
          pdfSections.find((section) => section.title.toLowerCase().includes("executive summary"))
            ?.content || fullReportContent;
        const executiveSummaryPreview = getExecutiveSummaryPreview(
          executiveSummaryContent,
          recommendation
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
        pdf.text(localizePdfPresentationLabel("ZERINIX INVESTOR INTELLIGENCE", pdfLocale), margin + 31, 37);

        pdf.setFontSize(24);
        pdf.setTextColor("#ffffff");
        const coverTitle = pdf.splitTextToSize(normalizePdfText(localizedReportTitle), contentWidth - 24);
        pdf.text(coverTitle, margin + 12, 51, {
          lineHeightFactor: 1.08,
          maxWidth: contentWidth - 24,
        });

        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text(businessIdea, margin + 12, 78, {
          maxWidth: contentWidth - 24,
        });

        const previewY = 88;
        const previewLines = wrapPdfText(executiveSummaryPreview, contentWidth - 38).slice(0, 2);
        const previewHeight = Math.max(21, 13 + previewLines.length * 4.1);
        pdf.setFillColor("#030712");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(margin + 12, previewY, contentWidth - 24, previewHeight, 5, 5, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin + 12, previewY + 4, 1.2, previewHeight - 8, "F");
        pdf.setFontSize(6.8);
        pdf.setTextColor("#99f6e4");
        pdf.text(localizePdfPresentationLabel("EXECUTIVE SUMMARY PREVIEW", pdfLocale), margin + 18, previewY + 7.5);
        pdf.setFontSize(8.4);
        pdf.setTextColor("#e4e4e7");
        pdf.text(previewLines, margin + 18, previewY + 14.7, {
          lineHeightFactor: 1.16,
          maxWidth: contentWidth - 38,
        });

        const tagY = previewY + previewHeight + 5;
        drawTag("Investor Ready", margin + 12, tagY, 36);
        drawTag(localizePdfPresentationLabel(report.type, pdfLocale), margin + 52, tagY, 42);

        const scoreX = margin + 12;
        const scoreY = tagY + 16;
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
        pdf.text(localizePdfPresentationLabel("INVESTMENT SCORE", pdfLocale), scoreX + 12, scoreY + 43);

        pdf.setFillColor(recommendationFill);
        pdf.setDrawColor("#334155");
        pdf.roundedRect(scoreX + 66, scoreY, contentWidth - 102, 26, 5, 5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor(recommendationText);
        pdf.text(localizePdfPresentationLabel("RECOMMENDATION", pdfLocale), scoreX + 72, scoreY + 8);
        pdf.setFontSize(18);
        pdf.text(recommendation, scoreX + 72, scoreY + 20);

        const cardWidth = (contentWidth - 86) / 2;
        const kpis = [
          ["Confidence", confidence === null ? "—" : `${confidence}%`],
          ["Estimated Valuation", valuation || "From report model"],
          [localizePdfPresentationLabel("Funding Stage", pdfLocale), conciseFundingStage(fundingStage || report.type)],
          ["Status", report.status],
        ].map(([label, value]) => {
          const labelLines = wrapPdfText(label.toUpperCase(), cardWidth - 8).slice(0, 2);
          const valueLines = wrapPdfText(
            label === "Funding Stage" ? value : conciseCoverText(value, 46),
            cardWidth - 8
          ).slice(0, label === "Funding Stage" ? 1 : 2);
          const height = Math.max(18, 7 + labelLines.length * 3.1 + valueLines.length * 4.2);

          return { labelLines, valueLines, height };
        });
        const rowHeights = [0, 1].map((row) =>
          Math.max(kpis[row * 2]?.height ?? 18, kpis[row * 2 + 1]?.height ?? 18)
        );

        kpis.forEach(({ labelLines, valueLines }, index) => {
          const row = Math.floor(index / 2);
          const cardX = scoreX + 66 + (index % 2) * (cardWidth + 4);
          const cardY = scoreY + 32 + rowHeights.slice(0, row).reduce((sum, height) => sum + height + 4, 0);
          const cardHeight = rowHeights[row];
          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(cardX, cardY, cardWidth, cardHeight, 3, 3, "FD");
          pdf.setFontSize(7.5);
          pdf.setTextColor("#71717a");
          pdf.text(labelLines, cardX + 4, cardY + 5.2, {
            lineHeightFactor: 1.05,
            maxWidth: cardWidth - 8,
          });
          pdf.setFontSize(9.5);
          pdf.setTextColor("#f4f4f5");
          pdf.text(valueLines, cardX + 4, cardY + 7 + labelLines.length * 3.1, {
            lineHeightFactor: 1.08,
            maxWidth: cardWidth - 8,
          });
        });

        const getInsightPanelLayout = (items: string[], panelWidth: number) => {
          const lineBlocks = (items.length ? items : ["See detailed section analysis."])
            .slice(0, 3)
            .map((item) => wrapPdfText(conciseCoverText(item), panelWidth - 15).slice(0, 2));
          const height = Math.max(
            46,
            17 + lineBlocks.reduce((sum, lines) => sum + Math.max(4.2, lines.length * 3.55) + 2.4, 0)
          );

          return { lineBlocks, height };
        };

        const drawInsightPanel = (
          title: string,
          lineBlocks: string[][],
          x: number,
          panelY: number,
          panelWidth: number,
          panelHeight: number,
          accent: string
        ) => {
          pdf.setFillColor("#0a0a0a");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(x, panelY, panelWidth, panelHeight, 4, 4, "FD");
          pdf.setFillColor(accent);
          pdf.rect(x, panelY, 1.5, panelHeight, "F");
          pdf.setFontSize(8);
          pdf.setTextColor("#ccfbf1");
          pdf.text(title.toUpperCase(), x + 5, panelY + 7);
          pdf.setFontSize(6.6);
          pdf.setTextColor("#d4d4d8");
          let itemY = panelY + 16;
          lineBlocks.forEach((lines) => {
            pdf.setFillColor(accent);
            pdf.circle(x + 5, itemY - 1.3, 1, "F");
            pdf.text(lines, x + 9, itemY, {
              lineHeightFactor: 1.12,
              maxWidth: panelWidth - 14,
            });
            itemY += Math.max(4.2, lines.length * 3.55) + 2.4;
          });
        };

        const insightWidth = (contentWidth - 31) / 2;
        const strengthsLayout = getInsightPanelLayout(strengths, insightWidth);
        const risksLayout = getInsightPanelLayout(risks, insightWidth);
        const insightHeight = Math.max(strengthsLayout.height, risksLayout.height);
        const insightY = scoreY + 72;
        drawInsightPanel(
          localizePdfPresentationLabel("Top 3 Strengths", pdfLocale),
          strengthsLayout.lineBlocks,
          margin + 12,
          insightY,
          insightWidth,
          insightHeight,
          "#14b8a6"
        );
        drawInsightPanel(
          "Top 3 Risks",
          risksLayout.lineBlocks,
          margin + 21 + insightWidth,
          insightY,
          insightWidth,
          insightHeight,
          "#f97316"
        );

        const nextActionY = insightY + insightHeight + 9;
        const nextActionLines = wrapPdfText(nextAction, contentWidth - 36).slice(0, 2);
        const nextActionHeight = Math.max(21, 14 + nextActionLines.length * 4.1);
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(margin + 12, nextActionY, contentWidth - 24, nextActionHeight, 5, 5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor("#99f6e4");
        pdf.text(localizePdfPresentationLabel("NEXT CRITICAL ACTION", pdfLocale), margin + 18, nextActionY + 8);
        pdf.setFontSize(9);
        pdf.setTextColor("#f8fafc");
        pdf.text(nextActionLines, margin + 18, nextActionY + 16, {
          lineHeightFactor: 1.12,
          maxWidth: contentWidth - 36,
        });

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
      pdf.text(localizePdfPresentationLabel("ZERINIX REPORT", pdfLocale), margin + 14, y);

      pdf.setFontSize(21);
      pdf.setTextColor("#ffffff");
      const titleLines = pdf.splitTextToSize(normalizePdfText(localizedReportTitle), contentWidth - 38);
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

      const meta = `${localizePdfPresentationLabel(report.type, pdfLocale)} - ${
        report.createdAt
          ? new Date(report.createdAt).toLocaleDateString("en-US")
          : "No date"
      }`;
      pdf.setFontSize(8.5);
      pdf.setTextColor("#a1a1aa");
      pdf.text(meta, margin, y, { maxWidth: contentWidth });
      y += 9;

      const summaryCards = [
        `${pdfSections.length} Sections`,
        report.type,
        "Investor Ready",
      ].map((label) => wrapPdfText(label, (contentWidth - 8) / 3 - 8).slice(0, 2));
      const summaryCardHeight = Math.max(
        12,
        6 + Math.max(...summaryCards.map((lines) => lines.length)) * 3.9
      );

      summaryCards.forEach((lines, index) => {
        const cardWidth = (contentWidth - 8) / 3;
        const cardX = margin + index * (cardWidth + 4);

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(cardX, y, cardWidth, summaryCardHeight, 3, 3, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor(index === 2 ? "#ccfbf1" : "#a1a1aa");
        pdf.text(lines, cardX + 4, y + 6.4, {
          lineHeightFactor: 1.06,
          maxWidth: cardWidth - 8,
        });
      });

      y += summaryCardHeight + 6;

      const getTamRows = (content: string) =>
        ([
          ["TAM", "#134e4a"],
          ["SAM", "#115e59"],
          ["SOM", "#5eead4"],
        ] as const).map(([label, color]) => {
          const value = extractMarketSizeVisualValue(content, label);
          const rowHeight = 15;

          return { label, color, value, rowHeight };
        });

      const getTamVisualHeight = (content: string) =>
        getTamRows(content).reduce((height, row, index) => {
          return height + row.rowHeight + (index === 0 ? 0 : 3);
        }, 0);

      const getTamVisualContent = (content: string) =>
        (["TAM", "SAM", "SOM"] as const)
          .map((label) => {
            const value = extractMarketSizeVisualValue(content, label);

            return value ? `${label}: ${value}` : "";
          })
          .filter(Boolean)
          .join("\n");

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
        const items = labels
          .map((item) => {
            const value = formatMetricCardValue(extractMetricValueFromAliases(metricContent, item.aliases));
            const compactValue = compactPdfMetricValue(value);
            const labelLines = wrapPdfText(item.label, itemWidth - 4).slice(0, 2);
            const description = extractShortDescription(metricContent, item.aliases);
            const descriptionLines = description
              ? (pdf.splitTextToSize(`${item.label}: ${description}`, width - 6) as string[])
              : [];
            const cardHeight = Math.max(21, 8 + labelLines.length * 3.3 + 8.2);

            return {
              label: item.label,
              aliases: item.aliases,
              value,
              compactValue,
              labelLines,
              descriptionLines,
              height: cardHeight,
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
          const tamVisualContent = getTamVisualContent(content);
          const rows = getTamRows(tamVisualContent);
          let rowY = visualY;

          rows.forEach(({ label, color, value, rowHeight }, index) => {
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
            rowY += rowHeight + 3;
          });
          return getTamVisualHeight(tamVisualContent);
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
            const score = extractScore(content, label);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 12, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(score === null ? "—" : String(score), x + 4.2, itemY + 7.8);
            pdf.setFontSize(6.5);
            pdf.setTextColor("#e4e4e7");
            pdf.text(label, x + 14, itemY + 5, { maxWidth: itemWidth - 17 });
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel("Score", pdfLocale), x + 14, itemY + 8.8);
          });

          return 31;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          const selected = detectRecommendation(content) || "REVIEW";
          const decisionLabel = formatDecisionLabel(selected);
          const confidence =
            extractConfidence(content) ??
            extractConfidence(fullReportContent) ??
            extractScore(fullReportContent, "Investment Score");
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
          pdf.text(localizePdfPresentationLabel("RECOMMENDATION", pdfLocale), bodyX + 5, visualY + 6);
          pdf.setFontSize(13);
          pdf.setTextColor("#000000");
          drawSingleLine(decisionLabel, bodyX + 5, visualY + 16, 42, 11, 6.5);

          pdf.setFillColor("#27272a");
          pdf.roundedRect(bodyX, visualY + 31, 52, 4, 2, 2, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            bodyX,
            visualY + 31,
            (52 * (confidence ?? 0)) / 100,
            4,
            2,
            2,
            "F"
          );

          const recItems = [
            ["Confidence", confidence === null ? "—" : `${confidence}%`],
            ["Investment Recommendation", investmentRecommendation || "—"],
            ["Main Risk", mainRisk || extractKeywordInsight(fullReportContent, ["risk", "threat"]) || "Primary risk is detailed in the risk analysis"],
            ["Next Action", nextAction || extractKeywordInsight(fullReportContent, ["next action", "critical action", "validate"]) || "Validate the primary investment thesis"],
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

        if (normalizedTitle.includes("competitor")) {
          const rows = extractCompetitorRows(content);
          const columns = [
            { label: localizePdfPresentationLabel("Company", pdfLocale), width: bodyWidth * 0.19 },
            { label: localizePdfPresentationLabel("Positioning", pdfLocale), width: bodyWidth * 0.27 },
            { label: localizePdfPresentationLabel("Strengths", pdfLocale), width: bodyWidth * 0.2 },
            { label: localizePdfPresentationLabel("Weaknesses", pdfLocale), width: bodyWidth * 0.2 },
            { label: localizePdfPresentationLabel("Threat", pdfLocale), width: bodyWidth * 0.14 },
          ];
          const headerHeight = 8;
          const rowHeight = 15;
          let x = bodyX;

          pdf.setFillColor("#101113");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(bodyX, visualY, bodyWidth, headerHeight + Math.max(1, rows.length) * rowHeight, 3, 3, "FD");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#5eead4");
          columns.forEach((column) => {
            pdf.text(column.label.toUpperCase(), x + 2, visualY + 5.2, { maxWidth: column.width - 4 });
            x += column.width;
          });

          if (rows.length === 0) {
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(localizePdfPresentationText("VALIDATION REQUIRED: competitor records were not structured enough for table rendering.", pdfLocale), bodyX + 3, visualY + 14, {
              maxWidth: bodyWidth - 6,
            });
            return headerHeight + rowHeight + 4;
          }

          rows.forEach((row, rowIndex) => {
            const rowY = visualY + headerHeight + rowIndex * rowHeight;
            const values = [row.company, row.positioning, row.strengths, row.weaknesses, row.threat];
            let cellX = bodyX;

            pdf.setDrawColor("#27272a");
            pdf.line(bodyX, rowY, bodyX + bodyWidth, rowY);
            values.forEach((value, cellIndex) => {
              const width = columns[cellIndex]?.width ?? 20;
              pdf.setFontSize(cellIndex === 0 ? 6.3 : 5.5);
              pdf.setTextColor(cellIndex === 0 ? "#f4f4f5" : "#d4d4d8");
              pdf.text(wrapPdfText(value || "Validation required", width - 4).slice(0, 2), cellX + 2, rowY + 4.7, {
                lineHeightFactor: 1.1,
                maxWidth: width - 4,
              });
              cellX += width;
            });
          });

          return headerHeight + Math.max(1, rows.length) * rowHeight + 4;
        }

        if (normalizedTitle.includes("roadmap")) {
          const stepWidth = (bodyWidth - 10) / 6;
          founderRoadmapSteps.forEach((step, index) => {
            const x = bodyX + index * (stepWidth + 2);
            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, stepWidth, 28, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(step, x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
            pdf.setFontSize(5.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(wrapPdfText(extractRoadmapAction(content, step), stepWidth - 4).slice(0, 4), x + 2, visualY + 11, {
              lineHeightFactor: 1.1,
              maxWidth: stepWidth - 4,
            });
          });
          return 31;
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
                  ? ["Acquisition", "Activation", "Retention", "Revenue", "CAC", "WTP", "Sales cycle", "Conversion"]
                  : normalizedTitle.includes("risk")
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : normalizedTitle.includes("unit economics")
                      ? ["ARPA", "CAC", "LTV", "Payback", "Gross Margin"]
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
              : isKpiDashboard ? 28 : isScenario ? 20 : isUnitEconomics ? 19 : 10;
            const itemY = isFinancialDashboard && financialLayout
              ? visualY + priorRowHeight + rowIndex * 3
              : visualY + rowIndex * (itemHeight + 3);
            const score = extractScore(metricContent, label);
            const value = typeof item !== "string" && "value" in item
              ? item.value
              : formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
            const compactValue = compactPdfMetricValue(value);
            const labelLines =
              typeof item !== "string" && "labelLines" in item
                ? item.labelLines
                : wrapPdfText(label, itemWidth - 4).slice(0, 2);
            const labelBottomY = itemY + 3.2 + Math.max(0, labelLines.length - 1) * 3.2;
            const primaryValueY = labelBottomY + 5.4;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(labelLines, x + 2, itemY + 3.2, {
              lineHeightFactor: 1.05,
              maxWidth: itemWidth - 4,
            });
            if (isFinancialDashboard && value) {
              pdf.setTextColor("#f4f4f5");
              drawSingleLine(compactValue || "—", x + 2, primaryValueY, itemWidth - 4, 8.8, 4.2, false);
              return;
            }
            if (isUnitEconomics) {
              drawSingleLine(compactValue || "—", x + 2, primaryValueY, itemWidth - 4, 7.2, 4.2, false);
              return;
            }
            if (isKpiDashboard) {
              const kpiValue = extractKpiValue(content, label) || (score === null ? "—" : `${score}%`);
              const target = extractKpiTarget(content, label);
              const status = extractKpiStatus(content, label);
              pdf.setTextColor("#f4f4f5");
              drawSingleLine(kpiValue, x + 2, primaryValueY, itemWidth - 4, 7.5, 4.2, false);
              pdf.setFontSize(5.3);
              pdf.setTextColor("#a1a1aa");
              pdf.text(`Target: ${target || kpiValue || "—"}`, x + 2, primaryValueY + 3.7, { maxWidth: itemWidth - 4 });
              pdf.text(`Status: ${status}`, x + 2, primaryValueY + 7.1, { maxWidth: itemWidth - 4 });
              pdf.setFillColor("#27272a");
              pdf.roundedRect(x + 2, itemY + itemHeight - 4.2, itemWidth - 4, 1.5, 0.7, 0.7, "F");
              pdf.setFillColor("#5eead4");
              pdf.roundedRect(x + 2, itemY + itemHeight - 4.2, Math.max(0, ((itemWidth - 4) * (score ?? 0)) / 100), 1.5, 0.7, 0.7, "F");
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
              pdf.roundedRect(x + 2, itemY + 15, Math.max(3, ((itemWidth - 4) * ([42, 66, 84][index] ?? score ?? 0)) / 100), 1.4, 0.7, 0.7, "F");
              return;
            }
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 7, itemWidth - 4, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(
              x + 2,
              itemY + 7,
              Math.max(0, ((itemWidth - 4) * (score ?? 0)) / 100),
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
              pdf.text(localizePdfPresentationLabel("METRIC DETAILS", pdfLocale), bodyX + 3, detailsY);
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
            return 62;
          }

          if (isScenario) {
            return 26;
          }

          if (isUnitEconomics) {
            return 23;
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
          return getTamVisualHeight(getTamVisualContent(section.content));
        }

        if (normalizedTitle.includes("scenario")) {
          return 26;
        }

        if (normalizedTitle.includes("competitor")) {
          const rows = extractCompetitorRows(section.content);
          return 8 + Math.max(1, rows.length) * 15 + 4;
        }

        if (normalizedTitle.includes("roadmap")) {
          return 31;
        }

        if (normalizedTitle.includes("kpi")) {
          return 62;
        }

        if (normalizedTitle.includes("unit economics")) {
          return 23;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          return 48;
        }

        return /founder score|scenario|roadmap|competitor|porter|kpi|risk|unit economics/i.test(section.title)
          ? 22
          : 0;
      };

      const drawTableOfContents = () => {
        paintPage();
        drawLogoMark(margin, 24, 13);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text(localizePdfPresentationLabel("ZERINIX REPORT", pdfLocale), margin + 17, 33);
        pdf.setFontSize(26);
        pdf.setTextColor("#ffffff");
        pdf.text(localizePdfPresentationLabel("Table of Contents", pdfLocale), margin, 54);
        pdf.setFontSize(8.5);
        pdf.setTextColor("#a1a1aa");
        pdf.text(localizePdfPresentationText("Click a section title to jump directly to that page.", pdfLocale), margin, 64);

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

      pdfSections.forEach((section) => {
        const visualHeight = getVisualHeight(section);
        const isTamSamSomPdfSection = section.field === "tamSamSom" || isTamSamSomTitle(section.title);
        const sectionBodyContent =
          isTamSamSomPdfSection
            ? normalizePdfTamSamSomBodyContent(section.content)
            : isSourceSectionTitle(section.title)
              ? formatPdfCitationContent(section.content)
              : removeDuplicateVisualText(section.title, section.content);
        const bodyLines = splitPdfReadableLines(sectionBodyContent, bodyWidth);
        const hasBodyText = sectionBodyContent.trim().length > 0;

        if (isSourceSectionTitle(section.title) && !hasBodyText) {
          return;
        }

        if (isTamSamSomPdfSection) {
          const cardHeight = Math.max(31, cardHeaderHeight + visualHeight + cardBottomPadding);
          ensureSpace(cardHeight);
          tocEntries.push({
            title: section.title,
            page: pdf.getCurrentPageInfo().pageNumber,
          });

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
          pdf.text(section.title, bodyX, y + 12.5, {
            maxWidth: bodyWidth,
          });

          drawSectionVisual(section.title, section.content, y);
          y += cardHeight + 4;

          if (hasBodyText) {
            let bodyLineIndex = 0;

            while (bodyLineIndex < bodyLines.length) {
              const availableHeight = pageHeight - margin - y;
              const maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
              const lines = bodyLines.slice(bodyLineIndex, bodyLineIndex + maxLines);
              const textHeight = lines.length * bodyLineHeight + 4;

              ensureSpace(textHeight);
              pdf.setFontSize(8.8);
              pdf.setTextColor("#d4d4d8");
              pdf.text(lines, bodyX, y + 4, {
                lineHeightFactor: 1.3,
                maxWidth: bodyWidth,
              });

              bodyLineIndex += lines.length;
              y += textHeight + 5;
            }
          }

          return;
        }

        const safeBodyLines = bodyLines.length > 0 ? bodyLines : [""];
        const isExecutiveSummarySection = section.title.toLowerCase().includes("executive summary");
        const sectionBodyLineHeight = isExecutiveSummarySection ? 5.75 : bodyLineHeight;
        let lineIndex = 0;

        while (lineIndex < safeBodyLines.length) {
          const activeVisualHeight = lineIndex === 0 ? visualHeight : 0;
          const bodyTextHeight = hasBodyText ? sectionBodyLineHeight : 0;
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
          const maxLines = Math.max(1, Math.floor(availableHeight / sectionBodyLineHeight));
          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight +
              activeVisualHeight +
              (hasBodyText ? lines.length * sectionBodyLineHeight : 0) +
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
          const sectionTitle = isContinued && isSourceSectionTitle(section.title)
            ? ""
            : `${section.title}${isContinued ? pdfLocale === "tr" ? " devamı" : " continued" : ""}`;

          if (sectionTitle) {
            pdf.text(sectionTitle, bodyX, y + 12.5, {
              maxWidth: bodyWidth,
            });
          }

          const drawnVisualHeight =
            activeVisualHeight > 0 && !isContinued && !isTamSamSomPdfSection
              ? drawSectionVisual(section.title, section.content, y)
              : 0;

          if (hasBodyText) {
            pdf.setFontSize(isExecutiveSummarySection ? 9.2 : 8.8);
            pdf.setTextColor("#d4d4d8");
            pdf.text(lines, bodyX, y + 24 + drawnVisualHeight, {
              lineHeightFactor: isExecutiveSummarySection ? 1.38 : 1.3,
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
        drawFooter(true);
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
        className="group inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-teal-100/50 bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-teal-950/30 ring-1 ring-white/20 transition duration-300 hover:-translate-y-0.5 hover:bg-teal-200 hover:shadow-2xl hover:shadow-teal-950/40 focus:outline-none focus:ring-2 focus:ring-teal-200/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        <Download className="h-4 w-4 text-black transition group-hover:-translate-y-0.5" />
        {exporting ? "Preparing PDF..." : "Download PDF"}
      </button>
      {error ? (
        <p className="mt-3 max-w-xs text-sm leading-6 text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
