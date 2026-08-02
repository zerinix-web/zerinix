import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAggregateResearchEvidence,
  researchEvidenceThresholds,
} from "../app/lib/ai/research-evidence-evaluation.ts";

function evidence(overrides = {}) {
  return {
    claim: "Independent market demand evidence",
    value: "Demand increased in the measured period",
    sourceTitle: "Market dataset",
    url: "https://example.com/research/market-demand",
    label: "Verified from external source",
    confidence: 65,
    qualityScore: 40,
    authorityLevel: "secondary",
    ...overrides,
  };
}

test("multiple independent medium-quality sources pass aggregate evaluation", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence(),
    evidence({
      sourceTitle: "Independent industry study",
      url: "https://industry.test/reports/demand",
      qualityScore: 41,
      confidence: 68,
    }),
  ]);

  assert.equal(result.before.usableEvidenceCount, 0);
  assert.equal(result.before.reportDecision, "clarification");
  assert.equal(result.aggregateSupportIsSufficient, true);
  assert.equal(result.after.usableEvidenceCount, 2);
  assert.equal(result.after.verifiedSources, 2);
  assert.equal(result.after.sourceDiversity, 2);
  assert.equal(result.after.reportDecision, "allow_report");
});

test("one medium-quality source remains insufficient", () => {
  const result = evaluateAggregateResearchEvidence([evidence()]);

  assert.equal(result.aggregateSupportIsSufficient, false);
  assert.equal(result.acceptedEvidence.length, 0);
  assert.equal(result.after.reportDecision, "clarification");
});

test("duplicate domains do not satisfy source diversity", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence(),
    evidence({ url: "https://example.com/research/second-study" }),
  ]);

  assert.equal(result.after.sourceDiversity, 0);
  assert.equal(result.aggregateSupportIsSufficient, false);
  assert.equal(result.after.reportDecision, "clarification");
});

test("a provenance-safe strong source retains the previous behavior", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence({
      qualityScore: researchEvidenceThresholds.legacySingleSourceQuality,
    }),
  ]);

  assert.equal(result.before.usableEvidenceCount, 1);
  assert.equal(result.after.usableEvidenceCount, 1);
  assert.equal(result.after.reportDecision, "allow_report");
});

test("invalid citation URLs cannot enter the aggregate", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence({ url: "fabricated-source", qualityScore: 90, confidence: 95 }),
    evidence({
      url: "javascript:alert(1)",
      qualityScore: 90,
      confidence: 95,
    }),
  ]);

  assert.equal(result.acceptedEvidence.length, 0);
  assert.equal(result.after.verifiedSources, 0);
  assert.equal(result.after.reportDecision, "clarification");
});

test("estimates are preserved for context but cannot satisfy verification", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence({
      label: "Estimate",
      url: "",
      qualityScore: 90,
      confidence: 90,
    }),
  ]);

  assert.equal(result.acceptedEvidence.length, 1);
  assert.equal(result.after.usableEvidenceCount, 0);
  assert.equal(result.after.verifiedSources, 0);
  assert.equal(result.after.reportDecision, "clarification");
});

test("verified uploaded evidence prevents an unnecessary hard failure", () => {
  const result = evaluateAggregateResearchEvidence([
    evidence({
      label: "Verified from uploaded asset",
      url: "",
      authorityLevel: "uploaded",
      qualityScore: 30,
      confidence: 30,
    }),
  ]);

  assert.equal(result.after.usableEvidenceCount, 1);
  assert.equal(result.after.verifiedSources, 0);
  assert.equal(result.after.confidenceScore, 30);
  assert.equal(result.after.reportDecision, "allow_report");
});
