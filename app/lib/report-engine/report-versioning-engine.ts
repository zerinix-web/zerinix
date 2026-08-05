import { z } from "zod";
import { executiveDecisionPackageSchema, type ExecutiveDecisionPackage } from "../ai/executive-decision-system.ts";
import { strategicDecisionMemoSchema } from "../ai/strategic-decision-memo.ts";
import { executiveBriefSchema } from "../ai/executive-brief-generator.ts";
import { executiveReportQualityValidationResultSchema } from "./executive-report-quality-validator.ts";
import { reportConsistencyCheckResultSchema } from "./report-consistency-checker.ts";
import { reportAuditTrailResultSchema } from "./report-audit-trail.ts";
import { explainabilityEngineResultSchema } from "./explainability-engine.ts";
import { reproducibilityRecordSchema } from "./decision-reproducibility-engine.ts";

// ZERINIX Report Versioning Engine v1.
//
// Attaches IMMUTABLE version metadata to every generated report: the
// report schema version, the Executive Decision System version, every
// participating engine's own version, the validation/consistency-
// check/explainability/audit-trail/reproducibility versions, a real
// generation timestamp, and structured compatibility information --
// so any report (current or one generated before some of these
// modules existed) can be identified, compared, and safely
// interpreted going forward.
//
// "Immutable" means exactly what it did for the Report Audit Trail
// Generator: the returned manifest and every nested object/array is
// deep-frozen before being returned -- a real, enforced guarantee,
// not just a type-level convention.
//
// Backward compatibility, concretely: this module models the report
// metadata schema as a small, ordered, additive ladder of real
// generations (see REPORT_SCHEMA_GENERATIONS below), each one
// introduced by exactly one of this session's sibling modules. Every
// generation strictly ADDS one optional field to ReportMetadata --
// none ever removed or renamed an existing one -- so a report that
// predates a later generation (or one generated with some of these
// modules' flags left off) is still a completely valid, readable
// object; it just lacks that generation's field. `detectReportSchema
// Version`/`assessReportVersionCompatibility` never throw on ANY
// input, including `null`, an empty object, or a genuinely legacy
// report's metadata blob that predates every module in this ladder --
// they degrade gracefully to the base generation and report exactly
// which later generations are missing, never fabricating a value for
// a field that was never computed.
//
// Integration with the Audit Trail / Reproducibility pipeline: the
// real, already-computed Report Audit Trail Generator's own
// `pipelineVersion` and the real Decision Reproducibility Engine's own
// presence are read directly (never re-derived) and folded into this
// manifest's `auditTrailVersion` / `reproducibilityVersion` /
// `engineVersions` fields -- the same "read the real thing, never
// recompute it" discipline every sibling module in this pipeline
// follows.
//
// This module makes no network/AI calls and never re-runs any engine
// beneath it. Scope (v1): it does not modify report generation, PDF
// generation, UI, billing, authentication, or routing, and changes no
// existing API/response contract -- the result is attached as an
// additive, optional reports.metadata field (see
// app/lib/report-jobs/worker.ts). Feature-flagged via
// ZERINIX_REPORT_VERSIONING_ENGINE_ENABLED, defaulting to disabled (or
// pass `enabled: true`, primarily for tests) -- when disabled, no
// manifest is ever generated.

export const REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR = "ZERINIX_REPORT_VERSIONING_ENGINE_ENABLED";

export function isReportVersioningEngineEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const reportSchemaGenerationSchema = z
  .object({
    version: shortString(20),
    label: shortString(160),
    // The ReportMetadata field whose presence marks this generation as
    // reached; null only for the base generation, which requires
    // nothing (every report, however old, satisfies it).
    requiredField: z.string().trim().max(80).nullable(),
  })
  .strict();

export type ReportSchemaGeneration = z.infer<typeof reportSchemaGenerationSchema>;

