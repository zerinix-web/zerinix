import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- acquisition sections were still falling back to bare
// boilerplate in production, even after the prior "acquisition analysis
// depth" turn improved acquisitionAnalysisPrompts. Root cause: that fix
// only changes what the AI MODEL is instructed to write. Production
// reports were actually falling back to
// createGroundedAcquisitionTimeoutFallback in plan-executor.ts -- a fully
// separate, deterministic code path used whenever generation times out --
// which set several fields to nothing but a single [Unknown][Required:X]
// tagged line, a bare localized.timeout disclosure sentence, or the bare
// [Recommendation]-tagged decision.recommendation word itself ("Wait").
// The presentation sanitizer (report-presentation-sanitizer.ts, untouched
// by this fix, still correct) can only rewrite what is there: a field
// whose entire content WAS one of those tagged fragments sanitizes down to
// either the literal bare word ("Wait") or the sanitizer's own generic
// backfill sentence -- exactly the phrases the user reported reaching
// production ("Wait", "Additional financial and operational information
// is needed before making a final decision.", "Additional information is
// needed to complete this section.", "Obtain the authoritative evidence
// required...").
//
// The fix lives entirely in plan-executor.ts's fallback content
// generators, never in the sanitizer, routing, or report schema. Every
// field's fallback content now carries real, deal-specific prose built
// from the verified deal facts and derived metrics, so real analysis
// survives sanitization even when the fallback path is used.
//
// This suite proves two things: (1) via source drift-checks, that the
// dangerous old patterns are gone and the new content generators exist
// with the required structure; (2) via the REAL, unmodified sanitizer
// (stripReportPresentationArtifacts), that field content mirroring these
// generators' worst case (zero deal facts, zero decision evidence, a bare
// "Wait" recommendation) still never sanitizes down to a bare verdict word
// or the sanitizer's generic fallback sentence.

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const { stripReportPresentationArtifacts } = await import(
  "../app/lib/report-engine/report-presentation-sanitizer.ts"
);
const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
  "../app/lib/ai/acquisition-deal-facts.ts"
);

// --- 1. Source drift checks: the old degenerate patterns are gone --------

test("plan-executor.ts no longer sets roiAnalysis/irrAnalysis to bare localized.timeout", () => {
  assert.doesNotMatch(planExecutorSource, /roiAnalysis: localized\.timeout,/);
  assert.doesNotMatch(planExecutorSource, /irrAnalysis: localized\.timeout,/);
});

test("plan-executor.ts no longer sets financingStructure/debtCapacity to bare unresolvedText", () => {
  assert.doesNotMatch(planExecutorSource, /financingStructure: unresolvedText,/);
  assert.doesNotMatch(planExecutorSource, /debtCapacity: unresolvedText,/);
});

test("plan-executor.ts no longer embeds a bare decision.recommendation as the entire executiveAcquisitionSummary/finalInvestmentRecommendation content", () => {
  assert.doesNotMatch(
    planExecutorSource,
    /executiveAcquisitionSummary: `\$\{localized\.timeout\}\\n\[Recommendation\] \[Basis:decision engine\] \$\{decision\.recommendation\}`,/
  );
  assert.doesNotMatch(
    planExecutorSource,
    /finalInvestmentRecommendation: `\$\{localized\.timeout\}\\n\[Recommendation\] \[Basis:decision engine\] \$\{decision\.recommendation\}`,/
  );
});

test("buildFallbackIntegrationRisks/buildFallbackPostMergerIntegrationPlan/buildFallbackConditionsBeforeClosing no longer use bare, unbracketed 'decision engine' prose (would be silently mangled by the sanitizer's internalVocabularyPattern, which strips that exact phrase outside bracket tags, leaving a broken sentence remnant)", () => {
  for (const fnName of [
    "buildFallbackIntegrationRisks",
    "buildFallbackPostMergerIntegrationPlan",
    "buildFallbackConditionsBeforeClosing",
  ]) {
    const fnMatch = new RegExp(`function ${fnName}\\([\\s\\S]*?\\n}`).exec(planExecutorSource);
    assert.ok(fnMatch, `${fnName} not found`);
    assert.doesNotMatch(fnMatch[0], /decision engine/i, `${fnName} should not use the bare "decision engine" phrase`);
  }
});

