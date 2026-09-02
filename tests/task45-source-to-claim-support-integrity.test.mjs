import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// TASK #45 -- Make Market Intelligence source-to-claim support
// structurally authoritative.
//
// This is a full-pipeline audit ticket: ensure the system never treats
// "a citation/source exists" as proof that the source actually SUPPORTS
// the specific claim being presented. Per the ticket's own instruction
// ("do not create duplicate competing evidence models if an existing
// canonical evidence structure can be extended safely"), this reuses
// the existing EvidenceLevel hierarchy (app/lib/report-evidence.ts:
// verified > derived > benchmarkDerived > planningAssumption >
// validationRequired, already the single canonical model every numeric
// and evidence badge across web and PDF reads from) rather than
// introducing a second, parallel SUPPORTED/PARTIALLY_SUPPORTED/
// UNSUPPORTED taxonomy -- benchmarkDerived is the existing tier that
// already means "some support exists, but not independent
// verification," the closest safe analog to "partially supported."
//
// AUDIT FINDING (confirmed, and the one genuine defect fixed by this
// ticket): page.tsx and Planner.tsx's web Competitive Landscape table
// already states, in text, that "Vendor Confidence reflects... a
// company's existence and market relevance... it does not verify the
// category, position, strengths, or weaknesses text next to it" (Task
// #32's own fix, addressing this exact ticket's requirement 5). The
// PDF's identical full 7-column table (ReportPdfButton.tsx) only ever
// renamed the column label to match ("Vendor Confidence" instead of
// "Validation") but never carried the scoping CAPTION itself over --
// so a PDF-only reader had no textual signal that citation-backed
// vendor existence does not verify every other attribute in the same
// row. This is a real web/PDF PARITY gap (requirement 8) and a real
// instance of the exact "citation exists = claim verified" risk this
// ticket exists to close. FIX: the identical scoping caption (adapted
// for PDF space) now draws above the PDF's full competitor table too,
// with the card's own reserved height (both the drawing function and
// its matching pagination-budget function) grown to fit it -- the
// sparse/compact competitor states already carried equivalent scoping
// language of their own (adjacentPlayersOnlyIntro/
// sparseCompetitorTableIntro), so only the full-table header band
// needed this addition.
//
// AUDIT CONFIRMATION (no defect found, verified structurally): the
// canonical inferEvidenceLevel classifier (which deriveMarketSizeMetricEvidenceLevel,
// and therefore every Market Size/CAGR/TAM/SAM/SOM evidence badge,
// routes through) was directly tested against realistic content
// containing a bare citation marker with NO accompanying "verified"
// language -- in every case it correctly resolves to "benchmarkDerived"
// (moderate confidence), never "verified". The presence of a citation
// tag alone, with no explicit verification language, structurally
// cannot promote a claim to the "verified" tier in this codebase today.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

// --- A) Citation exists but does not support the actual claim --------

test("TASK #45 (A): a bare citation marker with NO accompanying verification language never promotes a claim to 'verified' -- confirmed against the real, shared classifier", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");

  const citedOnly = inferEvidenceLevel({ label: "Market Size", value: "$1.5B", context: "Market Size: $1.5B [R12]." });
  assert.notEqual(citedOnly, "verified");

  const unrelatedCitation = inferEvidenceLevel({
    label: "Market Share",
    value: "35%",
    context: "Vendor X offers AI contract review [R12].",
  });
  assert.notEqual(unrelatedCitation, "verified", "a citation about product capability must never verify an unrelated market-share claim");
});

// --- B) Partial support on a compound claim -> conservative tier -----

test("TASK #45 (B): a value with evidence text supporting only PART of what it claims resolves to the conservative benchmarkDerived tier, never 'verified' -- reusing the existing EvidenceLevel hierarchy rather than a new taxonomy", async () => {
  const { inferEvidenceLevel } = await import("../app/lib/report-evidence.ts");
  // The source only establishes the company has 5,000 customers; the
  // claim goes further ("dominates the mid-market segment") -- the
  // customer count does not verify the broader positioning conclusion.
  const level = inferEvidenceLevel({
    label: "Market Position",
    value: "Dominates mid-market",
    context: "Company has 5,000 customers.",
  });
  assert.notEqual(level, "verified");
});

