type ReportQualityKind = "business_plan" | "market_analysis";
export type ExecutivePresentationKind =
  | ReportQualityKind
  | "real_estate"
  | "specialized_analysis";

const majorSectionsByKind: Record<ExecutivePresentationKind, string> = {
  business_plan:
    "Problem, Solution, Market Opportunity, Competitor Landscape, Business Model, Pricing Strategy, Go-to-Market, Financial Dashboard, and Risks",
  market_analysis:
    "Market Overview, Market Size, Industry Trends, Competitive Landscape, Opportunities, Threats, Porter's Five Forces, and Strategic Recommendations",
  real_estate:
    "Ownership and Title, Zoning and Land Use, Comparable Market Evidence, Valuation, Legal and Environmental Risks, Development Potential, and Scenarios",
  specialized_analysis:
    "Domain Findings, Regulatory and Compliance Findings, Financial Implications, Operational Implications, Risk Analysis, and Scenario Analysis",
};

/**
 * Presentation-only contract. All blocks are embedded inside existing string
 * fields, so report schemas, stream events, API contracts, and PDF inputs stay
 * unchanged.
 *
 * Deliberately minimal: the report's single Executive Decision layer (the
 * first field -- Final Decision, Confidence, Why, Biggest Risks, Biggest
 * Opportunity, First 90-Day Action Plan) is the ONLY place a decision,
 * confidence score, or action list belongs. This used to also mandate an
 * Executive Scorecard, a 4-part "AI Executive Insight" block plus a
 * Confidence line plus a 3-5 item Next Actions list after EVERY major
 * section, and a second "CEO Summary" block restating Biggest Opportunity/
 * Biggest Risk/First 90 Days/Final Recommendation at the end of the report --
 * three more places stating the same decision, in three more vocabularies,
 * padding every section with a repeated structural scaffold regardless of
 * whether that section had anything new to decide. A section earns the
 * right to a one-line implication by actually changing the decision, not by
 * existing.
 */
export function buildExecutivePresentationDirectives(
  kind: ExecutivePresentationKind
) {
  return [
    `Treat these as the sections that matter most for the decision: ${majorSectionsByKind[kind]}. End each with one compact sentence explaining why this section moves the decision -- no heading, no Insight block, no Confidence line, and no Next Actions list. Confidence and next actions live only in the report's single Executive Decision layer.`,
    "Reserve [Verified]/[Estimated]/[Assumption] labels for the handful of numbers that actually drive the decision (market size, investment ask, ROI, timeline). Do not label ordinary prose, and never repeat the same label pattern on every line.",
  ];
}

