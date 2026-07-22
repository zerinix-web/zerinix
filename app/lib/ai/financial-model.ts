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

export type FinancialConsistencyWarningCode =
  | "arr_mrr_mismatch"
  | "ltv_below_cac"
  | "weak_ltv_cac"
  | "payback_mismatch"
  | "low_gross_margin"
  | "runway_burn_mismatch"
  | "capital_efficiency"
  | "break_even_timing";

export type FinancialQuality = "Healthy" | "Needs Validation" | "High Risk";

export type FinancialConsistencyWarning = {
  code: FinancialConsistencyWarningCode;
  severity: "warning" | "critical";
  message: string;
  evidenceType: "User Provided Data" | "Benchmark Assumption" | "AI Planning Assumption";
};

export type FinancialConsistencyCheck = {
  quality: FinancialQuality;
  warnings: FinancialConsistencyWarning[];
  sources: {
    userProvidedData: string[];
    benchmarkAssumptions: string[];
    aiPlanningAssumptions: string[];
  };
};

export type BenchmarkFitLevel = "Strong Fit" | "Moderate Fit" | "Needs Validation";

export type BenchmarkFit = {
  version: "benchmark_fit_v1";
  industryKey: IndustryKey;
  industry: string;
  businessModel: string;
  benchmarkBasis: string;
  confidence: BenchmarkConfidence;
  fit: BenchmarkFitLevel;
  matchedSignals: string[];
  validationGaps: string[];
  rationale: string;
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
  benchmarkFit: BenchmarkFit;
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
      [/\b(kahve|kahveci|kafe|cafe|coffee|espresso|roastery|specialty coffee|speciality coffee|tea|beverage|içecek|icecek)\b/, "luxuryCoffee"],
      [/\b(ev charging|charging station|charge point|charger network|electric charging)\b/, "evCharging"],
      [/\b(scooter|scooters|scooter rental|micromobility|micro mobility|bike sharing|bikeshare|ride sharing|urban mobility|shared mobility)\b/, "mobility"],
      [/\b(fintech|payments|banking|lending|wallet|neobank|insurance|insurtech)\b/, "fintech"],
      [/\b(ecommerce|e-commerce|online store|shopify|retail marketplace|dtc|d2c|direct to consumer|direct-to-consumer|online satış|e-ticaret)\b/, "ecommerce"],
      [/\b(marketplace|two-sided|two sided|platform marketplace)\b/, "marketplace"],
      [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr|restoran|lokanta|yemek)\b/, "restaurant"],
      [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "drone"],
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
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "D2C Brand + Subscription + B2B"],
        [/\b(saas|subscription|platform|software|crm|cybersecurity)\b/, "subscription software"],
        [/\b(dtc|d2c|direct to consumer|direct-to-consumer|consumer brand|ecommerce|e-commerce|online store|e-ticaret|online satış)\b/, "D2C Brand / E-commerce"],
        [/\b(marketplace|two-sided|two sided)\b/, "marketplace"],
        [/\b(scooter|scooters|micromobility|micro mobility|bike sharing|bikeshare|shared mobility)\b/, "asset-heavy rental / utilization model"],
        [/\b(franchise|chain)\b/, "multi-location / franchise"],
        [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr|restoran|lokanta|yemek)\b/, "location-based food service"],
        [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "hardware plus service contracts"],
        [/\b(manufacturer|manufacturing|factory|battery|yacht)\b/, "asset-heavy manufacturing"],
        [/\b(hotel|hospital|clinic|gym)\b/, "asset-heavy operating company"],
        [/\b(consulting|agency|service|studio)\b/, "services"],
      ],
      benchmark.label,
      normalized
    ),
    targetCustomer: firstMatching(
      [
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "premium coffee consumers, office buyers, boutique HoReCa accounts"],
        [/\b(hospital|clinic|doctor|patient|healthcare)\b/, "healthcare buyers / operators"],
        [/\b(enterprise|b2b|company|companies|business)\b/, "B2B / enterprise customers"],
        [/\b(luxury|premium|affluent|private|yacht|hotel)\b/, "premium consumer / high-net-worth customers"],
        [/\b(founder|startup|smb|small business)\b/, "startups and SMBs"],
        [/\b(government|public sector|municipal)\b/, "public-sector buyers"],
        [/\b(commuter|commuters|student|students|urban|city|tourist|tourists|rider|riders)\b/, "urban riders / commuters"],
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
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "D2C unit sales, recurring subscriptions, and B2B wholesale accounts"],
        [/\b(subscription|monthly|annual|saas|software|cybersecurity)\b/, "subscription"],
        [/\b(dtc|d2c|direct to consumer|direct-to-consumer|consumer brand|ecommerce|e-commerce|e-ticaret|online satış)\b/, "online unit sales plus repeat purchase frequency"],
        [/\b(usage|per use|consumption)\b/, "usage-based"],
        [/\b(scooter|scooters|micromobility|bike sharing|bikeshare|ride sharing|rental)\b/, "per-ride rental plus passes"],
        [/\b(take rate|commission|marketplace)\b/, "take-rate / commission"],
        [/\b(franchise)\b/, "franchise fee plus royalties"],
        [/\b(coffee|cafe|hotel|yacht|hospital|clinic|gym|luxury|premium)\b/, "premium ticket / membership / service package"],
        [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr)\b/, "ticket size plus repeat purchase frequency"],
        [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "hardware sale plus recurring software/service"],
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

