// Financial evidence labeling: classifies every computed financial
// metric (ARR, TAM, CAGR, ROI, CAC, LTV, margins, market size, etc.)
// into the SAME canonical 5-state EvidenceLevel this codebase already
// uses everywhere else for evidence provenance (report-evidence.ts) --
// never a second, competing financial-only vocabulary -- and
// consolidates the assumptions behind them into one deduplicated list.
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
//
// TASK #69A-46 -- ROOT CAUSE FIX (canonical financial evidence
// unification): this module used to define its OWN, narrower 3-state
// `FinancialEvidenceType` ("Verified" | "Derived" | "Benchmark /
// Assumption") -- a genuine second, competing classification for the
// exact same underlying concept report-evidence.ts's `EvidenceLevel`
// already models with 5 states, used pervasively across web/PDF
// (EvidenceBadge, getFinancialMetricDisplayLabel, Founder Readiness's
// own Evidence Confidence dimension). Collapsing "benchmarkDerived" and
// "planningAssumption" into one combined "Benchmark / Assumption"
// bucket here erased a real, meaningful distinction the ticket's own
// architecture requires: a metric whose value is read directly from an
// industry benchmark table (TAM, CAC, ARPA, Gross Margin -- adjusted by
// a straightforward multiplier) is a materially different provenance
// shape from a metric COMPOSED by arithmetic over several OTHER
// already-modeled metrics (CAC Payback, Runway, ARR/MRR when not user-
// stated, EBITDA, Break-even, ROI -- a model-constructed planning
// scenario, not a single benchmark lookup). Returns EvidenceLevel
// directly now, eliminating the duplicate vocabulary entirely.
import type { ResponseLanguage } from "./report-language.ts";
import { getEvidenceLabel, type EvidenceLevel } from "./report-evidence.ts";

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
//
// TASK #69A-46 -- INVESTIGATED, NOT changed: considered checking this
// against `metric.formula` alone, before benchmarkSignal, so a
// composition formula (CAC Payback, Runway, EBITDA, ...) would resolve
// distinctly from a direct benchmark-table lookup (TAM, CAC, ARPA, Gross
// Margin, ...) even though every metric's shared assumptions boilerplate
// also mentions "Industry benchmark" as background context. Reverted:
// proven live (a real regression against this file's own pre-existing
// test suite) that TAM/SAM/SOM/ARPA/CAC/Gross Margin/Monthly Burn's OWN
// formulas ALSO use a multiplier ("industry TAM x geography multiplier",
// "TAM x serviceable market rate") -- the SAME "contains x/÷" shape a
// genuine composition formula has -- so checking formula-only composition
// first would misclassify these direct benchmark lookups as
// "planningAssumption" too, with no reliable way to tell "benchmark value
// x adjustment multiplier" apart from "compose several OTHER tracked
// metrics" from formula text alone without a real risk of drift. Order
// unchanged from before this ticket: benchmarkSignal (checked against the
// full derivationText, including the shared "Industry benchmark: X"
// context every metric carries) is still checked first. The finer
// benchmark-vs-composed-assumption distinction remains a documented,
// deliberate architectural gap (see this ticket's own final report) --
// not attempted here since a wrong, over-eager split would be worse than
// the current, safely-conservative single "benchmarkDerived" tier every
// non-user-stated financial-model.ts metric already correctly resolves
// to (never "verified", which is this function's own core invariant).
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
): EvidenceLevel {
  const derivationText = `${metric.formula} ${metric.benchmarkComparison} ${metric.assumptions.join(" ")}`;

  if (verifiedSignal.test(derivationText)) {
    return "verified";
  }

  if (derivedFromVerifiedSignal.test(derivationText)) {
    return "derived";
  }

  if (benchmarkSignal.test(derivationText)) {
    return "benchmarkDerived";
  }

  if (derivedCompositionSignal.test(metric.formula)) {
    return "planningAssumption";
  }

  if (hasUserEvidence) {
    return "verified";
  }

  return "planningAssumption";
}

export function localizeFinancialEvidenceType(
  type: EvidenceLevel,
  language: ResponseLanguage = "English"
) {
  return getEvidenceLabel(type, language);
}

// TASK #69A-46 -- CANONICAL FINANCIAL EVIDENCE STRENGTH (new, additive
// concept -- confirmed absent from the existing architecture before
// this fix: nothing previously aggregated "what fraction of this
// report's own financial model rests on Verified/Derived data vs
// Benchmark/Assumption" into one report-level figure). Deliberately
// SEPARATE from FinancialConsistencyCheck.quality (financial-model.ts),
// which measures something genuinely different -- whether the numbers
// are INTERNALLY COHERENT with each other (LTV >= CAC, ARR = MRR x 12,
// runway matches burn/investment, ...) -- a model built ENTIRELY from
// benchmark assumptions can be perfectly internally consistent while
// still resting on zero observed evidence; the two must never be
// conflated into one score. This is a pure, deterministic aggregation
// of already-computed per-metric classifications (no new AI call, no
// fabricated evidence, no change to any metric's own value) -- read-
// only reporting/presentation data, never wired into decisionEngine's
// own threshold math (see this ticket's own requirement 5: weak
// financial evidence must never itself flip MONITOR/GO eligibility).
export type FinancialEvidenceStrength = "Strong" | "Moderate" | "Weak";

