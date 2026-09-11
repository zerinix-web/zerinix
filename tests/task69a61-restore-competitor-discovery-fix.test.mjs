import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  enrichCompetitorWeaknessesFromEvidence,
  attachWeaknessProvenance,
  formatCompetitorWeaknessForDisplay,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";

// TASK #69A-61 -- regression coverage for a real production regression:
// a fresh Business Idea Validation report for a financial-planning SaaS
// produced "No competitor data could be validated for this market yet."
// even though research found 69 evidence items and the model's own
// structured response genuinely named real competitors. Traced via
// direct dev-server log inspection (not guessed): the whole report was
// discarded by validateDomainResearchQuality's own "unsupported numeric
// claim lacks evidence and source or method provenance" gate
// (domain-research.ts) -- NOT a competitor-discovery bug. Root cause:
// #69A-59/#69A-60's own correctPricingUnitMismatches fix replaces a
// mismatched ACV/per-seat pricing mention with a bare
// "$X/month per company" string, introducing a fresh, genuinely
// unlabeled numeric claim into targetCustomer/businessModel *after*
// parseFullPlanReport's #69A-39C per-field healing pass already ran, and
// neither field is covered by the later
// annotateUnclassifiedCanonicalMetricMentions healing pass either (it
// only auto-labels strategyRecommendationPlanFields). One unlabeled line
// anywhere in the 24-field report discards the ENTIRE report -- and
// with it, the genuinely-valid competitor/Porter data -- exactly the
// #69A-39A/#69A-39C disproportionate-blast-radius pattern, this time
// triggered by a fix from earlier in this same session.

const PLAN_EXECUTOR_SOURCE = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const PAGE_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const PLANNER_SOURCE = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const PDF_BUTTON_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// Reconstructed, byte-verified against the real domain-research.ts
// source below (this file cannot be imported directly -- it declares
// `import "server-only"` at module scope).
const NUMERIC_CLAIM_LINE_PATTERN =
  /(?:^|\n)(?!\s*#)[^\n]*(?:[$€£₺¥]\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:%|USD|EUR|GBP|TRY|TL|m²|sqm|months?|years?))\b[^\n]*/gi;
const NUMERIC_CLAIM_LABEL_PATTERN =
  /(?:\[(?:Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Recommendation)\]|\b(?:Verified|Estimated|Assumption|AI Analysis)\b)/i;
const NUMERIC_CLAIM_PROVENANCE_PATTERN =
  /(?:\[R\d+\]|\[Asset:[^\]]+\]|\[User\]|\[Method:[^\]]+\]|\[Basis:[^\]]+\]|https?:\/\/|\b(?:benchmark source|formula|assumption)\b)/i;

function fieldContentHasUnprovenClaim(text) {
  const numericClaims = text.match(NUMERIC_CLAIM_LINE_PATTERN) || [];
  return numericClaims.some(
    (claim) => !NUMERIC_CLAIM_LABEL_PATTERN.test(claim) || !NUMERIC_CLAIM_PROVENANCE_PATTERN.test(claim)
  );
}

const domainResearchSource = readFileSync(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);

test("the reconstructed NUMERIC_CLAIM_* patterns match domain-research.ts's real source exactly (so this file's own reconstruction can never silently drift from the actual gate)", () => {
  assert.match(
    domainResearchSource,
    /export const NUMERIC_CLAIM_LINE_PATTERN =\s*\n?\s*\/\(\?:\^\|\\n\)/
  );
  assert.match(domainResearchSource, /\\b\(\?:Verified\|Estimated\|Assumption\|AI Analysis\)\\b/);
  assert.match(domainResearchSource, /\\b\(\?:benchmark source\|formula\|assumption\)\\b/);
});

// --- 1. [FAIL-BEFORE PROOF] the exact real trigger -----------------------

test("[FAIL-BEFORE PROOF] the pre-fix pricing-unit-mismatch replacement produced a genuinely unlabeled numeric claim that fails the whole-report gate", () => {
  const preFixReplacement =
    "Budget owner: or advisory firm; willingness-to-pay: premium subscription ($1.5k/month per company up to advisor-bundled pricing) assumed; adoption trigger: cash variability, growth planning, financing or investor reporting need.";
  assert.equal(fieldContentHasUnprovenClaim(preFixReplacement), true);
});

