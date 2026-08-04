import { z } from "zod";
import { MISSING_EVIDENCE_LABEL, type Evidence, type EvidenceAcquisitionResult } from "./evidence-acquisition-engine.ts";

// ZERINIX Evidence Quality Scoring v1.
//
// Every piece of evidence ZERINIX collects must be scored before it is
// trusted in reasoning: a single unverified, stale, single-sourced claim
// must not carry the same weight as a fresh, corroborated, traceable one.
// This module scores each evidence item across 8 fixed dimensions --
// source authority, source freshness, evidence completeness, relevance
// to the decision, independent confirmation, conflict detection,
// traceability, and confidence -- and produces a 0-100 quality score per
// item plus pool-level aggregates (overall pool score, low-quality
// flags, detected contradictions, and a missing-evidence penalty).
//
// Never fabricates a score: every dimension score is a deterministic
// function of properties the evidence item (or the pool it sits in)
// actually has -- presence/absence of a url or publisher, a parseable
// date, keyword overlap with the stated decision objective, numeric or
// keyword conflicts with other pool items, etc. There is no randomness
// and no "looks about right" number; `scoringTrace`/`rationale` on every
// dimension names the exact rule that produced it, so every score is
// auditable. When there is genuinely nothing to score (an empty pool, or
// a dimension with no basis for comparison, such as relevance with no
// decision objective supplied), the result says so explicitly (score 0,
// or a stated neutral default with a rationale) rather than guessing.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_EVIDENCE_QUALITY_SCORING_ENABLED, defaulting to disabled (or
// pass `enabled: true` in the scoring context, primarily for tests) --
// when disabled, no scoring computation runs at all.

export const evidenceQualityDimensionValues = [
  "source_authority",
  "source_freshness",
  "evidence_completeness",
  "relevance_to_decision",
  "independent_confirmation",
  "conflict_detection",
  "traceability",
  "confidence",
] as const;

export type EvidenceQualityDimension = (typeof evidenceQualityDimensionValues)[number];

export const evidenceQualityFlagValues = [
  "low_quality",
  "missing_source",
  "stale",
  "unverifiable",
  "irrelevant",
  "contradicted",
] as const;

export type EvidenceQualityFlag = (typeof evidenceQualityFlagValues)[number];

export const EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR = "ZERINIX_EVIDENCE_QUALITY_SCORING_ENABLED";

export function isEvidenceQualityScoringEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const dimensionScoreSchema = z
  .object({
    dimension: z.enum(evidenceQualityDimensionValues),
    score: z.number().min(0).max(100),
    rationale: shortString(400),
  })
  .strict();

export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const evidenceQualityScoreSchema = z
  .object({
    id: shortString(120),
    overallScore: z.number().min(0).max(100),
    dimensionScores: z.array(dimensionScoreSchema).length(evidenceQualityDimensionValues.length),
    flags: z.array(z.enum(evidenceQualityFlagValues)).max(evidenceQualityFlagValues.length),
    isLowQuality: z.boolean(),
    contradictedBy: z.array(shortString(120)).max(50),
    confirmedBy: z.array(shortString(120)).max(50),
    scoringTrace: z.array(shortString(400)).max(20),
  })
  .strict();

export type EvidenceQualityScore = z.infer<typeof evidenceQualityScoreSchema>;

const contradictionSchema = z
  .object({
    a: shortString(120),
    b: shortString(120),
    reason: shortString(300),
  })
  .strict();

export const evidenceQualityScoringResultSchema = z
  .object({
    enabled: z.boolean(),
    itemScores: z.array(evidenceQualityScoreSchema).max(200),
    overallPoolScore: z.number().min(0).max(100),
    lowQualityItemIds: z.array(shortString(120)).max(200),
    contradictions: z.array(contradictionSchema).max(100),
    missingEvidencePenalty: z.number().min(0).max(100),
    scoringTrace: z.array(shortString(500)).max(40),
  })
  .strict();

export type EvidenceQualityScoringResult = z.infer<typeof evidenceQualityScoringResultSchema>;

export type ScorableEvidenceSource = {
  publisher?: string | null;
  url?: string | null;
  publishedDate?: string | null;
};

export type ScorableEvidenceItem = {
  id?: string;
  text: string;
  source?: ScorableEvidenceSource | null;
  statedConfidence?: number | null;
};

export type EvidenceQualityScoringContext = {
  // The user's decision objective / prompt, used only for keyword-overlap
  // relevance scoring. Omit if unavailable -- relevance then reports a
  // stated neutral default rather than a fabricated judgment.
  decisionObjective?: string;
  // Injectable clock, for deterministic freshness testing.
  now?: Date;
  // How many evidence items were actually expected (e.g. Evidence
  // Acquisition Engine's 9 categories); if the pool has fewer, a
  // missing-evidence penalty is applied to the pool score. Omit if
  // there is no known expectation.
  expectedItemCount?: number;
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_EVIDENCE_QUALITY_SCORING_ENABLED environment variable.
  enabled?: boolean;
};

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

