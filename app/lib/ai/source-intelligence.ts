import type { FinancialConsistencyCheck, FinancialModel } from "@/app/lib/ai/financial-model";

export type SourceIntelligenceType =
  | "User Provided"
  | "Industry Benchmark"
  | "Market Research"
  | "Competitor Data"
  | "AI Planning Assumption"
  | "Requires Validation";

export type SourceConfidenceLevel = "High Confidence" | "Medium Confidence" | "Low Confidence";

export type SourceIntelligenceItem = {
  area: "TAM/SAM/SOM" | "Market Size" | "Competitor Insights" | "Financial Benchmarks" | "KPI Assumptions" | "Pricing Assumptions";
  sourceType: SourceIntelligenceType;
  confidence: SourceConfidenceLevel;
  summary: string;
  validationRecommendation: string;
};

export type SourceIntelligenceModel = {
  version: "source_intelligence_engine_v1";
  items: SourceIntelligenceItem[];
  summary: {
    highConfidence: string[];
    mediumConfidence: string[];
    lowConfidence: string[];
  };
};

function confidenceFromMetric(value: string): SourceConfidenceLevel {
  if (value === "High") {
    return "High Confidence";
  }

  if (value === "Medium") {
    return "Medium Confidence";
  }

  return "Low Confidence";
}

function hasUserProvidedOperatingData(consistency: FinancialConsistencyCheck) {
  return consistency.sources.userProvidedData.some((item) =>
    /supplied validation evidence|provided/i.test(item)
  );
}

export function createSourceIntelligenceModel(input: {
  financialModel: FinancialModel;
  financialConsistency: FinancialConsistencyCheck;
}): SourceIntelligenceModel {
  const { financialModel, financialConsistency } = input;
  const userDataConfidence = hasUserProvidedOperatingData(financialConsistency)
    ? "High Confidence"
    : "Medium Confidence";
  const marketSizingConfidence = confidenceFromMetric(financialModel.metrics.tam.confidence);
  const financialBenchmarkConfidence = confidenceFromMetric(financialModel.metrics.grossMargin.confidence);
  const pricingConfidence = confidenceFromMetric(financialModel.metrics.arpa.confidence);
  const items: SourceIntelligenceItem[] = [
    {
      area: "TAM/SAM/SOM",
      sourceType: "Industry Benchmark",
      confidence: marketSizingConfidence,
      summary: "Market sizing uses benchmark market scope, serviceable-market rate, and obtainable-share assumptions.",
      validationRecommendation: "Validate with primary customer research.",
    },
    {
      area: "Market Size",
      sourceType: marketSizingConfidence === "Low Confidence" ? "Requires Validation" : "Market Research",
      confidence: marketSizingConfidence,
      summary: `${financialModel.benchmark.label} market boundaries are benchmark-derived until external market evidence is verified.`,
      validationRecommendation: "Validate market boundaries with current market research and customer interviews.",
    },
    {
      area: "Competitor Insights",
      sourceType: "Competitor Data",
      confidence: "Low Confidence",
      summary: "Competitor claims require confirmation from current public company, pricing, and positioning sources.",
      validationRecommendation: "Validate with competitor pricing pages, customer reviews, and direct substitute analysis.",
    },
    {
      area: "Financial Benchmarks",
      sourceType: "Industry Benchmark",
      confidence: financialBenchmarkConfidence,
      summary: financialModel.benchmark.basis,
      validationRecommendation: "Validate with operating data, supplier quotes, and actual contribution margin.",
    },
    {
      area: "KPI Assumptions",
      sourceType: "AI Planning Assumption",
      confidence: userDataConfidence === "High Confidence" ? "Medium Confidence" : "Low Confidence",
      summary: "KPI thresholds are planning inputs until acquisition, activation, retention, and conversion data exists.",
      validationRecommendation: "Validate KPI thresholds with pilot cohorts and funnel tracking.",
    },
    {
      area: "Pricing Assumptions",
      sourceType: "AI Planning Assumption",
      confidence: pricingConfidence,
      summary: `${financialModel.inputs.pricingModel} is modeled from benchmark ARPA and business-model assumptions.`,
      validationRecommendation: "Run willingness-to-pay interviews.",
    },
  ];

  return {
    version: "source_intelligence_engine_v1",
    items,
    summary: {
      highConfidence: [
        "User provided business context",
        ...items
          .filter((item) => item.confidence === "High Confidence")
          .map((item) => `${item.area}: ${item.summary}`),
      ],
      mediumConfidence: items
        .filter((item) => item.confidence === "Medium Confidence")
        .map((item) => `${item.area}: ${item.summary}`),
      lowConfidence: items
        .filter((item) => item.confidence === "Low Confidence")
        .map((item) => `${item.area}: ${item.summary}`),
    },
  };
}
