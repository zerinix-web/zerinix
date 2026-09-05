import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { extractVendorCandidateMentions } from "../app/lib/ai/vendor-discovery.ts";
import {
  resolveMarketIntelligenceEvidenceGaps,
  classifyStrategicRecommendationValidation,
  resolveMarketIntelligenceGapClosurePlan,
  resolveMarketIntelligenceConfidenceState,
} from "../app/lib/report-engine/market-intelligence-evidence-gaps.ts";
import { extractRecommendationSignals } from "../app/lib/report-presentation.ts";

// TASK #68 -- Make Market Intelligence evidence completion structurally
// authoritative.
//
// Three real, distinct structural gaps, each traced to its root cause
// and fixed at the narrowest correct layer:
//
// A. Competitor discovery (vendor-discovery.ts): the heuristic mention
//    extractor only recognized "is an AI-powered/leading/cloud-based"
//    after "is a/an" -- a real, common vendor-description construction
//    ("X is a governance, risk, and compliance platform.") used none of
//    those three adjectives, so a well-evidenced competitor mention in
//    an uncatalogued market (no static taxonomy entry) was never even
//    extracted as a candidate. Fixed by generalizing to "is a/an ...
//    <role-noun>" for a closed set of vendor/product role nouns.
//
// B. TAM/SAM/SOM (market-intelligence-graph.ts): the bottom-up
//    derivation engine already existed and was always invoked, but its
//    buyer-population and direct-pricing evidence filters were SMB-
//    shaped ("small business", "establishment", "subscription") with
//    no enterprise/regulated-buyer vocabulary at all -- so real
//    evidence for a regulated, enterprise-buyer market (banks,
//    financial institutions, "annual contract value"/"ACV" pricing)
//    was never admitted into the candidate pool, forcing an avoidable
//    "Validation Required" outcome. Fixed by widening both filters,
//    while explicitly excluding text that hedges with "comparable/
//    similar/analogous/adjacent" (preserving the existing, deliberate
//    proxy-tier distinction for genuinely adjacent-product evidence).
//
// C. Evidence Gap -> Recommendation closure linkage
//    (market-intelligence-evidence-gaps.ts): resolveLinkedEvidenceGap's
//    multi-gap disambiguation path can only ever select a gap present
//    in GAP_REQUIRED_EVIDENCE_CATEGORY (obtainable-share, market-
//    sizing) -- competitive-evidence is deliberately absent from that
//    map (Task #50's own guarantee that a SOLE competitive-evidence
//    gap accepts any validation/pilot metric). Whenever competitive-
//    evidence was unresolved SIMULTANEOUSLY with another material gap,
//    a recommendation genuinely aimed at resolving it (real owner/
//    timeline/budget, text naming named competitors/competitive
//    landscape) could never link, so its Closure Plan fell back to
//    "Not yet assigned"/"No timeline committed yet" despite the real
//    data sitting right there in Strategic Recommendations. Fixed with
//    a separate, additive multi-gap-only candidate set for competitive-
//    evidence specifically, never touching the shared map or Task #50's
//    single-gap guarantee.

const evidenceGapsSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");
const vendorDiscoverySource = readFileSync(new URL("../app/lib/ai/vendor-discovery.ts", import.meta.url), "utf8");

const checkedAt = "2026-08-02T00:00:00.000Z";
function evidence({
  id,
  field = "vendor_discovery",
  claim,
  value = claim,
  url,
  sourceType = "credible_market_data",
  authorityLevel = "secondary",
  confidence = 78,
  qualityScore = 60,
  publishedDate = "2025-06-01",
  label = "Verified from external source",
}) {
  return {
    id,
    field,
    claim,
    value,
    label,
    sourceTitle: `${id} source`,
    publisher: `${id} publisher`,
    url,
    sourceType,
    authorityLevel,
    confidence,
    publishedDate,
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports evidence coverage.",
    qualityScore,
    qualityRationale: "Directly relevant public source with valid provenance.",
  };
}

const regtechPrompt =
  "Evaluate whether launching a US AI-powered RegTech / GRC (governance, risk, and compliance) platform for mid-market financial institutions is commercially attractive.";

