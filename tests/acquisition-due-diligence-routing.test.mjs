import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL PRODUCTION FIX -- Acquisition Due Diligence Routing + dedicated
// schema.
//
// Turn 1: a prompt requesting acquisition/M&A due diligence was being
// routed to a "Legal Assessment Report" (or, depending on wording, a
// generic Business Validation / Finance domain-analysis report), producing
// generic startup validation metrics (burn rate, runway, validation
// readiness, execution scoring) that have no place in analyzing the
// acquisition of an already-operating company. Fixed with a new
// "acquisition" ReportDomain, detected via a dedicated acquisitionSignals
// pattern checked BEFORE every other specialized-domain signal in all
// three domain classifiers (classifyReportDomain, expertise-profile's
// detectDomain fallback, understanding's selectAnalysisWorkflow).
//
// Turn 2: "acquisition" initially reused the GENERIC domain-analysis
// 14-field schema (Domain Findings, Financial Implications, Operational
// Implications, ...) shared with legal/finance/accounting/operations/
// procurement, with acquisition-specific content only steered via prompt
// directives layered on top of those generic field names. This gives
// Acquisition Due Diligence its own fully dedicated schema
// (acquisition-analysis.ts) and its own dedicated generator
// (generateAcquisitionDueDiligenceReport in plan-executor.ts) with
// acquisition-specific field names only -- never the generic
// domain-analysis field names, and never any Business Plan/Startup field
// (Founder Roadmap, Go-to-Market Plan, Pricing Strategy, CAC/LTV
// validation, TAM/SAM/SOM, Product validation).

const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);
const { createExpertiseProfileFallback } = await import(
  "../app/lib/ai/expertise-profile.ts"
);
const { selectAnalysisWorkflow } = await import("../app/lib/ai/understanding.ts");
const {
  acquisitionAnalysisFields,
  acquisitionAnalysisFieldLabels,
  buildAcquisitionAnalysisInstructions,
  validateAcquisitionAnalysisReport,
} = await import("../app/lib/report-engine/prompts/acquisition-analysis.ts");
const { domainAnalysisFields, buildDomainAnalysisInstructions } = await import(
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

// --- Requirement (revised, confirmed product decision): every OTHER    --
// --- specialized domain (real_estate/legal/finance/...) remains hard-  --
// --- forced to "business" under both "plan" and "market". Acquisition  --
// --- is the one deliberate exception, and only under "plan": there is  --
// --- no dedicated M&A entry point, so a user evaluating an acquisition --
// --- most naturally clicks "Business Idea Validation" (the first,      --
// --- most prominent card) -- confirmed live: every acquisition prompt  --
// --- was still rendering as a Business Plan because of this exact      --
// --- boundary. "market" keeps the old unconditional "business" behavior --
// --- (Market Intelligence is market research, not a decision report,   --
// --- and its own pipeline never consults this function for routing).  --

test("resolveReportDomainForSelectedMode: an acquisition-classified prompt under 'plan' (Business Idea Validation) now resolves to 'acquisition' -- the confirmed fix for the live bug where every acquisition prompt rendered as a Business Plan regardless of content", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "acquisition",
      expertiseDomain: "acquisition",
    }),
    "acquisition"
  );
});

test("resolveReportDomainForSelectedMode: an acquisition-classified prompt under 'market' (Market Intelligence) still forces 'business' -- the acquisition exception is scoped to 'plan' only", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "market",
      inferredDomain: "acquisition",
      expertiseDomain: "acquisition",
    }),
    "business"
  );
});

test("resolveReportDomainForSelectedMode: every OTHER specialized domain (real_estate/legal/finance/accounting/operations/procurement) still unconditionally forces 'business' under 'plan' -- the exception is acquisition-only, no other domain gained a new escape hatch", () => {
  for (const domain of ["real_estate", "legal", "finance", "accounting", "operations", "procurement"]) {
    assert.equal(
      resolveReportDomainForSelectedMode({
        selectedMode: "plan",
        inferredDomain: domain,
        expertiseDomain: domain,
      }),
      "business",
      `domain "${domain}" unexpectedly escaped "plan" mode`
    );
  }
});

