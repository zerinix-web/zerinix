import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  buildMarketIntelligenceCanonicalState,
  readMarketIntelligenceCanonicalState,
  isKnownCitationId,
  resolveMarketIntelligenceCagrEvidenceLevel,
  classifyStrategicRecommendationAction,
  MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import { deriveMarketSizeMetricEvidenceLevel } from "../app/lib/report-presentation.ts";

// TASK #33 -- Make Market Intelligence source provenance authoritative
// and auditable end-to-end.
//
// ROOT CAUSE (confirmed via full audit of source identity, citation
// mechanics, and every existing citation-integrity module): the
// generation-time graph already computes real evidence-id links for
// market sizing (planningEstimate.evidenceIds), CAGR (graph.cagr[].evidenceIds),
// and specific competitor attributes (vendor-intelligence.ts's own
// strengthItem/weaknessItem/pricingItem selection) -- but every one of
// these links was silently DISCARDED before or during persistence into
// MarketIntelligenceCanonicalState, leaving canonical state with no way
// to trace a derived TAM/SAM/SOM figure or a displayed CAGR percentage
// back to real evidence, and leaving every competitor attribute
// (category/position/strengths/weaknesses/pricing) with no per-field
// provenance at all -- only the row's overall vendor-EXISTENCE
// corroboration score survived. Separately, Strategic Recommendations'
// own `evidenceTie` field (free text like "signed SOWs and pilot KPIs")
// was treated as sufficient to call a recommendation's budget/timeline
// "evidence"-based on ANY non-empty string, with zero check that it
// names a real, resolvable citation -- letting a recommendation's own
// FUTURE validation plan read as if it were already-established external
// evidence.
//
// FIX: every one of these evidence-id links now survives to canonical
// state (marketSizing.evidenceIds, the new top-level `cagr` array,
// competitors' new strengthEvidenceId/weaknessEvidenceId/pricingEvidenceId),
// a new isKnownCitationId helper validates a citation marker against the
// real citationSources registry, and Strategic Recommendations'
// numericBasis now requires evidenceTie to name a citation that actually
// resolves before calling anything "evidence" -- descriptive text alone
// is always "planning_assumption". No new taxonomy invented anywhere;
// canonical state version bumped 2 -> 3 for the new persisted fields.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim, label = "Verified from external source" }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label,
    sourceTitle: `${name} source`,
    publisher: name,
    url,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

function decisionBriefFixture(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 50,
    confidenceDirection: "reduced",
    confidenceFactors: ["verified market size unavailable"],
    why: "Evidence supports conditional entry pending SOM validation.",
    topReasons: ["Active vendor landscape", "Growing category"],
    topRisks: ["Incumbent concentration", "Procurement cycle length"],
    missingEvidence: ["Independent win-rate data"],
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
    ...overrides,
  };
}

function realGraphFixture() {
  const evidence = [
    evidenceItem({ id: "R3", name: "DocuSign", url: "https://procurement.sc.gov/docusign-clm" }),
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R5", name: "Evisort", url: "https://evisort.com/ai-engine" }),
    evidenceItem({
      id: "R12",
      name: "Emergen Research",
      url: "https://emergenresearch.com/clm-market",
      claim: "Market research report values the U.S. CLM software market at $1.5 billion.",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "AI compliance & contract intelligence SaaS");
}

function canonicalStateFor(decision, overrides = {}) {
  return buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: {
      marketSizingResolved: decision === "GO",
      competitiveEvidenceResolved: decision !== "NO_GO",
      obtainableShareResolved: decision === "GO",
    },
    decisionBrief: decisionBriefFixture({ decision, ...overrides }),
  });
}

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardReportSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const canonicalStateSource = readSourceFile("../app/lib/report-engine/market-intelligence-canonical-state.ts");

// --- 1. Claim -> canonical source relationship ----------------------------

test("SCHEMA: MarketIntelligenceCanonicalMarketSizing persists the real evidenceIds link (previously silently dropped)", () => {
  assert.match(canonicalStateSource, /\| "evidenceIds"/);
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.ok(canonicalState.marketSizing, "sanity check: this fixture must produce a planning estimate");
  assert.ok(Array.isArray(canonicalState.marketSizing.evidenceIds));
});

