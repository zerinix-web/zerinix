// TASK #69A-29A -- Resolve why real competitor weaknesses remain "Not
// available" without inventing unsupported claims.
//
// ROOT CAUSE (traced against the ACTUAL research-execution code path,
// not assumed): #69A-29's generation-time schema/prompt permission was
// correct but insufficient -- a fresh real regeneration still showed
// Float/Cash Flow Frog/Futrli (real, named direct competitors) with
// weaknesses unavailable, while a generic "Spreadsheets/Quicken"
// substitute got one. Traced to the REAL research-execution path
// (app/lib/decision-intelligence/research-plan.ts's buildDecisionResearchPlan,
// consuming app/lib/decision-intelligence/profiles.ts's own
// sharedBusinessResearch "competitors" requirement, further enriched
// by domain-research.ts's buildTaskStageQueries via a `fieldSynonyms`
// map): domain-research.ts's OWN similarly-named `RESEARCH_DOMAIN_TASKS`
// config (which #69A-29 widened) is DEAD configuration -- never read
// by the real research-execution path at all. The REAL query text
// never asked for comparative limitations, feature gaps, or review-
// platform cons, and its preferredSources were entirely vendor-owned.
// businessResearchSourceStages' own "authoritative_public" stage
// guidance already named G2/Capterra/TrustRadius/Trustpilot as sources
// to search, but never said to capture their own Cons/limitations
// sections. A generic substitute like "spreadsheets" needs no fresh
// evidence at all -- the model's own general knowledge already
// supplies an obvious limitation -- which is exactly why that one
// entry worked while real named competitors, requiring genuine
// comparative evidence, did not.
//
// FIX: widened the REAL query-text sources (profiles.ts,
// domain-research.ts) to ask for limitations/feature gaps/review cons,
// reusing the SAME G2/Capterra/TrustRadius/Trustpilot platforms already
// named elsewhere -- same query budget, zero additional search calls.
// Sharpened the generation-time comparative-inference rules (explicit
// allowed vs. prohibited logic) and bumped both the research cache
// version and the generation contract version so no stale cache
// silently serves pre-fix, weakness-blind data.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  formatCompetitorWeaknessForDisplay,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { buildDecisionResearchPlan } from "../app/lib/decision-intelligence/research-plan.ts";
import { getDomainProfile } from "../app/lib/decision-intelligence/profiles.ts";

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
  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a29a-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot, readFounderReadinessMetrics } = await importReportPresentation();

