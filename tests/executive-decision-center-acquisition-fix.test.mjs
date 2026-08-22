import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// FINAL FIX -- upgrade Executive Decision Center output.
//
// The Executive Snapshot card (dashboard: ExecutiveSnapshotPanel, PDF:
// drawCoverPage -- both fed by buildExecutiveSnapshot in
// app/lib/report-presentation.ts) is a shared, report-type-agnostic
// heuristic that text-mines an already-rendered section for keyword
// patterns designed around the ORIGINAL Business Plan GO/WAIT/NO-GO
// framework. Acquisition Due Diligence reports (built across many prior
// turns) use their own three-tier executive call (Proceed with
// Conditions / Pause Pending Review / Reject) and their own risk/action
// vocabulary, none of which the original heuristics recognized -- so
// every acquisition report's decision card silently fell through to
// generic defaults: "WAIT" (decision), a stray unrelated percentage or
// "Needs evidence review" (confidence), "Validation Required" (financial
// quality), and Business-Plan-flavored fallback bullets for Main Risk and
// Next Action.
//
// This is presentation-only: no report generation, calculation,
// sanitization, or user-fact-extraction code was touched. Verified by
// reproducing the exact bug (buildExecutiveSnapshot's real output) using
// realistic acquisition Executive Summary text, not just source greps.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Same established pattern as tests/report-presentation-confidence-radar.test.mjs
// -- report-presentation.ts has real "@/"-aliased imports that plain
// `node --test` can't resolve directly.
async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  const sanitizationPath = join(repoRoot, "app/lib/report-output-sanitization.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(sanitizationPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-executive-decision-center-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot } = await importReportPresentation();

const acquisitionExecutiveSummary = `
Transaction overview: this acquisition is defined by a $40M purchase price, $10M in target ARR, 500 enterprise customers, and 80 employees. The transaction structure (asset purchase, stock purchase, or merger) and involved parties should be confirmed during due diligence.

Main opportunity: the target's $10M in recurring revenue across 500 enterprise customers is a base for post-close cross-sell and retention; management should validate this by reviewing the underlying customer contracts before it is treated as certain.

Main risks: integration complexity and customer concentration are the standard risk areas that should be assessed before closing. Leverage from the $15M debt requirement (37.5% of the purchase price) also needs review.

Preliminary recommendation: Pause Pending Review -- the target's financial statements and customer contracts are not yet verified; the full scale of the customer and employee base is still awaiting confirmation. This call remains preliminary until the closing conditions below are satisfied.

Conditions before closing: this preliminary assessment is based on the deal's current information. Management should review EBITDA, cash flow, customer contracts and security architecture before final approval.
`;

// --- 1. Decision card: real acquisition vocabulary, never a default WAIT --

// NOTE: superseded by the "final executive dashboard language polish" turn
// -- "Pause with Reasons" was itself renamed to "Pause Pending Review".
test("a 'Pause Pending Review' acquisition recommendation renders as PAUSE PENDING REVIEW on the decision card, never the generic WAIT default", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.equal(snapshot.decision, "PAUSE PENDING REVIEW");
  assert.notEqual(snapshot.decision, "WAIT");
});

test("a 'Proceed with Conditions' acquisition recommendation renders as PROCEED WITH CONDITIONS on the decision card", () => {
  const content = acquisitionExecutiveSummary.replace(
    "Pause Pending Review -- the target's financial statements",
    "Proceed with Conditions -- the target's financial statements"
  );
  const snapshot = buildExecutiveSnapshot(content, undefined, undefined);
  assert.equal(snapshot.decision, "PROCEED WITH CONDITIONS");
});

test("a 'Reject' acquisition recommendation renders as REJECT verbatim, not the Business Plan NO-GO token", () => {
  const content = "Executive recommendation: Reject -- the target's material adverse finding makes this deal unworkable as structured.";
  const snapshot = buildExecutiveSnapshot(content, undefined, undefined);
  assert.equal(snapshot.decision, "REJECT");
});

