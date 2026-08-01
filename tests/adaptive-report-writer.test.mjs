import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  adaptiveReportWriterPlanSchema,
  createAdaptiveReportWriterPlan,
  formatAdaptiveReportWriterContext,
} from "../app/lib/ai/adaptive-report-writer.ts";

function profile(domain, overrides = {}) {
  return {
    domain,
    subdomain: `${domain}_advisory`,
    taskType: "decision_support",
    jurisdiction: domain === "legal" ? "California, United States" : "Global",
    userGoal: "Make an evidence-based decision",
    professionalPerspective: `${domain} senior advisor`,
    requiredAnalyses: [],
    decisionCriteria: [],
    requiredEvidence: [],
    forbiddenTopics: [],
    criticalClarifications: [],
    confidence: 0.9,
    ...overrides,
  };
}

function section(id, title, purpose, priority = "critical") {
  return {
    id,
    title,
    purpose,
    requiredEvidenceTypes: ["external_source"],
    analysisMethod: "evidence_review",
    priority,
  };
}

function plan(domain, sections, gates = [], selectedMode = "chat") {
  return {
    reportTitle: `${domain} decision report`,
    reportPurpose: "Support the requested decision",
    primaryDecision: "Determine the most defensible next action",
    domain,
    subdomain: `${domain}_advisory`,
    taskType: "decision_support",
    selectedMode,
    sections,
    dashboardMetrics: [],
    decisionCriteria: [],
    decisionGates: gates,
    requiredEvidence: [],
    forbiddenSections: [],
    clarificationQuestions: [],
    language: "en",
  };
}

function validation({ findings = [], sectionSupport = [], gates = [], quality = "moderate", sources } = {}) {
  return {
    version: "evidence_validation_v1",
    selectedMode: "chat",
    findings,
    sources: sources || [
      {
        id: "source_1",
        title: "Official record",
        publisher: "Public Authority",
        url: "https://authority.gov.test/records/1",
        sourceType: "official record",
        authority: 0.98,
        reliability: 0.98,
        publishedDate: "2026-01-01",
        accessedAt: "2026-08-01",
      },
    ],
    conflicts: [],
    unresolvedQuestions: [],
    decisionGates: gates,
    sectionSupport,
    overallEvidenceQuality: quality,
  };
}

function finding(overrides = {}) {
  return {
    id: "finding_1",
    field: "legal_rule",
    claim: "The official rule establishes a filing deadline.",
    evidenceState: "officially_verified",
    sourceIds: ["source_1"],
    relevance: 0.95,
    reliability: 0.98,
    confidence: 0.93,
    conflictStatus: "none",
    decisionImpact: "critical",
    impactDirection: "neutral",
    reason: "Supported by an official source.",
    ...overrides,
  };
}

function writer({ domain, sections, evidence, outputFields, gates = [], selectedMode = "chat" }) {
  return createAdaptiveReportWriterPlan({
    expertiseProfile: profile(domain),
    reportPlan: plan(domain, sections, gates, selectedMode),
    validatedEvidence: evidence,
    uploadedMaterialTypes: ["application/pdf"],
    outputContract: {
      fields: outputFields,
      labels: Object.fromEntries(outputFields.map((field) => [field, field])),
    },
  });
}

test("report structure comes only from the dynamic report plan", () => {
  const output = writer({
    domain: "manufacturing",
    sections: [
      section("production", "Production", "Assess production evidence"),
      section("capacity", "Capacity", "Assess capacity constraints"),
      section("decorative_appendix", "Decorative Appendix", "No decision value", "standard"),
    ],
    evidence: validation(),
    outputFields: ["domainFindings", "operationalImplications", "sources"],
  });
  assert.deepEqual(output.sections.map((item) => item.id), ["production", "capacity"]);
  assert.doesNotMatch(output.sections.map((item) => item.title).join(" "), /Executive Summary|Risks|Opportunities/);
});

test("legal writer excludes startup and investment artifacts", () => {
  const output = writer({
    domain: "legal",
    sections: [
      section("case_summary", "Case Summary", "Assess the supplied legal facts"),
      section("legal_exposure", "Legal Exposure", "Assess supported legal exposure"),
      section("recommended_next_steps", "Recommended Next Steps", "Provide legal next steps"),
    ],
    evidence: validation(),
    outputFields: ["subjectIdentification", "domainFindings", "riskAnalysis", "recommendedActions"],
  });
  const prohibited = output.prohibitedTopics.join(" ");
  assert.match(prohibited, /TAM|startup metrics|investment score|market size|CAC|LTV/);
  assert.doesNotMatch(output.sections.map((item) => item.title).join(" "), /Market Size|Investment Score/);
});

test("accounting writer excludes contract clauses and legal strategy", () => {
  const output = writer({
    domain: "accounting",
    sections: [
      section("financial_health", "Financial Health", "Assess reported financial health"),
      section("tax_risks", "Tax Risks", "Assess supported tax risks"),
    ],
    evidence: validation(),
    outputFields: ["financialImplications", "riskAnalysis"],
  });
  assert.match(output.prohibitedTopics.join(" "), /contract clauses|legal strategy/);
});

