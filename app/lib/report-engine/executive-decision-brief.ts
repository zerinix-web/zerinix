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
//
// Required structure (first page must answer exactly what the user asked):
// Final Recommendation -> Confidence (explained, not just a number) -> Why
// -> Top 3 Reasons -> Top 3 Risks -> What Evidence Is Missing -> What Would
// Change This Decision -> Immediate Next Action.

export type ExecutiveDecisionCode = "GO" | "CONDITIONAL_GO" | "NO_GO";

export type ExecutiveDecisionBrief = {
  decision: ExecutiveDecisionCode;
  confidence: number;
  // Whether confidenceFactors reads as "Confidence reduced because" or
  // "Confidence supported by" -- the score must always be traceable to a
  // reason, in either direction, never shown as a bare number.
  confidenceDirection: "reduced" | "supported";
  // Up to 3 short, concrete fragments explaining the confidence score
  // (e.g. "verified market size unavailable"), not generic hedging.
  confidenceFactors: string[];
  // One-sentence synthesis of the decision's rationale.
  why: string;
  // Top 3 reasons supporting the decision.
  topReasons: string[];
  // Top 3 risks, ranked.
  topRisks: string[];
  // Up to 3 concrete, named data points that are missing and would help
  // resolve the decision -- never a generic "more research is needed".
  missingEvidence: string[];
  // One sentence: the specific, falsifiable evidence or threshold that
  // would flip this decision to a different code.
  whatWouldChangeThisDecision: string;
  // One sentence: the single most urgent, concrete next step -- must
  // match the decision (never "run a pilot"/"execute" under NO_GO).
  immediateNextAction: string;
};

const decisionTranslations: Record<ResponseLanguage, Record<ExecutiveDecisionCode, string>> = {
  English: { GO: "GO", CONDITIONAL_GO: "CONDITIONAL GO", NO_GO: "NO-GO" },
  Turkish: { GO: "EVET", CONDITIONAL_GO: "KOŞULLU EVET", NO_GO: "HAYIR" },
  German: { GO: "GO", CONDITIONAL_GO: "BEDINGTES GO", NO_GO: "NO-GO" },
  French: { GO: "GO", CONDITIONAL_GO: "GO CONDITIONNEL", NO_GO: "NO-GO" },
  Spanish: { GO: "GO", CONDITIONAL_GO: "GO CONDICIONAL", NO_GO: "NO-GO" },
};

// CRITICAL FIX -- confirmed live (production report on a real market):
// Market Intelligence's OWN native decision vocabulary is ENTER/MONITOR/
// AVOID (assessMarketEntryConfidence, market-intelligence-presentation.ts)
// -- but buildMarketExecutiveDecisionBrief converts it to this shared
// module's GO/CONDITIONAL_GO/NO_GO purely to reuse the banner formatter,
// and executive-decision-vocabulary.ts's resolver further remapped THAT
// into the cross-report-kind PROCEED/PROCEED_WITH_CONDITIONS/
// PAUSE_PENDING_REVIEW/REJECT label set (built for Business Plan/
// Acquisition/Real Estate) -- so the SAME report showed "NO-GO" verbatim
// in its own raw executiveSummary banner text and "Reject" wherever the
// resolved decisionLabel was displayed: two different vocabularies for
// one decision. This is a second, additive translation table for the
// exact same ExecutiveDecisionCode values -- Business Plan/Acquisition/
// the domain-analysis family keep using decisionTranslations (the
// `vocabulary` parameter below defaults to "standard", so every existing
// caller is completely unaffected); Market Intelligence explicitly opts
// into "market" wherever it formats or parses its own banner, so its
// raw banner text, resolved decision label, and final verdict paragraph
// all say ENTER/MONITOR/AVOID -- never GO/CONDITIONAL GO/NO-GO, never
// Proceed/Reject.
const marketDecisionTranslations: Record<ResponseLanguage, Record<ExecutiveDecisionCode, string>> = {
  English: { GO: "ENTER", CONDITIONAL_GO: "MONITOR", NO_GO: "AVOID" },
  Turkish: { GO: "GİR", CONDITIONAL_GO: "İZLE", NO_GO: "KAÇIN" },
  German: { GO: "EINTRETEN", CONDITIONAL_GO: "BEOBACHTEN", NO_GO: "VERMEIDEN" },
  French: { GO: "ENTRER", CONDITIONAL_GO: "SURVEILLER", NO_GO: "ÉVITER" },
  Spanish: { GO: "ENTRAR", CONDITIONAL_GO: "MONITOREAR", NO_GO: "EVITAR" },
};

