import { z } from "zod";
import type { ScorableEvidenceItem } from "./evidence-quality-scoring.ts";

// ZERINIX Evidence Corroboration Engine v1.
//
// Before ZERINIX accepts any executive conclusion, it must independently
// check whether that specific conclusion is actually backed by more than
// one INDEPENDENT source -- not just repeated by the same source, and
// not just "some evidence exists somewhere in the pool." This module
// takes a list of stated conclusions and a pool of evidence, matches
// each conclusion to the evidence that actually supports it (by real
// topical overlap, the same technique already used by Evidence Quality
// Scoring and Conflict Detection Engine), and classifies each
// conclusion as unsupported, supported only by unattributed text,
// supported by exactly one identifiable source, or corroborated by
// multiple independent sources.
//
// Never fabricates corroboration: a conclusion is only ever counted as
// "multi-source corroborated" when at least two DISTINCT, non-empty
// publisher names appear among the evidence that actually overlaps the
// conclusion's own statement. Ten repeated mentions from the same
// publisher never count as more than one source. Evidence with no
// publisher at all can support a conclusion (it's still real,
// supplied text) but can never be counted toward independent source
// count -- there is nothing to verify independence against. There is no
// path in this module that raises a conclusion's status or confidence
// without a real, distinct, named source behind it.
//
// High-impact and critical decisions require independent confirmation:
// for those conclusions, anything short of multi-source corroboration
// is explicitly flagged as "required_and_not_met" -- this module never
// silently accepts a single-source claim just because it "sounds
// right." Confidence increases only as real, distinct source count
// increases, and unsupported conclusions are penalized to the floor
// (confidence 0), not left ambiguous.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_EVIDENCE_CORROBORATION_ENGINE_ENABLED, defaulting to disabled
// (or pass `enabled: true`, primarily for tests) -- when disabled, no
// corroboration check runs at all.

export const decisionImpactValues = ["low", "medium", "high", "critical"] as const;

export type DecisionImpact = (typeof decisionImpactValues)[number];

export const corroborationStatusValues = [
  "unsupported",
  "unattributed_only",
  "single_source",
  "multi_source_corroborated",
] as const;

export type CorroborationStatus = (typeof corroborationStatusValues)[number];

export const corroborationRequirementValues = ["not_required", "required_and_met", "required_and_not_met"] as const;

export type CorroborationRequirement = (typeof corroborationRequirementValues)[number];

export const EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR = "ZERINIX_EVIDENCE_CORROBORATION_ENGINE_ENABLED";

export function isEvidenceCorroborationEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const conclusionCorroborationSchema = z
  .object({
    conclusionId: shortString(120),
    statement: shortString(500),
    impact: z.enum(decisionImpactValues),
    status: z.enum(corroborationStatusValues),
    requirement: z.enum(corroborationRequirementValues),
    supportingEvidenceIds: z.array(shortString(120)).max(200),
    independentSources: z.array(shortString(200)).max(50),
    independentSourceCount: z.number().int().min(0),
    confidence: z.number().min(0).max(100),
    explanation: shortString(600),
  })
  .strict();

export type ConclusionCorroboration = z.infer<typeof conclusionCorroborationSchema>;

export const evidenceCorroborationResultSchema = z
  .object({
    enabled: z.boolean(),
    conclusions: z.array(conclusionCorroborationSchema).max(100),
    unsupportedConclusionIds: z.array(shortString(120)).max(100),
    unattributedOnlyConclusionIds: z.array(shortString(120)).max(100),
    singleSourceConclusionIds: z.array(shortString(120)).max(100),
    multiSourceConclusionIds: z.array(shortString(120)).max(100),
    highImpactRequirementsNotMet: z.array(shortString(120)).max(100),
    scoringTrace: z.array(shortString(500)).max(80),
  })
  .strict();

export type EvidenceCorroborationResult = z.infer<typeof evidenceCorroborationResultSchema>;

export type CorroborationConclusion = {
  id?: string;
  statement: string;
  // How much is at stake if this conclusion turns out to be wrong. When
  // omitted, defaults to "medium" -- a neutral assumption, never the
  // most lenient ("low") nor the most stringent ("high"/"critical").
  impact?: DecisionImpact;
};

