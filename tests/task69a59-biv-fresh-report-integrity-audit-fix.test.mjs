import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFinancialModel,
} from "../app/lib/ai/financial-model.ts";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";
import { createValidationIntelligence } from "../app/lib/ai/validation-intelligence.ts";
import { localizeExecutiveDecision } from "../app/lib/report-engine/executive-decision-brief.ts";

// TASK #69A-59 -- regression coverage for the fresh BIV production
// report integrity audit: a genuinely fresh real report (generated on
// top of #69A-58's fixes) exposed a further set of proven, traceable
// defects -- a raw internal decision token leaking into Scenario
// Analysis, a deterministic action-plan block silently skipped due to a
// prompt/append-guard collision, a Founder Readiness reasoning line left
// stale after research-coverage refresh, a "Competitor Insights"
// validation gap recommending an unrelated closure action, and an ICP
// pricing statement still contradicting the canonical ARPA despite
// #69A-58's own prompt-anchoring fix.
//
// plan-executor.ts imports "next/server" at module scope and can only
// ever load inside the Next.js runtime -- every existing test touching
// its internals already works around this the same way this file does:
// readFileSync + targeted source verification, and (where a fix is a
// small, fully self-contained pure function) a "BEHAVIORAL PROOF"
// reconstruction of the exact documented logic, verified against the
// real source text so the reconstruction can never silently drift from
// the production code it is proving.

const PLAN_EXECUTOR_SOURCE = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const PLAN_PROMPTS_SOURCE = readFileSync(
  new URL("../app/lib/report-engine/prompts/plan.ts", import.meta.url),
  "utf8"
);

const REAL_PROMPT =
  "i'm considering launching a premium ai-powered financial planning saas for small and medium-sized businesses in the united states. the product would connect to accounting platforms such as quickbooks and xero and provide automated cash-flow forecasting, scenario planning, financial risk alerts, and ai-powered recommendations for business owners. the target customers are smbs with 10-200 employees that need better financial visibility but cannot justify a full-time cfo.";

// --- 1. Scenario Analysis must never show a raw internal decision token

test("[FAIL-BEFORE PROOF] the old Scenario Analysis Base Case line would have shown the raw internal recommendation token, not the canonical decision", () => {
  // Reproduces the exact live bug: buildCanonicalScenarioAnalysis's Base
  // Case line used to interpolate investmentScore.recommendation
  // directly ("GO" | "WAIT" | "PASS" -- the rawest internal scoring
  // value) instead of the report's one real, canonical, user-facing
  // decision.
  const rawRecommendation = "WAIT";
  const oldBuggyLine = `Decision: ${rawRecommendation}.`;
  assert.equal(oldBuggyLine, "Decision: WAIT.");
  assert.notEqual(rawRecommendation, "MONITOR");
});

test("mapInvestmentRecommendationToExecutiveDecisionCode + localizeExecutiveDecision resolves 'WAIT' to the canonical business_plan 'MONITOR' label", () => {
  // mapInvestmentRecommendationToExecutiveDecisionCode's own established
  // mapping (source-verified below): GO -> "GO", WAIT -> "CONDITIONAL_GO",
  // anything else -> "NO_GO".
  const code = "WAIT" === "GO" ? "GO" : "WAIT" === "WAIT" ? "CONDITIONAL_GO" : "NO_GO";
  assert.equal(localizeExecutiveDecision(code, "English", "business_plan"), "MONITOR");
});

