import { z } from "zod";
import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
} from "../ai/executive-decision-system.ts";
import { strategicDecisionMemoSchema, type StrategicDecisionMemo } from "../ai/strategic-decision-memo.ts";
import { executiveBriefSchema, type ExecutiveBrief } from "../ai/executive-brief-generator.ts";
import {
  executiveReportQualityValidationResultSchema,
  type ExecutiveReportQualityValidationResult,
  type ReportQualityIssue,
} from "./executive-report-quality-validator.ts";
import {
  reportConsistencyCheckResultSchema,
  type ReportConsistencyCheckResult,
  type ConsistencyIssue,
} from "./report-consistency-checker.ts";

// ZERINIX Explainability Engine v1.
//
// Explains WHY the Executive Decision System reached each of its
// conclusions -- one structured explanation per real recommendation,
// per real risk, per real opportunity, plus exactly one for the
// overall verdict and exactly one for the aggregate confidence
// assessment. This is distinct from, and complementary to, the
// Report Audit Trail Generator (which records provenance PER
// CATEGORY: who produced it, when, how many issues) -- this module
// instead explains WHY each INDIVIDUAL conclusion was reached: its
// real reasoning trace, which real evidence/conflict/research-task IDs
// it traces back to, which real engines participated, which real
// assumptions it depends on, and what the Quality Validator /
// Consistency Checker already found about conclusions of that kind.
//
// This module makes no network/AI calls -- it NEVER invokes an LLM to
// generate an explanation. Every explanation is built entirely from
// real, already-computed structured output: the Strategic Decision
// Memo's and Executive Brief's own fields, and the Business
// Intelligence Orchestrator's own sub-engine results embedded in the
// Executive Decision Package. Reasoning sentences are fixed,
// deterministic templates that quote real values (a real signal, a
// real score, a real factor name, a real conflict severity) -- never
// freeform generated prose.
//
// Evidence IDs are cited only where a genuine, structural ID-bearing
// link exists in this codebase, and are honestly empty otherwise --
// never a fabricated ID:
//   - A risk built from an unresolved evidence conflict (Strategic
//     Decision Memo / Executive Brief both format these as
//     "Unresolved evidence conflict [severity]: reason") is matched
//     back, by literal severity+reason equality, to the real
//     Conflict Detection Engine conflict it came from, citing that
//     conflict's own real evidence item IDs (`a`, `b`).
//   - A recommendation sourced from the Business Intelligence
//     Orchestrator's top prioritized research task is matched back,
//     by literal topic equality, to that real task's own `taskId`.
//   - Every other conclusion (plain key risks, executive-advisory
//     opportunities, the holistic verdict, the holistic confidence
//     number) has no such per-item ID anywhere upstream in this
//     codebase, so `evidenceIds` is honestly empty for those --
//     never invented.
//
// "Assumptions applied" for a recommendation is the real subset of
// its own already-computed `supportingEvidence` citations that are
// also literally present in the real assumptions list (never a
// guessed link); for a risk/opportunity it is the real assumptions
// whose text is literally contained within that risk/opportunity's
// own text (the same literal-containment grounding
// strategic-decision-memo.ts/executive-brief-generator.ts already use
// for their own citations); for the holistic verdict/confidence it is
// the full real assumptions list, since those two conclusions
// genuinely depend on all of them collectively.
//
// "validation"/"consistency" per item report whether the Executive
// Report Quality Validator / Report Consistency Checker's own,
// already-computed issues (never re-run here) include any issue
// concerning conclusions of that TYPE -- the checkers do not have
// per-item granularity, so every conclusion of the same type shares
// the same validation/consistency outcome; this is an honest
// reflection of what the checkers actually inspect, not invented
// per-item precision.
//
// Scope (v1): this module does not modify report generation, PDF
// generation, UI, billing, authentication, or routing, and changes no
// existing API/response contract -- the result is attached as an
// additive, optional reports.metadata field (see
// app/lib/report-jobs/worker.ts). Feature-flagged via
// ZERINIX_EXPLAINABILITY_ENGINE_ENABLED, defaulting to disabled (or
// pass `enabled: true`, primarily for tests) -- when disabled, no
// explanation is ever generated.

export const EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR = "ZERINIX_EXPLAINABILITY_ENGINE_ENABLED";

export function isExplainabilityEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const explanationItemTypeValues = ["recommendation", "verdict", "risk", "opportunity", "confidence"] as const;

export type ExplanationItemType = (typeof explanationItemTypeValues)[number];

export const explanationValidationOutcomeSchema = z
  .object({
    validated: z.boolean(),
    passed: z.boolean().nullable(),
    issueCount: z.number().int().min(0),
  })
  .strict();

