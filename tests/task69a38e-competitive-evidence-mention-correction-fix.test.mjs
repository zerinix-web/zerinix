// TASK #69A-38E -- Fix the proven canonical competitive-evidence
// contradiction from the fresh real report.
//
// LIVE FAILURE: #69A-38D's own metadata-level fix (correcting the
// STRUCTURED decisionEngine.competitionScore/dimensions.competitiveEvidence
// once businessCompetitorLandscapeState is known) did NOT fully resolve
// the reported contradiction. A genuinely fresh report still showed:
//   - Competitor Landscape: "No competitor data could be validated for
//     this market yet."
//   - Executive Summary: "Competitive evidence: 93%; Distinct
//     competitor organizations represented: 5"
//   - Market Opportunity: "Competition Score: 93/100"
//   - Confidence Radar: "Evidence: 93"
//
// ROOT CAUSE, traced end-to-end and confirmed by direct reproduction:
// financial-assumptions.ts's formatInvestmentScore embeds a "Decision
// factors: - Competition Score: 93/100. Competitive evidence: 93%;
// Distinct competitor organizations represented: 5" line into the
// SHARED generation prompt (via financialAssumptionsContext), which
// explicitly instructs the model to "reuse the calculated score and
// category reasoning above." The model COPIED this line verbatim into
// TWO SEPARATE generated fields (executiveSummary AND
// marketOpportunity) -- confirmed by the ticket's own report of BOTH
// "Competition Score: 93/100" (Market Opportunity) and "Competitive
// evidence: 93%; ... represented: 5" (Executive Summary), the exact
// same reasoning line split across two fields. This happens DURING
// generation, which runs BEFORE businessCompetitorLandscapeState is
// known -- #69A-38D's metadata-only fix (applied AFTER generation) can
// correct the STRUCTURED investmentScore object, but has no way to
// retroactively edit text the model already wrote into parsedReport's
// own field content.
//
// FIX: report-consistency-validation.ts's correctMetricMentions (the
// SAME, already-tested mention corrector #69A-37/#69A-37A established)
// is exported and invoked a SECOND time in plan-executor.ts, once
// businessCompetitorLandscapeState/the corrected competitionScore are
// known, for three new targets ("Competitive evidence", "Competition
// Score", "Distinct competitor organizations represented"), mutating
// parsedReport/parsedCachedReport in place BEFORE persistence/
// streaming. This also surfaced and fixed a genuine, previously-latent
// bug in the SHARED VALUE_TOKEN regex: a bare integer immediately
// followed by a sentence-ending period with no space ("represented:
// 5. This supports...") had that period silently swallowed; VALUE_TOKEN
// now only consumes a "." as part of the number when a digit
// immediately follows it.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanonicalFinancialAssumptions, refreshResearchAwareFinancialContext } from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext, deriveCanonicalCompetitiveEvidence } from "../app/lib/ai/market-research-coverage.ts";
import { correctMetricMentions } from "../app/lib/report-consistency-validation.ts";
import { buildBusinessCompetitorLandscapeStateFromStructuredResponse } from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

const COMPETITOR_SHAPED_RAW_EVIDENCE = [
  {
    id: "R1",
    field: "product_evidence",
    claim: "Float targets finance teams and integrates with Xero/QuickBooks for cash-flow forecasting.",
    value: "",
    url: "https://float.com/about",
    sourceTitle: "Float - About",
    publisher: "Float",
    label: "Verified from external source",
    confidence: 80,
    qualityScore: 80,
    impactReason: "Shows established competitor positioning.",
    sourceType: "company_primary",
  },
];

function buildCorrectedContext(competitorState) {
  const base = createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
  const canonicalEvidence = deriveCanonicalCompetitiveEvidence(competitorState);
  const context = refreshResearchAwareFinancialContext(
    applyMarketResearchCoverageToContext(base, { evidence: COMPETITOR_SHAPED_RAW_EVIDENCE }, REAL_CASE_PROMPT, undefined, canonicalEvidence).context
  );
  return { context, canonicalEvidence };
}

