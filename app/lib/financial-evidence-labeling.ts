// Financial evidence labeling: classifies every computed financial
// metric (ARR, TAM, CAGR, ROI, CAC, LTV, margins, market size, etc.)
// into exactly one of the 3 required evidence types (PRODUCTION DATA
// PROVENANCE POLISH), and consolidates the assumptions behind them into
// one deduplicated list.
//
// Never invents a classification: every metric already carries real,
// already-computed `formula` / `benchmarkComparison` / `assumptions`
// text (see FinancialMetricModel in financial-model.ts) describing
// how it was actually derived. This module only reads that existing
// text to pick the accurate label -- it does not change what any
// metric's value is, and it never upgrades a metric to a stronger
// label than its own derivation text supports (never presents an
// estimate as a verified fact, and never presents a value calculated
// from a verified figure -- e.g. ARR = MRR x 12 -- as itself Verified).
import type { ResponseLanguage } from "./report-language.ts";

export const financialEvidenceTypeValues = [
  "Verified",
  "Derived",
  "Benchmark / Assumption",
] as const;

export type FinancialEvidenceType = (typeof financialEvidenceTypeValues)[number];

export type FinancialMetricLike = {
  label: string;
  formula: string;
  benchmarkComparison: string;
  assumptions: readonly string[];
};

// A metric whose own formula/assumptions text says the value was
// supplied directly (see financial-model.ts's userStated overrides:
// "User-provided (stated directly in the request)", "Actual,
// user-provided MRR: ..."). Checked first: this text can legitimately
// also contain benchmark-sounding words nowhere here, but ordering it
// first keeps the strongest, most specific signal from ever being
// diluted by a weaker one below.
const verifiedSignal = /\buser[\s-]?provided\b|\bstated directly in the request\b/i;
// A metric mathematically calculated only from another verified metric
// (see financial-model.ts: ARR derived from a stated MRR, or vice
// versa). Checked before benchmarkSignal specifically because this
// text's own wording ("derived from the verified MRR", "not a benchmark
// estimate") legitimately contains "verified"/"benchmark" as words
// describing the SOURCE value or a negation, not a benchmark
// classification of this value itself.
const derivedFromVerifiedSignal = /\bderived from the verified\b|\bderived value\b/i;
const benchmarkSignal = /\b(benchmark|industry)\b/i;
// A formula that composes other already-computed values (e.g.
// "CAC / monthly gross profit per customer", "Investment Needed /
// Monthly Burn") rather than citing a benchmark or industry figure --
// the metric is derived by the model's own math from benchmark inputs,
// not a value calculated from a verified user figure (that case is
// caught by derivedFromVerifiedSignal above first).
const derivedCompositionSignal = /[×x/]|\bcalculated from\b|\bderived from\b/i;

// Real, non-generic evidence that the user supplied actual operating
// data (see source-intelligence.ts's identical convention) -- checked
// against the model's own financialConsistency.sources.userProvidedData,
// never fabricated.
export function hasVerifiedUserProvidedData(userProvidedData: readonly string[]) {
  return userProvidedData.some(
    (item) => !/\bno direct operating data\b/i.test(item) && item.trim().length > 0
  );
}

// Classifies a single metric. `hasUserEvidence` should come from
// hasVerifiedUserProvidedData(context.financialConsistency.sources.userProvidedData)
// -- passed in rather than looked up here so this stays a pure,
// dependency-free function.
export function classifyFinancialMetricEvidenceType(
  metric: FinancialMetricLike,
  hasUserEvidence = false
): FinancialEvidenceType {
  const derivationText = `${metric.formula} ${metric.benchmarkComparison} ${metric.assumptions.join(" ")}`;

  if (verifiedSignal.test(derivationText)) {
    return "Verified";
  }

  if (derivedFromVerifiedSignal.test(derivationText)) {
    return "Derived";
  }

  if (benchmarkSignal.test(derivationText)) {
    return "Benchmark / Assumption";
  }

  if (derivedCompositionSignal.test(metric.formula)) {
    return "Benchmark / Assumption";
  }

  if (hasUserEvidence) {
    return "Verified";
  }

  return "Benchmark / Assumption";
}

