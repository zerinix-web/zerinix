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
  constrainMarketSizingResolutionToCanonicalState,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #24 -- Audit and harden Market Intelligence canonical-state
// consumption across all decision-critical surfaces.
//
// ROOT CAUSE (confirmed via full trace of page.tsx, components/Planner.tsx,
// and app/dashboard/[id]/ReportPdfButton.tsx): Task #23 wired canonical
// state into 6 of 15 decision-resolver call sites and left TAM/SAM/SOM
// resolution, coverage/confidence duplication, and "Next Action" entirely
// on independent prose-parsing paths. Concretely:
//  - Investment Decision Snapshot (ExecutiveSummaryVisual, both files) --
//    bare resolveMarketIntelligenceExecutiveDecision(content, locale).
//  - Decision/confidence/market-signal panel (ExecutiveSnapshotPanel, both
//    files) -- same.
//  - Strategic Recommendations decision badge (3 call sites: page.tsx's
//    ReportSectionVisual, Planner.tsx's PremiumSectionVisual AND its own
//    separate PDF drawing code, ReportPdfButton.tsx) -- same.
//  - Planner.tsx's own PDF Executive Decision card
//    (getExecutiveDecisionCardLayout) -- same.
//  - TAM/SAM/SOM "resolved" (Data Confirmed) badges -- computed purely
//    from re-parsing the section's own prose back into magnitudes
//    (resolveTamSamSomCascade / the shared resolveMarketSizingCascade),
//    completely independent of canonical state's own samMethod/somStatus
//    -- the exact "reconstructs a stronger... fact" failure mode this
//    audit targets, since a prose-formatting quirk could make an ASSUMED
//    SAM or PENDING SOM look resolved.
//  - page.tsx's "Recommended Next Step"/"Main Risk"/"Decision Confidence"
//    tiles -- independent extractMetricValueFromAliases/
//    extractDecisionConfidenceValue scans over the same content the
//    canonical decision was already resolved from.
//
// FIX: every one of the 9 remaining bare resolveMarketIntelligenceExecutiveDecision
// call sites now goes through resolveMarketIntelligenceExecutiveDecisionWithCanonicalState
// (confirmed below: ZERO bare call sites remain in any of the 3 files).
// A new constrainMarketSizingResolutionToCanonicalState narrows (never
// widens) every TAM/SAM/SOM resolution using canonical state's
// samMethod/somStatus, applied at all 4 resolution call sites (page.tsx
// web, Planner.tsx web, Planner.tsx PDF, ReportPdfButton.tsx PDF -- the
// latter two share ONE fix point, report-presentation.ts's
// resolveMarketSizingCascade, since both already called it). Canonical
// state gained why/missingEvidence/whatWouldChangeThisDecision/
// immediateNextAction (version bumped 1 -> 2, zero real data affected --
// no report persisted before this task carries any canonical state at
// all) so "Next Action" has a canonical source instead of falling back to
// prose extraction even when canonical state is otherwise available.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
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

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const pageSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");
const pdfButtonSource = readSourceFile("../app/dashboard/[id]/ReportPdfButton.tsx");

// --- Structural audit: zero bare decision-resolver call sites remain ------

test("STRUCTURAL AUDIT: no bare resolveMarketIntelligenceExecutiveDecision( call sites remain in any of the 3 decision-critical surfaces", () => {
  // A bare call is the literal substring "resolveMarketIntelligenceExecutiveDecision("
  // -- since the wrapper's name is "resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(",
  // it never matches this pattern at all (the character immediately after
  // "...Decision" is "W", not "("), so a non-zero count here can only mean
  // a genuine standalone bare call site.
  const bareCallPattern = /resolveMarketIntelligenceExecutiveDecision\(/g;
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    const bareMatches = source.match(bareCallPattern) || [];
    const withCanonicalStateMatches = source.match(/resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/g) || [];
    assert.equal(bareMatches.length, 0, `${name}: expected zero bare resolveMarketIntelligenceExecutiveDecision( call sites`);
    assert.ok(withCanonicalStateMatches.length > 0, `${name}: expected at least one canonical-state-aware decision resolution`);
  }
});

test("STRUCTURAL AUDIT: the bare resolver is no longer imported anywhere it isn't used (dead-import guard)", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\bresolveMarketIntelligenceExecutiveDecision\b(?!WithCanonicalState)[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/executive-decision-vocabulary"/,
      `${name} still imports the bare resolver despite having no bare call sites`
    );
  }
});

