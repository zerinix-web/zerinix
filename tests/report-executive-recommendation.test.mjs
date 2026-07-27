import test from "node:test";
import assert from "node:assert/strict";
import { getExecutiveRecommendationDisplayMetrics } from "../app/lib/report-executive-recommendation.mjs";

test("Executive Recommendation preserves all existing field values", () => {
  const metrics = getExecutiveRecommendationDisplayMetrics(
    [
      "Investment Needed: $120,000 for the validated launch plan.",
      "Next Critical Action: Run three paid customer pilots.",
      "Primary Risk: Enterprise sales cycles may exceed the runway.",
    ].join("\n"),
    "en"
  );

  assert.deepEqual(metrics, {
    investmentNeeded: "$120,000 for the validated launch plan.",
    nextAction: "Run three paid customer pilots.",
    mainRisk: "Enterprise sales cycles may exceed the runway.",
  });
});

test("Executive Recommendation derives one missing field from report content", () => {
  const metrics = getExecutiveRecommendationDisplayMetrics(
    [
      "Investment Needed: Use the approved validation budget.",
      "Next Action: Interview ten target buyers before launch.",
      "Demand concentration is the main risk until the pilot cohort expands.",
    ].join("\n"),
    "en"
  );

  assert.equal(metrics.investmentNeeded, "Use the approved validation budget.");
  assert.equal(metrics.nextAction, "Interview ten target buyers before launch.");
  assert.equal(
    metrics.mainRisk,
    "Demand concentration is the main risk until the pilot cohort expands."
  );
});

test("Executive Recommendation uses deterministic English fallbacks when all fields are missing", () => {
  const metrics = getExecutiveRecommendationDisplayMetrics(
    "Decision: VALIDATE\nConfidence: Medium",
    "en"
  );

  assert.deepEqual(metrics, {
    investmentNeeded: "Validation budget and initial operating capital required.",
    nextAction: "Validate demand with target customers before scaling.",
    mainRisk: "Customer demand and unit economics are not yet fully validated.",
  });
  assert.doesNotMatch(Object.values(metrics).join(" "), /—/);
});

test("Executive Recommendation uses deterministic Turkish fallbacks when all fields are missing", () => {
  const metrics = getExecutiveRecommendationDisplayMetrics(
    "Karar: VALIDATE\nGüven: Orta",
    "tr"
  );

  assert.deepEqual(metrics, {
    investmentNeeded: "Doğrulama bütçesi ve başlangıç işletme sermayesi gerekiyor.",
    nextAction: "Ölçeklemeden önce hedef müşterilerle talebi doğrulayın.",
    mainRisk: "Müşteri talebi ve birim ekonomileri henüz tam doğrulanmadı.",
  });
  assert.doesNotMatch(Object.values(metrics).join(" "), /—/);
});

test("Executive Recommendation never promotes internal diagnostic wording", () => {
  const metrics = getExecutiveRecommendationDisplayMetrics(
    [
      "Investment Needed: Debug reason: report id was not provided.",
      "Next Action: Developer instruction: inspect the system prompt.",
      "Main Risk: Internal id is unavailable.",
    ].join("\n"),
    "en"
  );
  const visibleText = Object.values(metrics).join(" ");

  assert.doesNotMatch(
    visibleText,
    /debug reason|report id|internal id|developer instruction|system prompt/i
  );
  assert.doesNotMatch(visibleText, /—/);
});