// --- C) Direct numeric source support -> remains supported ------------

test("TASK #45 (C): a value with an evidence line naming a real, specific verification signal for THAT value remains 'verified'", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "Market Size",
    "$1.5B",
    "Market Size: $1.5B, verified against the vendor's own audited 2024 annual filing."
  );
  assert.equal(level, "verified");
});

// --- D) Derived numeric value -> remains derived, not verified --------

test("TASK #45 (D): SAM = TAM x disclosed obtainable-share assumption remains classified 'derived', never indistinguishable from an independently verified figure", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "SAM",
    "$375M",
    "SAM: $375M, derived from the verified TAM figure using a disclosed 25% obtainable-share assumption."
  );
  assert.equal(level, "derived");
  assert.notEqual(level, "verified");
});

// --- E) Planning assumption with a citation nearby --------------------

test("TASK #45 (E): a figure explicitly tagged [Estimated]/Planning Estimate is never promoted to 'verified' merely because a citation marker sits nearby in the same sentence", async () => {
  const { deriveMarketSizeMetricEvidenceLevel } = await import("../app/lib/report-presentation.ts");
  const level = deriveMarketSizeMetricEvidenceLevel(
    "TAM",
    "$1.5B",
    "TAM: $1.5B [Estimated], see [R12] for the benchmark methodology used."
  );
  assert.notEqual(level, "verified");
});

// --- F) Competitor existence evidence does not verify other attributes ---

test("TASK #45 (F): the Competitive Landscape table's own scoping caption -- 'Vendor Confidence... does not verify category/position/strengths/weaknesses' -- exists in BOTH web render sites (page.tsx, Planner.tsx) and the PDF renderer, so citation-backed vendor existence can never be silently read as verifying every other attribute in the same row", () => {
  assert.match(pageSource, /does not verify the category, position, strengths, or/, "page.tsx: expected the Task #32 scoping caption");
  assert.match(plannerSource, /does not verify the category, position, strengths, or/, "Planner.tsx: expected the Task #32 scoping caption");
  assert.match(
    pdfButtonSource,
    /Vendor Confidence reflects existence and market relevance only -- not category, position, strengths, or weaknesses\./,
    "ReportPdfButton.tsx: expected the Task #45 PDF-carried scoping caption"
  );
  // Planner.tsx has its OWN, separate PDF drawer (downloadPdf) mirroring
  // ReportPdfButton.tsx's competitor table -- confirmed to have the
  // identical gap (only the column label was renamed by Task #32, the
  // caption itself was never carried over), fixed identically here.
  assert.match(
    plannerSource,
    /Vendor Confidence reflects existence and market relevance only -- not category, position, strengths, or weaknesses\./,
    "Planner.tsx's own PDF drawer: expected the Task #45 PDF-carried scoping caption"
  );
});

test("TASK #45 (F): the PDF caption is drawn INTO the full competitor table's own reserved card space (not floating text that could overlap the header row) -- both PDF renderers' drawing function and matching pagination-budget function grow the card by the same amount", () => {
  assert.match(pdfButtonSource, /const miHeaderHeight = 12;/, "ReportPdfButton.tsx: expected the wider MI-specific header height constant");
  assert.match(plannerSource, /const miCompetitorHeaderHeight = 12;/, "Planner.tsx: expected the wider MI-specific header height constant");
  // The generic (Business Plan/Acquisition) competitor table's own
  // header heights (8) must remain completely untouched in both files
  // -- this ticket is Market-Intelligence-scoped only.
  assert.match(pdfButtonSource, /const headerHeight = 8;/, "ReportPdfButton.tsx: the original, unrelated headerHeight constant must be unchanged");
  assert.match(plannerSource, /const competitorHeaderHeight = 8;/, "Planner.tsx: the original, unrelated competitorHeaderHeight constant must be unchanged");
  assert.match(
    pdfButtonSource,
    /return \(rows\.length === 0 \? 8 : 12\) \+ Math\.max\(1, rows\.length\) \* 15 \+ 4 \+ 8 \+ 50;/,
    "ReportPdfButton.tsx: expected getVisualHeight's budget to distinguish the empty state (8) from the real full-table state (12)"
  );
  assert.match(
    plannerSource,
    /return \(rows\.length === 0 \? competitorHeaderHeight : miCompetitorHeaderHeight\) \+ Math\.max\(1, rows\.length\) \* competitorRowHeight \+ 4 \+ 8 \+ 50;/,
    "Planner.tsx: expected getPdfVisualHeight's budget to distinguish the empty state from the real full-table state"
  );
});

