import { z } from "zod";

// ZERINIX Source Reliability Engine v1.
//
// Every evidence source must receive a reliability score (0-100) before
// it is allowed to influence a business decision. This module scores a
// source across 5 fixed dimensions -- authority, expertise, publication
// quality, source consistency, and historical reliability -- and
// explicitly detects anonymous or weak sources rather than letting them
// blend into an average.
//
// Never fabricates reliability: authority and expertise are looked up
// from a small, documented sourceType table (a methodology constant,
// the same "bucketed scoring" convention already used by Evidence
// Quality Scoring and Confidence Engine) or a URL's domain suffix --
// never invented. Source consistency and historical reliability are
// only ever computed from real numbers the caller supplies
// (confirmation/contradiction counts, past evidence-quality scores for
// this same source); when that history genuinely does not exist yet,
// the dimension defaults to a documented neutral value (50 -- "unknown,
// not judged good or bad") rather than an invented judgment either way.
// A source with no name at all is never scored as "unknown but okay" --
// it is explicitly flagged anonymous and scored at the floor (0) across
// every dimension, because a business decision should never trust a
// source it cannot even identify consistently across appearances.
//
// Increases confidence only for sources that actually reach a high
// score (`isHighlyTrusted` / the "highly_trusted" flag), and penalizes
// low-quality sources through the same weighted formula -- there is no
// separate code path that can raise the score without a real, cited
// dimension improvement.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_SOURCE_RELIABILITY_ENGINE_ENABLED, defaulting to disabled (or
// pass `enabled: true`, primarily for tests) -- when disabled, no
// scoring runs at all.

export const sourceTypeValues = [
  "government",
  "regulatory_body",
  "academic_journal",
  "industry_analyst",
  "news_media",
  "blog",
  "social_media",
  "user_generated",
  "unknown",
] as const;

export type SourceType = (typeof sourceTypeValues)[number];

export const sourceReliabilityDimensionValues = [
  "authority",
  "expertise",
  "publication_quality",
  "source_consistency",
  "historical_reliability",
] as const;

export type SourceReliabilityDimension = (typeof sourceReliabilityDimensionValues)[number];

export const sourceReliabilityFlagValues = [
  "anonymous",
  "weak_source",
  "low_authority",
  "low_expertise",
  "inconsistent",
  "no_track_record",
  "highly_trusted",
] as const;

export type SourceReliabilityFlag = (typeof sourceReliabilityFlagValues)[number];

export const SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR = "ZERINIX_SOURCE_RELIABILITY_ENGINE_ENABLED";

export function isSourceReliabilityEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const sourceReliabilityDimensionScoreSchema = z
  .object({
    dimension: z.enum(sourceReliabilityDimensionValues),
    score: z.number().min(0).max(100),
    weight: z.number().min(0).max(1),
    rationale: shortString(400),
  })
  .strict();

export type SourceReliabilityDimensionScore = z.infer<typeof sourceReliabilityDimensionScoreSchema>;

export const reliabilityDriverSchema = z
  .object({
    dimension: z.enum(sourceReliabilityDimensionValues),
    description: shortString(300),
  })
  .strict();

export const reliabilityPenaltySchema = z
  .object({
    dimension: z.enum(sourceReliabilityDimensionValues),
    description: shortString(300),
    impact: z.number().min(0).max(100),
  })
  .strict();

