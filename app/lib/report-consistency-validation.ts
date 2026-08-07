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

export type ConsistencyCorrectionType =
  | "recommendation_mismatch"
  | "market_size_mismatch"
  | "growth_rate_mismatch"
  | "financial_metric_mismatch"
  | "timeline_mismatch"
  | "risk_opportunity_duplicate";

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

  return {
    score: computeConsistencyScore(corrections),
    correctionsApplied: corrections,
  };
}
