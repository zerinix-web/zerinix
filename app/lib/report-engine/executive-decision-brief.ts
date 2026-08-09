import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

// Shared, report-type-agnostic "Executive Recommendation" block: every
// report (Business Plan, Market Intelligence, Strategic Advisory) must
// begin with this so a reader understands the conclusion within 30
// seconds, before any supporting detail. This module only defines
// STRUCTURE/FORMATTING/decision vocabulary -- it carries no founder,
// market, or domain-specific content itself, so it is safe to share across
// all three report types without reintroducing cross-report contamination
// (see app/lib/report-engine/report-isolation-validator.ts).

export type ExecutiveDecisionCode = "GO" | "NO_GO" | "WAIT" | "DEPENDS";

export type ExecutiveDecisionBrief = {
  shortAnswer: string;
  decision: ExecutiveDecisionCode;
  confidence: number;
  topReasons: string[];
  topRisks: string[];
};

const decisionTranslations: Record<ResponseLanguage, Record<ExecutiveDecisionCode, string>> = {
  English: { GO: "GO", NO_GO: "NO-GO", WAIT: "WAIT", DEPENDS: "DEPENDS" },
  Turkish: { GO: "EVET", NO_GO: "HAYIR", WAIT: "BEKLE", DEPENDS: "DURUMA BAĞLI" },
  German: { GO: "GO", NO_GO: "NO-GO", WAIT: "WARTEN", DEPENDS: "ABHÄNGIG" },
  French: { GO: "GO", NO_GO: "NO-GO", WAIT: "ATTENDRE", DEPENDS: "SOUS CONDITIONS" },
  Spanish: { GO: "GO", NO_GO: "NO-GO", WAIT: "ESPERAR", DEPENDS: "DEPENDE" },
};

export function localizeExecutiveDecision(
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage
) {
  return decisionTranslations[language][decision];
}

const labels: Record<
  ResponseLanguage,
  {
    heading: string;
    decision: string;
    confidence: string;
    topReasons: string;
    topRisks: string;
  }
> = {
  English: {
    heading: "Executive Recommendation",
    decision: "Decision",
    confidence: "Confidence",
    topReasons: "Top Reasons",
    topRisks: "Top Risks",
  },
  Turkish: {
    heading: "Yönetici Tavsiyesi",
    decision: "Karar",
    confidence: "Güven",
    topReasons: "Başlıca Nedenler",
    topRisks: "Başlıca Riskler",
  },
  German: {
    heading: "Managementempfehlung",
    decision: "Entscheidung",
    confidence: "Konfidenz",
    topReasons: "Wichtigste Gründe",
    topRisks: "Wichtigste Risiken",
  },
  French: {
    heading: "Recommandation exécutive",
    decision: "Décision",
    confidence: "Confiance",
    topReasons: "Principales raisons",
    topRisks: "Principaux risques",
  },
  Spanish: {
    heading: "Recomendación ejecutiva",
    decision: "Decisión",
    confidence: "Confianza",
    topReasons: "Razones principales",
    topRisks: "Riesgos principales",
  },
};

function takeThree(items: string[]) {
  return items.filter((item) => item?.trim()).slice(0, 3);
}

// Renders the mandatory opening block. Callers must prepend this to
// whichever field renders first in their report's own field order
// (executiveSummary for Business Plan/Market Intelligence; the first
// domain-analysis field for Strategic Advisory) so every report begins
// with it, per report-generation policy: "the user should understand the
// conclusion within 30 seconds."
export function formatExecutiveDecisionBrief(
  brief: ExecutiveDecisionBrief,
  language: ResponseLanguage
) {
  const copy = labels[language];
  const localizedDecision = localizeExecutiveDecision(brief.decision, language);
  const reasons = takeThree(brief.topReasons);
  const risks = takeThree(brief.topRisks);

  return [
    copy.heading,
    `${copy.decision}: ${localizedDecision} (${copy.confidence}: ${brief.confidence}%)`,
    brief.shortAnswer.trim(),
    "",
    `${copy.topReasons}:`,
    ...reasons.map((reason, index) => `${index + 1}. ${reason}`),
    "",
    `${copy.topRisks}:`,
    ...risks.map((risk, index) => `${index + 1}. ${risk}`),
  ].join("\n");
}

const decisionKeywordPatterns: Array<{ code: ExecutiveDecisionCode; pattern: RegExp }> = [
  // Order matters: conditional language is checked before an unqualified
  // go/no-go verb so "proceed only if X" resolves to DEPENDS, not GO.
  {
    code: "DEPENDS",
    pattern: /\b(?:conditional(?:ly)?|depends? on|contingent on|only if|provided that|subject to)\b/i,
  },
  { code: "WAIT", pattern: /\b(?:wait|hold|pending|not yet|premature|postpone)\b/i },
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
  let decision: ExecutiveDecisionCode = "DEPENDS";

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