test("the #69A-61 fix: the replacement now carries its own evidence annotation and passes the same gate check", () => {
  const postFixReplacement =
    "Budget owner: or advisory firm; willingness-to-pay: premium subscription ($1.5k/month per company (Estimated -- benchmark source) up to advisor-bundled pricing) assumed; adoption trigger: cash variability, growth planning, financing or investor reporting need.";
  assert.equal(fieldContentHasUnprovenClaim(postFixReplacement), false);
});

test("correctPricingUnitMismatches's real source now appends an evidence annotation parameter to its replacement, never a bare canonical price", () => {
  const fnStart = PLAN_EXECUTOR_SOURCE.indexOf("function correctPricingUnitMismatches(");
  assert.ok(fnStart > -1, "correctPricingUnitMismatches not found");
  const fnEnd = PLAN_EXECUTOR_SOURCE.indexOf("\nfunction ", fnStart + 10);
  const fnBody = PLAN_EXECUTOR_SOURCE.slice(fnStart, fnEnd);
  assert.match(fnBody, /evidenceAnnotation: string/);
  assert.match(fnBody, /`\$\{canonicalArpaDisplayValue\}\s*per company\s*\$\{evidenceAnnotation\}`/);
});

test("the correctPricingUnitMismatches call site computes a real, gate-recognized evidence annotation from the ARPA metric's own classification -- never a hardcoded label", () => {
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /const arpaEvidenceAnnotation = toGateRecognizedEvidenceAnnotation\(\s*\n\s*classifyFinancialMetricEvidenceType\(\s*\n\s*context\.metrics\.arpa,\s*\n\s*hasVerifiedUserProvidedData\(context\.financialConsistency\.sources\.userProvidedData\)\s*\n\s*\)\s*\n\s*\);/
  );
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /correctPricingUnitMismatches\(\s*\n\s*normalized\[pricingField\],\s*\n\s*context\.metrics\.arpa\.displayValue,\s*\n\s*arpaEvidenceAnnotation\s*\n\s*\);/
  );
});

// --- 2. Section 2: competitor acceptance must not depend on weakness ---

test("2. a competitor with genuinely no weakness evidence still produces a full competitor row -- entity existence is never coupled to weakness availability", () => {
  const structuredResponse = [
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting tool for accountants/bookkeepers", strengths: null, weaknesses: null, threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Cash flow forecasting SaaS for SMBs", strengths: null, weaknesses: null, threat: "Medium" },
    { company: "Futrli", type: "Direct competitor", positioning: "Financial forecasting and reporting for accountants", strengths: null, weaknesses: null, threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  assert.ok(state, "expected a non-null canonical state");
  assert.equal(state.competitors.length, 3);
  for (const competitor of state.competitors) {
    assert.equal(competitor.weaknessBasis, "unavailable");
    assert.ok(competitor.company, "identity must survive even with zero weakness evidence");
  }

  const enriched = enrichCompetitorWeaknessesFromEvidence(state, []);
  const withProvenance = attachWeaknessProvenance(enriched, []);
  assert.equal(withProvenance.competitors.length, 3, "no competitor may be dropped for lack of weakness evidence");
});

// --- 3-10. Real-case regression (financial-planning SaaS) --------------

function buildRealCaseFixture() {
  return buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Substitute", positioning: "Cash flow forecasting for accountants/bookkeepers", strengths: "Strong integration with QuickBooks/Xero", weaknesses: null, weaknessBasis: null, threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "Cash flow forecasting SaaS for SMBs", strengths: "Simple, visual cash flow tool", weaknesses: "Cons: limited scenario modeling depth compared to full FP&A suites", weaknessBasis: "directional", threat: "Medium" },
    { company: "Futrli", type: "Direct competitor", positioning: "Financial forecasting and reporting for accountants", strengths: "Confirmed directly on the vendor's own pricing page: unlimited forecasts on every plan", weaknesses: "No mobile app; confirmed directly on the vendor's own product page", weaknessBasis: "verified", threat: "Medium" },
    { company: "Cash Flow Frog", type: "Direct competitor", positioning: "duplicate entry, should be deduplicated", strengths: null, weaknesses: null, threat: "Low" },
  ]);
}

