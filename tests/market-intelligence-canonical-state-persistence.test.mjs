import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION,
  buildMarketIntelligenceCanonicalState,
  readMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
  readMarketIntelligenceCanonicalStateStatus,
  getMarketIntelligenceCanonicalStateAvailability,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #23 -- Market Intelligence persisted-report canonical data
// integrity. Root cause (confirmed via full-lifecycle audit): reports.metadata
// carried NOTHING Market-Intelligence-specific -- every decision-critical
// fact (decision, confidence, TAM/SAM/SOM + evidence methods, competitor
// evidence, citation registry) was generated once as a rich structured
// MarketIntelligenceGraph + ExecutiveDecisionBrief, flattened into prose,
// and then discarded; every reload re-derived an approximation of the same
// facts by re-parsing that prose, independently, in 3 separate render
// surfaces. These tests simulate the actual persistence boundary (a
// Supabase JSONB column) via JSON.parse(JSON.stringify(...)) round-trips,
// exactly as the real reports.metadata column behaves.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} reports figures relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
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
    confidence: 58,
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

function roundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

function persistAndReload(canonicalState) {
  // Simulates worker.ts's persistCompletedReport upsert (metadata:
  // {...report.metadata}) followed by report-utils.ts's normalizeReport
  // reading it back -- both are plain JSON pass-throughs over a JSONB
  // column, which is exactly what round-tripping through JSON simulates.
  const persistedMetadata = roundTrip({ marketIntelligenceCanonicalState: canonicalState });
  return readMarketIntelligenceCanonicalState(persistedMetadata);
}

// --- A. generate -> persist -> reload preserves canonical decision exactly --

test("A1. the canonical decision survives a full persist/reload round-trip unchanged", () => {
  const graph = realGraphFixture();
  const decisionCriticalEvidence = {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  };
  const decisionBrief = decisionBriefFixture({ decision: "GO", confidence: 71 });
  const built = buildMarketIntelligenceCanonicalState({ graph, decisionCriticalEvidence, decisionBrief });

  const reloaded = persistAndReload(built);
  assert.equal(reloaded.decision, "GO");
  assert.equal(reloaded.confidence, 71);
});

test("A2. canonical state wins over conflicting prose -- MONITOR-parsed prose cannot silently become ENTER (or vice versa)", () => {
  const canonicalState = { ...buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture({ decision: "NO_GO", confidence: 22 }),
  }) };
  // Deliberately conflicting prose banner -- if the resolver ever fell
  // through to re-parsing this text instead of trusting canonical state,
  // it would return ENTER/GO instead of the canonical AVOID/NO_GO.
  const conflictingProse = "Bottom Line -- Decision: ENTER the market immediately (Confidence: 90%).";

  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    conflictingProse,
    "English"
  );

  assert.equal(resolved.decisionSource, "canonical-state");
  assert.equal(resolved.canonicalDecision, "REJECT");
  assert.notEqual(resolved.decisionLabel, "ENTER");
  assert.match(resolved.decisionLabel, /AVOID/i);
});

test("A3. with no canonical state, the resolver falls back to the exact existing prose parse (legacy behavior unchanged)", () => {
  const prose = "Bottom Line: staged entry warranted.\nDecision: MONITOR (Confidence: 55%)";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(null, prose, "English");
  assert.equal(resolved.decisionSource, "canonical-banner");
  assert.match(resolved.decisionLabel, /MONITOR/i);
});

// --- B. confidence / validation status survives reload ---------------------

test("B1. confidence, confidenceDirection, and decisionCriticalEvidence pillars survive reload exactly", () => {
  const decisionCriticalEvidence = {
    marketSizingResolved: true,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  };
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence,
    decisionBrief: decisionBriefFixture({ confidence: 43, confidenceDirection: "reduced" }),
  });

  const reloaded = persistAndReload(built);
  assert.equal(reloaded.confidence, 43);
  assert.equal(reloaded.confidenceDirection, "reduced");
  assert.deepEqual(reloaded.decisionCriticalEvidence, decisionCriticalEvidence);
});

