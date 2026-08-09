type ReportQualityKind = "business_plan" | "market_analysis";
export type ExecutivePresentationKind =
  | ReportQualityKind
  | "real_estate"
  | "specialized_analysis";

const majorSectionsByKind: Record<ExecutivePresentationKind, string> = {
  business_plan:
    "Problem, Solution, Market Opportunity, Competitor Landscape, Business Model, Pricing Strategy, Go-to-Market, Financial Dashboard, Risks, and Executive Recommendation",
  market_analysis:
    "Market Overview, Market Size, Industry Trends, Competitive Landscape, Opportunities, Threats, Porter's Five Forces, and Strategic Recommendations",
  real_estate:
    "Ownership and Title, Zoning and Land Use, Comparable Market Evidence, Valuation, Legal and Environmental Risks, Development Potential, Scenarios, and Final Recommendation",
  specialized_analysis:
    "Domain Findings, Regulatory and Compliance Findings, Financial Implications, Operational Implications, Risk Analysis, Scenario Analysis, Decision Assessment, and Final Recommendation",
};

// Report-specific: the Executive Scorecard's field list must not silently
// carry Business Idea Validation's investor/founder vocabulary
// ("Investment Readiness", "Estimated Time to Market" -- a product-launch
// concept) into Market Intelligence or Strategic Advisory just because they
// share this presentation contract's placement/formatting rules. Only
// business_plan and real_estate are genuinely investment-decision reports;
// market_analysis and specialized_analysis get their own, report-native
// field names.
const scorecardFieldsByKind: Record<ExecutivePresentationKind, string> = {
  business_plan:
    "Overall Recommendation, Confidence Score, Opportunity Level, Risk Level, Estimated Time to Market, Investment Readiness, and Decision Summary",
  market_analysis:
    "Overall Recommendation, Confidence Score, Market Attractiveness, Competitive Intensity, Entry Timing, and Decision Summary",
  real_estate:
    "Overall Recommendation, Confidence Score, Opportunity Level, Risk Level, Estimated Time to Market, Investment Readiness, and Decision Summary",
  specialized_analysis:
    "Overall Recommendation, Confidence Score, Decision Readiness, Risk Level, Resolution Timeline, and Decision Summary",
};

// Same rationale: "CEO Summary" is investor/founder-executive framing.
// Market Intelligence and Strategic Advisory get a heading that names what
// the block actually is instead of who it's nominally addressed to.
const summaryHeadingByKind: Record<ExecutivePresentationKind, string> = {
  business_plan: "CEO Summary",
  market_analysis: "Market Diligence Summary",
  real_estate: "CEO Summary",
  specialized_analysis: "Executive Decision Summary",
};

/**
 * Presentation-only contract. All blocks are embedded inside existing string
 * fields, so report schemas, stream events, API contracts, and PDF inputs stay
 * unchanged.
 */
export function buildExecutivePresentationDirectives(
  kind: ExecutivePresentationKind
) {
  const scorecardPlacement =
    kind === "business_plan" || kind === "market_analysis"
      ? "Begin Executive Summary"
      : "Begin the existing executive/final-recommendation presentation";
  const summaryPlacement =
    kind === "business_plan"
      ? "End Sources / Assumptions"
      : kind === "market_analysis"
        ? "End Strategic Recommendations, immediately before Sources"
        : "End Final Recommendation";
  const summaryHeading = summaryHeadingByKind[kind];

  return [
    `${scorecardPlacement} with an Executive Scorecard containing exactly: ${scorecardFieldsByKind[kind]}. Keep it scannable in under 30 seconds.`,
    `Treat these as major sections: ${majorSectionsByKind[kind]}. End each with one compact AI Executive Insight block containing Key Insight, Why It Matters, Recommended Executive Action, and Expected Business Impact. The block must synthesize the section's new implication instead of repeating its prose.`,
    "After each major-section insight, include Confidence: High, Medium, or Low plus one sentence tied to evidence coverage and unresolved gaps.",
    "After each major section, include Next Actions with 3-5 concrete actions that name an owner or operating object, an action, and a measurable proof point or decision gate.",
    "Classify material claims with [Verified], [Estimated], or [Assumption]. If a specialized domain requires stricter provenance labels, preserve those stricter labels and map their meaning rather than weakening them.",
    `${summaryPlacement} with a one-page ${summaryHeading} containing exactly: Biggest Opportunity, Biggest Risk, First 90 Days, Critical KPIs, and Final Recommendation. Reuse conclusions by concise reference; do not copy earlier paragraphs.`,
    `Keep every insight, action, confidence line, scorecard, and ${summaryHeading} inside the existing field word budgets. Replace repetitive summaries and generic advice with these decision blocks; do not increase total report length.`,
  ];
}