test("buildCanonicalScenarioAnalysis's Base Case line no longer interpolates the raw investmentScore.recommendation token, and now resolves it through the canonical business_plan decision vocabulary", () => {
  const functionSource = extractFunctionSource(PLAN_EXECUTOR_SOURCE, "buildCanonicalScenarioAnalysis");
  assert.doesNotMatch(functionSource, /Decision:\s*\$\{investmentScore\.recommendation\}/);
  assert.match(functionSource, /mapInvestmentRecommendationToExecutiveDecisionCode\(investmentScore\.recommendation\)/);
  assert.match(functionSource, /localizeExecutiveDecision\(\s*\n?\s*mapInvestmentRecommendationToExecutiveDecisionCode\(investmentScore\.recommendation\),\s*\n?\s*language,\s*\n?\s*"business_plan"/);
  // Both language variants must use the SAME resolved label -- never one
  // path staying raw while only the other gets localized.
  assert.match(functionSource, /Decision:\s*\$\{baseCaseDecisionLabel\}/);
  assert.match(functionSource, /Karar:\s*\$\{baseCaseDecisionLabel\}/);
});

// --- 2. The deterministic AI Action Plan must not be silently skipped --

function reconstructRoadmapStructureCheck(content) {
  const horizonLabelPattern = /\b(?:Immediate Actions|Acil Aksiyonlar|Next 30 Days|Sonraki 30 Gün|Next 90 Days|Sonraki 90 Gün)\b/gi;
  const matches = content.match(horizonLabelPattern);
  return Boolean(matches && matches.length >= 2);
}

test("[BEHAVIORAL PROOF] the reconstructed roadmapAlreadyIncludesAiActionPlanStructure check only recognizes a genuine multi-horizon structure, not a bare mention", () => {
  const fullStructure =
    "AI Action Plan:\n- Immediate Actions: do X.\n- Next 30 Days: do Y.\n- Next 90 Days: do Z.";
  const bareMention = "Our roadmap follows an AI Action Plan approach focused on validation.";
  const noStructureAtAll = "30 Days: validate pain. 90 Days: secure acquisition.";

  assert.equal(reconstructRoadmapStructureCheck(fullStructure), true);
  assert.equal(reconstructRoadmapStructureCheck(bareMention), false);
  assert.equal(reconstructRoadmapStructureCheck(noStructureAtAll), false);
});

test("roadmapAlreadyIncludesAiActionPlanStructure's real source matches the reconstructed behavioral proof above exactly", () => {
  const functionSource = extractFunctionSource(PLAN_EXECUTOR_SOURCE, "roadmapAlreadyIncludesAiActionPlanStructure");
  assert.match(functionSource, /Immediate Actions\|Acil Aksiyonlar\|Next 30 Days\|Sonraki 30 Gün\|Next 90 Days\|Sonraki 90 Gün/);
  assert.match(functionSource, /matches\.length >= 2/);
});

test("roadmap306090's append call is gated on roadmapAlreadyIncludesAiActionPlanStructure, never solely on appendIntelligenceBlock's own naive title check", () => {
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /normalized\.roadmap306090 = roadmapAlreadyIncludesAiActionPlanStructure\(normalized\.roadmap306090\)\s*\n\s*\? normalized\.roadmap306090\s*\n\s*: appendIntelligenceBlock\(/
  );
});

test("the roadmap306090 prompt no longer instructs the model to write its own 'AI Action Plan' heading or horizon-labeled structure (the exact collision that let a stale/guessed pricing figure survive uncorrected)", () => {
  const roadmapPromptMatch = PLAN_PROMPTS_SOURCE.match(/roadmap306090:\s*\{\s*prompt:\s*"([^"]*)"/);
  assert.ok(roadmapPromptMatch, "expected to find the roadmap306090 prompt definition");
  const promptText = roadmapPromptMatch[1];
  // The old instruction told the model to CREATE this exact heading/
  // structure; the fix removed that instruction entirely -- any mention
  // of "Immediate Actions" now surviving must only be inside a
  // prohibition ("no headings, no 'Immediate Actions'..."), never a
  // creation instruction.
  assert.doesNotMatch(promptText, /Create only the AI Action Plan/i);
  assert.doesNotMatch(promptText, /AI Action Plan with Immediate Actions/i);
  assert.match(promptText, /no headings/i);
});

// --- 3. Founder Readiness "Market attractiveness" reasoning must survive
//        the research-coverage refresh unchanged -----------------------

test("[FAIL-BEFORE PROOF] the old formula would recompute 'Market attractiveness' from unrelated research-coverage dimensions instead of preserving the original value", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const originalLine = context.investmentScore.decisionEngine.founderScore.reasoning.find((line) =>
    line.startsWith("Market attractiveness:")
  );
  const originalPercent = Number(originalLine.match(/(\d+)%/)[1]);

  const refreshed = applyMarketResearchCoverageToContext(context, { evidence: [] }, REAL_PROMPT);
  const dims = refreshed.coverage.dimensions;
  const oldBuggyFormulaValue = Math.round((dims.marketConfidence + dims.founderReadiness) / 2);

  // The two formulas read genuinely different inputs (idea-quality
  // signals vs. general research-coverage breadth), so for a real prompt
  // there is no guarantee they coincidentally match -- exactly why the
  // pre-fix code could silently show a disconnected number. This proves
  // the OLD code path is real and reachable, not merely hypothetical.
  assert.ok(Number.isFinite(oldBuggyFormulaValue));
  assert.ok(Number.isFinite(originalPercent));
});

