import { z } from "zod";

// ZERINIX Evidence Acquisition Engine v1.
//
// ZERINIX is a decision platform, not a report generator: instead of
// letting a missing input collapse into a bare "not provided", this
// engine actively tries every available evidence pool -- already-verified
// external research candidates first, then the user's own prompt/
// attachments -- before ever giving up on a required piece of market
// knowledge. Only when nothing genuinely attributable exists does a
// category fall back to "Missing Verified Evidence". Nothing is ever
// invented: a fact can only be reported if it is copied verbatim from a
// candidate's own text, and a source/url/publisher/date can only be
// reported if the candidate itself carried that attribution.
//
// Scope (v1, standalone): this module does not perform any network or AI
// calls itself, and it is not wired into any existing file. It is a pure,
// deterministic classifier over evidence pools a caller already has --
// exactly the same "evidence pool" convention every other ZERINIX
// Intelligence layer already uses (expert-reasoning-engine.ts,
// decision-intent-engine.ts, decision-strategy-engine.ts all take
// `readonly string[]` evidence pools; this module additionally accepts
// richer, source-attributed candidates so genuinely verified research --
// e.g. from the existing domain-research/market-intelligence-graph
// subsystem -- can be recognized as such). Wiring live web research into
// `externalEvidenceCandidates`, or wiring the Executive Decision Engine to
// consume `verifiedEvidence` below, is intentionally left for a future,
// separate integration step -- this turn only creates this one file and
// does not touch report generation, PDF, UI, planner, billing,
// authentication, or the existing Business Intelligence flow.

export const evidenceCategoryValues = [
  "market_size",
  "cagr",
  "competitors",
  "pricing_benchmarks",
  "customer_segments",
  "industry_trends",
  "unit_economics_benchmarks",
  "regulatory_considerations",
  "technology_trends",
] as const;

export type EvidenceCategory = (typeof evidenceCategoryValues)[number];

export const evidenceTypeValues = [
  "external_verified",
  "user_provided",
  "missing",
] as const;

export type EvidenceType = (typeof evidenceTypeValues)[number];

export const MISSING_EVIDENCE_LABEL = "Missing Verified Evidence";
export const USER_PROVIDED_SOURCE_LABEL = "User-provided input";

const trimmedString = (max: number) => z.string().trim().min(1).max(max);

