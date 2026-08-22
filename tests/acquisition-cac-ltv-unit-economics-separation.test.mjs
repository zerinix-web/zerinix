import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL FIX -- separate legitimate acquisition metrics from Business
// Plan leakage.
//
// report-isolation-validator.ts's assertReportIsolation("acquisition_due_
// diligence", ...) is correct and untouched by this fix -- it never
// blocked bare CAC/LTV/ARR/MRR mentions for acquisition by design (those
// were treated as evidence-grounded acquisition vocabulary at the
// isolation-guard level). The actual gap was one layer down: the
// GENERATOR itself (acquisition-analysis.ts's instructions, and the
// domain-forbidden-topic/incompatible-pattern lists that filter the
// dynamic report plan and the adaptive-writer generation context in
// dynamic-report-plan.ts / expertise-profile.ts / adaptive-report-
// writer.ts) still let CAC and LTV through as if they were as legitimate
// as ARR/EBITDA/EV-ARR -- confirmed live, the report still framed
// findings as "Unit economics (CAC/LTV/ARR/MRR) indicates ..." even with
// real figures available. This fix draws the line precisely at the
// GENERATOR level: CAC/LTV/CAC-payback/"unit economics" framing are now a
// rejected startup Business Plan template, while ARR, Revenue, EBITDA,
// Gross margin, Cash flow, Purchase price, EV/ARR, ROI, IRR, Debt
// service, and Financing structure remain fully legitimate acquisition
// vocabulary. The isolation guard was not touched and stays active.

const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);
const adaptiveReportWriterSource = readFileSync(
  new URL("../app/lib/ai/adaptive-report-writer.ts", import.meta.url),
  "utf8"
);
const isolationValidatorSource = readFileSync(
  new URL("../app/lib/report-engine/report-isolation-validator.ts", import.meta.url),
  "utf8"
);

const { resolveDynamicReportPlan, createDynamicReportPlanFallback } = await import(
  "../app/lib/ai/dynamic-report-plan.ts"
);
const { createExpertiseProfileFallback } = await import("../app/lib/ai/expertise-profile.ts");
const { createAdaptiveReportWriterPlan, formatAdaptiveReportWriterGenerationContext } = await import(
  "../app/lib/ai/adaptive-report-writer.ts"
);
const { acquisitionAnalysisFields, acquisitionAnalysisFieldLabels } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);
const { planFields } = await import("../app/lib/report-engine/prompts/plan.ts");
const {
  assertReportIsolation,
  findReportIsolationViolations,
  getForbiddenTermLabels,
} = await import("../app/lib/report-engine/report-isolation-validator.ts");

const acquisitionPrompt =
  "We are acquiring a cybersecurity SaaS company in Germany. Purchase price is $14M and target ARR is $2.8M.";
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

// --- 1. Acquisition allows ARR/EBITDA/ROI/etc. when relevant --------------

test("acquisition-analysis.ts's generation instructions explicitly name the full allowed financial vocabulary: ARR, Revenue, EBITDA, Gross margin, Cash flow, Purchase price, EV/ARR, ROI, IRR, Debt service, Financing structure", () => {
  const requiredTerms = [
    "ARR",
    "Revenue",
    "EBITDA",
    "Gross margin",
    "Cash flow",
    "Purchase price",
    "EV/ARR",
    "ROI",
    "IRR",
    "Debt service",
    "Financing structure",
  ];
  for (const term of requiredTerms) {
    assert.ok(
      acquisitionAnalysisSource.includes(term),
      `acquisition-analysis.ts instructions do not name allowed term: "${term}"`
    );
  }
});

test("acquisition-analysis.ts requires EBITDA and Gross margin to be labeled a Planning Assumption when not directly provided, never fabricated outright", () => {
  assert.match(
    acquisitionAnalysisSource,
    /EBITDA \(only if provided or clearly marked a Planning Assumption\)/
  );
  assert.match(
    acquisitionAnalysisSource,
    /Gross margin \(only if provided or clearly marked a Planning Assumption\)/
  );
});