// Genuinely shared: formatting, tone, structural/output-consistency rules
// that name no report-specific concept (no founder, no CEO, no Roadmap, no
// investment terminology). Safe for any report type to reuse.
const universalDecisionQualityDirectives = [
  "Before drafting, silently create one Decision Spine with exactly five elements: the specific thesis, decisive evidence gap, primary risk mechanism, next concrete action, and a milestone sequence where each step depends on proof from the one before it. Keep wording internal; use the facts consistently without copying sentences between sections.",
  "Every recommendation or action must name a specific object such as the actual buyer, workflow, channel, pricing unit, geography, regulatory constraint, operating asset, or financial threshold. Never write generic advice when the submitted context supports a more precise action.",
  "Open the executive section with the decision or verdict in the first sentence, then explain only the highest-leverage evidence behind it.",
  "Use claim -> reason -> implication for major analytical statements; avoid descriptive paragraphs that do not change the decision.",
  "Use stable markdown: short paragraphs, compact bullets, bold metric labels where helpful, and no duplicated section headings inside section content.",
  "SWOT must render as four clearly labeled groups: Strengths, Weaknesses, Opportunities, and Threats. Each group needs distinct, non-empty, decision-relevant bullets.",
  "Separate opportunities from risks: opportunities are openings to exploit; risks are obstacles with a leading indicator and mitigation path.",
  "Recommendations must be action-oriented: decision, conviction/confidence, key reason, main risk, and next concrete action.",
  "Every major analytical section must include a compact executive implication line that explains why the section changes the decision. Do not add a heading. This must be specific, not a generic summary.",
  "Competitor or comparable analysis must name only real commercial vendors, operators, or service providers available from the input/model context -- never an encyclopedia entry, video platform, blog, forum, or generic reference/news article; those are sources, not competitors. For each important competitor, include pricing, target segment, scale, strengths, weaknesses, positioning, and how the analyzed subject can outperform when available; omit unknown fields instead of inventing them. If verified competitors are insufficient, say so plainly instead of filling the gap with an irrelevant entity.",
  "Risk analysis must use a professional risk matrix: probability, impact, severity, mitigation, and early warning signal for each material risk.",
  "Keep SWOT, Porter, and Risks mutually exclusive: SWOT inventories internal capabilities and external openings; Porter explains structural industry economics; Risks describes subject-specific failure modes with indicators and mitigations. Never reuse the same sentence, example, or recommendation across them.",
  "Use natural analytical continuity through dependencies between sections, not filler transitions such as 'as mentioned above', 'building on the previous section', or generic concluding sentences.",
  "Never reuse a complete narrative paragraph in another section. If the same fact is required for consistency, state only the new implication owned by the current section.",
  // Confirmed live: a prompt naming 5 explicit countries had only 2-3 of
  // them survive into the generated Market Analysis/Executive Summary
  // prose, the rest silently dropped as the model paraphrased for brevity.
  // Every explicit fact the user supplied (country, industry, customer
  // segment, technology, market) is itself evidence, not a word choice --
  // dropping one is a silent loss of user-provided information, not a
  // stylistic simplification.
  "Every specific entity the user's own request names explicitly -- a country, industry, customer segment, technology, or market -- must appear consistently in every section where it is relevant (e.g. all named countries appear in market sizing, expansion, and financial sections). Never silently drop one for brevity; if a section legitimately excludes one, state the reason in one clause rather than omitting it silently.",
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
  "Maintain executive continuity without repetition: Executive Summary states the verdict, the evidence gap, and the first 90 days of action; the Roadmap sequences what must be proven next beyond that window instead of restating the rationale.",
  "Treat the business model, ICP, pricing, unit economics, roadmap, and recommendation as one linked operating plan.",
  "Executive Summary is the report's only decision layer: state the Final Decision, Confidence, Why, Biggest Risks, Biggest Opportunity, and First 90-Day Action Plan there and nowhere else. Do not let it repeat Business Model, SWOT, Roadmap, or Financial Dashboard prose.",
  // CRITICAL SCORING ENGINE FIX -- company lifecycle awareness. Confirmed
  // live: a company reporting real paying customers and millions in ARR
  // still received validation-stage language ("validate willingness to
  // pay", "get first customers") throughout the report. The detected
  // lifecycle stage is stated explicitly in the financial-model context
  // block above (Data-Driven Financial Analysis Engine); this directive
  // makes following it mandatory rather than optional.
  "Match every recommendation to the company's detected lifecycle stage (stated in the financial model context as 'Company lifecycle stage'). A company with verified paying customers, MRR, or ARR must never be told to validate demand, validate willingness to pay, find/get its first customers, or prove first paid activation -- that evidence already exists. For revenue/growth-stage companies, phrase recommendations as improve retention, expand enterprise accounts, optimize CAC efficiency, scale distribution, and protect margins. Reserve validation-focused language (customer interviews, proving demand, first paid activation, finding first customers) for companies with no reported revenue.",
];

// Business Idea Validation-only, enforced at the type level: market.ts and
// domain-analysis.ts build their own report-specific directives instead of
// sharing this business-plan-native decision-support contract.
export function buildDecisionSupportDirectives(kind: "business_plan") {
  void kind;
  return [...universalDecisionQualityDirectives, ...businessPlanDecisionSupportDirectives];
}

