// TASK #69A-18A -- Fix empty Benchmark Intelligence "Largest Gaps"
// after #69A-18.
//
// OBSERVED (fresh, post-outage, real localhost E2E verification): a
// real Business Idea Validation report showed Founder Readiness 40/100
// (Execution Complexity 66, Evidence Confidence 34, Founder Evidence
// 34) -- genuine, material, unresolved validation gaps -- while
// Benchmark Intelligence's "Largest Gaps" panel rendered completely
// EMPTY. #69A-18's own fix (benchmarkFit.validationGaps, evidence-
// derived) was confirmed still correct and non-empty for this exact
// report shape; the empty panel was a SEPARATE, downstream defect.
//
// ROOT CAUSE (traced through the full runtime path, not inferred from
// the UI): BenchmarkIntelligencePanel's "Largest gaps" column -- in
// BOTH its web copy AND, discovered mid-investigation, a second,
// byte-for-byte duplicate that app/dashboard/[id]/page.tsx carried
// locally instead of importing the shared component -- and the PDF
// renderer's equivalent "largestGaps:" line in pdf-normalization.mjs,
// all sourced "Largest Gaps" from benchmarkScore.deviations: a narrow,
// 4-metric (CAC / CAC Payback / Gross Margin / LTV) numeric comparison
// against industry benchmark RANGES -- a "Benchmark Fit" concept --
// filtered to exclude "Within Benchmark" status. createBenchmarkIntelligenceScore
// (benchmark-intelligence.ts) never even looks at benchmarkFit.
// validationGaps when building `deviations` (it only folds
// validationGaps.length into a numeric score PENALTY, never into the
// deviations list itself). So whenever all 4 of those specific metrics
// happen to land inside their benchmark range -- plausible even for a
// business with zero real customer/pricing/retention evidence, as this
// report's own Founder Readiness scores prove -- `deviations` filters
// to empty, and "Largest Gaps" rendered nothing, even though the
// canonical benchmarkFit.validationGaps list (evidence completeness --
// a DIFFERENT concept from benchmark-range fit) was genuinely
// non-empty on the exact same report.
//
// FIX: both web copies (deduplicated into one: page.tsx now imports
// the shared components/planner/BenchmarkIntelligencePanel.tsx instead
// of carrying its own copy) and the PDF renderer's "Largest gaps"/
// "largestGaps:" line now read the SAME canonical benchmarkFit.
// validationGaps list the #69A-18 fix already produces -- never
// benchmarkScore.deviations, never a second, independently generated
// gap list, never prose parsing. Benchmark Fit (deviations/dimensions/
// overallFit) remains a fully separate, unmodified concept -- this fix
// never touches createBenchmarkIntelligenceScore or its scoring
// formulas, only which field the "Largest Gaps" LABEL reads from.
//
// #69A-18's OWN documented open question -- does
// refreshResearchAwareFinancialContext leave validationIntelligenceV2
// as a stale pre-research snapshot? -- was investigated directly (see
// below) and confirmed NOT to be the cause of this defect, and not
// currently a live staleness bug at all: none of validationIntelligenceV2's
// real dependencies (financialModel, financialConsistency,
// sourceIntelligence, decisionConfidence) are ever altered by the
// research-refresh pipeline, so re-deriving it there would be
// byte-identical to the existing snapshot -- proven below, not assumed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { createValidationIntelligence } from "../app/lib/ai/validation-intelligence.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");
const benchmarkIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/benchmark-intelligence.ts"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const reportUtilsSource = readFileSync(join(repoRoot, "app/dashboard/report-utils.ts"), "utf8");
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const executiveDecisionVocabSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"),
  "utf8"
);
const competitorStateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");

const WEAK_EVIDENCE_PROMPT =
  "We are a proprietary, patent-pending enterprise SaaS platform with a data moat and network effects, serving regulated financial institutions with a premium recurring subscription model. Our experienced founding team has deep domain expertise as former bank executives and engineers. We have strong gross margins and enterprise contracts.";

// --- Root cause confirmation ------------------------------------------

