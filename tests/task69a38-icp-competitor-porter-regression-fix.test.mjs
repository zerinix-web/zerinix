// TASK #69A-38 -- Diagnose and fix the fresh-report regression affecting
// ICP, Competitor Landscape, and Porter's Five Forces.
//
// ROOT CAUSE 1 (ICP misclassification), confirmed by direct regex
// reproduction against the exact reported prompt: financial-model.ts's
// targetCustomer classifier (inferFinancialModelingInputs) is pure
// first-match-wins keyword bucketing with no specificity ranking, and its
// existing patterns were not plural-safe. "small and medium-sized
// businesses" matched NEITHER the SMB bucket (`small business` requires
// the literal adjacent phrase; `smb` never matches plural "SMBs") NOR the
// generic `business` bucket (`\bbusiness\b` requires a boundary
// immediately after the match, which a trailing "es" breaks) -- so an
// unrelated bucket won by default (the "premium" POSITIONING adjective
// present elsewhere in the same prompt, or, for slightly different
// phrasing, the generic "B2B / enterprise customers" bucket once a
// singular "business"/"company" token appeared). FIX: every explicit
// customer-segment signal (SMB/SME, mid-market, consumer/B2C, professional
// services) is now checked BEFORE the generic business/enterprise
// catch-all and BEFORE the premium/luxury positioning bucket, and every
// pattern is plural-safe.
//
// ROOT CAUSE 2 (Porter's Five Forces degrading to "some empty, some
// duplicated generic text"), confirmed by tracing the exact consumption
// path: buildPortersFiveForcesStateFromStructuredResponse (Tier 0)
// requires ALL 5 forces well-formed or returns null; when null, every
// renderer previously fell through to its OWN independent legacy
// per-force regex scan of the single free-text portersFiveForces field --
// reproducing the EXACT pre-#69A-28 defect (this task's own history)
// whenever that prose is one uneven paragraph that only substantively
// discusses 2 of the 5 forces (as createPlanFieldFallback's own
// portersFiveForces template does, by construction, whenever the AI
// leaves that field blank). FIX: a new Tier 1,
// buildPortersFiveForcesStateFromLegacyProse, synthesized once at
// generation time (both the fresh-generation and cache-hit call sites in
// plan-executor.ts), guarantees exactly 5 independent, well-formed force
// records -- real extracted content where the prose genuinely supports
// it, the SAME honest "Insufficient evidence" sentence Tier 0 already
// uses everywhere else.
//
// COMPETITOR LANDSCAPE: traced end-to-end (research query construction in
// decision-intelligence/research-plan.ts, domain-research.ts's
// buildTaskStageQueries, and the Tier 0/Tier 1 read in
// business-competitor-landscape-state.ts) -- no code-level defect found
// that discards or rejects valid competitor evidence; targetCustomer's
// classification does not feed competitor search queries at all (they use
// the raw prompt text or verified extracted facts, never the ICP bucket).
// The empty state observed for this one report is consistent with the
// SAME per-field AI-generation event that left portersFiveForces blank
// (both fields are adjacent entries in the same single JSON response) --
// not a distinguishable code defect of its own. Per this task's explicit
// instruction, no competitor-discovery logic was changed and no
// competitor was fabricated; the honest empty state remains correct
// whenever evidence is genuinely absent.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inferFinancialModelingInputs } from "../app/lib/ai/financial-model.ts";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import {
  buildPortersFiveForcesStateFromLegacyProse,
  buildPortersFiveForcesStateFromStructuredResponse,
  PORTER_FORCE_ORDER,
} from "../app/lib/report-engine/porters-five-forces-state.ts";
import crypto from "node:crypto";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
// research-cache.ts (and governance.ts, which it depends on) pulls in a
// "server-only" Supabase/logging dependency chain with an extensionless
// relative import ("./logging") this test runner's path-alias hook can't
// resolve directly (the established convention across existing tests --
// e.g. research-preflight-cache.test.mjs -- is to read these files as
// source text, or import the dependency-free research-cache-core.ts,
// instead of importing research-cache.ts/governance.ts themselves).
const researchCacheSource = readFileSync(join(repoRoot, "app/lib/ai/research-cache.ts"), "utf8");

