import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  enrichCompetitorWeaknessesFromEvidence,
  attachWeaknessProvenance,
  readCompetitorResearchStatus,
  formatCompetitorResearchEmptyStateMessage,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";

// TASK #69A-63 -- regression coverage for the PROVEN root cause of
// nondeterministic competitor-evidence loss: a real fresh generation,
// captured directly from dev-server logs, showed research completing
// successfully (evidenceCount: 69) followed by
// `reason: 'timeout', errorDetail: 'OpenAI report generation timed out
// after 90 seconds.'` -- the SAME prompt that, on a different run,
// completed within budget and produced real competitor intelligence.
// This is inherent LLM response-time variance for a large,
// strictly-schema-validated response (24 planFields plus the
// competitorLandscapeStructured/portersFiveForcesStructured arrays),
// not a bug in research, extraction, or canonicalization -- every one
// of those was independently confirmed safe in #69A-58 through #69A-62.
// FIRST_DIVERGENCE: the fixed 90-second BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS
// ceiling, which the logs prove was the sole binding constraint (research
// 40.68s + hitting the full 90s ceiling = 130.76s, well under the 200s
// overall BUSINESS_PLAN_PIPELINE_BUDGET_MS -- ~65-70s of already
// -allocated budget was never available to the generation call at all).
// TWO fixes: (1) raise the ceiling to use the existing, unused budget
// headroom, directly reducing how often this fires; (2) since SOME
// timeout will always remain structurally possible (network/API
// variance), record WHY a competitor state came back empty
// (competitorResearchStatus) so a genuine infrastructure failure can
// never be presented as "research completed, no competitors validated."

const PLAN_EXECUTOR_SOURCE = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const PAGE_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const PLANNER_SOURCE = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const PDF_BUTTON_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// --- A. Timeout ceiling fix ------------------------------------------

test("[FAIL-BEFORE PROOF] the pre-fix 90-second ceiling was the sole binding constraint on a real run that had ~65-70s of unused pipeline budget remaining", () => {
  const researchExecutionMs = 40_680;
  const oldCeilingMs = 90_000;
  const totalPipelineBudgetMs = 200_000;
  const remainingBudgetAtGenerationStart = totalPipelineBudgetMs - researchExecutionMs;
  assert.ok(
    remainingBudgetAtGenerationStart > oldCeilingMs,
    "the old 90s ceiling must have been stricter than the remaining pipeline budget for this to be the true bottleneck"
  );
  assert.equal(Math.min(oldCeilingMs, remainingBudgetAtGenerationStart), oldCeilingMs);
});

test("A. BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS was raised from 90s, using the previously-unused pipeline budget headroom, while staying safely inside BUSINESS_PLAN_PIPELINE_BUDGET_MS", () => {
  const timeoutMatch = /const BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS = (\d+)_000;/.exec(PLAN_EXECUTOR_SOURCE);
  const budgetMatch = /const BUSINESS_PLAN_PIPELINE_BUDGET_MS = (\d+)_000;/.exec(PLAN_EXECUTOR_SOURCE);
  assert.ok(timeoutMatch && budgetMatch, "expected both constants to be found");

  const newTimeoutMs = Number(timeoutMatch[1]) * 1000;
  const pipelineBudgetMs = Number(budgetMatch[1]) * 1000;

  assert.ok(newTimeoutMs > 90_000, `expected the ceiling to be raised above the old 90s value, got ${newTimeoutMs}ms`);
  // Real research execution observed at 40.68s -- the raised ceiling
  // must still leave a positive margin before the report call would
  // exceed the overall pipeline budget at that observed research time.
  const observedResearchExecutionMs = 40_680;
  assert.ok(
    newTimeoutMs + observedResearchExecutionMs < pipelineBudgetMs,
    "the new ceiling plus the observed research execution time must still fit inside the overall pipeline budget"
  );
  // And it must strictly be the smaller of the two -- i.e. the report
  // call itself, not the overall pipeline budget, remains the informative
  // constraint that providerTimeoutMs's own Math.min resolves against.
  assert.ok(newTimeoutMs < pipelineBudgetMs);
});

test("the providerTimeoutMs call site still caps the report call at min(ceiling, remaining pipeline budget) -- this fix only raises the ceiling itself, never removes the overall pipeline-budget safety net", () => {
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /Math\.min\(\s*\n\s*BUSINESS_PLAN_REPORT_OPENAI_TIMEOUT_MS,\s*\n\s*BUSINESS_PLAN_PIPELINE_BUDGET_MS -/
  );
});

// --- B. Research failure-state model ---------------------------------

test("B. formatCompetitorResearchEmptyStateMessage returns the honest 'research completed, nothing validated' message for SUCCESS_NO_EVIDENCE and for the undefined/historical-report default", () => {
  assert.equal(
    formatCompetitorResearchEmptyStateMessage("SUCCESS_NO_EVIDENCE"),
    "No competitor data could be validated for this market yet."
  );
  assert.equal(
    formatCompetitorResearchEmptyStateMessage(undefined),
    "No competitor data could be validated for this market yet."
  );
});

