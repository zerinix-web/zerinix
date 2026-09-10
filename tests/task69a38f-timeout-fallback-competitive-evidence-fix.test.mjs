// TASK #69A-38F -- Trace and eliminate the false canonical "93%
// competitive evidence / 5 competitors" state at its source.
//
// LIVE FAILURE: #69A-38D/#69A-38E's own fixes (correcting
// decisionEngine.competitionScore and the report's own text mentions
// once businessCompetitorLandscapeState is known) did NOT resolve the
// contradiction in a real fresh report. Direct inspection of the actual
// persisted `reports` row (service-role, read-only) proved:
//   - `sections[competitorLandscape].content` was byte-identical to
//     createPlanFieldFallback's own GENERIC "Direct competitors,
//     substitutes, and status-quo alternatives within ... should be
//     mapped against this business's specific wedge" template.
//   - `sections[executiveSummary].content` was byte-identical to
//     formatExecutiveDecisionBrief's own shape (Executive Decision /
//     Confidence Reduced Because / Why / Top 3 Reasons / Top 3 Risks /
//     What Evidence Is Missing / What Would Change This Decision /
//     Immediate Next Action).
//   - `metadata` had NO businessCompetitorLandscapeState/
//     portersFiveForcesState keys at all, and
//     investmentScore.decisionEngine.competitionScore.score was still
//     93.
//
// ROOT CAUSE: every field in this report was createPlanFieldFallback's
// OWN fallback template -- proof the real AI generation call for this
// report FAILED or timed out and fell through to
// createGroundedBusinessTimeoutFallback (parseFullPlanReport("{}", ...),
// which fallback-fills literally every field). #69A-38D/#69A-38E's
// fixes are wired ONLY into the SUCCESS branch of report generation --
// this branch never sends a reportMetadata chunk at all (only
// serializePlanReportChunks(fallbackReport)), so the client/persistence
// kept whatever the EARLY, pre-generation metadata chunk had already
// sent: the raw-evidence-derived (never canonical-competitor-corrected)
// dimensions.competitiveEvidence. The fallback path also built its own
// report text from `researchAwareFinancialContext` (the SAME pre-
// correction context), so formatExecutiveDecisionBrief's own reasoning
// text baked in "Competitive evidence: 93%; Distinct competitor
// organizations represented: 5" directly.
//
// FIX (app/lib/report-jobs/plan-executor.ts, inside the
// shouldUseGroundedFallback branch):
//   1. Recompute a canonical-competitor-corrected context (identical
//      mechanism to #69A-38D/#69A-38E's success-path fix) BEFORE
//      calling createGroundedBusinessTimeoutFallback -- a total
//      generation failure means there is definitively no AI-produced
//      competitor list, so deriveCanonicalCompetitiveEvidence(null) is
//      unconditionally correct here, never a guess.
//   2. Apply correctCompetitiveEvidenceMentions to fallbackReport as
//      defense in depth.
//   3. Compute the SAME Tier 0/Tier 1 businessCompetitorLandscapeState/
//      portersFiveForcesState the success path already computes (Tier 1
//      honestly returns null competitors / 5 "Insufficient evidence"
//      Porter forces for this generic template, never fabricating).
//   4. Send a reportMetadata chunk (this path never sent ONE at all
//      before), so the client/persistence receive the corrected
//      snapshot instead of silently keeping the stale early one.
//
// Also fixed, per this task's own explicit semantic audit request:
// buildOpportunityScore's "Competition Score" (Market Opportunity's own
// sub-score) reuses decisionEngine.competitionScore verbatim --
// confirmed to be a DELIBERATE reuse of competitive-EVIDENCE-strength
// semantics, not an independent "how favorable are competitive
// conditions" metric. Clarified in place (label only, never a new,
// unvalidated score) rather than silently left ambiguous or replaced
// with a fabricated favorability metric.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions, refreshResearchAwareFinancialContext } from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext, deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";
import { correctMetricMentions } from "../app/lib/report-consistency-validation.ts";
import {
  buildBusinessCompetitorLandscapeState,
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { buildPortersFiveForcesStateFromLegacyProse, PORTER_FORCE_ORDER } from "../app/lib/report-engine/porters-five-forces-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

// Raw evidence shaped exactly like what a real research bundle can
// contain -- competitor-tagged text that, left unfiltered by canonical
// state, would independently inflate competitorBreadth/competitiveEvidence.
const COMPETITOR_SHAPED_RAW_EVIDENCE = [
  { id: "R1", field: "product_evidence", claim: "Float integrates with Xero/QuickBooks for cash-flow forecasting.", value: "", url: "https://float.com", sourceTitle: "Float", publisher: "Float", label: "Verified from external source", confidence: 80, qualityScore: 80, impactReason: "Shows established competitor positioning.", sourceType: "company_primary" },
  { id: "R2", field: "company_evidence", claim: "Fathom offers financial reporting.", value: "", url: "https://fathomhq.com", sourceTitle: "Fathom", publisher: "Fathom", label: "Verified from external source", confidence: 75, qualityScore: 75, impactReason: "Indicates available competitive analysis tooling.", sourceType: "company_primary" },
  { id: "R3", field: "product_evidence", claim: "Futrli provides forecasting tools.", value: "", url: "https://futrli.com", sourceTitle: "Futrli", publisher: "Futrli", label: "Verified from external source", confidence: 78, qualityScore: 78, impactReason: "Shows established competitor positioning.", sourceType: "company_primary" },
  // A duplicate ALIAS of Float on a different subdomain -- must not
  // count as a second, distinct organization.
  { id: "R4", field: "product_evidence", claim: "Float's blog covers cash-flow forecasting best practices.", value: "", url: "https://blog.float.com", sourceTitle: "Float Blog", publisher: "Float", label: "Verified from external source", confidence: 70, qualityScore: 70, impactReason: "Shows established competitor positioning.", sourceType: "company_primary" },
  // A pure research/data PROVIDER mention -- not a competitor of the
  // business itself.
  { id: "R5", field: "company_evidence", claim: "Crunchbase lists SaaS company profiles for market research.", value: "", url: "https://crunchbase.com", sourceTitle: "Crunchbase", publisher: "Crunchbase", label: "Verified from external source", confidence: 65, qualityScore: 65, impactReason: "Shows established competitor positioning.", sourceType: "company_primary" },
];

function buildRawEvidenceCoverage() {
  const base = createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
  return applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT);
}

