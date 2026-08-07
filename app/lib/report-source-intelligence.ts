// Source Intelligence: per-source type/trust/freshness/explanation,
// weak-source detection, and cross-claim deduplication for every
// external source cited in a report.
//
// Reuses source-reliability.ts's classifySourceReliability (already
// wired into every report via report-engine/metadata.ts) as the base
// category+score engine, rather than building a second, inconsistent
// classifier. This module only adds what that summary-only function
// does not compute: a per-source record (not just an aggregate
// distribution), publication freshness, explicit weak-source flags,
// and a trust-tier-grouped Executive Summary overview.
import {
  classifySourceReliability,
  type SourceReliabilityCategory,
} from "./source-reliability.ts";
import type { ResponseLanguage } from "./report-language.ts";

export const sourceIntelligenceTypeValues = [
  "Government",
  "Academic",
  "Company",
  "Industry",
  "News",
  "Unknown",
] as const;

export type SourceIntelligenceType = (typeof sourceIntelligenceTypeValues)[number];

export type TrustLevel = "High" | "Medium" | "Low";

export type FreshnessIndicator = "Fresh" | "Aging" | "Outdated" | "Unknown";

export type SourceWeaknessFlag =
  | "personal_blog"
  | "anonymous_source"
  | "ai_generated_content"
  | "link_shortener"
  | "informal_community_platform";

export type SourceIntelligenceRecord = {
  displayName: string;
  url: string;
  referenceIds: string[];
  occurrenceCount: number;
  sourceType: SourceIntelligenceType;
  trustLevel: TrustLevel;
  publicationDate: string | null;
  freshness: FreshnessIndicator;
  weaknessFlags: SourceWeaknessFlag[];
  explanation: string;
};

type RawSourceCandidate = {
  referenceId: string | null;
  title: string;
  url: string;
  publisher: string;
  dateRaw: string;
};

const linkShortenerDomains = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|shorturl\.at)\b/i;
const blogPlatformSignals = /\b(medium\.com|substack\.com|blogspot\.com|wordpress\.com|tumblr\.com)\b/i;
const blogPathSignal = /\/blog(?:\/|$|-)/i;
const communityPlatformSignals = /\b(reddit\.com|quora\.com|forum|discord\.com|telegram\.me|x\.com|twitter\.com)\b/i;
const aiContentSignals = /\b(ai[\s-]?generated|written by ai|gpt[\s-]?generated)\b/i;

// Sources named as report fields (sourcesAssumptions, sources, kaynak),
// matching the same field-selection convention source-reliability.ts's
// collectSourceCandidates already uses -- so this module and the
// existing wired metadata summary always look at the same text.
export function collectSourceFieldText(report: Record<string, string>) {
  const sourceText = Object.entries(report)
    .filter(([field]) => /source|sources|kaynak/i.test(field))
    .map(([, content]) => content)
    .join("\n");

  return sourceText || Object.values(report).join("\n");
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(url: string) {
  return url.trim().replace(/[.,;:)\]]+$/, "");
}

// Pulls "Key: value" pairs out of a pipe-delimited citation line, e.g.
// "- [R1] sec.gov | Publisher: sec.gov | URL: https://... | Source
// type: government/statistical source | Confidence: 64/100 (Medium)".
function parsePipeDelimitedMetadata(line: string) {
  const metadata: Record<string, string> = {};

  for (const segment of line.split("|").slice(1)) {
    const match = segment.match(/^\s*([A-Za-z ]+?):\s*(.+?)\s*$/);
    if (match) {
      metadata[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }

  return metadata;
}

// Parses the mixed citation formats actually produced across report
// types: pipe-delimited structured lines (Market Intelligence's
// evidence graph), "[R#] Title: description" followed by a bare URL
// on the next line (Business Idea Validation / Strategic Advisory
// research citations), and plain "Publisher:"/"URL:" metadata blocks.
// Tolerant by design: a line that matches nothing is simply not a
// citation, never guessed into one.
export function parseSourceCandidates(content: string): RawSourceCandidate[] {
  const lines = content.split("\n");
  const candidates: RawSourceCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const refMatch = line.match(/\[(R\d+)\]/i);
    const inlineUrlMatch = line.match(/https?:\/\/[^\s)\]|]+/i);
    const nextLine = lines[index + 1] || "";
    const nextLineIsBareUrl = /^\s*https?:\/\/\S+\s*$/i.test(nextLine);

    if (!refMatch && !inlineUrlMatch) {
      continue;
    }

    const url = normalizeUrl(
      inlineUrlMatch?.[0] || (nextLineIsBareUrl ? nextLine.trim() : "")
    );

    if (!refMatch && !url) {
      continue;
    }

    const metadata = parsePipeDelimitedMetadata(line);
    const beforeMetadata = line.split("|")[0];
    const titleText = beforeMetadata
      .replace(/^[-*•]\s*/, "")
      .replace(/\[R\d+\]\s*/i, "")
      .trim();

    candidates.push({
      referenceId: refMatch ? refMatch[1].toUpperCase() : null,
      title: titleText,
      url,
      publisher: metadata.publisher || "",
      dateRaw: metadata.published && metadata.published.toLowerCase() !== "not provided" ? metadata.published : "",
    });

    if (nextLineIsBareUrl && !inlineUrlMatch) {
      index += 1;
    }
  }

  return candidates;
}