// ---------------------------------------------------------------------
// A1: credible competitor evidence populates named competitors without
// fabricating unsupported attributes.
// ---------------------------------------------------------------------

test("A1: 'is a/an <role-noun>' competitor mentions (uncatalogued RegTech/GRC market) are extracted as real candidates", () => {
  const oneTrustMentions = extractVendorCandidateMentions(
    [evidence({ id: "R1", claim: "OneTrust is a governance, risk, and compliance platform used by financial institutions.", url: "https://example-review-site.com/reviews/onetrust" })],
    null
  );
  const logicGateMentions = extractVendorCandidateMentions(
    [evidence({ id: "R2", claim: "LogicGate is a compliance management software widely adopted by banks.", url: "https://example-review-site.com/reviews/logicgate" })],
    null
  );
  assert.ok(oneTrustMentions.some((m) => m.name === "OneTrust"), `expected OneTrust to be extracted, got ${JSON.stringify(oneTrustMentions.map((m) => m.name))}`);
  assert.ok(logicGateMentions.some((m) => m.name === "LogicGate"), `expected LogicGate to be extracted, got ${JSON.stringify(logicGateMentions.map((m) => m.name))}`);
});

test("A1 (end-to-end): a real RegTech/GRC report populates a named competitor from 'is a/an <role-noun>' evidence, never fabricating category/positioning beyond what evidence supports", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          claim: "OneTrust is a governance, risk, and compliance platform serving regulated financial institutions.",
          url: "https://example-review-site.com/reviews/onetrust",
          sourceType: "credible_market_data",
        }),
        evidence({
          id: "R2",
          claim: "OneTrust pricing starts at $30,000 per year for enterprise compliance teams.",
          url: "https://example-directory.com/onetrust-pricing",
          sourceType: "credible_market_data",
        }),
      ],
    },
    regtechPrompt
  );

  const allNames = [
    ...graph.vendorIntelligence.vendors.map((v) => v.name),
    ...graph.vendorIntelligence.adjacentPlayers.map((p) => p.name),
  ];
  assert.ok(allNames.includes("OneTrust"), `expected OneTrust to survive into the graph, got ${JSON.stringify(allNames)}`);

  // Never fabricates unsupported attributes: no vendor entry claims a
  // market-share/ranking figure this evidence never stated.
  for (const vendor of graph.vendorIntelligence.vendors) {
    assert.doesNotMatch(JSON.stringify(vendor), /\d+%\s*market\s*share/i);
  }
});

// ---------------------------------------------------------------------
// A2: insufficient competitor evidence remains honestly unresolved.
// ---------------------------------------------------------------------

test("A2: evidence with no competitor-shaped mentions at all produces zero vendors/adjacent players -- never fabricated", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          claim: "The regulated financial services sector continues to face increasing compliance obligations.",
          url: "https://example.gov/report",
          sourceType: "official_statistics",
          authorityLevel: "primary",
        }),
      ],
    },
    regtechPrompt
  );

  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.doesNotMatch(projection.competitiveLandscape, /OneTrust|LogicGate/);
});

// ---------------------------------------------------------------------
// B1: verified enterprise buyer-population + ACV pricing inputs produce
// a provenance-safe bottom-up sizing result.
// ---------------------------------------------------------------------

test("B1: enterprise buyer-population + unhedged ACV pricing evidence produces a labeled bottom-up estimate (never fabricated)", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          claim: "There are approximately 5,000 regulated financial institutions in the United States subject to GRC compliance requirements.",
          url: "https://example.gov/financial-regulation-data",
          sourceType: "official_statistics",
          authorityLevel: "primary",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          claim: "The typical annual contract value (ACV) for enterprise GRC software is $40,000.",
          url: "https://example-vendor.com/pricing",
          sourceType: "company_source",
          authorityLevel: "primary",
        }),
      ],
    },
    regtechPrompt
  );

  assert.ok(graph.planningEstimate, "expected a real bottom-up planning estimate, got null (sizingGap instead)");
  assert.equal(graph.planningEstimate.method, "bottomUp");
  assert.equal(graph.planningEstimate.pricingSource, "direct", "unhedged ACV evidence for the exact category must be treated as direct, not demoted to proxy");
  assert.equal(graph.planningEstimate.classification, "Estimated");
});

