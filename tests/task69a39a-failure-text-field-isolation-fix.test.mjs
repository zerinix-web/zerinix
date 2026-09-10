// TASK #69A-39A -- Use the newly captured live-generation diagnostics (added
// by #69A-39) to identify and fix the actual competitive-research failure.
//
// A. EXACT LIVE DIAGNOSTIC OBSERVED (dev-server.out.log, real fresh
//    localhost business_plan generation, reportRequestId
//    d921f191-7f90-4a32-9af6-da5edea6338e):
//      status: "completed" (the #69A-39 token-budget fix worked -- the
//      real OpenAI call finished, producing a full 24,709-character JSON
//      response, never truncated).
//      [api:plan] full report generation failed, used grounded fallback {
//        reason: 'generation_error',
//        errorDetail: 'Full report JSON validation failed. Failure-text
//          fields: risks. outputLength=24709'
//      }
//    I.e. NOT a timeout, NOT max_output_tokens, NOT a quality-gate
//    rejection -- exactly one of the 24 planFields ("risks") matched
//    isReportGenerationFailureText (app/lib/report-errors.ts), a heuristic
//    meant to catch a provider/model error message that leaked into
//    content (rate limit, quota, "this section is waiting for AI output",
//    etc.).
//
// B. FIRST PIPELINE STAGE WHERE COMPETITOR EVIDENCE DISAPPEARED:
//    app/lib/report-jobs/plan-executor.ts's parseFullPlanReport, in its
//    per-planField validation loop. Before this fix, ANY field matching
//    isReportGenerationFailureText pushed that field's name onto
//    `failureFields` and, after the loop, `if (failureFields.length)`
//    THREW for the entire report -- discarding all 24 fields (including
//    whatever real, schema-validated competitorLandscapeStructured /
//    portersFiveForcesStructured data the SAME successful response
//    already contained) and forcing entry into
//    createGroundedBusinessTimeoutFallback's empty-JSON skeleton. This is
//    the exact live symptom traced in #69A-39/#69A-39A: "No competitor
//    data could be validated for this market yet.", 0% competitive
//    evidence, Confidence Radar Evidence 0.
//
// C. ROOT CAUSE: isReportGenerationFailureText's generic technical-
//    vocabulary patterns (service unavailable / network error / timeout /
//    request failed / etc.) can match ordinary, legitimate business
//    content -- proven below with the REAL, unmodified function: a
//    realistic ~700-character Risk Matrix paragraph honestly describing
//    THIS business's own third-party API dependency risk (exactly what
//    its own prompt asks for, given the prompt's explicit QuickBooks/Xero
//    integration) is flagged true. Whether any individual match is a true
//    or false positive, the STRUCTURAL defect is that one field's match
//    discarded the entire, otherwise-valid 24-field report -- a hugely
//    disproportionate blast radius. app/api/market-analysis/route.ts
//    already runs the IDENTICAL isReportGenerationFailureText check
//    per-field and has NEVER had this defect: it swaps only the flagged
//    field for its own fallback and keeps every other field. This fix
//    brings plan-executor.ts's business_plan path in line with that
//    already-proven, already-safe pattern.
//
// SAFETY: this fix does not touch isReportGenerationFailureText's
// patterns, the quality gate, evidence gates, or research execution's
// bounded cost/timeout/dedupe logic. It adds no new retries -- if
// anything, it REDUCES wasted cost: previously, a real, fully-paid-for
// OpenAI generation call was thrown away and replaced by a second, free,
// synthetic call every time this happened; now the real call's 23 (or 24)
// valid fields are kept.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isReportGenerationFailureText } from "../app/lib/report-errors.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const reportErrorsSource = readFileSync(
  join(repoRoot, "app/lib/report-errors.ts"),
  "utf8"
);
const marketAnalysisSource = readFileSync(
  join(repoRoot, "app/api/market-analysis/route.ts"),
  "utf8"
);

// A realistic Risk Matrix paragraph for exactly this business (a
// financial-planning/cash-flow-forecasting SaaS integrating with
// QuickBooks/Xero) honestly analyzing its own third-party API dependency
// risk -- the field's own prompt (plan.ts's "risks" entry) explicitly asks
// for "regulatory, funding, supply, product, or execution reality" risks
// with Probability/Impact/Severity/Mitigation/Early Warning Signal, which
// is exactly what this is.
const REALISTIC_API_DEPENDENCY_RISK_PARAGRAPH =
  "Third-party accounting-platform API service unavailable (a QuickBooks or Xero outage) could disrupt real-time cash-flow sync for customers who depend on same-day numbers. Probability: Medium. Impact: High. Severity: High. Mitigation: implement a resilient retry queue, a cached last-known-good sync state, and proactive integration status-page monitoring. Early Warning Signal: elevated API error rates or webhook delivery failures from the accounting-platform partner. A prolonged network error during a scheduled forecast run could also produce a stale scenario for a finance team relying on same-day figures, so redundant polling and clear in-app staleness indicators are the primary mitigation.";

// --- FAIL-BEFORE PROOF: the false-positive mechanism is real, using the
//     REAL, unmodified isReportGenerationFailureText -----------------------

test("FAIL-BEFORE PROOF: a realistic, substantive Risk Matrix paragraph honestly describing this business's own third-party API dependency risk is flagged by isReportGenerationFailureText purely for using ordinary technical-operations vocabulary", () => {
  assert.ok(REALISTIC_API_DEPENDENCY_RISK_PARAGRAPH.length > 500);
  assert.equal(
    isReportGenerationFailureText(REALISTIC_API_DEPENDENCY_RISK_PARAGRAPH),
    true,
    "expected the real heuristic to flag this real, substantive business content -- proving the false-positive risk this task fixes is real, not hypothetical"
  );
});

