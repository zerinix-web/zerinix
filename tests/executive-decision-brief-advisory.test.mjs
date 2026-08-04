import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import { runExpertReasoningEngine } from "../app/lib/ai/expert-reasoning-engine.ts";
import {
  executiveBriefDomainValues,
  executiveDecisionBriefSchema,
  executiveAdvisorySchema,
  EXECUTIVE_ADVISORY_ENABLED_ENV_VAR,
  isExecutiveAdvisoryEnabled,
  buildExecutiveDecisionBrief,
  buildExecutiveDecisionBriefFromExpertReasoning,
} from "../app/lib/ai/executive-decision-brief.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/executive-decision-brief.ts", import.meta.url),
  "utf8"
);

const STRONG_PRICING_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`;

const CONTRADICTORY_FACT = "However, there is a significant risk that demand may decline sharply next quarter.";
const OPPORTUNITY_FACT = "This represents a significant growth opportunity with strong upside potential in adjacent markets.";

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

function buildExpertReasoningResult(assets, userRequest, extra = {}) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt: userRequest, documentIntelligence });
  return runExpertReasoningEngine({
    prompt: userRequest,
    documentIntelligence,
    decisionPlan,
    ...extra,
  });
}

function withEnvFlag(value, fn) {
  const previous = process.env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR];
  } else {
    process.env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR];
    } else {
      process.env[EXECUTIVE_ADVISORY_ENABLED_ENV_VAR] = previous;
    }
  }
}

test("executiveBriefDomainValues contains exactly the 6 required domains", () => {
  assert.deepEqual(
    [...executiveBriefDomainValues].sort(),
    ["business", "legal", "finance", "real_estate", "healthcare", "engineering"].sort()
  );
});

test("isExecutiveAdvisoryEnabled reads the ZERINIX_EXECUTIVE_ADVISORY_ENABLED env var exactly", () => {
  assert.equal(isExecutiveAdvisoryEnabled({}), false);
  assert.equal(isExecutiveAdvisoryEnabled({ [EXECUTIVE_ADVISORY_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isExecutiveAdvisoryEnabled({ [EXECUTIVE_ADVISORY_ENABLED_ENV_VAR]: "true" }), true);
});

test("with the flag off (default), executiveAdvisory is null and the brief is unchanged from the pre-advisory shape", () => {
  withEnvFlag(undefined, () => {
    const expertReasoningResult = buildExpertReasoningResult(
      [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
      "We need to decide on our pricing strategy urgently."
    );
    const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);

    assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
    assert.equal(brief.executiveAdvisory, null);
  });
});

test("calling with no options argument at all behaves identically to calling with an empty options object (backward compatibility)", () => {
  withEnvFlag(undefined, () => {
    const expertReasoningResult = buildExpertReasoningResult(
      [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
      "We need to decide on our pricing strategy urgently."
    );

    const a = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);
    const b = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {});

    assert.deepEqual(a, b);
  });
});

test("with the flag on, the advisory leads with the recommendation: executiveRecommendation matches executiveAdvisory.executiveRecommendationHeadline", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  assert.ok(brief.executiveAdvisory);
  assert.equal(executiveAdvisorySchema.safeParse(brief.executiveAdvisory).success, true);
  assert.equal(brief.executiveRecommendation, brief.executiveAdvisory.executiveRecommendationHeadline);
});

test("supporting and contradictory evidence are correctly partitioned from real evidence, never invented", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently.",
    { userProvidedFacts: [CONTRADICTORY_FACT] }
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.ok(brief.executiveAdvisory.contradictoryEvidence.includes(CONTRADICTORY_FACT));
  assert.ok(!brief.executiveAdvisory.supportingEvidence.includes(CONTRADICTORY_FACT));
});

test("opportunities are correctly identified from real evidence via keyword signal, never invented", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently.",
    { userProvidedFacts: [OPPORTUNITY_FACT] }
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.ok(brief.executiveAdvisory.opportunities.includes(OPPORTUNITY_FACT));
});

test("businessImpact is derived from applicable reasoning sections' own summaries, never fabricated", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  for (const line of brief.executiveAdvisory.businessImpact) {
    assert.match(line, /impact:/);
  }
});

test("confidenceNarrative explains confidence with the real supporting/contradictory counts", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently.",
    { userProvidedFacts: [CONTRADICTORY_FACT] }
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.match(brief.executiveAdvisory.confidenceNarrative, new RegExp(`${expertReasoningResult.confidence}`));
  assert.match(brief.executiveAdvisory.confidenceNarrative, /supporting evidence/);
  assert.match(brief.executiveAdvisory.confidenceNarrative, /contradictory/);
});

test("risks and assumptions in the advisory are exact pass-throughs of the existing, already-verified fields", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.deepEqual(brief.executiveAdvisory.risks, brief.keyRisks);
  assert.deepEqual(brief.executiveAdvisory.assumptions, brief.assumptions);
  assert.deepEqual(brief.executiveAdvisory.missingEvidence, brief.missingCriticalEvidence);
});

test("nextDecisions always contains exactly 3 items, even with no missing evidence, risks, or opportunities at all", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.equal(brief.executiveAdvisory.nextDecisions.length, 3);
  assert.deepEqual(brief.immediateNextActions, brief.executiveAdvisory.nextDecisions);
});

test("immediateNextActions with the flag on always has exactly 3 items even for a request with almost no evidence", () => {
  const expertReasoningResult = buildExpertReasoningResult([], "We might think about pricing at some point.");
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.equal(brief.immediateNextActions.length, 3);
  assert.equal(brief.executiveAdvisory.nextDecisions.length, 3);
});

test("domain defaults from detectedBusinessContext when no explicit domainHint is supplied", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "financials.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently.",
    { financialEvidence: ["Reviewing our income statement and cash flow for the acquisition."] }
  );
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.ok(["business", "finance"].includes(brief.executiveAdvisory.domain));
});

test("an explicit domainHint of 'finance' or 'business' overrides the derived domain", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );

  const asFinance = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
    enabled: true,
    domainHint: "finance",
  });
  const asBusiness = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
    enabled: true,
    domainHint: "business",
  });

  assert.equal(asFinance.executiveAdvisory.domain, "finance");
  assert.equal(asBusiness.executiveAdvisory.domain, "business");
});

const NON_BUSINESS_DOMAINS = ["legal", "real_estate", "healthcare", "engineering"];

for (const domain of NON_BUSINESS_DOMAINS) {
  test(`domain "${domain}": never fabricates a business recommendation -- forces insufficient_evidence, zero confidence, and empty evidence-bearing fields`, () => {
    const expertReasoningResult = buildExpertReasoningResult(
      [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
      "We need to decide on our pricing strategy urgently."
    );
    const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
      enabled: true,
      domainHint: domain,
    });

    assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
    assert.equal(brief.recommendationStatus, "insufficient_evidence");
    assert.equal(brief.decisionConfidence, 0);
    assert.equal(brief.verifiedEvidence.length, 0);
    assert.equal(brief.directionalSignals.length, 0);
    assert.equal(brief.assumptions.length, 0);
    assert.equal(brief.executiveAdvisory.domain, domain);
    assert.equal(brief.executiveAdvisory.supportingEvidence.length, 0);
    assert.equal(brief.executiveAdvisory.contradictoryEvidence.length, 0);
    assert.equal(brief.executiveAdvisory.nextDecisions.length, 3);

    // Never leaks the actual business document's content (e.g. the
    // dollar figure) into a domain it has no grounded reasoning for.
    const serialized = JSON.stringify(brief);
    assert.doesNotMatch(serialized, /\$50,000,000/);
  });
}

test("the 4 non-business domains produce pairwise-distinct brief structures (headline, why, missing evidence, next decisions)", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const briefs = NON_BUSINESS_DOMAINS.map((domain) =>
    buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true, domainHint: domain })
  );

  for (let i = 0; i < briefs.length; i += 1) {
    for (let j = i + 1; j < briefs.length; j += 1) {
      assert.notEqual(briefs[i].executiveRecommendation, briefs[j].executiveRecommendation);
      assert.notDeepEqual(briefs[i].decisionRationale, briefs[j].decisionRationale);
      assert.notDeepEqual(briefs[i].missingCriticalEvidence, briefs[j].missingCriticalEvidence);
      assert.notDeepEqual(briefs[i].immediateNextActions, briefs[j].immediateNextActions);
    }
  }
});

test("a business/finance-grounded brief has a structurally different shape from every non-business domain brief", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently."
  );
  const businessBrief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
    enabled: true,
    domainHint: "business",
  });

  for (const domain of NON_BUSINESS_DOMAINS) {
    const domainBrief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
      enabled: true,
      domainHint: domain,
    });
    assert.notEqual(businessBrief.executiveRecommendation, domainBrief.executiveRecommendation);
    assert.notEqual(businessBrief.recommendationStatus === "insufficient_evidence" && businessBrief.decisionConfidence === 0, true);
  }
});

test("an unsupported business context with no domain hint produces a null-domain advisory with exactly 3 next decisions", () => {
  const expertReasoningResult = buildExpertReasoningResult([{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }], "Please review this.");
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.equal(expertReasoningResult.detectedBusinessContext, "unsupported");
  assert.equal(brief.recommendationStatus, "insufficient_evidence");
  assert.ok(brief.executiveAdvisory);
  assert.equal(brief.executiveAdvisory.domain, null);
  assert.equal(brief.executiveAdvisory.nextDecisions.length, 3);
  assert.equal(brief.immediateNextActions.length, 3);
});

test("an unsupported business context with an explicit domainHint of 'finance' still honestly reports that hint, rather than forcing null", () => {
  const expertReasoningResult = buildExpertReasoningResult([{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }], "Please review this.");
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, {
    enabled: true,
    domainHint: "finance",
  });

  assert.equal(brief.executiveAdvisory.domain, "finance");
});

test("buildExecutiveDecisionBrief (the wrapper) also respects domainHint and enabled options", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
  });
  const decisionPlan = buildDecisionPlan({
    prompt: "We need to decide on our pricing strategy urgently.",
    documentIntelligence,
  });

  const brief = buildExecutiveDecisionBrief({
    decisionPlan,
    documentIntelligence,
    prompt: "We need to decide on our pricing strategy urgently.",
    enabled: true,
    domainHint: "legal",
  });

  assert.equal(brief.executiveAdvisory.domain, "legal");
  assert.equal(brief.recommendationStatus, "insufficient_evidence");
});

test("identical input and options always produce an identical result (determinism)", () => {
  const expertReasoningResult = buildExpertReasoningResult(
    [{ name: "pricing_memo.pdf", textContent: STRONG_PRICING_TEXT }],
    "We need to decide on our pricing strategy urgently.",
    { userProvidedFacts: [CONTRADICTORY_FACT, OPPORTUNITY_FACT] }
  );

  const a = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });
  const b = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult, { enabled: true });

  assert.deepEqual(a, b);
});

test("keeps existing architecture: the same exported function and type names remain, and no report/PDF/billing/UI imports were introduced", () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );
  assert.match(engineSource, /export function buildExecutiveDecisionBriefFromExpertReasoning/);
  assert.match(engineSource, /export function buildExecutiveDecisionBrief/);
  assert.match(engineSource, /export const executiveDecisionBriefSchema/);
});
