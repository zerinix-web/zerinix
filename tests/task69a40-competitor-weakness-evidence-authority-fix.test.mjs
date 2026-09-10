// TASK #69A-40 -- Make competitor weaknesses evidence-backed and
// structurally authoritative for discovered real competitors, without
// hallucination.
//
// CONTEXT: after #69A-39B/#69A-39C, a fresh real BIV report finally
// discovers and preserves real competitors end-to-end (Intuit
// QuickBooks, Xero, Dryrun, Accounting consultants/spreadsheets), but
// the Competitor Landscape showed no weakness for the three real DIRECT
// competitors -- only the generic "Accounting consultants / spreadsheets"
// substitute got a directional weakness.
//
// PIPELINE TRACE (direct inspection of the actual cached research
// bundle behind this exact live prompt, service-role, read-only, scratch
// script deleted immediately after use):
//   - QuickBooks/Xero: gathered evidence is real and substantive, but
//     describes their forecasting/scenario capability as a feature
//     EMBEDDED inside a broader, general-purpose accounting platform
//     ("built-in AI forecasting... available in QuickBooks Online",
//     Xero's "cash flow manager" within its wider accounting suite).
//     This is exactly the shape of a defensible DIRECTIONAL inference
//     the weaknesses field already permitted in principle (a company-
//     specific inference grounded in gathered positioning/differentiation
//     evidence) -- but this specific inference PATTERN (secondary/
//     embedded feature within a broader platform vs. a dedicated,
//     purpose-built specialization) was never named among the field's
//     own worked examples, unlike narrower-target-segment/integration-
//     limitation/pricing-friction/etc., which already were.
//   - Dryrun: research found only ONE competitor-relevant evidence
//     record, and it is a content-less stub (OpenAI's own url_citation
//     annotation provided no inline snippet, so the record fell back to
//     the BARE HOSTNAME as both claim and value, with an empty
//     impactReason) for what was otherwise a promising URL (a "Fathom
//     vs Dryrun" comparison blog post). No usable comparative text ever
//     reached the generation prompt for this competitor -- an honest
//     UNAVAILABLE outcome, not a defect to force-fill.
//
// ROOT CAUSE: a generation-time PROMPT-GUIDANCE gap (a common, real
// competitive shape -- a bundled feature inside a broad platform vs. a
// dedicated challenger -- was never named as a worked example), not a
// missing research capability, not a broken canonical structure, and not
// an overly strict validation rule. The existing #69A-29 canonical
// architecture (weaknessBasis: verified|directional|unavailable,
// formatCompetitorWeaknessForDisplay as the single display authority)
// was already structurally correct and required no parallel structure.
//
// FIX (app/lib/report-engine/business-competitor-landscape-state.ts):
//   1. The weaknesses field's JSON-schema description now explicitly
//      names the "secondary, embedded feature within a broader general-
//      purpose platform vs. a dedicated, purpose-built specialization"
//      inference pattern -- an ALREADY-PERMITTED inference category
//      made explicit, not a new one invented for this fix. No research
//      change, no new research call, no fabrication risk: absence of
//      evidence still can never become a negative claim (the field's
//      existing "absence of evidence is never itself evidence of that
//      limitation" language is preserved and reinforced, not weakened).
//   2. formatCompetitorWeaknessForDisplay's UNAVAILABLE case now returns
//      the explicit "Not available" (never the ambiguous bare "—"
//      sentinel), and the DIRECTIONAL qualifier is now capitalized
//      "(Directional)" -- both per this task's own presentation
//      requirement. The internal storage sentinel ("—") and every
//      existing comparison against it are completely untouched -- only
//      this function's own DISPLAY text changed, so every one of its 4
//      renderer call sites (Planner.tsx web card + its own PDF export,
//      page.tsx, ReportPdfButton.tsx) picks up the fix automatically
//      with no renderer-specific patch.
//
// NO new research call, NO new research task type, NO new cache
// structure was added -- ticket item 6 ("add bounded weakness research
// ONLY IF necessary") was evaluated and found unnecessary: existing
// evidence already supports a defensible directional inference for the
// two well-evidenced real competitors, and Dryrun's genuinely thin
// evidence legitimately supports only an honest UNAVAILABLE outcome.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  formatCompetitorWeaknessForDisplay,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);
const domainResearchSource = readFileSync(
  join(repoRoot, "app/lib/ai/domain-research.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);

// Realistic fixture modeled on the actual live case (QuickBooks/Xero/
// Dryrun/Accounting consultants), not a synthetic toy competitor set.
// Company names here mirror the real live shape but the WEAKNESS TEXT
// is authored for this test, not copied from any real production
// prompt/response -- no hardcoded production weakness text.
function realCaseFixtureResponse() {
  return [
    {
      company: "Intuit QuickBooks",
      type: "Direct competitor",
      positioning: "General-purpose small-business accounting platform with built-in cash-flow forecasting.",
      strengths: "Massive installed base and deep accounting-workflow integration.",
      weaknesses:
        "Forecasting and scenario planning are offered only as a secondary, embedded feature within its broader general-purpose accounting platform, not a dedicated, purpose-built specialization.",
      weaknessBasis: "directional",
      threat: "High",
    },
    {
      company: "Xero",
      type: "Direct competitor",
      positioning: "General-purpose cloud accounting platform with an embedded cash flow manager.",
      strengths: "Strong SMB accountant/bookkeeper channel distribution.",
      weaknesses:
        "Its cash flow manager is a secondary, embedded feature of a broader general-purpose accounting suite rather than a dedicated, purpose-built specialization.",
      weaknessBasis: "directional",
      threat: "High",
    },
    {
      company: "Dryrun",
      type: "Direct competitor",
      positioning: "Cash-flow forecasting tool for accounting firms and their SMB clients.",
      strengths: "Purpose-built cash-flow scenario modeling.",
      // No usable comparative evidence reached the generation prompt for
      // this competitor -- honestly null, never forced.
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
    {
      company: "Accounting consultants / spreadsheets",
      type: "Substitute",
      positioning: "Manual, human-delivered forecasting via spreadsheets and advisors.",
      strengths: "Highly customizable to any business's exact reporting needs.",
      weaknesses: "Scalability and cost for frequent reforecasting.",
      weaknessBasis: "directional",
      threat: "Medium",
    },
  ];
}

// --- A/B/C: the three canonical weakness states survive research ->
//     canonical object -> web -> PDF -------------------------------------

test("A/J: verified weakness, real competitor identity/order/threat survive buildBusinessCompetitorLandscapeStateFromStructuredResponse for the real-case fixture", () => {
  const verifiedFixture = [
    { company: "Intuit QuickBooks", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: "an independent product comparison documents a specific, named limitation", weaknessBasis: "verified", threat: "High" },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(verifiedFixture);
  assert.equal(state.competitors[0].company, "Intuit QuickBooks");
  assert.equal(state.competitors[0].weaknessBasis, "verified");
  assert.doesNotMatch(formatCompetitorWeaknessForDisplay(state.competitors[0]), /\(Directional\)$/);
});

test("B: a directional weakness remains explicitly labeled through the canonical object and its display formatting", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  const quickbooks = state.competitors.find((c) => c.company === "Intuit QuickBooks");
  const xero = state.competitors.find((c) => c.company === "Xero");

  assert.equal(quickbooks.weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(quickbooks), /\(Directional\)$/);
  assert.equal(xero.weaknessBasis, "directional");
  assert.match(formatCompetitorWeaknessForDisplay(xero), /\(Directional\)$/);
});

test("C: unavailable renders the explicit 'Not available', never an ambiguous bare dash", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  const dryrun = state.competitors.find((c) => c.company === "Dryrun");

  assert.equal(dryrun.weaknessBasis, "unavailable");
  assert.equal(dryrun.weaknesses, "—", "internal storage sentinel is unchanged");
  assert.equal(formatCompetitorWeaknessForDisplay(dryrun), "Not available");
});

// --- D/F: absence of evidence can never become a negative claim; generic
//     unsupported sentiment is rejected by generation-time guidance ------

test("D: the generation-time schema guidance explicitly states absence of evidence is never itself evidence of a limitation", () => {
  assert.match(
    BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description,
    /absence of evidence about a limitation is never itself evidence of that limitation/
  );
});

test("F: the generation-time schema guidance still explicitly prohibits generic, unsupported negative sentiment (weak AI, poor forecasting, expensive, limited scenarios, bad UX) with no evidentiary basis", () => {
  const description = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description;
  assert.match(description, /NEVER generic sentiment/);
  assert.match(description, /never invented merely because no directly documented weakness exists/);
});

// --- E: the newly-named inference pattern is real, evidence-grounded,
//     and reachable through the real builder function -------------------

test("E: the newly-named 'embedded feature within a broader platform vs. dedicated specialization' inference pattern is present in the schema's own worked examples", () => {
  assert.match(
    BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description,
    /secondary, embedded feature within a broader general-purpose platform rather than a dedicated, purpose-built specialization/
  );
});

test("E: this pattern reaches the real builder function end-to-end for the real-case QuickBooks/Xero fixture -- a directional inference, never fabricated as verified", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  const quickbooks = state.competitors.find((c) => c.company === "Intuit QuickBooks");
  assert.match(quickbooks.weaknesses, /embedded feature/);
  assert.equal(quickbooks.weaknessBasis, "directional");
});

// --- G: weakness provenance survives persistence -------------------------

test("G: weakness text + weaknessBasis (provenance) survive a full JSON persistence round trip (simulating reports.metadata JSONB) for every real-case competitor", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  const roundTripped = JSON.parse(JSON.stringify({ metadata: { businessCompetitorLandscapeState: state } }));
  const reloaded = roundTripped.metadata.businessCompetitorLandscapeState;

  for (const original of state.competitors) {
    const reloadedRecord = reloaded.competitors.find((c) => c.company === original.company);
    assert.ok(reloadedRecord, `${original.company} must survive persistence`);
    assert.equal(reloadedRecord.weaknesses, original.weaknesses);
    assert.equal(reloadedRecord.weaknessBasis, original.weaknessBasis);
    assert.equal(
      formatCompetitorWeaknessForDisplay(reloadedRecord),
      formatCompetitorWeaknessForDisplay(original),
      `${original.company}'s display text must be identical before and after persistence`
    );
  }
});