export const explanationConsistencyOutcomeSchema = z
  .object({
    checked: z.boolean(),
    consistent: z.boolean().nullable(),
    issueCount: z.number().int().min(0),
  })
  .strict();

export const explanationItemSchema = z
  .object({
    id: shortString(80),
    type: z.enum(explanationItemTypeValues),
    // The real conclusion text this explanation is FOR, quoted
    // verbatim -- unlike the Audit Trail, quoting it here is
    // necessary and safe: it is already the report's own visible
    // content (a real risk/opportunity/recommendation statement),
    // never a prompt, raw model transcript, or secret.
    statement: shortString(500),
    reasoning: z.array(shortString(400)).max(10),
    evidenceIds: z.array(shortString(120)).max(50),
    engines: z.array(shortString(80)).max(10),
    assumptions: z.array(shortString(400)).max(10),
    validation: explanationValidationOutcomeSchema,
    consistency: explanationConsistencyOutcomeSchema,
  })
  .strict();

export type ExplanationItem = z.infer<typeof explanationItemSchema>;

export const explainabilityEngineResultSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, generation always
    // genuinely runs against whatever real artifacts were supplied.
    generated: z.boolean(),
    generatedAt: z.string().trim().min(1),
    engineVersion: shortString(80),
    explanations: z.array(explanationItemSchema).max(120),
    explainabilityTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ExplainabilityEngineResult = z.infer<typeof explainabilityEngineResultSchema>;

export type ExplainabilityEngineInput = {
  // The same, already-computed Executive Decision System objects
  // already carried on the request payload elsewhere in this
  // pipeline. Untyped `unknown` on purpose -- each is validated
  // against its own real schema before anything is read from it;
  // omitted or invalid simply narrows which conclusions have a real
  // basis for an explanation.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  // The already-computed results from the two validation modules that
  // run earlier in the pipeline (see worker.ts). Untyped `unknown` on
  // purpose -- validated against their own real schemas before
  // anything is read from them; omitted or invalid simply means
  // validation/consistency honestly report "no data" instead of
  // guessing.
  qualityValidation?: unknown;
  consistencyCheck?: unknown;
  // Milliseconds since epoch, primarily for deterministic tests; when
  // omitted, falls back to the real Date.now().
  now?: number;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_EXPLAINABILITY_ENGINE_ENABLED environment variable.
  enabled?: boolean;
};

const ENGINE_VERSION = "explainability-engine@1";

const ENGINE = {
  executiveDecisionSystem: "executive-decision-system@1",
  businessIntelligenceOrchestrator: "business-intelligence-orchestrator@1",
  strategicDecisionMemo: "strategic-decision-memo@1",
  executiveBriefGenerator: "executive-brief-generator@1",
  conflictDetectionEngine: "conflict-detection-engine@1",
  researchPrioritizationEngine: "research-prioritization-engine@1",
} as const;

const CONFLICT_RISK_PATTERN = /^Unresolved evidence conflict \[(\w+)\]: (.+)$/;

type BusinessIntelligence = NonNullable<ExecutiveDecisionPackage["businessIntelligence"]>;

type BuildContext = {
  executiveDecisionPackage: ExecutiveDecisionPackage | null;
  businessIntelligence: BusinessIntelligence | null;
  memo: StrategicDecisionMemo | null;
  brief: ExecutiveBrief | null;
  qualityValidation: ExecutiveReportQualityValidationResult | null;
  consistencyCheck: ReportConsistencyCheckResult | null;
};