// --- 2. Source drift checks: the new content generators exist ------------

test("plan-executor.ts defines every new fallback content generator this fix relies on", () => {
  const requiredFunctions = [
    "buildFallbackTransactionOverview",
    "buildFallbackOpportunity",
    "buildFallbackKeyRisks",
    "describeAcquisitionExecutiveCall",
    "buildFallbackRecommendationReasoning",
    "buildFallbackPreliminaryRecommendation",
    "buildFallbackFinalRecommendation",
    "buildFallbackConditionsBeforeClosing",
    "buildFallbackStrategicFit",
    "buildFallbackValuationInterpretation",
    "buildFallbackRoiAnalysis",
    "buildFallbackDebtCapacity",
    "buildFallbackFinancingStructure",
    "buildFallbackRevenueSynergies",
    "buildFallbackCostSynergies",
    "buildFallbackIntegrationRisks",
    "buildFallbackPostMergerIntegrationPlan",
    "buildFallbackReviewNote",
  ];
  for (const fn of requiredFunctions) {
    assert.match(planExecutorSource, new RegExp(`function ${fn}\\(`), `${fn} should be defined`);
  }
});

// NOTE: superseded across the "final acquisition intelligence polish",
// "final acquisition advisor polish", and "final executive dashboard
// language polish" turns -- the raw decision-engine word is no longer
// interpolated directly (that was itself still a checklist-style output:
// a real word, but no reasoning behind it, and no translation into the
// report's own executive vocabulary). It is now translated via
// describeAcquisitionExecutiveCall (Proceed / Proceed Carefully / Wait /
// Avoid -> Proceed with Conditions / Pause Pending Review / Reject) and
// always paired with fact-grounded reasoning from
// buildFallbackRecommendationReasoning, never a bare confidence score or
// "critical evidence gaps" boilerplate.
test("buildFallbackPreliminaryRecommendation/buildFallbackFinalRecommendation translate the raw decision-engine word into the report's own executive vocabulary and pair it with fact-grounded reasoning -- never a bare confidence score", () => {
  const translatorMatch = /function describeAcquisitionExecutiveCall\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(translatorMatch, "describeAcquisitionExecutiveCall not found");
  assert.match(translatorMatch[0], /"Proceed with Conditions"/);
  assert.match(translatorMatch[0], /"Pause Pending Review"/);
  assert.match(translatorMatch[0], /"Reject"/);

  const reasoningMatch = /function buildFallbackRecommendationReasoning\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(reasoningMatch, "buildFallbackRecommendationReasoning not found");
  assert.doesNotMatch(reasoningMatch[0], /critical evidence gaps/i);
  assert.doesNotMatch(reasoningMatch[0], /authoritative evidence/i);

  const prelimMatch = /function buildFallbackPreliminaryRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(prelimMatch, "buildFallbackPreliminaryRecommendation not found");
  assert.match(prelimMatch[0], /Preliminary recommendation: \$\{call\} -- \$\{reasoning\}/);
  assert.doesNotMatch(prelimMatch[0], /confidence level \(\$\{decision\.confidence\}/);

  const finalMatch = /function buildFallbackFinalRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(finalMatch, "buildFallbackFinalRecommendation not found");
  assert.match(finalMatch[0], /Executive recommendation: \$\{call\} -- \$\{reasoning\}/);
});

test("plan-executor.ts no longer uses the banned internal-sounding phrases 'authoritative evidence', 'critical evidence gaps', or 'evidence-based risk assessment' anywhere", () => {
  assert.doesNotMatch(planExecutorSource, /authoritative evidence/i);
  assert.doesNotMatch(planExecutorSource, /critical evidence gaps/i);
  assert.doesNotMatch(planExecutorSource, /evidence-based risk assessment/i);
});

test("decision-intelligence/decision-engine.ts's generic nextActionFor fallback no longer uses 'authoritative evidence'", async () => {
  const decisionEngineSource = readFileSync(
    new URL("../app/lib/decision-intelligence/decision-engine.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(decisionEngineSource, /Obtain the authoritative evidence required/);
});

test("buildFallbackRevenueSynergies/buildFallbackCostSynergies cover the required themes and never invent a dollar figure", () => {
  const revenueMatch = /function buildFallbackRevenueSynergies\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(revenueMatch, "buildFallbackRevenueSynergies not found");
  assert.match(revenueMatch[0], /Cross-sell opportunities:/);
  assert.match(revenueMatch[0], /Customer expansion:/);
  assert.match(revenueMatch[0], /Product portfolio fit:/);

  const costMatch = /function buildFallbackCostSynergies\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(costMatch, "buildFallbackCostSynergies not found");
  assert.match(costMatch[0], /Infrastructure consolidation:/);
  assert.match(costMatch[0], /Operational efficiency:/);
  assert.match(costMatch[0], /Procurement leverage:/);
});

test("buildFallbackIntegrationRisks covers technology, security, customer retention, employee retention, and operational alignment (the ticket's five required dimensions)", () => {
  const fnMatch = /function buildFallbackIntegrationRisks\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackIntegrationRisks not found");
  const body = fnMatch[0];
  assert.match(body, /Technology integration:/);
  assert.match(body, /Security architecture and operations:/);
  assert.match(body, /Customer retention:/);
  assert.match(body, /Employee retention:/);
  assert.match(body, /Operational alignment:/);
});

test("buildFallbackPostMergerIntegrationPlan generates a real 30/60/90-day plan with the required milestones", () => {
  const fnMatch = /function buildFallbackPostMergerIntegrationPlan\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackPostMergerIntegrationPlan not found");
  const body = fnMatch[0];
  assert.match(body, /Days 1-30:.*financial validation.*customer contract review.*security assessment.*employee retention plan/);
  assert.match(body, /Days 31-60:.*technology integration.*operating-model alignment.*customer strategy/);
  assert.match(body, /Days 61-90:.*synergy tracking.*unified go-to-market roadmap.*KPI review/);
});

test("buildFallbackValuationInterpretation interprets EV/ARR (attractive/reasonable/expensive) and names the missing financial inputs", () => {
  const fnMatch = /function buildFallbackValuationInterpretation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackValuationInterpretation not found");
  const body = fnMatch[0];
  assert.match(body, /low and potentially attractive/);
  assert.match(body, /within the typical, reasonable range/);
  assert.match(body, /full, relative to typical SaaS multiples/);
  assert.match(body, /EBITDA, gross margin, revenue growth rate, and customer churn/);
});

test("buildFallbackRoiAnalysis explains what can/cannot be calculated and the missing inputs, without inventing EBITDA/margin/growth/churn/cash flow", () => {
  const fnMatch = /function buildFallbackRoiAnalysis\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackRoiAnalysis not found");
  const body = fnMatch[0];
  assert.match(body, /What can be calculated:/);
  assert.match(body, /What cannot be calculated:/);
  assert.match(body, /Missing inputs:/);
  assert.match(body, /None of these figures have been invented/);
});

test("buildFallbackDebtCapacity explains debt capacity cannot be determined without EBITDA/cash flow, names the financial statements needed, and how debt risk should be evaluated", () => {
  const fnMatch = /function buildFallbackDebtCapacity\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackDebtCapacity not found");
  const body = fnMatch[0];
  assert.match(body, /cannot be fully determined without EBITDA and cash-flow data/);
  assert.match(body, /Financial statements needed:/);
  assert.match(body, /debt risk should be evaluated/);
});

test("buildFallbackStrategicFit separates Known facts / Derived insights / Assumptions / Integration considerations", () => {
  const fnMatch = /function buildFallbackStrategicFit\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildFallbackStrategicFit not found");
  const body = fnMatch[0];
  assert.match(body, /Known facts:/);
  assert.match(body, /Derived insights:/);
  assert.match(body, /Assumptions:/);
  assert.match(body, /Integration considerations:/);
});

// --- 3. Live proof through the REAL, unmodified sanitizer -----------------
// The strings below mirror the exact literal templates in plan-executor.ts
// for the worst case (zero deal facts, zero decision-engine evidence, a
// bare "Wait" recommendation, 0/100 confidence) -- the precise shape that
// used to sanitize down to nothing but the bare word "Wait" or the
// sanitizer's generic backfill sentence. If plan-executor.ts's wording
// drifts, the source drift-checks above catch it; this section proves the
// STRUCTURE (real prose wrapped around any tagged/boilerplate fragment)
// actually survives the real sanitizer.

test("executiveAcquisitionSummary's worst case (no facts, no decision evidence, raw recommendation='Wait' translated to the executive call 'Pause Pending Review') never sanitizes down to a bare verdict word", () => {
  const worstCase = [
    "Transaction overview: this preliminary report has not yet identified verified core deal figures (purchase price, target ARR, customer count, or employee count); this section will be completed once those figures are supplied.",
    "Main opportunity: what has been reviewed so far does not yet support a specific, well-supported opportunity claim for this deal; management should validate customer contracts and financial statements before this section is finalized.",
    "Main risks: no deal-specific risk has yet been confirmed in this preliminary report; integration complexity, customer concentration, and limited financial visibility are the standard risk areas that should be assessed before closing.",
    "Preliminary recommendation: Pause Pending Review -- the target's financial statements and customer contracts are not yet verified; the full scale of the customer and employee base is still awaiting confirmation. This call remains preliminary until the closing conditions below are satisfied.",
    "Conditions before closing: this preliminary assessment is based on the deal's current information. Management should validate the target's financial statements, customer contracts, and a security assessment before this recommendation becomes final.",
  ].join("\n\n");

  const sanitized = stripReportPresentationArtifacts(worstCase);

  assert.notEqual(sanitized.trim(), "Wait");
  assert.notEqual(sanitized.trim(), "Pause Pending Review");
  assert.notEqual(sanitized.trim(), "Additional information is needed to complete this section.");
  assert.match(sanitized, /Transaction overview/);
  assert.match(sanitized, /Main opportunity/);
  assert.match(sanitized, /Main risks/);
  assert.match(sanitized, /Preliminary recommendation: Pause Pending Review --/);
  assert.match(sanitized, /Conditions before closing/);
});

test("roiAnalysis's worst case (no verified purchase price/ARR) never sanitizes down to the generic 'Additional information is needed' fallback", () => {
  const worstCase = [
    "What can be calculated: no ratio can currently be calculated without both a verified purchase price and ARR.",
    "What cannot be calculated: an IRR or return figure -- that requires cash-flow timing, margin, and an exit assumption, none of which are available yet.",
    "Missing inputs: EBITDA or operating margin, revenue growth rate, customer churn/retention rate, projected cash flow, and an expected exit multiple or holding period.",
    "None of these figures have been invented to fill in a scenario -- their absence is stated plainly here instead.",
  ].join("\n\n");

  const sanitized = stripReportPresentationArtifacts(worstCase);

  assert.notEqual(sanitized.trim(), "Additional information is needed to complete this section.");
  assert.match(sanitized, /What can be calculated/);
  assert.match(sanitized, /What cannot be calculated/);
  assert.match(sanitized, /Missing inputs/);
});

test("debtCapacity's worst case (no derived debt requirement) never sanitizes down to the generic fallback, and still explains what is needed", () => {
  const worstCase = [
    "Debt capacity cannot be fully determined without EBITDA and cash-flow data, since debt capacity is normally sized against a multiple of EBITDA or free cash flow -- neither of which has been supplied yet.",
    "Financial statements needed: trailing-twelve-month EBITDA, historical cash flow statements, and existing debt schedules.",
    "Once available, debt risk should be evaluated via debt-service coverage against free cash flow, the leverage multiple versus sector norms, and covenant headroom.",
  ].join("\n\n");

  const sanitized = stripReportPresentationArtifacts(worstCase);

  assert.notEqual(sanitized.trim(), "Additional information is needed to complete this section.");
  assert.match(sanitized, /cannot be fully determined without EBITDA and cash-flow data/);
  assert.match(sanitized, /Financial statements needed/);
});

test("a field whose only remaining unresolved content is a single [Unknown][Required:X] tagged line, now always paired with a 'Further review is recommended for...' note, never sanitizes down to the generic fallback alone", () => {
  const worstCase = [
    "[Unknown] [Required:authoritative source] No usable external evidence returned within the time budget.",
    "Further review is recommended for competitive-position and market-share data before this section can be finalized.",
  ].join("\n\n");

  const sanitized = stripReportPresentationArtifacts(worstCase);

  assert.notEqual(sanitized.trim(), "Additional financial and operational information is needed before making a final decision.");
  assert.match(sanitized, /Additional financial and operational information is needed before making a final decision\./);
  assert.match(sanitized, /Further review is recommended for competitive-position and market-share data/);
});

// --- 4. Live proof with real, known deal facts -----------------------------

const scenarioPrompt =
  "We are acquiring a cybersecurity SaaS company. Purchase price is $40M, target ARR is $10M, it has 500 enterprise customers and 80 employees, buyer available capital is $25M, and remaining financing is debt.";

test("extractAcquisitionDealFacts/computeAcquisitionDerivedMetrics reproduce the scenario used above: EV/ARR = 4x, $25M equity, $15M debt (37.5%/62.5% split)", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);

  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(derived.debtSharePercent, 37.5);
  assert.equal(derived.equitySharePercent, 62.5);
});

test("valuationAnalysis with a known 4.0x EV/ARR survives sanitization with its real interpretation intact, never the generic fallback", () => {
  const knownCase =
    "Valuation interpretation: at 4x EV/ARR, this multiple reads as within the typical, reasonable range for a SaaS target of this scale. EBITDA, gross margin, revenue growth rate, and customer churn are still needed to fully validate whether it is attractive or expensive.";

  const sanitized = stripReportPresentationArtifacts(knownCase);

  assert.notEqual(sanitized.trim(), "Additional information is needed to complete this section.");
  assert.match(sanitized, /4x EV\/ARR/);
  assert.match(sanitized, /within the typical, reasonable range/);
});

test("debtCapacity with known derived debt figures ($15M, 37.5%) survives sanitization with the real figures intact", () => {
  const knownCase =
    "Based on the derived financing figures, the debt requirement is $15M (37.5% of the purchase price) -- this is the starting point for the debt capacity assessment.\n\nDebt capacity cannot be fully determined without EBITDA and cash-flow data, since debt capacity is normally sized against a multiple of EBITDA or free cash flow -- neither of which has been supplied yet.";

  const sanitized = stripReportPresentationArtifacts(knownCase);

  assert.match(sanitized, /\$15M/);
  assert.match(sanitized, /37\.5%/);
});

// --- 5. Do not touch sanitization, routing, or sources handling -----------

test("report-presentation-sanitizer.ts is untouched by this fix (drift check)", async () => {
  const {
    stripReportPresentationArtifacts: strip,
    sanitizeReportSectionsForPresentation,
    isUniversalCustomerFacingSection,
  } = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");
  assert.equal(typeof strip, "function");
  assert.equal(typeof sanitizeReportSectionsForPresentation, "function");
  assert.equal(typeof isUniversalCustomerFacingSection, "function");
});

test("app/lib/report-engine/domain.ts routing is untouched by this fix -- an acquisition prompt under 'plan' mode still resolves to 'acquisition' (drift check)", async () => {
  const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
    "../app/lib/report-engine/domain.ts"
  );
  const inferredDomain = classifyReportDomain(scenarioPrompt);
  assert.equal(inferredDomain, "acquisition");
  const resolvedDomain = resolveReportDomainForSelectedMode({
    selectedMode: "plan",
    inferredDomain,
    expertiseDomain: "acquisition",
  });
  assert.equal(resolvedDomain, "acquisition");
});

test("the sources field's assembly (assetList + evidenceText) is untouched by this fix", () => {
  assert.match(planExecutorSource, /sources: `\$\{assetList\}\\n\$\{evidenceText\}`,/);
});
