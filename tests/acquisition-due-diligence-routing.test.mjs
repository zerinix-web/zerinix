import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL PRODUCTION FIX -- Acquisition Due Diligence Routing.
//
// A prompt requesting acquisition/M&A due diligence was being routed to
// a "Legal Assessment Report" (or, depending on wording, a generic
// Business Validation / Finance domain-analysis report), producing
// generic startup validation metrics (burn rate, runway, validation
// readiness, execution scoring) that have no place in analyzing the
// acquisition of an already-operating company.
//
// Root cause: none of the three independent domain classifiers
// (report-engine/domain.ts's classifyReportDomain -- the real,
// production-live one; expertise-profile.ts's detectDomain fallback;
// understanding.ts's selectAnalysisWorkflow) had any acquisition/M&A
// vocabulary, so an acquisition prompt fell through to whichever of
// legal/business/finance's own signals happened to also match (M&A
// due-diligence language routinely also mentions the target's existing
// contracts, compliance, and valuation/revenue).
//
// Fix: a new "acquisition" ReportDomain/ExpertiseProfile domain/
// AnalysisWorkflow value, detected via a dedicated acquisitionSignals
// pattern checked BEFORE every other specialized-domain signal in all
// three classifiers, routed through the existing generic domain-analysis
// pipeline (same as legal/finance/accounting/operations/procurement) with
// its own domainRole, content-shaping directives, and forbidden-term
// isolation list -- never through Business Idea Validation, Market
// Intelligence, or Legal Assessment.

const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);
const { createExpertiseProfileFallback } = await import(
  "../app/lib/ai/expertise-profile.ts"
);
const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");
const { buildDomainAnalysisInstructions } = await import(
  "../app/lib/report-engine/prompts/domain-analysis.ts"
);
const {
  assertReportIsolation,
  findReportIsolationViolations,
  getForbiddenTermLabels,
} = await import("../app/lib/report-engine/report-isolation-validator.ts");

// --- Requirement: acquisition prompts classify as "acquisition", never --
// --- "legal", "business", or "finance" -- for every named concept.      --

const acquisitionPrompts = {
  plainAcquisition:
    "We are evaluating the acquisition of a mid-market logistics company. Please assess whether this is a good acquisition.",
  acquireCompany:
    "Our corporate development team wants to acquire a company in the fintech space. Assess the target.",
  merger:
    "We are considering a merger with a competitor in the same industry. Assess the strategic fit.",
  mAndA:
    "Our M&A team needs an assessment of a potential target company before we proceed.",
  dueDiligence:
    "Please perform due diligence on this target company ahead of a potential purchase.",
  acquisitionTarget:
    "We have identified an acquisition target and need a full assessment before making an offer.",
  valuationAndPurchasePrice:
    "We are buying a SaaS company. Please assess the purchase price, using EV/ARR and comparable transactions to determine a fair purchase multiple.",
  enterpriseValueEvArr:
    "Assess the enterprise value and EV/ARR multiple implied by the asking price for this acquisition target.",
  financingStructureDebtFinancing:
    "We need to assess the financing structure for this acquisition, including debt financing and available leverage.",
  integrationSynergies:
    "Assess the post-merger integration risk and expected operational, revenue, and cost synergies for this acquisition.",
  postMerger:
    "We need a post-merger integration roadmap for the first 30, 60, and 90 days after closing this acquisition.",
  buyout:
    "We are structuring a leveraged buyout of an established manufacturing company.",
  corporateAcquisition:
    "Our corporation is planning a corporate acquisition of a smaller competitor. Please assess the deal.",
  // Deliberately ALSO contains ordinary legal vocabulary (the exact
  // failure mode from the live bug): the target's contracts, compliance,
  // liability. This must still route to acquisition, not legal.
  acquisitionWithLegalVocabulary:
    "We are conducting due diligence on an acquisition target. Please review the target's existing contracts, compliance posture, liability exposure, and indemnity provisions, and assess whether this acquisition should proceed.",
  // Deliberately ALSO contains ordinary business/startup vocabulary (the
  // target being acquired IS a startup) -- must still route to
  // acquisition, not business validation.
  acquisitionOfAStartup:
    "A larger company wants to acquire our startup. Please assess the acquisition attractiveness, valuation, and purchase price fairness of this deal.",
  // Deliberately ALSO contains ordinary finance vocabulary (valuation,
  // revenue, margin) -- must still route to acquisition, not the generic
  // finance domain analysis.
  acquisitionWithFinanceVocabulary:
    "We are assessing an acquisition. Please review the target's financial statements, revenue, and margin, and provide a valuation and purchase price recommendation.",
};

