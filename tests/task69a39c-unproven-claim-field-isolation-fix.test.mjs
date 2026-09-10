// TASK #69A-39C -- Diagnose and fix why the fresh live Business Idea
// Validation report still produces ZERO canonical competitor
// organizations after #69A-39B.
//
// LIVE DIAGNOSTIC EVIDENCE (dev-server.out.log, a completely fresh
// localhost generation run AFTER #69A-39B's stale-cache fix):
//   domain: 'business' (repeated throughout research planning/execution
//     -- #69A-39B's fix worked: no more stale "accounting" domain)
//   [research-cache] miss (research genuinely re-executed, not served
//     from cache -- also confirms #69A-39B)
//   ...real evidence gathered, including:
//   'executive_assessment: Commercial evidence indicates a growing
//     SMB-focused cash-flow/financial planning SaaS market in the US
//     with multiple established niche competitors (Float, Dryrun,
//     Fathom, Jirav, LivePlan) and rising interest in AI-enabled
//     forecasting...'
//   "material_facts: Major accounting platforms (Intuit QuickBooks,
//     Xero) offer built-in AI cash-flow forecasting..."
//   'analysis: ...Competitive rivalry: active with specialized niche
//     players and FP&A incumbents; Threat of substitution: spreadsheets
//     and accountants remain strong substitutes; Supplier power:
//     moderate (accounting platforms control APIs...)'
//   ...
//   [api:plan] replaced failure-text field(s) with fallback, kept the
//     rest of the report { failureFields: [ 'risks' ], outputLength: 24713 }
//   [decision-intelligence] quality gate fallback {
//     message: 'Report quality gate failed: unsupported numeric claim
//       lacks evidence and source or method provenance.'
//   }
//   [api:plan] full report generation failed, used grounded fallback {
//     errorDetail: 'Report quality gate failed: unsupported numeric
//       claim lacks evidence and source or method provenance.'
//   }
//
// I.e. #69A-39B's cache fix worked (fresh, correctly-"business"-domain
// research genuinely ran and found real competitor evidence -- Float,
// Dryrun, Fathom, Jirav, LivePlan -- plus real Porter's-Five-Forces-
// relevant analysis). #69A-39A's per-field isolation ALSO worked (only
// "risks" was healed, the rest of the report was kept). But the
// genuinely evidence-rich, competitor-rich report was STILL discarded
// entirely moments later, by a THIRD, different mechanism.
//
// ROOT CAUSE (PROVEN, not inferred): validateDomainResearchQuality's own
// content-shape gates (app/lib/ai/domain-research.ts) -- the same
// function whose DOMAIN check #69A-39B already fixed -- also enforce
// three separate claim-provenance checks (unsupported externally-
// verified claim / unsupported labeled claim / unsupported numeric
// claim) by scanning `Object.values(report).join("\n")`: the WHOLE
// report joined into one block of text, with NO field attribution. A
// SINGLE unlabeled numeric/dollar/percentage figure anywhere across all
// 24 planFields throws for the entire report. plan-executor.ts's
// business_plan success path (validateDomainResearchQualitySafely at
// ~line 9945-9952) explicitly re-throws whenever this happens
// (qualityGateResult.fallbackUsed), discarding the ENTIRE real,
// evidence-rich report -- including its genuinely-valid, schema-
// validated competitorLandscapeStructured/portersFiveForcesStructured
// data -- and falling through to createGroundedBusinessTimeoutFallback's
// empty-JSON skeleton. This is the EXACT SAME disproportionate-blast-
// radius architecture #69A-39A already fixed for a different check
// (isReportGenerationFailureText) -- one field's minor labeling slip
// (almost certainly buried in market-research-derived prose like the
// Xero "180 days" feature detail, or a competitor pricing/market-share
// figure) destroying 23 other genuinely valid fields, just tripped by a
// DIFFERENT gate this time.
//
// STAGE WHERE COMPETITOR DATA DISAPPEARED: parseFullPlanReport
// (app/lib/report-jobs/plan-executor.ts) succeeded and produced a real,
// valid report; validateDomainResearchQualitySafely, called on that
// SAME real report immediately after, threw and forced the ENTIRE
// report -- structured competitor/Porter data included -- to be
// replaced by the empty skeleton.
//
// FIX (app/lib/ai/domain-research.ts + app/lib/report-jobs/plan-executor.ts):
//   New fieldContentHasUnprovenClaim (domain-research.ts) reuses
//   validateDomainResearchQuality's own three content-shape checks,
//   byte-for-byte, but scoped to a SINGLE field's text. plan-executor.ts's
//   parseFullPlanReport now runs this check in its existing per-field
//   loop (the SAME loop #69A-39A's isReportGenerationFailureText check
//   already lives in) -- a field that fails it is healed (replaced with
//   createPlanFieldFallback's own honest, no-vendor-name generic
//   template) BEFORE validateDomainResearchQuality ever runs on the
//   assembled report, so by construction it can no longer find a
//   violation and never discards the rest.
//
// validateDomainResearchQuality's own throwing behavior is completely
// UNCHANGED -- this is a new, separate, non-throwing check consulted
// only inside parseFullPlanReport's per-field loop, not a modification
// to the gate itself, so every one of its other ~12 call sites (real
// estate, domain analysis, acquisition, every cached-reuse path) is
// unaffected.
//
// SAFETY: no citation is fabricated and no provenance requirement is
// relaxed -- the offending field's UNSUPPORTED claim is replaced with a
// generic, no-vendor-name fallback, never annotated with an invented
// label to force it past the gate. competitorLandscapeStructured/
// portersFiveForcesStructured (Tier 0) are parsed directly from the raw
// responseText at a call site AFTER parseFullPlanReport returns -- even
// in the (unlikely) case that competitorLandscape's own PROSE field is
// the one healed, the structured JSON competitor/Porter data is
// completely unaffected, since it was never read from `report` at all.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const domainResearchSource = readFileSync(
  join(repoRoot, "app/lib/ai/domain-research.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);

// domain-research.ts imports "server-only" (a Next.js-only package
// absent from node_modules), so it can't be imported directly outside
// Next's runtime -- the same limitation every other domain-research.ts
// test in this suite already works around (see
// tests/task69a4-biv-quality-gate-provenance-fix.test.mjs's own
// extractRegexConst) by reading the file as text and reconstructing the
// real regex literals/function body from it, rather than approximating
// them.
function extractRegexConst(name) {
  const match = domainResearchSource.match(
    new RegExp(`export const ${name} =\\s*\\n?\\s*(/.*/[a-z]*);`)
  );
  assert.notEqual(match, null, `${name} not found in domain-research.ts`);
  return eval(match[1]);
}

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

const NUMERIC_CLAIM_LINE_PATTERN = extractRegexConst("NUMERIC_CLAIM_LINE_PATTERN");
const NUMERIC_CLAIM_LABEL_PATTERN = extractRegexConst("NUMERIC_CLAIM_LABEL_PATTERN");
const NUMERIC_CLAIM_PROVENANCE_PATTERN = extractRegexConst("NUMERIC_CLAIM_PROVENANCE_PATTERN");

// Loads the REAL, unmodified fieldContentHasUnprovenClaim body (not an
// approximation of it) so this test proves the real function's own
// behavior.
function loadFieldContentHasUnprovenClaim() {
  const rawBody = extractFunctionSource(
    domainResearchSource,
    "fieldContentHasUnprovenClaim"
  ).replace(/^function fieldContentHasUnprovenClaim\(text: string\): boolean /, "");

  return new Function(
    "NUMERIC_CLAIM_LINE_PATTERN",
    "NUMERIC_CLAIM_LABEL_PATTERN",
    "NUMERIC_CLAIM_PROVENANCE_PATTERN",
    "text",
    `${rawBody}`
  ).bind(
    null,
    NUMERIC_CLAIM_LINE_PATTERN,
    NUMERIC_CLAIM_LABEL_PATTERN,
    NUMERIC_CLAIM_PROVENANCE_PATTERN
  );
}

const fieldContentHasUnprovenClaim = loadFieldContentHasUnprovenClaim();

// --- FAIL-BEFORE PROOF: the real gate's own logic really does flag
//     realistic, evidence-derived competitor/market prose -----------------

test("PROOF: a realistic, evidence-derived market/competitor sentence with an unlabeled numeric claim (exactly the shape live research produced -- e.g. a competitor's pricing detail cited without a bracketed source tag) is flagged by the REAL fieldContentHasUnprovenClaim", () => {
  const unlabeledCompetitorClaim =
    "Float charges $59 per month for its mid-tier plan, undercutting a typical new entrant's early pricing.";
  assert.equal(fieldContentHasUnprovenClaim(unlabeledCompetitorClaim), true);
});

test("PROOF: the SAME claim, properly labeled and provenance-tagged exactly as the gate requires, is correctly NOT flagged -- this fix never relaxes what counts as proof", () => {
  const properlyLabeledClaim =
    "[Verified from external source] Float charges $59 per month for its mid-tier plan [R7] (https://float.com/pricing).";
  assert.equal(fieldContentHasUnprovenClaim(properlyLabeledClaim), false);
});

test("PROOF: ordinary prose with no numeric/dollar/percentage claim at all (e.g. most of competitorLandscape's own narrative) is never flagged", () => {
  const narrativeOnly =
    "Float, Dryrun, Fathom, Jirav, and LivePlan are established niche competitors in SMB cash-flow forecasting, several with native QuickBooks and Xero integrations.";
  assert.equal(fieldContentHasUnprovenClaim(narrativeOnly), false);
});

// --- THE FIX ITSELF -------------------------------------------------------

test("fieldContentHasUnprovenClaim is exported from domain-research.ts, explicitly documented as a non-throwing, per-field mirror of validateDomainResearchQuality's own checks", () => {
  assert.match(domainResearchSource, /export function fieldContentHasUnprovenClaim\(text: string\): boolean/);
});

test("plan-executor.ts's parseFullPlanReport now heals (never throws for) a field matching fieldContentHasUnprovenClaim, in the SAME per-field loop as #69A-39A's failure-text check", () => {
  assert.match(
    planExecutorSource,
    /if \(fieldContentHasUnprovenClaim\(sanitizedContent\)\) \{[\s\S]{0,2000}?report\[field\] = ensureCompleteReportText\(\s*\n\s*createPlanFieldFallback\(field, parsed, context, language\)\s*\n\s*\);\s*\n\s*unprovenClaimFields\.push\(field\);\s*\n\s*continue;\s*\n\s*\}/
  );
});

test("a healed unproven-claim field is only ever logged, never thrown, for the whole report", () => {
  assert.match(
    planExecutorSource,
    /if \(unprovenClaimFields\.length\) \{\s*\n\s*logOperationalInfo\("\[api:plan\] replaced unproven-claim field\(s\) with fallback, kept the rest of the report"/
  );
});

test("plan-executor.ts imports fieldContentHasUnprovenClaim from domain-research.ts (the shared source of truth), not a duplicated re-implementation", () => {
  assert.match(
    planExecutorSource,
    /fieldContentHasUnprovenClaim,\s*\n\s*type DomainResearchBundle,/
  );
});

// --- REGRESSION SAFETY: validateDomainResearchQuality's own throwing
//     behavior, and its ~12 other call sites, are completely untouched --

test("SAFETY: validateDomainResearchQuality's own three content-shape checks (unsupported external/labeled/numeric claim) still throw exactly as before for every OTHER caller -- this fix adds a new function, it does not modify the gate", () => {
  assert.match(domainResearchSource, /"Report quality gate failed: an externally verified material claim lacks a source reference\."/);
  assert.match(domainResearchSource, /"Report quality gate failed: a material factual claim lacks source or method provenance\."/);
  assert.match(domainResearchSource, /"Report quality gate failed: unsupported numeric claim lacks evidence and source or method provenance\."/);
});

test("SAFETY: no citation/provenance annotation is fabricated by the fix -- the offending field is replaced with createPlanFieldFallback's own generic, no-vendor-name template, never force-labeled to slip past the gate", () => {
  const fixBlockMatch = planExecutorSource.match(
    /if \(fieldContentHasUnprovenClaim\(sanitizedContent\)\) \{[\s\S]{0,2400}?continue;\s*\n\s*\}/
  );
  assert.ok(fixBlockMatch);
  const executableLines = fixBlockMatch[0]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(executableLines, /Float|Cash Flow Frog|Futrli|Dryrun|Fathom|Jirav|LivePlan|QuickBooks|Xero/i);
  assert.doesNotMatch(executableLines, /\[Verified|\[R\d|\[Asset|\[User|\[Method|\[Basis/);
});

test("SAFETY: Tier 0 structured competitor/Porter extraction reads the raw responseText directly, completely independent of the healed planFields report object -- a healed competitorLandscape prose field can never affect it", () => {
  assert.match(planExecutorSource, /buildBusinessCompetitorLandscapeStateFromStructuredResponse/);
  assert.match(planExecutorSource, /buildPortersFiveForcesStateFromStructuredResponse/);
});

test("SAFETY: an honest total generation failure (every field genuinely unusable) still falls through to the fully-empty, evidence-honest grounded fallback exactly as before", () => {
  assert.match(planExecutorSource, /const shouldUseGroundedFallback = true;/);
  assert.match(planExecutorSource, /createGroundedBusinessTimeoutFallback\(\{/);
});