test("real-estate uploaded title evidence is preliminary rather than verified ownership", () => {
  const titleFinding = finding({
    field: "title_status",
    claim: "The uploaded image displays a title-related entry.",
    evidenceState: "uploaded_document",
    sourceIds: [],
    confidence: 0.75,
  });
  const output = writer({
    domain: "real_estate",
    sections: [section("title_ownership", "Ownership Summary", "Assess title and ownership evidence")],
    evidence: validation({
      findings: [titleFinding],
      sectionSupport: [
        {
          sectionId: "title_ownership",
          supportedFindingIds: ["finding_1"],
          unresolvedFindings: ["Current official title status"],
          risks: [],
          opportunities: [],
          conflictIds: [],
          decisionImpact: "critical",
        },
      ],
      quality: "preliminary",
    }),
    outputFields: ["ownershipTitleFindings"],
  });
  assert.equal(output.sections[0].evidence[0].certainty, "Preliminary finding");
  assert.equal(output.sections[0].confidenceExpression, "Requires verification");
  assert.match(output.sections[0].writingInstructions.join(" "), /Never claim title, ownership/);
});

test("logistics and retail plans preserve their own professional sections", () => {
  const logistics = writer({
    domain: "logistics",
    sections: [
      section("route_analysis", "Route Analysis", "Assess route efficiency"),
      section("warehouse_efficiency", "Warehouse Efficiency", "Assess warehouse performance"),
    ],
    evidence: validation(),
    outputFields: ["operationalImplications", "domainFindings"],
  });
  const retail = writer({
    domain: "retail",
    sections: [
      section("branch_comparison", "Branch Comparison", "Compare branch performance"),
      section("inventory", "Inventory", "Assess inventory performance"),
    ],
    evidence: validation(),
    outputFields: ["domainFindings", "operationalImplications"],
  });
  assert.deepEqual(logistics.sections.map((item) => item.id), ["route_analysis", "warehouse_efficiency"]);
  assert.deepEqual(retail.sections.map((item) => item.id), ["branch_comparison", "inventory"]);
});

test("one validated finding is owned by only one report section", () => {
  const shared = finding();
  const output = writer({
    domain: "legal",
    sections: [
      section("case_summary", "Case Summary", "Summarize the legal case"),
      section("risk_analysis", "Risk Analysis", "Assess legal risk"),
    ],
    evidence: validation({
      findings: [shared],
      sectionSupport: [
        { sectionId: "case_summary", supportedFindingIds: ["finding_1"], unresolvedFindings: [], risks: [], opportunities: [], conflictIds: [], decisionImpact: "critical" },
        { sectionId: "risk_analysis", supportedFindingIds: ["finding_1"], unresolvedFindings: [], risks: [], opportunities: [], conflictIds: [], decisionImpact: "critical" },
      ],
    }),
    outputFields: ["domainFindings", "riskAnalysis"],
  });
  assert.equal(output.sections.reduce((count, item) => count + item.evidence.length, 0), 1);
});

test("recommendations reference validated findings and insufficient evidence receives bounded decision guidance", () => {
  const supported = writer({
    domain: "legal",
    sections: [section("recommended_next_steps", "Recommended Next Steps", "Provide next steps")],
    evidence: validation({ findings: [finding()] }),
    outputFields: ["recommendedActions"],
  });
  assert.match(supported.sections[0].writingInstructions.join(" "), /Base recommendations on these previously established findings/);

  const insufficient = writer({
    domain: "legal",
    sections: [section("recommended_next_steps", "Recommended Next Steps", "Provide next steps")],
    evidence: validation({ quality: "insufficient" }),
    outputFields: ["recommendedActions"],
  });
  const context = formatAdaptiveReportWriterContext(insufficient);
  assert.match(context, /why the information may be unavailable/i);
  assert.match(context, /bounded decision/i);
  assert.doesNotMatch(context, /Additional verification is recommended\./);
});

test("writer preserves the exact decision question and requires consultant-grade interpretation", () => {
  const output = createAdaptiveReportWriterPlan({
    expertiseProfile: profile("business", {
      userGoal: "Should we enter the European decision-intelligence market?",
    }),
    reportPlan: plan("business", [
      section("executive_recommendation", "Executive Recommendation", "Decide whether to enter"),
    ], [], "plan"),
    validatedEvidence: validation(),
    outputContract: { fields: ["executiveRecommendation"] },
  });
  const context = formatAdaptiveReportWriterContext(output);
  assert.equal(output.decisionQuestion, "Should we enter the European decision-intelligence market?");
  assert.match(context, /Every sentence must help answer the stated decision question/i);
  assert.match(context, /causal driver.*decision implication.*execution risk.*recommended response/i);
});