// TASK #69A-7 -- CRITICAL BUG FIX (confirmed live: a real Business Idea
// Validation report was requested with an explicit "give me a clear
// ENTER, MONITOR, or AVOID decision" prompt, but the generated report's
// own Executive Decision banner said "CONDITIONAL GO" -- Business Plan
// has never had its own decision vocabulary opt-in; every BIV call site
// used decisionTranslationsFor's "standard" default (literal GO/
// CONDITIONAL GO/NO-GO), the same table domain-analysis/acquisition/
// real-estate use. "business_plan" reuses marketDecisionTranslations
// verbatim (never a new, third, independently-hand-typed translation
// table that could drift from Market Intelligence's own ENTER/MONITOR/
// AVOID wording over time) -- the STRUCTURAL backing enum stays the
// existing, unrenamed ExecutiveDecisionCode ("GO"/"CONDITIONAL_GO"/
// "NO_GO"; only the DISPLAYED/localized token changes, exactly the same
// pattern Market Intelligence's own "market" opt-in already established.
// Market Intelligence's own "market" call sites are completely untouched
// by this addition.
export type ExecutiveDecisionVocabulary = "standard" | "market" | "business_plan";

function decisionTranslationsFor(vocabulary: ExecutiveDecisionVocabulary) {
  return vocabulary === "market" || vocabulary === "business_plan"
    ? marketDecisionTranslations
    : decisionTranslations;
}

// Every vocabulary's own translation table, for callers that don't know
// (and must not have to guess) which vocabulary generated a given piece
// of report text -- see extractExecutiveDecisionFromText's own default
// behavior below.
const allDecisionVocabularies: readonly ExecutiveDecisionVocabulary[] = ["standard", "market", "business_plan"];

export function localizeExecutiveDecision(
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage,
  vocabulary: ExecutiveDecisionVocabulary = "standard"
) {
  return decisionTranslationsFor(vocabulary)[language][decision];
}

export const executiveDecisionLabels: Record<
  ResponseLanguage,
  {
    heading: string;
    decision: string;
    confidence: string;
    confidenceReducedBecause: string;
    confidenceSupportedBy: string;
    why: string;
    topReasons: string;
    topRisks: string;
    missingEvidence: string;
    whatWouldChangeThisDecision: string;
    immediateNextAction: string;
  }