test("SCHEMA: MarketIntelligenceCanonicalState persists a real `cagr` array (previously absent entirely)", () => {
  assert.match(canonicalStateSource, /cagr: MarketIntelligenceCanonicalCagrEstimate\[\];/);
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.ok(Array.isArray(canonicalState.cagr));
});

test("SCHEMA: version bumped to 3 for the new marketSizing.evidenceIds and cagr fields", () => {
  assert.equal(MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION, 3);
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.equal(canonicalState.version, 3);
});

test("REGRESSION: a real market-sizing evidenceIds link survives generation -> canonical persistence -> reload, verbatim", () => {
  const built = canonicalStateFor("CONDITIONAL_GO");
  const graph = realGraphFixture();
  if (graph.planningEstimate) {
    assert.deepEqual(built.marketSizing.evidenceIds, graph.planningEstimate.evidenceIds);
  }

  // Save -> reload (JSONB round-trip, exactly as worker.ts/Supabase behave).
  const reloaded = JSON.parse(JSON.stringify({ marketIntelligenceCanonicalState: built }));
  const canonicalState = readMarketIntelligenceCanonicalState(reloaded);
  assert.ok(canonicalState);
  assert.deepEqual(canonicalState.marketSizing.evidenceIds, built.marketSizing.evidenceIds);
});

// --- 2. Invalid/stale source references -----------------------------------

test("REGRESSION: isKnownCitationId is true for a real citation in the registry, false for a dangling/nonexistent one, and false when canonical state is unavailable", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.ok(canonicalState.citationSources.some((source) => source.evidenceId === "R4"), "sanity check: R4 must be real in this fixture");

  assert.equal(isKnownCitationId(canonicalState, "R4"), true);
  assert.equal(isKnownCitationId(canonicalState, "R999"), false, "a dangling reference must never resolve as known");
  assert.equal(isKnownCitationId(canonicalState, ""), false);
  assert.equal(isKnownCitationId(null, "R4"), false, "no canonical state means nothing can be confirmed known");
});

// --- 3. Market-size provenance discipline ---------------------------------

test("REGRESSION: an unresolved/assumption-based market-sizing estimate never gains a fabricated evidenceIds link -- an empty array is preserved, never invented", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, planningEstimate: graph.planningEstimate ? { ...graph.planningEstimate, evidenceIds: [] } : null },
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({ decision: "NO_GO" }),
  });
  if (canonicalState.marketSizing) {
    assert.deepEqual(canonicalState.marketSizing.evidenceIds, []);
  }
});

// --- 4. CAGR validation-required / evidence-aware behavior ----------------

test("REGRESSION: resolveMarketIntelligenceCagrEvidenceLevel returns null (defers to the existing prose heuristic) when canonical state is unavailable or no value is displayed", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(null, true), null);
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, false), null);
});

test("REGRESSION: zero qualifying CAGR evidence items (ground truth from generation) classifies a displayed figure as a planning assumption, never a too-confident 'benchmarkDerived' or 'verified'", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, cagr: [] },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(canonicalState.cagr.length, 0);
  const evidence = resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true);
  assert.equal(evidence, "planningAssumption");
});

test("REGRESSION: exactly one qualifying CAGR evidence item classifies from its OWN real confidenceClassification (Verified -> verified, Estimated -> benchmarkDerived), not a prose re-scan", () => {
  const graph = realGraphFixture();
  const verifiedCanonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, cagr: [{ description: "12.4% CAGR", evidenceIds: ["R12"], confidenceClassification: "Verified", confidenceScore: 82, confidenceLevel: "High" }] },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(verifiedCanonicalState, true), "verified");

  const estimatedCanonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, cagr: [{ description: "Forecast 12.4% CAGR", evidenceIds: ["R12"], confidenceClassification: "Estimated", confidenceScore: 60, confidenceLevel: "Medium" }] },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(estimatedCanonicalState, true), "benchmarkDerived");
});

test("REGRESSION: multiple qualifying CAGR evidence items defers to the caller's existing multi-estimate handling (returns null, never guesses which one is authoritative)", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: {
      ...graph,
      cagr: [
        { description: "12.4% CAGR", evidenceIds: ["R12"], confidenceClassification: "Verified", confidenceScore: 82, confidenceLevel: "High" },
        { description: "9.8% CAGR", evidenceIds: ["R4"], confidenceClassification: "Estimated", confidenceScore: 55, confidenceLevel: "Medium" },
      ],
    },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true), null);
});

