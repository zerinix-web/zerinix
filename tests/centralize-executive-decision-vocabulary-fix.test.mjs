import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL ARCHITECTURE FIX -- centralize executive decision vocabulary.
//
// A cross-report consistency audit found at least six distinct, live
// decision-vocabulary systems across Business Plan, Market Intelligence,
// Acquisition Due Diligence, and the domain-analysis ("Strategic
// Advisory") family. This adds ONE centralized, 4-value canonical type
// (app/lib/report-engine/executive-decision-vocabulary.ts) -- PROCEED /
// PROCEED_WITH_CONDITIONS / PAUSE_PENDING_REVIEW / REJECT -- plus a pure
// mapping function per existing source vocabulary, and wires the
// resulting canonical label into the three live-UI surfaces that
// previously showed each report kind's own raw decision word verbatim:
// app/dashboard/page.tsx's reports-list decision signal, and the
// per-report "Decision" KPI card in both app/dashboard/[id]/page.tsx and
// components/Planner.tsx.
//
// Report-specific reasoning is untouched -- only the final decision
// label is standardized. Report generation logic, financial
// calculations, routing, and PDF layout (ReportPdfButton.tsx) are all
// confirmed untouched below.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importExecutiveDecisionVocabulary() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-executive-decision-vocabulary-"));
  const outPath = join(dir, "executive-decision-vocabulary.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const {
  CANONICAL_EXECUTIVE_DECISIONS,
  getCanonicalDecisionLabel,
  mapExecutiveDecisionCodeToCanonicalDecision,
  mapInvestmentScoreRecommendationToCanonicalDecision,
  mapAcquisitionCallToCanonicalDecision,
  mapDecisionIntelligenceRecommendationToCanonicalDecision,
  mapRealEstateCommitteeDecisionToCanonicalDecision,
  resolveCanonicalDecisionFromReportText,
} = await importExecutiveDecisionVocabulary();

const dashboardListSource = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const dashboardReportSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

// --- 1. The centralized type has exactly the required 4 values ------------

test("CANONICAL_EXECUTIVE_DECISIONS is exactly the four required values, no more, no fewer", () => {
  assert.deepEqual(
    [...CANONICAL_EXECUTIVE_DECISIONS].sort(),
    ["PAUSE_PENDING_REVIEW", "PROCEED", "PROCEED_WITH_CONDITIONS", "REJECT"].sort()
  );
});

test("getCanonicalDecisionLabel renders a distinct, human-readable label for all four values", () => {
  const labels = CANONICAL_EXECUTIVE_DECISIONS.map((decision) => getCanonicalDecisionLabel(decision));
  assert.deepEqual(labels, ["Proceed", "Proceed with Conditions", "Pause Pending Review", "Reject"]);
  assert.equal(new Set(labels).size, 4, "all four labels must be distinct");
});

// --- 2. Per-source mappers: every report kind maps into the vocabulary ----

test("Business Plan / Market Intelligence / Acquisition / Strategic Advisory's shared executive-decision-brief code maps correctly", () => {
  assert.equal(mapExecutiveDecisionCodeToCanonicalDecision("GO"), "PROCEED");
  assert.equal(mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO"), "PROCEED_WITH_CONDITIONS");
  assert.equal(mapExecutiveDecisionCodeToCanonicalDecision("NO_GO"), "REJECT");
});

test("Business Plan's raw investment-score.ts recommendation maps correctly", () => {
  assert.equal(mapInvestmentScoreRecommendationToCanonicalDecision("GO"), "PROCEED");
  assert.equal(mapInvestmentScoreRecommendationToCanonicalDecision("WAIT"), "PAUSE_PENDING_REVIEW");
  assert.equal(mapInvestmentScoreRecommendationToCanonicalDecision("PASS"), "REJECT");
});

test("Acquisition's own three canonical call phrases map correctly, and unrelated text returns null", () => {
  assert.equal(
    mapAcquisitionCallToCanonicalDecision("Proceed with Conditions. The deal clears diligence but requires..."),
    "PROCEED_WITH_CONDITIONS"
  );
  assert.equal(
    mapAcquisitionCallToCanonicalDecision("Pause Pending Review. Regulatory clearance is unresolved."),
    "PAUSE_PENDING_REVIEW"
  );
  assert.equal(mapAcquisitionCallToCanonicalDecision("Reject. Customer concentration risk is unacceptable."), "REJECT");
  assert.equal(mapAcquisitionCallToCanonicalDecision("The market opportunity is meaningful."), null);
});

test("the decision-intelligence engine's own recommendation vocabulary (Real Estate / Strategic Advisory) maps correctly", () => {
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Proceed"), "PROCEED");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Proceed Conditionally"), "PROCEED_WITH_CONDITIONS");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Proceed Carefully"), "PROCEED_WITH_CONDITIONS");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Wait"), "PAUSE_PENDING_REVIEW");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Insufficient Evidence"), "PAUSE_PENDING_REVIEW");
  assert.equal(mapDecisionIntelligenceRecommendationToCanonicalDecision("Avoid"), "REJECT");
});

