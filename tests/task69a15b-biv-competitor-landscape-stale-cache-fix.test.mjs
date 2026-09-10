// TASK #69A-15B -- Trace and fix the real runtime loss of structured BIV
// competitor fields.
//
// ROOT CAUSE (proven via direct production-database inspection, not
// inferred from tests): #69A-15A's schema enforcement was NEVER the
// problem. A fresh "regeneration" for an existing business idea does not
// necessarily call the model at all -- plan-executor.ts's full-report path
// first computes fullReportCacheKey via createPreResearchReportCacheKey and
// serves getCachedAiResponse's hit if one exists. That cache key
// (research-cache.ts's createPreResearchReportCacheKey -> governance.ts's
// createAiCacheKey) is built from the business idea text, the financial
// assumptions version/fingerprint, and a `reportVariant` string -- NOTHING
// in it changes when the business-plan GENERATION CONTRACT itself changes
// (a new prompt convention in #69A-15, then real schema enforcement in
// #69A-15A). Three real production reports generated minutes apart on
// 2026-09-06, all believed by the user to be "fresh", turned out to have
// BYTE-IDENTICAL competitorLandscape prose (1483 chars) matching exactly
// one ai_response_cache row written on 2026-09-05 -- BEFORE #69A-15/15A
// existed -- and NONE of the three had a businessCompetitorLandscapeState
// key in metadata at all. The schema-enforced generation call was never
// even reached for these requests: the stale cache entry satisfied the
// (unchanged) cache key first, every time, for as long as that entry's TTL
// lasts (7 days), permanently starving the new schema/prompt of ever
// running against this business idea again.
//
// FIX: plan-executor.ts's business-plan reportVariant string (the ONLY
// call site with reportFamily "business_plan") now includes a dedicated
// BUSINESS_PLAN_GENERATION_CONTRACT_VERSION tag ("competitor-structured-
// v1"), following the exact versioning idiom already used by
// canonicalFinancialAssumptions.version in the same string. Bumping it
// changes the cache key for every future generation-contract change,
// forcing a genuine fresh model call (and hence Tier 0 schema-enforced
// competitor extraction) instead of silently replaying a pre-contract-
// change cached response forever. The three other createPreResearchReport-
// CacheKey call sites (real_estate, domain_decision_analysis x2) are
// untouched -- they never requested competitorLandscapeStructured and so
// have no stale-cache exposure from this specific contract change.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const researchCacheSource = readFileSync(join(repoRoot, "app/lib/ai/research-cache.ts"), "utf8");
const governanceSource = readFileSync(join(repoRoot, "app/lib/ai/governance.ts"), "utf8");

// research-cache.ts starts with `import "server-only"` (blocks direct
// import under plain `node --test`, same limitation documented in
// task69a15a's test file) and governance.ts pulls in Supabase/Next.js
// path-aliased modules that are equally unresolvable here. Following this
// codebase's own established convention for exactly this problem
// (market-intelligence-canonical-state-cache-propagation.test.mjs tests
// governance.ts purely via source-text assertions), the pure hashing logic
// is mirrored locally and verified byte-for-byte against the real source
// below, then used to PROVE the actual collision/fix on real inputs.
function hashAiPayloadMirror(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeAiPromptMirror(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function createAiCacheKeyMirror(parts) {
  const normalizedParts = {
    operationType: parts.operationType ?? "mirror-fixed-for-test",
    endpoint: parts.endpoint,
    inputHash: hashAiPayloadMirror(parts.normalizedPrompt),
    mode: parts.mode,
    language: parts.language,
    model: parts.model,
    options: parts.options
      ? Object.keys(parts.options)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = parts.options?.[key];
            return sorted;
          }, {})
      : {},
  };
  return hashAiPayloadMirror(JSON.stringify(normalizedParts));
}