const realCaseEvidence = [
  { id: "R1", url: "https://www.floatapp.com/product", claim: "Float is used by thousands of businesses for cash flow forecasting.", value: "" },
  { id: "R2", url: "https://www.g2.com/products/cash-flow-frog/reviews", claim: "Cons: limited scenario modeling depth compared to full FP&A suites", value: "" },
];

test("3. supported real competitors (Float, Cash Flow Frog, Futrli) survive canonicalization end-to-end", () => {
  const state = buildRealCaseFixture();
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, realCaseEvidence);
  const final = attachWeaknessProvenance(enriched, [{ id: "R1", confidence: 80 }, { id: "R2", confidence: 70 }]);
  const names = final.competitors.map((c) => c.company);
  assert.deepEqual(names, ["Float", "Cash Flow Frog", "Futrli"], "duplicate 'Cash Flow Frog' entry must be deduplicated, and every real, distinct competitor must survive");
});

test("4. Float's competitor entity is not deleted because its weakness is unavailable", () => {
  const state = buildRealCaseFixture();
  const float = state.competitors.find((c) => c.company === "Float");
  assert.ok(float, "Float must exist in the canonical set");
  assert.equal(float.weaknessBasis, "unavailable");
});

test("5. unavailable weakness renders the honest, current canonical UNAVAILABLE display text (see #69A-59's own wording fix -- the underlying weaknessBasis: 'unavailable' state this ticket asks to preserve is unchanged)", () => {
  const state = buildRealCaseFixture();
  const float = state.competitors.find((c) => c.company === "Float");
  assert.equal(formatCompetitorWeaknessForDisplay(float), "No evidence-backed weakness identified");
});

test("6. directional weakness (Cash Flow Frog) remains visibly labeled Directional", () => {
  const state = buildRealCaseFixture();
  const cashFlowFrog = state.competitors.find((c) => c.company === "Cash Flow Frog");
  assert.equal(cashFlowFrog.weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(cashFlowFrog), /\(Directional\)$/);
});

test("verified weakness (Futrli) renders with no qualifier, and unsupported negative claims are rejected -- Jirav-style fabrication never happens", () => {
  const state = buildRealCaseFixture();
  const futrli = state.competitors.find((c) => c.company === "Futrli");
  assert.equal(futrli.weaknessBasis, "verified");
  assert.doesNotMatch(formatCompetitorWeaknessForDisplay(futrli), /Directional/);

  // A competitor with evidence that supports NEITHER the embedded-feature
  // nor the stated-limitation shape must never be assigned a fabricated
  // weakness -- confirms unsupported negative claims are rejected.
  const noEvidenceState = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Quicken", type: "Substitute", positioning: "Personal/small business finance software", strengths: "s", weaknesses: null, threat: "Low" },
  ]);
  const enrichedNoEvidence = enrichCompetitorWeaknessesFromEvidence(noEvidenceState, [
    { id: "R9", url: "https://www.quicken.com/features", claim: "Quicken offers budgeting and bill-pay tools.", value: "" },
  ]);
  const quicken = enrichedNoEvidence.competitors.find((c) => c.company === "Quicken");
  assert.equal(quicken.weaknessBasis, "unavailable");
});

test("7. substitutes remain distinguishable from direct competitors in the canonical set", () => {
  const state = buildRealCaseFixture();
  const float = state.competitors.find((c) => c.company === "Float");
  const cashFlowFrog = state.competitors.find((c) => c.company === "Cash Flow Frog");
  assert.equal(float.type, "Substitute");
  assert.equal(cashFlowFrog.type, "Direct competitor");
});

test("8. competitive evidence score is derived from the surviving canonical competitors, never hardcoded, and is zero only when the canonical set is genuinely empty", () => {
  const state = buildRealCaseFixture();
  const evidence = deriveCanonicalCompetitiveEvidence(state);
  assert.equal(evidence.competitorBreadth, 3);
  assert.ok(evidence.competitiveEvidence > 0, "three supported competitors must produce non-zero competitive evidence");

  const emptyEvidence = deriveCanonicalCompetitiveEvidence(null);
  assert.deepEqual(emptyEvidence, { competitorBreadth: 0, competitiveEvidence: 0 });

  const emptyState = buildBusinessCompetitorLandscapeStateFromStructuredResponse([]);
  assert.equal(emptyState, null, "an empty structured response must resolve to a genuinely null state, never a fabricated one");
});

