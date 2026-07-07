import crypto from "node:crypto";
import {
  getIndustryBenchmarks,
  type BenchmarkConfidence,
  type BenchmarkRange,
  type IndustryBenchmark,
  type IndustryKey,
} from "@/app/lib/ai/industry-benchmarks";

export type FinancialModelInput = {
  prompt: string;
  reportKind: "business_plan" | "market_analysis";
};

export type FinancialModelingInputs = {
  industry: string;
  industryKey: IndustryKey;
  businessModel: string;
  targetCustomer: string;
  geography: string;
  pricingModel: string;
};

export type FinancialMetricModel = {
  label: string;
  value: number;
  displayValue: string;
  unit: "usd" | "percent" | "months";
  confidence: BenchmarkConfidence;
  formula: string;
  assumptions: string[];
  benchmarkComparison: string;
};

export type RevenueForecastYear = {
  year: string;
  customers: number;
  mrr: number;
  arr: number;
  revenue: number;
  marketPenetration: number;
};

export type FinancialModel = {
  version: "financial_model_engine_v1";
  fingerprint: string;
  reportKind: FinancialModelInput["reportKind"];
  normalizedBusinessIdea: string;
  inputs: FinancialModelingInputs;
  benchmark: {
    label: string;
    basis: string;
    ranges: IndustryBenchmark["ranges"];
  };
  metrics: {
    tam: FinancialMetricModel;
    sam: FinancialMetricModel;
    som: FinancialMetricModel;
    arpa: FinancialMetricModel;
    cac: FinancialMetricModel;
    ltv: FinancialMetricModel;
    grossMargin: FinancialMetricModel;
    cacPayback: FinancialMetricModel;
    monthlyBurn: FinancialMetricModel;
    runway: FinancialMetricModel;
    arr: FinancialMetricModel;
    revenueGrowth: FinancialMetricModel;
    mrr: FinancialMetricModel;
    ebitda: FinancialMetricModel;
    breakEvenMonth: FinancialMetricModel;
    investmentNeeded: FinancialMetricModel;
    roi: FinancialMetricModel;
  };
  revenueForecast: RevenueForecastYear[];
};

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function firstMatching<T>(matches: Array<[RegExp, T]>, fallback: T, value: string) {
  return matches.find(([pattern]) => pattern.test(value))?.[1] ?? fallback;
}

export function inferIndustryKey(value: string): IndustryKey {
  const normalized = normalizePrompt(value);

  return firstMatching(
    [
      [/\b(ev charging|charging station|charge point|charger network|electric charging)\b/, "evCharging"],
      [/\b(fintech|payments|banking|lending|wallet|neobank|insurance|insurtech)\b/, "fintech"],
      [/\b(ecommerce|e-commerce|online store|shopify|retail marketplace|dtc|direct to consumer)\b/, "ecommerce"],
      [/\b(marketplace|two-sided|two sided|platform marketplace)\b/, "marketplace"],
      [/\b(coffee|cafe|espresso|roastery|tea|beverage)\b/, "luxuryCoffee"],
      [/\b(cybersecurity|security|soc|compliance|threat|fraud)\b/, "cybersecurity"],
      [/\b(ai|artificial intelligence|automation|agent|assistant|llm)\b/, "ai"],
      [/\b(saas|crm|software|platform)\b/, "saas"],
      [/\b(hospital|clinic|healthcare|medical|patient|doctor)\b/, "healthcare"],
      [/\b(logistics|freight|supply chain|warehouse|delivery|shipping)\b/, "logistics"],
      [/\b(hotel|resort|hospitality|travel)\b/, "hospitality"],
      [/\b(yacht|marine|boat|ship|luxury goods|jewelry|watch)\b/, "luxuryGoods"],
      [/\b(battery|ev|electric vehicle|manufacturing|manufacturer|factory|industrial)\b/, "manufacturing"],
      [/\b(gym|fitness|franchise|pilates|wellness club)\b/, "fitness"],
      [/\b(farming|agriculture|vertical farm|food production|greenhouse)\b/, "agriculture"],
      [/\b(agency|consulting|service|studio)\b/, "services"],
    ],
    "services",
    normalized
  );
}

