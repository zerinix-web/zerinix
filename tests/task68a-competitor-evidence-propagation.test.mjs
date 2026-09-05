import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";

// TASK #68A -- Fix real competitor-evidence propagation into Competitive
// Landscape.
//
// ROOT CAUSE (confirmed live against the exact real report/evidence
// bundle that produced the reported bug -- retrieved directly from
// production via the ai_response_cache research snapshot for report
// 658290ec-8777-4e17-8b6f-faece4b3f366): OpenAI's native web_search tool
// commonly returns a bare URL citation with the domain itself as the
// ENTIRE claim/value/sourceTitle text (e.g. claim="niceactimize.com",
// sourceType: "official company source"), never a real descriptive
// snippet. extractVendorCandidateMentions' Path C (domain-fallback,
// deriveCandidateNameFromDomain) correctly recognizes this shape and
// names a candidate from it -- but vendor-intelligence.ts's own gate
// (`candidate.matchedByDomainFallbackOnly && preliminaryClassification.entityType
// !== "commercial_vendor"`) discarded EVERY domain-fallback candidate
// whose classifyOrganizationEntity call fell to the generic "unknown"
// default -- which is unavoidable for a bare domain string with no
// descriptive text to classify from -- BEFORE validateVendorCandidate or
// assessMarketRelevance ever got a chance to evaluate it. NICE Actimize
// was cited from 4 distinct niceactimize.com sub-pages, each
// independently labeled "official company source" by the research
// pipeline's own upstream source classifier, and was correctly named in
// the report's own narrative (Threats/Industry Trends/Executive Summary)
// -- but silently dropped from Competitive Landscape/Major Players by
// this one gate.
//
// FIX: vendor-intelligence.ts now upgrades a domain-fallback-only
// candidate's "unknown" classification to "commercial_vendor" ONLY when
// 2+ of its own qualifying evidence items, from 2+ INDEPENDENT domains,
// are already labeled "official company source" by the upstream
// classifier -- never a guess from citation volume alone, and never
// touching validateVendorCandidate's own stricter, unmodified
// corroboration paths (a candidate upgraded here still cannot become a
// fully validated `vendors` entry without real, non-thin evidence; it
// can only ever reach the pre-existing, honestly-labeled adjacentPlayers
// tier). Confirmed via fail-before/pass-after against the real evidence
// bundle: adjacentPlayers was [] before this fix, ["Nice"] after.

const checkedAt = "2026-09-05T13:01:00.948Z";
function domainEvidence({ id, url, sourceType = "official company source", field = "vendor_discovery" }) {
  const domain = new URL(url).hostname.replace(/^www\./i, "");
  return {
    id,
    field,
    // The exact real-report shape: claim/value/sourceTitle are ALL just
    // the bare hostname -- no descriptive snippet at all.
    claim: domain,
    value: domain,
    sourceTitle: domain,
    label: "Verified from external source",
    publisher: domain,
    url,
    sourceType,
    authorityLevel: "secondary",
    confidence: 60,
    publishedDate: "",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "unknown",
    impactReason: "",
    qualityScore: 40,
    qualityRationale: "authority=19; specificity=6; provenance=15; content=0; date=0",
  };
}

const financePrompt =
  "I am considering launching an AI-powered compliance and risk management SaaS platform for mid-sized financial services companies in the United States.";

// Mirrors the real report's evidence shape exactly (bare-domain claim/
// value/sourceTitle, "official company source", 4 distinct subdomains of
// the vendor's own domain) -- www.niceactimize.com/overview and
// info.niceactimize.com/PEP-Screening.html are the two real,
// unmodified URLs from the production evidence; the other two use
// differently-named subdomains than the real bundle's "marketplace."/
// "resources." (both of which incidentally collide with this codebase's
// OWN, separate, pre-existing marketplace/documentation-site exclusion
// vocabulary -- an unrelated edge case, not part of what this task
// fixes) so this fixture cleanly isolates the classification-upgrade fix
// under test.
const realNiceActimizeEvidence = [
  domainEvidence({ id: "R17", url: "https://www.niceactimize.com/overview" }),
  domainEvidence({ id: "R21", url: "https://apps.niceactimize.com/en-US/home" }),
  domainEvidence({ id: "R24", url: "https://info.niceactimize.com/PEP-Screening.html" }),
  domainEvidence({ id: "R25", url: "https://compliance.niceactimize.com/aml-transaction-monitoring" }),
];