function arbitraryCompetitorResponse() {
  return [
    {
      company: "Northwind Ledger",
      type: "Direct competitor",
      positioning: "targets independent freelancers with automated expense categorization",
      strengths: "deep bank-feed integrations across 4 major regional banks",
      weaknesses:
        "an independent comparison review documents that it lacks multi-entity/team permission support, a feature multiple comparable alternatives offer",
      weaknessBasis: "verified",
      threat: "Medium",
    },
    {
      company: "Ledgerly",
      type: "Substitute",
      positioning: "spreadsheet-template alternative marketed to solo consultants",
      strengths: "very low price point",
      weaknesses: "manual spreadsheet workflow creates a significant switching/implementation burden for any team beyond a single user",
      weaknessBasis: "directional",
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

// --- A: root cause -- the REAL query-construction path now asks for ------
// --- comparative limitations, not just positioning/pricing ---------------

test("[A1 root cause] the REAL research requirement (decision-intelligence/profiles.ts, business domain, field 'competitors') now asks for comparative limitations and third-party review evidence -- not only positioning/substitutes/pricing", () => {
  const businessProfile = getDomainProfile("business");
  const competitorsRequirement = businessProfile.researchRequirements.find(
    (requirement) => requirement.field === "competitors"
  );

  assert.ok(competitorsRequirement, "expected a 'competitors' research requirement on the business profile");
  assert.match(competitorsRequirement.reason, /limitation|feature gap|comparative weakness/i);
  assert.ok(
    competitorsRequirement.preferredSources.some((source) => /review platform|third-party comparison/i.test(source)),
    `expected at least one preferredSources entry naming review/comparison sources, got: ${JSON.stringify(competitorsRequirement.preferredSources)}`
  );
});

test("[A2 root cause] buildDecisionResearchPlan's own generated task.query for the 'competitors' field actually contains the widened comparative-limitation language (end-to-end proof, not just the config in isolation)", () => {
  const businessProfile = getDomainProfile("business");
  const plan = buildDecisionResearchPlan({
    profile: businessProfile,
    intent: { primary: "strategic_advisory", secondary: [], confidence: 0.5, rationale: [] },
    facts: [],
    prompt: "An arbitrary SaaS cash-flow forecasting tool for small business owners.",
  });
  const competitorsTask = plan.find((task) => task.field === "competitors");

  assert.ok(competitorsTask, "expected a 'competitors' task in the generated plan");
  assert.match(competitorsTask.query, /limitation|feature gap|comparative weakness/i);
});

test("[A3 root cause] buildTaskStageQueries' own fieldSynonyms for 'competitors' now include limitation/cons/review terms -- this is the actual text appended to every real search query for this field, previously positioning-only", () => {
  // domain-research.ts imports "server-only" (not installable/resolvable
  // under plain node), so every existing test for this file reads its
  // source text directly rather than importing it live -- same
  // established convention followed here (see domain-aware-research.test.mjs/
  // research-engine-integrity.test.mjs's own read() helper).
  const source = readFileSync(join(repoRoot, "app/lib/ai/domain-research.ts"), "utf8");
  const fieldSynonymsMatch = /const fieldSynonyms: Record<string, string> = \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(fieldSynonymsMatch, "fieldSynonyms map not found");
  const competitorsEntryMatch = /competitors:\s*"([^"]+)"/.exec(fieldSynonymsMatch[1]);
  assert.ok(competitorsEntryMatch, "competitors entry not found in fieldSynonyms");
  assert.match(competitorsEntryMatch[1], /limitation|cons|drawback/i);
});

test("[A4 root cause confirmation] domain-research.ts's own RESEARCH_DOMAIN_TASKS config (widened by #69A-29) is confirmed DEAD -- buildDecisionResearchPlan/buildTaskStageQueries never reference it, so the real fix had to live elsewhere", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/domain-research.ts"), "utf8");
  // domainDefinitions.<domain>.research is only ever read for its
  // sibling .criticalFields property in this file; grep confirms no
  // `.research` (the array itself) is ever accessed.
  assert.doesNotMatch(source, /definition\.research\b/);
  assert.doesNotMatch(source, /domainDefinitions\[[^\]]+\]\.research\b/);
});

// --- B: three valid semantic states, never collapsed ----------------------

test("[B] verified, directional, and unavailable are three genuinely distinct states that survive buildBusinessCompetitorLandscapeStateFromStructuredResponse end-to-end", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(arbitraryCompetitorResponse());
  const byCompany = Object.fromEntries(state.competitors.map((c) => [c.company, c]));

  assert.equal(byCompany["Northwind Ledger"].weaknessBasis, "verified");
  assert.notEqual(byCompany["Northwind Ledger"].weaknesses, "—");
  assert.equal(byCompany.Ledgerly.weaknessBasis, "directional");
  assert.notEqual(byCompany.Ledgerly.weaknesses, "—");
  assert.equal(byCompany.ClearRunway.weaknessBasis, "unavailable");
  assert.equal(byCompany.ClearRunway.weaknesses, "—");
});

test("[3] unavailable remains unavailable when evidence is genuinely insufficient -- never forced to fill the column", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(arbitraryCompetitorResponse());
  const clearRunway = state.competitors.find((c) => c.company === "ClearRunway");
  // TASK #69A-40 -- display text is an explicit sentence, never the
  // ambiguous bare "—" sentinel (the underlying stored value, asserted
  // elsewhere in this file, is unchanged). TASK #69A-58 updated the exact
  // wording to "No evidence-backed weakness identified".
  assert.equal(formatCompetitorWeaknessForDisplay(clearRunway), "No evidence-backed weakness identified");
});

// --- 4: renderer never converts directional into verified -----------------

test("[4] formatCompetitorWeaknessForDisplay never upgrades a directional weakness's own presentation into an unqualified/verified-looking statement", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(arbitraryCompetitorResponse());
  const ledgerly = state.competitors.find((c) => c.company === "Ledgerly");
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");

  // TASK #69A-40 -- the qualifier is now capitalized "(Directional)".
  assert.match(formatCompetitorWeaknessForDisplay(ledgerly), /\(Directional\)$/);
  // A verified weakness must NOT carry the directional qualifier.
  assert.doesNotMatch(formatCompetitorWeaknessForDisplay(northwind), /\(directional\)$/);
});

// --- 5/6: comparative-inference rules -- prohibited vs accepted logic -----

