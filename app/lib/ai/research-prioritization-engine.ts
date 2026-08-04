import { z } from "zod";

// ZERINIX Research Prioritization Engine v1.
//
// Before any live research begins, ZERINIX must decide WHICH task to do
// first -- not by a fixed checklist order, but by actual expected
// business value. This module takes a set of candidate research tasks
// (from any source -- Live Research Engine, Dynamic Research Planner,
// or manually specified) and ranks them by a transparent, 4-factor
// value score: expected decision impact, uncertainty reduction,
// execution cost, and execution time. It is intentionally standalone
// and does not import any other ZERINIX Intelligence module -- a
// caller maps whatever task shape it already has into the small
// candidate type below.
//
// Never fabricates a priority: every factor score is either a direct,
// documented bucket mapping of a real value the caller supplied
// (impact level, a real cost in USD, a real time estimate in hours, a
// real uncertainty-reduction estimate), or -- when that real value is
// missing -- a fixed, clearly-labeled neutral/baseline default (never a
// task-specific-looking invented number). The final rank and value
// score are always the literal weighted computation over those factor
// scores for THIS input; there is no separate code path that assigns a
// rank directly.
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_RESEARCH_PRIORITIZATION_ENGINE_ENABLED, defaulting to
// disabled (or pass `enabled: true`, primarily for tests) -- when
// disabled, no prioritization runs at all.

export const decisionImpactValues = ["low", "medium", "high", "critical"] as const;

export type DecisionImpact = (typeof decisionImpactValues)[number];

export const prioritizationFactorValues = [
  "expected_decision_impact",
  "uncertainty_reduction",
  "execution_cost",
  "execution_time",
] as const;

export type PrioritizationFactor = (typeof prioritizationFactorValues)[number];

export const RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR = "ZERINIX_RESEARCH_PRIORITIZATION_ENGINE_ENABLED";

export function isResearchPrioritizationEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const prioritizationFactorScoreSchema = z
  .object({
    factor: z.enum(prioritizationFactorValues),
    score: z.number().min(0).max(100),
    rationale: shortString(400),
  })
  .strict();

export type PrioritizationFactorScore = z.infer<typeof prioritizationFactorScoreSchema>;

export const prioritizedResearchTaskSchema = z
  .object({
    taskId: shortString(120),
    topic: shortString(200),
    rank: z.number().int().min(1),
    expectedDecisionImpact: z.enum(decisionImpactValues),
    uncertaintyReduction: z.number().min(0).max(100),
    estimatedCostUsd: z.number().min(0).max(1000),
    estimatedTimeHours: z.number().min(0).max(1000),
    valueScore: z.number().min(0).max(100),
    factorScores: z.array(prioritizationFactorScoreSchema).length(prioritizationFactorValues.length),
    explanation: shortString(600),
  })
  .strict();

export type PrioritizedResearchTask = z.infer<typeof prioritizedResearchTaskSchema>;

export const researchPrioritizationResultSchema = z
  .object({
    enabled: z.boolean(),
    prioritizedTasks: z.array(prioritizedResearchTaskSchema).max(100),
    recommendedOrder: z.array(shortString(120)).max(100),
    scoringTrace: z.array(shortString(500)).max(80),
  })
  .strict();

export type ResearchPrioritizationResult = z.infer<typeof researchPrioritizationResultSchema>;

export type PrioritizationTaskCandidate = {
  id?: string;
  topic: string;
  // Trusted completely when supplied (e.g. from Live Research Engine's
  // own expectedDecisionImpact). Defaults to "medium" -- a neutral
  // assumption -- when omitted, never the most lenient or most
  // stringent option.
  expectedDecisionImpact?: DecisionImpact;
  // 0-100: how much resolving this task would reduce ZERINIX's
  // uncertainty about the decision. Defaults to a neutral 50 when
  // omitted -- never assumed to correlate with impact, since that would
  // be an invented relationship, not a real one.
  uncertaintyReduction?: number;
  estimatedCostUsd?: number;
  estimatedTimeHours?: number;
};

export type ResearchPrioritizationInput = {
  tasks: readonly PrioritizationTaskCandidate[];
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_RESEARCH_PRIORITIZATION_ENGINE_ENABLED environment
  // variable.
  enabled?: boolean;
};

const IMPACT_SCORE: Record<DecisionImpact, number> = { low: 25, medium: 50, high: 75, critical: 100 };

const DEFAULT_IMPACT: DecisionImpact = "medium";
const DEFAULT_UNCERTAINTY_REDUCTION = 50;
// Standard per-task baseline used only when the caller supplied no real
// cost/time estimate -- deliberately small, generic, and documented as
// a baseline rather than a task-specific figure.
const DEFAULT_COST_USD = 0.15;
const DEFAULT_TIME_HOURS = 2;

// Bucketed, ascending desirability -- lower cost/time is better, exactly
// mirroring the "documented bucket, never a fabricated number" pattern
// already used by every prior ZERINIX scoring engine (e.g. Evidence
// Quality Scoring's freshness buckets).
function costBucketScore(costUsd: number): number {
  if (costUsd <= 0.1) return 100;
  if (costUsd <= 0.5) return 80;
  if (costUsd <= 2) return 60;
  if (costUsd <= 10) return 35;
  return 15;
}

