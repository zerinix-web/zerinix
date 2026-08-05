import { z } from "zod";
import { executiveDecisionPackageSchema } from "../ai/executive-decision-system.ts";
import { strategicDecisionMemoSchema } from "../ai/strategic-decision-memo.ts";
import { executiveBriefSchema } from "../ai/executive-brief-generator.ts";

// ZERINIX Executive Report Quality Validator v1.
//
// Runs before any generated report reaches the user: inspects the
// final, already-generated report sections -- optionally cross-
// referenced against the Executive Decision System context that
// produced them (the same executiveDecisionSystemResult /
// strategicDecisionMemo / executiveBrief objects already carried on
// the request payload since earlier ZERINIX Executive Decision work)
// -- and reports missing required sections, empty evidence, broken
// citations, placeholder text, duplicated content, inconsistent
// confidence values, and unsupported conclusions as a structured,
// severity-ranked result with an overall pass/fail status.
//
// This module makes no network/AI calls and never rewrites, censors,
// or "fixes" a report itself -- it only inspects and reports. Every
// issue it raises is grounded in a real, checkable fact about the
// report text or the real Executive Decision System data it is
// compared against: a missing section is a real absent/empty field, a
// broken citation is a real "[R#]" reference with no matching entry
// anywhere in the sources section, a placeholder match is a real
// substring match against a fixed pattern list, a duplicated-content
// finding is a real identical sentence found in two different
// sections, an inconsistent-confidence finding is a real number stated
// in the report text that numerically differs from the real,
// authoritative confidence the Executive Decision System computed, and
// an unsupported-conclusion finding only fires when the report's own
// text asserts unqualified certainty while the real, computed
// aggregate confidence is genuinely low. Nothing here is guessed.
//
// Scope (v1): this module does not modify report generation itself,
// PDF generation, UI, billing, authentication, or routing, and changes
// no existing API/response contract -- see app/lib/report-jobs/worker.ts
// for how a caller is expected to use the result (reject before
// persisting on failure, attach the result as additive report metadata
// on pass). Feature-flagged via
// ZERINIX_EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED, defaulting to
// disabled (or pass `enabled: true`, primarily for tests) -- when
// disabled, no report is ever inspected or rejected.

export const EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR =
  "ZERINIX_EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED";

export function isExecutiveReportQualityValidatorEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const reportQualityIssueSeverityValues = ["critical", "error", "warning", "info"] as const;

export type ReportQualityIssueSeverity = (typeof reportQualityIssueSeverityValues)[number];

export const reportQualityIssueCategoryValues = [
  "missing_section",
  "empty_evidence",
  "broken_citation",
  "placeholder_text",
  "duplicated_content",
  "inconsistent_confidence",
  "unsupported_conclusion",
] as const;

export type ReportQualityIssueCategory = (typeof reportQualityIssueCategoryValues)[number];

// Severities that block a report from being persisted/returned to the
// user (see worker.ts) -- everything else is surfaced as a flag only.
const BLOCKING_SEVERITIES: readonly ReportQualityIssueSeverity[] = ["critical", "error"];

export const reportQualityIssueSchema = z
  .object({
    category: z.enum(reportQualityIssueCategoryValues),
    severity: z.enum(reportQualityIssueSeverityValues),
    message: shortString(500),
    field: z.string().trim().max(120).nullable(),
  })
  .strict();

export type ReportQualityIssue = z.infer<typeof reportQualityIssueSchema>;

export const executiveReportQualityValidationResultSchema = z
  .object({
    enabled: z.boolean(),
    // False only when disabled -- once enabled, validation always
    // genuinely runs against whatever sections were supplied (even
    // zero sections, which itself produces real issues), so this is
    // never a "nothing to report" ambiguity.
    validated: z.boolean(),
    // True iff no issue reached a blocking severity (critical/error).
    passed: z.boolean(),
    issues: z.array(reportQualityIssueSchema).max(100),
    validationTrace: z.array(shortString(500)).max(60),
  })
  .strict();

export type ExecutiveReportQualityValidationResult = z.infer<
  typeof executiveReportQualityValidationResultSchema
>;

export type ReportQualitySection = {
  field: string;
  title: string;
  content: string;
};

export type ExecutiveReportQualityValidatorInput = {
  sections: readonly ReportQualitySection[];
  // The complete set of field keys this report was expected to
  // contain (e.g. planFields). Omit to skip the missing-section check
  // entirely rather than guess what was expected.
  expectedFields?: readonly string[];
  // The same, already-computed Executive Decision System objects
  // already carried on the request payload elsewhere in this
  // pipeline. Untyped `unknown` on purpose -- each is validated
  // against its own real schema before anything is read from it;
  // omitted or invalid simply narrows which checks have a real basis
  // to run.
  executiveDecisionPackage?: unknown;
  strategicDecisionMemo?: unknown;
  executiveBrief?: unknown;
  // Explicit override, primarily for tests; when omitted, falls back
  // to the ZERINIX_EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED
  // environment variable.
  enabled?: boolean;
};

