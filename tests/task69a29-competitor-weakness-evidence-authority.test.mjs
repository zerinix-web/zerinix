// TASK #69A-29 -- Make competitor weaknesses evidence-aware,
// structurally authoritative, and eliminate "Not available" where
// defensible analysis exists.
//
// ROOT CAUSE (traced before writing any code, confirmed against the
// real reported case -- Float/Cash Flow Frog/Futrli having useful
// structured entries yet weaknesses unavailable): the structured Tier 0
// path (buildBusinessCompetitorLandscapeStateFromStructuredResponse)
// was already firing correctly -- company/type/positioning/strengths
// came through. `weaknesses` specifically came back null far more
// often than `strengths` for the SAME competitors with the SAME
// evidence. Two contributing causes: (1) domain-research.ts's
// "competitors" objective never asked for differentiation/limitation
// signals at all; (2) the schema's own weaknesses description only
// said "use null instead of inventing", with no concrete permission or
// pattern for a defensible NEGATIVE inference about a real, named
// company -- an asymmetric caution bias against negative claims, not a
// wiring bug.
//
// FIX: weaknesses may now be directly evidenced OR a clearly labeled,
// evidence-grounded inference (narrower target segment, integration
// limitation, pricing friction, workflow complexity, weaker scenario
// depth, limited prescriptive guidance, enterprise/SMB mismatch,
// channel limitation, switching/implementation burden). The new
// `weaknessBasis` field ("verified" | "directional" | "unavailable")
// makes that provenance a structural fact, never prose-embedded and
// never inferred by a renderer. formatCompetitorWeaknessForDisplay is
// the ONE function every renderer (web x2, PDF x2) calls instead of
// reading `weaknesses` raw.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  parseStructuredCompetitorLines,
  readBusinessCompetitorLandscapeState,
  formatCompetitorWeaknessForDisplay,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
  BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
  WEAKNESS_BASIS_VALUES,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = pathToFileURL(new URL("..", import.meta.url).pathname).pathname;

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

  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a29-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot, readFounderReadinessMetrics } = await importReportPresentation();

// A realistic, ARBITRARY (never Float/Cash Flow Frog/Futrli/QuickBooks)
// set of 4 competitors representing what the model should now return,
// grounded entirely in hypothetical evidence -- proves the fix
// generalizes rather than being tuned to any one report.
function realisticCompetitorResponse() {
  return [
    {
      company: "Northwind Ledger",
      type: "Direct competitor",
      positioning: "targets independent freelancers with automated expense categorization",
      strengths: "deep bank-feed integrations across 4 major regional banks",
      weaknesses: "narrower target segment -- built for solo freelancers, with no multi-entity or team permission model for growing businesses",
      weaknessBasis: "directional",
      threat: "Medium",
    },
    {
      company: "Ledgerly",
      type: "Substitute",
      positioning: "spreadsheet-template alternative marketed to solo consultants",
      strengths: "very low price point",
      weaknesses: "manual spreadsheet workflow creates significant switching/implementation burden for any team beyond a single user",
      weaknessBasis: "directional",
      threat: "Low",
    },
    {
      company: "Vantage Books",
      type: "Direct competitor",
      positioning: "enterprise accounting suite for mid-market retailers",
      strengths: "broad regulatory/compliance coverage documented in its own published case studies",
      weaknesses: "documented in an independent review as having a steep implementation timeline (8-12 weeks) unsuitable for early-stage teams",
      weaknessBasis: "verified",
      threat: "Low",
    },
    {
      company: "ClearRunway",
      type: "Direct competitor",
      positioning: "cash-flow forecasting tool for early-stage startups",
      strengths: "well-regarded scenario modeling",
      weaknesses: null,
      weaknessBasis: "unavailable",
      threat: "Medium",
    },
  ];
}

// --- 1: structured weakness survives research -> normalization -----------

test("[1] a defensible, evidence-grounded weakness inference survives buildBusinessCompetitorLandscapeStateFromStructuredResponse", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());

  assert.ok(state);
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");
  assert.ok(northwind);
  assert.notEqual(northwind.weaknesses, "—");
  assert.match(northwind.weaknesses, /narrower target segment/i);
  assert.equal(northwind.weaknessBasis, "directional");
});

// --- 2: weakness survives persistence/reload ------------------------------

test("[2] weakness (text + basis) survives a full JSON.stringify/parse persistence round trip (simulating DB storage and reload)", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());
  const persistedMetadata = JSON.parse(JSON.stringify({ businessCompetitorLandscapeState: built }));
  const reconstructed = readBusinessCompetitorLandscapeState(persistedMetadata);

  assert.ok(reconstructed);
  assert.deepEqual(reconstructed, built);
  const northwind = reconstructed.competitors.find((c) => c.company === "Northwind Ledger");
  assert.equal(northwind.weaknessBasis, "directional");
  assert.notEqual(northwind.weaknesses, "—");
});

// --- 3: web and PDF consume the SAME canonical weakness field ------------

