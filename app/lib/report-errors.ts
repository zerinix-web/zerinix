export const reportGenerationFailurePatterns = [
  /daily ai usage limit reached/i,
  /too many requests/i,
  /usage limit/i,
  /rate limit/i,
  /limit reached/i,
  /quota/i,
  /quota exceeded/i,
  /provider error/i,
  /openai error/i,
  /model error/i,
  /request failed/i,
  /generation failed/i,
  /generation failure/i,
  /report generation failed/i,
  /failed to generate/i,
  /could not be generated/i,
  /could not generate/i,
  /something went wrong/i,
  /service unavailable/i,
  /timeout/i,
  /timed out/i,
  /aborted/i,
  /network error/i,
  /failed to fetch/i,
  /ai output could not be received/i,
  /this section is waiting for ai output/i,
  /bir hata oluştu/i,
  /pazar analizi sırasında bir hata oluştu/i,
  /rapor oluşturulamadı/i,
  /oluşturma başarısız/i,
  /zaman aşımı/i,
  /kota/i,
  /bu bölüm için ai çıktısı alınamadı/i,
  /bu bölüm için ai çıktısı bekleniyor/i,
];

export function isReportGenerationFailureText(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = normalized.toLowerCase().replace(/[^a-z0-9çğıöşü]+/gi, "");

  if (!normalized) {
    return false;
  }

  return (
    reportGenerationFailurePatterns.some((pattern) => pattern.test(normalized)) ||
    compact.includes("dailyaiusagelimitreached") ||
    compact.includes("toomanyrequests") ||
    compact.includes("usagelimit") ||
    compact.includes("ratelimit") ||
    compact.includes("quotaexceeded") ||
    compact.includes("providererror") ||
    compact.includes("generationfailed") ||
    compact.includes("requestfailed")
  );
}

export function containsReportGenerationFailure(
  sections: Array<{ content: string }>
) {
  return sections.some((section) => isReportGenerationFailureText(section.content));
}
