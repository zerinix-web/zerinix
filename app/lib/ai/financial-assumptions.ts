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
import { getEvidenceLabel, inferEvidenceLevel } from "@/app/lib/report-evidence";

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

function formatMetricRow(metric: FinancialMetricModel, benchmarkSource: string) {
  const formattedValue = formatFinancialModelValue(metric);
  const evidence = getEvidenceLabel(
    inferEvidenceLevel({
      label: metric.label,
      value: formattedValue,
      context: `${metric.formula}; ${metric.assumptions.join("; ")}; ${metric.benchmarkComparison}; confidence=${metric.confidence}`,
    })
  );

  return [
    `- ${metric.label}: ${formattedValue}`,
    `evidence=${evidence}`,
    `formula=${metric.formula}`,
    `assumptions=${metric.assumptions.join("; ")}`,
    `benchmark=${metric.benchmarkComparison}`,
    `benchmarkSource=${benchmarkSource}`,
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
  const isMobility = context.inputs.industryKey === "mobility";
  const customerLabel = isMobility ? "active riders" : "customers";
  const monthlyRevenueLabel = isMobility ? "Monthly Revenue" : "MRR";
  const yearlyRevenueLabel = isMobility ? "Yearly Revenue" : "ARR";
  const metricRows = Object.values(context.metrics)
    .map((metric) => formatMetricRow(metric, context.benchmark.basis))
    .join("\n");
  const forecastRows = context.revenueForecast
    .map(
      (year) =>
        `- ${year.year}: ${customerLabel}=${year.customers}, ${monthlyRevenueLabel}=${formatUsd(year.mrr)}, ${yearlyRevenueLabel}=${formatUsd(year.arr)}, revenue=${formatUsd(year.revenue)}, SOM penetration=${Math.round(year.marketPenetration * 100)}%`
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

	Evidence model:
	- Verified: user-provided facts only, including the submitted idea context (${context.normalizedBusinessIdea}) and any explicit facts stated by the user.
	- Benchmark Derived: industry benchmark ranges, market sizing, growth, margin, CAC, LTV, payback, EBITDA, revenue multiple, and operating assumptions from the selected benchmark basis.
	- Planning Assumption: geography multiplier, serviceable market rate, obtainable share rate, customer count, pricing model, burn rate, runway target, startup capex, and break-even timing where direct user data is absent.
	- Validation Required: metrics or claims that require primary research, customer interviews, pricing tests, cohort data, or real operating data before investment decisions.

${investmentScoreContext}

Financial modeling rules:
- Use the structured financial model above as the single source of truth for all financial metrics.
- Do not replace these values with generic ranges, generic templates, or unrelated benchmarks.
- Explain every major number with its formula, assumptions, benchmark comparison, and evidence label from the canonical set.
- If evidence is Validation Required, explicitly warn that the estimate needs validation instead of presenting it as precise.
- Financial Dashboard, Unit Economics, Scenario Analysis, Executive Summary, Executive Recommendation, KPI Dashboard, and Financial Assumptions must reuse these same values.
- Scenario Analysis may vary these values for worst/base/best cases, but Base Case must match this calculated model exactly.
- Use the Investment Scoring Engine as the source of truth for Total Investment Score, confidence, strengths, weaknesses, Founder Score, and investment recommendation logic.
- Do not invent static investment scores or category scores; reuse the calculated score and category reasoning above.
- Executive Summary and Executive Recommendation must use the calculated Recommendation, Estimated Valuation, Funding Stage, Top Risks, and Next Critical Action from the Investment Scoring Engine.
- For recurring software models, ARR and MRR are appropriate. For mobility, retail, hospitality, manufacturing, and other non-subscription models, use business-model-specific revenue labels from the structured model instead of SaaS labels.
- For revenue, CAC, LTV, Gross Margin, Burn, Runway, EBITDA, and Break-even, show value, formula, assumptions, evidence label, and benchmark source when the section is responsible for financial explanation.
	- Financial Assumptions must be written as a Key Assumptions section that lists every calculation assumption and classifies each as Verified, Benchmark Derived, Planning Assumption, or Validation Required.
	- Tag important claims with one concise evidence label only when useful: Verified, Benchmark Derived, Planning Assumption, or Validation Required. Do not create fake citations.`;
}