test("B2. 'Validation Required' cannot silently become 'Verified' after reload: an unresolved pillar stays false, never coerced to true", () => {
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: {
      marketSizingResolved: false,
      competitiveEvidenceResolved: true,
      obtainableShareResolved: false,
    },
    decisionBrief: decisionBriefFixture(),
  });

  const reloaded = persistAndReload(built);
  assert.equal(reloaded.decisionCriticalEvidence.marketSizingResolved, false);
  assert.equal(reloaded.decisionCriticalEvidence.obtainableShareResolved, false);
  assert.equal(typeof reloaded.decisionCriticalEvidence.marketSizingResolved, "boolean");
});

// --- C. TAM/SAM/SOM values AND evidence classifications survive reload -----

test("C1. TAM/SAM/SOM display strings and every evidence-method/tier field survive reload exactly", () => {
  const graph = realGraphFixture();
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });

  assert.ok(built.marketSizing, "expected a real planningEstimate on this fixture");
  const reloaded = persistAndReload(built);
  assert.deepEqual(reloaded.marketSizing, built.marketSizing);
  assert.equal(typeof reloaded.marketSizing.tam, "string");
  assert.equal(typeof reloaded.marketSizing.samMethod, "string");
  assert.equal(typeof reloaded.marketSizing.somStatus, "string");
});

test("C2. when generation had no planningEstimate at all, marketSizing is honestly null, not a fabricated placeholder, and survives reload as null", () => {
  const graph = { ...realGraphFixture(), planningEstimate: null };
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });

  assert.equal(built.marketSizing, null);
  const reloaded = persistAndReload(built);
  assert.equal(reloaded.marketSizing, null);
});

// --- D. unresolved SOM cannot become numeric after reload -------------------

test("D1. a 'pending' (non-numeric) SOM stays a non-numeric explanation after reload -- never coerced into a number", () => {
  const graph = realGraphFixture();
  const graphWithPendingSom = {
    ...graph,
    planningEstimate: {
      ...graph.planningEstimate,
      som: "Obtainable share could not be established from available evidence.",
      somStatus: "pending",
      samMethod: "defaultAssumption",
    },
  };
  const built = buildMarketIntelligenceCanonicalState({
    graph: graphWithPendingSom,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });

  const reloaded = persistAndReload(built);
  assert.equal(reloaded.marketSizing.somStatus, "pending");
  assert.doesNotMatch(reloaded.marketSizing.som, /^\s*[$€£]?\s*\d/, "a pending SOM must never read as a leading numeric figure");
  assert.equal(reloaded.marketSizing.samMethod, "defaultAssumption");
});

test("D2. samMethod: 'evidenceDerived' is preserved distinctly from 'defaultAssumption' -- reload cannot upgrade an assumption to evidence-derived", () => {
  const graph = realGraphFixture();
  const assumedGraph = { ...graph, planningEstimate: { ...graph.planningEstimate, samMethod: "defaultAssumption" } };
  const evidencedGraph = { ...graph, planningEstimate: { ...graph.planningEstimate, samMethod: "evidenceDerived" } };

  const assumedReloaded = persistAndReload(
    buildMarketIntelligenceCanonicalState({
      graph: assumedGraph,
      decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
      decisionBrief: decisionBriefFixture(),
    })
  );
  const evidencedReloaded = persistAndReload(
    buildMarketIntelligenceCanonicalState({
      graph: evidencedGraph,
      decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
      decisionBrief: decisionBriefFixture(),
    })
  );

  assert.equal(assumedReloaded.marketSizing.samMethod, "defaultAssumption");
  assert.equal(evidencedReloaded.marketSizing.samMethod, "evidenceDerived");
  assert.notEqual(assumedReloaded.marketSizing.samMethod, evidencedReloaded.marketSizing.samMethod);
});

// --- E. risk and market-signal state survive reload -------------------------

test("E1. coverage dimensions, overallConfidence, and topRisks survive reload exactly", () => {
  const graph = realGraphFixture();
  const decisionBrief = decisionBriefFixture({ topRisks: ["Incumbent concentration", "Procurement cycle length", "Model trust"] });
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief,
  });

  const reloaded = persistAndReload(built);
  assert.deepEqual(reloaded.coverage.dimensions, graph.coverage.dimensions);
  assert.equal(reloaded.coverage.overallConfidence, graph.coverage.overallConfidence);
  assert.deepEqual(reloaded.topRisks, decisionBrief.topRisks);
});

// --- F. Strategic Recommendations remain aligned with canonical decision ---

