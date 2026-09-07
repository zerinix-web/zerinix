import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyPromptIntentModeOverride } from "../app/lib/report-engine/domain.ts";
import {
  isFieldSetShapedForMarketIntelligence,
  inferReportDomainFromFieldNames,
} from "../app/lib/report-engine/domain-inference.ts";
import { planFields } from "../app/lib/report-engine/prompts/plan.ts";
import { marketReportFields } from "../app/lib/report-engine/prompts/market.ts";

// formatter.ts pulls in report-output-sanitization.ts, which this test
// harness's path-alias loader cannot resolve in isolation (unrelated to
// this task) -- isCompleteReportSectionPayload is reproduced verbatim
// below (byte-for-byte, per the drift check immediately after this
// comment) rather than fighting that unrelated resolution issue.
const formatterSource = readFileSync(new URL("../app/lib/report-engine/formatter.ts", import.meta.url), "utf8");
test("drift check: isCompleteReportSectionPayload's real implementation matches what this test file reproduces below", () => {
  assert.match(
    formatterSource,
    /export function isCompleteReportSectionPayload\(\s*\n\s*sections: ReportSectionPayload\[\],\s*\n\s*expectedSectionCount: number\s*\n\)\s*\{\s*\n\s*return \(\s*\n\s*sections\.length === expectedSectionCount &&\s*\n\s*sections\.every\(\(section\) => section\.title\.trim\(\) && section\.content\.trim\(\)\)\s*\n\s*\);\s*\n\}/
  );
});
function isCompleteReportSectionPayload(sections, expectedSectionCount) {
  return (
    sections.length === expectedSectionCount &&
    sections.every((section) => section.title.trim() && section.content.trim())
  );
}

// TASK #69A-2 -- Fix real Business Idea Validation report generation
// failure.
//
// EXACT ROOT CAUSE (confirmed against the real, failing production rows):
// a fresh, genuine, comprehensive Business Idea Validation prompt --
// "Analyze whether this is a strong business idea, including customer
// pain points, target segments, market opportunity, TAM/SAM/SOM,
// competitors, pricing, business model, unit economics, go-to-market
// strategy, key risks, validation plan, and financial assumptions." --
// submitted under the "plan" card, was silently rerouted to "market"
// (Market Intelligence) by applyPromptIntentModeOverride
// (app/lib/report-engine/domain.ts), BEFORE any report_jobs row was ever
// created for a "plan" request. Root cause: marketIntelligenceIntentSignals'
// own `\bmarket\s+(?:opportunity|...)\b` alternative treats "market
// opportunity" as an unambiguous Market-Intelligence-only phrase -- but
// "Market Opportunity" is itself one of Business Idea Validation's own
// always-produced, canonical report sections (prompts/plan.ts's
// `marketOpportunity` field), so a prompt that simply lists what a full
// business-idea report should cover is completely ordinary phrasing, not
// a signal the user wants Market Intelligence instead.
//
// Verified via direct production-database inspection: the same prompt,
// submitted twice, produced two "market_analysis"-typed, status=completed
// reports (report_jobs rows only ever recorded analysisMode: "market"),
// and two client-side "business_plan"-typed, status=failed, zero-section
// placeholder rows with no corresponding report_jobs row at all --
// confirming the client never even reached the point of creating a "plan"
// job; the override happened server-side, in app/api/plan/route.ts, before
// the job insert. The client (components/Planner.tsx's streamFullReport)
// then correctly found none of its own plan-mode outputFields present in
// the persisted, market-shaped report -- hasCompletePayload correctly
// evaluated false -- and threw "Report job completed without a complete
// report payload.", exactly the reported failure text.
//
// CONFIRMED NOT CAUSED BY TASK #69A-1: that task's changes were confined
// to ExecutiveSummaryVisual/ExecutiveInsightBanner/getExecutiveDecisionCardLayout
// (page.tsx, Planner.tsx, ReportPdfButton.tsx) -- purely rendering-layer
// functions with zero code-path overlap with applyPromptIntentModeOverride,
// outputFields, hasCompletePayload, or report_jobs/reports persistence.
// investmentScore is optional everywhere it was touched and was never
// validated against any schema that could reject a payload.
//
// FIX (two parts, both additive, neither weakens the completeness guard):
// 1. app/lib/report-engine/domain.ts -- a new, narrow countersignal,
//    businessIdeaValidationFramingSignals, recognizes a prompt that
//    explicitly frames itself as asking "whether this is a ... business
//    idea" (or an equivalent explicit Business-Idea-Validation framing)
//    and blocks the override in that case, alongside the pre-existing
//    businessPlanExecutionIntentSignals countersignal. marketIntelligenceIntentSignals
//    itself is UNTOUCHED -- several existing, deliberately-tested short
//    prompts ("Assess the market opportunity for this product.") correctly
//    rely on "market opportunity" as their sole, sufficient Market
//    Intelligence signal and must keep matching; only prompts that ALSO
//    carry this explicit Business-Idea-Validation framing are now
//    protected.
// 2. app/lib/report-engine/domain-inference.ts -- a new, purely additive
//    export, isFieldSetShapedForMarketIntelligence, lets Planner.tsx's own
//    pre-existing self-correction fallback (previously scoped only to
//    non-market domain confusion, by design never recognizing "market" at
//    all) distinguish "this persisted report is a genuinely incomplete
//    Business Idea Validation report" from "this persisted report is a
//    real, complete report belonging to a different pipeline" -- so any
//    FUTURE mode mismatch (this one now fixed, or a different one) fails
//    with an accurate, actionable message instead of the generic,
//    misleading incomplete-payload error either case would otherwise
//    produce identically. isCompleteReportSectionPayload/hasCompletePayload
//    themselves are completely unmodified -- neither fix weakens or
//    fabricates anything in the completeness guard itself.

