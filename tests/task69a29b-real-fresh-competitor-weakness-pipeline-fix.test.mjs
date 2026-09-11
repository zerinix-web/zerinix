import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  enrichCompetitorWeaknessesFromEvidence,
  attachWeaknessProvenance,
  formatCompetitorWeaknessForDisplay,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

// TASK #69A-29B -- a real fresh Business Idea Validation report
// discovered and structured 4 real, named competitors (Jirav, Spotlight
// Reporting, Fathom, Float) with populated, evidence-aware positioning
// and strengths, but ALL FOUR weakness fields still rendered "No
// evidence-backed weakness identified" -- in both web and PDF.
//
// ROOT CAUSE, traced through the real generation-time pipeline (research
// query -> research evidence -> normalization -> competitor extraction
// -> weakness candidate extraction -> negative-claim validation ->
// canonical object -> persistence -> renderers): the two existing
// deterministic Tier 1.5 fallback strategies in
// enrichCompetitorWeaknessesFromEvidence (#69A-40B's embedded-feature-
// within-a-broader-platform pattern, #69A-60's review-platform "Cons"
// pattern) are each narrow BY DESIGN and structurally cannot fire for
// any of these four real competitors: all four are dedicated, standalone
// FP&A/forecasting products (not an embedded add-on inside a broader
// platform), and none of them happened to have a G2/Capterra-shaped
// "Cons:" review captured in this report's research corpus. Tier 0 (the
// model itself) was already schema-permitted and explicitly instructed
// to draw exactly the comparative inference the ticket's own worked
// example describes (a competitor's own documented reporting/forecasting
// scope vs. this business's own differentiating capability), but
// reliably still returned null for these specific real competitors -- the
// same LLM caution-bias asymmetry #69A-29A/#69A-40B/#69A-45/#69A-60 each
// independently found and fixed with a deterministic code-level fallback
// for a DIFFERENT evidence shape.
//
// FIX: a third, independent Tier 1.5c strategy (deriveCapabilityGapWeakness,
// business-competitor-landscape-state.ts) that only fires when Tiers 0/
// 1/1.5a/1.5b all left a competitor "unavailable". It compares a small,
// curated set of capability-differentiator patterns (prescriptive
// recommendation depth, automated risk-alerting depth, scenario-planning
// depth -- the exact three differentiators this report's own reference
// business idea names) against (a) whether THIS business's own idea text
// claims that capability, and (b) whether this SPECIFIC competitor's own
// already-verified positioning/strengths text says anything about it. If
// (a) is true and (b) is false, the honest, non-fabricating inference is
// "<capability> is not established in the reviewed evidence for this
// competitor" -- an evidence-GAP statement, never a claim that the
// competitor lacks it. Requires no new research call: it reuses the
// SAME already-fetched, already-canonical positioning/strengths fields
// Tier 0 already produced.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const profilesSource = readFileSync(join(repoRoot, "app/lib/decision-intelligence/profiles.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");

// The exact real business idea from this ticket's own reference case.
const NORMALIZED_BUSINESS_IDEA =
  "premium ai-powered financial planning saas for small and medium-sized businesses in the united states " +
  "connecting to accounting platforms such as quickbooks and xero providing automated cash-flow forecasting " +
  "scenario planning financial risk alerts and ai-powered recommendations for business owners";

// The real observed case: 4 named competitors with populated,
// evidence-aware positioning/strengths but null structured weaknesses --
// text here is a faithful reconstruction of each vendor's own real,
// publicly documented positioning (reporting/forecasting for accountants
// and advisors), not copied from any specific proprietary research
// payload, and no negative claim is asserted about any of them anywhere
// in this test file.
function realFreshReportCompetitors() {
  return [
    {
      company: "Jirav",
      type: "Direct competitor",
      positioning: "Integrated FP&A platform for finance teams and accountants, combining budgeting, forecasting, and reporting.",
      strengths: "Deep integrations with QuickBooks/Xero/NetSuite and strong workforce planning tools.",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "High",
    },
    {
      company: "Spotlight Reporting",
      type: "Direct competitor",
      positioning: "Financial reporting and forecasting tool built for accountants and advisors to serve their SMB clients.",
      strengths: "Strong accountant/advisor channel distribution and polished reporting visuals.",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
    {
      company: "Fathom",
      type: "Direct competitor",
      positioning: "Financial analysis and management reporting SaaS for accountants and business advisors.",
      strengths: "Well-regarded KPI dashboards and consolidated reporting for multi-entity clients.",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
    {
      company: "Float",
      type: "Substitute",
      positioning: "Cash flow forecasting tool for accountants and bookkeepers, focused on short-term cash visibility.",
      strengths: "Simple, fast setup and direct QuickBooks/Xero sync.",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
  ];
}

function buildRealFreshReportState() {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realFreshReportCompetitors());
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], NORMALIZED_BUSINESS_IDEA);
  return attachWeaknessProvenance(enriched, []);
}

