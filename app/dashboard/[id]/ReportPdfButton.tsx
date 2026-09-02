"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { DashboardReport } from "../report-utils";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";
import {
  applyPdfFont,
  createPdfDocument,
  drawPdfFooter,
  drawPdfLogoMark,
  getPdfPageMetrics,
  paintPdfPageBackground,
  type PdfDocument,
  type PdfLocale,
} from "@/app/lib/pdf-engine/core";
import {
  createRealEstateReportPdf,
  isRealEstateDashboardReport,
} from "@/app/lib/pdf-engine/real-estate-report";
import { drawPdfSectionCardFrame } from "@/app/lib/pdf-engine/section-renderer";
import {
  splitPdfReadableLines as splitPdfReadableLinesWithEngine,
  wrapPdfText as wrapPdfTextWithEngine,
} from "@/app/lib/pdf-engine/utils";
import {
  buildExecutiveSnapshot,
  compactExecutiveDecisionMemoSections,
  extractMarketSizingLayerValue,
  extractRecommendationItems,
  extractRecommendationSignals,
  getReportQualityBreakdown,
  getSectionTakeaway,
  normalizeFounderReadinessScoreText,
  parseMarketSizingMagnitude,
  readFounderReadinessMetricValue,
  readFounderReadinessScoreValue,
  resolveMarketSizingCascade,
  resolveCagrHeadlinePresentation,
  stripLeadingTakeawaySentence,
} from "@/app/lib/report-presentation";
import {
  cleanPdfLegacyValidationIntelligenceContent,
  resolvePdfPresentationLocale,
  extractPdfValidationIntelligenceSection,
  insertPdfBenchmarkIntelligenceSection,
  localizePdfPresentationLabel,
  localizePdfPresentationText,
  localizePdfReportSections,
  normalizePdfCanonicalTamSamSomContent,
  normalizePdfFinancialSectionContent,
  normalizePdfTamSamSomOwnershipContent,
  normalizePdfText,
  normalizePdfSourceContent,
  normalizePdfSourceDomain,
  repairPdfLineFragments,
} from "@/app/lib/pdf-normalization.mjs";
import {
  sourceTypeToEvidenceLevel,
} from "@/app/lib/report-evidence";
import {
  buildLegalReportSections,
  formatLegalSourceContent,
  isLegalRenderableReport,
} from "@/app/lib/report-engine/legal-report-rendering";
import {
  readExecutiveDecisionIntelligenceSummary,
  type ExecutiveDecisionIntelligenceSummary,
} from "@/app/lib/report-engine/executive-decision-intelligence-presentation";
import {
  isUniversalCustomerFacingSection,
  stripReportPresentationArtifacts,
  sanitizeMarketIntelligencePresentationText,
} from "@/app/lib/report-engine/report-presentation-sanitizer";
import {
  extractExecutiveDecisionFromText,
  localizedLabelVariants,
} from "@/app/lib/report-engine/executive-decision-brief";
import {
  readMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
  constrainMarketSizingResolutionToCanonicalState,
} from "@/app/lib/report-engine/market-intelligence-canonical-state";
import {
  resolveMarketIntelligenceDecisionChangeState,
  buildMarketIntelligenceGapDrivenActions,
  resolveMarketIntelligenceDecisionThresholdState,
  classifyStrategicRecommendationValidation,
  localizeRecommendationProvenance,
} from "@/app/lib/report-engine/market-intelligence-evidence-gaps";
import {
  repairReportLanguageSections,
  resolveMarketPdfLanguage,
  resolveReportLanguage,
  validateReportLanguageConsistency,
} from "@/app/lib/report-language";

type PdfReportSection = DashboardReport["sections"][number];

let pdfFontPromise: Promise<string> | null = null;

function isFailedReport(report: DashboardReport) {
  return (
    report.status.toLowerCase() !== "completed" ||
    report.sections.length === 0
  );
}

function isMarketIntelligenceDashboardReport(report: DashboardReport) {
  return report.type === "Market Analysis";
}

const pdfLocaleToBcp47: Record<PdfLocale, string> = {
  en: "en-US",
  tr: "tr-TR",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
};

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
  // In-text [R#] citation tag(s) this source resolves, e.g. "[R3][R12]"
  // when two evidence IDs pointing at the same document were merged into
  // one entry. Only ever populated by the Market Intelligence
  // deterministic bibliography (buildMarketIntelligenceBibliography);
  // other report types never emit a "Reference:" line, so this stays
  // undefined for them exactly as before.
  referenceTag?: string;
  // Access date, distinct from publicationYear (when the source's own
  // content was published vs. when it was retrieved/verified).
  accessDate?: string;
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
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));

  if (level === "verified") return "Verified Source";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";

  // Genuinely unclassified: omit the field rather than print the internal
  // "Validation Required" tag -- same "omit, don't fabricate" convention
  // already used for publisher/year/URL/accessed date below.
  return "";
}

function getPdfCitationTrustLabel(citation: CitationData) {
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));

  if (level === "verified") return "Verified";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";

  return "";
}

function dedupePdfCitations(citations: CitationData[]) {
  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const normalizedUrl = normalizeCitationUrl(citation.url);
    const domain = getCitationDomain(normalizedUrl, citation.organization);
    const urlKey = `url:${normalizedUrl}`;
    const publisherKey = normalizeCitationKey(citation.organization);
    const sourceNameKey = normalizeCitationKey(getCitationSourceName(citation));
    const key = [
      normalizedUrl ? urlKey : "",
      domain || "no-domain",
      publisherKey || "unknown-publisher",
      sourceNameKey || "unknown-source",
    ].join("|");
    const existing = unique.get(key);
    const mergedReferenceTag =
      existing?.referenceTag && citation.referenceTag && existing.referenceTag !== citation.referenceTag
        ? `${existing.referenceTag}${citation.referenceTag}`
        : citation.referenceTag || existing?.referenceTag;

    unique.set(key, {
      ...existing,
      ...citation,
      url: normalizedUrl || existing?.url || "",
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
      ...(mergedReferenceTag ? { referenceTag: mergedReferenceTag } : {}),
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
      publisher: string;
      publicationYear: string;
      url: string;
      referenceTag: string;
      accessDate: string;
    }
  >();

  dedupePdfCitations(citations).forEach((citation) => {
    const hasUsableEvidence =
      Boolean(citation.url) ||
      isPlausibleCitationField(citation.organization) ||
      isPlausibleCitationField(citation.sourceTitle, 4);
    if (!hasUsableEvidence) {
      return;
    }

    const domain = getCitationDomain(citation.url, citation.organization);
    const domainNameKey = normalizeCitationKey(domain.split(".")[0] || "");
    const sourceName = getCitationSourceName(citation);
    const sourceNameKey = normalizeCitationKey(sourceName);
    const rawPublisherKey = normalizeCitationKey(citation.organization);
    const publisherKey =
      domainNameKey &&
      (!rawPublisherKey ||
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

    const existing = unique.get(key) || unique.get(fallbackDisplayKey);
    if (existing) {
      // Same displayed source cited under a second reference tag (e.g. a
      // duplicate URL the server-side bibliography didn't already merge,
      // or a report type whose citations aren't pre-merged) -- append the
      // tag instead of silently dropping it, so every [R#] that resolves
      // to this entry stays visible.
      if (citation.referenceTag && !existing.referenceTag.includes(citation.referenceTag)) {
        existing.referenceTag = `${existing.referenceTag}${citation.referenceTag}`;
      }
      return;
    }

    // Empty string, not a placeholder phrase like "Publisher not
    // specified" -- the renderer omits the line entirely when metadata
    // is unavailable instead of printing a broken-looking field.
    const entry = {
      sourceName,
      sourceType: getPdfCitationSourceTypeLabel(citation),
      trustLabel: getPdfCitationTrustLabel(citation),
      publisher: isPlausibleCitationField(citation.organization || "") ? citation.organization! : "",
      publicationYear: citation.publicationYear || "",
      url: normalizeCitationUrl(citation.url),
      referenceTag: citation.referenceTag || "",
      accessDate: isPlausibleCitationField(citation.accessDate || "") ? citation.accessDate! : "",
    };
    unique.set(key, entry);
    unique.set(fallbackDisplayKey, entry);
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

// Confirmed live: raw prompt text like "i want to build an AML/Fraud
// compliance platform..." was displayed verbatim as the report's business
// description, reading as a leftover chat instruction rather than a
// professional one-line summary. Stripping this filler opening reframes it
// as a plain noun phrase ("An AML/Fraud compliance platform...") -- the
// original meaning is unchanged, only the framing.
const leadingWantToPhrase =
  /^i\s+(?:want|would like|plan|am planning|need)\s+to\s+(?:build|create|start|launch|develop)\s+/i;

function sentenceCaseFirstLetter(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function getBusinessIdeaFromPrompt(value: string) {
  let cleaned = normalizePdfText(value)
    .replace(/^[-*•]\s*/, "")
    .replace(/\?+$/g, "")
    .trim();

  cleaned = sentenceCaseFirstLetter(cleaned.replace(leadingWantToPhrase, ""));

  if (!cleaned || looksLikePromptOrInstruction(cleaned)) {
    return "";
  }

  if (/\b(who is|what is|why|how|would|should|can you|tell me|analyze|compare)\b/i.test(cleaned)) {
    return "";
  }

  if (cleaned.length <= 180) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, 180).replace(/\s+\S*$/, "");

  return `${truncated || cleaned.slice(0, 180)}…`;
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

// Stray metadata-line values that survive `metadataMatch` but carry no
// real citation evidence (e.g. a leaked "Publisher: user" line) --
// too short/generic to be an actual publisher or title.
const STRAY_CITATION_FIELD_VALUES =
  /^(?:user|assistant|system|yes|no|n\/a|na|none|unknown|null|undefined)$/i;

// Confirmed live: a Sources page entry titled "FPDS (U.S." -- an opening
// paren with no matching close, and ending on an abbreviation dot rather
// than a real word -- reads as a genuinely truncated title, not a short
// but complete one. A real title/publisher never has more open than
// closed parens, and never ends mid-abbreviation on a bare single
// uppercase letter followed by a period (an initial that was clearly cut
// off before the next word). Catching this shape here (shared by both
// the title and organization/publisher checks) means a broken entry like
// this is excluded from the Sources page entirely rather than displayed
// with a dangling, unfinished-looking name.
function looksTruncated(value: string) {
  const openParens = (value.match(/\(/g) || []).length;
  const closeParens = (value.match(/\)/g) || []).length;
  if (openParens > closeParens) return true;
  return /\b[A-Z]\.\s*$/.test(value.trim());
}

function isPlausibleCitationField(value = "", minLength = 3) {
  const trimmed = value.trim();
  return (
    trimmed.length >= minLength &&
    !STRAY_CITATION_FIELD_VALUES.test(trimmed) &&
    !looksTruncated(trimmed)
  );
}

// parseCitations's "ORG — TITLE" shape below exists to catch the model's
// own citation prose (e.g. "TechCrunch — Series B funding announcement"),
// but the same em-dash/hyphen shape also appears in ordinary rhetorical
// prose ("The deciding factor -- X -- outweighs the risks..."). Confirmed
// live: the deterministic closing verdict paragraph appended to the
// Sources field (never meant to be parsed as a citation, only positioned
// there so it renders on the report's final page) matched this same
// pattern and was rendered as a fabricated source with "The deciding
// factor" as its publisher/organization. A real publisher/organization
// name is short and does not contain sentence structure -- this rejects
// anything that reads as prose instead of enumerating every phrase that
// could precede a dash in generated text.
const organizationVerbPattern = /\b(?:is|are|was|were|outweighs|confidence)\b/i;
function looksLikeOrganizationName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (trimmed.split(/\s+/).length > 7) return false;
  if (/[.!?]/.test(trimmed)) return false;
  if (organizationVerbPattern.test(trimmed)) return false;
  return true;
}

// Same class of guard as looksLikeOrganizationName above, applied to the
// explicit "Title:"/"Publisher:"/"Source type:" metadata-line parsing path
// below, which previously captured whatever text followed the label with
// no shape validation at all. Confirmed live: a Sources block rendered
// "Publisher: The opportunity is real, but the gap ..." as a fabricated
// source's publisher because a malformed model line put narrative prose
// (an evidence-gap explanation) directly after a "Publisher:" label, and
// this path accepted it unconditionally. A real title is allowed to be
// longer than a real organization name, so this takes a word-count ceiling
// rather than reusing looksLikeOrganizationName's tighter one, but the
// same sentence-shape rejections (terminal punctuation, narrative verbs)
// apply either way.
function looksLikeCitationMetadataValue(value: string, maxWords = 18): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 140) return false;
  if (trimmed.split(/\s+/).length > maxWords) return false;
  // Confirmed live: a real title continuation ("Contractors Spent $4.2B
  // on Software in 2025 · Clockwork") was rejected here because "$4.2B"
  // contains a literal period as a decimal point, not a sentence-ending
  // one -- indistinguishable from real prose punctuation by a bare
  // /[.!?]/ test. Stripping digit.digit sequences first (a decimal
  // point can never itself end a sentence) before checking for genuine
  // terminal punctuation keeps this guard's real purpose (reject
  // full-sentence prose) without misfiring on a dollar figure, version
  // number, or percentage.
  if (/[.!?]/.test(trimmed.replace(/\d\.\d/g, "0"))) return false;
  if (organizationVerbPattern.test(trimmed)) return false;
  return true;
}

// market-analysis/route.ts appends buildMarketFinalVerdictParagraph's
// closing narrative ("Final Investment Decision" / "The verdict is GO at
// 66% confidence. The deciding factor -- '...' -- outweighs the identified
// risks...") to the Sources field after the real bibliography, since
// mergePdfSourceSections always forces Sources to the report's final page.
// Confirmed live: parseCitations' last-resort "Organization — Title (Year)"
// fallback pattern below matches that paragraph's own "X -- Y -- Z" dash
// structure and mints a fabricated source entry -- Publisher: "The
// deciding factor", Confidence: "Validation Required" -- exactly the
// generated-prose-as-source failure mode this file's own citation guards
// exist to prevent, just reached through a path (a narrative paragraph,
// not a malformed citation line) those guards were never meant to see in
// the first place. This is deterministic, not occasional: every GO-decision
// Market Intelligence report appends this exact paragraph shape. Cut it
// off before citation parsing ever sees it, in every language the
// paragraph is written in.
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
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i)?.[1] || ""
  );
  const entries: CitationData[] = [];
  let current: Partial<CitationData> = {};
  // Tracks which field a continuation line (see below) should extend --
  // the field most recently set by a real Title:/Source:/Publisher:/
  // Organization: line, cleared once a later field (Year:/URL:/...) is
  // reached so a stray fragment after that point is never misattributed.
  let lastContinuableField: "sourceTitle" | "organization" | null = null;
  const flushCurrent = () => {
    const hasUsableEvidence =
      Boolean(current.url) ||
      isPlausibleCitationField(current.organization || "") ||
      isPlausibleCitationField(current.sourceTitle || "", 4);
    if (hasUsableEvidence) {
      entries.push({
        sourceTitle: current.sourceTitle || current.organization || "Untitled source",
        organization: isPlausibleCitationField(current.organization || "") ? current.organization! : "",
        ...(current.publicationYear ? { publicationYear: current.publicationYear } : {}),
        ...(current.confidence || fallbackConfidence
          ? { confidence: current.confidence || fallbackConfidence }
          : {}),
        ...(current.url ? { url: current.url } : {}),
        ...(current.sourceType ? { sourceType: current.sourceType } : { sourceType: "Verified source" }),
        ...(current.referenceTag ? { referenceTag: current.referenceTag } : {}),
        ...(current.accessDate ? { accessDate: current.accessDate } : {}),
      });
    }
    current = {};
    lastContinuableField = null;
  };

  content
    .split("\n")
    .forEach((rawLine) => {
      const url = normalizeCitationUrl(
        rawLine.match(/\]\((https?:\/\/[^)]+)\)/i)?.[1]?.trim() ||
          rawLine.match(/\bhttps?:\/\/[^\s)]+/i)?.[0]?.trim() ||
          ""
      );
      // Kept separate from `strippedLine` below: a dedicated "URL: https://..."
      // line has nothing left after stripping its own value, which made
      // metadataMatch fail to even recognize it as a "url" field and silently
      // drop every citation's URL. Only strip inline URLs from the OTHER
      // metadata fields' cosmetic display text (e.g. a title that trails off
      // into a raw link), never from the line used to detect the field itself.
      const line = rawLine
        .replace(/^[-*•]\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
        .trim();
      const strippedLine = line.replace(/\bhttps?:\/\/[^\s)]+/gi, "").trim();

      if (!line) {
        return;
      }

      const metadataMatch = line.match(
        /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type|reference|accessed|access date)\s*[:\-–—]\s*(.+)$/i
      );
      if (metadataMatch) {
        const key = metadataMatch[1].toLowerCase();
        const rawValue = metadataMatch[2].trim();
        const value = key === "url" ? rawValue : rawValue.replace(/\bhttps?:\/\/[^\s)]+/gi, "").trim();

        if ((key === "title" || key === "source") && current.sourceTitle) {
          flushCurrent();
        }

        if (key === "title" || key === "source") {
          lastContinuableField = null;
          if (looksLikeCitationMetadataValue(value, 24)) {
            current.sourceTitle = value;
            lastContinuableField = "sourceTitle";
          } else if (looksTruncated(value)) {
            // Confirmed live: "Title: U.S." (a genuine title's own
            // embedded newline splitting it right after an abbreviation
            // like "U.S.") never even reached the continuation-merge
            // logic below, because looksLikeCitationMetadataValue itself
            // rejects a bare "U.S." on its own two periods, so
            // current.sourceTitle was never set for the continuation
            // line to extend. Held here as a tentative, unconfirmed
            // fragment instead -- flushCurrent's own isPlausibleCitationField
            // check still gates whether the eventually-completed title
            // is ever shown, so this only ever gives an abbreviation a
            // chance to be completed, never bypasses validation for it.
            current.sourceTitle = value;
            lastContinuableField = "sourceTitle";
          }
        } else if (key === "publisher" || key === "organization") {
          lastContinuableField = null;
          if (looksLikeCitationMetadataValue(value)) {
            current.organization = value;
            lastContinuableField = "organization";
          } else if (looksTruncated(value)) {
            current.organization = value;
            lastContinuableField = "organization";
          }
        } else if (key === "year" || key === "publication year") {
          current.publicationYear = value.match(/\b(19|20)\d{2}\b/)?.[0];
          lastContinuableField = null;
        } else if (key === "url") {
          const normalizedUrl = normalizeCitationUrl(url || value);
          if (normalizedUrl) current.url = normalizedUrl;
          lastContinuableField = null;
        } else if (key === "confidence") {
          current.confidence = normalizeCitationConfidence(value);
          lastContinuableField = null;
        } else if (key === "reference") {
          // The Market Intelligence deterministic bibliography's own
          // in-text tag(s), e.g. "[R3][R12]" -- pure bracket syntax, never
          // free-form prose, so no shape guard is needed here.
          if (value) current.referenceTag = value;
          lastContinuableField = null;
        } else if (key === "accessed" || key === "access date") {
          if (looksLikeCitationMetadataValue(value)) current.accessDate = value;
          lastContinuableField = null;
        } else if (looksLikeCitationMetadataValue(value)) {
          current.sourceType = normalizeSourceType(value);
          lastContinuableField = null;
        }
        if (url) current.url = url;
        return;
      }

      if (!strippedLine) {
        return;
      }

      const citationMatch = strippedLine.match(
        /^([^—–|-]{2,80})\s*[—–-]\s*(.+?)(?:\s*\((\d{4})\))?(?:\s*[.;:]?\s*)?$/
      );

      if (!citationMatch || !looksLikeOrganizationName(citationMatch[1])) {
        // Confirmed live: a citation's own raw sourceTitle/publisher text
        // (extracted from a live webpage) sometimes carries an embedded
        // newline where the source page's own text wrapped (e.g. "U.S.
        // Copyright Office" split across two lines) -- that orphaned
        // continuation fragment matches neither the metadata-line pattern
        // above nor a new citation's own "Organization — Title" shape, so
        // it was silently dropped, leaving a truncated title/publisher
        // ("U.S.") behind. A short, plain fragment seen immediately after
        // the exact field it continues (tracked via lastContinuableField,
        // cleared the moment any other field line arrives) is that
        // field's own continuation, not unrelated content -- appended
        // back rather than discarded. looksLikeCitationMetadataValue's
        // existing shape guard (short, no sentence punctuation, not
        // prose) keeps this from ever swallowing an unrelated paragraph
        // that happens to follow the citations block.
        if (lastContinuableField && looksLikeCitationMetadataValue(strippedLine, 18)) {
          current[lastContinuableField] = `${current[lastContinuableField]} ${strippedLine}`.trim();
        } else {
          lastContinuableField = null;
        }
        return;
      }
      lastContinuableField = null;

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
        sourceType: normalizeSourceType(strippedLine),
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
  return /^(sources(?:\s+continued)?|references|kaynaklar|verified sources|doğrulanmış kaynaklar|sources \/ assumptions|kaynaklar \/ varsayımlar)$/i.test(
    title.trim()
  );
}

// The executive-decision-first redesign compresses the sources field's raw
// citation list into a short "Evidence Summary" (category + count) before
// the report is returned -- deliberately named/structured so it never
// matches parseCitations's title/publisher/URL or "Org — Title" shapes.
// Without this check, formatPdfCitationContent would see zero parsed
// citations for every report and silently substitute the generic
// placeholder block below (fabricated benchmark/assumption categories,
// unrelated to the report's real evidence), discarding the actual summary.
const evidenceSummaryHeadingPattern =
  /^(?:evidence summary|kanıt özeti|evidenzübersicht|synthèse des preuves|resumen de evidencia)\b/im;

function isEvidenceSummaryContent(content: string) {
  return evidenceSummaryHeadingPattern.test(content.trim());
}

function formatPdfCitationContent(content: string, realEstate = false) {
  const sourceContent = normalizePdfSourceContent(
    normalizePdfFinancialSectionContent(content, {
      field: "sourcesAssumptions",
      title: "Sources / Assumptions",
    })
  );

  if (isEvidenceSummaryContent(sourceContent)) {
    return sourceContent;
  }

  const citations = parseCitations(sourceContent);
  const methodologyBlock = realEstate
    ? [
        "Real Estate Evidence & Due-Diligence Methodology",
        "Uploaded asset facts are extracted first and kept separate from external evidence. Research coverage records successful, unavailable, timed-out, and not-found tasks. Valuation is gated by confirmed location, parcel size and unit, zoning or land use, sufficient comparables, currency, and an explicit calculation method. Evidence confidence falls when authoritative sources are missing or conflicting. Unresolved unknowns remain visible, and this report does not replace title, planning, survey, legal, environmental, geotechnical, or licensed valuation due diligence.",
      ].join("\n")
    : [
        "Methodology & Assumptions",
        "Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.",
      ].join("\n");

  if (citations.length === 0) {
    if (realEstate) {
      return [
        "• Uploaded Asset Evidence",
        "  Type: Primary document or image evidence",
        "• Official Planning and Cadastral Research",
        "  Type: Authoritative verification required",
        "• Comparable Market Research",
        "  Type: Dated external market evidence required",
        "• Unresolved Due-Diligence Items",
        "  Type: Missing evidence acquisition plan",
        "",
        methodologyBlock,
      ].join("\n");
    }
    // Confirmed live: this used to render internal provenance/methodology
    // categories ("Market Comparisons", "Financial Comparisons", etc.) as
    // "• Label" / "  Type: ..." bullets -- the exact same visual shape as
    // a real cited source a few lines below (source.sourceName / "Source
    // type: ..."). A reader had no way to tell these apart from genuine
    // external citations. When there are zero real citations, say so
    // plainly under its own heading, kept visually distinct from (never
    // styled like) a source entry, and let the methodology note below
    // explain what the report's figures are actually derived from
    // instead.
    return [
      "External Sources: none available for this report.",
      "",
      methodologyBlock,
      "No primary research or externally verifiable citation currently backs this report's figures -- they are derived from industry benchmark comparisons, financial benchmark/planning assumptions, and internal modeling. Primary research would raise confidence further.",
    ].join("\n");
  }

  const finalDedupeSources = getFinalDedupePdfSources(citations);
  // No cap here: the on-screen CitationList renders every deduplicated
  // source with no limit, and this content flows through the same
  // multi-page body-text pagination as any other section (confirmed to
  // correctly snap page breaks to bullet boundaries for Sources cards),
  // so capping here only meant a report with more than 8 real, unique
  // sources silently showed fewer citations in the PDF export than on
  // screen, with no indication anything was omitted.
  const sourceLines = finalDedupeSources
    .map((source) =>
      [
        // The in-text [R#] tag(s) this entry resolves, when present (only
        // Market Intelligence's deterministic bibliography emits these),
        // so a reader can trace a citation seen earlier in the report
        // straight back to its exact Sources entry.
        `• ${source.referenceTag ? `${source.referenceTag} ` : ""}${source.sourceName}`,
        // Metadata that isn't actually known is omitted entirely rather
        // than printed as "Publisher: Not specified" / "URL: Not
        // provided" -- a clean, shorter citation reads as production
        // quality; a citation full of broken-looking fields does not.
        // Source type/Confidence follow the same rule now: an unclassified
        // source (getPdfCitationSourceTypeLabel/getPdfCitationTrustLabel
        // returning "") omits the line instead of printing the internal
        // "Validation Required" tag.
        ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
        ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
        ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
        ...(source.url ? [`  URL: ${source.url}`] : []),
        ...(source.accessDate ? [`  Accessed: ${source.accessDate}`] : []),
        ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
      ].join("\n")
    )
    // A blank line between entries gives each source card visual room to
    // breathe -- purely a PDF rendering/formatting choice, not a change
    // to the underlying citation data.
    .join("\n\n");

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

const founderScorePdfDimensionMetrics = [
  { label: "Idea Quality", aliases: ["Idea Quality", "Fikir Kalitesi"] },
  { label: "Market Attractiveness", aliases: ["Market Attractiveness", "Pazar Çekiciliği"] },
  { label: "Business Model Quality", aliases: ["Business Model Quality", "İş Modeli Kalitesi"] },
  { label: "Validation Confidence", aliases: ["Validation Confidence", "Doğrulama Güveni"] },
  { label: "Execution Complexity", aliases: ["Execution Complexity", "executionComplexity", "Execution Difficulty", "executionDifficulty", "Execution", "Uygulama Karmaşıklığı", "Yürütme Karmaşıklığı", "Uygulama Zorluğu"] },
  { label: "Evidence Confidence", aliases: ["Evidence Confidence", "Kanıt Güveni"] },
  { label: "Founder Evidence", aliases: ["Founder Evidence", "Kurucu Kanıtı"] },
];

// CAC deliberately removed: the kpiDashboard prompt (plan.ts) explicitly
// instructs the model "Do not include CAC, LTV, Gross Margin, Payback,
// ARR, MRR, Burn, or Runway; those belong to Unit Economics and Financial
// Dashboard" -- so a CAC card here was always structurally wrong, and
// with no proper "CAC: $X" line ever written for this section, its value
// extraction fell through to the bare-score fallback below, which
// (confirmed live, e-commerce inventory SaaS report) rendered CAC's
// dollar figure with a nonsensical "%" suffix ("CAC 51%"). CAC already
// has its correct home -- Unit Economics/Financial Dashboard -- with
// correct currency formatting.
// isPercentage marks which of these are genuinely 0-100% completion/
// funnel metrics (Acquisition/Activation/Retention/Conversion) -- only
// those may fall back to a bare extracted number with a "%" suffix.
// Revenue/WTP/Sales cycle have no fixed unit (could be currency, a
// count, or a duration), so guessing "%" for them is exactly the same
// class of bug CAC had; see extractKpiValueFromSnippet below.
const kpiDashboardMetrics = [
  { label: "Acquisition", aliases: ["Acquisition", "acquisition", "Edinim"], isPercentage: true },
  { label: "Activation", aliases: ["Activation", "activation", "Aktivasyon"], isPercentage: true },
  { label: "Retention", aliases: ["Retention", "retention", "Elde Tutma"], isPercentage: true },
  { label: "Revenue", aliases: ["Revenue", "revenue", "Gelir"], isPercentage: false },
  { label: "WTP", aliases: ["WTP", "Ödeme İsteği"], isPercentage: false },
  { label: "Sales cycle", aliases: ["Sales cycle", "Satış Döngüsü"], isPercentage: false },
  { label: "Conversion", aliases: ["Conversion", "Dönüşüm"], isPercentage: true },
];

const unitEconomicsMetrics = [
  { label: "ARPA", aliases: ["ARPA", "ACV", "Average Revenue Per Account", "Ortalama Gelir"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost", "Müşteri Edinme Maliyeti"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value", "Yaşam Boyu Değer"] },
  { label: "Payback", aliases: ["Payback", "Payback Period", "Geri Ödeme"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
];

const financialDashboardMetrics = [
  { label: "ARR", aliases: ["ARR", "Annual Recurring Revenue", "Revenue"] },
  { label: "MRR", aliases: ["MRR", "Monthly Recurring Revenue"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Aylık Nakit Yakımı", "Nakit Yakımı", "Burn"] },
  { label: "Runway", aliases: ["Runway", "Finansal Pist"] },
  { label: "Payback", aliases: ["Payback", "Geri Ödeme", "Payback Period"] },
  { label: "Break-even", aliases: ["Break-even Month", "Başabaş Ayı", "Başabaş", "Break even Month", "Breakeven"] },
];

const mobilityFinancialDashboardMetrics = [
  { label: "Yearly Revenue", aliases: ["Yearly Revenue", "Annual Revenue", "ARR", "Revenue"] },
  { label: "Monthly Revenue", aliases: ["Monthly Revenue", "MRR"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "grossMargin", "Brüt Marj"] },
  { label: "Rider CAC", aliases: ["Rider CAC", "CAC", "Customer Acquisition Cost"] },
  { label: "Rider LTV", aliases: ["Rider LTV", "LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Aylık Nakit Yakımı", "Nakit Yakımı", "Monthly Burn", "Burn"] },
  { label: "Runway", aliases: ["Runway", "Finansal Pist"] },
  { label: "Payback", aliases: ["Payback", "Geri Ödeme", "Payback Period", "CAC Payback"] },
  { label: "Break-even", aliases: ["Break-even Month", "Başabaş Ayı", "Başabaş", "Break even Month", "Breakeven"] },
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedContent = normalizePdfText(content);
  const lineMatch = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(line)
    );

  if (lineMatch) {
    return lineMatch
      .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]\\s*`, "i"), "")
      .trim()
      .replace(/\*\*/g, "");
  }

  const tableMatch = normalizedContent.match(
    new RegExp(`\\|\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*\\|\\s*([^|\\n]+)`, "i")
  );

  if (tableMatch?.[1]?.trim()) {
    return tableMatch[1].trim().replace(/\*\*/g, "");
  }

  const inlineMatch = normalizedContent.match(
    new RegExp(
      `(?:^|[|\\n])\\s*(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:\\||\\n|[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü /-]{1,32}\\s*[:\\-–—]|$))`,
      "i"
    )
  );

  if (inlineMatch?.[1]?.trim()) {
    return inlineMatch[1].trim().replace(/\*\*/g, "");
  }

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

function extractStrictMetricValueFromAliases(
  content: string,
  aliases: string[] | readonly string[]
) {
  const normalizedContent = normalizePdfText(content);
  const lines = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const escapedAlias = escapeRegExp(alias);
    const lineMatch = lines.find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:=\\-–—]`, "i").test(line)
    );

    if (lineMatch) {
      return lineMatch
        .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:=\\-–—]\\s*`, "i"), "")
        .replace(/\*\*/g, "")
        .trim();
    }

    const tableMatch = normalizedContent.match(
      new RegExp(`\\|\\s*(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*\\|\\s*([^|\\n]+)`, "i")
    );

    if (tableMatch?.[1]?.trim()) {
      return tableMatch[1].trim().replace(/\*\*/g, "");
    }

    const objectMatch = normalizedContent.match(
      new RegExp(`["']?${escapedAlias}["']?\\s*[:=]\\s*["']?([^"',}\\n|]+)`, "i")
    );

    if (objectMatch?.[1]?.trim()) {
      return objectMatch[1].trim().replace(/\*\*/g, "");
    }
  }

  return "";
}

function normalizePdfFinancialMetrics(content: string, fullReportContent = "") {
  const metricContent = `${content}\n${fullReportContent}`;

  return getFinancialDashboardMetrics(metricContent)
    .map((metric) => {
      // Prefer a match from this card's own section content before ever
      // considering the rest of the report: Financial Assumptions
      // legitimately describes every one of these same metric names in
      // prose ("Payback: derived from CAC/ARPA, confidence Medium."), and
      // without this precedence that assumption sentence -- not this
      // card's own value -- would win whenever it's a plain "Label:" line
      // and this section only states the metric under a longer alias.
      const value =
        extractCanonicalFinancialMetricValue(content, metric.label, metric.aliases) ||
        extractCanonicalFinancialMetricValue(metricContent, metric.label, metric.aliases);
      const compactValue = compactPdfMetricValue(value);

      return {
        label: metric.label,
        aliases: metric.aliases,
        value,
        compactValue,
      };
    })
    .filter((metric) => metric.compactValue);
}

function extractCanonicalFinancialMetricValue(
  content: string,
  label: string,
  aliases: string[] | readonly string[]
) {
  if (label === "Gross Margin") {
    const grossMarginValue = formatMetricCardValue(
      extractStrictMetricValueFromAliases(content, ["grossMargin", "Gross Margin", "Brüt Marj"])
    );

    return grossMarginValue.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] || "";
  }

  const rawValue = formatMetricCardValue(extractMetricValueFromAliases(content, aliases));

  if (/\bmargin\b/i.test(label)) {
    return rawValue.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] || "";
  }

  return compactPdfMetricValue(rawValue);
}

