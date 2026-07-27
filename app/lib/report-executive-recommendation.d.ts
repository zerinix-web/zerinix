export type ExecutiveRecommendationDisplayMetrics = {
  investmentNeeded: string;
  nextAction: string;
  mainRisk: string;
};

export function getExecutiveRecommendationDisplayMetrics(
  content: string,
  locale?: "en" | "tr"
): ExecutiveRecommendationDisplayMetrics;
