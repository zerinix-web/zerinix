import crypto from "node:crypto";

export type ReportFinancialProfile = "software" | "capital_intensive" | "services" | "marketplace";
export type ReportKind = "business_plan" | "market_analysis";

export type CanonicalFinancialMetric = {
  label: string;
  value: string;
  confidence: "High" | "Medium" | "Low";
  status: "estimated" | "assumption" | "needs_validation";
  rationale: string;
};

export type CanonicalFinancialAssumptions = {
  version: "financial_assumptions_v1";
  fingerprint: string;
  profile: ReportFinancialProfile;
  reportKind: ReportKind;
  metrics: {
    pricingAsp: CanonicalFinancialMetric;
    mrr: CanonicalFinancialMetric;
    arr: CanonicalFinancialMetric;
    cac: CanonicalFinancialMetric;
    ltv: CanonicalFinancialMetric;
    grossMargin: CanonicalFinancialMetric;
    burnRate: CanonicalFinancialMetric;
    runway: CanonicalFinancialMetric;
    paybackPeriod: CanonicalFinancialMetric;
    ebitda: CanonicalFinancialMetric;
    breakEven: CanonicalFinancialMetric;
  };
};

type MetricInput = Omit<CanonicalFinancialMetric, "label">;

function hashAiPayload(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeAiPrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function detectFinancialProfile(prompt: string): ReportFinancialProfile {
  const normalized = normalizeAiPrompt(prompt);
  const hasSoftwareSignal = includesAny(normalized, [
    "ai",
    "crm",
    "cybersecurity",
    "saas",
    "software",
    "platform",
    "assistant",
    "automation",
  ]);
  const hasPrimaryHardAssetSignal = includesAny(normalized, [
    "battery",
    "manufacturer",
    "manufacturing",
    "factory",
    "yacht",
    "gym",
    "franchise",
    "restaurant",
    "real estate",
    "ev",
    "electric vehicle",
    "farming",
    "farm",
    "agriculture",
    "vertical farming",
  ]);
  const hasLocationHardAssetSignal = includesAny(normalized, [
    "hotel",
    "hospital",
    "clinic",
  ]);

  if (hasPrimaryHardAssetSignal || (hasLocationHardAssetSignal && !hasSoftwareSignal)) {
    return "capital_intensive";
  }

  if (includesAny(normalized, ["marketplace", "platform marketplace", "two sided", "two-sided"])) {
    return "marketplace";
  }

  if (includesAny(normalized, ["agency", "consulting", "service", "studio", "clinic"])) {
    return "services";
  }

  return "software";
}

function metric(label: string, input: MetricInput): CanonicalFinancialMetric {
  return { label, ...input };
}

function profileMetrics(profile: ReportFinancialProfile) {
  if (profile === "capital_intensive") {
    return {
      pricingAsp: metric("Pricing / ASP", {
        value: "$5,000-$50,000 initial contract or ticket size",
        confidence: "Low",
        status: "assumption",
        rationale: "Capital-intensive concepts vary widely by asset class, geography, and buyer segment.",
      }),
      mrr: metric("MRR", {
        value: "$25k-$150k by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Depends on capacity, utilization, sales cycle, and financing constraints.",
      }),
      arr: metric("ARR", {
        value: "$300k-$1.8M by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Derived from the canonical MRR range rather than an independent estimate.",
      }),
      cac: metric("CAC", {
        value: "$2,500-$25,000",
        confidence: "Low",
        status: "assumption",
        rationale: "High-ticket or regulated markets usually require founder-led sales and trust building.",
      }),
      ltv: metric("LTV", {
        value: "$30,000-$250,000",
        confidence: "Low",
        status: "assumption",
        rationale: "Requires retention, repeat purchase, utilization, and margin validation.",
      }),
      grossMargin: metric("Gross Margin", {
        value: "35%-60%",
        confidence: "Low",
        status: "assumption",
        rationale: "Asset, labor, financing, and operational costs materially affect margin.",
      }),
      burnRate: metric("Burn Rate", {
        value: "$75k-$300k/month",
        confidence: "Low",
        status: "assumption",
        rationale: "Capital expenditure, inventory, facilities, and staffing drive early burn.",
      }),
      runway: metric("Runway", {
        value: "9-18 months after financing",
        confidence: "Low",
        status: "assumption",
        rationale: "Runway depends on launch scope, asset financing, and pace of hiring.",
      }),
      paybackPeriod: metric("Payback Period", {
        value: "12-30 months",
        confidence: "Low",
        status: "assumption",
        rationale: "Longer payback is typical before utilization and repeat demand are proven.",
      }),
      ebitda: metric("EBITDA", {
        value: "negative until scale; 10%-20% target at maturity",
        confidence: "Low",
        status: "assumption",
        rationale: "Early EBITDA is likely negative while assets, team, and demand are built.",
      }),
      breakEven: metric("Break-even", {
        value: "month 24-48",
        confidence: "Low",
        status: "assumption",
        rationale: "Break-even requires utilization, repeat demand, and financing structure validation.",
      }),
    };
  }

  if (profile === "marketplace") {
    return {
      pricingAsp: metric("Pricing / ASP", {
        value: "8%-15% take rate or $99-$499/month SaaS fee",
        confidence: "Low",
        status: "assumption",
        rationale: "Marketplace monetization depends on liquidity, category margins, and payment flow.",
      }),
      mrr: metric("MRR", {
        value: "$20k-$120k by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Derived from expected early GMV or subscription adoption.",
      }),
      arr: metric("ARR", {
        value: "$240k-$1.44M by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Directly annualized from canonical MRR.",
      }),
      cac: metric("CAC", {
        value: "$500-$5,000 per retained supply or demand account",
        confidence: "Low",
        status: "assumption",
        rationale: "Two-sided acquisition usually requires incentives and manual onboarding.",
      }),
      ltv: metric("LTV", {
        value: "$5,000-$45,000",
        confidence: "Low",
        status: "assumption",
        rationale: "Depends on repeat frequency, take rate, retention, and liquidity.",
      }),
      grossMargin: metric("Gross Margin", {
        value: "55%-80%",
        confidence: "Medium",
        status: "assumption",
        rationale: "Software marketplace margins can be strong after payment, support, and incentive costs.",
      }),
      burnRate: metric("Burn Rate", {
        value: "$40k-$180k/month",
        confidence: "Low",
        status: "assumption",
        rationale: "Liquidity building and incentives can raise burn before density is reached.",
      }),
      runway: metric("Runway", {
        value: "12-18 months",
        confidence: "Medium",
        status: "assumption",
        rationale: "Standard early-stage runway target while testing marketplace liquidity.",
      }),
      paybackPeriod: metric("Payback Period", {
        value: "9-18 months",
        confidence: "Low",
        status: "assumption",
        rationale: "Payback depends on cohort repeat rate and incentive intensity.",
      }),
      ebitda: metric("EBITDA", {
        value: "negative until liquidity; 15%-25% target at scale",
        confidence: "Low",
        status: "assumption",
        rationale: "Operating leverage appears only after local/category liquidity is established.",
      }),
      breakEven: metric("Break-even", {
        value: "month 24-36",
        confidence: "Low",
        status: "assumption",
        rationale: "Requires stable repeat transactions and declining acquisition subsidy.",
      }),
    };
  }

  if (profile === "services") {
    return {
      pricingAsp: metric("Pricing / ASP", {
        value: "$2,000-$15,000/month per client",
        confidence: "Medium",
        status: "assumption",
        rationale: "Service businesses usually monetize through retainers, projects, or hybrid subscriptions.",
      }),
      mrr: metric("MRR", {
        value: "$20k-$100k by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Depends on founder-led sales velocity and delivery capacity.",
      }),
      arr: metric("ARR", {
        value: "$240k-$1.2M by month 12",
        confidence: "Low",
        status: "assumption",
        rationale: "Directly annualized from canonical MRR.",
      }),
      cac: metric("CAC", {
        value: "$750-$7,500",
        confidence: "Low",
        status: "assumption",
        rationale: "Founder-led outbound and referrals can lower CAC, but sales cycles vary.",
      }),
      ltv: metric("LTV", {
        value: "$12,000-$90,000",
        confidence: "Low",
        status: "assumption",
        rationale: "Retention and expansion are unvalidated until client cohorts exist.",
      }),
      grossMargin: metric("Gross Margin", {
        value: "45%-70%",
        confidence: "Medium",
        status: "assumption",
        rationale: "Depends on labor leverage, automation, and delivery seniority.",
      }),
      burnRate: metric("Burn Rate", {
        value: "$25k-$90k/month",
        confidence: "Medium",
        status: "assumption",
        rationale: "Early burn is driven mainly by team, tools, and founder sales costs.",
      }),
      runway: metric("Runway", {
        value: "12-18 months",
        confidence: "Medium",
        status: "assumption",
        rationale: "Standard runway target for validating repeatable services revenue.",
      }),
      paybackPeriod: metric("Payback Period", {
        value: "3-9 months",
        confidence: "Low",
        status: "assumption",
        rationale: "Service payback can be fast if founder-led acquisition works.",
      }),
      ebitda: metric("EBITDA", {
        value: "negative early; 15%-30% target at maturity",
        confidence: "Low",
        status: "assumption",
        rationale: "Profitability improves only after utilization and delivery leverage stabilize.",
      }),
      breakEven: metric("Break-even", {
        value: "month 12-24",
        confidence: "Low",
        status: "assumption",
        rationale: "Break-even depends on closing velocity and delivery margin.",
      }),
    };
  }

  return {
    pricingAsp: metric("Pricing / ASP", {
      value: "$300-$2,000/month per customer",
      confidence: "Medium",
      status: "assumption",
      rationale: "B2B software typically starts with subscription pricing before usage expansion.",
    }),
    mrr: metric("MRR", {
      value: "$10k-$75k by month 12",
      confidence: "Low",
      status: "assumption",
      rationale: "Depends on sales cycle, conversion, onboarding capacity, and retention.",
    }),
    arr: metric("ARR", {
      value: "$120k-$900k by month 12",
      confidence: "Low",
      status: "assumption",
      rationale: "Directly annualized from canonical MRR.",
    }),
    cac: metric("CAC", {
      value: "$1,000-$8,000",
      confidence: "Low",
      status: "assumption",
      rationale: "Early B2B software CAC is uncertain until channel conversion is validated.",
    }),
    ltv: metric("LTV", {
      value: "$10,000-$80,000",
      confidence: "Low",
      status: "assumption",
      rationale: "Requires churn, expansion, and gross margin validation.",
    }),
    grossMargin: metric("Gross Margin", {
      value: "70%-85%",
      confidence: "Medium",
      status: "assumption",
      rationale: "Software margins are typically high after hosting, AI, support, and success costs.",
    }),
    burnRate: metric("Burn Rate", {
      value: "$40k-$150k/month",
      confidence: "Medium",
      status: "assumption",
      rationale: "Early burn is mainly product, engineering, founder sales, and AI infrastructure.",
    }),
    runway: metric("Runway", {
      value: "12-18 months",
      confidence: "Medium",
      status: "assumption",
      rationale: "Standard early-stage runway while validating repeatable sales.",
    }),
    paybackPeriod: metric("Payback Period", {
      value: "6-15 months",
      confidence: "Low",
      status: "assumption",
      rationale: "Payback depends on channel mix, onboarding cost, and retention.",
    }),
    ebitda: metric("EBITDA", {
      value: "negative early; 20%-35% target at maturity",
      confidence: "Low",
      status: "assumption",
      rationale: "Operating leverage appears after product-market fit and scale.",
    }),
    breakEven: metric("Break-even", {
      value: "month 18-36",
      confidence: "Low",
      status: "assumption",
      rationale: "Break-even requires stable acquisition, retention, and controlled burn.",
    }),
  };
}

export function createCanonicalFinancialAssumptions(input: {
  prompt: string;
  reportKind: ReportKind;
}): CanonicalFinancialAssumptions {
  const profile = detectFinancialProfile(input.prompt);
  const fingerprint = hashAiPayload(
    JSON.stringify({
      version: "financial_assumptions_v1",
      prompt: normalizeAiPrompt(input.prompt),
      reportKind: input.reportKind,
      profile,
    })
  ).slice(0, 16);

  return {
    version: "financial_assumptions_v1",
    fingerprint,
    profile,
    reportKind: input.reportKind,
    metrics: profileMetrics(profile),
  };
}

export function formatCanonicalFinancialAssumptions(
  assumptions: CanonicalFinancialAssumptions
) {
  const metricRows = Object.values(assumptions.metrics)
    .map(
      (metric) =>
        `- ${metric.label}: ${metric.value} | status=${metric.status} | confidence=${metric.confidence} | rationale=${metric.rationale}`
    )
    .join("\n");

  return `Canonical Financial Assumptions (${assumptions.version}, ${assumptions.fingerprint})
Profile: ${assumptions.profile}
Source of truth rules:
- These values are the only financial metrics allowed in this report.
- No section may invent, replace, or independently recalculate ASP, MRR, ARR, CAC, LTV, Gross Margin, Burn Rate, Runway, Payback Period, EBITDA, or Break-even.
- If a section needs a financial metric, reference the exact value below.
- If confidence is Low, explicitly call it an assumption instead of presenting it as verified fact.
- Scenario Analysis may create worst/base/best directional variants, but the Base Case must use these canonical values.

${metricRows}`;
}