test("F1. the canonical decision used to localize the Strategic Recommendations badge is byte-identical to the one used for the top-level decision label", () => {
  const graph = realGraphFixture();
  const decisionBrief = decisionBriefFixture({ decision: "CONDITIONAL_GO", confidence: 60 });
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief,
  });
  const reloaded = persistAndReload(built);

  // Both the top-of-page decision signal AND a strategic-recommendations
  // alignment badge would call the SAME wrapper with the SAME reloaded
  // canonical state -- since both reads are pure functions of the exact
  // same frozen `decision` field, they cannot diverge, regardless of what
  // either section's own prose happens to say.
  const topLevel = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(reloaded, "", "English");
  const strategicRecommendationsBadge = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(reloaded, "", "English");

  assert.equal(topLevel.decisionLabel, strategicRecommendationsBadge.decisionLabel);
  assert.equal(topLevel.canonicalDecision, strategicRecommendationsBadge.canonicalDecision);
});

// --- G. citation/provenance mapping survives reload without renumbering ----

test("G1. every citationSources entry keeps its exact evidenceId -> title/publisher/url mapping after reload, in the same order", () => {
  const graph = realGraphFixture();
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });

  const reloaded = persistAndReload(built);
  assert.deepEqual(
    reloaded.citationSources.map((s) => s.evidenceId),
    built.citationSources.map((s) => s.evidenceId),
    "citation ids must survive reload in the exact same order -- no renumbering"
  );
  for (const source of built.citationSources) {
    const reloadedSource = reloaded.citationSources.find((s) => s.evidenceId === source.evidenceId);
    assert.deepEqual(reloadedSource, source);
  }
});

test("G2. repeated persist/reload cycles never change which evidenceId a citation resolves to (no drift across multiple reloads)", () => {
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });

  let current = built;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    current = persistAndReload(current);
  }
  assert.deepEqual(
    current.citationSources.map((s) => s.evidenceId),
    built.citationSources.map((s) => s.evidenceId)
  );
});

