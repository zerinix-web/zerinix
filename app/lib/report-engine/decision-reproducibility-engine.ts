import { z } from "zod";
import { createHash } from "node:crypto";
import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
  EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR,
} from "../ai/executive-decision-system.ts";
import {
  strategicDecisionMemoSchema,
  type StrategicDecisionMemo,
  STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR,
} from "../ai/strategic-decision-memo.ts";
import {
  executiveBriefSchema,
  type ExecutiveBrief,
  EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR,
} from "../ai/executive-brief-generator.ts";
import { EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR } from "./executive-report-quality-validator.ts";
import { REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR } from "./report-consistency-checker.ts";
import { reportAuditTrailResultSchema, type ReportAuditTrailResult, REPORT_AUDIT_TRAIL_ENABLED_ENV_VAR } from "./report-audit-trail.ts";
import {
  explainabilityEngineResultSchema,
  type ExplainabilityEngineResult,
  EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR,
} from "./explainability-engine.ts";

// ZERINIX Decision Reproducibility Engine v1.
//
// Given the same real, already-computed structured Executive Decision
// System output (executiveDecisionPackage / strategicDecisionMemo /
// executiveBrief), the same real engine versions, the same real
// evidence set, and the same real configuration (which ZERINIX flags
// are active), this module deterministically produces a
// reproducibility fingerprint -- a SHA-256 hash, computed with
// Node's built-in `crypto` module, over a canonical (key-sorted)
// serialization of exactly those four real inputs -- plus real
// execution metadata describing what went into it.
//
// This module makes no network/AI calls and NEVER re-runs Executive
// Decision System, Strategic Decision Memo, Executive Brief, or any
// engine beneath them -- doing so would violate this pipeline's own
// "exactly once per request" guarantee for expensive/stateful work
// (see app/lib/report-jobs/worker.ts). Instead, "given the same
// inputs it must deterministically reproduce the same output" is
// verified two ways, both without any duplicate expensive execution:
//   1. In-process self-check: this module's own four canonicalization
//      passes (inputs, engine versions, configuration, output) are
//      each independently run TWICE against the SAME already-computed
//      real data before returning, and must produce identical hashes
//      -- a real, cheap (pure, no I/O) guard against accidental
//      non-determinism inside this module's own hashing (e.g. Set/Map
//      iteration order, or any hidden clock/randomness).
//   2. `compareReproducibilityRecords`: an exported, standalone, pure
//      comparison function for TWO already-generated records (e.g.
//      from a genuinely separate execution, a retry, or a manual
//      reproducibility audit run outside this pipeline) -- it detects
//      and reports exactly which of the four real components
//      diverged, never guessing at a cause.
//
// Integration with the Audit Trail / Explainability pipeline: the
// real, already-computed Report Audit Trail Generator and
// Explainability Engine results (when supplied) are folded into the
// engine-versions component (their own real `pipelineVersion` /
// `engineVersion` fields) so the fingerprint is sensitive to changes
// in either of those two modules' own output too, not just the
// Executive Decision System artifacts alone -- a genuine part of the
// reproducibility surface, not fabricated.
//
// Scope (v1): this module does not modify report generation, PDF
// generation, UI, billing, authentication, or routing, and changes no
// existing API/response contract -- the result is attached as an
// additive, optional reports.metadata field (see
// app/lib/report-jobs/worker.ts). Feature-flagged via
// ZERINIX_DECISION_REPRODUCIBILITY_ENGINE_ENABLED, defaulting to
// disabled (or pass `enabled: true`, primarily for tests) -- when
// disabled, no fingerprint is ever generated.

export const DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR =
  "ZERINIX_DECISION_REPRODUCIBILITY_ENGINE_ENABLED";

export function isDecisionReproducibilityEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);
const hexHash = () => z.string().trim().length(64);

export const reproducibilityComponentNameValues = ["inputs", "engineVersions", "configuration", "output"] as const;

export type ReproducibilityComponentName = (typeof reproducibilityComponentNameValues)[number];

export const reproducibilityComponentHashSchema = z
  .object({
    component: z.enum(reproducibilityComponentNameValues),
    hash: hexHash(),
    itemCount: z.number().int().min(0),
  })
  .strict();

export type ReproducibilityComponentHash = z.infer<typeof reproducibilityComponentHashSchema>;

export const reproducibilityExecutionMetadataSchema = z
  .object({
    generatedAt: z.string().trim().min(1),
    engineVersions: z.array(shortString(80)).max(20),
    activeFeatureFlags: z.array(shortString(80)).max(20),
    auditTrailVersion: shortString(80).nullable(),
    explainabilityEngineVersion: shortString(80).nullable(),
  })
  .strict();

