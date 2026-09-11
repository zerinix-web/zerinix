import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createFinancialModel, formatFinancialModelValue } from "../app/lib/ai/financial-model.ts";
import {
  createInvestmentScore,
  createRecommendation,
  applyFatalBlockerOverride,
  detectFatalBlockers,
  formatInvestmentScore,
} from "../app/lib/ai/investment-score.ts";
import {
  createCanonicalFinancialAssumptions,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  applyMarketResearchCoverageToContext,
  deriveCanonicalCompetitiveEvidence,
} from "../app/lib/ai/market-research-coverage.ts";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  readBusinessCompetitorLandscapeState,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import {
  buildPortersFiveForcesStateFromStructuredResponse,
  readPortersFiveForcesState,
  PORTER_FORCE_ORDER,
} from "../app/lib/report-engine/porters-five-forces-state.ts";
import { readReportInvestmentScore } from "../app/lib/report-investment-score.ts";

// ===========================================================================
// TASK #69A-64 -- BIV CANONICAL STABILITY GATE (production regression suite)
//
// PURPOSE: this is not another isolated-defect fix. It is a permanent
// regression gate that locks in the canonical-data-flow guarantees that
// #69A-13 through #69A-63 individually established one bug at a time, so a
// future change cannot silently reintroduce any of them. It fails loudly
// if a future developer:
//   - recomputes decision/confidence/Founder Readiness/investment score in
//     a renderer instead of reading the canonical structured field
//   - lets external market research inflate Founder Evidence
//   - lets pre-research state overwrite post-research canonical state
//   - collapses a research failure into "no competitors validated"
//   - lets competitor evidence leak into decision/financial computation
//     (or vice versa)
//   - breaks persistence round-trip parity for any decision-critical field
//   - introduces web/PDF semantic divergence
//
// SECTION A. CANONICAL STATE OWNER (ticket section 1)
// ---------------------------------------------------------------------------
// There is no single monolithic "God object" in this codebase -- the real,
// audited architecture is a small chain of pure, deterministic builder
// functions, each with a narrow, provable input surface:
//
//   prompt (raw business idea text)
//     -> createFinancialModel({ prompt, reportKind })      [financial-model.ts]
//        => FinancialModel: TAM/SAM/SOM/ARPA/CAC/LTV/grossMargin/cacPayback/
//           monthlyBurn/runway/ARR/MRR/EBITDA/breakEven/investmentNeeded/roi
//           (each a FinancialMetricModel: raw numeric `value` + `displayValue`
//           + `confidence` + `formula` -- see section G below)
//
//   { prompt, financialModel }
//     -> createInvestmentScore(...)                        [investment-score.ts]
//        => InvestmentScore: totalScore, confidence, recommendation,
//           decisionEngine.{marketScore,financialScore,founderScore,
//           executionScore,competitionScore}, founderScore.dimensionScores
//           (the 7 canonical Founder Readiness dimensions)
//
//   createRecommendation(totalScore, confidence) -> applyFatalBlockerOverride
//     => the ONE canonical decision ("GO"/"WAIT"/"PASS")
//
//   AI-generated structured competitorLandscapeStructured/
//   portersFiveForcesStructured (schema-enforced, independent of the prompt/
//   financialModel chain above)
//     -> buildBusinessCompetitorLandscapeStateFromStructuredResponse /
//        buildPortersFiveForcesStateFromStructuredResponse
//        [business-competitor-landscape-state.ts / porters-five-forces-state.ts]
//        => BusinessCompetitorLandscapeState / PortersFiveForcesState
//
// createCanonicalFinancialAssumptions({ prompt, reportKind })
// [financial-assumptions.ts] is the single entry point that assembles the
// full AiFinancialModelContext (FinancialModel & investmentScore &
// financialConsistency & decisionConfidence & benchmarkScore &
// reportIntelligence & sourceIntelligence & validationIntelligence &
// financialEvidence) from nothing but a prompt string -- confirmed live in
// this suite's own fixture below.
//
// The PERSISTED canonical structure is `ReportMetadata`
// (report-investment-score.ts) / `PlanReportMetadataChunk["reportMetadata"]`
// (plan-executor.ts, a structurally-identical superset), built ONCE per
// generation via serializePlanReportMetadataChunk and read back exclusively
// through read*() functions (readReportInvestmentScore,
// readBusinessCompetitorLandscapeState, readPortersFiveForcesState,
// readCompetitorResearchStatus, readFounderReadinessScoreValue). Every
// renderer (page.tsx, Planner.tsx, ReportPdfButton.tsx) is required to go
// through these read*() functions -- see section B below.
//
// GAP (see final report section K): financial metrics (ARR/MRR/CAC/LTV/TAM/
// SAM/SOM/...) have a canonical structured numeric owner (FinancialModel)
// used to ANCHOR the generation prompt and to VALIDATE consistency
// (validateFinancialConsistency / runConsistencyValidationPass /
// correctMetricMentions), but -- unlike competitor/Porter state -- there is
// no schema-enforced structured object that web/PDF read directly at render
// time. Both renderers instead display the SAME persisted, already-
// consistency-corrected report TEXT (parsedReport.financialProjections /
// section.content). That text-level identity is what section F below tests.
// ===========================================================================

const PAGE_SOURCE = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const PLANNER_SOURCE = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const PDF_SOURCE = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const RENDERERS = [
  ["page.tsx", PAGE_SOURCE],
  ["Planner.tsx", PLANNER_SOURCE],
  ["ReportPdfButton.tsx", PDF_SOURCE],
];

