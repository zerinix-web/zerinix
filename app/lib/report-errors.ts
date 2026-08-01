export const reportGenerationFailurePatterns = [
  /daily ai usage limit reached/i,
  /too many requests/i,
  /usage limit/i,
  /rate limit/i,
  /limit reached/i,
  /quota exceeded/i,
  /insufficient quota/i,
  /\b(?:ai|openai|provider|usage|request|daily|monthly)\s+quota\s+(?:reached|exceeded|limit)/i,
  /\bquota\s+(?:reached|exceeded|limit)/i,
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

export const reportAdvisoryWarningPatterns = [
  /\bprovider_unavailable\b/i,
  /\bcompleted_no_evidence\b/i,
  /\bmissing (?:evidence|document|documents|information)\b/i,
  /\brequired (?:document|documents|evidence|record|records)\b/i,
  /\b(?:provider request|research provider)\b[^\n]{0,80}\b(?:aborted|timed out|unavailable)\b/i,
  /\bverification (?:failed|unavailable|incomplete)\b/i,
  /\bcould not be verified\b/i,
  /\bnot externally verified\b/i,
  /\bdoğrulanam(?:adı|ayan)\b/i,
  /\beksik (?:kanıt|belge|bilgi)\b/i,
  /\bgerekli (?:belge|kanıt|kayıt)\b/i,
];

export function isReportAdvisoryWarningText(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    Boolean(normalized) &&
    reportAdvisoryWarningPatterns.some((pattern) => pattern.test(normalized))
  );
}

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

  if (isReportAdvisoryWarningText(normalized)) {
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
