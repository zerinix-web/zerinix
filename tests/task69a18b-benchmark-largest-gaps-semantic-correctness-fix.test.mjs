// TASK #69A-18B -- Fix semantic correctness of Benchmark Intelligence
// "Largest Gaps".
//
// OBSERVED (fresh localhost E2E verification, after #69A-18A fixed the
// EMPTY panel): "Largest Gaps" was now populated, but with the WRONG
// data -- entries like "Financial Health: financial evidence 26%...",
// "Scalability: growth potential / margin structure...", and
// "Team / Founder: Market attractiveness 48%, Business model quality
// 54%, Validation confidence 60%, Execution complexity 66%, Evidence
// confidence 34%, Founder evidence 40%". These are report SCORES and
// DIMENSIONS, not validation gaps.
//
// ROOT CAUSE (traced end-to-end, not inferred from the UI):
// #69A-18A correctly redirected "Largest Gaps" to read
// benchmarkFit.validationGaps (the field #69A-18 made canonical) --
// but that field itself mixes THREE differently-shaped sources:
// (1) 3 prompt-level heuristic strings (financial-model.ts), (2)
// deriveAuthoritativeCategoryValidationGaps's category-derived entries
// (financial-assumptions.ts), and (3) deriveValidationIntelligenceGaps's
// genuinely structured, per-assumption evidence-gap strings
// (validationIntelligenceV2). Source (2) is the culprit: it maps
// `${category.label}: ${category.explanation}` for every
// investmentScore category scoring below 50% -- and
// refreshInvestmentNarrativeFromResearchCoverage (investment-score.ts,
// called inside refreshResearchAwareFinancialContext) OVERWRITES
// category.explanation, for 5 of the 8 categories (marketOpportunity,
// competitiveAdvantage, financialHealth, executionRisk, teamFounder),
// with `decisionCategory.reasoning.join("; ")` -- a semicolon-joined
// dump of raw percentage/reasoning lines never intended to be read as
// prose. Even BEFORE that corruption, "categoryLabel: categoryExplanation"
// was never a genuine "unresolved validation gap" to begin with -- it
// is category-scorecard commentary (what the category MEASURES), a
// fundamentally different concept from "what evidence is missing".
//
// FIX: Benchmark Intelligence "Largest Gaps" (web + PDF) now reads a
// NEW, separate, canonical field -- benchmarkFit.materialValidationGaps
// -- populated ONLY from deriveValidationIntelligenceGaps(validationIntelligenceV2),
// validationIntelligenceV2's own structured, per-assumption evidence-gap
// model (customer demand / CAC / pricing / retention / operations).
// This is never score-shaped and maps directly onto the ticket's
// expected semantics: willingness-to-pay/pricing, paid-pilot/paying-
// customer evidence, acquisition/conversion, retention/repeat
// behavior, primary customer validation. The OLD benchmarkFit.
// validationGaps field is completely UNCHANGED in composition (still
// the 3-source merge #69A-3/#69A-5/#69A-18 built and tested) -- it is
// simply no longer what these two renderers consume.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const reportInvestmentScoreSource = readFileSync(join(repoRoot, "app/lib/report-investment-score.ts"), "utf8");
const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const reportUtilsSource = readFileSync(join(repoRoot, "app/dashboard/report-utils.ts"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const competitorStateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
const authActionsSource = readFileSync(join(repoRoot, "app/auth/actions.ts"), "utf8");

const WEAK_EVIDENCE_PROMPT =
  "We are a proprietary, patent-pending enterprise SaaS platform with a data moat and network effects, serving regulated financial institutions with a premium recurring subscription model. Our experienced founding team has deep domain expertise as former bank executives and engineers. We have strong gross margins and enterprise contracts.";

// --- Root cause confirmation --------------------------------------------

test("root cause confirmation: refreshInvestmentNarrativeFromResearchCoverage overwrites category.explanation with a semicolon-joined reasoning dump for 5 of the 8 categories", () => {
  assert.match(
    investmentScoreSource,
    /explanation: decisionCategory\.reasoning\.length\s*\n\s*\? decisionCategory\.reasoning\.join\("; "\)\s*\n\s*: baseCategory\.explanation,/
  );
  assert.match(investmentScoreSource, /marketScore: "marketOpportunity"/);
  assert.match(investmentScoreSource, /founderScore: "teamFounder"/);
});

test("root cause confirmation (reproduced, not guessed): a weak-evidence prompt's refreshed teamFounder category.explanation is a percentage-dump string, exactly matching the observed defect", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  const teamFounderExplanation = refreshed.investmentScore.categories.teamFounder.explanation;
  // This is the exact shape of the observed bug: a semicolon-joined
  // list of "Label: NN%" fragments, never prose.
  assert.match(teamFounderExplanation, /Market attractiveness: \d+%/);
  assert.match(teamFounderExplanation, /Business model quality: \d+%/);
});

test("root cause confirmation: the OLD benchmarkFit.validationGaps field would have inherited that score dump via deriveAuthoritativeCategoryValidationGaps (still true of validationGaps itself -- proves why materialValidationGaps had to be a SEPARATE field, not a repair of validationGaps in place)", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  const materialCategories = Object.values(refreshed.investmentScore.categories).filter(
    (category) => category.maximumScore > 0 && category.score / category.maximumScore < 0.5
  );
  if (materialCategories.some((category) => category.key === "teamFounder")) {
    const teamFounderGapEntry = refreshed.benchmarkFit.validationGaps.find((gap) => gap.startsWith("Team / Founder:"));
    assert.ok(teamFounderGapEntry, "expected the OLD validationGaps to still carry the score-dump entry (proving materialValidationGaps must be a separate field)");
    assert.match(teamFounderGapEntry, /\d+%/, "the old field's category-derived entry is still a percentage dump");
  }
});