function disabledResult(generatedAt: string): ExplainabilityEngineResult {
  return {
    enabled: false,
    generated: false,
    generatedAt,
    engineVersion: ENGINE_VERSION,
    explanations: [],
    explainabilityTrace: [
      `Explainability Engine is disabled (set ${EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

function isQualityIssueForType(type: ExplanationItemType, issue: ReportQualityIssue): boolean {
  switch (type) {
    case "confidence":
      return issue.category === "inconsistent_confidence";
    case "risk":
      return issue.field !== null && /^risks?$/i.test(issue.field);
    case "opportunity":
      return issue.field !== null && /opportunit/i.test(issue.field);
    case "recommendation":
      return issue.field !== null && /recommend/i.test(issue.field);
    case "verdict":
      return false;
    default:
      return false;
  }
}

function attributeQualityIssuesForType(
  type: ExplanationItemType,
  qualityValidation: ExecutiveReportQualityValidationResult | null
): ExplanationItem["validation"] {
  if (!qualityValidation || !qualityValidation.validated) {
    return { validated: false, passed: null, issueCount: 0 };
  }
  const attributed = qualityValidation.issues.filter((issue) => isQualityIssueForType(type, issue));
  const blocking = attributed.filter((issue) => issue.severity === "critical" || issue.severity === "error");
  return { validated: true, passed: blocking.length === 0, issueCount: attributed.length };
}

function isConsistencyIssueForType(type: ExplanationItemType, issue: ConsistencyIssue): boolean {
  const message = issue.message.toLowerCase();
  switch (type) {
    case "confidence":
      return (
        issue.type === "confidence_score_mismatch" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("confidence"))
      );
    case "risk":
      return (
        issue.type === "risk_opportunity_contradiction" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("risk"))
      );
    case "opportunity":
      return (
        issue.type === "risk_opportunity_contradiction" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("opportunit"))
      );
    case "recommendation":
      return (
        issue.type === "evidence_recommendation_mismatch" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("recommend"))
      );
    case "verdict":
      return issue.type === "verdict_recommendation_mismatch" || issue.type === "executive_summary_verdict_mismatch";
    default:
      return false;
  }
}

function attributeConsistencyIssuesForType(
  type: ExplanationItemType,
  consistencyCheck: ReportConsistencyCheckResult | null
): ExplanationItem["consistency"] {
  if (!consistencyCheck || !consistencyCheck.checked) {
    return { checked: false, consistent: null, issueCount: 0 };
  }
  const attributed = consistencyCheck.issues.filter((issue) => isConsistencyIssueForType(type, issue));
  const blocking = attributed.filter((issue) => issue.severity === "critical" || issue.severity === "error");
  return { checked: true, consistent: blocking.length === 0, issueCount: attributed.length };
}

function buildRecommendationItems(ctx: BuildContext): ExplanationItem[] {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.recommendedActions.length > 0
      ? "memo"
      : ctx.brief && ctx.brief.immediateNextActions.length > 0
        ? "brief"
        : null;
  if (!source) {
    return [];
  }
  const actions = source === "memo" ? ctx.memo!.recommendedActions : ctx.brief!.immediateNextActions;
  const assumptions = source === "memo" ? ctx.memo!.assumptions : ctx.brief!.supportingEvidenceSummary.assumptions;
  const prioritizedTasks = ctx.businessIntelligence?.researchPrioritization?.prioritizedTasks ?? [];
  const baseEngines: string[] =
    source === "memo"
      ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
      : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem];
  const validation = attributeQualityIssuesForType("recommendation", ctx.qualityValidation);
  const consistency = attributeConsistencyIssuesForType("recommendation", ctx.consistencyCheck);

  return actions.map((action, index) => {
    const appliedAssumptions = action.supportingEvidence.filter((evidence) => assumptions.includes(evidence));
    const matchedTask =
      action.source === "top_research_priority"
        ? prioritizedTasks.find((task) => task.topic === action.action)
        : undefined;
    const reasoning: string[] = [
      action.source === "top_research_priority"
        ? "Sourced from the Business Intelligence Orchestrator's top prioritized research task."
        : "Sourced from the Executive Decision Brief's immediate next actions.",
      `Cites ${action.supportingEvidence.length} supporting evidence string(s), of which ${appliedAssumptions.length} are real assumptions.`,
    ];
    if (matchedTask) {
      reasoning.push(`Traces to prioritized research task "${matchedTask.taskId}" (rank ${matchedTask.rank}).`);
    }
    return {
      id: `recommendation-${index}`,
      type: "recommendation",
      statement: action.action,
      reasoning,
      evidenceIds: matchedTask ? [matchedTask.taskId] : [],
      engines: matchedTask ? [...baseEngines, ENGINE.researchPrioritizationEngine] : [...baseEngines],
      assumptions: appliedAssumptions,
      validation,
      consistency,
    };
  });
}

function buildRiskItems(ctx: BuildContext): ExplanationItem[] {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.risks.length > 0 ? "memo" : ctx.brief && ctx.brief.criticalRisks.length > 0 ? "brief" : null;
  if (!source) {
    return [];
  }
  const risks = source === "memo" ? ctx.memo!.risks : ctx.brief!.criticalRisks;
  const assumptions = source === "memo" ? ctx.memo!.assumptions : ctx.brief!.supportingEvidenceSummary.assumptions;
  const conflicts = ctx.businessIntelligence?.conflictDetection?.conflicts ?? [];
  const baseEngines: string[] =
    source === "memo"
      ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
      : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem];
  const validation = attributeQualityIssuesForType("risk", ctx.qualityValidation);
  const consistency = attributeConsistencyIssuesForType("risk", ctx.consistencyCheck);

  return risks.map((risk, index) => {
    const match = risk.match(CONFLICT_RISK_PATTERN);
    const matchedConflict = match
      ? conflicts.find((conflict) => conflict.severity === match[1] && conflict.reason === match[2])
      : undefined;
    const appliedAssumptions = assumptions.filter((assumption) => risk.includes(assumption));
    const reasoning: string[] = matchedConflict
      ? [
          `Derived from an unresolved evidence conflict (severity "${matchedConflict.severity}", topic "${matchedConflict.topicId}") between evidence items "${matchedConflict.a}" and "${matchedConflict.b}".`,
        ]
      : ["Derived from the Executive Decision Brief's own key risks."];
    return {
      id: `risk-${index}`,
      type: "risk",
      statement: risk,
      reasoning,
      evidenceIds: matchedConflict ? [matchedConflict.a, matchedConflict.b] : [],
      engines: matchedConflict ? [...baseEngines, ENGINE.conflictDetectionEngine] : [...baseEngines],
      assumptions: appliedAssumptions,
      validation,
      consistency,
    };
  });
}

function buildOpportunityItems(ctx: BuildContext): ExplanationItem[] {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.opportunities.length > 0
      ? "memo"
      : ctx.brief && ctx.brief.strategicOpportunities.length > 0
        ? "brief"
        : null;
  if (!source) {
    return [];
  }
  const opportunities = source === "memo" ? ctx.memo!.opportunities : ctx.brief!.strategicOpportunities;
  const assumptions = source === "memo" ? ctx.memo!.assumptions : ctx.brief!.supportingEvidenceSummary.assumptions;
  const baseEngines: string[] =
    source === "memo"
      ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
      : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem];
  const validation = attributeQualityIssuesForType("opportunity", ctx.qualityValidation);
  const consistency = attributeConsistencyIssuesForType("opportunity", ctx.consistencyCheck);

  return opportunities.map((opportunity, index) => ({
    id: `opportunity-${index}`,
    type: "opportunity",
    statement: opportunity,
    reasoning: ["Derived from the Executive Decision Brief's executive advisory opportunities."],
    evidenceIds: [],
    engines: [...baseEngines],
    assumptions: assumptions.filter((assumption) => opportunity.includes(assumption)),
    validation,
    consistency,
  }));
}

function buildVerdictItems(ctx: BuildContext): ExplanationItem[] {
  if (!ctx.businessIntelligence) {
    return [];
  }
  const signal = ctx.businessIntelligence.executiveDecisionSignal;
  const status = ctx.executiveDecisionPackage?.executiveDecisionBrief?.recommendationStatus ?? null;
  const conflictDetection = ctx.businessIntelligence.conflictDetection;
  const corroboration = ctx.businessIntelligence.evidenceCorroboration;

  const reasoning: string[] = [`Business Intelligence Orchestrator's executive decision signal: "${signal}".`];
  if (status) {
    reasoning.push(`Executive Decision Brief's recommendation status: "${status}".`);
  }
  if (conflictDetection?.overallSeverity) {
    reasoning.push(
      `Conflict Detection Engine found "${conflictDetection.overallSeverity}"-severity unresolved conflict(s) among the evidence.`
    );
  }
  if (corroboration && corroboration.conclusions.length > 0) {
    reasoning.push(
      `Evidence Corroboration Engine assessed ${corroboration.conclusions.length} conclusion(s): ${corroboration.multiSourceConclusionIds.length} multi-source, ${corroboration.singleSourceConclusionIds.length} single-source, ${corroboration.unsupportedConclusionIds.length} unsupported.`
    );
  }

  const engines: string[] = [ENGINE.businessIntelligenceOrchestrator, ENGINE.executiveDecisionSystem];
  if (conflictDetection && conflictDetection.conflicts.length > 0) {
    engines.push(ENGINE.conflictDetectionEngine);
  }

  const assumptions = ctx.memo?.assumptions ?? ctx.brief?.supportingEvidenceSummary.assumptions ?? [];

  return [
    {
      id: "verdict",
      type: "verdict",
      statement: status
        ? `Executive decision signal: "${signal}"; recommendation status: "${status}".`
        : `Executive decision signal: "${signal}".`,
      reasoning: reasoning.slice(0, 10),
      evidenceIds: [],
      engines,
      assumptions,
      validation: attributeQualityIssuesForType("verdict", ctx.qualityValidation),
      consistency: attributeConsistencyIssuesForType("verdict", ctx.consistencyCheck),
    },
  ];
}

function buildConfidenceItems(ctx: BuildContext): ExplanationItem[] {
  let value: number | null = null;
  let method: "memo" | "brief" | "businessIntelligence" | null = null;

  if (ctx.memo) {
    value = ctx.memo.confidence.aggregateConfidence;
    method = "memo";
  } else if (ctx.brief) {
    value = ctx.brief.confidenceAssessment.aggregateConfidence;
    method = "brief";
  } else if (ctx.businessIntelligence) {
    value = ctx.businessIntelligence.aggregateConfidence;
    method = "businessIntelligence";
  }
  if (method === null) {
    return [];
  }

  const drivers =
    method === "memo"
      ? ctx.memo!.confidence.drivers
      : method === "brief"
        ? ctx.brief!.confidenceAssessment.drivers
        : (ctx.businessIntelligence!.confidence?.confidenceDrivers ?? []);
  const penalties =
    method === "memo"
      ? ctx.memo!.confidence.penalties
      : method === "brief"
        ? ctx.brief!.confidenceAssessment.penalties
        : (ctx.businessIntelligence!.confidence?.confidencePenalties ?? []);

  const reasoning: string[] = [`Aggregate confidence ${value}/100 computed by the Confidence Engine.`];
  for (const driver of drivers.slice(0, 4)) {
    reasoning.push(`Driver "${driver.factor}": ${driver.description}`);
  }
  for (const penalty of penalties.slice(0, 3)) {
    reasoning.push(`Penalty "${penalty.factor}" (-${penalty.impact}): ${penalty.description}`);
  }

  const engines: string[] =
    method === "businessIntelligence"
      ? [ENGINE.businessIntelligenceOrchestrator, ENGINE.executiveDecisionSystem]
      : method === "memo"
        ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem, ENGINE.businessIntelligenceOrchestrator]
        : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem, ENGINE.businessIntelligenceOrchestrator];

  const assumptions = ctx.memo?.assumptions ?? ctx.brief?.supportingEvidenceSummary.assumptions ?? [];

  return [
    {
      id: "confidence",
      type: "confidence",
      statement: `Aggregate confidence: ${value}/100.`,
      reasoning: reasoning.slice(0, 10),
      evidenceIds: [],
      engines,
      assumptions,
      validation: attributeQualityIssuesForType("confidence", ctx.qualityValidation),
      consistency: attributeConsistencyIssuesForType("confidence", ctx.consistencyCheck),
    },
  ];
}