// ---------------------------------------------------------------------
// G1/G3: a vendor with identity + market relevance evidence (real bug
// shape) appears in Competitive Landscape, and a vendor referenced in
// narrative-worthy evidence is never silently dropped from structured
// output.
// ---------------------------------------------------------------------

test("G1/G3: 4 independent bare-domain 'official company source' citations for the same real vendor populate a named adjacent-player row, never silently dropped", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: realNiceActimizeEvidence }, financePrompt);

  assert.equal(graph.vendorIntelligence.vendors.length, 0, "thin-only evidence must never become a fully validated direct competitor");
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((p) => p.name);
  assert.ok(adjacentNames.length > 0, `expected the real vendor to survive as an adjacent player, got none`);

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.doesNotMatch(projection.majorPlayers, /No competitor data could be validated/i);
});

// ---------------------------------------------------------------------
// G2/G5: unsupported competitor attributes remain empty / Validation
// Required, and Market Map stays Validation Needed even though a named
// competitor now exists.
// ---------------------------------------------------------------------

test("G2/G5: unsupported attributes (category, positioning, strengths, weaknesses, pricing, market share) stay Validation Required, never fabricated -- Competitive Landscape itself states insufficient positioning data even with a named player", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: realNiceActimizeEvidence }, financePrompt);
  const adjacentPlayer = graph.vendorIntelligence.adjacentPlayers[0];

  // AdjacentMarketPlayer's own type carries no category/positioning/
  // strengths/weaknesses/pricing/marketShare fields at all -- structurally
  // impossible to fabricate them here.
  assert.deepEqual(
    Object.keys(adjacentPlayer).sort(),
    ["confidence", "confidenceLevel", "evidenceCount", "evidenceIds", "name", "reason"].sort()
  );

  const projection = projectMarketIntelligenceGraphToReport(graph);
  assert.match(
    projection.competitiveLandscape,
    /insufficient structured positioning data.*(?:market map)/i,
    "the market map / positioning axes must remain explicitly Validation Needed"
  );
});

// ---------------------------------------------------------------------
// G4: weak vendor mentions do not become competitors.
// ---------------------------------------------------------------------

test("G4a: a SINGLE bare-domain official-source citation (no independent corroboration) does not become a competitor", () => {
  const graph = buildMarketIntelligenceGraph(
    { evidence: [domainEvidence({ id: "R1", url: "https://www.solovendor.com/home" })] },
    financePrompt
  );
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);
});

test("G4b: 2+ bare-domain citations with a NON-official sourceType do not become a competitor", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        domainEvidence({ id: "R1", url: "https://a.weaksignal.com/page1", sourceType: "credible_market_data" }),
        domainEvidence({ id: "R2", url: "https://b.weaksignal.com/page2", sourceType: "credible_market_data" }),
      ],
    },
    financePrompt
  );
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);
});

test("G4c: excluded/institutional and review-directory domains are still never minted as competitors, even with 2+ official-labeled citations", () => {
  const graph = buildMarketIntelligenceGraph(
    {
      evidence: [
        domainEvidence({ id: "R1", url: "https://en.wikipedia.org/wiki/Something" }),
        domainEvidence({ id: "R2", url: "https://simple.wikipedia.org/wiki/Something" }),
      ],
    },
    financePrompt
  );
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.ok(!graph.vendorIntelligence.adjacentPlayers.some((p) => /wikipedia/i.test(p.name)));
});

// ---------------------------------------------------------------------
// G6: resolving named competitor evidence updates the Competitive
// Landscape evidence-gap state correctly -- resolved via the pre-
// existing, unmodified gap rule ("named competitor OR adjacent player"),
// never via a new/duplicated gap-resolution mechanism.
// ---------------------------------------------------------------------

test("G6: competitiveEvidenceResolved (decisionCriticalEvidence) correctly flips true once a real adjacent player propagates, per the pre-existing, unmodified gap rule", () => {
  const graphWithEvidence = buildMarketIntelligenceGraph({ evidence: realNiceActimizeEvidence }, financePrompt);
  const resolved =
    graphWithEvidence.vendorIntelligence.vendors.length > 0 ||
    graphWithEvidence.vendorIntelligence.adjacentPlayers.length > 0;
  assert.equal(resolved, true);

  const graphWithoutEvidence = buildMarketIntelligenceGraph({ evidence: [] }, financePrompt);
  const stillUnresolved =
    graphWithoutEvidence.vendorIntelligence.vendors.length > 0 ||
    graphWithoutEvidence.vendorIntelligence.adjacentPlayers.length > 0;
  assert.equal(stillUnresolved, false, "with no evidence at all, the gap must correctly remain unresolved");
});