test("resolveDynamicReportPlan keeps an acquisition section built around ARR, EBITDA, ROI, and financing structure -- legitimate financial vocabulary is never filtered", () => {
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
    prompt: acquisitionPrompt,
  });
  const candidate = {
    reportTitle: "Acquisition Assessment",
    reportPurpose: "Assess whether to acquire this company.",
    primaryDecision: "Determine whether to proceed with the acquisition.",
    domain: acquisitionProfile.domain,
    subdomain: acquisitionProfile.subdomain,
    taskType: acquisitionProfile.taskType,
    selectedMode: "plan",
    sections: [
      {
        id: "financial_profile",
        title: "Financial Profile",
        purpose:
          "The target reports $2.8M ARR, an EBITDA margin of 18%, positive cash flow, and a projected ROI of 22% on the $14M purchase price, financed through a debt/equity structure with quarterly debt service.",
        requiredEvidenceTypes: ["user_statement", "calculation"],
        analysisMethod: "financial_profile_review",
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
    value: candidate,
    fallback,
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
  });

  assert.ok(
    resolved.sections.some((s) => s.id === "financial_profile"),
    "a section using ARR/EBITDA/ROI/cash flow/debt service was incorrectly filtered out"
  );
});

// --- 2. Acquisition rejects CAC/LTV unit economics -------------------------

test("acquisition-analysis.ts's generation instructions explicitly reject CAC, LTV, CAC payback, and 'unit economics' framing as a startup Business Plan template", () => {
  assert.match(acquisitionAnalysisSource, /CAC \(Customer Acquisition Cost\)/);
  assert.match(acquisitionAnalysisSource, /LTV \(Lifetime Value\)/);
  assert.match(acquisitionAnalysisSource, /CAC payback/);
  assert.match(acquisitionAnalysisSource, /'unit economics' framing are a startup Business Plan template/);
  assert.match(acquisitionAnalysisSource, /Unit Economics \(CAC\/LTV\/ARR\/MRR\) framework/);
  assert.match(acquisitionAnalysisSource, /Customer Acquisition Cost framework/);
});

test("acquisition-analysis.ts's generation instructions embed the exact required before/after rewrite example", () => {
  assert.match(
    acquisitionAnalysisSource,
    /never write \\"Unit economics \(CAC\/LTV\/ARR\/MRR\) indicates strong retention\.\.\.\\" -- write \\"Based on the available purchase price and ARR, the transaction implies a 4\.0x EV\/ARR multiple\\" instead/
  );
});

test("resolveDynamicReportPlan's acquisition-domain filtering rejects CAC/LTV/CAC-payback/customer-acquisition-cost/unit-economics section text, but keeps sections using ARR/EBITDA/ROI/IRR/financing-structure/EV-ARR text", () => {
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
    prompt: acquisitionPrompt,
  });

  function buildCandidateWithSections(sectionTexts) {
    return {
      reportTitle: "Acquisition Assessment",
      reportPurpose: "Assess whether to acquire this company.",
      primaryDecision: "Determine whether to proceed with the acquisition.",
      domain: acquisitionProfile.domain,
      subdomain: acquisitionProfile.subdomain,
      taskType: acquisitionProfile.taskType,
      selectedMode: "plan",
      sections: sectionTexts.map((purpose, index) => ({
        id: `probe_section_${index}`,
        title: `Probe Section ${index}`,
        purpose,
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "probe_review",
        priority: "standard",
      })),
      dashboardMetrics: [],
      decisionCriteria: [],
      decisionGates: [],
      requiredEvidence: [],
      forbiddenSections: [],
      clarificationQuestions: [],
      language: "en",
    };
  }

  const rejectedTexts = [
    "Assess the target's CAC and LTV as a unit-economics framework.",
    "CAC payback exceeds 18 months.",
    "Customer Acquisition Cost has trended upward.",
    "Unit economics do not yet support this pace.",
  ];
  const rejectedResolved = resolveDynamicReportPlan({
    value: buildCandidateWithSections(rejectedTexts),
    fallback,
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
  });
  for (let i = 0; i < rejectedTexts.length; i++) {
    assert.ok(
      !rejectedResolved.sections.some((s) => s.id === `probe_section_${i}`),
      `acquisition filtering did not reject: "${rejectedTexts[i]}"`
    );
  }

  const legitimateTexts = [
    "The target reports $2.8M ARR and an EBITDA margin of 18%.",
    "Projected ROI is 22% with an IRR of 15%.",
    "The financing structure requires quarterly debt service.",
    "Purchase price implies a 5.0x EV/ARR multiple.",
  ];
  const legitimateResolved = resolveDynamicReportPlan({
    value: buildCandidateWithSections(legitimateTexts),
    fallback,
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
  });
  for (let i = 0; i < legitimateTexts.length; i++) {
    assert.ok(
      legitimateResolved.sections.some((s) => s.id === `probe_section_${i}`),
      `acquisition filtering incorrectly rejected legitimate text: "${legitimateTexts[i]}"`
    );
  }
});