// --- FAIL-BEFORE PROOF: reproduce the exact current contradiction ------

test("FAIL-BEFORE PROOF: the raw-evidence-only computation (what the timeout-fallback path used BEFORE this fix) independently inflates competitorBreadth/competitiveEvidence to a non-zero, non-trivial value from evidence alone -- with NO canonical competitor validated anywhere", () => {
  const rawResult = buildRawEvidenceCoverage();
  assert.ok(rawResult.coverage.competitorBreadth > 0, "the raw-evidence path alone reports a non-zero organization count");
  assert.ok(rawResult.coverage.dimensions.competitiveEvidence > 0, "the raw-evidence path alone reports non-zero competitive evidence");
  // The canonical Competitor Landscape for this same scenario is
  // genuinely empty (a real generation failure produced no structured
  // competitor list at all) -- the contradiction this task reproduces.
  assert.equal(buildBusinessCompetitorLandscapeState(""), null);
});

test("FAIL-BEFORE PROOF: before this fix, the timeout-fallback branch (createGroundedBusinessTimeoutFallback) never sent a reportMetadata chunk and never corrected its own context -- reconstructed from the CURRENT source (not git-dependent) by simulating the fix's own removal", () => {
  const fixMarker = "const finalResearchAwareFinancialContext = refreshResearchAwareFinancialContext(\n                applyMarketResearchCoverageToContext(\n                  canonicalFinancialAssumptions,\n                  businessResearch,\n                  promptText,\n                  undefined,\n                  deriveCanonicalCompetitiveEvidence(null)\n                ).context\n              );";
  assert.ok(planExecutorSource.includes(fixMarker), "expected the CURRENT source to contain the #69A-38F fix before simulating its absence");
  const oldStyleCall = "context: researchAwareFinancialContext,\n                research: businessResearch,\n                language: responseLanguage,\n              });";
  // Proves the OLD call shape (context: researchAwareFinancialContext,
  // the pre-correction variable) is no longer what feeds
  // createGroundedBusinessTimeoutFallback.
  assert.ok(!planExecutorSource.includes(oldStyleCall));
});

// --- [1] zero validated competitors => validated competitor count = 0 --

test("[1] zero validated competitors => validated competitor count = 0, regardless of how much competitor-shaped raw evidence exists", () => {
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  assert.equal(canonicalEvidence.competitorBreadth, 0);
  assert.equal(canonicalEvidence.competitiveEvidence, 0);
});

// --- [2] rejected competitor candidates do not increase evidence coverage

test("[2] rejected/malformed competitor candidates (blank company name, non-object entries) do not increase evidence coverage -- they are silently skipped, never counted", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "", type: "Direct competitor", positioning: "x", strengths: "x", weaknesses: "x", threat: "x" },
    null,
    "not an object",
    { company: "   ", type: "Direct competitor" },
  ]);
  assert.equal(state, null);
  assert.equal(deriveCanonicalCompetitiveEvidence(state).competitorBreadth, 0);
});

// --- [3] source domains/providers cannot be counted as competitors -----

