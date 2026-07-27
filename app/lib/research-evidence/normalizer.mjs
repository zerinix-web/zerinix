import {
  RESEARCH_EVIDENCE_TYPES,
  clampEvidenceScore,
  getEvidenceDomain,
  normalizeEvidenceText,
  normalizeEvidenceUrl,
} from "./model.mjs";

const authoritativeNewsDomains =
  /\b(reuters\.com|apnews\.com|bloomberg\.com|ft\.com|wsj\.com|bbc\.(com|co\.uk))$/i;
const industryDomains =
  /\b(statista\.com|mckinsey\.com|bcg\.com|deloitte\.com|pwc\.com|gartner\.com|forrester\.com|pitchbook\.com|crunchbase\.com)$/i;
const academicDomains =
  /\b(arxiv\.org|ssrn\.com|nature\.com|science\.org|jstor\.org|springer\.com|sciencedirect\.com)$/i;

function normalizeDate(value) {
  if (!value) return null;

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function inferEvidenceType(input, domain) {
  if (RESEARCH_EVIDENCE_TYPES.includes(input.evidenceType)) {
    return input.evidenceType;
  }

  const text = `${input.title || ""} ${input.source || ""} ${input.snippet || ""} ${domain}`;

  if (/\b(ai generated|ai-derived|language model|not externally verified)\b/i.test(text)) {
    return "AI Generated";
  }

  if (
    /\.(gov|gov\.[a-z]{2}|int)$/i.test(domain) ||
    /\b(government|ministry|world bank|imf|oecd|eurostat|tüik|tuik|tcmb)\b/i.test(text)
  ) {
    return "Government";
  }

  if (
    /\b(10-k|10-q|8-k|annual report|financial filing|investor relations|sec filing)\b/i.test(text) ||
    domain === "sec.gov"
  ) {
    return "Financial Filing";
  }

  if (
    /\.edu$/i.test(domain) ||
    academicDomains.test(domain) ||
    /\b(research paper|journal|university|doi|peer reviewed|working paper)\b/i.test(text)
  ) {
    return "Research Paper";
  }

  if (industryDomains.test(domain) || /\b(industry report|market report|benchmark report)\b/i.test(text)) {
    return "Industry Report";
  }

  if (authoritativeNewsDomains.test(domain) || /\b(news|reuters|associated press|bloomberg)\b/i.test(text)) {
    return "News";
  }

  return "Company Website";
}

export function assessEvidenceReliability(input) {
  const domain = getEvidenceDomain(input.url || "");
  const type = inferEvidenceType(input, domain);

  if (type === "AI Generated") return 25;
  if (type === "Financial Filing") return domain === "sec.gov" ? 97 : 92;
  if (type === "Government") return 94;
  if (type === "Research Paper") return /\.edu$/i.test(domain) || academicDomains.test(domain) ? 90 : 82;
  if (type === "Industry Report") return industryDomains.test(domain) ? 78 : 68;
  if (type === "News") return authoritativeNewsDomains.test(domain) ? 76 : 58;
  if (type === "Company Website") return domain ? 66 : 42;

  return 40;
}

function inferLanguage(value, explicitLanguage) {
  const normalizedLanguage = normalizeEvidenceText(explicitLanguage).toLowerCase();

  if (/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(normalizedLanguage)) {
    return normalizedLanguage;
  }

  const text = normalizeEvidenceText(value).toLowerCase();

  if (/[çğıöşü]/i.test(text) || /\b(ve|için|pazar|şirket|araştırma|yüzde)\b/i.test(text)) {
    return "tr";
  }

  if (/[a-z]/i.test(text)) {
    return "en";
  }

  return "und";
}

export function extractEvidenceFacts(value) {
  const sentences = normalizeEvidenceText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^[•*-]\s*/, "").trim())
    .filter(Boolean);
  const facts = sentences.filter((sentence) => {
    const hasQuantifiedClaim =
      /(?:[$€£₺]\s?\d|\d[\d,.]*\s?(?:%|percent|million|billion|trillion|milyon|milyar|year|month|day|yıl|ay|gün)\b|\b20\d{2}\b)/i.test(
        sentence
      );
    const hasAttributableClaim =
      /\b(reported|announced|published|found|measured|recorded|filed|states?|according to|bildirdi|açıkladı|ölçtü|yayınladı)\b/i.test(
        sentence
      );

    return sentence.length >= 12 && (hasQuantifiedClaim || hasAttributableClaim);
  });

  return [...new Set(facts)].slice(0, 20);
}

function normalizeProvenance(entries, input, collectedAt) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      collector: normalizeEvidenceText(entry?.collector) || "unknown",
      ...(normalizeEvidenceText(entry?.provider)
        ? { provider: normalizeEvidenceText(entry.provider) }
        : {}),
      ...(normalizeEvidenceText(entry?.sourceId)
        ? { sourceId: normalizeEvidenceText(entry.sourceId) }
        : {}),
      ...(normalizeEvidenceUrl(entry?.originalUrl)
        ? { originalUrl: normalizeEvidenceUrl(entry.originalUrl) }
        : {}),
      collectedAt: normalizeDate(entry?.collectedAt) || collectedAt,
    }))
    .filter((entry) => entry.collector);

  if (normalized.length) {
    return normalized;
  }

  return [
    {
      collector: "EvidenceCollector",
      ...(normalizeEvidenceUrl(input.url)
        ? { originalUrl: normalizeEvidenceUrl(input.url) }
        : {}),
      collectedAt,
    },
  ];
}

export class EvidenceNormalizer {
  normalize(input, options = {}) {
    const collectedAt =
      normalizeDate(options.collectedAt) || new Date().toISOString();
    const url = normalizeEvidenceUrl(input?.url);
    const domain = getEvidenceDomain(url);
    const evidenceType = inferEvidenceType(input || {}, domain);
    const title =
      normalizeEvidenceText(input?.title) ||
      normalizeEvidenceText(input?.source) ||
      domain ||
      "Untitled evidence";
    const source = normalizeEvidenceText(input?.source) || domain || "Unknown source";
    const snippet = normalizeEvidenceText(input?.snippet);
    const extractedFacts = [
      ...(Array.isArray(input?.extractedFacts)
        ? input.extractedFacts.map(normalizeEvidenceText)
        : []),
      ...extractEvidenceFacts(snippet),
    ].filter(Boolean);
    const assessedReliability = assessEvidenceReliability({
      ...input,
      url,
      evidenceType,
    });

    return {
      title,
      source,
      url,
      publishedAt: normalizeDate(input?.publishedAt),
      author: normalizeEvidenceText(input?.author) || null,
      snippet,
      relevanceScore: clampEvidenceScore(input?.relevanceScore, 50),
      reliabilityScore: clampEvidenceScore(
        input?.reliabilityScore,
        assessedReliability
      ),
      evidenceType,
      language: inferLanguage(`${title} ${snippet}`, input?.language),
      extractedFacts: [...new Set(extractedFacts)].slice(0, 20),
      provenance: normalizeProvenance(
        input?.provenance,
        input || {},
        collectedAt
      ),
      duplicateCount: 0,
      independentConfirmations: 0,
      rankingScore: 0,
    };
  }

  normalizeAll(inputs, options = {}) {
    return (Array.isArray(inputs) ? inputs : []).map((input) =>
      this.normalize(input, options)
    );
  }
}