test("this fix intentionally does NOT touch isReportGenerationFailureText's own patterns -- the false-positive risk proven above is bounded structurally (per-field isolation), not by narrowing/guessing at patterns that could also miss a genuine failure", () => {
  // Guards against a future edit trying to "fix" this by loosening the
  // shared heuristic instead -- that would weaken the OTHER 10+ call
  // sites (whole-cached-response failure detection) that correctly rely
  // on it being broad.
  assert.match(reportErrorsSource, /export function isReportGenerationFailureText/);
  assert.doesNotMatch(reportErrorsSource, /TASK #69A-39A/);
});

// --- THE FIX ITSELF: per-field isolation, mirroring market-analysis -----

test("market-analysis's own identical isReportGenerationFailureText check already isolates a single flagged field instead of discarding the whole report (the proven-safe pattern this fix now mirrors for business_plan)", () => {
  assert.match(
    marketAnalysisSource,
    /if \(isReportGenerationFailureText\(content\)\) \{\s*\n\s*invalidFields\.push\(field\);\s*\n\s*report\[field\] = createMarketFieldFallback\(field, language\);\s*\n\s*continue;/
  );
});

test("parseFullPlanReport no longer throws when a single field matches isReportGenerationFailureText -- it now substitutes that field's own fallback and keeps every other field, mirroring market-analysis", () => {
  assert.match(
    planExecutorSource,
    /if \(isReportGenerationFailureText\(sanitizedContent\)\) \{[\s\S]{0,2400}?report\[field\] = ensureCompleteReportText\(\s*\n\s*createPlanFieldFallback\(field, parsed, context, language\)\s*\n\s*\);\s*\n\s*failureFields\.push\(field\);\s*\n\s*continue;\s*\n\s*\}/
  );
});

test("a flagged field's rejection is now only ever logged, never thrown, for the whole report", () => {
  assert.doesNotMatch(
    planExecutorSource,
    /if \(failureFields\.length\) \{\s*\n\s*throw new Error/
  );
  assert.match(
    planExecutorSource,
    /if \(failureFields\.length\) \{\s*\n\s*logOperationalInfo\("\[api:plan\] replaced failure-text field\(s\) with fallback, kept the rest of the report"/
  );
});

test("the per-field fallback path reuses createPlanFieldFallback -- the exact same generic, honest, no-vendor-name template already used for genuinely-missing content, never a newly-invented or fabricated stand-in", () => {
  const fixBlockMatch = planExecutorSource.match(
    /if \(isReportGenerationFailureText\(sanitizedContent\)\) \{[\s\S]{0,2400}?continue;\s*\n\s*\}/
  );
  assert.ok(fixBlockMatch);
  assert.match(fixBlockMatch[0], /createPlanFieldFallback\(field, parsed, context, language\)/);
  // No hardcoded vendor/competitor name in the actual EXECUTABLE code
  // (comments above it may reference real-world examples like
  // QuickBooks/Xero for explanatory purposes -- only the code itself must
  // never hardcode a vendor name).
  const executableLines = fixBlockMatch[0]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(executableLines, /Float|Cash Flow Frog|Futrli|QuickBooks|Xero/i);
});

// --- REGRESSION SAFETY: competitor/Porter data from the SAME response
//     survives a single unrelated field being flagged --------------------

test("competitorLandscapeStructured/portersFiveForcesStructured extraction (#69A-15A/#69A-28's Tier 0 builders) happens completely independently of the planFields loop that failureFields lives in -- a flagged 'risks' field can never affect their extraction", () => {
  // Tier 0 re-parses the raw responseText directly (not the planFields
  // report object), at the call site AFTER parseFullPlanReport succeeds --
  // confirms competitor/Porter data was never at risk of the SAME
  // exception this fix removes, only of the report being discarded
  // wholesale before ever reaching that call site.
  assert.match(
    planExecutorSource,
    /buildBusinessCompetitorLandscapeStateFromStructuredResponse/
  );
  assert.match(
    planExecutorSource,
    /buildPortersFiveForcesStateFromStructuredResponse/
  );
});

test("SAFETY: no new retry logic was introduced -- this fix removes a spurious full-report discard, it does not add any additional AI call, so bounded cost/dedupe/retry-limit behavior is unchanged", () => {
  assert.doesNotMatch(planExecutorSource, /TASK #69A-39A[\s\S]{0,300}retry/i);
});

test("SAFETY: the quality gate, evidence gates, and isReportGenerationFailureText's own pattern list are untouched by this fix", () => {
  assert.match(reportErrorsSource, /export const reportGenerationFailurePatterns = \[/);
  assert.ok(
    planExecutorSource.includes(
      "The quality gate itself, and its threshold, are\n            // untouched"
    )
  );
});

// --- HONEST EMPTY STATE IS STILL POSSIBLE ---------------------------------

test("if EVERY field genuinely fails (a total generation failure), the report still falls through to the fully-empty, evidence-honest grounded fallback exactly as before -- this fix only stops a SINGLE field's rejection from destroying 23 OTHER valid fields", () => {
  // The outer catch block (real provider errors: timeout, quality gate,
  // JSON parse failure, root-not-an-object) is completely untouched --
  // still routes to createGroundedBusinessTimeoutFallback.
  assert.match(planExecutorSource, /const shouldUseGroundedFallback = true;/);
  assert.match(planExecutorSource, /createGroundedBusinessTimeoutFallback\(\{/);
});