test("classifyReportDomain: every named acquisition/M&A concept classifies as 'acquisition'", () => {
  for (const [name, prompt] of Object.entries(acquisitionPrompts)) {
    assert.equal(
      classifyReportDomain(prompt),
      "acquisition",
      `scenario "${name}" did not classify as acquisition`
    );
  }
});

test("classifyReportDomain: acquisition prompts never classify as legal, business, real_estate, or finance", () => {
  for (const [name, prompt] of Object.entries(acquisitionPrompts)) {
    const domain = classifyReportDomain(prompt);
    assert.notEqual(domain, "legal", `scenario "${name}" misrouted to legal`);
    assert.notEqual(domain, "business", `scenario "${name}" misrouted to business`);
    assert.notEqual(domain, "real_estate", `scenario "${name}" misrouted to real_estate`);
    assert.notEqual(domain, "finance", `scenario "${name}" misrouted to finance`);
  }
});

// --- No false positives: bare generic words elsewhere in an ordinary   --
// --- business/finance/legal prompt must never trigger acquisition.     --

test("classifyReportDomain: a bare generic word (leverage, integration, synergies, valuation) alone, with no M&A context, does not trigger acquisition routing", () => {
  const genericPrompts = {
    startupLeverage:
      "I want to build a business plan for a SaaS startup. How should we leverage our customer data to improve retention?",
    apiIntegration:
      "I want a business plan for a platform that offers API integration with third-party tools for developers.",
    teamSynergies:
      "I want a business plan for a workplace collaboration app that helps teams find synergies across departments.",
    startupValuation:
      "I want a business plan for my startup. What is a reasonable valuation for our seed round?",
  };

  for (const [name, prompt] of Object.entries(genericPrompts)) {
    assert.notEqual(
      classifyReportDomain(prompt),
      "acquisition",
      `scenario "${name}" was incorrectly routed to acquisition from a bare generic word`
    );
  }
});

// --- Requirement: never reachable from Business Idea Validation or     --
// --- Market Intelligence -- both remain hard-forced to "business",     --
// --- matching the existing architecture for every other specialized    --
// --- domain (real_estate/legal/finance/...).                          --

test("resolveReportDomainForSelectedMode: an acquisition-classified prompt under the 'plan' (Business Idea Validation) or 'market' (Market Intelligence) product still forces 'business', never 'acquisition'", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "acquisition",
      expertiseDomain: "acquisition",
    }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "market",
      inferredDomain: "acquisition",
      expertiseDomain: "acquisition",
    }),
    "business"
  );
});

test("resolveReportDomainForSelectedMode: Strategic Advisory ('chat') with an acquisition expertiseDomain resolves to 'acquisition'", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "chat",
      inferredDomain: "business",
      expertiseDomain: "acquisition",
    }),
    "acquisition"
  );
});

// --- selectAnalysisWorkflow (understanding.ts) -------------------------

test("selectAnalysisWorkflow: acquisition/M&A prompts route to the 'acquisition' workflow, never 'legal' or 'business'", () => {
  for (const [name, prompt] of Object.entries(acquisitionPrompts)) {
    const workflow = selectAnalysisWorkflow({ prompt });
    assert.equal(workflow, "acquisition", `scenario "${name}" did not route to the acquisition workflow (got ${workflow})`);
  }
});