test("Real Estate's own further-simplified BUY/WAIT/AVOID committee label maps correctly", () => {
  assert.equal(mapRealEstateCommitteeDecisionToCanonicalDecision("BUY"), "PROCEED");
  assert.equal(mapRealEstateCommitteeDecisionToCanonicalDecision("WAIT"), "PAUSE_PENDING_REVIEW");
  assert.equal(mapRealEstateCommitteeDecisionToCanonicalDecision("AVOID"), "REJECT");
});

// --- 3. resolveCanonicalDecisionFromReportText: full-text resolution ------

test("resolves Acquisition's own phrase from free-flowing report text", () => {
  const resolved = resolveCanonicalDecisionFromReportText(
    "Final Investment Recommendation\nProceed with Conditions. The deal clears financial diligence."
  );
  assert.equal(resolved.decision, "PROCEED_WITH_CONDITIONS");
});

test("resolves Real Estate's labeled 'Decision: BUY.' line", () => {
  const resolved = resolveCanonicalDecisionFromReportText(
    "Overall Investment Score: 78/100. Recommendation: BUY. Confidence: 80/100.\nDecision: BUY."
  );
  assert.equal(resolved.decision, "PROCEED");
});

test("resolves the shared executive-decision-brief 'Decision: TOKEN' line for GO / CONDITIONAL GO / NO-GO", () => {
  assert.equal(
    resolveCanonicalDecisionFromReportText("Decision: GO (Confidence: 82%)").decision,
    "PROCEED"
  );
  assert.equal(
    resolveCanonicalDecisionFromReportText("Decision: CONDITIONAL GO (Confidence: 61%)").decision,
    "PROCEED_WITH_CONDITIONS"
  );
  assert.equal(
    resolveCanonicalDecisionFromReportText("Decision: NO-GO (Confidence: 28%)").decision,
    "REJECT"
  );
});

test("resolves a Turkish-language report's 'Karar: EVET' line and preserves the detected language", () => {
  const resolved = resolveCanonicalDecisionFromReportText("Karar: EVET (Güven: 82%)");
  assert.equal(resolved.decision, "PROCEED");
  assert.equal(resolved.language, "Turkish");
  assert.equal(getCanonicalDecisionLabel(resolved.decision, resolved.language), "Devam Et");
});

test("falls back to investment-score.ts's raw recommendation only when no text signal is present", () => {
  assert.equal(resolveCanonicalDecisionFromReportText("No decision-shaped text here.", "WAIT").decision, "PAUSE_PENDING_REVIEW");
  assert.equal(resolveCanonicalDecisionFromReportText("No decision-shaped text here."), null);
});

test("returns null when nothing recognizable is present at all (no crash, no fabricated decision)", () => {
  assert.equal(resolveCanonicalDecisionFromReportText("Just some ordinary prose about the market."), null);
});

test("Acquisition's own phrase takes priority over a co-present shared-banner token, since it is the more granular source", () => {
  // Acquisition reports can carry both the shared banner AND their own
  // Final Investment Recommendation phrase; the phrase distinguishes
  // Pause-Pending-Review from Reject where the 3-tier banner cannot.
  const resolved = resolveCanonicalDecisionFromReportText(
    "Decision: CONDITIONAL GO (Confidence: 55%)\n...\nFinal Investment Recommendation\nPause Pending Review. Regulatory clearance is unresolved."
  );
  assert.equal(resolved.decision, "PAUSE_PENDING_REVIEW");
});

// --- 4. Requirement 4: same decision label renders consistently across ----
// --- every report kind's own, different raw vocabulary --------------------