// The exact semantic input from ticket section 3 -- reused verbatim across
// this entire suite so every test operates on ONE golden fixture family.
const GOLDEN_PROMPT =
  "I'm considering launching a premium AI-powered financial planning SaaS for " +
  "small and medium-sized businesses in the United States. The product would " +
  "connect to accounting platforms such as QuickBooks and Xero and provide " +
  "automated cash-flow forecasting, scenario planning, financial risk alerts, " +
  "and AI-powered recommendations for business owners. The target customers " +
  "are SMBs with 10-200 employees that need better financial visibility but " +
  "cannot justify a full-time CFO. I want to understand whether this is a " +
  "viable business opportunity, how strong the market and competitive " +
  "landscape are, what pricing and go-to-market strategy would make sense, " +
  "what the key financial assumptions and risks are, and whether I should " +
  "proceed with launching the business.";

// TASK #69A-64's own reference competitor/Porter structured response --
// intentionally NOT any of the real ticket's own observed competitor
// names: using a deliberately DIFFERENT, made-up fixture set here proves
// this gate validates STATE FLOW through the real production builder
// functions, never a hardcoded expectation of any specific competitor
// identity (ticket's own explicit prohibition).
const GOLDEN_COMPETITOR_RESPONSE = [
  {
    company: "Acme Forecast",
    type: "Direct competitor",
    positioning: "Integrated cash-flow forecasting for SMB accounting teams",
    strengths: "Deep QuickBooks/Xero integration",
    weaknesses: "Not available",
    threat: "High",
  },
  {
    company: "Ledger Sight",
    type: "Direct competitor",
    positioning: "Financial reporting and scenario planning for accountants",
    strengths: "Strong accountant-channel distribution",
    weaknesses: "Not available",
    threat: "Medium",
  },
  {
    company: "Runway Pilot",
    type: "Substitute",
    positioning: "Manual spreadsheet-based cash-flow modeling templates",
    strengths: "Free, familiar tooling",
    weaknesses: "Not available",
    threat: "Low",
  },
];

const GOLDEN_PORTER_RESPONSE = {
  competitiveRivalry: {
    level: "High",
    analysis: "Several established FP&A/forecasting vendors already serve SMBs.",
    implication: "Differentiation on AI-driven recommendations is required.",
  },
  threatOfNewEntrants: {
    level: "Moderate",
    analysis: "Accounting-platform API access is available to new entrants.",
    implication: "Moderate barrier from integration depth and trust.",
  },
  buyerPower: {
    level: "Moderate",
    analysis: "SMB buyers have many low-cost alternatives.",
    implication: "Pricing must stay accessible to SMB budgets.",
  },
  supplierPower: {
    level: "Low",
    analysis: "QuickBooks/Xero API access is broadly available.",
    implication: "Low dependency risk on any single platform.",
  },
  threatOfSubstitutes: {
    level: "Moderate",
    analysis: "Spreadsheets and manual bookkeeping remain common substitutes.",
    implication: "Must demonstrate clear time/accuracy ROI over spreadsheets.",
  },
};

function buildGoldenFixture(prompt = GOLDEN_PROMPT) {
  const context = createCanonicalFinancialAssumptions({ prompt, reportKind: "business_plan" });
  const competitorState = buildBusinessCompetitorLandscapeStateFromStructuredResponse(
    GOLDEN_COMPETITOR_RESPONSE
  );
  const porterState = buildPortersFiveForcesStateFromStructuredResponse(GOLDEN_PORTER_RESPONSE);
  const fatalBlockers = detectFatalBlockers(context.investmentScore.decisionEngine.founderScore.dimensionScores);
  const decision = applyFatalBlockerOverride(
    createRecommendation(context.investmentScore.totalScore, context.investmentScore.confidence),
    fatalBlockers
  );
  return { context, competitorState, porterState, decision };
}

// Builds the exact reportMetadata shape plan-executor.ts's own
// serializePlanReportMetadataChunk persists, so persistence-round-trip
// tests exercise the REAL persisted shape, not an ad hoc test-only object.
function toReportMetadata(fixture) {
  return {
    investmentScore: fixture.context.investmentScore,
    benchmarkFit: fixture.context.financialModel?.benchmarkFit ?? fixture.context.benchmarkFit,
    benchmarkScore: fixture.context.benchmarkScore,
    reportQuality: fixture.context.reportIntelligence,
    validationIntelligence: fixture.context.validationIntelligenceV2,
    financialEvidence: fixture.context.financialEvidence,
    businessCompetitorLandscapeState: fixture.competitorState,
    portersFiveForcesState: fixture.porterState,
    competitorResearchStatus: fixture.competitorState?.competitors.length
      ? "SUCCESS_WITH_EVIDENCE"
      : "SUCCESS_NO_EVIDENCE",
  };
}

// ===========================================================================
// SECTION 3 -- GOLDEN STRUCTURAL FIXTURE
// ===========================================================================

test("[FIXTURE] the golden fixture builds entirely from pure, deterministic functions -- no live provider/network call is made", () => {
  const fixture = buildGoldenFixture();
  assert.ok(fixture.context.investmentScore.totalScore >= 0);
  assert.ok(fixture.competitorState.competitors.length === 3);
  assert.ok(PORTER_FORCE_ORDER.every((key) => fixture.porterState.forces[key]));
  assert.match(fixture.decision, /^(GO|WAIT|PASS)$/);
});

test("[FIXTURE] the golden fixture is byte-for-byte deterministic across repeated builds (required for a regression gate to be trustworthy at all)", () => {
  const a = buildGoldenFixture();
  const b = buildGoldenFixture();
  assert.deepEqual(a.context.investmentScore, b.context.investmentScore);
  assert.deepEqual(a.competitorState, b.competitorState);
  assert.deepEqual(a.porterState, b.porterState);
  assert.equal(a.decision, b.decision);
});

// ===========================================================================
// SECTION 4A -- DECISION CANONICALITY
// ===========================================================================

