export const reportLanguageCodes = ["en", "tr", "de", "fr", "es"] as const;

export type ReportLanguageCode = (typeof reportLanguageCodes)[number];
export type ResponseLanguage = "English" | "Turkish" | "German" | "French" | "Spanish";

const languageNames: Record<ReportLanguageCode, ResponseLanguage> = {
  en: "English",
  tr: "Turkish",
  de: "German",
  fr: "French",
  es: "Spanish",
};

const languageCodes: Record<ResponseLanguage, ReportLanguageCode> = {
  English: "en",
  Turkish: "tr",
  German: "de",
  French: "fr",
  Spanish: "es",
};

export type ReportCopyKey =
  | "report"
  | "executiveSummary"
  | "decision"
  | "buy"
  | "wait"
  | "avoid"
  | "confidenceScore"
  | "mainRisk"
  | "risks"
  | "recommendations"
  | "nextAction"
  | "evidence"
  | "sources"
  | "source"
  | "warnings"
  | "missingInformation"
  | "legalAssessment"
  | "accessDate"
  | "reliability"
  | "page";

const copy: Record<ReportLanguageCode, Record<ReportCopyKey, string>> = {
  en: { report: "Report", executiveSummary: "Executive Summary", decision: "Decision", buy: "BUY", wait: "WAIT", avoid: "AVOID", confidenceScore: "Confidence Score", mainRisk: "Main Risk", risks: "Risks", recommendations: "Recommendations", nextAction: "Next Action", evidence: "Evidence", sources: "Sources", source: "Source", warnings: "Warnings", missingInformation: "Missing Information", legalAssessment: "Legal Assessment", accessDate: "Access date", reliability: "Reliability", page: "Page" },
  tr: { report: "Rapor", executiveSummary: "Yönetici Özeti", decision: "Karar", buy: "AL", wait: "BEKLE", avoid: "KAÇIN", confidenceScore: "Güven Skoru", mainRisk: "Ana Risk", risks: "Riskler", recommendations: "Öneriler", nextAction: "Sonraki Adım", evidence: "Kanıt", sources: "Kaynaklar", source: "Kaynak", warnings: "Uyarılar", missingInformation: "Eksik Bilgiler", legalAssessment: "Hukuki Değerlendirme", accessDate: "Erişim tarihi", reliability: "Güvenilirlik", page: "Sayfa" },
  de: { report: "Bericht", executiveSummary: "Zusammenfassung", decision: "Entscheidung", buy: "KAUFEN", wait: "ABWARTEN", avoid: "MEIDEN", confidenceScore: "Konfidenzwert", mainRisk: "Hauptrisiko", risks: "Risiken", recommendations: "Empfehlungen", nextAction: "Nächster Schritt", evidence: "Nachweise", sources: "Quellen", source: "Quelle", warnings: "Warnhinweise", missingInformation: "Fehlende Informationen", legalAssessment: "Rechtliche Bewertung", accessDate: "Zugriffsdatum", reliability: "Verlässlichkeit", page: "Seite" },
  fr: { report: "Rapport", executiveSummary: "Synthèse exécutive", decision: "Décision", buy: "ACHETER", wait: "ATTENDRE", avoid: "ÉVITER", confidenceScore: "Indice de confiance", mainRisk: "Risque principal", risks: "Risques", recommendations: "Recommandations", nextAction: "Prochaine action", evidence: "Éléments probants", sources: "Sources", source: "Source", warnings: "Avertissements", missingInformation: "Informations manquantes", legalAssessment: "Évaluation juridique", accessDate: "Date de consultation", reliability: "Fiabilité", page: "Page" },
  es: { report: "Informe", executiveSummary: "Resumen ejecutivo", decision: "Decisión", buy: "COMPRAR", wait: "ESPERAR", avoid: "EVITAR", confidenceScore: "Índice de confianza", mainRisk: "Riesgo principal", risks: "Riesgos", recommendations: "Recomendaciones", nextAction: "Siguiente acción", evidence: "Evidencia", sources: "Fuentes", source: "Fuente", warnings: "Advertencias", missingInformation: "Información faltante", legalAssessment: "Evaluación jurídica", accessDate: "Fecha de acceso", reliability: "Fiabilidad", page: "Página" },
};

export function normalizeReportLanguage(value: unknown): ReportLanguageCode | null {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  const base = raw.split("-")[0];
  if (reportLanguageCodes.includes(base as ReportLanguageCode)) return base as ReportLanguageCode;
  const named = Object.entries(languageCodes).find(([name]) => name.toLowerCase() === raw);
  return named?.[1] || null;
}

function scoreReportLanguages(text: string) {
  const value = ` ${String(text || "").toLowerCase()} `;
  const scores: Record<ReportLanguageCode, number> = { en: 0, tr: 0, de: 0, fr: 0, es: 0 };
  const signals: Record<ReportLanguageCode, RegExp[]> = {
    tr: [/[çğıöşü]/g, /\b(?:ve|bir|için|ile|yatırım|istiyorum|nedir|nasıl|rapor|hukuk)\b/g],
    de: [/[äöüß]/g, /\b(?:und|der|die|das|für|mit|ich|möchte|bericht|risiko|entscheidung)\b/g],
    fr: [/[àâçéèêëîïôûùüÿœ]/g, /\b(?:et|le|la|les|pour|avec|je|souhaite|rapport|risque|décision)\b/g],
    es: [/[áéíóúñ¿¡]/g, /\b(?:y|el|la|los|para|con|quiero|informe|riesgo|decisión)\b/g],
    en: [/\b(?:and|the|for|with|i|want|report|risk|decision|analysis)\b/g],
  };
  for (const code of reportLanguageCodes) {
    scores[code] = signals[code].reduce((total, pattern) => total + (value.match(pattern)?.length || 0), 0);
  }
  return scores;
}

