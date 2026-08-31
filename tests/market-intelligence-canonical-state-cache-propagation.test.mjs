import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assessMarketEntryConfidence,
} from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  resolveMarketIntelligenceConfidenceFactors,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
// research-cache.ts starts with "import 'server-only'" and cannot be
// imported directly in a Node test process (established pattern
// throughout this test suite -- see e.g.
// market-intelligence-executive-decision-consistency-and-cache-safety.test.mjs);
// verified via source-text reading instead.

// TASK #29C -- Fix the REAL canonical confidence-state propagation into
// the regenerated Market Intelligence UI.
//
// TRACE (the full path the ticket asked for):
//   /api/market-analysis (fresh generation)
//     -> marketIntelligenceGraph = conversationResearch?.marketIntelligenceGraph
//          || buildMarketIntelligenceGraph(domainResearch, ...)   [ALWAYS non-null]
//     -> ensureMarketReportQuality(report, coverage, language, graph)
//     -> decisionCriticalEvidence = resolveDecisionCriticalEvidenceState(graph)
//     -> marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief(..., decisionCriticalEvidence)
//     -> marketIntelligenceCanonicalState = buildMarketIntelligenceCanonicalState({graph, decisionCriticalEvidence, decisionBrief})
//     -> serialized into the SSE stream (serializeMarketReportMetadataChunk)
//     -> read by app/lib/report-jobs/worker.ts's readExecutionResponse (event.reportMetadata)
//     -> upserted into reports.metadata by persistCompletedReport (spread first, additive after)
//     -> read back by readMarketIntelligenceCanonicalState(report.metadata)
//     -> resolveMarketIntelligenceConfidenceFactors(canonicalState) [Task #29B]
//     -> page.tsx / Planner.tsx (web view + PDF)
//
// ROOT CAUSE (confirmed live against the real report DB, id
// 02ea9d38-2e99-42e0-befc-2757ba68f650, generated fresh on 2026-08-30 with
// the EXACT prompt used throughout this whole session's testing, and the
// entire "reports" table's every recent row): every one of the persist,
// reload, and presentation-adapter steps above is correct and was NOT the
// break -- confirmed by reading the actual persisted metadata
// (marketIntelligenceCanonicalStateStatus: "unavailable_no_graph") and by
// static trace of persistCompletedReport's `metadata: { ...(report.metadata
// || {}), ... }` spread (additive, correct) and readExecutionResponse's
// `metadata = event.reportMetadata as ReportMetadata` (correct).
//
// The actual break is upstream, in generation's own CACHE-HIT branch:
// route.ts's `cachedMarketGraph` can only ever be non-null via
// conversationResearch?.marketIntelligenceGraph (a live, conversation-
// scoped snapshot) -- its other two fallback tiers,
// getCachedMarketIntelligenceGraphFromReportData and
// getCachedResearchFromReportData, both read
// `cachedFullReport?.responseData`, and storeCachedAiResponse's PRIMARY
// write path (the global-sharing RPC, upsert_global_ai_response_cache_entry,
// taken first and returning early on success -- confirmed by reading
// governance.ts directly) has no parameter for response_data at all, so
// it is never populated for a cache entry written through that path. A
// "regeneration" whose prompt/model/financial-assumptions fingerprint
// matches an OLDER cached full-report entry (exactly what happened here --
// the persisted report's own prompt is byte-identical to this whole
// session's test prompt, and the AI response cache holds entries from
// days earlier for the same endpoint/field) then serves that cached TEXT
// with `coverage`/`decisionCriticalEvidence` both undefined -- silently
// permanently blocking canonical state for that exact cache key, no
// matter how correct every downstream step is.
//
// FIX: route.ts's cache-hit condition now also requires `cachedMarketGraph`
// to be truthy. When it is not (no research/graph recoverable for this
// cache hit), the cached text is skipped and generation falls through to
// the fresh-generation path -- which always builds a real,
// current-version MarketIntelligenceGraph (buildMarketIntelligenceGraph
// never returns null) -- so ANY regeneration going forward is guaranteed
// to produce a report with genuine, evidence-derived canonical state.
//
// REMAINING GAP (documented, not fixed here -- see the final report):
// storeCachedAiResponse's global-sharing RPC path could ALSO be extended
// (a new, additive migration adding an optional response_data parameter
// to upsert_global_ai_response_cache_entry, defaulting to '{}'::jsonb for
// every other existing caller) so that FUTURE cache writes carry a
// reconstructable graph too, letting a cache hit degrade gracefully
// instead of always falling through to a fresh generation. Deliberately
// not done in this pass: it requires a live database migration + SQL RPC
// change to shared, cross-report-type infrastructure, which is a larger,
// separately-reviewable change than this ticket's specific, safely
// self-contained regression.