test("STRUCTURAL AUDIT: all 4 TAM/SAM/SOM resolution call sites apply constrainMarketSizingResolutionToCanonicalState", () => {
  const reportPresentationSource = readSourceFile("../app/lib/report-presentation.ts");
  // page.tsx and Planner.tsx web: local resolveTamSamSomCascade, wrapped
  // at both its section-visual call site and its evidence-badge-dispatch
  // call site (getTamSamSomSectionEvidence).
  assert.match(pageSource, /constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveTamSamSomCascade\(content\)/);
  assert.match(plannerSource, /constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveTamSamSomCascade\(section\.content\)/);
  // Planner.tsx PDF and ReportPdfButton.tsx PDF: the shared
  // resolveMarketSizingCascade (report-presentation.ts), wrapped once at
  // each PDF drawing call site.
  assert.match(plannerSource, /constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveMarketSizingCascade\(magnitudes\)/);
  assert.match(pdfButtonSource, /constrainMarketSizingResolutionToCanonicalState\(\s*\n\s*resolveMarketSizingCascade\(magnitudes\)/);
  // The shared function itself is untouched -- the fix is applied at the
  // call site, not inside the pure magnitude-cascade function.
  assert.doesNotMatch(reportPresentationSource, /canonicalState/i);
});

test("STRUCTURAL AUDIT: getTamSamSomSectionEvidence / getSectionEvidenceLevel / getDashboardSectionEvidence thread canonical state through to the cascade (page.tsx and Planner.tsx)", () => {
  assert.match(pageSource, /function getTamSamSomSectionEvidence\(\s*\n\s*content: string,\s*\n\s*marketIntelligenceCanonicalState: MarketIntelligenceCanonicalState \| null = null/);
  assert.match(pageSource, /function getDashboardSectionEvidence\(\s*\n\s*section: \{[^}]*\},\s*\n\s*marketIntelligenceCanonicalState: MarketIntelligenceCanonicalState \| null = null/);
  assert.match(plannerSource, /function getTamSamSomSectionEvidence\(\s*\n\s*content: string,\s*\n\s*marketIntelligenceCanonicalState: MarketIntelligenceCanonicalState \| null = null/);
  assert.match(plannerSource, /function getSectionEvidenceLevel\(\s*\n\s*section: ReportSection,\s*\n\s*marketIntelligenceCanonicalState: MarketIntelligenceCanonicalState \| null = null/);
});

// --- constrainMarketSizingResolutionToCanonicalState: pure function tests --

test("NARROWING 1: canonical samMethod !== evidenceDerived turns a prose-resolved SAM into unresolved", () => {
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...realGraphFixture(), planningEstimate: { ...realGraphFixture().planningEstimate, samMethod: "defaultAssumption" } },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  const proseResolution = { tamResolved: true, samResolved: true, somResolved: true, allResolved: true };
  const constrained = constrainMarketSizingResolutionToCanonicalState(proseResolution, canonicalState);

  assert.equal(constrained.tamResolved, true, "TAM is not constrained by samMethod/somStatus");
  assert.equal(constrained.samResolved, false, "an assumption-based SAM must never present as resolved");
  assert.equal(constrained.allResolved, false, "allResolved must be recomputed from the constrained values");
});

test("NARROWING 2: canonical somStatus !== calculated turns a prose-resolved SOM into unresolved, independent of SAM", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, planningEstimate: { ...graph.planningEstimate, samMethod: "evidenceDerived", somStatus: "pending" } },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  const proseResolution = { tamResolved: true, samResolved: true, somResolved: true, allResolved: true };
  const constrained = constrainMarketSizingResolutionToCanonicalState(proseResolution, canonicalState);

  assert.equal(constrained.samResolved, true, "SAM stays resolved -- only SOM's own status gates it");
  assert.equal(constrained.somResolved, false, "a pending SOM must never present as a resolved numeric figure");
  assert.equal(constrained.allResolved, false);
});

test("NARROWING 3: canonical state can never UPGRADE a prose-parsed unresolved figure to resolved", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, planningEstimate: { ...graph.planningEstimate, samMethod: "evidenceDerived", somStatus: "calculated" } },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });
  const proseResolution = { tamResolved: true, samResolved: false, somResolved: false, allResolved: false };
  const constrained = constrainMarketSizingResolutionToCanonicalState(proseResolution, canonicalState);

  assert.equal(constrained.samResolved, false, "a prose-side failure to resolve SAM is never overridden to true");
  assert.equal(constrained.somResolved, false);
});

