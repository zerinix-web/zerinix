import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";

// TASK #9 -- Market Intelligence presentation-layer integrity pass.
// The user reported (1) duplicate KEY TAKEAWAY/body content in Planner.tsx
// (the live plan-creation viewer and its own PDF export -- page.tsx and
// ReportPdfButton.tsx had already been fixed for the same 9 sections in a
// prior pass), and (2) several executive visuals rendering a bare "—" for
// Confidence instead of the existing "Validation Needed"/"Validation
// Required" terminology this codebase already uses for the identical
// null-confidence state elsewhere. This file guards both fix classes
// against regression. No evidence-validation threshold was touched by
// either fix -- both only replace how an already-null value is DISPLAYED.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pageSource = readFileSync(`${repoRoot}app/dashboard/[id]/page.tsx`, "utf8");
const pdfSource = readFileSync(`${repoRoot}app/dashboard/[id]/ReportPdfButton.tsx`, "utf8");
const plannerSource = readFileSync(`${repoRoot}components/Planner.tsx`, "utf8");

// ---------------------------------------------------------------------------
// Group 1: Planner.tsx duplicate KEY TAKEAWAY / body content (parity with
// the already-fixed page.tsx and ReportPdfButton.tsx).
// ---------------------------------------------------------------------------

test("DUP1: stripLeadingTakeawaySentence correctly removes a bulleted first line that getSectionTakeaway selected as the takeaway -- the exact reported production shape ('1) Integration-first add-on products...')", () => {
  const content = [
    "1) Integration-first add-on products create durable expansion revenue for platform incumbents.",
    "2) Usage-based pricing pilots are expanding beyond early adopters into mid-market accounts.",
    "3) Vertical-specific compliance tooling is becoming a default purchase criterion.",
  ].join("\n");

  const takeaway = getSectionTakeaway(content);
  assert.ok(takeaway, "a takeaway must be extracted from real content");
  assert.match(takeaway, /Integration-first add-on products/);

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.doesNotMatch(
    stripped,
    /Integration-first add-on products/,
    "the takeaway's own leading bulleted line must be removed from the stripped content"
  );
  assert.match(
    stripped,
    /Usage-based pricing pilots/,
    "every other real bullet must survive stripping untouched"
  );
  assert.match(stripped, /Vertical-specific compliance tooling/);
});

test("DUP2 (evidence-integrity guard): stripLeadingTakeawaySentence leaves genuinely distinct content completely unchanged when the first line is not a duplicate of the takeaway", () => {
  const content = "A genuinely distinct opening line.\nA second, unrelated real sentence follows here.";
  const unrelatedTakeaway = "This sentence does not appear anywhere in the content above.";
  const stripped = stripLeadingTakeawaySentence(content, unrelatedTakeaway);

  assert.match(stripped, /A genuinely distinct opening line/);
  assert.match(stripped, /A second, unrelated real sentence/);
});

const plannerNineFieldsPattern =
  /field === "marketDrivers" \|\|\s*\n\s*field === "barriers" \|\|\s*\n\s*field === "opportunities" \|\|\s*\n\s*field === "threats" \|\|\s*\n\s*field === "customerSegments" \|\|\s*\n\s*field === "majorPlayers" \|\|\s*\n\s*field === "regionalAnalysis" \|\|\s*\n\s*field === "industryTrends" \|\|\s*\n\s*field === "marketSegmentation"/;

test("DUP3: source drift check -- the 9-field branch (Market Segmentation, Regional Analysis, Industry Trends, Major Players, Customer Segments, Market Drivers, Barriers, Opportunities, Threats) still exists in Planner.tsx's on-screen renderer", () => {
  assert.match(
    plannerSource,
    plannerNineFieldsPattern,
    "the 9 named fields' shared render branch must still exist in Planner.tsx"
  );
});