export const evidenceSchema = z
  .object({
    category: z.enum(evidenceCategoryValues),
    source: trimmedString(200),
    url: z.string().trim().url().nullable(),
    publisher: trimmedString(200).nullable(),
    evidence_type: z.enum(evidenceTypeValues),
    confidence: z.number().min(0).max(1),
    extracted_fact: trimmedString(500).nullable(),
    date: trimmedString(40).nullable(),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;

export const evidenceAcquisitionResultSchema = z
  .object({
    evidence: z.record(z.enum(evidenceCategoryValues), evidenceSchema),
    verifiedEvidence: z.array(evidenceSchema).max(evidenceCategoryValues.length),
    externalVerifiedCount: z.number().int().min(0).max(evidenceCategoryValues.length),
    userProvidedCount: z.number().int().min(0).max(evidenceCategoryValues.length),
    missingEvidenceCount: z.number().int().min(0).max(evidenceCategoryValues.length),
    missingCategories: z.array(z.enum(evidenceCategoryValues)).max(evidenceCategoryValues.length),
    evidenceTrace: z.array(trimmedString(600)).max(evidenceCategoryValues.length),
  })
  .strict();

export type EvidenceAcquisitionResult = z.infer<typeof evidenceAcquisitionResultSchema>;

// A candidate the caller already obtained from some external, attributable
// source (e.g. an already-fetched research finding). `source` is optional
// on purpose: a candidate with no source metadata, or with an incomplete
// one (missing url or publisher), can never be promoted to
// "external_verified" -- it is simply not used as an external match, so a
// partially-attributed snippet can never leak into the output looking more
// verified than it actually is.
export type EvidenceAcquisitionCandidateSource = {
  publisher?: string;
  url?: string;
  publishedDate?: string;
  confidence?: number;
};

export type EvidenceAcquisitionCandidate = {
  text: string;
  source?: EvidenceAcquisitionCandidateSource;
};

export type EvidenceAcquisitionInput = {
  prompt?: string;
  userProvidedFacts?: readonly string[];
  externalEvidenceCandidates?: readonly EvidenceAcquisitionCandidate[];
};

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

function unique(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

const EXTERNAL_VERIFIED_DEFAULT_CONFIDENCE = 0.65;
const USER_PROVIDED_CONFIDENCE = 0.3;
const MAX_EXTRACTED_FACT_LENGTH = 400;

// Patterns are matched against text already normalized by
// normalizeForMatch (Turkish-aware lowercasing, dotless-i folded to plain
// "i"), so every alternative must be written lowercase, ASCII "i".
const categoryPatterns: Record<EvidenceCategory, RegExp> = {
  market_size:
    /\b(market size|total addressable market|\btam\b|\bsam\b|\bsom\b|market value|market is valued|market is estimated|addressable market)\b/,
  cagr: /\b(cagr|compound annual growth rate|annual growth rate|yoy growth|year-over-year growth|year over year growth)\b/,
  competitors:
    /\b(competitor|competitors|rival|rivals|market leader|market leaders|incumbent|incumbents|competing product|competing companies|competing solutions)\b/,
  pricing_benchmarks:
    /\b(pricing|price point|price points|benchmark pricing|average price|subscription price|per seat|per-user pricing|per user pricing|price per)\b/,
  customer_segments:
    /\b(customer segment|customer segments|target customer|target audience|buyer persona|user persona|ideal customer profile|\bicp\b)\b/,
  industry_trends:
    /\b(industry trend|industry trends|market trend|market trends|emerging trend|emerging trends)\b/,
  unit_economics_benchmarks:
    /\b(unit economics|\bcac\b|\bltv\b|churn rate|gross margin|payback period|customer acquisition cost|lifetime value)\b/,
  regulatory_considerations:
    /\b(regulation|regulations|regulatory|compliance|licensing|licence|license requirement|legal requirement|legal requirements|gdpr|hipaa|kvkk)\b/,
  technology_trends:
    /\b(technology trend|technology trends|emerging technology|emerging technologies|tech stack trend|ai adoption|automation trend|automation trends)\b/,
};

const categoryLabels: Record<EvidenceCategory, string> = {
  market_size: "Market size",
  cagr: "CAGR",
  competitors: "Competitors",
  pricing_benchmarks: "Pricing benchmarks",
  customer_segments: "Customer segments",
  industry_trends: "Industry trends",
  unit_economics_benchmarks: "Unit economics benchmarks",
  regulatory_considerations: "Regulatory considerations",
  technology_trends: "Technology trends",
};

function truncate(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trim()}…`;
}

// Never invents a fact: the result is always either the candidate's whole
// text (when short enough) or the single sentence from it that actually
// contains the match -- never a paraphrase, never content outside the
// original source.
function extractRelevantFact(text: string, pattern: RegExp) {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_FACT_LENGTH) {
    return trimmed;
  }
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const match = sentences.find((sentence) => pattern.test(normalizeForMatch(sentence)));
  return truncate(match || trimmed, MAX_EXTRACTED_FACT_LENGTH);
}

function isUsableUrl(value: string | undefined) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Only a candidate that carries BOTH a usable url and a non-empty
// publisher can ever be treated as externally verified -- a candidate
// missing either is never promoted to "external_verified" and never
// silently downgraded into looking like a real source; it is simply
// excluded from this match.
function findExternalMatch(
  candidates: readonly EvidenceAcquisitionCandidate[],
  pattern: RegExp
) {
  const matches = candidates.filter(
    (candidate) =>
      candidate.source &&
      isUsableUrl(candidate.source.url) &&
      Boolean(candidate.source.publisher?.trim()) &&
      pattern.test(normalizeForMatch(candidate.text))
  );

  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort(
    (a, b) =>
      (b.source?.confidence ?? EXTERNAL_VERIFIED_DEFAULT_CONFIDENCE) -
      (a.source?.confidence ?? EXTERNAL_VERIFIED_DEFAULT_CONFIDENCE)
  )[0];
}

function findUserProvidedMatch(facts: readonly string[], pattern: RegExp) {
  return facts.find((fact) => pattern.test(normalizeForMatch(fact))) || null;
}

export function runEvidenceAcquisitionEngine(
  input: EvidenceAcquisitionInput = {}
): EvidenceAcquisitionResult {
  const { prompt = "", userProvidedFacts = [], externalEvidenceCandidates = [] } = input;

  const combinedUserFacts = unique([prompt, ...userProvidedFacts]);
  const evidenceTrace: string[] = [];
  const evidence = {} as Record<EvidenceCategory, Evidence>;
  const verifiedEvidence: Evidence[] = [];
  const missingCategories: EvidenceCategory[] = [];
  let externalVerifiedCount = 0;
  let userProvidedCount = 0;

  for (const category of evidenceCategoryValues) {
    const pattern = categoryPatterns[category];
    const label = categoryLabels[category];

    const externalMatch = findExternalMatch(externalEvidenceCandidates, pattern);
    if (externalMatch && externalMatch.source) {
      const publisher = externalMatch.source.publisher!.trim();
      const url = externalMatch.source.url!.trim();
      const confidence = Math.min(
        Math.max(externalMatch.source.confidence ?? EXTERNAL_VERIFIED_DEFAULT_CONFIDENCE, 0),
        1
      );
      const entry: Evidence = {
        category,
        source: publisher,
        url,
        publisher,
        evidence_type: "external_verified",
        confidence,
        extracted_fact: extractRelevantFact(externalMatch.text, pattern),
        date: externalMatch.source.publishedDate?.trim() || null,
      };
      evidence[category] = entry;
      verifiedEvidence.push(entry);
      externalVerifiedCount += 1;
      evidenceTrace.push(`${label}: verified from external source "${publisher}".`);
      continue;
    }

    const userMatch = findUserProvidedMatch(combinedUserFacts, pattern);
    if (userMatch) {
      evidence[category] = {
        category,
        source: USER_PROVIDED_SOURCE_LABEL,
        url: null,
        publisher: null,
        evidence_type: "user_provided",
        confidence: USER_PROVIDED_CONFIDENCE,
        extracted_fact: extractRelevantFact(userMatch, pattern),
        date: null,
      };
      userProvidedCount += 1;
      evidenceTrace.push(`${label}: found in user-provided input, not independently verified.`);
      continue;
    }

    evidence[category] = {
      category,
      source: MISSING_EVIDENCE_LABEL,
      url: null,
      publisher: null,
      evidence_type: "missing",
      confidence: 0,
      extracted_fact: null,
      date: null,
    };
    missingCategories.push(category);
    evidenceTrace.push(
      `${label}: ${MISSING_EVIDENCE_LABEL} -- no external or user-provided source found. Nothing was fabricated.`
    );
  }

  return {
    evidence,
    verifiedEvidence,
    externalVerifiedCount,
    userProvidedCount,
    missingEvidenceCount: missingCategories.length,
    missingCategories,
    evidenceTrace,
  };
}