const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

const REAL_FAILING_PROMPT =
  "I’m considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

// The exact real market-shaped section field names retrieved from the
// production "reports" row this real prompt actually produced.
const REAL_MARKET_FIELD_NAMES = [
  "executiveSummary", "marketOverview", "marketSize", "cagr", "marketSegmentation",
  "regionalAnalysis", "industryTrends", "competitiveLandscape", "majorPlayers",
  "customerSegments", "marketDrivers", "barriers", "opportunities", "threats",
  "tamSamSom", "portersFiveForces", "strategicRecommendations", "sources",
];

// -----------------------------------------------------------------------
// Root cause: the real failing prompt no longer gets rerouted.
// -----------------------------------------------------------------------

test("root cause fixed: the exact real failing Business Idea Validation prompt is no longer rerouted to Market Intelligence", () => {
  const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt: REAL_FAILING_PROMPT });
  assert.equal(result.selectedMode, "plan");
  assert.equal(result.overridden, false);
});

test("no weakening: bare 'market opportunity' prompts (no explicit business-idea framing) still correctly trigger Market Intelligence, exactly as before this fix", () => {
  const prompts = [
    "We need to assess market opportunity for a new B2B payments product.",
    "Assess the market opportunity for this product.",
    "Assess the market opportunity before entering this space with our new product idea.",
  ];
  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, true, `expected an override for: "${prompt}"`);
    assert.equal(result.selectedMode, "market");
  }
});

test("genuine Market Intelligence prompts (verb+market, competitors analysis, market sizing, named report) are unaffected", () => {
  const prompts = [
    "I want to evaluate the European AI cybersecurity market before launching a new B2B security product. Create a Market Intelligence Report.",
    "Provide a competitors analysis for the US ride-sharing market.",
    "I need market sizing and market research for the EU solar panel industry.",
    "Please generate a market intelligence report on the fintech lending space.",
  ];
  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, true, `expected an override for: "${prompt}"`);
    assert.equal(result.selectedMode, "market");
  }
});