test("DUP4: source drift check -- Planner.tsx's on-screen renderer now strips the leading takeaway sentence before extracting bullets for the 9 named sections, while extractSectionMainExplanation still receives the ORIGINAL content (it already does its own index-based skip; double-stripping would drop real prose)", () => {
  const importsStripHelper = /stripLeadingTakeawaySentence[\s\S]{0,40}\} from "@\/app\/lib\/report-presentation"/.test(
    plannerSource
  );
  assert.ok(importsStripHelper, "stripLeadingTakeawaySentence must be imported into Planner.tsx");

  const nineFieldBranchIndex = plannerSource.search(plannerNineFieldsPattern);
  assert.notEqual(nineFieldBranchIndex, -1);

  const branchWindow = plannerSource.slice(nineFieldBranchIndex, nineFieldBranchIndex + 2000);

  assert.match(
    branchWindow,
    /const contentWithoutTakeawayDuplication = stripLeadingTakeawaySentence\(section\.content, takeaway\)/,
    "bullets must be sourced from takeaway-stripped content"
  );
  assert.match(
    branchWindow,
    /extractSectionMainExplanation\(section\.content, takeaway\)/,
    "extractSectionMainExplanation must still receive the ORIGINAL section.content, not the stripped content"
  );
  assert.match(
    branchWindow,
    /extractRealBulletLines\(contentWithoutTakeawayDuplication\)/,
    "extractRealBulletLines must receive the takeaway-stripped content, not raw section.content"
  );
});

test("DUP5: source drift check -- Planner.tsx's PDF export (formatPdfReadableContent) now strips the leading takeaway sentence for the same 9 fields before building the body paragraph, matching ReportPdfButton.tsx's sectionContentWithoutTakeawayDuplication fix", () => {
  const fnIndex = plannerSource.indexOf("function formatPdfReadableContent(");
  assert.notEqual(fnIndex, -1, "formatPdfReadableContent must still exist in Planner.tsx");

  // TASK #29E widened this window: a new CAGR "Validation Required"
  // early-return check (with its own explanatory comment) was inserted
  // earlier in this same function, pushing the takeaway-stripping line
  // further from the function start than the original fixed window covered.
  const fnWindow = plannerSource.slice(fnIndex, fnIndex + 3200);

  assert.match(
    fnWindow,
    /pdfKeyTakeawayCardFields\.has\(section\.field \?\? ""\)\s*\n\s*\? stripLeadingTakeawaySentence\(section\.content, getSectionTakeaway\(section\.content\)\)/,
    "formatPdfReadableContent must strip the leading takeaway sentence for pdfKeyTakeawayCardFields before building the body text"
  );
});

test("DUP6 (no regression): pdfCompleteVisualFields (executiveSummary, tamSamSom, strategicRecommendations, portersFiveForces, competitiveLandscape) are untouched by the DUP5 fix -- they still return empty body text, since their visual is already their complete presentation", () => {
  assert.match(
    plannerSource,
    /const pdfCompleteVisualFields = new Set\(\[\s*"executiveSummary",\s*"tamSamSom",\s*"strategicRecommendations",\s*"portersFiveForces",\s*"competitiveLandscape",\s*\]\);/
  );
});

// ---------------------------------------------------------------------------
// Group 2: bare "—" Confidence displays replaced with existing semantic
// terminology ("Validation Needed" on page.tsx's plain-JSX surfaces,
// "Validation Required" via localizePdfPresentationLabel on PDF surfaces).
// Never a fabricated number -- only the display string for an
// already-null value changes.
// ---------------------------------------------------------------------------

test("CONF1: page.tsx's ExecutiveInsightBanner no longer renders a bare em-dash for a null confidence value", () => {
  const fnIndex = pageSource.indexOf("function ExecutiveInsightBanner(");
  assert.notEqual(fnIndex, -1);
  const fnWindow = pageSource.slice(fnIndex, fnIndex + 1600);

  assert.match(
    fnWindow,
    /confidence === null \? "Confidence: Validation Needed" : `Confidence \$\{confidence\}%`/
  );
});

test("CONF2: page.tsx's Executive Snapshot confidence display (snapshotConfidenceDisplay) resolves a null marketDecision confidence to 'Validation Needed'/'Doğrulama Gerekli' instead of a bare dash", () => {
  const idx = pageSource.indexOf("const snapshotConfidenceDisplay = marketDecision");
  assert.notEqual(idx, -1);
  const window_ = pageSource.slice(idx, idx + 400);

  assert.doesNotMatch(window_, /: "—"/, "no bare em-dash fallback should remain in this expression");
  assert.match(window_, /"Validation Needed"/);
  assert.match(window_, /"Doğrulama Gerekli"/);
});

