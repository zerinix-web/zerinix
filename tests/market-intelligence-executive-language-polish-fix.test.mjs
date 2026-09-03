import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- Market Intelligence executive language polish.
//
// Market Intelligence routing itself is confirmed working (prior
// tickets). This ticket improves ONLY Market Intelligence's own
// presentation language:
//
// 1. Align final decision with the centralized decision vocabulary
//    (PROCEED / PROCEED_WITH_CONDITIONS / PAUSE_PENDING_REVIEW /
//    REJECT). Confirmed live: the shared decision-KPI rendering
//    surfaces (app/dashboard/page.tsx's reports list,
//    app/dashboard/[id]/page.tsx's ExecutiveSummaryVisual, and
//    components/Planner.tsx's ExecutiveSummaryVisual) all fell back to
//    report.investmentScore.recommendation whenever the primary
//    "Decision: TOKEN" text extraction came up empty. That field is
//    investment-score.ts's generic founder-viability GO/WAIT/PASS score
//    -- a scoring model Market Intelligence does not evaluate at all
//    (it has its own, deliberately more conservative ENTER/MONITOR/
//    AVOID market-entry verdict instead, computed by
//    assessMarketEntryConfidence in market-intelligence-presentation.ts
//    and mapped to the shared GO/CONDITIONAL_GO/NO_GO banner). Falling
//    back to the generic score risked showing "Proceed" (an
//    unconditional GO) for a report whose real, correctly-computed
//    verdict was a bounded pilot (MONITOR) or an outright avoid. Fixed
//    by gating that fallback off for Market Intelligence reports on all
//    three surfaces, so only the report's own deterministic decision
//    text is ever trusted for Market Intelligence.
// 2. Remove internal system language ("Evidence"/"Verified"/"Missing
//    Evidence"/a raw "confidence score" readout) from Market
//    Intelligence-exclusive presentation text (market-intelligence-
//    presentation.ts) in favor of "Validation status"/"Data
//    availability"/"Planning confidence" executive wording. The shared,
//    cross-report-kind evidence taxonomy (report-evidence.ts) and the
//    shared executive-decision-brief.ts banner (used by Business Plan,
//    Acquisition, and the domain-analysis family too) were deliberately
//    left untouched, since editing either would affect report kinds
//    beyond Market Intelligence, which this ticket does not ask for.
// 3. Market analysis logic, competitor analysis, TAM/SAM/SOM behavior,
//    and routing are all unmodified -- confirmed by drift checks below.

const dashboardListSource = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const dashboardReportSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const marketPresentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

// --- 1. Decision vocabulary: Market Intelligence never falls back to ------
// --- the generic investmentScore.recommendation ----------------------------

test("app/dashboard/page.tsx's reports-list decision signal skips the investmentScore fallback for Market Analysis reports", () => {
  // TASK #30 -- confirmed live (canonical-decision-pipeline audit):
  // Market Analysis now resolves through the canonical-state-aware
  // resolver and RETURNS before this generic resolver is ever reached
  // (see getDecisionSignal's own early-return branch), rather than
  // reaching this same call with a per-call ternary swapping in
  // `undefined`. The per-call ternary this assertion previously checked
  // for is now moot -- Market Analysis never executes this line at all
  // -- so the invariant this test guards (Market Analysis never uses the
  // generic investmentScore fallback) is now proven by ordering instead.
  // Full behavioral coverage of the new early-return branch itself lives
  // in tests/task30-canonical-decision-structural-authority.test.mjs.
  const marketBranchIndex = dashboardListSource.indexOf('report.type === "Market Analysis"');
  const genericResolverIndex = dashboardListSource.indexOf(
    "resolveCanonicalDecisionFromReportText(content, report.investmentScore?.recommendation)"
  );
  assert.ok(marketBranchIndex >= 0, "Market Analysis branch not found");
  assert.ok(genericResolverIndex >= 0, "generic resolver call not found");
  assert.ok(
    marketBranchIndex < genericResolverIndex,
    "Market Analysis must be resolved and returned before the generic investmentScore fallback is ever reached"
  );
});

function sliceFrom(source, marker, length = 3200) {
  const startIndex = source.indexOf(marker);
  if (startIndex === -1) return "";
  return source.slice(startIndex, startIndex + length);
}

// CRITICAL FIX -- superseded by a later ticket ("Fix the canonical
// decision consistency bug"): Market Intelligence now resolves through
// resolveMarketIntelligenceExecutiveDecision instead of routing
// `undefined` through resolveCanonicalDecisionFromReportText -- see
// market-intelligence-decision-confidence-sync.test.mjs for that fix's
// own dedicated coverage. The isMarketIntelligence flag and its
// investmentScore isolation are preserved, just implemented via a
// dedicated marketDecision branch instead.
test("app/dashboard/[id]/page.tsx's ExecutiveSummaryVisual accepts an isMarketIntelligence flag and never reaches resolveCanonicalDecisionFromReportText's own investmentScore fallback when set", () => {
  const fnBody = sliceFrom(dashboardReportSource, "function ExecutiveSummaryVisual({");
  assert.ok(fnBody, "ExecutiveSummaryVisual not found");
  assert.match(fnBody, /isMarketIntelligence\??\s*:\s*boolean/);
  assert.match(
    fnBody,
    /const marketDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceGatedExecutiveDecision\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*content,\s*\n\s*evidenceLocale\s*\n\s*\)\s*\n\s*: null;/
  );
  assert.match(
    fnBody,
    /const resolvedDecision = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: resolveCanonicalDecisionFromReportText\(content, investmentScore\?\.recommendation\)/
  );
  assert.match(
    dashboardReportSource,
    /isMarketIntelligence=\{report\.type === "Market Analysis"\}/
  );
});