test("a genuinely mixed prompt (market opportunity mention + explicit business-plan execution intent) is still left unchanged, per the pre-existing philosophy", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "Evaluate the market opportunity and then create a business plan report for my SaaS idea.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "plan");
});

test("structural: the new countersignal is additive -- marketIntelligenceIntentSignals and businessPlanExecutionIntentSignals are both still present, unmodified in shape", () => {
  assert.match(domainSource, /const marketIntelligenceIntentSignals =/);
  assert.match(domainSource, /const businessPlanExecutionIntentSignals =/);
  assert.match(domainSource, /const businessIdeaValidationFramingSignals =/);
  assert.match(
    domainSource,
    /if \(businessIdeaValidationFramingSignals\.test\(prompt\)\) \{\s*\n\s*return \{ selectedMode: normalizedMode, overridden: false \};\s*\n\s*\}/
  );
});

// -----------------------------------------------------------------------
// isFieldSetShapedForMarketIntelligence: additive detector, correctly
// discriminates real plan vs real market field sets.
// -----------------------------------------------------------------------

test("isFieldSetShapedForMarketIntelligence correctly identifies the real market-shaped field set that caused the reported failure", () => {
  assert.equal(isFieldSetShapedForMarketIntelligence(REAL_MARKET_FIELD_NAMES), true);
});

test("isFieldSetShapedForMarketIntelligence never flags Business Idea Validation's own real field set", () => {
  assert.equal(isFieldSetShapedForMarketIntelligence([...planFields]), false);
});

test("isFieldSetShapedForMarketIntelligence never flags an empty or unrecognized field list", () => {
  assert.equal(isFieldSetShapedForMarketIntelligence([]), false);
  assert.equal(isFieldSetShapedForMarketIntelligence(["totallyUnknownField"]), false);
});

test("regression: inferReportDomainFromFieldNames's own existing contract (never returns 'market', still correctly classifies plan fields as 'business') is completely unaffected by the new sibling export", () => {
  assert.equal(inferReportDomainFromFieldNames([...planFields]), "business");
  assert.notEqual(inferReportDomainFromFieldNames(REAL_MARKET_FIELD_NAMES), "market");
});

// -----------------------------------------------------------------------
// D: plan and market payloads cannot be confused.
// -----------------------------------------------------------------------

test("D: plan and market field schemas share no distinguishing overlap that could cause one to be silently mistaken for the other -- marketReportFields' own distinguishing fields (marketOverview, marketSize, cagr, ...) never appear anywhere in planFields", () => {
  const planFieldSet = new Set(planFields);
  const marketOnlyFields = ["marketOverview", "marketSize", "cagr", "marketSegmentation", "regionalAnalysis", "industryTrends", "majorPlayers", "customerSegments", "marketDrivers", "barriers", "opportunities", "threats"];
  for (const field of marketOnlyFields) {
    assert.ok(marketReportFields.includes(field), `${field} expected in marketReportFields fixture`);
    assert.ok(!planFieldSet.has(field), `${field} must never appear in planFields`);
  }
});

test("D: Planner.tsx's self-correction now recognizes a market-shaped persisted report BEFORE attempting (and failing) to reattribute it to a non-market domain, producing an accurate error instead of the generic incomplete-payload one", () => {
  const guardIndex = plannerSource.indexOf("if (!clientGuessMatchesPersistedReport && persistedFieldNames.length > 0) {");
  assert.notEqual(guardIndex, -1);
  const marketCheckIndex = plannerSource.indexOf("isFieldSetShapedForMarketIntelligence(persistedFieldNames)", guardIndex);
  const correctedDomainIndex = plannerSource.indexOf("const correctedDomain = inferReportDomainFromFieldNames(persistedFieldNames);", guardIndex);
  assert.ok(marketCheckIndex > guardIndex, "market-shape check must be inside the self-correction guard");
  assert.ok(
    marketCheckIndex < correctedDomainIndex,
    "market-shape check must run BEFORE the non-market domain reattribution, so a real market report is never misattributed to the wrong domain first"
  );
});