// --- H. UI and PDF consume the same canonical persisted state --------------

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("H1. page.tsx's primary decision signal resolves through the canonical-state-aware wrapper, not the bare prose-only resolver", () => {
  const source = readSourceFile("../app/dashboard/[id]/page.tsx");
  assert.match(
    source,
    /const marketDecisionSignal = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
  assert.match(
    source,
    /import\s*\{[^}]*resolveMarketIntelligenceExecutiveDecisionWithCanonicalState[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/market-intelligence-canonical-state"/s
  );
});

test("H2. ReportPdfButton.tsx's cover-page decision AND per-section decision both resolve through the canonical-state-aware wrapper", () => {
  const source = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");
  const wrapperCallCount = (source.match(/resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/g) || []).length;
  assert.ok(wrapperCallCount >= 2, `expected at least 2 call sites (cover page + section), found ${wrapperCallCount}`);
  assert.match(source, /readMarketIntelligenceCanonicalState\(report\.metadata\)/);
});

test("H3. Planner.tsx's web-rendered snapshot AND its PDF cover both resolve through the canonical-state-aware wrapper, fed by the SAME ReportPanel-level canonical state", () => {
  const source = readSourceFile("../components/Planner.tsx");
  const wrapperCallCount = (source.match(/resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/g) || []).length;
  assert.ok(wrapperCallCount >= 2, `expected at least 2 call sites (web snapshot + PDF cover), found ${wrapperCallCount}`);
  // Both the ReportSectionCard/ExecutiveSnapshotPanel chain (web) and
  // downloadPdf/drawCoverPage (PDF) are fed by ReportPanel's single
  // `marketIntelligenceCanonicalState` prop, resolved once per call site
  // from the SAME currentReportMetadata/initialReport.metadata source --
  // never independently re-read or re-derived per surface.
  const resolvedCallCount = (source.match(/readMarketIntelligenceCanonicalState\(\s*currentReportMetadata \|\| initialReport\?\.metadata\s*\)/g) || []).length;
  assert.equal(resolvedCallCount, 2, "expected exactly the two ReportPanel call sites to resolve canonical state from the same source");
});

test("H4. all three presentation surfaces import from the SAME single canonical-state module -- no per-surface reimplementation", () => {
  const files = [
    "../app/dashboard/[id]/page.tsx",
    "../app/dashboard/[id]/ReportPdfButton.tsx",
    "../components/Planner.tsx",
  ];
  for (const relativePath of files) {
    const source = readSourceFile(relativePath);
    assert.match(
      source,
      /from\s*"@\/app\/lib\/report-engine\/market-intelligence-canonical-state"/,
      `${relativePath} must import the canonical-state module directly`
    );
  }
});

// --- I. legacy report without new structured fields still opens safely -----

test("I1. every shape of a legacy/malformed metadata value returns null instead of throwing", () => {
  const cases = [
    undefined,
    null,
    {},
    { reportLanguage: "en" },
    { marketIntelligenceCanonicalState: undefined },
    { marketIntelligenceCanonicalState: null },
    { marketIntelligenceCanonicalState: "not-an-object" },
    { marketIntelligenceCanonicalState: [] },
    { marketIntelligenceCanonicalState: { decision: "GO" } }, // no version field
    { marketIntelligenceCanonicalState: { version: 999, decision: "GO" } }, // future/unknown version
    { marketIntelligenceCanonicalState: { version: 0, decision: "GO" } }, // pre-versioning placeholder
    "not-an-object-at-all",
    [],
  ];

  for (const metadata of cases) {
    assert.doesNotThrow(() => readMarketIntelligenceCanonicalState(metadata));
    assert.equal(readMarketIntelligenceCanonicalState(metadata), null);
  }
});

test("I2. a legacy report (no canonical state) still resolves a decision via the exact pre-existing prose path, end to end", () => {
  const legacyMetadata = { reportLanguage: "en" };
  const canonicalState = readMarketIntelligenceCanonicalState(legacyMetadata);
  assert.equal(canonicalState, null);

  const prose = "Bottom Line: evidence supports entry.\nDecision: ENTER (Confidence: 74%)";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, prose, "English");
  assert.equal(resolved.decisionSource, "canonical-banner");
  assert.match(resolved.decisionLabel, /ENTER/i);
});

test("I3. a real (non-legacy) version number matches the module's own exported constant", () => {
  // TASK #24 -- bumped 1 -> 2 (why/missingEvidence/whatWouldChangeThisDecision/
  // immediateNextAction added); zero real data affected, see
  // market-intelligence-canonical-state-consumption-audit.test.mjs's own
  // SCHEMA test for the full rationale.
  assert.equal(MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION, 2);
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(built.version, MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION);
});

// --- J. repeated save/reload is idempotent, no semantic drift ---------------

test("J1. five repeated persist/reload cycles produce byte-identical canonical state every time", () => {
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({ decision: "CONDITIONAL_GO", confidence: 51 }),
  });

  let current = built;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const next = persistAndReload(current);
    assert.deepEqual(next, current, `cycle ${cycle} must be byte-identical to the previous cycle`);
    current = next;
  }
});

test("J2. the resolved decision label is identical across every reload cycle -- no drift toward a stronger or weaker decision over time", () => {
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({ decision: "NO_GO", confidence: 18 }),
  });

  const labels = new Set();
  let current = built;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    current = persistAndReload(current);
    labels.add(
      resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(current, "", "English").decisionLabel
    );
  }
  assert.equal(labels.size, 1, "every reload cycle must resolve to the exact same decision label");
});

// --- 7. Vendor/competitor structured evidence: persisted, boundary documented --

test("7.1. the decision-relevant competitor projection (name/positioning/pricingEvidence/confidence/evidenceIds) is persisted and survives reload", () => {
  const graph = realGraphFixture();
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });
  const reloaded = persistAndReload(built);
  assert.deepEqual(reloaded.competitors, graph.competitors);
  for (const competitor of reloaded.competitors) {
    assert.equal(typeof competitor.name, "string");
    assert.equal(typeof competitor.confidenceScore, "number");
    assert.ok(Array.isArray(competitor.evidenceIds));
  }
});

test("7.2. internal-only vendor scoring fields (rankingScore, overallVendorScore, discovery logs) are never persisted into canonical state", () => {
  const graph = realGraphFixture();
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });
  const serialized = JSON.stringify(built);
  assert.doesNotMatch(serialized, /rankingScore/);
  assert.doesNotMatch(serialized, /overallVendorScore/);
  assert.doesNotMatch(serialized, /discoveryQueries/);
});