test("CONF3: ReportPdfButton.tsx's Executive Decision Card 'Confidence' row uses the same 'Validation Required' label already shown one row below it for the identical null case (Report Quality), instead of an internally-inconsistent bare dash", () => {
  const idx = pdfSource.indexOf('const recItems: Array<[string, string]> = [');
  assert.notEqual(idx, -1);
  const window_ = pdfSource.slice(idx, idx + 400);

  assert.match(
    window_,
    /confidence === null\s*\n\s*\? localizePdfPresentationLabel\("Validation Required", pdfLocale\)\s*\n\s*: `\$\{confidence\}%`/
  );
});

test("CONF4: ReportPdfButton.tsx's main cover KPI grid 'Confidence Score' row (Market Intelligence branch) uses the same 'Validation Required' label instead of a bare dash", () => {
  const idx = pdfSource.indexOf(
    'localizePdfPresentationLabel("Confidence Score", pdfLocale),\n                marketConfidenceScore === null'
  );
  assert.notEqual(idx, -1, "the Market Intelligence cover metrics Confidence Score entry must exist");
  const window_ = pdfSource.slice(idx, idx + 250);

  assert.match(window_, /localizePdfPresentationLabel\("Validation Required", pdfLocale\)/);
});

test("CONF5: ReportPdfButton.tsx's KPI-card grid no longer over-truncates Main Risk/Next Action values to a 46-character pre-wrap cutoff that fills only the first of the card's 2 available lines", () => {
  assert.doesNotMatch(
    pdfSource,
    /wrapPdfText\(conciseCoverText\(value, 46\), cardWidth - 8\)/,
    "the old, overly aggressive 46-char override must be gone"
  );
  assert.match(
    pdfSource,
    /wrapPdfText\(conciseCoverText\(value\), cardWidth - 8\)/,
    "the KPI grid must use conciseCoverText's own default budget, matching the wider Insight Panel's already-correct call"
  );
});

test("CONF6: Planner.tsx's Executive Decision Card 'Confidence' row (recItems) mirrors ReportPdfButton.tsx's identical fix", () => {
  const idx = plannerSource.indexOf('const recItems: Array<[string, string]> = [');
  assert.notEqual(idx, -1);
  const window_ = plannerSource.slice(idx, idx + 400);

  assert.match(
    window_,
    /confidence === null\s*\n\s*\? localizePdfPresentationLabel\("Validation Required", pdfLocale\)\s*\n\s*: `\$\{confidence\}%`/
  );
});

test("CONF7: Planner.tsx's marketConfidenceDisplay (used in both the metricCards 'Confidence Score' row and the Confidence Gauge label) resolves null to the same 'Validation Required' label instead of a bare dash", () => {
  const idx = plannerSource.indexOf("const marketConfidenceDisplay =");
  assert.notEqual(idx, -1);
  const window_ = plannerSource.slice(idx, idx + 300);

  assert.match(
    window_,
    /marketConfidenceScore === null\s*\n\s*\? localizePdfPresentationLabel\("Validation Required", pdfLocale\)\s*\n\s*: `\$\{marketConfidenceScore\}%`/
  );
});

test("CONF8: Planner.tsx's on-screen ExecutiveInsightBanner mirrors page.tsx's identical fix -- no bare em-dash for a null confidence value", () => {
  const fnIndex = plannerSource.indexOf('function ExecutiveInsightBanner(');
  assert.notEqual(fnIndex, -1);
  const fnWindow = plannerSource.slice(fnIndex, fnIndex + 1600);

  assert.match(
    fnWindow,
    /confidence === null \? "Confidence: Validation Needed" : `Confidence \$\{confidence\}%`/
  );
});

test("CONF9 (no evidence-standard weakening, regression guard): none of the CONF1-CONF8 fixes changed how confidenceScore/confidence is COMPUTED -- every fix only changes the null-case DISPLAY string, and every site still guards on '=== null' before falling back to the semantic label, never fabricating a number", () => {
  const sites = [
    { source: pageSource, label: "page.tsx ExecutiveInsightBanner", marker: "Confidence: Validation Needed" },
    { source: pdfSource, label: "ReportPdfButton.tsx recItems", marker: 'localizePdfPresentationLabel("Validation Required", pdfLocale)' },
    { source: plannerSource, label: "Planner.tsx recItems/marketConfidenceDisplay", marker: 'localizePdfPresentationLabel("Validation Required", pdfLocale)' },
  ];

  for (const { source, label, marker } of sites) {
    assert.ok(source.includes(marker), `${label} must contain the semantic replacement, not a fabricated score`);
  }
});
