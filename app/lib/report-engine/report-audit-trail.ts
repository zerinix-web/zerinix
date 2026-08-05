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

// ZERINIX Report Audit Trail Generator v1.
//
// Records HOW each final report section was actually produced -- a
// permanent, machine-readable record of provenance, generated once a
// report has already passed (or been flagged by) the Executive Report
// Quality Validator and the Report Consistency Checker. Unlike those
// two modules, this one never blocks a report and never re-inspects
// content quality or cross-artifact contradictions itself -- it only
// records which real engines produced each of 8 tracked report
// categories (Executive Summary, Strategic Decision Memo, Executive
// Brief, Recommendations, Risks, Opportunities, Confidence, Evidence),
// what real evidence backs them, where their confidence numbers came
// from, and what the Quality Validator / Consistency Checker already
// found about them.
//
// Nothing here is guessed: "present" is a real boolean derived from
// whether the underlying artifact (a real report section, a real
// generated Strategic Decision Memo, a real generated Executive Brief)
// actually exists; "sourceEngines" and "version" name only the real
// modules whose real output was read; "evidenceReferences" are
// structural pointers plus real counts (e.g.
// "strategicDecisionMemo.verifiedFacts:3") -- NEVER the underlying
// evidence text itself, so this module can never leak prompts, raw
// model output, or any other sensitive content; "confidenceDerivation"
// quotes a real number and the real field path it came from, or is
// null when no real confidence value exists yet; "validationResult"
// and "consistencyOutcome" are real issue counts attributed to a
// section by matching the Quality Validator's / Consistency Checker's
// own real, already-computed issue records (by field name, issue
// category, issue type, and issue message keyword -- never a new
// judgment call about report quality); "executionOrder" is the real,
// fixed pipeline stage (1 = Executive Decision System, 2 = Strategic
// Decision Memo, 3 = Executive Brief, 4 = report generation) of
// whichever real artifact actually produced that section's content.
//
// "generatedAt" records when THIS audit trail was captured, not a
// fabricated distinct production timestamp per section -- the
// pipeline does not track individually-timestamped section
// production, so claiming one would be inventing data. The whole
// trail (and therefore every section record inside it) is captured
// atomically in one deterministic pass, and no field ever holds a
// prompt, an API key, a raw evidence string, or any other secret.
//
// Scope (v1): this module makes no network/AI calls, never modifies
// report generation, PDF generation, UI, billing, authentication, or
// routing, and changes no existing API/response contract -- the
// result is attached as a second, additive, optional reports.metadata
// field (see app/lib/report-jobs/worker.ts). Feature-flagged via
// ZERINIX_REPORT_AUDIT_TRAIL_ENABLED, defaulting to disabled (or pass
// `enabled: true`, primarily for tests) -- when disabled, no report is
// ever inspected.

export const REPORT_AUDIT_TRAIL_ENABLED_ENV_VAR = "ZERINIX_REPORT_AUDIT_TRAIL_ENABLED";