// Ordered, additive ladder -- see file header. Each entry after the
// base corresponds to exactly one sibling module's own additive
// ReportMetadata field, in the real order those modules were built.
export const REPORT_SCHEMA_GENERATIONS: readonly ReportSchemaGeneration[] = [
  { version: "1.0.0", label: "Base report metadata (pre-ZERINIX-Intelligence).", requiredField: null },
  {
    version: "1.1.0",
    label: "Adds Executive Report Quality Validator results.",
    requiredField: "reportQualityValidation",
  },
  { version: "1.2.0", label: "Adds Report Consistency Checker results.", requiredField: "reportConsistencyCheck" },
  { version: "1.3.0", label: "Adds Report Audit Trail Generator results.", requiredField: "reportAuditTrail" },
  { version: "1.4.0", label: "Adds Explainability Engine results.", requiredField: "reportExplainability" },
  { version: "1.5.0", label: "Adds Decision Reproducibility Engine results.", requiredField: "reportReproducibility" },
  { version: "1.6.0", label: "Adds Report Versioning Engine version metadata.", requiredField: "reportVersion" },
];

export const REPORT_SCHEMA_VERSION = REPORT_SCHEMA_GENERATIONS[REPORT_SCHEMA_GENERATIONS.length - 1].version;

export const engineVersionEntrySchema = z
  .object({
    engine: shortString(80),
    version: shortString(80),
    present: z.boolean(),
  })
  .strict();

export type EngineVersionEntry = z.infer<typeof engineVersionEntrySchema>;

export const reportCompatibilityInfoSchema = z
  .object({
    currentSchemaVersion: shortString(20),
    // The highest single generation whose required field was actually
    // found present -- computed independently per generation (each
    // sibling module is independently feature-flagged), never assumed
    // cumulative.
    detectedSchemaVersion: shortString(20),
    // True only when every generation's required field is present --
    // distinct from detectedSchemaVersion, which can equal
    // currentSchemaVersion's string while earlier generations are
    // still genuinely missing (an operator can enable later flags
    // without enabling earlier ones).
    isCurrent: z.boolean(),
    missingGenerations: z.array(shortString(20)).max(REPORT_SCHEMA_GENERATIONS.length),
    // Always true: this engine is designed to read any generation,
    // including the base generation with zero ZERINIX fields at all,
    // without ever throwing or fabricating a missing value. Exposed
    // as an explicit, checked fact (see the "never throws" tests)
    // rather than left implicit.
    backwardCompatible: z.boolean(),
  })
  .strict();

export type ReportCompatibilityInfo = z.infer<typeof reportCompatibilityInfoSchema>;

export const reportVersionManifestSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, generation always
    // genuinely runs against whatever real artifacts were supplied.
    generated: z.boolean(),
    generatedAt: z.string().trim().min(1),
    reportSchemaVersion: shortString(20),
    executiveDecisionSystemVersion: shortString(80).nullable(),
    engineVersions: z.array(engineVersionEntrySchema).max(20),
    validationVersion: shortString(80).nullable(),
    consistencyCheckVersion: shortString(80).nullable(),
    explainabilityVersion: shortString(80).nullable(),
    auditTrailVersion: shortString(80).nullable(),
    reproducibilityVersion: shortString(80).nullable(),
    compatibility: reportCompatibilityInfoSchema,
    versioningTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ReportVersionManifest = z.infer<typeof reportVersionManifestSchema>;

export type ReportVersioningEngineInput = {
  // The same, already-computed Executive Decision System objects and
  // sibling-module results already carried through this pipeline.
  // Untyped `unknown` on purpose -- each is validated against its own
  // real schema before anything is read from it; omitted or invalid
  // simply means the corresponding manifest field is honestly null.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  qualityValidation?: unknown;
  consistencyCheck?: unknown;
  auditTrail?: unknown;
  explainability?: unknown;
  reproducibility?: unknown;
  // Milliseconds since epoch, primarily for deterministic tests; when
  // omitted, falls back to the real Date.now().
  now?: number;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_REPORT_VERSIONING_ENGINE_ENABLED environment
  // variable.
  enabled?: boolean;
};