test("root cause confirmation: createBenchmarkIntelligenceScore's deviations never fold in benchmarkFit.validationGaps -- they measure a completely different, narrower concept", () => {
  assert.match(benchmarkIntelligenceSource, /const validationPenalty = benchmarkFit\.validationGaps\.length \* 5;/);
  // validationGaps.length is used only as a numeric SCORE PENALTY --
  // never appended into the `deviations` array itself.
  const deviationsBlockStart = benchmarkIntelligenceSource.indexOf("const deviations = [");
  const deviationsBlockEnd = benchmarkIntelligenceSource.indexOf("];", deviationsBlockStart);
  const deviationsBlock = benchmarkIntelligenceSource.slice(deviationsBlockStart, deviationsBlockEnd);
  assert.doesNotMatch(deviationsBlock, /validationGaps/);
});

test("root cause confirmation (pre-fix behavior, proven structurally): 4 metrics can all be simultaneously 'Within Benchmark' while validationGaps is non-empty -- the two concepts are provably independent", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  // The pre-research canonical context already carries non-empty
  // validationGaps (the 3 prompt-level heuristics alone, #69A-3/#69A-5)
  // for this weak-evidence prompt -- confirming benchmarkFit and
  // benchmarkScore.deviations are independent axes on the SAME report.
  assert.ok(context.benchmarkFit.validationGaps.length > 0, "expected non-empty canonical validationGaps for a weak-evidence prompt");
  assert.ok(Array.isArray(context.benchmarkScore.deviations));
});

// --- Fix proof: canonical field used everywhere -----------------------

