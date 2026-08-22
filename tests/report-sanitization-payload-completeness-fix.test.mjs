import test from "node:test";
import assert from "node:assert/strict";

// CRITICAL FIX -- sanitization must preserve complete report payload.
//
// After the "final cleanup" turn added timeoutDisclosureSentencePattern
// (removing plan-executor.ts's "The synthesis provider reached its
// deadline; ... the existing decision engine." boilerplate as a whole
// sentence), production reports started failing with "Report job
// completed without a complete report payload."
//
// Root cause, found by auditing stripReportPresentationArtifacts against
// the REAL timeout-fallback field values (plan-executor.ts's
// createGroundedAcquisitionTimeoutFallback): two fields --
// `roiAnalysis: localized.timeout` and `irrAnalysis: localized.timeout`
// -- are set to NOTHING BUT that disclosure sentence (wrapped in
// [Recommendation]/[Basis:...] tags). Once the sentence and its tags were
// both correctly stripped, those two fields' sanitized content became a
// true empty string. Planner.tsx's live-view extraction loop
// (components/Planner.tsx) only calls markSectionComplete for a field
// when its sanitized content is truthy, so completedFields.size fell
// short of outputFields.length and hasCompletePayload's equality check
// failed -- throwing exactly the reported error, on every report whose
// generation hit the timeout fallback.
//
// Fixed by teaching stripReportPresentationArtifacts to never return an
// empty string for a genuinely non-empty input: if every removal pass
// leaves nothing behind, a generic fallback sentence
// ("Additional information is needed to complete this section.") takes
// its place. This does not weaken anything sanitization already removes
// -- every pattern still runs exactly as before (drift-checked below) --
// it only guarantees a field that HAD content never ends up with none.
// Sections whose ORIGINAL content was already empty are untouched by
// this and are still correctly dropped, so no new blank cards appear.

const {
  stripReportPresentationArtifacts,
  sanitizeReportSectionsForPresentation,
} = await import("../app/lib/report-engine/report-presentation-sanitizer.ts");
const {
  extractAcquisitionDealFacts,
  computeAcquisitionDerivedMetrics,
  formatVerifiedDealFactsBlock,
  formatDerivedValuationBlock,
  formatDerivedFinancingBlock,
} = await import("../app/lib/ai/acquisition-deal-facts.ts");
const { acquisitionAnalysisFields } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);

const scenarioPrompt =
  "We are acquiring a cybersecurity SaaS company. Purchase price is $40M, target ARR is $10M, and buyer available capital is $25M.";

// --- 1. The exact bug: fields set to nothing but the timeout-disclosure --
// ---    sentence must never sanitize down to empty -----------------------

test("roiAnalysis/irrAnalysis-shaped content (the exact plan-executor.ts timeout-fallback field value: nothing but the disclosure sentence) never sanitizes down to an empty string", () => {
  const timeoutOnlyFieldValue =
    "[Recommendation] [Basis:verified evidence and deadline fallback] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.";

  const sanitized = stripReportPresentationArtifacts(timeoutOnlyFieldValue);

  assert.notEqual(sanitized, "");
  assert.ok(sanitized.trim().length > 0, "sanitized content must never be empty for non-empty input");
  assert.doesNotMatch(sanitized, /synthesis provider/i);
  assert.doesNotMatch(sanitized, /decision engine/i);
  assert.doesNotMatch(sanitized, /\[Recommendation\]/);
  assert.doesNotMatch(sanitized, /\[Basis:/);
});

test("a genuinely empty field is still genuinely empty after sanitization -- the fallback only applies when sanitization itself consumed real content", () => {
  assert.equal(stripReportPresentationArtifacts(""), "");
});

// --- 2. Regression: the exact $40M purchase price / $10M ARR / $25M ------
// ---    available capital acquisition case --------------------------------

test("extractAcquisitionDealFacts/computeAcquisitionDerivedMetrics reproduce the exact case: EV/ARR = 4x, $25M equity, $15M debt, 62.5%/37.5% split", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  assert.equal(facts.purchasePrice, 40_000_000);
  assert.equal(facts.targetArr, 10_000_000);
  assert.equal(facts.buyerAvailableCapital, 25_000_000);

  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(derived.equitySharePercent, 62.5);
  assert.equal(derived.debtSharePercent, 37.5);
});