test("resolveReportDomainForSelectedMode: a non-acquisition inferredDomain under 'plan' still forces 'business' even when expertiseDomain independently says 'acquisition' (the escape is keyed off the fresh classifyReportDomain-derived inferredDomain, not the possibly-stale expertiseDomain)", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain: "business",
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

test("resolveReportDomainForSelectedMode is the actual enforcement point for the final routed domain: under 'plan' it now resolves an acquisition prompt to 'acquisition' (the confirmed fix), while 'market' still forces 'business' for the same prompt", () => {
  const inferredDomain = classifyReportDomain(acquisitionPrompts.plainAcquisition);
  assert.equal(inferredDomain, "acquisition");

  const planProfile = createExpertiseProfileFallback({
    prompt: acquisitionPrompts.plainAcquisition,
    selectedMode: "plan",
  });
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain,
      expertiseDomain: planProfile.domain,
    }),
    "acquisition"
  );

  const marketProfile = createExpertiseProfileFallback({
    prompt: acquisitionPrompts.plainAcquisition,
    selectedMode: "market",
  });
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "market",
      inferredDomain,
      expertiseDomain: marketProfile.domain,
    }),
    "business"
  );
});

// --- The dedicated acquisition schema itself: acquisition-specific     --
// --- field names only -- never the generic domain-analysis field       --
// --- names, and never any Business Plan/Startup field.                --

const genericDomainAnalysisOnlyFieldNames = [
  "domainFindings",
  "financialImplications",
  "operationalImplications",
  "riskAnalysis",
  "scenarioAnalysis",
  "decisionAssessment",
  "recommendedActions",
  "finalRecommendation",
  "regulatoryCompliance",
  "extractedFacts",
];

const businessPlanStartupFieldNames = [
  "founderRoadmap",
  "goToMarketPlan",
  "pricingStrategy",
  "tamSamSom",
  "kpiDashboard",
  "founderScore",
  "unitEconomics",
  "salesStrategy",
  "businessModel",
  "swotAnalysis",
  "portersFiveForces",
  "competitorLandscape",
  "financialAssumptions",
  "roadmap306090",
];

test("acquisitionAnalysisFields never contains a generic domain-analysis field name (Domain Findings, Financial Implications, Operational Implications, Risk Analysis, Scenario Analysis, Decision Assessment, Recommended Actions, Final Recommendation, Regulatory Compliance, Extracted Facts)", () => {
  for (const field of genericDomainAnalysisOnlyFieldNames) {
    assert.ok(
      !acquisitionAnalysisFields.includes(field),
      `acquisitionAnalysisFields unexpectedly includes generic domain-analysis field "${field}"`
    );
  }
});

test("acquisitionAnalysisFields never contains a Business Plan/Startup field (Founder Roadmap, Go-to-Market Plan, Pricing Strategy, TAM/SAM/SOM, KPI Dashboard, Founder Score, Unit Economics, Sales Strategy, SWOT, Porter's Five Forces, ...)", () => {
  for (const field of businessPlanStartupFieldNames) {
    assert.ok(
      !acquisitionAnalysisFields.includes(field),
      `acquisitionAnalysisFields unexpectedly includes Business Plan/Startup field "${field}"`
    );
  }
});

test("acquisitionAnalysisFields contains every exact requested section: Executive Acquisition Summary, Strategic Fit, Target Company Overview, Valuation Analysis, Financing Structure, Debt Capacity, ROI Analysis, IRR Analysis, Revenue Synergies, Cost Synergies, Integration Risks, Operational Risks, Regulatory Review, Competitive Position, Deal Risks, Post-Merger Integration Plan, Final Investment Recommendation", () => {
  for (const field of [
    "executiveAcquisitionSummary",
    "strategicFit",
    "targetCompanyOverview",
    "valuationAnalysis",
    "financingStructure",
    "debtCapacity",
    "roiAnalysis",
    "irrAnalysis",
    "revenueSynergies",
    "costSynergies",
    "integrationRisks",
    "operationalRisks",
    "regulatoryReview",
    "competitivePosition",
    "dealRisks",
    "postMergerIntegrationPlan",
    "finalInvestmentRecommendation",
  ]) {
    assert.ok(acquisitionAnalysisFields.includes(field), `missing requested field: ${field}`);
  }
});

test("acquisitionAnalysisFields never contains the OLD (pre-rewrite) field names -- confirms the schema was actually replaced, not just extended", () => {
  for (const oldField of [
    "subjectIdentification",
    "targetCompanyFacts",
    "acquisitionAttractiveness",
    "valuation",
    "purchasePriceFairness",
    "roiIrrScenarios",
    "synergies",
    "integrationRisk",
    "postMergerRoadmap",
    "investmentRecommendation",
  ]) {
    assert.ok(!acquisitionAnalysisFields.includes(oldField), `stale old field name still present: ${oldField}`);
  }
});

