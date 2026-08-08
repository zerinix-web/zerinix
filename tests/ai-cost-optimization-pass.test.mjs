import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatMarketIntelligenceGraphForModel } from "../app/lib/ai/market-intelligence-graph.ts";
// domain-research.ts imports "server-only", which doesn't resolve under
// plain node --test, so DOMAIN_RESEARCH_MODEL is verified via source
// inspection below rather than a live import (same workaround already
// used elsewhere in this test suite for other server-only modules).
import {
  insightLedgerAndTokenBudgetDirectives,
  buildDecisionSupportDirectives,
} from "../app/lib/ai/report-quality-directives.ts";
import { buildLanguageOverridePrecedenceInstruction } from "../app/lib/report-language.ts";
import { dedupeExactPromptBlocks } from "../app/lib/ai/token-optimization-core.ts";

const root = new URL("..", import.meta.url).pathname;
function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("research-stage model no longer defaults to the premium gpt-5.5 tier", () => {
  const source = read("app/lib/ai/domain-research.ts");
  assert.match(
    source,
    /export const DOMAIN_RESEARCH_MODEL =\s*\n?\s*process\.env\.AI_RESEARCH_MODEL\?\.trim\(\) \|\| "gpt-5-mini";/,
    "DOMAIN_RESEARCH_MODEL must default to a cheaper tier and stay env-overridable"
  );
});

test("research-stage model is env-overridable and research-cache.ts stays in sync", () => {
  // research-cache.ts's RESEARCH_MODEL is used only for cost-estimation
  // bookkeeping (cache-hit savings figures) -- it must import the same
  // constant actually used for the live call, or savings estimates would
  // silently drift from real pricing the moment either value changes.
  const cacheSource = read("app/lib/ai/research-cache.ts");
  assert.match(
    cacheSource,
    /import\s*\{\s*\n?\s*DOMAIN_RESEARCH_MODEL,/,
    "research-cache.ts must import DOMAIN_RESEARCH_MODEL rather than hardcode its own copy"
  );
  assert.doesNotMatch(cacheSource, /const RESEARCH_MODEL = "gpt-5\.5"/);
});

test("the research-stage call site uses the shared constant, not a bare literal", () => {
  const source = read("app/lib/ai/domain-research.ts");
  assert.match(source, /const researchModel = DOMAIN_RESEARCH_MODEL;/);
  assert.doesNotMatch(source, /const researchModel = "gpt-5\.5";/);
});

test("market-intelligence-graph serialization drops the static version field and null keys but preserves all real data", () => {
  const graph = {
    version: "v3",
    competitors: [{ name: "Acme", pricingNotes: "tiered" }],
    pricingModels: [],
    verifiedMarketSize: [],
    planningEstimate: null,
    cagr: [],
    sources: [{ title: "Report", url: "https://example.com" }],
    vendorIntelligence: { vendors: [] },
    coverage: { sourceCount: 1, gaps: null },
  };

  const serialized = formatMarketIntelligenceGraphForModel(graph);
  const parsed = JSON.parse(serialized);

  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "version"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "planningEstimate"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.coverage, "gaps"), false);
  // Every non-null field must still be present -- no information loss.
  assert.deepEqual(parsed.competitors, graph.competitors);
  assert.deepEqual(parsed.sources, graph.sources);
  assert.deepEqual(parsed.vendorIntelligence, graph.vendorIntelligence);
  assert.equal(parsed.coverage.sourceCount, 1);
  assert.ok(!serialized.includes('"version"'));
});

test("insight-ledger directive pair is a single shared constant used by both plan.ts and market.ts", () => {
  assert.equal(insightLedgerAndTokenBudgetDirectives.length, 2);
  assert.match(insightLedgerAndTokenBudgetDirectives[0], /internal insight ledger/i);
  assert.match(insightLedgerAndTokenBudgetDirectives[1], /fewer output tokens/i);

  const planSource = read("app/lib/report-engine/prompts/plan.ts");
  const marketSource = read("app/lib/report-engine/prompts/market.ts");
  assert.match(planSource, /insightLedgerAndTokenBudgetDirectives/);
  assert.match(marketSource, /insightLedgerAndTokenBudgetDirectives/);
  // The old, independently-drifting inline copies must be gone.
  assert.doesNotMatch(planSource, /Maintain an internal insight ledger while drafting: explain each insight once/);
  assert.doesNotMatch(marketSource, /Maintain an internal insight ledger: explain each claim once/);

  // buildDecisionSupportDirectives must still work (unrelated export, sanity check).
  const directives = buildDecisionSupportDirectives("business_plan");
  assert.ok(Array.isArray(directives) && directives.length > 0);
});

