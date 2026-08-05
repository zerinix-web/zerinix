import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeSelectedAnalysisMode } from "../app/lib/ai/expertise-profile.ts";

// This is a dedicated regression test for the Executive Decision
// System production-integration task: the EDS/Decision-Engine gate in
// app/api/plan/route.ts must never intercept Market Intelligence
// ("market" mode) requests, even once ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED
// is turned on for a staged rollout of Business Idea Validation
// ("plan" mode). Market Intelligence has its own, completely separate
// report-generation pipeline (executeMarketAnalysisRequest); if this
// gate were scoped any broader than "plan" mode, a market-mode request
// could reach Decision Engine/EDS here first and be rejected with a
// 422 before its own pipeline ever runs.

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

test("normalizeSelectedAnalysisMode never resolves 'market' or 'chat' to 'plan'", () => {
  assert.equal(normalizeSelectedAnalysisMode("plan"), "plan");
  assert.notEqual(normalizeSelectedAnalysisMode("market"), "plan");
  assert.notEqual(normalizeSelectedAnalysisMode("chat"), "plan");
  assert.notEqual(normalizeSelectedAnalysisMode(undefined), "plan");
  assert.notEqual(normalizeSelectedAnalysisMode("anything else"), "plan");
});

test("both the Executive Decision System and Decision Engine route gates are scoped to Business Idea Validation ('plan' mode) only", () => {
  const edsIndex = planRouteSource.indexOf("const isSupportedExecutiveDecisionSystemContext =");
  const decisionEngineIndex = planRouteSource.indexOf("const isSupportedDecisionEngineContext =");
  assert.ok(edsIndex >= 0 && decisionEngineIndex > edsIndex);

  const edsPredicate = planRouteSource.slice(edsIndex, planRouteSource.indexOf(";", edsIndex));
  const decisionEnginePredicate = planRouteSource.slice(
    decisionEngineIndex,
    planRouteSource.indexOf(";", decisionEngineIndex)
  );

  assert.match(edsPredicate, /normalizeSelectedAnalysisMode\(body\.analysisMode\) === "plan"/);
  assert.match(decisionEnginePredicate, /normalizeSelectedAnalysisMode\(body\.analysisMode\) === "plan"/);
  assert.doesNotMatch(edsPredicate, /!== "chat"/);
  assert.doesNotMatch(decisionEnginePredicate, /!== "chat"/);
});

test("the Brain Orchestrator block's own, separate 'not chat mode' scope is untouched by this integration", () => {
  const brainIndex = planRouteSource.indexOf("const isSupportedBrainOrchestratorContext =");
  assert.ok(brainIndex >= 0);
  const brainPredicate = planRouteSource.slice(brainIndex, planRouteSource.indexOf(";", brainIndex));
  assert.match(brainPredicate, /normalizeSelectedAnalysisMode\(body\.analysisMode\) !== "chat"/);
});

test("Market Intelligence's own delegation ('isMarketIntelligenceRequest') is defined after, and structurally independent of, the EDS/Decision Engine gate", () => {
  const edsIndex = planRouteSource.indexOf("const isSupportedExecutiveDecisionSystemContext =");
  const marketIndex = planRouteSource.indexOf("const isMarketIntelligenceRequest =");
  assert.ok(edsIndex >= 0 && marketIndex > edsIndex);
});