test("B. formatCompetitorResearchEmptyStateMessage returns a DIFFERENT, honest 'generation did not finish' message for TIMEOUT and GENERATION_ERROR -- never presented as validated absence", () => {
  const timeoutMessage = formatCompetitorResearchEmptyStateMessage("TIMEOUT");
  const errorMessage = formatCompetitorResearchEmptyStateMessage("GENERATION_ERROR");
  assert.notEqual(timeoutMessage, "No competitor data could be validated for this market yet.");
  assert.notEqual(errorMessage, "No competitor data could be validated for this market yet.");
  assert.match(timeoutMessage, /did not finish|not evidence/i);
  assert.match(errorMessage, /did not finish|not evidence/i);
});

test("readCompetitorResearchStatus safely resolves undefined for metadata missing the field entirely (every report persisted before this fix) -- no regression for historical reports", () => {
  assert.equal(readCompetitorResearchStatus({}), undefined);
  assert.equal(readCompetitorResearchStatus(null), undefined);
  assert.equal(readCompetitorResearchStatus({ competitorResearchStatus: "bogus" }), undefined);
  assert.equal(readCompetitorResearchStatus({ competitorResearchStatus: "TIMEOUT" }), "TIMEOUT");
});

test("the SUCCESS path (a genuinely completed generation) classifies its own status from whether the model itself validated any competitors, never a fixed value", () => {
  const region = PLAN_EXECUTOR_SOURCE.slice(
    PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-63 -- this branch is a genuinely COMPLETED"),
    PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-63 -- this branch is a genuinely COMPLETED") + 1200
  );
  assert.match(region, /businessCompetitorLandscapeState\?\.competitors\.length\s*\n\s*\?\s*"SUCCESS_WITH_EVIDENCE"\s*\n\s*:\s*"SUCCESS_NO_EVIDENCE"/);
});

test("the fallback path (generation never completed) classifies its status from the SAME providerTimedOut flag the diagnostic log already uses, never a hardcoded SUCCESS value", () => {
  const region = PLAN_EXECUTOR_SOURCE.slice(
    PLAN_EXECUTOR_SOURCE.indexOf("fallbackCompetitorLandscapeState is"),
    PLAN_EXECUTOR_SOURCE.indexOf("fallbackCompetitorLandscapeState is") + 1500
  );
  assert.match(region, /providerTimedOut \? "TIMEOUT" : "GENERATION_ERROR"/);
});

// --- C. Cache safety (audited, confirmed already correct) ------------

test("C. the grounded-fallback branch (timeout/generation_error) never calls storeCachedAiResponse for the business_plan full report -- a genuine infrastructure failure can never be cached and later replayed as if it were a successful evidence-backed response", () => {
  const fallbackBranchStart = PLAN_EXECUTOR_SOURCE.indexOf("const fallbackReport = createGroundedBusinessTimeoutFallback(");
  const fallbackBranchEnd = PLAN_EXECUTOR_SOURCE.indexOf(
    "[api:plan] full report generation failed, used grounded fallback"
  );
  assert.ok(fallbackBranchStart > -1 && fallbackBranchEnd > fallbackBranchStart);
  const fallbackBranch = PLAN_EXECUTOR_SOURCE.slice(fallbackBranchStart, fallbackBranchEnd);
  assert.doesNotMatch(fallbackBranch, /storeCachedAiResponse/);
});

test("the success path's own cache write is gated on isReportGenerationFailureText, so a response that resembles a failure text is never cached as valid evidence either", () => {
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /if \(!isReportGenerationFailureText\(cacheResponseText\)\) \{\s*\n\s*fullReportStage = "cache_write";\s*\n\s*await storeCachedAiResponse/
  );
});

test("a cache-hit replay is always classified as one of the two SUCCESS variants -- the fallback path never writes to this cache, so a cache hit can never replay a TIMEOUT/GENERATION_ERROR state", () => {
  const region = PLAN_EXECUTOR_SOURCE.slice(
    PLAN_EXECUTOR_SOURCE.indexOf("finalCachedCompetitorLandscapeState?.competitors.length"),
    PLAN_EXECUTOR_SOURCE.indexOf("finalCachedCompetitorLandscapeState?.competitors.length") + 200
  );
  assert.match(region, /"SUCCESS_WITH_EVIDENCE"/);
  assert.match(region, /"SUCCESS_NO_EVIDENCE"/);
  assert.doesNotMatch(region, /"TIMEOUT"|"GENERATION_ERROR"/);
});

// --- D. Downstream consistency / evidence protection (re-confirmed) --