test("resolveDynamicReportPlan strips an acquisition section built around CAC/LTV unit economics, even when a real figure is supplied", () => {
  const fallback = createDynamicReportPlanFallback({
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
    prompt: acquisitionPrompt,
  });
  const candidate = {
    reportTitle: "Acquisition Assessment",
    reportPurpose: "Assess whether to acquire this company.",
    primaryDecision: "Determine whether to proceed with the acquisition.",
    domain: acquisitionProfile.domain,
    subdomain: acquisitionProfile.subdomain,
    taskType: acquisitionProfile.taskType,
    selectedMode: "plan",
    sections: [
      {
        id: "unit_economics",
        title: "Unit Economics",
        purpose: "The target reports a CAC of $4,200 and an LTV of $18,000, an LTV/CAC ratio of 4.3x.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "unit_economics_review",
        priority: "standard",
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
    value: candidate,
    fallback,
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
  });

  assert.ok(
    !resolved.sections.some((s) => s.id === "unit_economics"),
    "a CAC/LTV unit-economics section was not filtered out, even with a real supplied figure"
  );
});

test("expertise-profile.ts: acquisition's forbiddenTopics names CAC payback / Customer Acquisition Cost / unit economics template", () => {
  const forbidden = acquisitionProfile.forbiddenTopics.map((t) => t.toLowerCase());
  for (const term of ["unit economics template", "cac payback", "customer acquisition cost"]) {
    assert.ok(
      forbidden.some((topic) => topic.includes(term)),
      `acquisition forbiddenTopics missing: "${term}"`
    );
  }
});

test("adaptive-report-writer.ts: acquisition's domainProhibitedTopics explicitly names CAC and LTV -- fed directly into the generation context every acquisition report is written from", () => {
  const acquisitionFallback = createDynamicReportPlanFallback({
    expertiseProfile: acquisitionProfile,
    selectedMode: "plan",
    prompt: acquisitionPrompt,
  });
  const writerPlan = createAdaptiveReportWriterPlan({
    expertiseProfile: acquisitionProfile,
    reportPlan: acquisitionFallback,
    outputContract: {
      fields: acquisitionAnalysisFields,
      labels: acquisitionAnalysisFieldLabels.English,
    },
  });
  const prohibited = writerPlan.prohibitedTopics.join(" | ");
  assert.match(prohibited, /CAC \(Customer Acquisition Cost\)/);
  assert.match(prohibited, /LTV \(Lifetime Value\)/);
  assert.match(prohibited, /CAC payback/);

  const context = formatAdaptiveReportWriterGenerationContext(writerPlan);
  assert.match(context, /Prohibited topics:.*CAC \(Customer Acquisition Cost\)/);
});

// --- 3. Business Plan remains unchanged ------------------------------------

test("Business Idea Validation's own domain has no new CAC/LTV-related forbidden-topic entry -- the fix is scoped to 'acquisition' only", () => {
  assert.deepEqual(businessProfile.forbiddenTopics, []);
});

test("dynamic-report-plan.ts's acquisition-only CAC/LTV rejection pattern does not leak into Business Idea Validation -- a legitimate Business Plan unit-economics section survives", () => {
  const businessFallback = createDynamicReportPlanFallback({
    expertiseProfile: businessProfile,
    selectedMode: "plan",
    prompt: businessPrompt,
  });
  const candidate = {
    reportTitle: "Business Plan Assessment",
    reportPurpose: "Validate this business idea.",
    primaryDecision: "Determine whether to build this.",
    domain: businessProfile.domain,
    subdomain: businessProfile.subdomain,
    taskType: businessProfile.taskType,
    selectedMode: "plan",
    sections: [
      {
        id: "unit_economics",
        title: "Unit Economics",
        purpose: "Assess CAC, LTV, and the LTV/CAC ratio for this new product.",
        requiredEvidenceTypes: ["user_statement"],
        analysisMethod: "unit_economics_review",
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
    value: candidate,
    fallback: businessFallback,
    expertiseProfile: businessProfile,
    selectedMode: "plan",
  });

  assert.ok(
    resolved.sections.some((s) => s.id === "unit_economics"),
    "Unit Economics was incorrectly filtered out of a Business Idea Validation report -- it legitimately owns this concept"
  );
});

test("adaptive-report-writer.ts's domainProhibitedTopics for Business Idea Validation has no CAC/LTV entry -- CAC/LTV remain that report type's own native vocabulary", () => {
  assert.doesNotMatch(adaptiveReportWriterSource, /business:\s*\[[\s\S]*?"CAC/);
});

test("planFields (Business Plan) and acquisitionAnalysisFields (Acquisition Due Diligence) still share zero field names -- report schema generation keeps each domain in its own namespace", () => {
  const overlap = planFields.filter((field) => acquisitionAnalysisFields.includes(field));
  assert.deepEqual(overlap, []);
});

// --- 4. Isolation guard remains active -------------------------------------

test("report-isolation-validator.ts is not modified by this fix -- assertReportIsolation('acquisition_due_diligence', ...) still rejects Founder Score/PMF/decision-verdict tokens exactly as before (drift check)", () => {
  assert.doesNotThrow(() =>
    assertReportIsolation("acquisition_due_diligence", {
      strategicFit: "The target is well-positioned with a defensible market position.",
    })
  );
  assert.throws(() =>
    assertReportIsolation("acquisition_due_diligence", {
      strategicFit: "The target shows strong Founder Readiness and a high Product-Market Fit score.",
    })
  );
});

test("report-isolation-validator.ts's acquisition_due_diligence forbidden-term list still deliberately excludes bare CAC/LTV/ARR/MRR from getForbiddenTermLabels -- the guard's own design (raw metric names legitimate) is untouched; CAC/LTV rejection for acquisition now lives entirely at the generator level, not the guard", () => {
  const labels = getForbiddenTermLabels("acquisition_due_diligence").join(" | ").toLowerCase();
  assert.doesNotMatch(labels, /\bcac\b/);
  assert.doesNotMatch(labels, /\bltv\b/);
  assert.doesNotMatch(labels, /\barr\b/);
  assert.doesNotMatch(labels, /\bmrr\b/);
});

test("report-isolation-validator.ts source file is byte-identical in its acquisition_due_diligence forbidden-term definitions to before this fix (drift check, proves the guard was never touched)", () => {
  assert.match(
    isolationValidatorSource,
    /const startupValidationEngineTerms: ForbiddenPattern\[\] = \[/
  );
  assert.match(
    isolationValidatorSource,
    /acquisition_due_diligence: \[\.\.\.startupValidationEngineTerms, \.\.\.marketIntelligenceTemplateTerms\]/
  );
  assert.doesNotMatch(isolationValidatorSource, /CAC payback/);
  assert.doesNotMatch(isolationValidatorSource, /Customer Acquisition Cost/);
});

test("findReportIsolationViolations never flags a clean acquisition report that legitimately uses ARR, EBITDA, ROI, IRR, and financing-structure vocabulary", () => {
  const violations = findReportIsolationViolations("acquisition_due_diligence", {
    valuationAnalysis: "The transaction implies a 5.0x EV/ARR multiple against $2.8M target ARR.",
    financingStructure: "Financing structure combines $8M equity and $6M debt, with quarterly debt service.",
    roiAnalysis: "Projected ROI is 22% with an IRR of 15% over a five-year hold.",
  });
  assert.deepEqual(violations, []);
});
