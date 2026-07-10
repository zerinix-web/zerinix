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
}