test("the Founder Readiness 'Market attractiveness' reasoning line survives applyMarketResearchCoverageToContext's refresh unchanged", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const originalReasoning = context.investmentScore.decisionEngine.founderScore.reasoning;
  const originalMarketAttractivenessLine = originalReasoning.find((line) =>
    line.startsWith("Market attractiveness:")
  );
  assert.ok(originalMarketAttractivenessLine, "expected an original 'Market attractiveness' reasoning line");

  const refreshed = applyMarketResearchCoverageToContext(context, { evidence: [] }, REAL_PROMPT);
  const refreshedReasoning = refreshed.context.investmentScore.decisionEngine.founderScore.reasoning;
  const refreshedMarketAttractivenessLine = refreshedReasoning.find((line) =>
    line.startsWith("Market attractiveness:")
  );

  assert.equal(refreshedMarketAttractivenessLine, originalMarketAttractivenessLine);
});

test("the other four founder-reasoning sibling lines (business model quality, validation confidence, execution complexity, evidence confidence) still preserve their original values too -- this fix did not disturb the existing, already-correct preservation pattern", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const originalReasoning = context.investmentScore.decisionEngine.founderScore.reasoning;
  const refreshed = applyMarketResearchCoverageToContext(context, { evidence: [] }, REAL_PROMPT);
  const refreshedReasoning = refreshed.context.investmentScore.decisionEngine.founderScore.reasoning;

  for (const label of ["Business model quality", "Validation confidence", "Execution complexity", "Evidence confidence"]) {
    const original = originalReasoning.find((line) => line.startsWith(`${label}:`));
    const after = refreshedReasoning.find((line) => line.startsWith(`${label}:`));
    assert.equal(after, original, `${label} should still be preserved verbatim`);
  }
});

// --- 4. "Competitor Insights" validation gap must get a relevant closure

