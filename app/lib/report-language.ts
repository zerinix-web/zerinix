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
  en: /\b(?:Yönetici Özeti|Güven Skoru|Ana Risk|Sonraki Adım|Hukuki Değerlendirme|Doğrulama Gerekiyor|Doğrulanmadı|Zusammenfassung|Risque principal|Resumen ejecutivo)\b/i,
  tr: /\b(?:Executive Summary|Recommendation|Why|Immediate Actions?|Next Actions?|Confidence Score|Main Risk|Legal Assessment|Validation Required|Estimated|AI Analysis|Should proceed|Hold|Wait|Not verified|Verified from uploaded asset|Zusammenfassung|Synthèse exécutive|Resumen ejecutivo)\b/i,
  de: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Synthèse exécutive|Resumen ejecutivo)\b/i,
  fr: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Zusammenfassung|Resumen ejecutivo)\b/i,
  es: /\b(?:Executive Summary|Yönetici Özeti|Confidence Score|Main Risk|Legal Assessment|Zusammenfassung|Synthèse exécutive)\b/i,
};

export type ReportLanguageIssue = {
  kind: "foreign_ui_text" | "foreign_prose" | "dominant_foreign_prose";
  segment: string;
  detectedLanguage: ReportLanguageCode;
};

type ReportLanguageSection = {
  title: string;
  content: string;
};

const languageRepairWarnings: Record<ReportLanguageCode, string> = {
  en: "A section could not be translated reliably and was omitted. Review the original report content if needed.",
  tr: "Bir bölüm güvenilir biçimde çevrilemediği için çıkarıldı. Gerekirse özgün rapor içeriğini inceleyin.",
  de: "Ein Abschnitt konnte nicht zuverlässig übersetzt werden und wurde ausgelassen. Prüfen Sie bei Bedarf den ursprünglichen Bericht.",
  fr: "Une section n’a pas pu être traduite de façon fiable et a été omise. Consultez le rapport d’origine si nécessaire.",
  es: "Una sección no pudo traducirse de forma fiable y se omitió. Revise el informe original si es necesario.",
};

function replaceKnownReportCopy(value: string, code: ReportLanguageCode) {
  let repaired = value;
  for (const sourceCode of reportLanguageCodes) {
    if (sourceCode === code) continue;
    for (const key of Object.keys(copy[code]) as ReportCopyKey[]) {
      const source = copy[sourceCode][key];
      if (!source || source === copy[code][key]) continue;
      repaired = repaired.replaceAll(source, copy[code][key]);
    }
  }

  if (code === "tr") {
    const replacements: Array<[RegExp, string]> = [
      [/\bExecutive Recommendation\b/gi, "Yönetici Tavsiyesi"],
      [/\bRecommendation\b/gi, "Tavsiye"],
      [/\bWhy\b(?=\s*[:：\-–—])/gi, "Gerekçe"],
      [/\bImmediate Actions?\b/gi, "Acil Adımlar"],
      [/\bNext Actions?\b/gi, "Sonraki Adımlar"],
      [/\bValidation Required\b/gi, "Doğrulama Gerekli"],
      [/\bAI Analysis\b/gi, "Analitik Değerlendirme"],
      [/\bEstimated\b/gi, "Tahmini"],
      [/\bShould proceed\b/gi, "İlerleme Kararı"],
      [/\bHold for validation\b/gi, "Doğrulama Tamamlanana Kadar Bekle"],
      [/\b(?:Hold|Wait)\b/gi, "Bekle"],
    ];

    repaired = replacements.reduce(
      (content, [pattern, replacement]) => content.replace(pattern, replacement),
      repaired
    );
  }

  return repaired;
}

export function findReportLanguageIssues(
  visibleText: string,
  language: ResponseLanguage | ReportLanguageCode
): ReportLanguageIssue[] {
  const code = getReportLanguageCode(language);
  const normalizedText = String(visibleText || "");
  const issues: ReportLanguageIssue[] = [];
  const mixed = normalizedText.match(forbiddenUiPhrases[code]);
  if (mixed) {
    issues.push({
      kind: "foreign_ui_text",
      segment: mixed[0],
      detectedLanguage: detectReportLanguage(mixed[0]),
    });
  }
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
      issues.push({
        kind: "foreign_prose",
        segment,
        detectedLanguage: foreign,
      });
    }
  }
  const scores = scoreReportLanguages(prose);
  const strongestForeign = reportLanguageCodes
    .filter((candidate) => candidate !== code)
    .sort((left, right) => scores[right] - scores[left])[0];
  if (scores[strongestForeign] >= 5 && scores[strongestForeign] > scores[code]) {
    issues.push({
      kind: "dominant_foreign_prose",
      segment: prose.slice(0, 240),
      detectedLanguage: strongestForeign,
    });
  }
  return issues.filter(
    (issue, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.kind === issue.kind && candidate.segment === issue.segment
      ) === index
  );
}

export function repairReportLanguageSections<T extends ReportLanguageSection>(
  sections: T[],
  language: ResponseLanguage | ReportLanguageCode
) {
  const code = getReportLanguageCode(language);
  const warnings: string[] = [];
  const issues: Array<ReportLanguageIssue & { sectionTitle: string }> = [];
  const repairedSections = sections.map((section) => {
    const title = replaceKnownReportCopy(section.title, code);
    const knownCopyRepaired = replaceKnownReportCopy(section.content, code);
    const fragments = knownCopyRepaired
      .split(/(?<=[.!?])\s+|\n+/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);
    let sectionHadUnrepairableProse = false;
    const content = fragments
      .filter((fragment) => {
        const fragmentIssues = findReportLanguageIssues(fragment, code);
        if (fragmentIssues.length === 0) return true;
        sectionHadUnrepairableProse = true;
        issues.push(
          ...fragmentIssues.map((issue) => ({ ...issue, sectionTitle: title }))
        );
        return false;
      })
      .join("\n");
    if (sectionHadUnrepairableProse) warnings.push(languageRepairWarnings[code]);
    return {
      ...section,
      title,
      content: [content, sectionHadUnrepairableProse ? languageRepairWarnings[code] : ""]
        .filter(Boolean)
        .join("\n"),
    } as T;
  });
  return {
    sections: repairedSections,
    issues,
    warnings: [...new Set(warnings)],
  };
}

export function validateReportLanguageConsistency(
  visibleText: string,
  language: ResponseLanguage | ReportLanguageCode
) {
  const code = getReportLanguageCode(language);
  const issues = findReportLanguageIssues(visibleText, code);
  if (issues.length > 0) {
    console.warn("[report-language] non-fatal language mismatch", {
      expectedLanguage: code,
      issueCount: issues.length,
      issues: issues.map(({ kind, detectedLanguage }) => ({
        kind,
        detectedLanguage,
      })),
    });
  }
  return issues.length === 0;
}
