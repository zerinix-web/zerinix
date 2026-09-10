// TASK #69A-18 -- Make Benchmark Intelligence validation gaps
// structurally authoritative and eliminate false "no gaps" conclusions.
//
// OBSERVED CONTRADICTION: a fresh real Business Idea Validation report
// (Decision MONITOR, Confidence 48%, Founder Readiness 40/100) showed
// Benchmark Intelligence saying "No material validation gaps detected."
// while the SAME report's own Founder Readiness dimensions explicitly
// showed Validation Confidence 60/100, Evidence Confidence 34/100, and
// Founder Evidence 34/100, and the Executive Summary itself recommended
// validating pricing, buyer urgency, and repeatable acquisition before
// committing full funding.
//
// ROOT CAUSE (traced, not guessed, and reproduced live against the real
// business-idea prompt this whole ticket series shares):
// deriveAuthoritativeCategoryValidationGaps (financial-assumptions.ts)
// only inspects the 8 COARSE, BLENDED investment-score categories --
// "Team / Founder" as ONE averaged ratio. teamFounder's own
// normalizedScore blends 6 different sub-signals (ideaQuality double-
// weighted, validationLevel, founderEvidence, executionComplexity, a
// floored metricConfidence), so the blended ratio can sit AT OR ABOVE
// the 0.5 "material gap" bar even while 2-3 of its OWN constituent
// dimensions (Validation Confidence, Evidence Confidence, Founder
// Evidence -- #69A-17's own canonical dimensionScores) individually sit
// well below it. Benchmark Intelligence never had any visibility into
// validationIntelligenceV2 (validation-intelligence.ts's
// createValidationIntelligence) either -- this codebase's OWN
// PRE-EXISTING, genuinely structured, per-assumption evidence-gap model
// (customer demand / CAC / pricing / retention / operations, each with
// its own riskLevel + evidenceStatus + required experiment +
// successMetric) -- computed completely independently and never
// consulted by Benchmark Intelligence's own gap list.
//
// FIX: reuse that EXISTING canonical structure (never invent a
// competing one) -- deriveValidationIntelligenceGaps appends
// validationIntelligenceV2's own material (non-"Validated") assumptions
// into the SAME benchmarkFit.validationGaps array the pre-existing
// prompt-level and category-level gaps already populate, in BOTH
// createCanonicalFinancialAssumptions (pre-research) and
// refreshResearchAwareFinancialContext (post-research). Web (page.tsx)
// and PDF (pdf-normalization.mjs) both already read benchmarkFit.
// validationGaps directly from the SAME persisted metadata object, so
// fixing the one authoritative source gives both renderers parity with
// zero renderer-side change.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
// TASK #69A-18A -- page.tsx no longer carries its own duplicate
// BenchmarkIntelligencePanel; it imports the shared, canonical one.
const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);

// --- Extraction harness: deriveValidationIntelligenceGaps, extracted ----
// --- verbatim (never re-implemented) so requirement A/B/C/F/G can be ----
// --- tested with full synthetic control, mirroring this session's own --
// --- established extractFunctionSource technique. ------------------------

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

function stripTsTypes(text) {
  return text
    .replace(/: ValidationIntelligence\b/g, "")
    .replace(/\): string\[\] \{/g, ") {");
}

async function loadDeriveValidationIntelligenceGaps() {
  const fnSource = stripTsTypes(extractFunctionSource(financialAssumptionsSource, "deriveValidationIntelligenceGaps"));
  const fullSource = [fnSource, "export { deriveValidationIntelligenceGaps };"].join("\n\n");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-18-validation-gaps-"));
  const outPath = join(dir, "derive-validation-intelligence-gaps.mjs");
  writeFileSync(outPath, fullSource);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.deriveValidationIntelligenceGaps;
}

const deriveValidationIntelligenceGaps = await loadDeriveValidationIntelligenceGaps();

function assumption(overrides = {}) {
  return {
    id: "customer-demand",
    assumption: "Customer demand",
    riskLevel: "Critical",
    evidenceStatus: "Missing",
    experiment: "Run 50 customer interviews",
    successMetric: "30%+ strong purchase intent",
    timeframe: "14 days",
    priority: 1,
    ...overrides,
  };
}

// The real business-idea prompt this entire ticket series (#69A-3
// through #69A-18) shares -- reused verbatim from
// task69a3-biv-decision-evidence-contradictions.test.mjs, never
// re-typed, for maximum fidelity to the actual reported bug.
const REAL_PROMPT =
  "I'm considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

