type ReportQualityKind = "business_plan" | "market_analysis";

const sharedDecisionSupportDirectives = [
  "Open the executive section with the decision or verdict in the first sentence, then explain only the highest-leverage evidence behind it.",
  "Use claim -> reason -> business implication for major analytical statements; avoid descriptive paragraphs that do not change a founder decision.",
  "Use stable markdown: short paragraphs, compact bullets, bold metric labels where helpful, and no duplicated section headings inside section content.",
  "SWOT must render as four clearly labeled groups: Strengths, Weaknesses, Opportunities, and Threats. Each group needs distinct, non-empty, decision-relevant bullets.",
  "Separate opportunities from risks: opportunities are openings to exploit; risks are obstacles with a leading indicator and mitigation path.",
  "Recommendations must be action-oriented: decision, conviction/confidence, key reason, main risk, and next concrete action.",
];

const businessPlanDirectives = [
  "Treat the business model, ICP, pricing, unit economics, roadmap, and recommendation as one linked operating plan.",
  "Do not let Executive Summary repeat Business Model, SWOT, Roadmap, or Financial Dashboard; it should summarize the investability decision only.",
];

const marketAnalysisDirectives = [
  "Treat market size, trends, competitors, customer pain, opportunities, threats, and entry strategy as one linked market-entry thesis.",
  "Do not let Executive Summary repeat TAM/SAM/SOM, Competitor Analysis, SWOT, or Sources; it should summarize the market-entry verdict only.",
];

export function buildDecisionSupportDirectives(kind: ReportQualityKind) {
  return [
    ...sharedDecisionSupportDirectives,
    ...(kind === "business_plan" ? businessPlanDirectives : marketAnalysisDirectives),
  ];
}

export function buildFullReportStructureDirectives(kind: ReportQualityKind) {
  return [
    "Return JSON keys in the exact order listed above and keep every value compatible with the existing report renderer.",
    "Every section must add one unique business insight; if a point was made earlier, only reference the implication instead of repeating the paragraph.",
    "Prefer deterministic labels for structured sections: SWOT groups, Worst/Base/Best scenarios, metric names, source fields, and recommendation fields.",
    kind === "business_plan"
      ? "Keep the report ordered as an investor business plan: decision, pain, product, customer, market, competition, model, sizing, strategy, economics, risks, execution, sources."
      : "Keep the report ordered as market diligence: verdict, market context, sizing, trends, customers, competitors, pain, opportunities, threats, forces, economics, scenarios, recommendation, entry, validation, sources.",
  ];
}