export const sourceReliabilityResultSchema = z
  .object({
    enabled: z.boolean(),
    sourceName: z.string().trim().max(200).nullable(),
    reliabilityScore: z.number().min(0).max(100),
    dimensionScores: z.array(sourceReliabilityDimensionScoreSchema).max(sourceReliabilityDimensionValues.length),
    flags: z.array(z.enum(sourceReliabilityFlagValues)).max(sourceReliabilityFlagValues.length),
    isAnonymousOrWeak: z.boolean(),
    isHighlyTrusted: z.boolean(),
    reliabilityDrivers: z.array(reliabilityDriverSchema).max(sourceReliabilityDimensionValues.length),
    reliabilityPenalties: z.array(reliabilityPenaltySchema).max(sourceReliabilityDimensionValues.length),
    scoringTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type SourceReliabilityResult = z.infer<typeof sourceReliabilityResultSchema>;

export type SourceReliabilityInput = {
  name?: string;
  url?: string;
  sourceType?: SourceType;
  // Past 0-100 overall evidence-quality scores attributed to this same
  // source, if the caller has tracked them (e.g. from Evidence Quality
  // Scoring across multiple prior evidence items). Never fabricated --
  // omit if there is no real history yet.
  historicalEvidenceScores?: readonly number[];
  // How many times this source's evidence was independently confirmed
  // by, versus contradicted by, another source (e.g. from Conflict
  // Detection Engine / Evidence Quality Scoring's confirmedBy /
  // contradictedBy). Omit if unknown.
  confirmationCount?: number;
  contradictionCount?: number;
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_SOURCE_RELIABILITY_ENGINE_ENABLED environment variable.
  enabled?: boolean;
};

export type SourceReliabilityBatchResult = {
  enabled: boolean;
  sources: SourceReliabilityResult[];
};

function roundClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const DIMENSION_WEIGHT = 1 / sourceReliabilityDimensionValues.length;

const NEUTRAL_NO_HISTORY_SCORE = 50;
const NO_TYPE_OR_URL_AUTHORITY_SCORE = 15;
const UNKNOWN_URL_ONLY_AUTHORITY_SCORE = 25;
const OFFICIAL_DOMAIN_AUTHORITY_SCORE = 85;
const NO_TYPE_EXPERTISE_SCORE = 20;

const AUTHORITY_SCORE: Record<SourceType, number> = {
  regulatory_body: 95,
  government: 90,
  academic_journal: 85,
  industry_analyst: 75,
  news_media: 55,
  blog: 30,
  social_media: 10,
  user_generated: 10,
  unknown: 20,
};

const EXPERTISE_SCORE: Record<SourceType, number> = {
  regulatory_body: 90,
  academic_journal: 90,
  industry_analyst: 80,
  government: 55,
  news_media: 40,
  blog: 30,
  social_media: 10,
  user_generated: 10,
  unknown: 20,
};

function isOfficialDomain(url: string) {
  return /\.(gov|edu|int)(\/|$)/i.test(url);
}

function scoreAuthority(input: SourceReliabilityInput): SourceReliabilityDimensionScore {
  if (input.sourceType) {
    return {
      dimension: "authority",
      score: AUTHORITY_SCORE[input.sourceType],
      weight: DIMENSION_WEIGHT,
      rationale: `Source type "${input.sourceType}" carries a documented authority score of ${AUTHORITY_SCORE[input.sourceType]}.`,
    };
  }
  if (input.url && isOfficialDomain(input.url)) {
    return {
      dimension: "authority",
      score: OFFICIAL_DOMAIN_AUTHORITY_SCORE,
      weight: DIMENSION_WEIGHT,
      rationale: "No source type was supplied, but the URL is an official (.gov/.edu/.int) domain.",
    };
  }
  if (input.url) {
    return {
      dimension: "authority",
      score: UNKNOWN_URL_ONLY_AUTHORITY_SCORE,
      weight: DIMENSION_WEIGHT,
      rationale: "A URL is present but no source type is known and the domain is not an official one.",
    };
  }
  return {
    dimension: "authority",
    score: NO_TYPE_OR_URL_AUTHORITY_SCORE,
    weight: DIMENSION_WEIGHT,
    rationale: "Neither a source type nor a URL was supplied; authority defaults to the weakest non-anonymous value.",
  };
}

function scoreExpertise(input: SourceReliabilityInput): SourceReliabilityDimensionScore {
  if (input.sourceType) {
    return {
      dimension: "expertise",
      score: EXPERTISE_SCORE[input.sourceType],
      weight: DIMENSION_WEIGHT,
      rationale: `Source type "${input.sourceType}" carries a documented expertise score of ${EXPERTISE_SCORE[input.sourceType]}.`,
    };
  }
  return {
    dimension: "expertise",
    score: NO_TYPE_EXPERTISE_SCORE,
    weight: DIMENSION_WEIGHT,
    rationale: "No source type was supplied, so subject-matter expertise cannot be assessed.",
  };
}

function scorePublicationQuality(input: SourceReliabilityInput): SourceReliabilityDimensionScore {
  const fields = [Boolean(input.name?.trim()), Boolean(input.url?.trim()), Boolean(input.sourceType)];
  const populated = fields.filter(Boolean).length;
  return {
    dimension: "publication_quality",
    score: roundClamp((populated / fields.length) * 100),
    weight: DIMENSION_WEIGHT,
    rationale: `${populated} of ${fields.length} expected identifying field(s) (name, url, source type) are known.`,
  };
}

function scoreSourceConsistency(input: SourceReliabilityInput): {
  entry: SourceReliabilityDimensionScore;
  hasData: boolean;
} {
  const confirmations = input.confirmationCount ?? 0;
  const contradictions = input.contradictionCount ?? 0;
  const total = confirmations + contradictions;

  if (total === 0) {
    return {
      hasData: false,
      entry: {
        dimension: "source_consistency",
        score: NEUTRAL_NO_HISTORY_SCORE,
        weight: DIMENSION_WEIGHT,
        rationale: "No confirmation/contradiction history was supplied for this source, so consistency defaults to a neutral value.",
      },
    };
  }

  const score = roundClamp((confirmations / total) * 100);
  return {
    hasData: true,
    entry: {
      dimension: "source_consistency",
      score,
      weight: DIMENSION_WEIGHT,
      rationale: `This source was confirmed ${confirmations} time(s) and contradicted ${contradictions} time(s) by other sources.`,
    },
  };
}

function scoreHistoricalReliability(input: SourceReliabilityInput): {
  entry: SourceReliabilityDimensionScore;
  hasData: boolean;
} {
  const history = input.historicalEvidenceScores ?? [];
  if (history.length === 0) {
    return {
      hasData: false,
      entry: {
        dimension: "historical_reliability",
        score: NEUTRAL_NO_HISTORY_SCORE,
        weight: DIMENSION_WEIGHT,
        rationale: "No historical evidence-quality scores were supplied for this source, so history defaults to a neutral value.",
      },
    };
  }

  const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
  return {
    hasData: true,
    entry: {
      dimension: "historical_reliability",
      score: roundClamp(mean),
      weight: DIMENSION_WEIGHT,
      rationale: `Mean of ${history.length} past evidence-quality score(s) attributed to this source is ${Math.round(mean)}.`,
    },
  };
}

const DRIVER_THRESHOLD = 70;
const PENALTY_THRESHOLD = 40;
const WEAK_SOURCE_THRESHOLD = 40;
const HIGHLY_TRUSTED_THRESHOLD = 80;
const LOW_DIMENSION_THRESHOLD = 30;
const LOW_CONSISTENCY_THRESHOLD = 40;

function anonymousResult(enabled: true): SourceReliabilityResult {
  const dimensionScores: SourceReliabilityDimensionScore[] = sourceReliabilityDimensionValues.map((dimension) => ({
    dimension,
    score: 0,
    weight: DIMENSION_WEIGHT,
    rationale: "No source name was supplied; the source is anonymous and cannot be evaluated.",
  }));

  return {
    enabled,
    sourceName: null,
    reliabilityScore: 0,
    dimensionScores,
    flags: ["anonymous"],
    isAnonymousOrWeak: true,
    isHighlyTrusted: false,
    reliabilityDrivers: [],
    reliabilityPenalties: dimensionScores.map((entry) => ({
      dimension: entry.dimension,
      description: entry.rationale,
      impact: 100,
    })),
    scoringTrace: ["Source is anonymous (no name supplied); every dimension scores 0."],
  };
}

function disabledResult(): SourceReliabilityResult {
  return {
    enabled: false,
    sourceName: null,
    reliabilityScore: 0,
    dimensionScores: [],
    flags: [],
    isAnonymousOrWeak: false,
    isHighlyTrusted: false,
    reliabilityDrivers: [],
    reliabilityPenalties: [],
    scoringTrace: [
      `Source Reliability Engine is disabled (set ${SOURCE_RELIABILITY_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function scoreSourceReliability(input: SourceReliabilityInput = {}): SourceReliabilityResult {
  const enabled = input.enabled ?? isSourceReliabilityEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const name = input.name?.trim() || "";
  if (!name) {
    return anonymousResult(true);
  }

  const authority = scoreAuthority(input);
  const expertise = scoreExpertise(input);
  const publicationQuality = scorePublicationQuality(input);
  const consistency = scoreSourceConsistency(input);
  const historical = scoreHistoricalReliability(input);

  const dimensionScores: SourceReliabilityDimensionScore[] = [
    authority,
    expertise,
    publicationQuality,
    consistency.entry,
    historical.entry,
  ];

  const reliabilityScore = roundClamp(dimensionScores.reduce((sum, entry) => sum + entry.score * entry.weight, 0));

  const flags: SourceReliabilityFlag[] = [];
  if (reliabilityScore < WEAK_SOURCE_THRESHOLD) flags.push("weak_source");
  if (authority.score < LOW_DIMENSION_THRESHOLD) flags.push("low_authority");
  if (expertise.score < LOW_DIMENSION_THRESHOLD) flags.push("low_expertise");
  if (consistency.hasData && consistency.entry.score < LOW_CONSISTENCY_THRESHOLD) flags.push("inconsistent");
  if (!consistency.hasData && !historical.hasData) flags.push("no_track_record");
  if (reliabilityScore >= HIGHLY_TRUSTED_THRESHOLD) flags.push("highly_trusted");

  const reliabilityDrivers = dimensionScores
    .filter((entry) => entry.score >= DRIVER_THRESHOLD)
    .map((entry) => ({ dimension: entry.dimension, description: entry.rationale }));

  const reliabilityPenalties = dimensionScores
    .filter((entry) => entry.score < PENALTY_THRESHOLD)
    .map((entry) => ({
      dimension: entry.dimension,
      description: entry.rationale,
      impact: roundClamp(100 - entry.score),
    }));

  const scoringTrace = [
    `Scoring source "${name}".`,
    ...dimensionScores.map((entry) => `${entry.dimension}: ${entry.score} (weight ${entry.weight}) -- ${entry.rationale}`),
    `Reliability score: ${reliabilityScore}.`,
  ];

  return {
    enabled: true,
    sourceName: name,
    reliabilityScore,
    dimensionScores,
    flags,
    isAnonymousOrWeak: flags.includes("weak_source"),
    isHighlyTrusted: flags.includes("highly_trusted"),
    reliabilityDrivers,
    reliabilityPenalties,
    scoringTrace,
  };
}

export function scoreSourceReliabilityBatch(
  inputs: readonly SourceReliabilityInput[],
  context: { enabled?: boolean } = {}
): SourceReliabilityBatchResult {
  const enabled = context.enabled ?? isSourceReliabilityEngineEnabled();
  if (!enabled) {
    return { enabled: false, sources: inputs.map(() => disabledResult()) };
  }
  return { enabled: true, sources: inputs.map((input) => scoreSourceReliability({ ...input, enabled: true })) };
}
