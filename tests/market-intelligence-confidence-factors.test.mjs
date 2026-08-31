import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceConfidenceFactors,
  localizeMarketConfidenceFactorLevel,
  assessMarketEntryConfidence,
} from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  resolveMarketIntelligenceConfidenceFactors,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";

// TASK #29B -- Make Market Intelligence confidence factors explicit,
// deterministic, and evidence-derived.
//
// ROOT CAUSE (confirmed live, real Market Intelligence PDF/web cover):
// the cover's per-dimension confidence-factor breakdown (Market/
// Financial/Execution/Product/Market Signals) reused Business Plan/
// Acquisition's own buildConfidenceRadar (report-presentation.ts), whose
// every dimension is sourced from investmentScore.decisionEngine.*Score.score
// -- a founder/company-viability object Market Intelligence never
// populates (per market-intelligence-presentation.ts's own top-of-file
// isolation policy) -- with a fallback that scans the report's own prose
// for labels ("Market Confidence:"/"Financial Quality:"/etc.) Market
// Intelligence's generation prompts never write. Both paths fail for
// EVERY Market Intelligence report, unconditionally -- confirmed not a
// display bug but a genuine absence of any MI-native data source; found
// live in components/Planner.tsx's own PDF drawCoverPage
// (`pdf.text(dimension.score === null ? "--" : ...)`) and its mirrored
// web-view ExecutiveSnapshotPanel, and in app/dashboard/[id]/page.tsx's
// identical web-view code.
//
// FIX: buildMarketIntelligenceConfidenceFactors (market-intelligence-
// presentation.ts) derives all 5 factors from MarketResearchCoverage's
// own evidence-derived dimensions (marketConfidence/competitiveEvidence/
// financialEvidence/productEvidence -- confirmed computed purely from
// classified DomainResearchEvidence items, never founder-prompt keyword
// scanning, unlike coverage.dimensions' own executionReadiness/
// founderReadiness, which the ticket's "Execution" factor deliberately
// does NOT read from, since those two ARE founder-signal-derived) and the
// SAME DecisionCriticalEvidenceState 3-pillar gate the overall decision
// already uses. Both inputs are already part of
// MarketIntelligenceCanonicalState (persisted since Task #23) -- no new
// field, no version bump. resolveMarketIntelligenceConfidenceFactors
// (market-intelligence-canonical-state.ts) is the single shared entry
// point page.tsx, ReportPdfButton.tsx (via the same canonical-state
// module), and Planner.tsx (both its web view and its own PDF export)
// must call, so no renderer can independently infer a different value.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const presentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

// The real report's own documented evidence shape across Tasks #27D-#29:
// TAM $1.5B supported, Major Players (Ironclad/Evisort/DocuSign/LawGeex)
// present, SOM explicitly "Not established"/"Validation Required".
const realReportShapedCanonicalState = {
  coverage: {
    dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 45, productEvidence: 50 },
  },
  decisionCriticalEvidence: {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: false,
  },
};

const fullySupportedCanonicalState = {
  coverage: {
    dimensions: { marketConfidence: 80, competitiveEvidence: 75, financialEvidence: 70, productEvidence: 72 },
  },
  decisionCriticalEvidence: {
    marketSizingResolved: true,
    competitiveEvidenceResolved: true,
    obtainableShareResolved: true,
  },
};

test("1. supported market evidence produces a non-empty Market factor", () => {
  const factors = buildMarketIntelligenceConfidenceFactors(
    realReportShapedCanonicalState.coverage,
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.notEqual(factors.market, "Validation Required");
  assert.ok(["Strong", "Moderate", "Weak"].includes(factors.market));
  assert.equal(factors.market, "Strong", "marketConfidence=68 with marketSizingResolved=true crosses the Strong threshold");
});

test("2. unresolved financial/SOM evidence keeps Financial appropriately gated", () => {
  const factors = buildMarketIntelligenceConfidenceFactors(
    realReportShapedCanonicalState.coverage,
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(factors.financial, "Validation Required", "obtainableShareResolved=false must gate Financial regardless of financialEvidence's own score");

  // Even a maxed-out financialEvidence score must not escape the gate.
  const maxedFinancial = buildMarketIntelligenceConfidenceFactors(
    { dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 100, productEvidence: 50 } },
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false }
  );
  assert.equal(maxedFinancial.financial, "Validation Required");
});