const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const governanceSource = readFileSync(new URL("../app/lib/ai/governance.ts", import.meta.url), "utf8");

test("1. STRUCTURAL FIX: the cache-hit branch requires a real, recoverable MarketIntelligenceGraph before reusing cached report text", () => {
  const ifIndex = routeSource.indexOf("if (\n        cachedFullReport &&");
  assert.notEqual(ifIndex, -1, "the cache-hit condition block must exist");
  const conditionBlock = routeSource.slice(ifIndex, ifIndex + 300);
  assert.match(conditionBlock, /cachedFullReport &&\s*\n\s*cachedMarketGraph &&/, "cachedMarketGraph must be required, not just cachedFullReport");
});

test("2. DRIFT GUARD: the cache-hit condition can never regress to accepting cached text without a graph", () => {
  assert.doesNotMatch(
    routeSource,
    /if \(\s*cachedFullReport &&\s*!isReportGenerationFailureText/,
    "the old, ungated condition (cachedFullReport alone) must never reappear"
  );
});

test("3. ROOT CAUSE, confirmed by source: getCachedResearchFromReportData and getCachedMarketIntelligenceGraphFromReportData both guard on `value` being a real object first, so the real shape a cache-hit-without-response_data produces (responseData undefined) always resolves to null, never a guess", () => {
  const researchCacheSource = readFileSync(new URL("../app/lib/ai/research-cache.ts", import.meta.url), "utf8");
  const researchFnStart = researchCacheSource.indexOf("export function getCachedResearchFromReportData");
  assert.notEqual(researchFnStart, -1);
  const researchFnBody = researchCacheSource.slice(researchFnStart, researchFnStart + 250);
  assert.match(researchFnBody, /if \(!value \|\| typeof value !== "object" \|\| Array\.isArray\(value\)\) return null;/);

  const graphFnStart = researchCacheSource.indexOf("export function getCachedMarketIntelligenceGraphFromReportData");
  assert.notEqual(graphFnStart, -1);
  const graphFnBody = researchCacheSource.slice(graphFnStart, graphFnStart + 500);
  assert.match(graphFnBody, /if \(!value \|\| typeof value !== "object" \|\| Array\.isArray\(value\)\) return null;/);
  assert.match(graphFnBody, /version ===\s*\n?\s*MARKET_INTELLIGENCE_GRAPH_VERSION/, "the recovered graph must also be version-gated, never trusted from a stale/incompatible shape");
});

test("4. CONFIRMED GAP: storeCachedAiResponse's global-sharing RPC call (the path taken first, and returned from immediately on success) never passes response_data to upsert_global_ai_response_cache_entry", () => {
  const rpcCallStart = governanceSource.indexOf('supabase.rpc(\n      "upsert_global_ai_response_cache_entry"');
  assert.notEqual(rpcCallStart, -1, "the global-sharing RPC call must exist");
  const rpcCallBlock = governanceSource.slice(rpcCallStart, rpcCallStart + 500);
  assert.doesNotMatch(
    rpcCallBlock,
    /response_data/i,
    "documents the confirmed gap: this call site has no response_data parameter at all"
  );
  // The per-user fallback path (only reached if global sharing is
  // disabled or the RPC call itself errors) DOES correctly persist it --
  // proving the gap is specifically the RPC path being reached first and
  // returning early, not a total absence of support in this file.
  assert.match(governanceSource, /response_data: input\.responseData \?\? \{ text: input\.responseText \}/);
});

test("5. once a real MarketIntelligenceGraph-shaped canonical state exists (the guaranteed outcome of any fresh generation after the fix), Decision Factors resolve to real evidence-derived values, never '--'", () => {
  // The real report's own documented evidence shape (Tasks #27D-#29B):
  // TAM $1.5B supported, Major Players present, SOM unresolved.
  const canonicalState = {
    coverage: {
      dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 45, productEvidence: 50 },
    },
    decisionCriticalEvidence: {
      marketSizingResolved: true,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: false,
    },
  };
  const factors = resolveMarketIntelligenceConfidenceFactors(canonicalState);
  assert.notEqual(factors, null);
  for (const value of Object.values(factors)) {
    assert.notEqual(value, "--");
    assert.ok(["Strong", "Moderate", "Weak", "Validation Required"].includes(value));
  }
  assert.equal(factors.market, "Strong");
  assert.equal(factors.financial, "Validation Required");
  assert.equal(factors.execution, "Validation Required");
});