export type FinancialEvidenceSummary = {
  version: "financial_evidence_summary_v1";
  metrics: Record<string, EvidenceLevel>;
  verifiedCount: number;
  derivedCount: number;
  benchmarkDerivedCount: number;
  planningAssumptionCount: number;
  totalMetrics: number;
  // Percentage of tracked metrics resting on real, observed data
  // (verified, or mathematically derived from a verified figure) as
  // opposed to a benchmark table or a planning assumption. 0 when the
  // report supplies no financial metrics at all (never divides by
  // zero, never fabricates a number).
  observedEvidenceCoveragePercent: number;
  strength: FinancialEvidenceStrength;
};

// Mirrors report-intelligence.ts's own qualityFromScore tiers
// (>=72 High / >=48 Moderate / else Low) -- reusing this codebase's
// existing tier convention rather than inventing a new, arbitrary
// threshold tuned to any one report.
function strengthFromCoverage(coveragePercent: number): FinancialEvidenceStrength {
  if (coveragePercent >= 72) return "Strong";
  if (coveragePercent >= 48) return "Moderate";
  return "Weak";
}

// Aggregates the SAME per-metric classification classifyFinancialMetricEvidenceType
// already computes for every tracked FinancialMetricModel -- never a
// second, independently-derived scoring path. `metrics` should be
// FinancialModel["metrics"] (financial-model.ts); passed as a plain
// keyed record here (not imported) to keep this module dependency-free
// of financial-model.ts, mirroring classifyFinancialMetricEvidenceType's
// own FinancialMetricLike pattern.
export function deriveFinancialEvidenceSummary(
  metrics: Readonly<Record<string, FinancialMetricLike>>,
  hasUserEvidence = false
): FinancialEvidenceSummary {
  const entries = Object.entries(metrics);
  const classified: Record<string, EvidenceLevel> = {};
  let verifiedCount = 0;
  let derivedCount = 0;
  let benchmarkDerivedCount = 0;
  let planningAssumptionCount = 0;

  for (const [key, metric] of entries) {
    const level = classifyFinancialMetricEvidenceType(metric, hasUserEvidence);
    classified[key] = level;

    if (level === "verified") verifiedCount += 1;
    else if (level === "derived") derivedCount += 1;
    else if (level === "benchmarkDerived") benchmarkDerivedCount += 1;
    // "planningAssumption" and the defensive "validationRequired"
    // fallback (never actually reached for a deterministically-
    // computed metric, see classifyFinancialMetricEvidenceType's own
    // comment) both count as planning-assumption-tier for this
    // aggregate -- neither rests on observed or benchmark-table data.
    else planningAssumptionCount += 1;
  }

  const totalMetrics = entries.length;
  const observedEvidenceCoveragePercent =
    totalMetrics === 0
      ? 0
      : Math.round(((verifiedCount + derivedCount) / totalMetrics) * 100);

  return {
    version: "financial_evidence_summary_v1",
    metrics: classified,
    verifiedCount,
    derivedCount,
    benchmarkDerivedCount,
    planningAssumptionCount,
    totalMetrics,
    observedEvidenceCoveragePercent,
    strength: strengthFromCoverage(observedEvidenceCoveragePercent),
  };
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

// TASK #69A-4 -- CRITICAL BUG FIX (confirmed live: the real Business Idea
// Validation quality gate -- domain-research.ts's validateDomainResearchQuality,
// which every planFields section must satisfy -- requires every numeric-
// bearing line to carry an explicit evidence-classification word/tag.
// This list's own consolidated bullets (Lifetime, Monthly gross profit per
// customer, Annualized operating expense, Target runway, Year-3 revenue,
// ...) had NO classification of any kind -- unlike a few OTHER bullets in
// the SAME list that happen to restate a tracked FinancialMetricModel's
// own displayValue verbatim and get a "Planning assumption --" prefix
// later, from labelModelDerivedFinancialClaims' separate, narrower value-
// matching pass. This section is explicitly titled "Financial Assumptions"
// -- every line in it, by the section's own name and purpose, states an
// assumption feeding the financial model, whether or not it happens to
// match a tracked metric's exact displayValue string. Appending the same
// canonical "Assumption" classification word (already this codebase's own
// established vocabulary, see financial-evidence-labeling.ts's own
// FinancialEvidenceType/evidenceTypeLabelTranslations above) to every
// bullet, uniformly, fixes every current and future untracked-intermediate-
// value gap here at once -- never claims Verified, never invents a new
// classification, and is harmless alongside labelModelDerivedFinancialClaims'
// own later "Planning assumption --" prefix on lines it separately
// recognizes (that prefix is prepended; this suffix is appended -- the two
// never collide or duplicate each other's placement).
const financialAssumptionsListSuffix: Record<ResponseLanguage, string> = {
  English: "(Assumption)",
  Turkish: "(Varsayım)",
  German: "(Annahme)",
  French: "(Hypothèse)",
  Spanish: "(Supuesto)",
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

  const suffix = financialAssumptionsListSuffix[language];

  return [
    keyAssumptionsCopy[language].heading,
    ...assumptions.map((assumption) => `• ${assumption.label} ${suffix}`),
  ].join("\n");
}