test("NARROWING 4: no-op when canonical state (or its marketSizing) is unavailable -- existing behavior fully preserved", () => {
  const proseResolution = { tamResolved: true, samResolved: true, somResolved: true, allResolved: true };
  assert.deepEqual(constrainMarketSizingResolutionToCanonicalState(proseResolution, null), proseResolution);

  const canonicalWithNoMarketSizing = buildMarketIntelligenceCanonicalState({
    graph: { ...realGraphFixture(), planningEstimate: null },
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  assert.deepEqual(constrainMarketSizingResolutionToCanonicalState(proseResolution, canonicalWithNoMarketSizing), proseResolution);
});

test("NARROWING 5: works generically without an `allResolved` field on the input shape (no crash, no spurious field added)", () => {
  const graph = realGraphFixture();
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: { ...graph, planningEstimate: { ...graph.planningEstimate, samMethod: "defaultAssumption" } },
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture(),
  });
  const minimalResolution = { samResolved: true, somResolved: true };
  const constrained = constrainMarketSizingResolutionToCanonicalState(minimalResolution, canonicalState);
  assert.equal(constrained.samResolved, false);
  assert.ok(!("allResolved" in constrained));
});

// --- Ticket scenario 1: canonical MONITOR + prose says ENTER -----------------

test("SCENARIO 1: canonical MONITOR (CONDITIONAL_GO) + prose says ENTER -> the resolved decision stays MONITOR-aligned, everywhere this function is called", () => {
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({ decision: "CONDITIONAL_GO", confidence: 55 }),
  });
  const conflictingProseVariants = [
    "Bottom Line -- Decision: ENTER the market immediately (Confidence: 95%).",
    "Decision: ENTER (Confidence: 99%)",
    "", // even empty prose must not change the outcome
  ];

  // Since every real call site (Investment Decision Snapshot, Executive
  // Snapshot, Strategic Recommendations badge -- web AND PDF, both
  // report files) calls this SAME function with the SAME canonical
  // state, proving the function itself is conflict-proof proves every
  // surface is -- confirmed structurally wired via the STRUCTURAL AUDIT
  // tests above (zero bare call sites remain).
  for (const prose of conflictingProseVariants) {
    const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, prose, "English");
    assert.equal(resolved.decisionSource, "canonical-state");
    assert.equal(resolved.decisionLabel, "MONITOR");
    assert.equal(resolved.canonicalDecision, "PROCEED_WITH_CONDITIONS");
    assert.equal(resolved.confidenceScore, 55);
    assert.notEqual(resolved.decisionLabel, "ENTER");
  }
});

// --- Ticket scenario 2: canonical ENTER with sufficient evidence remains ---

test("SCENARIO 2: canonical ENTER (GO) with all decision-critical evidence resolved remains ENTER -- never spuriously downgraded", () => {
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture({ decision: "GO", confidence: 82 }),
  });

  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "Decision: MONITOR (Confidence: 20%)", // even a conflicting, WEAKER prose statement
    "English"
  );
  assert.equal(resolved.decisionLabel, "ENTER");
  assert.equal(resolved.canonicalDecision, "PROCEED");
  assert.equal(resolved.confidenceScore, 82);
  assert.deepEqual(canonicalState.decisionCriticalEvidence, {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  });
});

// --- Ticket scenario 3: canonical unavailable/degraded + prose ENTER -------

test("SCENARIO 3: canonical unavailable/degraded + prose says ENTER -> the existing conservative fallback (Tier 2 downgrade) still applies", () => {
  const degradedMetadata = { marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" };
  const canonicalState = readMarketIntelligenceCanonicalState(degradedMetadata);
  assert.equal(canonicalState, null);

  const unverifiedStrongProse = "Decision: ENTER the market based on preliminary signals.";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, unverifiedStrongProse, "English");

  assert.equal(resolved.decisionSource, "raw-label");
  assert.notEqual(resolved.decisionLabel, "ENTER");
  assert.equal(resolved.decisionLabel, "MONITOR");
  assert.equal(resolved.confidenceScore, null, "confidence must never be fabricated for a degraded report");
});

test("SCENARIO 3b: a real, deterministic Tier-1 banner in a degraded report is still trusted at face value (the fallback is conservative, not blanket-suppressive)", () => {
  const canonicalState = readMarketIntelligenceCanonicalState({ marketIntelligenceCanonicalStateStatus: "unavailable_no_graph" });
  const deterministicBanner = "Decision: ENTER (Confidence: 82%)\nStrong evidence across all decision-critical pillars supports this call.";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, deterministicBanner, "English");
  assert.equal(resolved.decisionSource, "canonical-banner");
  assert.equal(resolved.decisionLabel, "ENTER");
  assert.equal(resolved.confidenceScore, 82);
});

// --- Ticket scenario 4: save -> reload -> UI -> PDF retains the same state -