test("language-override precedence instruction produces identical output to the old inline text", () => {
  const english = buildLanguageOverridePrecedenceInstruction("English");
  const turkish = buildLanguageOverridePrecedenceInstruction("Turkish");

  assert.equal(
    english,
    "The user's latest message language is English. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language."
  );
  assert.equal(
    turkish,
    "The user's latest message language is Turkish. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language."
  );

  const planSource = read("app/lib/report-engine/prompts/plan.ts");
  assert.match(planSource, /buildLanguageOverridePrecedenceInstruction\(language\)/);
});

test("CEO Summary block spec is no longer double-specified in plan.ts/market.ts field prompts", () => {
  const planSource = read("app/lib/report-engine/prompts/plan.ts");
  const marketSource = read("app/lib/report-engine/prompts/market.ts");

  // The shared directive (report-quality-directives.ts) already states
  // this enumeration once per call; the field-level prompts must not
  // restate it a second time in the same request.
  assert.doesNotMatch(
    planSource,
    /End with CEO Summary using exactly Biggest Opportunity, Biggest Risk, First 90 Days, Critical KPIs, and Final Recommendation/
  );
  assert.doesNotMatch(
    marketSource,
    /Use exactly five blocks: Biggest Opportunity, Biggest Risk, First 90 Days, Critical KPIs, and Final Recommendation/
  );
  // Field-specific residual guidance must survive the trim.
  assert.match(marketSource, /First 90 Days must contain exactly three concrete actions with owners and proof gates/);
  assert.match(planSource, /Never reconstruct or invent citation metadata/);
});

test("dedupeExactPromptBlocks is a pure, information-preserving function (sanity check for every new call site)", () => {
  const input = "Block A text.\n\nBlock B text.\n\nBlock A text.\n\nBlock C text.";
  const result = dedupeExactPromptBlocks(input);

  assert.match(result, /Block A text\./);
  assert.match(result, /Block B text\./);
  assert.match(result, /Block C text\./);
  // The duplicate occurrence of "Block A text." must be removed, but only
  // the exact-duplicate one -- first-use order and unique content survive.
  assert.equal(result.split("Block A text.").length - 1, 1);
});

test("the deduped input is what actually reaches the model, not just the cost-metrics comparison", () => {
  // Regression guard for a real bug found during this pass: both files
  // computed dedupeExactPromptBlocks(fullReportInput) only to measure a
  // hypothetical savings figure, while the raw, un-deduped fullReportInput
  // was still what got sent to client.responses.create.
  const planExecutorSource = read("app/lib/report-jobs/plan-executor.ts");
  assert.match(
    planExecutorSource,
    /const dedupedFullReportInput = dedupeExactPromptBlocks\(fullReportInput\);/
  );
  assert.match(
    planExecutorSource,
    /input: buildAnalysisProviderInput\(\s*\n?\s*dedupedFullReportInput,/
  );
  assert.doesNotMatch(
    planExecutorSource,
    /input: buildAnalysisProviderInput\(\s*\n?\s*fullReportInput,/
  );

  const marketRouteSource = read("app/api/market-analysis/route.ts");
  assert.match(
    marketRouteSource,
    /const dedupedFullReportInput = dedupeExactPromptBlocks\(fullReportInput\);/
  );
  assert.match(
    marketRouteSource,
    /input: buildAnalysisProviderInput\(\s*\n?\s*dedupedFullReportInput,/
  );
  assert.doesNotMatch(
    marketRouteSource,
    /input: buildAnalysisProviderInput\(\s*\n?\s*fullReportInput,/
  );
});

test("real-estate and specialized-domain report inputs are now deduped too (previously had no dedup at all)", () => {
  const source = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(
    source,
    /const buildSectionInput = \(\s*\n?\s*section: RealEstateGenerationSection,\s*\n?\s*sectionEvidence: readonly CompressedEvidence\[\]\s*\n?\s*\) => dedupeExactPromptBlocks\(`User goal:/
  );
  assert.match(
    source,
    /const input = dedupeExactPromptBlocks\(`User goal:/
  );
});

test("domain-research.ts's shared per-stage input is deduped too (previously had no dedup at all)", () => {
  const source = read("app/lib/ai/domain-research.ts");
  assert.match(source, /const strategyInput = dedupeExactPromptBlocks\(`\$\{input\}/);
});