function timeBucketScore(hours: number): number {
  if (hours <= 1) return 100;
  if (hours <= 4) return 80;
  if (hours <= 8) return 60;
  if (hours <= 24) return 35;
  return 15;
}

function roundClamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const FACTOR_WEIGHT = 1 / prioritizationFactorValues.length;

function buildFactorScores(candidate: PrioritizationTaskCandidate): {
  factorScores: PrioritizationFactorScore[];
  impact: DecisionImpact;
  uncertaintyReduction: number;
  estimatedCostUsd: number;
  estimatedTimeHours: number;
} {
  const impact = candidate.expectedDecisionImpact ?? DEFAULT_IMPACT;
  const uncertaintyReduction = candidate.uncertaintyReduction ?? DEFAULT_UNCERTAINTY_REDUCTION;
  const estimatedCostUsd = candidate.estimatedCostUsd ?? DEFAULT_COST_USD;
  const estimatedTimeHours = candidate.estimatedTimeHours ?? DEFAULT_TIME_HOURS;

  const factorScores: PrioritizationFactorScore[] = [
    {
      factor: "expected_decision_impact",
      score: IMPACT_SCORE[impact],
      rationale:
        candidate.expectedDecisionImpact !== undefined
          ? `Expected decision impact is "${impact}".`
          : `No expected decision impact was supplied; defaulted to "${DEFAULT_IMPACT}".`,
    },
    {
      factor: "uncertainty_reduction",
      score: roundClamp(uncertaintyReduction),
      rationale:
        candidate.uncertaintyReduction !== undefined
          ? `This task is expected to reduce uncertainty by ${uncertaintyReduction} (0-100 scale).`
          : `No uncertainty-reduction estimate was supplied; defaulted to a neutral ${DEFAULT_UNCERTAINTY_REDUCTION}.`,
    },
    {
      factor: "execution_cost",
      score: costBucketScore(estimatedCostUsd),
      rationale:
        candidate.estimatedCostUsd !== undefined
          ? `Estimated execution cost is $${estimatedCostUsd}.`
          : `No cost estimate was supplied; defaulted to the standard per-task baseline of $${DEFAULT_COST_USD}.`,
    },
    {
      factor: "execution_time",
      score: timeBucketScore(estimatedTimeHours),
      rationale:
        candidate.estimatedTimeHours !== undefined
          ? `Estimated execution time is ${estimatedTimeHours} hour(s).`
          : `No time estimate was supplied; defaulted to the standard per-task baseline of ${DEFAULT_TIME_HOURS} hour(s).`,
    },
  ];

  return { factorScores, impact, uncertaintyReduction, estimatedCostUsd, estimatedTimeHours };
}

function disabledResult(): ResearchPrioritizationResult {
  return {
    enabled: false,
    prioritizedTasks: [],
    recommendedOrder: [],
    scoringTrace: [
      `Research Prioritization Engine is disabled (set ${RESEARCH_PRIORITIZATION_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function prioritizeResearchTasks(
  input: ResearchPrioritizationInput = { tasks: [] }
): ResearchPrioritizationResult {
  const enabled = input.enabled ?? isResearchPrioritizationEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const tasks = input.tasks ?? [];
  const scoringTrace: string[] = [`Prioritizing ${tasks.length} candidate research task(s).`];

  const scored = tasks.map((candidate, index) => {
    const taskId = candidate.id?.trim() || `task_${index}`;
    const { factorScores, impact, uncertaintyReduction, estimatedCostUsd, estimatedTimeHours } =
      buildFactorScores(candidate);
    const valueScore = roundClamp(factorScores.reduce((sum, entry) => sum + entry.score * FACTOR_WEIGHT, 0));

    return {
      taskId,
      topic: candidate.topic,
      impact,
      uncertaintyReduction,
      estimatedCostUsd,
      estimatedTimeHours,
      valueScore,
      factorScores,
      originalIndex: index,
    };
  });

  // Stable sort by value score descending; ties keep original input
  // order (Array.prototype.sort is stable), which is the fairest
  // tiebreaker available without inventing a preference between equally
  // valuable tasks.
  scored.sort((a, b) => b.valueScore - a.valueScore);

  const prioritizedTasks: PrioritizedResearchTask[] = scored.map((entry, position) => {
    const rank = position + 1;
    const topDriver = [...entry.factorScores].sort((a, b) => b.score - a.score)[0];
    const explanation = `Ranked #${rank} with a value score of ${entry.valueScore}/100. Strongest contributing factor: ${topDriver.factor} (${topDriver.rationale})`;

    scoringTrace.push(`${entry.taskId}: rank=${rank}, valueScore=${entry.valueScore}.`);

    return {
      taskId: entry.taskId,
      topic: entry.topic,
      rank,
      expectedDecisionImpact: entry.impact,
      uncertaintyReduction: entry.uncertaintyReduction,
      estimatedCostUsd: entry.estimatedCostUsd,
      estimatedTimeHours: entry.estimatedTimeHours,
      valueScore: entry.valueScore,
      factorScores: entry.factorScores,
      explanation,
    };
  });

  return {
    enabled: true,
    prioritizedTasks,
    recommendedOrder: prioritizedTasks.map((task) => task.taskId),
    scoringTrace,
  };
}
