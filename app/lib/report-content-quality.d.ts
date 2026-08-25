export type InsightSignature = {
  fingerprint: string;
  tokens: Set<string>;
  numbers: Set<string>;
};

// Fuzzy, token-set-based semantic-similarity primitives underlying
// dedupeReportParagraphsAcrossSections -- exported so presentation-layer
// dedup (e.g. Market Intelligence's Executive Highlights card) can reuse
// the exact same "restatement, not just exact-string-match" detection
// instead of a separate, weaker heuristic.
export function createInsightSignature(value: string): InsightSignature;

export function describesSameInsight(
  current: InsightSignature,
  previous: InsightSignature
): boolean;

export function dedupeReportParagraphsAcrossSections<T extends Record<string, string>>(
  report: T,
  options?: {
    language?: string;
    sectionLabels?: Partial<Record<keyof T & string, string>>;
    excludedFields?: readonly (keyof T & string)[];
  }
): T;

export function estimateReportOutputTokens(
  report: Record<string, string>
): number;

export function measureReportTokenReduction(
  before: Record<string, string>,
  after: Record<string, string>
): {
  estimatedOutputTokensBefore: number;
  estimatedOutputTokensAfter: number;
  estimatedOutputTokensSaved: number;
  estimatedOutputTokenReductionPercent: number;
};

export function auditExecutiveReportContent(
  report: Record<string, string>,
  requiredFields: readonly string[],
  businessTerms?: readonly string[]
): {
  missingFields: string[];
  duplicateParagraphs: string[];
  recommendationMatchesBusiness: boolean;
};