test("an unconditional 'go' decision renders the identical label whether it came from Business Plan's raw GO, the shared banner's 'Decision: GO', Real Estate's 'Decision: BUY.', or decision-intelligence's 'Proceed'", () => {
  const businessPlanRaw = resolveCanonicalDecisionFromReportText("No labeled decision in body text.", "GO");
  const sharedBanner = resolveCanonicalDecisionFromReportText("Decision: GO (Confidence: 88%)");
  const realEstate = resolveCanonicalDecisionFromReportText("Recommendation: BUY. Decision: BUY.");
  const decisionIntelligence = mapDecisionIntelligenceRecommendationToCanonicalDecision("Proceed");

  const labels = new Set([
    getCanonicalDecisionLabel(businessPlanRaw.decision),
    getCanonicalDecisionLabel(sharedBanner.decision),
    getCanonicalDecisionLabel(realEstate.decision),
    getCanonicalDecisionLabel(decisionIntelligence),
  ]);
  assert.equal(labels.size, 1, "all four report kinds must render the exact same label for the same decision");
  assert.deepEqual([...labels], ["Proceed"]);
});

test("a conditional-go decision renders the identical label whether it came from the shared banner's 'CONDITIONAL GO' or Acquisition's own 'Proceed with Conditions' phrase", () => {
  const sharedBanner = resolveCanonicalDecisionFromReportText("Decision: CONDITIONAL GO (Confidence: 60%)");
  const acquisition = resolveCanonicalDecisionFromReportText("Proceed with Conditions. Customer concentration needs review.");

  assert.equal(
    getCanonicalDecisionLabel(sharedBanner.decision),
    getCanonicalDecisionLabel(acquisition.decision)
  );
  assert.equal(getCanonicalDecisionLabel(sharedBanner.decision), "Proceed with Conditions");
});

test("a reject decision renders the identical label whether it came from Business Plan's raw PASS, the shared banner's 'NO-GO', Acquisition's own 'Reject' phrase, or Real Estate's 'Decision: AVOID.'", () => {
  const businessPlanRaw = resolveCanonicalDecisionFromReportText("No labeled decision in body text.", "PASS");
  const sharedBanner = resolveCanonicalDecisionFromReportText("Decision: NO-GO (Confidence: 22%)");
  const acquisition = resolveCanonicalDecisionFromReportText("Reject. Customer concentration risk is unacceptable.");
  const realEstate = resolveCanonicalDecisionFromReportText("Decision: AVOID.");

  const labels = new Set([
    getCanonicalDecisionLabel(businessPlanRaw.decision),
    getCanonicalDecisionLabel(sharedBanner.decision),
    getCanonicalDecisionLabel(acquisition.decision),
    getCanonicalDecisionLabel(realEstate.decision),
  ]);
  assert.equal(labels.size, 1);
  assert.deepEqual([...labels], ["Reject"]);
});

// --- 5. Integration: the three live-UI surfaces are wired to the module ---

// NOTE: superseded by the "Market Intelligence executive language
// polish" ticket -- passing report.investmentScore?.recommendation
// unconditionally was itself flagged as a bug (Market Intelligence has
// no business-viability score of its own; that field is investment-
// score.ts's generic founder-viability GO/WAIT/PASS, wrong for MI) and
// is now gated to skip Market Intelligence reports. See
// tests/market-intelligence-executive-language-polish-fix.test.mjs for
// the full, current assertion.
test("app/dashboard/page.tsx's reports-list decision signal resolves through the centralized vocabulary before any legacy fallback", () => {
  assert.match(
    dashboardListSource,
    /resolveCanonicalDecisionFromReportText\(\s*content,\s*report\.type === "Market Analysis" \? undefined : report\.investmentScore\?\.recommendation\s*\)/
  );
  assert.match(dashboardListSource, /getCanonicalDecisionLabel\(resolved\.decision, resolved\.language\)/);
});

