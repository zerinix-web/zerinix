import crypto from "node:crypto";

export type ReportKind = "business_plan" | "market_analysis";

type Confidence = "High" | "Medium" | "Low";
type IndustryKey =
  | "coffee"
  | "saas"
  | "ai"
  | "manufacturing"
  | "healthcare"
  | "logistics"
  | "hospitality"
  | "luxuryGoods"
  | "fitness"
  | "agriculture"
  | "cybersecurity"
  | "services";

type ModelingInputs = {
  industry: string;
  industryKey: IndustryKey;
  businessModel: string;
  targetCustomer: string;
  geography: string;
  pricingModel: string;
};

type FinancialMetric = {
  label: string;
  value: string;
  confidence: Confidence;
  formula: string;
  justification: string;
};

type RevenueForecastYear = {
  year: string;
  customers: number;
  mrr: number;
  arr: number;
  revenue: number;
  marketPenetration: number;
};

type IndustryBenchmark = {
  label: string;
  tamUsd: number;
  samRate: number;
  somRate: number;
  arpaMonthly: number;
  month12Customers: number;
  customerGrowthRate: number;
  cacUsd: number;
  grossMarginRate: number;
  lifetimeMonths: number;
  monthlyBurnUsd: number;
  startupCapexUsd: number;
  targetRunwayMonths: number;
  confidence: Confidence;
  benchmarkBasis: string;
};

export type AiFinancialModelContext = {
  version: "financial_model_engine_v3";
  fingerprint: string;
  reportKind: ReportKind;
  normalizedBusinessIdea: string;
  modelingInputs: ModelingInputs;
  benchmark: {
    label: string;
    basis: string;
  };
  metrics: {
    tam: FinancialMetric;
    sam: FinancialMetric;
    som: FinancialMetric;
    arpa: FinancialMetric;
    mrr: FinancialMetric;
    arr: FinancialMetric;
    cac: FinancialMetric;
    ltv: FinancialMetric;
    grossMargin: FinancialMetric;
    burnRate: FinancialMetric;
    runway: FinancialMetric;
    ebitda: FinancialMetric;
    breakEvenMonth: FinancialMetric;
    investmentNeeded: FinancialMetric;
    paybackPeriod: FinancialMetric;
    roi: FinancialMetric;
  };
  revenueForecast: RevenueForecastYear[];
};