test("numeric evidence is preserved and multiple sources require like-for-like comparison", () => {
  const marketFinding = finding({
    field: "market_growth",
    claim: "The market increases from USD 10 billion in 2026 to USD 20 billion in 2031.",
    sourceIds: ["source_1", "source_2"],
    reason: "Two independent forecasts report 14.9% CAGR for 2026-2031.",
  });
  const output = writer({
    domain: "business",
    sections: [section("market_analysis", "Market Analysis", "Assess market growth")],
    evidence: validation({
      findings: [marketFinding],
      sources: [
        {
          id: "source_1", title: "Forecast A", publisher: "Authority A",
          url: "https://authority-a.test/forecast", sourceType: "industry report",
          authority: 0.9, reliability: 0.9, publishedDate: "2026-01-01", accessedAt: "2026-08-01",
        },
        {
          id: "source_2", title: "Forecast B", publisher: "Authority B",
          url: "https://authority-b.test/forecast", sourceType: "industry report",
          authority: 0.88, reliability: 0.9, publishedDate: "2026-02-01", accessedAt: "2026-08-01",
        },
      ],
      sectionSupport: [
        { sectionId: "market_analysis", supportedFindingIds: ["finding_1"], unresolvedFindings: [], risks: [], opportunities: [], conflictIds: [], decisionImpact: "critical" },
      ],
    }),
    outputFields: ["marketOpportunity"],
  });
  assert.deepEqual(output.sections[0].evidence[0].numericSignals, [
    "USD 10 billion", "2026", "USD 20 billion", "2031", "14.9%",
  ]);
  assert.equal(output.sections[0].evidence[0].requiresSourceComparison, true);
  assert.match(formatAdaptiveReportWriterContext(output), /do not average incompatible figures/i);
});

test("executive recommendation contract requires one verdict and a three-action 30-day plan", () => {
  const output = writer({
    domain: "business",
    sections: [section("executive_recommendation", "Executive Recommendation", "Make the investment decision")],
    evidence: validation(),
    outputFields: ["executiveRecommendation"],
    selectedMode: "plan",
  });
  const rules = output.sections[0].writingInstructions.join(" ");
  assert.match(rules, /Should proceed, Why, Biggest opportunity, Biggest risk/);
  assert.match(rules, /three-action Next 30-day plan/);
});

test("only the final recommendation owner receives the executive recommendation contract", () => {
  const output = writer({
    domain: "business",
    sections: [
      section("executive_summary", "Executive Summary", "Summarize the decision"),
      section("market_analysis", "Market Analysis", "Assess the market"),
      section("executive_recommendation", "Executive Recommendation", "Conclude the decision"),
    ],
    evidence: validation(),
    outputFields: ["executiveSummary", "marketOpportunity", "executiveRecommendation"],
    selectedMode: "plan",
  });
  const owners = output.sections.filter((item) =>
    item.writingInstructions.some((rule) => /three-action Next 30-day plan/.test(rule))
  );
  assert.deepEqual(owners.map((item) => item.id), ["executive_recommendation"]);
});

test("writer preserves the selected analysis mode and existing output contract", () => {
  const output = writer({
    domain: "business",
    sections: [
      section("problem", "Problem", "Assess the customer problem"),
      section("validation_strategy", "Validation Strategy", "Define evidence-led validation"),
      section("roadmap", "90-Day Roadmap", "Prioritize the next ninety days"),
    ],
    evidence: validation(),
    outputFields: ["problem", "kpiDashboard", "roadmap306090"],
    selectedMode: "plan",
  });
  assert.equal(output.selectedMode, "plan");
  assert.ok(output.sections.every((item) => ["problem", "kpiDashboard", "roadmap306090"].includes(item.outputField)));
  assert.equal(adaptiveReportWriterPlanSchema.safeParse(output).success, true);
});

test("formatted writer context hides internal evidence and provider metadata", () => {
  const output = writer({
    domain: "legal",
    sections: [section("case_summary", "Case Summary", "Assess the legal case")],
    evidence: validation({
      findings: [finding()],
      sectionSupport: [
        { sectionId: "case_summary", supportedFindingIds: ["finding_1"], unresolvedFindings: [], risks: [], opportunities: [], conflictIds: [], decisionImpact: "critical" },
      ],
    }),
    outputFields: ["domainFindings"],
  });
  const context = formatAdaptiveReportWriterContext(output);
  assert.match(context, /Official record — https:\/\/authority\.gov\.test\/records\/1/);
  assert.doesNotMatch(context, /finding_1|source_1|provider|research query|retry|schema/i);
});

test("all three existing report-writing paths consume the adaptive writer", async () => {
  const source = await readFile(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  assert.equal((source.match(/createAdaptiveReportWriterPlan\(\{/g) || []).length, 3);
  assert.equal((source.match(/Adaptive report-writing contract:/g) || []).length, 3);
  assert.doesNotMatch(source, /pdf-engine\/.*adaptive-report-writer/);
});