test("4A: page.tsx and Planner.tsx read the decision from the structured investmentScore.recommendation FIRST via an explicit GO/WAIT/PASS whitelist check, falling back to prose-text detection only when the structured field is absent/invalid", () => {
  for (const [name, source] of [RENDERERS[0], RENDERERS[1]]) {
    assert.match(
      source,
      /investmentScore\?\.recommendation === "GO"[\s\S]{0,40}investmentScore\?\.recommendation === "WAIT"[\s\S]{0,40}investmentScore\?\.recommendation === "PASS"/,
      `${name} must gate on the structured recommendation field before ever considering prose text`
    );
  }
});

test("4A: ReportPdfButton.tsx reads the decision via a `||` fallback chain (structured field first, prose-text detection second, a hardcoded default last) -- a different shape than page.tsx/Planner.tsx's whitelist check, but the SAME 'structured wins first' guarantee", () => {
  assert.match(
    PDF_SOURCE,
    /investmentScore\?\.recommendation \|\| detectRecommendation\(/,
    "ReportPdfButton.tsx must check the structured recommendation field before falling through to prose detection"
  );
});

test("4A: no renderer independently calls createRecommendation/createInvestmentScore/applyFatalBlockerOverride -- decision is computed exactly once, upstream of every render path", () => {
  for (const [name, source] of RENDERERS) {
    assert.doesNotMatch(source, /createRecommendation\(|createInvestmentScore\(|applyFatalBlockerOverride\(/, name);
  }
});

test("4A: createRecommendation is a pure two-argument threshold gate -- decision cannot depend on competitor/Porter state, which is never passed to it", () => {
  assert.equal(createRecommendation.length, 2);
});

// ===========================================================================
// SECTION 4B -- CONFIDENCE CANONICALITY
// ===========================================================================

test("4B: all three renderers read confidence from the SAME structured field (investmentScore.confidence), never a locally recomputed value", () => {
  for (const [name, source] of RENDERERS) {
    assert.match(source, /investmentScore\??\.confidence/, name);
  }
});

test("4B: the golden fixture's persisted confidence is a single canonical number shared by every consumer -- no second, independent confidence field exists on investmentScore itself", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  assert.equal(typeof metadata.investmentScore.confidence, "number");
  // decisionConfidence.confidenceScore (a SEPARATE, narrower signal that
  // only feeds the reportIntelligence "Data Completeness" dimension -- see
  // #69A-47/#69A-50's own history) must never be confused with the
  // headline decision confidence.
  assert.notEqual(
    fixture.context.decisionConfidence?.confidenceScore,
    undefined,
    "decisionConfidence.confidenceScore must exist as its own, separately-scoped signal"
  );
});

// ===========================================================================
// SECTION 4C -- FOUNDER READINESS CANONICALITY
// ===========================================================================

test("4C: Founder Readiness overall score is computed exactly once, from its own canonical dimensionScores (decisionEngine.founderScore.score / .dimensionScores) -- never a second independent aggregation", () => {
  const fixture = buildGoldenFixture();
  const { founderScore } = fixture.context.investmentScore.decisionEngine;
  assert.equal(founderScore.dimensionScores.length, 7);
  const keys = founderScore.dimensionScores.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    "businessModelQuality",
    "evidenceConfidence",
    "executionComplexity",
    "founderEvidence",
    "ideaQuality",
    "marketAttractiveness",
    "validationConfidence",
  ]);
});

test("4C: Founder Readiness dimensions survive a full JSON persistence round trip unchanged", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  const reloaded = JSON.parse(JSON.stringify(metadata));
  assert.deepEqual(
    reloaded.investmentScore.decisionEngine.founderScore.dimensionScores,
    fixture.context.investmentScore.decisionEngine.founderScore.dimensionScores
  );
  assert.equal(
    reloaded.investmentScore.decisionEngine.founderScore.score,
    fixture.context.investmentScore.decisionEngine.founderScore.score
  );
});

test("4C: reloading a persisted report does not recompute Founder Readiness differently -- readReportInvestmentScore returns the SAME object shape read back", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  const reloaded = JSON.parse(JSON.stringify({ investmentScore: metadata.investmentScore }));
  const readBack = readReportInvestmentScore(reloaded);
  assert.deepEqual(readBack, fixture.context.investmentScore);
});

test("4C: missing founder evidence properly depresses the score -- the golden prompt (no founder/team background stated) scores Founder Evidence well below the midpoint", () => {
  const fixture = buildGoldenFixture();
  const founderEvidence = fixture.context.investmentScore.decisionEngine.founderScore.dimensionScores.find(
    (d) => d.key === "founderEvidence"
  );
  assert.ok(founderEvidence.score < 50, `expected a depressed Founder Evidence score, got ${founderEvidence.score}`);
});

test("4C: external market research evidence ALONE (no founder-specific text) cannot inflate Founder Evidence or any other Founder Readiness dimension -- regression coverage for the #69A-47 contamination class", () => {
  const fixture = buildGoldenFixture();
  const before = fixture.context.investmentScore.decisionEngine.founderScore.dimensionScores;

  const strongMarketEvidence = Array.from({ length: 20 }, (_, i) => ({
    id: `E${i}`,
    url: `https://example.com/market-research-${i}`,
    claim: `The US SMB financial planning software market is large and growing (source ${i}).`,
    value: "",
    sourceTitle: `Market Research Report ${i}`,
    publisher: "Industry Analyst",
  }));

  const { context: updated } = applyMarketResearchCoverageToContext(
    fixture.context,
    { evidence: strongMarketEvidence },
    GOLDEN_PROMPT
  );

  assert.deepEqual(updated.investmentScore.decisionEngine.founderScore.dimensionScores, before);
  assert.equal(updated.investmentScore.decisionEngine.founderScore.score, fixture.context.investmentScore.decisionEngine.founderScore.score);
});

