const executiveRecommendationLabels = {
  investmentNeeded: [
    "Investment Needed",
    "Funding Required",
    "Capital Required",
    "Initial Investment",
    "Yatırım İhtiyacı",
    "Gerekli Yatırım",
    "Sermaye İhtiyacı",
    "Başlangıç Sermayesi",
  ],
  nextAction: [
    "Next Action",
    "Next Critical Action",
    "Recommended Next Step",
    "Immediate Next Step",
    "Sonraki Aksiyon",
    "Sonraki Kritik Aksiyon",
    "Önerilen Sonraki Adım",
    "İlk Adım",
  ],
  mainRisk: [
    "Main Risk",
    "Primary Risk",
    "Key Risk",
    "Biggest Risk",
    "Ana Risk",
    "Temel Risk",
    "Başlıca Risk",
    "En Büyük Risk",
  ],
};

const executiveRecommendationFallbacks = {
  en: {
    investmentNeeded: "Validation budget and initial operating capital required.",
    nextAction: "Validate demand with target customers before scaling.",
    mainRisk: "Customer demand and unit economics are not yet fully validated.",
  },
  tr: {
    investmentNeeded: "Doğrulama bütçesi ve başlangıç işletme sermayesi gerekiyor.",
    nextAction: "Ölçeklemeden önce hedef müşterilerle talebi doğrulayın.",
    mainRisk: "Müşteri talebi ve birim ekonomileri henüz tam doğrulanmadı.",
  },
};

const unsafePresentationText =
  /\b(?:debug reason|report id|internal id|implementation detail|developer instruction|system prompt)\b/i;
const recommendationMetadataLine =
  /^(?:decision|recommendation|confidence|karar|tavsiye|güven)\s*[:\-–—]/i;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDisplayValue(value) {
  const cleaned = String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned === "—" || unsafePresentationText.test(cleaned)) {
    return "";
  }

  if (cleaned.length <= 180) {
    return cleaned;
  }

  const conciseSentence = cleaned
    .slice(0, 181)
    .match(/^(.{24,180}?[.!?])(?:\s|$)/)?.[1];

  return conciseSentence || `${cleaned.slice(0, 177).trimEnd()}…`;
}

function extractLabeledValue(content, labels) {
  for (const label of labels) {
    const escapedLabel = escapeRegex(label);
    const match = content.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[:\\-–—]\\s*([^\\n]+)`,
        "i"
      )
    );
    const value = cleanDisplayValue(match?.[1]);

    if (value) {
      return value;
    }
  }

  return "";
}

function deriveFromReportContent(content, keywords, labels) {
  const labelPattern = new RegExp(
    `^(?:${labels.map(escapeRegex).join("|")})\\s*[:\\-–—]\\s*`,
    "i"
  );
  const lines = content
    .split(/\n+/)
    .filter((line) => !recommendationMetadataLine.test(line.trim().replace(/\*\*/g, "")))
    .map((line) =>
      cleanDisplayValue(
        line
          .replace(/^\s*[-*•]\s+/, "")
          .replace(labelPattern, "")
      )
    )
    .filter(Boolean);

  return (
    lines.find((line) =>
      keywords.some((keyword) => line.toLocaleLowerCase().includes(keyword))
    ) || ""
  );
}

export function getExecutiveRecommendationDisplayMetrics(content, locale = "en") {
  const normalizedLocale = locale === "tr" ? "tr" : "en";
  const fallbacks = executiveRecommendationFallbacks[normalizedLocale];
  const investmentNeeded =
    extractLabeledValue(content, executiveRecommendationLabels.investmentNeeded) ||
    deriveFromReportContent(
      content,
      normalizedLocale === "tr"
        ? ["yatırım", "sermaye", "bütçe", "finansman"]
        : ["investment", "capital", "budget", "funding"],
      executiveRecommendationLabels.investmentNeeded
    ) ||
    fallbacks.investmentNeeded;
  const nextAction =
    extractLabeledValue(content, executiveRecommendationLabels.nextAction) ||
    deriveFromReportContent(
      content,
      normalizedLocale === "tr"
        ? ["doğrula", "pilot", "sonraki", "aksiyon", "müşteri"]
        : ["validate", "pilot", "next", "action", "customer"],
      executiveRecommendationLabels.nextAction
    ) ||
    fallbacks.nextAction;
  const mainRisk =
    extractLabeledValue(content, executiveRecommendationLabels.mainRisk) ||
    deriveFromReportContent(
      content,
      normalizedLocale === "tr"
        ? ["risk", "tehdit", "belirsiz", "doğrulan"]
        : ["risk", "threat", "uncertain", "unvalidated"],
      executiveRecommendationLabels.mainRisk
    ) ||
    fallbacks.mainRisk;

  return {
    investmentNeeded,
    nextAction,
    mainRisk,
  };
}