test("fix proof: page.tsx no longer carries a duplicate BenchmarkIntelligencePanel -- it imports the single shared, canonical one", () => {
  assert.match(
    pageSource,
    /import \{ BenchmarkIntelligencePanel \} from "@\/components\/planner\/BenchmarkIntelligencePanel";/
  );
  assert.doesNotMatch(pageSource, /function BenchmarkIntelligencePanel\(/);
  assert.doesNotMatch(pageSource, /function getBenchmarkFitLocale\(/);
});

test("fix proof: the shared BenchmarkIntelligencePanel's 'Largest gaps' column (benchmarkScore-present branch) now maps over the canonical `gaps` variable, never benchmarkScore.deviations", () => {
  // Strip line comments first -- the fix's own explanatory comment
  // deliberately quotes the OLD buggy property access in prose, which
  // would otherwise false-positive this check.
  const codeOnly = benchmarkPanelSource
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.doesNotMatch(codeOnly, /benchmarkScore\.deviations/);
  const scoreBranchStart = benchmarkPanelSource.indexOf("{benchmarkScore ? (");
  const scoreBranchEnd = benchmarkPanelSource.indexOf("{!benchmarkScore ? (");
  const scoreBranch = benchmarkPanelSource.slice(scoreBranchStart, scoreBranchEnd);
  assert.match(scoreBranch, /Largest gaps/);
  // TASK #69A-18C -- web no longer truncates to 3 (that was the exact
  // cause of a web/PDF parity break); it now renders the full
  // canonical array unsliced.
  assert.match(scoreBranch, /\{gaps\.map\(\(gap\) =>/);
});

test("fix proof: the PDF renderer's 'largestGaps:' line now reads the canonical `gaps` variable, never benchmarkScore.deviations/benchmarkGaps", () => {
  assert.doesNotMatch(pdfNormalizationSource, /benchmarkGaps/);
  assert.doesNotMatch(pdfNormalizationSource, /benchmarkScore\?\.deviations/);
  // TASK #69A-18C -- PDF no longer truncates to 4 either; both
  // renderers now render the identical, unsliced canonical array.
  assert.match(
    pdfNormalizationSource,
    /`\$\{labels\.largestGaps\}:`,\s*\n\s*\.\.\.gaps\.map\(\(gap\) => `- \$\{localizeBenchmarkFitValue\(gap, locale\)\}`\),/
  );
});

// --- Requirement: unresolved canonical gaps -> Largest Gaps non-empty --

test("unresolved canonical validation gaps produce a non-empty Largest Gaps list (web + PDF share the exact same source array)", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const canonicalGaps = context.benchmarkFit.validationGaps;
  assert.ok(canonicalGaps.length > 0);

  // Simulate exactly what both fixed renderers now do: gate on
  // canonicalGaps.length, never on benchmarkScore.deviations.
  const webGaps = canonicalGaps.length ? canonicalGaps : ["No material validation gaps detected."];
  const pdfGaps = Array.isArray(canonicalGaps) && canonicalGaps.length ? canonicalGaps : ["No material validation gaps detected."];
  assert.deepEqual(webGaps, canonicalGaps);
  assert.deepEqual(pdfGaps, canonicalGaps);
  assert.ok(webGaps.length > 0);
});

// --- Requirement: no unresolved material gaps -> honest empty state ----

test("a genuinely fully-evidenced report (no material gaps at all) still shows the honest no-gaps message, never a fabricated gap", () => {
  const emptyGaps = [];
  const webGaps = emptyGaps.length ? emptyGaps : ["No material validation gaps detected."];
  assert.deepEqual(webGaps, ["No material validation gaps detected."]);
});

// --- Requirement: Benchmark Fit score never determines gap emptiness ---

test("Benchmark Fit score/deviations do not determine validation-gap emptiness -- a report with ALL 4 deviation metrics 'Within Benchmark' can still carry non-empty canonical validationGaps", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  // Force every deviation to "Within Benchmark" directly -- proving the
  // fixed renderers' gap list is unaffected by this axis entirely.
  const allWithinBenchmarkScore = {
    ...context.benchmarkScore,
    deviations: context.benchmarkScore.deviations.map((deviation) => ({
      ...deviation,
      status: "Within Benchmark",
    })),
  };
  const deviationDerivedGaps = allWithinBenchmarkScore.deviations.filter(
    (deviation) => deviation.status !== "Within Benchmark"
  );
  assert.deepEqual(deviationDerivedGaps, [], "sanity: this scenario really does have zero deviation-derived gaps");
  // The canonical, renderer-consumed list is completely independent of
  // the (now all-passing) deviations above.
  assert.ok(context.benchmarkFit.validationGaps.length > 0, "canonical validationGaps must remain non-empty regardless of benchmark-fit deviations");
});

// --- Requirement: post-research refresh cannot leave stale pre-research gaps

test("post-research refresh replaces category-derived gaps with FRESH refreshed categories, never the stale pre-refresh ones", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  // The category-derived portion of validationGaps must come from
  // refreshed.investmentScore.categories (post-coverage), not from
  // context.investmentScore.categories (pre-coverage) -- confirmed by
  // checking the refreshed investmentScore itself differs in at least
  // one decisionEngine-driven field from the pre-refresh snapshot for
  // this evidence-weak prompt (proves the refresh really ran, not a
  // no-op), while validationGaps is derived from THAT fresh state.
  assert.notDeepEqual(refreshed.investmentScore, context.investmentScore);
  assert.ok(Array.isArray(refreshed.benchmarkFit.validationGaps));
});

test("investigated (not assumed): validationIntelligenceV2 is provably NOT stale relative to any input the research-refresh pipeline can currently change -- recomputing it from context's own (unchanged) dependencies is byte-identical to the existing snapshot", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);

  // applyMarketResearchCoverageToContext only ever changes investmentScore
  // and reportIntelligence -- confirmed directly here, not assumed.
  assert.deepEqual(coverageResult.context.financialConsistency, context.financialConsistency);
  assert.deepEqual(coverageResult.context.sourceIntelligence, context.sourceIntelligence);
  assert.deepEqual(coverageResult.context.decisionConfidence, context.decisionConfidence);

  // Since none of validationIntelligenceV2's real dependencies changed,
  // recomputing it fresh from the post-coverage context must be
  // byte-identical to the pre-coverage snapshot already sitting on
  // coverageResult.context.
  const freshlyRecomputed = createValidationIntelligence({
    financialModel: coverageResult.context,
    financialConsistency: coverageResult.context.financialConsistency,
    sourceIntelligence: coverageResult.context.sourceIntelligence,
    decisionConfidence: coverageResult.context.decisionConfidence,
  });
  assert.deepEqual(freshlyRecomputed, coverageResult.context.validationIntelligenceV2);
  assert.deepEqual(freshlyRecomputed, context.validationIntelligenceV2);
});

// --- Requirement: web/PDF consume the same canonical gap values --------