test("selectAnalysisWorkflow: an explicit legal case (no acquisition context) still routes to 'legal' (no regression)", () => {
  assert.equal(
    selectAnalysisWorkflow({
      prompt: "I need a legal assessment of my situation -- I was terminated last week and believe it was unlawful.",
    }),
    "legal"
  );
});

// --- createExpertiseProfileFallback (expertise-profile.ts) -------------

test("createExpertiseProfileFallback: an acquisition-detected prompt (no detectedDomain supplied, exercising the internal fallback classifier) returns domain 'acquisition' with acquisition-specific analyses and forbidden startup-pitch topics", () => {
  const profile = createExpertiseProfileFallback({
    prompt: acquisitionPrompts.plainAcquisition,
  });

  assert.equal(profile.domain, "acquisition");
  assert.equal(profile.subdomain, "acquisition_due_diligence");
  assert.match(profile.professionalPerspective, /M&A|due-diligence|corporate development/i);
  assert.ok(profile.requiredAnalyses.some((item) => /valuation/i.test(item)));
  assert.ok(profile.requiredAnalyses.some((item) => /financing/i.test(item)));
  assert.ok(profile.requiredAnalyses.some((item) => /integration/i.test(item)));
  assert.ok(profile.forbiddenTopics.some((topic) => /founder readiness/i.test(topic)));
  assert.ok(profile.forbiddenTopics.some((topic) => /product-market fit/i.test(topic)));
});

test("createExpertiseProfileFallback: passing classifyReportDomain's own 'acquisition' output as detectedDomain (the real production wiring) also resolves to domain 'acquisition'", () => {
  const detected = classifyReportDomain(acquisitionPrompts.acquisitionWithLegalVocabulary);
  const profile = createExpertiseProfileFallback({
    prompt: acquisitionPrompts.acquisitionWithLegalVocabulary,
    detectedDomain: detected,
  });

  assert.equal(detected, "acquisition");
  assert.equal(profile.domain, "acquisition");
});

// Note: createExpertiseProfileFallback's own `domain` field can still say
// "acquisition" under an explicit "plan"/"market" selectedMode -- exactly
// like every other specialized domain (real_estate, finance, ...) except
// "legal" (which has its own special-cased override). This mirrors the
// pre-existing architecture: expertiseProfile.domain is descriptive, and
// the actual hard boundary that guarantees "plan"/"market" can never
// surface a specialized-domain product is enforced one layer later, by
// resolveReportDomainForSelectedMode (see the dedicated test above) --
// the real production call sites (route.ts, plan-executor.ts) always
// resolve the final report domain through that function, never directly
// off expertiseProfile.domain.
test("resolveReportDomainForSelectedMode (not createExpertiseProfileFallback's own domain field) is the actual enforcement point: even when expertiseProfile.domain says 'acquisition' under 'plan'/'market', the final resolved domain is 'business'", () => {
  for (const selectedMode of ["plan", "market"]) {
    const profile = createExpertiseProfileFallback({
      prompt: acquisitionPrompts.plainAcquisition,
      selectedMode,
    });
    const finalDomain = resolveReportDomainForSelectedMode({
      selectedMode,
      inferredDomain: classifyReportDomain(acquisitionPrompts.plainAcquisition),
      expertiseDomain: profile.domain,
    });
    assert.equal(finalDomain, "business", `selectedMode "${selectedMode}" did not force business`);
  }
});

// --- buildDomainAnalysisInstructions (domain-analysis.ts) --------------