function mapCategoryToSourceType(category: SourceReliabilityCategory): SourceIntelligenceType {
  if (category === "Official") return "Company";
  if (category === "Government" || category === "Academic" || category === "Industry" || category === "News") {
    return category;
  }
  // "Community" and "AI Generated" are surfaced as weakness flags
  // (requirement 2), not as a type of their own -- the task's type
  // taxonomy has no "Community"/"AI Generated" bucket.
  return "Unknown";
}

function detectWeaknessFlags(
  candidate: RawSourceCandidate,
  category: SourceReliabilityCategory,
  domain: string
): SourceWeaknessFlag[] {
  const text = `${candidate.title} ${candidate.publisher} ${candidate.url}`;
  const flags: SourceWeaknessFlag[] = [];

  if (domain && linkShortenerDomains.test(domain)) {
    flags.push("link_shortener");
  }

  if (blogPlatformSignals.test(text) || blogPathSignal.test(candidate.url)) {
    flags.push("personal_blog");
  }

  if (communityPlatformSignals.test(text) || category === "Community") {
    flags.push("informal_community_platform");
  }

  if (aiContentSignals.test(text) || category === "AI Generated") {
    flags.push("ai_generated_content");
  }

  if (!candidate.publisher.trim() && !candidate.title.trim() && !domain) {
    flags.push("anonymous_source");
  }

  return [...new Set(flags)];
}

function computeFreshness(dateRaw: string): FreshnessIndicator {
  const yearMatch = dateRaw.match(/\b(19|20)\d{2}\b/);
  if (!yearMatch) {
    return "Unknown";
  }

  const year = Number(yearMatch[0]);
  const currentYear = new Date().getUTCFullYear();
  const age = currentYear - year;

  if (age <= 1) return "Fresh";
  if (age <= 3) return "Aging";
  return "Outdated";
}

const WEAKNESS_TRUST_CEILING: TrustLevel = "Low";

