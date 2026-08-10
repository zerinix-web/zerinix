import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

// Shared, report-type-agnostic "Executive Decision" layer: every report
// (Business Plan, Market Intelligence, Strategic Advisory) must begin with
// this single block, and it is the ONLY place a decision/confidence is
// stated -- callers must not layer a second summary, a confidence rollup,
// or a source-reliability overview on top of it. This module only defines
// STRUCTURE/FORMATTING/decision vocabulary -- it carries no founder,
// market, or domain-specific content itself, so it is safe to share across
// all three report types without reintroducing cross-report contamination
// (see app/lib/report-engine/report-isolation-validator.ts).

export type ExecutiveDecisionCode = "GO" | "CONDITIONAL_GO" | "NO_GO";

export type ExecutiveDecisionBrief = {
  decision: ExecutiveDecisionCode;
  confidence: number;
  // "Why" -- top 3 reasons supporting the decision itself (distinct from
  // biggestOpportunity, which is the single forward-looking upside case).
  topReasons: string[];
  // "Biggest Risks" -- up to 3, ranked.
  topRisks: string[];
  // "Biggest Opportunity" -- exactly one sentence, the single most
  // compelling upside if the decision plays out.
  biggestOpportunity: string;
  // "Missing Information" -- up to 3 concrete, named data points that, if
  // obtained, could change the decision itself (not generic caveats).
  // Never empty by omission: callers that have no real gap to report must
  // still explicitly say so rather than dropping the block.
  missingInformation: string[];
  // "First 90-Day Action Plan" -- up to 3 concrete, near-term actions.
  first90Days: string[];
};

const decisionTranslations: Record<ResponseLanguage, Record<ExecutiveDecisionCode, string>> = {
  English: { GO: "GO", CONDITIONAL_GO: "CONDITIONAL GO", NO_GO: "NO-GO" },
  Turkish: { GO: "EVET", CONDITIONAL_GO: "KOŞULLU EVET", NO_GO: "HAYIR" },
  German: { GO: "GO", CONDITIONAL_GO: "BEDINGTES GO", NO_GO: "NO-GO" },
  French: { GO: "GO", CONDITIONAL_GO: "GO CONDITIONNEL", NO_GO: "NO-GO" },
  Spanish: { GO: "GO", CONDITIONAL_GO: "GO CONDICIONAL", NO_GO: "NO-GO" },
};

export function localizeExecutiveDecision(
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage
) {
  return decisionTranslations[language][decision];
}

export const executiveDecisionLabels: Record<
  ResponseLanguage,
  {
    heading: string;
    decision: string;
    confidence: string;
    why: string;
    biggestRisks: string;
    biggestOpportunity: string;
    missingInformation: string;
    first90Days: string;
  }
> = {
  English: {
    heading: "Executive Decision",
    decision: "Decision",
    confidence: "Confidence",
    why: "Why",
    biggestRisks: "Biggest Risks",
    biggestOpportunity: "Biggest Opportunity",
    missingInformation: "Missing Information That Could Change This Decision",
    first90Days: "First 90-Day Action Plan",
  },
  Turkish: {
    heading: "Yönetici Kararı",
    decision: "Karar",
    confidence: "Güven",
    why: "Neden",
    biggestRisks: "Başlıca Riskler",
    biggestOpportunity: "Başlıca Fırsat",
    missingInformation: "Kararı Değiştirebilecek Eksik Bilgiler",
    first90Days: "İlk 90 Günlük Aksiyon Planı",
  },
  German: {
    heading: "Managemententscheidung",
    decision: "Entscheidung",
    confidence: "Konfidenz",
    why: "Warum",
    biggestRisks: "Größte Risiken",
    biggestOpportunity: "Größte Chance",
    missingInformation: "Fehlende Informationen, die diese Entscheidung ändern könnten",
    first90Days: "Aktionsplan für die ersten 90 Tage",
  },
  French: {
    heading: "Décision exécutive",
    decision: "Décision",
    confidence: "Confiance",
    why: "Pourquoi",
    biggestRisks: "Principaux risques",
    biggestOpportunity: "Principale opportunité",
    missingInformation: "Informations manquantes pouvant modifier cette décision",
    first90Days: "Plan d'action des 90 premiers jours",
  },
  Spanish: {
    heading: "Decisión ejecutiva",
    decision: "Decisión",
    confidence: "Confianza",
    why: "Por qué",
    biggestRisks: "Principales riesgos",
    biggestOpportunity: "Principal oportunidad",
    missingInformation: "Información faltante que podría cambiar esta decisión",
    first90Days: "Plan de acción de los primeros 90 días",
  },
};