export function inferFinancialModelingInputs(prompt: string): FinancialModelingInputs {
  const normalized = normalizePrompt(prompt);
  const industryKey = inferIndustryKey(prompt);
  const benchmark = getIndustryBenchmarks(industryKey);

  return {
    industry: benchmark.label,
    industryKey,
    businessModel: firstMatching(
      [
        [/\b(saas|subscription|platform|software|crm|cybersecurity)\b/, "subscription software"],
        [/\b(marketplace|two-sided|two sided)\b/, "marketplace"],
        [/\b(franchise|chain)\b/, "multi-location / franchise"],
        [/\b(manufacturer|manufacturing|factory|battery|yacht)\b/, "asset-heavy manufacturing"],
        [/\b(hotel|hospital|clinic|gym|restaurant|coffee|cafe)\b/, "asset-heavy operating company"],
        [/\b(consulting|agency|service|studio)\b/, "services"],
      ],
      benchmark.label,
      normalized
    ),
    targetCustomer: firstMatching(
      [
        [/\b(hospital|clinic|doctor|patient|healthcare)\b/, "healthcare buyers / operators"],
        [/\b(enterprise|b2b|company|companies|business)\b/, "B2B / enterprise customers"],
        [/\b(luxury|premium|affluent|private|yacht|hotel)\b/, "premium consumer / high-net-worth customers"],
        [/\b(founder|startup|smb|small business)\b/, "startups and SMBs"],
        [/\b(government|public sector|municipal)\b/, "public-sector buyers"],
      ],
      "inferred early adopters",
      normalized
    ),
    geography: firstMatching(
      [
        [/\b(us|usa|united states|america)\b/, "United States"],
        [/\b(uk|united kingdom|london)\b/, "United Kingdom"],
        [/\b(europe|eu|germany|france|italy|spain)\b/, "Europe"],
        [/\b(turkey|turkiye|tuerkiye|istanbul|türkiye)\b/, "Turkey"],
        [/\b(gcc|uae|dubai|saudi|qatar)\b/, "GCC / Middle East"],
        [/\b(global|worldwide|international)\b/, "global"],
      ],
      "global / unspecified",
      normalized
    ),
    pricingModel: firstMatching(
      [
        [/\b(subscription|monthly|annual|saas|software|cybersecurity)\b/, "subscription"],
        [/\b(usage|per use|consumption)\b/, "usage-based"],
        [/\b(take rate|commission|marketplace)\b/, "take-rate / commission"],
        [/\b(franchise)\b/, "franchise fee plus royalties"],
        [/\b(coffee|cafe|hotel|yacht|hospital|clinic|gym|luxury|premium)\b/, "premium ticket / membership / service package"],
        [/\b(manufacturer|manufacturing|battery|factory)\b/, "unit sales plus service contracts"],
      ],
      "inferred pricing model",
      normalized
    ),
  };
}

function geographyMultiplier(geography: string) {
  if (geography === "United States") return 0.38;
  if (geography === "Europe") return 0.3;
  if (geography === "United Kingdom") return 0.08;
  if (geography === "Turkey") return 0.035;
  if (geography === "GCC / Middle East") return 0.06;
  return 1;
}

function ideaScopeMultiplier(prompt: string) {
  const normalized = normalizePrompt(prompt);
  let multiplier = 1;

  if (/\b(luxury|premium|enterprise|private|hospital|global)\b/.test(normalized)) {
    multiplier *= 1.35;
  }

  if (/\b(local|small|solo|single location|neighborhood)\b/.test(normalized)) {
    multiplier *= 0.55;
  }

  if (/\b(manufacturer|factory|battery|yacht|hotel|hospital)\b/.test(normalized)) {
    multiplier *= 1.2;
  }

  return multiplier;
}

