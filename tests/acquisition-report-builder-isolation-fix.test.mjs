import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- acquisition report builder isolation regression.
//
// report-isolation-validator.ts's assertReportIsolation("acquisition_due_
// diligence", ...) already correctly rejects startup-scoring vocabulary
// (Founder Score, PMF, PASS/HOLD/VALIDATE/REJECT) that reaches it -- that
// guard is correct and is left untouched by this fix. The regression was
// upstream of the guard: the dynamic report-plan layer that PRODUCES each
// acquisition report's own section titles/purposes/dashboard metrics
// (app/lib/ai/dynamic-report-plan.ts, app/lib/ai/expertise-profile.ts,
// app/lib/ai/adaptive-report-writer.ts) had a domain-specific
// compatibility filter for every other structured domain (legal,
// real_estate, finance, accounting, retail) EXCEPT "acquisition" -- so an
// AI-generated dynamic plan section literally titled "Go-To-Market
// Strategy" or a dashboard metric named "TAM" passed straight through
// into the acquisition report's own generation contract, unfiltered,
// regardless of what the guard would have rejected after the fact.
//
// This suite proves the producer-side fix directly: the three
// compatibility tables now cover "acquisition" the same way they already
// cover every sibling domain, Business Idea Validation's own behavior is
// provably unaffected, and the guard itself is untouched.

const { createExpertiseProfileFallback } = await import(
  "../app/lib/ai/expertise-profile.ts"
);
const { createDynamicReportPlanFallback, resolveDynamicReportPlan } = await import(
  "../app/lib/ai/dynamic-report-plan.ts"
);
const { createAdaptiveReportWriterPlan, formatAdaptiveReportWriterGenerationContext } = await import(
  "../app/lib/ai/adaptive-report-writer.ts"
);
const { acquisitionAnalysisFields, acquisitionAnalysisFieldLabels } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);
const { planFields } = await import("../app/lib/report-engine/prompts/plan.ts");

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

const acquisitionPrompt =
  "We are acquiring a cybersecurity SaaS company in Germany. Assess this acquisition, including EV/ARR valuation and financing structure.";
const businessPrompt =
  "Validate my business idea: an AI-powered scheduling app for freelance photographers.";

const acquisitionProfile = createExpertiseProfileFallback({
  prompt: acquisitionPrompt,
  selectedMode: "plan",
});
const businessProfile = createExpertiseProfileFallback({
  prompt: businessPrompt,
  selectedMode: "plan",
});

test("createExpertiseProfileFallback resolves the acquisition scenario prompt to the 'acquisition' domain (sanity check for every test below)", () => {
  assert.equal(acquisitionProfile.domain, "acquisition");
  assert.equal(businessProfile.domain, "business");
});

// --- 1. domainForbiddenTopics.acquisition now names the full concept list --

test("expertise-profile.ts: acquisition's forbiddenTopics now names every Business Plan/startup section concept the fix requires blocked", () => {
  const forbidden = acquisitionProfile.forbiddenTopics.map((t) => t.toLowerCase());
  const requiredTerms = [
    "founder roadmap",
    "total addressable market",
    "serviceable addressable market",
    "serviceable obtainable market",
    "ideal customer profile",
    "go-to-market",
    "pricing strategy",
    "sales strategy",
    "startup kpi",
    "business validation",
    "product validation",
    "unit economics template",
  ];
  for (const term of requiredTerms) {
    assert.ok(
      forbidden.some((topic) => topic.includes(term)),
      `acquisition forbiddenTopics missing: "${term}"`
    );
  }
});

test("expertise-profile.ts: acquisition's forbiddenTopics never blocks legitimate ARR/CAC/LTV/MRR raw metric names (those are real evidence-grounded acquisition vocabulary, not startup-pitch vocabulary)", () => {
  const forbidden = acquisitionProfile.forbiddenTopics.map((t) => t.toLowerCase());
  for (const metric of ["cac", "ltv", "arr", "mrr", "runway", "ebitda"]) {
    assert.ok(
      !forbidden.some((topic) => topic === metric),
      `acquisition forbiddenTopics incorrectly blocks the bare metric "${metric}"`
    );
  }
});

// --- 2. dynamic-report-plan.ts: dedicated acquisition fallback template ---

