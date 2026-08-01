import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceScoringResultSchema,
  scoreValidatedEvidence,
} from "../app/lib/ai/evidence-scoring/index.ts";
import {
  createAdaptiveReportWriterPlan,
  formatAdaptiveReportWriterContext,
} from "../app/lib/ai/adaptive-report-writer.ts";

function source(id, overrides = {}) {
  return {
    id,
    title: `${id} title`,
    publisher: `${id} publisher`,
    url: `https://${id}.gov.test/records/1`,
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
    claim: `Parcel-specific zoning claim supported by ${id}.`,
    evidenceState: "officially_verified",
    sourceIds: ["official_source"],
    relevance: 0.95,
    reliability: 0.98,
    confidence: 0.93,
    conflictStatus: "none",
    decisionImpact: "critical",
    impactDirection: "neutral",
    reason: "Supported by a directly relevant official record.",
    ...overrides,
  };
}

function validation({ findings, sources, conflicts = [] }) {
  return {
    version: "evidence_validation_v1",
    selectedMode: "chat",
    findings,
    sources,
    conflicts,
    unresolvedQuestions: [],
    decisionGates: [],
    sectionSupport: [],
    overallEvidenceQuality: "moderate",
  };
}

test("every finding receives all six deterministic scoring criteria", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [finding("official")],
      sources: [source("official_source")],
    }),
  });
  const scored = result.findings[0];
  assert.deepEqual(Object.keys(scored.criteria).toSorted(), [
    "authority",
    "completeness",
    "confidence",
    "consistency",
    "recency",
    "relevance",
  ]);
  assert.equal(evidenceScoringResultSchema.safeParse(result).success, true);
  assert.ok(scored.finalEvidenceScore > 0);
});

test("official parcel evidence outranks a market listing with otherwise similar inputs", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("official"),
        finding("listing", {
          field: "comparables",
          claim: "A dated listing indicates an asking price for a nearby parcel.",
          evidenceState: "market_indication",
          sourceIds: ["market_source"],
          confidence: 0.9,
          decisionImpact: "high",
        }),
      ],
      sources: [
        source("official_source"),
        source("market_source", {
          url: "https://market.test/listings/1",
          sourceType: "market listing",
          authority: 0.5,
          reliability: 0.58,
        }),
      ],
    }),
  });
  const official = result.findings.find((item) => item.id === "official");
  const listing = result.findings.find((item) => item.id === "listing");
  assert.ok(official.finalEvidenceScore > listing.finalEvidenceScore);
  assert.equal(official.scoreBand, "high");
  assert.notEqual(listing.scoreBand, "high");
});

test("recent market evidence outranks stale market evidence", () => {
  const result = scoreValidatedEvidence({
    domain: "real_estate",
    validation: validation({
      findings: [
        finding("recent", {
          field: "comparables",
          evidenceState: "market_indication",
          sourceIds: ["recent_source"],
        }),
        finding("stale", {
          field: "comparables",
          evidenceState: "market_indication",
          sourceIds: ["stale_source"],
        }),
      ],
      sources: [
        source("recent_source", { authority: 0.55 }),
        source("stale_source", {
          authority: 0.55,
          publishedDate: "2015-01-01",
          accessedAt: "2015-01-01",
        }),
      ],
    }),
  });
  const recent = result.findings.find((item) => item.id === "recent");
  const stale = result.findings.find((item) => item.id === "stale");
  assert.ok(recent.criteria.recency > stale.criteria.recency);
  assert.ok(recent.finalEvidenceScore > stale.finalEvidenceScore);
});

test("user statements and assumptions cannot be scored like verified facts", () => {
  const result = scoreValidatedEvidence({
    domain: "finance",
    validation: validation({
      findings: [
        finding("user", {
          field: "revenue",
          evidenceState: "user_statement",
          sourceIds: [],
          confidence: "Preliminary",
        }),
        finding("assumption", {
          field: "growth",
          evidenceState: "assumption",
          sourceIds: [],
          confidence: "Verification Required",
        }),
      ],
      sources: [],
    }),
  });
  const user = result.findings.find((item) => item.id === "user");
  const assumption = result.findings.find((item) => item.id === "assumption");
  assert.equal(user.scoreBand, "low");
  assert.equal(assumption.scoreBand, "low");
  assert.ok(user.finalEvidenceScore > assumption.finalEvidenceScore);
});