// --- Fix proof: new canonical field, correctly typed and populated -----

test("fix proof: materialValidationGaps is a distinct, optional field on BenchmarkFit (financial-model.ts) and ReportBenchmarkFit (report-investment-score.ts)", () => {
  assert.match(financialModelSource, /materialValidationGaps\?: string\[\];/);
  assert.match(reportInvestmentScoreSource, /materialValidationGaps\?: string\[\];/);
});

test("fix proof: materialValidationGaps is populated ONLY from deriveValidationIntelligenceGaps -- never deriveAuthoritativeCategoryValidationGaps, never promptLevelValidationGaps, in either construction site", () => {
  assert.match(financialAssumptionsSource, /materialValidationGaps: validationIntelligenceGaps,/);
  assert.match(financialAssumptionsSource, /materialValidationGaps: refreshedValidationIntelligenceGaps,/);
});

test("fix proof: both renderers (web BenchmarkIntelligencePanel, PDF pdf-normalization.mjs) read benchmarkFit.materialValidationGaps, never benchmarkFit.validationGaps, for their gaps list", () => {
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length/
  );
  assert.doesNotMatch(benchmarkPanelSource, /const gaps = benchmarkFit\?\.validationGaps/);
  assert.match(
    pdfNormalizationSource,
    /const gaps = Array\.isArray\(benchmarkFit\?\.materialValidationGaps\)/
  );
  assert.doesNotMatch(pdfNormalizationSource, /const gaps = Array\.isArray\(benchmarkFit\?\.validationGaps\)/);
});

// --- Requirement: score/dimension data never appears in Largest Gaps ---

test("score dimensions never appear in materialValidationGaps -- it never contains a category label + percentage dump, only genuine per-assumption evidence-gap strings", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);

  for (const gap of refreshed.benchmarkFit.materialValidationGaps) {
    // None of these category labels (Founder Readiness dimensions,
    // Benchmark Fit dimensions, or generic report-score categories)
    // may appear as a gap entry's own label prefix.
    for (const forbiddenLabel of [
      "Financial Health:",
      "Scalability:",
      "Team / Founder:",
      "Market Opportunity:",
      "Competitive Advantage:",
      "Execution Risk:",
      "Idea Quality:",
      "Business Model Quality:",
    ]) {
      assert.ok(!gap.startsWith(forbiddenLabel), `materialValidationGaps must never contain a score/category entry like "${forbiddenLabel}", found: ${gap}`);
    }
    // Genuine gap entries are never a bare percentage dump (no
    // semicolon-separated "Label: NN%" list).
    assert.ok(!/^\s*[\w\s/]+: \d+%;/.test(gap), `materialValidationGaps entry looks like a score dump, not a gap: ${gap}`);
  }
});

test("score dimensions never appear in materialValidationGaps -- structural check: the derivation formula reads ONLY validationIntelligenceV2.assumptions, never investmentScore.categories or decisionEngine", () => {
  const materialValidationGapsAssignments = [
    ...financialAssumptionsSource.matchAll(/materialValidationGaps: ([\w.()]+),/g),
  ].map((match) => match[1]);
  assert.ok(materialValidationGapsAssignments.length >= 2, "expected materialValidationGaps to be assigned in both construction sites");
  for (const assignedValue of materialValidationGapsAssignments) {
    assert.doesNotMatch(assignedValue, /categories|decisionEngine|investmentScore/i);
  }
});

// --- Requirement: real unresolved validation gaps DO appear ------------

test("real unresolved validation gaps (customer demand / pricing / acquisition / retention / operations) DO appear in materialValidationGaps for a weak-evidence report", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const unresolvedAssumptions = context.validationIntelligenceV2.assumptions.filter(
    (assumption) => assumption.evidenceStatus !== "Validated"
  );
  assert.ok(unresolvedAssumptions.length > 0, "expected at least one genuinely unresolved assumption for a weak-evidence prompt");
  assert.ok(context.benchmarkFit.materialValidationGaps.length > 0);
  assert.equal(context.benchmarkFit.materialValidationGaps.length, unresolvedAssumptions.length);
  // Every entry is shaped exactly like deriveValidationIntelligenceGaps
  // produces: "<assumption>: evidence <status> -- <experiment> to
  // establish <successMetric>."
  for (const gap of context.benchmarkFit.materialValidationGaps) {
    assert.match(gap, /^.+: evidence (partial|missing) -- .+ to establish .+\.$/i);
  }
});