// The generic half of the directive set above (Decision Spine, claim ->
// reason -> implication, SWOT/risk-matrix structure, narrative continuity
// without filler transitions, never reusing a paragraph across sections)
// names no founder/CEO/Roadmap-specific concept, so it was always safe for
// market.ts and domain-analysis.ts to reuse -- it just had no export of
// its own before this, so those two prompt files never got the same
// anti-filler/anti-repetition scaffolding business_plan reports have had.
export function buildUniversalDecisionQualityDirectives() {
  return [...universalDecisionQualityDirectives];
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
    "Every section must exist to answer one specific executive question implied by its label (e.g. a market-attractiveness section answers 'Is this market attractive?'; a risk section answers 'What can make this fail?'; a financial section answers 'How much capital is required and when does it pay back?'). Open the section with that answer in the first sentence. If a section would only restate facts without answering its own question, compress it to the minimum that does. If a section cannot answer a real business question, it should not exist.",
    "Do not enumerate raw source URLs, domains, or evidence-registry IDs inside any analytical section. Reference evidence by category and confidence only (e.g. 'confirmed by two independent government filings'); the sources field is the only place a citation list belongs, and even there it must stay a categorized summary, not a page of links.",
    "Every paragraph must change what the reader would decide or how confident they should be. Delete a paragraph instead of writing it if it only restates the section title, defines a common term, or repeats a fact already established elsewhere in the report.",
    "Whenever a section states financial figures, lead with the compact figures themselves (Investment, Revenue, Costs, Gross Margin, ROI, Payback, and Worst/Expected/Best Case) before any prose explanation of how they were derived.",
    "Only one field in the entire report states a decision, a confidence score, or an action plan -- the Executive Decision layer at the start of the report. Every other section supports that decision with evidence and analysis; none of them restate the verdict, the confidence percentage, or the action list in any form. Zero internal contradiction is mandatory: if the verdict is to avoid or walk away, no other section may recommend piloting, scaling, entering, or proceeding -- rewrite or drop any sentence that would.",
    "Write the way a senior partner opens a Monday deal-review discussion: state the call, defend it in the strongest few moves, and name what would change your mind. Never write like an AI summarizing its own research process.",
  ];
}

// Business Idea Validation-only, enforced at the type level (see
// buildDecisionSupportDirectives above for the same rationale): this
// directive set names Roadmap unconditionally, a Business Plan-specific
// concept. market.ts and domain-analysis.ts build their own full-report
// structure directives.
export function buildFullReportStructureDirectives(kind: "business_plan") {
  void kind;
  return [
    "Return JSON keys in the exact order listed above and keep every value compatible with the existing report renderer.",
    "Every section must add one unique business insight; if a point was made earlier, only reference the implication instead of repeating the paragraph.",
    "Silently maintain a paragraph ledger while drafting. Before returning JSON, remove any sentence or paragraph that merely restates another section without adding a section-owned implication.",
    "A recommendation is specific only when it names the analyzed business context and defines who acts, what is tested or changed, and which proof point determines the next decision.",
    "Executive Summary and Roadmap must share one decision, one primary risk, and one next action, but each must express only its own layer: Executive Summary owns the verdict, the confidence, and the first 90 days; Roadmap sequences what must be proven next beyond that window without restating the rationale.",
    "SWOT, Porter, Financials, Risks, and Roadmap must not share prose. Financial sections own numbers; Risks owns failure mechanisms; Roadmap owns timing and what must be proven at each step beyond the first 90 days. Executive Summary alone owns the capital decision.",
    "Prefer deterministic labels for structured sections: SWOT groups, Worst/Base/Best scenarios, metric names, source fields, and recommendation fields.",
    "Keep the report ordered as an investor business plan: decision, pain, product, customer, market, competition, model, sizing, strategy, economics, risks, execution, sources.",
  ];
}
