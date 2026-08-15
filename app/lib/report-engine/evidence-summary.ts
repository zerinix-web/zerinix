import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

// Shared, report-type-agnostic source compression: replaces a long list of
// raw URLs/domains/registry IDs with a short "Evidence Summary" naming the
// EVIDENCE CATEGORIES used and a total count. This is citation/evidence
// policy -- explicitly allowed to be shared across report types -- not
// report-specific business content. Detailed per-source metadata is not
// discarded; it is still computed into report.metadata via each engine's
// existing analyzeReportSourceIntelligence/sourceIntelligence pipeline, so
// "only expose detailed sources if explicitly requested" is satisfied by
// what is (and isn't) rendered into the visible field, not by deleting data.

export type EvidenceCategory =
  | "Government data"
  | "Industry reports"
  | "Public financial filings"
  | "Market research"
  | "Competitor analysis"
  | "Company sources"
  | "Academic and regulatory sources"
  | "Other sources";

const categoryPatterns: Array<{ category: EvidenceCategory; pattern: RegExp }> = [
  {
    category: "Government data",
    pattern: /\b(?:government|regulator|regulatory|census|bureau of labor|statistical office|central bank|official statistics|\.gov\b)\b/i,
  },
  {
    category: "Public financial filings",
    pattern: /\b(?:10-k|10-q|annual report|financial filing|sec filing|investor relations|audited statement|earnings report)\b/i,
  },
  {
    category: "Academic and regulatory sources",
    pattern: /\b(?:academic|university|peer-reviewed|journal article|regulatory guidance|standards body)\b/i,
  },
  {
    category: "Competitor analysis",
    pattern: /\b(?:competitor|competitive landscape|major players?|rival|substitute)\b/i,
  },
  {
    category: "Market research",
    pattern: /\b(?:market research|industry report|market data|research report|forecast|tam|sam|som|cagr)\b/i,
  },
  {
    category: "Company sources",
    pattern: /\b(?:official company|company website|pricing page|product page|press release|company reference)\b/i,
  },
  {
    category: "Industry reports",
    pattern: /\b(?:industry association|trade publication|industry benchmark|sector report)\b/i,
  },
];

function classifySourceLine(line: string): EvidenceCategory {
  for (const { category, pattern } of categoryPatterns) {
    if (pattern.test(line)) {
      return category;
    }
  }
  return "Other sources";
}

// A "source line" is any line that looks like a citation entry: it carries
// a URL, an evidence-tag (e.g. "[Verified from external source]"), or a
// "Kaynak:"/"Publisher:"-style citation label. Plain narrative lines never
// count, so this never over-counts prose as evidence.
const citationLinePattern =
  /https?:\/\/\S+|\[(?:Verified from (?:official|external) source|Estimate|Unknown|Assumption)\]|^(?:[-*•]\s*)?(?:Title|Publisher|Kaynak(?:\s+türü)?|Source(?:\s+type)?|Confidence|Güven|Year|Published|Publication date|Publication Year|Yayın tarihi|Yıl)\s*[:\-–—]/im;

function isCitationLine(line: string) {
  return citationLinePattern.test(line.trim());
}

// A single citation is routinely written across several physical lines
// (an evidence-tag/Title line, then Publisher, then URL, ...). Counting
// every matching LINE as its own source would wildly over-count -- this
// groups consecutive citation lines into blocks, starting a new block only
// when a line looks like the START of a new entry (a bullet, an
// evidence-tag, or a "Title:" label), so "3 sources across 9 lines" is
// correctly counted as 3, not 9.
const citationStartPattern =
  /^(?:[-*•]\s*)?(?:\[(?:Verified from (?:official|external) source|Estimate|Unknown|Assumption)\]|Title\s*[:\-–—]|Kaynak\s*[:\-–—])/i;

function groupCitationLines(lines: string[]) {
  const groups: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (citationStartPattern.test(line) || current.length === 0) {
      if (current.length) groups.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) groups.push(current);

  return groups;
}