test("conflicts preserve both findings, lower scores and explain the stronger source", () => {
  const base = validation({
    findings: [
      finding("official", {
        claim: "Official zoning permits residential development.",
        conflictStatus: "conflicted",
        impactDirection: "favorable",
      }),
      finding("listing", {
        claim: "A listing states that residential development is not permitted.",
        evidenceState: "market_indication",
        sourceIds: ["market_source"],
        conflictStatus: "conflicted",
        impactDirection: "adverse",
      }),
    ],
    sources: [
      source("official_source"),
      source("market_source", {
        url: "https://market.test/listings/1",
        authority: 0.45,
        reliability: 0.5,
      }),
    ],
    conflicts: [
      {
        id: "conflict_1",
        field: "zoning",
        findingIds: ["official", "listing"],
        sourceIds: ["official_source", "market_source"],
        comparison: {
          authority: "official versus listing",
          date: "both current",
          relevance: "both address zoning",
          specificity: "official record is parcel-specific",
        },
        decisionImpact: "critical",
        resolutionRequired: "Verify the current official zoning record.",
      },
    ],
  });
  const result = scoreValidatedEvidence({ domain: "real_estate", validation: base });
  assert.equal(result.findings.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].preferredFindingId, "official");
  assert.equal(result.conflicts[0].resolution, "higher_scoring_evidence_preferred");
  assert.match(result.conflicts[0].explanation, /authority, relevance, recency, completeness, confidence, and consistency/);
});

test("similar conflicting scores do not create a false winner", () => {
  const result = scoreValidatedEvidence({
    domain: "legal",
    validation: validation({
      findings: [
        finding("left", { conflictStatus: "conflicted", sourceIds: ["left_source"] }),
        finding("right", { conflictStatus: "conflicted", sourceIds: ["right_source"] }),
      ],
      sources: [source("left_source"), source("right_source")],
      conflicts: [
        {
          id: "conflict_1",
          field: "zoning",
          findingIds: ["left", "right"],
          sourceIds: ["left_source", "right_source"],
          comparison: { authority: "equal", date: "equal", relevance: "equal", specificity: "equal" },
          decisionImpact: "high",
          resolutionRequired: "Obtain a controlling source.",
        },
      ],
    }),
  });
  assert.equal(result.conflicts[0].preferredFindingId, "");
  assert.equal(result.conflicts[0].resolution, "no_reliable_winner");
});

function adaptiveFixtures(validatedEvidence) {
  return createAdaptiveReportWriterPlan({
    expertiseProfile: {
      domain: "real_estate",
      subdomain: "land_investment",
      taskType: "investment_decision",
      jurisdiction: "Türkiye",
      userGoal: "Assess a land investment",
      professionalPerspective: "real-estate investment advisor",
      requiredAnalyses: [],
      decisionCriteria: [],
      requiredEvidence: [],
      forbiddenTopics: [],
      criticalClarifications: [],
      confidence: 0.9,
    },
    reportPlan: {
      reportTitle: "Land Investment Assessment",
      reportPurpose: "Support an investment decision",
      primaryDecision: "Determine whether to invest",
      domain: "real_estate",
      subdomain: "land_investment",
      taskType: "investment_decision",
      selectedMode: "chat",
      sections: [
        {
          id: "investment_recommendation",
          title: "Investment Recommendation",
          purpose: "Provide an evidence-led recommendation",
          requiredEvidenceTypes: ["official_source", "external_source"],
          analysisMethod: "decision_synthesis",
          priority: "critical",
        },
      ],
      dashboardMetrics: [],
      decisionCriteria: [],
      decisionGates: [],
      requiredEvidence: [],
      forbiddenSections: [],
      clarificationQuestions: [],
      language: "en",
    },
    validatedEvidence,
    outputContract: { fields: ["finalRecommendation"] },
  });
}

test("adaptive writer exposes score bands and ties recommendation evidence to scored findings", () => {
  const validatedEvidence = validation({
    findings: [
      finding("official"),
      finding("user", {
        field: "purchase_price",
        evidenceState: "user_statement",
        sourceIds: [],
        confidence: "Preliminary",
      }),
    ],
    sources: [source("official_source")],
  });
  validatedEvidence.sectionSupport = [
    {
      sectionId: "investment_recommendation",
      supportedFindingIds: ["official", "user"],
      unresolvedFindings: [],
      risks: [],
      opportunities: [],
      conflictIds: [],
      decisionImpact: "critical",
    },
  ];
  const plan = adaptiveFixtures(validatedEvidence);
  assert.equal(plan.evidenceBands.high.length, 1);
  assert.equal(plan.evidenceBands.low.length, 1);
  assert.equal(plan.recommendationEvidence.length, 1);
  assert.equal(plan.recommendationEvidence[0].claim, plan.evidenceBands.high[0].claim);
  assert.match(formatAdaptiveReportWriterContext(plan), /High confidence findings:/);
  assert.match(formatAdaptiveReportWriterContext(plan), /Final evidence score:/);
});

test("low-confidence evidence cannot drive a substantive recommendation", () => {
  const plan = adaptiveFixtures(
    validation({
      findings: [
        finding("assumption", {
          evidenceState: "assumption",
          sourceIds: [],
          confidence: "Verification Required",
        }),
      ],
      sources: [],
    })
  );
  assert.equal(plan.recommendationEvidence.length, 0);
  assert.match(
    formatAdaptiveReportWriterContext(plan),
    /recommend verification rather than a substantive action/
  );
});