function serializeIdentityMirror(identity) {
  return JSON.stringify({
    normalizedPrompt: normalizeAiPromptMirror(identity.normalizedPrompt),
    uploadedAssetHash: identity.uploadedAssetHash || "",
    analysisMode: identity.analysisMode,
    language: identity.language,
    reportFamily: identity.reportFamily,
  });
}

const REPORT_CACHE_VERSION_MIRROR = "pre-research-report-v1";

function createPreResearchReportCacheKeyMirror(input) {
  return createAiCacheKeyMirror({
    endpoint: input.endpoint,
    normalizedPrompt: serializeIdentityMirror(input.identity),
    mode: `${REPORT_CACHE_VERSION_MIRROR}:${input.identity.reportFamily}:${input.reportVariant}`,
    language: input.identity.language,
    model: input.model,
    options: {
      analysisMode: input.identity.analysisMode,
      contextFingerprint: input.contextFingerprint || "",
      uploadedAssetHash: input.identity.uploadedAssetHash,
    },
  });
}

// --- Mirror fidelity: prove the mirror matches the REAL source exactly --

test("mirror fidelity: governance.ts's real createAiCacheKey hashes exactly {operationType, endpoint, inputHash, mode, language, model, options} with sorted option keys", () => {
  assert.match(
    governanceSource,
    /const normalizedParts = \{\s*\n\s*operationType: parts\.operationType[\s\S]{0,200}\n\s*endpoint: parts\.endpoint,\s*\n\s*inputHash: hashAiPayload\(parts\.normalizedPrompt\),\s*\n\s*mode: parts\.mode,\s*\n\s*language: parts\.language,\s*\n\s*model: parts\.model,/
  );
  assert.match(governanceSource, /return hashAiPayload\(JSON\.stringify\(normalizedParts\)\);/);
});

test("mirror fidelity: research-cache.ts's real createPreResearchReportCacheKey builds `mode` as `${REPORT_CACHE_VERSION}:${identity.reportFamily}:${reportVariant}` -- the exact string this fix's new version tag must flow through", () => {
  assert.match(
    researchCacheSource,
    /mode: `\$\{REPORT_CACHE_VERSION\}:\$\{input\.identity\.reportFamily\}:\$\{input\.reportVariant\}`,/
  );
  assert.match(researchCacheSource, /const REPORT_CACHE_VERSION = "pre-research-report-v1";/);
});

// --- Fail-before proof: reproduce the actual staleness mechanism --------

test("fail-before proof: WITHOUT this fix's contract version tag, two requests for the identical business idea produce the SAME cache key even though the generation contract (schema/prompt) changed between them -- this is exactly why the 2026-09-05 pre-#69A-15A cache entry kept being served to 'fresh' 2026-09-06 requests", () => {
  const sharedIdentity = {
    normalizedPrompt: "an AI-powered cash flow forecasting tool for SMBs",
    uploadedAssetHash: "",
    analysisMode: "standard",
    language: "en",
    reportFamily: "business_plan",
  };
  const financialAssumptionsVersion = "v3";
  const financialAssumptionsFingerprint = "abc123";

  // The OLD (pre-#69A-15B) reportVariant shape -- no contract version tag.
  const oldStyleReportVariant = `fullReport:${financialAssumptionsVersion}:${financialAssumptionsFingerprint}`;

  const preFixCacheKey = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant: oldStyleReportVariant,
  });

  // A "fresh" request made AFTER #69A-15/15A changed the prompt and schema
  // -- but before this fix, plan-executor.ts still computed the SAME
  // oldStyleReportVariant string, because nothing about the generation
  // contract change was reflected in it.
  const postContractChangeCacheKeyWithoutFix = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant: oldStyleReportVariant,
  });

  assert.equal(
    preFixCacheKey,
    postContractChangeCacheKeyWithoutFix,
    "without a contract version tag, a stale pre-contract-change cache entry collides with (and is served to) every later request for the same idea, regardless of prompt/schema changes"
  );
});

