declare module "@/app/lib/pdf-normalization.mjs" {
  export function normalizePdfText(value: string): string;
  export function preservePdfInlineTokens(value: string): string;
  export function cleanPdfContinuationFragment(value: string): string;
  export function shouldJoinPdfLineFragment(previousLine: string, currentLine: string): boolean;
  export function joinPdfLineFragment(previousLine: string, currentLine: string): string;
  export function repairPdfLineFragments(
    lines: string[],
    isOrphanBulletText?: (value: string) => boolean
  ): string[];
  export function normalizePdfSourceDomain(value?: string): string;
  export function normalizePdfSourceContent(content?: string): string;
  export function normalizePdfTamSamSomOwnershipContent(
    content?: string,
    section?: { field?: string; title?: string }
  ): string;
  export function normalizePdfCanonicalTamSamSomContent(content?: string): string;
  export function normalizePdfTamSamSomBodyContent(content?: string): string;
  export function normalizePdfFinancialSectionContent(
    content?: string,
    section?: { field?: string; title?: string }
  ): string;
  export function detectPdfPresentationLocale(value?: string): "en" | "tr";
  export function localizePdfPresentationLabel(value?: string, locale?: "en" | "tr"): string;
  export function localizePdfPresentationText(value?: string, locale?: "en" | "tr"): string;
  export function createPdfBenchmarkIntelligenceSection(
    benchmarkFit?: unknown,
    locale?: "en" | "tr",
    benchmarkScore?: unknown
  ): { field: string; title: string; content: string } | null;
  export function insertPdfBenchmarkIntelligenceSection<T extends { field?: string; title: string; content: string }>(
    sections?: T[],
    benchmarkFit?: unknown,
    locale?: "en" | "tr",
    benchmarkScore?: unknown
  ): Array<T | { field: string; title: string; content: string }>;
  export function localizePdfReportSections<T extends { title: string; content: string }>(
    sections?: T[],
    locale?: "en" | "tr"
  ): T[];
}
