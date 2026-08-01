declare module "@/app/lib/pdf-normalization.mjs" {
  type PdfLocale = "en" | "tr" | "de" | "fr" | "es";
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
  export function cleanPdfLegacyValidationIntelligenceContent(value?: string): string;
  export function extractPdfValidationIntelligenceSection<T extends { field?: string; title: string; content: string }>(
    sections?: T[],
    locale?: PdfLocale
  ): Array<T | { field: string; title: string; content: string }>;
  export function detectPdfPresentationLocale(value?: string): PdfLocale;
  export function resolvePdfPresentationLocale(explicitLanguage?: unknown, value?: string): PdfLocale;
  export function localizePdfPresentationLabel(value?: string, locale?: PdfLocale): string;
  export function localizePdfPresentationText(value?: string, locale?: PdfLocale): string;
  export function createPdfBenchmarkIntelligenceSection(
    benchmarkFit?: unknown,
    locale?: PdfLocale,
    benchmarkScore?: unknown
  ): { field: string; title: string; content: string } | null;
  export function insertPdfBenchmarkIntelligenceSection<T extends { field?: string; title: string; content: string }>(
    sections?: T[],
    benchmarkFit?: unknown,
    locale?: PdfLocale,
    benchmarkScore?: unknown
  ): Array<T | { field: string; title: string; content: string }>;
  export function localizePdfReportSections<T extends { title: string; content: string }>(
    sections?: T[],
    locale?: PdfLocale
  ): T[];
}