// The report's own generation prompt requires every numeric claim to be
// tagged Verified/Estimated/Assumption/AI Analysis (or the Turkish
// equivalent) -- the model sometimes writes that tag directly after the
// value with no colon/dash/pipe separator at all ("CAC: $51 AI Analysis",
// "Gross Margin: 46% Assumption"), which none of the delimiter-based
// splits above catch (they all require a punctuation separator before
// the matched word). Confirmed live (e-commerce inventory SaaS report):
// this left the raw tag word concatenated straight onto the card's
// value. Stripped as a trailing suffix, with or without parens/a leading
// dash, since the tag only ever appears at the end of an otherwise-clean
// value here.
const evidenceTagSuffixPattern =
  /\s*[-–—]?\s*\(?\b(?:Verified|Estimated|Assumption|Planning assumption|AI Analysis|Model estimate|Model-derived estimate|Approximate|Doğrulanmış|Tahmini|Yaklaşık|Varsayım|Planlama varsayımı|AI Analizi|Model çıkarımı|Model tahmini)\b\)?\s*$/i;

function formatMetricCardValue(value: string) {
  const cleanValue = value.trim().replace(/\*\*/g, "");

  if (!cleanValue) {
    return "";
  }

  return cleanValue
    .split(/\b(?:formula|assumptions?|confidence|benchmark(?: source| comparison)?|explanation|justification|source)\b\s*[:\-–—]/i)[0]
    .split(/\s+(?:based on|using|assuming|calculated from|derived from)\s+/i)[0]
    .split(/\s*[;|]\s*/)[0]
    .replace(evidenceTagSuffixPattern, "")
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
  // Fields like TAM/SAM/SOM are explicitly instructed to "use ranges"
  // instead of inventing false precision, so a value such as "$2.1-2.8B"
  // is expected AI output, not an edge case. Capture an optional second
  // bound instead of stopping at the first number and silently dropping
  // the rest of the range from every metric card that reuses this
  // formatter.
  const singleBoundPattern = `(?:[$€₺]\\s*)?\\d+(?:[.,]\\d+)*(?:\\.\\d+)?\\s*(?:[kKmMbB%]|months?|ay|gün|days?)?\\s*(?:[$€₺])?`;
  const rangePattern = `${singleBoundPattern}(?:\\s*[-–—]\\s*${singleBoundPattern})?`;
  // These cards are inherently monetary, so an explicit currency-prefixed
  // number anywhere in the text outranks a bare number that happens to
  // appear earlier in the same sentence (e.g. "near-term obtainable share
  // over 18 months, estimated at $3-5M" -- the dollar figure is the
  // metric's real value, "18" is incidental).
  const currencyPattern = `[$€₺]\\s*\\d+(?:[.,]\\d+)*(?:\\.\\d+)?\\s*(?:[kKmMbB%])?(?:\\s*[-–—]\\s*(?:[$€₺]\\s*)?\\d+(?:[.,]\\d+)*(?:\\.\\d+)?\\s*(?:[kKmMbB%])?)?`;
  const numericMatch =
    cleanValue.match(new RegExp(currencyPattern, "i")) ||
    cleanValue.match(new RegExp(rangePattern, "i"));

  return numericMatch?.[0]?.replace(/\s+/g, " ").replace(/([kKmMbB%])\s+([$€₺])/g, "$1$2") || cleanValue.split(/\s{2,}/)[0] || "";
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure, UI/PDF canonical-data divergence): this used to run
// its own independent line/prose extraction over the raw content before
// ever looking for a number -- a stricter, self-anchored strategy than
// the web report's, which grabs the label's full value text first (via
// the canonical extractMarketSizingLayerValue, shared with page.tsx) and
// only THEN looks for the number/currency shape within it. A production
// TAM line's exact phrasing matched the web's extractor but fell outside
// what this function's old anchored regex accepted, so tamResolved was
// false in the PDF for a TAM that was correctly resolved on the web --
// which then cascaded (via the shared, unchanged TAM-first nesting rule)
// to collapse an independently-valid SAM into the same "Additional
// market validation is required" message. Delegating raw-value capture
// to the canonical function -- then applying this function's own
// existing shape/compacting pattern to produce a clean chart-legend
// string -- keeps the PDF's display formatting unchanged while
// guaranteeing the two surfaces can no longer disagree about which
// layers are actually stated in the report's own text.
function extractMarketSizeVisualValue(content: string, label: "TAM" | "SAM" | "SOM") {
  const normalized = normalizePdfText(content);
  const rawValue = extractMarketSizingLayerValue(normalized, label);

  if (!rawValue) {
    return "";
  }

  // The tamSamSom prompt explicitly instructs "use ranges" instead of
  // inventing false precision, so a value like "$2.1-2.8B" is the expected
  // shape, not an edge case -- capture an optional second bound instead of
  // stopping at the first number and silently dropping the rest of the
  // range. Also accepts a spelled-out unit ("200 million"), not just the
  // abbreviated K/M/B/T -- confirmed live, a real Planning Estimate paragraph
  // routinely writes units out in full.
  const unitWord = "(?:thousand|million|billion|trillion|milyon|milyar|bin)";
  // CRITICAL FIX -- confirmed live (third gap on top of the two documented
  // below): the model's own natural prose also writes a 3-letter currency
  // CODE ("USD 1.45B") instead of a symbol -- singleBound's currency group
  // only ever recognized [€$₺], so a value using a code alone had nothing
  // for the regex to anchor on between the separator and the digits,
  // falling through to "Validation Needed" a third, different way even
  // though the figure was stated plainly. Tolerates the common codes
  // alongside the existing symbols, in either bound of a range.
  const currencyToken = "(?:[€$₺]|(?:USD|EUR|GBP|TRY|CAD|AUD|CHF|JPY)\\b)";
  const singleBound = `(?:[<>~≈]?\\s*)?(?:${currencyToken}\\s*)?\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT%]\\b|\\s+${unitWord}\\b)?`;
  const valuePattern = `(${singleBound}(?:\\s*[-–—]\\s*(?:${currencyToken}\\s*)?${singleBound})?)`;

  // Searches WITHIN the already-scoped raw value text rather than
  // requiring the shape to start at position 0 -- this is what lets a
  // value text like "near-term obtainable share is estimated at $3-5M"
  // (real prose preceding the actual figure) still resolve to a clean
  // "$3-5M" legend string, instead of failing outright the way an
  // anchored `^...` match would.
  const shapedValue = rawValue.match(new RegExp(valuePattern, "i"))?.[0];

  return shapedValue ? shapedValue.replace(/\s+/g, " ").trim() : "";
}

// compactPdfMetricValue's fallback pattern deliberately allows a bare
// number (no currency symbol, no unit, no percent sign) because it is
// shared by general metric cards where a plain count can be a real,
// meaningful value (e.g. "Employees: 24"). A TAM/SAM/SOM legend value has
// no such case -- a market-size figure with no currency, unit, or percent
// attached is not a real figure a reader can act on, it is noise that
// survived the regex (e.g. a stray number from an unrelated sentence). This
// gate is intentionally scoped to just the chart legend rather than
// tightening compactPdfMetricValue itself, which stays correct for its
// other, non-market-size callers.
function isMarketSizeValueMeaningful(value: string) {
  if (!value.trim()) return false;
  return /[$€₺%]|\d\s*[kKmMbBtT]\b|\b(?:milyon|milyar|bin|thousand|million|billion|trillion)\b/i.test(
    value
  );
}

function extractMarketSizeValue(content: string, label: "TAM" | "SAM" | "SOM") {
  const value =
    extractMarketSizeVisualValue(content, label) ||
    compactPdfMetricValue(extractMetricValue(content, label));

  return isMarketSizeValueMeaningful(value) ? value : "";
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure, UI/PDF canonical-data divergence): this was its own
// independent copy of the exact magnitude-parsing logic now shared as
// parseMarketSizingMagnitude (report-presentation.ts). Delegating
// (rather than keeping a parallel, hand-maintained copy) is what
// actually guarantees the dashboard and exported PDF can never
// independently disagree on a TAM/SAM/SOM layer's resolved/nested
// state, instead of merely happening to agree today.
function parseMarketSizeMagnitude(value: string): number | null {
  return parseMarketSizingMagnitude(value);
}

// tamSamSom's own prompt requires a "named scaling assumption" and
// calculation basis stated as prose next to each layer's own figure. This
// reads that real sentence back out (same "sentence containing the label"
// technique extractForceImplication uses for Porter's Five Forces),
// matching page.tsx/Planner.tsx's own identical extractor -- never
// fabricating one.
function extractMarketSizeAssumption(content: string, label: string) {
  const match = content.match(new RegExp(`[^.\\n]*\\b${label}\\b[^.\\n]*\\.`, "i"));

  return match ? match[0].trim().replace(/^[-*•]\s+/, "") : "";
}

// tamSamSom's own prompt allows a transparent, benchmark-derived estimate
// when no verified local figure exists, explicitly requiring every such
// figure be labeled "[Estimated]" and "never presented as verified". This
// reads that real marker back out of the layer's own sentence (matching
// page.tsx/Planner.tsx's own isMarketSizeEstimated), rather than assuming
// estimated status.
function isMarketSizeEstimated(content: string, label: string) {
  const sentence = extractMarketSizeAssumption(content, label);

  return /\[Estimated\]/i.test(sentence) || /\bPlanning Estimate\b/i.test(sentence);
}

// FINAL PREMIUM REPORT RESTORATION -- these fields have no separate
// "methodology," their generated prose IS the primary insight, and on the
// web they now get a dedicated Key Takeaway + explanation + bullets card
// (see page.tsx/Planner.tsx's own pdfKeyTakeawayCardFields-equivalent).
// PDF cannot progressively disclose ("expand Details") the way a web page
// can, so it keeps the FULL body prose below (never shortens the report),
// but this same highlighted Key Takeaway box now sits above it, so a
// reader scanning the PDF gets the same at-a-glance summary the web
// primary view shows before ever reading the full paragraph.
const pdfKeyTakeawayCardFields = new Set([
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "customerSegments",
  "majorPlayers",
  "regionalAnalysis",
  "industryTrends",
  "marketSegmentation",
]);

// FINAL CLEANUP -- every field whose PDF visual (drawSectionVisual) is now
// enriched enough to be this section's COMPLETE presentation: TAM/SAM/SOM
// shows every layer's own real assumption sentence, Porter's shows every
// force's own real implication sentence, and Executive Summary/
// Competitive Landscape/Strategic Recommendations each already have their
// own dedicated, complete card. Drawing the raw section paragraph a
// second time below any of these would only repeat what the visual
// already fully communicates -- matches page.tsx/Planner.tsx's identical
// cardFirstReportFields gate exactly, so web and PDF share the same
// presentation hierarchy.
//
// CRITICAL FIX -- confirmed live: marketSize/cagr were previously listed
// here too, on the assumption (per this comment's own prior text) that
// they "already have their own dedicated, complete card" -- but the PDF
// never actually drew one for either: marketSize gets only the Market
// Metrics tile grid (five short derived signals, no reasoning), and cagr
// gets no dedicated visual at all, so with body text also suppressed the
// CAGR section rendered completely empty. Removed from this set so both
// fall back to the SAME "full body prose below the visual" treatment the
// pdfKeyTakeawayCardFields group already uses successfully -- restoring
// their real evidence/reasoning text, never re-fabricating anything, and
// matching the equivalent restore already made on-screen (page.tsx's/
// Planner.tsx's Market Size/CAGR card).
//
// CRITICAL FIX -- confirmed live (root-cause repair): `...pdfKeyTakeawayCardFields`
// was ALSO spread into this set until now -- directly contradicting the
// comment on pdfKeyTakeawayCardFields itself, which explicitly promises
// "it keeps the FULL body prose below" for exactly those 9 fields
// (marketDrivers/barriers/opportunities/threats/customerSegments/
// majorPlayers/regionalAnalysis/industryTrends/marketSegmentation). In
// reality the spread forced sectionBodyContent to "" for every one of
// them too, so the ONLY thing that ever rendered was the 3-line-capped
// Key Takeaway box -- for majorPlayers specifically, this collapsed a
// full list of real named vendors (Thomson Reuters/CoCounsel/Westlaw
// Edge, LexisNexis/Lexis+ AI, Evisort, Fastcase, Litera/Kira, ...) down
// to a single truncated fragment of its own first sentence. Removed so
// all 9 fields get their real body prose back, matching what the
// surrounding comment always claimed was already true.
const pdfCompleteVisualFields = new Set([
  "executiveSummary",
  "tamSamSom",
  "strategicRecommendations",
  "portersFiveForces",
  "competitiveLandscape",
]);

const tamCircleMaxRadius = 17;
const tamCircleMinRadius = 4;
const tamCircleDefaultRadii = [tamCircleMaxRadius, 12.5, tamCircleMinRadius + 4] as const;

// Radius scales with sqrt(value) so *area* -- not radius -- is
// proportional to the underlying market-size figure, matching how a real
// concentric market-sizing chart (the standard McKinsey/VC-deck device
// for TAM/SAM/SOM) communicates relative scale. Falls back to a fixed,
// always-legible set of decreasing radii whenever the parsed values are
// missing or don't make logical sense (SAM/SOM larger than their parent
// figure) rather than drawing a distorted or inverted diagram.
function computeTamSamSomRadii(
  tamValue: number | null,
  samValue: number | null,
  somValue: number | null
): readonly [number, number, number] {
  if (
    tamValue === null ||
    samValue === null ||
    somValue === null ||
    samValue > tamValue * 1.5 ||
    somValue > samValue * 1.5
  ) {
    return tamCircleDefaultRadii;
  }

  const scale = tamCircleMaxRadius / Math.sqrt(tamValue);
  const samRadius = Math.max(
    tamCircleMinRadius + 2,
    Math.min(tamCircleMaxRadius - 2, Math.sqrt(samValue) * scale)
  );
  const somRadius = Math.max(
    tamCircleMinRadius,
    Math.min(samRadius - 2, Math.sqrt(somValue) * scale)
  );

  if (!Number.isFinite(samRadius) || !Number.isFinite(somRadius)) {
    return tamCircleDefaultRadii;
  }

  return [tamCircleMaxRadius, samRadius, somRadius];
}

