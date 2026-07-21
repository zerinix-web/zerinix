import type { FinancialConsistencyCheck, FinancialModel } from "@/app/lib/ai/financial-model";
import type { InvestmentScore } from "@/app/lib/ai/investment-score";

export type DecisionConfidenceDecision = "GO" | "WAIT" | "NO-GO";

export type DecisionConfidenceModel = {
  version: "decision_confidence_engine_v1";
  decision: DecisionConfidenceDecision;
  confidenceScore: number;
  positiveFactors: string[];
  negativeFactors: string[];
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function categoryScore(score: InvestmentScore, key: keyof InvestmentScore["categories"]) {
  const category = score.categories[key];

  return Math.round((category.score / Math.max(1, category.maximumScore)) * 100);
}

function mapDecision(score: InvestmentScore): DecisionConfidenceDecision {
  if (score.recommendation === "GO") {
    return "GO";
  }

  if (score.recommendation === "PASS") {
    return "NO-GO";
  }

  return "WAIT";
}

export function createDecisionConfidenceModel(input: {
  financialModel: FinancialModel;
  investmentScore: InvestmentScore;
  financialConsistency: FinancialConsistencyCheck;
}): DecisionConfidenceModel {
  const { financialModel, investmentScore, financialConsistency } = input;
  const marketScore = categoryScore(investmentScore, "marketOpportunity");
  const modelScore = categoryScore(investmentScore, "businessModel");
  const marginScore = categoryScore(investmentScore, "financialHealth");
  const capitalScore = categoryScore(investmentScore, "capitalEfficiency");
  const executionScore = categoryScore(investmentScore, "executionRisk");
  const confidencePenalty =
    financialConsistency.quality === "High Risk"
      ? 14
      : financialConsistency.quality === "Needs Validation"
        ? 7
        : 0;
  const confidenceScore = clampScore(
    Math.round((investmentScore.confidence * 0.65) + (investmentScore.totalScore * 0.35) - confidencePenalty)
  );
  const recurringRevenue =
    /subscription|recurring|membership|abonelik/i.test(financialModel.inputs.businessModel) ||
    /subscription|recurring|membership|abonelik/i.test(financialModel.inputs.pricingModel);
  const revenueDiversity =
    /\+|b2b|b2c|d2c|marketplace|wholesale|abonelik|subscription/i.test(financialModel.inputs.businessModel);
  const positiveFactors = [
    marketScore >= 60
      ? "Market opportunity is attractive enough to justify validation."
      : "",
    modelScore >= 58 || recurringRevenue
      ? recurringRevenue
        ? "Subscription model creates recurring revenue potential."
        : "Business model strength is directionally positive."
      : "",
    financialModel.metrics.grossMargin.value >= financialModel.benchmark.ranges.grossMargin.low || marginScore >= 58
      ? "Gross margin opportunity is attractive."
      : "",
    revenueDiversity
      ? "Revenue diversity can reduce single-channel dependence."
      : "",
    investmentScore.confidence >= 60
      ? "Validation signals are strong enough to increase decision confidence."
      : "",
  ].filter(Boolean);
  const negativeFactors = [
    investmentScore.confidence < 60
      ? "Customer validation gaps remain unresolved."
      : "",
    financialModel.metrics.cac.confidence === "Low" || financialModel.metrics.cacPayback.value > financialModel.benchmark.ranges.cacPayback.high
      ? "CAC uncertainty remains a material risk."
      : "",
    capitalScore < 55 || financialConsistency.warnings.some((warning) => warning.code === "capital_efficiency")
      ? "Capital efficiency risk requires validation."
      : "",
    categoryScore(investmentScore, "competitiveAdvantage") < 55
      ? "Competitive risk needs stronger proof of defensibility."
      : "",
    executionScore < 55
      ? "Execution complexity could slow the path to proof."
      : "",
  ].filter(Boolean);

  return {
    version: "decision_confidence_engine_v1",
    decision: mapDecision(investmentScore),
    confidenceScore,
    positiveFactors: positiveFactors.slice(0, 5),
    negativeFactors: negativeFactors.slice(0, 5),
  };
}