export type ReproducibilityExecutionMetadata = z.infer<typeof reproducibilityExecutionMetadataSchema>;

export const reproducibilityStatusValues = ["fingerprinted", "insufficient_data"] as const;

export type ReproducibilityStatus = (typeof reproducibilityStatusValues)[number];

export const reproducibilityRecordSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, generation always
    // genuinely runs, even if it lands on "insufficient_data".
    generated: z.boolean(),
    status: z.enum(reproducibilityStatusValues).nullable(),
    fingerprint: hexHash().nullable(),
    componentHashes: z.array(reproducibilityComponentHashSchema).max(reproducibilityComponentNameValues.length),
    // A real, cheap, in-process double-computation guard -- see file
    // header. Null only when disabled or when there was nothing real
    // to fingerprint at all.
    selfCheckPassed: z.boolean().nullable(),
    executionMetadata: reproducibilityExecutionMetadataSchema.nullable(),
    reproducibilityTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ReproducibilityRecord = z.infer<typeof reproducibilityRecordSchema>;

export const reproducibilityDivergenceReportSchema = z
  .object({
    // False when either supplied record has no real fingerprint to
    // compare (disabled or insufficient data on either side) --
    // "nothing meaningful was compared", distinct from "compared and
    // found reproducible".
    compared: z.boolean(),
    reproducible: z.boolean(),
    divergentComponents: z
      .array(z.enum([...reproducibilityComponentNameValues, "fingerprint"] as const))
      .max(reproducibilityComponentNameValues.length + 1),
    details: z.array(shortString(300)).max(20),
  })
  .strict();

export type ReproducibilityDivergenceReport = z.infer<typeof reproducibilityDivergenceReportSchema>;

export type DecisionReproducibilityEngineInput = {
  // The same, already-computed Executive Decision System objects
  // already carried on the request payload elsewhere in this
  // pipeline. Untyped `unknown` on purpose -- each is validated
  // against its own real schema before anything is read from it.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  // The already-computed results from the Report Audit Trail
  // Generator and Explainability Engine, which run earlier in the
  // pipeline (see worker.ts). Untyped `unknown` on purpose -- omitted
  // or invalid simply narrows the engine-versions component.
  auditTrail?: unknown;
  explainability?: unknown;
  // Milliseconds since epoch, primarily for deterministic tests; when
  // omitted, falls back to the real Date.now().
  now?: number;
  // Which real ZERINIX_*_ENABLED flags are active, primarily for
  // deterministic tests; when omitted, falls back to the real
  // process.env, matching every isXEnabled(env = process.env)
  // function elsewhere in this codebase.
  env?: Record<string, string | undefined>;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_DECISION_REPRODUCIBILITY_ENGINE_ENABLED environment
  // variable.
  enabled?: boolean;
};

const ENGINE_VERSION = "decision-reproducibility-engine@1";

const ENGINE = {
  executiveDecisionSystem: "executive-decision-system@1",
  businessIntelligenceOrchestrator: "business-intelligence-orchestrator@1",
  strategicDecisionMemo: "strategic-decision-memo@1",
  executiveBriefGenerator: "executive-brief-generator@1",
} as const;

const RELEVANT_FLAG_VARS: readonly string[] = [
  EXECUTIVE_DECISION_SYSTEM_ENABLED_ENV_VAR,
  STRATEGIC_DECISION_MEMO_ENABLED_ENV_VAR,
  EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR,
  EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR,
  REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR,
  REPORT_AUDIT_TRAIL_ENABLED_ENV_VAR,
  EXPLAINABILITY_ENGINE_ENABLED_ENV_VAR,
  DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR,
];

type BusinessIntelligence = NonNullable<ExecutiveDecisionPackage["businessIntelligence"]>;

type BuildContext = {
  executiveDecisionPackage: ExecutiveDecisionPackage | null;
  businessIntelligence: BusinessIntelligence | null;
  memo: StrategicDecisionMemo | null;
  brief: ExecutiveBrief | null;
  auditTrail: ReportAuditTrailResult | null;
  explainability: ExplainabilityEngineResult | null;
  env: Record<string, string | undefined>;
};