export type EvidenceCorroborationInput = {
  conclusions: readonly CorroborationConclusion[];
  evidence: readonly ScorableEvidenceItem[];
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_EVIDENCE_CORROBORATION_ENGINE_ENABLED environment
  // variable.
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

const REQUIRED_CONFIRMATION_IMPACTS: readonly DecisionImpact[] = ["high", "critical"];

const CONFIDENCE_BY_SOURCE_COUNT: readonly number[] = [0, 40, 70, 85, 100];

function confidenceForSourceCount(count: number): number {
  if (count <= 0) return CONFIDENCE_BY_SOURCE_COUNT[0];
  return CONFIDENCE_BY_SOURCE_COUNT[Math.min(count, CONFIDENCE_BY_SOURCE_COUNT.length - 1)];
}

function disabledResult(): EvidenceCorroborationResult {
  return {
    enabled: false,
    conclusions: [],
    unsupportedConclusionIds: [],
    unattributedOnlyConclusionIds: [],
    singleSourceConclusionIds: [],
    multiSourceConclusionIds: [],
    highImpactRequirementsNotMet: [],
    scoringTrace: [
      `Evidence Corroboration Engine is disabled (set ${EVIDENCE_CORROBORATION_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function checkEvidenceCorroboration(
  input: EvidenceCorroborationInput = { conclusions: [], evidence: [] }
): EvidenceCorroborationResult {
  const enabled = input.enabled ?? isEvidenceCorroborationEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const conclusions = input.conclusions ?? [];
  const evidence = input.evidence ?? [];
  const evidenceIds = evidence.map((item, index) => item.id?.trim() || `evidence_${index}`);
  const scoringTrace: string[] = [
    `Checking corroboration for ${conclusions.length} conclusion(s) against ${evidence.length} evidence item(s).`,
  ];

  const results: ConclusionCorroboration[] = conclusions.map((conclusion, conclusionIndex) => {
    const conclusionId = conclusion.id?.trim() || `conclusion_${conclusionIndex}`;
    const impact = conclusion.impact ?? "medium";

    const supportingIndices = evidence
      .map((item, index) => index)
      .filter((index) => topicalOverlapRatio(evidence[index].text, conclusion.statement) >= TOPICAL_OVERLAP_THRESHOLD);

    const supportingEvidenceIds = supportingIndices.map((index) => evidenceIds[index]);
    const independentSources = [
      ...new Set(
        supportingIndices
          .map((index) => evidence[index].source?.publisher?.trim())
          .filter((publisher): publisher is string => Boolean(publisher))
      ),
    ];
    const independentSourceCount = independentSources.length;

    let status: CorroborationStatus;
    if (supportingIndices.length === 0) {
      status = "unsupported";
    } else if (independentSourceCount === 0) {
      status = "unattributed_only";
    } else if (independentSourceCount === 1) {
      status = "single_source";
    } else {
      status = "multi_source_corroborated";
    }

    const requiresConfirmation = REQUIRED_CONFIRMATION_IMPACTS.includes(impact);
    const requirement: CorroborationRequirement = !requiresConfirmation
      ? "not_required"
      : status === "multi_source_corroborated"
        ? "required_and_met"
        : "required_and_not_met";

    const confidence = confidenceForSourceCount(independentSourceCount);

    let explanation: string;
    if (status === "unsupported") {
      explanation = `No evidence was found supporting "${conclusion.statement.slice(0, 100)}"; this conclusion must not be accepted as-is.`;
    } else if (status === "unattributed_only") {
      explanation = `${supportingIndices.length} evidence item(s) mention this topic, but none carry an identifiable source, so independence cannot be verified.`;
    } else if (status === "single_source") {
      explanation = `This conclusion is supported by only 1 identifiable source (${independentSources[0]}).${
        requiresConfirmation ? " Independent confirmation from at least one additional source is required for this impact level before it can be accepted." : ""
      }`;
    } else {
      explanation = `This conclusion is corroborated by ${independentSourceCount} independent source(s): ${independentSources.join(", ")}.`;
    }

    scoringTrace.push(
      `${conclusionId}: status="${status}", requirement="${requirement}", independentSourceCount=${independentSourceCount}, confidence=${confidence}.`
    );

    return {
      conclusionId,
      statement: conclusion.statement,
      impact,
      status,
      requirement,
      supportingEvidenceIds,
      independentSources,
      independentSourceCount,
      confidence,
      explanation,
    };
  });

  const unsupportedConclusionIds = results.filter((r) => r.status === "unsupported").map((r) => r.conclusionId);
  const unattributedOnlyConclusionIds = results.filter((r) => r.status === "unattributed_only").map((r) => r.conclusionId);
  const singleSourceConclusionIds = results.filter((r) => r.status === "single_source").map((r) => r.conclusionId);
  const multiSourceConclusionIds = results.filter((r) => r.status === "multi_source_corroborated").map((r) => r.conclusionId);
  const highImpactRequirementsNotMet = results.filter((r) => r.requirement === "required_and_not_met").map((r) => r.conclusionId);

  return {
    enabled: true,
    conclusions: results,
    unsupportedConclusionIds,
    unattributedOnlyConclusionIds,
    singleSourceConclusionIds,
    multiSourceConclusionIds,
    highImpactRequirementsNotMet,
    scoringTrace,
  };
}