// A full, 20-field acquisition report row shaped exactly like
// createGroundedAcquisitionTimeoutFallback's real output for this exact
// scenario -- including the two fields (roiAnalysis/irrAnalysis) that are
// nothing but the timeout-disclosure sentence, the exact shape that broke
// production. Every field in acquisitionAnalysisFields is present, so
// this fixture doubles as the "every field the schema requires" proof.
function fullAcquisitionTimeoutFallbackRow() {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  const verifiedBlock = formatVerifiedDealFactsBlock(facts);
  const valuationBlock = formatDerivedValuationBlock(derived);
  const financingBlock = formatDerivedFinancingBlock(derived);
  const timeoutSentence =
    "[Recommendation] [Basis:verified evidence and deadline fallback] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.";
  const recommendation = "[Recommendation] [Basis:decision engine] Proceed conditionally on confirmed financing terms.";
  const unresolvedText =
    "[Unknown] [Required:regulatory_considerations] Some external sources could not be verified, so this field is not definitive.";

  const content = {
    executiveAcquisitionSummary: `${timeoutSentence}\n${recommendation}`,
    targetCompanyOverview: `${verifiedBlock}`,
    externalEvidence: "[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks",
    strategicFit: "[Recommendation] [Basis:acquisition evidence registry] Cross-sell opportunity into existing enterprise base.",
    valuationAnalysis: `${valuationBlock}`,
    financingStructure: `${financingBlock}`,
    debtCapacity: unresolvedText,
    roiAnalysis: timeoutSentence,
    irrAnalysis: timeoutSentence,
    revenueSynergies: "[Recommendation] [Basis:acquisition evidence registry] Cross-sell opportunity into existing enterprise base.",
    costSynergies: "[Recommendation] [Basis:acquisition evidence registry] Facility consolidation opportunity.",
    integrationRisks: "[Recommendation] [Basis:decision engine] Moderate technology integration risk.",
    operationalRisks: unresolvedText,
    regulatoryReview: unresolvedText,
    competitivePosition: unresolvedText,
    dealRisks: "Critical decision evidence remains unresolved: valuation.",
    postMergerIntegrationPlan: "[Recommendation] [Basis:decision engine] Complete financial and legal close within 30 days.",
    missingInformation: unresolvedText,
    finalInvestmentRecommendation: `${timeoutSentence}\n${recommendation}`,
    sources: "[Verified] [R1] valuation: SaaS EV/ARR benchmark https://saas-capital.example.com/benchmarks",
  };

  return acquisitionAnalysisFields.map((field) => ({
    field,
    title: field,
    content: content[field],
  }));
}

test("the exact $40M/$10M/$25M acquisition case: every acquisitionAnalysisFields field is present in the timeout-fallback fixture (fixture sanity check)", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  assert.equal(row.length, acquisitionAnalysisFields.length);
  assert.ok(row.every((section) => typeof section.content === "string"));
});

test("the exact $40M/$10M/$25M acquisition case: a Complete Acquisition Due Diligence Report is generated -- every non-excluded field has non-empty sanitized content, satisfying Planner.tsx's hasCompletePayload contract", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);

  // sources/externalEvidence are the only fields ever excluded.
  const expectedFieldCount = acquisitionAnalysisFields.length - 2;
  assert.equal(sanitized.length, expectedFieldCount);

  // Every remaining field -- including roiAnalysis/irrAnalysis, the exact
  // fields that broke production -- has real, non-empty content.
  for (const section of sanitized) {
    assert.ok(
      section.content && section.content.trim().length > 0,
      `field "${section.field}" has empty content -- would break hasCompletePayload`
    );
  }

  assert.ok(sanitized.some((s) => s.field === "roiAnalysis"));
  assert.ok(sanitized.some((s) => s.field === "irrAnalysis"));
});

test("the exact $40M/$10M/$25M acquisition case: EV/ARR = 4x is present in the sanitized valuationAnalysis field", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);
  const valuation = sanitized.find((s) => s.field === "valuationAnalysis")?.content || "";

  assert.match(valuation, /EV\/ARR: 4x/);
});

test("the exact $40M/$10M/$25M acquisition case: the financing structure exists and shows the $25M equity / $15M debt split", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);
  const financing = sanitized.find((s) => s.field === "financingStructure")?.content || "";

  assert.ok(financing.trim().length > 0, "financing structure section is missing/empty");
  assert.match(financing, /Equity contribution: \$25M/);
  assert.match(financing, /Debt requirement: \$15M/);
  assert.match(financing, /Debt share of purchase price: 37\.5%/);
  assert.match(financing, /Equity share: 62\.5%/);
});