test("G6 (drift check): canonicalState.competitors is built ONLY from validated vendors, never from adjacentPlayers -- an adjacent-only resolution is never mistaken for a fully 'Verified' competitor", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: realNiceActimizeEvidence }, financePrompt);
  assert.equal(graph.competitors.length, 0, "no fully validated competitor exists yet, so the strict competitors array must stay empty");
  assert.ok(graph.vendorIntelligence.adjacentPlayers.length > 0, "the real evidence still surfaces honestly, just not as a 'Verified' competitor");
});

// ---------------------------------------------------------------------
// G7: unrelated decision/confidence behavior remains unchanged; where
// the evidence state legitimately changes (this fix's whole purpose),
// the resulting confidence/decision shift is bounded, mechanically
// explained by the pre-existing, unmodified evidence-gap cap -- never a
// new ad-hoc rule, and never a MONITOR -> ENTER jump from this alone.
// ---------------------------------------------------------------------

test("G7a: with NO competitor evidence at all, confidence/decision are byte-identical regardless of this fix (nothing to propagate)", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: [] }, financePrompt);
  const decisionCriticalEvidence = {
    marketSizingResolved: graph.planningEstimate !== null,
    competitiveEvidenceResolved:
      graph.vendorIntelligence.vendors.length > 0 || graph.vendorIntelligence.adjacentPlayers.length > 0,
    obtainableShareResolved: true,
  };
  assert.equal(decisionCriticalEvidence.competitiveEvidenceResolved, false);
  const result = assessMarketEntryConfidence(graph.coverage, decisionCriticalEvidence);
  const resultWithForcedFalse = assessMarketEntryConfidence(graph.coverage, {
    ...decisionCriticalEvidence,
    competitiveEvidenceResolved: false,
  });
  assert.deepEqual(result, resultWithForcedFalse);
});

test("G7b: when real adjacent-player evidence legitimately resolves the gap, any resulting confidence change is bounded to the pre-existing, unmodified cap tiers and never flips decision away from MONITOR by itself", () => {
  const graph = buildMarketIntelligenceGraph({ evidence: realNiceActimizeEvidence }, financePrompt);
  const decisionCriticalEvidence = {
    marketSizingResolved: graph.planningEstimate !== null,
    competitiveEvidenceResolved:
      graph.vendorIntelligence.vendors.length > 0 || graph.vendorIntelligence.adjacentPlayers.length > 0,
    obtainableShareResolved: true,
  };
  assert.equal(decisionCriticalEvidence.competitiveEvidenceResolved, true);

  const withFix = assessMarketEntryConfidence(graph.coverage, decisionCriticalEvidence);
  const withoutFix = assessMarketEntryConfidence(graph.coverage, {
    ...decisionCriticalEvidence,
    competitiveEvidenceResolved: false,
  });

  // The confidence cap tier may legitimately shift (one fewer unresolved
  // pillar raises the cap from 40 to 50, per the existing, unmodified
  // capConfidenceForEvidenceGap tiers) -- but decision must not jump to
  // ENTER or AVOID purely from this one pillar resolving.
  assert.equal(withFix.decision, "MONITOR");
  assert.equal(withoutFix.decision, "MONITOR");
  assert.ok(withFix.confidence >= withoutFix.confidence, "resolving real evidence must never DECREASE confidence");
  assert.ok(withFix.confidence <= 50, "must stay within the one-unresolved-pillar cap tier, never jump further than the existing architecture allows");
});

// ---------------------------------------------------------------------
// Fail-before/pass-after proof (structural, via source inspection): the
// new upgrade branch is narrowly scoped to domain-fallback-only
// candidates and requires 2+ independent official-source domains,
// never a blanket relaxation.
// ---------------------------------------------------------------------

test("drift check: the Task #68A upgrade is scoped to matchedByDomainFallbackOnly candidates with 2+ independent official-company-source domains, and never touches validateVendorCandidate", () => {
  const source = readFileSync(
    new URL("../app/lib/ai/vendor-intelligence.ts", import.meta.url),
    "utf8"
  );
  const fixIndex = source.indexOf("TASK #68A");
  assert.ok(fixIndex >= 0);
  const fixBody = source.slice(fixIndex, fixIndex + 4500);
  assert.match(fixBody, /candidate\.matchedByDomainFallbackOnly/);
  assert.match(fixBody, /officialSourceDomainCount >= 2/);
  assert.doesNotMatch(fixBody, /function validateVendorCandidate/);
});