const summaryLabels: Record<
  ResponseLanguage,
  { heading: string; verifiedAgainst: string; sourcesUsed: (count: number) => string }
> = {
  English: {
    heading: "Evidence Summary",
    verifiedAgainst: "Verified against:",
    sourcesUsed: (count) => `${count} verified source${count === 1 ? "" : "s"} used.`,
  },
  Turkish: {
    heading: "Kanıt Özeti",
    verifiedAgainst: "Şu kaynaklara karşı doğrulandı:",
    sourcesUsed: (count) => `${count} doğrulanmış kaynak kullanıldı.`,
  },
  German: {
    heading: "Evidenzübersicht",
    verifiedAgainst: "Abgeglichen mit:",
    sourcesUsed: (count) => `${count} verifizierte Quelle${count === 1 ? "" : "n"} verwendet.`,
  },
  French: {
    heading: "Synthèse des preuves",
    verifiedAgainst: "Vérifié par rapport à :",
    sourcesUsed: (count) => `${count} source${count === 1 ? "" : "s"} vérifiée${count === 1 ? "" : "s"} utilisée${count === 1 ? "" : "s"}.`,
  },
  Spanish: {
    heading: "Resumen de evidencia",
    verifiedAgainst: "Verificado con:",
    sourcesUsed: (count) => `${count} fuente${count === 1 ? "" : "s"} verificada${count === 1 ? "" : "s"} utilizada${count === 1 ? "" : "s"}.`,
  },
};

const noEvidenceCopy: Record<ResponseLanguage, string> = {
  English: "No independently verifiable sources were available for this section.",
  Turkish: "Bu bölüm için bağımsız olarak doğrulanabilir bir kaynak bulunamadı.",
  German: "Für diesen Abschnitt lagen keine unabhängig überprüfbaren Quellen vor.",
  French: "Aucune source vérifiable de manière indépendante n'était disponible pour cette section.",
  Spanish: "No se dispuso de fuentes verificables de forma independiente para esta sección.",
};

// Replaces a raw citation list with a compact category+count summary.
// `rawContent` should be the model's own detailed source output (still
// worth asking for in the field prompt -- richer raw text produces a more
// accurate category classification) -- this function is the boundary
// where detail is compressed before the field is returned to the user.
export function buildEvidenceSummary(rawContent: string, language: ResponseLanguage) {
  const lines = (rawContent || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const citationLines = lines.filter(isCitationLine);
  const copy = summaryLabels[language];

  if (citationLines.length === 0) {
    return [copy.heading, noEvidenceCopy[language]].join("\n");
  }

  const citationGroups = groupCitationLines(citationLines);

  const categoriesPresent: EvidenceCategory[] = [];
  const seen = new Set<EvidenceCategory>();
  for (const group of citationGroups) {
    const category = classifySourceLine(group.join(" "));
    if (!seen.has(category)) {
      seen.add(category);
      categoriesPresent.push(category);
    }
  }

  // Count distinct citations by their URL when one is present (two groups
  // citing the same URL are the same source, however differently worded);
  // fall back to the group's own text only when no URL is available at all.
  const distinctCitationCount = new Set(
    citationGroups.map((group) => {
      const joined = group.join(" ");
      return joined.match(/https?:\/\/\S+/)?.[0]?.replace(/[)\].,;]+$/, "").toLowerCase() || joined;
    })
  ).size;

  // Per-source detail: publisher, document/report title, year (when
  // available), and confidence -- the actual validated references, not
  // just a category count. Deduplicated by the same URL/title key used for
  // distinctCitationCount above, so this list and that count always agree.
  const seenDetailKeys = new Set<string>();
  const sourceDetails: CitationDetail[] = [];
  for (const group of citationGroups) {
    const detail = extractCitationDetail(group, language);
    if (!detail || seenDetailKeys.has(detail.urlKey)) continue;
    seenDetailKeys.add(detail.urlKey);
    sourceDetails.push(detail);
  }

  return [
    copy.heading,
    copy.verifiedAgainst,
    ...categoriesPresent.map((category) => `• ${localizeCategory(category, language)}`),
    "",
    copy.sourcesUsed(distinctCitationCount),
    ...(sourceDetails.length
      ? ["", sourcesUsedHeading[language], ...sourceDetails.map(formatCitationDetail)]
      : []),
  ].join("\n");
}