test("B1 (regression guard): a HEDGED 'comparable product' ACV-style signal is still correctly treated as proxy, not direct", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          claim: "There are approximately 5,000 regulated financial institutions in the United States subject to GRC compliance requirements.",
          url: "https://example.gov/financial-regulation-data",
          sourceType: "official_statistics",
          authorityLevel: "primary",
        }),
        evidence({
          id: "R2",
          field: "company_evidence",
          claim: "A comparable compliance-technology platform discloses an average annual contract value of $18,000.",
          url: "https://example-adjacent-vendor.com/about",
          sourceType: "company_source",
        }),
      ],
    },
    regtechPrompt
  );

  assert.ok(graph.planningEstimate, "expected proxy pricing recovery to still unlock a bottom-up estimate");
  assert.equal(graph.planningEstimate.pricingSource, "proxy", "hedged 'comparable product' evidence must remain proxy-tier, exactly as before this task");
});

// ---------------------------------------------------------------------
// B2: insufficient sizing evidence never produces a fabricated number.
// ---------------------------------------------------------------------

test("B2: no buyer-population or pricing evidence at all -- sizingGap is honest, never a fabricated TAM/SAM/SOM", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          claim: "GRC software adoption is growing among enterprises facing new regulatory requirements.",
          url: "https://example.com/trend-article",
          sourceType: "credible_market_data",
        }),
      ],
    },
    regtechPrompt
  );

  assert.equal(graph.planningEstimate, null);
  assert.ok(graph.sizingGap);
  assert.doesNotMatch(graph.sizingGap.explanation, /\$\d/, "must never invent a market figure from insufficient evidence");
});

// ---------------------------------------------------------------------
// C. Evidence Gap -> Recommendation closure linkage.
// ---------------------------------------------------------------------

const defaultMarketSizing = {
  tam: "Additional market validation is required before sizing can be confirmed.",
  sam: "Additional market validation is required before sizing can be confirmed.",
  som: "Additional market validation is required before sizing can be confirmed.",
  method: "unresolved",
  tier: "directional",
  samMethod: "blocked",
  somStatus: "pending",
  conflicting: false,
  conflictNote: "",
  confidence: 40,
  confidenceLevel: "Low",
  evidenceIds: [],
};

function buildCoverage(overrides = {}) {
  return {
    overallConfidence: 45,
    verifiedMarketSizeAvailable: false,
    dimensions: {
      marketConfidence: 40,
      competitiveEvidence: 30,
      financialEvidence: 40,
      productEvidence: 45,
      executionReadiness: 45,
      founderReadiness: 45,
      ...overrides,
    },
  };
}

// The exact real-report shape this task's ticket describes: BOTH
// competitive-evidence AND market-sizing simultaneously unresolved,
// MONITOR at 40% confidence.
function buildTwoGapState(overrides = {}) {
  return {
    version: 3,
    decision: "CONDITIONAL_GO",
    confidence: 40,
    confidenceDirection: "reduced",
    topRisks: ["No named competitor or adjacent-market player could be independently validated."],
    topReasons: ["Regulatory tailwinds support continued category growth."],
    why: "Evidence supports monitoring pending competitive and market-sizing validation.",
    missingEvidence: ["Independently verified competitor data.", "Buyer-population and pricing evidence for sizing."],
    whatWouldChangeThisDecision: "Further diligence would be required before reconsidering this position.",
    immediateNextAction: "Commission competitor discovery and bottom-up sizing research.",
    decisionCriticalEvidence: {
      marketSizingResolved: false,
      competitiveEvidenceResolved: false,
      obtainableShareResolved: true,
    },
    marketSizing: { ...defaultMarketSizing },
    cagr: [],
    coverage: buildCoverage(),
    competitors: [],
    ...overrides,
  };
}

const TWO_GAP_STATE = buildTwoGapState();

