import { z } from "zod";

// ZERINIX Research Execution Planner v1.
//
// Once research tasks have been prioritized (e.g. by the Research
// Prioritization Engine), ZERINIX must turn them into an actually
// executable plan before any live research begins: ordered steps per
// task, real declared dependencies validated and (if circular)
// safely defused, estimated data-source categories, expected outputs
// per step, completion criteria, and one optimized execution sequence
// across every task -- with an explanation of why each task landed
// where it did.
//
// Never fabricates execution steps: every step comes from a small,
// fixed, documented per-complexity-tier template (never an invented,
// task-specific-sounding step); complexity tier is derived from a
// real supplied time estimate via a documented bucket table, or a
// neutral "standard" default when no estimate was supplied; required
// data-source categories are derived from real keyword matches in the
// task's own topic text against a fixed vocabulary, falling back to
// the honest, generic "general_web" category when nothing matches --
// never a specific named source that wasn't actually verified.
// Dependencies are never invented: the ONLY dependencies this engine
// recognizes are ones the caller explicitly declared for a task; this
// engine's own contribution is purely algorithmic -- validating those
// declarations (dropping self-references and references to unknown
// tasks), detecting circular dependencies, and computing a real
// topological execution order from what's left.
//
// Scope (v1, standalone): this module makes no network/AI calls,
// never generates a report, and is not wired into any route, engine,
// PDF generation, UI, or billing. Feature-flagged via
// ZERINIX_RESEARCH_EXECUTION_PLANNER_ENABLED, defaulting to disabled
// (or pass `enabled: true`, primarily for tests) -- when disabled, no
// planning runs at all.

export const complexityTierValues = ["simple", "standard", "complex"] as const;

export type ComplexityTier = (typeof complexityTierValues)[number];

export const executionStepTypeValues = [
  "define_scope",
  "identify_sources",
  "collect_evidence",
  "cross_verify",
  "synthesize_findings",
  "validate_against_decision",
] as const;

export type ExecutionStepType = (typeof executionStepTypeValues)[number];

export const dataSourceTypeValues = [
  "market_research",
  "financial_data",
  "competitor_intelligence",
  "regulatory_filings",
  "customer_data",
  "technical_documentation",
  "general_web",
] as const;

export type DataSourceType = (typeof dataSourceTypeValues)[number];

export const taskDependencyStatusValues = ["enforced", "cyclic_not_enforced"] as const;

export type TaskDependencyStatus = (typeof taskDependencyStatusValues)[number];

export const RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR = "ZERINIX_RESEARCH_EXECUTION_PLANNER_ENABLED";

export function isResearchExecutionPlannerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const taskDependencySchema = z
  .object({
    taskId: shortString(120),
    status: z.enum(taskDependencyStatusValues),
  })
  .strict();

export type TaskDependency = z.infer<typeof taskDependencySchema>;

export const executionStepSchema = z
  .object({
    stepType: z.enum(executionStepTypeValues),
    order: z.number().int().min(1),
    description: shortString(300),
    expectedOutput: shortString(300),
  })
  .strict();

export type ExecutionStep = z.infer<typeof executionStepSchema>;

export const plannedResearchTaskSchema = z
  .object({
    taskId: shortString(120),
    topic: shortString(200),
    sequencePosition: z.number().int().min(1),
    complexityTier: z.enum(complexityTierValues),
    dependencies: z.array(taskDependencySchema).max(50),
    executionSteps: z.array(executionStepSchema).min(1).max(executionStepTypeValues.length),
    requiredDataSourceTypes: z.array(z.enum(dataSourceTypeValues)).min(1).max(dataSourceTypeValues.length),
    completionCriteria: z.array(shortString(300)).min(1).max(10),
    explanation: shortString(700),
  })
  .strict();

export type PlannedResearchTask = z.infer<typeof plannedResearchTaskSchema>;

export const researchExecutionPlanSchema = z
  .object({
    enabled: z.boolean(),
    plannedTasks: z.array(plannedResearchTaskSchema).max(100),
    executionSequence: z.array(shortString(120)).max(100),
    dependencyIssues: z.array(shortString(300)).max(100),
    planningTrace: z.array(shortString(500)).max(120),
  })
  .strict();

export type ResearchExecutionPlan = z.infer<typeof researchExecutionPlanSchema>;