// --- Fix proof: the new contract version tag busts the stale cache ------

test("fix proof: plan-executor.ts declares a dedicated BUSINESS_PLAN_GENERATION_CONTRACT_VERSION constant and appends it to the business-plan reportVariant string", () => {
  // Version-tolerant: this constant is DESIGNED to be bumped again by a
  // later ticket whenever the generation contract changes again (see
  // TASK #69A-16, which bumped v1 -> v2 for a prompt-only change, and
  // TASK #69A-28, which renamed/bumped it again to "porter-structured-v3"
  // for its own schema-enforcement change) -- this test's own concern is
  // that the mechanism exists and is wired correctly, never the exact
  // version string or naming convention, which the ticket owning the
  // actual contract change is expected to choose and bump.
  assert.match(
    planExecutorSource,
    /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "[^"]+";/
  );
  assert.match(
    planExecutorSource,
    /reportVariant: `\$\{FULL_REPORT_FIELD\}:\$\{canonicalFinancialAssumptions\.version\}:\$\{canonicalFinancialAssumptions\.fingerprint\}:\$\{BUSINESS_PLAN_GENERATION_CONTRACT_VERSION\}`,/
  );
});

test("fix proof: with the new contract version tag appended, the SAME business idea/model/financial-assumptions now produces a DIFFERENT cache key than the old (pre-fix) shape -- so any cache entry written before this fix (including the real 2026-09-05 entry) becomes a guaranteed miss, forcing a genuine model call", () => {
  const sharedIdentity = {
    normalizedPrompt: "an AI-powered cash flow forecasting tool for SMBs",
    uploadedAssetHash: "",
    analysisMode: "standard",
    language: "en",
    reportFamily: "business_plan",
  };
  const financialAssumptionsVersion = "v3";
  const financialAssumptionsFingerprint = "abc123";

  const preFixCacheKey = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant: `fullReport:${financialAssumptionsVersion}:${financialAssumptionsFingerprint}`,
  });

  const postFixCacheKey = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant: `fullReport:${financialAssumptionsVersion}:${financialAssumptionsFingerprint}:competitor-structured-v1`,
  });

  assert.notEqual(preFixCacheKey, postFixCacheKey, "the fix must change the cache key so stale pre-fix entries miss");
});

test("fix proof: the contract version tag is a fixed literal (not derived from request-specific input), so it does not fragment caching for UNCHANGED requests made after this fix -- two post-fix requests for the same idea still collide (real caching still works)", () => {
  const sharedIdentity = {
    normalizedPrompt: "an AI-powered cash flow forecasting tool for SMBs",
    uploadedAssetHash: "",
    analysisMode: "standard",
    language: "en",
    reportFamily: "business_plan",
  };
  const reportVariant = "fullReport:v3:abc123:competitor-structured-v1";

  const firstCall = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant,
  });
  const secondCall = createPreResearchReportCacheKeyMirror({
    endpoint: "/api/plan",
    identity: sharedIdentity,
    model: "gpt-5-mini",
    reportVariant,
  });

  assert.equal(firstCall, secondCall, "identical post-fix requests must still cache-hit each other -- this fix must not disable caching entirely");
});

// --- Scope proof: only the business_plan call site is touched -----------

test("scope proof: only the business_plan reportFamily call site references BUSINESS_PLAN_GENERATION_CONTRACT_VERSION -- real_estate and domain_decision_analysis call sites are untouched", () => {
  const reportFamilyLines = [...planExecutorSource.matchAll(/reportFamily: [^\n,]+,/g)].map((m) => m[0]);
  assert.ok(reportFamilyLines.some((line) => line.includes('"business_plan"')));
  assert.ok(reportFamilyLines.some((line) => line.includes("_decision_analysis")));
  assert.ok(reportFamilyLines.some((line) => line.includes('"real_estate"')));

  const contractVersionUsageCount = (
    planExecutorSource.match(/BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/g) || []
  ).length;
  // Exactly one declaration + one usage inside the reportVariant template.
  assert.equal(contractVersionUsageCount, 2, "the contract version tag must be declared once and used exactly once, at the business_plan call site only");
});