test("the exact $40M/$10M/$25M acquisition case: no internal metadata appears anywhere in the sanitized report", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);
  const allContent = sanitized.map((s) => s.content).join("\n");

  assert.ok(!sanitized.some((s) => s.field === "sources"), "Sources section not removed");
  assert.ok(!sanitized.some((s) => s.field === "externalEvidence"), "External Evidence section not removed");
  assert.doesNotMatch(allContent, /\[R\d+\]/);
  assert.doesNotMatch(allContent, /https?:\/\//i);
  assert.doesNotMatch(allContent, /\[Verified\]/);
  assert.doesNotMatch(allContent, /\[Derived\]/);
  assert.doesNotMatch(allContent, /\[Recommendation\]/);
  assert.doesNotMatch(allContent, /\[Unknown\]/);
  assert.doesNotMatch(allContent, /\[Required:/);
  assert.doesNotMatch(allContent, /\[Basis:/);
  assert.doesNotMatch(allContent, /synthesis provider/i);
  assert.doesNotMatch(allContent, /decision engine/i);
  assert.doesNotMatch(allContent, /evidence registry/i);
  assert.doesNotMatch(allContent, /regulatory_considerations/);
});

// --- 3. Required report structure survives (title, type, sections, ------
// ---    section titles/content, recommendation, metrics, derived --------
// ---    calculations, risks, next actions) --------------------------------

test("the exact $40M/$10M/$25M acquisition case: sections array is non-empty and every section retains its own title and content -- the report contract's structural fields are never dropped", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);

  assert.ok(Array.isArray(sanitized));
  assert.ok(sanitized.length > 0);
  for (const section of sanitized) {
    assert.equal(typeof section.field, "string");
    assert.equal(typeof section.title, "string");
    assert.equal(typeof section.content, "string");
    assert.ok(section.title.length > 0);
    assert.ok(section.content.length > 0);
  }
});

test("the exact $40M/$10M/$25M acquisition case: the final recommendation, risks, and next-actions-shaped fields all retain real content", () => {
  const row = fullAcquisitionTimeoutFallbackRow();
  const sanitized = sanitizeReportSectionsForPresentation(row);

  const finalRecommendation = sanitized.find((s) => s.field === "finalInvestmentRecommendation");
  const dealRisks = sanitized.find((s) => s.field === "dealRisks");
  const postMerger = sanitized.find((s) => s.field === "postMergerIntegrationPlan");

  assert.ok(finalRecommendation && finalRecommendation.content.trim().length > 0);
  assert.match(finalRecommendation.content, /Proceed conditionally on confirmed financing terms\./);

  assert.ok(dealRisks && dealRisks.content.trim().length > 0);
  assert.match(dealRisks.content, /The valuation should be reviewed further before closing\./);

  assert.ok(postMerger && postMerger.content.trim().length > 0);
  assert.match(postMerger.content, /Complete financial and legal close within 30 days\./);
});

// --- 4. Do not weaken sanitization / do not restore source leakage -------

test("sanitization strength is unchanged -- every pattern stripReportPresentationArtifacts already removed still removes it, for a field with real prose alongside the boilerplate (not just the pure-boilerplate edge case)", () => {
  const mixed = stripReportPresentationArtifacts(
    "[Verified] [R1] Publisher: Statista\nhttps://statista.com/report\n[Recommendation] [Basis:decision engine] The synthesis provider reached its deadline; this preliminary report was completed from verified evidence and the existing decision engine.\nThe target's real analysis survives here."
  );

  assert.doesNotMatch(mixed, /\[Verified\]/);
  assert.doesNotMatch(mixed, /\[R1\]/);
  assert.doesNotMatch(mixed, /Publisher:/);
  assert.doesNotMatch(mixed, /https?:\/\//);
  assert.doesNotMatch(mixed, /\[Recommendation\]/);
  assert.doesNotMatch(mixed, /\[Basis:/);
  assert.doesNotMatch(mixed, /synthesis provider/i);
  assert.doesNotMatch(mixed, /decision engine/i);
  assert.match(mixed, /The target's real analysis survives here\./);
});

// --- 5. Drift check: fix is scoped to the sanitizer, not generation -------

// NOTE: superseded by the "acquisition sections are still falling back to
// empty responses" turn -- confirmed live, a field set to NOTHING BUT
// localized.timeout (or a bare [Recommendation]-tagged decision.recommendation
// word like "Wait") sanitizes down to either the sanitizer's generic
// backfill sentence or the bare verdict word itself, exactly the bug the
// user reported reaching production. The fix could not stay scoped to the
// sanitizer alone (the sanitizer can only rewrite what is there); it had to
// move upstream into createGroundedAcquisitionTimeoutFallback itself, which
// now builds every field from real deal facts and derived metrics instead
// of ever setting roiAnalysis/irrAnalysis to bare localized.timeout. This
// reverses the "lives entirely in the sanitizer" guarantee this test used
// to assert -- deliberately, per the explicit new requirement to fix the
// generator, not just the presentation layer.
test("plan-executor.ts's createGroundedAcquisitionTimeoutFallback no longer sets roiAnalysis/irrAnalysis to bare localized.timeout -- both now carry real deal-specific ROI/IRR analysis text", async () => {
  const { readFileSync } = await import("node:fs");
  const planExecutorSource = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planExecutorSource, /roiAnalysis: localized\.timeout,/);
  assert.doesNotMatch(planExecutorSource, /irrAnalysis: localized\.timeout,/);
  assert.match(planExecutorSource, /function buildFallbackRoiAnalysis\(/);
  assert.match(planExecutorSource, /What can be calculated/);
  assert.match(planExecutorSource, /What cannot be calculated/);
});