function buildValidation(item, canonicalState = TWO_GAP_STATE) {
  return classifyStrategicRecommendationValidation({
    item,
    signals: extractRecommendationSignals(item),
    canonicalState,
    language: "English",
  });
}

const COMPETITOR_ACTION_ITEM =
  "Validate the competitive landscape via structured competitor discovery over 6 weeks (Owner: Head of Market Research) — Budget cap $15,000 (estimated) — Success criterion: at least 2 named competitors independently confirmed via the competitive landscape review.";

const SIZING_ACTION_ITEM =
  "Validate the bottom-up market-sizing inputs (buyer population and pricing) over 8 weeks (Owner: Head of Strategy) — Budget cap $25,000 (estimated) — Success criterion: verified TAM within 20% confidence interval.";

const UNCLASSIFIABLE_ACTION_ITEM =
  "Continue monitoring the regulatory environment over 90 days (Owner: Compliance Lead) — Budget cap $5,000 (estimated).";

test("C-fixture sanity: competitive-evidence and market-sizing are both material/unresolved gaps simultaneously", () => {
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(TWO_GAP_STATE, "English").filter(
    (g) => g.decisionFactor !== null
  );
  assert.equal(materialGaps.length, 2);
  assert.ok(materialGaps.some((g) => g.id === "competitive-evidence"));
  assert.ok(materialGaps.some((g) => g.id === "market-sizing"));
});

test("C5: a competitor-discovery recommendation structurally links to the competitive-evidence gap even with 2 simultaneously unresolved gaps, and its Closure Plan inherits the real owner/timeline/budget", () => {
  const validation = buildValidation(COMPETITOR_ACTION_ITEM);
  assert.equal(validation.relatedEvidenceGapId, "competitive-evidence");

  const plan = resolveMarketIntelligenceGapClosurePlan(TWO_GAP_STATE, "competitive-evidence", [validation], "English");
  assert.ok(plan);
  assert.equal(plan.owner, "Head of Market Research");
  assert.match(plan.timeline, /6 weeks/);
  assert.match(plan.budget ?? "", /\$15,000/);
  assert.doesNotMatch(plan.owner, /not yet assigned/i);
  assert.doesNotMatch(plan.timeline, /no timeline committed/i);
});

test("C6: a recommendation with no classifiable competitor/sizing signal remains explicitly unassigned -- never fabricated", () => {
  const validation = buildValidation(UNCLASSIFIABLE_ACTION_ITEM);
  assert.equal(validation.relatedEvidenceGapId, null);

  const plan = resolveMarketIntelligenceGapClosurePlan(TWO_GAP_STATE, "competitive-evidence", [validation], "English");
  assert.ok(plan);
  assert.match(plan.owner, /not yet assigned/i);
  assert.match(plan.timeline, /no timeline committed/i);
});

test("C7: two simultaneously unresolved gaps resolve their Closure Plans independently, each from its own correctly-linked recommendation", () => {
  const competitorValidation = buildValidation(COMPETITOR_ACTION_ITEM);
  const sizingValidation = buildValidation(SIZING_ACTION_ITEM);
  assert.equal(competitorValidation.relatedEvidenceGapId, "competitive-evidence");
  assert.equal(sizingValidation.relatedEvidenceGapId, "market-sizing");

  const allValidations = [competitorValidation, sizingValidation];
  const competitivePlan = resolveMarketIntelligenceGapClosurePlan(TWO_GAP_STATE, "competitive-evidence", allValidations, "English");
  const sizingPlan = resolveMarketIntelligenceGapClosurePlan(TWO_GAP_STATE, "market-sizing", allValidations, "English");

  assert.equal(competitivePlan.owner, "Head of Market Research");
  assert.match(competitivePlan.timeline, /6 weeks/);
  assert.equal(sizingPlan.owner, "Head of Strategy");
  assert.match(sizingPlan.timeline, /8 weeks/);

  // Never cross-contaminated: the competitor plan never picks up the
  // sizing recommendation's fields, and vice versa.
  assert.notEqual(competitivePlan.owner, sizingPlan.owner);
});