// ===========================================================================
// SECTION 6 -- REAL-CASE ACCEPTANCE TEST
// ===========================================================================

test("[REAL CASE] Jirav, Spotlight Reporting, Fathom, and Float all resolve to a DIRECTIONAL weakness (never fabricated, never a hardcoded per-vendor string) for the exact real report shape that used to leave all four unavailable", () => {
  const state = buildRealFreshReportState();
  assert.equal(state.competitors.length, 4);
  for (const competitor of state.competitors) {
    assert.notEqual(competitor.weaknesses, "—", `${competitor.company} must no longer be unavailable`);
    assert.equal(competitor.weaknessBasis, "directional");
    assert.match(competitor.weaknesses, /not established in the reviewed evidence/i);
  }
});

test("[REAL CASE] the resolved weakness never asserts the competitor LACKS the capability -- only that the reviewed evidence does not establish it (the ticket's own required distinction)", () => {
  const state = buildRealFreshReportState();
  for (const competitor of state.competitors) {
    assert.doesNotMatch(competitor.weaknesses, /\blacks?\b|\bdoesn'?t have\b|\bdoes not have\b|\bweak(?:ness)?\s+ai\b|\bpoor\b|\binferior\b/i);
  }
});

test("[REAL CASE] web/PDF display text matches the ticket's own permitted example shape exactly: '<capability> ... (Directional)'", () => {
  const state = buildRealFreshReportState();
  for (const competitor of state.competitors) {
    const displayed = formatCompetitorWeaknessForDisplay(competitor);
    assert.match(displayed, / \(Directional\)$/);
    assert.notEqual(displayed, "No evidence-backed weakness identified");
  }
});

// ===========================================================================
// SECTION 8.1 -- explicit evidence-backed limitation -> VERIFIED survives
// ===========================================================================

test("1. an explicit, model-supplied VERIFIED weakness is never touched or downgraded by the new capability-gap fallback", () => {
  const structuredResponse = [
    {
      company: "Acme FP&A",
      type: "Direct competitor",
      positioning: "Reporting and forecasting for SMBs.",
      strengths: "Established brand.",
      weaknesses: "Its own G2 reviews directly document a documented limitation in multi-entity consolidation.",
      weaknessBasis: "verified",
      threat: "Medium",
    },
  ];
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknessBasis, "verified");
  assert.equal(
    enriched.competitors[0].weaknesses,
    "Its own G2 reviews directly document a documented limitation in multi-entity consolidation."
  );
});

// ===========================================================================
// SECTION 8.2 -- valid comparative inference -> DIRECTIONAL survives
// (covers all three Tier 1.5 strategies: embedded-feature, review-
// platform, and this task's new capability-gap fallback)
// ===========================================================================

test("2a. Tier 1.5a (embedded-feature, official-domain evidence) still fires and is never shadowed by the new capability-gap fallback", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Xero", type: "Direct competitor", positioning: "Accounting platform.", strengths: "Wide bank feeds.", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    { id: "R7", url: "https://www.xero.com/us/accounting-software/analytics/cash-flow", claim: "Cash flow forecasting and scenario planning is built-in to the broader accounting platform.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, evidence, NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknessBasis, "directional");
  assert.match(enriched.competitors[0].weaknesses, /embedded within a broader general-purpose platform/);
});

test("2b. Tier 1.5b (review-platform stated limitation) still fires and is never shadowed by the new capability-gap fallback", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Fathom", type: "Direct competitor", positioning: "Reporting SaaS.", strengths: "Good dashboards.", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const evidence = [
    { id: "R9", url: "https://www.g2.com/products/fathom/reviews", claim: "Cons: limited scenario modeling depth for complex multi-entity groups.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, evidence, NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknessBasis, "directional");
  assert.match(enriched.competitors[0].weaknesses, /stated limitation/);
});

test("2c. Tier 1.5c (this task's new capability-gap fallback) fires ONLY when 1.5a/1.5b found nothing, using the competitor's own already-verified positioning/strengths", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Jirav", type: "Direct competitor", positioning: "FP&A reporting and budgeting for finance teams.", strengths: "Strong integrations.", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknessBasis, "directional");
  assert.match(enriched.competitors[0].weaknesses, /not established in the reviewed evidence/);
});