> = {
  English: {
    heading: "Executive Decision",
    decision: "Decision",
    confidence: "Confidence",
    confidenceReducedBecause: "Confidence Reduced Because",
    confidenceSupportedBy: "Confidence Supported By",
    why: "Why",
    topReasons: "Top 3 Reasons",
    topRisks: "Top 3 Risks",
    missingEvidence: "What Evidence Is Missing",
    whatWouldChangeThisDecision: "What Would Change This Decision",
    immediateNextAction: "Immediate Next Action",
  },
  Turkish: {
    heading: "Yönetici Kararı",
    decision: "Karar",
    confidence: "Güven",
    confidenceReducedBecause: "Güven Şu Nedenlerle Düşürüldü",
    confidenceSupportedBy: "Güven Şunlarla Desteklendi",
    why: "Neden",
    topReasons: "En Önemli 3 Gerekçe",
    topRisks: "En Önemli 3 Risk",
    missingEvidence: "Eksik Olan Kanıtlar",
    whatWouldChangeThisDecision: "Bu Kararı Ne Değiştirir",
    immediateNextAction: "Acil Sonraki Adım",
  },
  German: {
    heading: "Managemententscheidung",
    decision: "Entscheidung",
    confidence: "Konfidenz",
    confidenceReducedBecause: "Konfidenz verringert, weil",
    confidenceSupportedBy: "Konfidenz gestützt durch",
    why: "Warum",
    topReasons: "Top 3 Gründe",
    topRisks: "Top 3 Risiken",
    missingEvidence: "Welche Belege fehlen",
    whatWouldChangeThisDecision: "Was diese Entscheidung ändern würde",
    immediateNextAction: "Sofortiger nächster Schritt",
  },
  French: {
    heading: "Décision exécutive",
    decision: "Décision",
    confidence: "Confiance",
    confidenceReducedBecause: "Confiance réduite parce que",
    confidenceSupportedBy: "Confiance soutenue par",
    why: "Pourquoi",
    topReasons: "Top 3 des raisons",
    topRisks: "Top 3 des risques",
    missingEvidence: "Quelles preuves manquent",
    whatWouldChangeThisDecision: "Ce qui changerait cette décision",
    immediateNextAction: "Prochaine action immédiate",
  },
  Spanish: {
    heading: "Decisión ejecutiva",
    decision: "Decisión",
    confidence: "Confianza",
    confidenceReducedBecause: "Confianza reducida porque",
    confidenceSupportedBy: "Confianza respaldada por",
    why: "Por qué",
    topReasons: "Las 3 razones principales",
    topRisks: "Los 3 riesgos principales",
    missingEvidence: "Qué evidencia falta",
    whatWouldChangeThisDecision: "Qué cambiaría esta decisión",
    immediateNextAction: "Próxima acción inmediata",
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

const noMissingEvidenceText: Record<ResponseLanguage, string> = {
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

const noConfidenceFactorsText: Record<ResponseLanguage, string> = {
  English: "no specific factor identified beyond the evidence already summarized above",
  Turkish: "yukarıda özetlenen kanıtların dışında belirli bir etken tanımlanmadı",
  German: "kein spezifischer Faktor über die oben zusammengefassten Belege hinaus identifiziert",
  French: "aucun facteur spécifique identifié au-delà des preuves déjà résumées ci-dessus",
  Spanish: "no se identificó ningún factor específico más allá de la evidencia ya resumida anteriormente",
};

function takeThree(items: string[]) {
  return (items || []).filter((item) => item?.trim()).slice(0, 3);
}

// topReasons/topRisks/missingEvidence entries are often extracted verbatim
// from a source section that is itself a numbered list (e.g. Opportunities
// written by the model as "1) ...", "2) ...") -- the extraction upstream
// (market-intelligence-presentation.ts's splitIntoCandidateSentences) has
// no reason to know it's feeding a second, independently-numbered list, so
// without this the deterministic "${index + 1}. " prefix below stacks on
// top of the source's own marker instead of replacing it. Confirmed live:
// an item's own "1) " survived through extraction and rendered as "1. 1)
// Compliance-packaged offerings..." in a real generated report.
function stripLeadingListMarker(text: string): string {
  return text.replace(/^\(?\d{1,2}[.)]\)?\s*/, "").trim();
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
  language: ResponseLanguage,
  vocabulary: ExecutiveDecisionVocabulary = "standard"
) {
  const copy = executiveDecisionLabels[language];
  const localizedDecision = localizeExecutiveDecision(brief.decision, language, vocabulary);
  const reasons = takeThree(brief.topReasons);
  const risks = takeThree(brief.topRisks);
  const gaps = takeThree(brief.missingEvidence);
  const factors = takeThree(brief.confidenceFactors);
  const confidenceHeading =
    brief.confidenceDirection === "supported" ? copy.confidenceSupportedBy : copy.confidenceReducedBecause;

  return [
    copy.heading,
    `${copy.decision}: ${localizedDecision} (${copy.confidence}: ${brief.confidence}%)`,
    "",
    `${confidenceHeading}:`,
    ...(factors.length
      ? factors.map((factor) => `- ${factor}`)
      : [`- ${noConfidenceFactorsText[language]}`]),
    "",
    `${copy.why}: ${brief.why.trim()}`,
    "",
    `${copy.topReasons}:`,
    ...reasons.map((reason, index) => `${index + 1}. ${stripLeadingListMarker(reason)}`),
    "",
    `${copy.topRisks}:`,
    ...risks.map((risk, index) => `${index + 1}. ${stripLeadingListMarker(risk)}`),
    "",
    `${copy.missingEvidence}:`,
    ...(gaps.length
      ? gaps.map((gap, index) => `${index + 1}. ${stripLeadingListMarker(gap)}`)
      : [noMissingEvidenceText[language]]),
    "",
    `${copy.whatWouldChangeThisDecision}: ${brief.whatWouldChangeThisDecision.trim()}`,
    "",
    `${copy.immediateNextAction}: ${brief.immediateNextAction.trim()}`,
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

// TASK #69A-37 -- the decision word this SAME text can (and, confirmed
// live, does) place directly inside its own "Confidence: X (NN%)" line
// -- e.g. "Confidence: GO (95%)." -- a real Strategic Advisory model
// response conflating the decision call and the confidence figure into
// one mislabeled sentence. Bounded to this codebase's own actual
// decision-vocabulary words (never an arbitrary phrase) so the
// confidence regex below can skip PAST one of these words sitting
// between "Confidence:" and the real number, without risking a false
// match on an unrelated later sentence that happens to also contain a
// percentage (e.g. "Confidence: We interviewed 15 customers and found
// 95% renewal intent." must still resolve to the conservative default,
// never 95, since "We interviewed..." is not one of these words).
const decisionWordInsideConfidencePattern =
  "(?:GO|NO[\\s-]?GO|CONDITIONAL\\s+GO|PROCEED(?:\\s+WITH\\s+CONDITIONS)?|PROCEED\\s+CONDITIONALLY|PAUSE\\s+PENDING\\s+REVIEW|REJECT|WAIT|AVOID|ENTER|MONITOR|PASS|DO\\s+NOT\\s+PROCEED|INSUFFICIENT\\s+EVIDENCE)";

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

  // TASK #69A-37 -- ROOT CAUSE FIX. Confirmed live: for the exact real
  // response "Confidence: GO (95%).", the ORIGINAL pattern
  // (`confidence\s*[:\-–—]?\s*(\d{1,3})\s*%`) requires the percentage to
  // sit IMMEDIATELY after "confidence:" with nothing but whitespace in
  // between -- "GO" is not whitespace, so neither alternative matched at
  // all, and this function silently fell back to the conservative
  // default (50) instead of the real, stated 95. This corrupted not just
  // the model's own displayed sentence but this function's own
  // CANONICAL derived confidence value -- the same number
  // buildDomainAnalysisExecutiveDecisionBrief's deterministic banner
  // then displays as "Decision: X (Confidence: 50%)", wrong by 45 points,
  // for a report that never had a numeric confidence problem at all.
  // FIX: the second alternative now optionally skips over exactly one of
  // this codebase's own known decision words (never arbitrary text)
  // sitting between "confidence:" and the number, so this exact
  // conflation is parsed correctly instead of silently defaulting.
  const confidenceMatch = normalized.match(
    new RegExp(
      `\\b(\\d{1,3})\\s*%\\s*confidence\\b|\\bconfidence\\s*(?:level)?\\s*[:\\-–—]?\\s*(?:${decisionWordInsideConfidencePattern}\\s*)?\\(?\\s*(\\d{1,3})\\s*%`,
      "i"
    )
  );
  const parsedConfidence = confidenceMatch
    ? Number(confidenceMatch[1] ?? confidenceMatch[2])
    : null;
  const confidence =
    parsedConfidence !== null && Number.isFinite(parsedConfidence)
      ? Math.max(0, Math.min(100, Math.round(parsedConfidence)))
      : 50;

  return { decision, confidence };
}

// TASK #69A-37 -- ROOT CAUSE FIX (display companion to
// extractGenericDecisionSignal's own identical fix above). A real
// Strategic Advisory response's own free-text finalRecommendation field
// -- not just the deterministic banner -- can contain the SAME
// conflated "Confidence: GO (95%)." sentence verbatim, since the model
// writes that field's prose itself. Confidence and decision/
// recommendation are separate concepts (this ticket's own core
// requirement): this deterministically rewrites any such sentence
// in-place to "Confidence: 95%." -- dropping only the decision word,
// keeping the SAME number the model actually wrote (never substituting
// a different, externally-computed figure, and never fabricating one
// when no percentage is present in the match at all, in which case the
// text is left untouched rather than guessing). The decision itself is
// never lost: the report's own prompt already requires the call to be
// stated as the OPENING sentence of this same field, so removing a
// second, duplicate/mislabeled copy of it from the confidence clause
// loses no information.
export function correctConfidenceDecisionConflation(text: string): string {
  if (!text) {
    return text;
  }

  const pattern = new RegExp(
    `\\bconfidence\\s*(?:level)?\\s*[:\\-–—]\\s*${decisionWordInsideConfidencePattern}\\s*\\(?\\s*(\\d{1,3})\\s*%\\)?`,
    "gi"
  );

  const withParenFormFixed = text.replace(
    pattern,
    (_match, percent: string) => `Confidence: ${percent}%`
  );

  // TASK #69A-37B -- ROOT CAUSE FIX. Confirmed live in the REAL runtime
  // Strategic Advisory chat path (app/api/chat/route.ts,
  // isDirectStrategicAdvisory): a fresh response wrote "Confidence: GO
  // with 95% confidence (per your preference)..." -- a second
  // conflation shape #69A-37's own pattern above never covered, because
  // it requires the percentage to sit immediately (optionally inside
  // one "(...)" pair) after the decision word, with no connector word
  // and no repeated "confidence" noun in between. This shape instead
  // has a connector ("with") before the number and restates the word
  // "confidence" again AFTER the percentage. Same guarantee as above:
  // never fabricates a number, drops only the decision word/connector/
  // repeated noun, keeps the model's own stated percentage, and leaves
  // text with no match completely untouched.
  const connectorPattern = new RegExp(
    `\\bconfidence\\s*(?:level)?\\s*[:\\-–—]\\s*${decisionWordInsideConfidencePattern}\\b` +
      `(?:\\s+with)?\\s*\\(?\\s*(\\d{1,3})\\s*%\\s*(?:confidence\\b)?\\)?`,
    "gi"
  );

  return withParenFormFixed.replace(
    connectorPattern,
    (_match, percent: string) => `Confidence: ${percent}%`
  );
}

// TASK #69A-37B -- ROOT CAUSE FIX. Confirmed live in the SAME real
// Strategic Advisory chat response: the model appended an unsupported,
// vague parenthetical -- "(per your preference)" -- attributing the
// confidence figure to a user preference the current request never
// actually stated. The model must never invent a user preference. This
// deterministically strips only the VAGUE, unnamed form (a bare "per
// your preference"/"per the user's preference" with no specific
// preference named) -- never a specific, named claim like "(per your
// stated preference for aggressive growth)", which is at least
// falsifiable/checkable and may be genuinely true; only the contentless
// generic form is stripped, since it adds no decision value regardless
// of whether some preference exists somewhere in the conversation.
// Never fabricates replacement text -- the phrase is simply removed,
// and text with no match is returned untouched.
const vagueUserPreferenceClaimPattern =
  /\s*[,(]\s*(?:as\s+)?(?:per|based on)\s+(?:your|the user'?s?)\s+preference\s*[,)]?/gi;

export function stripUnsupportedPreferenceClaims(text: string): string {
  if (!text) {
    return text;
  }

  return text
    .replace(vagueUserPreferenceClaimPattern, "")
    .replace(/[ \t]{2,}/g, " ");
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
  text: string,
  vocabulary?: ExecutiveDecisionVocabulary
): { code: ExecutiveDecisionCode; token: string; language: ResponseLanguage } | null {
  if (!text) return null;

  // TASK #69A-7 -- this shared, report-type-agnostic extractor is used by
  // callers (buildExecutiveSnapshot, ReportPdfButton.tsx's cover badge,
  // executive-decision-vocabulary.ts's canonical-decision resolver) that
  // do not know, and must not have to guess, which of Business Plan's
  // "standard" (GO/CONDITIONAL GO/NO-GO) or "business_plan" (ENTER/
  // MONITOR/AVOID) vocabularies produced the text they're parsing --
  // trying every vocabulary except Market Intelligence's own explicit
  // "market" opt-in (which every MI call site already requests by name,
  // and must keep matching only its own tokens, never a business_plan/
  // standard token that happens to coincide) covers both without any
  // caller needing to be told which one applies. A caller that already
  // knows its own vocabulary (Market Intelligence) still passes it
  // explicitly and gets the exact same single-table behavior as before.
  const vocabulariesToTry = vocabulary ? [vocabulary] : allDecisionVocabularies.filter((v) => v !== "market");
  const codes: ExecutiveDecisionCode[] = ["GO", "CONDITIONAL_GO", "NO_GO"];
  const candidates: Array<{ code: ExecutiveDecisionCode; token: string; language: ResponseLanguage }> = [];
  for (const candidateVocabulary of vocabulariesToTry) {
    const table = decisionTranslationsFor(candidateVocabulary);
    for (const language of Object.keys(table) as ResponseLanguage[]) {
      for (const code of codes) {
        candidates.push({ code, token: table[language][code], language });
      }
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
    // CRITICAL FIX -- confirmed live: the "market" vocabulary's tokens
    // (ENTER/MONITOR/AVOID) are ordinary English words far more likely to
    // appear as the start of an unrelated sentence than "GO"/"CONDITIONAL
    // GO"/"NO-GO" ever were -- e.g. raw legacy prose "Decision: Monitor
    // for a staged U.S. entry, contingent on ..." would otherwise
    // false-positive-match "MONITOR" as the deterministic banner's
    // token. The real banner formatExecutiveDecisionBrief generates
    // always immediately follows the token with " (Confidence: NN%)" or
    // ends the line right there -- requiring that same shape (the token
    // is followed only by optional whitespace and then "(", end of line,
    // or end of string, never more lowercase prose continuing the
    // sentence) distinguishes the real deterministic banner from
    // coincidental prose for every vocabulary, not just "market".
    const pattern = new RegExp(
      `(?:${labelPattern})\\s*[:\\-–—]\\s*(${escapedToken})\\b(?=\\s*(?:\\(|$|\\r?\\n))`,
      "im"
    );
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
export function decisionTokensForLanguage(
  language: ResponseLanguage,
  vocabulary: ExecutiveDecisionVocabulary = "standard"
): string[] {
  const table = decisionTranslationsFor(vocabulary);
  return [table[language].GO, table[language].CONDITIONAL_GO, table[language].NO_GO];
}