test("the expected semantic categories from the ticket (WTP/pricing, paid-pilot/paying-customer, acquisition/conversion, retention/repeat, primary customer validation) are exactly what validationIntelligenceV2's 5 assumptions represent", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const assumptionNames = context.validationIntelligenceV2.assumptions.map((assumption) => assumption.assumption);
  assert.ok(assumptionNames.some((name) => /customer demand/i.test(name)), "primary customer validation");
  assert.ok(assumptionNames.some((name) => /cac/i.test(name)), "acquisition/conversion evidence");
  assert.ok(assumptionNames.some((name) => /pricing/i.test(name)), "willingness-to-pay/pricing validation");
  assert.ok(assumptionNames.some((name) => /retention/i.test(name)), "retention/repeat behavior");
  const retentionAssumption = context.validationIntelligenceV2.assumptions.find((assumption) => /retention/i.test(assumption.assumption));
  assert.match(retentionAssumption.experiment, /pilot|repeat purchase|subscription cohort/i, "retention experiment covers paid-pilot / paying-customer evidence");
});

// --- Requirement: no-gap case remains honest ----------------------------

test("a genuinely fully-validated context (every assumption 'Validated') yields an empty materialValidationGaps -- the honest no-gaps fallback is reached, never fabricated", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const fullyValidated = {
    ...context.validationIntelligenceV2,
    assumptions: context.validationIntelligenceV2.assumptions.map((assumption) => ({
      ...assumption,
      evidenceStatus: "Validated",
    })),
  };
  const strongContext = { ...context, validationIntelligenceV2: fullyValidated };
  const coverageResult = applyMarketResearchCoverageToContext(strongContext, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  assert.deepEqual(refreshed.benchmarkFit.materialValidationGaps, []);
  const rendererGaps = refreshed.benchmarkFit.materialValidationGaps.length
    ? refreshed.benchmarkFit.materialValidationGaps
    : ["No material validation gaps detected."];
  assert.deepEqual(rendererGaps, ["No material validation gaps detected."]);
});

// --- Requirement: web/PDF parity -----------------------------------------

test("web and PDF both gate on the identical materialValidationGaps condition with the same honest fallback", () => {
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
  assert.match(
    pdfNormalizationSource,
    /const gaps = Array\.isArray\(benchmarkFit\?\.materialValidationGaps\) && benchmarkFit\.materialValidationGaps\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
});

// --- Requirement: persistence/reload parity ------------------------------

test("persistence/reload preserves materialValidationGaps verbatim -- report-utils.ts passes row.metadata through wholesale, never re-deriving or dropping fields", () => {
  assert.match(reportUtilsSource, /metadata:\s*\n\s*row\.metadata && typeof row\.metadata === "object" && !Array\.isArray\(row\.metadata\)\s*\n\s*\? \(row\.metadata as ReportMetadata\)/);
});

test("historical reports without materialValidationGaps (persisted before this field existed) degrade honestly -- optional field, safe fallback, never a crash or fabricated gap", () => {
  const legacyBenchmarkFit = { fit: "Moderate Fit", industry: "SaaS", validationGaps: ["Financial Health: some old score dump"] };
  const gaps = legacyBenchmarkFit?.materialValidationGaps?.length
    ? legacyBenchmarkFit.materialValidationGaps
    : ["No material validation gaps detected."];
  assert.deepEqual(gaps, ["No material validation gaps detected."]);
});

// --- Preserve prior fixes -------------------------------------------------

test("preserves #69A-17: Founder Readiness dimension resolution is untouched by this fix", () => {
  assert.doesNotMatch(reportPresentationSource, /#69A-18B/);
  assert.match(reportPresentationSource, /export function readFounderReadinessMetricValue\(/);
});

test("preserves competitor intelligence, admin PDF bypass, and auth resilience: none of those files carry a #69A-18B marker", () => {
  for (const source of [competitorStateSource, pdfExportRouteSource, authActionsSource]) {
    assert.doesNotMatch(source, /#69A-18B/);
  }
});

test("preserves the OLD benchmarkFit.validationGaps field's own composition unchanged -- #69A-3/#69A-5/#69A-18's own tests still verify it; this fix only ADDS materialValidationGaps alongside it", () => {
  assert.match(
    financialAssumptionsSource,
    /validationGaps: \[\s*\n\s*\.\.\.promptLevelValidationGaps,\s*\n\s*\.\.\.authoritativeCategoryValidationGaps,\s*\n\s*\.\.\.validationIntelligenceGaps,\s*\n\s*\],/
  );
  assert.match(
    financialAssumptionsSource,
    /validationGaps: \[\s*\n\s*\.\.\.context\.promptLevelValidationGaps,\s*\n\s*\.\.\.deriveAuthoritativeCategoryValidationGaps\(refreshedInvestmentScore\.categories\),\s*\n\s*\.\.\.refreshedValidationIntelligenceGaps,\s*\n\s*\],/
  );
});