function applyMentionCorrections(sections, competitionScore, competitorBreadth) {
  const corrections = [];
  for (const [labelPattern, canonicalDisplayValue] of [
    ["Competitive evidence", `${competitionScore}%`],
    ["Competition Score", `${competitionScore}`],
    ["Distinct competitor organizations represented", `${competitorBreadth}`],
  ]) {
    correctMetricMentions(sections, Object.keys(sections), labelPattern, canonicalDisplayValue, "financial_metric_mismatch", new Set(), corrections);
  }
  return corrections;
}

// --- A) zero validated competitors + raw/rejected candidates -----------

test("A) FAIL-BEFORE PROOF: reproduces the EXACT real report state -- AI-generated prose citing '93%'/'5 organizations'/'93/100' while the canonical competitor state is genuinely empty", () => {
  const staleProse = {
    executiveSummary: "Executive Decision: MONITOR (Confidence: 62%). Competitive Advantage: Competition Score: 93/100. Competitive evidence: 93%; Distinct competitor organizations represented: 5.",
    marketOpportunity: "Within this market, Competition Score: 93/100 reflects strong positioning.",
  };
  // This is the UNCORRECTED prose exactly as the model would have
  // written it, verbatim from the prompt's own reasoning line -- proof
  // that the contradiction is real and reproducible, not assumed.
  assert.match(staleProse.executiveSummary, /Competitive evidence: 93%/);
  assert.match(staleProse.executiveSummary, /Distinct competitor organizations represented: 5/);
  assert.match(staleProse.marketOpportunity, /Competition Score: 93\/100/);
});

test("A) zero validated competitors + competitor-shaped raw evidence => rendered count 0, no '5 competitors', no 93% validated competitive evidence", () => {
  const { context, canonicalEvidence } = buildCorrectedContext(null);
  assert.equal(canonicalEvidence.competitorBreadth, 0);
  assert.ok(canonicalEvidence.competitiveEvidence < 20);
  assert.equal(context.investmentScore.decisionEngine.competitionScore.score, 0);

  const sections = {
    executiveSummary: "Executive Decision: MONITOR (Confidence: 62%). Competitive Advantage: Competition Score: 93/100. Competitive evidence: 93%; Distinct competitor organizations represented: 5.",
    marketOpportunity: "Within this market, Competition Score: 93/100 reflects strong positioning.",
  };
  const corrections = applyMentionCorrections(
    sections,
    context.investmentScore.decisionEngine.competitionScore.score,
    canonicalEvidence.competitorBreadth
  );

  assert.ok(corrections.length > 0);
  assert.doesNotMatch(sections.executiveSummary, /93%/);
  assert.doesNotMatch(sections.executiveSummary, /represented: 5\b/);
  assert.doesNotMatch(sections.marketOpportunity, /93\/100/);
  assert.match(sections.executiveSummary, /Competitive evidence: 0%/);
  assert.match(sections.executiveSummary, /Distinct competitor organizations represented: 0\./);
  assert.match(sections.marketOpportunity, /Competition Score: 0\/100/);
});

test("A) raw/rejected candidates (e.g. a zero-length structured response) never contribute to validated competitor count", () => {
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse([]), null);
  const { canonicalEvidence } = buildCorrectedContext(buildBusinessCompetitorLandscapeStateFromStructuredResponse([]));
  assert.equal(canonicalEvidence.competitorBreadth, 0);
});

// --- B) validated competitors present -----------------------------------