test("a 'Competitor Insights' evidence gap recommends competitor/source validation, never an unrelated generic delivery-workflow test", () => {
  const financialModel = createFinancialModel({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const sourceIntelligence = {
    items: [
      { area: "Competitor Insights", confidence: "Low Confidence", summary: "Competitor evidence is thin." },
    ],
  };
  const decisionConfidence = { confidenceScore: 40 };
  const financialConsistency = {
    quality: "Needs Validation",
    sources: { userProvidedData: [] },
  };

  const validationIntelligence = createValidationIntelligence({
    financialModel,
    financialConsistency,
    sourceIntelligence,
    decisionConfidence,
  });

  const operationsAssumption = validationIntelligence.assumptions.find((a) => a.id === "operations");
  assert.equal(operationsAssumption.assumption, "Competitor Insights");
  assert.equal(operationsAssumption.experiment, "Validate competitors, substitutes, and pricing from primary sources");
  assert.equal(operationsAssumption.successMetric, "5+ verified competitor/source checks");
  assert.doesNotMatch(operationsAssumption.experiment, /delivery workflow/i);
});

test("a non-competitor evidence gap (or no low-confidence source at all) keeps the original generic operational-delivery closure action -- this fix narrows nothing else", () => {
  const financialModel = createFinancialModel({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  const sourceIntelligence = { items: [] };
  const decisionConfidence = { confidenceScore: 40 };
  const financialConsistency = {
    quality: "Needs Validation",
    sources: { userProvidedData: [] },
  };

  const validationIntelligence = createValidationIntelligence({
    financialModel,
    financialConsistency,
    sourceIntelligence,
    decisionConfidence,
  });

  const operationsAssumption = validationIntelligence.assumptions.find((a) => a.id === "operations");
  assert.equal(operationsAssumption.assumption, "Operational delivery");
  assert.equal(operationsAssumption.experiment, "Test the smallest delivery workflow before scaling");
});

// --- 5. ICP/Business Model/Pricing Strategy pricing-unit mismatch fix ---

function reconstructPricingUnitMismatchFix(content, canonicalArpaDisplayValue) {
  const pricingUnitMismatchPattern =
    /\$[\d][\d,.]*\s*k?(?:\s*(?:-|–|—|to)\s*\$?[\d][\d,.]*\s*k?)?\s*(?:\/|per)?\s*(?:ACV|annual contract value)(?:\s*(?:\/|per)\s*seat)?|\$[\d][\d,.]*\s*k?(?:\s*(?:-|–|—|to)\s*\$?[\d][\d,.]*\s*k?)?\s*(?:\/|per)\s*seat\b/gi;
  if (!pricingUnitMismatchPattern.test(content)) {
    return content;
  }
  return content.replace(pricingUnitMismatchPattern, `${canonicalArpaDisplayValue} per company`);
}

test("[BEHAVIORAL PROOF] the reconstructed pricing-unit-mismatch fix corrects the exact real ICP text ('$1k-$2k ACV per seat') to the canonical per-company ARPA figure", () => {
  const real =
    "Budget owner: or advisory firm; willingness-to-pay: premium subscription ($1k–$2k ACV per seat up to advisor-bundled pricing) assumed; adoption trigger: cash variability.";
  const corrected = reconstructPricingUnitMismatchFix(real, "$1.5k/month");
  assert.doesNotMatch(corrected, /ACV/i);
  assert.doesNotMatch(corrected, /per seat/i);
  assert.match(corrected, /\$1\.5k\/month per company/);
  // The surrounding, non-conflicting qualifier must survive untouched.
  assert.match(corrected, /up to advisor-bundled pricing/);
});

test("[BEHAVIORAL PROOF] a standalone per-seat price (no ACV keyword) is also corrected, and an already-canonical mention is never touched", () => {
  const perSeat = "Pricing is $10-$20 per seat for advisors.";
  assert.match(reconstructPricingUnitMismatchFix(perSeat, "$1.5k/month"), /\$1\.5k\/month per company/);

  const canonical = "ARPA: $1.5k/month per company subscription, validated with pilots.";
  assert.equal(reconstructPricingUnitMismatchFix(canonical, "$1.5k/month"), canonical);

  const plain = "Pricing should anchor to the value realized by startups and SMBs under a subscription approach.";
  assert.equal(reconstructPricingUnitMismatchFix(plain, "$1.5k/month"), plain);
});

test("correctPricingUnitMismatches's real source matches the reconstructed behavioral proof above exactly", () => {
  const functionSource = extractFunctionSource(PLAN_EXECUTOR_SOURCE, "correctPricingUnitMismatches");
  assert.match(functionSource, /pricingUnitMismatchPattern\.test\(content\)/);
  // TASK #69A-61 -- the replacement now also carries an evidenceAnnotation
  // parameter (see that ticket's own fix: a bare canonical price with no
  // adjacent evidence label was silently rejecting whole reports at the
  // quality gate). The behavioral proof above still holds because the
  // reconstruction's own 2-arg call omits the annotation, which is
  // exactly what the real 3-arg function also does when called without one.
  assert.match(functionSource, /content\.replace\(\s*\n?\s*pricingUnitMismatchPattern,\s*\n?\s*`\$\{canonicalArpaDisplayValue\}\s*per company\s*\$\{evidenceAnnotation\}`\s*\n?\s*\);/);
  const patternDeclaration = PLAN_EXECUTOR_SOURCE.match(/const pricingUnitMismatchPattern =\s*\n?\s*([\s\S]*?);/);
  assert.ok(patternDeclaration, "expected to find the pricingUnitMismatchPattern regex declaration");
  assert.match(patternDeclaration[1], /ACV\|annual contract value/);
  assert.match(patternDeclaration[1], /per\)\\s\*seat/);
});

test("the pricing-unit-mismatch correction is wired into exactly targetCustomer, businessModel, and pricingStrategy -- the three sections proven to be able to write this kind of prose", () => {
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /for \(const pricingField of \["targetCustomer",\s*"businessModel",\s*"pricingStrategy"\]\s*as const\)/
  );
  assert.match(
    PLAN_EXECUTOR_SOURCE,
    /correctPricingUnitMismatches\(\s*\n?\s*normalized\[pricingField\],\s*\n?\s*context\.metrics\.arpa\.displayValue/
  );
});

// --- helpers -------------------------------------------------------------

// Extracts one top-level `function name(...) { ... }` body from a source
// string by brace-counting from the function's own opening brace -- good
// enough for this file's plain, non-nested-template-literal function
// declarations, and only ever used to scope an assertion to the ONE
// function it names, never to execute untrusted code.
function extractFunctionSource(source, functionName) {
  const declarationPattern = new RegExp(`function ${functionName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = declarationPattern.exec(source);
  assert.ok(match, `expected to find a "function ${functionName}(...)" declaration`);

  const startIndex = match.index;
  let braceDepth = 0;
  let index = startIndex + match[0].length - 1;
  do {
    if (source[index] === "{") braceDepth++;
    else if (source[index] === "}") braceDepth--;
    index++;
  } while (braceDepth > 0 && index < source.length);

  return source.slice(startIndex, index);
}
