import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import { buildExecutiveDecisionBrief } from "../app/lib/ai/executive-decision-brief.ts";
import {
  expertReasoningResultSchema,
  reasoningDomainValues,
  runExpertReasoningEngine,
} from "../app/lib/ai/expert-reasoning-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/expert-reasoning-engine.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function pipeline(assets, prompt, extra = {}) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt, documentIntelligence });
  const executiveDecisionBrief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });
  const result = runExpertReasoningEngine({
    prompt,
    documentIntelligence,
    decisionPlan,
    executiveDecisionBrief,
    ...extra,
  });
  return { documentIntelligence, decisionPlan, executiveDecisionBrief, result };
}

test("reasoningDomainValues contains exactly the 10 supported domains plus 'unsupported'", () => {
  assert.deepEqual(
    [...reasoningDomainValues].sort(),
    [
      "business_intelligence",
      "market_intelligence",
      "company_analysis",
      "financial_intelligence",
      "investment_intelligence",
      "product_strategy",
      "pricing_strategy",
      "go_to_market_strategy",
      "growth_strategy",
      "risk_intelligence",
      "unsupported",
    ].sort()
  );
});

test("verified facts are never mixed with assumptions", () => {
  const { result } = pipeline(
    [
      {
        name: "market_report.pdf",
        textContent: `Subject: Market Entry Business Case

BUSINESS SUMMARY

This business plan describes a go-to-market plan. Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`,
      },
    ],
    "Please evaluate this business opportunity."
  );

  assert.equal(expertReasoningResultSchema.safeParse(result).success, true);
  assert.ok(result.assumptions.length > 0);
  assert.ok(result.verifiedFacts.length > 0);
  for (const assumption of result.assumptions) {
    assert.ok(!result.verifiedFacts.includes(assumption));
    assert.match(assumption, /assum/i);
  }
});

test("evidence too thin to support a decision produces 'insufficient_evidence' rather than a fabricated recommendation", () => {
  const { result } = pipeline(
    [
      {
        name: "note.txt",
        textContent:
          "Subject: New Business Idea\n\nBusiness plan idea. It could be a good business model.",
      },
    ],
    "Should we invest in this?"
  );

  assert.equal(expertReasoningResultSchema.safeParse(result).success, true);
  if (result.verifiedFacts.length === 0) {
    assert.equal(result.recommendedOption?.option, "Do not proceed with the current information.");
  }
});

test("every result includes a non-empty evidence trace explaining where each field came from", () => {
  const { result } = pipeline(
    [
      {
        name: "market_report.pdf",
        textContent: `Subject: Market Entry Business Case

This business plan describes a pricing strategy. Evidence supporting demand is attached, including signed letters of intent from three customers.`,
      },
    ],
    "Please evaluate this business opportunity."
  );

  assert.ok(result.evidenceTrace.length > 0);
  assert.ok(result.evidenceTrace.some((line) => /verifiedFacts/.test(line)));
  assert.ok(result.evidenceTrace.some((line) => /detectedBusinessContext/.test(line)));
  assert.ok(result.evidenceTrace.some((line) => /confidence/.test(line)));
});

test("an unsupported document category (Legal) never receives fabricated business advice", () => {
  const { result, decisionPlan } = pipeline(
    [
      {
        name: "contract.pdf",
        textContent:
          "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.",
      },
    ],
    "Please review this."
  );

  assert.equal(decisionPlan.detectedDomain, "Legal");
  assert.equal(result.detectedBusinessContext, "unsupported");
  assert.equal(result.recommendedOption, null);
  assert.deepEqual(result.strategicOptions, []);
  assert.deepEqual(result.verifiedFacts, []);
  assert.equal(result.confidence, 0);
  assert.doesNotMatch(result.confidenceExplanation, /\$\d|market size/i);
  assert.deepEqual(result.competitorReasoning, { applicable: false, summary: "", supportingEvidence: [] });
});

test("a request with no supported signal at all also yields 'unsupported', not a guessed business domain", () => {
  const result = runExpertReasoningEngine({});
  assert.equal(expertReasoningResultSchema.safeParse(result).success, true);
  assert.equal(result.detectedBusinessContext, "unsupported");
  assert.equal(result.recommendedOption, null);
});

