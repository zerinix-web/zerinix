import {
  clampEvidenceScore,
  getEvidenceDomain,
  normalizeEvidenceText,
} from "./model.mjs";

const primaryAuthorityDomains =
  /\b(worldbank\.org|imf\.org|oecd\.org|who\.int|sec\.gov|europa\.eu|eurostat\.ec\.europa\.eu|data\.gov|tuik\.gov\.tr|tcmb\.gov\.tr)$/i;
const academicDomains =
  /(?:\.edu$|\.ac\.[a-z]{2}$|\b(arxiv\.org|ssrn\.com|nature\.com|science\.org|jstor\.org)$)/i;
const authoritativeNewsDomains =
  /\b(reuters\.com|apnews\.com|bloomberg\.com|ft\.com|wsj\.com|bbc\.(com|co\.uk))$/i;

function canonicalFact(value) {
  return normalizeEvidenceText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%$€£₺]+/gu, " ")
    .trim();
}

function authorityBoost(item) {
  const domain = getEvidenceDomain(item.url);

  if (primaryAuthorityDomains.test(domain)) return 10;
  if (academicDomains.test(domain)) return 8;
  if (authoritativeNewsDomains.test(domain)) return 5;
  if (item.evidenceType === "Financial Filing") return 9;
  if (item.evidenceType === "Government") return 8;
  if (item.evidenceType === "Research Paper") return 6;
  if (item.evidenceType === "AI Generated") return -15;

  return 0;
}

function agePenalty(item, referenceDate) {
  if (!item.publishedAt) return 4;

  const publishedAt = new Date(item.publishedAt);
  if (!Number.isFinite(publishedAt.getTime())) return 6;

  const ageDays = Math.max(
    0,
    (referenceDate.getTime() - publishedAt.getTime()) / 86_400_000
  );

  if (item.evidenceType === "News") {
    if (ageDays > 1_095) return 28;
    if (ageDays > 730) return 20;
    if (ageDays > 365) return 10;
    return 0;
  }

  if (ageDays > 3_650) return 22;
  if (ageDays > 1_825) return 12;
  if (ageDays > 1_095) return 6;

  return 0;
}

function confirmationCounts(items) {
  const factDomains = new Map();

  for (const item of items) {
    const domain = getEvidenceDomain(item.url) || `source:${item.source.toLowerCase()}`;

    for (const fact of item.extractedFacts) {
      const key = canonicalFact(fact);
      if (!key) continue;

      const domains = factDomains.get(key) || new Set();
      domains.add(domain);
      factDomains.set(key, domains);
    }
  }

  return items.map((item) => {
    const confirmations = item.extractedFacts.reduce((highest, fact) => {
      const domains = factDomains.get(canonicalFact(fact));
      return Math.max(highest, domains?.size || 0);
    }, 0);

    return Math.max(0, confirmations - 1);
  });
}

export class EvidenceRanker {
  rank(items, options = {}) {
    const referenceDate = new Date(options.referenceDate || Date.now());
    const safeReferenceDate = Number.isFinite(referenceDate.getTime())
      ? referenceDate
      : new Date();
    const confirmations = confirmationCounts(items);

    return items
      .map((item, index) => {
        const independentConfirmations = confirmations[index];
        const confirmationBoost = Math.min(15, independentConfirmations * 5);
        const duplicatePenalty = Math.min(18, item.duplicateCount * 4);
        const stalePenalty = agePenalty(item, safeReferenceDate);
        const reliability =
          item.evidenceType === "AI Generated"
            ? Math.min(35, item.reliabilityScore)
            : item.reliabilityScore;
        const rankingScore = clampEvidenceScore(
          item.relevanceScore * 0.45 +
            reliability * 0.4 +
            authorityBoost(item) +
            confirmationBoost -
            duplicatePenalty -
            stalePenalty
        );

        return {
          ...item,
          reliabilityScore: reliability,
          independentConfirmations,
          rankingScore,
        };
      })
      .sort(
        (left, right) =>
          right.rankingScore - left.rankingScore ||
          right.reliabilityScore - left.reliabilityScore ||
          left.title.localeCompare(right.title)
      );
  }
}