export type ResearchExecutionTaskCandidate = {
  id?: string;
  topic: string;
  // Trusted completely when supplied: real prerequisite relationships
  // already known to the caller. A reference to an unknown taskId, or
  // a self-reference, is dropped rather than fabricated into a real
  // dependency; a reference that would create a circular dependency
  // is detected, reported, and not enforced (see dependencyIssues).
  dependsOnTaskIds?: readonly string[];
  // Optional real signals used only to break ties when multiple tasks
  // are simultaneously free to run -- never used to invent a
  // dependency that wasn't declared. Higher valueScore or lower
  // priorityRank (1 = highest) wins a tie.
  priorityRank?: number;
  valueScore?: number;
  // Real time estimate, if known; used only to pick the documented
  // step-count/complexity tier. Omitted -> neutral "standard" tier.
  estimatedTimeHours?: number;
};

export type ResearchExecutionPlannerInput = {
  tasks: readonly ResearchExecutionTaskCandidate[];
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_RESEARCH_EXECUTION_PLANNER_ENABLED environment
  // variable.
  enabled?: boolean;
};

const DEFAULT_COMPLEXITY_TIER: ComplexityTier = "standard";

// Ascending complexity from a real supplied time estimate -- the same
// "documented bucket, never a fabricated number" pattern used by
// every prior ZERINIX scoring engine.
function resolveComplexityTier(estimatedTimeHours: number | undefined): ComplexityTier {
  if (estimatedTimeHours === undefined) {
    return DEFAULT_COMPLEXITY_TIER;
  }
  if (estimatedTimeHours <= 2) return "simple";
  if (estimatedTimeHours <= 8) return "standard";
  return "complex";
}

const STEP_TEMPLATES: Record<ComplexityTier, readonly ExecutionStepType[]> = {
  simple: ["identify_sources", "collect_evidence"],
  standard: ["define_scope", "identify_sources", "collect_evidence", "synthesize_findings"],
  complex: [
    "define_scope",
    "identify_sources",
    "collect_evidence",
    "cross_verify",
    "synthesize_findings",
    "validate_against_decision",
  ],
};

const STEP_TEMPLATE_DETAILS: Record<ExecutionStepType, { description: string; expectedOutput: string }> = {
  define_scope: {
    description: "Define the precise research question and success criteria for this task.",
    expectedOutput: "A documented research scope and the specific question(s) it must answer.",
  },
  identify_sources: {
    description: "Identify the specific data sources to consult for this task.",
    expectedOutput: "A list of named data sources to query, drawn from the estimated source categories.",
  },
  collect_evidence: {
    description: "Collect raw evidence from the identified sources.",
    expectedOutput: "A set of raw evidence items with source attribution and retrieval date.",
  },
  cross_verify: {
    description: "Cross-verify collected evidence across at least two independent sources.",
    expectedOutput: "A record of which findings are corroborated versus single-source, and any contradictions found.",
  },
  synthesize_findings: {
    description: "Synthesize the collected evidence into a concise finding relevant to the decision.",
    expectedOutput: "A short synthesized finding with supporting citations.",
  },
  validate_against_decision: {
    description:
      "Validate that the synthesized finding actually resolves the uncertainty this task was meant to reduce.",
    expectedOutput: "A confirmation (or documented gap) that the original research question was answered.",
  },
};

// Real, minimum number of independent sources required to consider a
// task's completion criteria met, scaled with complexity -- a
// documented lookup, never invented per task.
const MIN_SOURCES_FOR_TIER: Record<ComplexityTier, number> = { simple: 1, standard: 2, complex: 3 };

// Fixed vocabulary of keyword substrings mapped to a data-source
// category. Matching is a real, deterministic substring check against
// the task's own topic text -- never a guess about what the task
// "probably" needs. A topic that matches nothing gets the honest,
// generic "general_web" category rather than an invented specific one.
const DATA_SOURCE_KEYWORDS: Partial<Record<DataSourceType, readonly string[]>> = {
  market_research: ["market", "tam", "sam", "som", "industry", "demand", "segment", "growth"],
  financial_data: ["revenue", "financial", "cost", "price", "pricing", "margin", "funding", "valuation", "budget"],
  competitor_intelligence: ["competitor", "competition", "rival", "alternative", "market share"],
  regulatory_filings: ["regulat", "compliance", "legal", "law", "policy", "license"],
  customer_data: ["customer", "user", "churn", "retention", "satisfaction", "nps"],
  technical_documentation: ["technical", "architecture", "api", "integration", "technology", "spec"],
};