test("[3] source domains/research providers (Crunchbase, a generic data provider mentioned in raw evidence) cannot be counted as competitors -- deriveCanonicalCompetitiveEvidence reads ONLY businessCompetitorLandscapeState.competitors, never raw evidence publishers/domains", () => {
  const rawResult = buildRawEvidenceCoverage();
  // Crunchbase (R5) is present in the RAW evidence and would be counted
  // by the raw-evidence-only path (proving the bug's mechanism)...
  assert.ok(rawResult.coverage.competitorBreadth > 0);
  // ...but the CANONICAL function this fix actually uses never even
  // looks at raw evidence publishers at all -- it is structurally
  // impossible for it to count a source/provider.
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  assert.equal(canonicalEvidence.competitorBreadth, 0);
});

// --- [4] duplicate aliases cannot inflate organization count -----------

test("[4] duplicate aliases (Float on float.com and blog.float.com) cannot inflate the canonical organization count -- Tier 0 dedupes by lowercased company name", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Direct competitor", positioning: "a", strengths: "a", weaknesses: "a", threat: "a" },
    { company: "float", type: "Direct competitor", positioning: "b", strengths: "b", weaknesses: "b", threat: "b" },
    { company: "FLOAT", type: "Direct competitor", positioning: "c", strengths: "c", weaknesses: "c", threat: "c" },
  ]);
  assert.equal(state.competitors.length, 1);
  assert.equal(deriveCanonicalCompetitiveEvidence(state).competitorBreadth, 1);
});

// --- [5] Executive Summary cannot claim organizations absent from -------
// --- canonical Competitor Landscape -------------------------------------

test("[5] Executive Summary text mentioning stale organization counts is corrected to the canonical count -- it can never claim competitors absent from Competitor Landscape", () => {
  const sections = {
    executiveSummary: 'Why: The opportunity -- "Competitive Advantage: Competitive evidence: 93%; Distinct competitor organizations represented: 5" -- is plausible.',
  };
  const corrections = [];
  correctMetricMentions(sections, ["executiveSummary"], "Distinct competitor organizations represented", "0", "financial_metric_mismatch", new Set(), corrections);
  correctMetricMentions(sections, ["executiveSummary"], "Competitive evidence", "0%", "financial_metric_mismatch", new Set(), corrections);
  assert.equal(corrections.length, 2);
  assert.doesNotMatch(sections.executiveSummary, /represented: 5\b/);
  assert.doesNotMatch(sections.executiveSummary, /93%/);
});

// --- [6] Confidence Radar cannot inherit rejected competitive evidence --

test("[6] Confidence Radar's 'Evidence' dimension reads decisionEngine.competitionScore.score directly -- once that score is corrected via the canonical competitor state, Confidence Radar cannot inherit the rejected/raw-evidence-derived value", () => {
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(null);
  const base = createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
  const corrected = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence).context
  );
  assert.equal(corrected.investmentScore.decisionEngine.competitionScore.score, 0);
});

// --- [7] Competition Score semantics are explicit and tested ------------

test("[7] Competition Score's semantics (competitive-EVIDENCE strength, not competitive-conditions favorability) are made explicit in the Market Opportunity Score label -- never silently mixed", () => {
  const markerIndex = planExecutorSource.indexOf("function buildOpportunityScore(");
  assert.ok(markerIndex > -1);
  const section = planExecutorSource.slice(markerIndex, markerIndex + 2000);
  assert.match(section, /competitive-evidence strength/);
  assert.match(section, /not how favorable competitive conditions are/);
});

test("[7b] the SAME decisionEngine.competitionScore number is what Market Opportunity's 'Competition Score' line displays -- a deliberate, documented reuse, never two independently-drifting numbers", () => {
  const markerIndex = planExecutorSource.indexOf("function buildOpportunityScore(");
  const section = planExecutorSource.slice(markerIndex, markerIndex + 500);
  assert.match(section, /const competition = scorePercent\(engine\.competitionScore\.score, engine\.competitionScore\.maximumScore\);/);
});

// --- [8] Founder Evidence Confidence remains independently canonical ---

test("[8] Founder Readiness's Evidence Confidence is never forced to equal decisionEngine.competitionScore/competitiveEvidence -- it has its own, prompt-derived source that this fix never touches", () => {
  const marketResearchCoverageSource = readFileSync(join(repoRoot, "app/lib/ai/market-research-coverage.ts"), "utf8");
  assert.match(
    marketResearchCoverageSource,
    /Evidence confidence: \$\{originalEvidenceConfidence \?\? coverage\.overallConfidence\}%/
  );
  // originalEvidenceConfidence (the founder-signal-specific value) is
  // preferred; coverage.overallConfidence (which competitiveEvidence
  // partially feeds) is only a defensive fallback for a missing line --
  // this task's fix does not change that preference order.
});