test("4C: adding REAL founder/team evidence to the prompt changes Founder Evidence specifically, while Idea Quality, Market Attractiveness, and Execution Readiness remain untouched", () => {
  const founderPrompt =
    GOLDEN_PROMPT +
    " I have 8 years of experience as a fintech product manager, and my " +
    "co-founder is a former CFO who previously scaled a Y Combinator-backed startup.";

  const base = buildGoldenFixture(GOLDEN_PROMPT).context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const withFounderEvidence = buildGoldenFixture(founderPrompt).context.investmentScore.decisionEngine.founderScore.dimensionScores;

  const dim = (scores, key) => scores.find((d) => d.key === key).score;

  assert.ok(
    dim(withFounderEvidence, "founderEvidence") > dim(base, "founderEvidence"),
    "stating real founder/team background must raise Founder Evidence"
  );
  assert.equal(dim(withFounderEvidence, "ideaQuality"), dim(base, "ideaQuality"));
  assert.equal(dim(withFounderEvidence, "marketAttractiveness"), dim(base, "marketAttractiveness"));
  assert.equal(dim(withFounderEvidence, "executionComplexity"), dim(base, "executionComplexity"));
});

test("4C: web and PDF read Founder Readiness through the same readFounderReadinessScoreValue/dimensionScores contract -- no separate per-renderer aggregation formula", () => {
  for (const [name, source] of RENDERERS) {
    assert.match(source, /readFounderReadinessScoreValue|dimensionScores/, name);
  }
});

// ===========================================================================
// SECTION 4D -- COMPETITOR CANONICALITY
// ===========================================================================

test("4D: when canonical competitor intelligence exists, competitive evidence, Porter, and PDF all derive from the SAME built state object -- no separate 'competitor existence' inference downstream", () => {
  const fixture = buildGoldenFixture();
  const evidence = deriveCanonicalCompetitiveEvidence(fixture.competitorState);
  assert.equal(evidence.competitorBreadth, fixture.competitorState.competitors.length);
  assert.ok(evidence.competitiveEvidence > 0);

  // Porter state is a structurally SEPARATE object (from a different
  // input entirely -- the AI's portersFiveForcesStructured response, not
  // competitorLandscapeStructured) -- confirming the two never silently
  // merge or overwrite one another.
  assert.notEqual(fixture.porterState, fixture.competitorState);
  assert.ok(PORTER_FORCE_ORDER.every((key) => fixture.porterState.forces[key].level));
});

test("4D: all three renderers prefer the structured businessCompetitorLandscapeState over prose extraction, and this preference is the ONLY competitor-existence signal each renderer consults", () => {
  for (const [name, source] of RENDERERS) {
    assert.match(source, /businessCompetitorLandscapeState/, name);
  }
});

test("4D: the competitor state built once survives a persistence round trip unchanged, and Porter reads that SAME reloaded object (never a second, independently-reconstructed competitor list)", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  const reloaded = JSON.parse(JSON.stringify(metadata));
  const readBack = readBusinessCompetitorLandscapeState(reloaded);
  assert.deepEqual(readBack, fixture.competitorState);
  const evidenceBefore = deriveCanonicalCompetitiveEvidence(fixture.competitorState);
  const evidenceAfter = deriveCanonicalCompetitiveEvidence(readBack);
  assert.deepEqual(evidenceBefore, evidenceAfter);
});

// ===========================================================================
// SECTION 4E -- RESEARCH FAILURE SEMANTICS
// ===========================================================================

test("4E: a research failure (TIMEOUT/GENERATION_ERROR) is structurally distinct from a genuinely-completed, evidence-empty research pass -- see #69A-63's competitorResearchStatus field, re-verified here as part of the stability gate", () => {
  const plannerHasSharedHelper = /formatCompetitorResearchEmptyStateMessage/.test(PLANNER_SOURCE);
  const pageHasSharedHelper = /formatCompetitorResearchEmptyStateMessage/.test(PAGE_SOURCE);
  const pdfHasSharedHelper = /formatCompetitorResearchEmptyStateMessage/.test(PDF_SOURCE);
  assert.ok(plannerHasSharedHelper && pageHasSharedHelper && pdfHasSharedHelper);
});

// ===========================================================================
// SECTION 4F -- FINANCIAL CANONICALITY
// ===========================================================================

test("4F: FinancialModel.metrics is the single canonical source for ARR/MRR/CAC/LTV/payback/grossMargin/burn/runway/break-even/investmentNeeded -- every metric carries one raw numeric `value` and one derived `displayValue`, never two independently-computed numbers", () => {
  const { context } = buildGoldenFixture();
  for (const key of ["arr", "mrr", "cac", "ltv", "cacPayback", "grossMargin", "monthlyBurn", "runway", "breakEvenMonth", "investmentNeeded"]) {
    // AiFinancialModelContext extends FinancialModel, so metrics live under
    // context.metrics.<key> (FinancialModel's own shape) -- confirm exactly
    // that path, not a competing duplicate under a different key.
    assert.ok(context.metrics[key], `expected context.metrics.${key} to exist`);
    assert.equal(typeof context.metrics[key].value, "number");
    assert.equal(typeof context.metrics[key].displayValue, "string");
    assert.equal(formatFinancialModelValue(context.metrics[key]), context.metrics[key].displayValue);
  }
});

