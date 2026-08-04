import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  adaptiveIntelligenceDomainValues,
  adaptiveIntelligenceResultSchema,
  reasoningProfileSchema,
  runAdaptiveIntelligenceEngine,
} from "../app/lib/ai/adaptive-intelligence-engine.ts";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/adaptive-intelligence-engine.ts", import.meta.url),
  "utf8"
);

const DOMAIN_FIXTURES = {
  business_intelligence:
    "We have a business idea for a subscription-based business model with a startup go-to-market plan.",
  market_intelligence:
    "This market research report includes a market study of the competitive landscape and an industry report on trends.",
  legal_intelligence:
    "The plaintiff filed litigation against the defendant; the Court of Appeal reviewed the docket and the attorney presented the case citing statute and precedent, and the verdict is pending.",
  financial_intelligence:
    "Attached is the financial statement including the balance sheet, income statement, and cash flow statement along with financial ratio and EBITDA analysis and a valuation multiple.",
  property_intelligence:
    "This real estate property listing needs zoning review, rental yield estimate, comparable sales analysis, cap rate calculation; note the tenant and landlord details for this parcel.",
  medical_intelligence:
    "This medical report covers the patient's diagnosis from a recent clinical trial, includes the treatment plan, contraindication warnings, medical guideline references, and symptom history.",
  engineering_intelligence:
    "This engineering drawing requires structural analysis, load calculation, material specification review, safety factor validation according to the blueprint, schematic, and ASME/Eurocode standards.",
  hr_intelligence:
    "This HR document covers an employee performance review, hr policy compliance, job offer letter terms, payroll adjustment, recruitment and onboarding steps, ahead of a possible termination.",
  contract_intelligence:
    "This agreement between party a and party b includes indemnification clauses, terms and conditions, and outlines what constitutes a breach of contract.",
};

function makeDecisionIntentResult({ category, statement, confidence = 0.8 }) {
  return {
    primaryDecision: { category, statement, confidence, supportingEvidence: [] },
    secondaryDecision: null,
    detectedBusinessGoal: "",
    urgency: "unspecified",
    confidence,
    decisionCategory: category,
    stakeholders: [],
    requiredEvidence: [],
    missingEvidence: [],
    criticalUnknowns: [],
    decisionComplexity: "medium",
    recommendedAnalysisPath: [],
    recommendedBusinessModules: [],
    reasoningSummary: [],
    evidenceTrace: [],
    cannotDetermineReason: null,
  };
}

test("adaptiveIntelligenceDomainValues contains exactly the 9 required domains", () => {
  assert.deepEqual(
    [...adaptiveIntelligenceDomainValues].sort(),
    [
      "business_intelligence",
      "market_intelligence",
      "legal_intelligence",
      "financial_intelligence",
      "property_intelligence",
      "medical_intelligence",
      "engineering_intelligence",
      "hr_intelligence",
      "contract_intelligence",
    ].sort()
  );
});

for (const [domain, text] of Object.entries(DOMAIN_FIXTURES)) {
  test(`a ${domain} document is detected from its own text and selects the correct reasoning domain`, () => {
    const result = runAdaptiveIntelligenceEngine({ prompt: text });

    assert.equal(adaptiveIntelligenceResultSchema.safeParse(result).success, true);
    assert.equal(result.selectedDomain, domain);
    assert.equal(result.cannotDetermineReason, null);
    assert.ok(result.reasoningProfile);
    assert.equal(result.reasoningProfile.domain, domain);
    assert.equal(reasoningProfileSchema.safeParse(result.reasoningProfile).success, true);
    assert.ok(result.confidenceProfile.documentTypeConfidence > 0);
    assert.ok(result.evidenceRequirements.length > 0);
  });
}

test("business idea text (no market-research language) is business_intelligence, not market_intelligence", () => {
  const result = runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES.business_intelligence });
  assert.equal(result.selectedDomain, "business_intelligence");
});

test("market research text is market_intelligence even though it is fundamentally a 'business' document", () => {
  const result = runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES.market_intelligence });
  assert.equal(result.selectedDomain, "market_intelligence");
});

test("with no prompt, no attachments, and no upstream signals, the engine returns null rather than a generic/default domain", () => {
  const result = runAdaptiveIntelligenceEngine({});

  assert.equal(adaptiveIntelligenceResultSchema.safeParse(result).success, true);
  assert.equal(result.selectedDomain, null);
  assert.ok(result.cannotDetermineReason);
  assert.equal(result.reasoningProfile, null);
  assert.deepEqual(result.evidenceRequirements, [
    "A clearer description of what type of document or decision this concerns",
    "The specific objective the user wants ZERINIX to help decide",
    "If a document was intended to be analyzed, the document's content or a description of it",
  ]);
  assert.equal(result.confidenceProfile.documentTypeConfidence, 0);
  assert.equal(result.confidenceProfile.intentConfidence, 0);
  assert.equal(result.confidenceProfile.overallConfidence, 0);
});