function estimateDataSourceTypes(topic: string): DataSourceType[] {
  const normalized = topic.toLocaleLowerCase("en-US");
  const matches: DataSourceType[] = [];

  for (const dataSourceType of dataSourceTypeValues) {
    if (dataSourceType === "general_web") continue;
    const keywords = DATA_SOURCE_KEYWORDS[dataSourceType] ?? [];
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      matches.push(dataSourceType);
    }
  }

  return matches.length > 0 ? matches : ["general_web"];
}

function buildExecutionSteps(tier: ComplexityTier): ExecutionStep[] {
  return STEP_TEMPLATES[tier].map((stepType, index) => ({
    stepType,
    order: index + 1,
    description: STEP_TEMPLATE_DETAILS[stepType].description,
    expectedOutput: STEP_TEMPLATE_DETAILS[stepType].expectedOutput,
  }));
}

function buildCompletionCriteria(
  tier: ComplexityTier,
  enforcedDependencyTaskIds: readonly string[]
): string[] {
  const minSources = MIN_SOURCES_FOR_TIER[tier];
  const criteria = [
    `At least ${minSources} independent data source(s) have been consulted.`,
    "All execution steps for this task have produced their expected output.",
    "The synthesized finding directly answers this task's research question with no unresolved contradiction.",
  ];

  if (enforcedDependencyTaskIds.length > 0) {
    criteria.push(`All prerequisite task(s) (${enforcedDependencyTaskIds.join(", ")}) have reached completion.`);
  }

  return criteria;
}

type InternalTask = {
  taskId: string;
  topic: string;
  originalIndex: number;
  priorityRank?: number;
  valueScore?: number;
  complexityTier: ComplexityTier;
  validDependsOn: string[];
};

function priorityCompare(a: InternalTask, b: InternalTask): number {
  const aValue = a.valueScore;
  const bValue = b.valueScore;
  if (aValue !== undefined || bValue !== undefined) {
    const diff = (bValue ?? -Infinity) - (aValue ?? -Infinity);
    if (diff !== 0) return diff;
  }

  const aRank = a.priorityRank;
  const bRank = b.priorityRank;
  if (aRank !== undefined || bRank !== undefined) {
    const diff = (aRank ?? Infinity) - (bRank ?? Infinity);
    if (diff !== 0) return diff;
  }

  return a.originalIndex - b.originalIndex;
}

function priorityBasisText(task: InternalTask): string {
  if (task.valueScore !== undefined) return `value score ${task.valueScore}`;
  if (task.priorityRank !== undefined) return `priority rank ${task.priorityRank}`;
  return "original input order";
}

function scheduleTasks(tasks: InternalTask[]): {
  order: InternalTask[];
  edgeStatus: Map<string, TaskDependencyStatus>;
  dependencyIssues: string[];
} {
  const dependencyIssues: string[] = [];
  const edgeStatus = new Map<string, TaskDependencyStatus>();

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.taskId, task.validDependsOn.length);
    for (const prereqId of task.validDependsOn) {
      edgeStatus.set(`${task.taskId}->${prereqId}`, "enforced");
      const list = dependents.get(prereqId) ?? [];
      list.push(task.taskId);
      dependents.set(prereqId, list);
    }
  }

  const scheduled = new Set<string>();
  const order: InternalTask[] = [];
  let remaining = tasks.slice();

  while (remaining.length > 0) {
    let ready = remaining.filter((task) => (inDegree.get(task.taskId) ?? 0) === 0);

    if (ready.length === 0) {
      // Every remaining task has at least one unresolved dependency,
      // and every such dependency necessarily points at another
      // still-remaining task (any dependency on an already-scheduled
      // task would already have been decremented to 0) -- this is a
      // real circular dependency among exactly this remaining set.
      // Defuse it deterministically: mark every still-pending edge
      // among the remaining tasks as not enforced, report it, and let
      // the whole remaining set become schedulable by priority alone.
      const remainingIds = new Set(remaining.map((task) => task.taskId));
      for (const task of remaining) {
        for (const prereqId of task.validDependsOn) {
          if (remainingIds.has(prereqId) && edgeStatus.get(`${task.taskId}->${prereqId}`) === "enforced") {
            edgeStatus.set(`${task.taskId}->${prereqId}`, "cyclic_not_enforced");
            dependencyIssues.push(
              `A circular dependency was detected: task "${task.taskId}" declared a dependency on "${prereqId}", which (directly or transitively) depends back on "${task.taskId}". This dependency is reported on the task but not enforced in the execution sequence.`
            );
          }
        }
        inDegree.set(task.taskId, 0);
      }
      ready = remaining.slice();
    }

    ready.sort(priorityCompare);
    const next = ready[0];
    order.push(next);
    scheduled.add(next.taskId);
    remaining = remaining.filter((task) => task.taskId !== next.taskId);

    for (const dependentId of dependents.get(next.taskId) ?? []) {
      if (scheduled.has(dependentId)) continue;
      inDegree.set(dependentId, Math.max(0, (inDegree.get(dependentId) ?? 0) - 1));
    }
  }

  return { order, edgeStatus, dependencyIssues };
}