const categoryTranslations: Record<EvidenceCategory, Record<ResponseLanguage, string>> = {
  "Government data": {
    English: "Government data",
    Turkish: "Resmi veriler",
    German: "Behördendaten",
    French: "Données gouvernementales",
    Spanish: "Datos gubernamentales",
  },
  "Industry reports": {
    English: "Industry reports",
    Turkish: "Sektör raporları",
    German: "Branchenberichte",
    French: "Rapports sectoriels",
    Spanish: "Informes del sector",
  },
  "Public financial filings": {
    English: "Public financial filings",
    Turkish: "Kamuya açık finansal belgeler",
    German: "Öffentliche Finanzunterlagen",
    French: "Documents financiers publics",
    Spanish: "Documentos financieros públicos",
  },
  "Market research": {
    English: "Market research",
    Turkish: "Pazar araştırması",
    German: "Marktforschung",
    French: "Études de marché",
    Spanish: "Investigación de mercado",
  },
  "Competitor analysis": {
    English: "Competitor analysis",
    Turkish: "Rakip analizi",
    German: "Wettbewerbsanalyse",
    French: "Analyse concurrentielle",
    Spanish: "Análisis de la competencia",
  },
  "Company sources": {
    English: "Company sources",
    Turkish: "Şirket kaynakları",
    German: "Unternehmensquellen",
    French: "Sources d'entreprise",
    Spanish: "Fuentes de la empresa",
  },
  "Academic and regulatory sources": {
    English: "Academic and regulatory sources",
    Turkish: "Akademik ve düzenleyici kaynaklar",
    German: "Akademische und regulatorische Quellen",
    French: "Sources académiques et réglementaires",
    Spanish: "Fuentes académicas y regulatorias",
  },
  "Other sources": {
    English: "Other verified sources",
    Turkish: "Diğer doğrulanmış kaynaklar",
    German: "Weitere verifizierte Quellen",
    French: "Autres sources vérifiées",
    Spanish: "Otras fuentes verificadas",
  },
};

function localizeCategory(category: EvidenceCategory, language: ResponseLanguage) {
  return categoryTranslations[category][language];
}

const sourcesUsedHeading: Record<ResponseLanguage, string> = {
  English: "Sources used:",
  Turkish: "Kullanılan kaynaklar:",
  German: "Verwendete Quellen:",
  French: "Sources utilisées :",
  Spanish: "Fuentes utilizadas:",
};

// The bracketed evidence-classification tag every citation already carries
// (e.g. "[Verified from official source]") is the confidence signal used
// everywhere else in the pipeline -- reused here rather than inventing a
// second confidence vocabulary just for display.
const confidenceTagLabels: Record<ResponseLanguage, Record<string, string>> = {
  English: {
    "verified from official source": "Verified",
    "verified from external source": "Verified",
    estimate: "Estimated",
    unknown: "Unverified",
    assumption: "Assumption",
  },
  Turkish: {
    "verified from official source": "Doğrulanmış",
    "verified from external source": "Doğrulanmış",
    estimate: "Tahmini",
    unknown: "Doğrulanmamış",
    assumption: "Varsayım",
  },
  German: {
    "verified from official source": "Verifiziert",
    "verified from external source": "Verifiziert",
    estimate: "Geschätzt",
    unknown: "Nicht verifiziert",
    assumption: "Annahme",
  },
  French: {
    "verified from official source": "Vérifié",
    "verified from external source": "Vérifié",
    estimate: "Estimé",
    unknown: "Non vérifié",
    assumption: "Hypothèse",
  },
  Spanish: {
    "verified from official source": "Verificado",
    "verified from external source": "Verificado",
    estimate: "Estimado",
    unknown: "No verificado",
    assumption: "Supuesto",
  },
};

