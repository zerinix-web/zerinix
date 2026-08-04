import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import { runExpertReasoningEngine } from "../app/lib/ai/expert-reasoning-engine.ts";
import { buildExecutiveDecisionBrief } from "../app/lib/ai/executive-decision-brief.ts";
import { runDecisionIntentEngine } from "../app/lib/ai/decision-intent-engine.ts";
import {
  decisionStrategyResultSchema,
  runDecisionStrategyEngine,
  strategyDecisionTypeValues,
} from "../app/lib/ai/decision-strategy-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/decision-strategy-engine.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function fullPipeline(assets, userRequest) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt: userRequest, documentIntelligence });
  const expertReasoningResult = runExpertReasoningEngine({
    prompt: userRequest,
    documentIntelligence,
    decisionPlan,
  });
  const executiveDecisionBrief = buildExecutiveDecisionBrief({
    decisionPlan,
    documentIntelligence,
    prompt: userRequest,
  });
  const decisionIntentResult = runDecisionIntentEngine({
    userRequest,
    documentIntelligence,
    expertReasoningResult,
  });
  const decisionStrategyResult = runDecisionStrategyEngine({
    decisionIntentResult,
    expertReasoningResult,
    executiveDecisionBrief,
  });
  return {
    documentIntelligence,
    decisionPlan,
    expertReasoningResult,
    executiveDecisionBrief,
    decisionIntentResult,
    decisionStrategyResult,
  };
}