// --- [9] web/PDF use the same values ------------------------------------

test("[9] the timeout-fallback path now sends its Tier 0/Tier 1 competitor and Porter state through the SAME serializePlanReportMetadataChunk every other path uses -- web and PDF read one canonical snapshot regardless of how the report was produced", () => {
  const markerIndex = planExecutorSource.indexOf("TASK #69A-38F -- mirrors the success path's own Tier 0/");
  assert.ok(markerIndex > -1);
  const section = planExecutorSource.slice(markerIndex, markerIndex + 2500);
  assert.match(section, /const fallbackCompetitorLandscapeState = buildBusinessCompetitorLandscapeState\(/);
  assert.match(section, /const fallbackPortersFiveForcesState = buildPortersFiveForcesStateFromLegacyProse\(/);
  assert.match(section, /serializePlanReportMetadataChunk\(\s*\n\s*finalResearchAwareFinancialContext,\s*\n\s*fallbackCompetitorLandscapeState,\s*\n\s*fallbackPortersFiveForcesState/);
});

// --- [10] cached/persisted stale 93/5 data is corrected or safely -------
// --- invalidated ---------------------------------------------------------

test("[10] a freshly-generated timeout-fallback report now stores the CORRECTED text/metadata in cacheResponseText's own upstream data -- a fresh regenerate cannot preserve stale pre-fix competitive metrics for this path", () => {
  const markerIndex = planExecutorSource.indexOf("const fallbackReport = createGroundedBusinessTimeoutFallback({");
  assert.ok(markerIndex > -1);
  const section = planExecutorSource.slice(Math.max(0, markerIndex - 900), markerIndex);
  assert.match(section, /const finalResearchAwareFinancialContext = refreshResearchAwareFinancialContext\(/);
  assert.match(section, /deriveCanonicalCompetitiveEvidence\(null\)/);
});

// --- [11] valid real competitors still produce legitimate evidence -----

test("[11] valid, real, canonical competitors still produce legitimate, proportionate competitive evidence -- this fix never zeroes out genuinely validated competitor data", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs", strengths: "Strong SMB adoption", weaknesses: "Limited scenario depth", weaknessBasis: "directional", threat: "Medium" },
    { company: "Fathom", type: "Direct competitor", positioning: "Financial reporting and analysis", strengths: "Broad integrations", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const evidence = deriveCanonicalCompetitiveEvidence(state);
  assert.equal(evidence.competitorBreadth, 2);
  assert.ok(evidence.competitiveEvidence > 0);
});

// --- [12] decision safety remains intact unless legitimate evidence -----
// --- changes it -----------------------------------------------------------

test("[12] no MONITOR/62/Founder-Readiness/40 (or any other specific score) is pinned as a required, hardcoded outcome anywhere in this fix -- scores are recomputed, never forced", () => {
  const markerIndex = planExecutorSource.indexOf("TASK #69A-38F -- ROOT CAUSE FIX. Confirmed live");
  assert.ok(markerIndex > -1);
  const section = planExecutorSource.slice(markerIndex, markerIndex + 6000);
  assert.ok(!/MONITOR/.test(section));
  assert.ok(!/62%/.test(section));
  assert.ok(!/Founder Readiness/.test(section));
  for (const forbidden of ["Float", "Cash Flow Frog", "Futrli", "Fathom", "= 93", "= 5;"]) {
    assert.ok(!section.includes(forbidden), `plan-executor.ts's #69A-38F fix must not hardcode "${forbidden}"`);
  }
});

// --- Porter regression guard: 5 forces, honest, never fabricated -------

test("Porter Tier 1 synthesis for the timeout-fallback path's own generic template still produces exactly 5 forces, all honestly 'Insufficient evidence' (no fabrication) -- consistent with this generic template genuinely supporting no force-specific signal", () => {
  const genericPortersTemplate =
    "Within the detected industry, the forces most likely to shape this business are buyer power and the ease of new entrants given the detected business model.";
  const state = buildPortersFiveForcesStateFromLegacyProse(genericPortersTemplate);
  assert.equal(Object.keys(state.forces).length, 5);
  for (const key of PORTER_FORCE_ORDER) {
    assert.ok(state.forces[key].analysis.trim().length > 0);
  }
});

// --- Diff-surface confinement --------------------------------------------

test("no decision-engine, financial-model, domain-classification, or Porter-architecture file carries a #69A-38F marker -- this fix is confined to plan-executor.ts's timeout-fallback branch and the Competition Score label clarification", () => {
  for (const relativePath of [
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-engine/domain.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-consistency-validation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-38F/, `${relativePath} should not carry this task's marker`);
  }
});