// --- G) Executive Summary cannot upgrade unsupported evidence ---------

test("TASK #45 (G): Executive Summary's confidence/decision-change state is read from the SAME canonical resolveMarketIntelligenceConfidenceState/resolveMarketIntelligenceDecisionChangeState pipeline as every other surface -- it has no independent code path that could re-derive a more confident classification from raw prose", async () => {
  const evidenceGapsSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-evidence-gaps.ts", import.meta.url),
    "utf8"
  );
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceConfidenceState\(/);
  assert.match(evidenceGapsSource, /export function resolveMarketIntelligenceDecisionChangeState\(/);

  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.match(source, /resolveMarketIntelligenceConfidenceState/, `${name}: Executive Summary must read the canonical confidence state`);
  }
});

// --- H) Web and PDF preserve identical support meaning -----------------

test("TASK #45 (H): Market Size/CAGR/TAM-SAM-SOM evidence classification remains read from the SAME shared, exported report-presentation.ts functions by every render site (unchanged by this ticket, reconfirmed)", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(source, /deriveMarketSizeMetricEvidenceLevel/, `${name}: expected the canonical, shared evidence-level function`);
  }
});

// --- I) Canonical decision unchanged -----------------------------------

test("TASK #45 (I): assessMarketEntryConfidence's blended-decision thresholds and evidence-gap cap are structurally unchanged -- this ticket only adds a presentation-layer scoping caption and confirms existing classification behavior, it does not touch decision or confidence computation", async () => {
  const marketIntelligencePresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketIntelligencePresentationSource, /export function assessMarketEntryConfidence\(/);
  assert.match(marketIntelligencePresentationSource, /marketConfidence\s*\*\s*0\.4/);
  assert.match(marketIntelligencePresentationSource, /competitiveEvidence\s*\*\s*0\.25/);
  assert.match(marketIntelligencePresentationSource, /financialEvidence\s*\*\s*0\.2/);
  assert.match(marketIntelligencePresentationSource, /productEvidence\s*\*\s*0\.15/);
});

// --- DRIFT CHECK: Tasks #30-#44 protections not weakened --------------

test("DRIFT CHECK: Task #44's negatedVerifiedPattern and Task #43B's recommendationFieldBoundaryPattern remain in place, untouched by this ticket", async () => {
  const reportEvidenceSource = readFileSync(new URL("../app/lib/report-evidence.ts", import.meta.url), "utf8");
  assert.match(reportEvidenceSource, /const negatedVerifiedPattern =/);

  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  assert.match(reportPresentationSource, /const recommendationFieldBoundaryPattern = /);
});

test("DRIFT CHECK: the generic (Business Plan/Acquisition) competitor table drawing code is completely untouched by this Market-Intelligence-scoped fix", () => {
  assert.match(pdfButtonSource, /const columns = \[\s*\n\s*\{ label: localizePdfPresentationLabel\("Company", pdfLocale\)/);
  assert.match(
    pdfButtonSource,
    /pdf\.roundedRect\(bodyX, visualY, bodyWidth, headerHeight \+ Math\.max\(1, rows\.length\) \* rowHeight, 3, 3, "FD"\);/,
    "the generic table's own roundedRect call must still use the original, unmodified headerHeight"
  );
});