function isMobilityReportContent(content: string) {
  // Confirmed live (e-commerce inventory SaaS report): the previous
  // loose keyword list (scooter/rental/commuters/fleet utilization/...)
  // false-positived on ordinary, unrelated mentions of those same common
  // words elsewhere in a non-mobility report (e.g. "equipment rental" or
  // "delivery fleet" used only as an illustrative example), mislabeling
  // that report's Financial Dashboard with "Rider CAC"/"Rider LTV".
  // financial-model.ts's own server-side isMobility flag (the ONE thing
  // that actually decides whether "Rider CAC"/"Rider LTV" get used in
  // the first place) is `inputs.industryKey === "mobility"`, and every
  // report's Financial Assumptions section always includes
  // `Industry benchmark: ${benchmark.label}` verbatim (sharedAssumptions
  // in financial-model.ts) -- benchmark.label is "Mobility / scooter
  // rental" exactly when industryKey is "mobility". Matching that one
  // deterministic line (its Turkish translation too) instead of loose
  // topic words ties this client-side check to the same signal the
  // server already used, eliminating false positives from incidental
  // word mentions anywhere else in the report.
  return /\bIndustry benchmark:\s*Mobility \/ scooter rental\b|\bSektör referansı:\s*Mobilite \/ scooter kiralama\b/i.test(
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
  const tableScoreMatch = normalizePdfText(content).match(
    new RegExp(`\\|\\s*(?:\\*\\*)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*\\|\\s*(\\d{1,3})(?:\\s*%|\\s*\\/\\s*100)?`, "i")
  );
  const fallbackMatch = content.match(
    new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]{0,30}(\\d{1,3})`, "i")
  );
  const rawScore = Number(scoreMatch?.[1] || tableScoreMatch?.[1] || fallbackMatch?.[1] || NaN);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  return Math.max(0, Math.min(100, rawScore));
}

function extractScoreFromAliases(content: string, aliases: string[] | readonly string[]) {
  for (const alias of aliases) {
    const score = extractScore(content, alias);

    if (score !== null) {
      return score;
    }
  }

  return null;
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

// Reads a bullet/numbered list directly out of Market Intelligence's own
// deterministic executive-decision block (formatExecutiveDecisionBrief),
// e.g. everything between "Top 3 Risks:" and the next blank line. Tries
// each candidate heading (the block's language varies with the report's
// own language) and returns the first that matches.
function extractMarketBriefListLines(content: string, headings: string[]): string[] {
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = content.match(new RegExp(`${escaped}\\s*:\\s*\\n([\\s\\S]*?)(?:\\n\\s*\\n|$)`, "i"));
    if (!match) continue;

    const lines = match[1]
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\d+\.|[-*•])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 3);

    if (lines.length > 0) {
      return lines;
    }
  }

  return [];
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency hardening): a value extracted from a labeled section can
// legitimately be either a single sentence ("Biggest Risk: Regulatory
// uncertainty...") or a short bulleted list ("Recommendation:\n1. ...\n2.
// ...\n3. ..."), depending on which real label matched. A cover-level
// field needs exactly ONE concise statement -- this takes the first real
// list item when the value is bulleted/numbered, or returns a
// single-sentence value unchanged, rather than concatenating multiple
// bullets into one run-on cover fragment.
function takeFirstListItemOrSentence(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const firstLine = trimmed
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .find(Boolean);
  return firstLine || trimmed;
}

// Buckets the exact, verbatim decision text extracted above into a color
// category -- checked NO_GO/CONDITIONAL first since "GO" is itself a
// substring of "CONDITIONAL GO"/"BEDINGTES GO"/etc.
// CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical decision
// consistency bug"). Only ever called with a raw, unstructured decision
// text (the deterministic-banner case is colored directly from its own
// canonicalDecision enum, never through here) -- e.g. this report's own
// legacy "MONITOR FOR A STAGED U.S. ..." text, or the honest "—"
// unavailable placeholder. Defaulting unrecognized text to "GO" (as this
// function previously did) painted a green/affirmative badge behind
// EVERY such case, including "unavailable" and "monitor"/"staged pilot"
// language that never said GO -- exactly the kind of fallback the ticket
// requires removed. This tier has no reliable, structured way to confirm
// an affirmative verdict (a bare `\bGO\b` scan would just reintroduce the
// same "Go-to-Market" false-positive this fix removes elsewhere), so GO
// is never guessed here: anything that isn't explicitly a NO-GO/HAYIR
// renders as the neutral CONDITIONAL color, never the affirmative one.
function marketDecisionColorCategory(decisionText: string): "CONDITIONAL" | "NO_GO" {
  const normalized = decisionText.trim().toUpperCase();

  if (/HAYIR|NO[\s-]?GO/.test(normalized)) {
    return "NO_GO";
  }

  return "CONDITIONAL";
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
  // normalizePdfText inserts a non-breaking space (U+00A0) between a
  // number and a following unit word (e.g. "30 days" -> "30 days")
  // so prose never orphans a number from its unit across a line break --
  // but that also fires on structural labels like "Next 30 Days" or
  // "12 Months" used throughout this file for section/roadmap-step
  // matching, silently turning their literal space into U+00A0. Every
  // caller here builds patterns from label/alias strings that still have
  // an ordinary space, so match either character wherever one was
  // expected instead of only the plain space.
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "[ \\u00a0]");
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
    const lineMatchRegex = new RegExp(
      `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${labelPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]\\s*([\\s\\S]*?)(?=${stopPattern ? `\\n\\s*(?:#{1,6}\\s*)?(?:[-*•]\\s*)?(?:\\*\\*)?(?:${stopPattern})(?:\\*\\*)?\\s*(?:case|senaryo)?\\s*[:\\-–—]` : "$"}|$)`,
      "i"
    );
    const lineMatch = normalizedContent.match(lineMatchRegex);

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
  const detail = cleanPdfEvidenceMetadataText(extractMetricDetail(content, aliases))
    .replace(/\b(?:formula|assumptions?|benchmark|source|confidence)\s*[:=]\s*/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  if (detail) {
    return detail;
  }

  const raw = normalizePdfText(extractMetricValueFromAliases(content, aliases));

  return cleanPdfEvidenceMetadataText(raw)
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

// CRITICAL FIX -- do not reintroduce old fake-data behavior. Porter's
// Five Forces' PDF intensity bars were a static, hardcoded array
// ([72, 54, 66, 48, 60]) -- identical for every report regardless of the
// generated content, which the section's own prompt explicitly instructs
// to give "a qualitative assessment ... for each force". This reads that
// real qualitative assessment (high/moderate/low and their synonyms)
// back out of the text near each force's own name, scoped to a bounded
// window so an intensity word describing a DIFFERENT force can't bleed
// into this one's reading. Returns null (never a guessed number) when no
// such signal is present for that force. Mirrors page.tsx/Planner.tsx's
// own on-screen copies of this same function.
const forceAliases: Record<string, string[]> = {
  Rivalry: ["rivalry", "competitive rivalry", "rekabet yoğunluğu"],
  Entrants: ["threat of (?:new )?entr(?:y|ants)", "new entrants", "barriers? to entry", "giriş engeli"],
  "Buyer Power": ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  Buyer: ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  "Supplier Power": ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  Supplier: ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  // CRITICAL FIX (Task #19) -- see page.tsx's own identical entry for the
  // full rationale: a bare "Substitutes -- Moderate: ..." heading matched
  // neither existing alias, silently showing "Not specified" for real
  // content the model actually wrote.
  Substitutes: ["threat of substitutes?", "substitute products?", "substitutes", "ikame ürün"],
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

// Each Porter's Five Forces card's own "investor interpretation" -- the
// full sentence containing that force's own alias, matching
// page.tsx/Planner.tsx's identical on-screen extractor. Never fabricated:
// returns "" when the content says nothing about this specific force.
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

// CRITICAL FIX (Task #19) -- see page.tsx's own identical function for
// the full rationale: every Porter's Five Forces card drew its intensity
// bar in the same teal regardless of whether that force's own sentence
// cited real evidence or explicitly admitted it had none. Reused here as
// a bar-fill-color signal (rather than a new badge element) since this
// PDF card has no spare room for one without risking repagination.
function isForceEvidenceCited(implication: string): boolean {
  if (!implication) {
    return false;
  }
  if (/\bnot\s+(?:directly\s+)?evidenced\b|\bno\s+(?:direct\s+)?evidence\b|\bunevidenced\b/i.test(implication)) {
    return false;
  }

  return /\[R\d+\]|\(R\d+(?:,\s*R\d+)*\)/.test(implication);
}

function extractHeadlineCagrValue(content: string) {
  const match = (content || "").match(
    /\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/
  );

  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

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

// TASK #29J -- isRecommendationHeadingLine, isMetadataOnlyRecommendationLine,
// isEvidenceStatusDisclaimerLine, extractRecommendationItems,
// recommendationOwnerRolePattern, and extractRecommendationSignals were
// consolidated into app/lib/report-presentation.ts (the single shared
// source of truth for Strategic Recommendations extraction/grouping,
// now imported above) -- previously duplicated, byte-for-byte identical
// copies lived here, in Planner.tsx, and in page.tsx, which is exactly
// what let Tasks #29E-#29I's fixes drift out of sync across surfaces.

// CRITICAL FIX -- confirmed live: Market Intelligence's competitive
// landscape table (market-intelligence-graph.ts) has its own real column
// set -- "| Vendor | Parent Company | Category | Segment | AI Capability |
// Key Use Cases | Pricing Model | Strengths | Weaknesses | Validation
// Count | Confidence | Market Relevance |" -- distinct from Business
// Plan/Acquisition's Company/Positioning/Threat shape extractCompetitorRows
// below reads. Reusing that generic extractor for Market Intelligence
// (as this PDF export always had) collapses Category/Segment/AI
// Capability/Key Use Cases/Pricing Model into a single "Positioning" read,
// and its "Threat" read actually resolves to the "Confidence" column
// (found first when scanning for "threat"/"risk"/"market relevance"/
// "confidence", since Confidence appears before Market Relevance in the
// real header order) -- producing a PDF table that disagreed with, and
// mislabeled, exactly what the on-screen table already shows correctly.
// Mirrors page.tsx's/Planner.tsx's identical on-screen extractor exactly,
// so Market Intelligence's web and PDF tables are now the same table.
// Positional slicing (not .filter(Boolean) on data cells) keeps columns
// aligned even when a cell is legitimately empty.
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
// cells) so the PDF table consumes the SAME underlying vendor data either
// way, without fabricating anything new -- mirrors page.tsx's/Planner.tsx's
// identical fallback exactly.
//
// CRITICAL FIX -- confirmed live (root-cause pipeline repair): none of
// the three competitor-row extraction tiers below validated that a
// captured "vendor" string actually LOOKS like a company/product name --
// so when the underlying competitiveLandscape text was un-gated model
// prose (e.g. this exact cache-degraded path), an entire evidence/
// citation sentence like "Pricing evidence: Westlaw Edge charges
// $89-$450/user/month..." could be captured whole as a "vendor name" -- a
// structural parsing failure, not a data problem. Mirrors vendor-
// discovery.ts's own isImplausibleCompetitorName heuristic (length/word-
// count bounds, markdown/parser-artifact characters, instruction-leading
// verbs) plus an explicit reject for the specific evidence/citation-label
// prefixes this exact failure mode produces (never a real company name).
// Applied as a per-row VENDOR-field gate only -- an implausible vendor is
// treated as missing, not fabricated; any other real fields the row
// captured survive untouched, and the row is only dropped entirely when
// nothing real remains.
function isImplausibleCompetitorNamePdf(name: string) {
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
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNamePdf(row.vendor) ? "" : row.vendor }))
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
        row !== null && Boolean(row.vendor) && !isImplausibleCompetitorNamePdf(row.vendor)
    )
    .slice(0, 20);
}

// CRITICAL FIX -- confirmed live: real Major Players content can be
// grouped/prose bullets with no parenthetical label immediately after the
// name at all (e.g. "- Thomson Reuters / CoCounsel / Westlaw Edge:
// AI-powered legal research and contract platform..."), which fails the
// row extractor above at its very first capture boundary. This is a 4th,
// last-resort tier: never fabricates category/position/strengths/
// weaknesses -- it extracts ONLY the plausible name segment(s) from each
// bullet, splitting a grouped "A / B / C" entry into separate candidate
// names. Callers must render this as its own distinct state (validated
// identities, but not enough structure for a comparison matrix). Mirrors
// page.tsx's/Planner.tsx's own extractMarketIntelligenceCompetitorNamesOnly.
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

    const candidates = nameSegment
      .split(/\s*\/\s*|,\s*/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      // isImplausibleCompetitorNamePdf's evidence/label-phrase reject
      // ("market relevance:", "confidence:", ...) only fires when the
      // colon is still attached -- nameSegment already stripped it during
      // the name/label split above, so re-attach one here purely for this
      // check (never part of the stored name itself).
      if (!isImplausibleCompetitorNamePdf(`${candidate}:`) && !names.includes(candidate)) {
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
  // weaknesses here either. Mirrors page.tsx's identical fix.
  if (names.length === 0) {
    const proseWithoutUrls = normalized.replace(/https?:\/\/\S+/gi, "");
    const nameListGroup =
      "((?:[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})(?:\\s*,\\s*(?:and\\s+)?[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})*(?:\\s+and\\s+[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})?)";
    // Tier 2a: predicate-leading prose ("major players include X, Y, and
    // Z", "such as X, Y, Z", "led by X, Y, Z").
    const predicateLeadingMatch = proseWithoutUrls.match(
      new RegExp(
        `\\b(?:include|includes|including|such as|like|named|led by|dominated by|anchored by)\\s+${nameListGroup}`
      )
    );
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence report-
    // isolation-adjacent research-quality failure, Task #12): mirrors
    // page.tsx's identical fix -- the predicate-leading pattern above only
    // covers ONE of two equally common ways a model introduces a vendor
    // list; the exact reported production shape ("Ironclad, Evisort,
    // DocuSign CLM, and LawGeex are established competitors in this
    // space") is SUBJECT-leading, which the prior pattern never matched
    // at all. Tier 2b covers this second shape: a name list immediately
    // followed by "are/is (adjective) competitors/players/vendors/...",
    // reusing the EXACT SAME name-list capture group as tier 2a.
    const subjectLeadingMatch = proseWithoutUrls.match(
      new RegExp(
        `${nameListGroup}\\s+(?:are|is)\\s+(?:the\\s+)?(?:established|leading|key|major|notable|primary|prominent|main|top)?\\s*(?:competitors?|players?|vendors?|providers?|companies|solutions?|options?)\\b`
      )
    );
    // P0 PRODUCTION FIX -- confirmed live (Task #14): real Major Players
    // prose can introduce its name list with neither a predicate trigger
    // word before it NOR an "are/is ... competitors" clause after it --
    // just a plain colon, e.g. "Only evidence-supported major players in
    // the supplied registry: Ironclad, Evisort, DocuSign CLM, and
    // LawGeex." Neither tier 2a/2b anchor matches this shape. Tier 2c
    // anchors on the colon itself: a name list immediately after a colon,
    // with nothing else before the sentence ends (period/newline/end of
    // string) -- deliberately not open-ended, so a colon-introduced clause
    // that continues past the list into further prose does not match at
    // all, rather than truncating mid-sentence into a partial capture.
    const colonLeadingMatch = proseWithoutUrls.match(new RegExp(`:\\s*${nameListGroup}\\s*(?:[.\\n]|$)`));
    const listMatch = predicateLeadingMatch || subjectLeadingMatch || colonLeadingMatch;

    if (listMatch?.[1]) {
      const candidates = listMatch[1]
        .split(/\s*,\s*|\s+and\s+/)
        .map((candidate) =>
          candidate
            .replace(/^and\s+/i, "")
            // A name at the end of a captured list can swallow the
            // sentence's own trailing period -- only stripped from the
            // LAST character, never from the middle of a name (so real
            // abbreviations like "Corp." elsewhere in the list survive).
            .replace(/\.$/, "")
            .trim()
        )
        .filter(Boolean);

      for (const candidate of candidates) {
        if (!isImplausibleCompetitorNamePdf(`${candidate}:`) && !names.includes(candidate)) {
          names.push(candidate);
        }
      }
    }

    // P0 PRODUCTION FIX -- confirmed live against the REAL regenerated
    // report's own stored content (Task #15): Major Players is not always
    // one combined comma-separated list -- the model wrote one "Vendor --
    // description [citation]." entry per line, with the FIRST vendor
    // sharing a line with the intro clause and no "-" bullet marker
    // anywhere. None of the tiers above match this shape. This tier finds
    // each vendor independently: a short capitalized phrase (1-4 words)
    // immediately preceded by a line start, a newline, or a colon-
    // introduced clause, and immediately followed by " -- " (an em dash),
    // the model's own per-item label separator here. Anchoring on that
    // exact separator -- not just any capitalized word -- keeps this
    // safe: ordinary prose essentially never continues a colon or starts
    // a new line with "Word -- " unless it is genuinely introducing a
    // labeled item exactly like this.
    if (names.length === 0) {
      const emDashLabelPattern = /(?:^|\n|:\s+)([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+—\s+/g;

      for (const match of proseWithoutUrls.matchAll(emDashLabelPattern)) {
        const candidate = match[1]?.trim();

        if (candidate && !isImplausibleCompetitorNamePdf(`${candidate}:`) && !names.includes(candidate)) {
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
      validationStatus: read(cells, ["confidence"]),
    }))
    // Defense-in-depth: the deterministic table is already filtered
    // server-side (isImplausibleCompetitorName), but this render-time
    // check never trusts that alone -- the same evidence-sentence-as-
    // vendor failure mode is possible here too if a model ever writes
    // its own "| a | b | c |" table without going through the graph.
    .map((row) => ({ ...row, vendor: isImplausibleCompetitorNamePdf(row.vendor) ? "" : row.vendor }))
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

// Market Map for extractMarketIntelligenceCompetitorRows' own row shape
// (category/position, matching page.tsx's/Planner.tsx's on-screen
// inferMarketMapPosition exactly). Deliberately reads only category/
// position, never strengths/weaknesses: a weakness like "Limited enterprise
// features" would
// otherwise false-positive the word "enterprise" as this vendor's target
// segment when it actually describes the opposite. Never fabricates a
// placement -- a vendor missing a clear signal on either axis is simply
// omitted.
function inferMarketIntelligenceMarketMapPosition(row: { category: string; position: string }) {
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
        // CRITICAL FIX -- restore Market Intelligence's structured PDF
        // presentation. Market Intelligence's competitiveLandscape table
        // (market-intelligence-graph.ts) uses "Vendor" for the company
        // column and "Market Relevance"/"Confidence" in place of a
        // "Threat" column -- neither previously matched, so this table
        // rendered with empty Company/Threat cells for Market
        // Intelligence even when the "competitor" title check below
        // fired. Added as additional keys, not replacements, so Business
        // Plan/Acquisition's existing column matches are unchanged.
        company: cleanPdfExecutiveText(read(["company", "competitor", "vendor", "rakip"]), 44),
        positioning: cleanPdfExecutiveText(read(["position", "category", "konum"]), 88),
        strengths: cleanPdfExecutiveText(read(["strength", "güç"]), 76),
        weaknesses: cleanPdfExecutiveText(read(["weakness", "zayıf"]), 76),
        threat: cleanPdfExecutiveText(read(["threat", "risk", "market relevance", "confidence"]), 64),
      });
    });

    return rows.filter((row) => row.company || row.positioning || row.strengths || row.weaknesses || row.threat).slice(0, 4);
  }

  // competitorLandscape's own prompt explicitly instructs a trailing
  // "Include incumbent response, switching barriers, and the gap for a new
  // entrant. End with a concise executive implication..." sentence -- the
  // generic "capitalized phrase followed by a colon" company-name guess
  // below would otherwise misread that closing commentary as another
  // competitor row (e.g. "Executive implication: ..." -> company name
  // "Executive implication"). Every other analytical section is under the
  // same "compact executive implication line" directive
  // (report-quality-directives.ts), so this guard is not competitor-page
  // specific busywork -- it is the one place that summary sentence
  // actually collides with a row-parsing heuristic.
  const competitorSummaryLinePattern =
    /^(?:Executive implication|Incumbent response(?: risk)?|Switching barriers?|Gap for (?:a )?new entrant)\s*[:\-–—]/i;

  normalized
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter((line) => line.length > 14 && !competitorSummaryLinePattern.test(line))
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

function extractCanonicalKpiSnippet(content: string, aliases: string[] | readonly string[]) {
  const normalizedContent = normalizePdfText(content);
  const lines = normalizedContent
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const alias of aliases) {
    const escapedAlias = escapeRegExp(alias);
    const labeledLine = lines.find((line) =>
      new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]`, "i").test(line)
    );

    if (labeledLine) {
      return labeledLine
        .replace(new RegExp(`^(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]\\s*`, "i"), "")
        .replace(/\*\*/g, "")
        .trim();
    }

    const tableLine = lines.find((line) =>
      new RegExp(`^\\|\\s*(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*\\|`, "i").test(line)
    );

    if (tableLine) {
      return tableLine.replace(/\*\*/g, "").trim();
    }

    const objectLine = lines.find((line) =>
      new RegExp(`["']?(?:metric|kpi|name|label)["']?\\s*[:=]\\s*["']?${escapedAlias}["']?`, "i").test(line)
    );

    if (objectLine) {
      return objectLine.replace(/\*\*/g, "").trim();
    }
  }

  return "";
}

function extractKpiValueFromSnippet(
  snippet: string,
  aliases: string[] | readonly string[],
  isPercentage: boolean
) {
  const explicitValue = extractKpiObjectField(snippet, ["value", "değer", "current", "mevcut", "baseline", "metric"]);
  const targetValue = extractKpiObjectField(snippet, ["target", "hedef"]);
  const quantityValue = extractKpiQuantityValue(snippet);
  // A bare 1-3 digit number with no unit word attached (extractScore) is
  // only safe to render as "N%" for metrics that are genuinely 0-100%
  // completion/funnel figures. For everything else (Revenue, WTP, Sales
  // cycle -- currency, counts, or durations with no fixed unit) guessing
  // "%" produces exactly the CAC bug this was fixed for ("$51" rendered
  // as "51%"); an honest "not yet measured" fallback (never the internal
  // "Validation Required" tag) is used for an unresolved metric instead
  // of a wrong unit slapped on a bare digit.
  const score = isPercentage ? extractScoreFromAliases(snippet, aliases) : null;
  const value = explicitValue ||
    targetValue ||
    quantityValue ||
    (score === null ? "" : `${score}%`) ||
    "";

  // Also guards a genuinely empty value (nothing at all was resolved,
  // e.g. a non-percentage metric like Revenue/WTP/Sales cycle with no
  // score fallback available): the drawing code's own fallback for a
  // falsy card value independently recomputes a bare score and appends
  // "%" with no isPercentage awareness at all, so leaving `value` as ""
  // here would let that same wrong-unit bug resurface downstream for
  // every non-percentage metric, not just CAC.
  return !value || isMissingKpiText(value) ? "Not yet measured" : value;
}

function extractKpiValueFromAliases(
  content: string,
  aliases: string[] | readonly string[],
  isPercentage: boolean
) {
  return extractKpiValueFromSnippet(extractKpiSnippet(content, aliases), aliases, isPercentage);
}

function isMissingKpiText(value: string) {
  const trimmed = value.trim();

  return !trimmed ||
    /^1$/.test(trimmed) ||
    /\b1\s*(?:[-–—]\s*)?\/\s*(?:target\s*[:\-–—]?\s*)?1\b/i.test(value) ||
    /\b(?:value|metric|current|baseline|threshold|target)\s*[:\-–—]?\s*1\b/i.test(trimmed);
}

function extractKpiSnippet(content: string, aliases: string[] | readonly string[]) {
  return extractCanonicalKpiSnippet(content, aliases);
}

function extractKpiObjectField(snippet: string, fieldLabels: string[]) {
  if (!snippet) {
    return "";
  }

  const fieldPattern = fieldLabels.map(escapeRegExp).join("|");
  const stopPattern = [
    "owner",
    "sahip",
    "target",
    "hedef",
    "status",
    "durum",
    "trigger",
    "tetikleyici",
    "action",
    "aksiyon",
    "value",
    "değer",
    "current",
    "mevcut",
    "baseline",
    "metric",
  ]
    .filter((label) => !fieldLabels.includes(label))
    .map(escapeRegExp)
    .join("|");
  const normalizedSnippet = normalizePdfText(snippet).replace(/[{}"']/g, "");
  const match = normalizedSnippet.match(
    new RegExp(`(?:^|[|;,\\n])\\s*(?:${fieldPattern})\\s*[:=\\-–—]\\s*([\\s\\S]*?)(?=\\s*(?:[|;,\\n]|${stopPattern}\\s*[:=\\-–—]|$))`, "i")
  );
  const value = match?.[1]?.trim().replace(/\*\*/g, "") || "";

  // Genuinely not found: return empty (not the internal "Validation
  // Required" tag) so this shared helper's callers -- extractKpiValueFromSnippet's
  // multi-strategy OR chain, and extractKpiTargetFromSnippet below -- can
  // fall through to their own next extraction strategy or their own
  // context-appropriate user-facing fallback text, instead of this one
  // generic (value-or-target-agnostic) helper short-circuiting both with
  // the same placeholder.
  return isMissingKpiText(value) ? "" : value;
}

function extractKpiQuantityValue(snippet: string) {
  const matches = normalizePdfText(snippet).match(
    /\d+(?:[.,]\d+)*(?:\.\d+)?\s*(?:customers?|users?|reports?|leads?|conversations?|accounts?|orders?|sales|revenue|activation|retention|conversion|%)/gi
  );

  return matches?.at(-1)?.trim() || "";
}

function extractKpiTargetFromSnippet(snippet: string) {
  const target = extractKpiObjectField(snippet, ["target", "hedef"]);
  const cleanTarget = target ? compactPdfMetricValue(target) || target : "";

  return isMissingKpiText(cleanTarget) ? "To be defined" : cleanTarget;
}

function extractKpiTargetFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiTargetFromSnippet(extractKpiSnippet(content, aliases));
}

function extractKpiStatusFromSnippet(snippet: string, aliases: string[] | readonly string[]) {
  const status = extractKpiObjectField(snippet, ["status", "durum"]);

  if (status) {
    return status;
  }

  return (extractScoreFromAliases(snippet, aliases) ?? 0) >= 70 ? "On track" : "Watch";
}

function extractKpiStatusFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiStatusFromSnippet(extractKpiSnippet(content, aliases), aliases);
}

function extractKpiOwnerFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["owner", "sahip"]);
}

function extractKpiTriggerFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["trigger", "tetikleyici"]);
}

function extractKpiActionFromAliases(content: string, aliases: string[] | readonly string[]) {
  return extractKpiObjectField(extractKpiSnippet(content, aliases), ["action", "aksiyon"]);
}

function normalizePdfKpiMetrics(content: string) {
  return kpiDashboardMetrics.map((metric) => {
    const value = extractKpiValueFromAliases(content, metric.aliases, metric.isPercentage);
    const target = extractKpiTargetFromAliases(content, metric.aliases);
    const status = extractKpiStatusFromAliases(content, metric.aliases);
    const owner = extractKpiOwnerFromAliases(content, metric.aliases);
    const trigger = extractKpiTriggerFromAliases(content, metric.aliases);
    const action = extractKpiActionFromAliases(content, metric.aliases);
    const score = extractScoreFromAliases(content, metric.aliases);

    return {
      label: metric.label,
      aliases: metric.aliases,
      value,
      target,
      status,
      owner,
      trigger,
      action,
      score,
    };
  });
}

function normalizePdfFounderScoreMetrics(content: string, investmentScore?: DashboardReport["investmentScore"]) {
  const textScoreValues = [
    readFounderReadinessMetricValue("Founder Readiness Score", investmentScore, content),
    readFounderReadinessMetricValue("Idea Quality", investmentScore, content),
    readFounderReadinessMetricValue("Market Attractiveness", investmentScore, content),
    readFounderReadinessMetricValue("Business Model Quality", investmentScore, content),
    readFounderReadinessMetricValue("Validation Confidence", investmentScore, content),
    readFounderReadinessMetricValue("Execution Complexity", investmentScore, content),
    readFounderReadinessMetricValue("Evidence Confidence", investmentScore, content),
    readFounderReadinessMetricValue("Founder Evidence", investmentScore, content),
  ];
  const dimensionScoreValues = textScoreValues.slice(1);

  return founderScorePdfDimensionMetrics.map((metric) => ({
    label: metric.label,
    aliases: metric.aliases,
    score:
      dimensionScoreValues[founderScorePdfDimensionMetrics.findIndex((item) => item.label === metric.label)] ??
      readFounderReadinessMetricValue(metric.label, investmentScore, content),
  }));
}

function buildPdfFounderScoreCards(
  content: string,
  investmentScore: DashboardReport["investmentScore"] | undefined,
  locale: PdfLocale
) {
  return normalizePdfFounderScoreMetrics(content, investmentScore).map((metric) => ({
    label: localizePdfPresentationLabel(metric.label, locale),
    score: metric.score,
  }));
}

function getPdfSectionCardTitle(section: PdfReportSection, locale: PdfLocale) {
  if (section.field === "founderScore") {
    return locale === "tr" ? "Kurucu Hazırlık Boyutları" : "Founder Readiness Dimensions";
  }

  return section.title;
}

function getPdfTocEntryTitle(section: PdfReportSection, locale: PdfLocale) {
  if (/\b(?:Validation Intelligence|Doğrulama Zekası)\b/i.test(section.content)) {
    return localizePdfPresentationLabel("Validation Intelligence", locale);
  }

  return section.title;
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

// The Competitive Landscape/competitor visual above already renders every
// row of market-intelligence-graph.ts's markdown table as a real table --
// without this, the section's own raw body text (drawn below the visual,
// same as every other section) would dump that SAME markdown table a
// second time as literal, unformatted "| Vendor | Category | ... |" pipe
// syntax. Strips only table row/separator lines, keeping any genuine
// surrounding commentary the model wrote outside the table.
function stripPdfMarkdownTableLines(content: string) {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("|") && trimmed.endsWith("|"));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const cleaned = removeDuplicatePdfExecutiveInsightText(
    normalizePdfTamSamSomOwnershipContent(financialContent, { title })
  );

  if (normalizedTitle.includes("competitive landscape") || normalizedTitle.includes("competitor")) {
    return stripPdfMarkdownTableLines(cleaned);
  }

  return cleaned;
}

