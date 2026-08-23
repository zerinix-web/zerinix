import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- Prevent Legal Assessment routing from hijacking Market
// Intelligence requests.
//
// Bug: "I want a Market Intelligence analysis, not a legal analysis." and
// "Create a Market Intelligence Report." both contain the bare word
// "legal" (as an explicit negation, or as a regulated sector's own name
// in a prompt like "Evaluate AI legal compliance software market for
// SMEs") -- and the two canonical domain classifiers this app uses had an
// unconditional, bare-keyword "legal" check with zero Market Intelligence
// awareness, so it claimed these prompts before any market-research
// signal got a chance to run.
//
// Fixed at both classifiers, the same priority-ordering fix in each,
// mirroring the existing isVentureEvaluation/explicitBusinessReportSignals
// guard each file already had for Business Plan intent:
//
// 1. app/lib/report-engine/domain.ts's classifyReportDomain -- the
//    canonical domain classifier fed into report generation
//    (plan-executor.ts's inferredReportDomain, and the detectedDomain
//    fallback for createExpertiseProfileFallback). Added a check
//    (marketIntelligenceLegalPriorityPattern, a superset of this file's
//    own marketIntelligenceIntentSignals) at the same priority position as
//    the existing explicitBusinessReportSignals/ventureCreationSignals
//    guard, ahead of every specializedDomainSignals entry including
//    "legal".
// 2. app/lib/ai/understanding.ts's selectAnalysisWorkflow -- the
//    "Understanding" preview classifier's own deterministic fallback.
//    Added MARKET_INTELLIGENCE_WORKFLOW_PATTERN, checked at the same
//    priority position (and same hasLegalCaseInHandSignal gating) as the
//    existing isVentureEvaluation/BUSINESS_WORKFLOW_PATTERN guard
//    immediately above it.
//
// Both new patterns require an unambiguous compound market-research
// phrase or one of the report's own named triggers (Market Intelligence,
// TAM/SAM/SOM, entry strategy, competitors analysis) -- never a bare
// "market"/"industry" word alone, matching this codebase's established
// anti-false-positive discipline (see acquisitionSignals/
// marketIntelligenceIntentSignals's own comments in domain.ts). Both are
// gated so a prompt with a genuine legal matter in hand is never blocked
// from routing to Legal Assessment just because it also mentions a
// market/competitor/TAM-SAM-SOM concept in passing.
//
// A third layer (app/lib/ai/expertise-profile.ts's resolveExpertiseProfile)
// was investigated and confirmed NOT to need a change: for a chat-mode
// prompt whose local classification lands on "legal",
// createExpertiseProfileFallback's own existing "inferredDomain === legal"
// remap already downgrades it (first to "general" internally, then to
// "business" in its final return value -- see the "normalizedDomain"
// line near the end of that function) BEFORE resolveExpertiseProfile ever
// sees it, and resolveExpertiseProfile's domain-match guard then already
// rejects any AI-supplied candidate that disagrees with that "business"
// fallback. See the end-to-end tests below, which prove this with the
// real (unmodified) functions rather than assuming it.
//
// Preserved and confirmed below: Business Plan routing, Acquisition
// routing, Market Intelligence generation (resolveReportDomainForSelectedMode's
// "market" mode branch), and the centralized decision vocabulary.

const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
const understandingSource = readFileSync(new URL("../app/lib/ai/understanding.ts", import.meta.url), "utf8");

const HIJACK_PROMPT_1 = "I want a Market Intelligence analysis, not a legal analysis.";
const HIJACK_PROMPT_2 = "Create a Market Intelligence Report.";
const HIJACK_PROMPT_3 = "Evaluate AI legal compliance software market for SMEs";
const GENUINE_LEGAL_PROMPT =
  "I need legal advice about my employer terminating me last week; the filing deadline is next Friday.";

// --- 1. classifyReportDomain (domain.ts) --------------------------------

test("classifyReportDomain routes all three required Market Intelligence prompts to 'business', not 'legal'", async () => {
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain(HIJACK_PROMPT_1), "business");
  assert.equal(classifyReportDomain(HIJACK_PROMPT_2), "business");
  assert.equal(classifyReportDomain(HIJACK_PROMPT_3), "business");
});

