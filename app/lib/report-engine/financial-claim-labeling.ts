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
  const unavailableCopyForField = (fieldLabel: string) => {
    if (language !== "Turkish") {
      return copy.unavailable;
    }

    if (/\b(?:CAC|LTV|edinim|dönüşüm|geri ödeme|payback)\b/i.test(fieldLabel)) {
      return "Gerçek müşteri edinimi ve gelir verisi gerekli";
    }
    if (/\b(?:ARR|MRR|gelir|ciro|revenue)\b/i.test(fieldLabel)) {
      return "Gerçekleşmiş gelir verisi bulunmadığı için hesaplanamadı";
    }
    if (/\b(?:TAM|SAM|SOM|pazar|market size)\b/i.test(fieldLabel)) {
      return "Doğrulanmış pazar verisi olmadan hesaplanamaz";
    }
    if (/\b(?:runway|burn|funding|fonlama|finansman|gider|maliyet)\b/i.test(fieldLabel)) {
      return "Gider ve finansman verisi gerekli";
    }
    if (/\b(?:margin|marj|kârlılık|profit)\b/i.test(fieldLabel)) {
      return "Gelir ve maliyet verisi olmadan hesaplanamaz";
    }

    return copy.unavailable;
  };

  return content
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
      return fieldLabel
        ? `${fieldLabel}: ${unavailableCopyForField(fieldLabel)}`
        : copy.unavailable;
    })
    .join("\n");
}
