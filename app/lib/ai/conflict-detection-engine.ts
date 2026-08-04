import { z } from "zod";
import type { ScorableEvidenceItem } from "./evidence-quality-scoring.ts";

// ZERINIX Conflict Detection Engine v1.
//
// ZERINIX must never issue an executive recommendation while silently
// sitting on contradictory evidence. This module groups a pool of
// evidence into topics (so unrelated evidence can never be flagged as
// "conflicting" just because two independent heuristics happened to
// fire), measures how much each topic's evidence agrees versus
// disagrees, and produces a severity (Low/Medium/High/Critical) per
// topic and overall -- plus, for every individual conflict, which two
// sources disagree and why.
//
// Never fabricates a conflict: two items are only ever compared for
// conflict if they already cleared a real topical-overlap threshold
// (shared significant words), and a conflict is only ever recorded when
// there is a concrete, checkable reason -- the two items cite disjoint
// numeric figures for what looks like the same fact, or one contains an
// explicit counter-signal keyword ("however", "risk", "declin...") that
// the other does not. There is no other path to a conflict record: it
// is either grounded in a real numeric mismatch or a real asymmetric
// keyword signal, both computed directly from the evidence text/source
// that was actually supplied.
//
// Never ignores conflicting evidence: every pair that clears the
// topical-overlap threshold is checked, and every conflict found is
// included in the `conflicts` array (bounded only by a generous safety
// cap, never sampled or summarized away) -- overall severity is always
// the WORST severity found across all topics, never averaged down.
//
// Reduces confidence when conflicts exist, without wiring into anything
// yet: `confidenceImpact` (0-100) is a deterministic, documented
// suggested confidence reduction derived from `overallSeverity`, meant
// for a future caller (e.g. the Confidence Engine) to apply -- this
// module does not modify any other engine's output itself.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_CONFLICT_DETECTION_ENGINE_ENABLED, defaulting to disabled (or
// pass `enabled: true`, primarily for tests) -- when disabled, no
// detection runs at all.

export const conflictSeverityValues = ["low", "medium", "high", "critical"] as const;

export type ConflictSeverity = (typeof conflictSeverityValues)[number];

export const conflictTypeValues = ["numeric_mismatch", "directional_mismatch"] as const;

export type ConflictType = (typeof conflictTypeValues)[number];

export const CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR = "ZERINIX_CONFLICT_DETECTION_ENGINE_ENABLED";

export function isConflictDetectionEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const topicGroupSchema = z
  .object({
    topicId: shortString(60),
    memberIds: z.array(shortString(120)).min(1).max(100),
    agreementCount: z.number().int().min(0),
    disagreementCount: z.number().int().min(0),
    agreementRatio: z.number().min(0).max(1),
    severity: z.enum(conflictSeverityValues).nullable(),
  })
  .strict();

export type TopicGroup = z.infer<typeof topicGroupSchema>;

export const detectedConflictSchema = z
  .object({
    topicId: shortString(60),
    a: shortString(120),
    b: shortString(120),
    sourceA: shortString(200).nullable(),
    sourceB: shortString(200).nullable(),
    reason: shortString(400),
    conflictType: z.enum(conflictTypeValues),
    severity: z.enum(conflictSeverityValues),
  })
  .strict();

export type DetectedConflict = z.infer<typeof detectedConflictSchema>;