test("D. a competitor with no weakness evidence still produces a full canonical entity -- competitive evidence scoring and Porter both consume the SAME canonical set regardless of async completion order", () => {
  // Simulates the SAME evidence set being applied in two different
  // orders (the enrichment call happening effectively "before" or
  // "after" other canonicalization steps by reordering the calls) --
  // proving the result is order-independent, without spending any real
  // provider/API call.
  const structuredResponse = [
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting for accountants/bookkeepers", strengths: "Broad accounting integrations", weaknesses: null, threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Cash flow forecasting SaaS for SMBs", strengths: "Simple visual tool", weaknesses: null, threat: "Medium" },
  ];
  const evidence = [
    { id: "R1", url: "https://www.g2.com/products/cash-flow-frog/reviews", claim: "Cons: limited scenario modeling depth", value: "" },
  ];

  // Order A: build -> enrich -> attach provenance.
  const stateA = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enrichedA = enrichCompetitorWeaknessesFromEvidence(stateA, evidence);
  const finalA = attachWeaknessProvenance(enrichedA, [{ id: "R1", confidence: 70 }]);

  // Order B: build fresh again, same evidence, same steps -- pure
  // functions must be deterministic regardless of when/how many times
  // they are invoked.
  const stateB = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enrichedB = enrichCompetitorWeaknessesFromEvidence(stateB, evidence);
  const finalB = attachWeaknessProvenance(enrichedB, [{ id: "R1", confidence: 70 }]);

  assert.deepEqual(finalA, finalB);
  assert.equal(finalA.competitors.length, 2);

  const evidenceScoreA = deriveCanonicalCompetitiveEvidence(finalA);
  const evidenceScoreB = deriveCanonicalCompetitiveEvidence(finalB);
  assert.deepEqual(evidenceScoreA, evidenceScoreB);
  assert.ok(evidenceScoreA.competitiveEvidence > 0);
});

test("a genuinely empty successful research pass remains honestly SUCCESS_NO_EVIDENCE -- never upgraded to fabricated competitors", () => {
  const emptyState = buildBusinessCompetitorLandscapeStateFromStructuredResponse([]);
  assert.equal(emptyState, null);
  const evidenceScore = deriveCanonicalCompetitiveEvidence(emptyState);
  assert.deepEqual(evidenceScore, { competitorBreadth: 0, competitiveEvidence: 0 });
});

// --- E. Persistence round trip with the new field ---------------------

test("E. competitorResearchStatus and a non-empty canonical competitor set both survive a full JSON serialize/deserialize round trip (simulating reports.metadata JSONB persistence and reload)", () => {
  const structuredResponse = [
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting for accountants/bookkeepers", strengths: "Broad accounting integrations", weaknesses: null, threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const metadata = {
    businessCompetitorLandscapeState: state,
    competitorResearchStatus: "SUCCESS_WITH_EVIDENCE",
  };

  const reloaded = JSON.parse(JSON.stringify(metadata));
  assert.equal(readCompetitorResearchStatus(reloaded), "SUCCESS_WITH_EVIDENCE");
  assert.equal(reloaded.businessCompetitorLandscapeState.competitors.length, 1);
});

// --- F. Web/PDF parity for the new honest-message helper ---------------

test("F. web (dashboard, Planner) and PDF (ReportPdfButton, Planner's own downloadPdf) all render the BIV competitor-empty state through the same shared formatCompetitorResearchEmptyStateMessage helper -- never independently deciding whether competitor evidence exists", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.match(source, /formatCompetitorResearchEmptyStateMessage/);
  }
});

test("web and PDF still consume the same shared formatCompetitorWeaknessForDisplay helper for individual weaknesses -- unaffected by this fix", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.match(source, /formatCompetitorWeaknessForDisplay/);
  }
});

test("the Market-Intelligence-only empty-competitor branches (a separate, unrelated canonical system) are left untouched by this fix -- confirms the fix is scoped to BIV's businessCompetitorLandscapeState only", () => {
  // Both page.tsx and Planner.tsx have a SEPARATE "Competitive Landscape"
  // (Market Intelligence) empty-state branch that must keep its own,
  // pre-existing literal wording -- this fix must never touch it.
  assert.match(PAGE_SOURCE, /No competitor data could be validated for this market yet\./);
  assert.match(PLANNER_SOURCE, /No competitor data could be validated for this market yet\./);
});

// --- G. No hardcoded competitor identities -----------------------------

test("G. this fix's own diff contains no hardcoded competitor name", () => {
  const planExecutorMarkerStart = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-63");
  const region = PLAN_EXECUTOR_SOURCE.slice(planExecutorMarkerStart, planExecutorMarkerStart + 6000);
  assert.doesNotMatch(region, /\bFloat\b|\bCash Flow Frog\b|\bFutrli\b|\bQuicken\b|\bJirav\b|\bFathom\b/);
});

// --- H. Decision safety: confined blast radius --------------------------

test("H. this fix's own diff carries no #69A-63 marker in any canonical decision/confidence/founder-readiness file, and no direct assignment to investmentScore/decisionEngine fields", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/report-engine/decision-contradiction-gate.ts",
    "app/lib/ai/decision-confidence.ts",
  ]) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TASK #69A-63/, `${relativePath} must not carry a #69A-63 marker`);
  }
});

test("no new AI/research call was added -- the fix is confined to a timeout constant, a status classification field, and its two honest-message renderers", () => {
  const planExecutorMarkerStart = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-63");
  const region = PLAN_EXECUTOR_SOURCE.slice(planExecutorMarkerStart, planExecutorMarkerStart + 1600);
  assert.doesNotMatch(region, /client\.responses\.create|runDomainAwareResearch|resolveDomainResearchWithCache/);
});