function disabledResult(): ReproducibilityRecord {
  return {
    enabled: false,
    generated: false,
    status: null,
    fingerprint: null,
    componentHashes: [],
    selfCheckPassed: null,
    executionMetadata: null,
    reproducibilityTrace: [
      `Decision Reproducibility Engine is disabled (set ${DECISION_REPRODUCIBILITY_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

// Deterministic, key-sorted serialization -- object key order never
// affects the resulting hash; array order is preserved because, for
// this module's payloads, array order is either genuinely meaningful
// real output content (e.g. the ordered list of recommendations) or
// has already been explicitly sorted by the caller before reaching
// here (e.g. the "inputs" component, a real set, sorts first).
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashComponent(
  component: ReproducibilityComponentName,
  payload: unknown,
  itemCount: number
): ReproducibilityComponentHash {
  return { component, hash: sha256Hex(stableStringify(payload)), itemCount };
}

function buildInputsComponent(ctx: BuildContext): ReproducibilityComponentHash {
  const evidenceTrace = [...(ctx.executiveDecisionPackage?.decision.evidenceTrace ?? [])].sort();
  const itemScores = [...(ctx.businessIntelligence?.evidenceQuality?.itemScores ?? [])]
    .map((item) => ({ id: item.id, overallScore: item.overallScore }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return hashComponent("inputs", { evidenceTrace, itemScores }, evidenceTrace.length + itemScores.length);
}

function buildEngineVersionsList(ctx: BuildContext): string[] {
  const versions = new Set<string>([ENGINE_VERSION]);
  if (ctx.executiveDecisionPackage) versions.add(ENGINE.executiveDecisionSystem);
  if (ctx.businessIntelligence) versions.add(ENGINE.businessIntelligenceOrchestrator);
  if (ctx.memo) versions.add(ENGINE.strategicDecisionMemo);
  if (ctx.brief) versions.add(ENGINE.executiveBriefGenerator);
  if (ctx.auditTrail) versions.add(ctx.auditTrail.pipelineVersion);
  if (ctx.explainability) versions.add(ctx.explainability.engineVersion);
  return [...versions].sort();
}

function buildEngineVersionsComponent(ctx: BuildContext): ReproducibilityComponentHash {
  const sorted = buildEngineVersionsList(ctx);
  return hashComponent("engineVersions", sorted, sorted.length);
}

function buildConfigurationComponent(ctx: BuildContext): ReproducibilityComponentHash {
  const active = RELEVANT_FLAG_VARS.filter((name) => ctx.env[name] === "true").sort();
  return hashComponent("configuration", active, active.length);
}

function buildOutputComponent(ctx: BuildContext): ReproducibilityComponentHash {
  const signal = ctx.businessIntelligence?.executiveDecisionSignal ?? null;
  const status = ctx.executiveDecisionPackage?.recommendationStatus ?? null;
  const confidence =
    ctx.memo?.confidence.aggregateConfidence ??
    ctx.brief?.confidenceAssessment.aggregateConfidence ??
    ctx.businessIntelligence?.aggregateConfidence ??
    null;
  const risks = ctx.memo?.risks ?? ctx.brief?.criticalRisks ?? [];
  const opportunities = ctx.memo?.opportunities ?? ctx.brief?.strategicOpportunities ?? [];
  const recommendations = (ctx.memo?.recommendedActions ?? ctx.brief?.immediateNextActions ?? []).map(
    (action) => action.action
  );
  const verifiedFacts = ctx.memo?.verifiedFacts ?? ctx.brief?.supportingEvidenceSummary.verifiedFacts ?? [];
  const assumptions = ctx.memo?.assumptions ?? ctx.brief?.supportingEvidenceSummary.assumptions ?? [];

  const payload = { signal, status, confidence, risks, opportunities, recommendations, verifiedFacts, assumptions };
  const itemCount =
    risks.length +
    opportunities.length +
    recommendations.length +
    verifiedFacts.length +
    assumptions.length +
    (signal !== null ? 1 : 0) +
    (confidence !== null ? 1 : 0);
  return hashComponent("output", payload, itemCount);
}

function computeComponents(ctx: BuildContext): ReproducibilityComponentHash[] {
  return [
    buildInputsComponent(ctx),
    buildEngineVersionsComponent(ctx),
    buildConfigurationComponent(ctx),
    buildOutputComponent(ctx),
  ];
}

function componentsEqual(a: readonly ReproducibilityComponentHash[], b: readonly ReproducibilityComponentHash[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((entry, index) => entry.component === b[index].component && entry.hash === b[index].hash);
}

export function generateReproducibilityRecord(
  input: DecisionReproducibilityEngineInput = {}
): ReproducibilityRecord {
  const enabled = input.enabled ?? isDecisionReproducibilityEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const generatedAt = new Date(input.now ?? Date.now()).toISOString();
  const env = input.env ?? process.env;

  const packageParsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  const executiveDecisionPackage = packageParsed.success ? packageParsed.data : null;
  const businessIntelligence = executiveDecisionPackage?.businessIntelligence ?? null;

  const memoParsed = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = memoParsed.success && memoParsed.data.generated ? memoParsed.data : null;

  const briefParsed = executiveBriefSchema.safeParse(input.executiveBrief);
  const brief = briefParsed.success && briefParsed.data.generated ? briefParsed.data : null;

  const auditTrailParsed = reportAuditTrailResultSchema.safeParse(input.auditTrail);
  const auditTrail = auditTrailParsed.success && auditTrailParsed.data.generated ? auditTrailParsed.data : null;

  const explainabilityParsed = explainabilityEngineResultSchema.safeParse(input.explainability);
  const explainability =
    explainabilityParsed.success && explainabilityParsed.data.generated ? explainabilityParsed.data : null;

  const reproducibilityTrace: string[] = [
    `Real inputs available: executiveDecisionPackage=${Boolean(executiveDecisionPackage)}, strategicDecisionMemo=${Boolean(memo)}, executiveBrief=${Boolean(brief)}, auditTrail=${Boolean(auditTrail)}, explainability=${Boolean(explainability)}.`,
  ];

  if (!executiveDecisionPackage && !memo && !brief) {
    reproducibilityTrace.push("No real Executive Decision System output was supplied; nothing to fingerprint.");
    return {
      enabled: true,
      generated: true,
      status: "insufficient_data",
      fingerprint: null,
      componentHashes: [],
      selfCheckPassed: null,
      executionMetadata: null,
      reproducibilityTrace,
    };
  }

  const ctx: BuildContext = { executiveDecisionPackage, businessIntelligence, memo, brief, auditTrail, explainability, env };

  // Two fully independent passes over the same real data, per the
  // file header's in-process self-check.
  const firstPass = computeComponents(ctx);
  const secondPass = computeComponents(ctx);
  const selfCheckPassed = componentsEqual(firstPass, secondPass);
  reproducibilityTrace.push(
    `Computed ${firstPass.length} component hash(es) twice for a real in-process self-check; selfCheckPassed=${selfCheckPassed}.`
  );

  const fingerprint = sha256Hex(firstPass.map((component) => component.hash).join("|"));

  const executionMetadata: ReproducibilityExecutionMetadata = {
    generatedAt,
    engineVersions: buildEngineVersionsList(ctx),
    activeFeatureFlags: RELEVANT_FLAG_VARS.filter((name) => env[name] === "true").sort(),
    auditTrailVersion: auditTrail?.pipelineVersion ?? null,
    explainabilityEngineVersion: explainability?.engineVersion ?? null,
  };

  reproducibilityTrace.push(`Fingerprint computed from ${firstPass.length} real component(s).`);

  return {
    enabled: true,
    generated: true,
    status: "fingerprinted",
    fingerprint,
    componentHashes: firstPass,
    selfCheckPassed,
    executionMetadata,
    reproducibilityTrace,
  };
}

export function compareReproducibilityRecords(
  a: ReproducibilityRecord,
  b: ReproducibilityRecord
): ReproducibilityDivergenceReport {
  if (!a.generated || !b.generated || a.fingerprint === null || b.fingerprint === null) {
    return {
      compared: false,
      reproducible: false,
      divergentComponents: [],
      details: [
        "At least one of the two records has no real fingerprint to compare (disabled or insufficient data); nothing was compared.",
      ],
    };
  }

  const divergentComponents: Array<ReproducibilityComponentName | "fingerprint"> = [];
  const details: string[] = [];

  for (const component of reproducibilityComponentNameValues) {
    const hashA = a.componentHashes.find((entry) => entry.component === component)?.hash ?? null;
    const hashB = b.componentHashes.find((entry) => entry.component === component)?.hash ?? null;
    if (hashA !== hashB) {
      divergentComponents.push(component);
      details.push(`Component "${component}" diverged between the two executions.`);
    }
  }

  if (a.fingerprint !== b.fingerprint) {
    divergentComponents.push("fingerprint");
  }

  const reproducible = divergentComponents.length === 0;
  if (reproducible) {
    details.push("Both executions produced identical fingerprints across all tracked components.");
  }

  return { compared: true, reproducible, divergentComponents, details };
}