test("no generic reasoning: every one of the 9 domains has a pairwise-distinct reasoning profile (approach, steps, questions, frameworks, prohibitions)", () => {
  const profiles = adaptiveIntelligenceDomainValues.map(
    (domain) => runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES[domain] }).reasoningProfile
  );

  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const a = profiles[i];
      const b = profiles[j];
      assert.notEqual(a.reasoningApproach, b.reasoningApproach, `${a.domain} vs ${b.domain} reasoningApproach`);
      assert.notDeepEqual(a.reasoningSteps, b.reasoningSteps, `${a.domain} vs ${b.domain} reasoningSteps`);
      assert.notDeepEqual(a.keyQuestions, b.keyQuestions, `${a.domain} vs ${b.domain} keyQuestions`);
      assert.notDeepEqual(
        a.applicableFrameworks,
        b.applicableFrameworks,
        `${a.domain} vs ${b.domain} applicableFrameworks`
      );
      assert.notDeepEqual(
        a.prohibitedReasoningPatterns,
        b.prohibitedReasoningPatterns,
        `${a.domain} vs ${b.domain} prohibitedReasoningPatterns`
      );
    }
  }
});

test("evidenceRequirements are domain-specific: no two domains share an identical evidence-requirements list", () => {
  const results = adaptiveIntelligenceDomainValues.map((domain) =>
    runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES[domain] })
  );

  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      assert.notDeepEqual(results[i].evidenceRequirements, results[j].evidenceRequirements);
    }
  }
});

test("a supplied UniversalDocumentIntelligence result is trusted directly: its domainConfidence becomes documentTypeConfidence exactly", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "financials.pdf", textContent: DOMAIN_FIXTURES.financial_intelligence }],
  });

  const result = runAdaptiveIntelligenceEngine({
    prompt: "Please review our financials.",
    documentIntelligence,
  });

  assert.equal(documentIntelligence.documentDomain, "Financial");
  assert.equal(result.selectedDomain, "financial_intelligence");
  assert.equal(result.confidenceProfile.documentTypeConfidence, documentIntelligence.domainConfidence);
});

test("when the supplied UniversalDocumentIntelligence domain is 'Business', the engine still refines business vs. market_intelligence from the prompt", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "notes.pdf", textContent: DOMAIN_FIXTURES.business_intelligence }],
  });
  assert.equal(documentIntelligence.documentDomain, "Business");

  const asBusiness = runAdaptiveIntelligenceEngine({
    prompt: "We have a business idea for a subscription product.",
    documentIntelligence,
  });
  assert.equal(asBusiness.selectedDomain, "business_intelligence");

  const asMarket = runAdaptiveIntelligenceEngine({
    prompt: "This is a market research report and market study of the competitive landscape.",
    documentIntelligence,
  });
  assert.equal(asMarket.selectedDomain, "market_intelligence");
});

test("a supplied DecisionIntentResult is trusted directly: decisionCategory maps to the correct domain and the objective/confidence are pass-through, verbatim", () => {
  const decisionIntentResult = makeDecisionIntentResult({
    category: "hiring",
    statement: "Decide whether to hire a new VP of Sales.",
    confidence: 0.82,
  });

  const result = runAdaptiveIntelligenceEngine({
    prompt: "We need to decide whether to hire a new VP of Sales.",
    decisionIntentResult,
  });

  assert.equal(result.selectedDomain, "hr_intelligence");
  assert.equal(result.detectedIntent, "hiring");
  assert.equal(result.detectedDecisionObjective, "Decide whether to hire a new VP of Sales.");
  assert.equal(result.confidenceProfile.intentConfidence, 0.82);
  assert.equal(result.confidenceProfile.decisionObjectiveConfidence, 0.82);
});

test("when document-type and intent signals agree, confidence is boosted by corroboration and capped at 0.97", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "idea.pdf", textContent: DOMAIN_FIXTURES.business_intelligence }],
  });
  const decisionIntentResult = makeDecisionIntentResult({
    category: "validate_business",
    statement: "Validate whether this business idea is worth pursuing.",
    confidence: 0.9,
  });

  const result = runAdaptiveIntelligenceEngine({
    prompt: "We have a business idea for a subscription product; should we pursue it?",
    documentIntelligence,
    decisionIntentResult,
  });

  assert.equal(result.selectedDomain, "business_intelligence");
  assert.ok(result.confidenceProfile.overallConfidence > documentIntelligence.domainConfidence);
  assert.ok(result.confidenceProfile.overallConfidence > decisionIntentResult.confidence);
  assert.ok(result.confidenceProfile.overallConfidence <= 0.97);
  assert.ok(result.evidenceTrace.some((line) => /agree/i.test(line)));
});

