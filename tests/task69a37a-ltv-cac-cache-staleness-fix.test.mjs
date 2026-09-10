// TASK #69A-37A -- Fix the remaining real-PDF LTV:CAC narrative
// serialization corruption.
//
// LIVE PROOF (direct database inspection, not assumed): after #69A-37's
// correction-pass fix was written, a fresh localhost PDF STILL showed
// all four malformed strings, byte-for-byte identical across three
// separate report generations (ids 4e4c2547.../6bdb84d0.../a775113c...,
// created at three different timestamps). Identical corruption across
// independent "fresh" generations is the signature of a CACHE HIT, not
// a live generation bug.
//
// ROOT CAUSE: plan-executor.ts's full-report cache stores
// `cacheResponseText = JSON.stringify(parsedReport)`, where
// `parsedReport` is the return value of `parseFullPlanReport`, which
// ALREADY includes a full run of `normalizeFullPlanReport` (and
// therefore of runConsistencyValidationPass) -- i.e. the cache stores
// the report AFTER correction, not the raw AI text before it. The
// FIRST time this exact prompt/fingerprint/contract-version was
// generated (before #69A-37's fix existed), the OLD, buggy
// correctMetricMentions corrupted "LTV:CAC 3" into "LTV:CAC $10kand"/
// "$10kor"/"$10klegal ..." as part of that one-time correction pass,
// and THAT corrupted text was what got cached. Every subsequent
// "regeneration" of the same prompt is a cache HIT that replays this
// already-corrupted text verbatim through `parseFullPlanReport` again
// -- but by then "CAC" no longer looks like a correctable bare mention
// inside "LTV:CAC $10kand" at all (correctly, per #69A-37's own fix),
// so the already-merged corruption simply survives, cache hit after
// cache hit. #69A-37's fix is necessary but insufficient on its own:
// it stops FUTURE corruption but cannot repair TEXT ALREADY BAKED INTO
// AN EXISTING CACHE ENTRY.
//
// FIX (app/lib/report-jobs/plan-executor.ts): BUSINESS_PLAN_GENERATION_
// CONTRACT_VERSION bumped ("weakness-comparison-rules-v5" ->
// "ltv-cac-ratio-integrity-v6"), the established, already-precedented
// mechanism (see #69A-15A/15B/16/28/29/29A's own identical bumps) for
// invalidating a cache entry whose content reflects an outdated
// generation/normalization contract -- forcing a genuinely fresh AI
// call (and therefore a fresh, #69A-37-fixed normalization pass) the
// next time any of these prompts are requested. No change to the
// canonical financial model, decision engine, or any already-correct
// value: CAC/LTV/payback/margin are computed independently of this
// cache key and are unaffected.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

function runPass(sections, metricTargets) {
  const copy = { ...sections };
  const result = runConsistencyValidationPass({
    sections: copy,
    fields: Object.keys(copy),
    language: "English",
    metricTargets,
    metricProtectedFields: [],
  });
  return { sections: copy, corrections: result.correctionsApplied };
}

