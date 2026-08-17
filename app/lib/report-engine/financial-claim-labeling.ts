export function labelModelDerivedFinancialClaims({
  content,
  metricValues,
  language,
  sourceContext,
}: {
  content: string;
  metricValues: readonly string[];
  language: "English" | "Turkish" | "German" | "French" | "Spanish";
  sourceContext: string;
}) {
  const copy = {
    English: {
      assumption: "Planning assumption",
      unspecifiedModel: "Unspecified business model",
      unavailable: "not provided; cannot be calculated from available evidence",
    },
    Turkish: {
      assumption: "Planlama varsayımı",
      unspecifiedModel: "Belirtilmemiş iş modeli",
      unavailable: "Mevcut verilerle hesaplanamadı",
    },
    German: {
      assumption: "Planungsannahme",
      unspecifiedModel: "Nicht angegebenes Geschäftsmodell",
      unavailable: "nicht angegeben; aus den verfügbaren Nachweisen nicht berechenbar",
    },
    French: {
      assumption: "Hypothèse de planification",
      unspecifiedModel: "Modèle économique non précisé",
      unavailable: "non fourni ; impossible à calculer à partir des éléments disponibles",
    },
    Spanish: {
      assumption: "Supuesto de planificación",
      unspecifiedModel: "Modelo de negocio no especificado",
      unavailable: "no proporcionado; no puede calcularse con la evidencia disponible",
    },
  }[language];
  const escapePattern = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = [...new Set(metricValues.map((value) => value.trim()).filter(Boolean))];
  const metricPattern = values.length
    ? new RegExp(values.map(escapePattern).join("|"), "i")
    : null;
  const assumptionLabel = copy.assumption;
  const userProvidedPattern =
    /(?:\bUser-provided\b|\bKullanıcı tarafından\b)/i;
  const planningEstimatePattern =
    /(?:\b(?:Estimated|Assumption|Planning assumption|Planungsannahme|Annahme|Hypothèse de planification|Hypothèse|Supuesto de planificación|Supuesto)\b|\b(?:Tahmin|Varsayım|Planlama varsayımı)\b)/i;
  const hasExplicitServiceModel =
    /\b(?:consulting|consultancy|agency|professional services?|service business|danışmanlık|ajans|profesyonel hizmet)\b/i.test(
      sourceContext
    );
  const planningScenarioRequested =
    /\b(?:scenario|forecast|projection|planning assumption|what if|senaryo|tahmin|projeksiyon|planlama varsayımı|szenario|prognose|scénario|prévision|escenario|proyección)\b/i.test(
      sourceContext
    );
  // Each category also carries what the founder should actually go
  // collect -- requirement 5 asks for why-missing plus what's-missing
  // plus what-to-collect-next in one clean sentence, not a bare label.
  const unavailableCopyForField = (fieldLabel: string) => {
    if (language !== "Turkish") {
      return copy.unavailable;
    }

    if (/\b(?:CAC|LTV|edinim|dönüşüm|geri ödeme|payback)\b/i.test(fieldLabel)) {
      return "gerçek müşteri edinimi ve elde tutma verisi bulunmadığı için hesaplanamıyor; kurucunun kanal başına edinim maliyeti ve kohort elde tutma kayıtlarını toplaması gerekir";
    }
    if (/\b(?:ARR|MRR|gelir|ciro|revenue)\b/i.test(fieldLabel)) {
      return "gerçekleşmiş gelir verisi bulunmadığı için hesaplanamıyor; kurucunun fatura/ödeme kayıtlarından gerçekleşmiş gelir verisini paylaşması gerekir";
    }
    if (/\b(?:TAM|SAM|SOM|pazar|market size)\b/i.test(fieldLabel)) {
      return "doğrulanmış pazar büyüklüğü verisi bulunmadığı için hesaplanamıyor; sektör raporu veya resmi istatistik gibi doğrulanmış kaynaklar gerekir";
    }
    if (/\b(?:runway|burn|funding|fonlama|finansman|gider|maliyet)\b/i.test(fieldLabel)) {
      return "güncel gider ve finansman verisi bulunmadığı için hesaplanamıyor; kurucunun güncel nakit pozisyonu ve aylık giderlerini paylaşması gerekir";
    }
    if (/\b(?:margin|marj|kârlılık|profit)\b/i.test(fieldLabel)) {
      return "gerçekleşmiş gelir ve maliyet verisi bulunmadığı için hesaplanamıyor; kurucunun birim maliyet ve satış fiyatı verisini paylaşması gerekir";
    }

    return "mevcut kanıtlarla hesaplanamıyor; doğrulanmış ek veri gerekir";
  };

  // Tracks which output lines are actually a generated unavailable-data
  // explanation (as opposed to an ordinary line -- e.g. "Industry
  // benchmark: X" / "Business model: X" -- that only happens to share
  // its value with an unrelated line). Only lines this function itself
  // generated are eligible for consolidation below; every other line
  // is left exactly as it already was, regardless of what it says.
  const generatedUnavailableLines = new Set<string>();

  const labeled = content
    .split("\n")
    .map((line) => {
      let normalizedLine = line;
      if (!hasExplicitServiceModel) {
        normalizedLine = normalizedLine.replace(
          /\bProfessional Services\b/gi,
          copy.unspecifiedModel
        );
      }
      if (!metricPattern?.test(normalizedLine)) {
        return normalizedLine;
      }
      const lineMetricValues = values.filter((value) =>
        normalizedLine.toLowerCase().includes(value.toLowerCase())
      );
      if (
        userProvidedPattern.test(normalizedLine) ||
        lineMetricValues.some((value) =>
          sourceContext.toLowerCase().includes(value.toLowerCase())
        )
      ) {
        return normalizedLine;
      }
      if (planningScenarioRequested) {
        return planningEstimatePattern.test(normalizedLine)
          ? normalizedLine
          : `${assumptionLabel} — ${normalizedLine}`;
      }

      const fieldLabel = normalizedLine.split(/\s*(?::|—)\s*/, 1)[0]?.trim();
      const result = fieldLabel
        ? `${fieldLabel}: ${unavailableCopyForField(fieldLabel)}`
        : copy.unavailable;
      generatedUnavailableLines.add(result);
      return result;
    });

  return consolidateRepeatedUnavailableLines(labeled, generatedUnavailableLines).join("\n");
}