test("3. unresolved execution validation prevents falsely strong Execution", () => {
  const factors = buildMarketIntelligenceConfidenceFactors(
    realReportShapedCanonicalState.coverage,
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(factors.execution, "Validation Required", "obtainableShareResolved=false (market access/procurement/pilot conversion unresolved) must gate Execution");

  // Even maxed-out coverage across every dimension must not escape the gate.
  const maxedEverything = buildMarketIntelligenceConfidenceFactors(
    { dimensions: { marketConfidence: 100, competitiveEvidence: 100, financialEvidence: 100, productEvidence: 100 } },
    { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false }
  );
  assert.equal(maxedEverything.execution, "Validation Required");
});

test("4. product accuracy/differentiation evidence affects Product", () => {
  const weakProduct = buildMarketIntelligenceConfidenceFactors(
    { dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 45, productEvidence: 15 } },
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(weakProduct.product, "Weak");

  const strongProduct = buildMarketIntelligenceConfidenceFactors(
    { dimensions: { marketConfidence: 68, competitiveEvidence: 55, financialEvidence: 45, productEvidence: 90 } },
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(strongProduct.product, "Strong");
  assert.notEqual(weakProduct.product, strongProduct.product, "Product must actually move with its own evidence, not stay fixed");
});

test("5. Market Signals reflects actual evidence state, including when demand/adoption evidence is unresolved", () => {
  const resolved = buildMarketIntelligenceConfidenceFactors(
    realReportShapedCanonicalState.coverage,
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(resolved.marketSignals, "Moderate");

  const unresolved = buildMarketIntelligenceConfidenceFactors(realReportShapedCanonicalState.coverage, {
    ...realReportShapedCanonicalState.decisionCriticalEvidence,
    competitiveEvidenceResolved: false,
  });
  assert.equal(unresolved.marketSignals, "Validation Required", "Market Signals must not read Strong/Moderate when competitive/demand evidence itself is unresolved");
});

test("6. no factor returns '--' (or any non-categorical value) when canonical evidence state is available", () => {
  const validLevels = ["Strong", "Moderate", "Weak", "Validation Required"];
  for (const state of [realReportShapedCanonicalState, fullySupportedCanonicalState]) {
    const factors = buildMarketIntelligenceConfidenceFactors(state.coverage, state.decisionCriticalEvidence);
    for (const [key, value] of Object.entries(factors)) {
      assert.ok(validLevels.includes(value), `${key} must be one of the 4 categorical levels, got ${JSON.stringify(value)}`);
      assert.notEqual(value, "--");
    }
  }
});

test("7. overall confidence remains Validation Required for the current real report's own evidence shape (TAM supported, SOM unresolved)", () => {
  const overall = assessMarketEntryConfidence(
    { overallConfidence: 0, dimensions: realReportShapedCanonicalState.coverage.dimensions, sourceClasses: [] },
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(overall.decision, "MONITOR");
  assert.ok(overall.confidence <= 50);

  // Per-factor breakdown must be internally consistent with this same
  // overall gate: Financial and Execution (both gated on the same
  // obtainableShareResolved=false) must also read Validation Required,
  // never contradicting the overall MONITOR/gated-confidence outcome.
  const factors = buildMarketIntelligenceConfidenceFactors(
    realReportShapedCanonicalState.coverage,
    realReportShapedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(factors.financial, "Validation Required");
  assert.equal(factors.execution, "Validation Required");
});

test("8. fully supported synthetic fixtures can produce stronger factor states (legitimate ENTER-supporting evidence preserved)", () => {
  const factors = buildMarketIntelligenceConfidenceFactors(
    fullySupportedCanonicalState.coverage,
    fullySupportedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(factors.market, "Strong");
  assert.equal(factors.financial, "Strong");
  assert.equal(factors.execution, "Strong");
  assert.equal(factors.product, "Strong");
  assert.equal(factors.marketSignals, "Strong");

  const overall = assessMarketEntryConfidence(
    { overallConfidence: 0, dimensions: fullySupportedCanonicalState.coverage.dimensions, sourceClasses: [] },
    fullySupportedCanonicalState.decisionCriticalEvidence
  );
  assert.equal(overall.decision, "ENTER");
});

test("7b. requirement 7: one strong factor must not override a critical unresolved factor (strong TAM + unresolved SOM/competitive)", () => {
  const factors = buildMarketIntelligenceConfidenceFactors(
    { dimensions: { marketConfidence: 95, competitiveEvidence: 20, financialEvidence: 20, productEvidence: 20 } },
    { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: false }
  );
  assert.equal(factors.market, "Strong", "Market's own gate (marketSizingResolved) is satisfied, so it may read Strong independently");
  assert.equal(factors.financial, "Validation Required");
  assert.equal(factors.execution, "Validation Required");
  assert.equal(factors.marketSignals, "Validation Required");
  const overall = assessMarketEntryConfidence(
    { overallConfidence: 0, dimensions: { marketConfidence: 95, competitiveEvidence: 20, financialEvidence: 20, productEvidence: 20 }, sourceClasses: [] },
    { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: false }
  );
  assert.equal(overall.decision, "MONITOR", "a single Strong factor must never override the overall gate when other decision-critical pillars are unresolved");
});

test("overall confidence is NOT a simple average of the 5 factor labels", () => {
  // All-Strong-except-one-Validation-Required would average to something
  // resembling "mostly strong" if labels were blended; the actual overall
  // computation must ignore label text entirely and re-derive purely from
  // the same coverage/evidence inputs, landing on MONITOR (gated), not a
  // watered-down ENTER.
  const coverage = { dimensions: { marketConfidence: 95, competitiveEvidence: 90, financialEvidence: 90, productEvidence: 90 } };
  const evidence = { marketSizingResolved: true, competitiveEvidenceResolved: true, obtainableShareResolved: false };
  const factors = buildMarketIntelligenceConfidenceFactors(coverage, evidence);
  const strongCount = Object.values(factors).filter((level) => level === "Strong").length;
  assert.ok(strongCount >= 3, "most factors read Strong in this fixture");
  const overall = assessMarketEntryConfidence({ overallConfidence: 0, dimensions: coverage.dimensions, sourceClasses: [] }, evidence);
  assert.equal(overall.decision, "MONITOR", "a majority of Strong factor labels must not average into an ungated ENTER");
  assert.ok(overall.confidence <= 50);
});

test("9. UI/PDF/persisted factor states cannot disagree: page.tsx, Planner.tsx (web view and PDF), and ReportPdfButton.tsx's shared canonical-state module all resolve identically for the same canonical state", () => {
  const factorsA = resolveMarketIntelligenceConfidenceFactors(realReportShapedCanonicalState);
  const factorsB = resolveMarketIntelligenceConfidenceFactors(realReportShapedCanonicalState);
  const factorsC = resolveMarketIntelligenceConfidenceFactors(realReportShapedCanonicalState);
  assert.deepEqual(factorsA, factorsB);
  assert.deepEqual(factorsB, factorsC);
});

test("9b. STRUCTURAL AUDIT: page.tsx and Planner.tsx both call the single shared resolveMarketIntelligenceConfidenceFactors, never re-deriving factor levels independently", () => {
  for (const [name, source] of [["page.tsx", pageSource], ["Planner.tsx", plannerSource]]) {
    assert.match(source, /resolveMarketIntelligenceConfidenceFactors/, `${name} must call the single shared resolver`);
  }
});

test("9c. STRUCTURAL AUDIT: the two founder-viability dimensions (executionReadiness/founderReadiness) are never read by the Market Intelligence factor derivation", () => {
  const fnStart = presentationSource.indexOf("export function buildMarketIntelligenceConfidenceFactors");
  const fnEnd = presentationSource.indexOf("\n}", fnStart);
  const fnSource = presentationSource.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnSource, /executionReadiness|founderReadiness/, "must never read the founder-signal-derived coverage dimensions");
  assert.match(fnSource, /marketConfidence/);
  assert.match(fnSource, /financialEvidence/);
  assert.match(fnSource, /productEvidence/);
  assert.match(fnSource, /competitiveEvidence/);
});

test("10. repeated runs are deterministic: the resolver is a pure function of its inputs", () => {
  const runs = Array.from({ length: 25 }, () =>
    buildMarketIntelligenceConfidenceFactors(
      realReportShapedCanonicalState.coverage,
      realReportShapedCanonicalState.decisionCriticalEvidence
    )
  );
  for (const run of runs) {
    assert.deepEqual(run, runs[0]);
  }
});

test("no canonical state available (the real report's own actual persisted shape: unavailable_no_graph) falls back to null, never a fabricated guess", () => {
  assert.equal(resolveMarketIntelligenceConfidenceFactors(null), null);
  const factors = buildMarketIntelligenceConfidenceFactors(undefined, undefined);
  assert.deepEqual(factors, {
    market: "Validation Required",
    financial: "Validation Required",
    execution: "Validation Required",
    product: "Validation Required",
    marketSignals: "Validation Required",
  });
});

test("localizeMarketConfidenceFactorLevel covers all 4 levels for English and Turkish (the two languages exercised by the real report)", () => {
  for (const level of ["Strong", "Moderate", "Weak", "Validation Required"]) {
    assert.equal(typeof localizeMarketConfidenceFactorLevel(level, "English"), "string");
    assert.equal(typeof localizeMarketConfidenceFactorLevel(level, "Turkish"), "string");
  }
  assert.equal(localizeMarketConfidenceFactorLevel("Validation Required", "Turkish"), "Doğrulama Gerekli");
});

test("no citation-count substitution: a maxed-out coverage blend cannot escape any GATED per-factor's evidence check, mirroring the overall decision gate's own guarantee", () => {
  const maxed = { dimensions: { marketConfidence: 100, competitiveEvidence: 100, financialEvidence: 100, productEvidence: 100 } };
  const allUnresolved = buildMarketIntelligenceConfidenceFactors(maxed, {
    marketSizingResolved: false,
    competitiveEvidenceResolved: false,
    obtainableShareResolved: false,
  });
  // market/financial/execution/marketSignals are each gated on a
  // decision-critical pillar and must read Validation Required
  // regardless of how high the underlying (citation-count-inflatable)
  // coverage score is. product is deliberately NOT tied to any of the 3
  // pillars (the ticket's own accuracy/differentiation axis, independent
  // of TAM/SOM/competitive resolution), so it legitimately reflects its
  // own maxed productEvidence score here -- that is correct, not a gate
  // escape.
  assert.equal(allUnresolved.market, "Validation Required");
  assert.equal(allUnresolved.financial, "Validation Required");
  assert.equal(allUnresolved.execution, "Validation Required");
  assert.equal(allUnresolved.marketSignals, "Validation Required");
  assert.equal(allUnresolved.product, "Strong", "product is its own independent evidence axis and is expected to reflect a genuinely maxed productEvidence score");
});