// Genuinely shared: formatting, tone, structural/output-consistency rules
// that name no report-specific concept (no founder, no CEO, no Roadmap, no
// investment terminology). Safe for any report type to reuse.
const universalDecisionQualityDirectives = [
  "Before drafting, silently create one Decision Spine with exactly five elements: the specific thesis, decisive evidence gap, primary risk mechanism, next concrete action, and proof-gated milestone sequence. Keep wording internal; use the facts consistently without copying sentences between sections.",
  "Every recommendation or action must name a specific object such as the actual buyer, workflow, channel, pricing unit, geography, regulatory constraint, operating asset, or financial threshold. Never write generic advice when the submitted context supports a more precise action.",
  "Open the executive section with the decision or verdict in the first sentence, then explain only the highest-leverage evidence behind it.",
  "Use claim -> reason -> implication for major analytical statements; avoid descriptive paragraphs that do not change the decision.",
  "Use stable markdown: short paragraphs, compact bullets, bold metric labels where helpful, and no duplicated section headings inside section content.",
  "SWOT must render as four clearly labeled groups: Strengths, Weaknesses, Opportunities, and Threats. Each group needs distinct, non-empty, decision-relevant bullets.",
  "Separate opportunities from risks: opportunities are openings to exploit; risks are obstacles with a leading indicator and mitigation path.",
  "Recommendations must be action-oriented: decision, conviction/confidence, key reason, main risk, and next concrete action.",
  "Every major analytical section must include a compact executive implication line that explains why the section changes the decision. Do not add a heading. This must be specific, not a generic summary.",
  "Competitor or comparable analysis must name only credible entities available from the input/model context. For each important one, include pricing, target segment, scale, strengths, weaknesses, positioning, and how the analyzed subject can outperform when available; omit unknown fields instead of inventing them.",
  "Risk analysis must use a professional risk matrix: probability, impact, severity, mitigation, and early warning signal for each material risk.",
  "Keep SWOT, Porter, and Risks mutually exclusive: SWOT inventories internal capabilities and external openings; Porter explains structural industry economics; Risks describes subject-specific failure modes with indicators and mitigations. Never reuse the same sentence, example, or recommendation across them.",
  "Use natural analytical continuity through dependencies between sections, not filler transitions such as 'as mentioned above', 'building on the previous section', or generic concluding sentences.",
  "Never reuse a complete narrative paragraph in another section. If the same fact is required for consistency, state only the new implication owned by the current section.",
];

// Business Idea Validation only: founder/CEO framing, unit-economics
// confidence decomposition, and the founder Roadmap structure have no
// place in Market Intelligence or Strategic Advisory.
const businessPlanDecisionSupportDirectives = [
  "Use claim -> reason -> business implication for major analytical statements; avoid descriptive paragraphs that do not change a founder decision.",
  "Every major analytical section must include a compact executive implication line that explains why the section changes the CEO/founder decision. Do not add a heading. This must be specific, not a generic summary.",
  "Confidence must be decomposed where relevant into Market, Competition, Financial, Execution, and Product confidence. Explain the weighted logic using report findings; do not present a single unexplained score.",
  "Competitor analysis must name only credible competitors or substitutes available from the input/model context. For each important competitor, include pricing, target customer, funding, employee size, strengths, weaknesses, positioning, and how the analyzed company can outperform when available; omit unknown fields instead of inventing them.",
  "Roadmap/action sections must be written as an AI Action Plan with Immediate Actions, Next 30 Days, Next 90 Days, Next 6 Months, and Next 12 Months. Every action needs expected business impact.",
  "Maintain executive continuity without repetition: Executive Summary states the verdict and evidence gap; Executive Recommendation converts them into one decision and next action; Roadmap begins with that action and sequences new proof gates instead of restating the rationale.",
  "Treat the business model, ICP, pricing, unit economics, roadmap, and recommendation as one linked operating plan.",
  "Do not let Executive Summary repeat Business Model, SWOT, Roadmap, or Financial Dashboard; it should summarize the investability decision only.",
  "End the final available report section with a board-level CEO Brief: maximum 10 concise bullets, each directly supported by findings already in the report; no new research or unsupported claims.",
];

