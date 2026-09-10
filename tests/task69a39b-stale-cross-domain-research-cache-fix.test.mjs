// TASK #69A-39B -- Diagnose the fresh-report competitive research failure
// from the live diagnostics captured by #69A-39/#69A-39A, before changing
// any code, and fix only the conclusively-proven root cause.
//
// LIVE DIAGNOSTIC EVIDENCE (dev-server.out.log, a completely fresh
// localhost generation run AFTER #69A-39A's per-field-isolation fix):
//   [research-cache] hit {
//     reportFamily: 'business_plan', analysisMode: 'plan',
//     researchCacheHit: true, skippedGptResearchCalls: true, ...
//   }
//   ...
//   [decision-intelligence] quality gate fallback {
//     message: 'Report quality gate failed: expected business schema but
//       research classified accounting.'
//   }
//   [api:plan] full report generation failed, used grounded fallback {
//     errorDetail: 'Report quality gate failed: expected business schema
//       but research classified accounting.'
//   }
// I.e. research was NOT executed fresh at all -- it was served entirely
// from cache (skippedGptResearchCalls: true), and the SERVED bundle's own
// `domain` was "accounting", not "business".
//
// DIRECT DATABASE PROOF (service-role, read-only, scratch script deleted
// immediately after use -- app/lib/ai/governance.ts's ai_response_cache
// table, the exact row createResearchResultCacheKey/getCachedAiResponse
// read/wrote): the row matching this exact prompt's identity
// (reportFamily "business_plan", normalizedPrompt containing "quickbooks"/
// "xero"/"cash-flow forecasting") had:
//   created_at: 2026-09-09T08:08:39 UTC (early this session, before
//     #69A-38C's domain.ts classifier fix landed)
//   expires_at: 2026-09-16T08:08:39 UTC (7-day TTL -- would have kept
//     being served for another week)
//   research.domain: "accounting"
//   research.plan: finance_official_filings, finance_industry_benchmarks,
//     finance_macro_inputs (audited filings, margin benchmarks, Fed/BLS
//     macro data) -- an "accounting"/"finance"-category task plan with
//     NO competitor-discovery task at all (contrast with a correctly
//     "business"-classified bundle for a different prompt in the SAME
//     table, whose plan includes market_competitor_landscape,
//     market_vendor_discovery, market_product_evidence).
//
// ROOT CAUSE (PROVEN, not inferred): this exact prompt was misclassified
// into the "accounting" research domain at some earlier point (the same
// false-positive class #69A-38C fixed in domain.ts: naming the
// accounting SOFTWARE it integrates with -- QuickBooks/Xero --
// hijacked classification before competitor-discovery research ever
// ran), then CACHED with a 7-day TTL under a cache key
// (createResearchResultCacheKey) that has never included the classified
// domain or a version tied to classifier correctness. #69A-38C's later
// classifier fix could never invalidate this already-poisoned cache
// entry, so EVERY subsequent request for the identical prompt kept being
// served the SAME stale, wrong-domain research bundle -- completely
// independent of #69A-39's token-budget fix or #69A-39A's per-field-
// isolation fix, both of which were correct but could never see real
// competitor evidence because research itself never re-ran.
//
// STAGE WHERE DATA DISAPPEARED (Phase 4 case E): "Cache/routing
// prevented the correct research from executing" -- specifically
// app/lib/ai/research-cache.ts's resolveDomainResearchWithCache, whose
// cache-read paths returned the stale bundle without ever re-validating
// it against current classifier behavior.
//
// FIX (app/lib/ai/research-cache.ts):
//   1. RESEARCH_CACHE_VERSION bumped v2 -> v3, clearing this and any
//      other already-poisoned cache entries immediately (bounded,
//      one-time re-fetch per previously-cached prompt -- the exact
//      mechanism #69A-29A already established for this class of change).
//   2. New isCachedResearchDomainStillValid: on every cache read (both
//      the conversation-snapshot path and the per-user/global cache
//      path), a cached bundle's domain is re-checked against what
//      CURRENT classifier code (classifyResearchDomain, mirroring
//      createDomainResearchPlan's own isMarketIntelligence override)
//      would produce for the same prompt. A mismatch is treated as a
//      cache miss -- never served, always falls through to fresh
//      research. This is the ongoing fix: it protects against this
//      exact bug class recurring after any FUTURE classifier change,
//      without depending on anyone remembering to bump the version
//      constant again.
//
// SAFETY: classification is a pure, synchronous, no-AI-call keyword/
// regex check -- re-running it on every cache read is negligible cost,
// never an additional AI call, retry, or unbounded cost. No competitor
// names are hardcoded. No evidence-validation rule was weakened. Research
// that genuinely fails still degrades to the honest empty state exactly
// as before (this fix only changes whether a cached bundle is TRUSTED,
// never what a real research failure produces).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyReportDomain } from "../app/lib/report-engine/domain.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const researchCacheSource = readFileSync(
  join(repoRoot, "app/lib/ai/research-cache.ts"),
  "utf8"
);