const acquisitionFallbackPlan = createDynamicReportPlanFallback({
  expertiseProfile: acquisitionProfile,
  selectedMode: "plan",
  prompt: acquisitionPrompt,
});

test("createDynamicReportPlanFallback('acquisition') returns a dedicated, acquisition-shaped plan, never the generic bottom template", () => {
  assert.equal(acquisitionFallbackPlan.reportTitle, "Acquisition Due Diligence Assessment");
  assert.notEqual(acquisitionFallbackPlan.reportTitle, "Decision Assessment");
});

test("the acquisition fallback plan's own sections never contain Business Plan/startup section concepts", () => {
  const sectionText = acquisitionFallbackPlan.sections
    .map((s) => `${s.id} ${s.title} ${s.purpose} ${s.analysisMethod}`)
    .join(" ")
    .toLowerCase();
  const forbiddenTerms = [
    "go-to-market",
    "pricing strategy",
    "sales strategy",
    "ideal customer profile",
    "founder roadmap",
    "startup kpi",
    "business validation",
    "product validation",
    "tam/sam/som",
  ];
  for (const term of forbiddenTerms) {
    assert.ok(!sectionText.includes(term), `fallback plan section text contains forbidden term: "${term}"`);
  }
});

test("the acquisition fallback plan covers every acquisition-specific analysis area the fix requires", () => {
  const sectionText = acquisitionFallbackPlan.sections
    .map((s) => `${s.id} ${s.title} ${s.purpose}`)
    .join(" ")
    .toLowerCase();
  const expectedConcepts = [
    "strategic fit",
    "valuation",
    "financing",
    "synergies",
    "integration",
    "regulatory",
    "competitive position",
    "deal risks",
    "post-merger integration",
    "final investment recommendation",
  ];
  for (const concept of expectedConcepts) {
    assert.ok(sectionText.includes(concept), `fallback plan missing expected acquisition concept: "${concept}"`);
  }
});

// --- 3. resolveDynamicReportPlan: AI-generated plans are now filtered ----
// ---    for acquisition the same way every sibling domain already is  ----

function poisonedAcquisitionCandidate(profile) {
  return {
    reportTitle: "Acquisition Assessment",
    reportPurpose: "Assess whether to acquire this company.",
    primaryDecision: "Determine whether to proceed with the acquisition.",
    domain: profile.domain,
    subdomain: profile.subdomain,
    taskType: profile.taskType,
    selectedMode: "plan",
    sections: [
      {
        id: "go_to_market_strategy",
        title: "Go-To-Market Strategy",
        purpose: "Assess the target's go-to-market motion and channel strategy.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "gtm_review",
        priority: "high",
      },
      {
        id: "pricing_strategy",
        title: "Pricing Strategy",
        purpose: "Assess the target's pricing strategy and packaging tiers.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "pricing_review",
        priority: "high",
      },
      {
        id: "strategic_fit",
        title: "Strategic Fit",
        purpose: "Assess strategic rationale and fit of this acquisition.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "strategic_fit_review",
        priority: "critical",
      },
      {
        id: "valuation_analysis",
        title: "Valuation Analysis",
        purpose: "Assess EV/ARR and purchase price fairness.",
        requiredEvidenceTypes: ["user_statement", "calculation"],
        analysisMethod: "valuation_analysis",
        priority: "critical",
      },
      {
        id: "financial_profile",
        title: "Financial Profile",
        purpose:
          "The target reports $12M ARR, a CAC of $4,200 per enterprise account, an EBITDA margin of 18%, and 24 months of post-close runway.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "financial_profile_review",
        priority: "high",
      },
    ],
    dashboardMetrics: [
      {
        id: "tam",
        label: "TAM",
        purpose: "Total addressable market size for the target's category.",
        valueType: "calculated",
        requiredEvidenceTypes: ["external_source"],
      },
      {
        id: "ev_arr",
        label: "EV/ARR Multiple",
        purpose: "Derived valuation multiple from purchase price and target ARR.",
        valueType: "calculated",
        requiredEvidenceTypes: ["calculation"],
      },
    ],
    decisionCriteria: ["valuation support"],
    decisionGates: [],
    requiredEvidence: ["target company financials"],
    forbiddenSections: [],
    clarificationQuestions: [],
    language: "en",
  };
}