test("classifyReportDomain still routes a genuine legal-advice request to 'legal'", async () => {
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain(GENUINE_LEGAL_PROMPT), "legal");
});

test("classifyReportDomain preserves Acquisition and Business Plan routing (drift check)", async () => {
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain("I want to acquire a cybersecurity SaaS company."), "acquisition");
  assert.equal(classifyReportDomain("Create a business plan for my new SaaS startup."), "business");
});

// --- 2. selectAnalysisWorkflow (understanding.ts) -----------------------

test("selectAnalysisWorkflow routes all three required Market Intelligence prompts to 'business', not 'legal'", async () => {
  const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");
  assert.equal(selectAnalysisWorkflow({ prompt: HIJACK_PROMPT_1 }), "business");
  assert.equal(selectAnalysisWorkflow({ prompt: HIJACK_PROMPT_2 }), "business");
  assert.equal(selectAnalysisWorkflow({ prompt: HIJACK_PROMPT_3 }), "business");
});

test("selectAnalysisWorkflow still routes a genuine legal-advice request (with a case-in-hand signal) to 'legal'", async () => {
  const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");
  assert.equal(selectAnalysisWorkflow({ prompt: GENUINE_LEGAL_PROMPT }), "legal");
  assert.equal(
    selectAnalysisWorkflow({
      prompt: "I was dismissed from my job and need to understand my legal options.",
    }),
    "legal"
  );
});

test("selectAnalysisWorkflow preserves Acquisition and Business Plan routing (drift check)", async () => {
  const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");
  assert.equal(
    selectAnalysisWorkflow({ prompt: "I want to acquire a cybersecurity SaaS company." }),
    "acquisition"
  );
  assert.equal(
    selectAnalysisWorkflow({ prompt: "Create a business plan for my new SaaS startup." }),
    "business"
  );
});

// --- 3. Preserve: Market Intelligence generation, Business Plan, --------
// --- Acquisition routing, and the centralized decision vocabulary -------

test("resolveReportDomainForSelectedMode's Market Intelligence and Business Plan mode branches are untouched (drift check)", async () => {
  const { resolveReportDomainForSelectedMode } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "market", inferredDomain: "legal" }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "plan", inferredDomain: "legal" }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "plan", inferredDomain: "acquisition" }),
    "acquisition"
  );
});

test("the centralized executive decision vocabulary is untouched (drift check)", () => {
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    vocabularySource,
    /"PROCEED"\s*\|\s*"PROCEED_WITH_CONDITIONS"\s*\|\s*"PAUSE_PENDING_REVIEW"\s*\|\s*"REJECT"/
  );
});

