import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildDecisionResearchPlan } from "../app/lib/decision-intelligence/research-plan.ts";
import { extractStructuredAssetFacts } from "../app/lib/decision-intelligence/extraction.ts";
import { crossValidateEvidence } from "../app/lib/decision-intelligence/evidence-engine.ts";
import { getDomainProfile } from "../app/lib/decision-intelligence/profiles.ts";
import { extractLegalResearchContext } from "../app/lib/decision-intelligence/legal-research-context.mjs";
import { prepareLegalDecisionReport } from "../app/lib/report-engine/legal-report-quality.ts";

const californiaQuery = `I worked for a software company in California for four years. I was terminated without prior warning after reporting repeated unpaid overtime. My employer classified me as exempt, but I regularly worked 55–65 hours per week without overtime compensation. I signed a severance agreement two days after termination and waived certain legal claims. I want to know whether the agreement may be challenged, what employment law claims I may still have, what evidence is most important, what filing deadlines apply, and what immediate actions I should take.

Jurisdiction:
California, United States

Deadline:
The severance agreement was signed 2 days after termination. I need to evaluate my legal options within the next 30 days.`;

const expectedIssues = [
  "legal_overtime",
  "legal_exempt_status",
  "legal_retaliation",
  "legal_severance_enforceability",
  "legal_claim_waiver",
  "legal_final_pay",
  "legal_filing_routes",
  "legal_limitation_deadlines",
  "legal_evidence_preservation",
  "legal_case_law",
];

function legalPlan() {
  return buildDecisionResearchPlan({
    profile: getDomainProfile("legal"),
    intent: { primary: "legal", secondary: [], confidence: 100, rationale: [] },
    facts: [],
    prompt: californiaQuery,
  });
}

function officialEvidence(overrides = {}) {
  return {
    id: "CAL-1",
    field: "legal_overtime",
    title: "Overtime rules for California employees",
    summary: "California overtime rules apply unless a worker satisfies the applicable exemption tests.",
    value: "The source describes overtime entitlement and exemption requirements.",
    source: "California Department of Industrial Relations",
    url: "https://www.dir.ca.gov/dlse/faq_overtime.htm",
    provider: "fixture",
    confidence: 94,
    official: true,
    verified: true,
    publishedDate: "2026-01-01",
    lastChecked: "2026-07-31T10:00:00.000Z",
    supportingData: ["The cited page directly addresses overtime and exemption requirements."],
    category: "Official Source",
    impact: "favorable",
    impactReason: "Supports reviewing overtime eligibility despite the employer's classification.",
    sourceType: "official agency guidance",
    authorityLevel: "primary",
    jurisdiction: "California, United States",
    supportedIssue: "unpaid overtime",
    proposition: "Overtime eligibility depends on the applicable exemption requirements, not the label alone.",
    sourceClassification: "official agency guidance",
    ...overrides,
  };
}

test("California legal research planning preserves facts and creates issue-specific official-source tasks", () => {
  const context = extractLegalResearchContext(californiaQuery);
  const plan = legalPlan();
  const facts = extractStructuredAssetFacts(californiaQuery, []);
  const factText = facts.map((fact) => `${fact.field}: ${fact.value}`).join("\n");

  assert.equal(context.jurisdiction, "California, United States");
  assert.equal(context.legalDomain, "employment law");
  assert.deepEqual(plan.map((task) => task.field), expectedIssues);
  assert.ok(new Set(plan.map((task) => task.query)).size > 1);
  assert.ok(plan.every((task) => task.jurisdiction === "California, United States"));
  assert.ok(plan.every((task) => task.legalIssue));
  assert.ok(plan.every((task) => task.preferredSources.some((source) => /official|court|agency|regulator|legislation/i.test(source))));

  for (const expectedFact of [
    "employment_duration: four years",
    "employer_industry: software company",
    "jurisdiction_region: California",
    "termination_notice: terminated without prior warning",
    "retaliation_timing: termination after reporting repeated unpaid overtime",
    "employment_classification: classified as exempt",
    "weekly_hours: 55–65 hours per week",
    "overtime_compensation: no overtime compensation",
    "severance_timing: 2 days after termination",
    "claim_waiver: waiver of certain legal claims",
    "decision_deadline: next 30 days",
  ]) {
    assert.match(factText, new RegExp(expectedFact, "i"));
  }
});

test("legal evidence classification retains traceable issue support and rejects unusable sources", () => {
  const valid = officialEvidence();
  const invalid = officialEvidence({
    id: "CAL-BROKEN",
    title: "Validation Required",
    url: "",
    proposition: "",
    sourceClassification: "unsupported/irrelevant",
  });
  const validation = crossValidateEvidence({
    profile: getDomainProfile("legal"),
    evidence: [valid, invalid],
    facts: [],
    unresolvedFields: [],
  });

  assert.equal(validation.evidence.length, 1);
  assert.equal(validation.evidence[0].id, "CAL-1");
  assert.equal(validation.evidence[0].supportedIssue, "unpaid overtime");
  assert.equal(validation.evidence[0].jurisdiction, "California, United States");
  assert.equal(validation.evidence[0].sourceClassification, "official agency guidance");
});