type CitationDetail = {
  title: string;
  publisher: string;
  year: string;
  confidence: string;
  urlKey: string;
};

// A "Title:"/"Publisher:" label immediately followed by the model's own
// narrative prose (a evidence-gap explanation, a recommendation fragment,
// a decision-verdict sentence) rather than a real citation value is a real,
// observed model failure mode -- confirmed live, a Sources block rendered
// "Publisher: The opportunity is real, but the gap ..." as a fabricated
// source because this extraction accepted whatever text followed the label
// with no shape check at all. A real title or publisher name is short and
// does not read as a full sentence -- this rejects anything that does,
// independent of which specific words appear in it, so it generalizes to
// any narrative fragment that happens to follow one of these labels.
const citationProseVerbPattern =
  /\b(?:is|are|was|were|outweighs|remains|requires|means|shows|reflects|confidence)\b/i;
function looksLikeCitationMetadataValue(value: string, maxWords = 12): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return false;
  if (trimmed.split(/\s+/).length > maxWords) return false;
  if (/[.!?]/.test(trimmed)) return false;
  if (citationProseVerbPattern.test(trimmed)) return false;
  return true;
}

// Extracts only fields that are actually present in the model's own
// citation lines -- a field that isn't there is omitted from the rendered
// bullet entirely (never a fabricated "Publisher: Unknown"-style filler),
// matching the same "omit, don't invent" convention already used for the
// PDF's own per-citation cards (ReportPdfButton.tsx's formatPdfCitationContent).
function extractCitationDetail(group: string[], language: ResponseLanguage): CitationDetail | null {
  const joined = group.join("\n");
  const tagMatch = joined.match(
    /\[(Verified from official source|Verified from external source|Estimate|Unknown|Assumption)\]/i
  );
  const titleMatch = joined.match(/(?:^|\n)\s*(?:\[[^\]]+\]\s*)?Title\s*[:\-–—]\s*([^\n]+)/i);
  const publisherMatch = joined.match(/(?:^|\n)\s*Publisher\s*[:\-–—]\s*([^\n]+)/i);
  const yearMatch = joined
    .match(/(?:^|\n)\s*(?:Year|Published|Publication date|Publication Year)\s*[:\-–—]\s*([^\n]+)/i)?.[1]
    ?.match(/\b(19|20)\d{2}\b/)?.[0];
  const urlMatch = joined.match(/https?:\/\/\S+/)?.[0]?.replace(/[)\].,;]+$/, "").toLowerCase();

  const rawTitle = titleMatch?.[1]?.trim() || "";
  const title = looksLikeCitationMetadataValue(rawTitle, 20) ? rawTitle : "";
  if (!title) return null;

  const rawPublisher = publisherMatch?.[1]?.trim() || "";
  const publisher = looksLikeCitationMetadataValue(rawPublisher) ? rawPublisher : "";

  const confidence = tagMatch
    ? confidenceTagLabels[language][tagMatch[1].toLowerCase()] || ""
    : "";

  return {
    title,
    publisher,
    year: yearMatch || "",
    confidence,
    urlKey: urlMatch || title.toLowerCase(),
  };
}

function formatCitationDetail(detail: CitationDetail) {
  const parts = [detail.title];
  const attribution = [detail.publisher, detail.year].filter(Boolean).join(", ");
  if (attribution) parts.push(attribution);
  const line = `• ${parts.join(" — ")}`;
  return detail.confidence ? `${line} (${detail.confidence})` : line;
}
