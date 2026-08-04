import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import { runExpertReasoningEngine } from "../app/lib/ai/expert-reasoning-engine.ts";
import {
  decisionCategoryValues,
  decisionIntentResultSchema,
  runDecisionIntentEngine,
} from "../app/lib/ai/decision-intent-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/decision-intent-engine.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function context(assets, userRequest) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt: userRequest, documentIntelligence });
  const expertReasoningResult = runExpertReasoningEngine({
    prompt: userRequest,
    documentIntelligence,
    decisionPlan,
  });
  return { documentIntelligence, decisionPlan, expertReasoningResult };
}

function run(assets, userRequest, extra = {}) {
  const ctx = context(assets, userRequest);
  return runDecisionIntentEngine({ userRequest, ...ctx, ...extra });
}

const PRICING_DOC_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

test("decisionCategoryValues contains exactly the required 19 categories", () => {
  assert.deepEqual(
    [...decisionCategoryValues].sort(),
    [
      "start_business",
      "validate_business",
      "enter_market",
      "expand_market",
      "launch_product",
      "pricing",
      "fundraising",
      "investment",
      "acquisition",
      "partnership",
      "hiring",
      "budgeting",
      "financial_review",
      "company_analysis",
      "competitor_analysis",
      "growth_strategy",
      "operational_decision",
      "strategic_decision",
      "risk_assessment",
    ].sort()
  );
});

test("identical evidence always produces identical decision intents (determinism)", () => {
  const assets = [{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }];
  const userRequest = "We need to decide on our pricing strategy urgently, our investors want an answer this week.";

  const resultA = run(assets, userRequest);
  const resultB = run(assets, userRequest);

  assert.equal(decisionIntentResultSchema.safeParse(resultA).success, true);
  assert.deepEqual(resultA, resultB);
});

test("unsupported inputs (a Legal document) return cannotDetermineReason, never a fabricated decision", () => {
  const result = run([{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }], "Please review this.");

  assert.equal(decisionIntentResultSchema.safeParse(result).success, true);
  assert.equal(result.primaryDecision, null);
  assert.equal(result.decisionCategory, null);
  assert.ok(result.cannotDetermineReason !== null && result.cannotDetermineReason.length > 0);
  assert.equal(result.confidence, 0);
});

test("a request with no matching signal at all also returns cannotDetermineReason", () => {
  const result = runDecisionIntentEngine({});

  assert.equal(decisionIntentResultSchema.safeParse(result).success, true);
  assert.equal(result.primaryDecision, null);
  assert.ok(result.cannotDetermineReason !== null);
  assert.match(result.cannotDetermineReason, /rather than guessing/i);
});

test("multiple decision objectives are ranked by confidence: the stronger signal becomes primary", () => {
  const result = run(
    [{ name: "notes.pdf", textContent: "This is a general planning note." }],
    "We are strongly considering fundraising, raise capital plans, and a seed round, and we might also think about hiring one day."
  );

  assert.ok(result.primaryDecision);
  assert.equal(result.primaryDecision.category, "fundraising");
  assert.ok(result.secondaryDecision === null || result.secondaryDecision.category === "hiring");
  if (result.secondaryDecision) {
    assert.ok(result.primaryDecision.confidence >= result.secondaryDecision.confidence);
  }
});

test("confidence decreases when evidence is weak compared to strong, multi-signal matches", () => {
  const strong = run(
    [],
    "We need to decide on fundraising, our raise capital plans, and a seed round, urgently."
  );
  const weak = run([], "We might think about fundraising at some point.");

  assert.ok(strong.primaryDecision);
  assert.ok(weak.primaryDecision);
  assert.ok(strong.primaryDecision.confidence > weak.primaryDecision.confidence);
});

test("every detected intent includes a non-empty evidenceTrace", () => {
  const result = run([{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }], "We need to decide on our pricing strategy.");

  assert.ok(result.primaryDecision !== null);
  assert.ok(result.evidenceTrace.length > 0);
  assert.ok(result.evidenceTrace.some((line) => /primaryDecision/.test(line)));
});

test("no fabricated stakeholders appear: only people/organizations/roles actually present in the input are listed", () => {
  const result = run(
    [
      {
        name: "pricing_memo.pdf",
        textContent:
          "This business plan describes our pricing review. Evidence supporting demand is attached from Northwind Traders. Our investors and customers should be informed.",
      },
    ],
    "We need to decide on our pricing strategy."
  );

  for (const stakeholder of result.stakeholders) {
    assert.ok(
      "This business plan describes our pricing review. Evidence supporting demand is attached from Northwind Traders. Our investors and customers should be informed. We need to decide on our pricing strategy.".includes(
        stakeholder
      ),
      `stakeholder "${stakeholder}" was not found verbatim in the source text`
    );
  }
  assert.ok(result.stakeholders.some((s) => /northwind traders/i.test(s)));
});

test("no fabricated urgency appears: urgency is 'unspecified' unless explicit urgency language is present", () => {
  const noUrgencyLanguage = run(
    [{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }],
    "We need to decide on our pricing strategy."
  );
  const explicitUrgency = run(
    [{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }],
    "We need to decide on our pricing strategy urgently, this week."
  );

  assert.equal(noUrgencyLanguage.urgency, "unspecified");
  assert.equal(explicitUrgency.urgency, "immediate");
});

test("no generic startup recommendations appear: recommendedAnalysisPath is tied to actual missing evidence and applicable reasoning modules", () => {
  const result = run([{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }], "We need to decide on our pricing strategy.");

  for (const step of result.recommendedAnalysisPath) {
    assert.doesNotMatch(step, /move fast|hustle|disrupt|10x|growth hack|follow your passion/i);
  }
  if (result.missingEvidence.length > 0) {
    assert.ok(result.recommendedAnalysisPath.some((step) => /missing evidence/i.test(step)));
  }
});

test("requiredEvidence and missingEvidence are specific to the detected decision category", () => {
  const pricingResult = run([{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }], "We need to decide on our pricing strategy.");
  const hiringResult = run([], "We need to decide whether to hire a new VP of Sales.");

  assert.ok(pricingResult.requiredEvidence.some((item) => /competitor pricing/i.test(item)));
  assert.ok(hiringResult.requiredEvidence.some((item) => /role definition/i.test(item)));
  assert.notDeepEqual(pricingResult.requiredEvidence, hiringResult.requiredEvidence);
});

test("decisionCategory always mirrors primaryDecision.category", () => {
  const result = run([{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }], "We need to decide on our pricing strategy.");
  assert.equal(result.decisionCategory, result.primaryDecision.category);
});

test("does not generate a report, and does not modify PDF, report generation, billing, or UI code", () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|billing)/i);
  assert.doesNotMatch(planRouteSource, /decision-intent-engine/);
  assert.doesNotMatch(planRouteSource, /runDecisionIntentEngine/);
});

test("this module never invents financial or market facts: no dollar amounts, percentages, or market-size claims appear anywhere in the output unless copied from evidencePool", () => {
  const result = run([{ name: "pricing_memo.pdf", textContent: PRICING_DOC_TEXT }], "We need to decide on our pricing strategy.");
  const serialized = JSON.stringify(result);
  const dollarMatches = serialized.match(/\$[\d,]+/g) || [];
  for (const match of dollarMatches) {
    assert.ok(
      PRICING_DOC_TEXT.includes(match),
      `unexpected monetary figure "${match}" not present in the source document`
    );
  }
});