test("scope proof: the real_estate and domain_decision_analysis createPreResearchReportCacheKey call sites' reportVariant strings do not reference BUSINESS_PLAN_GENERATION_CONTRACT_VERSION", () => {
  const cacheKeyCallSites = [...planExecutorSource.matchAll(/const \w+ = createPreResearchReportCacheKey\(\{[\s\S]{0,600}?\}\);/g)].map((m) => m[0]);
  assert.ok(cacheKeyCallSites.length >= 4, `expected at least 4 createPreResearchReportCacheKey call sites, found ${cacheKeyCallSites.length}`);
  // The business-plan full-report call site is the only one assigned to
  // `fullReportCacheKey` -- every other call site (real_estate x1,
  // domain_decision_analysis x2) is assigned to a plain `cacheKey`.
  const businessSites = cacheKeyCallSites.filter((site) => site.includes("fullReportCacheKey ="));
  const nonBusinessSites = cacheKeyCallSites.filter((site) => !site.includes("fullReportCacheKey ="));
  assert.equal(businessSites.length, 1, "expected exactly one business-plan (fullReportCacheKey) call site");
  assert.match(businessSites[0], /BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/);
  assert.equal(nonBusinessSites.length, 3, "expected exactly three non-business-plan call sites (real_estate, domain_decision_analysis x2)");
  for (const site of nonBusinessSites) {
    assert.doesNotMatch(site, /BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/);
  }
});

// --- Preserve #69A-15A's own logic (drift check) -------------------------

test("preserves #69A-15A: the Tier 0 schema-enforced generation call, its schema, and the cache-hit precedence (structured state before Tier 1 prose parse) are unchanged by this fix -- this task only changed cache-key staleness, never the extraction/precedence logic itself", () => {
  // Field-list-tolerant: TASK #69A-28 legitimately appended a second,
  // unrelated schema-enforced key ("portersFiveForcesStructured") to
  // this SAME array; this test's own concern is only that
  // competitorLandscapeStructured itself is still requested.
  assert.match(
    planExecutorSource,
    /format: createFullReportJsonSchema\(\s*\n\s*"zerinix_business_plan_report",\s*\n\s*\[\.\.\.planFields, "competitorLandscapeStructured"(?:, "portersFiveForcesStructured")?\],/
  );
  assert.match(
    planExecutorSource,
    /cachedBusinessCompetitorLandscapeState \|\|\s*\n\s*buildBusinessCompetitorLandscapeState\(parsedCachedReport\.competitorLandscape\)/
  );
  // TASK #69A-40B -- this Tier 0/Tier 1 expression is now wrapped in
  // enrichCompetitorWeaknessesFromEvidence(...) (a deterministic,
  // evidence-based safety net for competitors Tier 0/Tier 1 left
  // "unavailable" -- see that task's own tests) -- the underlying
  // Tier 0 || Tier 1 fallback logic itself is unchanged.
  assert.match(
    planExecutorSource,
    /buildBusinessCompetitorLandscapeStateFromStructuredResponse\(\s*\n\s*structuredCompetitorLandscapeResponse\s*\n\s*\) \|\| buildBusinessCompetitorLandscapeState\(parsedReport\.competitorLandscape\),/
  );
});

test("preserves authority: no canonical decision/confidence/evidence-provenance/Founder-Readiness/Benchmark-Intelligence/TAM-SAM-SOM/financial/risk/report-completion/Market-Intelligence file carries a #69A-15B marker", () => {
  for (const relativePath of [
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/ai/market-intelligence-graph.ts",
    "app/lib/ai/vendor-intelligence.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-15B/);
  }
});