function isD2cFoodOrFmcg(input: FinancialModelingInputs) {
  return (
    input.industryKey === "luxuryCoffee" ||
    input.businessModel.toLowerCase().includes("d2c") ||
    input.pricingModel.toLowerCase().includes("repeat purchase")
  );
}

function hasValidationEvidence(prompt: string) {
  const normalized = normalizePrompt(prompt);

  return /\b(revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr|gelir|satış|satis|müşteri|musteri|abon[eelik]*|ön sipariş|on siparis|bekleme listesi)\b/.test(
    normalized
  );
}

function customerRampMultiplier(input: FinancialModelingInputs, prompt: string) {
  if (!isD2cFoodOrFmcg(input)) {
    return 1;
  }

  return hasValidationEvidence(prompt) ? 0.72 : 0.38;
}

function acquisitionCostMultiplier(input: FinancialModelingInputs, prompt: string) {
  if (!isD2cFoodOrFmcg(input)) {
    return 1;
  }

  return hasValidationEvidence(prompt) ? 1.15 : 1.45;
}

function growthCurveMultiplier(input: FinancialModelingInputs, year: number, baseGrowthRate: number) {
  if (!isD2cFoodOrFmcg(input)) {
    return Math.pow(1 + baseGrowthRate, year - 1);
  }

  if (year === 1) {
    return 1;
  }

  const postLaunchGrowthRates = [baseGrowthRate * 0.55, baseGrowthRate * 0.7];

  return postLaunchGrowthRates
    .slice(0, year - 1)
    .reduce((multiplier, growthRate) => multiplier * (1 + growthRate), 1);
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
    input.industryKey === "drone" ||
	    input.industryKey === "mobility" ||
	    input.industryKey === "fintech" ||
	    input.industryKey === "agriculture";
  const evidenceSensitive =
    input.industryKey === "luxuryCoffee" || input.industryKey === "ecommerce";
  const hasEvidence = hasValidationEvidence(input.prompt);
  const validationSensitiveMetrics = [
    "TAM",
    "SAM",
    "SOM",
    "ARPA",
    "CAC",
    "LTV",
    "CAC Payback",
    "Revenue Growth",
    "MRR",
    "ARR",
    "EBITDA",
    "Break-even Month",
    "ROI",
  ];

  if (hardToEstimate && ["TAM", "SAM", "SOM", "EBITDA", "Break-even Month"].includes(input.metric)) {
    return "Low";
  }

  if (evidenceSensitive && !hasEvidence && validationSensitiveMetrics.includes(input.metric)) {
    return "Low";
  }

  if (hasSpecificity && input.base !== "Low") {
    return "High";
  }

  return input.base;
}