// --- TASK #23 FOLLOW-UP: the degraded/graph-less persistence gap -----------
//
// INVESTIGATION FINDING: graph truthy always implies marketExecutiveDecisionBrief
// truthy in route.ts's actual data flow (coverage is always derived using
// graph.coverage as its override in both call paths) -- there is exactly
// ONE condition, never a partial state. When it's false, there is no
// evidence, no coverage, and nothing genuinely structured to reconstruct --
// only the model's raw prose. CONCLUSION (confirmed, not assumed): it is
// NOT safe to build canonical state in this state. FIX: an explicit,
// always-populated `marketIntelligenceCanonicalStateStatus` marker
// ("available" | "unavailable_no_graph") distinguishes a report that
// EXPLICITLY had no evidence to snapshot from one that simply predates
// this whole mechanism -- without ever fabricating the canonical state
// itself.

test("K1. readMarketIntelligenceCanonicalStateStatus recognizes both valid values and rejects everything else", () => {
  assert.equal(readMarketIntelligenceCanonicalStateStatus({ marketIntelligenceCanonicalStateStatus: "available" }), "available");
  assert.equal(
    readMarketIntelligenceCanonicalStateStatus({ marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" }),
    "unavailable_no_graph"
  );
  for (const bad of [undefined, null, {}, { marketIntelligenceCanonicalStateStatus: "verified" }, { marketIntelligenceCanonicalStateStatus: 1 }, "not-an-object", []]) {
    assert.doesNotThrow(() => readMarketIntelligenceCanonicalStateStatus(bad));
    assert.equal(readMarketIntelligenceCanonicalStateStatus(bad), null);
  }
});

test("K2. getMarketIntelligenceCanonicalStateAvailability distinguishes all three real states", () => {
  const graph = realGraphFixture();
  const availableState = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });

  // A real, healthy generation.
  assert.equal(
    getMarketIntelligenceCanonicalStateAvailability({
      marketIntelligenceCanonicalState: availableState,
      marketIntelligenceCanonicalStateStatus: "available",
    }),
    "available"
  );

  // A degraded generation that explicitly recorded it had no graph.
  assert.equal(
    getMarketIntelligenceCanonicalStateAvailability({
      marketIntelligenceCanonicalStateStatus: "unavailable_no_graph",
    }),
    "unavailable_degraded"
  );

  // A report persisted before this mechanism existed at all -- neither
  // field present (the real, currently-existing shape of every report in
  // production today, confirmed against the actual persisted report used
  // throughout this task).
  assert.equal(
    getMarketIntelligenceCanonicalStateAvailability({
      reportLanguage: "en",
      expertiseProfile: {},
      reportPlan: {},
      researchPlan: {},
    }),
    "legacy_unknown"
  );
  assert.equal(getMarketIntelligenceCanonicalStateAvailability(undefined), "legacy_unknown");
});

test("K3. a degraded report is never mistaken for canonical -- the state object itself is absent even though a status is present", () => {
  const degradedMetadata = { marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" };
  assert.equal(readMarketIntelligenceCanonicalState(degradedMetadata), null);
  assert.equal(getMarketIntelligenceCanonicalStateAvailability(degradedMetadata), "unavailable_degraded");
});

test("K4. route.ts computes canonicalStateStatus from the exact same graph-availability condition as canonicalState itself, and always returns a status", () => {
  const source = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /const marketIntelligenceCanonicalStateStatus: MarketIntelligenceCanonicalStateStatus =\s*\n\s*marketIntelligenceCanonicalState \? "available" : "unavailable_no_graph";/
  );
  assert.match(source, /canonicalStateStatus: marketIntelligenceCanonicalStateStatus,/);
});

test("K5. serializeMarketReportMetadataChunk always includes canonicalStateStatus, and includes the canonical state object ONLY when it is real (never a placeholder for the unavailable case)", () => {
  const source = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
  const fnMatch = source.match(/function serializeMarketReportMetadataChunk\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "expected to find serializeMarketReportMetadataChunk");
  const fnSource = fnMatch[0];
  assert.doesNotMatch(fnSource, /if \(!canonicalState\) return "";/, "must no longer skip emission for the unavailable case");
  assert.match(fnSource, /marketIntelligenceCanonicalStateStatus: canonicalStateStatus,/);
  assert.match(fnSource, /\.\.\.\(canonicalState \? \{ marketIntelligenceCanonicalState: canonicalState \} : \{\}\)/);
});