export function generateExplainabilityReport(
  input: ExplainabilityEngineInput = {}
): ExplainabilityEngineResult {
  const generatedAt = new Date(input.now ?? Date.now()).toISOString();
  const enabled = input.enabled ?? isExplainabilityEngineEnabled();
  if (!enabled) {
    return disabledResult(generatedAt);
  }

  const packageParsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  const executiveDecisionPackage = packageParsed.success ? packageParsed.data : null;
  const businessIntelligence = executiveDecisionPackage?.businessIntelligence ?? null;

  const memoParsed = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = memoParsed.success && memoParsed.data.generated ? memoParsed.data : null;

  const briefParsed = executiveBriefSchema.safeParse(input.executiveBrief);
  const brief = briefParsed.success && briefParsed.data.generated ? briefParsed.data : null;

  const qualityParsed = executiveReportQualityValidationResultSchema.safeParse(input.qualityValidation);
  const qualityValidation = qualityParsed.success ? qualityParsed.data : null;

  const consistencyParsed = reportConsistencyCheckResultSchema.safeParse(input.consistencyCheck);
  const consistencyCheck = consistencyParsed.success ? consistencyParsed.data : null;

  const ctx: BuildContext = {
    executiveDecisionPackage,
    businessIntelligence,
    memo,
    brief,
    qualityValidation,
    consistencyCheck,
  };

  const explanations: ExplanationItem[] = [
    ...buildRecommendationItems(ctx),
    ...buildVerdictItems(ctx),
    ...buildRiskItems(ctx),
    ...buildOpportunityItems(ctx),
    ...buildConfidenceItems(ctx),
  ];

  const explainabilityTrace: string[] = [
    `Generated ${explanations.length} explanation(s) from real, already-computed Executive Decision System output.`,
    `Real inputs available: executiveDecisionPackage=${Boolean(executiveDecisionPackage)}, strategicDecisionMemo=${Boolean(memo)}, executiveBrief=${Boolean(brief)}, qualityValidation=${Boolean(qualityValidation)}, consistencyCheck=${Boolean(consistencyCheck)}.`,
  ];

  return {
    enabled: true,
    generated: true,
    generatedAt,
    engineVersion: ENGINE_VERSION,
    explanations,
    explainabilityTrace,
  };
}