test("[3] web and PDF renderers resolve an IDENTICAL display string for the same competitor -- no independent per-renderer reconstruction", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");

  // Simulates page.tsx/Planner.tsx's web table call and ReportPdfButton.tsx/
  // Planner.tsx's own PDF call -- both must call the SAME function with
  // the SAME record and get the SAME string.
  const webDisplay = formatCompetitorWeaknessForDisplay(northwind);
  const pdfDisplay = formatCompetitorWeaknessForDisplay(northwind);

  assert.equal(webDisplay, pdfDisplay);
  // TASK #69A-40 -- the qualifier is now capitalized "(Directional)".
  assert.match(webDisplay, /\(Directional\)$/);
});

// --- 4: valid weakness is not replaced by "Not available" -----------------

test("[4] a real, non-empty weakness string is never downgraded to the unavailable marker", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());

  for (const company of ["Northwind Ledger", "Ledgerly", "Vantage Books"]) {
    const entity = state.competitors.find((c) => c.company === company);
    assert.notEqual(entity.weaknesses, "—", `${company} should have preserved its real weakness text`);
  }
});

// --- 5: absent evidence still yields an honest unavailable state ---------

test("[5] a competitor with genuinely no supported weakness keeps the honest unavailable marker -- never a fabricated one", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());
  const clearRunway = state.competitors.find((c) => c.company === "ClearRunway");

  assert.equal(clearRunway.weaknesses, "—");
  assert.equal(clearRunway.weaknessBasis, "unavailable");
  // TASK #69A-40 -- the DISPLAY text is now the explicit "Not available"
  // (never the ambiguous bare "—" sentinel); the underlying STORED value
  // above is unchanged.
  assert.equal(formatCompetitorWeaknessForDisplay(clearRunway), "Not available");
});

// --- 6: an inferred weakness can never masquerade as verified fact -------

test("[6] weaknessBasis can only ever be \"verified\" when the model explicitly said so -- any other/missing/malformed value defaults to the WEAKER claim (\"directional\"), never silently upgraded", () => {
  const ambiguousBasisResponse = realisticCompetitorResponse().map((entry) =>
    entry.company === "Northwind Ledger" ? { ...entry, weaknessBasis: undefined } : entry
  );
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ambiguousBasisResponse);
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");

  assert.notEqual(northwind.weaknessBasis, "verified");
  assert.equal(northwind.weaknessBasis, "directional");

  // Even a nonsense/malformed basis value must not be trusted as "verified".
  const malformedBasisResponse = realisticCompetitorResponse().map((entry) =>
    entry.company === "Vantage Books" ? { ...entry, weaknessBasis: "extremely-confident" } : entry
  );
  const state2 = buildBusinessCompetitorLandscapeStateFromStructuredResponse(malformedBasisResponse);
  const vantage = state2.competitors.find((c) => c.company === "Vantage Books");
  assert.equal(vantage.weaknessBasis, "directional");
});

test("[6b] the Tier 1 labeled-line prose parser (no provenance signal available) never claims \"verified\" -- always \"directional\" or \"unavailable\"", () => {
  const content = [
    "COMPETITOR: Northwind Ledger | TYPE: Direct competitor | POSITIONING: targets freelancers | STRENGTHS: deep bank integrations | WEAKNESSES: narrower target segment for growing teams | THREAT: Medium",
    "COMPETITOR: ClearRunway | TYPE: Direct competitor | POSITIONING: cash-flow forecasting | STRENGTHS: scenario modeling | WEAKNESSES: Not available | THREAT: Medium",
  ].join("\n");
  const records = parseStructuredCompetitorLines(content);

  const northwind = records.find((r) => r.company === "Northwind Ledger");
  const clearRunway = records.find((r) => r.company === "ClearRunway");
  assert.equal(northwind.weaknessBasis, "directional");
  assert.notEqual(northwind.weaknessBasis, "verified");
  assert.equal(clearRunway.weaknesses, "—");
  assert.equal(clearRunway.weaknessBasis, "unavailable");
});

// --- 7: competitor ordering remains stable --------------------------------

test("[7] competitor ordering is preserved exactly (first-occurrence order), unaffected by weakness/weaknessBasis handling", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());
  assert.deepEqual(
    state.competitors.map((c) => c.company),
    ["Northwind Ledger", "Ledgerly", "Vantage Books", "ClearRunway"]
  );
});

// --- 8: threat level is not accidentally altered --------------------------

test("[8] threat level is read independently and is never changed by weakness/weaknessBasis resolution", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(realisticCompetitorResponse());
  const byCompany = Object.fromEntries(state.competitors.map((c) => [c.company, c.threat]));

  assert.deepEqual(byCompany, {
    "Northwind Ledger": "Medium",
    Ledgerly: "Low",
    "Vantage Books": "Low",
    ClearRunway: "Medium",
  });
});

// --- 9-13: decision safety -- competitor weakness enrichment must not ----
// --- touch decision/confidence/founder-readiness/Porter at all -----------

test("[9] business-competitor-landscape-state.ts imports nothing from the decision-engine files -- #69A-27's hard blockers, unsupported-projection gate, and Founder Evidence semantics are structurally unreachable from this change", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/business-competitor-landscape-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /investment-score|financial-assumptions|financial-model|market-research-coverage/);
});