// Mirrors governance.ts's own normalizeAiPrompt/createAiCacheKey exactly
// (confirmed against the real source below in [3b]) -- reimplemented
// inline rather than importing governance.ts, for the same dependency-
// chain reason as researchCacheSource above.
function normalizeAiPrompt(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
function hashAiPayload(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function createAiCacheKey(parts) {
  return JSON.stringify({
    endpoint: parts.endpoint,
    inputHash: hashAiPayload(parts.normalizedPrompt),
    mode: parts.mode,
    language: parts.language,
    model: parts.model,
    options: parts.options ?? {},
  });
}

const REPORTED_PROMPT =
  "premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS for small and medium-sized businesses in the United States.";

// --- [1] Explicit SMB input does not become enterprise --------------------

test("[1] the exact reported prompt no longer classifies target customer as B2B / enterprise customers", () => {
  const inputs = inferFinancialModelingInputs(REPORTED_PROMPT);
  assert.notEqual(inputs.targetCustomer, "B2B / enterprise customers");
  assert.equal(inputs.targetCustomer, "startups and SMBs");
});

test("[1b] FAIL-BEFORE PROOF: the OLD classifier ordering (reconstructed inline, not git-dependent) really did produce the wrong bucket for this prompt", () => {
  function firstMatchingOld(matches, fallback, value) {
    return matches.find(([pattern]) => pattern.test(value))?.[1] ?? fallback;
  }
  const normalized = REPORTED_PROMPT.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const oldResult = firstMatchingOld(
    [
      [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "premium coffee consumers, office buyers, boutique HoReCa accounts"],
      [/\b(hospital|clinic|doctor|patient|healthcare)\b/, "healthcare buyers / operators"],
      [/\b(enterprise|b2b|company|companies|business)\b/, "B2B / enterprise customers"],
      [/\b(luxury|premium|affluent|private|yacht|hotel)\b/, "premium consumer / high-net-worth customers"],
      [/\b(founder|startup|smb|small business)\b/, "startups and SMBs"],
      [/\b(government|public sector|municipal)\b/, "public-sector buyers"],
      [/\b(commuter|commuters|student|students|urban|city|tourist|tourists|rider|riders)\b/, "urban riders / commuters"],
    ],
    "inferred early adopters",
    normalized
  );
  assert.notEqual(oldResult, "startups and SMBs", "the OLD ordering never reached the SMB bucket correctly for this exact prompt");
});

test("[1c] additional plural/longhand SMB phrasings are all correctly classified", () => {
  for (const prompt of [
    "AI-powered financial planning and cash-flow forecasting SaaS for SMBs in the United States.",
    "A premium AI-powered financial planning SaaS built for small and medium-sized business owners.",
    "Financial planning software for SMEs.",
    "Financial planning software for small and medium enterprises.",
  ]) {
    assert.equal(inferFinancialModelingInputs(prompt).targetCustomer, "startups and SMBs", prompt);
  }
});

test("[1d] explicit segment distinctions are preserved: mid-market, consumer/B2C, professional/service firms, and genuine enterprise/B2B are never collapsed into each other", () => {
  assert.equal(inferFinancialModelingInputs("A financial planning platform for mid-market companies.").targetCustomer, "mid-market companies");
  assert.equal(inferFinancialModelingInputs("A budgeting app for individual consumers to track personal spending.").targetCustomer, "individual consumers");
  assert.equal(inferFinancialModelingInputs("Practice management software for accounting firms.").targetCustomer, "professional and service firms");
  assert.equal(inferFinancialModelingInputs("Enterprise procurement software for large companies.").targetCustomer, "B2B / enterprise customers");
});

test("[1e] no regression to previously-correct verticals (coffee, healthcare, luxury, mobility, government, generic fallback)", () => {
  assert.equal(inferFinancialModelingInputs("premium coffee roastery selling specialty coffee.").targetCustomer, "premium coffee consumers, office buyers, boutique HoReCa accounts");
  assert.equal(inferFinancialModelingInputs("A healthcare app for hospitals and clinics.").targetCustomer, "healthcare buyers / operators");
  assert.equal(inferFinancialModelingInputs("luxury yacht charter service for affluent clients.").targetCustomer, "premium consumer / high-net-worth customers");
  assert.equal(inferFinancialModelingInputs("A scooter rental app for urban commuters and students.").targetCustomer, "urban riders / commuters");
  assert.equal(inferFinancialModelingInputs("A compliance platform for government and municipal agencies.").targetCustomer, "public-sector buyers");
  assert.equal(inferFinancialModelingInputs("A generic productivity tool with no named segment.").targetCustomer, "inferred early adopters");
});

// --- [2] Explicit customer segment survives into GTM/pricing fallback text -

test("[2] every narrative fallback field that names a target-customer label reads context.inputs.targetCustomerDescriptor -- the SAME corrected classifier output's richer, report-facing form -- never a second, independent classification", () => {
  // TASK #69A-60 -- redirected from the coarse context.inputs.targetCustomer
  // (a benchmark-lookup enum value, e.g. "startups and SMBs") to
  // context.inputs.targetCustomerDescriptor (the richer, report-facing
  // form of that SAME classifier output, e.g. "United States small and
  // medium-sized businesses (10-200 employees)") -- see that ticket's own
  // fix. Still one single classification, never a second one.
  const targetCustomerLabelDeclaration = planExecutorSource.match(/const targetCustomerLabel = context\?\.inputs\.targetCustomerDescriptor \|\| "[^"]+";/);
  assert.ok(targetCustomerLabelDeclaration, "expected exactly one targetCustomerLabel declaration sourced from context.inputs.targetCustomerDescriptor");
  const usages = (planExecutorSource.match(/\$\{targetCustomerLabel\}/g) || []).length;
  assert.ok(usages >= 5, `expected targetCustomerLabel to be reused across multiple GTM/pricing/Porter/roadmap fallback fields, found ${usages} usages`);
});

// --- [3] Research/cache identity distinguishes materially different ICPs --

test("[3] the research-cache identity (normalizedPrompt) is derived from the raw prompt text -- an SMB-described business and an enterprise-described business produce DIFFERENT cache keys even though the (now-fixed) targetCustomer bucket is not part of the key at all", () => {
  // Mirrors createPreResearchReportCacheKey's own construction exactly
  // (research-cache.ts:349-361: createAiCacheKey with
  // normalizedPrompt: serializeIdentity(identity)) -- reimplemented here
  // against the lighter, directly-importable createAiCacheKey rather than
  // importing research-cache.ts itself (see this file's own header
  // comment on why).
  function serializeIdentity(identity) {
    return JSON.stringify({
      normalizedPrompt: identity.normalizedPrompt,
      uploadedAssetHash: identity.uploadedAssetHash,
      analysisMode: identity.analysisMode,
      language: identity.language,
      reportFamily: identity.reportFamily,
    });
  }
  function buildKey(prompt) {
    const identity = {
      normalizedPrompt: normalizeAiPrompt(prompt),
      uploadedAssetHash: "none",
      analysisMode: "business_plan",
      language: "English",
      reportFamily: "business_plan",
    };
    return createAiCacheKey({
      endpoint: "/api/plan",
      normalizedPrompt: serializeIdentity(identity),
      mode: `pre-research-report-v1:${identity.reportFamily}:v1`,
      language: identity.language,
      model: "gpt-test",
      options: { analysisMode: identity.analysisMode, contextFingerprint: "", uploadedAssetHash: identity.uploadedAssetHash },
    });
  }

  const smbKey = buildKey("AI-powered financial planning SaaS for small and medium-sized businesses in the United States.");
  const enterpriseKey = buildKey("AI-powered financial planning SaaS for large enterprise customers in the United States.");

  assert.notEqual(smbKey, enterpriseKey, "materially different ICPs described in the raw prompt must never collide on the same cache key");
});

test("[3b] research-cache.ts's own createPreResearchReportCacheKey genuinely builds its key from serializeIdentity(identity), which includes normalizedPrompt -- structural proof the real implementation matches what [3] verified against the reimplementation", () => {
  assert.match(researchCacheSource, /normalizedPrompt:\s*serializeIdentity\(input\.identity\)/);
  assert.match(researchCacheSource, /function serializeIdentity\(identity: ResearchCacheIdentity\)/);
});

test("[3c] governance.ts's real normalizeAiPrompt/createAiCacheKey match this test's inline reimplementation (structural proof, not a duplicate implementation drifting silently out of sync)", () => {
  const governanceSource = readFileSync(join(repoRoot, "app/lib/ai/governance.ts"), "utf8");
  assert.match(governanceSource, /export function normalizeAiPrompt\(value: string\) \{\s*\n\s*return value\.trim\(\)\.replace\(\/\\s\+\/g, " "\)\.toLocaleLowerCase\("en-US"\);/);
  assert.match(governanceSource, /inputHash: hashAiPayload\(parts\.normalizedPrompt\)/);
});

// --- [4] Valid structured competitors survive into the final report -------

test("[4] real, evidence-backed structured competitors survive Tier 0 unchanged", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs", strengths: "Strong SMB adoption", weaknesses: "Limited scenario depth", weaknessBasis: "directional", threat: "Medium" },
    { company: "Fathom", type: "Direct competitor", positioning: "Financial reporting and analysis", strengths: "Broad integrations", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  assert.ok(state);
  assert.equal(state.competitors.length, 2);
  assert.equal(state.competitors[0].company, "Float");
  assert.equal(state.competitors[1].company, "Fathom");
});

// --- [5] Honest competitor empty state still works when evidence is absent

test("[5] a genuinely empty evidence-backed competitor array still resolves to null (the honest empty state), never a fabricated entry", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([]);
  assert.equal(state, null);
});

test("[5b] the competitorLandscape per-field fallback template (source-level) never hardcodes a specific company name -- it must stay a generic, honest placeholder so it can never fabricate a competitor when the model leaves the field blank", () => {
  const match = planExecutorSource.match(/competitorLandscape:\s*`([^`]+)`/);
  assert.ok(match, "expected to find the competitorLandscape fallback template");
  const template = match[1];
  for (const knownCompetitor of ["Float", "Fathom", "Futrli", "Jirav", "Causal", "Finmark"]) {
    assert.ok(!template.includes(knownCompetitor), `fallback template must not hardcode "${knownCompetitor}"`);
  }
});

// --- [6] All five Porter forces survive final assembly --------------------

test("[6] buildPortersFiveForcesStateFromLegacyProse always returns exactly 5 forces, never null, never partial", () => {
  for (const prose of ["", "no force-related content at all", "Rivalry is high."]) {
    const state = buildPortersFiveForcesStateFromLegacyProse(prose);
    assert.ok(state);
    assert.equal(Object.keys(state.forces).length, 5);
    for (const key of PORTER_FORCE_ORDER) {
      assert.ok(state.forces[key], `expected ${key} to be present`);
      assert.ok(state.forces[key].analysis.trim().length > 0, `expected ${key} to have non-empty analysis`);
      assert.ok(state.forces[key].implication.trim().length > 0, `expected ${key} to have non-empty implication`);
    }
  }
});

test("[6b] the EXACT reported broken shape (a fallback paragraph only discussing buyer power and new entrants) now yields 5 well-formed forces instead of 3 empty + 2 duplicated", () => {
  const brokenProse =
    "Within the AI software / automation industry, the forces most likely to shape this business are buyer power (given the alternatives available to startups and SMBs) and the ease of new entrants given the detected subscription software model. The key question is whether a defensible wedge can be built before competitive or switching pressure rises.";
  const state = buildPortersFiveForcesStateFromLegacyProse(brokenProse);

  for (const key of ["competitiveRivalry", "supplierPower", "threatOfSubstitutes"]) {
    assert.equal(state.forces[key].level, "Insufficient evidence", `${key} was never discussed and must be honestly marked, not left empty`);
    assert.match(state.forces[key].analysis, /Insufficient evidence to assess/i);
  }
  assert.notEqual(state.forces.threatOfNewEntrants.analysis, "");
  assert.notEqual(state.forces.buyerPower.analysis, "");
});

// --- [7] Porter forces cannot silently collapse into duplicated generic ---
// --- fallback text ----------------------------------------------------

test("[7] two forces genuinely discussed in DIFFERENT sentences never end up with byte-identical analysis text, and a force with no signal never copies another force's text", () => {
  const richProse =
    "Competitive rivalry is high given many established SaaS players. Threat of new entrants is moderate due to capital requirements. Buyer power is high since SMBs can switch tools easily. Supplier power is low as cloud infrastructure is commoditized. Threat of substitutes is moderate given spreadsheets remain viable.";
  const state = buildPortersFiveForcesStateFromLegacyProse(richProse);

  const analyses = PORTER_FORCE_ORDER.map((key) => state.forces[key].analysis);
  const uniqueAnalyses = new Set(analyses);
  assert.equal(uniqueAnalyses.size, analyses.length, "every force with genuine independent signal must have distinct analysis text");

  const levels = PORTER_FORCE_ORDER.map((key) => state.forces[key].level);
  assert.deepEqual(levels, ["High", "Moderate", "High", "Low", "Moderate"]);
});

test("[7b] forces with NO signal at all share the SAME honest fallback sentence (by design, not fabrication) -- but this is only reached when genuinely nothing was extracted for that specific force", () => {
  const state = buildPortersFiveForcesStateFromLegacyProse("Rivalry is high among incumbents.");
  assert.notEqual(state.forces.competitiveRivalry.level, "Insufficient evidence");
  for (const key of ["threatOfNewEntrants", "buyerPower", "supplierPower", "threatOfSubstitutes"]) {
    assert.equal(state.forces[key].level, "Insufficient evidence");
  }
});

// --- [8] Web/PDF consume the same canonical Porter/competitor states ------

test("[8] readPortersFiveForcesState/readBusinessCompetitorLandscapeState remain the single canonical read functions -- both structured states are persisted once, at generation time, and every renderer consumes the SAME value, never re-deriving it independently", () => {
  for (const file of ["app/dashboard/[id]/page.tsx", "components/Planner.tsx", "app/dashboard/[id]/ReportPdfButton.tsx"]) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    assert.ok(
      source.includes("readPortersFiveForcesState") || source.includes("portersFiveForcesState"),
      `${file} should consume the canonical portersFiveForcesState`
    );
  }
});

test("[8b] the new Tier 1 Porter synthesis is wired into ALL THREE persistence/generation call sites (fresh generation, cache hit, and #69A-38F's own timeout/quality-gate-failure fallback), so web and PDF never see a different completeness guarantee depending on how the report was produced", () => {
  const occurrences = (planExecutorSource.match(/buildPortersFiveForcesStateFromLegacyProse\(/g) || []).length;
  assert.equal(occurrences, 3, "expected exactly 3 call sites: fresh generation, cache-hit, and the timeout-fallback path");
});

// --- [9] No regression to #69A-37A financial serialization ----------------

test("[9] report-consistency-validation.ts (the #69A-37/#69A-37A LTV:CAC fix) was not touched by THIS task's (#69A-38) diff -- matched precisely so the later, legitimate #69A-38E ticket's own markers on this same file are never mistaken for this one", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-consistency-validation.ts"), "utf8");
  assert.doesNotMatch(source, /#69A-38(?![A-Z])/);
});

test("[9b] BUSINESS_PLAN_GENERATION_CONTRACT_VERSION still reflects #69A-37A's cache-invalidating bump, untouched by this task", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "([^"]+)";/.exec(planExecutorSource);
  assert.ok(match);
  // Pinned to "v6" by this task (#69A-38); #69A-40A later bumped it again
  // (v6 -> v7) for an unrelated later fix (a stale pre-#69A-40 full-
  // report cache entry) using this exact same established mechanism --
  // assert it is still the "ltv-cac-ratio-integrity" family at v6 or
  // later, rather than pinning a since-superseded exact string, so a
  // later legitimate bump doesn't fail this task's own drift check.
  const versionMatch = /^ltv-cac-ratio-integrity-v(\d+)$/.exec(match[1]);
  assert.ok(versionMatch, `expected the ltv-cac-ratio-integrity version family, got "${match[1]}"`);
  assert.ok(Number(versionMatch[1]) >= 6, "expected the version to be at least v6 (this task's own bump)");
});

// --- [10] No unsupported competitor/Porter claims are invented ------------

test("[10] every force the legacy-prose synthesis cannot support gets the EXACT same honest sentence Tier 0 already uses -- never a fabricated rating or invented implication", () => {
  const state = buildPortersFiveForcesStateFromLegacyProse("completely unrelated text with no force signal whatsoever");
  for (const key of PORTER_FORCE_ORDER) {
    const label = key === "competitiveRivalry" ? "competitive rivalry"
      : key === "threatOfNewEntrants" ? "threat of new entrants"
      : key === "buyerPower" ? "buyer power"
      : key === "supplierPower" ? "supplier power"
      : "threat of substitutes";
    assert.equal(state.forces[key].analysis, `Insufficient evidence to assess ${label} for this business.`);
    assert.equal(state.forces[key].level, "Insufficient evidence");
  }
});

test("[10b] Tier 0 and Tier 1 never disagree on the honest-fallback sentence format -- both come from the SAME normalizeStructuredPorterText helper (structural proof, not a duplicate implementation)", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  const occurrences = (source.match(/normalizeStructuredPorterText\(/g) || []).length;
  assert.ok(occurrences >= 3, "expected normalizeStructuredPorterText to be reused, not reimplemented, by the new Tier 1 function");
});

test("[10c] buildPortersFiveForcesStateFromStructuredResponse (Tier 0) is still preferred over the new Tier 1 legacy-prose synthesis whenever the model DOES supply real structured data", () => {
  const structured = buildPortersFiveForcesStateFromStructuredResponse({
    competitiveRivalry: { level: "High", analysis: "Real analysis", implication: "Real implication" },
    threatOfNewEntrants: { level: "Low", analysis: "Real analysis", implication: "Real implication" },
    buyerPower: { level: "Moderate", analysis: "Real analysis", implication: "Real implication" },
    supplierPower: { level: "Low", analysis: "Real analysis", implication: "Real implication" },
    threatOfSubstitutes: { level: "Moderate", analysis: "Real analysis", implication: "Real implication" },
  });
  assert.ok(structured);
  const tierPreferenceCount = (planExecutorSource.match(/buildPortersFiveForcesStateFromStructuredResponse\(\s*\n?\s*structuredPortersFiveForcesResponse\s*\n?\s*\)\s*\|\|/g) || []).length;
  assert.ok(tierPreferenceCount >= 1, "expected Tier 0 to be tried first via a `||` fallback to Tier 1");
});

// --- Diff-surface / decision-safety confinement ---------------------------

test("the financial-model.ts fix is confined to the targetCustomer classifier -- decision-engine/scoring files carry no #69A-38 marker (matched precisely so the later, legitimate #69A-38B ticket's own markers on other files are never mistaken for this one)", () => {
  assert.match(financialModelSource, /TASK #69A-38(?!B)/);
  for (const relativePath of [
    "app/lib/decision-engine-v2/dimensions.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/report-presentation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-38(?!B)/, `${relativePath} should not carry a #69A-38 marker`);
  }
});