const resolvedAcquisitionPlan = resolveDynamicReportPlan({
  value: poisonedAcquisitionCandidate(acquisitionProfile),
  fallback: acquisitionFallbackPlan,
  expertiseProfile: acquisitionProfile,
  selectedMode: "plan",
});

test("resolveDynamicReportPlan strips Business Plan-flavored sections (Go-To-Market Strategy, Pricing Strategy) out of an AI-generated acquisition candidate plan", () => {
  const ids = resolvedAcquisitionPlan.sections.map((s) => s.id);
  assert.ok(!ids.includes("go_to_market_strategy"), "Go-To-Market Strategy section was not filtered out");
  assert.ok(!ids.includes("pricing_strategy"), "Pricing Strategy section was not filtered out");
});

test("resolveDynamicReportPlan keeps legitimate acquisition sections, including one using real evidence-grounded ARR/CAC/EBITDA/Runway figures", () => {
  const ids = resolvedAcquisitionPlan.sections.map((s) => s.id);
  assert.ok(ids.includes("strategic_fit"), "legitimate Strategic Fit section was incorrectly filtered out");
  assert.ok(ids.includes("valuation_analysis"), "legitimate Valuation Analysis section was incorrectly filtered out");
  assert.ok(
    ids.includes("financial_profile"),
    "a section using real ARR/CAC/EBITDA/Runway figures was incorrectly filtered out -- these are legitimate acquisition vocabulary, not startup-pitch vocabulary"
  );
});

test("resolveDynamicReportPlan strips a TAM dashboard metric from an AI-generated acquisition candidate plan, keeping the legitimate EV/ARR metric", () => {
  const ids = resolvedAcquisitionPlan.dashboardMetrics.map((m) => m.id);
  assert.ok(!ids.includes("tam"), "TAM dashboard metric was not filtered out");
  assert.ok(ids.includes("ev_arr"), "legitimate EV/ARR dashboard metric was incorrectly filtered out");
});

// --- 4. Business Idea Validation ('business' domain) is unaffected -------

test("Business Idea Validation's own domain has no new forbidden-topic entry -- the fix is scoped to 'acquisition' only", () => {
  assert.deepEqual(businessProfile.forbiddenTopics, []);
});

test("createDynamicReportPlanFallback('business') still returns the original generic template, not the new acquisition-shaped one", () => {
  const businessFallback = createDynamicReportPlanFallback({
    expertiseProfile: businessProfile,
    selectedMode: "plan",
    prompt: businessPrompt,
  });
  assert.equal(businessFallback.reportTitle, "Decision Assessment");
  assert.notEqual(businessFallback.reportTitle, "Acquisition Due Diligence Assessment");
});

test("resolveDynamicReportPlan never filters a legitimate Go-To-Market Strategy section for Business Idea Validation -- the new acquisition-only pattern does not leak into business_plan's own vocabulary", () => {
  const businessFallback = createDynamicReportPlanFallback({
    expertiseProfile: businessProfile,
    selectedMode: "plan",
    prompt: businessPrompt,
  });
  const businessCandidate = {
    reportTitle: "Business Plan Assessment",
    reportPurpose: "Validate this business idea.",
    primaryDecision: "Determine whether to build this.",
    domain: businessProfile.domain,
    subdomain: businessProfile.subdomain,
    taskType: businessProfile.taskType,
    selectedMode: "plan",
    sections: [
      {
        id: "go_to_market_strategy",
        title: "Go-To-Market Strategy",
        purpose: "Assess the go-to-market motion and channel strategy for this new product.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "gtm_review",
        priority: "high",
      },
    ],
    dashboardMetrics: [],
    decisionCriteria: [],
    decisionGates: [],
    requiredEvidence: [],
    forbiddenSections: [],
    clarificationQuestions: [],
    language: "en",
  };

  const resolved = resolveDynamicReportPlan({
    value: businessCandidate,
    fallback: businessFallback,
    expertiseProfile: businessProfile,
    selectedMode: "plan",
  });

  assert.ok(
    resolved.sections.some((s) => s.id === "go_to_market_strategy"),
    "Go-To-Market Strategy was incorrectly filtered out of a Business Idea Validation report -- it legitimately owns this concept"
  );
});

