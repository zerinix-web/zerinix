export type BenchmarkConfidence = "High" | "Medium" | "Low";

export type IndustryKey =
  | "saas"
  | "ai"
  | "cybersecurity"
  | "healthcare"
  | "marketplace"
  | "fintech"
  | "ecommerce"
  | "luxuryCoffee"
  | "logistics"
  | "restaurant"
  | "drone"
  | "evCharging"
  | "mobility"
  | "manufacturing"
  | "hospitality"
  | "luxuryGoods"
  | "fitness"
  | "agriculture"
  | "services";

export type BenchmarkRange = {
  low: number;
  high: number;
  unit: "percent" | "usd" | "months" | "multiple";
};

export type IndustryBenchmark = {
  key: IndustryKey;
  label: string;
  benchmarkBasis: string;
  confidence: BenchmarkConfidence;
  ranges: {
    grossMargin: BenchmarkRange;
    cac: BenchmarkRange;
    ltv: BenchmarkRange;
    cacPayback: BenchmarkRange;
    arrGrowth: BenchmarkRange;
    ebitdaMargin: BenchmarkRange;
    revenueMultiple: BenchmarkRange;
  };
  modeling: {
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
  };
};

export const industryBenchmarks: Record<IndustryKey, IndustryBenchmark> = {
  saas: {
    key: "saas",
    label: "B2B SaaS",
    benchmarkBasis:
      "Seed-stage B2B SaaS subscription, ACV, retention, margin, and founder-led sales benchmarks.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.72, high: 0.86, unit: "percent" },
      cac: { low: 2_500, high: 12_000, unit: "usd" },
      ltv: { low: 18_000, high: 180_000, unit: "usd" },
      cacPayback: { low: 6, high: 18, unit: "months" },
      arrGrowth: { low: 0.7, high: 1.8, unit: "percent" },
      ebitdaMargin: { low: -0.45, high: 0.25, unit: "percent" },
      revenueMultiple: { low: 4, high: 12, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  ai: {
    key: "ai",
    label: "AI software / automation",
    benchmarkBasis:
      "AI application software benchmarks adjusted for model cost, implementation friction, and B2B adoption.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.6, high: 0.8, unit: "percent" },
      cac: { low: 4_000, high: 22_000, unit: "usd" },
      ltv: { low: 20_000, high: 220_000, unit: "usd" },
      cacPayback: { low: 8, high: 24, unit: "months" },
      arrGrowth: { low: 0.8, high: 2.2, unit: "percent" },
      ebitdaMargin: { low: -0.55, high: 0.22, unit: "percent" },
      revenueMultiple: { low: 5, high: 16, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  cybersecurity: {
    key: "cybersecurity",
    label: "Cybersecurity",
    benchmarkBasis:
      "Cybersecurity SaaS benchmarks adjusted for enterprise trust, compliance, and competitive noise.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.68, high: 0.84, unit: "percent" },
      cac: { low: 8_000, high: 35_000, unit: "usd" },
      ltv: { low: 45_000, high: 350_000, unit: "usd" },
      cacPayback: { low: 10, high: 24, unit: "months" },
      arrGrowth: { low: 0.55, high: 1.6, unit: "percent" },
      ebitdaMargin: { low: -0.5, high: 0.28, unit: "percent" },
      revenueMultiple: { low: 5, high: 14, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  healthcare: {
    key: "healthcare",
    label: "Healthcare services / healthtech",
    benchmarkBasis:
      "Healthcare operator and healthtech benchmarks adjusted for regulation, trust, reimbursement, and procurement friction.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.35, high: 0.65, unit: "percent" },
      cac: { low: 8_000, high: 45_000, unit: "usd" },
      ltv: { low: 35_000, high: 300_000, unit: "usd" },
      cacPayback: { low: 12, high: 36, unit: "months" },
      arrGrowth: { low: 0.35, high: 1.1, unit: "percent" },
      ebitdaMargin: { low: -0.35, high: 0.22, unit: "percent" },
      revenueMultiple: { low: 2, high: 8, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  marketplace: {
    key: "marketplace",
    label: "Marketplace",
    benchmarkBasis:
      "Two-sided marketplace benchmarks adjusted for take rate, liquidity density, incentives, and repeat transaction behavior.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.5, high: 0.78, unit: "percent" },
      cac: { low: 500, high: 8_000, unit: "usd" },
      ltv: { low: 5_000, high: 85_000, unit: "usd" },
      cacPayback: { low: 9, high: 30, unit: "months" },
      arrGrowth: { low: 0.7, high: 2.5, unit: "percent" },
      ebitdaMargin: { low: -0.6, high: 0.2, unit: "percent" },
      revenueMultiple: { low: 2, high: 10, unit: "multiple" },
    },
    modeling: {
      tamUsd: 45_000_000_000,
      samRate: 0.04,
      somRate: 0.008,
      arpaMonthly: 650,
      month12Customers: 120,
      customerGrowthRate: 1.05,
      cacUsd: 2_200,
      grossMarginRate: 0.62,
      lifetimeMonths: 28,
      monthlyBurnUsd: 175_000,
      startupCapexUsd: 220_000,
      targetRunwayMonths: 18,
    },
  },
  fintech: {
    key: "fintech",
    label: "FinTech",
    benchmarkBasis:
      "FinTech benchmarks adjusted for compliance, trust, transaction economics, fraud risk, and regulated buyer adoption.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.45, high: 0.78, unit: "percent" },
      cac: { low: 4_000, high: 30_000, unit: "usd" },
      ltv: { low: 25_000, high: 250_000, unit: "usd" },
      cacPayback: { low: 10, high: 30, unit: "months" },
      arrGrowth: { low: 0.5, high: 1.8, unit: "percent" },
      ebitdaMargin: { low: -0.55, high: 0.25, unit: "percent" },
      revenueMultiple: { low: 3, high: 12, unit: "multiple" },
    },
    modeling: {
      tamUsd: 70_000_000_000,
      samRate: 0.045,
      somRate: 0.007,
      arpaMonthly: 1_900,
      month12Customers: 58,
      customerGrowthRate: 0.78,
      cacUsd: 11_000,
      grossMarginRate: 0.64,
      lifetimeMonths: 36,
      monthlyBurnUsd: 260_000,
      startupCapexUsd: 600_000,
      targetRunwayMonths: 20,
    },
  },
  ecommerce: {
    key: "ecommerce",
    label: "E-commerce",
    benchmarkBasis:
      "E-commerce benchmarks adjusted for contribution margin, paid acquisition, repeat purchase, fulfillment, and inventory risk.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.32, high: 0.62, unit: "percent" },
      cac: { low: 25, high: 180, unit: "usd" },
      ltv: { low: 90, high: 650, unit: "usd" },
      cacPayback: { low: 1, high: 8, unit: "months" },
      arrGrowth: { low: 0.25, high: 1.2, unit: "percent" },
      ebitdaMargin: { low: -0.25, high: 0.18, unit: "percent" },
      revenueMultiple: { low: 0.7, high: 3, unit: "multiple" },
    },
    modeling: {
      tamUsd: 90_000_000_000,
      samRate: 0.035,
      somRate: 0.006,
      arpaMonthly: 55,
      month12Customers: 12_500,
      customerGrowthRate: 0.7,
      cacUsd: 68,
      grossMarginRate: 0.46,
      lifetimeMonths: 14,
      monthlyBurnUsd: 160_000,
      startupCapexUsd: 380_000,
      targetRunwayMonths: 15,
    },
  },
  luxuryCoffee: {
    key: "luxuryCoffee",
    label: "Luxury Coffee",
    benchmarkBasis:
      "Specialty and luxury coffee benchmarks adjusted for premium pricing, repeat purchase, retail footprint, and brand-led acquisition.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.55, high: 0.72, unit: "percent" },
      cac: { low: 8, high: 55, unit: "usd" },
      ltv: { low: 120, high: 900, unit: "usd" },
      cacPayback: { low: 1, high: 6, unit: "months" },
      arrGrowth: { low: 0.25, high: 0.9, unit: "percent" },
      ebitdaMargin: { low: -0.2, high: 0.2, unit: "percent" },
      revenueMultiple: { low: 0.8, high: 3.5, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  logistics: {
    key: "logistics",
    label: "Logistics / supply chain",
    benchmarkBasis:
      "Logistics software/service benchmarks with operational labor, route density, utilization, and enterprise sales assumptions.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.25, high: 0.55, unit: "percent" },
      cac: { low: 5_000, high: 28_000, unit: "usd" },
      ltv: { low: 25_000, high: 220_000, unit: "usd" },
      cacPayback: { low: 9, high: 24, unit: "months" },
      arrGrowth: { low: 0.35, high: 1.1, unit: "percent" },
      ebitdaMargin: { low: -0.3, high: 0.18, unit: "percent" },
      revenueMultiple: { low: 1.2, high: 5, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  evCharging: {
    key: "evCharging",
    label: "EV Charging",
    benchmarkBasis:
      "EV charging infrastructure benchmarks adjusted for utilization, site capex, energy margin, fleet demand, and permitting friction.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.22, high: 0.5, unit: "percent" },
      cac: { low: 1_500, high: 18_000, unit: "usd" },
      ltv: { low: 12_000, high: 160_000, unit: "usd" },
      cacPayback: { low: 12, high: 42, unit: "months" },
      arrGrowth: { low: 0.4, high: 1.5, unit: "percent" },
      ebitdaMargin: { low: -0.45, high: 0.2, unit: "percent" },
      revenueMultiple: { low: 1.5, high: 7, unit: "multiple" },
    },
    modeling: {
      tamUsd: 58_000_000_000,
      samRate: 0.035,
      somRate: 0.005,
      arpaMonthly: 7_500,
      month12Customers: 28,
      customerGrowthRate: 0.75,
      cacUsd: 9_500,
      grossMarginRate: 0.34,
      lifetimeMonths: 48,
      monthlyBurnUsd: 310_000,
      startupCapexUsd: 2_400_000,
      targetRunwayMonths: 22,
    },
  },
  mobility: {
    key: "mobility",
    label: "Mobility / scooter rental",
    benchmarkBasis:
      "Shared micromobility and scooter rental benchmarks adjusted for fleet utilization, local density, maintenance, charging, permits, theft risk, and repeat trips.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.25, high: 0.52, unit: "percent" },
      cac: { low: 18, high: 95, unit: "usd" },
      ltv: { low: 90, high: 650, unit: "usd" },
      cacPayback: { low: 2, high: 10, unit: "months" },
      arrGrowth: { low: 0.25, high: 1.1, unit: "percent" },
      ebitdaMargin: { low: -0.45, high: 0.18, unit: "percent" },
      revenueMultiple: { low: 0.8, high: 4.5, unit: "multiple" },
    },
    modeling: {
      tamUsd: 28_000_000_000,
      samRate: 0.035,
      somRate: 0.006,
      arpaMonthly: 24,
      month12Customers: 9_000,
      customerGrowthRate: 0.72,
      cacUsd: 42,
      grossMarginRate: 0.38,
      lifetimeMonths: 14,
      monthlyBurnUsd: 185_000,
      startupCapexUsd: 1_200_000,
      targetRunwayMonths: 18,
    },
  },
  manufacturing: {
    key: "manufacturing",
    label: "Advanced manufacturing",
    benchmarkBasis:
      "Industrial manufacturing benchmarks with high capex, long sales cycles, utilization, and capacity constraints.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.22, high: 0.48, unit: "percent" },
      cac: { low: 15_000, high: 90_000, unit: "usd" },
      ltv: { low: 80_000, high: 700_000, unit: "usd" },
      cacPayback: { low: 12, high: 36, unit: "months" },
      arrGrowth: { low: 0.25, high: 0.9, unit: "percent" },
      ebitdaMargin: { low: -0.4, high: 0.22, unit: "percent" },
      revenueMultiple: { low: 0.8, high: 4, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  hospitality: {
    key: "hospitality",
    label: "Hospitality / hotels",
    benchmarkBasis:
      "Hotel and hospitality operating benchmarks adjusted for occupancy, ADR, property capex, and ramp time.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.3, high: 0.58, unit: "percent" },
      cac: { low: 2_000, high: 28_000, unit: "usd" },
      ltv: { low: 20_000, high: 260_000, unit: "usd" },
      cacPayback: { low: 10, high: 36, unit: "months" },
      arrGrowth: { low: 0.15, high: 0.75, unit: "percent" },
      ebitdaMargin: { low: -0.3, high: 0.25, unit: "percent" },
      revenueMultiple: { low: 0.9, high: 4.5, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  luxuryGoods: {
    key: "luxuryGoods",
    label: "Luxury goods / marine",
    benchmarkBasis:
      "Luxury durable goods benchmarks adjusted for long sales cycles, bespoke production, and affluent buyers.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.25, high: 0.58, unit: "percent" },
      cac: { low: 25_000, high: 180_000, unit: "usd" },
      ltv: { low: 150_000, high: 1_200_000, unit: "usd" },
      cacPayback: { low: 18, high: 48, unit: "months" },
      arrGrowth: { low: 0.15, high: 0.7, unit: "percent" },
      ebitdaMargin: { low: -0.45, high: 0.18, unit: "percent" },
      revenueMultiple: { low: 0.8, high: 4, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  fitness: {
    key: "fitness",
    label: "Fitness / gym franchise",
    benchmarkBasis:
      "Premium fitness membership and franchise benchmarks with churn, location ramp, and local acquisition costs.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.42, high: 0.68, unit: "percent" },
      cac: { low: 45, high: 250, unit: "usd" },
      ltv: { low: 650, high: 2_800, unit: "usd" },
      cacPayback: { low: 2, high: 10, unit: "months" },
      arrGrowth: { low: 0.25, high: 1, unit: "percent" },
      ebitdaMargin: { low: -0.25, high: 0.22, unit: "percent" },
      revenueMultiple: { low: 0.8, high: 3.5, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  agriculture: {
    key: "agriculture",
    label: "Agriculture / vertical farming",
    benchmarkBasis:
      "Controlled-environment agriculture benchmarks adjusted for yield, energy cost, buyer concentration, and capex.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.22, high: 0.5, unit: "percent" },
      cac: { low: 8_000, high: 45_000, unit: "usd" },
      ltv: { low: 45_000, high: 320_000, unit: "usd" },
      cacPayback: { low: 12, high: 36, unit: "months" },
      arrGrowth: { low: 0.25, high: 1.1, unit: "percent" },
      ebitdaMargin: { low: -0.45, high: 0.16, unit: "percent" },
      revenueMultiple: { low: 0.7, high: 4, unit: "multiple" },
    },
    modeling: {
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
    },
  },
  restaurant: {
    key: "restaurant",
    label: "Restaurant / food service",
    benchmarkBasis:
      "Restaurant and food-service benchmarks adjusted for location economics, labor cost, food cost, table/throughput capacity, repeat visits, and local demand density.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.58, high: 0.72, unit: "percent" },
      cac: { low: 8, high: 85, unit: "usd" },
      ltv: { low: 160, high: 1_400, unit: "usd" },
      cacPayback: { low: 1, high: 7, unit: "months" },
      arrGrowth: { low: 0.15, high: 0.65, unit: "percent" },
      ebitdaMargin: { low: -0.18, high: 0.18, unit: "percent" },
      revenueMultiple: { low: 0.6, high: 2.2, unit: "multiple" },
    },
    modeling: {
      tamUsd: 82_000_000_000,
      samRate: 0.025,
      somRate: 0.004,
      arpaMonthly: 42,
      month12Customers: 9_500,
      customerGrowthRate: 0.38,
      cacUsd: 34,
      grossMarginRate: 0.64,
      lifetimeMonths: 16,
      monthlyBurnUsd: 125_000,
      startupCapexUsd: 650_000,
      targetRunwayMonths: 15,
    },
  },
  drone: {
    key: "drone",
    label: "Drone technology / autonomous systems",
    benchmarkBasis:
      "Drone hardware, autonomy, inspection, defense, and industrial robotics benchmarks adjusted for hardware margin, regulatory approvals, enterprise procurement, fleet operations, and service contracts.",
    confidence: "Low",
    ranges: {
      grossMargin: { low: 0.28, high: 0.62, unit: "percent" },
      cac: { low: 12_000, high: 75_000, unit: "usd" },
      ltv: { low: 55_000, high: 650_000, unit: "usd" },
      cacPayback: { low: 12, high: 36, unit: "months" },
      arrGrowth: { low: 0.35, high: 1.4, unit: "percent" },
      ebitdaMargin: { low: -0.55, high: 0.2, unit: "percent" },
      revenueMultiple: { low: 1.5, high: 8, unit: "multiple" },
    },
    modeling: {
      tamUsd: 42_000_000_000,
      samRate: 0.035,
      somRate: 0.006,
      arpaMonthly: 12_000,
      month12Customers: 22,
      customerGrowthRate: 0.78,
      cacUsd: 28_000,
      grossMarginRate: 0.44,
      lifetimeMonths: 36,
      monthlyBurnUsd: 380_000,
      startupCapexUsd: 1_900_000,
      targetRunwayMonths: 22,
    },
  },
  services: {
    key: "services",
    label: "Professional services",
    benchmarkBasis:
      "Founder-led services benchmarks adjusted for utilization, delivery leverage, and retainer retention.",
    confidence: "Medium",
    ranges: {
      grossMargin: { low: 0.42, high: 0.72, unit: "percent" },
      cac: { low: 1_000, high: 12_000, unit: "usd" },
      ltv: { low: 12_000, high: 120_000, unit: "usd" },
      cacPayback: { low: 2, high: 12, unit: "months" },
      arrGrowth: { low: 0.2, high: 0.9, unit: "percent" },
      ebitdaMargin: { low: -0.2, high: 0.3, unit: "percent" },
      revenueMultiple: { low: 0.6, high: 2.5, unit: "multiple" },
    },
    modeling: {
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
    },
  },
};

function normalizeIndustryKey(industry: string): IndustryKey {
  const normalized = industry.trim().toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized in industryBenchmarks) {
    return normalized as IndustryKey;
  }

  const aliases: Record<string, IndustryKey> = {
    b2bsaas: "saas",
    softwareasaservice: "saas",
    artificialintelligence: "ai",
    cyber: "cybersecurity",
    healthtech: "healthcare",
    medical: "healthcare",
    twosidedmarketplace: "marketplace",
    platformmarketplace: "marketplace",
    financialtechnology: "fintech",
    ecommerce: "ecommerce",
    onlinecommerce: "ecommerce",
    luxurycoffee: "luxuryCoffee",
    specialtycoffee: "luxuryCoffee",
    coffee: "luxuryCoffee",
    supplychain: "logistics",
    restaurant: "restaurant",
    restaurants: "restaurant",
    foodservice: "restaurant",
    foodandbeverage: "restaurant",
    drone: "drone",
    drones: "drone",
    uav: "drone",
    autonomoussystems: "drone",
    evcharging: "evCharging",
    electricvehiclecharging: "evCharging",
    mobility: "mobility",
    micromobility: "mobility",
    scooterrental: "mobility",
    scooter: "mobility",
    scooters: "mobility",
    bikesharing: "mobility",
    ridesharing: "mobility",
    manufacturing: "manufacturing",
    hospitality: "hospitality",
    luxurygoods: "luxuryGoods",
    fitness: "fitness",
    agriculture: "agriculture",
    services: "services",
  };

  return aliases[normalized] ?? "services";
}

export function getIndustryBenchmarks(industry: string): IndustryBenchmark {
  return industryBenchmarks[normalizeIndustryKey(industry)];
}