function createBenchmarkFit(input: {
  prompt: string;
  inputs: FinancialModelingInputs;
  benchmark: IndustryBenchmark;
}): BenchmarkFit {
  const normalized = normalizePrompt(input.prompt);
  const matchedSignals = [
    input.inputs.industry,
    input.inputs.businessModel,
    input.inputs.targetCustomer,
    input.inputs.geography,
    input.inputs.pricingModel,
  ].filter(Boolean);
  const hasBusinessSpecificSignal =
    input.inputs.industryKey !== "services" ||
    /\b(b2b|b2c|d2c|dtc|subscription|marketplace|ecommerce|e-commerce|retail|kahve|coffee|saas|software|manufacturing|restaurant|mobility|fintech)\b/.test(
      normalized
    );
  const hasValidation = hasValidationEvidence(input.prompt);
  const validationGaps = [
    ...(hasValidation ? [] : ["No direct customer, revenue, retention, or acquisition evidence was provided in the request."]),
    ...(input.benchmark.confidence === "Low"
      ? ["Benchmark confidence is low for this business model and requires primary validation."]
      : []),
    ...(hasBusinessSpecificSignal ? [] : ["Business model signal is broad, so benchmark selection may need refinement."]),
  ];
  const fit: BenchmarkFitLevel =
    input.benchmark.confidence === "High" && hasBusinessSpecificSignal
      ? "Strong Fit"
      : input.benchmark.confidence === "Low" || !hasBusinessSpecificSignal
        ? "Needs Validation"
        : "Moderate Fit";

  return {
    version: "benchmark_fit_v1",
    industryKey: input.inputs.industryKey,
    industry: input.inputs.industry,
    businessModel: input.inputs.businessModel,
    benchmarkBasis: input.benchmark.benchmarkBasis,
    confidence: input.benchmark.confidence,
    fit,
    matchedSignals,
    validationGaps,
    rationale: `Benchmark fit is based on detected industry, business model, geography, pricing model, and whether the prompt includes validation evidence. It does not change financial calculations or scoring.`,
  };
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

function approximatelyEqual(left: number, right: number, tolerance = 0.03) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right)) * tolerance;
}