test("applyPromptIntentModeOverride (the plan->market mode override) and its underlying marketIntelligenceIntentSignals pattern are untouched by this fix", () => {
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
  // The new marketIntelligenceLegalPriorityPattern is a superset built
  // from marketIntelligenceIntentSignals.source, not a replacement of it.
  assert.match(domainSource, /const marketIntelligenceIntentSignals =/);
  assert.match(
    domainSource,
    /marketIntelligenceLegalPriorityPattern = new RegExp\(\s*\n\s*marketIntelligenceIntentSignals\.source/
  );
});

test("expertise-profile.ts (resolveExpertiseProfile / createExpertiseProfileFallback) is untouched by this fix (drift check)", () => {
  const expertiseProfileSource = readFileSync(
    new URL("../app/lib/ai/expertise-profile.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(expertiseProfileSource, /marketIntelligenceLegalPriorityPattern|MARKET_INTELLIGENCE_WORKFLOW_PATTERN/);
});

test("the new guards are gated by legal-case-in-hand detection, never unconditional (source check)", () => {
  assert.match(understandingSource, /isMarketIntelligenceEvaluation && !hasLegalCaseInHandSignal/);
});

test("the acquisition signal check retains top priority ahead of the new Market Intelligence guard in both classifiers (source check)", () => {
  const domainAcquisitionIndex = domainSource.indexOf("if (acquisitionSignals.test(combined))");
  const domainMarketGuardIndex = domainSource.indexOf("if (marketIntelligenceLegalPriorityPattern.test(prompt))");
  assert.ok(domainAcquisitionIndex > -1 && domainMarketGuardIndex > -1);
  assert.ok(domainAcquisitionIndex < domainMarketGuardIndex);

  const workflowAcquisitionIndex = understandingSource.indexOf(
    'if (ACQUISITION_WORKFLOW_PATTERN.test(combined)) return "acquisition";'
  );
  const workflowMarketGuardIndex = understandingSource.indexOf(
    "const isMarketIntelligenceEvaluation = MARKET_INTELLIGENCE_WORKFLOW_PATTERN.test(combined);"
  );
  assert.ok(workflowAcquisitionIndex > -1 && workflowMarketGuardIndex > -1);
  assert.ok(workflowAcquisitionIndex < workflowMarketGuardIndex);
});

// --- 4. End-to-end simulation of the full generation-time domain chain --
// --- (classifyReportDomain -> createExpertiseProfileFallback ->        --
// --- resolveExpertiseProfile -> resolveReportDomainForSelectedMode),   --
// --- exactly as app/lib/report-jobs/plan-executor.ts wires them, for   --
// --- a Strategic Advisory ("chat" mode) request -----------------------

function makeExpertiseProfile(domain) {
  return {
    domain,
    subdomain: "general",
    taskType: "general_assessment",
    jurisdiction: "Global",
    userGoal: "test",
    professionalPerspective: "advisor",
    requiredAnalyses: [],
    decisionCriteria: [],
    requiredEvidence: [],
    forbiddenTopics: [],
    criticalClarifications: [],
    confidence: 0.8,
  };
}

test("end-to-end: the full chat-mode domain chain never produces 'legal' for the reported bug prompts, even simulating an AI candidate that independently (and wrongly) votes 'legal'", async () => {
  const { createExpertiseProfileFallback, resolveExpertiseProfile } = await import(
    "../app/lib/ai/expertise-profile.ts"
  );
  const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
    "../app/lib/report-engine/domain.ts"
  );

  for (const prompt of [HIJACK_PROMPT_1, HIJACK_PROMPT_2, HIJACK_PROMPT_3]) {
    const inferredReportDomain = classifyReportDomain(prompt);
    assert.equal(inferredReportDomain, "business");

    const expertiseFallback = createExpertiseProfileFallback({
      prompt,
      selectedMode: "chat",
      detectedDomain: inferredReportDomain,
    });
    const hijackingAiCandidate = makeExpertiseProfile("legal");
    const expertiseProfile = resolveExpertiseProfile(hijackingAiCandidate, expertiseFallback, "chat");
    const reportDomain = resolveReportDomainForSelectedMode({
      selectedMode: "chat",
      inferredDomain: inferredReportDomain,
      expertiseDomain: expertiseProfile.domain,
    });

    assert.notEqual(reportDomain, "legal", `reportDomain must not be 'legal' for: ${prompt}`);
    assert.equal(reportDomain, "business", `reportDomain should be 'business' for: ${prompt}`);
  }
});

test("end-to-end: createExpertiseProfileFallback's own pre-existing 'legal' -> 'business' remap for chat mode is what protects resolveExpertiseProfile downstream -- confirmed unchanged by this fix", async () => {
  const { createExpertiseProfileFallback, resolveExpertiseProfile } = await import(
    "../app/lib/ai/expertise-profile.ts"
  );
  const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
    "../app/lib/report-engine/domain.ts"
  );

  const inferredReportDomain = classifyReportDomain(GENUINE_LEGAL_PROMPT);
  assert.equal(inferredReportDomain, "legal");

  const expertiseFallback = createExpertiseProfileFallback({
    prompt: GENUINE_LEGAL_PROMPT,
    selectedMode: "chat",
    detectedDomain: inferredReportDomain,
  });
  // createExpertiseProfileFallback's own remap already substitutes
  // "business" here for chat mode, regardless of this fix.
  assert.equal(expertiseFallback.domain, "business");

  const expertiseProfile = resolveExpertiseProfile(expertiseFallback, expertiseFallback, "chat");
  const reportDomain = resolveReportDomainForSelectedMode({
    selectedMode: "chat",
    inferredDomain: inferredReportDomain,
    expertiseDomain: expertiseProfile.domain,
  });
  assert.equal(reportDomain, "business");
});
