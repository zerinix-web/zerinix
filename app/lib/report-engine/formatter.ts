import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  containsReportGenerationFailure,
  isReportGenerationFailureText,
} from "@/app/lib/report-errors";
import { dedupeReportSections } from "@/app/lib/report-section-normalization";
import type { ReportFieldDefinition, ReportSectionPayload } from "./schema";

export function sanitizeReportContent(content: string) {
  return sanitizeAiResponseText(content)
    .replace(/\n\s*(?:sources|kaynaklar)\s*:[\s\S]*$/im, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^\s)]+\)/gi, "$1")
    .replace(/(?:https?:\/\/|www\.)[^\s),]+/gi, "")
    .replace(/\bEarly evidence\b/gi, "Directional")
    .replace(/\bDeveloping evidence\b/gi, "Developing")
    .replace(/\bStrong evidence\b/gi, "Verified")
    .replace(/\bSector view\b/gi, "Market view")
    .replace(/\bLow[\s-]+Confidence\b/gi, "Directional")
    .replace(/\bMedium[\s-]+Confidence\b/gi, "Developing")
    .replace(/\bHigh[\s-]+Confidence\b/gi, "Verified")
    .replace(/\bIndustry[\s-]+Estimate\b/gi, "Market view")
    .replace(/\bWAIT\b/g, "Hold for validation")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function sanitizeReportFieldContent<TReport extends object>(
  field: keyof TReport & string,
  content: string
) {
  if (field === "sources" || field === "sourcesAssumptions") {
    return sanitizeAiResponseText(content)
      .normalize("NFC")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\bSource\s+unavailable\b/gi, "")
      .replace(/\bConfidence\s+unavailable\b/gi, "")
      .replace(/\bT\s*B\s*D\b/gi, "")
      .replace(/\bPlace\s*holder\b/gi, "")
      .replace(/\bUn\s*known\b/gi, "")
      .replace(/\bUn\s*available\b/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return sanitizeReportContent(content);
}

export function serializeReportSections<TReport extends object>(
  reportData: Partial<TReport>,
  fields: Array<ReportFieldDefinition<keyof TReport & string>>
) {
  const sections = dedupeReportSections(
    fields.map(({ field, title }) => ({
      field,
      title,
      content: sanitizeReportFieldContent<TReport>(
        field,
        String(reportData[field] || "")
      ),
    }))
  );

  const invalidSection = sections.find(
    (section) =>
      !section.content ||
      isReportGenerationFailureText(section.content)
  );

  if (invalidSection) {
    throw new Error(
      invalidSection.content && isReportGenerationFailureText(invalidSection.content)
        ? invalidSection.content
        : `Report section "${invalidSection.title}" was empty after sanitization.`
    );
  }

  return sections;
}

export function isCompleteReportSectionPayload(
  sections: ReportSectionPayload[],
  expectedSectionCount: number
) {
  return (
    sections.length === expectedSectionCount &&
    sections.every((section) => section.title.trim() && section.content.trim()) &&
    !containsReportGenerationFailure(sections)
  );
}