// When the same evidence gap applies to several metrics in one section
// (e.g. CAC, LTV, and Payback all missing the same acquisition data),
// labeling each metric's line independently produced the identical
// explanation sentence repeated back-to-back -- exactly the "dozens of
// times" pattern this was asked to remove. This merges consecutive
// lines that this function itself generated as an unavailable-data
// explanation and that ended up with the exact same reason text into
// one line listing every affected metric together. Lines it did not
// generate are never touched, even if they coincidentally share the
// same trailing text as a generated line (e.g. two unrelated "label:
// value" lines whose values happen to be identical).
function consolidateRepeatedUnavailableLines(
  lines: string[],
  generatedUnavailableLines: Set<string>
): string[] {
  const result: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = generatedUnavailableLines.has(line)
      ? /^([^:\n]{1,80}):\s*(.+)$/.exec(line)
      : null;

    if (!match) {
      result.push(line);
      index += 1;
      continue;
    }

    const [, firstLabel, reason] = match;
    const labels = [firstLabel.trim()];
    let lookahead = index + 1;

    while (lookahead < lines.length && generatedUnavailableLines.has(lines[lookahead])) {
      const nextMatch = /^([^:\n]{1,80}):\s*(.+)$/.exec(lines[lookahead]);
      if (!nextMatch || nextMatch[2] !== reason) {
        break;
      }
      labels.push(nextMatch[1].trim());
      lookahead += 1;
    }

    result.push(labels.length > 1 ? `${labels.join(", ")}: ${reason}` : line);
    index = lookahead > index + 1 ? lookahead : index + 1;
  }

  return result;
}