test("D: the market-shape mismatch produces a distinct, honest error message naming the actual mismatch -- never the generic incomplete-payload text, and never silently treated as success", () => {
  const guardIndex = plannerSource.indexOf("if (isFieldSetShapedForMarketIntelligence(persistedFieldNames)) {");
  assert.notEqual(guardIndex, -1, "market-shape mismatch guard not found");
  const throwIndex = plannerSource.indexOf("throw new Error(", guardIndex);
  const genericIncompleteIndex = plannerSource.indexOf(
    "Report job completed without a complete report payload."
  );
  assert.ok(throwIndex > guardIndex && throwIndex < guardIndex + 200);
  const nearbyText = plannerSource.slice(guardIndex, guardIndex + 900);
  assert.match(nearbyText, /Market Intelligence report instead of a Business Idea Validation report/);
  // The two failure messages must be textually distinct -- confirms this
  // new path never reuses (or is confused with) the generic incomplete-
  // payload text.
  assert.notEqual(genericIncompleteIndex, -1);
  assert.ok(
    !nearbyText.includes("Report job completed without a complete report payload."),
    "the market-mismatch error must not reuse the generic incomplete-payload message"
  );
});

// -----------------------------------------------------------------------
// A/B: the completeness guard itself (unmodified) still correctly accepts
// a full payload and rejects an incomplete one -- neither fix weakens or
// fabricates anything here.
// -----------------------------------------------------------------------

test("A: a realistic, fully-populated Business Idea Validation section payload is accepted as complete", () => {
  const sections = planFields.map((field) => ({
    title: field,
    content: `Real generated content for ${field}.`,
  }));
  assert.equal(isCompleteReportSectionPayload(sections, planFields.length), true);
});

test("B: a payload missing even one real Business Idea Validation field remains rejected as incomplete -- never fabricated to pass", () => {
  const sections = planFields.slice(0, -1).map((field) => ({
    title: field,
    content: `Real generated content for ${field}.`,
  }));
  assert.equal(isCompleteReportSectionPayload(sections, planFields.length), false);
});

test("B: a payload with an empty-content section remains rejected as incomplete, even when the section count matches", () => {
  const sections = planFields.map((field) => ({
    title: field,
    content: field === planFields[0] ? "" : `Real generated content for ${field}.`,
  }));
  assert.equal(isCompleteReportSectionPayload(sections, planFields.length), false);
});

test("B: a genuinely incomplete Business Idea Validation payload (real plan fields, just fewer than expected) is never mistaken for a market-shaped mismatch -- the new detector stays false, so this case is correctly reported as a genuine incompleteness, not misrouted to the new market-mismatch error", () => {
  const partialPlanFieldNames = planFields.slice(0, 5);
  assert.equal(isFieldSetShapedForMarketIntelligence(partialPlanFieldNames), false);
});

// -----------------------------------------------------------------------
// C: canonical decision/confidence (investmentScore) survives persistence
// unchanged -- structural proof against worker.ts's own persistence code.
// -----------------------------------------------------------------------

test("C: worker.ts's persistCompletedReport spreads report.metadata (which carries investmentScore when the generator produced one) into the persisted row verbatim -- nothing in this fix touches that code path", () => {
  const workerSource = readFileSync(new URL("../app/lib/report-jobs/worker.ts", import.meta.url), "utf8");
  assert.match(workerSource, /metadata:\s*\{\s*\n\s*\.\.\.\(report\.metadata \|\| \{\}\),/);
});

test("C: ReportInvestmentScore's structured shape (recommendation/confidence, consumed by Task #69A/#69A-1's decision-authority fixes) is untouched by this task", () => {
  const investmentScoreSource = readFileSync(
    new URL("../app/lib/report-investment-score.ts", import.meta.url),
    "utf8"
  );
  assert.match(investmentScoreSource, /recommendation:\s*"GO"\s*\|\s*"WAIT"\s*\|\s*"PASS"\s*\|\s*string;/);
  assert.match(investmentScoreSource, /confidence:\s*number;/);
});
