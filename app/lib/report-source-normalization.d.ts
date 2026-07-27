export type ReportSourceNormalizationOptions = {
  language?: "English" | "Turkish";
  allowExternalCitations?: boolean;
};

export function normalizeReportSourceSection(
  content: string,
  options?: ReportSourceNormalizationOptions
): string;