test("acquisitionAnalysisFieldLabels provides a label for every field, in every supported language", () => {
  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    for (const field of acquisitionAnalysisFields) {
      const label = acquisitionAnalysisFieldLabels[language][field];
      assert.ok(typeof label === "string" && label.trim().length > 0, `missing ${language} label for ${field}`);
    }
  }
});

test("validateAcquisitionAnalysisReport throws when a required field is missing, and returns the report unchanged when complete", () => {
  const complete = Object.fromEntries(acquisitionAnalysisFields.map((field) => [field, "content"]));
  assert.deepEqual(validateAcquisitionAnalysisReport(complete), complete);

  const incomplete = { ...complete, valuationAnalysis: "" };
  assert.throws(() => validateAcquisitionAnalysisReport(incomplete), /missing fields/);
});

// --- domain-analysis.ts must no longer know about "acquisition" at all --

test("domain-analysis.ts's SpecializedReportDomain/domainRole no longer include 'acquisition' (drift check: the generic schema is legal/finance/accounting/operations/procurement only)", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/prompts/domain-analysis.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /acquisition:/);
  assert.match(source, /"business" \| "real_estate" \| "acquisition"/);
});

test("buildDomainAnalysisInstructions throws or produces no acquisition content for the 5 generic specialized domains (no leakage)", () => {
  for (const domain of ["legal", "finance", "accounting", "operations", "procurement"]) {
    const instructions = buildDomainAnalysisInstructions(domain, "English");
    assert.doesNotMatch(
      instructions,
      /Acquisition Due Diligence Report|post-merger integration roadmap|EV\/ARR/i,
      `${domain} instructions unexpectedly contain acquisition-specific directives`
    );
  }
});

test("domainAnalysisFields (the generic schema) and acquisitionAnalysisFields (the dedicated schema) share no field names beyond the universal externalEvidence/missingInformation/sources connective fields", () => {
  const expectedSharedFields = new Set([
    "externalEvidence",
    "missingInformation",
    "sources",
  ]);
  const shared = domainAnalysisFields.filter((field) => acquisitionAnalysisFields.includes(field));
  assert.deepEqual(new Set(shared), expectedSharedFields);
});

// --- buildAcquisitionAnalysisInstructions (acquisition-analysis.ts) ----

test("buildAcquisitionAnalysisInstructions (the model's role/behavior directives) plus acquisitionAnalysisPrompts (the per-field prompts, both actually sent to the model together at generation time) cover every required content area and forbid fabricated startup metrics", async () => {
  const { acquisitionAnalysisPrompts } = await import(
    "../app/lib/report-engine/prompts/acquisition-analysis.ts"
  );
  const instructions = buildAcquisitionAnalysisInstructions("English");
  const combined = `${instructions}\n${Object.values(acquisitionAnalysisPrompts).join("\n")}`;

  assert.match(combined, /M&A due-diligence/i);
  assert.match(combined, /strategic fit/i);
  assert.match(combined, /EV\/ARR/);
  assert.match(combined, /comparable transactions/i);
  assert.match(combined, /purchase multiple/i);
  assert.match(combined, /purchase price is fair/i);
  assert.match(combined, /financing structure/i);
  assert.match(combined, /debt capacity/i);
  assert.match(combined, /ROI scenarios/i);
  assert.match(combined, /IRR estimate/i);
  assert.match(combined, /integration risk/i);
  assert.match(combined, /revenue synergies/i);
  assert.match(combined, /cost synergies/i);
  assert.match(combined, /technology integration/i);
  assert.match(combined, /cultural integration/i);
  assert.match(combined, /operational risks/i);
  assert.match(combined, /competitive position/i);
  assert.match(combined, /regulatory/i);
  assert.match(combined, /30, 60, and 90/);
  assert.match(combined, /investment recommendation/i);
  assert.match(combined, /executive decision|final investment recommendation/i);
  assert.match(combined, /burn rate/i);
  assert.match(combined, /runway/i);
  assert.match(combined, /\bCAC\b/);
  assert.match(combined, /\bLTV\b/);
  assert.match(combined, /churn/i);
  assert.match(combined, /ARR growth/i);
  assert.match(combined, /Planning Assumption/);
  assert.match(combined, /must be preserved exactly, not withheld/i);
});