function createFinancialConsistencyCheck(input: {
  prompt: string;
  metrics: FinancialModel["metrics"];
  benchmark: {
    basis: string;
    ranges: IndustryBenchmark["ranges"];
  };
  targetRunwayMonths: number;
  startupCapexUsd: number;
}): FinancialConsistencyCheck {
  const { prompt, metrics, benchmark, targetRunwayMonths, startupCapexUsd } = input;
  const warnings: FinancialConsistencyWarning[] = [];
  const ltvCacRatio = metrics.ltv.value / Math.max(1, metrics.cac.value);
  const expectedPayback = metrics.cac.value / Math.max(1, metrics.arpa.value * metrics.grossMargin.value);
  const expectedRunway = metrics.investmentNeeded.value / Math.max(1, metrics.monthlyBurn.value);
  const capitalEfficiencyRatio = metrics.investmentNeeded.value / Math.max(1, metrics.arr.value);

  const addWarning = (
    code: FinancialConsistencyWarningCode,
    severity: FinancialConsistencyWarning["severity"],
    message: string,
    evidenceType: FinancialConsistencyWarning["evidenceType"] = "AI Planning Assumption"
  ) => {
    warnings.push({ code, severity, message, evidenceType });
  };

  if (!approximatelyEqual(metrics.arr.value, metrics.mrr.value * 12)) {
    addWarning("arr_mrr_mismatch", "critical", "Financial assumptions are inconsistent.");
  }

  if (metrics.ltv.value < metrics.cac.value) {
    addWarning("ltv_below_cac", "critical", "Customer acquisition economics require validation.");
  } else if (ltvCacRatio < 2) {
    addWarning("weak_ltv_cac", "warning", "Customer acquisition economics require validation.");
  }

  if (!approximatelyEqual(metrics.cacPayback.value, expectedPayback, 0.08)) {
    addWarning("payback_mismatch", "warning", "CAC payback assumptions require validation.");
  }

  if (metrics.grossMargin.value < benchmark.ranges.grossMargin.low) {
    addWarning("low_gross_margin", "warning", "Gross margin may not support the current acquisition and burn assumptions.", "Benchmark Assumption");
  }

  if (!approximatelyEqual(metrics.runway.value, expectedRunway, 0.05)) {
    addWarning("runway_burn_mismatch", "critical", "Financial assumptions are inconsistent.");
  }

  if (capitalEfficiencyRatio > 4) {
    addWarning("capital_efficiency", "critical", "Capital efficiency requires validation.");
  } else if (capitalEfficiencyRatio > 2) {
    addWarning("capital_efficiency", "warning", "Capital efficiency requires validation.");
  }

  if (metrics.breakEvenMonth.value > Math.max(48, targetRunwayMonths * 2)) {
    addWarning("break_even_timing", "warning", "Break-even timing requires validation.");
  }

  const quality: FinancialQuality = warnings.some((warning) => warning.severity === "critical")
    ? "High Risk"
    : warnings.length > 0
      ? "Needs Validation"
      : "Healthy";

  return {
    quality,
    warnings,
    sources: {
      userProvidedData: hasValidationEvidence(prompt)
        ? ["User supplied validation evidence in the request."]
        : ["No direct operating data was supplied by the user."],
      benchmarkAssumptions: [
        benchmark.basis,
        `Gross margin benchmark range: ${formatPercent(benchmark.ranges.grossMargin.low)}-${formatPercent(benchmark.ranges.grossMargin.high)}`,
        `CAC benchmark range: ${formatUsd(benchmark.ranges.cac.low)}-${formatUsd(benchmark.ranges.cac.high)}`,
        `LTV benchmark range: ${formatUsd(benchmark.ranges.ltv.low)}-${formatUsd(benchmark.ranges.ltv.high)}`,
      ],
      aiPlanningAssumptions: [
        `Target runway: ${targetRunwayMonths} months`,
        `Startup capex: ${formatUsd(startupCapexUsd)}`,
        `Funding need vs ARR ratio: ${capitalEfficiencyRatio.toFixed(1)}x`,
      ],
    },
  };
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
  const rampMultiplier = customerRampMultiplier(inputs, input.prompt);
  const cacMultiplier = acquisitionCostMultiplier(inputs, input.prompt);
  const tam = modeling.tamUsd * geoMultiplier * scopeMultiplier;
  const sam = tam * modeling.samRate;
  const som = sam * modeling.somRate;
  const arpa = modeling.arpaMonthly * scopeMultiplier;
  const month12Customers = Math.max(1, Math.round(modeling.month12Customers * scopeMultiplier * rampMultiplier));
  const mrr = month12Customers * arpa;
  const arr = mrr * 12;
  const cac = modeling.cacUsd * (scopeMultiplier > 1 ? 1.18 : 1) * cacMultiplier;
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
    const customers = Math.round(
      month12Customers * growthCurveMultiplier(inputs, year, modeling.customerGrowthRate)
    );
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
  const isMobility = inputs.industryKey === "mobility";
  const customerUnit = isMobility ? "active riders" : "customers";
  const arpaLabel = isMobility ? "Monthly Revenue per Active Rider" : "ARPA";
  const mrrLabel = isMobility ? "Monthly Revenue" : "MRR";
  const arrLabel = isMobility ? "Yearly Revenue" : "ARR";
  const cacLabel = isMobility ? "Rider CAC" : "CAC";
  const ltvLabel = isMobility ? "Rider LTV" : "LTV";
  const arpaFormula = isMobility
    ? "monthly ride revenue per active rider x idea scope multiplier"
    : "benchmark monthly ARPA x idea scope multiplier";
  const mrrFormula = isMobility
    ? "Month-12 active riders x monthly revenue per active rider"
    : "Month-12 customers x ARPA";
  const arrFormula = isMobility ? "Monthly Revenue x 12" : "MRR x 12";
  const sharedAssumptions = [
    `Industry benchmark: ${benchmark.label}`,
    `Business model: ${inputs.businessModel}`,
    `Target customer: ${inputs.targetCustomer}`,
    `Geography: ${inputs.geography}`,
    `Pricing model: ${inputs.pricingModel}`,
    `Validation evidence: ${hasValidationEvidence(input.prompt) ? "present in prompt" : "not provided; planning assumptions require validation"}`,
    `Customer ramp multiplier: ${rampMultiplier}`,
  ];
  const benchmarkFit = createBenchmarkFit({
    prompt: input.prompt,
    inputs,
    benchmark,
  });

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
    benchmarkFit,
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
        label: arpaLabel,
        value: arpa,
        unit: "usd",
	        displayValue: `${formatUsd(arpa)}/month`,
	        confidence: confidence(arpaLabel),
	        formula: arpaFormula,
	        assumptions: [...sharedAssumptions, `Month-12 ${customerUnit}: ${month12Customers}`],
        benchmarkComparison: isMobility
          ? "Uses mobility revenue-per-active-rider benchmark as the base case."
          : "Uses industry benchmark ARPA as the base case.",
      }),
      cac: metric({
        label: cacLabel,
        value: cac,
	        unit: "usd",
	        confidence: confidence(cacLabel),
	        formula: "benchmark CAC x complexity multiplier",
	        assumptions: [...sharedAssumptions, `Complexity multiplier: ${scopeMultiplier > 1 ? 1.18 : 1}`, `Acquisition uncertainty multiplier: ${cacMultiplier}`],
        benchmarkComparison: compareToBenchmark(cac, benchmark.ranges.cac),
      }),
      ltv: metric({
        label: ltvLabel,
        value: ltv,
        unit: "usd",
        confidence: confidence(ltvLabel),
        formula: `${arpaLabel} x Gross Margin x lifetime months`,
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
        label: arrLabel,
        value: arr,
        unit: "usd",
        confidence: confidence(arrLabel),
        formula: arrFormula,
        assumptions: [...sharedAssumptions, `${mrrLabel}: ${formatUsd(mrr)}`, `Month-12 ${customerUnit}: ${month12Customers}`],
        benchmarkComparison: `${arrLabel} is calculated from ${customerUnit} and pricing assumptions.`,
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
        label: mrrLabel,
        value: mrr,
        unit: "usd",
        confidence: confidence(mrrLabel),
        formula: mrrFormula,
        assumptions: [...sharedAssumptions, `Month-12 ${customerUnit}: ${month12Customers}`, `${arpaLabel}: ${formatUsd(arpa)}/month`],
        benchmarkComparison: `${mrrLabel} is calculated from ${customerUnit} and pricing assumptions.`,
      }),
      ebitda: metric({
        label: "EBITDA",
        value: ebitda,
        unit: "usd",
        confidence: confidence("EBITDA"),
        formula: `${arrLabel} x Gross Margin - annualized operating expense`,
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

export function validateFinancialConsistency(model: FinancialModel): FinancialConsistencyCheck {
  const targetRunwayAssumption = model.metrics.investmentNeeded.assumptions.find((assumption) =>
    /target runway/i.test(assumption)
  );
  const startupCapexAssumption = model.metrics.breakEvenMonth.assumptions.find((assumption) =>
    /startup capex/i.test(assumption)
  );
  const targetRunwayMonths = Number(targetRunwayAssumption?.match(/\d+(?:\.\d+)?/)?.[0]) || model.metrics.runway.value;
  const startupCapexUsd =
    Number(startupCapexAssumption?.match(/\$?([\d,.]+)\s*k/i)?.[1]?.replace(/,/g, "")) * 1_000 ||
    Number(startupCapexAssumption?.match(/\$?([\d,.]+)\s*m/i)?.[1]?.replace(/,/g, "")) * 1_000_000 ||
    0;

  return createFinancialConsistencyCheck({
    prompt: model.normalizedBusinessIdea,
    metrics: model.metrics,
    benchmark: model.benchmark,
    targetRunwayMonths,
    startupCapexUsd,
  });
}
