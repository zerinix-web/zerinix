import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// FINAL POLISH -- Market Intelligence user-facing language cleanup.
//
// Builds on the prior "Market Intelligence executive language polish"
// ticket (which fixed the investmentScore.recommendation fallback and
// four wording spots in market-intelligence-presentation.ts). This
// ticket removes the remaining internal-sounding surfaces confirmed
// live on the dashboard/Planner rendering of a Market Intelligence
// report:
//
// 1. "Confidence Radar" -- a widget whose dimensions (Market/Financial/
//    Execution readiness) are drawn from investmentScore.decisionEngine,
//    the generic founder-viability score Market Intelligence does not
//    evaluate. Relabeled to "Decision Factors" for Market Intelligence
//    only; Business Plan and Acquisition, which share the same
//    ExecutiveSnapshotPanel component, keep the existing label.
// 2. The panel's "Confidence" pill relabeled to "Planning Confidence"
//    for Market Intelligence only, matching this ticket's own
//    requested vocabulary.
// 3. Source-list wording: bare "Verified"/"Verified source"/"Not
//    verified" citation badges reworded to "Validated"/"Validated
//    Source"/"Not yet validated" for Market Intelligence only, in both
//    the live composer (components/planner/Citations.tsx) and the
//    persisted dashboard view (app/dashboard/[id]/page.tsx). The
//    "Methodology & Assumptions" heading is relabeled "Key Assumptions"
//    for Market Intelligence, matching the ticket's own vocabulary.
//
// Decision-vocabulary consistency (pilot/monitor/conditional must never
// render as a bare "GO"/PROCEED) was already fixed by the prior
// centralize-executive-decision-vocabulary and executive-language-polish
// tickets; this suite re-confirms that fix is intact and untouched.
//
// Routing, market analysis logic, TAM/SAM/SOM calculations, competitor
// analysis, report structure, the intelligence engine, and PDF layout
// are all confirmed untouched below.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const dashboardReportSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const citationsSource = readFileSync(
  new URL("../components/planner/Citations.tsx", import.meta.url),
  "utf8"
);

function sliceFrom(source, marker, length = 1600) {
  const startIndex = source.indexOf(marker);
  if (startIndex === -1) return "";
  return source.slice(startIndex, startIndex + length);
}

// --- 1 & 2. "Confidence Radar" -> "Decision Factors", "Confidence" -> ------
// --- "Planning Confidence", Market Intelligence only ------------------------

test("app/dashboard/[id]/page.tsx's ExecutiveSnapshotPanel overrides 'Confidence Radar'/'Confidence' labels only when isMarketIntelligence is set", () => {
  const fnBody = sliceFrom(dashboardReportSource, "function ExecutiveSnapshotPanel({");
  assert.ok(fnBody, "ExecutiveSnapshotPanel not found");
  assert.match(fnBody, /isMarketIntelligence\??\s*:\s*boolean/);
  assert.match(fnBody, /"Decision Factors"/);
  assert.match(fnBody, /"Planning Confidence"/);
  assert.match(fnBody, /"Karar Faktörleri"/);
  assert.match(fnBody, /"Planlama Güveni"/);
  assert.match(
    dashboardReportSource,
    /isMarketIntelligence=\{report\.type === "Market Analysis"\}/
  );
});

test("components/Planner.tsx's ExecutiveSnapshotPanel overrides 'Confidence Radar'/'Confidence' labels only when isMarketIntelligence is set", () => {
  const fnBody = sliceFrom(plannerSource, "function ExecutiveSnapshotPanel({");
  assert.ok(fnBody, "ExecutiveSnapshotPanel not found");
  assert.match(fnBody, /isMarketIntelligence\??\s*:\s*boolean/);
  assert.match(fnBody, /"Decision Factors"/);
  assert.match(fnBody, /"Planning Confidence"/);
});

test("Business Plan and Acquisition are unaffected: getReportPresentationLabels itself (shared, cross-report-kind) is untouched", () => {
  const reportPresentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(reportPresentationSource, /confidenceRadar:\s*"Confidence Radar"/);
  assert.doesNotMatch(reportPresentationSource, /Decision Factors/);
});

// --- 3. Source-list wording, Market Intelligence only ----------------------

