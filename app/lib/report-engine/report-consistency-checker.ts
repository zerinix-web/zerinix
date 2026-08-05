import { z } from "zod";
import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
} from "../ai/executive-decision-system.ts";
import { strategicDecisionMemoSchema, type StrategicDecisionMemo } from "../ai/strategic-decision-memo.ts";
import { executiveBriefSchema, type ExecutiveBrief } from "../ai/executive-brief-generator.ts";
import type { RecommendationStatus } from "../ai/executive-decision-brief.ts";
import type { ExecutiveDecisionSignal } from "../ai/business-intelligence-orchestrator.ts";

// ZERINIX Report Consistency Checker v1.
//
// Validates CROSS-SECTION consistency before a report is finalized --
// distinct from, and runs AFTER, ZERINIX Executive Report Quality
// Validator v1 (which inspects each section's own content in
// isolation: missing sections, placeholder text, broken citations,
// duplicated content, and a report-stated confidence number against
// the real aggregate). This module instead compares the STRUCTURED
// artifacts that fed the report against EACH OTHER -- the Executive
// Summary section, the Strategic Decision Memo, the Executive Brief,
// their evidence, their confidence scores, their risks, their
// opportunities, their recommendations, and the Business Intelligence
// Orchestrator's own real final verdict (executiveDecisionSignal) --
// and reports genuine CONTRADICTIONS between them, not just problems
// within a single one.
//
// This module makes no network/AI calls and never rewrites or
// resolves a contradiction itself -- it only detects and reports.
// Every issue is grounded in a real, checkable fact: a confidence
// mismatch is two real numbers that numerically disagree; a Memo/Brief
// field mismatch is two real, already-computed arrays/objects that are
// not deepEqual when they were supposed to be identical by
// construction (see executive-brief-generator.ts's own "reuse the
// Memo" design); a risk/opportunity contradiction is the same real,
// normalized sentence appearing in both lists; a verdict/recommendation
// mismatch is two real enum values that are on a small, explicit,
// documented incompatible-pairs list; an Executive-Summary/verdict
// mismatch is a real PASS/HOLD/VALIDATE/REJECT keyword extracted
// verbatim from the report's own (always legacy-built, never
// memo-derived) Executive Summary text, compared against the real
// executiveDecisionSignal; an evidence/recommendation mismatch is a
// real empty evidence list paired with a real, non-empty list of
// forward-looking recommendations. Nothing here is guessed.
//
// Scope (v1): this module does not modify report generation itself,
// PDF generation, UI, billing, authentication, or routing, and changes
// no existing API/response contract. Feature-flagged via
// ZERINIX_REPORT_CONSISTENCY_CHECKER_ENABLED, defaulting to disabled
// (or pass `enabled: true`, primarily for tests) -- when disabled, no
// report is ever inspected.

export const REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR = "ZERINIX_REPORT_CONSISTENCY_CHECKER_ENABLED";

export function isReportConsistencyCheckerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const consistencyIssueTypeValues = [
  "confidence_score_mismatch",
  "memo_brief_field_mismatch",
  "risk_opportunity_contradiction",
  "verdict_recommendation_mismatch",
  "executive_summary_verdict_mismatch",
  "evidence_recommendation_mismatch",
] as const;

export type ConsistencyIssueType = (typeof consistencyIssueTypeValues)[number];

export const consistencyIssueSeverityValues = ["critical", "error", "warning", "info"] as const;

export type ConsistencyIssueSeverity = (typeof consistencyIssueSeverityValues)[number];

// Severities that make the report inconsistent overall (see worker.ts
// integration) -- everything else is surfaced as a flag only.
const BLOCKING_SEVERITIES: readonly ConsistencyIssueSeverity[] = ["critical", "error"];

export const consistencyIssueSchema = z
  .object({
    type: z.enum(consistencyIssueTypeValues),
    affectedSections: z.array(shortString(120)).min(1).max(10),
    severity: z.enum(consistencyIssueSeverityValues),
    message: shortString(500),
    suggestedResolution: shortString(400),
  })
  .strict();

export type ConsistencyIssue = z.infer<typeof consistencyIssueSchema>;

export const reportConsistencyCheckResultSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, checking always
    // genuinely runs against whatever was supplied.
    checked: z.boolean(),
    // True iff no issue reached a blocking severity (critical/error).
    consistent: z.boolean(),
    issues: z.array(consistencyIssueSchema).max(100),
    checkTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ReportConsistencyCheckResult = z.infer<typeof reportConsistencyCheckResultSchema>;

export type ConsistencySection = {
  field: string;
  title: string;
  content: string;
};