export function isReportAuditTrailEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[REPORT_AUDIT_TRAIL_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const auditedSectionKeyValues = [
  "executive_summary",
  "strategic_decision_memo",
  "executive_brief",
  "recommendations",
  "risks",
  "opportunities",
  "confidence",
  "evidence",
] as const;

export type AuditedSectionKey = (typeof auditedSectionKeyValues)[number];

export const auditConfidenceDerivationSchema = z
  .object({
    value: z.number().min(0).max(100).nullable(),
    method: z.string().trim().max(120).nullable(),
  })
  .strict();

export const auditValidationResultSchema = z
  .object({
    validated: z.boolean(),
    passed: z.boolean().nullable(),
    attributedIssueCount: z.number().int().min(0),
    blockingIssueCount: z.number().int().min(0),
  })
  .strict();

export const auditConsistencyOutcomeSchema = z
  .object({
    checked: z.boolean(),
    consistent: z.boolean().nullable(),
    attributedIssueCount: z.number().int().min(0),
    blockingIssueCount: z.number().int().min(0),
  })
  .strict();

export const auditedSectionRecordSchema = z
  .object({
    section: z.enum(auditedSectionKeyValues),
    present: z.boolean(),
    sourceEngines: z.array(shortString(80)).max(10),
    evidenceReferences: z.array(shortString(160)).max(20),
    confidenceDerivation: auditConfidenceDerivationSchema,
    validationResult: auditValidationResultSchema,
    consistencyOutcome: auditConsistencyOutcomeSchema,
    generatedAt: z.string().trim().min(1),
    executionOrder: z.number().int().min(1).max(4).nullable(),
    version: shortString(80),
  })
  .strict();

export type AuditedSectionRecord = z.infer<typeof auditedSectionRecordSchema>;

export const reportAuditTrailResultSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, generation always
    // genuinely runs against whatever real artifacts were supplied.
    generated: z.boolean(),
    generatedAt: z.string().trim().min(1),
    pipelineVersion: shortString(80),
    sections: z.array(auditedSectionRecordSchema).max(auditedSectionKeyValues.length),
    auditTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ReportAuditTrailResult = z.infer<typeof reportAuditTrailResultSchema>;

export type AuditSection = {
  field: string;
  title: string;
  content: string;
};

export type ReportAuditTrailInput = {
  sections: readonly AuditSection[];
  // The same, already-computed Executive Decision System objects
  // already carried on the request payload elsewhere in this
  // pipeline. Untyped `unknown` on purpose -- each is validated
  // against its own real schema before anything is read from it;
  // omitted or invalid simply narrows which sections have a real
  // basis for a present=true record.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  // The already-computed results from the two validation modules that
  // run immediately before this one in the pipeline (see worker.ts).
  // Untyped `unknown` on purpose -- validated against their own real
  // schemas before anything is read from them; omitted or invalid
  // simply means this section's validationResult/consistencyOutcome
  // honestly reports "no data" instead of guessing.
  qualityValidation?: unknown;
  consistencyCheck?: unknown;
  // Milliseconds since epoch, primarily for deterministic tests; when
  // omitted, falls back to the real Date.now().
  now?: number;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_REPORT_AUDIT_TRAIL_ENABLED environment variable.
  enabled?: boolean;
};

const PIPELINE_VERSION = "report-audit-trail@1";
const NOT_GENERATED_VERSION = "n/a";

const ENGINE = {
  reportGeneration: "report-generation-pipeline@1",
  executiveDecisionSystem: "executive-decision-system@1",
  businessIntelligenceOrchestrator: "business-intelligence-orchestrator@1",
  strategicDecisionMemo: "strategic-decision-memo@1",
  executiveBriefGenerator: "executive-brief-generator@1",
} as const;

const STAGE = {
  executiveDecisionSystem: 1,
  strategicDecisionMemo: 2,
  executiveBrief: 3,
  reportGeneration: 4,
} as const;

const MIN_SECTION_CONTENT_LENGTH = 10;

type BuildContext = {
  sections: readonly AuditSection[];
  memo: StrategicDecisionMemo | null;
  brief: ExecutiveBrief | null;
  businessIntelligence: ExecutiveDecisionPackage["businessIntelligence"] | null;
  qualityValidation: ExecutiveReportQualityValidationResult | null;
  consistencyCheck: ReportConsistencyCheckResult | null;
  generatedAt: string;
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function disabledResult(generatedAt: string): ReportAuditTrailResult {
  return {
    enabled: false,
    generated: false,
    generatedAt,
    pipelineVersion: PIPELINE_VERSION,
    sections: [],
    auditTrace: [
      `Report Audit Trail Generator is disabled (set ${REPORT_AUDIT_TRAIL_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

function findSection(sections: readonly AuditSection[], matcher: RegExp): AuditSection | undefined {
  return sections.find((section) => matcher.test(section.field) || matcher.test(section.title));
}

function countRef(path: string, count: number): string {
  return `${path}:${count}`;
}

// Even when a section has no real Memo/Brief data to report as
// "present", the Quality Validator or Consistency Checker may have
// raised a real issue ABOUT that absence (e.g. a "missing_section"
// finding for a literal "risks" report field) -- so validation/
// consistency attribution always runs here too, never only on the
// present=true branches below.
function baseRecord(
  section: AuditedSectionKey,
  ctx: BuildContext,
  sectionField: string | null = null
): AuditedSectionRecord {
  return {
    section,
    present: false,
    sourceEngines: [],
    evidenceReferences: [],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues(section, ctx.qualityValidation, sectionField),
    consistencyOutcome: attributeConsistencyIssues(section, ctx.consistencyCheck, sectionField),
    generatedAt: ctx.generatedAt,
    executionOrder: null,
    version: NOT_GENERATED_VERSION,
  };
}

function isQualityIssueForSection(
  section: AuditedSectionKey,
  issue: ReportQualityIssue,
  sectionField: string | null
): boolean {
  switch (section) {
    case "executive_summary":
      return sectionField !== null && issue.field === sectionField;
    case "confidence":
      return issue.category === "inconsistent_confidence";
    case "evidence":
      return issue.category === "empty_evidence";
    case "strategic_decision_memo":
      return issue.message.includes("Strategic Decision Memo");
    case "executive_brief":
      return issue.message.includes("Executive Brief");
    case "risks":
      return issue.field !== null && /^risks?$/i.test(issue.field);
    case "opportunities":
      return issue.field !== null && /opportunit/i.test(issue.field);
    case "recommendations":
      return issue.field !== null && /recommend/i.test(issue.field);
    default:
      return false;
  }
}

function attributeQualityIssues(
  section: AuditedSectionKey,
  qualityValidation: ExecutiveReportQualityValidationResult | null,
  sectionField: string | null
): AuditedSectionRecord["validationResult"] {
  if (!qualityValidation || !qualityValidation.validated) {
    return { validated: false, passed: null, attributedIssueCount: 0, blockingIssueCount: 0 };
  }
  const attributed = qualityValidation.issues.filter((issue) =>
    isQualityIssueForSection(section, issue, sectionField)
  );
  const blocking = attributed.filter((issue) => issue.severity === "critical" || issue.severity === "error");
  return {
    validated: true,
    passed: blocking.length === 0,
    attributedIssueCount: attributed.length,
    blockingIssueCount: blocking.length,
  };
}

function isConsistencyIssueForSection(
  section: AuditedSectionKey,
  issue: ConsistencyIssue,
  sectionField: string | null
): boolean {
  const hasMemo = issue.affectedSections.includes("Strategic Decision Memo");
  const hasBrief = issue.affectedSections.includes("Executive Brief");
  const message = issue.message.toLowerCase();
  switch (section) {
    case "executive_summary":
      return sectionField !== null && issue.affectedSections.includes(sectionField);
    case "strategic_decision_memo":
      return hasMemo;
    case "executive_brief":
      return hasBrief;
    case "confidence":
      return (
        issue.type === "confidence_score_mismatch" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("confidence"))
      );
    case "evidence":
      return issue.type === "evidence_recommendation_mismatch";
    case "risks":
      return (
        issue.type === "risk_opportunity_contradiction" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("risk"))
      );
    case "opportunities":
      return (
        issue.type === "risk_opportunity_contradiction" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("opportunit"))
      );
    case "recommendations":
      return (
        issue.type === "evidence_recommendation_mismatch" ||
        (issue.type === "memo_brief_field_mismatch" && message.includes("recommend"))
      );
    default:
      return false;
  }
}

function attributeConsistencyIssues(
  section: AuditedSectionKey,
  consistencyCheck: ReportConsistencyCheckResult | null,
  sectionField: string | null
): AuditedSectionRecord["consistencyOutcome"] {
  if (!consistencyCheck || !consistencyCheck.checked) {
    return { checked: false, consistent: null, attributedIssueCount: 0, blockingIssueCount: 0 };
  }
  const attributed = consistencyCheck.issues.filter((issue) =>
    isConsistencyIssueForSection(section, issue, sectionField)
  );
  const blocking = attributed.filter((issue) => issue.severity === "critical" || issue.severity === "error");
  return {
    checked: true,
    consistent: blocking.length === 0,
    attributedIssueCount: attributed.length,
    blockingIssueCount: blocking.length,
  };
}

// Every real domain's field-naming convention (plan/market/real
// estate/domain analysis) uses this literal key -- see
// app/lib/report-engine/prompts/*.ts. Used as the attribution field
// even when no matching section was actually found, so a real
// "missing_section" finding for it is still correctly attributed.
const CANONICAL_EXECUTIVE_SUMMARY_FIELD = "executiveSummary";

function buildExecutiveSummaryRecord(ctx: BuildContext): AuditedSectionRecord {
  const section = findSection(ctx.sections, /executivesummary/i);
  const sectionField = section?.field ?? CANONICAL_EXECUTIVE_SUMMARY_FIELD;
  if (!section || section.content.trim().length < MIN_SECTION_CONTENT_LENGTH) {
    return baseRecord("executive_summary", ctx, sectionField);
  }
  return {
    section: "executive_summary",
    present: true,
    sourceEngines: [ENGINE.reportGeneration],
    evidenceReferences: [`report.sections.${section.field}:${section.content.trim().length}chars`],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues("executive_summary", ctx.qualityValidation, section.field),
    consistencyOutcome: attributeConsistencyIssues("executive_summary", ctx.consistencyCheck, section.field),
    generatedAt: ctx.generatedAt,
    executionOrder: STAGE.reportGeneration,
    version: ENGINE.reportGeneration,
  };
}

function buildStrategicDecisionMemoRecord(ctx: BuildContext): AuditedSectionRecord {
  if (!ctx.memo) {
    return baseRecord("strategic_decision_memo", ctx);
  }
  const sourceEngines: string[] = [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem];
  if (ctx.businessIntelligence) {
    sourceEngines.push(ENGINE.businessIntelligenceOrchestrator);
  }
  return {
    section: "strategic_decision_memo",
    present: true,
    sourceEngines,
    evidenceReferences: [
      countRef("strategicDecisionMemo.verifiedFacts", ctx.memo.verifiedFacts.length),
      countRef("strategicDecisionMemo.assumptions", ctx.memo.assumptions.length),
    ],
    confidenceDerivation: {
      value: ctx.memo.confidence.aggregateConfidence,
      method: "strategicDecisionMemo.confidence.aggregateConfidence",
    },
    validationResult: attributeQualityIssues("strategic_decision_memo", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("strategic_decision_memo", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: STAGE.strategicDecisionMemo,
    version: ENGINE.strategicDecisionMemo,
  };
}

function buildExecutiveBriefRecord(ctx: BuildContext): AuditedSectionRecord {
  if (!ctx.brief) {
    return baseRecord("executive_brief", ctx);
  }
  const sourceEngines: string[] = [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem];
  if (ctx.memo) {
    sourceEngines.push(ENGINE.strategicDecisionMemo);
  }
  if (ctx.businessIntelligence) {
    sourceEngines.push(ENGINE.businessIntelligenceOrchestrator);
  }
  return {
    section: "executive_brief",
    present: true,
    sourceEngines,
    evidenceReferences: [
      countRef(
        "executiveBrief.supportingEvidenceSummary.verifiedFacts",
        ctx.brief.supportingEvidenceSummary.verifiedFacts.length
      ),
      countRef(
        "executiveBrief.supportingEvidenceSummary.assumptions",
        ctx.brief.supportingEvidenceSummary.assumptions.length
      ),
    ],
    confidenceDerivation: {
      value: ctx.brief.confidenceAssessment.aggregateConfidence,
      method: "executiveBrief.confidenceAssessment.aggregateConfidence",
    },
    validationResult: attributeQualityIssues("executive_brief", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("executive_brief", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: STAGE.executiveBrief,
    version: ENGINE.executiveBriefGenerator,
  };
}

function buildRecommendationsRecord(ctx: BuildContext): AuditedSectionRecord {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.recommendedActions.length > 0
      ? "memo"
      : ctx.brief && ctx.brief.immediateNextActions.length > 0
        ? "brief"
        : null;
  if (!source) {
    return baseRecord("recommendations", ctx);
  }
  const actions = source === "memo" ? ctx.memo!.recommendedActions : ctx.brief!.immediateNextActions;
  const path = source === "memo" ? "strategicDecisionMemo.recommendedActions" : "executiveBrief.immediateNextActions";
  const totalCitations = actions.reduce((sum, action) => sum + action.supportingEvidence.length, 0);
  return {
    section: "recommendations",
    present: true,
    sourceEngines:
      source === "memo"
        ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
        : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem],
    evidenceReferences: [countRef(path, actions.length), countRef(`${path}[].supportingEvidence`, totalCitations)],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues("recommendations", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("recommendations", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: source === "memo" ? STAGE.strategicDecisionMemo : STAGE.executiveBrief,
    version: source === "memo" ? ENGINE.strategicDecisionMemo : ENGINE.executiveBriefGenerator,
  };
}

function buildRisksRecord(ctx: BuildContext): AuditedSectionRecord {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.risks.length > 0 ? "memo" : ctx.brief && ctx.brief.criticalRisks.length > 0 ? "brief" : null;
  if (!source) {
    return baseRecord("risks", ctx);
  }
  const risks = source === "memo" ? ctx.memo!.risks : ctx.brief!.criticalRisks;
  const path = source === "memo" ? "strategicDecisionMemo.risks" : "executiveBrief.criticalRisks";
  return {
    section: "risks",
    present: true,
    sourceEngines:
      source === "memo"
        ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
        : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem],
    evidenceReferences: [countRef(path, risks.length)],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues("risks", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("risks", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: source === "memo" ? STAGE.strategicDecisionMemo : STAGE.executiveBrief,
    version: source === "memo" ? ENGINE.strategicDecisionMemo : ENGINE.executiveBriefGenerator,
  };
}

function buildOpportunitiesRecord(ctx: BuildContext): AuditedSectionRecord {
  const source: "memo" | "brief" | null =
    ctx.memo && ctx.memo.opportunities.length > 0
      ? "memo"
      : ctx.brief && ctx.brief.strategicOpportunities.length > 0
        ? "brief"
        : null;
  if (!source) {
    return baseRecord("opportunities", ctx);
  }
  const opportunities = source === "memo" ? ctx.memo!.opportunities : ctx.brief!.strategicOpportunities;
  const path = source === "memo" ? "strategicDecisionMemo.opportunities" : "executiveBrief.strategicOpportunities";
  return {
    section: "opportunities",
    present: true,
    sourceEngines:
      source === "memo"
        ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
        : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem],
    evidenceReferences: [countRef(path, opportunities.length)],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues("opportunities", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("opportunities", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: source === "memo" ? STAGE.strategicDecisionMemo : STAGE.executiveBrief,
    version: source === "memo" ? ENGINE.strategicDecisionMemo : ENGINE.executiveBriefGenerator,
  };
}

function buildConfidenceRecord(ctx: BuildContext): AuditedSectionRecord {
  let value: number | null = null;
  let method: string | null = null;
  let source: "memo" | "brief" | "businessIntelligence" | null = null;

  if (ctx.memo) {
    value = ctx.memo.confidence.aggregateConfidence;
    method = "strategicDecisionMemo.confidence.aggregateConfidence";
    source = "memo";
  } else if (ctx.brief) {
    value = ctx.brief.confidenceAssessment.aggregateConfidence;
    method = "executiveBrief.confidenceAssessment.aggregateConfidence";
    source = "brief";
  } else if (ctx.businessIntelligence) {
    value = ctx.businessIntelligence.aggregateConfidence;
    method = "executiveDecisionPackage.businessIntelligence.aggregateConfidence";
    source = "businessIntelligence";
  }

  if (source === null) {
    return baseRecord("confidence", ctx);
  }

  const sourceEngines: string[] =
    source === "businessIntelligence"
      ? [ENGINE.businessIntelligenceOrchestrator, ENGINE.executiveDecisionSystem]
      : source === "memo"
        ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem, ENGINE.businessIntelligenceOrchestrator]
        : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem, ENGINE.businessIntelligenceOrchestrator];

  return {
    section: "confidence",
    present: true,
    sourceEngines,
    evidenceReferences: [`${method}:${value}`],
    confidenceDerivation: { value, method },
    validationResult: attributeQualityIssues("confidence", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("confidence", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder:
      source === "memo" ? STAGE.strategicDecisionMemo : source === "brief" ? STAGE.executiveBrief : STAGE.executiveDecisionSystem,
    version:
      source === "memo"
        ? ENGINE.strategicDecisionMemo
        : source === "brief"
          ? ENGINE.executiveBriefGenerator
          : ENGINE.businessIntelligenceOrchestrator,
  };
}

function buildEvidenceRecord(ctx: BuildContext): AuditedSectionRecord {
  const memoHasEvidence = Boolean(ctx.memo) && (ctx.memo!.verifiedFacts.length > 0 || ctx.memo!.assumptions.length > 0);
  const briefHasEvidence =
    Boolean(ctx.brief) &&
    (ctx.brief!.supportingEvidenceSummary.verifiedFacts.length > 0 ||
      ctx.brief!.supportingEvidenceSummary.assumptions.length > 0);
  const source: "memo" | "brief" | null = memoHasEvidence ? "memo" : briefHasEvidence ? "brief" : null;
  if (!source) {
    return baseRecord("evidence", ctx);
  }
  const verifiedCount = source === "memo" ? ctx.memo!.verifiedFacts.length : ctx.brief!.supportingEvidenceSummary.verifiedFacts.length;
  const assumptionCount = source === "memo" ? ctx.memo!.assumptions.length : ctx.brief!.supportingEvidenceSummary.assumptions.length;
  const path = source === "memo" ? "strategicDecisionMemo" : "executiveBrief.supportingEvidenceSummary";
  const sourceEngines: string[] =
    source === "memo"
      ? [ENGINE.strategicDecisionMemo, ENGINE.executiveDecisionSystem]
      : [ENGINE.executiveBriefGenerator, ENGINE.executiveDecisionSystem];
  if (ctx.businessIntelligence) {
    sourceEngines.push(ENGINE.businessIntelligenceOrchestrator);
  }
  return {
    section: "evidence",
    present: true,
    sourceEngines,
    evidenceReferences: [countRef(`${path}.verifiedFacts`, verifiedCount), countRef(`${path}.assumptions`, assumptionCount)],
    confidenceDerivation: { value: null, method: null },
    validationResult: attributeQualityIssues("evidence", ctx.qualityValidation, null),
    consistencyOutcome: attributeConsistencyIssues("evidence", ctx.consistencyCheck, null),
    generatedAt: ctx.generatedAt,
    executionOrder: source === "memo" ? STAGE.strategicDecisionMemo : STAGE.executiveBrief,
    version: source === "memo" ? ENGINE.strategicDecisionMemo : ENGINE.executiveBriefGenerator,
  };
}

const SECTION_BUILDERS: Record<AuditedSectionKey, (ctx: BuildContext) => AuditedSectionRecord> = {
  executive_summary: buildExecutiveSummaryRecord,
  strategic_decision_memo: buildStrategicDecisionMemoRecord,
  executive_brief: buildExecutiveBriefRecord,
  recommendations: buildRecommendationsRecord,
  risks: buildRisksRecord,
  opportunities: buildOpportunitiesRecord,
  confidence: buildConfidenceRecord,
  evidence: buildEvidenceRecord,
};

export function generateReportAuditTrail(
  input: ReportAuditTrailInput = { sections: [] }
): ReportAuditTrailResult {
  const generatedAt = new Date(input.now ?? Date.now()).toISOString();
  const enabled = input.enabled ?? isReportAuditTrailEnabled();
  if (!enabled) {
    return disabledResult(generatedAt);
  }

  const sections = input.sections ?? [];

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

  const auditTrace: string[] = [
    `Generating audit trail for ${sections.length} report section(s) across ${auditedSectionKeyValues.length} tracked categories.`,
    `Real inputs available: executiveDecisionPackage=${Boolean(executiveDecisionPackage)}, strategicDecisionMemo=${Boolean(memo)}, executiveBrief=${Boolean(brief)}, qualityValidation=${Boolean(qualityValidation)}, consistencyCheck=${Boolean(consistencyCheck)}.`,
  ];

  const ctx: BuildContext = {
    sections,
    memo,
    brief,
    businessIntelligence,
    qualityValidation,
    consistencyCheck,
    generatedAt,
  };

  const records = auditedSectionKeyValues.map((key) => SECTION_BUILDERS[key](ctx));

  auditTrace.push(
    `Recorded audit metadata for ${records.filter((record) => record.present).length} of ${records.length} tracked section(s) that had real data.`
  );

  return deepFreeze({
    enabled: true,
    generated: true,
    generatedAt,
    pipelineVersion: PIPELINE_VERSION,
    sections: records,
    auditTrace,
  });
}
