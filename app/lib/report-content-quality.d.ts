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