// --- 2. Confidence Score: reflects available/missing inputs, never a stray % -

test("confidence never picks up an unrelated percentage (e.g. the 37.5% debt share) when the report never states an actual confidence figure", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.notEqual(snapshot.confidence, "37.5%");
  assert.notEqual(snapshot.confidenceScore, 37.5);
  assert.doesNotMatch(snapshot.confidence, /^\d{1,3}%$/, "should not be a fabricated bare percentage");
});

test("confidence reflects available deal inputs when concrete figures are present, instead of the old generic 'Needs evidence review'", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.notEqual(snapshot.confidence, "Needs evidence review");
  assert.match(snapshot.confidence, /figures are available/i);
});

test("a genuinely labeled 'Decision: GO (Confidence: 72%)' line still extracts the real 72% exactly as before (no regression for Business Plan/Market Intelligence reports)", () => {
  const snapshot = buildExecutiveSnapshot(
    "Executive Recommendation\nDecision: GO (Confidence: 72%)\nThis market should be entered now given strong structural demand.",
    undefined,
    undefined
  );
  assert.equal(snapshot.confidence, "72%");
  assert.equal(snapshot.confidenceScore, 72);
});

// --- 3. Financial Quality: useful executive wording, never bare "Validation Required" -

test("financialQuality never defaults to the bare 'Validation Required' string for a report with no labeled Financial Quality line", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.notEqual(snapshot.financialQuality, "Validation Required");
  assert.match(snapshot.financialQuality, /Full Audit|Additional Financials|Financial Statements Pending/);
});

// --- 4. Main Risk: surfaces the real acquisition risk category ------------

test("mainRisk surfaces the real integration/leverage/customer-concentration risk sentence, not a generic Business-Plan-flavored fallback", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.match(snapshot.mainRisk, /integration complexity/i);
  assert.match(snapshot.mainRisk, /leverage/i);
  assert.notEqual(
    snapshot.mainRisk,
    "The main risks sit around validation, acquisition, and capital efficiency."
  );
});

// --- 5. Next Action: actionable, acquisition-specific, never generic startup advice -

test("nextAction surfaces the real, actionable due-diligence next step (reviewing EBITDA/cash flow/customer contracts/security), never the generic startup-validation fallback", () => {
  const snapshot = buildExecutiveSnapshot(acquisitionExecutiveSummary, undefined, undefined);
  assert.match(snapshot.nextAction, /review EBITDA/i);
  assert.notEqual(
    snapshot.nextAction,
    "The priority is to validate critical assumptions through small measurable tests."
  );
});

// --- 6. Remove internal reasoning language from this file's own strings ---

test("report-presentation.ts's own hardcoded strings no longer contain 'authoritative evidence', 'verified evidence', or 'Needs evidence review'", () => {
  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(presentationSource, /authoritative evidence/i);
  assert.doesNotMatch(presentationSource, /verified evidence/i);
  assert.doesNotMatch(presentationSource, /Needs evidence review/);
});

// --- 7. The word-boundary fix for collectBullets is real and general ------

test("collectBullets' keyword matching uses word boundaries, so 'action' never matches inside 'Transaction' (the exact bug that broke Next Action for every acquisition report)", () => {
  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(presentationSource, /function containsKeyword/);
  assert.match(presentationSource, /\(\?<!\[\\\\p\{L\}\\\\p\{N\}\]\)/);
});

// --- 8. Do not change calculations, report generation, sanitization, user facts -

test("acquisition-deal-facts.ts's calculation functions and the sanitizer are untouched by this presentation-only fix (drift check)", async () => {
  const { computeAcquisitionDerivedMetrics, extractAcquisitionDealFacts } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  assert.equal(typeof computeAcquisitionDerivedMetrics, "function");
  assert.equal(typeof extractAcquisitionDealFacts, "function");
  assert.equal(typeof stripReportPresentationArtifacts, "function");

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
});
