// Cross-report consistency validation: a final pass, run right before
// a report is finalized, that detects contradictions BETWEEN sections
// and silently corrects them in favor of the report's own canonical,
// already-computed structured values (the same AiFinancialModelContext
// metrics and decision every canonical section is already built from)
// -- never a guessed or invented value. Nothing here is exposed to the
// user: corrections are applied in place (same field, same shape, same
// formatting -- only the contradicting number/keyword changes), and the
// consistency score/correction log are for internal use only.
import type { ResponseLanguage } from "./report-language.ts";
import { decisionTokensForLanguage } from "./report-engine/executive-decision-brief.ts";

export type ConsistencyCorrectionType =
  | "recommendation_mismatch"
  | "market_size_mismatch"
  | "growth_rate_mismatch"
  | "financial_metric_mismatch"
  | "timeline_mismatch"
  | "risk_opportunity_duplicate"
  | "strategic_signal_contradiction";

export type ConsistencyCorrection = {
  field: string;
  type: ConsistencyCorrectionType;
  before: string;
  after: string;
};

export type ConsistencyValidationResult = {
  score: number;
  correctionsApplied: ConsistencyCorrection[];
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A bare numeric/percentage/currency/duration token, the same shape
// used everywhere else in this report-generation pipeline
// (report-evidence-confidence.ts, financial-evidence-labeling.ts).
// Longer alternatives (months?/days?) must be listed before the
// single-letter magnitude suffixes (k/m/b) -- regex alternation takes
// the first branch that matches at a given position, not the longest,
// so "6 months" tried against "...|m|...|months?|..." would otherwise
// match just the "m" in "months" and leave "onths" dangling after a
// substitution (a real mangling bug caught while testing this module).
const VALUE_TOKEN = `(?:[<>~≈]?\\s*)?[$€£₺]?\\s*\\d[\\d.,]*\\s*(?:months?|days?|ay\\b|%|k|K|m|M|b|B)?`;

function normalizeValueForComparison(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

// Finds every "<label> ... <value>" mention of a given metric across
// every section and replaces the value with the canonical
// displayValue wherever it genuinely differs -- the metric's own
// label must appear as a whole word/phrase immediately before the
// value, so this can never touch an unrelated number elsewhere in the
// sentence. Sections in `protectedFields` (the ones the value was
// itself canonically built from) are left untouched: correcting them
// against themselves would be a no-op at best and a formatting risk
// at worst.
function correctMetricMentions(
  sections: Record<string, string>,
  fields: readonly string[],
  labelPattern: string,
  canonicalDisplayValue: string,
  type: ConsistencyCorrectionType,
  protectedFields: ReadonlySet<string>,
  corrections: ConsistencyCorrection[]
) {
  const canonicalNormalized = normalizeValueForComparison(canonicalDisplayValue);
  // The connector allows an optional linking verb/preposition/punctuation
  // plus a bounded, explicit whitelist of hedging words ("only",
  // "about", "roughly", ...) so a sentence like "runway is only 6
  // months" is still recognized as a mention of "runway" -- deliberately
  // NOT an open-ended word-class match, so this can never skip past
  // unrelated words to grab an unconnected number later in the sentence.
  const mentionPattern = new RegExp(
    `\\b(${labelPattern})\\b(\\s*(?:is|was|of|at|[:=\\-–—])?\\s*(?:only|about|approximately|around|roughly|nearly|almost|just|still|currently|neredeyse|yaklaşık|sadece|yalnızca)?\\s*)(${VALUE_TOKEN})`,
    "gi"
  );

  for (const field of fields) {
    if (protectedFields.has(field)) {
      continue;
    }

    const content = sections[field];
    if (!content) {
      continue;
    }

    let changed = false;
    const nextContent = content.replace(mentionPattern, (match, label, connector, value) => {
      if (normalizeValueForComparison(value) === canonicalNormalized) {
        return match;
      }

      changed = true;
      return `${label}${connector}${canonicalDisplayValue}`;
    });

    if (changed) {
      corrections.push({ field, type, before: content, after: nextContent });
      sections[field] = nextContent;
    }
  }
}

const legacyDecisionKeywordPattern = /\b(PASS|HOLD|VALIDATE|REJECT)\b/g;
const legacyDecisionKeywordPatternTurkish = /\b(GEÇ|BEKLE|DOĞRULA|REDDET)\b/g;

// Replaces any legacy decision keyword (PASS/HOLD/VALIDATE/REJECT, or
// the Turkish equivalents) that contradicts the report's one real,
// canonically-computed decision -- in every section except the ones
// the decision was itself built from (Executive Summary, Executive
// Recommendation / Strategic Recommendations), which are already
// correct by construction and must never be rewritten against
// themselves.
function correctRecommendationMentions(
  sections: Record<string, string>,
  fields: readonly string[],
  authoritativeDecision: string,
  language: ResponseLanguage,
  protectedFields: ReadonlySet<string>,
  corrections: ConsistencyCorrection[]
) {
  const pattern = language === "Turkish" ? legacyDecisionKeywordPatternTurkish : legacyDecisionKeywordPattern;

  for (const field of fields) {
    if (protectedFields.has(field)) {
      continue;
    }

    const content = sections[field];
    if (!content) {
      continue;
    }

    let changed = false;
    const nextContent = content.replace(pattern, (match) => {
      if (match === authoritativeDecision) {
        return match;
      }

      changed = true;
      return authoritativeDecision;
    });

    if (changed) {
      corrections.push({ field, type: "recommendation_mismatch", before: content, after: nextContent });
      sections[field] = nextContent;
    }
  }
}

// Confirmed live: correctRecommendationMentions above only ever matches
// the OLD PASS/HOLD/VALIDATE/REJECT vocabulary. Every report now states
// its verdict through the shared Executive Decision layer instead
// (GO/CONDITIONAL GO/NO-GO, see executive-decision-brief.ts) -- so that
// check had become a silent no-op: nothing in a modern report ever
// contains a PASS/HOLD/VALIDATE/REJECT token to correct, which is
// exactly how a report could show "WAIT"/"PASS"-family language on the
// cover (derived independently, see report-presentation.ts) while the
// Executive Summary said "CONDITIONAL GO", with no cross-check ever
// firing. This scans every non-protected section for the CURRENT
// vocabulary's tokens (in the report's own language, all 5 supported
// languages, not just English/Turkish) and replaces any mismatch with the
// one real, canonically-computed decision -- same mechanism, current
// vocabulary.
function correctExecutiveDecisionMentions(
  sections: Record<string, string>,
  fields: readonly string[],
  authoritativeToken: string,
  language: ResponseLanguage,
  protectedFields: ReadonlySet<string>,
  corrections: ConsistencyCorrection[]
) {
  const tokens = decisionTokensForLanguage(language)
    .slice()
    // Longest token first: "CONDITIONAL GO"/"NO-GO" must match whole,
    // never let the bare "GO" alternative match just the tail of one of
    // them and leave "CONDITIONAL "/"NO-" dangling in the text.
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${tokens.join("|")})\\b`, "g");

  for (const field of fields) {
    if (protectedFields.has(field)) {
      continue;
    }

    const content = sections[field];
    if (!content) {
      continue;
    }

    let changed = false;
    const nextContent = content.replace(pattern, (match) => {
      if (match === authoritativeToken) {
        return match;
      }

      changed = true;
      return authoritativeToken;
    });

    if (changed) {
      corrections.push({ field, type: "recommendation_mismatch", before: content, after: nextContent });
      sections[field] = nextContent;
    }
  }
}

function normalizeSentence(sentence: string) {
  return sentence
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function extractLabeledSection(content: string, heading: string) {
  const pattern = new RegExp(`${escapeRegExp(heading)}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n[A-ZÇĞİÖŞÜ][\\w /]*:|$)`, "i");
  return content.match(pattern)?.[1] ?? "";
}

const MIN_CONTRADICTION_LINE_LENGTH = 15;

// Requirement 2's "risks contradict opportunities": the same
// (near-)identical statement listed as both a risk and an
// opportunity. Mechanical and non-fabricating -- an exact normalized-
// sentence match across two real, already-generated lists, the same
// approach report-consistency-checker.ts already uses for the
// analogous EDS-only check. When found, the duplicate is removed from
// the opportunities side only (risks stays authoritative: a claim
// that reads as a threat should not also be presented as upside).
function resolveRiskOpportunityDuplicates(
  sections: Record<string, string>,
  risksField: string,
  opportunitiesHostField: string,
  // When set, opportunities live in a labeled sub-section of a shared
  // field (plan's swotAnalysis: "Opportunities:" / "Threats:" inside
  // one field). When omitted, opportunitiesHostField IS the whole
  // opportunities content on its own (market's separate "opportunities"
  // report field).
  opportunitiesHeading: string | undefined,
  corrections: ConsistencyCorrection[]
) {
  const risksContent = sections[risksField];
  const opportunitiesHost = sections[opportunitiesHostField];
  if (!risksContent || !opportunitiesHost) {
    return;
  }

  const opportunitiesBlock = opportunitiesHeading
    ? extractLabeledSection(opportunitiesHost, opportunitiesHeading)
    : opportunitiesHost;
  if (!opportunitiesBlock) {
    return;
  }

  const riskLines = new Set(
    risksContent
      .split("\n")
      .map((line) => normalizeSentence(line))
      .filter((line) => line.length >= MIN_CONTRADICTION_LINE_LENGTH)
  );

  const opportunityLines = opportunitiesBlock.split("\n");
  let changed = false;
  const nextOpportunityLines = opportunityLines.filter((line) => {
    const normalized = normalizeSentence(line);
    if (normalized.length >= MIN_CONTRADICTION_LINE_LENGTH && riskLines.has(normalized)) {
      changed = true;
      return false;
    }
    return true;
  });

  if (!changed) {
    return;
  }

  const nextOpportunitiesBlock = nextOpportunityLines.join("\n");
  const nextHost = opportunitiesHost.replace(opportunitiesBlock, nextOpportunitiesBlock);
  corrections.push({
    field: opportunitiesHostField,
    type: "risk_opportunity_duplicate",
    before: opportunitiesHost,
    after: nextHost,
  });
  sections[opportunitiesHostField] = nextHost;
}

// Confirmed live (report-quality audit, intentionally-contradictory test
// prompts): a report can be internally consistent on every EXISTING check
// above (same decision everywhere, same metric values, no risk/opportunity
// duplicate) while still pairing a weak, already-computed underlying
// signal (low competitive advantage, low market opportunity, negative
// unit economics, thin runway, low validation confidence) with an
// AGGRESSIVE recommendation in a completely different section that never
// accounts for it -- "recommend premium pricing" next to a benchmark fit
// that already says defensibility is weak, "scale rapidly" next to a
// unit-economics section showing LTV below CAC, "increase burn" next to
// a runway already under 6 months. None of the number/keyword-mismatch
// checks above catch this: nothing is factually WRONG in either section
// taken alone, the sections just never talk to each other.
//
// Requirement 4's own framing ("if confidence is low or evidence is weak,
// recommendations must become more conservative instead of more
// aggressive") is applied literally: this never rewrites or deletes the
// AI's own sentence (an in-place phrase swap risks producing broken
// grammar across the wide range of sentence shapes the model can write --
// the same reasoning that kept every correction above to whole-value or
// whole-keyword substitution, never partial-sentence surgery). Instead it
// appends one short, deterministic caution sentence immediately after any
// sentence matching an aggressive pattern, naming the specific weak
// signal that contradicts it -- always grammatically safe, since it is a
// new sentence rather than an edit to the existing one, and never
// fabricates a value: the caution text only ever names a signal this
// same report already computed (competitive advantage, market
// opportunity, unit economics, runway, validation confidence) or already
// stated in its own Risks section (regulatory risk).
export type StrategicSignalFlags = {
  weakCompetitiveAdvantage: boolean;
  weakMarketOpportunity: boolean;
  negativeUnitEconomics: boolean;
  lowRunway: boolean;
  lowValidationConfidence: boolean;
};

const strategicSignalCaveats: Record<
  keyof StrategicSignalFlags,
  Record<ResponseLanguage, string>
> = {
  weakCompetitiveAdvantage: {
    English:
      "Caution: competitive differentiation has not been established, so this pricing position should be validated with buyers before being treated as defensible.",
    Turkish:
      "Uyarı: rekabetçi farklılaşma henüz kanıtlanmadığı için bu fiyatlandırma konumu savunulabilir kabul edilmeden önce alıcılarla doğrulanmalıdır.",
    German:
      "Hinweis: Die wettbewerbliche Differenzierung ist noch nicht belegt, daher sollte diese Preispositionierung bei Kunden validiert werden, bevor sie als verteidigungsfähig gilt.",
    French:
      "Attention : la différenciation concurrentielle n'est pas encore établie ; ce positionnement tarifaire doit être validé auprès des acheteurs avant d'être considéré comme défendable.",
    Spanish:
      "Precaución: la diferenciación competitiva aún no está establecida, por lo que esta posición de precios debe validarse con los compradores antes de considerarse defendible.",
  },
  weakMarketOpportunity: {
    English:
      "Caution: market demand for this opportunity is not yet validated, so hiring should stay lean until demand signals strengthen.",
    Turkish:
      "Uyarı: bu fırsata yönelik pazar talebi henüz doğrulanmadığından, talep sinyalleri güçlenene kadar işe alım sınırlı tutulmalıdır.",
    German:
      "Hinweis: Die Marktnachfrage für diese Chance ist noch nicht validiert, daher sollte die Einstellung schlank bleiben, bis sich die Nachfragesignale verstärken.",
    French:
      "Attention : la demande du marché pour cette opportunité n'est pas encore validée ; le recrutement doit rester limité jusqu'à ce que les signaux de demande se renforcent.",
    Spanish:
      "Precaución: la demanda del mercado para esta oportunidad aún no está validada, por lo que la contratación debe mantenerse limitada hasta que las señales de demanda se fortalezcan.",
  },
  negativeUnitEconomics: {
    English:
      "Caution: unit economics do not yet support this pace -- LTV/CAC needs to clear a healthy threshold before scaling spend rather than after.",
    Turkish:
      "Uyarı: birim ekonomisi henüz bu hızı desteklemiyor -- harcamayı ölçeklendirmeden önce LTV/CAC sağlıklı bir eşiği geçmelidir.",
    German:
      "Hinweis: Die Unit Economics unterstützen dieses Tempo noch nicht -- der LTV/CAC-Wert sollte einen gesunden Schwellenwert erreichen, bevor die Ausgaben skaliert werden.",
    French:
      "Attention : l'économie unitaire ne soutient pas encore ce rythme -- le ratio LTV/CAC doit atteindre un seuil sain avant d'augmenter les dépenses, pas après.",
    Spanish:
      "Precaución: la economía unitaria aún no respalda este ritmo -- el ratio LTV/CAC debe alcanzar un umbral saludable antes de escalar el gasto, no después.",
  },
  lowRunway: {
    English:
      "Caution: current runway is thin, so any increase in burn should be conditioned on a funding plan rather than assumed alongside it.",
    Turkish:
      "Uyarı: mevcut finansal pist kısa olduğundan, harcamadaki her artış bir finansman planına bağlı olmalı, ondan bağımsız varsayılmamalıdır.",
    German:
      "Hinweis: Die aktuelle Finanzierungsreichweite ist knapp, daher sollte jede Erhöhung der Ausgaben an einen Finanzierungsplan geknüpft sein, nicht parallel dazu angenommen werden.",
    French:
      "Attention : la trésorerie actuelle est limitée ; toute augmentation des dépenses devrait être conditionnée à un plan de financement plutôt que supposée en parallèle.",
    Spanish:
      "Precaución: la pista financiera actual es limitada, por lo que cualquier aumento del gasto debe condicionarse a un plan de financiamiento, no asumirse en paralelo.",
  },
  lowValidationConfidence: {
    English:
      "Caution: product-market fit and customer validation are still weak, so this should follow evidence of repeatable demand rather than precede it.",
    Turkish:
      "Uyarı: ürün-pazar uyumu ve müşteri doğrulaması hâlâ zayıf olduğundan, bu adım tekrarlanabilir talep kanıtından önce değil sonra atılmalıdır.",
    German:
      "Hinweis: Product-Market-Fit und Kundenvalidierung sind noch schwach, daher sollte dies auf Nachweise für wiederholbare Nachfrage folgen, nicht ihnen vorausgehen.",
    French:
      "Attention : l'adéquation produit-marché et la validation client restent faibles ; cette étape devrait suivre la preuve d'une demande répétable, pas la précéder.",
    Spanish:
      "Precaución: el ajuste producto-mercado y la validación de clientes siguen siendo débiles, por lo que esto debería seguir a la evidencia de demanda repetible, no precederla.",
  },
};

type StrategicContradictionRule = {
  signal: keyof StrategicSignalFlags;
  fields: readonly string[];
  pattern: RegExp;
};

// Deliberately narrow, specific phrases -- not broad words like "scale" or
// "pricing" alone, which are used constantly in perfectly legitimate,
// already-qualified sentences ("scale only after validating demand").
// Each pattern targets the unqualified, confidently aggressive phrasing
// the live audit actually found paired with a weak underlying signal.
const strategicContradictionRules: StrategicContradictionRule[] = [
  {
    signal: "weakCompetitiveAdvantage",
    fields: ["pricingStrategy", "executiveSummary"],
    pattern: /\b(?:premium pricing|pricing power|charge a premium|price at a premium|strong pricing power)\b/i,
  },
  {
    signal: "weakMarketOpportunity",
    fields: ["founderRoadmap", "roadmap306090", "goToMarketPlan"],
    pattern: /\b(?:aggressive(?:ly)?\s+hir\w+|hire\s+aggressively|scale\s+the\s+team\s+rapidly|rapid(?:ly)?\s+hir\w+)\b/i,
  },
  {
    signal: "negativeUnitEconomics",
    fields: ["scenarioAnalysis", "founderRoadmap", "roadmap306090", "executiveSummary"],
    pattern: /\b(?:scale\s+rapidly|scale\s+aggressively|aggressive(?:ly)?\s+scal\w+|rapid(?:ly)?\s+scal\w+)\b/i,
  },
  {
    signal: "lowRunway",
    fields: ["financialAssumptions", "unitEconomics", "financialDashboard", "scenarioAnalysis"],
    pattern: /\b(?:increase\s+(?:the\s+)?burn(?:\s+rate)?|raise\s+(?:the\s+)?burn(?:\s+rate)?|spend\s+aggressively|increase\s+spend\s+aggressively)\b/i,
  },
  {
    signal: "lowValidationConfidence",
    fields: ["goToMarketPlan", "founderRoadmap", "roadmap306090"],
    pattern: /\b(?:expand(?:ing)?\s+internationally|international\s+expansion|enter\s+international\s+markets)\b/i,
  },
  {
    signal: "lowValidationConfidence",
    fields: ["salesStrategy", "goToMarketPlan", "pricingStrategy"],
    pattern: /\b(?:large\s+marketing\s+spend|significant\s+marketing\s+budget|scale\s+marketing\s+spend|aggressive\s+marketing\s+spend)\b/i,
  },
];

// RULE G is structurally different from RULES A-F above: instead of a
// pre-computed numeric signal contradicting a phrase in another section,
// it is two pieces of TEXT the report wrote itself contradicting each
// other -- the Risks section calling out regulatory/compliance/legal
// exposure as high, while a summary section separately concludes "low
// overall risk." Shaped after resolveRiskOpportunityDuplicates immediately
// above: read one field to detect a condition, then correct a sentence in
// another. Never deletes or downgrades the regulatory-risk finding itself
// (that would hide real information) -- only appends the same short,
// non-fabricating caveat pattern used by RULES A-F to the contradicting
// "low risk" sentence.
const highRegulatoryRiskPattern =
  /\bhigh\b[^.\n]{0,80}\b(?:regulatory|compliance|legal)\b|\b(?:regulatory|compliance|legal)\b[^.\n]{0,80}\bhigh\b/i;
const lowOverallRiskPattern =
  /\blow(?:\s+overall)?\s+risk\b|\brisk\b[^.\n]{0,40}\bis\s+low\b/i;

const regulatoryRiskCaveat: Record<ResponseLanguage, string> = {
  English:
    "Caution: this report's own Risks section flags high regulatory/compliance exposure, so overall risk should not be characterized as low without addressing that exposure first.",
  Turkish:
    "Uyarı: bu raporun kendi Riskler bölümü yüksek düzenleyici/uyum riski belirtiyor, bu nedenle bu risk ele alınmadan genel risk düşük olarak nitelendirilmemelidir.",
  German:
    "Hinweis: Der eigene Risikoabschnitt dieses Berichts weist auf ein hohes regulatorisches/Compliance-Risiko hin, daher sollte das Gesamtrisiko nicht als niedrig eingestuft werden, ohne dieses Risiko zuerst zu adressieren.",
  French:
    "Attention : la section Risques de ce rapport signale une exposition réglementaire/de conformité élevée ; le risque global ne devrait pas être qualifié de faible sans d'abord traiter cette exposition.",
  Spanish:
    "Precaución: la propia sección de Riesgos de este informe señala una alta exposición regulatoria/de cumplimiento, por lo que el riesgo general no debe calificarse como bajo sin abordar primero esa exposición.",
};

function resolveRegulatoryRiskLowRiskContradiction(
  sections: Record<string, string>,
  fields: readonly string[],
  risksField: string,
  language: ResponseLanguage,
  corrections: ConsistencyCorrection[]
) {
  const risksContent = sections[risksField];
  if (!risksContent || !highRegulatoryRiskPattern.test(risksContent)) return;

  const caveat = regulatoryRiskCaveat[language] ?? regulatoryRiskCaveat.English;
  const fieldSet = new Set(fields);

  for (const field of fieldSet) {
    const content = sections[field];
    // Already carries this caution somewhere in the field -- never stack
    // a duplicate onto a re-run/repeated pass over already-corrected
    // content.
    if (!content || content.includes(caveat)) continue;

    const sentences = content.split(/(?<=[.!?\n])\s+/);
    let changed = false;
    const nextSentences = sentences.flatMap((sentence) => {
      if (!lowOverallRiskPattern.test(sentence)) {
        return [sentence];
      }
      changed = true;
      return [sentence, caveat];
    });

    if (changed) {
      const nextContent = nextSentences.join(" ");
      corrections.push({
        field,
        type: "strategic_signal_contradiction",
        before: content,
        after: nextContent,
      });
      sections[field] = nextContent;
    }
  }
}

function resolveStrategicSignalMismatches(
  sections: Record<string, string>,
  fields: readonly string[],
  flags: StrategicSignalFlags | undefined,
  language: ResponseLanguage,
  corrections: ConsistencyCorrection[]
) {
  if (!flags) return;

  const fieldSet = new Set(fields);

  for (const rule of strategicContradictionRules) {
    if (!flags[rule.signal]) continue;

    const caveat = strategicSignalCaveats[rule.signal][language] ?? strategicSignalCaveats[rule.signal].English;

    for (const field of rule.fields) {
      if (!fieldSet.has(field)) continue;

      const content = sections[field];
      // Already carries this caution somewhere in the field -- never
      // stack a duplicate onto a re-run/repeated pass over
      // already-corrected content.
      if (!content || content.includes(caveat)) continue;

      const sentences = content.split(/(?<=[.!?\n])\s+/);
      let changed = false;
      const nextSentences = sentences.flatMap((sentence) => {
        if (!rule.pattern.test(sentence)) {
          return [sentence];
        }
        changed = true;
        return [sentence, caveat];
      });

      if (changed) {
        const nextContent = nextSentences.join(" ");
        corrections.push({
          field,
          type: "strategic_signal_contradiction",
          before: content,
          after: nextContent,
        });
        sections[field] = nextContent;
      }
    }
  }
}

// score: 100 minus a fixed penalty per correction actually applied,
// floored at 0. Purely internal -- never rendered in any report
// section, PDF, or API response body a user reads.
function computeConsistencyScore(correctionsApplied: readonly ConsistencyCorrection[]) {
  return Math.max(0, 100 - correctionsApplied.length * 8);
}

export type MetricConsistencyTarget = {
  labelPattern: string;
  canonicalDisplayValue: string;
  type?: ConsistencyCorrectionType;
};

export type ConsistencyValidationInput = {
  sections: Record<string, string>;
  fields: readonly string[];
  language: ResponseLanguage;
  authoritativeDecision?: string;
  // The current, canonical Executive Decision token (e.g. "GO"/
  // "CONDITIONAL GO"/"NO-GO", localized to `language`) -- the same value
  // the Executive Summary's own decision line was rendered from. Corrects
  // any other section that states this vocabulary's tokens differently.
  // Independent of, and additive to, authoritativeDecision above (which
  // only ever matches the older PASS/HOLD/VALIDATE/REJECT vocabulary).
  authoritativeExecutiveDecisionToken?: string;
  decisionProtectedFields?: readonly string[];
  metricTargets?: readonly MetricConsistencyTarget[];
  metricProtectedFields?: readonly string[];
  riskOpportunity?: {
    risksField: string;
    opportunitiesHostField: string;
    // Omit when opportunitiesHostField is itself the whole
    // opportunities field (no sub-section extraction needed).
    opportunitiesHeading?: string;
  };
  strategicSignals?: StrategicSignalFlags;
  // Field to scan for regulatory/compliance/legal risk language, used to
  // detect a contradiction against any other field claiming "low overall
  // risk." Omit to skip RULE G entirely (e.g. no Risks field exists).
  regulatoryRiskField?: string;
};

// Runs every cross-section consistency check against the report's own
// canonical values and applies corrections in place (mutates
// `input.sections`). Returns the internal-only score/correction log --
// never write this into report content.
export function runConsistencyValidationPass(
  input: ConsistencyValidationInput
): ConsistencyValidationResult {
  const corrections: ConsistencyCorrection[] = [];
  const decisionProtected = new Set(input.decisionProtectedFields ?? []);
  const metricProtected = new Set(input.metricProtectedFields ?? []);

  if (input.authoritativeDecision) {
    correctRecommendationMentions(
      input.sections,
      input.fields,
      input.authoritativeDecision,
      input.language,
      decisionProtected,
      corrections
    );
  }

  if (input.authoritativeExecutiveDecisionToken) {
    correctExecutiveDecisionMentions(
      input.sections,
      input.fields,
      input.authoritativeExecutiveDecisionToken,
      input.language,
      decisionProtected,
      corrections
    );
  }

  for (const target of input.metricTargets ?? []) {
    if (!target.canonicalDisplayValue) {
      continue;
    }

    correctMetricMentions(
      input.sections,
      input.fields,
      target.labelPattern,
      target.canonicalDisplayValue,
      target.type ?? "financial_metric_mismatch",
      metricProtected,
      corrections
    );
  }

  if (input.riskOpportunity) {
    resolveRiskOpportunityDuplicates(
      input.sections,
      input.riskOpportunity.risksField,
      input.riskOpportunity.opportunitiesHostField,
      input.riskOpportunity.opportunitiesHeading,
      corrections
    );
  }

  resolveStrategicSignalMismatches(
    input.sections,
    input.fields,
    input.strategicSignals,
    input.language,
    corrections
  );

  if (input.regulatoryRiskField) {
    resolveRegulatoryRiskLowRiskContradiction(
      input.sections,
      input.fields,
      input.regulatoryRiskField,
      input.language,
      corrections
    );
  }

  return {
    score: computeConsistencyScore(corrections),
    correctionsApplied: corrections,
  };
}