const MIN_SECTION_CONTENT_LENGTH = 10;

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\blorem ipsum\b/i,
  /\btodo\b/i,
  /\btbd\b/i,
  /\bfixme\b/i,
  /\[insert[^\]]*\]/i,
  /\bplaceholder\b/i,
  /\bxxx+\b/i,
  /\byour company( name)?\b/i,
  /\bcompany name here\b/i,
];

const CITATION_PATTERN = /\[R(\d+)\]/g;
const CONFIDENCE_STATEMENT_PATTERN = /(?:confidence)[^\d]{0,20}(\d{1,3})\s*(?:\/\s*100|%)/gi;
const MIN_DUPLICATE_SENTENCE_LENGTH = 40;
const CONFIDENCE_TOLERANCE = 5;
const LOW_CONFIDENCE_THRESHOLD = 40;
const UNQUALIFIED_CERTAINTY_PATTERN =
  /\b(strongly recommend|highly confident|clear go|definitely proceed|proceed immediately|no doubt)\b/i;
const HEDGING_LANGUAGE_PATTERN =
  /\b(caution|however|risk|uncertain|limited evidence|insufficient|preliminary|assumption)\b/i;

function disabledResult(): ExecutiveReportQualityValidationResult {
  return {
    enabled: false,
    validated: false,
    passed: true,
    issues: [],
    validationTrace: [
      `Executive Report Quality Validator is disabled (set ${EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR}="true" to enable it).`,
    ],
  };
}

function normalizeSentence(sentence: string): string {
  return sentence.trim().replace(/\s+/g, " ").toLowerCase();
}

function splitIntoSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function checkMissingSections(
  sections: readonly ReportQualitySection[],
  expectedFields: readonly string[] | undefined,
  issues: ReportQualityIssue[]
): void {
  if (!expectedFields || expectedFields.length === 0) {
    return;
  }
  const contentByField = new Map(sections.map((section) => [section.field, section.content]));
  for (const field of expectedFields) {
    const content = contentByField.get(field);
    if (!content || content.trim().length < MIN_SECTION_CONTENT_LENGTH) {
      issues.push({
        category: "missing_section",
        severity: "critical",
        message: content
          ? `Required section "${field}" is present but has no meaningful content (${content.trim().length} character(s)).`
          : `Required section "${field}" is missing entirely.`,
        field,
      });
    }
  }
}

function checkPlaceholderText(sections: readonly ReportQualitySection[], issues: ReportQualityIssue[]): void {
  for (const section of sections) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const match = section.content.match(pattern);
      if (match) {
        issues.push({
          category: "placeholder_text",
          severity: "error",
          message: `Section "${section.field}" contains placeholder text: "${match[0]}".`,
          field: section.field,
        });
        break;
      }
    }
  }
}

function checkBrokenCitations(sections: readonly ReportQualitySection[], issues: ReportQualityIssue[]): void {
  const sourcesSection = sections.find((section) => /source/i.test(section.field) || /source/i.test(section.title));
  const sourcesContent = sourcesSection?.content ?? "";

  for (const section of sections) {
    const referenced = new Set<string>();
    for (const match of section.content.matchAll(CITATION_PATTERN)) {
      referenced.add(match[1]);
    }
    for (const referenceNumber of referenced) {
      const definedSomewhere = new RegExp(`R${referenceNumber}\\b`).test(sourcesContent);
      if (!definedSomewhere) {
        issues.push({
          category: "broken_citation",
          severity: "error",
          message: `Section "${section.field}" cites "[R${referenceNumber}]", but no matching source entry was found${sourcesSection ? ` in "${sourcesSection.field}"` : " (no sources section exists in this report at all)"}.`,
          field: section.field,
        });
      }
    }
  }
}

function checkDuplicatedContent(sections: readonly ReportQualitySection[], issues: ReportQualityIssue[]): void {
  const seenSentences = new Map<string, string>();
  const flaggedPairs = new Set<string>();

  for (const section of sections) {
    for (const rawSentence of splitIntoSentences(section.content)) {
      if (rawSentence.length < MIN_DUPLICATE_SENTENCE_LENGTH) {
        continue;
      }
      const normalized = normalizeSentence(rawSentence);
      const previousField = seenSentences.get(normalized);
      if (previousField && previousField !== section.field) {
        const pairKey = [previousField, section.field, normalized].sort().join("::");
        if (!flaggedPairs.has(pairKey)) {
          flaggedPairs.add(pairKey);
          issues.push({
            category: "duplicated_content",
            severity: "warning",
            message: `Sections "${previousField}" and "${section.field}" both contain the same sentence: "${rawSentence.slice(0, 120)}${rawSentence.length > 120 ? "…" : ""}".`,
            field: section.field,
          });
        }
      } else if (!previousField) {
        seenSentences.set(normalized, section.field);
      }
    }
  }
}

