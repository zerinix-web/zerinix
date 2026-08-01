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

function validation({ findings = [], sectionSupport = [], gates = [], quality = "moderate" } = {}) {
  return {
    version: "evidence_validation_v1",
    selectedMode: "chat",
    findings,
    sources: [
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

test("recommendations reference validated findings and insufficient evidence uses the required fallback", () => {
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
  assert.match(formatAdaptiveReportWriterContext(insufficient), /Additional verification is recommended\./);
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
