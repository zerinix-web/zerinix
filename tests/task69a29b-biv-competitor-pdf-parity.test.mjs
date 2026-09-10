// TASK #69A-29B -- Make BIV Competitor Landscape web/PDF parity
// structurally authoritative.
//
// ROOT CAUSE (traced by a dedicated Explore pass, then independently
// confirmed by direct reading, not assumed): the canonical structured
// pipeline (businessCompetitorLandscapeState -> resolveCompetitorRowsForPdf
// / resolveCompetitorRowsForDownloadPdf -> formatCompetitorWeaknessForDisplay)
// was ALREADY correct in both ReportPdfButton.tsx and Planner.tsx --
// #69A-29/#69A-29A's own fixes work exactly as intended. The bug is a
// SEPARATE, older gap: both files' own `pdfCompleteVisualFields` set
// (which suppresses a section's raw free-prose body text once its
// structured visual widget already presents that section completely)
// carried "competitiveLandscape" -- Market Analysis's own field name --
// but never "competitorLandscape" (Business Idea Validation/Business
// Plan's own field name) or "competitorAnalysis", even though page.tsx's
// own equivalent web-side set (cardFirstReportFields) has carried all
// three since TASK #69A-13. With "competitorLandscape" missing, BOTH
// PDF exporters kept drawing the raw, independently-generated
// competitorLandscape free-prose string (written in its own prompt's
// labeled-line format, e.g. "COMPETITOR: Float | ... | WEAKNESSES: Not
// available | ...") a SECOND time directly below the correct,
// structured table -- contradicting it whenever the two independently-
// generated texts disagreed, exactly the reported symptom (Float's
// literal "WEAKNESSES: Not available", Jirav's weakness/threat not
// matching web).
//
// FIX: added "competitorLandscape" (and "competitorAnalysis", for full
// parity with page.tsx's own set) to pdfCompleteVisualFields in BOTH
// ReportPdfButton.tsx and Planner.tsx -- no prose parsing, no
// competitor-name hardcoding, no manual web/PDF synchronization of
// VALUES (only of which FIELD NAMES suppress their own raw-prose
// duplicate, the same mechanism every other structured-visual field
// already uses).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  formatCompetitorWeaknessForDisplay,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfButtonPath = join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx");
const plannerPath = join(repoRoot, "components/Planner.tsx");
const pagePath = join(repoRoot, "app/dashboard/[id]/page.tsx");

const pdfButtonSource = readFileSync(pdfButtonPath, "utf8");
const plannerSource = readFileSync(plannerPath, "utf8");
const pageSource = readFileSync(pagePath, "utf8");

