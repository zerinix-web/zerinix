"use client";

// Extracted verbatim from components/Planner.tsx as an incremental
// modularization step: a self-contained "citation parsing,
// normalization, deduplication, and presentation" responsibility.
// Every function/component here depends only on each other, the three
// already-imported external utilities below, and the FileText icon --
// nothing from Planner.tsx's own local state, hooks, or other
// component-scoped helpers. Moving them here changes nothing about
// their behavior.

import { FileText } from "lucide-react";
import { normalizePdfText, normalizePdfSourceDomain } from "@/app/lib/pdf-normalization.mjs";
import { sourceTypeToEvidenceLevel } from "@/app/lib/report-evidence";

export type CitationData = {
  sourceTitle: string;
  organization: string;
  publicationYear?: string;
  confidence?: "High" | "Medium" | "Low";
  url?: string;
  sourceType?: "Verified source" | "Company reference" | "Industry reference" | "Planning assumption";
};

export function normalizeCitationConfidence(value: string): CitationData["confidence"] | undefined {
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

export function normalizeSourceType(value: string): CitationData["sourceType"] {
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

export function getCitationDomain(url?: string, organization = "") {
  if (url) {
    return normalizePdfSourceDomain(url);
  }

  return normalizePdfSourceDomain(
    normalizePdfText(organization)
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|company|publisher|organization)\b\.?/g, "")
  );
}

export function getCitationSourceName(citation: Pick<CitationData, "sourceTitle" | "organization" | "url">) {
  return (
    getCitationDomain(citation.url, citation.organization) ||
    citation.organization ||
    citation.sourceTitle ||
    "Source"
  );
}

export function getCitationDedupeKey(citation: CitationData) {
  const domain = getCitationDomain(citation.url, citation.organization);
  const titleKey = normalizePdfText(citation.sourceTitle).toLowerCase().replace(/\W+/g, " ").trim();
  const organizationKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
  const domainNameKey = normalizePdfText(domain.split(".")[0] || "").toLowerCase().replace(/\W+/g, " ").trim();
  const sourceNameKey = normalizePdfText(getCitationSourceName(citation))
    .toLowerCase()
    .replace(/\W+/g, " ")
    .trim();
  const normalizedSourceName =
    domainNameKey &&
    (titleKey === domainNameKey ||
      organizationKey === domainNameKey ||
      sourceNameKey === domainNameKey ||
      titleKey.startsWith(`${domainNameKey} `) ||
      organizationKey.startsWith(`${domainNameKey} `))
      ? domainNameKey
      : sourceNameKey || titleKey || organizationKey;

  return [
    "source",
    domain || "no-domain",
    organizationKey || "unknown-publisher",
    normalizedSourceName || "unknown-source",
  ].join("|");
}

export function getPdfCitationSourceTypeLabel(citation: CitationData) {
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));

  if (level === "verified") return "Verified Source";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";

  return "Validation Required";
}

export function getPdfCitationTrustLabel(citation: CitationData) {
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));

  if (level === "verified") return "Verified";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";

  return "Validation Required";
}

export function dedupePdfCitations(citations: CitationData[]) {
  const unique = new Map<string, CitationData>();

  citations.forEach((citation) => {
    const normalizedUrl = normalizeCitationUrl(citation.url);
    const domain = getCitationDomain(normalizedUrl, citation.organization);
    const urlKey = `url:${normalizedUrl}`;
    const publisherKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
    const sourceNameKey = normalizePdfText(getCitationSourceName(citation))
      .toLowerCase()
      .replace(/\W+/g, " ")
      .trim();
    const key = [
      normalizedUrl ? urlKey : "",
      domain || "no-domain",
      publisherKey || "unknown-publisher",
      sourceNameKey || "unknown-source",
    ].join("|");
    const existing = unique.get(key);

    unique.set(key, {
      ...existing,
      ...citation,
      url: normalizedUrl || existing?.url || "",
      ...(existing?.url && !citation.url ? { url: existing.url } : {}),
      ...(existing?.sourceType && !citation.sourceType ? { sourceType: existing.sourceType } : {}),
      ...(existing?.confidence && !citation.confidence ? { confidence: existing.confidence } : {}),
    });
  });

  return Array.from(unique.values());
}