test("2c: 1.5a/1.5b take priority over 1.5c when BOTH could apply -- the capability-gap fallback never overrides an evidence-item-backed inference", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Xero", type: "Direct competitor", positioning: "Accounting platform for SMBs.", strengths: "Wide bank feeds.", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    { id: "R7", url: "https://www.xero.com/us/accounting-software/analytics/cash-flow", claim: "Cash flow forecasting and scenario planning is built-in to the broader accounting platform.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, evidence, NORMALIZED_BUSINESS_IDEA);
  // Xero's positioning/strengths text says nothing about scenario planning
  // either, so 1.5c COULD also have fired here -- confirm 1.5a's
  // evidence-item-cited result is what actually won.
  assert.match(enriched.competitors[0].weaknesses, /\[R7\]/);
});

// ===========================================================================
// SECTION 8.3 -- unsupported negative inference -> rejected
// ===========================================================================

test("3a. a competitor whose OWN verified positioning/strengths ALREADY claims the differentiating capability is never given a fabricated gap weakness", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    {
      company: "Vendor With Recommendations",
      type: "Direct competitor",
      positioning: "Offers AI-powered prescriptive recommendations, automated risk alerts, and scenario planning for SMB finance teams.",
      strengths: "Not available",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
  ]);
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknesses, "—");
  assert.equal(enriched.competitors[0].weaknessBasis, "unavailable");
});

test("3b. when the business idea itself names no differentiating capability at all, the fallback never invents one", () => {
  const genericIdea = "a mobile app for tracking daily water intake";
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "HydrateNow", type: "Direct competitor", positioning: "A hydration tracking app for consumers.", strengths: "Simple UI.", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], genericIdea);
  assert.equal(enriched.competitors[0].weaknesses, "—");
});

test("3c. an empty/undefined normalizedBusinessIdea argument (the default, e.g. any pre-existing caller that only passes 2 args) never fires the new fallback -- fully backward compatible", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Jirav", type: "Direct competitor", positioning: "FP&A reporting for finance teams.", strengths: "Strong integrations.", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const enrichedNoArg = enrichCompetitorWeaknessesFromEvidence(built, []);
  assert.equal(enrichedNoArg.competitors[0].weaknesses, "—");
});

// ===========================================================================
// SECTION 8.4 -- absence of evidence -> UNAVAILABLE
// ===========================================================================

test("4. a competitor with no verified positioning AND no verified strengths at all stays honestly unavailable -- there is no verified fact to ground a comparison in", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Unknown Vendor", type: "Direct competitor", positioning: null, strengths: null, weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, [], NORMALIZED_BUSINESS_IDEA);
  assert.equal(enriched.competitors[0].weaknesses, "—");
  assert.equal(enriched.competitors[0].weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(enriched.competitors[0]), "No evidence-backed weakness identified");
});

// ===========================================================================
// SECTION 8.5 -- absence-of-feature evidence is not proof of absence
// ===========================================================================

test("5. the capability-gap fallback's own template never claims proof of absence -- source-level check that the sentence structurally reports an evidence GAP, not a fact about the competitor's product", () => {
  assert.match(stateSource, /is not established in the reviewed evidence/);
  const fnMatch = stateSource.match(/function deriveCapabilityGapWeakness\([\s\S]{0,2000}?\n\}/);
  assert.ok(fnMatch, "deriveCapabilityGapWeakness not found");
  assert.doesNotMatch(fnMatch[0], /`.*\blacks\b.*`|`.*\bdoes not (?:have|offer|support)\b.*`/i);
});

// ===========================================================================
// SECTION 8.6 -- sourceRefs/basis survive canonicalization and persistence
// ===========================================================================

test("6. weaknessBasis ('directional') survives a full JSON persistence round trip for all four real competitors, and the capability-gap case correctly has NO weaknessSourceRefs (no single citable evidence item backs an evidence-gap inference)", () => {
  const state = buildRealFreshReportState();
  const roundTripped = JSON.parse(JSON.stringify(state));

  for (const original of state.competitors) {
    const reloaded = roundTripped.competitors.find((c) => c.company === original.company);
    assert.equal(reloaded.weaknesses, original.weaknesses);
    assert.equal(reloaded.weaknessBasis, original.weaknessBasis);
    assert.equal(reloaded.weaknessSourceRefs, undefined);
    assert.equal(reloaded.weaknessConfidence, undefined);
  }
});

test("6b. an evidence-backed Tier 1.5a/1.5b weakness's [R#] citation and derived weaknessConfidence DO survive persistence -- provenance is preserved when it genuinely exists", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Xero", type: "Direct competitor", positioning: "Accounting platform.", strengths: "Wide bank feeds.", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    { id: "R7", url: "https://www.xero.com/us/accounting-software/analytics/cash-flow", claim: "Cash flow forecasting and scenario planning is built-in to the broader accounting platform.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(built, evidence, NORMALIZED_BUSINESS_IDEA);
  const withProvenance = attachWeaknessProvenance(enriched, [{ id: "R7", confidence: 80 }]);
  const roundTripped = JSON.parse(JSON.stringify(withProvenance));
  assert.deepEqual(roundTripped.competitors[0].weaknessSourceRefs, ["R7"]);
  assert.equal(roundTripped.competitors[0].weaknessConfidence, "High");
});