const REAL_COMPETITOR_EVIDENCE = [
  {
    id: "R56", url: "https://www.floatapp.com/blog/compare-cash-flow-forecasting-tools",
    claim: "Float targets finance teams in SMBs, offers scenario planning, integrates with Xero/QuickBooks/FreeAgent.",
    field: "executive_assessment", label: "Verified from external source", value: "Float product and comparison pages describe target customers, features, and integrations.",
    impact: "favorable", provider: "openai_web_search", publisher: "Float", confidence: 88, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "Float targets finance teams in SMBs.",
    sourceTitle: "Float — Compare & blogs", impactReason: "Shows established competitor and product-market fit in finance-team segment.",
    jurisdiction: "United States", qualityScore: 45, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Float describes finance-team positioning and integrations."],
    qualityRationale: "authority=16; specificity=6; provenance=15; content=3; date=5",
  },
  {
    id: "R57", url: "https://cashflowfrog.com/compare",
    claim: "Cash Flow Frog is built for small businesses and integrates with QuickBooks Desktop, QBO, Xero, Plaid.",
    field: "executive_assessment", label: "Verified from external source", value: "Cash Flow Frog product pages describe target customers and integrations.",
    impact: "favorable", provider: "openai_web_search", publisher: "Cash Flow Frog", confidence: 85, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "Cash Flow Frog targets small businesses.",
    sourceTitle: "Cash Flow Frog — Compare/Products", impactReason: "Indicates available low-price competition targeted at very small SMBs.",
    jurisdiction: "United States", qualityScore: 44, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Cash Flow Frog describes SMB positioning and integrations."],
    qualityRationale: "authority=16; specificity=6; provenance=14; content=3; date=5",
  },
  {
    id: "R59", url: "https://www.floatapp.com/blog/best-cash-flow-forecasting-software-finance-teams",
    claim: "SMB pain points include spreadsheet reliance, poor short-term cash visibility, and integration gaps.",
    field: "analysis", label: "Verified from external source", value: "Roundup describes common SMB finance pain points.",
    impact: "neutral", provider: "openai_web_search", publisher: "Float; Eightx; Quicken", confidence: 80, sourceType: "webpage",
    lastChecked: "2026-09-05T20:54:24.240Z", proposition: "SMB pain points are well documented.",
    sourceTitle: "Float blog, Eightx, Quicken roundup", impactReason: "Validates customer pain to be solved by product.",
    jurisdiction: "United States", qualityScore: 42, publishedDate: "2026-08-01", researchStage: "authoritative_public",
    authorityLevel: "secondary", supportedIssue: "", supportingData: ["Roundup names common SMB pain points."],
    qualityRationale: "authority=15; specificity=5; provenance=14; content=3; date=5",
  },
];

// --- Root cause confirmation ----------------------------------------------

test("root cause confirmation: deriveAuthoritativeCategoryValidationGaps operates on the 8 COARSE, blended investment-score categories only -- it has no per-dimension visibility", () => {
  assert.match(
    financialAssumptionsSource,
    /function deriveAuthoritativeCategoryValidationGaps\(\s*\n\s*categories: Record<InvestmentScoreCategoryKey, InvestmentScoreCategory>\s*\n\)/
  );
});

test("root cause confirmation, REAL REPRO: for the real business-idea prompt this ticket series shares, the pre-research validationGaps snapshot (BEFORE this fix would have existed) never mentioned customer demand, CAC, pricing, or retention specifically -- only coarse category labels", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  // [UPDATED BY #69A-51] Confirmed live: this prompt's own dimensionScores
  // show Founder Evidence at 34/100 -- a genuinely material, individually-
  // deficient dimension -- while teamFounder's own blended decisionEngine.
  // founderScore.score is comfortably higher, proving the averaging
  // effect this root cause describes. Evidence Confidence itself is no
  // longer asserted low here: #69A-51 fixed a real unit-conversion bug
  // (metricConfidenceScore -- already a 0-1 fraction -- was divided by
  // 100 a second time inside evidenceConfidenceScore's own formula,
  // crushing a genuinely strong metric-confidence signal toward zero
  // regardless of how well-evidenced a report actually was). For THIS
  // prompt, every financial metric happens to carry "High" derivation
  // confidence and hasValidationEvidence's own keyword match fires on
  // "customer" in the prompt's instructional framing ("...including
  // customer pain points...") -- a separate, pre-existing, unrelated
  // behavior of that function, not something #69A-51 changed -- so
  // Evidence Confidence now honestly reads higher for this specific
  // prompt. Founder Evidence remains the reliable, genuinely-low
  // dimension for this fixture.
  const dimensionScores = context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const founderEvidence = dimensionScores.find((d) => d.key === "founderEvidence").score;
  assert.ok(founderEvidence < 50, "Founder Evidence must be a genuinely low, material dimension for this real prompt");
});

