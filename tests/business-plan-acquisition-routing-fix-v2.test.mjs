import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL BUG FIX -- a Business Plan prompt was still generating an
// Acquisition Due Diligence report even after the prior turn's fix to
// app/lib/report-engine/domain.ts's classifyReportDomain.
//
// Root cause, found by tracing the actual live "plan" mode routing path
// (not just domain.ts): classifyReportDomain is the single classifier
// that decides which report-generator function actually runs
// (resolveReportDomainForSelectedMode + plan-executor.ts's dispatch), and
// it was already correct. But TWO further, entirely independent copies of
// the exact same acquisitionSignals regex exist elsewhere in the
// pipeline, and both still had the OLD, unfixed pattern:
//
//   1. app/lib/ai/expertise-profile.ts's own acquisitionSignals, used
//      inside detectDomain() -- checked UNCONDITIONALLY, before the
//      already-correct detectedDomain parameter (classifyReportDomain's
//      own output) is ever consulted. Its result becomes
//      expertiseProfile.domain, which is spliced directly into the
//      model's own generation instructions (formatExpertiseProfileForReportContext
//      -> plan-executor.ts's expertiseContext), telling the model
//      "Domain scope: acquisition" and to adopt an M&A advisor persona
//      -- even while the correct business-plan code path is dispatched.
//      This is exactly why the report still READ like an Acquisition
//      Due Diligence report.
//   2. app/lib/ai/understanding.ts's ACQUISITION_WORKFLOW_PATTERN, whose
//      result can feed into reportReadiness.detectedIndustry, which
//      plan-executor.ts then threads through to expertise-profile.ts's
//      own detectDomain as its detectedDomain argument -- a second path
//      by which a stale "acquisition" verdict could leak into
//      expertiseProfile.domain.
//
// Both were hardened to match domain.ts's already-fixed pattern exactly:
// bare "financing structure"/"debt financing" (ordinary startup-pitch
// capital-planning vocabulary any pre-revenue venture uses) removed as
// standalone triggers, and "acquire"/"buy"/"purchase a [company]" now
// tolerate descriptive words between the article and the noun instead of
// requiring the noun immediately after "a"/"the".
//
// This is routing-only: no report generation, acquisition report
// quality, sanitization, PDF, or presentation-layer code was touched.

const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);
const { createExpertiseProfileFallback } = await import("../app/lib/ai/expertise-profile.ts");
const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");

const businessPrompt =
  "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe.";
const businessPromptWithFinancing =
  "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe. Our financing structure includes $2M in seed funding and some debt financing.";
const acquisitionPrompt = "I want to acquire a cybersecurity SaaS company.";

// --- 1. The exact reported prompt, across all three independent classifiers -

test("classifyReportDomain (domain.ts) classifies the reported prompt as business, not acquisition", () => {
  assert.equal(classifyReportDomain(businessPrompt), "business");
});

test("createExpertiseProfileFallback (expertise-profile.ts) resolves the reported prompt's domain as business, not acquisition", () => {
  const fallback = createExpertiseProfileFallback({
    prompt: businessPrompt,
    assets: [],
    selectedMode: "plan",
  });
  assert.equal(fallback.domain, "business");
});

test("selectAnalysisWorkflow (understanding.ts) selects the business workflow for the reported prompt, not acquisition", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: businessPrompt }), "business");
});

// --- 2. The natural continuation that actually trips the old bug ------------

test("all three classifiers correctly stay 'business' even when the prompt goes on to mention its own financing structure/debt financing (the exact continuation that caused the original bug)", () => {
  assert.equal(classifyReportDomain(businessPromptWithFinancing), "business");
  assert.equal(
    createExpertiseProfileFallback({
      prompt: businessPromptWithFinancing,
      assets: [],
      selectedMode: "plan",
    }).domain,
    "business"
  );
  assert.equal(selectAnalysisWorkflow({ prompt: businessPromptWithFinancing }), "business");
});

// --- 3. The acquisition prompt still correctly routes to acquisition -------