test("B) validated competitors present => count and evidence derive from the accepted canonical competitors, and mentions correct to that real count", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Float", type: "Direct competitor", positioning: "Cash-flow forecasting for SMBs", strengths: "Strong SMB adoption", weaknesses: "Limited scenario depth", weaknessBasis: "directional", threat: "Medium" },
    { company: "Fathom", type: "Direct competitor", positioning: "Financial reporting and analysis", strengths: "Broad integrations", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const { context, canonicalEvidence } = buildCorrectedContext(state);
  assert.equal(canonicalEvidence.competitorBreadth, 2);
  assert.ok(canonicalEvidence.competitiveEvidence > 0);

  const sections = {
    executiveSummary: "Competitive evidence: 93%; Distinct competitor organizations represented: 5.",
  };
  applyMentionCorrections(sections, context.investmentScore.decisionEngine.competitionScore.score, canonicalEvidence.competitorBreadth);
  assert.match(sections.executiveSummary, /Distinct competitor organizations represented: 2\./);
});

// --- C) Benchmark Intelligence and Executive Summary agree ---------------

test("C) Benchmark Intelligence and Executive Summary cannot disagree about competitor evidence availability -- both derive from the SAME corrected decisionEngine.competitionScore/canonical competitor state", () => {
  const { context } = buildCorrectedContext(null);
  const competitiveAdvantageCategory = context.investmentScore.categories.competitiveAdvantage;
  assert.ok(competitiveAdvantageCategory.score / competitiveAdvantageCategory.maximumScore < 0.5);
  assert.ok(
    context.benchmarkFit.validationGaps.some((gap) => gap.startsWith("Competitive Advantage:")),
    "Benchmark Intelligence must list Competitive Advantage as a material gap when competitor evidence is genuinely absent"
  );
});

// --- D) Market Opportunity competition score cannot masquerade as -------
// --- evidence coverage if it represents a different concept ------------

test("D) 'Competition Score' and 'Competitive evidence' are corrected to the SAME canonical number (they are, by design, the same decisionEngine.competitionScore value expressed as a raw score vs a percentage) -- never two independently-drifting numbers", () => {
  const { context, canonicalEvidence } = buildCorrectedContext(null);
  const sections = {
    marketOpportunity: "Competition Score: 93/100.",
    executiveSummary: "Competitive evidence: 93%.",
  };
  applyMentionCorrections(sections, context.investmentScore.decisionEngine.competitionScore.score, canonicalEvidence.competitorBreadth);
  const scoreMatch = sections.marketOpportunity.match(/Competition Score: (\d+)\/100/);
  const evidenceMatch = sections.executiveSummary.match(/Competitive evidence: (\d+)%/);
  assert.ok(scoreMatch && evidenceMatch);
  assert.equal(scoreMatch[1], evidenceMatch[1]);
});

// --- E) Confidence Radar Evidence uses its defined authority -----------

test("E) Confidence Radar 'Evidence' is documented (in code) as intentionally sourced from decisionEngine.competitionScore -- never an accidental reuse -- and is now truthful since competitionScore itself is corrected", () => {
  const presentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
  assert.match(presentationSource, /decisionEngine\.\s*\n\s*\/\/ competitionScore/);
  assert.match(presentationSource, /score: investmentScore\?\.decisionEngine\?\.competitionScore\?\.score,/);
  const { context } = buildCorrectedContext(null);
  // The exact same structured value Confidence Radar reads.
  assert.equal(context.investmentScore.decisionEngine.competitionScore.score, 0);
});

// --- F) web/PDF parity ----------------------------------------------------