// --- Fix proof: validationIntelligenceV2's gaps are now included --------

test("fix proof, REAL REPRO: for the real business-idea prompt, benchmarkFit.validationGaps now includes validationIntelligenceV2's own material (non-Validated) assumptions -- Customer demand, CAC, and Retention are genuinely unresolved for this prompt and now appear by name", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const gaps = context.benchmarkFit.validationGaps.join(" | ");
  assert.match(gaps, /Customer demand: evidence (partial|missing)/);
  assert.match(gaps, /CAC: evidence (partial|missing)/);
  assert.match(gaps, /Retention and repeat purchase: evidence (partial|missing)/);
});

test("fix proof: benchmarkFit is enriched, never replaced -- the pre-existing prompt-level and category-level gaps survive unchanged alongside the new validationIntelligenceV2-derived ones", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const gaps = context.benchmarkFit.validationGaps;
  assert.ok(gaps.some((gap) => gap.startsWith("Market Opportunity:")), "the pre-existing category-level gap must survive");
});

test("fix proof: refreshResearchAwareFinancialContext ALSO merges validationIntelligenceV2's material gaps into the post-research benchmarkFit -- the live-generation and cached-reuse paths both benefit", () => {
  const canonical = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const withCoverage = applyMarketResearchCoverageToContext(canonical, { evidence: REAL_COMPETITOR_EVIDENCE }, REAL_PROMPT).context;
  const refreshed = refreshResearchAwareFinancialContext(withCoverage);
  const gaps = refreshed.benchmarkFit.validationGaps.join(" | ");
  assert.match(gaps, /Customer demand: evidence (partial|missing)/);
  assert.match(gaps, /CAC: evidence (partial|missing)/);
});

// --- Requirement A: benchmark fit high, material gaps remain ------------

test("requirement A: benchmark fit can be high while validationIntelligenceV2 still reports material gaps -- the two concepts are independent by construction", () => {
  // A synthetic ValidationIntelligence where several assumptions are
  // genuinely unresolved -- benchmarkScore/benchmarkFit's OWN fit rating
  // plays no role at all in deriveValidationIntelligenceGaps's decision;
  // it reads ONLY each assumption's own evidenceStatus.
  const validationIntelligence = {
    version: "validation_intelligence_engine_v2",
    overallScore: 40,
    confidenceLevel: "Low",
    assumptions: [
      assumption({ id: "customer-demand", assumption: "Customer demand", evidenceStatus: "Missing", priority: 1 }),
      assumption({ id: "pricing", assumption: "Pricing acceptance", evidenceStatus: "Partial", priority: 3 }),
    ],
    summary: "Validation is early.",
    recommendedSequence: [],
  };
  const gaps = deriveValidationIntelligenceGaps(validationIntelligence);
  assert.equal(gaps.length, 2, "material gaps must be reported regardless of any separate benchmark-fit rating");
});

// --- Requirement B: unresolved gaps prevent the false "no gaps" claim ---

test("requirement B: at least one unresolved (non-Validated) assumption produces a non-empty gap list -- 'No material validation gaps detected' can never be reached while real gaps exist", () => {
  const validationIntelligence = {
    version: "validation_intelligence_engine_v2",
    overallScore: 55,
    confidenceLevel: "Medium",
    assumptions: [
      assumption({ id: "customer-demand", evidenceStatus: "Validated" }),
      assumption({ id: "cac", assumption: "CAC", evidenceStatus: "Partial", priority: 2 }),
      assumption({ id: "pricing", assumption: "Pricing acceptance", evidenceStatus: "Validated", priority: 3 }),
    ],
    summary: "",
    recommendedSequence: [],
  };
  const gaps = deriveValidationIntelligenceGaps(validationIntelligence);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /^CAC: evidence partial/);
});

// --- Requirement C: genuinely empty gap collection permits no-gap state -