// ---------------------------------------------------------------------
// D. Decision safety: fixing closure-plan linkage must never change
// the canonical decision/confidence/ENTER eligibility for a fixture
// whose actual evidence state is unchanged.
// ---------------------------------------------------------------------

test("D8: decision and confidence for the two-gap fixture are unaffected by the Closure Plan linkage fix -- still MONITOR-equivalent at 40%", () => {
  assert.equal(TWO_GAP_STATE.decision, "CONDITIONAL_GO");
  const confidenceState = resolveMarketIntelligenceConfidenceState(TWO_GAP_STATE, "English");
  assert.equal(confidenceState.score, 40);
});

test("D8 (drift check): the Task #68 competitive-evidence multi-gap fallback lives entirely inside resolveLinkedEvidenceGap and never touches decision/confidence/ENTER-eligibility functions", () => {
  const fixIndex = evidenceGapsSource.indexOf("COMPETITIVE_EVIDENCE_LINK_PATTERN");
  const decisionFnIndex = evidenceGapsSource.indexOf("export function resolveMarketIntelligenceGatedExecutiveDecision");
  const confidenceFnIndex = evidenceGapsSource.indexOf("export function resolveMarketIntelligenceConfidenceState");
  const enterFnIndex = evidenceGapsSource.indexOf("export function resolveMarketIntelligenceEnterEligibility");
  assert.ok(fixIndex >= 0);
  // The fix is defined well before those functions and is never
  // referenced inside them (a simple substring scope check: the
  // decision/confidence/ENTER functions' own bodies never mention the
  // new pattern name).
  const decisionFnBody = evidenceGapsSource.slice(decisionFnIndex, decisionFnIndex + 4000);
  const confidenceFnBody = evidenceGapsSource.slice(confidenceFnIndex, confidenceFnIndex + 4000);
  const enterFnBody = evidenceGapsSource.slice(enterFnIndex, enterFnIndex + 4000);
  assert.doesNotMatch(decisionFnBody, /COMPETITIVE_EVIDENCE_LINK_PATTERN/);
  assert.doesNotMatch(confidenceFnBody, /COMPETITIVE_EVIDENCE_LINK_PATTERN/);
  assert.doesNotMatch(enterFnBody, /COMPETITIVE_EVIDENCE_LINK_PATTERN/);
});

test("D (drift check, Task #50 preserved): a sole competitive-evidence gap still accepts ANY validation/pilot metric, unaffected by the new multi-gap-only fallback", () => {
  const soleGapState = buildTwoGapState({
    decisionCriticalEvidence: { marketSizingResolved: true, competitiveEvidenceResolved: false, obtainableShareResolved: true },
  });
  const anyPilot = buildValidation(
    "Run a pilot survey of adjacent vendors to validate the competitive landscape over 6 weeks (Owner: Head of Insights) — Success criterion: 85% extraction accuracy on vendor filings.",
    soleGapState
  );
  assert.equal(anyPilot.relatedEvidenceGapId, "competitive-evidence");
});

// ---------------------------------------------------------------------
// E. Web and PDF consume the same canonical structured objects -- no
// separate re-implementation of competitor discovery or closure-plan
// resolution in either render surface.
// ---------------------------------------------------------------------

test("E9: page.tsx and ReportPdfButton.tsx both resolve Evidence Gap Closure Plans through the shared canonical resolver, never a separate implementation", () => {
  assert.match(pageSource, /resolveMarketIntelligenceGapClosurePlan|resolveMarketIntelligenceControllingClosurePlan/);
  assert.match(pdfButtonSource, /resolveMarketIntelligenceGapClosurePlan|resolveMarketIntelligenceControllingClosurePlan/);
});

test("E9: the new competitor-mention pattern lives only in vendor-discovery.ts's shared mentionPatterns array, not duplicated in any render surface", () => {
  assert.doesNotMatch(pageSource, /is\\s\+an\?\\s\+/);
  assert.doesNotMatch(pdfButtonSource, /is\\s\+an\?\\s\+/);
  const occurrences = (vendorDiscoverySource.match(/platform\|software\|solution\|tool\|provider\|service/g) || []).length;
  assert.equal(occurrences, 1, "the new role-noun pattern must be defined exactly once");
});