test("when document-type and intent signals disagree, the document-type signal wins, at reduced confidence, and the conflict is disclosed in evidenceTrace", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "contract.pdf", textContent: DOMAIN_FIXTURES.legal_intelligence }],
  });
  const decisionIntentResult = makeDecisionIntentResult({
    category: "hiring",
    statement: "Decide whether to hire a new VP of Sales.",
  });

  const result = runAdaptiveIntelligenceEngine({
    prompt: "Please review this.",
    documentIntelligence,
    decisionIntentResult,
  });

  assert.equal(documentIntelligence.documentDomain, "Legal");
  assert.equal(result.selectedDomain, "legal_intelligence");
  assert.equal(result.confidenceProfile.overallConfidence, documentIntelligence.domainConfidence * 0.85);
  assert.ok(result.evidenceTrace.some((line) => /disagree/i.test(line)));
});

test("with only an intent signal (no document/attachment signal), the domain comes from intent alone, at a reduced confidence basis", () => {
  const decisionIntentResult = makeDecisionIntentResult({
    category: "financial_review",
    statement: "Review last quarter's financial performance.",
    confidence: 0.6,
  });

  const result = runAdaptiveIntelligenceEngine({
    prompt: "Let's review last quarter's numbers.",
    decisionIntentResult,
  });

  assert.equal(result.selectedDomain, "financial_intelligence");
  assert.equal(result.confidenceProfile.overallConfidence, 0.6 * 0.7);
  assert.ok(result.evidenceTrace.some((line) => /weaker basis/i.test(line)));
});

test("with only a document-type signal (no decisionIntentResult), overall confidence equals the document-type confidence exactly", () => {
  const result = runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES.engineering_intelligence });
  assert.equal(result.confidenceProfile.overallConfidence, result.confidenceProfile.documentTypeConfidence);
});

test("detectedDecisionObjective, when derived from the raw prompt (no DecisionIntentResult supplied), is always verbatim from the prompt, never invented", () => {
  const prompt = "We need to decide whether to expand into the European market next year.";
  const result = runAdaptiveIntelligenceEngine({ prompt });
  assert.equal(result.detectedDecisionObjective, prompt);
});

test("identical input always produces an identical result (determinism)", () => {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "financials.pdf", textContent: DOMAIN_FIXTURES.financial_intelligence }],
  });
  const input = { prompt: "Please review our financials.", documentIntelligence };

  const a = runAdaptiveIntelligenceEngine(input);
  const b = runAdaptiveIntelligenceEngine(input);

  assert.deepEqual(a, b);
});

test("all confidence values across every fixture and the cannot-determine case stay within [0, 1]", () => {
  const results = [
    ...adaptiveIntelligenceDomainValues.map((domain) => runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES[domain] })),
    runAdaptiveIntelligenceEngine({}),
  ];

  for (const result of results) {
    for (const value of Object.values(result.confidenceProfile)) {
      assert.ok(value >= 0 && value <= 1);
    }
  }
});

test("every fixture's detectedDocumentType is a human-readable label matching its selected domain", () => {
  const expectedLabels = {
    business_intelligence: "Business idea / business plan",
    market_intelligence: "Market research document",
    legal_intelligence: "Legal document",
    financial_intelligence: "Financial statement",
    property_intelligence: "Real estate document",
    medical_intelligence: "Medical report",
    engineering_intelligence: "Engineering drawing / document",
    hr_intelligence: "HR document",
    contract_intelligence: "Contract",
  };

  for (const domain of adaptiveIntelligenceDomainValues) {
    const result = runAdaptiveIntelligenceEngine({ prompt: DOMAIN_FIXTURES[domain] });
    assert.equal(result.detectedDocumentType, expectedLabels[domain]);
  }
});

test("does not modify report generation, PDF generation, billing, or UI, and is not directly wired into any production route", async () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );

  const planRouteSource = await readFile(
    new URL("../app/api/plan/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planRouteSource, /adaptive-intelligence-engine|runAdaptiveIntelligenceEngine/);

  // decision-engine.ts is an allowed exception: it is the standalone,
  // feature-flagged connector explicitly built to import and call this
  // engine (ZERINIX Decision Engine v1). Every other file in
  // app/lib/ai/ must still not reference it.
  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "adaptive-intelligence-engine.ts" || file === "decision-engine.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /adaptive-intelligence-engine|runAdaptiveIntelligenceEngine/,
      `expected ${file} to not reference the standalone engine`
    );
  }
});

test("does not modify any of the underlying modules it optionally reuses (zero regression guard)", () => {
  assert.doesNotMatch(engineSource, /^export function createUniversalDocumentIntelligenceFallback/m);
  assert.doesNotMatch(engineSource, /^export function runDecisionIntentEngine/m);
});
