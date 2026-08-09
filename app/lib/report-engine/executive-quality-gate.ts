import { computeFillerRatio } from "@/app/lib/report-engine/filler-detection";

// Shared, report-type-agnostic pre-return gate: fails generation instead of
// silently returning a report that dumps information rather than helping
// an executive decide. Mirrors report-isolation-validator.ts's fail-fast
// pattern (find* returns violations, assert* throws).

export type QualityGateFailure = {
  check: string;
  detail: string;
};

export type QualityGateInput = {
  sections: Record<string, string | undefined>;
  // The field that must render first and carry the Executive Recommendation
  // block (executiveSummary for Business Plan/Market Intelligence; the
  // first domain-analysis field for Strategic Advisory).
  firstField: string;
  // Fields whose job IS to carry source/citation material. These are
  // exempt from the "no long source list" scan on their OWN raw-URL count,
  // since they are expected to reference sources by category+count (an
  // Evidence Summary) -- but they are still checked for raw over-exposure
  // (a literal wall of URLs is still wrong even in a sources field).
  sourceFields?: string[];
};

// A field is a "long source dump" if it contains more raw URLs than a short
// Evidence Summary would ever need to name (a category list + one count
// line has zero URLs; this is a generous ceiling to avoid false positives
// on a section that legitimately cites 2-3 sources inline).
const MAX_RAW_URLS_PER_FIELD = 3;
const MAX_FILLER_RATIO = 0.15;
// "Page one, readable in 30 seconds" is about the OPENING of the first
// field -- the Executive Recommendation block itself (heading, decision,
// short answer, top reasons, top risks) -- not the entire field. The
// first field legitimately carries additional supporting summary content
// after that block (e.g. Market Intelligence's Bottom Line/Key Findings/
// entry strategy, or a confidence rollup appended later in the pipeline);
// none of that later content is what a reader needs for the 30-second
// verdict, so it must never count against this check. Bounding the excerpt
// to roughly 200 words (~1,100 characters, generous for the block's own
// heading + decision line + short answer + up to 3 reasons + up to 3
// risks) keeps the check anchored to what it is actually named after.
const OPENING_EXCERPT_CHARS = 1_100;
const MAX_OPENING_WORD_COUNT = 200;
// A field is considered to "add no decision value" once the vast majority
// of its substantive sentences are filler/duplicate -- this is
// deliberately looser than the report-wide 15% ceiling, since a single
// weak section shouldn't fail the whole gate unless it's dominated by
// filler.
const MAX_SECTION_FILLER_RATIO = 0.6;
const MIN_SUBSTANTIVE_SECTION_LENGTH = 40;

function countRawUrls(content: string) {
  return (content.match(/https?:\/\/\S+/g) || []).length;
}

function firstFieldHasExecutiveRecommendation(content: string) {
  const normalized = (content || "").trim();
  if (!normalized) return false;

  // Language-agnostic: checks for the *shape* (a decision line with a
  // confidence percentage near the top), not literal English words, so
  // this works for any of the five supported report languages.
  const opening = normalized.slice(0, 400);
  const hasConfidencePercent = /\b\d{1,3}\s*%/.test(opening);
  const hasDecisionLine = /:\s*\S+.*\(.*\d{1,3}\s*%/.test(opening) || /\n.*\d{1,3}\s*%/.test(opening);

  return hasConfidencePercent && hasDecisionLine;
}

export function runExecutiveQualityGate(input: QualityGateInput): QualityGateFailure[] {
  const { sections, firstField, sourceFields = [] } = input;
  const failures: QualityGateFailure[] = [];
  const firstContent = sections[firstField] || "";

  // 1 & 2: the first screen must open with a decision a CEO can act on --
  // a decision line with a stated confidence -- within roughly a page's
  // worth of text (long preambles before the verdict fail this by design).
  if (!firstFieldHasExecutiveRecommendation(firstContent)) {
    failures.push({
      check: "executive_decision_first",
      detail: `Field "${firstField}" does not open with a Decision + Confidence line within its first 400 characters.`,
    });
  } else {
    const openingExcerpt = firstContent.trim().slice(0, OPENING_EXCERPT_CHARS);
    const openingWordCount = openingExcerpt.split(/\s+/).length;
    if (openingWordCount > MAX_OPENING_WORD_COUNT) {
      failures.push({
        check: "page_one_readable_in_30_seconds",
        detail: `Field "${firstField}"'s opening is ${openingWordCount} words within its first ${OPENING_EXCERPT_CHARS} characters -- too long to reach a decision within a 30-second read.`,
      });
    }
  }

  // 3: no field may read as a raw source dump.
  for (const [field, content] of Object.entries(sections)) {
    if (!content) continue;
    const urlCount = countRawUrls(content);
    const isSourceField = sourceFields.includes(field);
    const limit = isSourceField ? MAX_RAW_URLS_PER_FIELD : 1;

    if (urlCount > limit) {
      failures.push({
        check: "no_long_source_lists",
        detail: `Field "${field}" exposes ${urlCount} raw URLs directly in the report body (limit ${limit}); use an Evidence Summary instead.`,
      });
    }
  }

  // 4: report-wide filler ceiling.
  const combinedContent = Object.values(sections).filter(Boolean).join("\n\n");
  const overallFillerRatio = computeFillerRatio(combinedContent);
  if (overallFillerRatio > MAX_FILLER_RATIO) {
    failures.push({
      check: "filler_ceiling",
      detail: `${Math.round(overallFillerRatio * 100)}% of report sentences are generic filler or duplicates (limit ${Math.round(MAX_FILLER_RATIO * 100)}%).`,
    });
  }

  // 5: every section must add decision value -- not empty, not
  // filler-dominated.
  for (const [field, content] of Object.entries(sections)) {
    if (field === firstField || sourceFields.includes(field)) continue;
    const trimmed = (content || "").trim();
    if (!trimmed) continue; // missing-field handling belongs to schema validation, not this gate

    if (trimmed.length < MIN_SUBSTANTIVE_SECTION_LENGTH) {
      failures.push({
        check: "every_section_adds_decision_value",
        detail: `Field "${field}" is too short (${trimmed.length} chars) to add decision value.`,
      });
      continue;
    }

    const sectionFillerRatio = computeFillerRatio(trimmed);
    if (sectionFillerRatio > MAX_SECTION_FILLER_RATIO) {
      failures.push({
        check: "every_section_adds_decision_value",
        detail: `Field "${field}" is ${Math.round(sectionFillerRatio * 100)}% filler/duplicate content.`,
      });
    }
  }

  return failures;
}

export class ExecutiveQualityGateError extends Error {
  failures: QualityGateFailure[];

  constructor(failures: QualityGateFailure[]) {
    const summary = failures.map((f) => `[${f.check}] ${f.detail}`).join("; ");
    super(`Executive quality gate failed (${failures.length} issue(s)): ${summary}`);
    this.name = "ExecutiveQualityGateError";
    this.failures = failures;
  }
}

// Fail fast instead of silently returning an information dump: throws
// ExecutiveQualityGateError if any of the 5 checks fail.
export function assertExecutiveQualityGate(input: QualityGateInput): void {
  const failures = runExecutiveQualityGate(input);
  if (failures.length > 0) {
    throw new ExecutiveQualityGateError(failures);
  }
}