test("app/dashboard/[id]/page.tsx's Decision KPI card and Decision Signal card both resolve through the centralized vocabulary", () => {
  assert.match(dashboardReportSource, /resolveCanonicalDecisionFromReportText\(/);
  assert.match(dashboardReportSource, /getCanonicalDecisionLabel\(/);
  // The old, now-superseded direct extractExecutiveDecisionFromText call
  // sites are gone -- resolution now flows through one shared resolver.
  assert.doesNotMatch(dashboardReportSource, /extractExecutiveDecisionFromText/);
});

// NOTE: superseded by the "Market Intelligence executive language
// polish" ticket -- see the equivalent note above for
// app/dashboard/page.tsx; the same gating was applied here.
test("components/Planner.tsx's live Decision KPI card resolves through the centralized vocabulary (its two other extractExecutiveDecisionFromText call sites -- the decision segmented control and the PDF drawing code -- are untouched)", () => {
  // CRITICAL FIX -- superseded by a later ticket ("Fix the canonical
  // decision consistency bug"): Market Intelligence now resolves through
  // resolveMarketIntelligenceExecutiveDecision instead of
  // resolveCanonicalDecisionFromReportText's own detectRecommendation
  // fallback -- see market-intelligence-decision-confidence-sync.test.mjs
  // for that fix's own dedicated coverage. Business Plan/Acquisition/Real
  // Estate still resolve through resolveCanonicalDecisionFromReportText
  // exactly as before.
  assert.match(
    plannerSource,
    /resolveCanonicalDecisionFromReportText\(section\.content, investmentScore\?\.recommendation\)/
  );
  assert.match(plannerSource, /getCanonicalDecisionLabel\(resolvedDecision\.decision, evidenceLocale\)/);
  // Untouched sites: still present, still using the original extractor.
  const remainingCallSites = plannerSource.match(/extractExecutiveDecisionFromText\(/g) || [];
  assert.equal(remainingCallSites.length, 2, "the decision segmented-control and PDF-drawing call sites must be untouched");
});

test("getDecisionClasses in both dashboard files and Planner.tsx still colors the canonical labels correctly (green/amber/red), not just the old raw words", () => {
  for (const source of [dashboardReportSource, plannerSource]) {
    const fnMatch = /function getDecisionClasses\([\s\S]*?\n}/.exec(source);
    assert.ok(fnMatch, "getDecisionClasses not found");
    const body = fnMatch[0];
    assert.match(body, /"PROCEED"|"Proceed"/);
    assert.match(body, /"REJECT"|"Reject"/);
    assert.match(body, /PAUSE_PENDING_REVIEW|"Pause Pending Review"/);
  }
});

// --- 6. Do not change: report generation, financial calculations, --------
// --- routing, PDF layout ---------------------------------------------------

// CRITICAL FIX -- superseded by a later ticket ("Fix the remaining
// canonical-data consistency and PDF export defects"): PDF layout was
// deliberately NOT untouched there -- a live-confirmed defect (PDF cover
// showing "GO" while the PDF Executive Summary card showed a blank "—"
// and the web report showed a third, different decision, all for the
// same report) traced directly to the PDF cover/card NOT using this
// canonical resolver, unlike the web dashboard. ReportPdfButton.tsx now
// deliberately imports resolveCanonicalDecisionFromReportText/
// getCanonicalDecisionLabel from this module for its cover badge and
// Executive Summary card, matching the web's own ExecutiveSummaryVisual
// -- see tests/market-intelligence-decision-confidence-sync.test.mjs for
// that fix's own dedicated coverage.
test("ReportPdfButton.tsx (PDF layout) now deliberately imports the canonical decision vocabulary for its cover badge and Executive Summary card (see market-intelligence-decision-confidence-sync.test.mjs)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  // TASK #24 -- ReportPdfButton.tsx's last remaining bare
  // resolveMarketIntelligenceExecutiveDecision call site (the Strategic
  // Recommendations badge) was upgraded to
  // resolveMarketIntelligenceExecutiveDecisionWithCanonicalState, so it no
  // longer imports anything directly from executive-decision-vocabulary --
  // the canonical-state module is now the sole decision-resolution entry
  // point for this file, and it internally still calls
  // resolveMarketIntelligenceExecutiveDecision from that same vocabulary
  // module for every report without a persisted canonical state.
  assert.doesNotMatch(pdfSource, /from "@\/app\/lib\/report-engine\/executive-decision-vocabulary"/);
  assert.match(pdfSource, /from "@\/app\/lib\/report-engine\/market-intelligence-canonical-state"/);
  const canonicalStateModuleSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-canonical-state.ts", import.meta.url),
    "utf8"
  );
  assert.match(canonicalStateModuleSource, /from "@\/app\/lib\/report-engine\/executive-decision-vocabulary"/);
});

test("report generation prompts, financial calculations, and domain routing are untouched (drift check)", async () => {
  const acquisitionPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    acquisitionPromptSource,
    /Proceed with Conditions, Pause Pending Review, or Reject/,
    "Acquisition's own prompt instruction (report-specific reasoning) must be unchanged"
  );

  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);

  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain("I want to acquire a cybersecurity SaaS company."), "acquisition");
});

test("investment-score.ts's underlying recommendation logic and executive-decision-brief.ts's own type are untouched (only additively consumed)", () => {
  const investmentScoreSource = readFileSync(
    new URL("../app/lib/ai/investment-score.ts", import.meta.url),
    "utf8"
  );
  assert.match(investmentScoreSource, /recommendation:\s*"GO"\s*\|\s*"WAIT"\s*\|\s*"PASS"/);

  const briefSource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-brief.ts", import.meta.url),
    "utf8"
  );
  assert.match(briefSource, /export type ExecutiveDecisionCode = "GO" \| "CONDITIONAL_GO" \| "NO_GO"/);
});
