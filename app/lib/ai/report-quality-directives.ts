type ReportQualityKind = "business_plan" | "market_analysis";

const sharedDecisionSupportDirectives = [
  "Before drafting, silently create one Decision Spine with exactly five elements: business-specific thesis, decisive evidence gap, primary risk mechanism, next concrete action, and proof-gated milestone sequence. Keep wording internal; use the facts consistently without copying sentences between sections.",
  "Every recommendation or action must name a business-specific object such as the actual ICP, buyer, workflow, channel, pricing unit, geography, regulatory constraint, operating asset, or financial threshold. Never write generic startup advice when the submitted business context supports a more precise action.",
  "Open the executive section with the decision or verdict in the first sentence, then explain only the highest-leverage evidence behind it.",
  "Use claim -> reason -> business implication for major analytical statements; avoid descriptive paragraphs that do not change a founder decision.",
  "Use stable markdown: short paragraphs, compact bullets, bold metric labels where helpful, and no duplicated section headings inside section content.",
  "SWOT must render as four clearly labeled groups: Strengths, Weaknesses, Opportunities, and Threats. Each group needs distinct, non-empty, decision-relevant bullets.",
  "Separate opportunities from risks: opportunities are openings to exploit; risks are obstacles with a leading indicator and mitigation path.",
  "Recommendations must be action-oriented: decision, conviction/confidence, key reason, main risk, and next concrete action.",
  "Every major analytical section must include a compact executive implication line that explains why the section changes the CEO/founder decision. Do not add a heading. This must be specific, not a generic summary.",
  "Confidence must be decomposed where relevant into Market, Competition, Financial, Execution, and Product confidence. Explain the weighted logic using report findings; do not present a single unexplained score.",
  "Competitor analysis must name only credible competitors or substitutes available from the input/model context. For each important competitor, include pricing, target customer, funding, employee size, strengths, weaknesses, positioning, and how the analyzed company can outperform when available; omit unknown fields instead of inventing them.",
  "Risk analysis must use a professional risk matrix: probability, impact, severity, mitigation, and early warning signal for each material risk.",
  "Keep SWOT, Porter, and Risks mutually exclusive: SWOT inventories internal capabilities and external openings; Porter explains structural industry economics; Risks describes company-specific failure modes with indicators and mitigations. Never reuse the same sentence, example, or recommendation across them.",
  "Roadmap/action sections must be written as an AI Action Plan with Immediate Actions, Next 30 Days, Next 90 Days, Next 6 Months, and Next 12 Months. Every action needs expected business impact.",
  "Maintain executive continuity without repetition: Executive Summary states the verdict and evidence gap; Executive Recommendation converts them into one decision and next action; Roadmap begins with that action and sequences new proof gates instead of restating the rationale.",
  "Use natural analytical continuity through dependencies between sections, not filler transitions such as 'as mentioned above', 'building on the previous section', or generic concluding sentences.",
  "Never reuse a complete narrative paragraph in another section. If the same fact is required for consistency, state only the new implication owned by the current section.",
  "End the final available report section with a board-level CEO Brief: maximum 10 concise bullets, each directly supported by findings already in the report; no new research or unsupported claims.",
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
    "Silently maintain a paragraph ledger while drafting. Before returning JSON, remove any sentence or paragraph that merely restates another section without adding a section-owned implication.",
    "A recommendation is specific only when it names the analyzed business context and defines who acts, what is tested or changed, and which proof point determines the next decision.",
    "Executive Summary, Executive Recommendation, and Roadmap must share one decision, one primary risk, and one next action, but each must express only its own layer: verdict, decision logic, and execution sequence.",
    "SWOT, Porter, Financials, Risks, Executive Recommendation, and Roadmap must not share prose. Financial sections own numbers; Risks owns failure mechanisms; Recommendation owns the capital decision; Roadmap owns timing and proof gates.",
    "Prefer deterministic labels for structured sections: SWOT groups, Worst/Base/Best scenarios, metric names, source fields, and recommendation fields.",
    kind === "business_plan"
      ? "Keep the report ordered as an investor business plan: decision, pain, product, customer, market, competition, model, sizing, strategy, economics, risks, execution, sources."
      : "Keep the report ordered as market diligence: verdict, market context, sizing, trends, customers, competitors, pain, opportunities, threats, forces, economics, scenarios, recommendation, entry, validation, sources.",
  ];
}