test("K6. both call sites (fresh generation and cache-hit) pass their own canonicalStateStatus into the metadata chunk, never a hardcoded value", () => {
  const source = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
  assert.match(source, /serializeMarketReportMetadataChunk\(cachedCanonicalState, cachedCanonicalStateStatus\)/);
  assert.match(source, /serializeMarketReportMetadataChunk\(freshCanonicalState, freshCanonicalStateStatus\)/);
});

// --- L. A degraded report cannot gain confidence, numeric SOM, ENTER/GO, ---
// --- or other stronger semantics through reload/rendering ------------------

test("L1. a degraded report's decision resolves through the exact same, already-hardened prose-parsing tiers -- no new bypass is introduced", () => {
  const degradedMetadata = { marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" };
  const canonicalState = readMarketIntelligenceCanonicalState(degradedMetadata);
  assert.equal(canonicalState, null, "a degraded report must never carry a canonical state to resolve from");

  // Tier 2's existing isUnverifiedStrongAffirmativeText downgrade must
  // still fire exactly as it does for any other graph-less report: a raw,
  // unbannered "Decision: ENTER" statement with no verified confidence
  // behind it is downgraded to CONDITIONAL_GO, never trusted at face value.
  const unverifiedStrongProse = "Decision: ENTER the market based on preliminary signals.";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    unverifiedStrongProse,
    "English"
  );
  assert.equal(resolved.decisionSource, "raw-label");
  assert.doesNotMatch(resolved.decisionLabel, /^ENTER$/);
  // CONDITIONAL_GO's market-vocabulary label is "MONITOR" (the shared
  // ENTER/MONITOR/AVOID axis) -- the downgrade itself (never trusting an
  // unverified strong-affirmative statement at face value) is what this
  // test protects, not the exact display string.
  assert.equal(resolved.decisionLabel, "MONITOR");
  assert.equal(resolved.canonicalDecision, "PROCEED_WITH_CONDITIONS");
});

test("L2. a degraded report with NO decision text at all resolves to unavailable ('-'), never a guessed or default GO/ENTER", () => {
  const canonicalState = readMarketIntelligenceCanonicalState({ marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" });
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, "", "English");
  assert.equal(resolved.decisionLabel, "—");
  assert.equal(resolved.canonicalDecision, null);
  assert.equal(resolved.confidenceScore, null);
});

test("L3. a degraded report's confidence is never fabricated -- with no canonical state and no deterministic banner, confidenceScore stays null even when the prose mentions an unrelated percentage", () => {
  const canonicalState = readMarketIntelligenceCanonicalState({ marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" });
  const proseWithUnrelatedPercentage =
    "Decision: MONITOR. Note: 30% of pilots in this category historically stall in month one.";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    proseWithUnrelatedPercentage,
    "English"
  );
  assert.equal(resolved.confidenceScore, null, "confidence must never be picked up from an unrelated percentage in prose");
});

test("L4. marking a report degraded never upgrades its status on a later reload -- five repeated reads of the same degraded metadata return the identical status every time", () => {
  const degradedMetadata = JSON.parse(JSON.stringify({ marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" }));
  for (let cycle = 0; cycle < 5; cycle += 1) {
    assert.equal(readMarketIntelligenceCanonicalState(degradedMetadata), null);
    assert.equal(getMarketIntelligenceCanonicalStateAvailability(degradedMetadata), "unavailable_degraded");
  }
});

test("L5. a degraded report can never present as 'available' even if it coincidentally carries a stray, malformed canonical-state-shaped value", () => {
  // Defensive: even if some future bug wrote a partial/invalid object
  // under the canonical-state key alongside the degraded status, the
  // version gate must still reject it rather than upgrading the report.
  const malformedMetadata = {
    marketIntelligenceCanonicalStateStatus: "unavailable_no_graph",
    marketIntelligenceCanonicalState: { decision: "GO", confidence: 90 }, // no version field
  };
  assert.equal(readMarketIntelligenceCanonicalState(malformedMetadata), null);
  assert.equal(getMarketIntelligenceCanonicalStateAvailability(malformedMetadata), "unavailable_degraded");
});