const CAC_TARGET = { labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" };
const LTV_TARGET = { labelPattern: "LTV", canonicalDisplayValue: "$26k", type: "financial_metric_mismatch" };

// --- The four EXACT live-PDF strings, reconstructed as their likely --
// --- pre-correction originals (a bare "LTV:CAC 3" ratio mention) -----

const LIVE_CASES = [
  {
    label: "Page 5 / Market Opportunity",
    original: "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
    forbidden: /\$10kand/,
  },
  {
    label: "Page 9 / Go-to-Market Plan (the NEW no-conjunction variant)",
    original: "Validation milestones: 10 paid pilots, LTV:CAC 3, legal sign-off.",
    forbidden: /\$10klegal/,
  },
  {
    label: "Page 14 / Founder Roadmap",
    original: "Next 12 months: fundraising conditional on LTV:CAC 3 and legal/compliance clearance.",
    forbidden: /\$10kand/,
  },
  {
    label: "Page 14 / 30-60-90 days Roadmap",
    original: "measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan.",
    forbidden: /\$10kor/,
  },
];

test("[9] all four exact live-PDF narrative patterns are protected by the real, current consistency pass -- including the NEW no-conjunction ('$10klegal') variant this ticket reported", () => {
  for (const { label, original, forbidden } of LIVE_CASES) {
    const { sections, corrections } = runPass({ f: original }, [CAC_TARGET, LTV_TARGET]);
    assert.equal(sections.f, original, `[${label}] expected the LTV:CAC mention to survive completely unchanged`);
    assert.doesNotMatch(sections.f, forbidden, `[${label}] the exact reported malformed substring must never occur`);
    assert.equal(corrections.length, 0, `[${label}] no correction should fire at all for a protected compound-ratio mention`);
  }
});

// --- [8] no "$10klegal" (the one new malformed shape this ticket -----
// --- specifically reports, distinct from #69A-37's "and"/"or" cases) --

test("[8] \"$10klegal\" (no conjunction word at all between the ratio and the next word) can never occur", () => {
  for (const original of [
    "Validation milestones: 10 paid pilots, LTV:CAC 3, legal sign-off.",
    "Validation milestones: 10 paid pilots, LTV:CAC 3 legal sign-off.",
  ]) {
    const { sections } = runPass({ f: original }, [CAC_TARGET]);
    assert.doesNotMatch(sections.f, /\$10klegal/);
    assert.equal(sections.f, original);
  }
});

// --- [1]-[4] composite vs. substring metric matching --------------------

test("[1] \"LTV:CAC >= 3x and ...\" cannot become CAC currency", () => {
  const { sections, corrections } = runPass(
    { f: "Fundraising is conditional on LTV:CAC >= 3x and legal/compliance clearance." },
    [CAC_TARGET]
  );
  assert.equal(sections.f, "Fundraising is conditional on LTV:CAC >= 3x and legal/compliance clearance.");
  assert.equal(corrections.length, 0);
});

test("[2] \"LTV:CAC >= 3x or ...\" preserves the ratio and its separator", () => {
  const { sections } = runPass(
    { f: "Track and measure LTV:CAC; proof: LTV:CAC >= 3x or documented channel plan." },
    [CAC_TARGET]
  );
  assert.equal(sections.f, "Track and measure LTV:CAC; proof: LTV:CAC >= 3x or documented channel plan.");
});

test("[3] standalone \"CAC $10k\" (no LTV: prefix) still resolves/corrects correctly", () => {
  const { sections, corrections } = runPass(
    { f: "CAC is currently 8k but should stabilize near $10k." },
    [CAC_TARGET]
  );
  assert.equal(sections.f, "CAC is currently $10k but should stabilize near $10k.");
  assert.equal(corrections.length, 1);
});

test("[4] standalone \"LTV $26k\" (no :CAC suffix) still resolves/corrects correctly", () => {
  const { sections, corrections } = runPass(
    { f: "LTV is currently 20k, below the $26k target." },
    [LTV_TARGET]
  );
  assert.equal(sections.f, "LTV is currently $26k, below the $26k target.");
  assert.equal(corrections.length, 1);
});

test("[5] composite metric matching wins over substring metric matching for BOTH halves of the compound (CAC and LTV targets applied together)", () => {
  const { sections, corrections } = runPass(
    { f: "LTV:CAC 3 and legal/compliance clearance, while standalone CAC is 8k and LTV is 20k." },
    [CAC_TARGET, LTV_TARGET]
  );
  // The compound mention must survive untouched...
  assert.match(sections.f, /LTV:CAC 3 and legal\/compliance clearance/);
  // ...while the two genuinely standalone mentions later in the SAME
  // sentence are still correctly resolved to their canonical values.
  assert.match(sections.f, /CAC is \$10k/);
  assert.match(sections.f, /LTV is \$26k/);
  assert.equal(corrections.length, 2);
});

// --- [6]/[7] exact malformed strings from #69A-37 remain blocked too ---

test("[6] \"$10kand\" can never occur (regression guard carried over from #69A-37)", () => {
  const { sections } = runPass(
    { f: "Scaling is fundraising conditional on LTV:CAC 3 and legal/compliance clearance." },
    [CAC_TARGET]
  );
  assert.doesNotMatch(sections.f, /\$10kand/);
});

test("[7] \"$10kor\" can never occur (regression guard carried over from #69A-37)", () => {
  const { sections } = runPass(
    { f: "measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan." },
    [CAC_TARGET]
  );
  assert.doesNotMatch(sections.f, /\$10kor/);
});

// --- [10] web/PDF semantic parity remains intact -------------------------

test("[10] the consistency-correction pass still runs exactly once, before persistence -- web and PDF continue to read the SAME already-corrected (and now cache-invalidation-protected) text", () => {
  const occurrences = (planExecutorSource.match(/runConsistencyValidationPass\(/g) || []).length;
  assert.equal(occurrences, 1);
});

// --- Cache-staleness fix proof --------------------------------------------

test("[CACHE FIX PROOF] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped to a value distinct from #69A-29A's own \"weakness-comparison-rules-v5\", invalidating any full-report cache entry whose text was normalized under the pre-#69A-37 buggy consistency pass", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "([^"]+)";/.exec(planExecutorSource);
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.notEqual(match[1], "weakness-comparison-rules-v5", "expected the version string to have changed from #69A-29A's own value");
  assert.match(consistencyMarkerContext(planExecutorSource), /#69A-37A/);
});