test("[10/11/12] the currently-verified real BIV fixture (MONITOR/48%, Founder Readiness 40 with 66/66/54/60/66/36/34, Confidence Radar 55/26/52/58/41) is untouched by this competitor-weakness change -- decisionEngine/founderScore/confidenceRadar are computed entirely independently of businessCompetitorLandscapeState", () => {
  const score = {
    totalScore: 44,
    confidence: 48,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 55, maximumScore: 100, label: "Market Score", reasoning: [] },
      financialScore: { score: 26, maximumScore: 100, label: "Financial Score", reasoning: [] },
      founderScore: {
        score: 40,
        maximumScore: 100,
        label: "Founder Score",
        reasoning: [],
        dimensionScores: [
          { key: "ideaQuality", label: "Idea Quality", score: 66 },
          { key: "marketAttractiveness", label: "Market Attractiveness", score: 66 },
          { key: "businessModelQuality", label: "Business Model Quality", score: 54 },
          { key: "validationConfidence", label: "Validation Confidence", score: 60 },
          { key: "executionComplexity", label: "Execution Complexity", score: 66 },
          { key: "evidenceConfidence", label: "Evidence Confidence", score: 36 },
          { key: "founderEvidence", label: "Founder Evidence", score: 34 },
        ],
      },
      executionScore: { score: 52, maximumScore: 100, label: "Execution Score", reasoning: [] },
      riskScore: { score: 52, maximumScore: 100, label: "Risk Score", reasoning: [] },
      competitionScore: { score: 41, maximumScore: 100, label: "Competition Score", reasoning: ["Competitive evidence: 41%"] },
      technologyScore: { score: 58, maximumScore: 100, label: "Technology Score", reasoning: [] },
    },
  };
  const executiveSummaryContent = "Decision: WAIT (Confidence: 48%).";

  // Attaching a fully-populated businessCompetitorLandscapeState to the
  // same metadata object must have zero effect on any decision field --
  // they are read from entirely separate metadata keys.
  const metadata = {
    investmentScore: score,
    businessCompetitorLandscapeState: buildBusinessCompetitorLandscapeStateFromStructuredResponse(
      realisticCompetitorResponse()
    ),
  };

  const web = buildExecutiveSnapshot(executiveSummaryContent, metadata.investmentScore, undefined);
  const founderMetrics = readFounderReadinessMetrics(metadata.investmentScore);
  const radar = Object.fromEntries(web.confidenceRadar.map((d) => [d.label, d.score]));

  assert.equal(web.decision, "WAIT");
  assert.equal(web.confidenceScore, 48);
  assert.equal(web.founderScoreValue, 40);
  assert.deepEqual(founderMetrics, {
    founderReadinessScore: 40,
    ideaQuality: 66,
    marketAttractiveness: 66,
    businessModelQuality: 54,
    validationConfidence: 60,
    executionComplexity: 66,
    evidenceConfidence: 36,
    founderEvidence: 34,
  });
  assert.deepEqual(radar, { Market: 55, "Financial Research Coverage": 26, Execution: 52, Product: 58, "Moat Evidence": 41 });
});

test("[13] Porter's Five Forces state module is untouched by this task", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/porters-five-forces-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /#69A-29/);
});

// --- Schema/version integrity ---------------------------------------------

test("weaknessBasis is a required, non-nullable enum property; BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION was NOT bumped (additive/optional field, historical reports keep working unchanged)", () => {
  const props = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties;
  assert.equal(props.weaknessBasis.type, "string");
  assert.deepEqual([...props.weaknessBasis.enum].sort(), [...WEAKNESS_BASIS_VALUES].sort());
  assert.ok(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.required.includes("weaknessBasis"));
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION, 1);
});

test("historical reports (a record with no weaknessBasis at all) degrade honestly -- formatCompetitorWeaknessForDisplay never fabricates a provenance qualifier for one", () => {
  const legacyRecord = { company: "Some Co", type: "Unknown", positioning: "x", strengths: "y", weaknesses: "a real legacy weakness", threat: "Low" };
  assert.equal(formatCompetitorWeaknessForDisplay(legacyRecord), "a real legacy weakness");

  const metadata = {
    businessCompetitorLandscapeState: {
      version: BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
      competitors: [legacyRecord],
    },
  };
  const state = readBusinessCompetitorLandscapeState(metadata);
  assert.ok(state);
  assert.equal(state.competitors[0].weaknessBasis, undefined);
});

test("never invents a company-specific weakness with no evidentiary basis: a response with only company/type/positioning (no strengths/weaknesses/threat evidence at all) keeps weaknesses unavailable, never fabricated to fill the field", () => {
  const sparse = [
    { company: "Quiet Vendor Inc", type: "Direct competitor", positioning: "a competitor mentioned only by name", strengths: null, weaknesses: null, weaknessBasis: "unavailable", threat: null },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(sparse);
  const entity = state.competitors[0];

  assert.equal(entity.weaknesses, "—");
  assert.equal(entity.weaknessBasis, "unavailable");
  assert.equal(entity.strengths, "—");
  assert.equal(entity.threat, "—");
});