export function getFinalDedupePdfSources(citations: CitationData[]) {
  const unique = new Map<
    string,
    {
      sourceName: string;
      sourceType: string;
      trustLabel: string;
      publisher: string;
      publicationYear: string;
      url: string;
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
    const domainNameKey = normalizePdfText(domain.split(".")[0] || "")
      .toLowerCase()
      .replace(/\W+/g, " ")
      .trim();
    const sourceName = getCitationSourceName(citation);
    const sourceNameKey = normalizePdfText(sourceName).toLowerCase().replace(/\W+/g, " ").trim();
    const rawPublisherKey = normalizePdfText(citation.organization).toLowerCase().replace(/\W+/g, " ").trim();
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
        publisher: citation.organization || "Publisher not specified",
        publicationYear: citation.publicationYear || "",
        url: normalizeCitationUrl(citation.url),
      });
      unique.set(fallbackDisplayKey, unique.get(key)!);
    }
  });

  return Array.from(new Set(unique.values()));
}

export function normalizeCitationUrl(value = "") {
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

// Stray metadata-line values that survive `metadataMatch` but carry no
// real citation evidence (e.g. a leaked "Publisher: user" line) --
// too short/generic to be an actual publisher or title.
const STRAY_CITATION_FIELD_VALUES =
  /^(?:user|assistant|system|yes|no|n\/a|na|none|unknown|null|undefined)$/i;

function isPlausibleCitationField(value = "", minLength = 3) {
  const trimmed = value.trim();
  return trimmed.length >= minLength && !STRAY_CITATION_FIELD_VALUES.test(trimmed);
}

export function parseCitations(content: string): CitationData[] {
  if (/\bsource\s+unavailable\b/i.test(content)) {
    return [];
  }

  const fallbackConfidence = normalizeCitationConfidence(
    content.match(/\bconfidence\s*[:\-–—]\s*(high|medium|low|moderate|strong)\b/i)?.[1] || ""
  );

  const entries: CitationData[] = [];
  let current: Partial<CitationData> = {};
  const flushCurrent = () => {
    const hasUsableEvidence =
      Boolean(current.url) ||
      isPlausibleCitationField(current.organization || "") ||
      isPlausibleCitationField(current.sourceTitle || "", 4);
    if (hasUsableEvidence) {
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
    const key = getCitationDedupeKey(citation);
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

export function Citation({ citation }: { citation?: CitationData }) {
  if (!citation) {
    return null;
  }

  const sourceName = getCitationSourceName(citation);
  const trustLabel = citation.sourceType === "Verified source" && citation.url ? "Verified" : "Reference";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-6 text-white">{sourceName}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="rounded-full border border-teal-200/15 bg-teal-200/10 px-2.5 py-1 text-[11px] font-semibold text-teal-100">
            {citation.sourceType || "Verified source"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
            {trustLabel}
          </span>
        </div>
      </div>
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex w-fit items-center rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs font-semibold text-teal-100 transition hover:border-teal-200/25 hover:bg-teal-200/10"
        >
          Open source
        </a>
      ) : null}
    </div>
  );
}

export function SourcesCard({
  sections,
  legal = false,
}: {
  sections: { content: string }[];
  legal?: boolean;
}) {
  const mergedContent = sections
    .map((section) => section.content.trim())
    .filter(Boolean)
    .join("\n");
  const citations = parseCitations(mergedContent);

  if (!mergedContent) {
    return null;
  }

  return (
    <article className="rounded-[2rem] border border-teal-200/15 bg-teal-200/[0.045] p-5 shadow-xl shadow-black/30">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-teal-200/20 bg-teal-200/10">
          <FileText className="h-5 w-5 text-teal-100" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-200/80">
            Research Appendix
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-white">
            Sources
          </h3>
          <div className="mt-4 space-y-3">
            {citations.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {citations.map((citation, index) => (
                  <Citation
                    key={`${getCitationDomain(citation.url, citation.organization)}-${citation.sourceTitle}-${citation.publicationYear || ""}-${index}`}
                    citation={citation}
                  />
                ))}
              </div>
            ) : null}
            {!legal ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-sm font-semibold text-white">Methodology &amp; Assumptions</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Market sizing, financial projections and KPI estimates are based on available market signals, benchmark data and planning assumptions.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