test("buildDomainAnalysisInstructions('acquisition', ...) covers every required content area and forbids fabricated startup metrics", () => {
  const instructions = buildDomainAnalysisInstructions("acquisition", "English");

  assert.match(instructions, /M&A due-diligence/i);
  assert.match(instructions, /acquisition attractiveness/i);
  assert.match(instructions, /EV\/ARR/);
  assert.match(instructions, /comparable transactions/i);
  assert.match(instructions, /purchase multiple/i);
  assert.match(instructions, /purchase price fairness/i);
  assert.match(instructions, /financing structure/i);
  assert.match(instructions, /debt capacity/i);
  assert.match(instructions, /ROI scenarios/i);
  assert.match(instructions, /IRR estimates/i);
  assert.match(instructions, /integration risk/i);
  assert.match(instructions, /operational synergies/i);
  assert.match(instructions, /revenue synergies/i);
  assert.match(instructions, /cost synergies/i);
  assert.match(instructions, /technology integration/i);
  assert.match(instructions, /cultural integration/i);
  assert.match(instructions, /regulatory considerations|Regulatory and Compliance/i);
  assert.match(instructions, /30, 60, and 90|30\/60\/90/);
  assert.match(instructions, /investment recommendation/i);
  assert.match(instructions, /executive decision/i);
  assert.match(instructions, /burn rate/i);
  assert.match(instructions, /runway/i);
  assert.match(instructions, /\bCAC\b/);
  assert.match(instructions, /\bLTV\b/);
  assert.match(instructions, /churn/i);
  assert.match(instructions, /ARR growth/i);
  assert.match(instructions, /Planning Assumption/);
});

test("buildDomainAnalysisInstructions: the acquisition-specific directives never leak into any other specialized domain's instructions", () => {
  for (const domain of ["legal", "finance", "accounting", "operations", "procurement"]) {
    const instructions = buildDomainAnalysisInstructions(domain, "English");
    assert.doesNotMatch(
      instructions,
      /Acquisition Due Diligence Report|post-merger integration roadmap|EV\/ARR/i,
      `${domain} instructions unexpectedly contain acquisition-specific directives`
    );
  }
});

// --- Report isolation: acquisition report never carries startup-       --
// --- scoring vocabulary, but legitimate evidence-based metrics (the    --
// --- target's real ARR/CAC/Runway) are never blocked outright.        --

test("assertReportIsolation('acquisition_due_diligence', ...) rejects startup-scoring vocabulary (Founder Score, PMF, decision-verdict tokens)", () => {
  const violatingSections = {
    domainFindings: "The target shows strong Founder Readiness and a high Product-Market Fit score.",
  };
  assert.throws(() => assertReportIsolation("acquisition_due_diligence", violatingSections));

  const violatingSections2 = {
    finalRecommendation: "Our recommendation is PASS based on the Founder Score.",
  };
  assert.throws(() => assertReportIsolation("acquisition_due_diligence", violatingSections2));
});

test("assertReportIsolation('acquisition_due_diligence', ...) never blocks legitimate, evidence-based ARR/CAC/LTV/Runway/EBITDA mentions (these are real acquisition-analysis vocabulary, not startup-pitch vocabulary)", () => {
  const legitimateSections = {
    financialImplications:
      "The target reports $12M ARR and a CAC of $4,200 per enterprise account. EBITDA margin is 18%. Post-close runway under the proposed financing structure is 24 months.",
  };

  assert.doesNotThrow(() => assertReportIsolation("acquisition_due_diligence", legitimateSections));
  assert.deepEqual(findReportIsolationViolations("acquisition_due_diligence", legitimateSections), []);
});

test("assertReportIsolation('acquisition_due_diligence', ...) passes for a clean, on-topic acquisition report", () => {
  const cleanSections = {
    domainFindings: "The target company is a well-positioned acquisition candidate with a defensible market position.",
    financialImplications: "Valuation is supported by an EV/ARR multiple of 6.2x against comparable transactions. Purchase price of $48M appears fair.",
    operationalImplications: "Integration risk is moderate; expected operational and cost synergies of $2M annually within 18 months.",
    recommendedActions: "Days 1-30: finalize integration team and retention plan. Days 31-60: begin systems integration. Days 61-90: realize first cost synergies.",
    finalRecommendation: "Recommendation: proceed conditionally on confirmed financing terms.",
  };

  assert.doesNotThrow(() => assertReportIsolation("acquisition_due_diligence", cleanSections));
});