// ===========================================================================
// SECTION 8.7 -- web and PDF render the same weakness state
// ===========================================================================

test("7. page.tsx, Planner.tsx, and ReportPdfButton.tsx all import and rely on the SAME formatCompetitorWeaknessForDisplay -- no independent per-renderer reconstruction of the '(Directional)' qualifier", () => {
  for (const source of [plannerSource, pageSource, pdfButtonSource]) {
    assert.match(
      source,
      /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s
    );
  }
});

test("7b. rendering the real 4-competitor state through formatCompetitorWeaknessForDisplay produces the exact same string every time it is called -- web and PDF cannot diverge for the same persisted record", () => {
  const state = buildRealFreshReportState();
  for (const competitor of state.competitors) {
    const forWeb = formatCompetitorWeaknessForDisplay(competitor);
    const forPdf = formatCompetitorWeaknessForDisplay(competitor);
    assert.equal(forWeb, forPdf);
  }
});

// ===========================================================================
// SECTION 8.8 -- real competitor identities/order/threat levels stable
// ===========================================================================

test("8. competitor company names, order, and threat levels for the real 4-competitor case are completely unaffected by the new weakness fallback", () => {
  const before = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realFreshReportCompetitors());
  const after = buildRealFreshReportState();
  assert.deepEqual(
    after.competitors.map((c) => ({ company: c.company, type: c.type, threat: c.threat })),
    before.competitors.map((c) => ({ company: c.company, type: c.type, threat: c.threat }))
  );
});

// ===========================================================================
// SECTION 8.9 -- research retries bounded/cached/deduplicated
// ===========================================================================

test("9. no new AI/research call, retry loop, or fetch was introduced anywhere in the new fallback -- it is pure, synchronous string matching over already-fetched data", () => {
  const fnMatch = stateSource.match(/function deriveCapabilityGapWeakness\([\s\S]{0,2000}?\n\}/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /await|fetch\(|client\.responses\.create|async |setTimeout|retry/i);
});

test("9b. the widened research-requirement text is still exactly ONE requirement entry (same query budget) -- not a new, additional research task", () => {
  const requirementCount = (profilesSource.match(/requirement\(\s*\n\s*"competitors",/g) || []).length;
  assert.equal(requirementCount, 1, "expected exactly one 'competitors' requirement definition, never duplicated");
});

test("9c. no hardcoded competitor-specific weakness text was introduced anywhere in the new fallback -- the template is generic and reusable for any competitor", () => {
  const fnMatch = stateSource.match(/function deriveCapabilityGapWeakness\([\s\S]{0,2000}?\n\}/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /Jirav|Spotlight|Fathom|Float|QuickBooks|Xero|Cash Flow Frog|Futrli/i);
});

// ===========================================================================
// SECTION 8.10 -- decision/confidence/founder metrics unaffected
// ===========================================================================

test("10. business-competitor-landscape-state.ts still imports nothing from decision-engine/investment-score/founder-score/confidence-radar/Porter files -- this presentation-only fix cannot drift unrelated scoring", () => {
  assert.doesNotMatch(stateSource, /decision-engine|investment-score|founder-score|confidence-radar|porters-five-forces/i);
});

test("10b. the new 3rd argument threaded through plan-executor.ts's call site is read from the SAME already-built researchAwareFinancialContext -- no new scoring recomputation, no new AI call at the call site", () => {
  const callSiteStart = planExecutorSource.indexOf(
    "const businessCompetitorLandscapeState = attachWeaknessProvenance("
  );
  assert.ok(callSiteStart > -1);
  const callSiteRegion = planExecutorSource.slice(callSiteStart, callSiteStart + 600);
  assert.match(callSiteRegion, /researchAwareFinancialContext\.normalizedBusinessIdea/);
  assert.doesNotMatch(callSiteRegion, /createInvestmentScore\(|createRecommendation\(|client\.responses\.create/);
});

test("[REGRESSION LOCK] no test in this file asserts a specific frozen decision/confidence/Founder Readiness value -- this suite is scoped exclusively to competitor weakness classification", () => {
  const gateSource = readFileSync(new URL(import.meta.url).pathname, "utf8");
  assert.doesNotMatch(gateSource, /recommendation.*===.*"(GO|WAIT|PASS)"|confidence.*===.*\d+/);
});
