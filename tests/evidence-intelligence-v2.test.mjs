import test from "node:test";
import assert from "node:assert/strict";
import { scoreValidatedEvidence } from "../app/lib/ai/evidence-scoring/index.ts";
import {
  evidenceIntelligenceResultSchema,
} from "../app/lib/ai/evidence-intelligence/index.ts";
import { createProfessionalDecision } from "../app/lib/ai/decision-engine/index.ts";

function source(id, overrides = {}) {
  return {
    id,
    title: `${id} official record`,
    publisher: `${id} authority`,
    url: `https://${id}.gov.test/records/current`,
    sourceType: "official record",
    authority: 0.98,
    reliability: 0.97,
    publishedDate: "2026-06-01",
    accessedAt: "2026-08-01",
    ...overrides,
  };
}

function finding(id, overrides = {}) {
  return {
    id,
    field: "zoning",
    claim: `Parcel zoning is supported by ${id}.`,
    evidenceState: "officially_verified",
    sourceIds: ["zoning_source"],
    relevance: 0.96,
    reliability: 0.97,
    confidence: 0.94,
    conflictStatus: "none",
    decisionImpact: "critical",
    impactDirection: "neutral",
    reason: "A parcel-specific official record directly supports this claim.",
    ...overrides,
  };
}

function validation({
  findings = [],
  sources = [],
  conflicts = [],
  gates = [],
  sections = [],
  unresolvedQuestions = [],
} = {}) {
  return {
    version: "evidence_validation_v1",
    selectedMode: "chat",
    findings,
    sources,
    conflicts,
    unresolvedQuestions,
    decisionGates: gates,
    sectionSupport: sections,
    overallEvidenceQuality: findings.length ? "moderate" : "insufficient",
  };
}

test("Evidence Intelligence v2 emits structured, categorized, quality-scored evidence", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("zoning_fact", {
          claim: "Ada 1517 Parsel 1 has an official parcel zoning record.",
        }),
      ],
      sources: [source("zoning_source")],
    }),
  }).intelligence;

  assert.equal(evidenceIntelligenceResultSchema.safeParse(result).success, true);
  assert.equal(result.version, "evidence_intelligence_v2");
  assert.equal(result.evidence.length, 1);
  const evidence = result.evidence[0];
  assert.equal(evidence.evidenceCategory, "Zoning");
  assert.equal(evidence.evidenceStatus, "verified");
  assert.equal(evidence.sourceName, "zoning_source authority");
  assert.equal(evidence.citations[0].url, "https://zoning_source.gov.test/records/current");
  assert.deepEqual(Object.keys(evidence.quality).toSorted(), [
    "authorityScore",
    "completenessScore",
    "evidenceQualityScore",
    "freshnessScore",
    "reliabilityScore",
  ]);
  assert.ok(evidence.quality.evidenceQualityScore > 0);
  assert.equal(evidence.reliabilityScore, evidence.quality.reliabilityScore);
  assert.equal(evidence.freshnessScore, evidence.quality.freshnessScore);
  assert.equal(evidence.authorityScore, evidence.quality.authorityScore);
  assert.equal(evidence.completenessScore, evidence.quality.completenessScore);
  assert.equal(evidence.evidenceQualityScore, evidence.quality.evidenceQualityScore);
});

test("duplicate evidence is merged while preserving independent citations", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("duplicate_a", {
          claim: "The parcel has confirmed legal road access from the north.",
          field: "access",
          sourceIds: ["access_source_a"],
          impactDirection: "favorable",
        }),
        finding("duplicate_b", {
          claim: "The parcel has confirmed legal road access from the north side.",
          field: "access",
          sourceIds: ["access_source_b"],
          impactDirection: "favorable",
        }),
      ],
      sources: [source("access_source_a"), source("access_source_b")],
    }),
  }).intelligence;

  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.evidence[0].mergedEvidenceIds.toSorted(), [
    "duplicate_a",
    "duplicate_b",
  ]);
  assert.equal(result.evidence[0].citations.length, 2);
  assert.equal(result.evidence[0].supportsDecision, true);
});