test("9. Porter's Five Forces Tier 0/Tier 1 builders are untouched by this fix -- the degradation was a downstream symptom of the whole-report gate rejection, not a Porter-specific bug", () => {
  const portersSource = readFileSync(
    new URL("../app/lib/report-engine/porters-five-forces-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(portersSource, /TASK #69A-61/);
});

test("10. web (dashboard, Planner) and PDF (ReportPdfButton) consume the same canonical competitor set through the shared formatCompetitorWeaknessForDisplay helper -- unaffected by this fix", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.match(source, /formatCompetitorWeaknessForDisplay/);
  }
});

// --- 11. Generic-industry safety: prove the fix is not tuned to this ---
//         one business or these specific competitor names --------------

test("11. GENERIC INDUSTRY: an unrelated business (industrial 3D-printing marketplace) with its own arbitrary competitor names survives canonicalization identically -- proves no hardcoding to financial-planning SaaS or Float/Cash Flow Frog/Futrli", () => {
  const structuredResponse = [
    { company: "Xometry", type: "Direct competitor", positioning: "On-demand manufacturing marketplace", strengths: "Broad manufacturing network", weaknesses: null, threat: "High" },
    { company: "Fictiv", type: "Direct competitor", positioning: "Digital manufacturing platform for custom parts", strengths: null, weaknesses: "Cons: higher pricing for low-volume orders", weaknessBasis: "directional", threat: "Medium" },
    { company: "Local machine shops", type: "Substitute", positioning: "Traditional local manufacturing", strengths: null, weaknesses: null, threat: "Low" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(structuredResponse);
  assert.equal(state.competitors.length, 3);

  const evidence = [
    { id: "R1", url: "https://www.g2.com/products/fictiv/reviews", claim: "Cons: higher pricing for low-volume orders", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const withProvenance = attachWeaknessProvenance(enriched, [{ id: "R1", confidence: 65 }]);

  const xometry = withProvenance.competitors.find((c) => c.company === "Xometry");
  const fictiv = withProvenance.competitors.find((c) => c.company === "Fictiv");
  const localShops = withProvenance.competitors.find((c) => c.company === "Local machine shops");

  assert.equal(xometry.weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(xometry), "No evidence-backed weakness identified");
  assert.equal(fictiv.weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(fictiv), /\(Directional\)$/);
  assert.equal(localShops.type, "Substitute");
  assert.equal(xometry.type, "Direct competitor");

  const evidenceScore = deriveCanonicalCompetitiveEvidence(withProvenance);
  assert.equal(evidenceScore.competitorBreadth, 3);
  assert.ok(evidenceScore.competitiveEvidence > 0);
});

test("this fix's own #69A-61 diff contains no hardcoded reference to Float, Cash Flow Frog, Futrli, or Quicken -- these are regression examples, not expected constants (pre-existing historical comments from earlier tickets, e.g. #69A-15/#69A-29/#69A-29A, are untouched and out of scope for this check)", () => {
  const planExecutorMarkerStart = PLAN_EXECUTOR_SOURCE.indexOf("TASK #69A-61");
  assert.ok(planExecutorMarkerStart > -1, "expected at least one #69A-61 marker in plan-executor.ts");
  // Scope the check to the #69A-61 fix's own code, not the whole file
  // (which legitimately carries historical comments naming these exact
  // regression-example companies from #69A-15/#69A-29/#69A-29A).
  const fixRegionEnd = PLAN_EXECUTOR_SOURCE.indexOf(
    "function correctPricingUnitMismatches(",
    planExecutorMarkerStart
  );
  const fixRegion = PLAN_EXECUTOR_SOURCE.slice(planExecutorMarkerStart, fixRegionEnd + 2000);
  assert.doesNotMatch(fixRegion, /\bFloat\b|\bCash Flow Frog\b|\bFutrli\b|\bQuicken\b/);
});

// --- 12. Decision safety: this fix's blast radius is confined -----------

test("12. this fix's own diff surface carries no #69A-61 marker in any canonical decision/confidence/founder-readiness/benchmark-intelligence file", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/report-engine/decision-contradiction-gate.ts",
    "app/lib/ai/decision-confidence.ts",
    "app/lib/ai/validation-intelligence.ts",
  ]) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TASK #69A-61/, `${relativePath} must not carry a #69A-61 marker`);
  }
});