function significantWords(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );
}

function topicalOverlapRatio(a: string, b: string): number {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }
  let intersectionSize = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersectionSize += 1;
    }
  }
  const unionSize = wordsA.size + wordsB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

const TOPICAL_OVERLAP_THRESHOLD = 0.2;

const NUMERIC_TOKEN_PATTERN = /\$?\d[\d,]*(?:\.\d+)?%?/g;

function extractNumericTokens(text: string): Set<string> {
  const matches = text.match(NUMERIC_TOKEN_PATTERN) || [];
  return new Set(matches.map((token) => token.replace(/,/g, "")));
}

const CONTRADICTORY_SIGNAL_PATTERN =
  /\b(however|but\b|risk|declin|loss|concern|against|unfavorable|conflict|contradict|downside|weakness|uncertain|caution)/i;

function roundClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreSourceAuthority(source: ScorableEvidenceSource | null | undefined): DimensionScore {
  const url = source?.url?.trim() || "";
  const publisher = source?.publisher?.trim() || "";
  let score: number;
  let rationale: string;

  if (url && publisher) {
    const isOfficialDomain = /\.(gov|edu|int)(\/|$)/i.test(url);
    score = isOfficialDomain ? 95 : 80;
    rationale = isOfficialDomain
      ? `Publisher "${publisher}" and an official (.gov/.edu/.int) URL are both present.`
      : `Publisher "${publisher}" and a URL are both present.`;
  } else if (publisher) {
    score = 50;
    rationale = `Only a publisher ("${publisher}") is present, with no URL to verify it against.`;
  } else if (url) {
    score = 55;
    rationale = "Only a URL is present, with no named publisher.";
  } else {
    score = 0;
    rationale = "No publisher or URL is present; the source's authority cannot be assessed.";
  }

  return { dimension: "source_authority", score, rationale };
}

function scoreSourceFreshness(
  source: ScorableEvidenceSource | null | undefined,
  now: Date
): DimensionScore {
  const rawDate = source?.publishedDate?.trim();
  if (!rawDate) {
    return {
      dimension: "source_freshness",
      score: 30,
      rationale: "No publication date is present, so freshness cannot be verified.",
    };
  }

  const parsed = Date.parse(rawDate);
  if (Number.isNaN(parsed)) {
    return {
      dimension: "source_freshness",
      score: 30,
      rationale: `The stated date "${rawDate}" could not be parsed, so freshness cannot be verified.`,
    };
  }

  const ageDays = Math.max(0, (now.getTime() - parsed) / (1000 * 60 * 60 * 24));
  let score: number;
  if (ageDays <= 180) score = 100;
  else if (ageDays <= 365) score = 80;
  else if (ageDays <= 730) score = 60;
  else if (ageDays <= 1825) score = 40;
  else score = 20;

  return {
    dimension: "source_freshness",
    score,
    rationale: `Published ${Math.round(ageDays)} day(s) ago (${rawDate}).`,
  };
}

function scoreEvidenceCompleteness(item: ScorableEvidenceItem): DimensionScore {
  const fields = [
    Boolean(item.text?.trim()),
    Boolean(item.source?.publisher?.trim()),
    Boolean(item.source?.url?.trim()),
    Boolean(item.source?.publishedDate?.trim()),
    typeof item.statedConfidence === "number",
  ];
  const populated = fields.filter(Boolean).length;
  const score = roundClamp((populated / fields.length) * 100);

  return {
    dimension: "evidence_completeness",
    score,
    rationale: `${populated} of ${fields.length} expected field(s) (text, publisher, url, date, confidence) are populated.`,
  };
}

function scoreRelevance(text: string, decisionObjective: string | undefined): DimensionScore {
  if (!decisionObjective || !decisionObjective.trim()) {
    return {
      dimension: "relevance_to_decision",
      score: 50,
      rationale: "No decision objective was supplied, so relevance defaults to a neutral score rather than a guess.",
    };
  }

  const overlap = topicalOverlapRatio(text, decisionObjective);
  const score = roundClamp(overlap * 400);

  return {
    dimension: "relevance_to_decision",
    score,
    rationale: `Keyword overlap with the decision objective is ${(overlap * 100).toFixed(1)}%.`,
  };
}

function scoreIndependentConfirmation(confirmingCount: number): DimensionScore {
  let score: number;
  if (confirmingCount === 0) score = 20;
  else if (confirmingCount === 1) score = 60;
  else if (confirmingCount === 2) score = 85;
  else score = 100;

  return {
    dimension: "independent_confirmation",
    score,
    rationale: `${confirmingCount} other pool item(s) from a different publisher independently corroborate this evidence.`,
  };
}