function extractSetLiteral(source, constName) {
  const match = new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source);
  assert.ok(match, `${constName} not found`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

// --- 1/2: the actual fix -- both PDF exporters' own duplicate- --------
// --- suppression set now includes BIV's real field names ---------------

test("[1] ReportPdfButton.tsx's pdfCompleteVisualFields now includes 'competitorLandscape' (BIV's own field name) and 'competitorAnalysis' -- not only Market Analysis's 'competitiveLandscape'", () => {
  const fields = extractSetLiteral(pdfButtonSource, "pdfCompleteVisualFields");
  assert.ok(fields.includes("competitorLandscape"), `expected 'competitorLandscape' in ${JSON.stringify(fields)}`);
  assert.ok(fields.includes("competitorAnalysis"), `expected 'competitorAnalysis' in ${JSON.stringify(fields)}`);
  assert.ok(fields.includes("competitiveLandscape"), "Market Analysis's own field must remain, untouched");
});

test("[2] Planner.tsx's own, independent PDF export carries the identical fix -- same field names added to its own pdfCompleteVisualFields set", () => {
  const fields = extractSetLiteral(plannerSource, "pdfCompleteVisualFields");
  assert.ok(fields.includes("competitorLandscape"), `expected 'competitorLandscape' in ${JSON.stringify(fields)}`);
  assert.ok(fields.includes("competitorAnalysis"), `expected 'competitorAnalysis' in ${JSON.stringify(fields)}`);
  assert.ok(fields.includes("competitiveLandscape"), "Market Analysis's own field must remain, untouched");
});

// --- 3: structural parity between web and BOTH PDF exporters, going ----
// --- forward -- not just for today's specific field names --------------

test("[3] web's cardFirstReportFields and BOTH PDF exporters' pdfCompleteVisualFields agree on every BIV/Business-Plan competitor field name -- no renderer can drift back into drawing a stale duplicate for one of them", () => {
  const webFields = new Set(extractSetLiteral(pageSource, "cardFirstReportFields"));
  const pdfButtonFields = new Set(extractSetLiteral(pdfButtonSource, "pdfCompleteVisualFields"));
  const plannerFields = new Set(extractSetLiteral(plannerSource, "pdfCompleteVisualFields"));

  for (const field of ["competitorLandscape", "competitorAnalysis", "competitiveLandscape"]) {
    assert.ok(webFields.has(field), `web (cardFirstReportFields) is missing '${field}'`);
    assert.ok(pdfButtonFields.has(field), `ReportPdfButton.tsx (pdfCompleteVisualFields) is missing '${field}'`);
    assert.ok(plannerFields.has(field), `Planner.tsx (pdfCompleteVisualFields) is missing '${field}'`);
  }
});

// --- 4: the suppression MECHANISM itself is unchanged and still gates --
// --- on the fixed set --------------------------------------------------

test("[4] ReportPdfButton.tsx's raw section body text is still suppressed to '' precisely when pdfCompleteVisualFields.has(section.field) is true -- the fix only changed set MEMBERSHIP, never the suppression wiring itself", () => {
  assert.match(
    pdfButtonSource,
    /const isPdfCompleteVisualSection = pdfCompleteVisualFields\.has\(section\.field \?\? ""\) \|\| isTamSamSomPdfSection;/
  );
  assert.match(
    pdfButtonSource,
    /const rawSectionBodyContent = stripReportPresentationArtifacts\(\s*\n\s*isPdfCompleteVisualSection\s*\n\s*\? ""/
  );
});

test("[4b] Planner.tsx's own formatPdfReadableContent is still gated the same way", () => {
  assert.match(
    plannerSource,
    /pdfCompleteVisualFields\.has\(section\.field \?\? ""\) \|\|\s*\n\s*section\.field === "tamSamSom"/
  );
});

// --- 5: the ONE canonical builder/formatter functions feed EVERY -------
// --- renderer -- verified/directional/unavailable semantics preserved --

test("[5] ReportPdfButton.tsx's resolveCompetitorRowsForPdf and Planner.tsx's resolveCompetitorRowsForDownloadPdf both call the SAME canonical formatCompetitorWeaknessForDisplay -- never an independent re-derivation of weakness text for PDF", () => {
  assert.match(pdfButtonSource, /weaknesses: formatCompetitorWeaknessForDisplay\(entity\)/);
  assert.match(plannerSource, /weaknesses: formatCompetitorWeaknessForDisplay\(entity\)/);
  // Both files must import it from the one canonical module, never
  // redefine it locally.
  assert.match(pdfButtonSource, /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s);
  assert.match(plannerSource, /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s);
  assert.doesNotMatch(pdfButtonSource, /function formatCompetitorWeaknessForDisplay/);
  assert.doesNotMatch(plannerSource, /function formatCompetitorWeaknessForDisplay/);
});

test("[5b] verified/directional/unavailable weakness semantics survive the canonical formatter unchanged (end-to-end proof using the real builder function, since suppressing the raw-prose duplicate changes nothing about how the structured table's OWN values are computed)", () => {
  const responses = [
    { company: "Alpha Ledger", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: "an independent review documents a specific, named limitation", weaknessBasis: "verified", threat: "Medium" },
    { company: "Beta Books", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: "narrower target segment than comparable alternatives", weaknessBasis: "directional", threat: "Low" },
    { company: "Gamma Flow", type: "Substitute", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(responses);
  const byCompany = Object.fromEntries(state.competitors.map((c) => [c.company, c]));

  const verifiedDisplay = formatCompetitorWeaknessForDisplay(byCompany["Alpha Ledger"]);
  const directionalDisplay = formatCompetitorWeaknessForDisplay(byCompany["Beta Books"]);
  const unavailableDisplay = formatCompetitorWeaknessForDisplay(byCompany["Gamma Flow"]);

  // TASK #69A-40 -- the qualifier is now capitalized "(Directional)" and
  // the unavailable case renders the explicit "Not available" rather than
  // the ambiguous bare "—" sentinel.
  assert.doesNotMatch(verifiedDisplay, /\(Directional\)$/, "a verified weakness must never carry the directional qualifier");
  assert.match(directionalDisplay, /\(Directional\)$/, "a directional weakness must always carry the qualifier -- never silently promoted to verified-looking text");
  assert.equal(unavailableDisplay, "Not available", "genuinely unavailable evidence must render the honest unavailable marker, never fabricated text");

  // Same record, called twice (simulating web's own call and PDF's own
  // call against the identical canonical object) -- must be byte-identical.
  assert.equal(formatCompetitorWeaknessForDisplay(byCompany["Beta Books"]), directionalDisplay);
});

// --- 6: decision-safety -- this fix touches ONLY PDF/web presentation --
// --- wiring, never the decision engine, confidence, or Porter's Five ---
// --- Forces --------------------------------------------------------------

test("[6] no decision-engine, confidence, Founder-Readiness, or Porter's Five Forces file carries a #69A-29B marker -- this is a presentation-only fix", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/market-research-coverage.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-29B/, `${relativePath} should not carry a #69A-29B marker`);
  }
});

test("[6b] admin PDF export entitlement is untouched by this fix", () => {
  const routeSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
  const accessSource = readFileSync(join(repoRoot, "app/lib/strategic-report-access.ts"), "utf8");
  assert.doesNotMatch(routeSource, /#69A-29B/);
  assert.doesNotMatch(accessSource, /#69A-29B/);
});

test("[6c] the fix's own diff surface is confined to pdfCompleteVisualFields' set literal in exactly the two PDF-exporter files -- no change to resolveCompetitorRowsForPdf/resolveCompetitorRowsForDownloadPdf's own extraction logic, which #69A-29/#69A-29A already proved correct", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /#69A-29B/);
  }
  // The extraction functions themselves are untouched -- still exactly
  // the same structured-state-first, prose-fallback shape #69A-29
  // established.
  assert.match(pdfButtonSource, /function resolveCompetitorRowsForPdf\(report: DashboardReport, content: string\) \{\s*\n\s*const structuredState = readBusinessCompetitorLandscapeState\(report\.metadata\);/);
});