// Business Idea Validation-only, enforced at the type level: market.ts and
// domain-analysis.ts build their own report-specific directives instead of
// sharing this business-plan-native decision-support contract.
export function buildDecisionSupportDirectives(kind: "business_plan") {
  void kind;
  return [...universalDecisionQualityDirectives, ...businessPlanDecisionSupportDirectives];
}

// Shared verbatim by plan.ts and market.ts (previously two independently
// hand-written, slightly-drifting versions of the same two rules -- pure
// prompt text has no logic to diverge, so duplication there only buys
// drift risk and doubled maintenance, never resilience).
export const insightLedgerAndTokenBudgetDirectives = [
  "Maintain an internal insight ledger while drafting: explain each insight once; later fields/sections use a cross-reference of at most 12 words and contribute only their new section-owned implication.",
  "Use at least 20% fewer output tokens than a repetitive draft by deleting restatement and filler only. Preserve evidence, citations, calculations, decisions, and unique analysis.",
];

// Genuinely universal across every report type: tone, filler elimination,
// citation/evidence policy, and the "every section answers a question"
// structural rule. Names no report-specific concept (no founder, no
// Roadmap, no market-entry-specific vocabulary) -- write like a senior
// strategy consultant, not an AI research log. A deterministic
// post-processing pass (report-isolation-validator.ts, executive-quality-gate.ts,
// filler-detection.ts, evidence-summary.ts) enforces the hard versions of
// several of these as a safety net; this directive set is the first line
// of defense so the model produces less to strip in the first place.
export function buildExecutiveConsultingStyleDirectives() {
  return [
    "Write like a senior strategy consultant delivering a decision memo, not an AI answering a question. Prefer the words Recommendation, Evidence, Reasoning, Decision, Trade-offs, and Execution over hedge language.",
    "Never open a sentence with 'According to', 'It depends', 'There are many', 'As an AI', 'It is important to note', 'In conclusion', or 'In today's market'. State the conclusion, then the evidence behind it.",
    "Every section must exist to answer one specific executive question implied by its label (e.g. a market-attractiveness section answers 'Is this market attractive?'; a risk section answers 'What can make this fail?'; a financial section answers 'How much capital is required and when does it pay back?'). Open the section with that answer in the first sentence. If a section would only restate facts without answering its own question, compress it to the minimum that does.",
    "Do not enumerate raw source URLs, domains, or evidence-registry IDs inside any analytical section. Reference evidence by category and confidence only (e.g. 'confirmed by two independent government filings'); the sources field is the only place a citation list belongs, and even there it must stay a categorized summary, not a page of links.",
    "Every paragraph must change what the reader would decide or how confident they should be. Delete a paragraph instead of writing it if it only restates the section title, defines a common term, or repeats a fact already established elsewhere in the report.",
    "Whenever a section states financial figures, lead with the compact figures themselves (Investment, Revenue, Costs, Gross Margin, ROI, Payback, and Worst/Expected/Best Case) before any prose explanation of how they were derived.",
  ];
}

// Business Idea Validation-only, enforced at the type level (see
// buildDecisionSupportDirectives above for the same rationale): this
// directive set names Roadmap and "capital decision" unconditionally,
// which are Business Plan-specific concepts. market.ts and
// domain-analysis.ts build their own full-report structure directives.
export function buildFullReportStructureDirectives(kind: "business_plan") {
  void kind;
  return [
    "Return JSON keys in the exact order listed above and keep every value compatible with the existing report renderer.",
    "Every section must add one unique business insight; if a point was made earlier, only reference the implication instead of repeating the paragraph.",
    "Silently maintain a paragraph ledger while drafting. Before returning JSON, remove any sentence or paragraph that merely restates another section without adding a section-owned implication.",
    "A recommendation is specific only when it names the analyzed business context and defines who acts, what is tested or changed, and which proof point determines the next decision.",
    "Executive Summary, Executive Recommendation, and Roadmap must share one decision, one primary risk, and one next action, but each must express only its own layer: verdict, decision logic, and execution sequence.",
    "SWOT, Porter, Financials, Risks, Executive Recommendation, and Roadmap must not share prose. Financial sections own numbers; Risks owns failure mechanisms; Recommendation owns the capital decision; Roadmap owns timing and proof gates.",
    "Prefer deterministic labels for structured sections: SWOT groups, Worst/Base/Best scenarios, metric names, source fields, and recommendation fields.",
    "Keep the report ordered as an investor business plan: decision, pain, product, customer, market, competition, model, sizing, strategy, economics, risks, execution, sources.",
  ];
}
