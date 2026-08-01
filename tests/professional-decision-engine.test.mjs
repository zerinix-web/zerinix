import test from "node:test";
import assert from "node:assert/strict";
import {
  createProfessionalDecision,
  professionalDecisionSchema,
} from "../app/lib/ai/decision-engine/index.ts";
import { scoreValidatedEvidence } from "../app/lib/ai/evidence-scoring/index.ts";
import { createAdaptiveReportWriterPlan } from "../app/lib/ai/adaptive-report-writer.ts";

const profile = {
  domain: "real_estate",
  subdomain: "land_investment",
  taskType: "investment_decision",
  jurisdiction: "Türkiye",
  userGoal: "decide whether to invest in the land",
  professionalPerspective: "real-estate investment advisor",
  requiredAnalyses: [],
  decisionCriteria: [],
  requiredEvidence: ["official title and zoning evidence"],
  forbiddenTopics: [],
  criticalClarifications: [],
  confidence: 0.9,
};

const reportPlan = {
  reportTitle: "Land Investment Decision",
  reportPurpose: "Support a defensible land investment decision",
  primaryDecision: "decide whether to invest in the land",
  domain: "real_estate",
  subdomain: "land_investment",
  taskType: "investment_decision",
  selectedMode: "chat",
  sections: [
    {
      id: "executive_decision",
      title: "Executive Decision",
      purpose: "State the professional investment decision",
      requiredEvidenceTypes: ["official_source", "external_source"],
      analysisMethod: "decision_synthesis",
      priority: "critical",
    },
  ],
  dashboardMetrics: [],
  decisionCriteria: [],
  decisionGates: [],
  requiredEvidence: ["official title and zoning evidence"],
  forbiddenSections: [],
  clarificationQuestions: [],
  language: "en",
};

function source(id = "official_source", overrides = {}) {
  return {
    id,
    title: "Official parcel record",
    publisher: "Land Registry",
    url: `https://registry.gov.test/parcel/${id}`,
    sourceType: "official record",
    authority: 0.98,
    reliability: 0.98,
    publishedDate: "2026-06-01",
    accessedAt: "2026-08-01",
    ...overrides,
  };
}

function finding(id, overrides = {}) {
  return {
    id,
    field: "zoning",
    claim: `Decision-relevant finding ${id} is supported by an official parcel record.`,
    evidenceState: "officially_verified",
    sourceIds: ["official_source"],
    relevance: 0.96,
    reliability: 0.98,
    confidence: 0.94,
    conflictStatus: "none",
    decisionImpact: "critical",
    impactDirection: "favorable",
    reason: "The parcel-specific official record directly affects lawful development potential.",
    ...overrides,
  };
}

function validation({ findings = [], sources = [], conflicts = [], gates = [] } = {}) {
  return {
    version: "evidence_validation_v1",
    selectedMode: "chat",
    findings,
    sources,
    conflicts,
    unresolvedQuestions: [],
    decisionGates: gates,
    sectionSupport: [
      {
        sectionId: "executive_decision",
        supportedFindingIds: findings.map((item) => item.id),
        unresolvedFindings: [],
        risks: [],
        opportunities: [],
        conflictIds: conflicts.map((item) => item.id),
        decisionImpact: "critical",
      },
    ],
    overallEvidenceQuality: findings.length ? "moderate" : "insufficient",
  };
}

function decide(validatedEvidence) {
  const scoring = scoreValidatedEvidence({
    domain: profile.domain,
    validation: validatedEvidence,
  });
  return createProfessionalDecision({
    expertiseProfile: profile,
    reportPlan,
    validation: validatedEvidence,
    scoring,
  });
}

test("verified material adverse evidence produces AVOID", () => {
  const decision = decide(
    validation({
      findings: [
        finding("legal_access", {
          field: "legal_access",
          claim: "The official record confirms that the parcel has no legal access.",
          impactDirection: "adverse",
          reason: "Without legal access, development and liquidity are materially impaired.",
        }),
      ],
      sources: [source()],
    })
  );
  assert.equal(decision.outcome, "avoid");
  assert.match(decision.executiveDecision, /Do not proceed/);
  assert.equal(decision.topRisks[0].evidenceIds[0], "legal_access");
});

test("a critical unresolved gate produces WAIT and an exact next action", () => {
  const decision = decide(
    validation({
      findings: [finding("market_signal")],
      sources: [source()],
      gates: [
        {
          id: "zoning_gate",
          condition: "Parcel-specific zoning must be officially verified.",
          status: "unresolved",
          supportingFindingIds: [],
          requiredEvidenceFields: ["zoning"],
          decisionImpact: "critical",
          requiredNextAction: "Obtain the current official zoning certificate.",
        },
      ],
    })
  );
  assert.equal(decision.outcome, "wait");
  assert.equal(
    decision.recommendedNextAction.action,
    "Obtain the current official zoning certificate."
  );
  assert.equal(decision.topRisks[0].statement, "Parcel-specific zoning must be officially verified.");
  assert.ok(decision.confidence.limitingFactors.includes("Parcel-specific zoning must be officially verified."));
});