test("buildAcquisitionAnalysisInstructions explicitly forbids every named startup section from the request: Problem, Solution, ICP, TAM/SAM/SOM, Pricing Strategy, Go-To-Market, Sales Strategy, Founder Roadmap, Founder Readiness, Startup KPIs, Business Validation, Product Validation", () => {
  const instructions = buildAcquisitionAnalysisInstructions("English");
  for (const section of [
    "Problem",
    "Solution",
    "ICP",
    "TAM/SAM/SOM",
    "Pricing Strategy",
    "Go-To-Market",
    "Sales Strategy",
    "Founder Roadmap",
    "Founder Readiness",
    "Startup KPIs",
    "Business Validation",
    "Product Validation",
  ]) {
    assert.ok(
      instructions.includes(section),
      `instructions do not name forbidden section "${section}"`
    );
  }
});

// --- Report isolation: acquisition report never carries startup-       --
// --- scoring vocabulary, but legitimate evidence-based metrics (the    --
// --- target's real ARR/CAC/Runway) are never blocked outright.        --

test("assertReportIsolation('acquisition_due_diligence', ...) rejects startup-scoring vocabulary (Founder Score, PMF, decision-verdict tokens)", () => {
  const violatingSections = {
    strategicFit: "The target shows strong Founder Readiness and a high Product-Market Fit score.",
  };
  assert.throws(() => assertReportIsolation("acquisition_due_diligence", violatingSections));

  const violatingSections2 = {
    finalInvestmentRecommendation: "Our recommendation is PASS based on the Founder Score.",
  };
  assert.throws(() => assertReportIsolation("acquisition_due_diligence", violatingSections2));
});

test("assertReportIsolation('acquisition_due_diligence', ...) never blocks legitimate, evidence-based ARR/CAC/LTV/Runway/EBITDA mentions (these are real acquisition-analysis vocabulary, not startup-pitch vocabulary)", () => {
  const legitimateSections = {
    valuationAnalysis:
      "The target reports $12M ARR and a CAC of $4,200 per enterprise account. EBITDA margin is 18%. Post-close runway under the proposed financing structure is 24 months.",
  };

  assert.doesNotThrow(() => assertReportIsolation("acquisition_due_diligence", legitimateSections));
  assert.deepEqual(findReportIsolationViolations("acquisition_due_diligence", legitimateSections), []);
});

