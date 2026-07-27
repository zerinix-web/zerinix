import {
  canonicalEvidenceKey,
  getEvidenceDomain,
  normalizeEvidenceText,
} from "./model.mjs";

function normalizedTitle(value) {
  return normalizeEvidenceText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalizedTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedTitle(right).split(" ").filter(Boolean));

  if (!leftTokens.size || !rightTokens.size) return 0;

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union ? intersection / union : 0;
}

function provenanceKey(item) {
  return [
    item.collector,
    item.provider || "",
    item.sourceId || "",
    item.originalUrl || "",
    item.collectedAt,
  ].join("|");
}

function typePriority(type) {
  return {
    Government: 7,
    "Financial Filing": 6,
    "Research Paper": 5,
    "Company Website": 4,
    "Industry Report": 3,
    News: 2,
    "AI Generated": 1,
  }[type] || 0;
}

function mergeEvidence(left, right) {
  const preferred = left.reliabilityScore >= right.reliabilityScore ? left : right;
  const alternate = preferred === left ? right : left;
  const preferredType =
    typePriority(left.evidenceType) >= typePriority(right.evidenceType)
      ? left.evidenceType
      : right.evidenceType;
  const provenance = [...left.provenance, ...right.provenance];
  const uniqueProvenance = [
    ...new Map(provenance.map((item) => [provenanceKey(item), item])).values(),
  ];
  const dates = [left.publishedAt, right.publishedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return {
    ...preferred,
    title:
      left.title.length >= right.title.length ? left.title : right.title,
    source:
      left.source.length >= right.source.length ? left.source : right.source,
    url: preferred.url || alternate.url,
    publishedAt: dates[0] || null,
    author: preferred.author || alternate.author,
    snippet:
      left.snippet.length >= right.snippet.length ? left.snippet : right.snippet,
    relevanceScore: Math.max(left.relevanceScore, right.relevanceScore),
    reliabilityScore: Math.max(left.reliabilityScore, right.reliabilityScore),
    evidenceType: preferredType,
    language:
      preferred.language !== "und" ? preferred.language : alternate.language,
    extractedFacts: [
      ...new Set([...left.extractedFacts, ...right.extractedFacts]),
    ].slice(0, 30),
    provenance: uniqueProvenance,
    duplicateCount: left.duplicateCount + right.duplicateCount + 1,
    independentConfirmations: Math.max(
      left.independentConfirmations,
      right.independentConfirmations
    ),
    rankingScore: Math.max(left.rankingScore, right.rankingScore),
  };
}

export class EvidenceDeduplicator {
  isDuplicate(left, right) {
    const leftKey = canonicalEvidenceKey(left);
    const rightKey = canonicalEvidenceKey(right);

    if (leftKey === rightKey) return true;

    const leftDomain = getEvidenceDomain(left.url);
    const rightDomain = getEvidenceDomain(right.url);
    const sameDomain = Boolean(leftDomain && leftDomain === rightDomain);
    const titleMatch = normalizedTitle(left.title) === normalizedTitle(right.title);

    return (
      (sameDomain && titleMatch) ||
      (sameDomain && tokenSimilarity(left.title, right.title) >= 0.82)
    );
  }

  merge(left, right) {
    return mergeEvidence(left, right);
  }

  deduplicate(items) {
    const unique = [];

    for (const item of Array.isArray(items) ? items : []) {
      const duplicateIndex = unique.findIndex((candidate) =>
        this.isDuplicate(candidate, item)
      );

      if (duplicateIndex === -1) {
        unique.push(item);
      } else {
        unique[duplicateIndex] = this.merge(unique[duplicateIndex], item);
      }
    }

    return unique;
  }
}