const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`;

const WEAK_PRICING_TEXT = "Subject: Pricing thoughts\n\nWe might think about pricing at some point.";

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

test("strategyDecisionTypeValues contains exactly the required 13 supported types", () => {
  assert.deepEqual(
    [...strategyDecisionTypeValues].sort(),
    [
      "investment",
      "acquisition",
      "pricing",
      "product launch",
      "market expansion",
      "fundraising",
      "partnership",
      "hiring",
      "budgeting",
      "operational strategy",
      "company analysis",
      "market analysis",
      "strategic planning",
    ].sort()
  );
});

test("identical evidence always produces identical strategy (determinism)", () => {
  const assets = [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }];
  const userRequest = "We need to decide on our pricing strategy urgently.";

  const resultA = fullPipeline(assets, userRequest).decisionStrategyResult;
  const resultB = fullPipeline(assets, userRequest).decisionStrategyResult;

  assert.equal(decisionStrategyResultSchema.safeParse(resultA).success, true);
  assert.deepEqual(resultA, resultB);
});

test("weak evidence produces a conservative recommendation, never 'proceed'", () => {
  const { decisionStrategyResult } = fullPipeline(
    [{ name: "note.txt", textContent: WEAK_PRICING_TEXT }],
    "We might think about our pricing strategy."
  );

  assert.equal(decisionStrategyResultSchema.safeParse(decisionStrategyResult).success, true);
  assert.notEqual(decisionStrategyResult.recommendedDecision.status, "proceed");
  assert.ok(["wait", "insufficient_evidence", "reject"].includes(decisionStrategyResult.recommendedDecision.status));
});

test("recommendations always include a non-empty evidenceTrace", () => {
  const { decisionStrategyResult } = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  );

  assert.ok(decisionStrategyResult.evidenceTrace.length > 0);
  assert.ok(decisionStrategyResult.evidenceTrace.some((line) => /recommendedDecision/.test(line)));
  assert.ok(decisionStrategyResult.evidenceTrace.some((line) => /evidenceStrength/.test(line)));
});

test("assumptions never become facts: assumptionsUsed never overlaps with expectedBenefits or recommendedDecision.supportingEvidence", () => {
  const { decisionStrategyResult } = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  );

  for (const assumption of decisionStrategyResult.assumptionsUsed) {
    assert.ok(!decisionStrategyResult.expectedBenefits.includes(assumption));
    assert.ok(!decisionStrategyResult.recommendedDecision.supportingEvidence.includes(assumption));
    assert.match(assumption, /assum/i);
  }
});

test("confidence reflects evidence quality: strong evidence yields higher confidence than weak evidence for the same decision category", () => {
  const strong = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  ).decisionStrategyResult;
  const weak = fullPipeline(
    [{ name: "note.txt", textContent: WEAK_PRICING_TEXT }],
    "We might think about our pricing strategy."
  ).decisionStrategyResult;

  assert.equal(strong.evidenceStrength, "moderate");
  assert.equal(weak.evidenceStrength, "none");
  assert.ok(strong.confidence > weak.confidence);
});

test("alternative strategies are evidence-based: every alternative's supportingEvidence is drawn from upstream fields, never invented", () => {
  const { decisionStrategyResult, expertReasoningResult, decisionIntentResult } = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  );

  const upstreamEvidencePool = [
    ...expertReasoningResult.rejectedOptions.flatMap((o) => o.supportingEvidence),
    ...(decisionIntentResult.secondaryDecision?.supportingEvidence || []),
  ];

  for (const alternative of decisionStrategyResult.alternativeStrategies) {
    for (const item of alternative.supportingEvidence) {
      assert.ok(upstreamEvidencePool.includes(item), `unexpected alternative evidence: "${item}"`);
    }
  }
});

test("an unsupported business context (a Legal document) returns 'insufficient_evidence', never a fabricated recommendation", () => {
  const { decisionStrategyResult, decisionIntentResult } = fullPipeline(
    [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
    "Please review this."
  );

  assert.ok(decisionIntentResult.cannotDetermineReason !== null);
  assert.equal(decisionStrategyResultSchema.safeParse(decisionStrategyResult).success, true);
  assert.equal(decisionStrategyResult.recommendedDecision.status, "insufficient_evidence");
  assert.equal(decisionStrategyResult.recommendedDecision.decisionType, null);
  assert.deepEqual(decisionStrategyResult.alternativeStrategies, []);
  assert.equal(decisionStrategyResult.confidence, 0);
});

test("a decision category outside the 13 supported strategy types also returns 'insufficient_evidence'", () => {
  const { decisionStrategyResult, decisionIntentResult } = fullPipeline(
    [],
    "We are considering starting a business, starting my own company as a new venture."
  );

  if (decisionIntentResult.decisionCategory === "start_business") {
    assert.equal(decisionStrategyResult.recommendedDecision.status, "insufficient_evidence");
    assert.equal(decisionStrategyResult.recommendedDecision.decisionType, null);
  }
});

test("no fabricated financial values appear: every dollar figure in the output is copied verbatim from the source evidence", () => {
  const { decisionStrategyResult } = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  );

  const serialized = JSON.stringify(decisionStrategyResult);
  const dollarMatches = serialized.match(/\$[\d,]+/g) || [];
  for (const match of dollarMatches) {
    assert.ok(
      STRONG_PRICING_TEXT.includes(match),
      `unexpected monetary figure "${match}" not present in the source document`
    );
  }
});

test("never outputs motivational language or generic startup advice", () => {
  const { decisionStrategyResult } = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  );

  const serialized = JSON.stringify(decisionStrategyResult).toLowerCase();
  const forbiddenPhrases = [
    "move fast",
    "hustle",
    "disrupt",
    "10x",
    "growth hack",
    "seize the opportunity",
    "sky's the limit",
    "believe in yourself",
    "game-changing",
    "amazing opportunity",
    "follow your passion",
  ];
  for (const phrase of forbiddenPhrases) {
    assert.ok(!serialized.includes(phrase), `found forbidden motivational phrase: "${phrase}"`);
  }
});

test("recommendedDecision.decisionType is null exactly when status is insufficient_evidence due to an unmapped or undetermined category", () => {
  const supported = fullPipeline(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy."
  ).decisionStrategyResult;
  const unsupported = fullPipeline([{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }], "Please review this.")
    .decisionStrategyResult;

  assert.notEqual(supported.recommendedDecision.decisionType, null);
  assert.equal(unsupported.recommendedDecision.decisionType, null);
});

test("does not modify reports, PDF generation, billing, or UI code, and is not wired into the route yet", () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|billing)/i);
  assert.doesNotMatch(planRouteSource, /decision-strategy-engine/);
  assert.doesNotMatch(planRouteSource, /runDecisionStrategyEngine/);
});