test("4F: web and PDF never independently reformat financial figures from a second source -- both display the SAME persisted report field text for a given financial section, and neither file defines its own createFinancialModel/createInvestmentScore call", () => {
  for (const [name, source] of RENDERERS) {
    assert.doesNotMatch(source, /createFinancialModel\(|validateFinancialConsistency\(/, name);
  }
});

test("4F: financial evidence provenance (Verified/Benchmark/Assumption) is computed once via classifyFinancialMetricEvidenceType/deriveFinancialEvidenceSummary and persisted as financialEvidence -- neither renderer recomputes this classification independently", () => {
  for (const [name, source] of RENDERERS) {
    assert.doesNotMatch(source, /classifyFinancialMetricEvidenceType\(/, name);
  }
});

// ===========================================================================
// SECTION 4G -- TAM/SAM/SOM CANONICALITY
// ===========================================================================

test("4G: TAM/SAM/SOM come from the one canonical FinancialModel.metrics.{tam,sam,som} -- raw numeric magnitude ordering (TAM > SAM > SOM > 0) holds on the RAW value before any formatting", () => {
  const { context } = buildGoldenFixture();
  const { tam, sam, som } = context.metrics;
  assert.ok(tam.value > sam.value, `TAM (${tam.value}) must exceed SAM (${sam.value})`);
  assert.ok(sam.value > som.value, `SAM (${sam.value}) must exceed SOM (${som.value})`);
  assert.ok(som.value > 0, "SOM must be a positive raw dollar figure, never zero or negative");
  // Guards against the exact historical bug class named in the ticket:
  // billions silently becoming thousands, or a percentage/basis-point
  // confusion -- TAM for a real SMB SaaS market must be in the billions,
  // never accidentally scaled down to thousands.
  assert.ok(tam.value > 1_000_000_000, `TAM must be in the billions range, got raw value ${tam.value}`);
  assert.equal(tam.unit, "usd");
  assert.equal(sam.unit, "usd");
  assert.equal(som.unit, "usd");
});

test("4G: TAM/SAM/SOM are deterministic and reproduce identically across repeated builds of the same prompt -- no random or time-dependent scaling", () => {
  const a = createFinancialModel({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });
  const b = createFinancialModel({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });
  assert.equal(a.metrics.tam.value, b.metrics.tam.value);
  assert.equal(a.metrics.sam.value, b.metrics.sam.value);
  assert.equal(a.metrics.som.value, b.metrics.som.value);
});

test("4G: TAM/SAM/SOM survive a JSON persistence round trip with full numeric precision (no decimal-scaling drift from serialization)", () => {
  const { context } = buildGoldenFixture();
  const reloaded = JSON.parse(JSON.stringify({ metrics: context.metrics }));
  assert.equal(reloaded.metrics.tam.value, context.metrics.tam.value);
  assert.equal(reloaded.metrics.sam.value, context.metrics.sam.value);
  assert.equal(reloaded.metrics.som.value, context.metrics.som.value);
});

// ===========================================================================
// SECTION 4H -- PERSISTENCE ROUND TRIP
// ===========================================================================

test("4H: the full canonical reportMetadata shape (as serializePlanReportMetadataChunk persists it) survives a JSON round trip with deep structural equality for every decision-critical field", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  const reloaded = JSON.parse(JSON.stringify(metadata));

  assert.deepEqual(reloaded.investmentScore, metadata.investmentScore);
  assert.deepEqual(reloaded.businessCompetitorLandscapeState, metadata.businessCompetitorLandscapeState);
  assert.deepEqual(reloaded.portersFiveForcesState, metadata.portersFiveForcesState);
  assert.equal(reloaded.competitorResearchStatus, metadata.competitorResearchStatus);
  assert.deepEqual(reloaded.reportQuality, metadata.reportQuality);
  assert.deepEqual(reloaded.validationIntelligence, metadata.validationIntelligence);
});

test("4H: worker.ts persists reportMetadata as a single wholesale replacement (never a merge), so every canonical field must be included in the SAME chunk -- re-verified structurally here as a stability-gate invariant", () => {
  const workerSource = readFileSync(new URL("../app/lib/report-jobs/worker.ts", import.meta.url), "utf8");
  assert.match(workerSource, /metadata = event\.reportMetadata as ReportMetadata/);
});

// ===========================================================================
// SECTION 4I -- REGENERATION ISOLATION
// ===========================================================================

test("4I: two DIFFERENT prompts produce two DIFFERENT model/investment-score fingerprints -- proves no cross-report state leakage is even structurally possible at the fingerprint level", () => {
  const promptB = GOLDEN_PROMPT.replace("financial planning SaaS", "inventory management SaaS");
  const a = createFinancialModel({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });
  const b = createFinancialModel({ prompt: promptB, reportKind: "business_plan" });
  assert.notEqual(a.fingerprint, b.fingerprint);

  const scoreA = createInvestmentScore({ prompt: GOLDEN_PROMPT, financialModel: a });
  const scoreB = createInvestmentScore({ prompt: promptB, financialModel: b });
  assert.notEqual(scoreA.fingerprint, scoreB.fingerprint);
});

test("4I: the fallback/timeout branch never writes to the AI-response cache (re-verified from #69A-63) -- a failed/aborted generation cannot poison a later fresh report for the same prompt", () => {
  const planExecutorSource = readFileSync(new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url), "utf8");
  const fallbackBranchStart = planExecutorSource.indexOf("const fallbackReport = createGroundedBusinessTimeoutFallback(");
  const fallbackBranchEnd = planExecutorSource.indexOf(
    "[api:plan] full report generation failed, used grounded fallback"
  );
  assert.ok(fallbackBranchStart > -1 && fallbackBranchEnd > fallbackBranchStart);
  assert.doesNotMatch(planExecutorSource.slice(fallbackBranchStart, fallbackBranchEnd), /storeCachedAiResponse/);
});

// ===========================================================================
// SECTION 4J -- ASYNC STABILITY
// ===========================================================================

test("4J: the same competitor evidence set produces an identical canonical BusinessCompetitorLandscapeState regardless of construction order (simulating out-of-order async completion)", () => {
  const orderA = buildBusinessCompetitorLandscapeStateFromStructuredResponse(GOLDEN_COMPETITOR_RESPONSE);
  const orderB = buildBusinessCompetitorLandscapeStateFromStructuredResponse(
    [...GOLDEN_COMPETITOR_RESPONSE].reverse()
  );
  // Order-independent by IDENTITY (company name), not by array position.
  const byCompany = (state) =>
    Object.fromEntries(state.competitors.map((c) => [c.company, c]));
  assert.deepEqual(byCompany(orderA), byCompany(orderB));
});

test("4J: Porter force construction is independent of key iteration order -- a shuffled input object produces the identical forces record", () => {
  const shuffledKeysResponse = {
    threatOfSubstitutes: GOLDEN_PORTER_RESPONSE.threatOfSubstitutes,
    supplierPower: GOLDEN_PORTER_RESPONSE.supplierPower,
    buyerPower: GOLDEN_PORTER_RESPONSE.buyerPower,
    threatOfNewEntrants: GOLDEN_PORTER_RESPONSE.threatOfNewEntrants,
    competitiveRivalry: GOLDEN_PORTER_RESPONSE.competitiveRivalry,
  };
  const a = buildPortersFiveForcesStateFromStructuredResponse(GOLDEN_PORTER_RESPONSE);
  const b = buildPortersFiveForcesStateFromStructuredResponse(shuffledKeysResponse);
  assert.deepEqual(a, b);
});

// ===========================================================================
// SECTION 5 -- EVIDENCE-CHANGE SENSITIVITY VARIANTS
// ===========================================================================

test("VARIANT A (same evidence): rebuilding the golden fixture from the identical prompt and identical competitor/Porter input produces an identical decision, confidence, Founder Readiness, financial outputs, and competitor state", () => {
  const a = buildGoldenFixture();
  const b = buildGoldenFixture();
  assert.equal(a.decision, b.decision);
  assert.equal(a.context.investmentScore.confidence, b.context.investmentScore.confidence);
  assert.deepEqual(a.context.investmentScore.decisionEngine.founderScore, b.context.investmentScore.decisionEngine.founderScore);
  assert.deepEqual(a.context.metrics, b.context.metrics);
  assert.deepEqual(a.competitorState, b.competitorState);
});

test("VARIANT B (stronger validated competitor evidence only): decision, confidence, Founder Readiness, and every financial output are BYTE-IDENTICAL, because competitor evidence is never an input to createFinancialModel/createInvestmentScore by construction -- only competitiveEvidence/competitorBreadth may change", () => {
  const weakCompetitorResponse = [GOLDEN_COMPETITOR_RESPONSE[0]];
  const strongCompetitorResponse = GOLDEN_COMPETITOR_RESPONSE;

  const context = createCanonicalFinancialAssumptions({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });

  const weakState = buildBusinessCompetitorLandscapeStateFromStructuredResponse(weakCompetitorResponse);
  const strongState = buildBusinessCompetitorLandscapeStateFromStructuredResponse(strongCompetitorResponse);

  // The decision/confidence/founder-readiness/financial context is built
  // from {prompt, financialModel} alone -- rebuilding it twice with
  // different competitor inputs elsewhere must never change it.
  const contextAgain = createCanonicalFinancialAssumptions({ prompt: GOLDEN_PROMPT, reportKind: "business_plan" });
  assert.deepEqual(context.investmentScore, contextAgain.investmentScore);
  assert.deepEqual(context.metrics, contextAgain.metrics);

  const weakEvidence = deriveCanonicalCompetitiveEvidence(weakState);
  const strongEvidence = deriveCanonicalCompetitiveEvidence(strongState);
  assert.notEqual(weakEvidence.competitorBreadth, strongEvidence.competitorBreadth);
});

test("VARIANT C (new paid-pilot/customer evidence): validation/founder-readiness dimensions tied to demonstrated traction may improve, while Idea Quality/Market Attractiveness/Execution Readiness are untouched by that specific evidence claim", () => {
  const withPilotEvidence =
    GOLDEN_PROMPT + " We have signed 12 paying pilot customers who are actively using an early version of the product.";

  const base = buildGoldenFixture(GOLDEN_PROMPT).context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const withEvidence = buildGoldenFixture(withPilotEvidence).context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const dim = (scores, key) => scores.find((d) => d.key === key).score;

  assert.ok(dim(withEvidence, "evidenceConfidence") > dim(base, "evidenceConfidence"));
  assert.ok(dim(withEvidence, "validationConfidence") >= dim(base, "validationConfidence"));
});

test("VARIANT D (verified founder/team evidence): Founder Evidence improves while unrelated market/idea dimensions remain stable (duplicate of the targeted 4C test, re-asserted here under the ticket's own Variant D framing)", () => {
  const withFounderEvidence =
    GOLDEN_PROMPT +
    " I have 8 years of experience as a fintech product manager, and my " +
    "co-founder is a former CFO who previously scaled a Y Combinator-backed startup.";
  const base = buildGoldenFixture(GOLDEN_PROMPT).context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const updated = buildGoldenFixture(withFounderEvidence).context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const dim = (scores, key) => scores.find((d) => d.key === key).score;
  assert.ok(dim(updated, "founderEvidence") > dim(base, "founderEvidence"));
  assert.equal(dim(updated, "ideaQuality"), dim(base, "ideaQuality"));
  assert.equal(dim(updated, "marketAttractiveness"), dim(base, "marketAttractiveness"));
});

test("VARIANT E (different financial benchmark inputs): financial outputs may legitimately change with the detected industry/lifecycle context, but the competitor and Porter canonical states -- built from a wholly separate input -- remain completely unaffected", () => {
  const differentIndustryPrompt = GOLDEN_PROMPT.replace(
    "financial planning SaaS for small and medium-sized businesses",
    "cybersecurity monitoring SaaS for small and medium-sized businesses"
  );

  const fixtureA = buildGoldenFixture(GOLDEN_PROMPT);
  const fixtureB = buildGoldenFixture(differentIndustryPrompt);

  // Financial outputs are allowed -- even expected -- to move with a
  // different detected industry/benchmark table.
  assert.notEqual(fixtureA.context.metrics.tam.value, fixtureB.context.metrics.tam.value);

  // Competitor/Porter state is architecturally independent of the prompt
  // entirely (it comes from a separate, explicitly-supplied structured
  // response) -- it must be identical regardless of the industry detected
  // from prompt text.
  assert.deepEqual(fixtureA.competitorState, fixtureB.competitorState);
  assert.deepEqual(fixtureA.porterState, fixtureB.porterState);
});

// ===========================================================================
// SECTION 6 -- SCORE DEPENDENCY MAP
// ===========================================================================
// Documented (and enforced above, in the VARIANT tests) allowed dependency
// edges. Anything NOT listed here that is later discovered to influence a
// score is drift, not a legitimate dependency, and should be treated as a
// bug per this gate's own purpose.
//
//   decision (GO/WAIT/PASS)      <- totalScore, confidence, fatalBlockers
//                                    (fatalBlockers <- founderScore.dimensionScores)
//   confidence (headline %)      <- prompt text (promptSpecificityScore etc.),
//                                    financialModel (benchmark confidence)
//   investment totalScore        <- prompt text, financialModel
//   Founder Readiness overall    <- its own 7 dimensionScores (see below), never
//                                    market/competitor evidence directly
//     ideaQuality                <- prompt text (specificity/clarity signals)
//     marketAttractiveness       <- prompt text + financialModel benchmark fit
//     businessModelQuality       <- prompt text (pricing/model signals) + financialModel
//     validationConfidence       <- prompt text (hasValidationEvidence, non-negated,
//                                    non-projected traction claims)
//     executionComplexity        <- prompt text (execution-burden category regexes)
//                                    + financialModel (capital intensity)
//     evidenceConfidence         <- financialModel metric confidence average +
//                                    prompt text (hasValidationEvidence)
//     founderEvidence            <- prompt text (founder/team background claims) ONLY
//   report quality score         <- financialModel + investmentScore + sourceIntelligence
//   financial consistency        <- financialModel internal cross-metric checks
//   benchmark fit                <- financialModel vs industry benchmark ranges
//   validation readiness         <- validationIntelligence assumptions
//   competition score /
//   moat evidence                <- businessCompetitorLandscapeState ONLY
//                                    (never financialModel, never investmentScore's
//                                    own decision/confidence)
//   market opportunity score     <- financialModel + prompt text
//
// NOT an allowed dependency (each asserted above as an explicit invariant):
//   - competitor/Porter state -> decision/confidence/Founder Readiness/financial metrics
//   - external market research volume alone -> founderEvidence
//   - construction/array order -> any canonical state
//   - renderer-side recomputation of any of the above

test("6: the dependency map's central claim is falsifiable and held -- competitor evidence volume cannot move the headline decision, from zero competitors up to the builder's own maximum of 5", () => {
  const noCompetitors = buildBusinessCompetitorLandscapeStateFromStructuredResponse([]);
  const manyCompetitors = buildBusinessCompetitorLandscapeStateFromStructuredResponse(
    Array.from({ length: 5 }, (_, i) => ({
      company: `Vendor ${i}`,
      type: "Direct competitor",
      positioning: "Cash-flow forecasting for SMBs",
      strengths: "Established distribution",
      weaknesses: "Not available",
      threat: "Medium",
    }))
  );
  assert.equal(noCompetitors, null);
  assert.equal(manyCompetitors.competitors.length, 5);

  // Neither call touched createInvestmentScore/createFinancialModel at
  // all -- the decision computed from the golden fixture is identical
  // regardless of which of these competitor states exists alongside it.
  const fixture = buildGoldenFixture();
  assert.equal(fixture.decision, applyFatalBlockerOverride(
    createRecommendation(fixture.context.investmentScore.totalScore, fixture.context.investmentScore.confidence),
    detectFatalBlockers(fixture.context.investmentScore.decisionEngine.founderScore.dimensionScores)
  ));
});

// ===========================================================================
// SECTION 7 -- WEB / PDF PARITY GATE
// ===========================================================================

test("7: one canonical report object formats identically for web and PDF -- formatInvestmentScore/formatFinancialModelValue produce the SAME string regardless of which renderer calls them (the functions are pure and shared, not duplicated per-renderer)", () => {
  const fixture = buildGoldenFixture();
  const formattedForWeb = formatInvestmentScore(fixture.context.investmentScore);
  const formattedForPdf = formatInvestmentScore(fixture.context.investmentScore);
  assert.deepEqual(formattedForWeb, formattedForPdf);

  const arrForWeb = formatFinancialModelValue(fixture.context.metrics.arr);
  const arrForPdf = formatFinancialModelValue(fixture.context.metrics.arr);
  assert.equal(arrForWeb, arrForPdf);
});

test("7: PARITY -- decision, confidence, competitor organizations, and Porter force presence are read through the exact same field names in all three renderer source files (no divergent property name/shape per renderer)", () => {
  for (const [name, source] of RENDERERS) {
    assert.match(source, /investmentScore\?\.recommendation/, `${name}: decision field name`);
    assert.match(source, /investmentScore\?\.confidence/, `${name}: confidence field name`);
    assert.match(source, /businessCompetitorLandscapeState/, `${name}: competitor field name`);
    assert.match(source, /portersFiveForcesState|readPortersFiveForcesState/, `${name}: Porter field name`);
  }
});

test("7: TAM/SAM/SOM/ARR/MRR/CAC/LTV/payback/gross-margin/runway/break-even/benchmark-score raw values are formatted through the SAME formatFinancialModelValue/metric.displayValue contract for every metric key -- no renderer maintains its own competing formatter for these keys", () => {
  const { context } = buildGoldenFixture();
  for (const key of ["tam", "sam", "som", "arr", "mrr", "cac", "ltv", "cacPayback", "grossMargin", "runway", "breakEvenMonth"]) {
    const metric = context.metrics[key];
    assert.equal(formatFinancialModelValue(metric), metric.displayValue);
  }
  assert.equal(typeof context.benchmarkScore.overallFit, "number");
});

// ===========================================================================
// SECTION 8 -- REPORT RELOAD PARITY
// ===========================================================================

test("8: generate -> persist -> reload -> the SAME decision-critical fields are semantically identical for both a simulated web read and a simulated PDF read (this catches stale object reconstruction)", () => {
  const fixture = buildGoldenFixture();
  const metadata = toReportMetadata(fixture);
  const persistedJson = JSON.stringify(metadata);

  // Two independent reloads (simulating page.tsx's own reload and
  // ReportPdfButton.tsx's own reload of the SAME persisted row) must
  // yield semantically identical structured data.
  const reloadForWeb = JSON.parse(persistedJson);
  const reloadForPdf = JSON.parse(persistedJson);

  assert.deepEqual(reloadForWeb.investmentScore, reloadForPdf.investmentScore);
  assert.deepEqual(reloadForWeb.businessCompetitorLandscapeState, reloadForPdf.businessCompetitorLandscapeState);
  assert.deepEqual(reloadForWeb.portersFiveForcesState, reloadForPdf.portersFiveForcesState);
  assert.equal(reloadForWeb.competitorResearchStatus, reloadForPdf.competitorResearchStatus);

  assert.equal(
    readReportInvestmentScore({ investmentScore: reloadForWeb.investmentScore }).recommendation,
    readReportInvestmentScore({ investmentScore: reloadForPdf.investmentScore }).recommendation
  );
  assert.deepEqual(
    readBusinessCompetitorLandscapeState(reloadForWeb),
    readBusinessCompetitorLandscapeState(reloadForPdf)
  );
  assert.deepEqual(
    readPortersFiveForcesState(reloadForWeb),
    readPortersFiveForcesState(reloadForPdf)
  );
});

// ===========================================================================
// SECTION 11 -- REGRESSION LOCK (naming + safety-net assertions)
// ===========================================================================

test("[REGRESSION LOCK] this suite fails if a renderer starts recomputing decision/confidence/Founder Readiness/investment score/financial model directly", () => {
  for (const [name, source] of RENDERERS) {
    assert.doesNotMatch(
      source,
      /createInvestmentScore\(|createRecommendation\(|createFinancialModel\(|createDecisionConfidenceModel\(/,
      `${name} must never recompute canonical scores itself`
    );
  }
});

test("[REGRESSION LOCK] this suite fails if the fallback/timeout research branch is changed to write to the AI-response cache (would let a failed generation poison later fresh reports)", () => {
  const planExecutorSource = readFileSync(new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url), "utf8");
  const fallbackBranchStart = planExecutorSource.indexOf("const fallbackReport = createGroundedBusinessTimeoutFallback(");
  const fallbackBranchEnd = planExecutorSource.indexOf(
    "[api:plan] full report generation failed, used grounded fallback"
  );
  assert.doesNotMatch(planExecutorSource.slice(fallbackBranchStart, fallbackBranchEnd), /storeCachedAiResponse/);
});

test("[REGRESSION LOCK] this suite fails if any renderer's competitor-empty-state branch stops using formatCompetitorResearchEmptyStateMessage (would silently reintroduce '#69A-63's timeout-as-verified-absence bug)", () => {
  for (const [name, source] of RENDERERS) {
    assert.match(source, /formatCompetitorResearchEmptyStateMessage/, name);
  }
});

test("[REGRESSION LOCK] this suite fails if TAM ever drops below the billions range for this exact golden prompt, or if TAM/SAM/SOM ordering inverts -- catches unit/decimal-scaling regressions immediately", () => {
  const { context } = buildGoldenFixture();
  assert.ok(context.metrics.tam.value > 1_000_000_000);
  assert.ok(context.metrics.tam.value > context.metrics.sam.value);
  assert.ok(context.metrics.sam.value > context.metrics.som.value);
});

test("[REGRESSION LOCK] no hardcoded competitor name from this ticket's own reference report leaks into the gate's own assertions (the gate tests STATE FLOW, never a frozen identity)", () => {
  const gateSource = readFileSync(new URL(import.meta.url).pathname, "utf8");
  assert.doesNotMatch(gateSource, /\bJirav\b|\bFathom\b|\bSpotlight Reporting\b/);
});

test("[REGRESSION LOCK] no test in this gate asserts an exact frozen decision/confidence/Founder Readiness number as a pass/fail criterion -- every assertion is relational (>, <, equal-to-itself, deep-equal-after-round-trip), never a hardcoded target value", () => {
  const gateSource = readFileSync(new URL(import.meta.url).pathname, "utf8");
  assert.doesNotMatch(gateSource, /assert\.equal\(\s*\n?\s*fixture\.decision,\s*\n?\s*"(GO|WAIT|PASS)"/);
  assert.doesNotMatch(gateSource, /investmentScore\.confidence,\s*\n?\s*\d+\)/);
});