test("SCENARIO 4: save -> reload -> UI -> PDF retains the exact same canonical decision, confidence, and risk state", () => {
  const graph = realGraphFixture();
  const decisionBrief = decisionBriefFixture({
    decision: "CONDITIONAL_GO",
    confidence: 61,
    topRisks: ["Incumbent concentration", "Procurement cycle length", "Model trust"],
  });
  const built = buildMarketIntelligenceCanonicalState({
    graph,
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false },
    decisionBrief,
  });

  // SAVE -> RELOAD (JSONB round-trip, exactly as worker.ts/Supabase behave).
  const reloaded = JSON.parse(JSON.stringify({ marketIntelligenceCanonicalState: built }));
  const canonicalState = readMarketIntelligenceCanonicalState(reloaded);
  assert.ok(canonicalState);

  // UI (Investment Decision Snapshot / Executive Snapshot Panel) and PDF
  // (cover page / Executive Decision card / Strategic Recommendations
  // badge) all call the exact same function -- simulated here against
  // DIFFERENT prose per "surface" to prove none of them can diverge.
  const uiExecutiveSummary = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "Some executive summary prose that might differ from other sections.",
    "English"
  );
  const uiStrategicRecommendations = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "",
    "English"
  );
  const pdfCover = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "A completely different prose variant, simulating PDF-side content extraction.",
    "English"
  );

  for (const result of [uiExecutiveSummary, uiStrategicRecommendations, pdfCover]) {
    assert.equal(result.decisionLabel, "MONITOR");
    assert.equal(result.canonicalDecision, "PROCEED_WITH_CONDITIONS");
    assert.equal(result.confidenceScore, 61);
  }

  assert.deepEqual(canonicalState.topRisks, decisionBrief.topRisks, "risk state must survive reload exactly");
  assert.equal(canonicalState.immediateNextAction, decisionBrief.immediateNextAction);
});

// --- Ticket scenario 5: Strategic Recommendations / Next Action cannot -----
// --- contradict canonical decision ------------------------------------------

test("SCENARIO 5a: the Strategic Recommendations badge (all 3 files, web + PDF) resolves through the SAME canonical-state-aware function as the top-level decision -- structurally cannot disagree", () => {
  assert.match(
    pageSource,
    /const strategicRecommendationDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
  assert.match(
    plannerSource,
    /const strategicRecommendationDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
  assert.match(
    plannerSource,
    /const strategicRecommendationDecision = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
  assert.match(
    pdfButtonSource,
    /const strategicRecommendationDecision = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
});

test("SCENARIO 5b: canonical state carries a real immediateNextAction that matches the canonical decision -- Next Action can no longer independently contradict it via a separate prose scan", () => {
  const canonicalState = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false },
    decisionBrief: decisionBriefFixture({
      decision: "NO_GO",
      confidence: 15,
      immediateNextAction: "Do not proceed until independent market-size verification exists.",
    }),
  });

  assert.equal(canonicalState.immediateNextAction, "Do not proceed until independent market-size verification exists.");
  assert.equal(canonicalState.decision, "NO_GO");

  // page.tsx's getDecisionSummaryItems prefers canonicalState.immediateNextAction
  // over its own extractMetricValueFromAliases prose scan whenever
  // canonical state is available.
  assert.match(
    pageSource,
    /const marketNextAction = isMarketIntelligence\s*\n\s*\? marketIntelligenceCanonicalState\?\.immediateNextAction \|\|/
  );
});

test("SCENARIO 5c: canonical state's main risk tile reads topRisks[0] directly, never independently re-derived from prose when available", () => {
  assert.match(
    pageSource,
    /const marketMainRisk = isMarketIntelligence\s*\n\s*\? marketIntelligenceCanonicalState\?\.topRisks\[0\] \|\|/
  );
});

test("SCENARIO 5d: page.tsx's Decision Confidence tile reads the SAME canonical-state-aware resolver's confidenceScore, never a second independent scan when available", () => {
  assert.match(
    pageSource,
    /const marketDecisionConfidence = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/
  );
  assert.match(pageSource, /marketDecisionConfidence !== null\s*\n\s*\? `\$\{marketDecisionConfidence\}%`/);
});

// --- Canonical state schema: version bump + new decision-brief fields -----

test("SCHEMA: version bumped to 2 for the new why/missingEvidence/whatWouldChangeThisDecision/immediateNextAction fields, with zero real v1 data affected", () => {
  assert.equal(MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION, 2);
  const built = buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: true },
    decisionBrief: decisionBriefFixture(),
  });
  assert.equal(built.version, 2);
  assert.equal(typeof built.why, "string");
  assert.ok(Array.isArray(built.missingEvidence));
  assert.equal(typeof built.whatWouldChangeThisDecision, "string");
  assert.equal(typeof built.immediateNextAction, "string");

  // A hypothetical v1-shaped object (missing the new fields) must be
  // rejected by the version gate, not partially trusted.
  const v1Shaped = { ...built, version: 1 };
  delete v1Shaped.immediateNextAction;
  assert.equal(readMarketIntelligenceCanonicalState({ marketIntelligenceCanonicalState: v1Shaped }), null);
});