function scoreConflictDetection(conflictingCount: number): DimensionScore {
  let score: number;
  if (conflictingCount === 0) score = 100;
  else if (conflictingCount === 1) score = 60;
  else score = 30;

  return {
    dimension: "conflict_detection",
    score,
    rationale: `${conflictingCount} other pool item(s) appear to conflict with this evidence.`,
  };
}

function scoreTraceability(source: ScorableEvidenceSource | null | undefined, hasText: boolean): DimensionScore {
  const url = source?.url?.trim() || "";
  const publisher = source?.publisher?.trim() || "";

  if (url) {
    return { dimension: "traceability", score: 100, rationale: "A URL is present, so the evidence can be traced to its source." };
  }
  if (publisher) {
    return {
      dimension: "traceability",
      score: 60,
      rationale: `A publisher ("${publisher}") is present but no URL, so tracing requires manual lookup.`,
    };
  }
  if (hasText) {
    return {
      dimension: "traceability",
      score: 30,
      rationale: "No publisher or URL is present; only the raw text itself (e.g. user-provided input) can be traced.",
    };
  }
  return { dimension: "traceability", score: 0, rationale: "There is no text or source to trace." };
}

function scoreConfidence(statedConfidence: number | null | undefined, hasSource: boolean): DimensionScore {
  if (typeof statedConfidence === "number") {
    return {
      dimension: "confidence",
      score: roundClamp(statedConfidence * 100),
      rationale: `Derived from the evidence's own stated confidence (${statedConfidence}).`,
    };
  }
  const score = hasSource ? 50 : 20;
  return {
    dimension: "confidence",
    score,
    rationale: hasSource
      ? "No stated confidence was supplied; defaulted to a moderate value because a source is present."
      : "No stated confidence was supplied and no source is present; defaulted to a low value.",
  };
}

const DIMENSION_WEIGHT = 1 / evidenceQualityDimensionValues.length;

function computeOverallScore(dimensionScores: readonly DimensionScore[]): number {
  const total = dimensionScores.reduce((sum, entry) => sum + entry.score * DIMENSION_WEIGHT, 0);
  return roundClamp(total);
}

const LOW_QUALITY_THRESHOLD = 50;