function assessTrustLevel(score: number, weaknessFlags: SourceWeaknessFlag[]): TrustLevel {
  if (weaknessFlags.length > 0) {
    return WEAKNESS_TRUST_CEILING;
  }

  // Threshold set so Government/Academic/Official (85-92) land High
  // while Industry analysts and News (66-78) land Medium -- matching
  // the task's own example, which places Gartner under Medium Trust
  // alongside "Company Annual Reports" rather than High.
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

const weaknessExplanations: Record<SourceWeaknessFlag, string> = {
  personal_blog: "Personal blog or informal publishing platform with no editorial review -- verify independently before relying on it.",
  anonymous_source: "No publisher, author, or organization could be identified -- treat as unverified until a real source is confirmed.",
  ai_generated_content: "Shows signals of AI-generated or unverified content -- confirm with a primary or editorially reviewed source.",
  link_shortener: "Shortened link hides its true destination -- resolve and verify the real domain before trusting this source.",
  informal_community_platform: "Community/forum/social platform with no editorial oversight -- useful for signal, not for verified facts.",
};

const typeExplanations: Record<SourceIntelligenceType, string> = {
  Government: "Official government or statistical authority -- high reliability for factual and regulatory claims.",
  Academic: "Academic or peer-reviewed publication -- strong methodological credibility.",
  Company: "Primary company material (official site, investor relations, annual report) -- reliable for self-reported facts, verify for competitive claims.",
  Industry: "Recognized industry analyst or research firm -- credible for market benchmarks and sizing.",
  News: "Established news publisher -- useful for timely context, verify the original data source.",
  Unknown: "Source organization could not be confidently identified from the citation text -- treat findings as directional.",
};

function buildExplanation(sourceType: SourceIntelligenceType, weaknessFlags: SourceWeaknessFlag[]) {
  if (weaknessFlags.length > 0) {
    return weaknessFlags.map((flag) => weaknessExplanations[flag]).join(" ");
  }

  return typeExplanations[sourceType];
}

function pickDisplayName(candidate: RawSourceCandidate, domain: string) {
  const publisher = candidate.publisher.trim();
  if (publisher && publisher.toLowerCase() !== domain) {
    return publisher;
  }

  if (domain) {
    return domain;
  }

  return candidate.title.trim() || "Untitled source";
}

function dedupeKeyFor(candidate: RawSourceCandidate, domain: string) {
  return domain || candidate.title.trim().toLowerCase().slice(0, 120) || candidate.url;
}

// Analyzes every source cited in a report field's raw text and
// returns one enriched, deduplicated record per unique source --
// multiple claims/reference ids pointing at the same source are
// merged into a single entry (requirement 3), never listed twice.
export function analyzeReportSourceIntelligence(content: string): SourceIntelligenceRecord[] {
  const candidates = parseSourceCandidates(content);
  const byKey = new Map<
    string,
    {
      candidate: RawSourceCandidate;
      domain: string;
      referenceIds: Set<string>;
      occurrenceCount: number;
    }
  >();

  for (const candidate of candidates) {
    const domain = getDomain(candidate.url);
    const key = dedupeKeyFor(candidate, domain);
    const existing = byKey.get(key);

    if (existing) {
      existing.occurrenceCount += 1;
      if (candidate.referenceId) existing.referenceIds.add(candidate.referenceId);
      if (!existing.candidate.publisher && candidate.publisher) {
        existing.candidate.publisher = candidate.publisher;
      }
      if (!existing.candidate.dateRaw && candidate.dateRaw) {
        existing.candidate.dateRaw = candidate.dateRaw;
      }
      continue;
    }

    byKey.set(key, {
      candidate,
      domain,
      referenceIds: new Set(candidate.referenceId ? [candidate.referenceId] : []),
      occurrenceCount: 1,
    });
  }

  return [...byKey.values()].map(({ candidate, domain, referenceIds, occurrenceCount }) => {
    const { category, score } = classifySourceReliability({
      text: `${candidate.title} ${candidate.publisher}`,
      url: candidate.url,
    });
    const sourceType = mapCategoryToSourceType(category);
    const weaknessFlags = detectWeaknessFlags(candidate, category, domain);
    const trustLevel = assessTrustLevel(score, weaknessFlags);
    const freshness = computeFreshness(candidate.dateRaw);

    return {
      displayName: pickDisplayName(candidate, domain),
      url: candidate.url,
      referenceIds: [...referenceIds].sort(),
      occurrenceCount,
      sourceType,
      trustLevel,
      publicationDate: candidate.dateRaw || null,
      freshness,
      weaknessFlags,
      explanation: buildExplanation(sourceType, weaknessFlags),
    };
  });
}

const overviewCopy: Record<
  ResponseLanguage,
  { heading: string; high: string; medium: string; low: string; none: string }
> = {
  English: { heading: "Source Reliability Overview", high: "High Trust:", medium: "Medium Trust:", low: "Low Trust:", none: "No external sources were cited in this report." },
  Turkish: { heading: "Kaynak Güvenilirliği Genel Bakışı", high: "Yüksek Güven:", medium: "Orta Güven:", low: "Düşük Güven:", none: "Bu raporda dış kaynak belirtilmemiştir." },
  German: { heading: "Übersicht zur Quellenzuverlässigkeit", high: "Hohes Vertrauen:", medium: "Mittleres Vertrauen:", low: "Geringes Vertrauen:", none: "In diesem Bericht wurden keine externen Quellen zitiert." },
  French: { heading: "Aperçu de la fiabilité des sources", high: "Confiance élevée :", medium: "Confiance moyenne :", low: "Confiance faible :", none: "Aucune source externe n'a été citée dans ce rapport." },
  Spanish: { heading: "Resumen de fiabilidad de fuentes", high: "Confianza alta:", medium: "Confianza media:", low: "Confianza baja:", none: "No se citaron fuentes externas en este informe." },
};

// Executive Summary block: sources grouped by trust tier, showing only
// display names (never full citation detail) -- matches the task's
// own example format exactly. Empty tiers are omitted.
export function buildSourceReliabilityOverview(
  records: SourceIntelligenceRecord[],
  language: ResponseLanguage = "English"
) {
  const copy = overviewCopy[language];

  if (records.length === 0) {
    return "";
  }

  const tiers: Array<[TrustLevel, string]> = [
    ["High", copy.high],
    ["Medium", copy.medium],
    ["Low", copy.low],
  ];
  const lines = [copy.heading];

  for (const [level, label] of tiers) {
    const names = [...new Set(records.filter((record) => record.trustLevel === level).map((record) => record.displayName))];

    if (names.length === 0) {
      continue;
    }

    lines.push(label);
    for (const name of names) {
      lines.push(`• ${name}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : "";
}