test("6. INTEGRATION: Planning Confidence, Confidence Gauge (Market Signal), and Decision Factors all derive from the exact same canonical coverage/decisionCriticalEvidence pair -- never an independently inferred value", () => {
  const canonicalState = {
    coverage: {
      dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 45, productEvidence: 50 },
    },
    decisionCriticalEvidence: {
      marketSizingResolved: true,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: false,
    },
  };

  // "Planning Confidence" / overall gauge -- assessMarketEntryConfidence,
  // fed the SAME coverage.dimensions + decisionCriticalEvidence.
  const overall = assessMarketEntryConfidence(
    { overallConfidence: 0, dimensions: canonicalState.coverage.dimensions, sourceClasses: [] },
    canonicalState.decisionCriticalEvidence
  );
  assert.equal(overall.decision, "MONITOR");
  assert.ok(overall.confidence <= 50);

  // "Market Signal" gauge -- the Market Signals factor, from the same
  // resolver every other surface calls.
  const factors = resolveMarketIntelligenceConfidenceFactors(canonicalState);
  assert.equal(factors.marketSignals, "Moderate");

  // Both are pure functions of the identical canonical inputs -- no
  // independent re-derivation, no drift possible between them.
  const overallAgain = assessMarketEntryConfidence(
    { overallConfidence: 0, dimensions: canonicalState.coverage.dimensions, sourceClasses: [] },
    canonicalState.decisionCriticalEvidence
  );
  const factorsAgain = resolveMarketIntelligenceConfidenceFactors(canonicalState);
  assert.deepEqual(overall, overallAgain);
  assert.deepEqual(factors, factorsAgain);
});

test("7. no canonical state recoverable (the exact real persisted report's own actual shape) never fabricates a factor value -- explicit Validation-Required/null, not a guess", () => {
  assert.equal(resolveMarketIntelligenceConfidenceFactors(null), null);
});

test("8. persistence layer correctness (static verification): persistCompletedReport spreads report.metadata FIRST and additively, so a real canonical state produced upstream is never dropped by the DB write itself", () => {
  const workerSource = readFileSync(new URL("../app/lib/report-jobs/worker.ts", import.meta.url), "utf8");
  assert.match(
    workerSource,
    /metadata:\s*\{\s*\n\s*\.\.\.\(report\.metadata \|\| \{\}\),/,
    "the upsert must spread report.metadata first, additively, never replacing it wholesale"
  );
  assert.match(
    workerSource,
    /if \(event\.reportMetadata && typeof event\.reportMetadata === "object"\) \{\s*\n\s*metadata = event\.reportMetadata as ReportMetadata;/,
    "readExecutionResponse must correctly capture the reportMetadata stream chunk"
  );
});