export type ReportConsistencyCheckerInput = {
  sections: readonly ConsistencySection[];
  // The same, already-computed Executive Decision System objects
  // already carried on the request payload elsewhere in this
  // pipeline. Untyped `unknown` on purpose -- each is validated
  // against its own real schema before anything is read from it;
  // omitted or invalid simply narrows which cross-checks have a real
  // basis to run.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_REPORT_CONSISTENCY_CHECKER_ENABLED environment
  // variable.
  enabled?: boolean;
};

const CONFIDENCE_TOLERANCE = 5;
const CONFIDENCE_STATEMENT_PATTERN = /(?:confidence)[^\d]{0,20}(\d{1,3})\s*(?:\/\s*100|%)/gi;
const MIN_CONTRADICTION_SENTENCE_LENGTH = 30;

// A conservative, documented, explicit list of executiveDecisionSignal
// / recommendationStatus pairs that are UNAMBIGUOUSLY contradictory --
// deliberately narrow (see file header) so this never flags a
// legitimate, nuanced middle-ground combination (e.g.
// "proceed_with_caution" + "wait" is a perfectly normal, non-
// contradictory pairing and is never on this list).
const CLEARLY_INCOMPATIBLE_SIGNAL_RECOMMENDATION_PAIRS: ReadonlyArray<
  readonly [ExecutiveDecisionSignal, RecommendationStatus]
> = [
  ["do_not_proceed_insufficient_evidence", "proceed"],
  ["proceed", "reject"],
  ["proceed", "insufficient_evidence"],
];

const LEGACY_DECISION_KEYWORD_PATTERN = /\b(PASS|HOLD|VALIDATE|REJECT)\b/;

function isLegacyKeywordIncompatibleWithSignal(
  keyword: "PASS" | "HOLD" | "VALIDATE" | "REJECT",
  signal: ExecutiveDecisionSignal
): boolean {
  if ((keyword === "PASS" || keyword === "VALIDATE") && signal === "do_not_proceed_insufficient_evidence") {
    return true;
  }
  if (keyword === "REJECT" && signal === "proceed") {
    return true;
  }
  return false;
}

function disabledResult(): ReportConsistencyCheckResult {
  return {
    enabled: false,
    checked: false,
    consistent: true,
    issues: [],
    checkTrace: [
      `Report Consistency Checker is disabled (set ${REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

function normalizeSentence(sentence: string): string {
  return sentence.trim().replace(/\s+/g, " ").toLowerCase();
}

function findSection(
  sections: readonly ConsistencySection[],
  matcher: RegExp
): ConsistencySection | undefined {
  return sections.find((section) => matcher.test(section.field) || matcher.test(section.title));
}

function checkConfidenceScoreMismatch(
  sections: readonly ConsistencySection[],
  memo: StrategicDecisionMemo | null,
  brief: ExecutiveBrief | null,
  businessIntelligence: ExecutiveDecisionPackage["businessIntelligence"] | null,
  issues: ConsistencyIssue[]
): void {
  const structuredValues: { source: string; value: number }[] = [];
  if (memo) structuredValues.push({ source: "Strategic Decision Memo", value: memo.confidence.aggregateConfidence });
  if (brief) structuredValues.push({ source: "Executive Brief", value: brief.confidenceAssessment.aggregateConfidence });
  if (businessIntelligence) {
    structuredValues.push({ source: "Business Intelligence (final verdict)", value: businessIntelligence.aggregateConfidence });
  }

  for (let i = 0; i < structuredValues.length; i += 1) {
    for (let j = i + 1; j < structuredValues.length; j += 1) {
      if (Math.abs(structuredValues[i].value - structuredValues[j].value) > CONFIDENCE_TOLERANCE) {
        issues.push({
          type: "confidence_score_mismatch",
          affectedSections: [structuredValues[i].source, structuredValues[j].source],
          severity: "critical",
          message: `${structuredValues[i].source} states aggregate confidence ${structuredValues[i].value}, but ${structuredValues[j].source} states ${structuredValues[j].value} -- these should be identical by construction.`,
          suggestedResolution:
            "Regenerate the Executive Brief and Strategic Decision Memo from the same Executive Decision System package so their confidence values agree.",
        });
      }
    }
  }

  const authoritative = memo?.confidence.aggregateConfidence ?? brief?.confidenceAssessment.aggregateConfidence ?? businessIntelligence?.aggregateConfidence ?? null;
  if (authoritative === null) {
    return;
  }
  const executiveSummarySection = findSection(sections, /executivesummary/i);
  if (!executiveSummarySection) {
    return;
  }
  for (const match of executiveSummarySection.content.matchAll(CONFIDENCE_STATEMENT_PATTERN)) {
    const stated = Number(match[1]);
    if (Number.isFinite(stated) && Math.abs(stated - authoritative) > CONFIDENCE_TOLERANCE) {
      issues.push({
        type: "confidence_score_mismatch",
        affectedSections: [executiveSummarySection.field, "Executive Decision System"],
        severity: "error",
        message: `The "${executiveSummarySection.field}" section states a confidence of ${stated}, which does not match the Executive Decision System's real aggregate confidence of ${authoritative}.`,
        suggestedResolution:
          "Regenerate this section from the Strategic Decision Memo, or investigate why its stated confidence diverged from the Executive Decision System's real number.",
      });
    }
  }
}