const evidenceTypeLabelTranslations: Record<ResponseLanguage, Record<FinancialEvidenceType, string>> = {
  English: {
    Verified: "Verified",
    Derived: "Derived",
    "Benchmark / Assumption": "Benchmark / Assumption",
  },
  Turkish: {
    Verified: "Doğrulanmış",
    Derived: "Türetilmiş",
    "Benchmark / Assumption": "Benchmark / Varsayım",
  },
  German: {
    Verified: "Verifiziert",
    Derived: "Abgeleitet",
    "Benchmark / Assumption": "Benchmark / Annahme",
  },
  French: {
    Verified: "Vérifié",
    Derived: "Dérivé",
    "Benchmark / Assumption": "Référence / Hypothèse",
  },
  Spanish: {
    Verified: "Verificado",
    Derived: "Derivado",
    "Benchmark / Assumption": "Referencia / Supuesto",
  },
};

export function localizeFinancialEvidenceType(
  type: FinancialEvidenceType,
  language: ResponseLanguage = "English"
) {
  return evidenceTypeLabelTranslations[language][type];
}

// Normalizes an assumption sentence for deduplication -- strips the
// dynamic numeric/value portion (which differs per report) so two
// assumptions that state the same underlying planning input in the
// same shape (e.g. "Complexity multiplier: 1.18" and "Complexity
// multiplier: 1.3") are recognized as the same assumption and never
// both printed in the consolidated list (requirement 5).
function normalizeAssumptionKey(assumption: string) {
  return assumption
    .toLowerCase()
    .replace(/[:=].*$/, "")
    .replace(/\d+(?:[.,]\d+)?%?/g, "")
    .replace(/[^a-zçğıöşü\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ConsolidatedFinancialAssumption = {
  label: string;
  metricLabels: string[];
};

// Collects every metric's `assumptions` entries and merges duplicates
// that describe the same underlying planning input (even with
// different numeric values) into one entry, listing which metrics
// depend on it. Order-preserving: first occurrence wins.
export function consolidateFinancialAssumptions(
  metrics: readonly FinancialMetricLike[]
): ConsolidatedFinancialAssumption[] {
  const byKey = new Map<string, ConsolidatedFinancialAssumption>();

  for (const metric of metrics) {
    for (const assumption of metric.assumptions) {
      const trimmed = assumption.trim();
      if (!trimmed) continue;

      const key = normalizeAssumptionKey(trimmed);
      if (!key) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (!existing.metricLabels.includes(metric.label)) {
          existing.metricLabels.push(metric.label);
        }
        continue;
      }

      byKey.set(key, { label: trimmed, metricLabels: [metric.label] });
    }
  }

  return [...byKey.values()];
}

const keyAssumptionsCopy: Record<ResponseLanguage, { heading: string }> = {
  English: { heading: "Financial Assumptions" },
  Turkish: { heading: "Finansal Varsayımlar" },
  German: { heading: "Finanzielle Annahmen" },
  French: { heading: "Hypothèses financières" },
  Spanish: { heading: "Supuestos financieros" },
};

// Renders the consolidated, deduplicated assumption list in the
// task's requested format (a plain bullet list under a "Financial
// Assumptions" heading, one line per distinct assumption).
export function formatKeyFinancialAssumptionsList(
  assumptions: readonly ConsolidatedFinancialAssumption[],
  language: ResponseLanguage = "English"
) {
  if (assumptions.length === 0) {
    return "";
  }

  return [
    keyAssumptionsCopy[language].heading,
    ...assumptions.map((assumption) => `• ${assumption.label}`),
  ].join("\n");
}