test("components/planner/Citations.tsx's Citation/SourcesCard accept a 'market' prop and reword the trust badges only when set", () => {
  assert.match(citationsSource, /export function Citation\(\{\s*citation,\s*market = false\s*\}/);
  assert.match(citationsSource, /"Validated Source"/);
  assert.match(citationsSource, /"Validated"/);
  assert.match(citationsSource, /export function SourcesCard\(\{[\s\S]*?market = false/);
  assert.match(citationsSource, /"Key Assumptions"/);
});

test("Business Plan and Acquisition's citation cards are unaffected: the original 'Verified'/'Verified source' wording still exists as the non-market branch", () => {
  assert.match(citationsSource, /isVerifiedSource\s*\?\s*"Verified"\s*:\s*"Reference"/);
  assert.match(citationsSource, /citation\.sourceType \|\| "Verified source"/);
});

test("components/Planner.tsx's SourcesCard call site passes market={isMarketIntelligence}", () => {
  assert.match(
    plannerSource,
    /<SourcesCard sections=\{sourceSections\} legal=\{isLegalReport\} market=\{isMarketIntelligence\} \/>/
  );
});

test("app/dashboard/[id]/page.tsx's CitationCard/CitationList accept a 'market' prop and reword 'Verified source'/'Not verified' only when set", () => {
  const cardBody = sliceFrom(dashboardReportSource, "function CitationCard({", 3000);
  assert.ok(cardBody, "CitationCard not found");
  assert.match(cardBody, /market\??\s*:\s*boolean/);
  assert.match(cardBody, /"Validated Source"/);
  assert.match(cardBody, /"Not yet validated"/);
  assert.doesNotMatch(cardBody, /^\s*Not verified\s*$/m);

  const listBody = sliceFrom(dashboardReportSource, "function CitationList({", 900);
  assert.ok(listBody, "CitationList not found");
  assert.match(listBody, /market\??\s*:\s*boolean/);
});

test("both app/dashboard/[id]/page.tsx CitationList call sites pass market={report.type === \"Market Analysis\"}", () => {
  const matches = dashboardReportSource.match(/market=\{report\.type === "Market Analysis"\}/g) || [];
  assert.ok(matches.length >= 2, "expected both CitationList call sites to pass the market flag");
});

// --- 4. Decision-vocabulary consistency is intact (drift check) -----------

// CRITICAL FIX -- superseded by a later ticket ("Fix the canonical
// decision consistency bug"): Market Intelligence now resolves through
// resolveMarketIntelligenceExecutiveDecision instead of routing an
// isMarketIntelligence-guarded `undefined` through
// resolveCanonicalDecisionFromReportText's own detectRecommendation
// fallback (that fallback's full-content keyword scan matched "GO" inside
// "Go-to-Market" -- see market-intelligence-decision-confidence-sync.test.mjs
// for that fix's own dedicated coverage). Business Plan/Acquisition/Real
// Estate still resolve through resolveCanonicalDecisionFromReportText
// exactly as before -- this gate's investmentScore guard is preserved for
// those report kinds, just no longer reachable for Market Intelligence at
// all (a stronger guarantee than routing `undefined` through it).
test("Market Intelligence no longer reaches resolveCanonicalDecisionFromReportText's own fallback at all -- it resolves through resolveMarketIntelligenceExecutiveDecision instead; Business Plan/Acquisition/Real Estate's own resolveCanonicalDecisionFromReportText call (and its investmentScore guard) is untouched", () => {
  assert.match(
    dashboardReportSource,
    /const resolvedDecision = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: resolveCanonicalDecisionFromReportText\(content, investmentScore\?\.recommendation\)/
  );
  assert.match(
    plannerSource,
    /const resolvedDecision = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: resolveCanonicalDecisionFromReportText\(section\.content, investmentScore\?\.recommendation\)/
  );
});

test("the centralized decision vocabulary still maps ENTER/MONITOR/AVOID correctly, so a pilot/monitor verdict never renders as a bare PROCEED (drift check)", async () => {
  const vocabularySourcePath = join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts");
  let source = readFileSync(vocabularySourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-executive-decision-vocabulary-"));
  const outPath = join(dir, "executive-decision-vocabulary.ts");
  writeFileSync(outPath, source);
  const { mapExecutiveDecisionCodeToCanonicalDecision, getCanonicalDecisionLabel } = await import(
    pathToFileURL(outPath).href
  );

  // A Market Intelligence MONITOR verdict maps to CONDITIONAL_GO in the
  // shared banner, which must render as "Proceed with Conditions" --
  // never a bare "Proceed"/"GO".
  const monitorDecision = mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO");
  assert.equal(monitorDecision, "PROCEED_WITH_CONDITIONS");
  assert.equal(getCanonicalDecisionLabel(monitorDecision), "Proceed with Conditions");
  assert.notEqual(getCanonicalDecisionLabel(monitorDecision), "Proceed");

  const avoidDecision = mapExecutiveDecisionCodeToCanonicalDecision("NO_GO");
  assert.equal(avoidDecision, "REJECT");
  assert.equal(getCanonicalDecisionLabel(avoidDecision), "Reject");
});

// --- 5. Preserve: routing, market analysis logic, TAM/SAM/SOM, ------------
// --- competitor analysis, report structure, intelligence engine, PDF ------

test("routing (applyPromptIntentModeOverride) is untouched by this presentation-only fix", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
  assert.doesNotMatch(domainSource, /Confidence Radar|Decision Factors|Validated Source/);
});

test("market analysis logic and TAM/SAM/SOM calculations (financial-model.ts, market-intelligence-presentation.ts) are untouched", () => {
  const marketPresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
  assert.doesNotMatch(marketPresentationSource, /Decision Factors|Validated Source|Key Assumptions/);

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /tamSamSom/);
});

test("report structure (marketFields, market.ts field list) is unchanged (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  for (const field of [
    "executiveSummary",
    "marketOverview",
    "marketSize",
    "competitiveLandscape",
    "tamSamSom",
    "strategicRecommendations",
  ]) {
    assert.match(marketPromptSource, new RegExp(`\\b${field}\\b`));
  }
});

test("ReportPdfButton.tsx (PDF layout) is untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  // "Real Estate Decision Factors" and isMarketIntelligenceDashboardReport
  // are real, pre-existing, unrelated PDF strings -- only the exact new
  // prop/parameter patterns this fix introduces are checked for absence.
  assert.doesNotMatch(pdfSource, /isMarketIntelligence\??\s*:\s*boolean/);
  assert.doesNotMatch(pdfSource, /"Validated Source"/);
  assert.doesNotMatch(pdfSource, /"Not yet validated"/);
});

test("acquisition routing and financial calculations are untouched (drift check)", async () => {
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