test("consistent favorable material evidence permits PROCEED", () => {
  const decision = decide(
    validation({
      findings: [finding("zoning"), finding("access", { field: "legal_access" })],
      sources: [source()],
    })
  );
  assert.equal(decision.outcome, "proceed");
  assert.equal(decision.topOpportunities.length, 2);
  assert.ok(decision.recommendedNextAction.supportingEvidenceIds.length > 0);
  assert.equal(professionalDecisionSchema.safeParse(decision).success, true);
});

test("insufficient evidence produces no fabricated risk or opportunity", () => {
  const decision = decide(validation());
  assert.equal(decision.outcome, "insufficient_evidence");
  assert.deepEqual(decision.topRisks, []);
  assert.deepEqual(decision.topOpportunities, []);
  assert.equal(decision.confidence.level, "low");
  assert.match(decision.recommendedNextAction.action, /official title and zoning evidence/);
});

test("an unresolved material contradiction lowers confidence and prevents proceeding", () => {
  const conflicted = validation({
    findings: [
      finding("zoning_a", {
        claim: "The parcel is zoned for development.",
        conflictStatus: "conflicted",
      }),
      finding("zoning_b", {
        claim: "The parcel remains agricultural land.",
        conflictStatus: "conflicted",
        impactDirection: "adverse",
        sourceIds: ["second_source"],
      }),
    ],
    sources: [source(), source("second_source")],
    conflicts: [
      {
        id: "zoning_conflict",
        field: "zoning",
        findingIds: ["zoning_a", "zoning_b"],
        sourceIds: ["official_source", "second_source"],
        comparison: {
          authority: "equal",
          date: "equal",
          relevance: "equal",
          specificity: "equal",
        },
        decisionImpact: "critical",
        resolutionRequired: "Obtain the controlling current zoning record.",
      },
    ],
  });
  const decision = decide(conflicted);
  assert.equal(decision.outcome, "wait");
  assert.equal(decision.conflicts[0].preferredClaim, "");
  assert.match(decision.conflicts[0].explanation, /not sufficient to prefer/);
  assert.ok(decision.confidence.limitingFactors.some((item) => /Unresolved conflict/.test(item)));
});

test("a material conflict uses only the defensibly stronger claim to set direction", () => {
  const conflicted = validation({
    findings: [
      finding("official_access", {
        field: "legal_access",
        claim: "The official record confirms no legal road access.",
        conflictStatus: "conflicted",
        impactDirection: "adverse",
      }),
      finding("listing_access", {
        field: "legal_access",
        claim: "A property listing advertises direct road access.",
        evidenceState: "market_indication",
        sourceIds: ["listing_source"],
        reliability: 0.5,
        confidence: 0.55,
        conflictStatus: "conflicted",
        impactDirection: "favorable",
      }),
    ],
    sources: [
      source(),
      source("listing_source", {
        title: "Property listing",
        publisher: "Listing site",
        url: "https://listings.test/land/1",
        sourceType: "market listing",
        authority: 0.4,
        reliability: 0.5,
      }),
    ],
    conflicts: [
      {
        id: "access_conflict",
        field: "legal_access",
        findingIds: ["official_access", "listing_access"],
        sourceIds: ["official_source", "listing_source"],
        comparison: {
          authority: "official record versus listing",
          date: "both current",
          relevance: "both address access",
          specificity: "official parcel record is controlling",
        },
        decisionImpact: "critical",
        resolutionRequired: "Verify access against the controlling official record.",
      },
    ],
  });
  const decision = decide(conflicted);
  assert.equal(decision.conflicts[0].preferredClaim, "The official record confirms no legal road access.");
  assert.equal(decision.outcome, "avoid");
  assert.equal(decision.topOpportunities.length, 0);
  assert.match(decision.conflicts[0].explanation, /higher-scoring claim is more reliable/);
});

test("Adaptive Report Writer consumes the Professional Decision without changing output contracts", () => {
  const validatedEvidence = validation({
    findings: [finding("zoning")],
    sources: [source()],
  });
  const writerPlan = createAdaptiveReportWriterPlan({
    expertiseProfile: profile,
    reportPlan,
    validatedEvidence,
    outputContract: { fields: ["finalRecommendation"] },
  });
  assert.equal(writerPlan.decision.outcome, "proceed");
  assert.equal(writerPlan.sections[0].outputField, "finalRecommendation");
  assert.equal(writerPlan.recommendationEvidence[0].claim, writerPlan.decision.decisionRationale[0].statement);
});