const ENGINE = {
  executiveDecisionSystem: "executive-decision-system@1",
  businessIntelligenceOrchestrator: "business-intelligence-orchestrator@1",
  strategicDecisionMemo: "strategic-decision-memo@1",
  executiveBriefGenerator: "executive-brief-generator@1",
  executiveReportQualityValidator: "executive-report-quality-validator@1",
  reportConsistencyChecker: "report-consistency-checker@1",
  reportAuditTrail: "report-audit-trail@1",
  explainabilityEngine: "explainability-engine@1",
  decisionReproducibilityEngine: "decision-reproducibility-engine@1",
} as const;

const ENGINE_VERSION = "report-versioning-engine@1";

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

// Never throws on any input -- see file header. Degrades gracefully
// to the base generation for null/undefined/non-object/legacy input.
export function assessReportVersionCompatibility(metadata: unknown): ReportCompatibilityInfo {
  const record = isRecord(metadata) ? metadata : {};
  let detectedSchemaVersion = REPORT_SCHEMA_GENERATIONS[0].version;
  const missingGenerations: string[] = [];

  for (const generation of REPORT_SCHEMA_GENERATIONS) {
    if (generation.requiredField === null) {
      continue;
    }
    if (isPresent(record[generation.requiredField])) {
      detectedSchemaVersion = generation.version;
    } else {
      missingGenerations.push(generation.version);
    }
  }

  return {
    currentSchemaVersion: REPORT_SCHEMA_VERSION,
    detectedSchemaVersion,
    isCurrent: missingGenerations.length === 0,
    missingGenerations,
    backwardCompatible: true,
  };
}