// TASK #29E -- confirmed live (real persisted report, Market Overview):
// "confidence"/"evidence" ("güven"/"referans" in Turkish) are ordinary
// English/Turkish words a genuine sentence can start with or use as a
// natural lead-in ("Evidence: market reports and vendor product pages
// show AI-enabled CLM offerings and U.S. buyer population counts...") --
// unlike every OTHER keyword below (formula, assumptions, raw validation
// context, ...), which only ever appear in this pipeline as genuine
// internal/debug metadata labels the model occasionally leaks verbatim.
// The old, single shared pattern matched "evidence:"/"confidence:" at
// the start of ANY line unconditionally, which silently deleted that
// entire real Market Overview sentence (it happens to open with
// "Evidence:") -- and, on the same real report's CAGR field, the
// mid-line variant deleted "| Confidence: 64/100 (Medium) | Evidence:
// [R12]" for the RIGHT reason (that line genuinely is metadata) but with
// no distinction from the wrong case above.
//
// Fix: "confidence"/"evidence"/"güven"/"referans" are now only treated
// as metadata when what immediately follows the colon is METADATA-
// SHAPED -- a bare number/fraction/parenthetical for confidence (e.g.
// "64/100", "(Medium)"), or a citation-bracket list for evidence (e.g.
// "[R12]") -- never when it introduces ordinary prose. Every other
// keyword's existing (unconditional, start-of-line) matching is
// completely unchanged.
const metadataShapedConfidenceEvidenceLinePattern =
  /^(?:[-*•]\s*)?(?:confidence|güven)\s*[:=]\s*(?=\d|\()|^(?:[-*•]\s*)?(?:evidence|referans)\s*[:=]\s*(?=\[|$)/i;
const midLineMetadataShapedConfidenceEvidencePattern =
  /\s*\|\s*(?:confidence|güven)\s*[:=]\s*(?:\d|\()[^|\n]*|\s*\|\s*(?:evidence|referans)\s*[:=]\s*(?:\[[^|\n]*)?/gi;
const otherMetadataLineKeywordsPattern =
  /^(?:[-*•]\s*)?(?:formula|assumptions?|varsayımlar|validation evidence|validation needed|metadata|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=]/i;
const midLineOtherMetadataKeywordsPattern =
  /\s*\|\s*(?:formula|assumptions?|varsayımlar|validation evidence|validation needed|metadata|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=][^|\n]+/gi;

function cleanPdfEvidenceMetadataText(value: string) {
  return normalizePdfText(value)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      return (
        !metadataShapedConfidenceEvidenceLinePattern.test(trimmed) &&
        !otherMetadataLineKeywordsPattern.test(trimmed)
      );
    })
    .map((line) =>
      line
        .replace(midLineOtherMetadataKeywordsPattern, "")
        .replace(midLineMetadataShapedConfidenceEvidencePattern, "")
        .replace(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmarkSource|benchmark)\s*=\s*[^|;\n]+/gi, "")
        .replace(/\bplanning assumptions require validation\b[.;]?/gi, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const moreTocSectionsCopy: Record<PdfLocale, (count: number) => string> = {
  en: (count) => `+${count} more section${count === 1 ? "" : "s"} in this report`,
  tr: (count) => `Bu raporda +${count} bölüm daha var`,
  de: (count) => `+${count} weitere${count === 1 ? "r" : ""} Abschnitt${count === 1 ? "" : "e"} in diesem Bericht`,
  fr: (count) => `+${count} section${count === 1 ? "" : "s"} supplémentaire${count === 1 ? "" : "s"} dans ce rapport`,
  es: (count) => `+${count} sección${count === 1 ? "" : "es"} más en este informe`,
};

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

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // consistency hardening): the genuine, first-class "Market Size"
  // section (field === "marketSize", its own real title is literally
  // "Market Size") was being misclassified as a "legacy TAM/SAM/SOM
  // duplicate" by the title regex below (`\bmarket\s+size\b` matches
  // the section's OWN title, independent of content quality or
  // confirmation status) -- dedupePdfSections then silently dropped a
  // valid, populated, "Data Confirmed" Market Size section out of the
  // PDF entirely, even though the web dashboard rendered it correctly.
  // Market Size and TAM/SAM/SOM are two DIFFERENT, both-legitimate
  // fields (see market-intelligence-graph.ts's own "Market / Industry
  // Baseline" distinction) -- this guard excludes the real field the
  // exact same way the existing tamsamsom guard above already protects
  // its own canonical field, so only a genuinely different, untitled or
  // stray legacy section can ever match the heuristics below.
  if (fieldKey === "tamsamsom" || fieldKey === "marketsize" || isTamSamSomTitle(section.title)) {
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
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
    // production consistency hardening): the genuine "Market Size"
    // section (field === "marketSize") is a different, first-class
    // field from TAM/SAM/SOM -- never a legacy duplicate of it -- but
    // was being silently dropped here whenever its own content
    // happened to include the report's standard "AI Executive Insight"
    // callout: contentContainsSizingInsight's second condition matches
    // on `${normalizedTitle}\n${normalizedContent}` including "market
    // size", which the section's OWN title trivially always satisfies,
    // independent of whether the content is actually a TAM/SAM/SOM
    // duplicate. Excluding the real field here mirrors the same guard
    // already protecting the canonical tamsamsom field two lines below.
    const fieldKey = section.field?.trim().toLowerCase();
    if (fieldKey === "marketsize") {
      return true;
    }
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
  // Must happen before normalizePdfSourceContent, not just before
  // parseCitations later: normalizePdfSourceContent's own block-splitting
  // treats a bare "X -- Y -- Z" line (the closing verdict paragraph's own
  // shape) as the start of a new source block, drops the paragraph's
  // heading (no Title:/Publisher:/URL: pattern, so getPdfSourceBlockKey
  // returns nothing to key it by) but leaves the "The deciding factor --
  // ..." fragment behind as a lone survivor with just enough shape to
  // pass the block-dedup filter -- confirmed live: by the time content
  // reached parseCitations, "Final Investment Decision" was already gone
  // but "The deciding factor" remained, so cutting it there was too late.
  const mergedSourceContentWithoutVerdict = stripMarketVerdictParagraph(mergedSourceContent);
  const normalizedSourceContent = normalizePdfSourceContent(mergedSourceContentWithoutVerdict);

  if (!normalizedSourceContent) {
    return nonSourceSections;
  }

  // removeDuplicatePdfExecutiveInsightText's line-level dedup is built for
  // prose (repeated AI-written insight sentences) and drops any exact-
  // repeated line over 24 chars -- which corrupts Market Intelligence's
  // deterministic bibliography, where a line like "Type: government/
  // statistical source" or "Type: company" is EXPECTED to repeat
  // correctly across many distinct, unrelated entries. Confirmed live:
  // this silently deleted the "Type:" line from most bibliography
  // entries and, worse, ate enough surrounding structure that a
  // downstream citation-boundary heuristic (parseCitations) lost track
  // of where the bibliography ended and the appended closing verdict
  // paragraph began, letting that paragraph's own prose get parsed as a
  // fabricated source entry. Recognized by its own unmistakable, code-
  // generated "Reference: [R#]" tag format -- skip the prose dedup pass
  // entirely for this shape; every other report type's Sources content
  // (which has no such tags) still gets it, unchanged.
  const isDeterministicBibliography = /(?:^|\n)Reference:\s*\[R\d+/.test(normalizedSourceContent);

  return [
    ...nonSourceSections,
    {
      ...sourceSections[0],
      field: "sources",
      title: "Sources",
      content: isDeterministicBibliography
        ? normalizedSourceContent
        : removeDuplicatePdfExecutiveInsightText(normalizedSourceContent),
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

function usesMobilePdfFlow() {
  return (
    window.matchMedia("(max-width: 1023px)").matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  );
}

function deliverPdf(
  pdf: PdfDocument,
  report: Pick<DashboardReport, "title">,
  setError: (message: string) => void
) {
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);

  if (usesMobilePdfFlow()) {
    try {
      window.location.assign(url);
    } catch (openError) {
      console.error(openError);
      URL.revokeObjectURL(url);
      setError("PDF could not be opened on this device. Please try again.");
    }

    return;
  }

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
    return;
  }

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

// Extracted verbatim from the inline body of downloadPdf() below --
// same code, same order, no logic changes -- so it can be called
// directly (from a Node script, generating a real PDF to inspect)
// without needing a React render tree. Parameter names intentionally
// match the identifiers the moved body already references, so no
// internal line needed to change.
export function buildStandardReportPdf({
  report,
  fontBase64,
}: {
  report: DashboardReport;
  fontBase64: string;
}) {
      const pdf = createPdfDocument();
      const { pageWidth, pageHeight, margin, contentWidth } = getPdfPageMetrics(pdf);
      const bodyX = margin + 20;
      const bodyWidth = contentWidth - 28;
      const bodyLineHeight = 5.25;
      // KPI explanation prose is denser than most sections, so it gets a
      // taller line-height (matching Executive Summary's existing
      // treatment) to avoid feeling cramped.
      const kpiBodyLineHeight = 5.75;
      const cardHeaderHeight = 24;
      const cardBottomPadding = 9;
      // Minimum gaps in mm equivalent to the requested pixel minimums
      // (1px ~= 0.2646mm at 96dpi), rounded up for a safety margin.
      // Reused for every section-to-section gap, not just SWOT, so the
      // "at least 32px between major sections" rule holds everywhere.
      const minHeadingToContentGap = 4.5; // >= 16px
      const minSectionGap = 9; // >= 32px
      const minPageBottomPadding = 11; // >= 40px (on top of the page margin)
      const maxUsableCardHeight = pageHeight - margin - margin;
      const normalizedSectionsBeforeLanguageRepair = dedupeReportSections(
        normalizeSavedPdfSectionsBeforeRender(report.sections)
      );
      const pdfLanguageSource =
        report.prompt?.trim() ||
        [report.title, report.type, ...normalizedSectionsBeforeLanguageRepair.map((section) => `${section.title}\n${section.content}`)]
          .filter(Boolean)
          .join("\n\n");
      // Market Intelligence PDFs trust the report's own saved language
      // (the value that actually governed generation) over re-detecting
      // from prompt text or browser locale, so a correctly-generated
      // report can never get a mismatched PDF. Every other report type
      // keeps the existing resolution order unchanged.
      const pdfLocale = resolvePdfPresentationLocale(
        isMarketIntelligenceDashboardReport(report)
          ? resolveMarketPdfLanguage({
              explicitLanguage: window.localStorage.getItem("zerinix_report_language"),
              savedReportLanguage: report.metadata?.reportLanguage,
              requestText: report.prompt,
            })
          : resolveReportLanguage({
              explicitLanguage: window.localStorage.getItem("zerinix_report_language"),
              requestText: report.prompt,
              uiLanguage: report.metadata?.reportLanguage,
            }),
        pdfLanguageSource
      );
      const languageRepair = repairReportLanguageSections(
        normalizedSectionsBeforeLanguageRepair,
        pdfLocale
      );
      const normalizedSections = languageRepair.sections;
      validateReportLanguageConsistency(
        [report.title, ...normalizedSections.map((section) => `${section.title}\n${section.content}`)].join("\n"),
        pdfLocale
      );
      const isLegalReport = isLegalRenderableReport(report);
      const basePdfSections = isLegalReport
        ? buildLegalReportSections(normalizedSections, pdfLocale, report.prompt)
        : compactExecutiveDecisionMemoSections(
            dedupeReportSections(
              dedupePdfSections(mergePdfSourceSections(normalizedSections))
            )
          );
      const pdfBaseSectionsWithBenchmark = isLegalReport
        ? basePdfSections
        : extractPdfValidationIntelligenceSection(
            insertPdfBenchmarkIntelligenceSection(
              basePdfSections,
              report.metadata?.benchmarkFit,
              pdfLocale,
              report.metadata?.benchmarkScore
            ),
            pdfLocale
          );
      // CRITICAL FIX -- apply presentation sanitization to ALL report
      // surfaces. Confirmed live: excluding "sources"/"externalEvidence"
      // by field name upstream (normalizeReport) was not enough --
      // buildLegalReportSections/mergePdfSourceSections above can
      // construct a FRESH sources-like section (e.g. "legalSources") from
      // the report's own citation content, entirely after normalizeReport
      // already ran, so an upstream-only exclusion could never catch it.
      // Filtered here, at the single array every downstream PDF surface
      // (the per-section render loop, the Table of Contents, cover-page
      // extraction) reads from, so none of them can independently
      // reintroduce a Sources/External Evidence page.
      const pdfSections = localizePdfReportSections(pdfBaseSectionsWithBenchmark, pdfLocale).filter(
        (section) => isUniversalCustomerFacingSection(section)
      );
      const localizedReportTitle = isLegalReport
        ? pdfLocale === "tr"
          ? "Hukuki Değerlendirme Raporu"
          : "Legal Assessment Report"
        : localizePdfPresentationLabel(report.title, pdfLocale);
      const isRealEstateReport =
        report.type === "Real Estate Investment Analysis" ||
        /real[\s-]?estate|gayrimenkul|arsa|arazi|tapu/i.test(report.title);
      const isMarketIntelligenceReport = isMarketIntelligenceDashboardReport(report);
      const isAcquisitionReport =
        report.type === "Acquisition Due Diligence Report" ||
        report.sections.some((section) => section.field === "valuationAnalysis");
      const businessIdea = isLegalReport
        ? normalizePdfText(report.prompt).slice(0, 220)
        : deriveBusinessDescriptionFromSections(report, pdfSections);
      // Built from the sanitized/filtered pdfSections (not basePdfSections)
      // -- this text is used only for regex-based cover-card value
      // extraction (extractScore/extractMetricValue/extractConfidence/...
      // below), and excluding the raw Sources/External Evidence content
      // eliminates any chance of an extraction pattern accidentally
      // matching inside a citation entry.
      const fullReportContent = pdfSections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      const tocEntries: Array<{ title: string; page: number }> = [];
      let y = margin;

      applyPdfFont(pdf, fontBase64);

      const paintPage = () => {
        paintPdfPageBackground(pdf, { pageWidth, pageHeight });
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
        drawPdfFooter(pdf, {
          pageWidth,
          pageHeight,
          margin,
          locale: pdfLocale,
          includePageCounter,
        });
      };

      const drawLogoMark = (x: number, logoY: number, size = 13) => {
        drawPdfLogoMark(pdf, x, logoY, size);
      };

      const drawTag = (label: string, x: number, tagY: number, width: number) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(x, tagY, width, 10, 5, 5, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor("#ccfbf1");
        pdf.text(label, x + 4, tagY + 6.4, { maxWidth: width - 8 });
      };

      const splitPdfReadableLines = (content: string, width: number) => {
        const repairedContent = repairPdfLineFragments(
          content.split("\n"),
          isOrphanBulletText
        ).join("\n");
        return splitPdfReadableLinesWithEngine({
          pdf,
          content: repairedContent,
          width,
          normalizeText: normalizePdfText,
          repairLineFragments: repairPdfLineFragments,
          isOrphanBulletText,
        });
      };

      const wrapPdfText = (text: string, width: number) =>
        wrapPdfTextWithEngine({ pdf, text, width, normalizeText: normalizePdfText });

      // Fixed-line-count cells (table cells, roadmap steps, scenario
      // snippets) hard-slice a wrapped line array to fit their budgeted
      // height; slicing alone silently drops the remainder with no
      // visual cue that content was cut. Mirrors the real-estate PDF
      // engine's own truncateLines(), which already does this correctly.
      const truncatePdfCellLines = (lines: string[], maxLines: number) => {
        if (lines.length <= maxLines) return lines;
        const output = lines.slice(0, maxLines);
        output[maxLines - 1] = `${output[maxLines - 1].replace(/[.,;:]*$/, "")}...`;
        return output;
      };

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

      const drawCoverPage = () => {
        const investmentScore =
          report.investmentScore?.totalScore ??
          extractScore(fullReportContent, "Total Investment Score") ??
          extractScore(fullReportContent, "Investment Score") ??
          extractScore(fullReportContent, "AI Investment Score");
        // Computed here, before recommendation/recommendationFill below,
        // so the cover badge's color can never disagree with the
        // Executive Summary's real decision.
        const marketExecutiveSummaryContent =
          report.sections.find((section) => section.field === "executiveSummary")?.content || "";
        // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
        // decision consistency bug"): confirmed live -- the PREVIOUS fix
        // here fell back to `buildExecutiveSnapshot(fullReportContent,
        // undefined, ...)` when no deterministic decision banner was
        // present. That fallback's extractDecision scans the ENTIRE
        // report (not just this section) for a bare GO/WAIT/PASS/...
        // keyword: virtually every Market Intelligence report mentions
        // "Go-to-Market" somewhere in its full text, and `\bGO\b` matches
        // the "GO" inside it (a hyphen is a non-word boundary) --
        // fabricating a "GO" cover badge regardless of the report's real
        // recommendation. This is the confirmed root cause of the live
        // defect: web (correctly scoped to just the executiveSummary
        // section) showed "MONITOR FOR A STAGED U.S. ...", while this
        // fallback, given the whole report, hit the "Go-to-Market" trap.
        // Now resolves through resolveMarketIntelligenceExecutiveDecision
        // -- the ONE canonical decision/confidence source for Market
        // Intelligence, which never falls through to that scan (its own
        // fallback tier returns the raw "Decision:" labeled text
        // verbatim, never re-scanned for a keyword) -- over the SAME
        // executiveSummary section content the web dashboard uses.
        //
        // TASK #23 -- prefer the persisted canonical decision snapshot
        // over re-parsing the banner text; falls back to the exact same
        // prose parse for every report without one.
        const marketDecision = isMarketIntelligenceReport
          ? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
              readMarketIntelligenceCanonicalState(report.metadata),
              marketExecutiveSummaryContent,
              pdfLocale === "tr" ? "Turkish" : "English"
            )
          : null;
        const marketDecisionText = marketDecision ? marketDecision.decisionLabel : "";
        const marketDecisionCategory = isMarketIntelligenceReport
          ? marketDecision?.canonicalDecision === "PROCEED"
            ? "GO"
            : marketDecision?.canonicalDecision === "REJECT"
              ? "NO_GO"
              : marketDecision?.canonicalDecision === "PROCEED_WITH_CONDITIONS" ||
                  marketDecision?.canonicalDecision === "PAUSE_PENDING_REVIEW"
                ? "CONDITIONAL"
                : marketDecisionColorCategory(marketDecisionText)
          : null;
        // Same canonical, locale-agnostic decision the Executive Summary
        // banner and the Executive Recommendation section below both read
        // from -- keeps the cover badge's color/label from ever disagreeing
        // with the Executive Summary the way independently re-deriving from
        // the raw investmentScore.recommendation ("GO"/"WAIT"/"PASS", a
        // different vocabulary than the Executive Summary's own "GO"/
        // "CONDITIONAL GO"/"NO GO") previously could.
        const coverExecutiveDecisionCode = !isMarketIntelligenceReport
          ? extractExecutiveDecisionFromText(marketExecutiveSummaryContent)?.code
          : null;
        const recommendation =
          coverExecutiveDecisionCode === "GO"
            ? "GO"
            : coverExecutiveDecisionCode === "NO_GO"
              ? "PASS"
              : coverExecutiveDecisionCode === "CONDITIONAL_GO"
                ? "WAIT"
                : report.investmentScore?.recommendation || detectRecommendation(fullReportContent) || "WAIT";
        const recommendationFill = isMarketIntelligenceReport
          ? marketDecisionCategory === "GO"
            ? "#064e3b"
            : marketDecisionCategory === "NO_GO"
              ? "#7f1d1d"
              : "#713f12"
          : recommendation === "GO"
            ? "#064e3b"
            : recommendation === "PASS"
              ? "#7f1d1d"
              : "#713f12";
        const recommendationText = isMarketIntelligenceReport
          ? marketDecisionCategory === "GO"
            ? "#bbf7d0"
            : marketDecisionCategory === "NO_GO"
              ? "#fecaca"
              : "#fde68a"
          : recommendation === "GO"
            ? "#bbf7d0"
            : recommendation === "PASS"
              ? "#fecaca"
              : "#fde68a";
        const executiveSnapshot = buildExecutiveSnapshot(
          fullReportContent,
          report.investmentScore,
          report.metadata?.reportQuality
        );
        const reportQualityBreakdown = getReportQualityBreakdown(
          report.metadata?.reportQuality,
          pdfLocale === "tr"
        );
        // buildExecutiveSnapshot/getReportQualityBreakdown are shared,
        // Business-Idea-Validation-shaped heuristics (they text-mine for
        // CAC/founder score/financial consistency and read report.investmentScore/
        // report.metadata.reportQuality, neither of which a Market Intelligence
        // report ever populates). Confirmed live: reusing them for a Market
        // Intelligence PDF put "Investor Ready" and a Risk Heatmap reading
        // "CAC: Low / Capital efficiency: Low" on the cover of a market
        // research report. Market Intelligence gets its confidence from
        // resolveMarketIntelligenceExecutiveDecision instead -- the SAME
        // canonical value the decision badge above was just resolved
        // from, read only from the deterministic banner's own matched
        // line (never extractConfidence's bare "any NN% anywhere in this
        // section" fallback, which risks attaching an unrelated
        // percentage mentioned in the executive summary's own prose).
        const marketConfidenceScore = marketDecision ? marketDecision.confidenceScore : null;
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // production consistency hardening): "Top 3 Risks" is the
        // deterministic banner's own label (formatExecutiveDecisionBrief),
        // only present when coverage was available at generation/save
        // time. When it's absent, this returned [] and the cover fell
        // back to buildExecutiveSnapshot's mainRisk -- an UNSCOPED,
        // keyword-based full-report scan (collectBullets) with no
        // section boundary, the same class of defect that produced the
        // malformed "combined AUM$150M) to validate attainable..." Next
        // Action fragment below. The market executiveSummary prompt
        // (market.ts) always instructs the model to write its own
        // "(4) Biggest Risk -- one sentence" regardless of whether the
        // deterministic banner is embedded, so falling back to THAT
        // labeled, scoped sentence (still confined to
        // marketExecutiveSummaryContent, never the full report) is a
        // real, coherent risk statement instead of an arbitrary fragment
        // from an unrelated section.
        // TASK #29E -- prefer the persisted MarketIntelligenceCanonicalState's
        // own topRisks[0] first -- the exact field the Executive Summary
        // itself is built from (market-intelligence-canonical-state.ts) --
        // over re-parsing the banner text below, so this cover's Main
        // Risk can never disagree with the Executive Summary's own Top
        // Risk. Falls back to the existing prose extraction unchanged for
        // any report without a persisted canonical state.
        const marketCanonicalTopRisk = isMarketIntelligenceReport
          ? readMarketIntelligenceCanonicalState(report.metadata)?.topRisks?.[0] || ""
          : "";
        const marketTopRisks = isMarketIntelligenceReport && marketCanonicalTopRisk
          ? [marketCanonicalTopRisk]
          : isMarketIntelligenceReport
          ? (() => {
              const bannerRisks = extractMarketBriefListLines(marketExecutiveSummaryContent, [
                "Top 3 Risks",
                "En Önemli 3 Risk",
                "Top 3 Risiken",
                "Top 3 des risques",
                "Los 3 riesgos principales",
              ]);
              if (bannerRisks.length > 0) {
                return bannerRisks;
              }
              const biggestRisk = extractMetricValueFromAliases(marketExecutiveSummaryContent, [
                "Biggest Risk",
                "En Büyük Risk",
                "Größtes Risiko",
                "Risque le plus important",
                "Mayor riesgo",
              ]);
              return biggestRisk ? [biggestRisk] : [];
            })()
          : [];
        const marketConfidenceFactors = isMarketIntelligenceReport
          ? [
              ...extractMarketBriefListLines(marketExecutiveSummaryContent, [
                "Confidence Supported By",
                "Confidence Reduced Because",
                "Güven Şunlarla Desteklendi",
                "Güven Şu Nedenlerle Düşürüldü",
                "Konfidenz gestützt durch",
                "Konfidenz verringert, weil",
                "Confiance soutenue par",
                "Confiance réduite parce que",
                "Confianza respaldada por",
                "Confianza reducida porque",
              ]),
            ]
          : [];
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // production consistency hardening): "Immediate Next Action" is
        // the deterministic banner's own label -- it never appears
        // anywhere in the market executiveSummary prompt (market.ts),
        // which instead always instructs the model to write its own
        // "(5) Recommendation -- at most 3 bullets, concrete next
        // actions only." When the banner isn't embedded (coverage
        // unavailable at generation/save time), this extraction ALWAYS
        // returned "", forcing the cover to fall back to
        // buildExecutiveSnapshot's nextAction -- an UNSCOPED, keyword-
        // based full-report scan (collectBullets, matching bare words
        // like "validate"/"action"/"pilot" anywhere in the ENTIRE
        // report) with no section boundary. Confirmed live: this
        // produced the malformed cover fragment "combined AUM$150M) to
        // validate attainable..." -- a mid-sentence clip lifted from
        // strategicRecommendations (an unrelated section that
        // legitimately contains the word "validate"), truncated to
        // ~46 characters. Falling back to the model's own scoped
        // "Recommendation" bullets (still confined to
        // marketExecutiveSummaryContent, never the full report) instead
        // gives a real, coherent next-action statement; if even that is
        // genuinely absent, marketNextAction stays "" and the cover
        // correctly falls through to the same honest unavailable state
        // as before -- never a random unscoped fragment.
        const marketNextAction = isMarketIntelligenceReport
          ? extractMetricValue(marketExecutiveSummaryContent, "Immediate Next Action") ||
            takeFirstListItemOrSentence(
              extractMetricValueFromAliases(marketExecutiveSummaryContent, [
                "Recommendation",
                "Öneri",
                "Empfehlung",
                "Recommandation",
                "Recomendación",
              ])
            )
          : "";
        const marketReportQualityLabel = isMarketIntelligenceReport
          ? marketConfidenceScore === null
            ? localizePdfPresentationLabel("Validation Required", pdfLocale)
            : marketConfidenceScore >= 65
              ? localizePdfPresentationLabel("High Confidence", pdfLocale)
              : marketConfidenceScore >= 40
                ? localizePdfPresentationLabel("Medium Confidence", pdfLocale)
                : localizePdfPresentationLabel("Low Confidence", pdfLocale)
          : "";
        const founderScore = executiveSnapshot.founderScoreValue ?? investmentScore;
        const legalConfidence =
          extractScore(fullReportContent, pdfLocale === "tr" ? "Güven" : "Confidence") ??
          extractConfidence(fullReportContent);
        const legalDecision = isLegalReport
          ? fullReportContent
              .match(/(?:Nihai tavsiye|Final recommendation|Karar|Assessment)\s*:\s*([A-ZÇĞİÖŞÜ ]{2,32})/i)?.[1]
              ?.trim()
              .toLocaleUpperCase(pdfLocale === "tr" ? "tr-TR" : "en-US") ||
            (pdfLocale === "tr" ? "KOŞULLU DEĞERLENDİRME" : "CONDITIONAL ASSESSMENT")
          : isMarketIntelligenceReport
            ? marketDecisionText
            : executiveSnapshot.decision;
        // Reads from basePdfSections (pre-sanitization-filter), not
        // pdfSections -- the "legalSources" section itself is now excluded
        // from pdfSections/rendering entirely, but the underlying source
        // COUNT (a bare number, not the URLs/publishers themselves) is
        // still a legitimate cover-page stat.
        const legalSourceCount = new Set(
          (basePdfSections.find((section) => section.field === "legalSources")?.content.match(/https?:\/\/[^\s)]+/g) || [])
        ).size;
        const overallInvestmentScore =
          extractScore(fullReportContent, "Overall Investment Score") ??
          investmentScore;
        const realEstateMainOpportunity =
          extractMetricValue(fullReportContent, "Main Opportunity") ||
          pdfSections.find((section) => section.field === "developmentPotential")
            ?.content ||
          "Not verified";

        paintPage();
        pdf.setFillColor("#020617");
        pdf.setDrawColor("#134e4a");
        pdf.roundedRect(margin, 18, contentWidth, pageHeight - 36, 8, 8, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin, 18, 2, pageHeight - 36, "F");

        drawLogoMark(margin + 12, 28, 14);
        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX EXECUTIVE DECISION CENTER", margin + 31, 37);

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
        const previewLines = wrapPdfText(
          isLegalReport
            ? `${pdfLocale === "tr" ? "Hukuki değerlendirme" : "Legal assessment"}: ${legalDecision}. ${pdfLocale === "tr" ? "Temel risk" : "Primary risk"}: ${executiveSnapshot.mainRisk}`
            : isMarketIntelligenceReport
              ? `${localizePdfPresentationLabel("Decision", pdfLocale)}: ${marketDecisionText || legalDecision}. ${localizePdfPresentationLabel("Main Risk", pdfLocale)}: ${marketTopRisks[0] || executiveSnapshot.mainRisk}`
              : `${localizePdfPresentationLabel("Decision", pdfLocale)}: ${executiveSnapshot.decision}. ${localizePdfPresentationLabel("Main Risk", pdfLocale)}: ${executiveSnapshot.mainRisk}`,
          contentWidth - 38
        ).slice(0, 2);
        const previewHeight = Math.max(21, 13 + previewLines.length * 4.1);
        pdf.setFillColor("#030712");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(margin + 12, previewY, contentWidth - 24, previewHeight, 5, 5, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin + 12, previewY + 4, 1.2, previewHeight - 8, "F");
        pdf.setFontSize(6.8);
        pdf.setTextColor("#99f6e4");
        pdf.text(localizePdfPresentationLabel("Executive Decision Snapshot", pdfLocale).toUpperCase(), margin + 18, previewY + 7.5);
        pdf.setFontSize(8.4);
        pdf.setTextColor("#e4e4e7");
        pdf.text(previewLines, margin + 18, previewY + 14.7, {
          lineHeightFactor: 1.16,
          maxWidth: contentWidth - 38,
        });

        const tagY = previewY + previewHeight + 5;
        drawTag(
          isAcquisitionReport
            ? localizePdfPresentationLabel("Due Diligence", pdfLocale)
            : isRealEstateReport
              ? localizePdfPresentationLabel("Due-Diligence Report", pdfLocale)
              : isLegalReport
                ? pdfLocale === "tr"
                  ? "Hukuki Analiz"
                  : "Legal Analysis"
                : isMarketIntelligenceReport
                  ? localizePdfPresentationLabel("Validation-Based", pdfLocale)
                  : localizePdfPresentationLabel("Investor Ready", pdfLocale),
          margin + 12,
          tagY,
          isLegalReport ? 42 : 36
        );
        drawTag(
          isLegalReport
            ? pdfLocale === "tr"
              ? "Karar Desteği"
              : "Decision Support"
            : localizePdfPresentationLabel(report.type, pdfLocale),
          margin + (isLegalReport ? 58 : 52),
          tagY,
          42
        );

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
        pdf.text(
          String(
            (isLegalReport
              ? legalConfidence
              : isRealEstateReport
                ? overallInvestmentScore
                : isMarketIntelligenceReport
                  ? marketConfidenceScore
                  : isAcquisitionReport
                    ? legalConfidence
                    : founderScore) ?? "--"
          ),
          scoreX + 20,
          scoreY + 31
        );
        pdf.setFontSize(6.5);
        pdf.setTextColor("#99f6e4");
        pdf.text(
          (isRealEstateReport
            ? "Overall Investment Score"
            : isLegalReport
              ? pdfLocale === "tr"
                ? "Kanıt Gücü"
                : "Evidence Strength"
              : isMarketIntelligenceReport
                ? localizePdfPresentationLabel("Confidence Score", pdfLocale)
                : isAcquisitionReport
                  ? localizePdfPresentationLabel("Deal Confidence", pdfLocale)
                  : localizePdfPresentationLabel("Founder Readiness Score", pdfLocale)
          ).toUpperCase(),
          scoreX + 12,
          scoreY + 43
        );

        pdf.setFillColor(recommendationFill);
        pdf.setDrawColor("#334155");
        pdf.roundedRect(scoreX + 66, scoreY, contentWidth - 102, 26, 5, 5, "FD");
        pdf.setFontSize(7);
        pdf.setTextColor(recommendationText);
        pdf.text(localizePdfPresentationLabel("Decision", pdfLocale).toUpperCase(), scoreX + 72, scoreY + 8);
        pdf.setFontSize(18);
        // This banner is a fixed single-line, fixed-height row -- extractDecision
        // normally returns a short keyword (GO/WAIT/NO-GO), but defend against
        // any longer text still reaching here (e.g. a malformed AI response
        // with no recognizable decision keyword anywhere) so it can never
        // overflow past the card or off the page edge the way an unbounded
        // pdf.text() call would.
        const decisionBannerWidth = contentWidth - 102 - 12;
        const decisionFirstLine = (pdf.splitTextToSize(legalDecision, decisionBannerWidth) as string[])[0] || "";
        const decisionDisplay =
          decisionFirstLine === legalDecision
            ? legalDecision
            : `${decisionFirstLine.replace(/\s+\S*$/, "")}…`;
        pdf.text(decisionDisplay, scoreX + 72, scoreY + 20);

        const cardWidth = (contentWidth - 86) / 2;
        const kpis = (isLegalReport
          ? [
              [pdfLocale === "tr" ? "Kanıt Gücü" : "Evidence Strength", legalConfidence === null ? "—" : `${legalConfidence}%`],
              [pdfLocale === "tr" ? "Usul Aciliyeti" : "Procedural Urgency", pdfLocale === "tr" ? "Derhâl süre kontrolü" : "Immediate deadline review"],
              [pdfLocale === "tr" ? "Zamanaşımı Riski" : "Limitation Risk", pdfLocale === "tr" ? "Tarih teyidi gerekli" : "Date verification required"],
              [pdfLocale === "tr" ? "Talep Gücü" : "Claim Viability", legalDecision],
              [pdfLocale === "tr" ? "Kaynak Kapsamı" : "Source Coverage", String(legalSourceCount)],
              [pdfLocale === "tr" ? "Rapor Türü" : "Report Type", pdfLocale === "tr" ? "Hukuki analiz" : "Legal analysis"],
            ]
          : isRealEstateReport
          ? [
              ["Confidence", executiveSnapshot.confidence],
              [
                "Evidence Quality",
                extractScore(fullReportContent, "Evidence Quality") === null
                  ? "Not verified"
                  : `${extractScore(fullReportContent, "Evidence Quality")}/100`,
              ],
              ["Main Risk", executiveSnapshot.mainRisk],
              ["Main Opportunity", realEstateMainOpportunity],
              ["Required Next Action", executiveSnapshot.nextAction],
              [
                "Zoning Risk",
                extractScore(fullReportContent, "Zoning Risk") === null
                  ? "Not verified"
                  : `${extractScore(fullReportContent, "Zoning Risk")}/100`,
              ],
            ]
          : isMarketIntelligenceReport
          ? [
              // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
              // production presentation hardening): "Confidence Score: —"
              // sitting directly above "Report Quality: Validation
              // Required" (the SAME underlying null confidence, resolved
              // to a semantic label two rows down) was exactly the
              // internally-incoherent pairing this fix removes -- reuses
              // the identical label rather than inventing new wording.
              [
                localizePdfPresentationLabel("Confidence Score", pdfLocale),
                marketConfidenceScore === null
                  ? localizePdfPresentationLabel("Validation Required", pdfLocale)
                  : `${marketConfidenceScore}%`,
              ],
              [localizePdfPresentationLabel("Report Quality", pdfLocale), marketReportQualityLabel],
              [localizePdfPresentationLabel("Main Risk", pdfLocale), marketTopRisks[0] || executiveSnapshot.mainRisk],
              [localizePdfPresentationLabel("Next Action", pdfLocale), marketNextAction || executiveSnapshot.nextAction],
              [localizePdfPresentationLabel("Report Type", pdfLocale), localizePdfPresentationLabel(report.type, pdfLocale)],
            ]
          : isAcquisitionReport
          ? [
              [localizePdfPresentationLabel("Valuation", pdfLocale), pdfSections.find((section) => section.field === "valuationAnalysis")?.content || "Not verified"],
              [localizePdfPresentationLabel("Strategic Fit", pdfLocale), pdfSections.find((section) => section.field === "strategicFit")?.content || "Not verified"],
              [localizePdfPresentationLabel("Financing Structure", pdfLocale), pdfSections.find((section) => section.field === "financingStructure")?.content || "Not verified"],
              [localizePdfPresentationLabel("Revenue Synergies", pdfLocale), pdfSections.find((section) => section.field === "revenueSynergies")?.content || "Not verified"],
              [localizePdfPresentationLabel("Integration Risks", pdfLocale), pdfSections.find((section) => section.field === "integrationRisks")?.content || "Not verified"],
              [localizePdfPresentationLabel("Deal Risks", pdfLocale), pdfSections.find((section) => section.field === "dealRisks")?.content || "Not verified"],
            ]
          : [
              [localizePdfPresentationLabel("Confidence Score", pdfLocale), executiveSnapshot.confidence],
              [localizePdfPresentationLabel("Financial Quality", pdfLocale), executiveSnapshot.financialQuality],
              [localizePdfPresentationLabel("Report Quality", pdfLocale), executiveSnapshot.reportQuality],
              [localizePdfPresentationLabel("Main Risk", pdfLocale), executiveSnapshot.mainRisk],
              [localizePdfPresentationLabel("Next Action", pdfLocale), executiveSnapshot.nextAction],
              [localizePdfPresentationLabel("Report Type", pdfLocale), localizePdfPresentationLabel(report.type, pdfLocale)],
            ]).map(([label, value]) => {
          // Same bug class getFinancialLayout above already documents:
          // wrapPdfText measures at whatever font size happens to be active
          // on `pdf` right now (here, still 18pt left over from the
          // Decision banner just drawn), not the 7.5/9.5pt these labels and
          // values actually draw at below -- which forced short words like
          // "CONFIDENCE" to hard-wrap mid-word. Pin to the real draw-time
          // sizes for measurement only, then restore.
          const previousCoverFontSize = pdf.getFontSize();
          pdf.setFontSize(7.5);
          const labelLines = wrapPdfText(label.toUpperCase(), cardWidth - 8).slice(0, 2);
          pdf.setFontSize(9.5);
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // production presentation hardening, round 2): the prior fix
          // widened conciseCoverText's own pre-wrap budget to its 94-char
          // default, but this card's 2-LINE cap (truncatePdfCellLines
          // below) was untouched -- at this card's actual wrap width
          // (~40mm, roughly 20-24 chars/line), a 94-char sentence still
          // wraps to 4-5 lines, so real Main Risk/Next Action text kept
          // getting clipped with "..." after only 2 of those lines. Raised
          // to 5 lines (enough for conciseCoverText's own worst case) so a
          // real finding is never cut short by this card specifically --
          // everything drawn below this KPI grid (insightY, a few lines
          // down) already derives its Y-position from kpiGridHeight, the
          // ACTUAL summed row heights, so a taller card here safely pushes
          // later content down instead of overlapping it. conciseCoverText
          // and truncatePdfCellLines' own "..." remain the safety net for
          // the rare sentence that still overflows even 5 lines.
          const valueLines = truncatePdfCellLines(
            wrapPdfText(conciseCoverText(value), cardWidth - 8),
            5
          );
          pdf.setFontSize(previousCoverFontSize);
          const height = Math.max(18, 7 + labelLines.length * 3.1 + valueLines.length * 4.2);

          return { labelLines, valueLines, height };
        });
        const rowHeights = Array.from({ length: Math.ceil(kpis.length / 2) }, (_, row) =>
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

        const getInsightPanelLayout = (items: string[], panelWidth: number, maxItems = 3) => {
          const lineBlocks = (items.length ? items : ["See detailed section analysis."])
            .slice(0, maxItems)
            .map((item) => wrapPdfText(conciseCoverText(item), panelWidth - 15).slice(0, 2));
          const height = Math.max(
            34,
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
        const legalRiskItems = extractBullets(
          pdfSections.find((section) => section.field === "legalProceduralRisks")?.content || "",
          ""
        );
        const legalActionItems = extractBullets(
          pdfSections.find((section) => section.field === "legalImmediateActions")?.content || "",
          ""
        );
        const strengthsLayout = getInsightPanelLayout(
          isLegalReport
            ? legalRiskItems
          : isRealEstateReport
            ? [
                ["Legal Risk", "Title / Ownership Risk"],
                ["Market Evidence", "Market Evidence"],
                ["Infrastructure", "Access and Infrastructure"],
                ["Environmental Risk", "Environmental and Geotechnical Risk"],
                ["Development Potential", "Development Potential"],
              ].map(([label, metric]) => {
                const value = extractScore(fullReportContent, metric);
                return `${label}: ${value === null ? "Not verified" : `${value}/100`}`;
              })
            : isMarketIntelligenceReport
              ? marketTopRisks
              : executiveSnapshot.riskHeatmap.map((risk) => `${risk.label}: ${risk.level}`),
          insightWidth
        );
        const confidenceOrQualityItems = isLegalReport
          ? legalActionItems
          : isMarketIntelligenceReport
          ? marketConfidenceFactors
          : reportQualityBreakdown.length
          ? reportQualityBreakdown.map((item) => `${item.label}: ${item.value}`)
          : executiveSnapshot.confidenceRadar.map((dimension) =>
              `${dimension.label}: ${dimension.score === null ? "Not yet measured" : `${dimension.score}%`}`
            );
        const risksLayout = getInsightPanelLayout(
          confidenceOrQualityItems,
          insightWidth,
          reportQualityBreakdown.length ? 6 : 3
        );
        const insightHeight = Math.max(strengthsLayout.height, risksLayout.height);
        const kpiGridHeight = rowHeights.reduce((sum, height) => sum + height, 0) + (rowHeights.length - 1) * 4;
        const insightY = scoreY + 32 + kpiGridHeight + 8;
        drawInsightPanel(
          isLegalReport
            ? pdfLocale === "tr"
              ? "Temel Hukuki Riskler"
              : "Key Legal Risks"
          : isRealEstateReport
            ? "Real Estate Decision Factors"
            : isMarketIntelligenceReport
              ? localizePdfPresentationLabel("Top Risks", pdfLocale)
              : localizePdfPresentationLabel("Risk Heatmap", pdfLocale),
          strengthsLayout.lineBlocks,
          margin + 12,
          insightY,
          insightWidth,
          insightHeight,
          "#14b8a6"
        );
        drawInsightPanel(
          isLegalReport
            ? pdfLocale === "tr"
              ? "Hemen Atılacak Adımlar"
              : "Immediate Actions"
          : isMarketIntelligenceReport
            ? localizePdfPresentationLabel("Confidence Factors", pdfLocale)
          : reportQualityBreakdown.length
            ? localizePdfPresentationLabel("Report Quality", pdfLocale)
            : localizePdfPresentationLabel("Confidence Radar", pdfLocale),
          risksLayout.lineBlocks,
          margin + 21 + insightWidth,
          insightY,
          insightWidth,
          insightHeight,
          "#f97316"
        );

        drawFooter();
      };

      const drawExecutiveDecisionIntelligencePage = (
        summary: ExecutiveDecisionIntelligenceSummary
      ) => {
        paintPage();
        pdf.setFillColor("#020617");
        pdf.setDrawColor("#134e4a");
        pdf.roundedRect(margin, 18, contentWidth, pageHeight - 36, 8, 8, "FD");
        pdf.setFillColor("#0ea5e9");
        pdf.rect(margin, 18, 2, pageHeight - 36, "F");

        let cursorY = 36;
        pdf.setFontSize(9);
        pdf.setTextColor("#7dd3fc");
        pdf.text(
          pdfLocale === "tr" ? "YÖNETİCİ KARAR ZEKASI" : "EXECUTIVE DECISION INTELLIGENCE",
          margin + 12,
          cursorY
        );
        cursorY += 12;

        if (summary.verdict) {
          pdf.setFontSize(15);
          pdf.setTextColor("#f8fafc");
          const verdictLines = wrapPdfText(stripReportPresentationArtifacts(summary.verdict), contentWidth - 24);
          for (const line of verdictLines) {
            pdf.text(line, margin + 12, cursorY);
            cursorY += 7;
          }
          cursorY += 3;
        }

        if (summary.recommendation) {
          pdf.setFontSize(10.5);
          pdf.setTextColor("#cbd5e1");
          const recommendationLines = wrapPdfText(
            stripReportPresentationArtifacts(summary.recommendation),
            contentWidth - 24
          );
          for (const line of recommendationLines) {
            pdf.text(line, margin + 12, cursorY);
            cursorY += 5.5;
          }
          cursorY += 3;
        }

        if (summary.aggregateConfidence !== null) {
          pdf.setFontSize(10);
          pdf.setTextColor("#94a3b8");
          pdf.text(
            `${pdfLocale === "tr" ? "Toplam güven" : "Aggregate confidence"}: ${summary.aggregateConfidence}/100`,
            margin + 12,
            cursorY
          );
          cursorY += 10;
        }

        const badges: string[] = [];
        if (summary.qualityPassed !== null) {
          badges.push(`Quality: ${summary.qualityPassed ? "Passed" : "Flagged"}`);
        }
        if (summary.consistencyPassed !== null) {
          badges.push(`Consistency: ${summary.consistencyPassed ? "Passed" : "Flagged"}`);
        }
        if (summary.reproducibility.present) {
          badges.push(
            `Reproducibility: ${summary.reproducibility.status === "fingerprinted" ? "Fingerprinted" : "Insufficient data"}`
          );
        }
        if (summary.version.present && summary.version.reportSchemaVersion) {
          badges.push(`Schema: ${summary.version.reportSchemaVersion}`);
        }

        let badgeX = margin + 12;
        for (const badge of badges) {
          const badgeWidth = pdf.getTextWidth(badge) + 10;
          if (badgeX + badgeWidth > margin + contentWidth - 12) {
            badgeX = margin + 12;
            cursorY += 12;
          }
          drawTag(badge, badgeX, cursorY, badgeWidth);
          badgeX += badgeWidth + 6;
        }

        drawFooter();
      };

      drawCoverPage();
      // CRITICAL FIX -- confirmed live: this page was never gated to
      // exclude Market Intelligence, even though the Executive Decision
      // System is deliberately scoped to Business Idea Validation only
      // (see app/api/plan/route.ts's isSupportedExecutiveDecisionSystemContext)
      // and MI already has its own, separate canonical decision resolver
      // (resolveMarketIntelligenceExecutiveDecision, used on the cover
      // page above). Gated here as defense in depth, matching the same
      // web-dashboard fix (page.tsx's ExecutiveDecisionIntelligencePanel
      // call site) -- an MI PDF must never carry a second, uncoordinated
      // "verdict" page that could disagree with the cover page's Decision.
      const executiveDecisionIntelligenceSummary = isMarketIntelligenceReport
        ? null
        : readExecutiveDecisionIntelligenceSummary(report.metadata);
      if (executiveDecisionIntelligenceSummary) {
        pdf.addPage();
        drawExecutiveDecisionIntelligencePage(executiveDecisionIntelligenceSummary);
      }
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
          ? new Date(report.createdAt).toLocaleDateString(pdfLocaleToBcp47[pdfLocale])
          : localizePdfPresentationLabel("No date", pdfLocale)
      }`;
      pdf.setFontSize(8.5);
      pdf.setTextColor("#a1a1aa");
      pdf.text(meta, margin, y, { maxWidth: contentWidth });
      y += 9;

      const summaryCards = [
        `${pdfSections.length} ${localizePdfPresentationLabel("Sections", pdfLocale)}`,
        isLegalReport
          ? pdfLocale === "tr"
            ? "Hukuki Analiz"
            : "Legal Analysis"
          : localizePdfPresentationLabel(report.type, pdfLocale),
        isRealEstateReport
          ? localizePdfPresentationLabel("Due-Diligence Report", pdfLocale)
          : isLegalReport
            ? pdfLocale === "tr"
              ? "Karar Desteği"
              : "Decision Support"
            : isMarketIntelligenceReport
              ? localizePdfPresentationLabel("Validation-Based", pdfLocale)
              : localizePdfPresentationLabel("Investor Ready", pdfLocale),
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

      const getTamRows = (visualContent: string, rawContent = "") =>
        ([
          ["TAM", "#134e4a"],
          ["SAM", "#115e59"],
          ["SOM", "#5eead4"],
        ] as const).map(([label, color]) => {
          // getTamVisualContent already strips the section down to just its
          // "LABEL: value" lines, but drops a label entirely when the value
          // doesn't start immediately after the colon (e.g. "SOM: near-term
          // obtainable share is $3-5M..."). Fall back to this section's own
          // prose -- not the whole report -- before ever considering
          // fullReportContent, so an unrelated number from another section
          // can't win over this section's real, just-differently-phrased
          // value.
          const value =
            extractMarketSizeValue(visualContent, label) ||
            extractMarketSizeValue(rawContent, label) ||
            extractMarketSizeValue(`${visualContent}\n${fullReportContent}`, label);
          const rowHeight = 15;

          return { label, color, value, rowHeight };
        });

      // Fixed footprint for the concentric TAM/SAM/SOM circle diagram
      // below (2 * tamCircleMaxRadius plus top/bottom padding), plus 27mm
      // (9mm per legend row) so each row has room for its own two-line
      // planning-assumption sentence beneath the value -- independent of
      // content length, since the diagram's size never varies with text
      // length the way the old stacked-row layout did.
      const tamCircleVisualHeight = tamCircleMaxRadius * 2 + 8 + 27;
      const getTamVisualHeight = () => tamCircleVisualHeight;

      // Fixed footprint for the Market Metrics dashboard below -- shared
      // between drawSectionVisual (drawing) and getVisualHeight
      // (pagination budgeting) so the two never disagree on how much
      // space the visual needs.
      const marketMetricsDashboardHeight = 30;
      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
      // layout hardening): this used to be a single FIXED 36mm constant
      // for every Strategic Recommendation card regardless of how much
      // actual text (action sentence, Owner/Timeline/Budget/Success
      // Metric fields, Decision Gate) each recommendation carried.
      // Actions 3 and 4 (row 2) truncated/overlapped visibly in
      // production while 1-2 (row 1) looked fine only because row 2's
      // own opaque card background happened to paint over row 1's
      // overflow -- row 2 has nothing drawn after it, so ITS overflow
      // was fully exposed. computeRecommendationCardLayout replaces the
      // fixed constant with a REAL per-card height derived from that
      // card's own wrapped action-text line count, field-row count, and
      // whether a Decision Gate is present -- called identically by both
      // drawSectionVisual (drawing) and getVisualHeight (pagination
      // budgeting) so the two can never disagree, exactly like the fixed
      // constant did before, just content-aware instead of arbitrary.
      const recommendationCardGap = 3;
      const recommendationCardMinHeight = 36;
      // TASK #17 -- fixed height reserved for the "Current Decision: X"
      // line drawn above the recommendation cards (see drawSectionVisual's
      // own strategic-recommendation branch), read once here so
      // getVisualHeight (pagination budgeting) and drawSectionVisual
      // (drawing) can never disagree about how much space it needs.
      const strategicRecommendationDecisionBadgeHeight = 7;
      // TASK #31 -- read once, reused by both computeRecommendationCardLayout
      // (height math) and the strategic-recommendation draw branch below
      // (decision badge + per-card classification), so layout and drawing
      // can never classify or gate a card differently from each other.
      const recommendationCanonicalState = readMarketIntelligenceCanonicalState(report.metadata);
      const computeRecommendationCardLayout = (item: string, cardWidth: number) => {
        const signals = extractRecommendationSignals(item);
        const { timeframe, metric, budget, owner, gate, activity, evidenceTie } = signals;
        // TASK #31 -- see app/dashboard/[id]/page.tsx's identical
        // strategic-recommendation branch for the full comment. The
        // effective gate (model's own gate text, or the conservative
        // downgrade reason when none was written) must be computed HERE,
        // not just at draw time, since it directly affects gateReservedHeight
        // below -- drawing a longer auto-generated caution line than the
        // card reserved room for would silently overlap the next card.
        // TASK #38 -- classifyStrategicRecommendationValidation wraps
        // the same Task #31 classification with a finer evidence/
        // benchmark/planning-assumption/validation-target provenance and,
        // when structurally safe, a link to the single controlling
        // evidence gap and its decision threshold.
        const classification = classifyStrategicRecommendationValidation({
          item,
          signals,
          canonicalState: recommendationCanonicalState,
          language: pdfLocale === "tr" ? "Turkish" : "English",
        });
        const numericAssumptionSuffix = classification.provenance
          ? ` (${localizeRecommendationProvenance(classification.provenance, pdfLocale === "tr" ? "Turkish" : "English")})`
          : "";
        const effectiveGate = gate || classification.downgradeReason || "";
        pdf.setFontSize(6);
        // TASK #25C -- confirmed live (real persisted report): capping
        // this at 2 lines silently ellipsized real action text whenever
        // a recommendation's actual sentence needed more room, which
        // Task #25's requirement explicitly forbids ("do not silently
        // truncate content to make it fit"). The card's own height
        // below is already fully derived from actionLines.length, so
        // removing the cap simply lets the card grow to fit its real
        // text -- no other call site re-truncates this array (see the
        // draw call in the strategic-recommendation pagination branch),
        // so the full, untruncated action always reaches the page.
        const actionLines = wrapPdfText(localizePdfPresentationText(item, pdfLocale), cardWidth - 13);
        // TASK #29H -- Activity/Evidence Tie added alongside the
        // pre-existing 4 fields so a fully-populated recommendation (now
        // correctly grouped into ONE item, see extractRecommendationItems'
        // own fix) can show all of its real metadata as labeled fields
        // instead of leaving 2 of them buried in the action paragraph.
        const fields = (
          [
            ["Owner", owner],
            ["Timeline", timeframe ? `${timeframe}${numericAssumptionSuffix}` : ""],
            ["Budget", budget ? `${budget}${numericAssumptionSuffix}` : ""],
            ["Success Metric", metric ? `${metric}${numericAssumptionSuffix}` : ""],
            ["Activity", activity],
            ["Evidence Tie", evidenceTie],
          ] as const
        ).filter(([, value]) => value);
        const fieldsTopY = 7.8 + actionLines.length * 3.3 + 2.5;
        // TASK #29H -- raised from 4 to 6 (3 rows of 2) to match the 2
        // new fields above -- a fully-populated recommendation must never
        // have Activity/Evidence Tie silently dropped once grouping
        // correctly keeps all of a recommendation's metadata on one card
        // (Task #25's "never silently truncate content" requirement).
        const fieldsRows = fields.length > 0 ? Math.ceil(Math.min(fields.length, 6) / 2) : 0;
        const contentBottom =
          fieldsRows > 0 ? fieldsTopY + (fieldsRows - 1) * 5.6 + 5.5 : fieldsTopY + 3;
        const gateReservedHeight = effectiveGate ? 9 : 0;
        const height = Math.max(recommendationCardMinHeight, contentBottom + gateReservedHeight);

        return {
          timeframe,
          metric,
          budget,
          owner,
          gate: effectiveGate,
          activity,
          evidenceTie,
          actionLines,
          fields,
          fieldsTopY,
          height,
          classification,
        };
      };
      const computeRecommendationRowHeights = (items: string[], cardWidth: number) => {
        const cards = items.map((item) => computeRecommendationCardLayout(item, cardWidth));
        const rowHeights = Array.from({ length: Math.ceil(cards.length / 2) }, (_, row) =>
          Math.max(cards[row * 2]?.height ?? 0, cards[row * 2 + 1]?.height ?? 0)
        );

        return { cards, rowHeights };
      };

      const getTamVisualContent = (content: string) =>
        (["TAM", "SAM", "SOM"] as const)
          .map((label) => {
            const value = extractMarketSizeVisualValue(content, label);

            return value ? `${label}: ${value}` : "";
          })
          .filter(Boolean)
          .join("\n");

      // SWOT bullet line pitch/box padding, named so the height formula
      // below and the drawing code in drawSectionVisual stay in sync --
      // changing one without the other would either crowd the text or
      // under-report the box height (letting text spill past the box).
      const swotBulletLineHeight = 4.6;
      const swotBoxBottomPadding = 5;
      const getSwotLayout = (content: string, width: number) => {
        // pdf.splitTextToSize() measures wrapping using whatever font
        // size happens to be active on `pdf` at call time -- it takes
        // no size argument of its own. This function is called both
        // for height budgeting (before the section title is drawn,
        // whatever font size the previous section left behind) and for
        // actual drawing (right after the title's setFontSize(14)), so
        // without pinning the size explicitly here, those two calls
        // measure the same bullets at two different font sizes and
        // disagree on how many lines they wrap to -- which is exactly
        // what let SWOT boxes render taller than their budgeted card
        // height and spill into the next section. Pin to the real
        // bullet font size (matching the draw call below) and restore
        // whatever was active before, since this is otherwise called
        // as a pure measurement function.
        const previousFontSize = pdf.getFontSize();
        pdf.setFontSize(6.6);
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
            .map((bullet) => pdf.splitTextToSize(`• ${bullet}`, boxWidth - 7) as string[]);
          const textLineCount = Math.max(1, bulletLines.reduce((count, lines) => count + lines.length, 0));
          const boxHeight = Math.max(31, 11 + textLineCount * swotBulletLineHeight + swotBoxBottomPadding);

          return { label, color, bulletLines, boxHeight };
        });
        pdf.setFontSize(previousFontSize);
        const firstRowHeight = Math.max(items[0]?.boxHeight ?? 31, items[1]?.boxHeight ?? 31);
        const secondRowHeight = Math.max(items[2]?.boxHeight ?? 31, items[3]?.boxHeight ?? 31);

        return {
          gap,
          boxWidth,
          items,
          rowHeights: [firstRowHeight, secondRowHeight],
          totalHeight: firstRowHeight + gap + secondRowHeight,
        };
      };

      const getFinancialLayout = (content: string, width: number) => {
        // Same class of bug the SWOT layout above already documents and
        // fixes: pdf.splitTextToSize()/wrapPdfText() measure wrapping at
        // whatever font size happens to be active on `pdf` when called,
        // which varies depending on whether this ran for height
        // budgeting (getVisualHeight, before this card's own font is
        // set) or for the actual draw call -- and drawSectionVisual
        // draws labelLines at 6.2 and detailLines/descriptionLines at
        // 5.8 (below), neither of which was pinned here before. Pin
        // each measurement to its real draw-time font and restore
        // whatever was active, since this is otherwise a pure
        // measurement function.
        const previousFontSize = pdf.getFontSize();
        const metricContent = content;
        const labels = normalizePdfFinancialMetrics(content, fullReportContent);
        const columns = 3;
        const itemWidth = (width - (columns - 1) * 3) / columns;
        const items = labels
          .map((item) => {
            const value = item.value;
            const compactValue = item.compactValue;
            pdf.setFontSize(6.2);
            const labelLines = wrapPdfText(item.label, itemWidth - 4).slice(0, 2);
            const description = extractShortDescription(metricContent, item.aliases);
            pdf.setFontSize(5.8);
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
        pdf.setFontSize(previousFontSize);
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

      // Shared by drawSectionVisual's Executive Summary branch (drawing)
      // and getVisualHeight (pagination budgeting) -- same class of fix
      // as getSwotLayout/getFinancialLayout above: computing the
      // decision/confidence/why/top-risk/etc. values AND their wrapped
      // line counts in exactly one place is what guarantees the height
      // reserved for this card always matches what actually gets drawn
      // in it. Also the root fix for ticket-reported truncation of Why/
      // Top Risk/Information Required/Next Action: those 4 values
      // previously always drew through drawSingleLine (a single-line-
      // only helper that hard-truncates with an ellipsis regardless of
      // available page space) inside a hardcoded 15mm-tall tile. Now
      // wraps up to 4 lines and only grows the tile past its original
      // 15mm height when the content actually needs more room.
      const getExecutiveDecisionCardLayout = (content: string, width: number) => {
        const whyLabels = localizedLabelVariants("why");
        const topRisksLabels = localizedLabelVariants("topRisks");
        const missingEvidenceLabels = localizedLabelVariants("missingEvidence");
        const whatWouldChangeLabels = localizedLabelVariants("whatWouldChangeThisDecision");
        const immediateNextActionLabels = localizedLabelVariants("immediateNextAction");
        const why = extractMetricValueFromAliases(content, whyLabels);
        // TASK #29F -- confirmed live (real persisted report): for Market
        // Intelligence, extractAliasedSectionSnippet captures EVERYTHING
        // between "Top 3 Risks:" and the next stop label -- i.e. all
        // three numbered risk items concatenated ("1.\n<risk 1>\n2.\n<risk
        // 2>\n3.\n<risk 3>"), not just the first one. That produced a
        // "Top Risk" card that both truncated mid-sentence AND kept
        // running into the NEXT risk's text ("continuing with additional
        // risk context"), and could never match the cover's own
        // canonical-state-first Main Risk value. Reads the exact same
        // canonical topRisks[0] field the cover (marketTopRisks/
        // marketCanonicalTopRisk above) already prefers, falling back to
        // just the FIRST item of the legacy snippet (never the whole
        // block) only when no canonical state was persisted. Every other
        // report kind's identical extraction is completely unchanged.
        const topRisk = isMarketIntelligenceReport
          ? readMarketIntelligenceCanonicalState(report.metadata)?.topRisks?.[0] ||
            takeFirstListItemOrSentence(extractAliasedSectionSnippet(content, topRisksLabels, missingEvidenceLabels))
          : extractAliasedSectionSnippet(content, topRisksLabels, missingEvidenceLabels);
        const missingEvidence = extractAliasedSectionSnippet(content, missingEvidenceLabels, whatWouldChangeLabels);
        const whatWouldChange = extractMetricValueFromAliases(content, whatWouldChangeLabels);
        // TASK #35 -- structured, canonical-state-derived evidence gaps
        // (market-intelligence-evidence-gaps.ts) rather than raw prose.
        // "Information Required Before Decision" must state WHAT is
        // missing and WHY it matters, derived from the SAME
        // decisionCriticalEvidence pillars the canonical decision itself
        // gates on -- never independently re-derived from this section's
        // own prose. Falls back to the pre-existing prose extraction
        // exactly as before for any report without canonical state.
        const marketDecisionChangeState = isMarketIntelligenceReport
          ? resolveMarketIntelligenceDecisionChangeState(recommendationCanonicalState, pdfLocale === "tr" ? "Turkish" : "English")
          : null;
        const marketTopEvidenceGap =
          marketDecisionChangeState && marketDecisionChangeState.materialGaps.length > 0
            ? marketDecisionChangeState.materialGaps[0]
            : null;
        const marketInformationRequired = marketTopEvidenceGap
          ? `${marketTopEvidenceGap.label}: ${marketTopEvidenceGap.evidenceRequired}`
          : null;
        const nextAction = extractMetricValueFromAliases(content, immediateNextActionLabels);

        // CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical
        // decision consistency bug"): confirmed live -- the PREVIOUS fix
        // here fell back to `buildExecutiveSnapshot(fullReportContent,
        // undefined, ...)` for decision, and `extractConfidence(fullReportContent)`
        // for confidence, whenever this section's own deterministic
        // banner wasn't found. Both scan the ENTIRE report: extractDecision
        // matches "GO" inside "Go-to-Market" (a phrase virtually every
        // Market Intelligence report mentions somewhere), and
        // extractConfidence's bare percentage fallback can attach an
        // unrelated "NN%" mentioned anywhere in the report near the word
        // "confidence". This is the confirmed root cause of the live
        // defect (PDF cover/card showing "GO"/"30%" while the web report
        // correctly showed a conservative "MONITOR..." verdict with no
        // confidence figure). Now resolves through
        // resolveMarketIntelligenceExecutiveDecision -- the ONE
        // canonical decision/confidence source for Market Intelligence,
        // which never falls through to either unsafe scan.
        //
        // TASK #23 -- prefer the persisted canonical decision snapshot
        // over re-parsing the banner text; falls back to the exact same
        // prose parse for every report without one.
        const marketDecision = isMarketIntelligenceReport
          ? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
              readMarketIntelligenceCanonicalState(report.metadata),
              content,
              pdfLocale === "tr" ? "Turkish" : "English"
            )
          : null;
        const decisionMatch = extractExecutiveDecisionFromText(content);
        const decisionLabel = marketDecision
          ? marketDecision.decisionLabel
          : decisionMatch?.token.toUpperCase() ||
            formatDecisionLabel(report.investmentScore?.recommendation || detectRecommendation(content) || "") ||
            "—";
        const confidence = marketDecision
          ? marketDecision.confidenceScore
          : extractConfidence(content) ??
            report.investmentScore?.confidence ??
            extractConfidence(fullReportContent) ??
            extractScore(fullReportContent, "Investment Score");

        const isTurkishPdf = pdfLocale === "tr";
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // production presentation hardening): a bare "—" for Confidence
        // reads as an unexplained gap, not a stated evidence state --
        // especially confusing right next to "Report Quality" on the
        // SAME card, which already resolves this identical null case to
        // the semantic localizePdfPresentationLabel("Validation
        // Required", pdfLocale) a few lines above (marketReportQualityLabel).
        // Reusing that exact label (rather than inventing new wording)
        // keeps the two rows internally consistent -- never fabricates a
        // number, only replaces an unexplained placeholder with the
        // same honest state already shown elsewhere on this card.
        const recItems: Array<[string, string]> = [
          [
            "Confidence",
            confidence === null
              ? localizePdfPresentationLabel("Validation Required", pdfLocale)
              : `${confidence}%`,
          ],
          [
            "Why",
            why ||
              extractKeywordInsight(fullReportContent, ["opportunity", "market"]) ||
              (isTurkishPdf ? "Gerekçe, yönetici kararı bölümünde detaylandırılmıştır" : "Rationale is detailed in the executive decision"),
          ],
          [
            "Top Risk",
            topRisk ||
              extractKeywordInsight(fullReportContent, ["risk", "threat"]) ||
              (isTurkishPdf ? "Ana risk, risk analizi bölümünde detaylandırılmıştır" : "Primary risk is detailed in the risk analysis"),
          ],
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // production consistency hardening): this fallback fires
          // whenever the deterministic banner's own "What Evidence Is
          // Missing"/localized-equivalent labeled section wasn't
          // embedded (the same coverage-dependent gap already fixed for
          // Decision/Confidence/Next Action/Main Risk elsewhere) -- the
          // old text described PARSER/GENERATION state ("not explicitly
          // stated in the generated executive summary"), which reads as
          // internal system language in an investor-grade report, not a
          // finding about the market. Replaced with the same honest,
          // evidence-aware validation wording this codebase already uses
          // elsewhere for an equivalent "no structured gap description
          // available" state (see marketIntelligenceUnverifiedSourcesReplacements,
          // report-presentation-sanitizer.ts) -- never invents a
          // specific missing-evidence claim the report didn't actually
          // make.
          [
            isMarketIntelligenceReport ? "Information Required Before Decision" : "Missing Evidence",
            marketInformationRequired ||
              missingEvidence ||
              (isTurkishPdf
                ? "Nihai karardan önce ek doğrulama gereklidir."
                : "Additional validation required before a final decision."),
          ],
          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
          // production consistency hardening): this is a SEPARATE
          // occurrence of the same malformed-fragment defect already
          // fixed for the PDF cover's own Next Action field --
          // `extractKeywordInsight(fullReportContent, [...])` scans the
          // ENTIRE report for a bare keyword match with no section
          // boundary, which produced the reported "combined AUM$150M) to
          // validate attainable..." fragment lifted mid-sentence from an
          // unrelated section. For Market Intelligence, falls back to
          // the model's own scoped "(5) Recommendation" bullets (still
          // confined to this card's own `content`, i.e. the executive
          // summary section only, never the full report) before ever
          // reaching that unscoped scan; Business Plan/Acquisition are
          // unchanged.
          [
            "Next Action",
            nextAction ||
              whatWouldChange ||
              (isMarketIntelligenceReport
                ? takeFirstListItemOrSentence(
                    extractMetricValueFromAliases(content, [
                      "Recommendation",
                      "Öneri",
                      "Empfehlung",
                      "Recommandation",
                      "Recomendación",
                    ])
                  )
                : "") ||
              extractKeywordInsight(fullReportContent, ["next action", "critical action", "validate"]) ||
              (isTurkishPdf ? "Acil sonraki adım için yönetici kararı bölümüne bakın" : "See the Immediate Next Action in the executive decision"),
          ],
        ];

        const itemWidth = (width - 68) / 2;
        const previousFontSize = pdf.getFontSize();
        pdf.setFontSize(6);
        const wrappedValues = recItems.map(([, value]) =>
          wrapPdfText(localizePdfPresentationText(value, pdfLocale), itemWidth - 4).slice(0, 4)
        );
        pdf.setFontSize(previousFontSize);

        const rowHeights: number[] = [];
        for (let row = 0; row * 2 < recItems.length; row += 1) {
          const leftLines = wrappedValues[row * 2]?.length ?? 1;
          const rightLines = wrappedValues[row * 2 + 1]?.length ?? 1;
          const maxLines = Math.max(leftLines, rightLines, 1);
          rowHeights.push(Math.max(15, 7.8 + (maxLines - 1) * 3.2 + 3));
        }
        const gridHeight =
          rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * 2;
        // The card's previous fixed 65 return value already carried ~16mm
        // of padding beyond the raw 3-row grid's own math (49mm) -- kept
        // here so short-content reports render at identical proportions
        // to before; only content that needs more than the original
        // per-tile height grows the card.
        const totalHeight = Math.max(65, gridHeight + 16);

        return {
          decisionLabel,
          confidence,
          recItems,
          itemWidth,
          wrappedValues,
          rowHeights,
          totalHeight,
        };
      };

      // Shared by drawSectionVisual's Competitive Landscape branch
      // (drawing) and getVisualHeight (pagination budgeting) for the
      // "no structured rows, but Major Players names real vendors" state
      // -- see extractMarketIntelligenceCompetitorNamesOnly's own comment.
      // Same class of fix as getExecutiveDecisionCardLayout above:
      // measuring the wrapped intro/name lines in exactly one place is
      // what keeps the height reserved for this card in sync with what
      // actually gets drawn.
      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
      // layout hardening, round 2): introText is now a parameter rather
      // than a single hardcoded sentence, so this same compact-card
      // layout can be reused for a SECOND distinct evidence-insufficient
      // state below (a genuinely sparse structured table, 1-2 validated
      // rows) with its own, more accurate wording -- without duplicating
      // this function's height math a second time.
      const getNamesOnlyCompetitorLayout = (namesOnly: string[], width: number, introText: string) => {
        const previousFontSize = pdf.getFontSize();
        pdf.setFontSize(5.8);
        const introLines = wrapPdfText(localizePdfPresentationText(introText, pdfLocale), width - 6);
        pdf.setFontSize(6.2);
        const nameLines = wrapPdfText(namesOnly.join("   •   "), width - 6);
        pdf.setFontSize(previousFontSize);
        const totalHeight = 13 + introLines.length * 3.6 + 5 + nameLines.length * 3.8 + 6;

        return { introLines, nameLines, totalHeight };
      };
      // CRITICAL FIX (Task #15) -- this wording used to say evidence
      // "does not independently validate them as direct, head-to-head
      // competitors," which conflates two separate things: whether these
      // ARE evidence-supported named players (yes -- Major Players itself
      // already says so), and whether a structured attribute-by-attribute
      // comparison has been validated (no -- that is the genuine gap).
      // The old wording cast doubt on the former when only the latter was
      // ever true, producing exactly the reported contradiction against
      // Major Players' own, more confident language for the same vendors.
      const adjacentPlayersOnlyIntro =
        "These companies are identified in available evidence as active market participants. Detailed competitive comparison -- positioning, strengths, weaknesses, and market share -- has not yet been independently validated for this analysis.";
      // Distinct from adjacentPlayersOnlyIntro above: these rows ARE
      // validated, named competitors (not merely adjacent players) --
      // the gap here is structured comparison DATA (category, market
      // position, relative strengths/weaknesses) across enough of them,
      // not competitor identity itself. Conflating the two would
      // incorrectly imply these vendors were never validated at all.
      const sparseCompetitorTableIntro =
        pdfLocale === "tr"
          ? "Bu şirketler mevcut kanıtlarla doğrulanmış rakiplerdir, ancak güvenilir bir karşılaştırma tablosu oluşturmak için yeterli sayıda şirkette yapılandırılmış konumlandırma verisi (kategori, pazar konumu, güçlü/zayıf yönler) henüz bulunmamaktadır. Ek doğrulanmış kanıt gerekmektedir."
          : "These are validated, named competitors from available evidence, but there is not yet enough structured comparison data (category, market position, relative strengths and weaknesses) across enough of them to build a reliable side-by-side table. Additional validated evidence is needed.";
      // Below this bar, a table would show mostly empty rows in what is
      // visually a spacious multi-column grid -- reads as broken, not
      // intentional. 1-2 validated rows still get their names surfaced
      // via the compact card above (never hidden), just not stretched
      // into a full comparative table they cannot support yet.
      const minCompetitorTableRows = 3;

      const drawSectionVisual = (section: PdfReportSection, sectionY: number) => {
        const { title, content, field } = section;
        const normalizedTitle = title.toLowerCase();
        // The card header strip ends at sectionY + 18; keep at least
        // minHeadingToContentGap (>= 16px) of breathing room below it
        // before any visual content starts.
        const visualY = sectionY + 18 + minHeadingToContentGap;
        const isTamSamSomSection = field === "tamSamSom" || normalizedTitle.includes("tam / sam / som");
        const isFinancialDashboardSection = field === "financialDashboard" || normalizedTitle.includes("financial dashboard") || normalizedTitle.includes("finansal panel");
        const isFounderScoreSection =
          field === "founderScore" ||
          normalizedTitle.includes("founder score") ||
          normalizedTitle.includes("founder readiness") ||
          normalizedTitle.includes("kurucu skoru") ||
          normalizedTitle.includes("kurucu hazırlık");
        // Acquisition Due Diligence's own ROI Analysis / IRR Analysis
        // fields (roiAnalysis, irrAnalysis) must never render the
        // Business-Plan Worst/Base/Best widget below, even defensively
        // against a title that happens to contain "scenario" (see the
        // matching exclusion in app/dashboard/[id]/page.tsx).
        const isScenarioSection =
          field !== "roiAnalysis" &&
          field !== "irrAnalysis" &&
          (field === "scenarioAnalysis" || normalizedTitle.includes("scenario") || normalizedTitle.includes("senaryo"));
        const isPorterSection = normalizedTitle.includes("porter");
        const isKpiSection = field === "kpiDashboard" || field === "kpis" || normalizedTitle.includes("kpi");
        const isUnitEconomicsSection = field === "unitEconomics" || normalizedTitle.includes("unit economics") || normalizedTitle.includes("birim ekonomisi");
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

        if (pdfKeyTakeawayCardFields.has(field ?? "")) {
          const takeaway = getSectionTakeaway(content);

          if (!takeaway) {
            return 0;
          }

          // Pin to the actual draw-time font (8.4) before measuring --
          // wrapPdfText measures at whatever font is currently active on
          // `pdf`, and the label line just below is set at a different
          // size, so measuring before drawing the label (rather than
          // after) keeps the wrap count consistent with what is actually
          // rendered.
          //
          // TASK #26B -- confirmed live: this used to additionally cap at
          // 3 wrapped lines on top of getSectionTakeaway's own now-removed
          // 220-char cap, silently dropping any remaining wrapped lines
          // with no visual cue. takeawayBoxHeight below is already fully
          // derived from takeawayLines.length, so removing the cap simply
          // lets the box grow to fit the complete sentence -- same fix
          // already applied to Strategic Recommendations.
          pdf.setFontSize(8.4);
          const takeawayLines = wrapPdfText(localizePdfPresentationText(takeaway, pdfLocale), bodyWidth - 12);
          const takeawayBoxHeight = Math.max(16, 8 + takeawayLines.length * 4.4);

          pdf.setFillColor("#101f1d");
          pdf.setDrawColor("#115e59");
          pdf.roundedRect(bodyX, visualY, bodyWidth, takeawayBoxHeight, 3, 3, "FD");

          pdf.setFontSize(6.4);
          pdf.setTextColor("#5eead4");
          pdf.text(localizePdfPresentationLabel("KEY TAKEAWAY", pdfLocale), bodyX, visualY - 2);

          pdf.setFontSize(8.4);
          pdf.setTextColor("#e4e4e7");
          pdf.text(takeawayLines, bodyX + 6, visualY + 7, {
            lineHeightFactor: 1.3,
            maxWidth: bodyWidth - 12,
          });

          return takeawayBoxHeight;
        }

        if (isTamSamSomSection) {
          // Concentric TAM/SAM/SOM circles -- the standard consulting/VC-deck
          // device for market sizing -- replacing the previous three stacked
          // text rows. Radius is area-proportional (sqrt-scaled) to the
          // parsed market-size magnitude when the values parse sensibly,
          // and falls back to a fixed, always-legible nested silhouette
          // otherwise, so the chart never looks broken even on an
          // unparseable range.
          const tamVisualContent = getTamVisualContent(content);
          const rows = getTamRows(tamVisualContent, content);
          const magnitudes = rows.map((row) => parseMarketSizeMagnitude(row.value)) as [
            number | null,
            number | null,
            number | null,
          ];
          // P0 FIX -- confirmed live (root-cause repair): this section used
          // to require ALL THREE of TAM/SAM/SOM to parse before drawing
          // anything, discarding an already-resolved TAM and SAM the
          // moment SOM alone was pending -- the web report never had this
          // restriction (each layer renders independently there). The
          // per-layer resolution decision now comes from
          // resolveMarketSizingCascade (report-presentation.ts), the SAME
          // canonical rule the web report uses, so the two surfaces can
          // never disagree about which layers are trustworthy: a layer
          // resolves only when it has its own parseable value AND every
          // layer above it in the hierarchy is also resolved and correctly
          // nested -- exactly preserving the existing evidence-first
          // gating (an unresolved TAM still withholds SAM/SOM here, same
          // as it always has), while no longer punishing SAM/TAM for an
          // unrelated, independently-missing SOM.
          // TASK #24 -- canonical state can only ever narrow (never
          // widen) what this cascade treats as resolved.
          const cascade = constrainMarketSizingResolutionToCanonicalState(
            resolveMarketSizingCascade(magnitudes),
            readMarketIntelligenceCanonicalState(report.metadata)
          );
          const resolvedByIndex = [cascade.tamResolved, cascade.samResolved, cascade.somResolved];

          if (!cascade.tamResolved && !cascade.samResolved && !cascade.somResolved) {
            // Genuinely nothing to show -- same wording as the on-screen
            // "Validation Needed" state (see page.tsx/Planner.tsx's
            // ReportSectionVisual/PremiumSectionVisual) -- PDF must match
            // the UI, not show its own bespoke explanation. Unchanged from
            // prior behavior for this one case.
            const explanationText =
              pdfLocale === "tr"
                ? "Boyutlandırmanın doğrulanabilmesi için ek pazar doğrulaması gereklidir."
                : "Additional market validation is required before sizing can be confirmed.";
            pdf.setFontSize(7.6);
            pdf.setTextColor("#a1a1aa");
            pdf.text(
              wrapPdfText(explanationText, bodyWidth - 6),
              bodyX + 3,
              visualY + 10,
              { lineHeightFactor: 1.3, maxWidth: bodyWidth - 6 }
            );

            return getTamVisualHeight();
          }

          const radii = computeTamSamSomRadii(magnitudes[0], magnitudes[1], magnitudes[2]);
          const circleCenterX = bodyX + tamCircleMaxRadius + 4;
          const circleCenterY = visualY + tamCircleMaxRadius + 3;

          rows.forEach((row, index) => {
            pdf.setFillColor(row.color);
            pdf.circle(circleCenterX, circleCenterY, radii[index], "F");
          });

          const legendX = circleCenterX + tamCircleMaxRadius + 10;
          const legendWidth = Math.max(20, bodyX + bodyWidth - legendX);
          const legendRowHeight = (tamCircleVisualHeight - 4) / 3;

          rows.forEach(({ label, color, value }, index) => {
            const rowY = visualY + 2 + index * legendRowHeight;
            const isResolved = resolvedByIndex[index];
            const isEstimated = isMarketSizeEstimated(content, label);
            // The reader must see WHY the figure is what it is without
            // opening Details -- the same real planning-assumption
            // sentence the on-screen visual now shows inline, never a
            // fabricated one. Unconditional (not gated on isResolved):
            // for an unresolved layer, this same extraction finds that
            // layer's own real, already-honest gap sentence (e.g. "SAM
            // withheld: TAM confidence did not clear the threshold..."),
            // which is informative context for why it is unresolved, not
            // a fabricated value.
            const assumption = extractMarketSizeAssumption(content, label);
            pdf.setFillColor(color);
            pdf.roundedRect(legendX, rowY, 7, 4.4, 1.5, 1.5, "F");
            pdf.setFontSize(7.2);
            pdf.setTextColor(isEstimated ? "#fbbf24" : "#a1a1aa");
            pdf.text(
              isEstimated ? `${label} · ${localizePdfPresentationLabel("Planning Estimate", pdfLocale)}` : label,
              legendX + 10,
              rowY + 3.8
            );
            pdf.setTextColor(isResolved ? "#ccfbf1" : "#71717a");
            // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
            // decision/market-sizing consistency hardening): an unresolved
            // layer's own text is a gap-EXPLANATION sentence (e.g. "realistic
            // obtainable-share evidence was not found..."), which
            // isMarketSizeValueMeaningful correctly filters out of `value`
            // (no $/%/magnitude unit) -- but that left this line falling
            // through to a bare "—" with no semantic meaning, while page.tsx's
            // equivalent bar already shows "Pending <Parent> Validation" or
            // "Validation Needed" for the identical unresolved state. Reusing
            // this file's own established "Validation Required" convention
            // (already used everywhere else in this PDF for the same
            // null-value state) keeps this one remaining site consistent with
            // both the rest of this file and the web report's own wording --
            // never inventing a number, only replacing an unexplained
            // placeholder with an honest, already-localized state.
            drawSingleLine(
              isResolved ? value : localizePdfPresentationLabel("Validation Required", pdfLocale),
              legendX + 10,
              rowY + 9.4,
              legendWidth - 10,
              8,
              5,
              false
            );
            if (assumption) {
              pdf.setFontSize(5.2);
              pdf.setTextColor("#71717a");
              const assumptionLines = wrapPdfText(
                localizePdfPresentationText(assumption, pdfLocale),
                legendWidth - 10
              ).slice(0, 2);
              pdf.text(assumptionLines, legendX + 10, rowY + 13.6, {
                lineHeightFactor: 1.2,
                maxWidth: legendWidth - 10,
              });
            }
          });

          return getTamVisualHeight();
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
            pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), x + 3, boxY + 5);
            pdf.setFontSize(6.6);
            pdf.setTextColor("#d4d4d8");
            let bulletY = boxY + 10.5;
            bulletLines.forEach((lines) => {
              pdf.text(lines.map((line) => localizePdfPresentationText(line, pdfLocale)), x + 3, bulletY, {
                lineHeightFactor: 1.22,
                maxWidth: swotLayout.boxWidth - 7,
              });
              bulletY += lines.length * swotBulletLineHeight;
            });
          });

          return swotLayout.totalHeight;
        }

        if (isFounderScoreSection) {
          const cards = buildPdfFounderScoreCards(
            content,
            report.investmentScore,
            pdfLocale
          );
          const itemWidth = (bodyWidth - 10) / 3;

          cards.forEach((item, index) => {
            const displayLabel = item.label;
            const x = bodyX + (index % 3) * (itemWidth + 5);
            const itemY = visualY + Math.floor(index / 3) * 15;
            const score = item.score;
            const scoreText = score === null ? "—" : `${score}/100`;
            const labelLines = wrapPdfText(displayLabel, itemWidth - 19).slice(0, 2);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 13.5, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(scoreText.length > 4 ? 4.8 : 5.8);
            pdf.setTextColor("#ccfbf1");
            pdf.text(scoreText, x + 3.6, itemY + 7.6, { maxWidth: 7 });
            pdf.setFontSize(6.2);
            pdf.setTextColor("#e4e4e7");
            pdf.text(labelLines, x + 14, itemY + 5, {
              lineHeightFactor: 1.08,
              maxWidth: itemWidth - 18,
            });
          });

          return 46;
        }

        if (field === "executiveSummary" || normalizedTitle.includes("executive summary") || normalizedTitle.includes("yönetici özeti")) {
          const cardLayout = getExecutiveDecisionCardLayout(content, bodyWidth);
          const { decisionLabel, confidence, recItems, itemWidth, wrappedValues, rowHeights } = cardLayout;

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 52, 26, 5, 5, "FD");
          pdf.setFontSize(5.8);
          pdf.setTextColor("#134e4a");
          pdf.text(localizePdfPresentationLabel("DECISION", pdfLocale), bodyX + 5, visualY + 6);
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

          // CRITICAL FIX -- confirmed live (root-cause repair): Why/Top
          // Risk/Information Required/Next Action previously always drew
          // through drawSingleLine (single line only, hard-truncated with
          // an ellipsis regardless of available space) inside a fixed
          // 15mm-tall tile. Now wraps to getExecutiveDecisionCardLayout's
          // own pre-measured line count and each row grows to fit the
          // taller of its two tiles -- short content (the common case)
          // renders at the exact same 15mm tile height as before.
          let recItemRowY = visualY;
          recItems.forEach(([label], index) => {
            const row = Math.floor(index / 2);
            if (index % 2 === 0 && row > 0) {
              recItemRowY += rowHeights[row - 1] + 2;
            }
            const itemX = bodyX + 60 + (index % 2) * ((bodyWidth - 64) / 2 + 2);
            const itemY = recItemRowY;
            const rowHeight = rowHeights[row] ?? 15;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, rowHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#71717a");
            pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), itemX + 2, itemY + 3.2);
            pdf.setTextColor("#e4e4e7");
            pdf.setFontSize(6);
            pdf.text(wrappedValues[index] ?? [], itemX + 2, itemY + 7.8, {
              lineHeightFactor: 1.28,
              maxWidth: itemWidth - 4,
            });
          });

          return cardLayout.totalHeight;
        }

        if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {
          const headerHeight = 8;
          const rowHeight = 15;
          const marketMapGap = 8;
          const marketMapHeight = 50;

          // Market Intelligence gets its own real column set (see
          // extractMarketIntelligenceCompetitorRows' own comment) -- the
          // generic table below stays exactly as it always was for
          // Business Plan/Acquisition.
          if (isMarketIntelligenceReport) {
            const miRows = extractMarketIntelligenceCompetitorRows(
              content,
              pdfSections.find((entry) => entry.field === "majorPlayers")?.content
            );
            // CRITICAL FIX -- confirmed live: before falling back to a
            // bare empty table shell, check whether Major Players
            // actually names real, plausible vendors that just don't fit
            // the strict row shape (see
            // extractMarketIntelligenceCompetitorNamesOnly's own
            // comment). Never fabricates category/position/strengths/
            // weaknesses to fill the full table -- shows a distinct,
            // honest state instead, matching the on-screen dashboard.
            const namesOnly =
              miRows.length === 0
                ? extractMarketIntelligenceCompetitorNamesOnly(
                    pdfSections.find((entry) => entry.field === "majorPlayers")?.content || ""
                  )
                : [];
            // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
            // layout hardening, round 2): a genuinely sparse table (1-2
            // real rows, below minCompetitorTableRows) used to fall
            // straight into the full 7-column table branch below,
            // rendering mostly-empty cells across a spacious grid that
            // read as broken rather than intentional. Reuses the same
            // compact-card treatment as the "adjacent players only" case
            // above (never a large empty-looking table), but with its own
            // header/intro since these ARE validated named competitors,
            // not merely adjacent ones -- the gap is comparison DATA, not
            // competitor identity.
            const compactCompetitorState =
              namesOnly.length > 0
                ? {
                    headerText: "RELEVANT PLAYERS IDENTIFIED — DETAILED COMPARISON REQUIRES VALIDATION",
                    layout: getNamesOnlyCompetitorLayout(namesOnly, bodyWidth, adjacentPlayersOnlyIntro),
                  }
                : miRows.length > 0 && miRows.length < minCompetitorTableRows
                  ? {
                      headerText:
                        pdfLocale === "tr"
                          ? "REKABET VERİSİ — SINIRLI YAPILANDIRILMIŞ KARŞILAŞTIRMA"
                          : "COMPETITORS IDENTIFIED — LIMITED STRUCTURED COMPARISON DATA",
                      layout: getNamesOnlyCompetitorLayout(
                        miRows.map((row) => row.vendor || "Vendor"),
                        bodyWidth,
                        sparseCompetitorTableIntro
                      ),
                    }
                  : null;
            const namesLayout = compactCompetitorState?.layout ?? null;
            const miColumns = [
              { label: localizePdfPresentationLabel("Vendor", pdfLocale), width: bodyWidth * 0.15 },
              { label: localizePdfPresentationLabel("Category", pdfLocale), width: bodyWidth * 0.13 },
              { label: localizePdfPresentationLabel("Position", pdfLocale), width: bodyWidth * 0.15 },
              { label: localizePdfPresentationLabel("Strengths", pdfLocale), width: bodyWidth * 0.17 },
              { label: localizePdfPresentationLabel("Weaknesses", pdfLocale), width: bodyWidth * 0.17 },
              { label: localizePdfPresentationLabel("Relevance", pdfLocale), width: bodyWidth * 0.11 },
              // TASK #32 -- see the web table's identical fix (page.tsx /
              // Planner.tsx): renamed from "Validation" to make clear
              // this column reflects vendor existence/relevance
              // corroboration, not the category/position/strengths/
              // weaknesses text in the same row.
              { label: localizePdfPresentationLabel("Vendor Confidence", pdfLocale), width: bodyWidth * 0.12 },
            ];
            let miX = bodyX;

            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(
              bodyX,
              visualY,
              bodyWidth,
              namesLayout ? namesLayout.totalHeight : headerHeight + Math.max(1, miRows.length) * rowHeight,
              3,
              3,
              "FD"
            );
            if (namesLayout && compactCompetitorState) {
              pdf.setFontSize(6.5);
              pdf.setTextColor("#7dd3fc");
              pdf.text(
                localizePdfPresentationText(compactCompetitorState.headerText, pdfLocale),
                bodyX + 3,
                visualY + 7,
                { maxWidth: bodyWidth - 6 }
              );
              pdf.setFontSize(5.8);
              pdf.setTextColor("#a1a1aa");
              pdf.text(namesLayout.introLines, bodyX + 3, visualY + 13, {
                lineHeightFactor: 1.3,
                maxWidth: bodyWidth - 6,
              });
              pdf.setFontSize(6.2);
              pdf.setTextColor("#e0f2fe");
              const namesY = visualY + 13 + namesLayout.introLines.length * 3.6 + 5;
              pdf.text(namesLayout.nameLines, bodyX + 3, namesY, {
                lineHeightFactor: 1.35,
                maxWidth: bodyWidth - 6,
              });
            } else {
              pdf.setFontSize(5.8);
              pdf.setTextColor("#5eead4");
              miColumns.forEach((column) => {
                pdf.text(column.label.toUpperCase(), miX + 2, visualY + 5.2, { maxWidth: column.width - 4 });
                miX += column.width;
              });
            }

            // Market Map -- positions vendors on Enterprise<->SME (x) and
            // Broad platform<->Specialized (y) axes, read only from each
            // row's own category/position text. Never fabricates a
            // placement: a report with fewer than 2 confidently-placeable
            // vendors gets an honest "Validation Needed" state instead of
            // a sparse or guessed chart.
            const drawMarketMap = (mapY: number) => {
              const placements = miRows
                .map((row) => {
                  const coordinates = inferMarketIntelligenceMarketMapPosition(row);
                  return coordinates ? { vendor: row.vendor || "Vendor", ...coordinates } : null;
                })
                .filter((placement): placement is { vendor: string; x: number; y: number } => placement !== null);

              pdf.setFontSize(7.2);
              pdf.setTextColor("#5eead4");
              pdf.text(localizePdfPresentationLabel("MARKET MAP", pdfLocale), bodyX, mapY - 2);

              pdf.setFillColor("#101113");
              pdf.setDrawColor("#27272a");
              pdf.roundedRect(bodyX, mapY, bodyWidth, marketMapHeight, 3, 3, "FD");

              if (placements.length < 2) {
                pdf.setFontSize(6.2);
                pdf.setTextColor("#fbbf24");
                pdf.text(localizePdfPresentationLabel("VALIDATION NEEDED", pdfLocale), bodyX + 5, mapY + 9);
                pdf.setFontSize(6);
                pdf.setTextColor("#a1a1aa");
                pdf.text(
                  wrapPdfText(
                    localizePdfPresentationText(
                      "Not enough competitors have a clear category or positioning signal on both axes to plot a reliable market map yet.",
                      pdfLocale
                    ),
                    bodyWidth - 10
                  ),
                  bodyX + 5,
                  mapY + 15,
                  { lineHeightFactor: 1.3, maxWidth: bodyWidth - 10 }
                );
                return;
              }

              const mapInnerX = bodyX + 6;
              const mapInnerY = mapY + 6;
              const mapInnerWidth = bodyWidth - 12;
              const mapInnerHeight = marketMapHeight - 12;

              pdf.setDrawColor("#27272a");
              pdf.line(mapInnerX + mapInnerWidth / 2, mapInnerY, mapInnerX + mapInnerWidth / 2, mapInnerY + mapInnerHeight);
              pdf.line(mapInnerX, mapInnerY + mapInnerHeight / 2, mapInnerX + mapInnerWidth, mapInnerY + mapInnerHeight / 2);
              pdf.setFontSize(5);
              pdf.setTextColor("#71717a");
              pdf.text(localizePdfPresentationLabel("Broad platform", pdfLocale), mapInnerX + 1, mapInnerY + 3.6);
              pdf.text(localizePdfPresentationLabel("Specialized", pdfLocale), mapInnerX + 1, mapInnerY + mapInnerHeight - 1);
              pdf.text(localizePdfPresentationLabel("SME", pdfLocale), mapInnerX + 1, mapInnerY + mapInnerHeight / 2 - 1);
              const enterpriseLabelWidth = pdf.getTextWidth(localizePdfPresentationLabel("Enterprise", pdfLocale));
              pdf.text(
                localizePdfPresentationLabel("Enterprise", pdfLocale),
                mapInnerX + mapInnerWidth - enterpriseLabelWidth - 1,
                mapInnerY + mapInnerHeight / 2 - 1
              );

              placements.forEach((placement) => {
                const dotX = mapInnerX + (placement.x / 100) * mapInnerWidth;
                const dotY = mapInnerY + (placement.y / 100) * mapInnerHeight;

                pdf.setFillColor("#5eead4");
                pdf.circle(dotX, dotY, 1.6, "F");
                pdf.setFontSize(5.2);
                pdf.setTextColor("#ccfbf1");
                drawSingleLine(placement.vendor, dotX + 2.6, dotY + 1.2, 24, 5.2, 4);
              });
            };

            if (namesLayout) {
              drawMarketMap(visualY + namesLayout.totalHeight + marketMapGap);
              return namesLayout.totalHeight + marketMapGap + marketMapHeight;
            }

            if (miRows.length === 0) {
              // P0 FIX #8 -- confirmed live (Competitive Landscape data-flow
              // repair): this IS the Competitive Landscape section's own
              // render (title-matched above) -- telling the reader to "see
              // the Competitive Landscape section" from inside that exact
              // section was a self-referential, useless copy-paste artifact.
              // Every real extraction tier (table, flattened bullets, Major
              // Players' own bullets/prose-list) has already failed by this
              // point, so this is the genuine "nothing defensible found"
              // case -- matches page.tsx's own wording for the identical
              // state, never fabricating a vendor to fill the gap.
              pdf.setFontSize(6.2);
              pdf.setTextColor("#a1a1aa");
              pdf.text(localizePdfPresentationText("No competitor data could be validated for this market yet.", pdfLocale), bodyX + 3, visualY + 14, {
                maxWidth: bodyWidth - 6,
              });
              drawMarketMap(visualY + headerHeight + rowHeight + 4 + marketMapGap);
              return headerHeight + rowHeight + 4 + marketMapGap + marketMapHeight;
            }

            miRows.forEach((row, rowIndex) => {
              const rowY = visualY + headerHeight + rowIndex * rowHeight;
              const values = [row.vendor, row.category, row.position, row.strengths, row.weaknesses, row.relevance, row.validationStatus];
              let cellX = bodyX;

              pdf.setDrawColor("#27272a");
              pdf.line(bodyX, rowY, bodyX + bodyWidth, rowY);
              values.forEach((value, cellIndex) => {
                const width = miColumns[cellIndex]?.width ?? 20;
                pdf.setFontSize(cellIndex === 0 ? 6.3 : 5.5);
                pdf.setTextColor(cellIndex === 0 ? "#f4f4f5" : "#d4d4d8");
                pdf.text(truncatePdfCellLines(wrapPdfText(value || localizePdfPresentationLabel("Validation Required", pdfLocale), width - 4), 2), cellX + 2, rowY + 4.7, {
                  lineHeightFactor: 1.1,
                  maxWidth: width - 4,
                });
                cellX += width;
              });
            });

            drawMarketMap(visualY + headerHeight + Math.max(1, miRows.length) * rowHeight + 4 + marketMapGap);
            return headerHeight + Math.max(1, miRows.length) * rowHeight + 4 + marketMapGap + marketMapHeight;
          }

          const rows = extractCompetitorRows(content);

          if (rows.length === 0) {
            // P0 FIX #8 -- same self-referential copy-paste fix as the
            // Market Intelligence branch above: this is the Competitive
            // Landscape section's own generic (Business Plan/Acquisition)
            // render, so it must never tell the reader to "see" the exact
            // section already on screen.
            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(bodyX, visualY, bodyWidth, headerHeight + rowHeight, 3, 3, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(localizePdfPresentationText("No competitor data could be validated for this market yet.", pdfLocale), bodyX + 3, visualY + 14, {
              maxWidth: bodyWidth - 6,
            });
            return headerHeight + rowHeight + 4;
          }

          // P0 PRODUCTION FIX -- confirmed live (Market Intelligence PDF
          // layout hardening, round 2): mirrors the identical fix just
          // above for Market Intelligence's own competitor table -- a
          // sparse table (1-2 rows, below minCompetitorTableRows) used to
          // still draw the full 5-column grid, mostly empty. Shows the
          // same compact, honest card instead.
          if (rows.length < minCompetitorTableRows) {
            const sparseLayout = getNamesOnlyCompetitorLayout(
              rows.map((row) => row.company || "Company"),
              bodyWidth,
              sparseCompetitorTableIntro
            );

            pdf.setFillColor("#101113");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(bodyX, visualY, bodyWidth, sparseLayout.totalHeight, 3, 3, "FD");
            pdf.setFontSize(6.5);
            pdf.setTextColor("#7dd3fc");
            pdf.text(
              localizePdfPresentationText("COMPETITORS IDENTIFIED — LIMITED STRUCTURED COMPARISON DATA", pdfLocale),
              bodyX + 3,
              visualY + 7,
              { maxWidth: bodyWidth - 6 }
            );
            pdf.setFontSize(5.8);
            pdf.setTextColor("#a1a1aa");
            pdf.text(sparseLayout.introLines, bodyX + 3, visualY + 13, {
              lineHeightFactor: 1.3,
              maxWidth: bodyWidth - 6,
            });
            pdf.setFontSize(6.2);
            pdf.setTextColor("#e0f2fe");
            const namesY = visualY + 13 + sparseLayout.introLines.length * 3.6 + 5;
            pdf.text(sparseLayout.nameLines, bodyX + 3, namesY, {
              lineHeightFactor: 1.35,
              maxWidth: bodyWidth - 6,
            });

            return sparseLayout.totalHeight;
          }

          const columns = [
            { label: localizePdfPresentationLabel("Company", pdfLocale), width: bodyWidth * 0.19 },
            { label: localizePdfPresentationLabel("Positioning", pdfLocale), width: bodyWidth * 0.27 },
            { label: localizePdfPresentationLabel("Strengths", pdfLocale), width: bodyWidth * 0.2 },
            { label: localizePdfPresentationLabel("Weaknesses", pdfLocale), width: bodyWidth * 0.2 },
            { label: localizePdfPresentationLabel("Threat", pdfLocale), width: bodyWidth * 0.14 },
          ];
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
              pdf.text(truncatePdfCellLines(wrapPdfText(value || "Validation required", width - 4), 2), cellX + 2, rowY + 4.7, {
                lineHeightFactor: 1.1,
                maxWidth: width - 4,
              });
              cellX += width;
            });
          });

          return headerHeight + Math.max(1, rows.length) * rowHeight + 4;
        }

        // Market Metrics dashboard -- combines real signals already
        // generated across several Market Intelligence sections
        // (marketSize, cagr, customerSegments, threats) into one premium
        // tile grid rather than leaving each as a separate plain-text
        // section. Every tile reads real content only; a tile with no
        // detectable signal shows "Validation Needed", never a fabricated
        // value.
        if (isMarketIntelligenceReport && field === "marketSize") {
          const cagrContent = pdfSections.find((candidate) => candidate.field === "cagr")?.content || "";
          const customerSegmentsContent = pdfSections.find((candidate) => candidate.field === "customerSegments")?.content || "";
          const threatsContent = pdfSections.find((candidate) => candidate.field === "threats")?.content || "";

          // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair):
          // mirrors page.tsx's identical fix -- when the evidence names
          // more than one materially different growth-rate figure for
          // what the report presents as one requested market,
          // resolveCagrHeadlinePresentation (report-presentation.ts, the
          // ONE canonical source both surfaces read) reports an honest
          // range instead of extractHeadlineCagrValue's plain first-match
          // pick, so the PDF tile can never disagree with the web card
          // about which figure is authoritative.
          const tiles = [
            { label: "Market Growth Signal", value: extractMarketGrowthTrend(content, cagrContent) },
            {
              label: "CAGR",
              value: (() => {
                const cagrPresentation = resolveCagrHeadlinePresentation(cagrContent);
                return cagrPresentation.isMultiEstimate ? cagrPresentation.displayValue : extractHeadlineCagrValue(cagrContent);
              })(),
            },
            { label: "Customer Segment", value: extractKeywordInsight(customerSegmentsContent, []) },
            { label: "Adoption Signal", value: extractAdoptionSignal(customerSegmentsContent) },
            { label: "Risk Level", value: extractRiskLevel(threatsContent) },
          ];
          const columns = tiles.length;
          const itemWidth = (bodyWidth - (columns - 1) * 3) / columns;
          const itemHeight = marketMetricsDashboardHeight - 6;

          pdf.setFontSize(7.2);
          pdf.setTextColor("#5eead4");
          pdf.text(localizePdfPresentationLabel("MARKET METRICS", pdfLocale), bodyX, visualY - 2);

          tiles.forEach((tile, index) => {
            const x = bodyX + index * (itemWidth + 3);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, itemWidth, itemHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(5.2);
            pdf.setTextColor("#71717a");
            const labelLines = wrapPdfText(localizePdfPresentationLabel(tile.label, pdfLocale), itemWidth - 4).slice(0, 2);
            pdf.text(labelLines, x + 2, visualY + 3.6, {
              lineHeightFactor: 1.05,
              maxWidth: itemWidth - 4,
            });
            const valueY = visualY + 3.6 + labelLines.length * 3.1 + 3;
            if (tile.value) {
              pdf.setFontSize(5.6);
              pdf.setTextColor("#f4f4f5");
              pdf.text(truncatePdfCellLines(wrapPdfText(tile.value, itemWidth - 4), 3), x + 2, valueY, {
                lineHeightFactor: 1.15,
                maxWidth: itemWidth - 4,
              });
            } else {
              pdf.setFontSize(5);
              pdf.setTextColor("#fbbf24");
              pdf.text(localizePdfPresentationLabel("VALIDATION NEEDED", pdfLocale), x + 2, valueY, { maxWidth: itemWidth - 4 });
            }
          });

          return marketMetricsDashboardHeight;
        }

        // TASK #25C -- Strategic Recommendations moved out of this
        // generic single-call visual dispatch entirely: its card grid's
        // total height is genuinely data-dependent and, once each card's
        // height reflects its own real untruncated action text (see
        // computeRecommendationCardLayout), can exceed a single page --
        // something this function's single drawSectionVisual(section, y)
        // call site has no way to react to (it always draws everything
        // it's given in one pass at one Y). Handled instead by its own
        // dedicated, row-pagination-aware branch directly in the
        // top-level pdfSections.forEach loop below, which can start a
        // fresh "continued" card and keep drawing remaining rows exactly
        // like the generic body-text path already does for long prose.

        // Acquisition Due Diligence's own postMergerIntegrationPlan field
        // must never draw the fixed Business-Plan founder timeline
        // (Tomorrow/This Week/30 Days/90 Days/180 Days/12 Months) below,
        // even defensively against a title that happens to contain
        // "roadmap" -- see the matching exclusion in
        // app/dashboard/[id]/page.tsx.
        if (field !== "postMergerIntegrationPlan" && normalizedTitle.includes("roadmap")) {
          const stepWidth = (bodyWidth - 10) / 6;
          founderRoadmapSteps.forEach((step, index) => {
            const x = bodyX + index * (stepWidth + 2);
            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, stepWidth, 28, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(localizePdfPresentationLabel(step, pdfLocale), x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
            pdf.setFontSize(5.6);
            pdf.setTextColor("#a1a1aa");
            pdf.text(truncatePdfCellLines(wrapPdfText(localizePdfPresentationText(extractRoadmapAction(content, step), pdfLocale), stepWidth - 4), 4), x + 2, visualY + 11, {
              lineHeightFactor: 1.16,
              maxWidth: stepWidth - 4,
            });
          });
          return 31;
        }

        if (isPorterSection) {
          const forces = ["Rivalry", "Entrants", "Buyer", "Supplier", "Substitutes"];
          const centerX = bodyX + bodyWidth * 0.32;
          const centerY = visualY + 22;
          // Each force card now also carries its own real investor-
          // interpretation sentence (matching the on-screen radar cards) --
          // this section's raw paragraph is essentially "one sentence per
          // force" by its own prompt's structure, so with all five shown
          // here the paragraph below it would be a pure duplicate; the
          // taller card (was a fixed 6mm/8mm-spaced row, now sized to fit
          // up to 2 wrapped lines) is what makes it safe for
          // pdfCompleteVisualFields to suppress that paragraph entirely.
          const forceCardHeight = 14;
          const forceCardSpacing = 16;

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
            const cardY = visualY + index * forceCardSpacing;
            // CRITICAL FIX -- do not reintroduce old fake-data behavior.
            // This used to be a static [72, 54, 66, 48, 60] array,
            // identical for every report -- see extractForceIntensity's
            // own comment for why a real per-force reading is used
            // instead.
            const score = extractForceIntensity(content, force)?.width ?? 0;
            const implication = extractForceImplication(content, force);

            pdf.setDrawColor("#5eead4");
            pdf.line(centerX, centerY, dotX, dotY);
            pdf.setFillColor("#0f766e");
            pdf.circle(dotX, dotY, 1.8, "F");

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(cardX, cardY, bodyWidth * 0.38, forceCardHeight, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#e4e4e7");
            pdf.text(localizePdfPresentationLabel(force, pdfLocale), cardX + 2, cardY + 4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(cardX + 22, cardY + 2.2, bodyWidth * 0.24, 1.4, 0.7, 0.7, "F");
            // CRITICAL FIX (Task #19) -- Market Intelligence only: the bar
            // color itself now signals whether THIS force's own sentence
            // cited real evidence (teal, unchanged) or did not (amber,
            // the same warning color this file already uses for
            // "Validation Needed" elsewhere) -- no new element, no
            // repagination risk. Every other report kind keeps the
            // original unconditional teal fill.
            pdf.setFillColor(
              isMarketIntelligenceReport && !isForceEvidenceCited(implication) ? "#fbbf24" : "#5eead4"
            );
            pdf.roundedRect(cardX + 22, cardY + 2.2, (bodyWidth * 0.24 * score) / 100, 1.4, 0.7, 0.7, "F");
            if (implication) {
              pdf.setFontSize(4.6);
              pdf.setTextColor("#a1a1aa");
              const implicationLines = wrapPdfText(
                localizePdfPresentationText(implication, pdfLocale),
                bodyWidth * 0.38 - 4
              ).slice(0, 2);
              pdf.text(implicationLines, cardX + 2, cardY + 7.6, {
                lineHeightFactor: 1.2,
                maxWidth: bodyWidth * 0.38 - 4,
              });
            }
          });

          return Math.max(44, forces.length * forceCardSpacing);
        }

        if (
          isFinancialDashboardSection ||
          isScenarioSection ||
          isPorterSection ||
          isKpiSection ||
          isUnitEconomicsSection
        ) {
          const financialLayout = isFinancialDashboardSection
            ? getFinancialLayout(content, bodyWidth)
            : null;
          const labels = isScenarioSection
              ? ["Worst", "Base", "Best"]
              : isPorterSection
                ? ["Rivalry", "Entrants", "Buyer", "Substitutes"]
                : isKpiSection
                  ? normalizePdfKpiMetrics(content)
                  : normalizedTitle.includes("risk") || normalizedTitle.includes("riskler")
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : isUnitEconomicsSection
                      ? unitEconomicsMetrics
                      : financialLayout?.items ?? [];
          const isFinancialDashboard = isFinancialDashboardSection;
          const isKpiDashboard = isKpiSection;
          const isScenario = isScenarioSection;
          const isUnitEconomics = isUnitEconomicsSection;
          const metricContent = isFinancialDashboard ? content : `${content}\n${fullReportContent}`;
          const columns = isFinancialDashboard ? 3 : labels.length > 6 ? 4 : labels.length;
          const itemWidth = isFinancialDashboard && financialLayout
            ? financialLayout.itemWidth
            : (bodyWidth - (columns - 1) * 3) / columns;

          labels.forEach((item, index) => {
            const typedItem = item as string | {
              label: string;
              aliases: string[] | readonly string[];
              value?: string;
              labelLines?: string[];
              target?: string;
              status?: string;
              owner?: string;
              trigger?: string;
              action?: string;
              score?: number | null;
            };
            const label = typeof typedItem === "string" ? typedItem : typedItem.label;
            const displayLabel = localizePdfPresentationLabel(label, pdfLocale);
            const aliases = typeof typedItem === "string" ? [typedItem] : typedItem.aliases;
            const x = bodyX + (index % columns) * (itemWidth + 3);
            const rowIndex = Math.floor(index / columns);
            const priorRowHeight = isFinancialDashboard && financialLayout
              ? financialLayout.rowHeights.slice(0, rowIndex).reduce((sum, height) => sum + height, 0)
              : 0;
            const itemHeight = isFinancialDashboard && financialLayout
              ? financialLayout.rowHeights[rowIndex]
              : isKpiDashboard ? 31 : isScenario ? 20 : isUnitEconomics ? 19 : 10;
            const itemY = isFinancialDashboard && financialLayout
              ? visualY + priorRowHeight + rowIndex * 3
              : visualY + rowIndex * (itemHeight + 3);
            const score = typeof typedItem !== "string" && "score" in typedItem
              ? typedItem.score ?? null
              : extractScoreFromAliases(metricContent, aliases);
            const value = typeof typedItem !== "string" && typedItem.value
              ? typedItem.value
              : isUnitEconomics && label === "Gross Margin"
                ? formatMetricCardValue(extractStrictMetricValueFromAliases(content, ["grossMargin", "Gross Margin", "Brüt Marj"]))
                // Prefer this card's own section content before falling back to
                // the rest of the report: Financial Assumptions legitimately
                // describes every one of these same metric names in prose
                // ("Payback: derived from CAC/ARPA, confidence Medium."), and
                // without this precedence that assumption sentence -- not this
                // section's own value -- wins whenever this section only
                // states the metric under a longer alias.
                : formatMetricCardValue(extractMetricValueFromAliases(content, aliases)) ||
                  formatMetricCardValue(extractMetricValueFromAliases(metricContent, aliases));
            const compactValue = compactPdfMetricValue(value);
            const labelLines =
              typeof typedItem !== "string" && typedItem.labelLines
                ? typedItem.labelLines
                : wrapPdfText(displayLabel, itemWidth - 4).slice(0, 2);
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
              const kpiValue = typeof typedItem !== "string" && typedItem.value
                ? typedItem.value
                : (score === null ? "—" : `${score}%`);
              const status = typeof typedItem !== "string" ? typedItem.status || "Watch" : "Watch";
              pdf.setTextColor("#f4f4f5");
              // Some KPI "values" are a short number/percent, but others
              // are a full descriptive sentence (no score available).
              // drawSingleLine only shrinks font size, it never wraps --
              // for a long sentence that still doesn't fit at its
              // smallest allowed size, that let text run past the card's
              // right edge into the next card. Measure at that same
              // floor size first, and only fall back to wrapping (safe,
              // capped at 2 lines) when a single line genuinely can't
              // hold the text.
              pdf.setFontSize(4.2);
              const kpiValueFitsOnOneLine = pdf.getTextWidth(kpiValue) <= itemWidth - 4;
              let kpiValueLineCount = 1;
              if (kpiValueFitsOnOneLine) {
                drawSingleLine(kpiValue, x + 2, primaryValueY, itemWidth - 4, 7.5, 4.2, false);
              } else {
                pdf.setFontSize(6);
                const wrappedKpiValueLines = (pdf.splitTextToSize(kpiValue, itemWidth - 4) as string[]).slice(0, 2);
                pdf.text(wrappedKpiValueLines, x + 2, primaryValueY, {
                  lineHeightFactor: 1.16,
                  maxWidth: itemWidth - 4,
                });
                kpiValueLineCount = wrappedKpiValueLines.length;
              }
              pdf.setFontSize(5.6);
              pdf.setTextColor("#a1a1aa");
              const kpiStatusY = primaryValueY + (kpiValueLineCount - 1) * 4.6 + 4.8;
              pdf.text(`${localizePdfPresentationLabel("Status", pdfLocale)}: ${localizePdfPresentationLabel(status, pdfLocale)}`, x + 2, kpiStatusY, { maxWidth: itemWidth - 4 });
              pdf.setFillColor("#27272a");
              pdf.roundedRect(x + 2, itemY + itemHeight - 5, itemWidth - 4, 1.5, 0.7, 0.7, "F");
              pdf.setFillColor("#5eead4");
              pdf.roundedRect(x + 2, itemY + itemHeight - 5, Math.max(0, ((itemWidth - 4) * (score ?? 0)) / 100), 1.5, 0.7, 0.7, "F");
              return;
            }
            if (isScenario) {
              const snippet = extractScenarioSnippet(content, label) || extractKeywordInsight(content, [label]);
              pdf.setTextColor("#f4f4f5");
              pdf.setFontSize(6);
              pdf.text(truncatePdfCellLines(pdf.splitTextToSize(localizePdfPresentationText(snippet || "Scenario path under review.", pdfLocale), itemWidth - 4) as string[], 2), x + 2, itemY + 8.1, {
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
              pdf.setFontSize(5.8);
              pdf.setTextColor("#a1a1aa");
              pdf.text(
                financialLayout.detailLines.map((line) => localizePdfPresentationText(line, pdfLocale)),
                bodyX + 3,
                detailsY + 4,
                {
                lineHeightFactor: 1.16,
                maxWidth: bodyWidth - 6,
                }
              );
            }

            return financialLayout?.totalHeight ?? 0;
          }

          if (isKpiDashboard) {
            return 68;
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

        if (pdfKeyTakeawayCardFields.has(section.field ?? "")) {
          const takeaway = getSectionTakeaway(section.content);
          if (!takeaway) {
            return 0;
          }
          const previousFontSize = pdf.getFontSize();
          pdf.setFontSize(8.4);
          const takeawayLines = wrapPdfText(localizePdfPresentationText(takeaway, pdfLocale), bodyWidth - 12);
          pdf.setFontSize(previousFontSize);
          return Math.max(16, 8 + takeawayLines.length * 4.4);
        }

        // CRITICAL FIX -- confirmed live (root-cause repair): this
        // function had NO branch matching Executive Summary at all, so it
        // fell through to the generic keyword-regex fallback at the
        // bottom (which does not match "Executive Summary") and returned
        // 0. Since the drawing loop below only calls drawSectionVisual
        // (which DOES have a matching branch and draws the real Decision/
        // Confidence/Why/Top-Risk card) when this function returns a
        // positive height, the entire Executive Decision card could be
        // silently absent from the PDF, not merely truncated. Must call
        // the SAME getExecutiveDecisionCardLayout used by
        // drawSectionVisual's own branch, or drawing and pagination
        // height disagree.
        if (
          section.field === "executiveSummary" ||
          normalizedTitle.includes("executive summary") ||
          normalizedTitle.includes("yönetici özeti")
        ) {
          return getExecutiveDecisionCardLayout(section.content, bodyWidth).totalHeight;
        }

        if (normalizedTitle.includes("financial dashboard")) {
          return getFinancialLayout(section.content, bodyWidth).totalHeight;
        }

        if (normalizedTitle.includes("swot")) {
          return getSwotLayout(section.content, bodyWidth).totalHeight;
        }

        if (normalizedTitle.includes("porter")) {
          // Must match drawSectionVisual's own isPorterSection branch
          // exactly (Math.max(44, forces.length(5) * forceCardSpacing(16))).
          return Math.max(44, 5 * 16);
        }

        if (
          section.field === "founderScore" ||
          normalizedTitle.includes("founder score") ||
          normalizedTitle.includes("founder readiness") ||
          normalizedTitle.includes("kurucu skoru") ||
          normalizedTitle.includes("kurucu hazırlık")
        ) {
          return 46;
        }

        if (normalizedTitle.includes("tam / sam / som")) {
          return getTamVisualHeight();
        }

        if (
          section.field !== "roiAnalysis" &&
          section.field !== "irrAnalysis" &&
          normalizedTitle.includes("scenario")
        ) {
          return 26;
        }

        if (normalizedTitle.includes("competitor") || normalizedTitle.includes("competitive landscape")) {
          // Row source must match drawSectionVisual's own fork exactly --
          // MI reports draw extractMarketIntelligenceCompetitorRows (plus
          // the Market Map), everything else draws extractCompetitorRows
          // with no Market Map -- or drawing and pagination height disagree.
          if (isMarketIntelligenceReport) {
            const rows = extractMarketIntelligenceCompetitorRows(
              section.content,
              pdfSections.find((entry) => entry.field === "majorPlayers")?.content
            );
            // Must match drawSectionVisual's own compactCompetitorState
            // fork exactly -- see its own comment -- or drawing and
            // pagination height disagree.
            if (rows.length === 0) {
              const namesOnly = extractMarketIntelligenceCompetitorNamesOnly(
                pdfSections.find((entry) => entry.field === "majorPlayers")?.content || ""
              );
              if (namesOnly.length > 0) {
                return getNamesOnlyCompetitorLayout(namesOnly, bodyWidth, adjacentPlayersOnlyIntro).totalHeight + 8 + 50;
              }
            } else if (rows.length < minCompetitorTableRows) {
              return (
                getNamesOnlyCompetitorLayout(
                  rows.map((row) => row.vendor || "Vendor"),
                  bodyWidth,
                  sparseCompetitorTableIntro
                ).totalHeight +
                8 +
                50
              );
            }
            return 8 + Math.max(1, rows.length) * 15 + 4 + 8 + 50;
          }
          const rows = extractCompetitorRows(section.content);
          if (rows.length === 0) {
            return 8 + 15 + 4;
          }
          if (rows.length < minCompetitorTableRows) {
            return getNamesOnlyCompetitorLayout(
              rows.map((row) => row.company || "Company"),
              bodyWidth,
              sparseCompetitorTableIntro
            ).totalHeight;
          }
          return 8 + rows.length * 15 + 4;
        }

        if (section.field !== "postMergerIntegrationPlan" && normalizedTitle.includes("roadmap")) {
          return 31;
        }

        if (normalizedTitle.includes("kpi")) {
          return 68;
        }

        if (normalizedTitle.includes("unit economics")) {
          return 23;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          return 48;
        }

        if (isMarketIntelligenceReport && section.field === "marketSize") {
          return marketMetricsDashboardHeight;
        }

        // TASK #25C -- Strategic Recommendations' own dedicated
        // pagination branch (pdfSections.forEach below) computes and
        // consumes its row heights directly and never reads this
        // function's return value for that section, so no branch is
        // needed here any more; see that branch's own comment.

        return /founder score|founder readiness|scenario|roadmap|competitor|porter|kpi|risk|unit economics/i.test(section.title)
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
        let tocDrawnCount = 0;
        for (const [index, entry] of tocEntries.entries()) {
          if (tocY > pageHeight - 26) {
            break;
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
          tocDrawnCount += 1;
        }

        // The TOC is a single fixed page reserved before section pagination
        // runs, so it cannot grow to fit an arbitrary number of entries.
        // Long reports (e.g. a full 25-field Business Plan) can have more
        // sections than fit here -- surface the count instead of silently
        // dropping their entries with no indication anything is missing.
        // Every section still exists in the body; only its TOC shortcut is
        // omitted.
        const hiddenTocCount = tocEntries.length - tocDrawnCount;
        if (hiddenTocCount > 0) {
          pdf.setFontSize(8);
          pdf.setTextColor("#71717a");
          pdf.text(
            moreTocSectionsCopy[pdfLocale](hiddenTocCount),
            margin,
            Math.min(tocY + 2, pageHeight - 18)
          );
        }

        drawFooter();
      };

      pdfSections.forEach((section) => {
        const visualHeight = getVisualHeight(section);
        const isTamSamSomPdfSection = section.field === "tamSamSom" || isTamSamSomTitle(section.title);
        // FINAL CLEANUP -- these fields' visuals (drawSectionVisual) are
        // now each section's COMPLETE presentation (see
        // pdfCompleteVisualFields' own comment) -- their raw paragraph
        // never draws a second time below the visual. Every other section
        // keeps its existing body text, unchanged.
        const isPdfCompleteVisualSection = pdfCompleteVisualFields.has(section.field ?? "") || isTamSamSomPdfSection;
        // P0 FIX #8 -- confirmed live (Key Takeaway / body duplication
        // repair): pdfKeyTakeawayCardFields draws a highlighted Key
        // Takeaway box (drawSectionVisual, below) ABOVE this same body
        // text -- previously the body still started with the identical
        // leading sentence/bulleted item ("1) Integration-first add-on
        // products...", the exact reported production shape), since
        // nothing here ever removed it. stripLeadingTakeawaySentence
        // (report-presentation.ts) is the ONE canonical function that
        // removes JUST that duplicate -- conservative by design, it
        // returns the content completely unchanged whenever there is any
        // uncertainty, so distinct evidence/qualifiers/numbers/citations
        // and every sentence after the first are never touched.
        const isKeyTakeawayCardSection = pdfKeyTakeawayCardFields.has(section.field ?? "");
        const sectionContentWithoutTakeawayDuplication = isKeyTakeawayCardSection
          ? stripLeadingTakeawaySentence(section.content, getSectionTakeaway(section.content))
          : section.content;
        // TASK #29E -- confirmed live (real persisted report): the CAGR
        // section's raw content can genuinely contain no growth-rate
        // percentage anywhere (a real generation-time content gap, not a
        // presentation bug -- the same raw text also drives the Market
        // Metrics tile's "CAGR" value via extractHeadlineCagrValue, which
        // already falls back to a blank/"Validation Needed" tile in that
        // case). Left to the generic pipeline below, that same content
        // still contains a source citation/URL fragment ("- [Estimated]
        // https://.../report — Emergen Research US CLM market report."),
        // which upstream metadata/artifact stripping (cleanPdfEvidence-
        // MetadataText, stripReportPresentationArtifacts) legitimately
        // removes piece by piece, leaving a dangling, unprofessional
        // remainder ("- — Emergen Research US CLM market report.") rather
        // than the malformed content itself being the bug. Detecting this
        // BEFORE any of that stripping runs -- straight from the section's
        // own raw content, via the same extractHeadlineCagrValue used by
        // the tile -- and substituting one explicit, honest "Validation
        // Required" sentence is the correct fix: it never fires when a
        // real percentage is present (that text is completely untouched,
        // still flowing through the exact same pipeline as before), and
        // it can never itself be reduced to a fragment since it carries no
        // URL/citation markup for a later pass to strip.
        const isCagrSection = section.field === "cagr";
        const cagrHeadlineValue = isCagrSection ? extractHeadlineCagrValue(section.content) : "";
        const cagrValidationRequiredText =
          pdfLocale === "tr"
            ? "Bu rapordaki kaynaklarda bir CAGR (yıllık bileşik büyüme oranı) yüzdesi belirtilmemiştir. Doğrulanana kadar bu değer Doğrulama Gerekli olarak işaretlenmiştir."
            : "A CAGR percentage was not stated in this report's own sources. This value is marked Validation Required until it can be confirmed.";
        // stripReportPresentationArtifacts wraps every branch as the final
        // step -- pdfSections is already filtered to exclude Sources/
        // External Evidence sections above, so isSourceSectionTitle can no
        // longer match here, but this final pass is the last line of
        // defense against any OTHER internal artifact a PDF-specific
        // content transform (cleanPdfEvidenceMetadataText,
        // cleanPdfLegacyValidationIntelligenceContent, ...) might
        // reintroduce or fail to catch, on every rendering surface, not
        // just the ones already sanitized upstream.
        // TASK #34 -- confirmed live (citation-integrity audit): this PDF
        // path never called sanitizeMarketIntelligencePresentationText at
        // all, unlike page.tsx (:5634) and Planner.tsx's web view (:7494)
        // -- a genuine web/PDF asymmetry for Market Intelligence's own
        // dangling "| Evidence: ,"-shaped residue and internal heading
        // relabeling. Mirrors the identical ordering (MI pass wraps the
        // already-stripped result) both other surfaces already use.
        const rawSectionBodyContent = stripReportPresentationArtifacts(
          isPdfCompleteVisualSection
            ? ""
            : isCagrSection && !cagrHeadlineValue
              ? cagrValidationRequiredText
              : isSourceSectionTitle(section.title)
              ? isLegalReport
                ? formatLegalSourceContent(section.content, pdfLocale)
                : localizePdfPresentationText(formatPdfCitationContent(section.content, isRealEstateReport), pdfLocale)
              : localizePdfPresentationText(
                  cleanPdfLegacyValidationIntelligenceContent(
                    cleanPdfEvidenceMetadataText(
                      removeDuplicateVisualText(
                        section.title,
                        section.field === "founderScore"
                          ? normalizeFounderReadinessScoreText(
                              section.content,
                              readFounderReadinessScoreValue(report.investmentScore)
                            )
                          : sectionContentWithoutTakeawayDuplication
                      )
                    )
                  ),
                  pdfLocale
                )
        );
        const sectionBodyContent = isMarketIntelligenceReport
          ? sanitizeMarketIntelligencePresentationText(rawSectionBodyContent)
          : rawSectionBodyContent;
        // Same font-measurement bug the SWOT/financial layouts above
        // already document: splitPdfReadableLines measures wrapping at
        // whatever font is active on `pdf` right now, which is whatever
        // the PREVIOUS section's drawing left behind (this runs before
        // this section's own setFontSize call below) -- not the font
        // this section's body will actually be drawn at (9.2 for
        // Executive Summary, 8.8 otherwise). Pin to the real draw-time
        // font before measuring so the line count used for pagination
        // budgeting matches what jsPDF will actually render.
        const bodyLinesPreviousFontSize = pdf.getFontSize();
        pdf.setFontSize(section.title.toLowerCase().includes("executive summary") ? 9.2 : 8.8);
        const bodyLines = splitPdfReadableLines(sectionBodyContent, bodyWidth);
        pdf.setFontSize(bodyLinesPreviousFontSize);
        const hasBodyText = sectionBodyContent.trim().length > 0;

        if (isSourceSectionTitle(section.title) && !hasBodyText) {
          return;
        }

        if (isTamSamSomPdfSection) {
          const cardHeight = Math.max(31, cardHeaderHeight + visualHeight + cardBottomPadding);
          ensureSpace(cardHeight);
          tocEntries.push({
            title: getPdfTocEntryTitle(section, pdfLocale),
            page: pdf.getCurrentPageInfo().pageNumber,
          });

          drawPdfSectionCardFrame(pdf, { margin, y, contentWidth, cardHeight });

          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          pdf.text(section.title, bodyX, y + 12.5, {
            maxWidth: bodyWidth,
          });

          drawSectionVisual(section, y);
          y += cardHeight + minSectionGap;

          // No body text ever draws here: pdfCompleteVisualFields
          // suppresses sectionBodyContent entirely for TAM/SAM/SOM (see
          // its own comment) -- the visual's per-layer real assumption
          // sentence, drawn above, is already this section's complete
          // presentation, so hasBodyText is always false at this point.

          return;
        }

        // TASK #25C -- Strategic Recommendations gets its own dedicated
        // branch, drawn as one or more "continued" cards instead of a
        // single drawSectionVisual(section, y) call. Root cause of the
        // reported defect: once computeRecommendationCardLayout no
        // longer truncates action text to 2 lines (see its own comment),
        // the card grid's total height is genuinely data-dependent and
        // can exceed a single page -- something the generic single-call
        // visual dispatch above has no way to react to mid-draw. This
        // paginates by whole ROWS (a row is 2 cards): as many complete
        // rows as fit in the space left on the current page are drawn
        // in one card, then a fresh "continued" card picks up the
        // remaining rows, exactly like the generic body-text loop below
        // already does for long prose. A row (and therefore every card
        // and its full action text) is never split across two pages.
        // Every action is read from extractRecommendationItems' own
        // already-shared, order-preserving list exactly once, for
        // whatever count it returns -- nothing here hardcodes a count.
        if (isMarketIntelligenceReport && section.title.toLowerCase().includes("strategic recommendation")) {
          const items = extractRecommendationItems(section.content);

          if (items.length === 0) {
            return;
          }

          const columns = 2;
          const cardGap = recommendationCardGap;
          const cardWidth = (bodyWidth - (columns - 1) * cardGap) / columns;
          const { cards, rowHeights } = computeRecommendationRowHeights(items, cardWidth);

          const strategicRecommendationDecision = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
            recommendationCanonicalState,
            pdfSections.find((entry) => entry.field === "executiveSummary")?.content || "",
            pdfLocale === "tr" ? "Turkish" : "English"
          );
          const decisionBadgeText =
            strategicRecommendationDecision.decisionLabel !== "—"
              ? `${localizePdfPresentationLabel("Current Decision", pdfLocale)}: ${strategicRecommendationDecision.decisionLabel}`
              : "";

          const drawRecommendationFieldValue = (
            text: string,
            x: number,
            lineY: number,
            maxWidth: number,
            size: number,
            minSize = 5.4
          ) => {
            let fontSize = size;
            pdf.setFontSize(fontSize);
            while (fontSize > minSize && pdf.getTextWidth(text) > maxWidth) {
              fontSize -= 0.35;
              pdf.setFontSize(fontSize);
            }
            const safeText =
              pdf.getTextWidth(text) > maxWidth
                ? `${text.slice(0, Math.max(4, Math.floor(text.length * (maxWidth / Math.max(pdf.getTextWidth(text), 1))) - 1))}…`
                : text;
            pdf.text(safeText, x, lineY);
          };

          let rowCursor = 0;
          let isFirstChunk = true;

          while (rowCursor < rowHeights.length) {
            const chunkBadgeHeight = isFirstChunk ? strategicRecommendationDecisionBadgeHeight : 0;
            let rowsInChunk = 0;
            let chunkRowsHeight = 0;

            for (let candidate = rowCursor; candidate < rowHeights.length; candidate += 1) {
              const candidateGap = candidate > rowCursor ? cardGap : 0;
              const candidateRowsHeight = chunkRowsHeight + candidateGap + rowHeights[candidate];
              const candidateCardHeight =
                cardHeaderHeight + chunkBadgeHeight + candidateRowsHeight + cardBottomPadding;

              // Always keep at least one row per chunk -- a single
              // pathologically tall row still gets its own page rather
              // than looping forever trying to find a chunk that fits.
              if (rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight) {
                break;
              }

              chunkRowsHeight = candidateRowsHeight;
              rowsInChunk += 1;
            }

            const chunkCardHeight = Math.max(
              31,
              cardHeaderHeight + chunkBadgeHeight + chunkRowsHeight + cardBottomPadding
            );

            ensureSpace(chunkCardHeight);

            if (isFirstChunk) {
              tocEntries.push({
                title: getPdfTocEntryTitle(section, pdfLocale),
                page: pdf.getCurrentPageInfo().pageNumber,
              });
            }

            drawPdfSectionCardFrame(pdf, { margin, y, contentWidth, cardHeight: chunkCardHeight });

            pdf.setFontSize(14);
            pdf.setTextColor("#ffffff");
            const displaySectionTitle = getPdfSectionCardTitle(section, pdfLocale);
            const chunkTitle = isFirstChunk
              ? displaySectionTitle
              : `${displaySectionTitle}${pdfLocale === "tr" ? " devamı" : " continued"}`;
            if (chunkTitle) {
              pdf.text(chunkTitle, bodyX, y + 12.5, { maxWidth: bodyWidth });
            }

            const contentTopY = y + 18 + minHeadingToContentGap;

            if (isFirstChunk && decisionBadgeText) {
              pdf.setFontSize(5.6);
              pdf.setTextColor("#a1a1aa");
              pdf.text(decisionBadgeText, bodyX, contentTopY + 3.6, { maxWidth: bodyWidth });
            }

            const rowsTopY = contentTopY + chunkBadgeHeight;

            cards
              .slice(rowCursor * columns, (rowCursor + rowsInChunk) * columns)
              .forEach((card, indexInChunk) => {
                const absoluteIndex = rowCursor * columns + indexInChunk;
                const col = indexInChunk % columns;
                const rowInChunk = Math.floor(indexInChunk / columns);
                const x = bodyX + col * (cardWidth + cardGap);
                const cardY =
                  rowsTopY +
                  rowHeights
                    .slice(rowCursor, rowCursor + rowInChunk)
                    .reduce((sum, height) => sum + height + cardGap, 0);
                const cardHeight = rowHeights[rowCursor + rowInChunk];
                const { gate, actionLines, fields, classification } = card;

                pdf.setFillColor("#18181b");
                pdf.setDrawColor("#27272a");
                pdf.roundedRect(x, cardY, cardWidth, cardHeight, 2.5, 2.5, "FD");

                pdf.setFillColor("#042f2e");
                pdf.setDrawColor("#5eead4");
                pdf.circle(x + 6, cardY + 6, 3, "FD");
                pdf.setFontSize(5.6);
                pdf.setTextColor("#ccfbf1");
                pdf.text(String(absoluteIndex + 1), x + 4.7, cardY + 7.4);

                pdf.setFontSize(5.2);
                pdf.setTextColor("#71717a");
                // TASK #31 -- explicit action-type classification appended
                // next to the existing "ACTION" label (never a new
                // element/row -- see this task's own "without cluttering
                // the UI" requirement), truncated to the card's own
                // available width exactly like every other field value
                // already does via drawRecommendationFieldValue.
                drawRecommendationFieldValue(
                  `${localizePdfPresentationLabel("ACTION", pdfLocale)} · ${classification.actionTypeLabel.toUpperCase()}${classification.relatedEvidenceGapId ? ` → ${classification.relatedDecisionThreshold?.gapLabel.toUpperCase()}` : ""}`,
                  x + 11,
                  cardY + 4,
                  cardWidth - 13,
                  5.2,
                  4
                );
                pdf.setFontSize(6);
                pdf.setTextColor("#e4e4e7");
                pdf.text(actionLines, x + 11, cardY + 7.8, {
                  lineHeightFactor: 1.15,
                  maxWidth: cardWidth - 13,
                });

                const fieldsTopY = cardY + 7.8 + actionLines.length * 3.3 + 2.5;
                const fieldColWidth = (cardWidth - 6) / 2;

                if (fields.length > 0) {
                  pdf.setDrawColor("#27272a");
                  pdf.line(x + 3, fieldsTopY - 1.6, x + cardWidth - 3, fieldsTopY - 1.6);

                  fields.slice(0, 6).forEach(([label, value], fieldIndex) => {
                    const fx = x + 3 + (fieldIndex % 2) * fieldColWidth;
                    const fy = fieldsTopY + Math.floor(fieldIndex / 2) * 5.6;

                    pdf.setFontSize(4.4);
                    pdf.setTextColor("#71717a");
                    pdf.text(localizePdfPresentationLabel(label, pdfLocale).toUpperCase(), fx, fy);
                    pdf.setFontSize(5.2);
                    pdf.setTextColor("#5eead4");
                    drawRecommendationFieldValue(value, fx, fy + 2.8, fieldColWidth - 2, 5.2, 4);
                  });
                }

                if (gate) {
                  pdf.setFontSize(4.4);
                  pdf.setTextColor("#71717a");
                  pdf.text(localizePdfPresentationLabel("DECISION GATE", pdfLocale), x + 3, cardY + cardHeight - 5.4);
                  pdf.setFontSize(5);
                  pdf.setTextColor("#fbbf24");
                  drawRecommendationFieldValue(gate, x + 3, cardY + cardHeight - 2, cardWidth - 6, 5, 4);
                }
              });

            y += chunkCardHeight + minSectionGap;
            rowCursor += rowsInChunk;
            isFirstChunk = false;
          }

          // TASK #35 -- requirement #6 (bounded gap -> validation action ->
          // measurable result -> decision consequence) + requirement #7
          // (web/PDF parity): draws the SAME structured gap-driven actions
          // the web Strategic Recommendations card already renders
          // (buildMarketIntelligenceGapDrivenActions, itself built only
          // from the SAME canonical decisionCriticalEvidence pillars every
          // other MI surface reads) -- never a second, independently
          // derived PDF-only list. Appended as trailing rows within this
          // same section rather than a new TOC entry, since it is part of
          // Strategic Recommendations, not a separate section.
          const marketGapDrivenActions = buildMarketIntelligenceGapDrivenActions(
            recommendationCanonicalState,
            pdfLocale === "tr" ? "Turkish" : "English"
          );
          // TASK #37 -- requirement #4: MONITOR must explicitly identify
          // which unresolved decision-critical condition(s) are
          // preventing ENTER. Reads the SAME canonical threshold-state
          // object the web card reads -- never independently re-derived.
          const marketDecisionThresholdState = resolveMarketIntelligenceDecisionThresholdState(
            recommendationCanonicalState,
            pdfLocale === "tr" ? "Turkish" : "English"
          );
          const controllingFactorText = marketDecisionThresholdState?.controllingUnresolvedCondition
            ? `${pdfLocale === "tr" ? "Kontrol Eden Faktör" : "Controlling Factor"}: ${marketDecisionThresholdState.controllingUnresolvedCondition.label}`
            : "";

          if (marketGapDrivenActions.length > 0) {
            const gapsLabel = pdfLocale === "tr" ? "Kapatılması Gereken Kanıt Boşlukları" : "Evidence Gaps to Close";
            const thresholdLabel = pdfLocale === "tr" ? "KARAR EŞİĞİ" : "DECISION THRESHOLD";
            const enterIfLabel = pdfLocale === "tr" ? "GİR EĞER" : "ENTER IF";
            const monitorIfLabel = pdfLocale === "tr" ? "İZLE EĞER" : "MONITOR IF";
            const avoidIfLabel = pdfLocale === "tr" ? "KAÇIN EĞER" : "AVOID IF";
            const gapRowHeight = 36;

            let gapCursor = 0;
            let isFirstGapChunk = true;

            while (gapCursor < marketGapDrivenActions.length) {
              let rowsInChunk = 0;
              let chunkRowsHeight = 0;

              for (let candidate = gapCursor; candidate < marketGapDrivenActions.length; candidate += 1) {
                const candidateRowsHeight = chunkRowsHeight + gapRowHeight;
                const candidateCardHeight = cardHeaderHeight + candidateRowsHeight + cardBottomPadding;
                if (rowsInChunk > 0 && candidateCardHeight > maxUsableCardHeight) {
                  break;
                }
                chunkRowsHeight = candidateRowsHeight;
                rowsInChunk += 1;
              }

              const chunkCardHeight = Math.max(31, cardHeaderHeight + chunkRowsHeight + cardBottomPadding);
              ensureSpace(chunkCardHeight);

              drawPdfSectionCardFrame(pdf, { margin, y, contentWidth, cardHeight: chunkCardHeight });

              pdf.setFontSize(14);
              pdf.setTextColor("#ffffff");
              const chunkTitle = isFirstGapChunk ? gapsLabel : `${gapsLabel}${pdfLocale === "tr" ? " devamı" : " continued"}`;
              pdf.text(chunkTitle, bodyX, y + 12.5, { maxWidth: bodyWidth });

              if (isFirstGapChunk && controllingFactorText) {
                pdf.setFontSize(5.6);
                pdf.setTextColor("#a1a1aa");
                pdf.text(controllingFactorText, bodyX, y + 17, { maxWidth: bodyWidth });
              }

              const rowsTopY = y + 19;

              marketGapDrivenActions
                .slice(gapCursor, gapCursor + rowsInChunk)
                .forEach((gapAction, indexInChunk) => {
                  const rowY = rowsTopY + indexInChunk * gapRowHeight;
                  if (indexInChunk > 0) {
                    pdf.setDrawColor("#27272a");
                    pdf.line(bodyX, rowY - 4, bodyX + bodyWidth, rowY - 4);
                  }

                  pdf.setFontSize(7.2);
                  pdf.setTextColor("#e4e4e7");
                  drawRecommendationFieldValue(gapAction.gapLabel, bodyX, rowY, bodyWidth, 7.2, 5.5);

                  pdf.setFontSize(5.6);
                  pdf.setTextColor("#71717a");
                  drawRecommendationFieldValue(gapAction.action, bodyX, rowY + 4.6, bodyWidth, 5.6, 4.4);

                  pdf.setFontSize(5.6);
                  pdf.setTextColor("#a1a1aa");
                  drawRecommendationFieldValue(gapAction.measurableResult, bodyX, rowY + 9.2, bodyWidth, 5.6, 4.4);

                  pdf.setFontSize(5.4);
                  pdf.setTextColor("#fbbf24");
                  drawRecommendationFieldValue(gapAction.decisionConsequence, bodyX, rowY + 13.8, bodyWidth, 5.4, 4.2);

                  // TASK #36 -- the SAME structured per-gap decision
                  // threshold the web Strategic Recommendations card
                  // already renders (resolveMarketIntelligenceDecisionThresholds,
                  // attached to this action by buildMarketIntelligenceGapDrivenActions)
                  // -- never a second, independently derived PDF-only
                  // threshold. "Threshold requires validation" is drawn
                  // verbatim, exactly like the web card, rather than
                  // inventing a number for the PDF alone.
                  pdf.setFontSize(4.2);
                  pdf.setTextColor("#71717a");
                  pdf.text(thresholdLabel, bodyX, rowY + 18.2);

                  pdf.setFontSize(4.6);
                  pdf.setTextColor("#5eead4");
                  drawRecommendationFieldValue(
                    `${enterIfLabel} — ${gapAction.threshold.enterCondition.description}`,
                    bodyX,
                    rowY + 22.4,
                    bodyWidth,
                    4.6,
                    3.8
                  );

                  pdf.setFontSize(4.6);
                  pdf.setTextColor("#a1a1aa");
                  drawRecommendationFieldValue(
                    `${monitorIfLabel} — ${gapAction.threshold.monitorCondition.description}`,
                    bodyX,
                    rowY + 26.8,
                    bodyWidth,
                    4.6,
                    3.8
                  );

                  pdf.setFontSize(4.6);
                  pdf.setTextColor("#fca5a5");
                  drawRecommendationFieldValue(
                    `${avoidIfLabel} — ${gapAction.threshold.avoidCondition.description}`,
                    bodyX,
                    rowY + 31.2,
                    bodyWidth,
                    4.6,
                    3.8
                  );
                });

              y += chunkCardHeight + minSectionGap;
              gapCursor += rowsInChunk;
              isFirstGapChunk = false;
            }
          }

          return;
        }

        const safeBodyLines = bodyLines.length > 0 ? bodyLines : [""];
        const isExecutiveSummarySection = section.title.toLowerCase().includes("executive summary");
        const isKpiPdfSection =
          section.field === "kpiDashboard" ||
          section.field === "kpis" ||
          section.title.toLowerCase().includes("kpi");
        const isSourcePdfSection = isSourceSectionTitle(section.title);
        // Sources cards get extra bottom padding (>= 40px) -- the
        // general cardBottomPadding (9mm, ~34px) is close but falls
        // just short of the requested minimum for this section.
        const sectionCardBottomPadding = isSourcePdfSection ? minPageBottomPadding : cardBottomPadding;
        const sectionBodyLineHeight = isExecutiveSummarySection
          ? 5.75
          : isKpiPdfSection
            ? kpiBodyLineHeight
            : bodyLineHeight;
        let lineIndex = 0;

        // Prefer moving an entire section to a fresh page over starting a
        // split ("continued") card: only content that is genuinely too
        // long for a single page (fullCardHeight > maxUsableCardHeight)
        // still falls through to the incremental chunking below. This is
        // what keeps SWOT/KPI visuals and short source lists from being
        // split just because they didn't quite fit in what was left of
        // the current page.
        const fullBodyTextHeight = hasBodyText ? safeBodyLines.length * sectionBodyLineHeight : 0;
        const fullCardHeight = Math.max(
          31,
          cardHeaderHeight + visualHeight + fullBodyTextHeight + sectionCardBottomPadding
        );
        if (fullCardHeight <= maxUsableCardHeight) {
          ensureSpace(fullCardHeight);
        }

        while (lineIndex < safeBodyLines.length) {
          const activeVisualHeight = lineIndex === 0 ? visualHeight : 0;
          const bodyTextHeight = hasBodyText ? sectionBodyLineHeight : 0;
          const minimumCardHeight =
            cardHeaderHeight + activeVisualHeight + bodyTextHeight + sectionCardBottomPadding + 3;

          ensureSpace(minimumCardHeight);

          if (lineIndex === 0) {
            tocEntries.push({
              title: getPdfTocEntryTitle(section, pdfLocale),
              page: pdf.getCurrentPageInfo().pageNumber,
            });
          }

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - activeVisualHeight - sectionCardBottomPadding;
          let maxLines = Math.max(1, Math.floor(availableHeight / sectionBodyLineHeight));
          if (safeBodyLines.length - lineIndex - maxLines === 1 && maxLines > 1) {
            maxLines -= 1;
          }

          // Keep each source entry ("• Name" plus its metadata lines)
          // together: never cut between a bullet's start and its last
          // metadata line unless that single entry alone cannot fit on
          // a fresh page (a case this fixed-width content never hits in
          // practice, but the fallback keeps this safe either way).
          if (isSourcePdfSection && lineIndex + maxLines < safeBodyLines.length) {
            let snappedBoundary = -1;
            for (
              let candidate = lineIndex + maxLines;
              candidate > lineIndex;
              candidate -= 1
            ) {
              if (safeBodyLines[candidate]?.startsWith("•")) {
                snappedBoundary = candidate;
                break;
              }
            }
            if (snappedBoundary > lineIndex) {
              maxLines = snappedBoundary - lineIndex;
            }
          }

          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight +
              activeVisualHeight +
              (hasBodyText ? lines.length * sectionBodyLineHeight : 0) +
              sectionCardBottomPadding
          );

          drawPdfSectionCardFrame(pdf, { margin, y, contentWidth, cardHeight });

          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          const displaySectionTitle = getPdfSectionCardTitle(section, pdfLocale);
          const sectionTitle = isContinued
            ? isSourcePdfSection
              ? `${displaySectionTitle} ${pdfLocale === "tr" ? "(devamı)" : "(continued)"}`
              : `${displaySectionTitle}${pdfLocale === "tr" ? " devamı" : " continued"}`
            : displaySectionTitle;

          if (sectionTitle) {
            pdf.text(sectionTitle, bodyX, y + 12.5, {
              maxWidth: bodyWidth,
            });
          }

          const drawnVisualHeight =
            activeVisualHeight > 0 && !isContinued && !isTamSamSomPdfSection
              ? drawSectionVisual(section, y)
              : 0;

          if (hasBodyText) {
            pdf.setFontSize(isExecutiveSummarySection ? 9.2 : 8.8);
            pdf.setTextColor("#d4d4d8");
            pdf.text(lines, bodyX, y + minHeadingToContentGap + 19.5 + drawnVisualHeight, {
              // KPI explanation prose gets the same taller line-height as
              // Executive Summary (both use kpiBodyLineHeight === 5.75 for
              // their pagination budget, so the rendered spacing must match).
              lineHeightFactor: isExecutiveSummarySection || isKpiPdfSection ? 1.38 : 1.3,
              maxWidth: bodyWidth,
            });
          }

          lineIndex += lines.length;
          y += cardHeight + minSectionGap;
        }
      });

      // TASK #34 FOLLOW-UP -- the Sources PDF page this block used to draw
      // (resolveMarketIntelligenceSourcesForDisplay) is deliberately
      // removed: Sources is never rendered on any surface, for every
      // report kind (presentation-only decision). The underlying
      // structured citationSources registry and
      // resolveMarketIntelligenceSourcesForDisplay itself remain fully
      // intact in market-intelligence-canonical-state.ts.

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
  return pdf;
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
      if (isRealEstateDashboardReport(report)) {
        const resolvedExportLanguage = resolveReportLanguage({
          explicitLanguage: window.localStorage.getItem("zerinix_report_language"),
          requestText: report.prompt,
          uiLanguage: report.metadata?.reportLanguage,
          browserLanguage: navigator.language,
        });
        const realEstatePdf = createRealEstateReportPdf({
          report,
          fontBase64,
          language: resolvedExportLanguage,
        });
        deliverPdf(realEstatePdf, report, setError);
        return;
      }

      const pdf = buildStandardReportPdf({ report, fontBase64 });

      deliverPdf(pdf, report, setError);
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