function checkMemoBriefFieldMismatch(
  memo: StrategicDecisionMemo | null,
  brief: ExecutiveBrief | null,
  issues: ConsistencyIssue[]
): void {
  if (!memo || !brief) {
    return;
  }
  const fieldPairs: Array<{ label: string; memoValue: unknown; briefValue: unknown }> = [
    { label: "risks / critical risks", memoValue: memo.risks, briefValue: brief.criticalRisks },
    { label: "opportunities / strategic opportunities", memoValue: memo.opportunities, briefValue: brief.strategicOpportunities },
    { label: "recommended actions / immediate next actions", memoValue: memo.recommendedActions, briefValue: brief.immediateNextActions },
    { label: "confidence", memoValue: memo.confidence, briefValue: brief.confidenceAssessment },
  ];

  for (const pair of fieldPairs) {
    if (JSON.stringify(pair.memoValue) !== JSON.stringify(pair.briefValue)) {
      issues.push({
        type: "memo_brief_field_mismatch",
        affectedSections: ["Strategic Decision Memo", "Executive Brief"],
        severity: "critical",
        message: `The Strategic Decision Memo and Executive Brief disagree on ${pair.label}, even though the Executive Brief is expected to reuse the Memo's own computed values exactly.`,
        suggestedResolution:
          "Regenerate the Executive Brief with the Strategic Decision Memo supplied as input so it reuses the Memo's own computed values instead of diverging from them.",
      });
    }
  }
}

function checkRiskOpportunityContradiction(
  memo: StrategicDecisionMemo | null,
  brief: ExecutiveBrief | null,
  issues: ConsistencyIssue[]
): void {
  const risks = memo?.risks ?? brief?.criticalRisks ?? [];
  const opportunities = memo?.opportunities ?? brief?.strategicOpportunities ?? [];
  const source = memo ? "Strategic Decision Memo" : "Executive Brief";

  const normalizedOpportunities = new Set(
    opportunities
      .filter((opportunity) => opportunity.length >= MIN_CONTRADICTION_SENTENCE_LENGTH)
      .map((opportunity) => normalizeSentence(opportunity))
  );

  for (const risk of risks) {
    if (risk.length < MIN_CONTRADICTION_SENTENCE_LENGTH) {
      continue;
    }
    if (normalizedOpportunities.has(normalizeSentence(risk))) {
      issues.push({
        type: "risk_opportunity_contradiction",
        affectedSections: [source],
        severity: "error",
        message: `The same statement is listed as both a risk and an opportunity: "${risk.slice(0, 150)}${risk.length > 150 ? "…" : ""}".`,
        suggestedResolution: "Review the flagged statement and classify it as either a risk or an opportunity, not both.",
      });
    }
  }
}

function checkVerdictRecommendationMismatch(
  executiveDecisionPackage: ExecutiveDecisionPackage | null,
  issues: ConsistencyIssue[]
): void {
  const signal = executiveDecisionPackage?.businessIntelligence?.executiveDecisionSignal;
  const recommendationStatus = executiveDecisionPackage?.executiveDecisionBrief?.recommendationStatus;
  if (!signal || !recommendationStatus) {
    return;
  }
  const isIncompatible = CLEARLY_INCOMPATIBLE_SIGNAL_RECOMMENDATION_PAIRS.some(
    ([incompatibleSignal, incompatibleStatus]) => incompatibleSignal === signal && incompatibleStatus === recommendationStatus
  );
  if (isIncompatible) {
    issues.push({
      type: "verdict_recommendation_mismatch",
      affectedSections: ["Business Intelligence (final verdict)", "Executive Decision Brief"],
      severity: "critical",
      message: `The Business Intelligence Orchestrator's final verdict is "${signal}", but the Executive Decision Brief's recommendation status is "${recommendationStatus}" -- these directly contradict each other.`,
      suggestedResolution:
        "Reconcile the Executive Decision Brief's recommendation status with the Business Intelligence Orchestrator's executive decision signal before finalizing the report.",
    });
  }
}