test("getForbiddenTermLabels('acquisition_due_diligence') names startup-scoring vocabulary but not raw metric names (ARR/CAC/LTV/Runway/EBITDA)", () => {
  const labels = getForbiddenTermLabels("acquisition_due_diligence").join(" | ").toLowerCase();
  assert.match(labels, /founder/);
  assert.match(labels, /product-market fit/);
  assert.doesNotMatch(labels, /\bcac\b/);
  assert.doesNotMatch(labels, /\bltv\b/);
  assert.doesNotMatch(labels, /\barr\b/);
  assert.doesNotMatch(labels, /runway/);
  assert.doesNotMatch(labels, /ebitda/);
});

// --- Research/evidence-quality layer must recognize "acquisition" too --
// --- (drift check against the exact bug class this codebase has hit   --
// --- before: an unrecognized domain silently reduces evidence to      --
// --- zero, see domain-research.ts's own comment on this).             --

test("domain-research.ts and decision-intelligence recognize 'acquisition' as a first-class research domain (drift check, prevents silent zero-evidence)", () => {
  const domainResearchSource = readFileSync(
    new URL("../app/lib/ai/domain-research.ts", import.meta.url),
    "utf8"
  );
  assert.match(domainResearchSource, /export type ResearchDomain =[\s\S]*?"acquisition"/);
  assert.match(domainResearchSource, /acquisition:\s*\{[\s\S]*?criticalFields:/);

  const contractsSource = readFileSync(
    new URL("../app/lib/decision-intelligence/contracts.ts", import.meta.url),
    "utf8"
  );
  assert.match(contractsSource, /export type DecisionDomain =[\s\S]*?"acquisition"/);

  const profilesSource = readFileSync(
    new URL("../app/lib/decision-intelligence/profiles.ts", import.meta.url),
    "utf8"
  );
  assert.match(profilesSource, /acquisition:\s*\{[\s\S]*?id:\s*"acquisition"/);
});

// --- plan-executor.ts wiring (drift checks; the file is too large and --
// --- side-effectful to import wholesale in a unit test, matching the  --
// --- existing convention used by other plan-executor.ts test files). --

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

test("plan-executor.ts routes reportDomain === 'acquisition' into the specialized domain-analysis pipeline (drift check)", () => {
  assert.match(
    planExecutorSource,
    /reportDomain === "procurement" ||\s*\n\s*reportDomain === "acquisition"/
  );
});

test("plan-executor.ts runs assertReportIsolation('acquisition_due_diligence', ...) at every presentedReport construction site (drift check)", () => {
  const occurrences = planExecutorSource.match(/assertReportIsolation\("acquisition_due_diligence"/g) || [];
  assert.equal(occurrences.length, 3, `expected 3 assertReportIsolation("acquisition_due_diligence", ...) call sites, found ${occurrences.length}`);
});

test("plan-executor.ts never routes 'acquisition' through the legal-specific post-processing (prepareLegalDecisionReport/assessLegalResearchCoverage remain gated on domain === \"legal\" only)", () => {
  assert.doesNotMatch(planExecutorSource, /domain === "acquisition"[\s\S]{0,80}prepareLegalDecisionReport/);
  assert.doesNotMatch(planExecutorSource, /domain === "acquisition"[\s\S]{0,80}assessLegalResearchCoverage/);
});

// --- User-provided facts must always be preserved (requirement:        --
// --- "Always preserve every user-provided fact exactly") --------------

test("buildDomainAnalysisInstructions instructs the model to preserve verified target-company figures exactly, not withhold them", () => {
  const instructions = buildDomainAnalysisInstructions("acquisition", "English");
  assert.match(instructions, /must be preserved exactly, not withheld/i);
});