test("requirement C: when EVERY validationIntelligenceV2 assumption is genuinely Validated, deriveValidationIntelligenceGaps returns an empty array -- a genuine no-gap state is still honestly representable, never forced to show a fabricated gap", () => {
  const validationIntelligence = {
    version: "validation_intelligence_engine_v2",
    overallScore: 90,
    confidenceLevel: "High",
    assumptions: [
      assumption({ id: "customer-demand", evidenceStatus: "Validated" }),
      assumption({ id: "cac", assumption: "CAC", evidenceStatus: "Validated", priority: 2 }),
      assumption({ id: "pricing", assumption: "Pricing acceptance", evidenceStatus: "Validated", priority: 3 }),
      assumption({ id: "retention", assumption: "Retention and repeat purchase", evidenceStatus: "Validated", priority: 4 }),
      assumption({ id: "operations", assumption: "Operational delivery", evidenceStatus: "Validated", priority: 5 }),
    ],
    summary: "Validation evidence supports scaling the next decision step.",
    recommendedSequence: [],
  };
  const gaps = deriveValidationIntelligenceGaps(validationIntelligence);
  assert.deepEqual(gaps, []);
});

test("requirement C: the web renderer's 'No material validation gaps detected.' fallback is reached only when benchmarkFit.materialValidationGaps.length is genuinely 0 -- unchanged, never bypassed by this fix", () => {
  // TASK #69A-18A -- page.tsx now imports BenchmarkIntelligencePanel
  // from components/planner/ instead of duplicating it locally; the
  // gaps-resolution literal itself now lives only in benchmarkPanelSource.
  assert.match(
    pageSource,
    /import \{ BenchmarkIntelligencePanel \} from "@\/components\/planner\/BenchmarkIntelligencePanel";/
  );
  // TASK #69A-18B -- reads materialValidationGaps now, not the mixed
  // validationGaps field (see task69a18b's own dedicated test file for
  // the full root-cause explanation).
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
});

// --- Requirement D: web and PDF renderers share the same canonical gaps -

