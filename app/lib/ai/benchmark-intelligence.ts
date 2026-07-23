import type { BenchmarkConfidence, BenchmarkRange } from "@/app/lib/ai/industry-benchmarks";
import type { FinancialMetricModel, FinancialModel } from "@/app/lib/ai/financial-model";

export type BenchmarkDeviationStatus = "Above Benchmark" | "Below Benchmark" | "Within Benchmark" | "Needs Validation";

export type BenchmarkDeviation = {
  metric: string;
  userValue: string;
  benchmarkRange: string;
  status: BenchmarkDeviationStatus;
};

export type BenchmarkScore = {
  version: "benchmark_intelligence_engine_v2";
  overallFit: number;
  dimensions: {
    industryFit: number;
    businessModelFit: number;
    geographyFit: number;
    pricingFit: number;
    financialBenchmarkFit: number;
  };
  confidence: BenchmarkConfidence;
  deviations: BenchmarkDeviation[];
  insights: string[];
  actions: string[];
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rangeMidpoint(range: BenchmarkRange) {
  return (range.low + range.high) / 2;
}

function formatRange(range: BenchmarkRange) {
  if (range.unit === "percent") {
    return `${Math.round(range.low * 100)}%-${Math.round(range.high * 100)}%`;
  }

  if (range.unit === "months") {
    return `${range.low}-${range.high} months`;
  }

  if (range.unit === "multiple") {
    return `${range.low}x-${range.high}x`;
  }

  const formatUsd = (value: number) =>
    value >= 1_000_000
      ? `$${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `$${Math.round(value / 1_000)}k`
        : `$${Math.round(value)}`;

  return `${formatUsd(range.low)}-${formatUsd(range.high)}`;
}

function metricFitScore(value: number, range: BenchmarkRange, lowerIsBetter = false) {
  if (value >= range.low && value <= range.high) {
    return 82;
  }

  const midpoint = Math.max(0.0001, rangeMidpoint(range));
  const distance = value < range.low ? (range.low - value) / midpoint : (value - range.high) / midpoint;
  const base = lowerIsBetter && value < range.low ? 88 : 64;

  return clampScore(base - distance * 30);
}

function deviationFor(metric: FinancialMetricModel, range: BenchmarkRange, lowerIsBetter = false): BenchmarkDeviation {
  const status: BenchmarkDeviationStatus =
    metric.confidence === "Low"
      ? "Needs Validation"
      : metric.value >= range.low && metric.value <= range.high
        ? "Within Benchmark"
        : metric.value > range.high
          ? lowerIsBetter
            ? "Above Benchmark"
            : "Above Benchmark"
          : "Below Benchmark";

  return {
    metric: metric.label,
    userValue: metric.displayValue,
    benchmarkRange: formatRange(range),
    status,
  };
}

function confidenceFromScore(score: number): BenchmarkConfidence {
  if (score >= 72) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

export function createBenchmarkIntelligenceScore(financialModel: FinancialModel): BenchmarkScore {
  const { benchmarkFit, metrics, inputs, benchmark } = financialModel;
  const validationPenalty = benchmarkFit.validationGaps.length * 5;
  const industryFit =
    benchmarkFit.fit === "Strong Fit"
      ? 84
      : benchmarkFit.fit === "Moderate Fit"
        ? 68
        : 46;
  const businessModelFit = clampScore(
    (/d2c|b2b|b2c|subscription|saas|marketplace|ecommerce|manufacturing|services|abonelik/i.test(inputs.businessModel)
      ? 72
      : 54) - validationPenalty
  );
  const geographyFit = clampScore(
    (/turkey|türkiye|us|usa|uk|europe|gcc|global|local|regional/i.test(inputs.geography)
      ? 68
      : 48) - Math.min(12, validationPenalty)
  );
  const pricingFit = clampScore(
    metricFitScore(metrics.arpa.value, {
      low: benchmark.ranges.cac.low / 200,
      high: benchmark.ranges.ltv.high / 24,
      unit: "usd",
    }) - (metrics.arpa.confidence === "Low" ? 12 : 0)
  );
  const financialMetricScores = [
    metricFitScore(metrics.grossMargin.value, benchmark.ranges.grossMargin),
    metricFitScore(metrics.cac.value, benchmark.ranges.cac, true),
    metricFitScore(metrics.ltv.value, benchmark.ranges.ltv),
    metricFitScore(metrics.cacPayback.value, benchmark.ranges.cacPayback, true),
  ];
  const financialBenchmarkFit = clampScore(
    financialMetricScores.reduce((sum, score) => sum + score, 0) / financialMetricScores.length
  );
  const overallFit = clampScore(
    industryFit * 0.22 +
      businessModelFit * 0.2 +
      geographyFit * 0.16 +
      pricingFit * 0.17 +
      financialBenchmarkFit * 0.25
  );
  const deviations = [
    deviationFor(metrics.cac, benchmark.ranges.cac, true),
    deviationFor(metrics.cacPayback, benchmark.ranges.cacPayback, true),
    deviationFor(metrics.grossMargin, benchmark.ranges.grossMargin),
    deviationFor(metrics.ltv, benchmark.ranges.ltv),
  ];
  const gaps = deviations.filter((deviation) => deviation.status !== "Within Benchmark");
  const insights = [
    `${benchmark.label} benchmark fit is ${confidenceFromScore(overallFit).toLowerCase()} confidence at ${overallFit}/100.`,
    gaps.some((gap) => gap.metric === "CAC") ? "CAC is the most decision-sensitive benchmark gap." : "",
    gaps.some((gap) => gap.metric === "CAC Payback") ? "Payback requires validation before scaling spend." : "",
    financialBenchmarkFit < 60 ? "Financial benchmark fit is not strong enough for aggressive scaling." : "",
  ].filter(Boolean);
  const actions = [
    pricingFit < 65 ? "Validate pricing with willingness-to-pay tests." : "",
    gaps.some((gap) => gap.metric === "CAC") ? "Test acquisition channels before increasing budget." : "",
    financialBenchmarkFit < 65 ? "Reduce initial capital exposure until economics improve." : "",
    geographyFit < 60 ? "Validate geographic demand and market access assumptions." : "",
  ].filter(Boolean);

  return {
    version: "benchmark_intelligence_engine_v2",
    overallFit,
    dimensions: {
      industryFit: clampScore(industryFit),
      businessModelFit,
      geographyFit,
      pricingFit,
      financialBenchmarkFit,
    },
    confidence: confidenceFromScore(overallFit),
    deviations,
    insights: insights.slice(0, 4),
    actions: actions.length ? actions.slice(0, 4) : ["Monitor benchmark assumptions against real operating data."],
  };
}