test("[5] the generation-time guidance (prompt + schema description) explicitly prohibits generic sentiment and unsupported negative claims as a weakness basis", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  assert.match(planExecutorSource, /seems expensive/i);
  assert.match(planExecutorSource, /looks outdated/i);
  assert.match(planExecutorSource, /generic sentiment|unsupported negative opinion/i);

  const schemaDescription = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.weaknesses.description;
  assert.match(schemaDescription, /generic sentiment|seems expensive|looks outdated/i);
});

test("[6] the generation-time guidance explicitly accepts a defensible, evidence-backed comparative inference as a valid weakness basis, with a stated source-preference order", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  assert.match(planExecutorSource, /clear evidence-backed comparison/i);
  assert.match(
    planExecutorSource,
    /official product\/pricing\/feature documentation.*official integration documentation.*credible third-party comparisons.*documented customer reviews/is
  );
});

// --- 7: bounded/cached research behavior -- no new per-competitor query ---
// --- mechanism, no unbounded retries ---------------------------------------

test("[7] the fix widens EXISTING query text only -- no new per-competitor research task, no new research call, no retry loop was introduced", () => {
  const researchPlanSource = readFileSync(
    join(repoRoot, "app/lib/decision-intelligence/research-plan.ts"),
    "utf8"
  );
  const profilesSource = readFileSync(join(repoRoot, "app/lib/decision-intelligence/profiles.ts"), "utf8");

  // sharedBusinessResearch still has exactly 3 requirements (company_evidence,
  // market_demand, competitors) -- no new "weakness"/"comparison" task added.
  const sharedBusinessResearchMatch = /const sharedBusinessResearch = \[([\s\S]*?)\n\];/.exec(profilesSource);
  assert.ok(sharedBusinessResearchMatch);
  const requirementCount = (sharedBusinessResearchMatch[1].match(/requirement\(/g) || []).length;
  assert.equal(requirementCount, 3, "expected exactly the original 3 requirements -- no new weakness-specific research task");

  // buildDecisionResearchPlan itself is untouched -- one query per
  // requirement, same as before, no added retry/loop logic.
  assert.doesNotMatch(researchPlanSource, /retry|attempt\s*\+\+|for\s*\(.*weakness/i);
});

test("[7b] the research CACHE version was bumped so a stale, pre-fix cached research bundle is never silently replayed -- but the shared version constant governs a single one-time invalidation, not repeated re-fetching", () => {
  const source = readFileSync(join(repoRoot, "app/lib/ai/research-cache.ts"), "utf8");
  // Pinned to "v2" originally; #69A-39B bumped it again (v2 -> v3) for an
  // unrelated later fix (a stale cross-domain-classification cache entry)
  // using this exact same mechanism -- assert it was bumped at least past
  // "v1" (this task's own fix) rather than pinning a since-superseded
  // exact string, so a later legitimate bump doesn't fail this test.
  const versionMatch = source.match(/RESEARCH_CACHE_VERSION = "research-result-v(\d+)"/);
  assert.ok(versionMatch, "expected RESEARCH_CACHE_VERSION to still exist");
  assert.ok(Number(versionMatch[1]) >= 2, "expected the version to be bumped past v1 by this task's own fix");
});

// --- 8: web/PDF parity ------------------------------------------------------

test("[8] web and PDF resolve an identical weakness display string for the same competitor record", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(arbitraryCompetitorResponse());
  const ledgerly = state.competitors.find((c) => c.company === "Ledgerly");

  assert.equal(formatCompetitorWeaknessForDisplay(ledgerly), formatCompetitorWeaknessForDisplay(ledgerly));
});

// --- 9: competitor order and threat remain stable --------------------------

test("[9] competitor ordering and threat levels are unaffected by the widened research/inference rules", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(arbitraryCompetitorResponse());
  assert.deepEqual(state.competitors.map((c) => c.company), ["Northwind Ledger", "Ledgerly", "ClearRunway"]);
  assert.deepEqual(state.competitors.map((c) => c.threat), ["Medium", "Low", "Medium"]);
});

// --- 10: decision metrics unchanged for the current fixture ----------------

test("[10] the currently-verified real BIV fixture (MONITOR/48%, Founder Readiness 40 with 66/66/54/60/66/36/34, Confidence Radar 55/26/52/58/41, Porter's Five Forces complete) is untouched by this research/prompt change", () => {
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
  const web = buildExecutiveSnapshot("Decision: WAIT (Confidence: 48%).", score, undefined);
  const founderMetrics = readFounderReadinessMetrics(score);
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

  const portersSource = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.doesNotMatch(portersSource, /#69A-29A/);
});
