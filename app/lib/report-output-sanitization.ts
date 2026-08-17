const internalResearchDiagnosticPattern =
  /(?:\bprovider_unavailable\b|\bcompleted_no_evidence\b|\brequest (?:was )?aborted\b|\bprovider disabled\b|\bresult\s*=\s*failed\b|\breason\s*=\s*request was aborted\b|\bresearch attempts?\b|\battempt\s*\||\bnext provider\b|\bsearch query\b|\b(?:provider|query|result|reason|status)\s*[:=|]|\b(?:stack trace|request payload|api response|execution log)\b|\b(?:tavily|perplexity|firecrawl|serper|exa)\b)/i;

const internalRoutingMetadataPattern =
  /^\s*(?:(?:ZERINIX validated request context|validated request context|Private expertise routing context|prompt diagnostics|planner\/debug metadata|routing metadata|execution metadata|Conversation Context|Current Session|Analysis Type|Recent Outputs|developer\/debug panel)\b|(?:[-*•]\s*)?(?:Likely domain|Likely content type|Inferred decision goal|Unresolved information|Classified user intent|Selected expert|Authoritative user-selected mode|Expert perspective|Domain scope|Jurisdiction or geography|User goal|Required analysis|Decision criteria|Required evidence|Forbidden analysis topics|Critical clarifications|Profile confidence|Internal asset identifiers?|Asset identifiers?|Routing metadata|Execution metadata)\s*:)/i;