test("assertReportIsolation('acquisition_due_diligence', ...) passes for a clean, on-topic acquisition report using the dedicated field names", () => {
  const cleanSections = {
    strategicFit: "The target company is a well-positioned acquisition candidate with a defensible market position.",
    valuationAnalysis: "Valuation is supported by an EV/ARR multiple of 6.2x against comparable transactions. Purchase price of $48M appears fair given the valuation range.",
    integrationRisks: "Integration risk is moderate.",
    revenueSynergies: "Expected cross-sell revenue synergies of $2M annually within 18 months.",
    costSynergies: "Expected overlapping-function cost synergies of $1M annually within 12 months.",
    postMergerIntegrationPlan: "Days 1-30: finalize integration team and retention plan. Days 31-60: begin systems integration. Days 61-90: realize first cost synergies.",
    finalInvestmentRecommendation: "Recommendation: proceed conditionally on confirmed financing terms.",
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

test("plan-executor.ts routes reportDomain === 'acquisition' to its own dedicated generateAcquisitionDueDiligenceReport, not the generic generateSpecializedDomainReport (drift check)", () => {
  assert.match(
    planExecutorSource,
    /if \(reportDomain === "acquisition"\) \{\s*\n\s*return generateAcquisitionDueDiligenceReport\(/
  );
  // "acquisition" must no longer appear in generateSpecializedDomainReport's
  // own routing condition list (it has its own branch above instead).
  assert.doesNotMatch(
    planExecutorSource,
    /reportDomain === "procurement" \|\|\s*\n\s*reportDomain === "acquisition"/
  );
});

test("generateAcquisitionDueDiligenceReport uses the dedicated acquisition-analysis.ts schema throughout (drift check)", () => {
  const fnStart = planExecutorSource.indexOf("async function generateAcquisitionDueDiligenceReport(");
  assert.ok(fnStart > -1, "generateAcquisitionDueDiligenceReport not found");
  const fnEnd = planExecutorSource.indexOf("\nexport async function getPlanExecutorUsageError", fnStart);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);

  assert.match(fnBody, /parseAcquisitionAnalysisReport/);
  assert.match(fnBody, /serializeAcquisitionAnalysisReportChunks/);
  assert.match(fnBody, /buildAcquisitionAnalysisInstructions/);
  assert.match(fnBody, /acquisitionAnalysisFields/);
  assert.match(fnBody, /createMockAcquisitionAnalysisReport/);
  assert.match(fnBody, /createGroundedAcquisitionTimeoutFallback/);
  // Never the generic domain-analysis schema or the legal-specific
  // post-processing -- those belong only to generateSpecializedDomainReport.
  assert.doesNotMatch(fnBody, /parseDomainAnalysisReport\(/);
  assert.doesNotMatch(fnBody, /prepareLegalDecisionReport/);
  assert.doesNotMatch(fnBody, /assessLegalResearchCoverage/);
});

test("plan-executor.ts runs assertReportIsolation('acquisition_due_diligence', ...) exactly once, inside the shared parseAcquisitionAnalysisReport parser (single source of truth for every code path that returns an acquisition report)", () => {
  const occurrences = planExecutorSource.match(/assertReportIsolation\("acquisition_due_diligence"/g) || [];
  assert.equal(occurrences.length, 1, `expected exactly 1 occurrence, found ${occurrences.length}`);

  const fnStart = planExecutorSource.indexOf("function parseAcquisitionAnalysisReport(");
  const fnEnd = planExecutorSource.indexOf("\nfunction parseRealEstateReport", fnStart);
  const fnBody = planExecutorSource.slice(fnStart, fnEnd);
  assert.match(fnBody, /assertReportIsolation\("acquisition_due_diligence"/);
});

test("plan-executor.ts never routes 'acquisition' through the legal-specific post-processing anywhere in the file (prepareLegalDecisionReport/assessLegalResearchCoverage remain gated on domain === \"legal\" only)", () => {
  assert.doesNotMatch(planExecutorSource, /domain === "acquisition"[\s\S]{0,80}prepareLegalDecisionReport/);
  assert.doesNotMatch(planExecutorSource, /domain === "acquisition"[\s\S]{0,80}assessLegalResearchCoverage/);
});

// --- worker.ts wiring: acquisition reports must resolve their own field --
// --- list/labels/type/title, never fall back to the generic domain-     --
// --- analysis schema or business_plan fields (drift check).            --

const workerSource = readFileSync(
  new URL("../app/lib/report-jobs/worker.ts", import.meta.url),
  "utf8"
);

test("worker.ts's getExpectedFields/getFieldTitle/getReportType/getReportTitle/inferDomain all handle domain === 'acquisition' using the dedicated schema (drift check)", () => {
  assert.match(workerSource, /acquisitionAnalysisFields/);
  assert.match(workerSource, /acquisitionAnalysisFieldLabels/);
  assert.match(workerSource, /if \(domain === "acquisition"\) \{\s*\n\s*return acquisitionAnalysisFields/);
  assert.match(workerSource, /if \(domain === "acquisition"\) \{\s*\n\s*return acquisitionAnalysisFieldLabels/);
  assert.match(workerSource, /if \(domain === "acquisition"\) \{\s*\n\s*return "acquisition_due_diligence_analysis"/);
  assert.match(workerSource, /candidate === "acquisition"/);
  assert.match(workerSource, /acquisitionAnalysisDistinguishingFields/);
});

// --- components/Planner.tsx wiring: acquisition reports get their own  --
// --- UI field list/title, and are never misrendered as a Legal         --
// --- Assessment even when their content legitimately mentions          --
// --- contracts/compliance (drift check).                              --

const plannerSource = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);

test("Planner.tsx has its own acquisitionReportFields UI descriptor list and routes domain === 'acquisition' to it (drift check)", () => {
  assert.match(plannerSource, /const acquisitionReportFields:/);
  assert.match(plannerSource, /if \(domain === "acquisition"\) return acquisitionReportFields;/);
});

test("Planner.tsx never lets a known non-legal specialized domain (including 'acquisition') fall through to the legal-shaped-content heuristic, so an acquisition report can never be mislabeled and re-rendered as a Legal Assessment (drift check)", () => {
  assert.match(plannerSource, /isKnownNonLegalSpecializedDomain/);
  assert.match(plannerSource, /reportDomain === "acquisition";/);
  assert.match(
    plannerSource,
    /const isLegalReport =\s*\n\s*reportDomain === "legal" \|\|\s*\n\s*\(!isKnownNonLegalSpecializedDomain/
  );
});