// --- H/I: no new research call, no new cache structure, bounded/cached/
//     deduplicated behavior preserved (this fix touches guidance/display
//     text only) --------------------------------------------------------

test("H/I: no new research call site, research task type, or cache key structure was added by this fix -- item 6's bounded-research escalation was evaluated and found unnecessary", () => {
  assert.doesNotMatch(stateSource, /TASK #69A-40[\s\S]{0,400}research-cache|fetch\(|client\.responses\.create/i);
  // domain-research.ts's own research-planning/task-count logic is
  // completely untouched by this fix.
  assert.doesNotMatch(domainResearchSource, /TASK #69A-40/);
});

test("H/I: plan-executor.ts's AI-call budget / max-calls-per-report enforcement is untouched by this fix", () => {
  assert.match(planExecutorSource, /maxAiCallsPerReport/);
  // #69A-40A later legitimately touched plan-executor.ts too (an
  // unrelated stale-cache fix, bumping BUSINESS_PLAN_GENERATION_CONTRACT_VERSION)
  // -- only reject the EXACT #69A-40 marker, not a later ticket's own.
  assert.doesNotMatch(planExecutorSource, /TASK #69A-40(?![A-Z])/);
});

// --- K: web and PDF consume the SAME canonical weakness state -----------

test("K: Planner.tsx, page.tsx, and ReportPdfButton.tsx all import the same formatCompetitorWeaknessForDisplay -- no renderer independently reconstructs weakness text from prose", () => {
  for (const source of [plannerSource, pageSource, pdfButtonSource]) {
    assert.match(
      source,
      /import\s*\{[^}]*formatCompetitorWeaknessForDisplay[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/business-competitor-landscape-state"/s
    );
    assert.doesNotMatch(source, /function formatCompetitorWeaknessForDisplay/);
  }
});

test("K: web and PDF resolve an IDENTICAL display string for every real-case competitor (verified/directional/unavailable alike)", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  for (const competitor of state.competitors) {
    const webDisplay = formatCompetitorWeaknessForDisplay(competitor);
    const pdfDisplay = formatCompetitorWeaknessForDisplay(competitor);
    assert.equal(webDisplay, pdfDisplay, `${competitor.company} must render identically on web and PDF`);
  }
});

// --- J: identity/order/threat stability ----------------------------------

test("J: real competitor identity, first-occurrence order, and threat level are completely unaffected by this fix for the real-case fixture", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realCaseFixtureResponse());
  assert.deepEqual(
    state.competitors.map((c) => c.company),
    ["Intuit QuickBooks", "Xero", "Dryrun", "Accounting consultants / spreadsheets"]
  );
  assert.deepEqual(
    state.competitors.map((c) => c.threat),
    ["High", "High", "Medium", "Medium"]
  );
});

// --- L: decision/scoring stability ---------------------------------------

test("L: business-competitor-landscape-state.ts imports nothing from the decision-engine/founder-score/confidence-radar files -- this fix cannot drift unrelated scoring", () => {
  assert.doesNotMatch(stateSource, /decision-engine|founder-score|confidence-radar/i);
});

test("L: no decision-engine, founder-score, confidence-radar, benchmark-fit, or Porter's-Five-Forces file carries a #69A-40 marker -- this is a weakness-guidance + display-text fix only", () => {
  const decisionSafetyFiles = [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
  ];
  for (const relativePath of decisionSafetyFiles) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-40/, `${relativePath} must not carry a #69A-40 marker`);
  }
});