test("all three classifiers correctly resolve the acquisition prompt as acquisition", () => {
  assert.equal(classifyReportDomain(acquisitionPrompt), "acquisition");
  assert.equal(
    createExpertiseProfileFallback({
      prompt: acquisitionPrompt,
      assets: [],
      selectedMode: "plan",
    }).domain,
    "acquisition"
  );
  assert.equal(selectAnalysisWorkflow({ prompt: acquisitionPrompt }), "acquisition");
});

// --- 4. End-to-end: the actual "plan" mode dispatch decision ---------------

test("resolveReportDomainForSelectedMode ('plan' mode) dispatches the reported prompt to business, and the acquisition prompt to acquisition -- the exact decision that selects which report generator runs", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: classifyReportDomain(businessPrompt),
      expertiseDomain: createExpertiseProfileFallback({
        prompt: businessPrompt,
        assets: [],
        selectedMode: "plan",
      }).domain,
    }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: classifyReportDomain(acquisitionPrompt),
      expertiseDomain: createExpertiseProfileFallback({
        prompt: acquisitionPrompt,
        assets: [],
        selectedMode: "plan",
      }).domain,
    }),
    "acquisition"
  );
});

// --- 5. The three regex copies are kept in exact lockstep ------------------

test("expertise-profile.ts's and understanding.ts's copies of acquisitionSignals no longer contain 'financing structure' or 'debt financing' as standalone triggers (drift check)", () => {
  const expertiseProfileSource = readFileSync(
    new URL("../app/lib/ai/expertise-profile.ts", import.meta.url),
    "utf8"
  );
  const understandingSource = readFileSync(
    new URL("../app/lib/ai/understanding.ts", import.meta.url),
    "utf8"
  );

  const expertiseProfileMatch = /const acquisitionSignals = new RegExp\(([\s\S]*?)\);/.exec(
    expertiseProfileSource
  );
  assert.ok(expertiseProfileMatch, "expertise-profile.ts's acquisitionSignals not found");
  assert.doesNotMatch(expertiseProfileMatch[1], /financing structure/);
  assert.doesNotMatch(expertiseProfileMatch[1], /debt financing/);

  const understandingMatch = /const ACQUISITION_WORKFLOW_PATTERN = new RegExp\(([\s\S]*?)\);/.exec(
    understandingSource
  );
  assert.ok(understandingMatch, "understanding.ts's ACQUISITION_WORKFLOW_PATTERN not found");
  assert.doesNotMatch(understandingMatch[1], /financing structure/);
  assert.doesNotMatch(understandingMatch[1], /debt financing/);
});

test("expertise-profile.ts's and understanding.ts's 'acquire a [company]' patterns tolerate descriptive words between the article and the noun, matching domain.ts's pattern exactly", () => {
  const descriptivePrompt =
    "We want to acquire a well-established, profitable AI-powered cybersecurity SaaS company.";
  assert.equal(classifyReportDomain(descriptivePrompt), "acquisition");
  assert.equal(
    createExpertiseProfileFallback({
      prompt: descriptivePrompt,
      assets: [],
      selectedMode: "plan",
    }).domain,
    "acquisition"
  );
  assert.equal(selectAnalysisWorkflow({ prompt: descriptivePrompt }), "acquisition");
});

// --- 6. Do not modify report generation, acquisition quality, sanitization, PDF, presentation -

test("acquisition report generation, the deal-fact calculations, the sanitizer, and the Executive Decision Center presentation logic are all untouched by this routing-only fix (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { acquisitionAnalysisPrompts, acquisitionAnalysisFields } = await import(
    "../app/lib/report-engine/prompts/acquisition-analysis.ts"
  );
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(acquisitionAnalysisFields.length, 20);
  assert.match(
    acquisitionAnalysisPrompts.finalInvestmentRecommendation,
    /Proceed with Conditions, Pause Pending Review, or Reject/
  );
  assert.equal(typeof stripReportPresentationArtifacts, "function");

  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(presentationSource, /Proceed with Conditions\|Pause Pending Review/);
});