test("conflicting zoning evidence creates an Evidence Conflict without dropping either claim", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("residential", {
          claim: "The parcel is zoned for residential development.",
          sourceIds: ["residential_source"],
        }),
        finding("agricultural", {
          claim: "The parcel is zoned as agricultural land.",
          sourceIds: ["agricultural_source"],
        }),
      ],
      sources: [
        source("residential_source"),
        source("agricultural_source"),
      ],
    }),
  }).intelligence;

  assert.equal(result.evidence.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].evidenceIds.toSorted(), [
    "agricultural",
    "residential",
  ]);
  assert.equal(result.conflicts[0].status, "unresolved");
  assert.equal(result.summary.conflictingEvidence.length, 1);
  assert.ok(result.evidence.every((item) => item.evidenceStatus === "conflicting"));
});

test("Evidence Summary reports coverage, pending verification, missing evidence, and critical unknowns", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("verified_zoning"),
        finding("user_price", {
          field: "purchase_price",
          claim: "The user reports an asking price of 10,000,000 TRY.",
          evidenceState: "user_statement",
          sourceIds: [],
          confidence: "Preliminary",
        }),
      ],
      sources: [source("zoning_source")],
      unresolvedQuestions: ["Current title and encumbrance record"],
      gates: [
        {
          id: "zoning_gate",
          condition: "Official zoning must be verified.",
          status: "passed",
          supportingFindingIds: ["verified_zoning"],
          requiredEvidenceFields: ["zoning"],
          decisionImpact: "critical",
          requiredNextAction: "Retain the zoning record.",
        },
        {
          id: "title_gate",
          condition: "Current title must be verified.",
          status: "unresolved",
          supportingFindingIds: [],
          requiredEvidenceFields: ["title_status"],
          decisionImpact: "critical",
          requiredNextAction: "Obtain the current title record.",
        },
      ],
      sections: [
        {
          sectionId: "zoning",
          supportedFindingIds: ["verified_zoning"],
          unresolvedFindings: [],
          risks: [],
          opportunities: [],
          conflictIds: [],
          decisionImpact: "critical",
        },
      ],
    }),
  }).intelligence;

  assert.equal(result.summary.verifiedFacts.length, 1);
  assert.equal(result.summary.pendingVerification.length, 1);
  assert.ok(result.summary.missingEvidence.includes("Current title and encumbrance record"));
  assert.ok(result.summary.criticalUnknowns.includes("Current title must be verified."));
  assert.equal(result.summary.evidenceCoverage, 67);
});

test("Decision Engine confidence explicitly consumes Evidence Intelligence quality metrics", () => {
  const validated = validation({
    findings: [
      finding("zoning", {
        claim: "Official zoning permits the proposed land use.",
        impactDirection: "favorable",
      }),
    ],
    sources: [source("zoning_source")],
    sections: [
      {
        sectionId: "executive_decision",
        supportedFindingIds: ["zoning"],
        unresolvedFindings: [],
        risks: [],
        opportunities: [],
        conflictIds: [],
        decisionImpact: "critical",
      },
    ],
  });
  const scoring = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validated,
  });
  const decision = createProfessionalDecision({
    expertiseProfile: {
      domain: "real_estate",
      subdomain: "land_investment",
      taskType: "investment_decision",
      jurisdiction: "Türkiye",
      userGoal: "decide whether to invest",
      professionalPerspective: "real-estate investment advisor",
      requiredAnalyses: [],
      decisionCriteria: [],
      requiredEvidence: [],
      forbiddenTopics: [],
      criticalClarifications: [],
      confidence: 0.9,
    },
    reportPlan: {
      reportTitle: "Investment Decision",
      reportPurpose: "Support a decision",
      primaryDecision: "decide whether to invest",
      domain: "real_estate",
      subdomain: "land_investment",
      taskType: "investment_decision",
      selectedMode: "chat",
      sections: [],
      dashboardMetrics: [],
      decisionCriteria: [],
      decisionGates: [],
      requiredEvidence: [],
      forbiddenSections: [],
      clarificationQuestions: [],
      language: "en",
    },
    validation: validated,
    scoring,
  });

  assert.match(decision.confidence.explanation, /Evidence quality contributes/);
  assert.match(decision.confidence.explanation, /coverage contributes/);
  assert.match(decision.confidence.explanation, /authority contributes/);
  assert.match(decision.confidence.explanation, /freshness contributes/);
});