const industryBenchmarks: Record<IndustryKey, IndustryBenchmark> = {
  coffee: {
    label: "Coffee / specialty retail",
    tamUsd: 95_000_000_000,
    samRate: 0.035,
    somRate: 0.006,
    arpaMonthly: 18,
    month12Customers: 18_000,
    customerGrowthRate: 0.55,
    cacUsd: 14,
    grossMarginRate: 0.62,
    lifetimeMonths: 18,
    monthlyBurnUsd: 85_000,
    startupCapexUsd: 420_000,
    targetRunwayMonths: 15,
    confidence: "Medium",
    benchmarkBasis: "Specialty coffee retail, premium beverage, and early multi-location consumer benchmarks.",
  },
  saas: {
    label: "B2B SaaS",
    tamUsd: 38_000_000_000,
    samRate: 0.06,
    somRate: 0.012,
    arpaMonthly: 850,
    month12Customers: 85,
    customerGrowthRate: 0.95,
    cacUsd: 4_800,
    grossMarginRate: 0.78,
    lifetimeMonths: 36,
    monthlyBurnUsd: 145_000,
    startupCapexUsd: 150_000,
    targetRunwayMonths: 18,
    confidence: "Medium",
    benchmarkBasis: "Seed-stage B2B SaaS subscription, ACV, retention, margin, and founder-led sales benchmarks.",
  },
  ai: {
    label: "AI software / automation",
    tamUsd: 52_000_000_000,
    samRate: 0.045,
    somRate: 0.01,
    arpaMonthly: 1_400,
    month12Customers: 65,
    customerGrowthRate: 0.9,
    cacUsd: 7_500,
    grossMarginRate: 0.68,
    lifetimeMonths: 30,
    monthlyBurnUsd: 190_000,
    startupCapexUsd: 260_000,
    targetRunwayMonths: 18,
    confidence: "Medium",
    benchmarkBasis: "AI application software benchmarks adjusted for model cost, implementation friction, and B2B adoption.",
  },
  manufacturing: {
    label: "Advanced manufacturing",
    tamUsd: 120_000_000_000,
    samRate: 0.025,
    somRate: 0.004,
    arpaMonthly: 38_000,
    month12Customers: 11,
    customerGrowthRate: 0.5,
    cacUsd: 42_000,
    grossMarginRate: 0.34,
    lifetimeMonths: 48,
    monthlyBurnUsd: 520_000,
    startupCapexUsd: 4_500_000,
    targetRunwayMonths: 24,
    confidence: "Low",
    benchmarkBasis: "Industrial manufacturing benchmarks with high capex, long sales cycles, and capacity constraints.",
  },
  healthcare: {
    label: "Healthcare services / healthtech",
    tamUsd: 85_000_000_000,
    samRate: 0.04,
    somRate: 0.006,
    arpaMonthly: 3_200,
    month12Customers: 34,
    customerGrowthRate: 0.65,
    cacUsd: 16_000,
    grossMarginRate: 0.48,
    lifetimeMonths: 42,
    monthlyBurnUsd: 240_000,
    startupCapexUsd: 900_000,
    targetRunwayMonths: 18,
    confidence: "Low",
    benchmarkBasis: "Healthcare operator and healthtech benchmarks adjusted for regulation, trust, and procurement friction.",
  },
  logistics: {
    label: "Logistics / supply chain",
    tamUsd: 75_000_000_000,
    samRate: 0.035,
    somRate: 0.007,
    arpaMonthly: 4_500,
    month12Customers: 40,
    customerGrowthRate: 0.62,
    cacUsd: 11_500,
    grossMarginRate: 0.38,
    lifetimeMonths: 30,
    monthlyBurnUsd: 210_000,
    startupCapexUsd: 650_000,
    targetRunwayMonths: 18,
    confidence: "Medium",
    benchmarkBasis: "Logistics software/service benchmarks with operational labor, route density, and enterprise sales assumptions.",
  },
  hospitality: {
    label: "Hospitality / hotels",
    tamUsd: 240_000_000_000,
    samRate: 0.03,
    somRate: 0.0035,
    arpaMonthly: 28_000,
    month12Customers: 14,
    customerGrowthRate: 0.45,
    cacUsd: 18_000,
    grossMarginRate: 0.42,
    lifetimeMonths: 30,
    monthlyBurnUsd: 420_000,
    startupCapexUsd: 3_200_000,
    targetRunwayMonths: 24,
    confidence: "Low",
    benchmarkBasis: "Hotel and hospitality operating benchmarks adjusted for occupancy, ADR, property capex, and ramp time.",
  },
  luxuryGoods: {
    label: "Luxury goods / marine",
    tamUsd: 55_000_000_000,
    samRate: 0.025,
    somRate: 0.0025,
    arpaMonthly: 95_000,
    month12Customers: 4,
    customerGrowthRate: 0.4,
    cacUsd: 85_000,
    grossMarginRate: 0.32,
    lifetimeMonths: 54,
    monthlyBurnUsd: 680_000,
    startupCapexUsd: 6_500_000,
    targetRunwayMonths: 24,
    confidence: "Low",
    benchmarkBasis: "Luxury durable goods benchmarks adjusted for long sales cycles, bespoke production, and affluent buyers.",
  },
  fitness: {
    label: "Fitness / gym franchise",
    tamUsd: 42_000_000_000,
    samRate: 0.04,
    somRate: 0.008,
    arpaMonthly: 72,
    month12Customers: 5_600,
    customerGrowthRate: 0.7,
    cacUsd: 95,
    grossMarginRate: 0.56,
    lifetimeMonths: 20,
    monthlyBurnUsd: 150_000,
    startupCapexUsd: 700_000,
    targetRunwayMonths: 16,
    confidence: "Medium",
    benchmarkBasis: "Premium fitness membership and franchise benchmarks with churn, location ramp, and local acquisition costs.",
  },
  agriculture: {
    label: "Agriculture / vertical farming",
    tamUsd: 35_000_000_000,
    samRate: 0.04,
    somRate: 0.005,
    arpaMonthly: 18_000,
    month12Customers: 16,
    customerGrowthRate: 0.55,
    cacUsd: 19_000,
    grossMarginRate: 0.36,
    lifetimeMonths: 36,
    monthlyBurnUsd: 360_000,
    startupCapexUsd: 2_800_000,
    targetRunwayMonths: 22,
    confidence: "Low",
    benchmarkBasis: "Controlled-environment agriculture benchmarks adjusted for yield, energy cost, buyer concentration, and capex.",
  },
  cybersecurity: {
    label: "Cybersecurity",
    tamUsd: 65_000_000_000,
    samRate: 0.055,
    somRate: 0.009,
    arpaMonthly: 2_800,
    month12Customers: 52,
    customerGrowthRate: 0.82,
    cacUsd: 13_500,
    grossMarginRate: 0.74,
    lifetimeMonths: 38,
    monthlyBurnUsd: 230_000,
    startupCapexUsd: 280_000,
    targetRunwayMonths: 18,
    confidence: "Medium",
    benchmarkBasis: "Cybersecurity SaaS benchmarks adjusted for enterprise trust, compliance, and competitive noise.",
  },
  services: {
    label: "Professional services",
    tamUsd: 18_000_000_000,
    samRate: 0.05,
    somRate: 0.01,
    arpaMonthly: 7_500,
    month12Customers: 22,
    customerGrowthRate: 0.58,
    cacUsd: 5_200,
    grossMarginRate: 0.58,
    lifetimeMonths: 18,
    monthlyBurnUsd: 90_000,
    startupCapexUsd: 75_000,
    targetRunwayMonths: 14,
    confidence: "Medium",
    benchmarkBasis: "Founder-led services benchmarks adjusted for utilization, delivery leverage, and retainer retention.",
  },
};