function checkEmptyEvidence(
  sections: readonly ReportQualitySection[],
  businessIntelligence: EDSBusinessIntelligenceLike | null,
  memo: MemoLike | null,
  issues: ReportQualityIssue[]
): void {
  if (businessIntelligence && businessIntelligence.evidenceQuality?.itemScores.length === 0) {
    issues.push({
      category: "empty_evidence",
      severity: "error",
      message: "The Executive Decision System's evidence pool for this report was empty -- no evidence was actually scored.",
      field: null,
    });
  }
  if (memo && memo.verifiedFacts.length === 0 && memo.assumptions.length === 0) {
    issues.push({
      category: "empty_evidence",
      severity: "error",
      message: "The Strategic Decision Memo carries no verified facts and no assumptions -- there is no real evidence behind it.",
      field: null,
    });
  }
  void sections;
}

function checkInconsistentConfidence(
  sections: readonly ReportQualitySection[],
  authoritativeConfidence: number | null,
  issues: ReportQualityIssue[]
): void {
  if (authoritativeConfidence === null) {
    return;
  }
  for (const section of sections) {
    for (const match of section.content.matchAll(CONFIDENCE_STATEMENT_PATTERN)) {
      const stated = Number(match[1]);
      if (!Number.isFinite(stated)) {
        continue;
      }
      if (Math.abs(stated - authoritativeConfidence) > CONFIDENCE_TOLERANCE) {
        issues.push({
          category: "inconsistent_confidence",
          severity: "error",
          message: `Section "${section.field}" states a confidence of ${stated}, which does not match the Executive Decision System's real aggregate confidence of ${authoritativeConfidence}.`,
          field: section.field,
        });
      }
    }
  }
}

function checkUnsupportedConclusions(
  sections: readonly ReportQualitySection[],
  businessIntelligence: EDSBusinessIntelligenceLike | null,
  issues: ReportQualityIssue[]
): void {
  if (!businessIntelligence || businessIntelligence.aggregateConfidence >= LOW_CONFIDENCE_THRESHOLD) {
    return;
  }
  for (const section of sections) {
    if (UNQUALIFIED_CERTAINTY_PATTERN.test(section.content) && !HEDGING_LANGUAGE_PATTERN.test(section.content)) {
      issues.push({
        category: "unsupported_conclusion",
        severity: "warning",
        message: `Section "${section.field}" asserts unqualified certainty, but the Executive Decision System's real aggregate confidence is only ${businessIntelligence.aggregateConfidence}/100.`,
        field: section.field,
      });
    }
  }
}

type EDSBusinessIntelligenceLike = {
  aggregateConfidence: number;
  evidenceQuality: { itemScores: readonly unknown[] } | null;
};

type MemoLike = {
  verifiedFacts: readonly string[];
  assumptions: readonly string[];
  confidence: { aggregateConfidence: number };
};

export function validateExecutiveReportQuality(
  input: ExecutiveReportQualityValidatorInput = { sections: [] }
): ExecutiveReportQualityValidationResult {
  const enabled = input.enabled ?? isExecutiveReportQualityValidatorEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const sections = input.sections ?? [];
  const validationTrace: string[] = [`Validating ${sections.length} report section(s).`];

  const packageParsed = executiveDecisionPackageSchema.safeParse(input.executiveDecisionPackage);
  const businessIntelligence = packageParsed.success ? packageParsed.data.businessIntelligence : null;

  const memoParsed = strategicDecisionMemoSchema.safeParse(input.strategicDecisionMemo);
  const memo = memoParsed.success && memoParsed.data.generated ? memoParsed.data : null;

  const briefParsed = executiveBriefSchema.safeParse(input.executiveBrief);
  const brief = briefParsed.success && briefParsed.data.generated ? briefParsed.data : null;

  const authoritativeConfidence =
    memo?.confidence.aggregateConfidence ??
    brief?.confidenceAssessment.aggregateConfidence ??
    businessIntelligence?.aggregateConfidence ??
    null;

  const issues: ReportQualityIssue[] = [];

  checkMissingSections(sections, input.expectedFields, issues);
  checkPlaceholderText(sections, issues);
  checkBrokenCitations(sections, issues);
  checkDuplicatedContent(sections, issues);
  checkEmptyEvidence(sections, businessIntelligence, memo, issues);
  checkInconsistentConfidence(sections, authoritativeConfidence, issues);
  checkUnsupportedConclusions(sections, businessIntelligence, issues);

  const passed = !issues.some((issue) => BLOCKING_SEVERITIES.includes(issue.severity));

  validationTrace.push(
    `Found ${issues.length} issue(s) (${issues.filter((i) => BLOCKING_SEVERITIES.includes(i.severity)).length} blocking); passed=${passed}.`
  );

  return {
    enabled: true,
    validated: true,
    passed,
    issues,
    validationTrace,
  };
}