test("REAL PERSISTED REPORT (171cf10d-538a-4ad3-9ed9-b30e85914e85): CAGR content with no percentage at all still classifies as validationRequired via the existing empty-value gate, canonical-first check never overrides that", () => {
  const REAL_CAGR_CONTENT =
    "- [Estimated] https://www.emergenresearch.com/industry-report/us-contract-lifecycle-management-market — Emergen Research US CLM market report.\n| Confidence: 64/100 (Medium) | Evidence: [R12]";
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const cagrEvidence =
    resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, false) ||
    deriveMarketSizeMetricEvidenceLevel("CAGR", "", REAL_CAGR_CONTENT);
  assert.equal(cagrEvidence, "validationRequired");
});

test("REAL PERSISTED REPORT: the report's own actual persisted shape (unavailable_no_graph, per Task #29-#32's own audit) has no canonical state at all -- the CAGR resolver safely returns null and the pre-existing prose fallback runs completely unchanged", () => {
  const degradedMetadata = { marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" };
  const canonicalState = readMarketIntelligenceCanonicalState(degradedMetadata);
  assert.equal(canonicalState, null);
  assert.equal(resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true), null);
});

// --- 5. Competitor attribute-level provenance -----------------------------

test("REGRESSION: a competitor's overall existence evidenceIds is never the ONLY provenance signal -- strength/weakness/pricing each carry their OWN evidence-id link (or null when no qualifying item existed), never inherited from the row's existence score", () => {
  const evidence = [
    evidenceItem({
      id: "R40",
      name: "Ironclad",
      url: "https://ironclad.com",
      claim: "Ironclad is a CLM and contract-lifecycle vendor serving mid-market and enterprise buyers.",
    }),
    evidenceItem({
      id: "R41",
      name: "Ironclad",
      url: "https://ironclad.com/features",
      claim: "Ironclad's key strength is its native Salesforce and DocuSign integration feature set.",
    }),
    evidenceItem({
      id: "R42",
      name: "Ironclad",
      url: "https://ironclad.com/reviews",
      claim: "A known weakness and limitation of Ironclad is its steep onboarding and configuration cost.",
    }),
    evidenceItem({
      id: "R43",
      name: "Ironclad",
      url: "https://ironclad.com/pricing",
      claim: "Ironclad's pricing model is custom quote-based, not published on its pricing page.",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "CLM software for mid-market companies");
  const ironclad = graph.competitors.find((competitor) => competitor.name.toLowerCase().includes("ironclad"));
  assert.ok(ironclad, "Ironclad must be discovered as a competitor from this evidence");

  // The row's overall existence corroboration is real, aggregate data --
  // untouched by this fix.
  assert.ok(Array.isArray(ironclad.evidenceIds));
  assert.ok(ironclad.evidenceIds.length > 0);

  // The 3 new per-attribute fields exist on the type and are independent
  // of (never simply copied from) the aggregate evidenceIds list.
  assert.ok("strengthEvidenceId" in ironclad);
  assert.ok("weaknessEvidenceId" in ironclad);
  assert.ok("pricingEvidenceId" in ironclad);
});

test("REGRESSION: competitor per-attribute evidence ids survive generation -> canonical persistence verbatim (the competitors array is spread through, not reconstructed)", () => {
  const evidence = [
    evidenceItem({ id: "R40", name: "Ironclad", url: "https://ironclad.com" }),
    evidenceItem({
      id: "R41",
      name: "Ironclad",
      url: "https://ironclad.com/features",
      claim: "Ironclad's key strength is its native Salesforce and DocuSign integration feature set.",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "CLM software for mid-market companies");
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  const graphCompetitor = graph.competitors.find((c) => c.name.toLowerCase().includes("ironclad"));
  const canonicalCompetitor = canonicalState.competitors.find((c) => c.name.toLowerCase().includes("ironclad"));
  assert.ok(graphCompetitor && canonicalCompetitor);
  assert.equal(canonicalCompetitor.strengthEvidenceId, graphCompetitor.strengthEvidenceId);
  assert.equal(canonicalCompetitor.weaknessEvidenceId, graphCompetitor.weaknessEvidenceId);
  assert.equal(canonicalCompetitor.pricingEvidenceId, graphCompetitor.pricingEvidenceId);
});

test("STRUCTURAL AUDIT: the Competitive Landscape table's UI caption already states Vendor Confidence does not verify category/position/strengths/weaknesses -- this task's per-attribute ids are additive structured data, not a UI redesign", () => {
  for (const source of [dashboardReportSource, plannerSource]) {
    assert.match(source, /does not verify the category, position, strengths, or/);
  }
});

// --- 6. Recommendations: evidence ties must point to real canonical evidence

test("REGRESSION: an evidenceTie naming a citation that resolves in the real registry counts as 'evidence'; the same shape naming a dangling id does not", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Account Validation Sprint -- Owner: Head of Sales; Budget ceiling: $75,000.";

  const resolvable = classifyStrategicRecommendationAction({
    item,
    signals: { budget: "$75,000", metric: "", timeframe: "", owner: "", gate: "", activity: "", evidenceTie: "Ironclad pricing page [R4]" },
    canonicalState,
  });
  assert.equal(resolvable.numericBasis, "evidence");

  const dangling = classifyStrategicRecommendationAction({
    item,
    signals: { budget: "$75,000", metric: "", timeframe: "", owner: "", gate: "", activity: "", evidenceTie: "Ironclad pricing page [R999]" },
    canonicalState,
  });
  assert.equal(dangling.numericBasis, "planning_assumption");
});

test("REGRESSION: descriptive (non-citation) evidenceTie text never upgrades a recommendation's numeric fields to 'evidence', regardless of how evidentiary it sounds", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const item = "Pricing & Procurement Discovery -- Owner: Head of BD; Budget ceiling: $20,000.";
  const result = classifyStrategicRecommendationAction({
    item,
    signals: { budget: "$20,000", metric: "", timeframe: "", owner: "", gate: "", activity: "", evidenceTie: "documented realized per-user pricing and procurement terms" },
    canonicalState,
  });
  assert.equal(result.numericBasis, "planning_assumption");
});

// --- 7. UI/PDF parity ------------------------------------------------------

test("REGRESSION: web (page.tsx / Planner.tsx) CAGR evidence resolution is identical for the same canonical state and value, since both call the same shared functions", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO");
  const webResult = resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true);
  const otherResult = resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true);
  assert.equal(webResult, otherResult);
});