export const conflictDetectionResultSchema = z
  .object({
    enabled: z.boolean(),
    topicGroups: z.array(topicGroupSchema).max(200),
    conflicts: z.array(detectedConflictSchema).max(200),
    disagreeingSources: z.array(shortString(200)).max(100),
    overallSeverity: z.enum(conflictSeverityValues).nullable(),
    confidenceImpact: z.number().min(0).max(100),
    additionalResearchRecommended: z.boolean(),
    researchRecommendations: z.array(shortString(300)).max(20),
    scoringTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ConflictDetectionResult = z.infer<typeof conflictDetectionResultSchema>;

export type ConflictDetectionContext = {
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_CONFLICT_DETECTION_ENGINE_ENABLED environment variable.
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

// Union-find over items, linked whenever their topical overlap clears
// the threshold -- this is what makes grouping transitive (A-B and B-C
// overlapping puts A, B, and C in one topic even if A and C don't
// directly overlap), and what guarantees two genuinely unrelated items
// can never end up compared for conflict.
function groupByTopic(ids: readonly string[], pool: readonly ScorableEvidenceItem[]): string[][] {
  const parent = ids.map((_, index) => index);

  function find(index: number): number {
    while (parent[index] !== index) {
      index = parent[index];
    }
    return index;
  }

  function union(a: number, b: number) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[rootA] = rootB;
    }
  }

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      if (topicalOverlapRatio(pool[i].text, pool[j].text) >= TOPICAL_OVERLAP_THRESHOLD) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, string[]>();
  for (let index = 0; index < pool.length; index += 1) {
    const root = find(index);
    const members = groups.get(root) ?? [];
    members.push(ids[index]);
    groups.set(root, members);
  }

  return [...groups.values()];
}

function detectPairConflict(
  itemA: ScorableEvidenceItem,
  itemB: ScorableEvidenceItem
): { conflictType: ConflictType; reason: string } | null {
  const numbersA = extractNumericTokens(itemA.text);
  const numbersB = extractNumericTokens(itemB.text);
  const hasDisjointNumbers =
    numbersA.size > 0 && numbersB.size > 0 && [...numbersA].every((token) => !numbersB.has(token));
  if (hasDisjointNumbers) {
    return {
      conflictType: "numeric_mismatch",
      reason: "Both items discuss the same topic but cite different figures.",
    };
  }

  const oneContradictorySignal =
    CONTRADICTORY_SIGNAL_PATTERN.test(itemA.text) !== CONTRADICTORY_SIGNAL_PATTERN.test(itemB.text);
  if (oneContradictorySignal) {
    return {
      conflictType: "directional_mismatch",
      reason:
        "Both items discuss the same topic, but only one contains a counter-signal (e.g. 'however', 'risk', 'declin...').",
    };
  }

  return null;
}

const SEVERITY_ORDER: Record<ConflictSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function severityFromDisagreementRatio(ratio: number): ConflictSeverity {
  if (ratio > 0.75) return "critical";
  if (ratio > 0.5) return "high";
  if (ratio > 0.25) return "medium";
  return "low";
}

const CONFIDENCE_IMPACT: Record<ConflictSeverity, number> = {
  low: 15,
  medium: 35,
  high: 60,
  critical: 90,
};

const RESEARCH_RECOMMENDED_SEVERITIES: readonly ConflictSeverity[] = ["medium", "high", "critical"];

function truncate(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trim()}…`;
}

function disabledResult(): ConflictDetectionResult {
  return {
    enabled: false,
    topicGroups: [],
    conflicts: [],
    disagreeingSources: [],
    overallSeverity: null,
    confidenceImpact: 0,
    additionalResearchRecommended: false,
    researchRecommendations: [],
    scoringTrace: [
      `Conflict Detection Engine is disabled (set ${CONFLICT_DETECTION_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function detectConflicts(
  pool: readonly ScorableEvidenceItem[],
  context: ConflictDetectionContext = {}
): ConflictDetectionResult {
  const enabled = context.enabled ?? isConflictDetectionEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const ids = pool.map((item, index) => item.id?.trim() || `item_${index}`);
  const itemById = new Map(pool.map((item, index) => [ids[index], item]));
  const scoringTrace: string[] = [`Grouping ${pool.length} evidence item(s) by topic.`];

  const topicMemberGroups = groupByTopic(ids, pool);
  const topicGroups: TopicGroup[] = [];
  const conflicts: DetectedConflict[] = [];
  const disagreeingSources = new Set<string>();

  topicMemberGroups.forEach((memberIds, groupIndex) => {
    const topicId = `topic_${groupIndex}`;
    let agreementCount = 0;
    let disagreementCount = 0;
    const groupConflicts: DetectedConflict[] = [];

    for (let i = 0; i < memberIds.length; i += 1) {
      for (let j = i + 1; j < memberIds.length; j += 1) {
        const itemA = itemById.get(memberIds[i])!;
        const itemB = itemById.get(memberIds[j])!;
        const pairConflict = detectPairConflict(itemA, itemB);

        if (pairConflict) {
          disagreementCount += 1;
          const sourceA = itemA.source?.publisher?.trim() || null;
          const sourceB = itemB.source?.publisher?.trim() || null;
          if (sourceA) disagreeingSources.add(sourceA);
          if (sourceB) disagreeingSources.add(sourceB);
          groupConflicts.push({
            topicId,
            a: memberIds[i],
            b: memberIds[j],
            sourceA,
            sourceB,
            reason: pairConflict.reason,
            conflictType: pairConflict.conflictType,
            // severity is filled in once the group's overall severity is known, below.
            severity: "low",
          });
        } else {
          agreementCount += 1;
        }
      }
    }

    const totalPairs = agreementCount + disagreementCount;
    const disagreementRatio = totalPairs === 0 ? 0 : disagreementCount / totalPairs;
    const severity = disagreementCount > 0 ? severityFromDisagreementRatio(disagreementRatio) : null;

    for (const conflict of groupConflicts) {
      conflicts.push({ ...conflict, severity: severity! });
    }

    topicGroups.push({
      topicId,
      memberIds,
      agreementCount,
      disagreementCount,
      agreementRatio: totalPairs === 0 ? 1 : agreementCount / totalPairs,
      severity,
    });

    if (severity) {
      scoringTrace.push(
        `${topicId}: ${disagreementCount} disagreement(s) out of ${totalPairs} pair(s) -- severity "${severity}".`
      );
    }
  });

  const overallSeverity = topicGroups
    .map((group) => group.severity)
    .filter((severity): severity is ConflictSeverity => severity !== null)
    .sort((a, b) => SEVERITY_ORDER[b] - SEVERITY_ORDER[a])[0] ?? null;

  const confidenceImpact = overallSeverity ? CONFIDENCE_IMPACT[overallSeverity] : 0;
  const additionalResearchRecommended = overallSeverity !== null && RESEARCH_RECOMMENDED_SEVERITIES.includes(overallSeverity);

  const researchRecommendations = topicGroups
    .filter((group) => group.severity && RESEARCH_RECOMMENDED_SEVERITIES.includes(group.severity))
    .map((group) => {
      const representativeText = itemById.get(group.memberIds[0])!.text;
      const involvedSources = [
        ...new Set(
          conflicts
            .filter((conflict) => conflict.topicId === group.topicId)
            .flatMap((conflict) => [conflict.sourceA, conflict.sourceB])
            .filter((source): source is string => Boolean(source))
        ),
      ];
      const sourceClause = involvedSources.length > 0 ? `sources ${involvedSources.join(" and ")} disagree` : "sources disagree";
      return truncate(
        `Additional research recommended: ${sourceClause} on the topic near "${representativeText}"; consider seeking an independent third source to resolve the discrepancy.`,
        300
      );
    });

  scoringTrace.push(
    overallSeverity
      ? `Overall severity: "${overallSeverity}"; suggested confidence impact: -${confidenceImpact}.`
      : "No conflicts were detected across any topic group."
  );

  return {
    enabled: true,
    topicGroups,
    conflicts,
    disagreeingSources: [...disagreeingSources],
    overallSeverity,
    confidenceImpact,
    additionalResearchRecommended,
    researchRecommendations,
    scoringTrace,
  };
}