test("California end-to-end research payload remains issue-mapped and produces case-specific legal analysis", () => {
  const plan = legalPlan();
  const facts = extractStructuredAssetFacts(californiaQuery, []);
  const evidence = [
    officialEvidence(),
    officialEvidence({
      id: "CAL-2",
      field: "legal_claim_waiver",
      title: "Employment release enforceability decision",
      summary: "The court decision addresses enforceability of an employment release and waiver.",
      value: "Release enforceability depends on the governing requirements and case facts.",
      source: "California Courts",
      url: "https://law.justia.com/cases/california/supreme-court/4th/24/317.html",
      supportingData: ["The decision discusses an employment release and waiver."],
      supportedIssue: "waiver of employment claims",
      proposition: "A waiver must be assessed under the applicable enforceability requirements.",
      category: "External Research",
      official: false,
      authorityLevel: "secondary",
      source: "Justia",
      sourceClassification: "authoritative secondary source",
    }),
  ];
  const domainEvidence = evidence.map((item) => ({
    id: item.id,
    field: item.field,
    claim: item.summary,
    value: item.value,
    label: item.category === "Official Source"
      ? "Verified from official source"
      : "Verified from external source",
    sourceTitle: item.title,
    publisher: item.source,
    url: item.url,
    sourceType: item.sourceType,
    authorityLevel: item.authorityLevel,
    confidence: item.confidence,
    publishedDate: item.publishedDate,
    lastChecked: item.lastChecked,
    supportingData: item.supportingData,
    impact: item.impact,
    impactReason: item.impactReason,
    jurisdiction: item.jurisdiction,
    supportedIssue: item.supportedIssue,
    proposition: item.proposition,
    sourceClassification: item.sourceClassification,
  }));
  const reportSeed = Object.fromEntries([
    "subjectIdentification", "extractedFacts", "externalEvidence", "domainFindings",
    "regulatoryCompliance", "financialImplications", "operationalImplications",
    "riskAnalysis", "scenarioAnalysis", "decisionAssessment", "missingInformation",
    "recommendedActions", "finalRecommendation", "sources",
  ].map((field) => [field, "Investor Ready Strategy Model Customer validation CAC Market Product"]));
  const research = {
    domain: "legal",
    decisionType: "due_diligence",
    identifiers: [],
    plan,
    evidence: domainEvidence,
    attemptedFields: plan.map((task) => task.field),
    unresolvedFields: plan.filter((task) => !domainEvidence.some((item) => item.field === task.field)).map((task) => task.field),
    researchAttempted: true,
    researchCompleted: false,
    requiredResearchCompletion: 20,
    recommendedOutput: "preliminary_report",
    summary: "Issue-specific fixture research completed.",
    providerResponseId: "fixture",
    fallbackUsed: false,
    failurePhase: "",
    failureReason: "",
    timings: { entityExtractionMs: 0, researchPlanningMs: 0, researchExecutionMs: 0 },
    decisionIntelligence: {
      version: "decision_intelligence_v1",
      intent: { primary: "legal", secondary: [], confidence: 100, rationale: [] },
      domain: "legal",
      domainProfile: getDomainProfile("legal"),
      extractedFacts: facts,
      researchPlan: plan,
      evidenceValidation: {
        evidence,
        conflicts: [],
        corroboratedFields: [],
        unresolvedFields: [],
        coverage: 25,
        confidence: 65,
      },
      decision: {
        finalDecision: "WAIT",
        recommendation: "Proceed Carefully",
        confidence: 65,
        topReasons: [],
        decisionChangingEvidence: "",
        conflictExplanation: "",
        scores: [],
        opportunities: [],
        risks: [],
        contradictions: [],
        unknowns: [],
        rationale: [],
        nextActions: [],
      },
      outputMode: "preliminary_report",
    },
  };
  const report = prepareLegalDecisionReport({
    report: reportSeed,
    research,
    assets: [],
    prompt: californiaQuery,
    language: "English",
  });
  const payload = Object.values(report).join("\n");

  for (const fact of extractLegalResearchContext(californiaQuery).userFacts) {
    assert.match(payload, new RegExp(fact.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(payload, /unpaid overtime/i);
  assert.match(payload, /https:\/\/www\.dir\.ca\.gov\/dlse\/faq_overtime\.htm/);
  assert.doesNotMatch(payload, /Validation Required|Not provided|source\.title|access\.date|reliability\.|Investor Ready|Strategy Model|Customer validation|\bCAC\b|^Market$|^Product$/im);
  assert.doesNotMatch(payload, /No specific unpaid-wage allegation was supplied/i);
  const genericFallbackCount = (payload.match(/professional advice|required documents|depends on reviewing documents/gi) || []).length;
  assert.ok(genericFallbackCount <= 1);

  const researchSource = readFileSync("app/lib/ai/domain-research.ts", "utf8");
  assert.match(researchSource, /assessLegalResearchQualityGate/);
  assert.match(researchSource, /sourceClassification/);
  assert.match(researchSource, /supportedIssue/);
  assert.match(researchSource, /proposition/);
});