// Every language variant of a given label, e.g. for building a
// locale-agnostic extraction regex in PDF/dashboard rendering code that
// must parse whichever language the report was actually generated in.
export function localizedLabelVariants(
  key: keyof (typeof executiveDecisionLabels)["English"]
): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const language of Object.keys(executiveDecisionLabels) as ResponseLanguage[]) {
    const value = executiveDecisionLabels[language][key];
    if (!seen.has(value)) {
      seen.add(value);
      variants.push(value);
    }
  }
  return variants;
}

const noMissingInformationText: Record<ResponseLanguage, string> = {
  English:
    "No material data gaps were identified; the confidence score above already reflects the available evidence.",
  Turkish:
    "Kararı değiştirecek nitelikte bir veri eksikliği bulunmadı; yukarıdaki güven skoru mevcut kanıtları zaten yansıtmaktadır.",
  German:
    "Es wurden keine wesentlichen Datenlücken festgestellt; der obige Konfidenzwert spiegelt bereits die verfügbaren Belege wider.",
  French:
    "Aucune lacune de données significative n'a été identifiée ; le score de confiance ci-dessus reflète déjà les preuves disponibles.",
  Spanish:
    "No se identificaron brechas de datos significativas; la puntuación de confianza anterior ya refleja la evidencia disponible.",
};

function takeThree(items: string[]) {
  return (items || []).filter((item) => item?.trim()).slice(0, 3);
}

// Renders the mandatory, SINGLE opening block. Callers must prepend this
// to whichever field renders first in their report's own field order
// (executiveSummary for Business Plan/Market Intelligence; the first
// domain-analysis field for Strategic Advisory) and must not add any
// further decision/confidence/summary block anywhere else in the report --
// this is the one place the verdict is stated. Every downstream section
// supports this decision; none of them restate it.
export function formatExecutiveDecisionBrief(
  brief: ExecutiveDecisionBrief,
  language: ResponseLanguage
) {
  const copy = executiveDecisionLabels[language];
  const localizedDecision = localizeExecutiveDecision(brief.decision, language);
  const reasons = takeThree(brief.topReasons);
  const risks = takeThree(brief.topRisks);
  const gaps = takeThree(brief.missingInformation);
  const actions = takeThree(brief.first90Days);

  return [
    copy.heading,
    `${copy.decision}: ${localizedDecision} (${copy.confidence}: ${brief.confidence}%)`,
    "",
    `${copy.why}:`,
    ...reasons.map((reason, index) => `${index + 1}. ${reason}`),
    "",
    `${copy.biggestRisks}:`,
    ...risks.map((risk, index) => `${index + 1}. ${risk}`),
    "",
    `${copy.biggestOpportunity}: ${brief.biggestOpportunity.trim()}`,
    "",
    `${copy.missingInformation}:`,
    ...(gaps.length ? gaps.map((gap, index) => `${index + 1}. ${gap}`) : [noMissingInformationText[language]]),
    "",
    `${copy.first90Days}:`,
    ...actions.map((action, index) => `${index + 1}. ${action}`),
  ].join("\n");
}