export function detectReportLanguage(text: string): ReportLanguageCode {
  const scores = scoreReportLanguages(text);
  const ranked = [...reportLanguageCodes].sort((left, right) => scores[right] - scores[left]);
  return scores[ranked[0]] > 0 ? ranked[0] : "en";
}

export function resolveReportLanguage(input: {
  explicitLanguage?: unknown;
  uiLanguage?: unknown;
  browserLanguage?: unknown;
  requestText?: string;
}): ReportLanguageCode {
  const requestText = input.requestText || "";
  const requestScores = scoreReportLanguages(requestText);
  const detectedRequestLanguage = Object.values(requestScores).some((score) => score > 0)
    ? detectReportLanguage(requestText)
    : null;
  return normalizeReportLanguage(input.explicitLanguage)
    || detectedRequestLanguage
    || normalizeReportLanguage(input.uiLanguage)
    || normalizeReportLanguage(input.browserLanguage)
    || "en";
}

export function getResponseLanguage(code: ReportLanguageCode): ResponseLanguage {
  return languageNames[code];
}

export function getReportLanguageCode(language: ResponseLanguage | ReportLanguageCode): ReportLanguageCode {
  return normalizeReportLanguage(language) || "en";
}

export function reportCopy(language: ResponseLanguage | ReportLanguageCode, key: ReportCopyKey) {
  return copy[getReportLanguageCode(language)][key];
}

export function localizeReportDecision(value: string, language: ResponseLanguage | ReportLanguageCode) {
  const key = /^(?:BUY|AL|KAUFEN|ACHETER|COMPRAR)$/i.test(value) ? "buy"
    : /^(?:AVOID|KAÇIN|MEIDEN|ÉVITER|EVITAR|DON'T BUY|DO NOT BUY)$/i.test(value) ? "avoid"
      : "wait";
  return reportCopy(language, key);
}

export function buildStrictReportLanguageInstruction(language: ResponseLanguage | ReportLanguageCode) {
  const name = getResponseLanguage(getReportLanguageCode(language));
  return `Output language is ${name}. Write every user-visible title, heading, label, paragraph, bullet, table cell, warning, placeholder, recommendation, source label, and action only in ${name}. Do not mix languages. Preserve proper nouns, registered company names, source titles, URLs, legal citations, and standard technical acronyms verbatim.`;
}

const forbiddenUiPhrases: Record<ReportLanguageCode, RegExp> = {
  en: /\b(?:Yönetici Özeti|Güven Skoru|Ana Risk|Sonraki Adım|Hukuki Değerlendirme|Zusammenfassung|Risque principal|Resumen ejecutivo)\b/i,
  tr: /\b(?:Executive Summary|Confidence Score|Main Risk|Next Action|Legal Assessment|Zusammenfassung|Synthèse exécutive|Resumen ejecutivo)\b/i,
  de: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Synthèse exécutive|Resumen ejecutivo)\b/i,
  fr: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Zusammenfassung|Resumen ejecutivo)\b/i,
  es: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Zusammenfassung|Synthèse exécutive)\b/i,
};

export function validateReportLanguageConsistency(
  visibleText: string,
  language: ResponseLanguage | ReportLanguageCode
) {
  const code = getReportLanguageCode(language);
  const normalizedText = String(visibleText || "");
  const mixed = normalizedText.match(forbiddenUiPhrases[code]);
  if (mixed) throw new Error(`Report language validation failed: ${code} report contains foreign UI text "${mixed[0]}".`);
  const prose = normalizedText
    .split("\n")
    .filter((line) => !/https?:\/\/|^\s*(?:URL|R\d+|\[[^\]]+\])\s*:/i.test(line))
    .join("\n");
  for (const segment of prose.split(/\n+|(?<=[.!?])\s+/).map((item) => item.trim())) {
    if (segment.length < 30) continue;
    const segmentScores = scoreReportLanguages(segment);
    const foreign = reportLanguageCodes
      .filter((candidate) => candidate !== code)
      .sort((left, right) => segmentScores[right] - segmentScores[left])[0];
    if (segmentScores[foreign] >= 3 && segmentScores[foreign] > segmentScores[code]) {
      throw new Error(
        `Report language validation failed: ${code} report contains a ${foreign} prose segment.`
      );
    }
  }
  const scores = scoreReportLanguages(prose);
  const strongestForeign = reportLanguageCodes
    .filter((candidate) => candidate !== code)
    .sort((left, right) => scores[right] - scores[left])[0];
  if (scores[strongestForeign] >= 5 && scores[strongestForeign] > scores[code]) {
    throw new Error(
      `Report language validation failed: ${code} report contains dominant ${strongestForeign} prose.`
    );
  }
  return true;
}
