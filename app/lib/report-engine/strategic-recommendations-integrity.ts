// Structural completeness checks for the Strategic Recommendations /
// "First 90 Days" numbered action plan. The generation prompt
// (app/lib/report-engine/prompts/market.ts) requires exactly three
// numbered, measurable actions -- this module verifies the numbering
// itself is never broken (skipped/duplicated/truncated), which is true
// for ANY valid numbered list regardless of how many items the model
// wrote, and separately flags (without blocking) numbered items that
// look like they're missing the required geography/budget/KPI/success
// criterion specifics, since that check is inherently fuzzier free-text
// matching and not safe to hard-fail generation on.

const NUMBERED_ITEM_PATTERN = /(?:^|\n)\s*(\d{1,2})[.)]\s+([\s\S]+?)(?=\n\s*\d{1,2}[.)]\s+|$)/g;

export type StrategicRecommendationsIssue =
  | { type: "numbering_gap"; detail: string }
  | { type: "duplicate_number"; detail: string }
  | { type: "truncated_item"; detail: string }
  | { type: "missing_field"; detail: string };

export class StrategicRecommendationsStructureError extends Error {
  issues: StrategicRecommendationsIssue[];

  constructor(issues: StrategicRecommendationsIssue[]) {
    super(
      `Strategic Recommendations numbered action plan is structurally broken: ${issues
        .map((issue) => issue.detail)
        .join("; ")}`
    );
    this.name = "StrategicRecommendationsStructureError";
    this.issues = issues;
  }
}

function extractNumberedItems(content: string): Array<{ number: number; body: string }> {
  const items: Array<{ number: number; body: string }> = [];
  for (const match of content.matchAll(NUMBERED_ITEM_PATTERN)) {
    const number = Number.parseInt(match[1], 10);
    const body = match[2].trim();
    if (Number.isFinite(number)) {
      items.push({ number, body });
    }
  }
  return items;
}

const BUDGET_SIGNAL = /\$|€|£|budget|spend|cost ceiling|bütçe|harcama|budget[a-zäöü]*/i;
const KPI_SIGNAL = /\bkpi\b|metric|conversion|retention|pipeline|revenue|signups?|leads?|response rate|win rate|adoption/i;
const GEOGRAPHY_SIGNAL = /\b(north america|europe|u\.?s\.?|usa|uk|germany|france|spain|apac|emea|latam|region|segment|market|country|state|city)\b/i;
const SUCCESS_CRITERION_SIGNAL = /\bif\b|\bunless\b|threshold|criteri|success (?:is|means)|proceed if|continue if|>=|<=|%|\bat least\b|\btarget of\b/i;

// Only checks numbering integrity (hard-safe -- a numbered list is either
// sequential or it isn't, independent of report content/language/market)
// plus obviously truncated items. Field-presence is reported but never
// used to fail generation, since detecting "does this sentence name a
// budget" in free text across five languages is inherently approximate.
export function findStrategicRecommendationsStructureIssues(
  content: string
): StrategicRecommendationsIssue[] {
  const items = extractNumberedItems(content);
  if (items.length === 0) {
    // A valid AVOID-verdict report can legitimately contain zero numbered
    // actions (prose-only "no supported opportunity exists" explanation)
    // -- nothing to validate structurally in that case.
    return [];
  }

  const issues: StrategicRecommendationsIssue[] = [];
  const seen = new Set<number>();
  const numbers = items.map((item) => item.number);

  for (const number of numbers) {
    if (seen.has(number)) {
      issues.push({
        type: "duplicate_number",
        detail: `action item number ${number} appears more than once`,
      });
    }
    seen.add(number);
  }

  const sortedUnique = [...seen].sort((a, b) => a - b);
  if (sortedUnique[0] !== 1) {
    issues.push({
      type: "numbering_gap",
      detail: `numbered action list does not start at 1 (starts at ${sortedUnique[0]})`,
    });
  }
  for (let index = 1; index < sortedUnique.length; index += 1) {
    if (sortedUnique[index] !== sortedUnique[index - 1] + 1) {
      issues.push({
        type: "numbering_gap",
        detail: `numbered action list skips from ${sortedUnique[index - 1]} to ${sortedUnique[index]}`,
      });
    }
  }

  for (const item of items) {
    if (item.body.replace(/\s+/g, " ").trim().length < 20) {
      issues.push({
        type: "truncated_item",
        detail: `action item ${item.number} has no substantive content ("${item.body.slice(0, 40)}")`,
      });
    }
  }

  for (const item of items) {
    const missing: string[] = [];
    if (!GEOGRAPHY_SIGNAL.test(item.body)) missing.push("geography/segment");
    if (!BUDGET_SIGNAL.test(item.body)) missing.push("budget");
    if (!KPI_SIGNAL.test(item.body)) missing.push("KPI");
    if (!SUCCESS_CRITERION_SIGNAL.test(item.body)) missing.push("success criterion");
    if (missing.length > 0) {
      issues.push({
        type: "missing_field",
        detail: `action item ${item.number} may be missing: ${missing.join(", ")}`,
      });
    }
  }

  return issues;
}

const HARD_ISSUE_TYPES = new Set<StrategicRecommendationsIssue["type"]>([
  "numbering_gap",
  "duplicate_number",
  "truncated_item",
]);

// Only numbering/truncation issues are safe to hard-fail generation on --
// they're unambiguous regardless of language or market. missing_field
// issues are logged by the caller (soft signal), never thrown here.
export function assertStrategicRecommendationsNumbering(content: string): void {
  const issues = findStrategicRecommendationsStructureIssues(content).filter((issue) =>
    HARD_ISSUE_TYPES.has(issue.type)
  );
  if (issues.length > 0) {
    throw new StrategicRecommendationsStructureError(issues);
  }
}