const decisionKeywordPatterns: Array<{ code: ExecutiveDecisionCode; pattern: RegExp }> = [
  // Order matters: conditional/hold language is checked before an
  // unqualified go/no-go verb so "proceed only if X" or "wait for more
  // evidence" resolves to CONDITIONAL_GO, not GO/NO_GO.
  {
    code: "CONDITIONAL_GO",
    pattern:
      /\b(?:conditional(?:ly)?|depends? on|contingent on|only if|provided that|subject to|wait|hold|pending|not yet|premature|postpone)\b/i,
  },
  {
    code: "NO_GO",
    pattern: /\b(?:do not proceed|does not support proceeding|no-go|reject|avoid|not recommended|insufficient evidence to proceed)\b/i,
  },
  {
    code: "GO",
    pattern: /\b(?:proceed|recommend(?:ed)?|support(?:s|ed)? proceeding|go[\s-]?ahead)\b/i,
  },
];

// Best-effort decision/confidence extraction from qualitative narrative
// text, for report types (Strategic Advisory) that have no numeric
// decision-scoring engine of their own. Never fabricates a number: when no
// explicit confidence is stated, it returns a conservative default rather
// than inventing precision.
export function extractGenericDecisionSignal(text: string) {
  const normalized = (text || "").trim();
  let decision: ExecutiveDecisionCode = "CONDITIONAL_GO";

  for (const { code, pattern } of decisionKeywordPatterns) {
    if (pattern.test(normalized)) {
      decision = code;
      break;
    }
  }

  const confidenceMatch = normalized.match(/\b(\d{1,3})\s*%\s*confidence\b|\bconfidence\s*[:\-–—]?\s*(\d{1,3})\s*%/i);
  const parsedConfidence = confidenceMatch
    ? Number(confidenceMatch[1] ?? confidenceMatch[2])
    : null;
  const confidence =
    parsedConfidence !== null && Number.isFinite(parsedConfidence)
      ? Math.max(0, Math.min(100, Math.round(parsedConfidence)))
      : 50;

  return { decision, confidence };
}

// Locale-agnostic extraction of the deterministic "Decision: TOKEN" line
// formatExecutiveDecisionBrief always emits as its second line, regardless
// of which of the 5 supported languages the report was generated in. This
// is what PDF/dashboard/Planner rendering code must use instead of an
// English-only regex -- a Turkish report's own content says "Karar: EVET",
// never "Decision: GO", so an English-only pattern silently fails and
// falls back to a placeholder ("REVIEW", "Review required") that should
// never reach a user.
export function extractExecutiveDecisionFromText(
  text: string
): { code: ExecutiveDecisionCode; token: string; language: ResponseLanguage } | null {
  if (!text) return null;

  const codes: ExecutiveDecisionCode[] = ["GO", "CONDITIONAL_GO", "NO_GO"];
  const candidates: Array<{ code: ExecutiveDecisionCode; token: string; language: ResponseLanguage }> = [];
  for (const language of Object.keys(decisionTranslations) as ResponseLanguage[]) {
    for (const code of codes) {
      candidates.push({ code, token: decisionTranslations[language][code], language });
    }
  }
  // Longest tokens first: "CONDITIONAL GO"/"KOŞULLU EVET" must match
  // before the shorter "GO"/"EVET" substring nested inside them.
  candidates.sort((a, b) => b.token.length - a.token.length);

  const labelPattern = localizedLabelVariants("decision")
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  for (const { code, token, language } of candidates) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:${labelPattern})\\s*[:\\-–—]\\s*(${escapedToken})\\b`, "i");
    const match = text.match(pattern);
    if (match) {
      return { code, token: match[1], language };
    }
  }

  return null;
}

// All 3 decision tokens in the same language as a previously-matched
// result, for UI that renders a full badge set (e.g. "GO / CONDITIONAL GO
// / NO-GO") and must not mix languages within that set.
export function decisionTokensForLanguage(language: ResponseLanguage): string[] {
  return [
    decisionTranslations[language].GO,
    decisionTranslations[language].CONDITIONAL_GO,
    decisionTranslations[language].NO_GO,
  ];
}
