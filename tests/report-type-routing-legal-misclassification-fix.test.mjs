import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL PRODUCTION REGRESSION -- wrong report-type routing.
//
// A live production request for "an AI-powered enterprise risk
// intelligence platform" (sanctions, compliance, cyber incidents,
// supplier contracts, geopolitical risk) explicitly asking for "a
// complete investor-grade business plan" was routed to a 2-section Legal
// Assessment report instead.
//
// Root cause: app/lib/ai/understanding.ts's selectAnalysisWorkflow()
// gates its venture-evaluation detection (isVentureEvaluation) on
// BUSINESS_WORKFLOW_PATTERN, which recognized "business idea"/"startup"/
// "launch"/"founder"/etc. but not the exact phrase the requirement names
// as an explicit request that must win: "business plan"/"business idea
// validation"/"investor-grade business report". Without that match,
// isVentureEvaluation stayed false, and the prompt's own domain
// vocabulary ("supplier contracts" -> LEGAL_WORKFLOW_PATTERN's bare
// "contract") won instead, cascading through createUnderstandingFallback's
// `contract` branch into a full Legal Assessment routing.
//
// Fixed in two places (defense in depth, matching the "audit end-to-end"
// requirement): understanding.ts's BUSINESS_WORKFLOW_PATTERN, and
// expertise-profile.ts's detectDomain() fallback, which can run
// independently if a caller doesn't propagate detectedDomain.
// app/lib/report-engine/domain.ts's classifyReportDomain already handled
// this correctly (explicitBusinessReportSignals is checked before any
// specialized-domain signal) and needed no change -- confirmed with a
// drift check below.

const { selectAnalysisWorkflow, createUnderstandingFallback } = await import(
  "../app/lib/ai/understanding.ts"
);
const { createExpertiseProfileFallback } = await import(
  "../app/lib/ai/expertise-profile.ts"
);
const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);

// --- Requirement 5: the 5 named regression scenarios --------------------

const enterpriseRiskPrompt =
  "I want a complete investor-grade business plan for an AI-powered enterprise risk intelligence platform. It analyzes sanctions exposure, compliance gaps, cyber incidents, supplier contracts, and geopolitical risk for large enterprises.";
const procurementPrompt =
  "I want a complete investor-grade business plan for an AI-powered procurement intelligence platform that reviews supplier contracts, purchase orders, and vendor compliance.";
const cybersecurityCompliancePrompt =
  "I want a business idea validation for a cybersecurity compliance platform that helps companies manage regulatory compliance and legal risk exposure.";
const analyzeContractLegallyPrompt =
  "Please analyze this contract legally and tell me the risks and obligations.";
const explicitLegalAssessmentPrompt =
  "I need a legal assessment of my situation -- I was terminated last week and believe it was unlawful.";

test("the exact live bug: enterprise risk intelligence + sanctions + compliance + cyber + supplier contracts + geopolitical risk, with an explicit business-plan request, routes to the business workflow", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: enterpriseRiskPrompt }), "business");
});

test("procurement intelligence + supplier contracts, with an explicit business-plan request, routes to the business workflow", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: procurementPrompt }), "business");
});

test("cybersecurity compliance platform + explicit business idea validation request routes to the business workflow", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: cybersecurityCompliancePrompt }), "business");
});

test("an explicit request to analyze a contract legally still routes to the legal workflow (no regression)", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: analyzeContractLegallyPrompt }), "legal");
});

test("an explicit request for a legal assessment still routes to the legal workflow (no regression)", () => {
  assert.equal(selectAnalysisWorkflow({ prompt: explicitLegalAssessmentPrompt }), "legal");
});

// --- Requirement 2/3: primary intent wins; domain terms alone never do --

test("supporting domain terms (sanctions, compliance, contracts, regulatory, legal risk) alone, with no explicit business-plan phrase and no in-hand legal case, still fall through to the legal workflow (documents current, correct behavior: an explicit report-format request is what's required to override, not merely also mentioning the domain terms)", () => {
  const bareSectorPrompt =
    "An enterprise platform covering sanctions exposure, regulatory compliance, legal risk, and contract analysis for large enterprises.";
  // No "business plan"/"business idea" phrase and no venture-launch verb
  // -- LEGAL_WORKFLOW_PATTERN's bare "contract"/"compliance"-adjacent
  // terms are the only signal present, so this is expected to still read
  // as a legal-shaped request. This is the control case proving the fix
  // is specifically about explicit intent, not a blanket exemption for
  // any prompt naming these words.
  assert.equal(selectAnalysisWorkflow({ prompt: bareSectorPrompt }), "legal");
});