function confidenceFor(input: {
  base: BenchmarkConfidence;
  prompt: string;
  metric: string;
  industryKey: IndustryKey;
}) {
  const normalized = normalizePrompt(input.prompt);
  const hasSpecificity = /\b(us|usa|uk|europe|turkey|gcc|b2b|enterprise|premium|luxury|subscription|franchise|monthly|annual)\b/.test(
    normalized
  );
  const hardToEstimate =
    input.industryKey === "manufacturing" ||
    input.industryKey === "healthcare" ||
    input.industryKey === "hospitality" ||
    input.industryKey === "luxuryGoods" ||
    input.industryKey === "evCharging" ||
    input.industryKey === "fintech" ||
    input.industryKey === "agriculture";

  if (hardToEstimate && ["TAM", "SAM", "SOM", "EBITDA", "Break-even Month"].includes(input.metric)) {
    return "Low";
  }

  if (hasSpecificity && input.base !== "Low") {
    return "High";
  }

  return input.base;
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;

  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMonths(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} months`;
}

function formatBenchmarkRange(range: BenchmarkRange) {
  if (range.unit === "percent") {
    return `${formatPercent(range.low)}-${formatPercent(range.high)}`;
  }

  if (range.unit === "usd") {
    return `${formatUsd(range.low)}-${formatUsd(range.high)}`;
  }

  if (range.unit === "months") {
    return `${range.low}-${range.high} months`;
  }

  return `${range.low}x-${range.high}x`;
}

function compareToBenchmark(value: number, range: BenchmarkRange) {
  const formattedRange = formatBenchmarkRange(range);

  if (value < range.low) {
    return `Below benchmark range (${formattedRange})`;
  }

  if (value > range.high) {
    return `Above benchmark range (${formattedRange})`;
  }

  return `Within benchmark range (${formattedRange})`;
}

function metric(input: Omit<FinancialMetricModel, "displayValue"> & { displayValue?: string }) {
  return {
    ...input,
    displayValue:
      input.displayValue ??
      (input.unit === "usd"
        ? formatUsd(input.value)
        : input.unit === "percent"
          ? formatPercent(input.value)
          : formatMonths(input.value)),
  };
}

export function createFinancialModel(input: FinancialModelInput): FinancialModel {
  const normalizedBusinessIdea = normalizePrompt(input.prompt);
  const inputs = inferFinancialModelingInputs(input.prompt);
  const benchmark = getIndustryBenchmarks(inputs.industryKey);
  const modeling = benchmark.modeling;
  const geoMultiplier = geographyMultiplier(inputs.geography);
  const scopeMultiplier = ideaScopeMultiplier(input.prompt);
  const tam = modeling.tamUsd * geoMultiplier * scopeMultiplier;
  const sam = tam * modeling.samRate;
  const som = sam * modeling.somRate;
  const arpa = modeling.arpaMonthly * scopeMultiplier;
  const month12Customers = Math.max(1, Math.round(modeling.month12Customers * scopeMultiplier));
  const mrr = month12Customers * arpa;
  const arr = mrr * 12;
  const cac = modeling.cacUsd * (scopeMultiplier > 1 ? 1.18 : 1);
  const grossMargin = modeling.grossMarginRate;
  const ltv = arpa * grossMargin * modeling.lifetimeMonths;
  const cacPayback = cac / Math.max(1, arpa * grossMargin);
  const monthlyBurn = modeling.monthlyBurnUsd * scopeMultiplier;
  const investmentNeeded = monthlyBurn * modeling.targetRunwayMonths + modeling.startupCapexUsd;
  const runway = investmentNeeded / monthlyBurn;
  const annualOpex = monthlyBurn * 12;
  const ebitda = arr * grossMargin - annualOpex;
  const monthlyContribution = mrr * grossMargin;
  const breakEvenMonth =
    monthlyContribution > monthlyBurn
      ? Math.max(1, Math.ceil(modeling.startupCapexUsd / (monthlyContribution - monthlyBurn)))
      : 36 + Math.ceil((monthlyBurn - monthlyContribution) / Math.max(1, monthlyContribution)) * 3;
  const year3Revenue = arr * Math.pow(1 + modeling.customerGrowthRate, 2);
  const year3Ebitda = year3Revenue * grossMargin - annualOpex * 1.35;
  const roi = (year3Ebitda - investmentNeeded) / Math.max(1, investmentNeeded);
  const revenueForecast: RevenueForecastYear[] = [1, 2, 3].map((year) => {
    const customers = Math.round(month12Customers * Math.pow(1 + modeling.customerGrowthRate, year - 1));
    const yearMrr = customers * arpa;
    const yearArr = yearMrr * 12;

    return {
      year: `Year ${year}`,
      customers,
      mrr: yearMrr,
      arr: yearArr,
      revenue: yearArr,
      marketPenetration: yearArr / Math.max(1, som),
    };
  });
  const confidence = (metricName: string) =>
    confidenceFor({
      base: benchmark.confidence,
      prompt: input.prompt,
      metric: metricName,
      industryKey: inputs.industryKey,
    });
  const sharedAssumptions = [
    `Industry benchmark: ${benchmark.label}`,
    `Business model: ${inputs.businessModel}`,
    `Target customer: ${inputs.targetCustomer}`,
    `Geography: ${inputs.geography}`,
    `Pricing model: ${inputs.pricingModel}`,
  ];

  return {
    version: "financial_model_engine_v1",
    fingerprint: hashValue(
      JSON.stringify({
        version: "financial_model_engine_v1",
        prompt: normalizedBusinessIdea,
        reportKind: input.reportKind,
        inputs,
        benchmark,
      })
    ).slice(0, 16),
    reportKind: input.reportKind,
    normalizedBusinessIdea,
    inputs,
    benchmark: {
      label: benchmark.label,
      basis: benchmark.benchmarkBasis,
      ranges: benchmark.ranges,
    },
    metrics: {
      tam: metric({
        label: "TAM",
        value: tam,
        unit: "usd",
        confidence: confidence("TAM"),
        formula: "industry TAM x geography multiplier x idea scope multiplier",
        assumptions: [...sharedAssumptions, `Geography multiplier: ${geoMultiplier}`, `Idea scope multiplier: ${scopeMultiplier}`],
        benchmarkComparison: "Derived from benchmark market scope rather than compared to operating range.",
      }),
      sam: metric({
        label: "SAM",
        value: sam,
        unit: "usd",
        confidence: confidence("SAM"),
        formula: "TAM x serviceable market rate",
        assumptions: [...sharedAssumptions, `Serviceable market rate: ${formatPercent(modeling.samRate)}`],
        benchmarkComparison: "Derived from benchmark serviceable-market rate.",
      }),
      som: metric({
        label: "SOM",
        value: som,
        unit: "usd",
        confidence: confidence("SOM"),
        formula: "SAM x obtainable share rate",
        assumptions: [...sharedAssumptions, `Obtainable share rate: ${formatPercent(modeling.somRate)}`],
        benchmarkComparison: "Derived from benchmark obtainable-share rate.",
      }),
      arpa: metric({
        label: "ARPA",
        value: arpa,
        unit: "usd",
        displayValue: `${formatUsd(arpa)}/month`,
        confidence: confidence("ARPA"),
        formula: "benchmark monthly ARPA x idea scope multiplier",
        assumptions: [...sharedAssumptions, `Month-12 customers: ${month12Customers}`],
        benchmarkComparison: "Uses industry benchmark ARPA as the base case.",
      }),
      cac: metric({
        label: "CAC",
        value: cac,
        unit: "usd",
        confidence: confidence("CAC"),
        formula: "benchmark CAC x complexity multiplier",
        assumptions: [...sharedAssumptions, `Complexity multiplier: ${scopeMultiplier > 1 ? 1.18 : 1}`],
        benchmarkComparison: compareToBenchmark(cac, benchmark.ranges.cac),
      }),
      ltv: metric({
        label: "LTV",
        value: ltv,
        unit: "usd",
        confidence: confidence("LTV"),
        formula: "ARPA x Gross Margin x lifetime months",
        assumptions: [...sharedAssumptions, `Lifetime: ${modeling.lifetimeMonths} months`],
        benchmarkComparison: compareToBenchmark(ltv, benchmark.ranges.ltv),
      }),
      grossMargin: metric({
        label: "Gross Margin",
        value: grossMargin,
        unit: "percent",
        confidence: confidence("Gross Margin"),
        formula: "industry gross margin benchmark",
        assumptions: [...sharedAssumptions, "Gross margin is benchmark-derived until validated by actual COGS."],
        benchmarkComparison: compareToBenchmark(grossMargin, benchmark.ranges.grossMargin),
      }),
      cacPayback: metric({
        label: "CAC Payback",
        value: cacPayback,
        unit: "months",
        confidence: confidence("CAC Payback"),
        formula: "CAC / monthly gross profit per customer",
        assumptions: [...sharedAssumptions, `Monthly gross profit per customer: ${formatUsd(arpa * grossMargin)}`],
        benchmarkComparison: compareToBenchmark(cacPayback, benchmark.ranges.cacPayback),
      }),
      monthlyBurn: metric({
        label: "Monthly Burn",
        value: monthlyBurn,
        unit: "usd",
        displayValue: `${formatUsd(monthlyBurn)}/month`,
        confidence: confidence("Monthly Burn"),
        formula: "benchmark monthly burn x idea scope multiplier",
        assumptions: [...sharedAssumptions, "Includes team, operating overhead, infrastructure, and go-to-market load."],
        benchmarkComparison: "Operating-burn benchmark is industry-specific and adjusted for idea scope.",
      }),
      runway: metric({
        label: "Runway",
        value: runway,
        unit: "months",
        confidence: confidence("Runway"),
        formula: "Investment Needed / Monthly Burn",
        assumptions: [...sharedAssumptions, `Investment needed: ${formatUsd(investmentNeeded)}`],
        benchmarkComparison: "Runway is calculated from financing need and monthly burn.",
      }),
      arr: metric({
        label: "ARR",
        value: arr,
        unit: "usd",
        confidence: confidence("ARR"),
        formula: "MRR x 12",
        assumptions: [...sharedAssumptions, `MRR: ${formatUsd(mrr)}`, `Month-12 customers: ${month12Customers}`],
        benchmarkComparison: "ARR is calculated from customer count and pricing assumptions.",
      }),
      revenueGrowth: metric({
        label: "Revenue Growth",
        value: modeling.customerGrowthRate,
        unit: "percent",
        confidence: confidence("Revenue Growth"),
        formula: "industry customer growth benchmark",
        assumptions: [...sharedAssumptions, "Growth rate is applied to customer count in the 3-year forecast."],
        benchmarkComparison: compareToBenchmark(modeling.customerGrowthRate, benchmark.ranges.arrGrowth),
      }),
      mrr: metric({
        label: "MRR",
        value: mrr,
        unit: "usd",
        confidence: confidence("MRR"),
        formula: "Month-12 customers x ARPA",
        assumptions: [...sharedAssumptions, `Month-12 customers: ${month12Customers}`, `ARPA: ${formatUsd(arpa)}/month`],
        benchmarkComparison: "MRR is calculated from customer count and pricing assumptions.",
      }),
      ebitda: metric({
        label: "EBITDA",
        value: ebitda,
        unit: "usd",
        confidence: confidence("EBITDA"),
        formula: "ARR x Gross Margin - annualized operating expense",
        assumptions: [...sharedAssumptions, `Annualized operating expense: ${formatUsd(annualOpex)}`],
        benchmarkComparison: compareToBenchmark(ebitda / Math.max(1, arr), benchmark.ranges.ebitdaMargin),
      }),
      breakEvenMonth: metric({
        label: "Break-even Month",
        value: Math.max(1, Math.round(breakEvenMonth)),
        unit: "months",
        displayValue: `Month ${Math.max(1, Math.round(breakEvenMonth))}`,
        confidence: confidence("Break-even Month"),
        formula: "Startup capex / monthly contribution above burn",
        assumptions: [...sharedAssumptions, `Startup capex: ${formatUsd(modeling.startupCapexUsd)}`],
        benchmarkComparison: "Break-even is derived from contribution margin and burn, not a standalone benchmark.",
      }),
      investmentNeeded: metric({
        label: "Investment Needed",
        value: investmentNeeded,
        unit: "usd",
        confidence: confidence("Investment Needed"),
        formula: "Monthly Burn x target runway + startup capex",
        assumptions: [...sharedAssumptions, `Target runway: ${modeling.targetRunwayMonths} months`],
        benchmarkComparison: "Investment need is calculated from runway and capex assumptions.",
      }),
      roi: metric({
        label: "ROI",
        value: roi,
        unit: "percent",
        displayValue: `${Math.round(roi * 100)}% by Year 3`,
        confidence: confidence("ROI"),
        formula: "(Year-3 EBITDA - Investment Needed) / Investment Needed",
        assumptions: [...sharedAssumptions, `Year-3 revenue: ${formatUsd(year3Revenue)}`],
        benchmarkComparison: "ROI is calculated from the same forecast, margin, burn, and investment assumptions.",
      }),
    },
    revenueForecast,
  };
}

export function formatFinancialModelValue(metric: FinancialMetricModel) {
  return metric.displayValue;
}
