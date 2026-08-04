import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import {
  buildDecisionPlan,
  decisionPlanSchema,
  intelligenceModuleValues,
} from "../app/lib/ai/intelligence-router.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function financialDocument() {
  return createUniversalDocumentIntelligenceFallback({
    assets: [
      {
        name: "q3_report.pdf",
        textContent: `Subject: Q3 2024 Financial Statement Review

FINANCIAL SUMMARY

This report presents the balance sheet and income statement for Acme Corporation for the period ending September 30, 2024.

Revenue for the quarter was $4,500,000, an increase of 12%. There is a material risk of currency exposure given international operations. The board approved the quarterly budget on October 15, 2024.

The company is required to submit quarterly filings to the Ministry of Finance.`,
      },
    ],
  });
}

test("intelligenceModuleValues contains exactly the required 12 modules", () => {
  assert.deepEqual(
    [...intelligenceModuleValues].sort(),
    [
      "Business Intelligence",
      "Market Intelligence",
      "Financial Intelligence",
      "Legal Intelligence",
      "Technical Intelligence",
      "Medical Intelligence",
      "Real Estate Intelligence",
      "HR Intelligence",
      "Risk Intelligence",
      "Investment Intelligence",
      "Executive Summary",
      "Decision Brief",
    ].sort()
  );
});

test("a financial document with risks and decisions recommends Financial Intelligence, Risk Intelligence, and Decision Brief, and excludes unrelated modules", () => {
  const doc = financialDocument();
  const plan = buildDecisionPlan({
    prompt: "Please analyze this quarterly financial report and tell me if we should be concerned.",
    documentIntelligence: doc,
  });

  assert.equal(decisionPlanSchema.safeParse(plan).success, true);
  assert.equal(plan.detectedDomain, "Financial");

  const recommendedModules = plan.recommendedAnalyses.map((item) => item.module);
  assert.ok(recommendedModules.includes("Financial Intelligence"));
  assert.ok(recommendedModules.includes("Risk Intelligence"));
  assert.ok(recommendedModules.includes("Decision Brief"));
  assert.ok(recommendedModules.includes("Executive Summary"));

  const excludedModules = plan.excludedModules.map((item) => item.module);
  assert.ok(excludedModules.includes("Medical Intelligence"));
  assert.ok(excludedModules.includes("HR Intelligence"));
  assert.ok(excludedModules.includes("Legal Intelligence"));

  for (const recommendation of plan.recommendedAnalyses) {
    assert.ok(recommendation.confidence >= 0 && recommendation.confidence <= 1);
    assert.ok(recommendation.rationale.length > 0);
  }
  for (const exclusion of plan.excludedModules) {
    assert.ok(exclusion.reason.length > 0);
  }
});

test("execution priority is ordered by priority level and then confidence, matching recommendedAnalyses", () => {
  const doc = financialDocument();
  const plan = buildDecisionPlan({ documentIntelligence: doc });

  assert.deepEqual(
    plan.executionPriority,
    [...plan.recommendedAnalyses]
      .sort((a, b) => {
        const rank = { critical: 4, high: 3, medium: 2, low: 1 };
        return rank[b.priority] - rank[a.priority] || b.confidence - a.confidence;
      })
      .map((item) => item.module)
  );
  assert.equal(plan.executionPriority[0], "Financial Intelligence");
});

test("detected intent prefers explicit user objective language over the document's own purpose", () => {
  const doc = financialDocument();
  const plan = buildDecisionPlan({
    prompt: "Please evaluate whether we should approve this budget.",
    documentIntelligence: doc,
  });

  assert.equal(plan.detectedIntent, "Please evaluate whether we should approve this budget.");
  assert.ok(plan.intentConfidence >= 0.7);
});

test("a generic prompt with no objective language falls back to the document's own purpose, at lower confidence", () => {
  const doc = financialDocument();
  const plan = buildDecisionPlan({ prompt: "ok thanks", documentIntelligence: doc });

  assert.match(plan.detectedIntent, /Q3 2024 Financial Statement Review/);
  assert.ok(plan.intentConfidence < 0.7);
});

test("no attachment and no prompt produces a low-confidence, Unknown-domain plan with no recommendations and full transparency on why", () => {
  const doc = createUniversalDocumentIntelligenceFallback({ assets: [] });
  const plan = buildDecisionPlan({ documentIntelligence: doc });

  assert.equal(decisionPlanSchema.safeParse(plan).success, true);
  assert.equal(plan.detectedDomain, "Unknown");
  assert.deepEqual(plan.recommendedAnalyses, []);
  assert.deepEqual(plan.executionPriority, []);
  assert.equal(plan.excludedModules.length, intelligenceModuleValues.length);
  assert.ok(plan.confidence < 0.5);
  assert.ok(plan.missingEvidence.length > 0);
  assert.equal(plan.estimatedBusinessValue.level, "low");
});

test("estimated business value scales with risk, decision, obligation, and monetary signals", () => {
  const richDoc = financialDocument();
  const plainDoc = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "notes.txt", textContent: "Some unrelated notes about groceries and travel plans." }],
  });

  const richPlan = buildDecisionPlan({ documentIntelligence: richDoc });
  const plainPlan = buildDecisionPlan({ documentIntelligence: plainDoc });

  const rank = { low: 0, medium: 1, high: 2, critical: 3 };
  assert.ok(rank[richPlan.estimatedBusinessValue.level] > rank[plainPlan.estimatedBusinessValue.level]);
});

test("does not generate a report or answer the user -- the module returns only structured planning data", () => {
  const doc = financialDocument();
  const plan = buildDecisionPlan({ documentIntelligence: doc });
  const serialized = JSON.stringify(plan);

  assert.doesNotMatch(serialized, /<h[1-6]>|<p>|##\s/);
  assert.equal(typeof plan.detectedIntent, "string");
  assert.ok(Array.isArray(plan.recommendedAnalyses));
});

test("app/api/plan/route.ts wires the router right after layer 4, independently of body.analysisMode and body.documentIntelligence", () => {
  const universalIndex = planRouteSource.indexOf("createUniversalDocumentIntelligenceFallback({");
  const routerIndex = planRouteSource.indexOf("buildDecisionPlan({");
  const layer1Index = planRouteSource.indexOf("classifyAttachmentDocument({");

  assert.ok(universalIndex > -1 && routerIndex > -1 && layer1Index > -1);
  assert.ok(universalIndex < routerIndex);
  assert.ok(routerIndex < layer1Index);
  assert.match(planRouteSource, /body\.decisionPlan = buildDecisionPlan/);

  const startIndex = planRouteSource.indexOf("body.decisionPlan = buildDecisionPlan(");
  const endIndex = planRouteSource.indexOf("});", startIndex) + "});".length;
  const statementSource = planRouteSource.slice(startIndex, endIndex);
  assert.doesNotMatch(statementSource, /analysisMode/);
});

test("layer 5 does not touch report generation, PDF generation, or the existing decision-intelligence subsystem", () => {
  const forbiddenPaths = [
    "app/lib/pdf-engine",
    "app/lib/report-engine",
    "app/lib/billing",
    "app/lib/ai/market-analysis",
    "app/lib/ai/adaptive-report-writer",
    "app/lib/decision-intelligence/",
  ];

  for (const path of forbiddenPaths) {
    assert.doesNotMatch(planRouteSource, new RegExp(path.replace(/\//g, "\\/")));
  }
});
