import test from "node:test";
import assert from "node:assert/strict";
import {
  findStrategicRecommendationsStructureIssues,
  assertStrategicRecommendationsNumbering,
  StrategicRecommendationsStructureError,
} from "../app/lib/report-engine/strategic-recommendations-integrity.ts";

test("a complete, sequential three-item action plan has no hard issues", () => {
  const content = [
    "Conclusion: Evidence supports entering.",
    "1) Buyer Evidence Program — Owner: Head of Sales; Budget: $50k outreach; KPI: 20 procurement engagements; Success = 10 NDAs within 60 days.",
    "2) Compliance Offer Pilot — Owner: Product Lead; Budget: $150k implementation; KPI: 3 targeted demos; Success = 1 pilot contract within 90 days.",
    "3) Regional Expansion — Owner: VP Sales; Budget: $80k; KPI: 5 enterprise leads in North America; Success = 2 signed contracts within 120 days.",
  ].join("\n");

  const issues = findStrategicRecommendationsStructureIssues(content);
  const hardIssues = issues.filter((issue) => issue.type !== "missing_field");
  assert.deepEqual(hardIssues, []);
  assert.doesNotThrow(() => assertStrategicRecommendationsNumbering(content));
});

test("numbering that skips from 1 straight to 2, missing item 1, is a hard gap", () => {
  // Reproduces a real, live-observed defect: the plan's own numbered list
  // started at 2 with no item 1 anywhere in the section.
  const content = [
    "Conclusion: Evidence supports entering.",
    "2) Buyer Evidence Program — Owner: Head of Sales; Budget: $50k; KPI: 20 engagements; Success = 10 NDAs within 60 days.",
    "3) Compliance Offer Pilot — Owner: Product Lead; Budget: $150k; KPI: 3 demos; Success = 1 pilot within 90 days.",
  ].join("\n");

  const issues = findStrategicRecommendationsStructureIssues(content);
  assert.ok(issues.some((issue) => issue.type === "numbering_gap"));
  assert.throws(
    () => assertStrategicRecommendationsNumbering(content),
    StrategicRecommendationsStructureError
  );
});

test("a duplicated item number is a hard gap", () => {
  const content = [
    "1) First action — Owner: A; Budget: $10k; KPI: leads; Success = 5 within 30 days.",
    "1) Duplicate number reused — Owner: B; Budget: $20k; KPI: demos; Success = 3 within 30 days.",
  ].join("\n");

  const issues = findStrategicRecommendationsStructureIssues(content);
  assert.ok(issues.some((issue) => issue.type === "duplicate_number"));
  assert.throws(() => assertStrategicRecommendationsNumbering(content));
});

test("a numbered item with no substantive body is flagged as truncated", () => {
  const content = ["1) TBD", "2) Real action with a body — Owner: A; Budget: $5k; KPI: X; Success = Y."].join("\n");

  const issues = findStrategicRecommendationsStructureIssues(content);
  assert.ok(issues.some((issue) => issue.type === "truncated_item"));
  assert.throws(() => assertStrategicRecommendationsNumbering(content));
});

test("a prose-only AVOID-verdict plan with zero numbered items has no structural issues", () => {
  const content =
    "Conclusion: Evidence does not support entering this market at this time. No supported opportunity exists given current evidence gaps.";

  const issues = findStrategicRecommendationsStructureIssues(content);
  assert.deepEqual(issues, []);
  assert.doesNotThrow(() => assertStrategicRecommendationsNumbering(content));
});

test("missing owner/budget/KPI/success-criterion fields are reported but never thrown", () => {
  const content = [
    "1) Run a pilot with a friendly customer to validate the core assumption before any wider rollout.",
    "2) Compliance Offer Pilot — Owner: Product Lead; Budget: $150k; KPI: 3 demos; Success = 1 pilot within 90 days.",
    "3) Expand the sales motion and grow the team to cover more accounts over time.",
  ].join("\n");

  const issues = findStrategicRecommendationsStructureIssues(content);
  const missingFieldIssues = issues.filter((issue) => issue.type === "missing_field");
  assert.ok(missingFieldIssues.length > 0);
  // Soft signal only -- must never be part of the hard-fail gate.
  assert.doesNotThrow(() => assertStrategicRecommendationsNumbering(content));
});