test("STRUCTURAL AUDIT: both page.tsx and Planner.tsx import and call resolveMarketIntelligenceCagrEvidenceLevel for the CAGR card", () => {
  for (const [name, source] of [
    ["page.tsx", dashboardReportSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceCagrEvidenceLevel,/, `${name}: import missing`);
    assert.match(
      source,
      /isCagr && resolveMarketIntelligenceCagrEvidenceLevel\(marketIntelligenceCanonicalState, Boolean\(value\)\)/,
      `${name}: call site missing`
    );
  }
});

// --- 8. Canonical MONITOR/ENTER/AVOID decision remains unchanged ----------

test("REGRESSION: none of this task's new provenance functions read, mutate, or influence the canonical decision or its confidence", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 50 });

  isKnownCitationId(canonicalState, "R4");
  resolveMarketIntelligenceCagrEvidenceLevel(canonicalState, true);
  classifyStrategicRecommendationAction({
    item: "Scale up marketing spend to capture the full addressable market this quarter.",
    signals: { budget: "$500,000", metric: "", timeframe: "", owner: "", gate: "", activity: "", evidenceTie: "" },
    canonicalState,
  });

  assert.equal(canonicalState.decision, "CONDITIONAL_GO");
  assert.equal(canonicalState.confidence, 50);
});

test("REGRESSION: the same canonical decision (MONITOR / CONDITIONAL_GO), (ENTER / GO), and (AVOID / NO_GO) all persist their evidenceIds/cagr fields identically -- the new fields are decision-independent structured data, never a second decision signal", () => {
  for (const decision of ["GO", "CONDITIONAL_GO", "NO_GO"]) {
    const canonicalState = canonicalStateFor(decision);
    assert.equal(canonicalState.decision, decision);
    assert.ok(Array.isArray(canonicalState.cagr));
    if (canonicalState.marketSizing) {
      assert.ok(Array.isArray(canonicalState.marketSizing.evidenceIds));
    }
  }
});