function disabledResult(generatedAt: string): ReportVersionManifest {
  return {
    enabled: false,
    generated: false,
    generatedAt,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    executiveDecisionSystemVersion: null,
    engineVersions: [],
    validationVersion: null,
    consistencyCheckVersion: null,
    explainabilityVersion: null,
    auditTrailVersion: null,
    reproducibilityVersion: null,
    compatibility: {
      currentSchemaVersion: REPORT_SCHEMA_VERSION,
      detectedSchemaVersion: REPORT_SCHEMA_GENERATIONS[0].version,
      isCurrent: false,
      missingGenerations: REPORT_SCHEMA_GENERATIONS.slice(1).map((generation) => generation.version),
      backwardCompatible: true,
    },
    versioningTrace: [
      `Report Versioning Engine is disabled (set ${REPORT_VERSIONING_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

export function generateReportVersionManifest(
  input: ReportVersioningEngineInput = {}
): ReportVersionManifest {
  const generatedAt = new Date(input.now ?? Date.now()).toISOString();
  const enabled = input.enabled ?? isReportVersioningEngineEnabled();
  if (!enabled) {
    return disabledResult(generatedAt);
  }

  const packageParsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  const executiveDecisionPackage: ExecutiveDecisionPackage | null = packageParsed.success ? packageParsed.data : null;

  const memoParsed = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = memoParsed.success && memoParsed.data.generated ? memoParsed.data : null;

  const briefParsed = executiveBriefSchema.safeParse(input.executiveBrief);
  const brief = briefParsed.success && briefParsed.data.generated ? briefParsed.data : null;

  const qualityParsed = executiveReportQualityValidationResultSchema.safeParse(input.qualityValidation);
  const qualityValidation = qualityParsed.success && qualityParsed.data.validated ? qualityParsed.data : null;

  const consistencyParsed = reportConsistencyCheckResultSchema.safeParse(input.consistencyCheck);
  const consistencyCheck = consistencyParsed.success && consistencyParsed.data.checked ? consistencyParsed.data : null;

  const auditTrailParsed = reportAuditTrailResultSchema.safeParse(input.auditTrail);
  const auditTrail = auditTrailParsed.success && auditTrailParsed.data.generated ? auditTrailParsed.data : null;

  const explainabilityParsed = explainabilityEngineResultSchema.safeParse(input.explainability);
  const explainability =
    explainabilityParsed.success && explainabilityParsed.data.generated ? explainabilityParsed.data : null;

  const reproducibilityParsed = reproducibilityRecordSchema.safeParse(input.reproducibility);
  const reproducibility =
    reproducibilityParsed.success && reproducibilityParsed.data.generated ? reproducibilityParsed.data : null;

  const engineVersions: EngineVersionEntry[] = [
    {
      engine: "executive-decision-system",
      version: ENGINE.executiveDecisionSystem,
      present: Boolean(executiveDecisionPackage),
    },
    {
      engine: "business-intelligence-orchestrator",
      version: ENGINE.businessIntelligenceOrchestrator,
      present: Boolean(executiveDecisionPackage?.businessIntelligence),
    },
    { engine: "strategic-decision-memo", version: ENGINE.strategicDecisionMemo, present: Boolean(memo) },
    { engine: "executive-brief-generator", version: ENGINE.executiveBriefGenerator, present: Boolean(brief) },
    {
      engine: "executive-report-quality-validator",
      version: ENGINE.executiveReportQualityValidator,
      present: Boolean(qualityValidation),
    },
    {
      engine: "report-consistency-checker",
      version: ENGINE.reportConsistencyChecker,
      present: Boolean(consistencyCheck),
    },
    {
      engine: "report-audit-trail",
      version: auditTrail?.pipelineVersion ?? ENGINE.reportAuditTrail,
      present: Boolean(auditTrail),
    },
    {
      engine: "explainability-engine",
      version: explainability?.engineVersion ?? ENGINE.explainabilityEngine,
      present: Boolean(explainability),
    },
    {
      engine: "decision-reproducibility-engine",
      version: ENGINE.decisionReproducibilityEngine,
      present: Boolean(reproducibility),
    },
    { engine: "report-versioning-engine", version: ENGINE_VERSION, present: true },
  ];

  // A real presence probe mirroring ReportMetadata's own optional
  // fields -- built entirely from the same real booleans computed
  // above, never guessed -- fed into the exact same compatibility
  // detector used for genuinely external/legacy metadata.
  const metadataPresenceProbe: Record<string, unknown> = {
    reportQualityValidation: qualityValidation ?? undefined,
    reportConsistencyCheck: consistencyCheck ?? undefined,
    reportAuditTrail: auditTrail ?? undefined,
    reportExplainability: explainability ?? undefined,
    reportReproducibility: reproducibility ?? undefined,
    reportVersion: true,
  };
  const compatibility = assessReportVersionCompatibility(metadataPresenceProbe);

  const versioningTrace: string[] = [
    `Real inputs available: executiveDecisionPackage=${Boolean(executiveDecisionPackage)}, strategicDecisionMemo=${Boolean(memo)}, executiveBrief=${Boolean(brief)}, qualityValidation=${Boolean(qualityValidation)}, consistencyCheck=${Boolean(consistencyCheck)}, auditTrail=${Boolean(auditTrail)}, explainability=${Boolean(explainability)}, reproducibility=${Boolean(reproducibility)}.`,
    `Detected schema version "${compatibility.detectedSchemaVersion}" against current "${compatibility.currentSchemaVersion}" (${compatibility.missingGenerations.length} generation(s) not present).`,
  ];

  return deepFreeze({
    enabled: true,
    generated: true,
    generatedAt,
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    executiveDecisionSystemVersion: executiveDecisionPackage ? ENGINE.executiveDecisionSystem : null,
    engineVersions,
    validationVersion: qualityValidation ? ENGINE.executiveReportQualityValidator : null,
    consistencyCheckVersion: consistencyCheck ? ENGINE.reportConsistencyChecker : null,
    explainabilityVersion: explainability?.engineVersion ?? null,
    auditTrailVersion: auditTrail?.pipelineVersion ?? null,
    reproducibilityVersion: reproducibility ? ENGINE.decisionReproducibilityEngine : null,
    compatibility,
    versioningTrace,
  });
}