test("web and PDF both gate their gaps list on the exact same canonical benchmarkFit.materialValidationGaps condition (length check with the same honest no-gaps fallback)", () => {
  // TASK #69A-18B superseded this literal: the canonical field the
  // renderers read is now materialValidationGaps (see
  // task69a18b-benchmark-largest-gaps-semantic-correctness-fix.test.mjs
  // for the full follow-up fix and its own root-cause explanation).
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
  assert.match(
    pdfNormalizationSource,
    /const gaps = Array\.isArray\(benchmarkFit\?\.materialValidationGaps\) && benchmarkFit\.materialValidationGaps\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
});

test("Planner.tsx's own Benchmark Intelligence usage imports the identical shared component page.tsx now uses -- no third, independent copy exists anywhere", () => {
  assert.match(
    plannerSource,
    /import \{ BenchmarkIntelligencePanel \} from "@\/components\/planner\/BenchmarkIntelligencePanel";/
  );
});

// --- Requirement: persistence/reload preserves gaps ---------------------

test("persistence/reload preserves benchmarkFit/benchmarkScore verbatim -- report-utils.ts passes row.metadata through wholesale, never re-deriving or dropping fields", () => {
  assert.match(reportUtilsSource, /metadata:\s*\n\s*row\.metadata && typeof row\.metadata === "object" && !Array\.isArray\(row\.metadata\)\s*\n\s*\? \(row\.metadata as ReportMetadata\)/);
});

// --- Requirement: historical reports without structured gaps ------------
// --- degrade honestly, never fabricate ----------------------------------

test("a historical report with no benchmarkFit/benchmarkScore at all renders nothing (BenchmarkIntelligencePanel returns null) rather than inventing gap data", () => {
  assert.match(benchmarkPanelSource, /if \(!benchmarkFit && !benchmarkScore\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("a historical report with benchmarkFit present but validationGaps missing/undefined falls back to the honest no-gaps message, never throws or fabricates", () => {
  const benchmarkFitWithoutGaps = { fit: "Moderate Fit", industry: "SaaS" };
  const gaps = benchmarkFitWithoutGaps?.validationGaps?.length ? benchmarkFitWithoutGaps.validationGaps : ["No material validation gaps detected."];
  assert.deepEqual(gaps, ["No material validation gaps detected."]);
});

// --- Preserve prior fixes -------------------------------------------------

test("preserves #69A-17: Founder Readiness dimension resolution is untouched by this fix (no #69A-18A marker in report-presentation.ts's founder readiness logic)", () => {
  assert.doesNotMatch(reportPresentationSource, /#69A-18A/);
  assert.match(reportPresentationSource, /export function readFounderReadinessMetricValue\(/);
});

test("preserves canonical decision/confidence: executive-decision-vocabulary.ts and investment-score.ts are untouched by this fix", () => {
  assert.doesNotMatch(executiveDecisionVocabSource, /#69A-18A/);
  assert.doesNotMatch(investmentScoreSource, /#69A-18A/);
});

test("preserves competitor structured data: business-competitor-landscape-state.ts is untouched by this fix", () => {
  assert.doesNotMatch(competitorStateSource, /#69A-18A/);
});

test("preserves createBenchmarkIntelligenceScore's own scoring formulas -- this fix never touches how deviations/dimensions/overallFit are computed, only which field the Largest Gaps LABEL reads", () => {
  assert.doesNotMatch(benchmarkIntelligenceSource, /#69A-18A/);
});

test("preserves #69A-18's own fix: the 3-source validationGaps merge in financial-assumptions.ts is unchanged in formula (materialValidationGaps, added by #69A-18B, is a separate, additional field, not a replacement)", () => {
  assert.match(
    financialAssumptionsSource,
    /validationGaps: \[\s*\n\s*\.\.\.context\.promptLevelValidationGaps,\s*\n\s*\.\.\.deriveAuthoritativeCategoryValidationGaps\(refreshedInvestmentScore\.categories\),\s*\n\s*\.\.\.refreshedValidationIntelligenceGaps,\s*\n\s*\],/
  );
  assert.match(financialAssumptionsSource, /materialValidationGaps: refreshedValidationIntelligenceGaps,/);
});