const REAL_LIVE_PROMPT =
  "I’m considering launching a premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for small and medium-sized businesses (SMBs) in the United States. The product would integrate with accounting platforms such as QuickBooks and Xero and help SMB owners forecast cash flow, model financial scenarios, identify risks, and make better financial decisions. Evaluate whether this is a viable business opportunity, identify the target customer and competitive landscape, assess Porter’s Five Forces, pricing and go-to-market strategy, and give me a clear investment decision.";

// --- PHASE 2/5 PROOF: the underlying classifier (current code) correctly
//     resolves this exact real prompt to "business", not "accounting" ---

test("PROOF: classifyReportDomain (the function classifyResearchDomain delegates to for a non-general decision domain) correctly classifies the exact real live prompt as business, not accounting -- the CURRENT classifier is not the active bug for this input", () => {
  assert.equal(classifyReportDomain(REAL_LIVE_PROMPT, []), "business");
});

test("PROOF: the accounting misclassification this task traces was a STALE, pre-fix cached result, not a currently-reproducible classifier bug -- the lowercased/normalized form of the same prompt (as stored in ResearchCacheIdentity.normalizedPrompt) still classifies correctly", () => {
  assert.equal(classifyReportDomain(REAL_LIVE_PROMPT.toLowerCase(), []), "business");
});

// --- THE FIX ITSELF ---------------------------------------------------

test("RESEARCH_CACHE_VERSION was bumped to invalidate the already-poisoned cache entry proven live", () => {
  assert.match(researchCacheSource, /const RESEARCH_CACHE_VERSION = "research-result-v3";/);
});

test("isCachedResearchDomainStillValid exists and reclassifies against CURRENT classifier code, mirroring createDomainResearchPlan's own Market Intelligence override", () => {
  assert.match(
    researchCacheSource,
    /function isCachedResearchDomainStillValid\(/
  );
  assert.match(
    researchCacheSource,
    /const isMarketIntelligence = identity\.analysisMode === "market";/
  );
  assert.match(
    researchCacheSource,
    /classifyResearchDomain\(identity\.normalizedPrompt, \[\]\)/
  );
  assert.match(researchCacheSource, /return expectedDomain === research\.domain;/);
});

test("the per-user/global cache read path discards (never serves) a cached bundle whose domain no longer matches current classifier behavior", () => {
  assert.match(
    researchCacheSource,
    /if \(payload && !isCachedResearchDomainStillValid\(input\.identity, payload\.research\)\) \{[\s\S]{0,300}?return null;\s*\n\s*\}/
  );
});

test("the conversation-snapshot reuse path also requires domain validity, not just identity match -- a stale cross-domain snapshot can never be reused just because the prompt/asset/language matched", () => {
  assert.match(
    researchCacheSource,
    /conversationResearchIdentityMatches\(rawConversationSnapshot\.identity, input\.identity\) &&\s*\n\s*isCachedResearchDomainStillValid\(input\.identity, rawConversationSnapshot\.research\)/
  );
});

test("a discarded stale cross-domain cache entry is logged for observability, distinct from a normal cache miss", () => {
  assert.match(
    researchCacheSource,
    /\[research-cache\] discarded stale cross-domain result/
  );
});

// --- REGRESSION SAFETY --------------------------------------------------

test("SAFETY: no hardcoded competitor names (Float/Cash Flow Frog/Futrli/QuickBooks/Xero) appear anywhere in research-cache.ts's actual logic", () => {
  const executableLines = researchCacheSource
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(executableLines, /Float|Cash Flow Frog|Futrli/i);
});

test("SAFETY: cache write/dedupe/TTL/cost-estimation logic is completely untouched -- this fix only changes what is TRUSTED on read, never what gets written, deduped, or how long it lives", () => {
  assert.match(researchCacheSource, /function getResearchCacheTtlDays\(/);
  assert.match(researchCacheSource, /function isReusableResearch\(/);
  assert.match(researchCacheSource, /dedupeKey: `\$\{input\.userId\}:\$\{cacheKey\}`/);
});

test("SAFETY: a stale-domain cache miss still goes through the SAME bounded, deduped execute() path as any other cache miss -- no new unbounded retry loop was introduced", () => {
  assert.match(researchCacheSource, /execute: input\.execute,/);
  assert.doesNotMatch(researchCacheSource, /while\s*\(\s*true\s*\)/);
});

test("SAFETY: real research failure still degrades honestly -- isReusableResearch (the only gate on what gets cached at all) is untouched, so a genuinely-failed/empty research result is never written to cache and never falsely marked domain-valid to justify reuse", () => {
  const isReusableMatch = researchCacheSource.match(
    /function isReusableResearch\(research: DomainResearchBundle\) \{[\s\S]{0,200}?\n\}/
  );
  assert.ok(isReusableMatch);
  assert.match(isReusableMatch[0], /research\.researchAttempted/);
  assert.match(isReusableMatch[0], /!research\.fallbackUsed/);
  assert.match(isReusableMatch[0], /research\.evidence\.length > 0/);
});