function checkExecutiveSummaryVerdictMismatch(
  sections: readonly ConsistencySection[],
  executiveDecisionPackage: ExecutiveDecisionPackage | null,
  issues: ConsistencyIssue[]
): void {
  const signal = executiveDecisionPackage?.businessIntelligence?.executiveDecisionSignal;
  if (!signal) {
    return;
  }
  const executiveSummarySection = findSection(sections, /executivesummary/i);
  if (!executiveSummarySection) {
    return;
  }
  const match = executiveSummarySection.content.match(LEGACY_DECISION_KEYWORD_PATTERN);
  if (!match) {
    return;
  }
  const keyword = match[1] as "PASS" | "HOLD" | "VALIDATE" | "REJECT";
  if (isLegacyKeywordIncompatibleWithSignal(keyword, signal)) {
    issues.push({
      type: "executive_summary_verdict_mismatch",
      affectedSections: [executiveSummarySection.field, "Business Intelligence (final verdict)"],
      severity: "error",
      message: `The "${executiveSummarySection.field}" section states a decision of "${keyword}", but the Executive Decision System's real final verdict is "${signal}" -- these contradict each other.`,
      suggestedResolution:
        "Update the Executive Summary's decision keyword to match the Executive Decision System's real executive decision signal, or regenerate it from the Strategic Decision Memo.",
    });
  }
}

function checkEvidenceRecommendationMismatch(
  memo: StrategicDecisionMemo | null,
  brief: ExecutiveBrief | null,
  issues: ConsistencyIssue[]
): void {
  const verifiedFacts = memo?.verifiedFacts ?? brief?.supportingEvidenceSummary.verifiedFacts ?? [];
  const assumptions = memo?.assumptions ?? brief?.supportingEvidenceSummary.assumptions ?? [];
  const recommendedActions = memo?.recommendedActions ?? brief?.immediateNextActions ?? [];
  const source = memo ? "Strategic Decision Memo" : brief ? "Executive Brief" : null;

  if (!source) {
    return;
  }
  if (verifiedFacts.length === 0 && assumptions.length === 0 && recommendedActions.length > 0) {
    issues.push({
      type: "evidence_recommendation_mismatch",
      affectedSections: [source],
      severity: "warning",
      message: `${source} lists ${recommendedActions.length} recommended action(s) but has no verified facts and no assumptions behind them.`,
      suggestedResolution: "Do not issue confident recommendations until real verified evidence exists; gather evidence first or soften the recommendation language.",
    });
  }
}

export function checkReportConsistency(
  input: ReportConsistencyCheckerInput = { sections: [] }
): ReportConsistencyCheckResult {
  const enabled = input.enabled ?? isReportConsistencyCheckerEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const sections = input.sections ?? [];
  const checkTrace: string[] = [`Checking cross-section consistency across ${sections.length} report section(s).`];

  const packageParsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  const executiveDecisionPackage = packageParsed.success ? packageParsed.data : null;
  const businessIntelligence = executiveDecisionPackage?.businessIntelligence ?? null;

  const memoParsed = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = memoParsed.success && memoParsed.data.generated ? memoParsed.data : null;

  const briefParsed = executiveBriefSchema.safeParse(input.executiveBrief);
  const brief = briefParsed.success && briefParsed.data.generated ? briefParsed.data : null;

  checkTrace.push(
    `Real inputs available: executiveDecisionPackage=${Boolean(executiveDecisionPackage)}, strategicDecisionMemo=${Boolean(memo)}, executiveBrief=${Boolean(brief)}.`
  );

  const issues: ConsistencyIssue[] = [];

  checkConfidenceScoreMismatch(sections, memo, brief, businessIntelligence, issues);
  checkMemoBriefFieldMismatch(memo, brief, issues);
  checkRiskOpportunityContradiction(memo, brief, issues);
  checkVerdictRecommendationMismatch(executiveDecisionPackage, issues);
  checkExecutiveSummaryVerdictMismatch(sections, executiveDecisionPackage, issues);
  checkEvidenceRecommendationMismatch(memo, brief, issues);

  const consistent = !issues.some((issue) => BLOCKING_SEVERITIES.includes(issue.severity));

  checkTrace.push(
    `Found ${issues.length} issue(s) (${issues.filter((i) => BLOCKING_SEVERITIES.includes(i.severity)).length} blocking); consistent=${consistent}.`
  );

  return {
    enabled: true,
    checked: true,
    consistent,
    issues,
    checkTrace,
  };
}
