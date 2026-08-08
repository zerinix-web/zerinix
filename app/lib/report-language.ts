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

/**
 * Market Intelligence-only language resolution. Unlike `resolveReportLanguage`,
 * this never falls back to site/browser locale: short, keyword-sparse category
 * prompts ("US AI accounting software") score zero signal for every language,
 * and falling through to locale in that case is what causes an English prompt
 * to silently produce a Turkish report when the site/browser locale is Turkish.
 * Priority is explicit selection, then prompt-detected language, then English.
 */
export function resolveMarketIntelligenceLanguage(input: {
  explicitLanguage?: unknown;
  requestText?: string;
}): ReportLanguageCode {
  const requestText = input.requestText || "";
  const requestScores = scoreReportLanguages(requestText);
  const detectedRequestLanguage = Object.values(requestScores).some((score) => score > 0)
    ? detectReportLanguage(requestText)
    : "en";
  return normalizeReportLanguage(input.explicitLanguage) || detectedRequestLanguage;
}

/**
 * Market Intelligence PDF export language. The report's own saved
 * `metadata.reportLanguage` (the language that actually governed generation)
 * outranks re-detecting from the prompt text or browser locale, so a
 * correctly-generated report can never get a mismatched PDF.
 */
export function resolveMarketPdfLanguage(input: {
  explicitLanguage?: unknown;
  savedReportLanguage?: unknown;
  requestText?: string;
}): ReportLanguageCode {
  return (
    normalizeReportLanguage(input.explicitLanguage) ||
    normalizeReportLanguage(input.savedReportLanguage) ||
    resolveMarketIntelligenceLanguage({ requestText: input.requestText })
  );
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

// Shared verbatim across every entry point (plan full-report generation,
// chat) that needs to state this precedence rule -- previously
// hand-duplicated with slightly different wording in each caller, which
// only wastes tokens since the rule itself never varies by caller.
export function buildLanguageOverridePrecedenceInstruction(
  language: ResponseLanguage | ReportLanguageCode
) {
  const name = getResponseLanguage(getReportLanguageCode(language));
  return `The user's latest message language is ${name}. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language.`;
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

// User-facing disclosure text for the `warnings` channel only (see
// repairReportLanguageSections below) -- never injected into section
// content. Deliberately worded around the report's language
// requirement rather than "translation failure": the pipeline never
// performs machine translation, so describing this as a translation
// error would expose an internal mechanism that doesn't exist and
// read as a system diagnostic rather than a normal content notice.
const languageRepairWarnings: Record<ReportLanguageCode, string> = {
  en: "Part of this section did not meet the report's language requirement and was removed for consistency.",
  tr: "Bu bölümün bir kısmı, raporun dil gereksinimini karşılamadığı için tutarlılık amacıyla kaldırıldı.",
  de: "Ein Teil dieses Abschnitts erfüllte die Sprachanforderung des Berichts nicht und wurde aus Konsistenzgründen entfernt.",
  fr: "Une partie de cette section ne respectait pas l'exigence linguistique du rapport et a été retirée pour en assurer la cohérence.",
  es: "Parte de esta sección no cumplía con el requisito de idioma del informe y se eliminó para mantener la coherencia.",
};

// Financial/business acronyms and technical terms that must never be
// treated as language signal: they are language-neutral by
// convention (used verbatim across en/tr/de/fr/es reports) and would
// otherwise inflate a fragment's "foreign" score under the finer
// residual-detection pass below.
const languageNeutralTermPattern =
  /\b(?:CAC|LTV|ARPA|ARPU|ICP|B2B|B2C|D2C|HoReCa|SaaS|KPIs?|ROI|MRR|ARR|TAM|SAM|SOM|EBITDA|CAGR|NPS|MVP|GMV|IRR|NPV|API|CEO|CFO|CTO|COO|PDF)\b/gi;

function maskLanguageNeutralTerms(text: string) {
  return text.replace(/https?:\/\/\S+/gi, " ").replace(languageNeutralTermPattern, " ");
}

function replaceKnownReportCopy(value: string, code: ReportLanguageCode) {
  let repaired = value;
  for (const sourceCode of reportLanguageCodes) {
    if (sourceCode === code) continue;
    for (const key of Object.keys(copy[code]) as ReportCopyKey[]) {
      const source = copy[sourceCode][key];
      if (!source || source === copy[code][key]) continue;
      // Word-bounded, not a raw substring replaceAll: short tokens like
      // "AL" (Turkish for "buy") are literal substrings of many unrelated
      // ALL-CAPS words (e.g. "VALIDATE" -> "VBUYIDATE" when code is "en"),
      // so an unbounded replace corrupts them. \b only matches a
      // standalone occurrence of the foreign-language copy token, which is
      // the actual leak this function is meant to repair.
      const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      repaired = repaired.replace(new RegExp(`\\b${escapedSource}\\b`, "g"), copy[code][key]);
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
    // Fragments below 12 chars are too short to score reliably at all
    // (a single word, a stray token) -- skip them outright rather than
    // risk a false positive.
    if (segment.length < 12) continue;
    const maskedSegment = maskLanguageNeutralTerms(segment);
    if (!maskedSegment.trim()) continue;
    const segmentScores = scoreReportLanguages(maskedSegment);
    const foreign = reportLanguageCodes
      .filter((candidate) => candidate !== code)
      .sort((left, right) => segmentScores[right] - segmentScores[left])[0];
    // Primary check: long fragments (>=30 chars) need a strong foreign
    // signal (score >= 3) to flag, matching the original heuristic.
    // Residual check: shorter fragments (12-29 chars) -- the exact gap
    // where a short, keyword-bearing foreign phrase (e.g. a leftover
    // English label or short sentence) previously scored high enough
    // to be foreign but was never long enough to be looked at -- only
    // need a slightly lower bar (score >= 2) since the length itself
    // already limits how much signal can accumulate.
    const isPrimaryMatch = segment.length >= 30 && segmentScores[foreign] >= 3;
    const isResidualMatch = segment.length < 30 && segmentScores[foreign] >= 2;
    if ((isPrimaryMatch || isResidualMatch) && segmentScores[foreign] > segmentScores[code]) {
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
    // The removal itself is disclosed only through `warnings` (the
    // existing, correctly-scoped channel Planner already renders as a
    // dedicated "Warnings / Missing Evidence" section) -- never
    // written into `content`. Injecting it into content would present
    // an internal pipeline notice as if it were report prose.
    if (sectionHadUnrepairableProse) warnings.push(languageRepairWarnings[code]);
    return {
      ...section,
      title,
      content,
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
