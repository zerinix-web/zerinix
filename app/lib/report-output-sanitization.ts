const internalResearchDiagnosticPattern =
  /(?:\bprovider_unavailable\b|\bcompleted_no_evidence\b|\brequest (?:was )?aborted\b|\bprovider disabled\b|\bresult\s*=\s*failed\b|\breason\s*=\s*request was aborted\b|\bresearch attempts?\b|\battempt\s*\||\bnext provider\b|\bsearch query\b|\b(?:provider|query|result|reason|status)\s*[:=|]|\b(?:stack trace|request payload|api response|execution log)\b|\b(?:tavily|perplexity|firecrawl|serper|exa)\b)/i;

export function isTurkishReportText(value: string) {
  return (
    /[çğıöşüÇĞİÖŞÜ]/.test(value) ||
    /\b(?:gayrimenkul|arsa|parsel|tapu|imar|doğrulan|yatırım|bilgi|belge)\b/i.test(
      value
    )
  );
}

export function sanitizeInternalResearchDiagnostics(
  content: string,
  includeBusinessSummary = true
) {
  const normalized = content.normalize("NFC").replace(/\r\n?/g, "\n");
  const seen = new Set<string>();
  let removedDiagnostic = false;
  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (internalResearchDiagnosticPattern.test(line)) {
        removedDiagnostic = true;
        return false;
      }

      const key = line
        .toLocaleLowerCase("tr")
        .replace(/\s+/g, " ")
        .trim();
      if (key && seen.has(key)) {
        return false;
      }
      if (key) {
        seen.add(key);
      }
      return true;
    });
  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!removedDiagnostic || !includeBusinessSummary) {
    return cleaned;
  }

  const summary = isTurkishReportText(normalized)
    ? "Bazı dış kaynaklar doğrulanamadığı için bu bölüm kesin sonuç içermiyor."
    : "Some external sources could not be verified, so this section does not contain a definitive conclusion.";

  return cleaned ? `${cleaned}\n\n${summary}` : summary;
}