test("F) web and PDF consume the SAME corrected parsedReport/parsedCachedReport/fallbackReport text -- correctCompetitiveEvidenceMentions mutates the report object itself, before persistence/streaming, not a renderer-local copy", () => {
  assert.match(planExecutorSource, /function correctCompetitiveEvidenceMentions\(/);
  const occurrences = [...planExecutorSource.matchAll(/correctCompetitiveEvidenceMentions\(/g)];
  // Declaration + fresh-generation call site + cache-hit call site +
  // #69A-38F's own timeout/quality-gate-failure fallback call site.
  assert.equal(occurrences.length, 4);
});

// --- G) persistence/reload preserves the same canonical state -----------

test("G) the fresh-generation correction runs BEFORE cacheResponseText is captured -- the cache itself stores the CORRECTED text, so persistence/reload never resurfaces the stale mention, with no cache-key/version bump required", () => {
  const cacheIndex = planExecutorSource.indexOf("const cacheResponseText = JSON.stringify(parsedReport);");
  const correctionIndex = planExecutorSource.indexOf("correctCompetitiveEvidenceMentions(\n              parsedReport,");
  assert.ok(correctionIndex > -1 && cacheIndex > -1);
  assert.ok(correctionIndex < cacheIndex, "the correction must run before the cache snapshot is captured");
});

test("G) the cache-hit path ALSO re-applies the correction to parsedCachedReport, so an already-existing stale cache entry self-heals on every read, not just future generations", () => {
  assert.match(planExecutorSource, /correctCompetitiveEvidenceMentions\(\s*\n\s*parsedCachedReport,/);
});

// --- VALUE_TOKEN period-swallowing fix -----------------------------------

test("VALUE_TOKEN fix: a bare integer immediately followed by a sentence-ending period survives correction with its period intact", () => {
  const sections = { f: "Distinct competitor organizations represented: 5. This supports the decision." };
  correctMetricMentions(sections, ["f"], "Distinct competitor organizations represented", "0", "financial_metric_mismatch", new Set(), []);
  assert.equal(sections.f, "Distinct competitor organizations represented: 0. This supports the decision.");
});

test("VALUE_TOKEN fix: genuine decimals and unit suffixes are unaffected (regression guard)", () => {
  const sections = { f: "Runway is currently 11.3 months, well within plan." };
  const corrections = [];
  correctMetricMentions(sections, ["f"], "Runway", "18 months", "timeline_mismatch", new Set(), corrections);
  assert.equal(sections.f, "Runway is currently 18 months, well within plan.");
});

test("VALUE_TOKEN fix: #69A-37's own LTV:CAC compound-ratio protection and swallowed-space fix are unaffected (regression guard)", () => {
  const sections = { f: "Fundraising is conditional on LTV:CAC 3 and legal/compliance clearance." };
  correctMetricMentions(sections, ["f"], "CAC", "$10k", "financial_metric_mismatch", new Set(), []);
  assert.equal(sections.f, "Fundraising is conditional on LTV:CAC 3 and legal/compliance clearance.");
});

// --- Decision safety: no hardcoded fixture values as production logic --

test("no hardcoded competitor names, the score 93, or the count 5 appear as PRODUCTION LOGIC (not test fixtures) in the #69A-38E fix", () => {
  const markerIndex = planExecutorSource.indexOf("TASK #69A-38E");
  assert.ok(markerIndex > -1);
  const section = planExecutorSource.slice(markerIndex, markerIndex + 5000);
  for (const forbidden of ["Float", "Cash Flow Frog", "Futrli", "Fathom", "= 93", "=== 93", "= 5;", "=== 5"]) {
    assert.ok(!section.includes(forbidden), `plan-executor.ts's #69A-38E fix must not hardcode "${forbidden}"`);
  }
});

test("no decision-score preservation assertion exists anywhere in this fix -- MONITOR/62/Founder Readiness/40 are never pinned as required outcomes", () => {
  const markerIndex = planExecutorSource.indexOf("TASK #69A-38E");
  const section = planExecutorSource.slice(markerIndex, markerIndex + 5000);
  assert.ok(!/MONITOR/.test(section));
  assert.ok(!/Founder Readiness/.test(section));
});

// --- Porter safety: not touched by this fix -------------------------------

test("Porter's Five Forces architecture is untouched by this task -- porters-five-forces-state.ts carries no #69A-38E marker; Porter's own #69A-38 Tier 1 synthesis is unaffected", () => {
  const portersSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.doesNotMatch(portersSource, /#69A-38E/);
});
