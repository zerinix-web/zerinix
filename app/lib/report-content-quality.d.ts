export function dedupeReportParagraphsAcrossSections<T extends Record<string, string>>(
  report: T
): T;

export function auditExecutiveReportContent(
  report: Record<string, string>,
  requiredFields: readonly string[],
  businessTerms?: readonly string[]
): {
  missingFields: string[];
  duplicateParagraphs: string[];
  recommendationMatchesBusiness: boolean;
};