function disabledResult(): ResearchExecutionPlan {
  return {
    enabled: false,
    plannedTasks: [],
    executionSequence: [],
    dependencyIssues: [],
    planningTrace: [
      `Research Execution Planner is disabled (set ${RESEARCH_EXECUTION_PLANNER_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function planResearchExecution(
  input: ResearchExecutionPlannerInput = { tasks: [] }
): ResearchExecutionPlan {
  const enabled = input.enabled ?? isResearchExecutionPlannerEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const candidates = input.tasks ?? [];
  const planningTrace: string[] = [`Planning execution for ${candidates.length} candidate research task(s).`];
  const dependencyIssues: string[] = [];

  const taskIds = candidates.map((candidate, index) => candidate.id?.trim() || `task_${index}`);
  const knownTaskIds = new Set(taskIds);

  const internalTasks: InternalTask[] = candidates.map((candidate, index) => {
    const taskId = taskIds[index];
    const declared = candidate.dependsOnTaskIds ?? [];
    const validDependsOn: string[] = [];

    for (const rawPrereqId of declared) {
      const prereqId = rawPrereqId.trim();
      if (prereqId === taskId) {
        dependencyIssues.push(
          `Task "${taskId}" declared a dependency on itself; the self-reference was ignored.`
        );
        continue;
      }
      if (!knownTaskIds.has(prereqId)) {
        dependencyIssues.push(
          `Task "${taskId}" declared a dependency on unknown task "${prereqId}"; the reference was ignored.`
        );
        continue;
      }
      if (!validDependsOn.includes(prereqId)) {
        validDependsOn.push(prereqId);
      }
    }

    return {
      taskId,
      topic: candidate.topic,
      originalIndex: index,
      priorityRank: candidate.priorityRank,
      valueScore: candidate.valueScore,
      complexityTier: resolveComplexityTier(candidate.estimatedTimeHours),
      validDependsOn,
    };
  });

  const { order, edgeStatus, dependencyIssues: cyclicIssues } = scheduleTasks(internalTasks);
  dependencyIssues.push(...cyclicIssues);

  const plannedTasks: PlannedResearchTask[] = order.map((task, position) => {
    const sequencePosition = position + 1;
    const dependencies: TaskDependency[] = task.validDependsOn.map((prereqId) => ({
      taskId: prereqId,
      status: edgeStatus.get(`${task.taskId}->${prereqId}`) ?? "enforced",
    }));
    const enforcedDependencyIds = dependencies
      .filter((dependency) => dependency.status === "enforced")
      .map((dependency) => dependency.taskId);
    const cyclicDependencyIds = dependencies
      .filter((dependency) => dependency.status === "cyclic_not_enforced")
      .map((dependency) => dependency.taskId);

    const executionSteps = buildExecutionSteps(task.complexityTier);
    const requiredDataSourceTypes = estimateDataSourceTypes(task.topic);
    const completionCriteria = buildCompletionCriteria(task.complexityTier, enforcedDependencyIds);

    let explanation: string;
    if (enforcedDependencyIds.length > 0) {
      explanation = `Scheduled at position ${sequencePosition}, after its prerequisite task(s) (${enforcedDependencyIds.join(", ")}) complete.`;
    } else {
      explanation = `Scheduled at position ${sequencePosition}. No enforced prerequisites; ordered by ${priorityBasisText(task)}.`;
    }
    if (cyclicDependencyIds.length > 0) {
      explanation += ` Note: a declared dependency on ${cyclicDependencyIds.join(", ")} could not be enforced because it is part of a circular dependency, and was ignored for sequencing purposes.`;
    }

    planningTrace.push(`${task.taskId}: sequencePosition=${sequencePosition}, complexityTier=${task.complexityTier}.`);

    return {
      taskId: task.taskId,
      topic: task.topic,
      sequencePosition,
      complexityTier: task.complexityTier,
      dependencies,
      executionSteps,
      requiredDataSourceTypes,
      completionCriteria,
      explanation,
    };
  });

  return {
    enabled: true,
    plannedTasks,
    executionSequence: plannedTasks.map((task) => task.taskId),
    dependencyIssues,
    planningTrace,
  };
}