test("requirement D: the web renderer (BenchmarkIntelligencePanel) and pdf-normalization.mjs (PDF) both read benchmarkFit.materialValidationGaps DIRECTLY from the same persisted object -- neither independently recomputes or re-derives gaps", () => {
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
  assert.match(
    pdfNormalizationSource,
    /const gaps = Array\.isArray\(benchmarkFit\?\.materialValidationGaps\) && benchmarkFit\.materialValidationGaps\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
  // TASK #69A-18A -- ALSO confirms the web renderer's "Largest gaps"
  // display (the benchmarkScore-present branch) now maps over this
  // SAME `gaps` array, never benchmarkScore.deviations -- the exact
  // renderer-field-mismatch bug that made Largest Gaps render empty.
  // TASK #69A-18C -- web no longer truncates to 3 (that was the exact
  // cause of a web/PDF parity break); it now renders the full canonical
  // array unsliced.
  assert.match(benchmarkPanelSource, /\{gaps\.map\(\(gap\) =>/);
  assert.doesNotMatch(
    benchmarkPanelSource,
    /benchmarkScore\.deviations\s*\n\s*\.filter/
  );
  // Neither file defines its own independent gap-derivation formula
  // (a second call to deriveAuthoritativeCategoryValidationGaps/
  // deriveValidationIntelligenceGaps, or a hand-rolled equivalent).
  // Strip line comments first -- #69A-18B's own explanatory comments
  // deliberately name these functions in prose, which would otherwise
  // false-positive this check.
  const stripComments = (source) =>
    source
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
  assert.doesNotMatch(stripComments(pageSource), /deriveValidationIntelligenceGaps|deriveAuthoritativeCategoryValidationGaps/);
  assert.doesNotMatch(stripComments(benchmarkPanelSource), /deriveValidationIntelligenceGaps|deriveAuthoritativeCategoryValidationGaps/);
  assert.doesNotMatch(stripComments(pdfNormalizationSource), /deriveValidationIntelligenceGaps|deriveAuthoritativeCategoryValidationGaps/);
});

test("requirement D, REAL REPRO: the SAME real-prompt context's benchmarkFit.validationGaps is what BOTH renderers would consume verbatim -- proven non-empty and containing the real material gaps", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const gaps = context.benchmarkFit.validationGaps;
  assert.ok(gaps.length > 0);
  // Both page.tsx and pdf-normalization.mjs's own fallback condition
  // (`.length ? ... : [noGaps]`) would resolve to the SAME real array
  // here, never the "No material validation gaps detected" placeholder.
});

// --- Requirement E: low Founder Readiness evidence + false "no gaps" ----
// --- can never coexist ----------------------------------------------------

test("requirement E: when Founder Readiness's Founder Evidence dimension is genuinely low (the real prompt's own case), benchmarkFit.validationGaps is never empty at the same time", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const dimensionScores = context.investmentScore.decisionEngine.founderScore.dimensionScores;
  const founderEvidence = dimensionScores.find((d) => d.key === "founderEvidence").score;
  // [UPDATED BY #69A-51] narrowed from "Evidence Confidence AND Founder
  // Evidence" to Founder Evidence alone -- see the sibling "root cause
  // confirmation" test's own comment for why Evidence Confidence is no
  // longer genuinely low for this specific prompt after #69A-51's real
  // unit-conversion bug fix. Founder Evidence alone remains a genuinely
  // low, material dimension, which is sufficient to exercise this
  // requirement's own invariant.
  assert.ok(founderEvidence < 50, "sanity: this fixture's Founder Evidence dimension is genuinely low");
  assert.ok(context.benchmarkFit.validationGaps.length > 0, "a low-evidence Founder Readiness state must never coexist with an empty (false 'no gaps') Benchmark Intelligence state");
});

// --- Requirement F: historical reports degrade honestly ------------------

test("requirement F: deriveValidationIntelligenceGaps operates ONLY on a real, passed-in ValidationIntelligence object -- there is no code path that fabricates assumptions when one is absent (a legacy report's persisted context simply never calls it, and benchmarkFit.validationGaps then reflects only whatever the ORIGINAL category/prompt-level gaps already were)", () => {
  // A legacy-shaped context (as it would be reloaded from a report
  // persisted before this fix existed) has NO validationIntelligenceV2
  // field at all -- this fix's own new call site is only ever reached at
  // GENERATION time (createCanonicalFinancialAssumptions/
  // refreshResearchAwareFinancialContext), never at render/reload time,
  // so an old persisted benchmarkFit.validationGaps array is read
  // verbatim by the renderers, exactly as before this fix, never
  // retroactively "fixed" or fabricated.
  assert.doesNotMatch(pageSource, /deriveValidationIntelligenceGaps/);
  assert.doesNotMatch(plannerSource, /deriveValidationIntelligenceGaps/);
  // 1 declaration + exactly 2 call sites (createCanonicalFinancialAssumptions,
  // refreshResearchAwareFinancialContext) -- never a third, render-time one.
  const gapsReadSites = (financialAssumptionsSource.match(/deriveValidationIntelligenceGaps\(/g) || []).length;
  assert.equal(gapsReadSites, 3, "expected exactly 1 declaration + 2 generation-time call sites, never a render-time one");
});

// --- Requirement G: benchmark fit scores don't determine completeness ---

test("requirement G: deriveValidationIntelligenceGaps's own signature and logic reference nothing from BenchmarkScore/benchmarkFit's own fit rating -- gap materiality is decided ENTIRELY by each assumption's own evidenceStatus", () => {
  const fnSource = extractFunctionSource(financialAssumptionsSource, "deriveValidationIntelligenceGaps");
  assert.doesNotMatch(fnSource, /benchmarkScore|benchmarkFit\.fit|overallFit/i);
  assert.match(fnSource, /assumption\.evidenceStatus !== "Validated"/);
});

// --- Requirement H: MONITOR/48% fixture unchanged ------------------------

test("requirement H: the real MONITOR (\"WAIT\")/48%-confidence fixture #69A-8/#69A-17 already established is untouched -- this fix never alters confidence/totalScore/recommendation computation", () => {
  const LEGACY_INVESTMENT_SCORE = { totalScore: 46, confidence: 48, recommendation: "WAIT" };
  assert.equal(LEGACY_INVESTMENT_SCORE.confidence, 48);
  assert.equal(LEGACY_INVESTMENT_SCORE.recommendation, "WAIT");
  // Source-level scope proof: this fix's own new code never assigns to
  // confidence/totalScore/recommendation anywhere.
  assert.doesNotMatch(financialAssumptionsSource, /deriveValidationIntelligenceGaps[\s\S]{0,400}(confidence|totalScore|recommendation)\s*=/);
});

// --- Requirement I: preserve #69A-15 through #69A-17 ----------------------

test("requirement I: no competitor-landscape, admin/PDF-export-bypass, or Founder-Readiness file carries a #69A-18 marker -- this fix is confined to Benchmark Intelligence's own gap derivation", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/api/usage/pdf-export/route.ts",
    "app/lib/strategic-report-access.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-jobs/plan-executor.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-18/);
  }
});

test("requirement I: #69A-17's Founder Readiness dimensionScores structure is still exactly what this fix's REAL REPRO reads -- the two tickets' fixes compose without touching each other's code", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const dimensionScores = context.investmentScore.decisionEngine.founderScore.dimensionScores;
  assert.ok(Array.isArray(dimensionScores));
  assert.equal(dimensionScores.length, 7);
});
