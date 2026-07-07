import {
  createFinancialModel,
  formatFinancialModelValue,
  type FinancialMetricModel,
  type FinancialModel,
} from "@/app/lib/ai/financial-model";
import {
  createInvestmentScore,
  formatInvestmentScore,
  type InvestmentScore,
} from "@/app/lib/ai/investment-score";

export type ReportKind = "business_plan" | "market_analysis";
export type AiFinancialModelContext = FinancialModel & {
  investmentScore: InvestmentScore;
};

export function createCanonicalFinancialAssumptions(input: {
  prompt: string;
  reportKind: ReportKind;
}): AiFinancialModelContext {
  const financialModel = createFinancialModel(input);

  return {
    ...financialModel,
    investmentScore: createInvestmentScore({
      prompt: input.prompt,
      financialModel,
    }),
  };
}

function formatMetricRow(metric: FinancialMetricModel) {
  return [
    `- ${metric.label}: ${formatFinancialModelValue(metric)}`,
    `formula=${metric.formula}`,
    `assumptions=${metric.assumptions.join("; ")}`,
    `benchmark=${metric.benchmarkComparison}`,
    `confidence=${metric.confidence}`,
  ].join(" | ");
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;

  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function formatCanonicalFinancialAssumptions(
  context: AiFinancialModelContext
) {
  const metricRows = Object.values(context.metrics).map(formatMetricRow).join("\n");
  const forecastRows = context.revenueForecast
    .map(
      (year) =>
        `- ${year.year}: customers=${year.customers}, MRR=${formatUsd(year.mrr)}, ARR=${formatUsd(year.arr)}, revenue=${formatUsd(year.revenue)}, SOM penetration=${Math.round(year.marketPenetration * 100)}%`
    )
    .join("\n");
  const investmentScoreContext = formatInvestmentScore(context.investmentScore);

  return `Data-Driven Financial Analysis Engine (${context.version}, ${context.fingerprint})
Business idea fingerprint: ${context.normalizedBusinessIdea}
Detected modeling inputs:
- Industry: ${context.inputs.industry}
- Business model: ${context.inputs.businessModel}
- Target customer: ${context.inputs.targetCustomer}
- Geography: ${context.inputs.geography}
- Pricing model: ${context.inputs.pricingModel}
- Benchmark basis: ${context.benchmark.basis}

Structured financial model:
${metricRows}

Revenue forecast:
${forecastRows}

${investmentScoreContext}

Financial modeling rules:
- Use the structured financial model above as the single source of truth for all financial metrics.
- Do not replace these values with generic ranges, generic templates, or unrelated benchmarks.
- Explain every major number with its formula, assumptions, benchmark comparison, and confidence level.
- If confidence is Low, explicitly warn that the estimate needs validation instead of presenting it as precise.
- Financial Dashboard, Unit Economics, Scenario Analysis, Executive Summary, Executive Recommendation, KPI Dashboard, and Financial Assumptions must reuse these same values.
- Scenario Analysis may vary these values for worst/base/best cases, but Base Case must match this calculated model exactly.
- Use the Investment Scoring Engine as the source of truth for Total Investment Score, confidence, strengths, weaknesses, Founder Score, and investment recommendation logic.
- Do not invent static investment scores or category scores; reuse the calculated score and category reasoning above.`;
}