function hashAiPayload(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeAiPrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function firstMatching<T>(matches: Array<[RegExp, T]>, fallback: T, value: string) {
  return matches.find(([pattern]) => pattern.test(value))?.[1] ?? fallback;
}

function inferIndustryKey(value: string): IndustryKey {
  return firstMatching(
    [
      [/\b(coffee|cafe|cafe|espresso|roastery|tea|beverage)\b/, "coffee"],
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
    value
  );
}

function inferModelingInputs(prompt: string): ModelingInputs {
  const normalized = normalizeAiPrompt(prompt);
  const industryKey = inferIndustryKey(normalized);
  const benchmark = industryBenchmarks[industryKey];

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

function promptMultiplier(prompt: string) {
  const normalized = normalizeAiPrompt(prompt);
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
  base: Confidence;
  prompt: string;
  metric: string;
  industryKey: IndustryKey;
}) {
  const normalized = normalizeAiPrompt(input.prompt);
  const hasSpecificity = /\b(us|usa|uk|europe|turkey|gcc|b2b|enterprise|premium|luxury|subscription|franchise|monthly|annual)\b/.test(
    normalized
  );
  const hardToEstimate =
    input.industryKey === "manufacturing" ||
    input.industryKey === "healthcare" ||
    input.industryKey === "hospitality" ||
    input.industryKey === "luxuryGoods" ||
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

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function metric(input: FinancialMetric): FinancialMetric {
  return input;
}

function buildFinancialModel(prompt: string, modelingInputs: ModelingInputs) {
  const benchmark = industryBenchmarks[modelingInputs.industryKey];
  const geoMultiplier = geographyMultiplier(modelingInputs.geography);
  const ideaMultiplier = promptMultiplier(prompt);
  const tam = benchmark.tamUsd * geoMultiplier * ideaMultiplier;
  const sam = tam * benchmark.samRate;
  const som = sam * benchmark.somRate;
  const arpa = benchmark.arpaMonthly * ideaMultiplier;
  const month12Customers = Math.max(1, Math.round(benchmark.month12Customers * ideaMultiplier));
  const mrr = month12Customers * arpa;
  const arr = mrr * 12;
  const cac = benchmark.cacUsd * (ideaMultiplier > 1 ? 1.18 : 1);
  const grossMargin = benchmark.grossMarginRate;
  const ltv = arpa * grossMargin * benchmark.lifetimeMonths;
  const burnRate = benchmark.monthlyBurnUsd * ideaMultiplier;
  const investmentNeeded = burnRate * benchmark.targetRunwayMonths + benchmark.startupCapexUsd;
  const runway = investmentNeeded / burnRate;
  const paybackPeriod = cac / Math.max(1, arpa * grossMargin);
  const annualOpex = burnRate * 12;
  const ebitda = arr * grossMargin - annualOpex;
  const monthlyContribution = mrr * grossMargin;
  const breakEvenMonth =
    monthlyContribution > burnRate
      ? Math.max(1, Math.ceil(benchmark.startupCapexUsd / (monthlyContribution - burnRate)))
      : 36 + Math.ceil((burnRate - monthlyContribution) / Math.max(1, monthlyContribution)) * 3;
  const year3Revenue = arr * Math.pow(1 + benchmark.customerGrowthRate, 2);
  const year3Ebitda = year3Revenue * grossMargin - annualOpex * 1.35;
  const roi = (year3Ebitda - investmentNeeded) / Math.max(1, investmentNeeded);
  const revenueForecast: RevenueForecastYear[] = [1, 2, 3].map((year) => {
    const customers = Math.round(month12Customers * Math.pow(1 + benchmark.customerGrowthRate, year - 1));
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

  return {
    benchmark,
    tam,
    sam,
    som,
    arpa,
    month12Customers,
    mrr,
    arr,
    cac,
    grossMargin,
    ltv,
    burnRate,
    investmentNeeded,
    runway,
    paybackPeriod,
    ebitda,
    breakEvenMonth,
    roi,
    revenueForecast,
  };
}

export function createCanonicalFinancialAssumptions(input: {
  prompt: string;
  reportKind: ReportKind;
}): AiFinancialModelContext {
  const normalizedBusinessIdea = normalizeAiPrompt(input.prompt);
  const modelingInputs = inferModelingInputs(input.prompt);
  const model = buildFinancialModel(input.prompt, modelingInputs);
  const fingerprint = hashAiPayload(
    JSON.stringify({
      version: "financial_model_engine_v3",
      prompt: normalizedBusinessIdea,
      reportKind: input.reportKind,
      modelingInputs,
      model,
    })
  ).slice(0, 16);
  const confidence = (metricName: string) =>
    confidenceFor({
      base: model.benchmark.confidence,
      prompt: input.prompt,
      metric: metricName,
      industryKey: modelingInputs.industryKey,
    });

  return {
    version: "financial_model_engine_v3",
    fingerprint,
    reportKind: input.reportKind,
    normalizedBusinessIdea,
    modelingInputs,
    benchmark: {
      label: model.benchmark.label,
      basis: model.benchmark.benchmarkBasis,
    },
    metrics: {
      tam: metric({
        label: "TAM",
        value: formatUsd(model.tam),
        confidence: confidence("TAM"),
        formula: "industry TAM x geography multiplier x idea scope multiplier",
        justification: `Derived from ${model.benchmark.label} benchmark scope and adjusted for ${modelingInputs.geography}.`,
      }),
      sam: metric({
        label: "SAM",
        value: formatUsd(model.sam),
        confidence: confidence("SAM"),
        formula: `TAM x ${formatPercent(model.benchmark.samRate)} serviceable segment`,
        justification: "Narrows the total market to the realistic buyer/category segment ZERINIX can initially serve.",
      }),
      som: metric({
        label: "SOM",
        value: formatUsd(model.som),
        confidence: confidence("SOM"),
        formula: `SAM x ${formatPercent(model.benchmark.somRate)} obtainable share`,
        justification: "Uses conservative early penetration to avoid overstating near-term obtainable revenue.",
      }),
      arpa: metric({
        label: "ARPA",
        value: `${formatUsd(model.arpa)}/month`,
        confidence: confidence("ARPA"),
        formula: "industry ARPA benchmark x idea scope multiplier",
        justification: `Matches the inferred pricing model: ${modelingInputs.pricingModel}.`,
      }),
      mrr: metric({
        label: "MRR",
        value: formatUsd(model.mrr),
        confidence: confidence("MRR"),
        formula: `${formatNumber(model.month12Customers)} month-12 customers x ${formatUsd(model.arpa)} ARPA`,
        justification: "Connects revenue to customer count and pricing rather than a generic revenue range.",
      }),
      arr: metric({
        label: "ARR",
        value: formatUsd(model.arr),
        confidence: confidence("ARR"),
        formula: "MRR x 12",
        justification: "Annualized directly from the calculated month-12 recurring revenue run rate.",
      }),
      cac: metric({
        label: "CAC",
        value: formatUsd(model.cac),
        confidence: confidence("CAC"),
        formula: "industry CAC benchmark adjusted for premium/enterprise complexity",
        justification: `Reflects ${modelingInputs.targetCustomer} acquisition friction and sales cycle intensity.`,
      }),
      ltv: metric({
        label: "LTV",
        value: formatUsd(model.ltv),
        confidence: confidence("LTV"),
        formula: "ARPA x Gross Margin x expected lifetime months",
        justification: "Keeps LTV tied to pricing, margin, and retention instead of a standalone estimate.",
      }),
      grossMargin: metric({
        label: "Gross Margin",
        value: formatPercent(model.grossMargin),
        confidence: confidence("Gross Margin"),
        formula: "industry gross margin benchmark",
        justification: `Reflects cost structure for ${model.benchmark.label}.`,
      }),
      burnRate: metric({
        label: "Burn Rate",
        value: `${formatUsd(model.burnRate)}/month`,
        confidence: confidence("Burn Rate"),
        formula: "industry operating burn x idea scope multiplier",
        justification: "Includes team, go-to-market, infrastructure, operating overhead, and asset intensity where relevant.",
      }),
      runway: metric({
        label: "Runway",
        value: `${formatNumber(model.runway)} months`,
        confidence: confidence("Runway"),
        formula: "Investment Needed / Burn Rate",
        justification: "Calculated from required financing and monthly burn, not independently estimated.",
      }),
      ebitda: metric({
        label: "EBITDA",
        value: formatUsd(model.ebitda),
        confidence: confidence("EBITDA"),
        formula: "ARR x Gross Margin - annualized operating expense",
        justification: "Shows whether the year-1 model creates operating leverage before scale.",
      }),
      breakEvenMonth: metric({
        label: "Break-even Month",
        value: `Month ${Math.max(1, Math.round(model.breakEvenMonth))}`,
        confidence: confidence("Break-even Month"),
        formula: "Startup capex / monthly contribution above burn",
        justification:
          model.breakEvenMonth > 36
            ? "Low confidence warning: contribution margin does not cover burn quickly, so break-even likely requires scale, pricing improvement, or lower burn."
            : "Calculated from contribution margin after monthly burn coverage.",
      }),
      investmentNeeded: metric({
        label: "Investment Needed",
        value: formatUsd(model.investmentNeeded),
        confidence: confidence("Investment Needed"),
        formula: "Burn Rate x target runway + startup capex",
        justification: "Financing need is tied to runway target and upfront asset/product build requirements.",
      }),
      paybackPeriod: metric({
        label: "Payback Period",
        value: `${formatNumber(model.paybackPeriod)} months`,
        confidence: confidence("Payback Period"),
        formula: "CAC / monthly gross profit per account",
        justification: "Calculated from CAC, ARPA, and gross margin so unit economics remain consistent.",
      }),
      roi: metric({
        label: "ROI",
        value: `${Math.round(model.roi * 100)}% by Year 3`,
        confidence: confidence("ROI"),
        formula: "(Year-3 EBITDA - Investment Needed) / Investment Needed",
        justification: "Uses the same revenue forecast, margin, burn, and investment assumptions as the rest of the model.",
      }),
    },
    revenueForecast: model.revenueForecast,
  };
}

function formatMetricRow(metric: FinancialMetric) {
  return `- ${metric.label}: ${metric.value} | confidence=${metric.confidence} | formula=${metric.formula} | justification=${metric.justification}`;
}

export function formatCanonicalFinancialAssumptions(
  context: AiFinancialModelContext
) {
  const metricRows = Object.values(context.metrics).map(formatMetricRow).join("\n");
  const forecastRows = context.revenueForecast
    .map(
      (year) =>
        `- ${year.year}: customers=${year.customers}, MRR=${formatUsd(year.mrr)}, ARR=${formatUsd(year.arr)}, revenue=${formatUsd(year.revenue)}, SOM penetration=${formatPercent(year.marketPenetration)}`
    )
    .join("\n");

  return `Data-Driven Financial Analysis Engine (${context.version}, ${context.fingerprint})
Business idea fingerprint: ${context.normalizedBusinessIdea}
Detected modeling inputs:
- Industry: ${context.modelingInputs.industry}
- Business model: ${context.modelingInputs.businessModel}
- Target customer: ${context.modelingInputs.targetCustomer}
- Geography: ${context.modelingInputs.geography}
- Pricing model: ${context.modelingInputs.pricingModel}
- Benchmark basis: ${context.benchmark.basis}

Calculated financial model:
${metricRows}

Revenue forecast:
${forecastRows}

Financial modeling rules:
- Use the calculated financial model above as the single source of truth for TAM, SAM, SOM, ARPA, MRR, ARR, CAC, LTV, Gross Margin, Burn Rate, Runway, EBITDA, Break-even Month, Investment Needed, Payback Period, ROI, and Revenue Forecast.
- Do not replace these values with generic ranges, generic templates, or unrelated benchmarks.
- Explain every major number with its formula, confidence level, and short justification.
- If confidence is Low, explicitly warn that the estimate needs validation instead of presenting it as precise.
- Financial Dashboard, Unit Economics, Scenario Analysis, Executive Summary, Executive Recommendation, KPI Dashboard, and Financial Assumptions must reuse these same values.
- Different industries must preserve different economics: coffee/retail uses ticket and repeat purchase logic; SaaS/AI uses subscription and churn logic; manufacturing uses capex/capacity logic; healthcare uses trust/regulatory friction; logistics uses density and operational margin; hospitality uses occupancy/ADR/capex logic.
- Scenario Analysis may vary these values for worst/base/best cases, but Base Case must match this calculated model exactly.`;
}