test("createUnderstandingFallback for the exact live bug prompt selects the business_idea content type, not a contract/legal one", () => {
  const result = createUnderstandingFallback({ prompt: enterpriseRiskPrompt, assets: [] });
  assert.equal(result.detectedContentType, "business_idea");
  assert.equal(result.detectedIndustry, "startup");
  assert.notEqual(result.detectedIndustry, "legal");
});

// --- expertise-profile.ts: the same explicit-business guard, for callers ---
// --- that don't propagate a pre-resolved detectedDomain.                 ---

test("expertise-profile.ts's fallback resolves the exact live bug prompt to the business domain even with no selectedMode/detectedDomain hint supplied", () => {
  const profile = createExpertiseProfileFallback({ prompt: enterpriseRiskPrompt });
  assert.equal(profile.domain, "business");
});

test("expertise-profile.ts's fallback still resolves an explicit contract-review request to the legal domain (no regression)", () => {
  const profile = createExpertiseProfileFallback({ prompt: analyzeContractLegallyPrompt });
  assert.equal(profile.domain, "legal");
});

// --- domain.ts: already correct before this fix -- drift check only ----

test("report-engine/domain.ts's classifyReportDomain already resolves the exact live bug prompt to 'business' (was already correct, confirmed unaffected)", () => {
  assert.equal(classifyReportDomain(enterpriseRiskPrompt), "business");
  assert.equal(classifyReportDomain(procurementPrompt), "business");
});

test("resolveReportDomainForSelectedMode still unconditionally forces 'business' for selectedMode 'plan'/'market' regardless of any inferred domain (no regression)", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "plan", inferredDomain: "legal" }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "market", inferredDomain: "legal" }),
    "business"
  );
});

// --- Requirement 6: preserve all recent fixes (drift checks) ------------

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const reportPresentationSource = readFileSync("app/lib/report-presentation.ts", "utf8");
const financialModelSource = readFileSync("app/lib/ai/financial-model.ts", "utf8");
const marketResearchCoverageSource = readFileSync("app/lib/ai/market-research-coverage.ts", "utf8");
const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pdfSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

test("canonical decision consistency is preserved: plan-executor.ts still passes authoritativeExecutiveDecisionToken into the consistency pass", () => {
  assert.match(
    planExecutorSource,
    /authoritativeExecutiveDecisionToken:\s*localizeExecutiveDecision\(planExecutiveDecisionBrief\.decision,\s*language\)/
  );
});

test("prototype/design-partner evidence handling is preserved: promptReadiness still recognizes prototype/design-partner signals", () => {
  assert.match(marketResearchCoverageSource, /design partners\?\|pilot partners\?\|pilot customers\?/);
});

test("financial evidence labeling is preserved: the standardized 3-tier (Verified/Derived/Benchmark-Assumption) system still exists in both dashboard renderers", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /derived:\s*\{\s*English:\s*"Derived"/);
    assert.match(source, /benchmarkDerived:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /planningAssumption:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
    assert.match(source, /validationRequired:\s*\{\s*English:\s*"Benchmark \/ Assumption"/);
  }
});

test("geography preservation is preserved: Germany/France/Netherlands/Saudi Arabia/Qatar still resolve to their own country entries", () => {
  for (const country of ["Germany", "France", "Netherlands", "Saudi Arabia", "Qatar"]) {
    assert.match(financialModelSource, new RegExp(`"${country}"`));
  }
});

test("source/provenance separation is preserved: the zero-citations fallback still states 'External Sources: none available'", () => {
  for (const source of [pdfSource, plannerSource]) {
    assert.match(source, /"External Sources: none available for this report\."/);
  }
});

test("English canonical language enforcement is unaffected (drift check: buildStrictReportLanguageInstruction still exists and is used by domain-analysis prompts)", () => {
  const domainAnalysisSource = readFileSync("app/lib/report-engine/prompts/domain-analysis.ts", "utf8");
  assert.match(domainAnalysisSource, /buildStrictReportLanguageInstruction/);
});

test("cross-report isolation is unaffected: assertReportIsolation is still invoked from plan-executor.ts", () => {
  assert.match(planExecutorSource, /assertReportIsolation\("business_plan", deduped\)/);
});

test("benchmark classification is unaffected: report-presentation.ts's cleanupTemplatePresentationArtifacts is still exported and wired into plan-executor.ts", () => {
  assert.match(reportPresentationSource, /export function cleanupTemplatePresentationArtifacts/);
  assert.match(planExecutorSource, /cleanupTemplatePresentationArtifacts\(normalized\[field\]\)/);
});