function consistencyMarkerContext(source) {
  const index = source.indexOf('const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "');
  // TASK #69A-43 -- widened from 2000, then #69A-51 -- widened again
  // from 6000: each later, legitimate reuse of this exact mechanism
  // (#69A-40A/#69A-41/#69A-43/#69A-44/#69A-45/#69A-47/#69A-50/#69A-51 so
  // far) appends its own explanatory comment before the constant, so the
  // #69A-37A comment this test looks for keeps moving further back -- a
  // fixed small window would eventually fail this test for a reason
  // completely unrelated to what it actually checks.
  return source.slice(Math.max(0, index - 12000), index);
}

test("[CACHE FIX PROOF 2] the cache-write call site still stringifies parsedReport (the POST-normalization report) -- confirms WHY a version bump, not a code-only fix, was required to invalidate already-cached corrupted text", () => {
  assert.match(planExecutorSource, /const cacheResponseText = JSON\.stringify\(parsedReport\);/);
  assert.match(planExecutorSource, /const parsedReport = parseFullPlanReport\(/);
});

test("[CACHE FIX PROOF 3] parseFullPlanReport is invoked identically from both the cache-hit path and the fresh-generation path -- confirms the SAME normalization/correction pass (and therefore #69A-37's fix) applies uniformly regardless of cache status", () => {
  const occurrences = (planExecutorSource.match(/parseFullPlanReport\(/g) || []).length;
  // Declaration + the "{}" skeleton call + cache-hit call + fresh-
  // generation call (at minimum) -- both real report-producing call
  // sites must exist; a drop to fewer would mean one path stopped
  // normalizing its report at all.
  assert.ok(occurrences >= 4, `expected at least 4 occurrences (declaration + skeleton + cache-hit + fresh-generation), found ${occurrences}`);
});

// --- Decision/regression safety -------------------------------------------

test("no decision-engine, confidence, Founder-Readiness, Porter's Five Forces, Benchmark Intelligence, or Competitor Landscape file carries a #69A-37A marker -- this is a cache-versioning fix only, on top of #69A-37's own serialization fix", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/decision-intelligence/profiles.ts",
    "app/dashboard/[id]/ReportPdfButton.tsx",
    "components/Planner.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-37A/, `${relativePath} should not carry a #69A-37A marker`);
  }
});

test("the fix's own diff surface in plan-executor.ts is confined to the BUSINESS_PLAN_GENERATION_CONTRACT_VERSION constant and its own explanatory comment -- no change to canonical financial computation, decision logic, or the consistency-pass call site's own arguments", () => {
  assert.match(planExecutorSource, /const consistencyResult = runConsistencyValidationPass\(\{/);
  assert.match(planExecutorSource, /metricTargets: buildPlanFinancialConsistencyTargets\(context\)/);
});