export function sanitizeInternalRoutingMetadata(content: string) {
  return content
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !internalRoutingMetadataPattern.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ö/ü/Ö/Ü are deliberately excluded from this character class -- they are
// ordinary German letters (für, Bereichsübergreifende, Warentransport),
// not Turkish-exclusive ones. Confirmed live: an English-language Market
// Intelligence report analyzing the German market cites German-language
// source titles/publishers in its Sources bibliography, and that alone
// (no Turkish text anywhere in the report) made this function return
// true -- forcibly relabeling the deterministic, hardcoded-English
// bibliography's own "Sources"/"Confidence:" field labels into
// "Kaynaklar"/"Güven:", corrupting every citation's structure. ç/ğ/ı/ş/İ
// (and their uppercase forms) are Turkish-exclusive among this app's
// supported report languages (en/tr/de/fr/es) and remain a reliable
// signal on their own.
export function isTurkishReportText(value: string) {
  return (
    /[çğışÇĞİŞ]/.test(value) ||
    /\b(?:gayrimenkul|arsa|parsel|tapu|imar|doğrulan|yatırım|bilgi|belge)\b/i.test(
      value
    )
  );
}

const turkishUserFacingPhrasePairs: Array<[RegExp, string]> = [
  [/\bExecutive Summary\b/gi, "Yönetici Özeti"],
  [/\bExecutive Recommendation\b/gi, "Yönetici Tavsiyesi"],
  [/\bFinal Recommendation\b/gi, "Nihai Tavsiye"],
  [/\bRecommendation\b/gi, "Tavsiye"],
  [/\bDecision Rationale\b/gi, "Karar Gerekçesi"],
  [/\bFinal Decision\b/gi, "Nihai Karar"],
  [/\bDecision\b(?=\s*[:：\-–—])/gi, "Karar"],
  [/\bImmediate Actions?\b/gi, "Acil Adımlar"],
  [/\bNext Actions?\b/gi, "Sonraki Adımlar"],
  [/\bRecommended Actions?\b/gi, "Önerilen Adımlar"],
  [/\bKey Reasons?\b/gi, "Temel Gerekçeler"],
  [/\bKey Risks?\b/gi, "Temel Riskler"],
  [/\bTop Risks?\b/gi, "Öncelikli Riskler"],
  [/\bTop Opportunities?\b/gi, "Öncelikli Fırsatlar"],
  [/\bKey Findings?\b/gi, "Temel Bulgular"],
  [/\bRisk Assessment\b/gi, "Risk Değerlendirmesi"],
  [/\bEvidence Assessment\b/gi, "Kanıt Değerlendirmesi"],
  [/\bSupporting Evidence\b/gi, "Destekleyici Kanıtlar"],
  [/\bMissing Evidence\b/gi, "Eksik Kanıtlar"],
  [/\bMissing Information\b/gi, "Eksik Bilgiler"],
  [/\bEvidence Gaps?\b/gi, "Kanıt Boşlukları"],
  [/\bSources\b(?=\s*[:：\-–—]?\s*(?:$|\n))/gim, "Kaynaklar"],
  [/\bMethodology\b/gi, "Yöntem"],
  [/\bInvestment Score\b/gi, "Yatırım Skoru"],
  [/\bRisk Level\b/gi, "Risk Seviyesi"],
  [/\bMain Risk\b/gi, "Ana Risk"],
  [/\bMain Opportunity\b/gi, "Ana Fırsat"],
  [/\bConfidence\b(?=\s*[:：\-–—])/gi, "Güven"],
  [/\bWhy\b(?=\s*[:：\-–—])/gi, "Gerekçe"],
  [/\bValidation Required\b/gi, "Doğrulama Gerekli"],
  [/\bAI Analysis\b/gi, "Model çıkarımı"],
  [/\bEstimated\b/gi, "Yaklaşık"],
  [/\bNot provided\b/gi, "Belirtilmemiş"],
  [/\bNot available\b/gi, "Doğrulanmış veri mevcut değil"],
  [/\bUnknown\b/gi, "Henüz doğrulanmadı"],
  [/\bShould proceed\b/gi, "İlerlenebilir"],
  [/\bHold for validation\b/gi, "Doğrulama Tamamlanana Kadar Bekle"],
  [/\b(?:Hold|Wait)\b/gi, "Bekle"],
];

const rawMissingValuePattern =
  /^(\s*(?:[-*•]\s*)?)([^:\n]{2,80})\s*:\s*(?:null|undefined|n\/?a|none|unknown|not provided|not available|[-–—])\s*$/i;

function contextualTurkishMissingValue(label: string) {
  if (/(?:fiyat|değer|değerleme|emsal|m²|metrekare|gelir|ciro|maliyet|oran|skor|tam|sam|som)/i.test(label)) {
    return "Yeterli veri olmadığı için hesaplanamadı";
  }
  if (/(?:hedef|amaç|bütçe|tercih|beklenti|süre|vade)/i.test(label)) {
    return "Kullanıcı tarafından belirtilmemiş";
  }
  if (/(?:kaynak|url|bağlantı|belge|kayıt|ruhsat|tapu|imar)/i.test(label)) {
    return "Doğrulanmış kayıt mevcut değil";
  }
  if (/(?:tarih|dönem|konum|adres|bölge)/i.test(label)) {
    return "Mevcut bilgilerden doğrulanamadı";
  }

  return "Bu değerlendirme için yeterli bilgi yok";
}

function naturalizeRawMissingValue(line: string) {
  const match = line.match(rawMissingValuePattern);
  if (!match) {
    return line.replace(/\b(?:null|undefined)\b/gi, "");
  }

  const label = match[2].trim();
  return `${match[1]}${label}: ${contextualTurkishMissingValue(label)}`;
}

function naturalizeTurkishUnavailableLine(line: string) {
  if (
    /(?:yeterli veri olmadığı için hesaplanamadı|gerçekleşmiş gelir verisi bulunmadığı için hesaplanamadı|doğrulanmış pazar verisi olmadan hesaplanamaz|gelir ve maliyet verisi olmadan hesaplanamaz)/i.test(
      line
    )
  ) {
    return line;
  }

  const repeatedUnavailable =
    /(?:sağlanmadı\s*[;,.]?\s*)?(?:mevcut\s+kanıtlardan\s+)?(?:hesaplanamaz|hesaplanamadı)/i;

  if (!repeatedUnavailable.test(line)) {
    return line;
  }

  const replacement = /(?:değerleme|fiyat|emsal|piyasa değeri)/i.test(line)
    ? "Yeterli doğrulanmış veri yok"
    : /(?:kullanıcı|hedef|bütçe|fiyat beklentisi)/i.test(line)
      ? "Kullanıcı bilgisi gerekli"
      : /(?:kaynak|araştırma|doğrulama)/i.test(line)
        ? "Ek araştırma gerekiyor"
        : /(?:oran|tutar|metrik|tam|sam|som|gelir|maliyet)/i.test(line)
          ? "Hesaplanamadı"
          : "Veri bulunamadı";

  return line
    .replace(repeatedUnavailable, replacement)
    .replace(
      /^(\s*(?:değerleme|fiyat|emsal değer|tam|sam|som|gelir|maliyet|metrik))\s+(Veri bulunamadı|Hesaplanamadı|Yeterli doğrulanmış veri yok|Kullanıcı bilgisi gerekli|Ek araştırma gerekiyor)/i,
      "$1: $2"
    );
}

function removeTurkishPlaceholderMetrics(value: string) {
  return value.replace(
    /(^|\n)(\s*(?:[-*•]\s*)?)(TAM|SAM|SOM)\s*[:=]\s*(?:[0-3](?:[.,]0+)?|[-–—]|N\/?A)(?=\s*(?:$|\n|[.;,]))/gi,
    "$1$2$3: Hesaplanamadı"
  );
}

export function polishTurkishUserFacingOutput(content: string) {
  if (!isTurkishReportText(content)) {
    return content;
  }

  const contextualized = content.split("\n").map(naturalizeRawMissingValue).join("\n");
  const localized = turkishUserFacingPhrasePairs.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    contextualized
  );

  const seenUnavailableLines = new Set<string>();

  return removeTurkishPlaceholderMetrics(localized)
    .split("\n")
    .map(naturalizeTurkishUnavailableLine)
    .filter((line) => {
      if (!/(?:hesaplanamadı|hesaplanamaz|yeterli bilgi yok|doğrulanmış (?:veri|kayıt) mevcut değil|mevcut bilgilerden doğrulanamadı)/i.test(line)) {
        return true;
      }

      const key = line
        .replace(/^\s*(?:[-*•]\s*)?[^:]{2,80}:\s*/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("tr");
      if (seenUnavailableLines.has(key)) {
        return false;
      }
      seenUnavailableLines.add(key);
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeInternalResearchDiagnostics(
  content: string,
  includeBusinessSummary = true
) {
  const normalized = polishTurkishUserFacingOutput(
    sanitizeInternalRoutingMetadata(content)
  );
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