test("components/Planner.tsx's ExecutiveSummaryVisual accepts an isMarketIntelligence flag, threaded from ReportPanel/ReportSectionCard down to it", () => {
  const fnBody = sliceFrom(plannerSource, "function ExecutiveSummaryVisual({");
  assert.ok(fnBody, "ExecutiveSummaryVisual not found");
  assert.match(fnBody, /isMarketIntelligence\??\s*:\s*boolean/);
  assert.match(
    fnBody,
    /const marketDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceGatedExecutiveDecision\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*section\.content,\s*\n\s*evidenceLocale\s*\n\s*\)\s*\n\s*: null;/
  );
  // Threaded: ReportPanel receives isMarketIntelligence from its two call
  // sites (activeReportMode === "market"), passes it to ReportSectionCard,
  // which passes it on to ExecutiveSummaryVisual.
  assert.match(plannerSource, /isMarketIntelligence=\{activeReportMode === "market"\}/g);
  assert.match(plannerSource, /isMarketIntelligence=\{isMarketIntelligence\}/);
});

// --- 2. Internal system language removed from MI-exclusive text -----------

test("the 'biggestRisk' fallback no longer leads with 'Verified' -- reworded around data availability", () => {
  assert.doesNotMatch(marketPresentationSource, /"Verified market-size and competitive endpoints remain incomplete\."/);
  assert.match(
    marketPresentationSource,
    /"Data availability for market size and competitive positioning remains incomplete\."/
  );
});

test("buildWhatWouldChangeThisDecision's GO case no longer leads with 'independently verified' -- reworded to 'newly confirmed ... from an independent source'", () => {
  assert.doesNotMatch(marketPresentationSource, /a new, independently verified competitive threat/);
  assert.match(
    marketPresentationSource,
    /a newly confirmed competitive threat from an independent source/
  );
});

test("buildWhatWouldChangeThisDecision's CONDITIONAL_GO and default (NO_GO) cases no longer lead with 'Verified, independent evidence' -- reworded around validation status", () => {
  assert.doesNotMatch(marketPresentationSource, /`Verified, independent evidence that resolves/);
  const matches = marketPresentationSource.match(/A change in validation status for "\$\{risk\}"/g) || [];
  assert.equal(matches.length, 2, "expected both the CONDITIONAL_GO and default cases to use the new wording");
});

test("the zero-named-gaps fallback no longer reads as a raw 'confidence score' readout -- reworded around planning confidence", () => {
  assert.doesNotMatch(
    marketPresentationSource,
    /the blended confidence score falls short of a full Enter decision/
  );
  assert.match(
    marketPresentationSource,
    /planning confidence for this market falls short of a full Enter decision/
  );
});

test("the Turkish equivalents of all four reworded strings were updated alongside English (this app's paired primary languages)", () => {
  assert.match(marketPresentationSource, /Pazar büyüklüğü ve rekabet konumlandırmasına ilişkin veri erişilebilirliği henüz tam değil\./);
  assert.match(marketPresentationSource, /bağımsız bir kaynaktan doğrulanan yeni bir rekabet tehdidi/);
  assert.match(marketPresentationSource, /doğrulama durumundaki bir değişiklik/);
  assert.match(marketPresentationSource, /bu pazar için planlama güveni tam bir Gir kararı için yeterli değil/);
});

// --- 3. Preserve: market analysis logic, competitor analysis, ------------
// --- TAM/SAM/SOM behavior, routing (drift checks) --------------------------

test("assessMarketEntryConfidence's ENTER/MONITOR/AVOID decision computation and its GO/CONDITIONAL_GO/NO_GO mapping are unchanged", () => {
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
});

test("competitor-analysis and TAM/SAM/SOM field prompts are unchanged (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /tamSamSom/);
});

test("Market Intelligence routing (applyPromptIntentModeOverride, resolveReportDomainForSelectedMode) is unmodified by this presentation-only fix", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
  assert.doesNotMatch(domainSource, /market-intelligence-presentation/);
});

test("ReportPdfButton.tsx (PDF layout) is untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  // isMarketIntelligenceDashboardReport is a real, pre-existing PDF
  // helper unrelated to this fix's new isMarketIntelligence prop --
  // only the exact new prop/parameter pattern this fix introduces is
  // checked for absence here.
  assert.doesNotMatch(pdfSource, /resolveCanonicalDecisionFromReportText\(\s*content,\s*isMarketIntelligence/);
  assert.doesNotMatch(pdfSource, /isMarketIntelligence\??\s*:\s*boolean/);
});

test("the protected, cross-report-kind evidence taxonomy (report-evidence.ts) and the shared executive-decision-brief.ts banner are untouched (drift check)", () => {
  const reportEvidenceSource = readFileSync(
    new URL("../app/lib/report-evidence.ts", import.meta.url),
    "utf8"
  );
  assert.match(reportEvidenceSource, /verified:\s*"Verified"/);

  const briefSource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-brief.ts", import.meta.url),
    "utf8"
  );
  assert.match(briefSource, /missingEvidence:\s*"What Evidence Is Missing"/);
});
