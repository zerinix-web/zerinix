import type { DomainResearchEvidence } from "@/app/lib/ai/domain-research";

export type CompressedEvidence = {
  title: string;
  source: string;
  claim: string;
  supportingFacts: string[];
  confidence: number;
  date: string;
  relevanceScore: number;
};

export type EvidenceCompressionResult = {
  evidence: CompressedEvidence[];
  fieldTags: string[][];
  metrics: {
    rawEvidenceCount: number;
    compressedEvidenceCount: number;
    contextCharactersBefore: number;
    contextCharactersAfter: number;
    tokensEstimated: number;
  };
};

const MAX_EVIDENCE_OBJECTS = 10;
const MAX_EVIDENCE_CHARACTERS = 600;

function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function compactText(value: unknown, maximum: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_.+)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeIdentity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function claimTokens(value: string) {
  return new Set(
    normalizeIdentity(value)
      .split(" ")
      .filter((token) => token.length > 2)
  );
}

function claimsAreEquivalent(left: string, right: string) {
  const leftTokens = claimTokens(left);
  const rightTokens = claimTokens(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.75;
}

function freshnessScore(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  if (ageDays <= 90) return 100;
  if (ageDays <= 365) return 80;
  if (ageDays <= 1_095) return 55;
  return 25;
}

function evidenceRank(item: DomainResearchEvidence) {
  const official = item.authorityLevel === "primary" ? 1 : 0;
  const relevance = clampScore(item.qualityScore ?? item.confidence);
  const freshness = freshnessScore(item.publishedDate || item.lastChecked);
  const confidence = clampScore(item.confidence);
  return { official, relevance, freshness, confidence };
}

function compareEvidence(left: DomainResearchEvidence, right: DomainResearchEvidence) {
  const a = evidenceRank(left);
  const b = evidenceRank(right);
  return (
    b.official - a.official ||
    b.relevance - a.relevance ||
    b.freshness - a.freshness ||
    b.confidence - a.confidence
  );
}

function fitEvidenceObject(item: CompressedEvidence) {
  const fitted: CompressedEvidence = {
    title: compactText(item.title, 100),
    source: compactText(item.source, 190),
    claim: compactText(item.claim, 170),
    supportingFacts: item.supportingFacts.slice(0, 3).map((fact) => compactText(fact, 100)),
    confidence: clampScore(item.confidence),
    date: compactText(item.date, 24),
    relevanceScore: clampScore(item.relevanceScore),
  };

  while (JSON.stringify(fitted).length > MAX_EVIDENCE_CHARACTERS) {
    const longestFact = fitted.supportingFacts
      .map((fact, index) => ({ fact, index }))
      .sort((a, b) => b.fact.length - a.fact.length)[0];
    if (longestFact?.fact.length > 40) {
      fitted.supportingFacts[longestFact.index] = compactText(
        longestFact.fact,
        longestFact.fact.length - 20
      );
      continue;
    }
    if (fitted.claim.length > 80) {
      fitted.claim = compactText(fitted.claim, fitted.claim.length - 20);
      continue;
    }
    if (fitted.source.length > 100) {
      fitted.source = compactText(fitted.source, fitted.source.length - 20);
      continue;
    }
    fitted.supportingFacts.pop();
    if (!fitted.supportingFacts.length) break;
  }

  return fitted;
}

export function compressResearchEvidence(
  input: readonly DomainResearchEvidence[]
): EvidenceCompressionResult {
  const rawEvidence = [...input];
  const ranked = rawEvidence
    .filter((item) => item.claim.trim() && item.value.trim())
    .sort(compareEvidence);
  const merged: Array<{ base: DomainResearchEvidence; sources: string[]; facts: string[] }> = [];

  for (const item of ranked) {
    const sourceUrl = canonicalUrl(item.url);
    const source = [item.publisher || item.sourceTitle, sourceUrl]
      .filter(Boolean)
      .join(" — ");
    const duplicate = merged.find(
      (candidate) =>
        normalizeIdentity(candidate.base.field) === normalizeIdentity(item.field) &&
        claimsAreEquivalent(candidate.base.claim, item.claim)
    );

    if (duplicate) {
      if (source && !duplicate.sources.includes(source)) duplicate.sources.push(source);
      for (const fact of [item.value, ...item.supportingData]) {
        if (fact.trim() && !duplicate.facts.some((existing) => normalizeIdentity(existing) === normalizeIdentity(fact))) {
          duplicate.facts.push(fact);
        }
      }
      continue;
    }

    merged.push({
      base: item,
      sources: source ? [source] : [],
      facts: [item.value, ...item.supportingData].filter((fact) => fact.trim()),
    });
  }

  const evidence = merged.slice(0, MAX_EVIDENCE_OBJECTS).map(({ base, sources, facts }, index) =>
    fitEvidenceObject({
      title: `[R${index + 1}] ${base.sourceTitle || base.publisher || base.field}`,
      source: sources.join("; "),
      claim: base.claim,
      supportingFacts: facts,
      confidence: base.confidence,
      date: base.publishedDate || base.lastChecked || "",
      relevanceScore: base.qualityScore ?? base.confidence,
    })
  );
  const contextCharactersBefore = JSON.stringify(rawEvidence).length;
  const contextCharactersAfter = JSON.stringify(evidence).length;

  return {
    evidence,
    fieldTags: merged
      .slice(0, MAX_EVIDENCE_OBJECTS)
      .map(({ base }) => [base.field].filter(Boolean)),
    metrics: {
      rawEvidenceCount: rawEvidence.length,
      compressedEvidenceCount: evidence.length,
      contextCharactersBefore,
      contextCharactersAfter,
      tokensEstimated: Math.ceil(contextCharactersAfter / 4),
    },
  };
}