// --- 5. adaptive-report-writer.ts: the generation-context prohibited-  ---
// ---    topics line an acquisition report is actually written from    ---

const acquisitionWriterPlan = createAdaptiveReportWriterPlan({
  expertiseProfile: acquisitionProfile,
  reportPlan: acquisitionFallbackPlan,
  outputContract: {
    fields: acquisitionAnalysisFields,
    labels: acquisitionAnalysisFieldLabels.English,
  },
});

test("createAdaptiveReportWriterPlan's prohibitedTopics for an acquisition report now names the Business Plan/startup section concepts", () => {
  const prohibited = acquisitionWriterPlan.prohibitedTopics.join(" | ").toLowerCase();
  const requiredTerms = [
    "tam/sam/som",
    "go-to-market strategy",
    "pricing strategy",
    "founder roadmap",
    "startup kpi",
    "business validation",
    "product validation",
  ];
  for (const term of requiredTerms) {
    assert.ok(prohibited.includes(term), `prohibitedTopics missing: "${term}"`);
  }
});

test("formatAdaptiveReportWriterGenerationContext embeds the acquisition prohibitedTopics list verbatim in the generation-context text the model actually receives", () => {
  const context = formatAdaptiveReportWriterGenerationContext(acquisitionWriterPlan);
  assert.match(context, /Prohibited topics:.*go-to-market strategy/i);
  assert.match(context, /Prohibited topics:.*founder roadmap/i);
});

const businessWriterPlan = createAdaptiveReportWriterPlan({
  expertiseProfile: businessProfile,
  reportPlan: createDynamicReportPlanFallback({
    expertiseProfile: businessProfile,
    selectedMode: "plan",
    prompt: businessPrompt,
  }),
  outputContract: { fields: planFields, labels: undefined },
});

test("createAdaptiveReportWriterPlan's prohibitedTopics for a Business Idea Validation report is unaffected -- no acquisition-only terms leak into it", () => {
  const prohibited = businessWriterPlan.prohibitedTopics.join(" | ").toLowerCase();
  assert.doesNotMatch(prohibited, /go-to-market strategy/i);
  assert.doesNotMatch(prohibited, /founder roadmap/i);
});

// --- 6. No cross-report field leakage -------------------------------------

test("acquisitionAnalysisFields (Acquisition Due Diligence) and planFields (Business Plan) still share zero field names", () => {
  const overlap = planFields.filter((field) => acquisitionAnalysisFields.includes(field));
  assert.deepEqual(overlap, []);
});

test("the new acquisition-shaped dynamic-report-plan fallback's own section/metric IDs never collide with a planFields name", () => {
  const ids = [
    ...acquisitionFallbackPlan.sections.map((s) => s.id),
    ...acquisitionFallbackPlan.dashboardMetrics.map((m) => m.id),
  ];
  const overlap = ids.filter((id) => planFields.includes(id));
  assert.deepEqual(overlap, []);
});

// --- 7. The isolation guard itself is untouched (still wired, still ------
// ---    correct) -- this fix only changes what reaches it -------------

test("plan-executor.ts still calls assertReportIsolation('acquisition_due_diligence', ...) for every acquisition report -- the guard was not weakened or removed by this fix (drift check)", () => {
  assert.match(planExecutorSource, /assertReportIsolation\("strategic_advisory", validated\);\s*\n\s*assertReportIsolation\("acquisition_due_diligence", validated\);/);
});

test("report-isolation-validator.ts's acquisition_due_diligence forbidden-term list still names Founder Score, PMF, and the decision-verdict tokens -- untouched by this fix (drift check)", () => {
  const validatorSource = readFileSync(
    new URL("../app/lib/report-engine/report-isolation-validator.ts", import.meta.url),
    "utf8"
  );
  const startupTermsMatch = /const startupValidationEngineTerms: ForbiddenPattern\[\] = \[[\s\S]*?\n\];/.exec(
    validatorSource
  );
  assert.ok(startupTermsMatch, "startupValidationEngineTerms not found");
  assert.match(startupTermsMatch[0], /Founder\s+Readiness/);
  assert.match(startupTermsMatch[0], /Product-Market Fit/);
  assert.match(startupTermsMatch[0], /PASS\|HOLD\|VALIDATE\|REJECT/);
});