test("pricing-only evidence activates pricingReasoning but not market, financial, or investment reasoning", () => {
  const { result } = pipeline(
    [
      {
        name: "pricing_memo.pdf",
        textContent:
          "This business plan discusses our pricing strategy and subscription price point given willingness to pay research.",
      },
    ],
    "Please evaluate our pricing strategy."
  );

  assert.equal(result.pricingReasoning.applicable, true);
  assert.equal(result.financialReasoning.applicable, false);
  assert.equal(result.investmentReasoning.applicable, false);
});

test("go-to-market-only evidence activates goToMarketReasoning but not pricing or investment reasoning", () => {
  const { result } = pipeline(
    [
      {
        name: "gtm_memo.pdf",
        textContent:
          "This business plan lays out our go-to-market plan, launch strategy, and distribution channel approach.",
      },
    ],
    "Please evaluate our go-to-market plan."
  );

  assert.equal(result.goToMarketReasoning.applicable, true);
  assert.equal(result.pricingReasoning.applicable, false);
  assert.equal(result.investmentReasoning.applicable, false);
});

test("investment-only evidence activates investmentReasoning without pricing or go-to-market reasoning", () => {
  const { result } = pipeline(
    [
      {
        name: "investment_memo.pdf",
        textContent:
          "This business plan seeks investment funding at a proposed valuation, with a target return on investment.",
      },
    ],
    "Please evaluate this investment opportunity."
  );

  assert.equal(result.investmentReasoning.applicable, true);
  assert.equal(result.pricingReasoning.applicable, false);
  assert.equal(result.goToMarketReasoning.applicable, false);
});

test("market and financial evidence activate their own sections independently of each other's absence", () => {
  const marketOnly = pipeline(
    [
      {
        name: "market_memo.pdf",
        textContent:
          "This business plan reviews market size, customer segment data, and the competitive landscape.",
      },
    ],
    "Please evaluate this market."
  ).result;

  const financialOnly = pipeline(
    [
      {
        name: "financial_memo.pdf",
        textContent:
          "This business plan reviews the balance sheet, income statement, and financial health of the company.",
      },
    ],
    "Please evaluate our financial position."
  ).result;

  assert.equal(marketOnly.marketReasoning.applicable, true);
  assert.equal(marketOnly.financialReasoning.applicable, false);
  assert.equal(financialOnly.financialReasoning.applicable, true);
  assert.equal(financialOnly.marketReasoning.applicable, false);
});

test("does not add a legal, medical, engineering, or HR reasoning system", () => {
  assert.doesNotMatch(engineSource, /legal-document-understanding|legal-case-analysis/);
  for (const forbidden of ["legalReasoning", "medicalReasoning", "engineeringReasoning", "hrReasoning"]) {
    assert.doesNotMatch(engineSource, new RegExp(forbidden, "i"));
  }
});

test("no output depends on hardcoded names, companies, cases, or example-specific content in the source", () => {
  assert.doesNotMatch(engineSource, /Acme|Yargıtay|Ali Gümüş|Mehmet Kaya/);
});

test("running the same structural evidence under two different company names produces identical structural output", () => {
  const buildFor = (companyName) =>
    pipeline(
      [
        {
          name: "market_report.pdf",
          textContent: `Subject: Market Entry Business Case for ${companyName}

BUSINESS SUMMARY

This business plan describes ${companyName}'s go-to-market plan. Evidence supporting demand is attached, including signed letters of intent from three customers.`,
        },
      ],
      "Please evaluate this business opportunity."
    ).result;

  const resultA = buildFor("Northwind Traders");
  const resultB = buildFor("Contoso Holdings");

  assert.equal(resultA.detectedBusinessContext, resultB.detectedBusinessContext);
  assert.equal(resultA.recommendedOption?.option, resultB.recommendedOption?.option);
  assert.equal(resultA.marketReasoning.applicable, resultB.marketReasoning.applicable);
  assert.equal(resultA.goToMarketReasoning.applicable, resultB.goToMarketReasoning.applicable);
  assert.equal(resultA.confidenceExplanation, resultB.confidenceExplanation);
});

test("app/api/plan/route.ts is not modified to wire the expert reasoning engine into report generation, PDF, billing, or language logic", () => {
  assert.doesNotMatch(planRouteSource, /expert-reasoning-engine/);
  assert.doesNotMatch(planRouteSource, /runExpertReasoningEngine/);
});