function disabledResult(): EvidenceQualityScoringResult {
  return {
    enabled: false,
    itemScores: [],
    overallPoolScore: 0,
    lowQualityItemIds: [],
    contradictions: [],
    missingEvidencePenalty: 0,
    scoringTrace: [
      `Evidence Quality Scoring is disabled (set ${EVIDENCE_QUALITY_SCORING_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function scoreEvidenceQuality(
  pool: readonly ScorableEvidenceItem[],
  context: EvidenceQualityScoringContext = {}
): EvidenceQualityScoringResult {
  const enabled = context.enabled ?? isEvidenceQualityScoringEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const now = context.now ?? new Date();
  const scoringTrace: string[] = [`Scoring ${pool.length} evidence item(s).`];

  const ids = pool.map((item, index) => item.id?.trim() || `item_${index}`);

  // Pairwise topical overlap, once, reused for both conflict detection
  // and independent confirmation.
  const conflictingCounts = pool.map(() => 0);
  const confirmingCounts = pool.map(() => 0);
  const contradictions: z.infer<typeof contradictionSchema>[] = [];
  const contradictedByIds: string[][] = pool.map(() => []);
  const confirmedByIds: string[][] = pool.map(() => []);

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const overlap = topicalOverlapRatio(pool[i].text, pool[j].text);
      if (overlap < TOPICAL_OVERLAP_THRESHOLD) {
        continue;
      }

      const numbersA = extractNumericTokens(pool[i].text);
      const numbersB = extractNumericTokens(pool[j].text);
      const hasDisjointNumbers =
        numbersA.size > 0 && numbersB.size > 0 && [...numbersA].every((token) => !numbersB.has(token));
      const oneContradictorySignal =
        CONTRADICTORY_SIGNAL_PATTERN.test(pool[i].text) !== CONTRADICTORY_SIGNAL_PATTERN.test(pool[j].text);

      if (hasDisjointNumbers || oneContradictorySignal) {
        conflictingCounts[i] += 1;
        conflictingCounts[j] += 1;
        contradictedByIds[i].push(ids[j]);
        contradictedByIds[j].push(ids[i]);
        contradictions.push({
          a: ids[i],
          b: ids[j],
          reason: hasDisjointNumbers
            ? "Both items discuss overlapping evidence but cite different figures."
            : "Both items discuss overlapping evidence, but only one contains a counter-signal (e.g. 'however', 'risk', 'declin...').",
        });
        continue;
      }

      const publisherA = pool[i].source?.publisher?.trim();
      const publisherB = pool[j].source?.publisher?.trim();
      if (publisherA && publisherB && publisherA !== publisherB) {
        confirmingCounts[i] += 1;
        confirmingCounts[j] += 1;
        confirmedByIds[i].push(ids[j]);
        confirmedByIds[j].push(ids[i]);
      }
    }
  }

  const itemScores: EvidenceQualityScore[] = pool.map((item, index) => {
    const dimensionScores = [
      scoreSourceAuthority(item.source),
      scoreSourceFreshness(item.source, now),
      scoreEvidenceCompleteness(item),
      scoreRelevance(item.text, context.decisionObjective),
      scoreIndependentConfirmation(confirmingCounts[index]),
      scoreConflictDetection(conflictingCounts[index]),
      scoreTraceability(item.source, Boolean(item.text?.trim())),
      scoreConfidence(item.statedConfidence, Boolean(item.source?.publisher?.trim() || item.source?.url?.trim())),
    ];
    const overallScore = computeOverallScore(dimensionScores);

    const flags: EvidenceQualityFlag[] = [];
    if (overallScore < LOW_QUALITY_THRESHOLD) flags.push("low_quality");
    if (!item.source?.publisher?.trim() && !item.source?.url?.trim()) flags.push("missing_source");
    if (dimensionScores.find((d) => d.dimension === "source_freshness")!.score < 40) flags.push("stale");
    if (dimensionScores.find((d) => d.dimension === "traceability")!.score <= 30) flags.push("unverifiable");
    if (context.decisionObjective && dimensionScores.find((d) => d.dimension === "relevance_to_decision")!.score < 30) {
      flags.push("irrelevant");
    }
    if (contradictedByIds[index].length > 0) flags.push("contradicted");

    return {
      id: ids[index],
      overallScore,
      dimensionScores,
      flags,
      isLowQuality: overallScore < LOW_QUALITY_THRESHOLD,
      contradictedBy: contradictedByIds[index],
      confirmedBy: confirmedByIds[index],
      scoringTrace: dimensionScores.map((d) => `${d.dimension}: ${d.score} -- ${d.rationale}`),
    };
  });

  const meanItemScore = itemScores.length === 0 ? 0 : itemScores.reduce((sum, s) => sum + s.overallScore, 0) / itemScores.length;

  let missingEvidencePenalty = 0;
  if (typeof context.expectedItemCount === "number" && context.expectedItemCount > pool.length) {
    missingEvidencePenalty = roundClamp(((context.expectedItemCount - pool.length) / context.expectedItemCount) * 100);
    scoringTrace.push(
      `${context.expectedItemCount - pool.length} of ${context.expectedItemCount} expected evidence item(s) are missing; applying a ${missingEvidencePenalty}% confidence penalty.`
    );
  }

  const overallPoolScore = roundClamp(meanItemScore * (1 - missingEvidencePenalty / 100));
  const lowQualityItemIds = itemScores.filter((s) => s.isLowQuality).map((s) => s.id);

  scoringTrace.push(`Overall pool score: ${overallPoolScore} (mean item score ${Math.round(meanItemScore)}).`);
  if (contradictions.length > 0) {
    scoringTrace.push(`Detected ${contradictions.length} contradiction(s) between pool items.`);
  }

  return {
    enabled: true,
    itemScores,
    overallPoolScore,
    lowQualityItemIds,
    contradictions,
    missingEvidencePenalty,
    scoringTrace,
  };
}

const TOTAL_EVIDENCE_CATEGORIES = 9;

function toScorableItem(category: string, evidence: Evidence): ScorableEvidenceItem | null {
  if (evidence.evidence_type === "missing" || evidence.source === MISSING_EVIDENCE_LABEL || !evidence.extracted_fact) {
    return null;
  }
  return {
    id: category,
    text: evidence.extracted_fact,
    source: {
      publisher: evidence.publisher,
      url: evidence.url,
      publishedDate: evidence.date,
    },
    statedConfidence: evidence.confidence,
  };
}

// Convenience wrapper: scores an Evidence Acquisition Engine result
// directly. "Missing Verified Evidence" categories are never scored --
// there is no text to score without fabricating one -- but they DO count
// toward the missing-evidence penalty (expectedItemCount is always the
// full 9-category set), exactly matching "missing evidence must reduce
// confidence."
export function scoreEvidenceAcquisitionResult(
  result: EvidenceAcquisitionResult,
  context: EvidenceQualityScoringContext = {}
): EvidenceQualityScoringResult {
  const pool = Object.entries(result.evidence)
    .map(([category, evidence]) => toScorableItem(category, evidence))
    .filter((item): item is ScorableEvidenceItem => item !== null);

  return scoreEvidenceQuality(pool, {
    ...context,
    expectedItemCount: context.expectedItemCount ?? TOTAL_EVIDENCE_CATEGORIES,
  });
}
