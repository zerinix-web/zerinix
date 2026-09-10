import crypto from "node:crypto";
import type { BenchmarkConfidence } from "@/app/lib/ai/industry-benchmarks";
import type { FinancialModel } from "@/app/lib/ai/financial-model";
import { lifecycleConfidenceBoost, isRevenueOrGrowthStage } from "@/app/lib/ai/company-lifecycle";

export type InvestmentScoreCategoryKey =
  | "marketOpportunity"
  | "competitiveAdvantage"
  | "businessModel"
  | "financialHealth"
  | "scalability"
  | "teamFounder"
  | "capitalEfficiency"
  | "executionRisk";

// TASK #69A-17 -- the ONE canonical, deterministic, per-dimension
// Founder Readiness score entry. `key`/`label` identify the dimension by
// IDENTITY (matching report-presentation.ts's own FounderReadinessDimensionKey/
// FOUNDER_READINESS_DIMENSIONS), never a positional array index, so a
// consumer can resolve a dimension's score without ever re-deriving it
// from prose. Optional and additive on InvestmentScoreCategory (only
// decisionEngine.founderScore ever actually populates it) -- a report
// persisted before this field existed simply has it undefined, which
// every reader below treats as "fall back to the pre-existing,
// unmodified prose/reasoning-derived extraction," never as a reason to
// fabricate a score.
export type FounderReadinessDimensionScoreEntry = {
  key: string;
  label: string;
  score: number;
};

export type InvestmentScoreCategory = {
  key: InvestmentScoreCategoryKey;
  label: string;
  score: number;
  maximumScore: number;
  explanation: string;
  reasoning: string[];
  dimensionScores?: FounderReadinessDimensionScoreEntry[];
};

// TASK #69A-27 -- structured, canonical provenance for a fatal-blocker
// override (see applyFatalBlockerOverride below): which named Founder
// Readiness dimension(s) fell below FATAL_BLOCKER_SCORE_RATIO and
// therefore forced the recommendation away from "GO", so a downstream
// reader (report narrative, decision provenance, a future UI) can
// reconstruct WHY GO was blocked from structured data alone, never
// from generated prose or renderer inference.
export type FatalBlocker = {
  key: string;
  label: string;
  score: number;
};

export type InvestmentScore = {
  version: "investment_score_engine_v1";
  fingerprint: string;
  totalScore: number;
  confidence: number;
  recommendation: "GO" | "WAIT" | "PASS";
  // TASK #69A-27 -- empty whenever no fatal blocker exists (the
  // overwhelmingly common case); non-empty ONLY when
  // applyFatalBlockerOverride actually downgraded a would-be "GO" to
  // "WAIT" because of one or more of these entries.
  fatalBlockers: FatalBlocker[];
  estimatedValuation: string;
  fundingStage: string;
  nextCriticalAction: string;
  strengths: string[];
  weaknesses: string[];
  topRisks: string[];
  categories: Record<InvestmentScoreCategoryKey, InvestmentScoreCategory>;
  decisionEngine: Record<
    | "marketScore"
    | "financialScore"
    | "founderScore"
    | "executionScore"
    | "riskScore"
    | "competitionScore"
    | "technologyScore",
    InvestmentScoreCategory
  >;
};

type InvestmentScoreInput = {
  prompt: string;
  financialModel: FinancialModel;
};

const CATEGORY_WEIGHTS: Record<InvestmentScoreCategoryKey, number> = {
  marketOpportunity: 15,
  competitiveAdvantage: 12,
  businessModel: 13,
  financialHealth: 15,
  scalability: 12,
  teamFounder: 10,
  capitalEfficiency: 13,
  executionRisk: 10,
};

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Math.round(clamp(value, 0, 100));
}

function weightedScore(score: number, maximumScore: number) {
  return Math.round(clamp(score, 0, 1) * maximumScore);
}

function normalizeHigherBetter(value: number, low: number, high: number) {
  if (high <= low) return 0.5;
  return clamp((value - low) / (high - low), 0, 1);
}

function normalizeLowerBetter(value: number, good: number, poor: number) {
  if (poor <= good) return 0.5;
  return clamp(1 - (value - good) / (poor - good), 0, 1);
}

function confidenceValue(confidence: BenchmarkConfidence) {
  if (confidence === "High") return 85;
  if (confidence === "Medium") return 65;
  return 45;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function promptSpecificityScore(prompt: string) {
  const normalized = normalizePrompt(prompt);
  const signals = [
    /\b(b2b|b2c|enterprise|consumer|smb|hospital|clinic|hotel|restaurant|manufacturer|founder|developer)\b/,
    /\b(us|usa|uk|europe|turkey|gcc|global|london|istanbul|dubai)\b/,
    /\b(subscription|marketplace|franchise|usage-based|premium|luxury|enterprise sales|direct sales)\b/,
    /\b(ai|cybersecurity|healthcare|fintech|logistics|manufacturing|coffee|ev|saas)\b/,
    /\b(monthly|annual|arr|mrr|cac|ltv|margin|pricing|customers)\b/,
  ];
  const matchedSignals = signals.filter((pattern) => pattern.test(normalized)).length;

  return clamp(0.35 + matchedSignals * 0.13, 0.35, 1);
}

// Confirmed live: a prompt explicitly disclaiming evidence ("I have no
// customers, no revenue, no funding, no prototype, and no validated
// scientific evidence") was misread as CLAIMING it, purely because
// "customers" and "revenue" literally appear inside the negated clause --
// this independently-duplicated copy of financial-model.ts's own
// hasValidationEvidence had the identical bug, and it directly drives the
// Founder Score / Execution Risk categories' own "Validation evidence
// detected: yes/no" narrative line and several real score adjustments
// (e.g. a +0.08 evidence bonus instead of the correct -0.08 penalty, and
// a validation-level score of 70 instead of 48). Negated occurrences are
// stripped before the positive-evidence scan runs, matching financial-
// model.ts's fix exactly, so "no revenue" no longer counts as "has
// revenue evidence" while a genuine claim like "we have 200 customers on
// a waitlist" is untouched.
const negatedEvidenceClaimPattern =
  /\b(?:no|not|zero|without|never (?:had|have|has)|don'?t have|doesn'?t have|do not have|does not have|haven'?t(?:\s+(?:got|had))?|have not(?:\s+(?:got|had))?|hasn'?t(?:\s+(?:got|had))?|has not(?:\s+(?:got|had))?|lack(?:s|ing)? of|no direct|not yet)\s+(?:\w+\s+){0,3}?(?:revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr|gelir|satış|satis|müşteri|musteri|abone|abonelik|ön sipariş|on siparis|bekleme listesi)\b/gi;

// TASK #69A-27 -- ROOT CAUSE FIX (#69A-26 P1, adversarial finding: an
// unsupported revenue PROJECTION alone -- "we project $10M ARR within
// 18 months... we have no customers, no revenue, no pilots" -- reached
// recommendation "GO"). Confirmed live: hasValidationEvidence already
// stripped NEGATED evidence claims, but never stripped FORWARD-LOOKING
// ones -- "we project $10M ARR" still matched the bare "arr" keyword,
// so a stated TARGET/FORECAST was indistinguishable from a stated,
// already-achieved fact. This is the exact mechanism that let a
// planning assumption satisfy the same evidence bar real, demonstrated
// traction is supposed to require: hasValidationEvidence's result
// becomes financial-model.ts's `sources.userProvidedData` ("User
// supplied validation evidence in the request."), which
// validation-intelligence.ts's hasUserEvidence reads verbatim to grade
// the canonical "customer-demand" assumption Validated -- so a bare
// projection could silently clear the SAME structured evidence-gap
// check real traction is meant to gate. Same window-based approach as
// negatedEvidenceClaimPattern above (a fixed nearby-text scan, matching
// this file's own existing hasNearbyNegation-style precedent), applied
// to forward-looking/aspirational framing instead of negation.
const projectedEvidenceClaimPattern =
  /\b(?:project(?:ed|ing|ions?)?|forecast(?:ed|ing|s)?|expect(?:ed|ing)?|anticipat(?:e|ed|ing)|target(?:ed|ing)?|plan(?:s|ned|ning)?\s+(?:for|to)|aim(?:s|ing)?\s+(?:for|to)|hope(?:s|d|ing)?\s+(?:for|to)|believe|confident (?:that|it|this)?|will (?:be|reach|have|see)|should (?:be|reach|have|see)|going to (?:be|reach|have))\b[^.!?]{0,30}?\b(?:revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr)\b/gi;

function hasValidationEvidence(prompt: string) {
  const normalized = normalizePrompt(prompt);
  const withoutNegatedClaims = normalized
    .replace(negatedEvidenceClaimPattern, " ")
    .replace(projectedEvidenceClaimPattern, " ");

  return /\b(revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr|gelir|satış|satis|müşteri|musteri|abone|abonelik|ön sipariş|on siparis|bekleme listesi)\b/.test(
    withoutNegatedClaims
  );
}

function isD2cFoodOrFmcg(model: FinancialModel) {
  return (
    model.inputs.industryKey === "luxuryCoffee" ||
    model.inputs.businessModel.toLowerCase().includes("d2c") ||
    model.inputs.pricingModel.toLowerCase().includes("repeat purchase")
  );
}

// TASK #69A-54 -- ROOT CAUSE FIX. #69A-53 corrected executionComplexityScore's
// DIRECTION (higher = better readiness), but left its own accuracy
// unaudited: the score was, and remains, a flat 3-way bucket (capitalHeavy
// ? 0.42 : d2cFoodOrFmcg ? 0.5 : 0.66) keyed to a narrow physical-
// capital-intensity keyword list -- confirmed live, a real SMB AI
// forecasting SaaS prompt ("AI-powered financial planning... integrating
// with QuickBooks/Xero") matched neither capitalHeavy nor d2cFoodOrFmcg,
// so it silently defaulted to 0.66 (the EASIEST bucket) even though its
// own generated narrative separately, correctly identified real
// execution burden ("integrations, model training, and channel building
// raise complexity") -- the exact number/narrative mismatch #69A-53 set
// out to prevent, just from a missed SIGNAL rather than a wrong
// DIRECTION.
//
// FIX: 7 bounded, evidence-specific execution-burden categories, each
// checked against literal USER INPUT (the submitted prompt text --
// explicitly a sanctioned evidence source; see this function's own doc
// comment), NEVER a large uncontrolled keyword bag -- each category is a
// single, narrow regex tied to a real, named burden type (never a bare
// "ai"/"integration" alone, which would fire on unrelated marketing
// language). A category counts AT MOST ONCE regardless of how many of
// its own keywords match (no double counting within a category), and
// each matched category subtracts the SAME small, fixed, bounded amount
// (EXECUTION_BURDEN_CATEGORY_PENALTY) from the existing capitalHeavy/
// d2cFoodOrFmcg baseline -- purely ADDITIVE on top of #69A-53's own
// unchanged formula, so a prompt that matches NONE of these categories
// (the common case for most existing test fixtures) produces the exact
// same score as before, byte-for-byte. Deliberately excludes the
// "Operational complexity" and "Distribution/channel complexity"
// categories the ticket also names: those are already covered by the
// EXISTING capitalHeavy (physical/capital-intensive operations) and
// d2cFoodOrFmcg (D2C/FMCG retail distribution) checks respectively --
// adding a second, separate keyword check for the same concept would be
// duplicate counting, not new signal.
export type ExecutionBurdenCategoryKey =
  | "productTechnical"
  | "integrationDependency"
  | "dataInfrastructure"
  | "regulatoryCompliance"
  | "distributionChannel"
  | "talentExpertise"
  | "implementationOnboarding";

const EXECUTION_BURDEN_CATEGORY_PATTERNS: Record<ExecutionBurdenCategoryKey, RegExp> = {
  // AI/ML model training, data-quality-dependent forecasting/prediction --
  // literal "ai-powered"/"machine learning" branding is included
  // deliberately (a genuinely AI/ML-driven product carries real model-
  // build/data-quality complexity as an inherent, literal, user-stated
  // characteristic -- this is bounded inference from stated input, not
  // hallucination), but bare "ai" alone is never enough on its own.
  productTechnical:
    /\b(ai-powered|ai-driven|ai-enabled|machine learning|predictive model(?:s|ing)?|forecasting (?:model|algorithm|engine)|model training|train(?:ing)? (?:a |an |the )?(?:ai|ml) model|proprietary algorithm|fine-tun(?:e|ing))\b/,
  integrationDependency:
    /\b(integrat(?:e|es|ing|ion|ions) with|third-party integrations?|api integrations?|multiple integrations|depends? on (?:external|third-party) (?:platforms?|apis?|systems?))\b/,
  dataInfrastructure:
    /\b(data migration|data infrastructure|data pipeline|data quality requirements?|legacy data|data warehouse)\b/,
  regulatoryCompliance:
    /\b(regulatory (?:burden|requirements?|approval)|compliance burden|multi-jurisdiction|cross-border compliance|licensing requirements?|hipaa|gdpr|sox compliance|pci compliance)\b/,
  distributionChannel:
    /\b(channel (?:building|development|partnerships?)|distribution (?:motion|strategy) (?:is |remains )?unvalidated|reseller network|partner channel)\b/,
  talentExpertise:
    /\b(specialized talent|niche expertise|hard to hire|scarce talent|domain experts? required|specialized (?:engineers|staff|personnel))\b/,
  implementationOnboarding:
    /\b(long onboarding|lengthy deployment|enterprise implementation|multi-month (?:onboarding|deployment|implementation)|complex onboarding|extended (?:onboarding|deployment) cycles?)\b/,
};

// Short, human-readable fragments for the SAME categories, reused
// verbatim by plan-executor.ts's buildCanonicalFounderScore (via the
// reasoning line this function writes below) so the explanation a
// reader sees is built from the IDENTICAL evidence the score used --
// never a second, independently-worded description that could drift.
const EXECUTION_BURDEN_CATEGORY_DESCRIPTIONS: Record<ExecutionBurdenCategoryKey, string> = {
  productTechnical: "AI/ML model or data-quality requirements",
  integrationDependency: "dependency on multiple third-party integrations",
  dataInfrastructure: "data migration and infrastructure requirements",
  regulatoryCompliance: "regulatory or compliance burden",
  distributionChannel: "an unvalidated or difficult distribution/channel motion",
  talentExpertise: "dependency on specialized or scarce talent",
  implementationOnboarding: "long onboarding or enterprise implementation cycles",
};

const EXECUTION_BURDEN_CATEGORY_PENALTY = 0.05;
const EXECUTION_READINESS_FLOOR = 0.15;

function detectExecutionBurdenCategories(normalizedPrompt: string): ExecutionBurdenCategoryKey[] {
  return (Object.keys(EXECUTION_BURDEN_CATEGORY_PATTERNS) as ExecutionBurdenCategoryKey[]).filter((key) =>
    EXECUTION_BURDEN_CATEGORY_PATTERNS[key].test(normalizedPrompt)
  );
}

function makeCategory(input: {
  key: InvestmentScoreCategoryKey;
  label: string;
  normalizedScore: number;
  explanation: string;
  reasoning: string[];
}): InvestmentScoreCategory {
  const maximumScore = CATEGORY_WEIGHTS[input.key];

  return {
    key: input.key,
    label: input.label,
    maximumScore,
    score: weightedScore(input.normalizedScore, maximumScore),
    explanation: input.explanation,
    reasoning: input.reasoning,
  };
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;

  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function createStrengths(categories: InvestmentScoreCategory[], model: FinancialModel) {
  const topCategories = [...categories]
    .sort((a, b) => b.score / b.maximumScore - a.score / a.maximumScore)
    .slice(0, 3)
    .map((category) => `${category.label}: ${category.explanation}`);

  if (model.metrics.grossMargin.value >= model.benchmark.ranges.grossMargin.low) {
    topCategories.push(
      `Gross margin discipline: ${model.metrics.grossMargin.displayValue} sits ${model.metrics.grossMargin.benchmarkComparison.toLowerCase()}.`
    );
  }

  return topCategories.slice(0, 4);
}

function createWeaknesses(categories: InvestmentScoreCategory[], model: FinancialModel) {
  const bottomCategories = [...categories]
    .sort((a, b) => a.score / a.maximumScore - b.score / b.maximumScore)
    .slice(0, 3)
    .map((category) => `${category.label}: ${category.explanation}`);

  if (model.metrics.cacPayback.value > model.benchmark.ranges.cacPayback.high) {
    bottomCategories.push(
      `CAC payback risk: ${model.metrics.cacPayback.displayValue} is above the benchmark range.`
    );
  }

  return bottomCategories.slice(0, 4);
}

// TASK #69A-27 -- exported so refreshResearchAwareFinancialContext
// (financial-assumptions.ts) can recompute the post-research
// recommendation from THIS one authoritative formula instead of
// duplicating its threshold logic a second time (the exact
// "duplicated decision logic" pattern #69A-26 already flagged
// elsewhere in this codebase for hasValidationEvidence).
export function createRecommendation(totalScore: number, confidence: number) {
  if (totalScore >= 72 && confidence >= 60) return "GO";
  if (totalScore < 35 && confidence < 35) return "PASS";
  return "WAIT";
}

// TASK #69A-27 -- ROOT CAUSE FIX (#69A-26 P0 finding: createRecommendation
// above is a PURE two-threshold gate on the aggregate totalScore/
// confidence, with no per-category floor -- proven live, and by direct
// arithmetic, that 7 categories at 90% and ONE catastrophic category
// (e.g. teamFounder) at 10% still produces totalScore 82, clearing the
// GO threshold outright). A material/fatal blocker must never be
// averaged away by strong, unrelated dimensions. Deliberately checks
// the 7 named Founder Readiness DIMENSION scores, not just the 8
// top-level categories: teamFounder's own category score is itself an
// AVERAGE of the same 7 sub-signals displayed as Founder Readiness
// dimensions ([UPDATED BY #69A-51] ideaQuality counted twice --
// see teamFounder's own construction below for why -- plus
// businessModelQuality, validationLevel, evidenceConfidence,
// founderEvidence, and executionComplexity, each counted once), so
// even a genuinely catastrophic founderEvidenceScore gets diluted back
// up to a moderate teamFounder category score the same way totalScore
// dilutes teamFounder itself -- checking at dimension granularity is
// the only way to catch the blocker before it is averaged away twice
// over. This is deliberately NOT a prose/keyword scan of the report
// text -- it reads only the already-computed, structured dimension
// scores every Founder Readiness renderer already displays.
export const FATAL_BLOCKER_SCORE_RATIO = 0.15;

export function detectFatalBlockers(
  dimensionScores: readonly FounderReadinessDimensionScoreEntry[]
): FatalBlocker[] {
  return dimensionScores
    .filter((dimension) => dimension.score < FATAL_BLOCKER_SCORE_RATIO * 100)
    .map((dimension) => ({ key: dimension.key, label: dimension.label, score: dimension.score }));
}

// A fatal blocker can only ever downgrade GO -> WAIT; it never manufactures
// a WAIT -> PASS downgrade on its own (PASS already has its own,
// independent low-totalScore/low-confidence gate above) and never
// upgrades anything. This keeps the override narrowly scoped to
// exactly the proven exploit (a blocker hiding behind a high aggregate
// score reaching GO), not a broader re-grading of every recommendation.
export function applyFatalBlockerOverride(
  recommendation: "GO" | "WAIT" | "PASS",
  fatalBlockers: readonly FatalBlocker[]
): "GO" | "WAIT" | "PASS" {
  if (fatalBlockers.length > 0 && recommendation === "GO") {
    return "WAIT";
  }

  return recommendation;
}

function createVisibleRecommendation(recommendation: "GO" | "WAIT" | "PASS", confidence: number) {
  if (recommendation === "GO") return "VALIDATE";
  if (recommendation === "PASS" && confidence < 35) return "PASS";
  return "HOLD";
}

function createFundingStage(model: FinancialModel) {
  const investmentNeeded = model.metrics.investmentNeeded.value;
  const arr = model.metrics.arr.value;

  if (arr < 250_000 && investmentNeeded < 750_000) return "Pre-seed";
  if (arr < 1_500_000 && investmentNeeded < 3_000_000) return "Seed";
  if (arr < 8_000_000 && investmentNeeded < 10_000_000) return "Seed / Series A";
  return "Series A+ / growth capital";
}

function createEstimatedValuation(model: FinancialModel) {
  const multiple = average([
    model.benchmark.ranges.revenueMultiple.low,
    model.benchmark.ranges.revenueMultiple.high,
  ]);
  const baseValuation = Math.max(
    model.metrics.arr.value * multiple,
    model.metrics.investmentNeeded.value * 1.25
  );

  return `${formatUsd(baseValuation * 0.8)}-${formatUsd(baseValuation * 1.2)}`;
}

function createNextCriticalAction(model: FinancialModel, recommendation: "GO" | "WAIT" | "PASS") {
  if (recommendation === "PASS") {
    return "Do not scale spend until the weakest economics are redesigned and validated.";
  }

  // CRITICAL SCORING ENGINE FIX -- company lifecycle awareness. A company
  // with real paying customers must never be told to "validate
  // willingness to pay" or "get first customers" -- that evidence already
  // exists. Revenue/growth-stage companies get retention/expansion/CAC-
  // payback framing instead, matching REVENUE_STAGE's own required
  // behavior ("do NOT recommend validate willingness to pay if customers
  // already pay; analyze retention, expansion, CAC, payback, sales
  // efficiency").
  const stage = model.inputs.lifecycleStage;
  if (isRevenueOrGrowthStage(stage)) {
    if (model.metrics.cacPayback.value > model.benchmark.ranges.cacPayback.high) {
      return "Optimize CAC efficiency by tightening acquisition spend or raising net revenue retention before increasing budget.";
    }

    return stage === "growth"
      ? "Scale distribution into new markets while protecting margins and expanding enterprise accounts."
      : "Improve retention and expand enterprise accounts on the existing paying base before increasing acquisition spend.";
  }

  if (model.metrics.cacPayback.value > model.benchmark.ranges.cacPayback.high) {
    return "Validate a lower-CAC acquisition motion before increasing budget.";
  }

  if (model.metrics.grossMargin.confidence === "Low" || model.metrics.tam.confidence === "Low") {
    return "Run primary research to validate market size and contribution margin assumptions.";
  }

  if (stage === "pilot") {
    return "Convert the strongest pilots into paid, renewing contracts using the calculated pricing and payback targets.";
  }

  if (recommendation === "GO") {
    return "Convert the strongest ICP into paid pilots using the calculated pricing and payback targets.";
  }

  return "Validate pricing, buyer urgency, and repeatable acquisition before committing full funding.";
}

function createTopRisks(model: FinancialModel, categories: InvestmentScoreCategory[]) {
  const risks = [
    `Execution risk: ${categories.find((category) => category.key === "executionRisk")?.explanation}`,
    `Capital efficiency: investment need is ${model.metrics.investmentNeeded.displayValue} against ${model.metrics.arr.displayValue} Year-1 ARR.`,
    `Confidence: ${model.benchmark.label} assumptions require primary validation where confidence is Low.`,
  ].filter(Boolean);

  if (model.metrics.cacPayback.value > model.benchmark.ranges.cacPayback.high) {
    risks.unshift(`Payback risk: ${model.metrics.cacPayback.displayValue} exceeds the benchmark range.`);
  }

  if (model.metrics.runway.value < 12) {
    risks.unshift(`Runway risk: ${model.metrics.runway.displayValue} gives limited iteration time.`);
  }

  return risks.slice(0, 3);
}

export function createInvestmentScore(input: InvestmentScoreInput): InvestmentScore {
  const model = input.financialModel;
  const metrics = model.metrics;
  const ranges = model.benchmark.ranges;
  const normalizedPrompt = normalizePrompt(input.prompt);
  const specificity = promptSpecificityScore(input.prompt);
  const capitalHeavy = hasAny(normalizedPrompt, [
    /\b(manufacturing|factory|hospital|hotel|yacht|ev charging|battery|clinic|franchise|drone|uav)\b/,
  ]);
  const d2cFoodOrFmcg = isD2cFoodOrFmcg(model);
  const validationEvidence = hasValidationEvidence(input.prompt);
  // CRITICAL SCORING ENGINE FIX -- company lifecycle awareness. This used
  // to be a single flat +0.08 boost for "any validation evidence exists
  // at all," so a company with $4.8M ARR from 37 paying customers scored
  // identically to one with a single unpaid pilot -- both just cleared
  // the same yes/no bar. lifecycleConfidenceBoost adds a further,
  // stage-proportional step on top of that same base boost: none for
  // idea stage, modest for MVP/pilot, and the largest step for
  // revenue/growth stage, where paying customers are categorically
  // stronger evidence than a prototype or a pilot.
  const lifecycleStage = model.inputs.lifecycleStage;
  const evidenceAdjustment = validationEvidence
    ? 0.08 + lifecycleConfidenceBoost(lifecycleStage)
    : d2cFoodOrFmcg
      ? -0.18
      : -0.08;
  const executionComplexityAdjustment = d2cFoodOrFmcg ? -0.1 : 0;
  const defensibilitySignals = hasAny(normalizedPrompt, [
    /\b(proprietary|patent|data moat|network effect|regulated|compliance|brand|luxury|enterprise)\b/,
  ]);
  // TASK #69A-27 -- ROOT CAUSE FIX (#69A-26 P0 finding, Case F: a
  // controlled fixture explicitly stating the founder has "never
  // operated a company... no technical background... no domain
  // expertise whatsoever" still produced a Founder Evidence score of
  // 94/100). ROOT CAUSE: founderSignals was a bare keyword-presence
  // check with NO negation awareness at all -- unlike
  // hasValidationEvidence in this same file, already fixed for the
  // identical class of bug -- so the negated sentence's own
  // "founder"/"domain"/"expert"-adjacent words still made it evaluate
  // true. Fixed with the same window-based negation-stripping
  // technique already established here and in financial-model.ts,
  // PLUS a separate, higher-priority explicit-inexperience check: a
  // genuine disclosure that the founder/team lacks relevant experience
  // must dominate outright, never be diluted by an unrelated positive
  // mention elsewhere in the same prompt -- the same "a blocker must
  // not be averaged away" principle applied at signal-detection level,
  // not just at the final aggregate.
  const negatedFounderSignalPattern =
    /\b(?:no|not|zero|without|never|lack(?:s|ing)?(?: of)?|inexperienced|first-time)\b[^.!?]{0,40}?\b(?:founder|team|operator|doctor|engineer|expert|experienced|domain|background)\b/gi;
  const explicitFounderInexperiencePattern =
    /\b(?:no founder|no team|founders? (?:has|have) never|team (?:has|have) never|never (?:operated|run|built|led|managed) a company|no (?:domain|industry|technical|relevant|prior) (?:expertise|experience|background)|lacks? (?:any )?(?:domain|industry|technical|relevant|founder|team) experience|no domain expertise|no technical background|no relevant experience|inexperienced founder)\b/i;
  const founderClaimText = normalizedPrompt.replace(negatedFounderSignalPattern, " ");
  const founderSignals = hasAny(founderClaimText, [
    /\b(founder|team|operator|doctor|engineer|expert|experienced|domain)\b/,
  ]);
  const explicitFounderInexperience = explicitFounderInexperiencePattern.test(normalizedPrompt);
  const recurringRevenue =
    model.inputs.businessModel.includes("subscription") ||
    model.inputs.pricingModel.includes("subscription") ||
    model.inputs.pricingModel.includes("membership");
  const metricConfidenceScore = normalizeHigherBetter(
    average(Object.values(metrics).map((metric) => confidenceValue(metric.confidence))),
    45,
    85
  );
  const ideaQualityScore = clamp(
    average([
      normalizeHigherBetter(metrics.sam.value, 50_000_000, 2_500_000_000),
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
      recurringRevenue ? (d2cFoodOrFmcg ? 0.66 : 0.78) : 0.6,
      normalizeHigherBetter(ranges.revenueMultiple.high, 3, 16),
    ]),
    d2cFoodOrFmcg ? 0.7 : 0.66,
    0.88
  );
  // Same lifecycle gradation as evidenceAdjustment above, applied to the
  // two figures that most directly answer "how much do we trust this
  // company's own evidence": Validation Confidence and Founder/Evidence
  // Confidence. Base 0.60 keeps the previous flat 0.68 as roughly the
  // pilot-stage anchor (0.60 + 0.08 lifecycle boost), while revenue/
  // growth stage push meaningfully higher, matching REVENUE_STAGE's
  // "significantly increase evidence confidence" requirement.
  const validationLevelScore = validationEvidence
    ? clamp(0.6 + lifecycleConfidenceBoost(lifecycleStage), 0, 0.95)
    : d2cFoodOrFmcg
      ? 0.42
      : 0.45;
  // Full lifecycle boost weight (not dampened), matching
  // validationLevelScore -- a $4M+ ARR, production, paying-enterprise-
  // customer company must not land anywhere near a pre-revenue idea's
  // Evidence Confidence, and a partial weight left too small a gap here
  // specifically (confirmed live: 34% vs 49%, still readable as "similar"
  // even though every other lifecycle-graded figure showed a clear gap).
  const founderEvidenceScore = clamp(
    explicitFounderInexperience
      ? 0.12
      : (founderSignals ? 0.72 : 0.34) + lifecycleConfidenceBoost(lifecycleStage),
    0,
    0.95
  );
  // TASK #69A-27 -- de-collapse "Evidence Confidence" from "Founder
  // Evidence" (#69A-26 P1 finding: both dimensions read the exact same
  // founderEvidenceScore variable, so they could never disagree with
  // each other despite representing different concepts -- founder/team
  // capability specifically, versus how much real evidence backs the
  // report's numbers overall). Evidence Confidence now reflects two
  // already-independent, non-founder-specific signals -- average
  // metric confidence across every financial metric, and whether
  // genuine (non-projected -- see hasValidationEvidence's own #69A-27
  // fix) validation evidence exists in the prompt at all -- so it can
  // no longer be identical to Founder Evidence by construction, and a
  // founder-inexperience disclosure no longer silently drags down a
  // dimension that has nothing to do with founder capability.
  //
  // TASK #69A-51 -- ROOT CAUSE FIX (unit-conversion bug, found while
  // auditing this exact dimension for low-evidence inflation):
  // metricConfidenceScore (above) is already a normalizeHigherBetter
  // result -- a 0-1 FRACTION, exactly like every other *Score variable
  // in this file (ideaQualityScore, founderEvidenceScore, ...), never a
  // 0-100 percentage. Dividing it by 100 here treated it as if it were
  // already a percentage, crushing a genuinely perfect metric-confidence
  // signal (1.0, i.e. every financial metric derived with "High"
  // confidence) down to 0.01 before averaging -- silently making it
  // almost impossible for real, strong metric confidence to ever raise
  // Evidence Confidence, regardless of how well-evidenced the report
  // actually was. Confirmed live: a fixture with 900 paying enterprise
  // customers, validated CAC/payback, and every financial metric at
  // "High" confidence still scored Evidence Confidence at 47/100 --
  // explained exactly by this bug (average([0.01, ~0.93]) ~= 0.47), not
  // by any real evidence weakness. This bug predates #69A-51 and was
  // previously invisible because evidenceConfidenceScore was never part
  // of the headline Founder Readiness aggregate (see teamFounder's own
  // construction below) -- #69A-51's own fix (correctly including it)
  // is what surfaced this bug's real impact for the first time, so
  // fixing it here is required for that fix to behave correctly.
  const evidenceConfidenceScore = clamp(
    average([
      metricConfidenceScore,
      validationEvidence
        ? clamp(0.7 + lifecycleConfidenceBoost(lifecycleStage), 0, 0.95)
        : 0.35,
    ]),
    0,
    0.95
  );
  const executionBaselineEase = capitalHeavy ? 0.42 : d2cFoodOrFmcg ? 0.5 : 0.66;
  const matchedExecutionBurdenCategories = detectExecutionBurdenCategories(normalizedPrompt);
  const executionComplexityScore = clamp(
    executionBaselineEase - matchedExecutionBurdenCategories.length * EXECUTION_BURDEN_CATEGORY_PENALTY,
    EXECUTION_READINESS_FLOOR,
    executionBaselineEase
  );
  const executionBurdenSummary =
    matchedExecutionBurdenCategories.length > 0
      ? matchedExecutionBurdenCategories.map((key) => EXECUTION_BURDEN_CATEGORY_DESCRIPTIONS[key]).join("; ")
      : "no specific integration, technical, regulatory, or distribution burden identified in the submitted information";

  const marketOpportunity = makeCategory({
    key: "marketOpportunity",
    label: "Market Opportunity",
    normalizedScore: average([
      normalizeHigherBetter(metrics.sam.value, 50_000_000, 2_500_000_000),
      normalizeHigherBetter(metrics.som.value, 1_000_000, 80_000_000),
      normalizeHigherBetter(metrics.revenueGrowth.value, ranges.arrGrowth.low, ranges.arrGrowth.high),
      recurringRevenue ? 0.68 : 0.58,
    ]),
    explanation: `${model.inputs.industry} opportunity is supported by reachable demand, obtainable market wedge, and benchmark growth potential.`,
    reasoning: [
      `SAM: ${metrics.sam.displayValue}`,
      `SOM: ${metrics.som.displayValue}`,
      `Revenue growth benchmark: ${metrics.revenueGrowth.benchmarkComparison}`,
      `Input specificity multiplier: ${Math.round(specificity * 100)}%`,
    ],
  });

  const competitiveAdvantage = makeCategory({
    key: "competitiveAdvantage",
    label: "Competitive Advantage",
    normalizedScore: average([
      defensibilitySignals ? 0.78 : 0.48,
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
      normalizeHigherBetter(ranges.revenueMultiple.high, 3, 16),
      capitalHeavy ? 0.58 : d2cFoodOrFmcg ? 0.5 : 0.66,
      clamp(0.58 + evidenceAdjustment, 0.3, 0.8),
    ]),
    explanation: defensibilitySignals
      ? "The idea includes defensibility signals, but the advantage still depends on margin quality and proof of a durable wedge."
      : "Defensibility is only partially evidenced; competitive advantage needs stronger moat proof.",
    reasoning: [
      `Defensibility signals detected: ${defensibilitySignals ? "yes" : "no"}`,
      `Gross margin: ${metrics.grossMargin.displayValue}`,
      `Revenue multiple benchmark: ${ranges.revenueMultiple.low}x-${ranges.revenueMultiple.high}x`,
      `Capital intensity adjustment: ${capitalHeavy ? "negative" : "neutral"}`,
    ],
  });

  const businessModel = makeCategory({
    key: "businessModel",
    label: "Business Model",
    normalizedScore: average([
      recurringRevenue ? (d2cFoodOrFmcg ? 0.64 : 0.8) : 0.58,
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
      normalizeLowerBetter(metrics.cacPayback.value, ranges.cacPayback.low, ranges.cacPayback.high),
      normalizeHigherBetter(metrics.ltv.value / Math.max(1, metrics.cac.value), 2, 6),
      clamp(0.58 + evidenceAdjustment, 0.3, 0.82),
    ]),
    explanation: `Business-model quality reflects the pricing model, gross margin discipline, payback path, and repeat purchase or retention potential.`,
    reasoning: [
      `Pricing model: ${model.inputs.pricingModel}`,
      `Gross margin: ${metrics.grossMargin.displayValue}`,
      `CAC payback: ${metrics.cacPayback.displayValue}`,
      `LTV/CAC: ${(metrics.ltv.value / Math.max(1, metrics.cac.value)).toFixed(1)}x`,
    ],
  });

  const financialHealth = makeCategory({
    key: "financialHealth",
    label: "Financial Health",
    normalizedScore: average([
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
      normalizeHigherBetter(metrics.ebitda.value / Math.max(1, metrics.arr.value), ranges.ebitdaMargin.low, ranges.ebitdaMargin.high),
      normalizeHigherBetter(metrics.runway.value, 9, 24),
      normalizeLowerBetter(metrics.breakEvenMonth.value, 12, 48),
      clamp(0.55 + evidenceAdjustment, 0.28, 0.78),
    ]),
    explanation: `Financial health is based on margin, EBITDA profile, runway (${metrics.runway.displayValue}), and break-even timing (${metrics.breakEvenMonth.displayValue}).`,
    reasoning: [
      `EBITDA: ${metrics.ebitda.displayValue}`,
      `Runway: ${metrics.runway.displayValue}`,
      `Break-even: ${metrics.breakEvenMonth.displayValue}`,
      `Gross margin benchmark: ${metrics.grossMargin.benchmarkComparison}`,
    ],
  });

  const scalability = makeCategory({
    key: "scalability",
    label: "Scalability",
    normalizedScore: average([
      normalizeHigherBetter(metrics.revenueGrowth.value, ranges.arrGrowth.low, ranges.arrGrowth.high),
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
      normalizeHigherBetter(metrics.arr.value, 500_000, 15_000_000),
      capitalHeavy ? 0.46 : d2cFoodOrFmcg ? 0.52 : 0.72,
      clamp(0.55 + evidenceAdjustment + executionComplexityAdjustment, 0.25, 0.78),
    ]),
    explanation: `Scalability reflects growth potential, margin structure, Year-1 revenue potential, and capital intensity.`,
    reasoning: [
      `Revenue growth: ${metrics.revenueGrowth.displayValue}`,
      `Year-1 ARR: ${metrics.arr.displayValue}`,
      `Gross margin: ${metrics.grossMargin.displayValue}`,
      `Capital-heavy model: ${capitalHeavy ? "yes" : "no"}`,
    ],
  });

  // TASK #69A-51 -- ROOT CAUSE FIX. Confirmed live and by direct,
  // reproducible test: this average used to silently EXCLUDE two of the
  // 7 dimensions its own reasoning text (below) already claims to
  // describe -- businessModelQuality and evidenceConfidenceScore --
  // while including a 6th term, Math.max(metricConfidenceScore, 0.55),
  // that is never displayed as a Founder Readiness dimension at all and
  // is artificially FLOORED at 55%, so it could never pull the aggregate
  // down no matter how weak real metric confidence actually was. Net
  // effect: "Evidence Confidence" (how much genuine evidence backs this
  // analysis) had ZERO weight in the headline "Founder Readiness Score"
  // a reader sees directly above it, and a hidden, artificially-propped
  // term filled its place instead -- exactly the "low-evidence
  // inflation" this ticket exists to close. Reproduced live: a fixture
  // with Evidence Confidence=18/Founder Evidence=34/Validation
  // Confidence=45 (all weak, genuine directional/unvalidated evidence)
  // still produced a Founder Readiness Score of 60/100, mathematically
  // explained by metricConfidenceScore's own floor plus the excluded
  // dimensions, not by any real founder/customer proof.
  //
  // FIX: the average now includes EXACTLY the same 7 sub-signals already
  // displayed as this report's own Founder Readiness dimensions --
  // ideaQualityScore is counted twice because it legitimately backs TWO
  // displayed dimensions (Idea Quality and Market Attractiveness,
  // #69A-17's own established design, unchanged) -- so every displayed
  // number the user actually sees has equal, direct influence on the
  // headline score, and no hidden, undisplayed, artificially-floored
  // term can prop it up. metricConfidenceScore is not deleted: it
  // remains part of evidenceConfidenceScore's own, unfloored formula
  // (see that variable's definition above), so its real signal still
  // reaches the aggregate through its rightful, displayed channel
  // instead of a shadow duplicate.
  // TASK #69A-52 -- ROOT CAUSE FIX. Audited whether Evidence Confidence
  // literally reads external market-research-coverage fields: it does
  // not -- evidenceConfidenceScore (above) is built entirely from
  // metricConfidenceScore (the financial model's OWN "High"/"Medium"/
  // "Low" derivation-confidence tags, assigned at prompt-time, long
  // before any research evidence exists -- confirmed in #69A-50's own
  // trace: financialModel/metrics are never touched by
  // applyMarketResearchCoverageToContext) and hasValidationEvidence's
  // prompt-keyword check -- neither one is "external research evidence"
  // in the sense of government/vendor/market/competitor sources.
  //
  // The REAL defect this ticket's own report exposes is narrower but
  // just as real: metricConfidenceScore reads as "the model's own
  // derivation is standard/well-formed" -- a signal that is HIGH for
  // almost any benchmark-driven business plan regardless of whether the
  // founder has proven anything -- so evidenceConfidenceScore (and,
  // through it, this category's aggregate) can read comfortably high
  // even when the two genuinely founder/validation-specific dimensions
  // (founderEvidenceScore, validationLevelScore) are weak. Averaging all
  // 7 displayed dimensions with equal weight (#69A-51's own fix) still
  // lets 5 more optimistic dimensions dilute -- "average away" -- the 2
  // that actually answer "is this founder/team ready, based on
  // founder-specific and primary-validation evidence." Confirmed live:
  // Founder Evidence=34/Validation Confidence=45 (both genuinely weak)
  // coexisted with a 60/100 headline score.
  //
  // FIX: founderValidationCeiling is a NON-COMPENSATORY cap, not a
  // reweighting -- opportunity quality, business model, execution ease,
  // and evidence confidence may never lift the aggregate ABOVE what
  // founder-specific + primary-validation evidence alone can support
  // (plus a fixed headroom margin, reusing FATAL_BLOCKER_SCORE_RATIO's
  // own established 15%-margin convention rather than inventing a new
  // constant). Uses Math.min, not an average, of founderEvidenceScore
  // and validationLevelScore: EACH must independently support the
  // ceiling -- a strong validation signal must never "rescue" weak
  // founder evidence by averaging with it (or vice versa), which is
  // exactly what an average-based ceiling would still allow, one level
  // removed from the original defect. A genuinely strong founder AND
  // validation case (e.g. #69A-51's own STRONG_LOGISTICS fixture, both
  // dimensions 70+) is never constrained by this cap; a case where
  // EITHER is weak is, regardless of how strong every other dimension
  // reads. Individual dimensionScores (Idea Quality, Evidence
  // Confidence, ...) are completely unaffected -- only the AGGREGATE is
  // capped, so Confidence Radar/Report Quality/every other displayed
  // number stays exactly as its own formula computes it.
  // MIN, not average: founderEvidenceScore and validationLevelScore must
  // EACH independently constrain the ceiling -- a strong validation
  // signal must never "rescue" catastrophically weak founder evidence
  // (or vice versa) by averaging with it. Confirmed live: an average-
  // based ceiling let a fixture with founderEvidenceScore=0.12 (explicit
  // founder inexperience) but strong, validated CAC/payback evidence
  // keep a ~62% ceiling -- exactly the "one weak dimension gets
  // averaged away by a strong sibling" failure mode this ticket exists
  // to close, one level removed. min() guarantees either dimension
  // alone gates the ceiling; both must be genuinely strong for it to be
  // generous.
  const founderValidationCeiling = clamp(
    Math.min(founderEvidenceScore, validationLevelScore) + FATAL_BLOCKER_SCORE_RATIO,
    0,
    0.95
  );
  const teamFounderRawAverage = average([
    ideaQualityScore,
    ideaQualityScore,
    businessModel.score / businessModel.maximumScore,
    validationLevelScore,
    executionComplexityScore,
    evidenceConfidenceScore,
    founderEvidenceScore,
  ]);
  const teamFounder = makeCategory({
    key: "teamFounder",
    label: "Team / Founder",
    normalizedScore: Math.min(teamFounderRawAverage, founderValidationCeiling),
    explanation:
      "Founder readiness separates the quality of the opportunity from the current level of validation and founder-specific evidence.",
    reasoning: [
      `Market attractiveness: ${Math.round(ideaQualityScore * 100)}%`,
      `Business model quality: ${Math.round((businessModel.score / businessModel.maximumScore) * 100)}%`,
      `Validation confidence: ${Math.round(validationLevelScore * 100)}%`,
      `Execution complexity: ${Math.round(executionComplexityScore * 100)}%`,
      // TASK #69A-54 -- a NEW, dedicated line (never replacing the
      // "Execution complexity: NN%" line above, which #69A-47's own
      // cross-file extraction in market-research-coverage.ts still
      // matches by exact label text) carrying the SAME evidence the
      // score above was computed from, so plan-executor.ts's
      // buildCanonicalFounderScore can build its explanation from this
      // canonical data instead of independently re-scanning the prompt
      // with a second, potentially-drifting detector.
      `Execution readiness factors: ${executionBurdenSummary}`,
      // TASK #69A-27 -- kept in sync with the de-collapsed
      // evidenceConfidence/founderEvidence dimensionScores entries
      // below: this reasoning line must report the SAME variable each
      // dimension's own structured score reads, never a stale
      // duplicate of the other dimension's value.
      `Evidence confidence: ${Math.round(evidenceConfidenceScore * 100)}%`,
      `Founder evidence: ${Math.round(founderEvidenceScore * 100)}%`,
      `Founder or domain signals detected: ${founderSignals ? "yes" : "no"}`,
      `Validation evidence detected: ${validationEvidence ? "yes" : "no"}`,
    ],
  });

  // TASK #69A-17 -- ROOT CAUSE FIX. Confirmed live: the Founder Readiness
  // dimension CARDS and the explanatory TEXT below them showed different
  // numbers for the same dimension. Both ultimately trace back to this
  // SAME teamFounder.reasoning string array above, but through TWO
  // independently-written regex extractors -- plan-executor.ts's
  // buildCanonicalFounderScore (an un-anchored search over the array
  // joined with " | ") and report-presentation.ts's
  // readFounderReasoningScore (a per-line, start-anchored search) --
  // that have no structural guarantee of ever agreeing, since they are
  // two separate implementations parsing the same prose independently.
  // This array is the SAME six values as the `reasoning` strings above,
  // computed from the SAME source variables, but as genuinely structured
  // {key, label, score} entries requiring zero regex to read. Every
  // downstream consumer (buildCanonicalFounderScore's own text
  // generation, AND every renderer's card/explanation lookup via
  // report-presentation.ts) now reads THIS array first, so the
  // generated text and the structured score can never diverge again --
  // they are the same number, read once. "Idea Quality" is intentionally
  // NOT its own key here: it has no independent underlying dimension in
  // this engine (by design -- see report-presentation.ts's own comment
  // on FOUNDER_READINESS_DIMENSIONS) and is instead the exact same value
  // as Market Attractiveness, unchanged from the pre-existing behavior.
  const founderReadinessDimensionScores: FounderReadinessDimensionScoreEntry[] = [
    { key: "ideaQuality", label: "Idea Quality", score: roundScore(ideaQualityScore * 100) },
    { key: "marketAttractiveness", label: "Market Attractiveness", score: roundScore(ideaQualityScore * 100) },
    {
      key: "businessModelQuality",
      label: "Business Model Quality",
      score: roundScore((businessModel.score / businessModel.maximumScore) * 100),
    },
    { key: "validationConfidence", label: "Validation Confidence", score: roundScore(validationLevelScore * 100) },
    // TASK #69A-53 -- label corrected to "Execution Readiness" (this
    // .label field is not itself read by any renderer -- report-
    // presentation.ts's FOUNDER_READINESS_DIMENSIONS is the real,
    // canonical display-label source -- but keeping it accurate avoids
    // a stale, wrong-direction label sitting in this structured data).
    { key: "executionComplexity", label: "Execution Readiness", score: roundScore(executionComplexityScore * 100) },
    { key: "evidenceConfidence", label: "Evidence Confidence", score: roundScore(evidenceConfidenceScore * 100) },
    { key: "founderEvidence", label: "Founder Evidence", score: roundScore(founderEvidenceScore * 100) },
  ];

  const capitalEfficiency = makeCategory({
    key: "capitalEfficiency",
    label: "Capital Efficiency",
    normalizedScore: average([
      normalizeLowerBetter(metrics.investmentNeeded.value / Math.max(1, metrics.arr.value), 1, 8),
      normalizeLowerBetter(metrics.cacPayback.value, ranges.cacPayback.low, ranges.cacPayback.high),
      normalizeHigherBetter(metrics.roi.value, -0.5, 2),
      capitalHeavy ? 0.42 : d2cFoodOrFmcg ? 0.5 : 0.72,
      clamp(0.54 + evidenceAdjustment, 0.26, 0.78),
    ]),
    explanation: `Capital efficiency reflects investment need, payback discipline, three-year return potential, and capital intensity.`,
    reasoning: [
      `Investment needed: ${metrics.investmentNeeded.displayValue}`,
      `ARR: ${metrics.arr.displayValue}`,
      `CAC payback: ${metrics.cacPayback.displayValue}`,
      `ROI: ${metrics.roi.displayValue}`,
    ],
  });

  const executionRisk = makeCategory({
    key: "executionRisk",
    label: "Execution Risk",
    normalizedScore: average([
      normalizeLowerBetter(metrics.cacPayback.value, ranges.cacPayback.low, ranges.cacPayback.high),
      normalizeLowerBetter(metrics.breakEvenMonth.value, 12, 48),
      normalizeHigherBetter(average(Object.values(metrics).map((metric) => confidenceValue(metric.confidence))), 45, 85),
      capitalHeavy ? 0.38 : d2cFoodOrFmcg ? 0.46 : 0.7,
      validationEvidence ? 0.62 : 0.34,
    ]),
    explanation: `Execution risk is healthier when payback and break-even timing are realistic, confidence is stronger, validation evidence exists, and the model is less operationally complex.`,
    reasoning: [
      `CAC payback: ${metrics.cacPayback.displayValue}`,
      `Break-even: ${metrics.breakEvenMonth.displayValue}`,
      `Average metric confidence: ${Math.round(average(Object.values(metrics).map((metric) => confidenceValue(metric.confidence))))}%`,
      `Validation evidence detected: ${validationEvidence ? "yes" : "no"}`,
      `Operating complexity: ${capitalHeavy || d2cFoodOrFmcg ? "elevated" : "moderate"}`,
    ],
  });

  const categoryList = [
    marketOpportunity,
    competitiveAdvantage,
    businessModel,
    financialHealth,
    scalability,
    teamFounder,
    capitalEfficiency,
    executionRisk,
  ];
  const totalScore = roundScore(
    categoryList.reduce((sum, category) => sum + category.score, 0)
  );
  // CRITICAL SCORING ENGINE FIX -- this term used to be a flat 70 for
  // "any validation evidence exists," diluted further by three other
  // averaged terms unrelated to lifecycle stage (metric confidence,
  // founder/defensibility keyword presence). A company with verified
  // paying customers must score meaningfully more confident than one
  // with an unpaid pilot, so this term now scales directly and
  // monotonically with lifecycle stage.
  const confidence = roundScore(
    average([
      average(Object.values(metrics).map((metric) => confidenceValue(metric.confidence))),
      clamp(specificity + evidenceAdjustment, 0.28, 1) * 100,
      founderSignals ? 72 : 58,
      defensibilitySignals ? 72 : 58,
      validationEvidence
        ? clamp(70 + lifecycleConfidenceBoost(lifecycleStage) * 100, 70, 100)
        : d2cFoodOrFmcg
          ? 38
          : 48,
    ])
  );
  // TASK #69A-27 -- fatal blockers checked against the already-computed
  // Founder Readiness dimensions (defined above, in scope here) and
  // applied as a narrow override on top of the existing pure aggregate
  // gate -- see applyFatalBlockerOverride's own doc comment.
  const fatalBlockers = detectFatalBlockers(founderReadinessDimensionScores);
  const recommendation = applyFatalBlockerOverride(
    createRecommendation(totalScore, confidence),
    fatalBlockers
  );
  const technologyScore = makeCategory({
    key: "competitiveAdvantage",
    label: "Technology Score",
    normalizedScore: average([
      hasAny(normalizedPrompt, [/\b(ai|software|automation|cybersecurity|drone|uav|ev|battery|platform)\b/])
        ? 0.76
        : 0.48,
      defensibilitySignals ? 0.74 : 0.5,
      normalizeHigherBetter(metrics.grossMargin.value, ranges.grossMargin.low, ranges.grossMargin.high),
    ]),
    explanation: "Technology leverage reflects technical intensity, defensibility signals, and margin expansion potential.",
    reasoning: [
      `Technical signals detected: ${
        hasAny(normalizedPrompt, [/\b(ai|software|automation|cybersecurity|drone|uav|ev|battery|platform)\b/])
          ? "yes"
          : "no"
      }`,
      `Defensibility signals detected: ${defensibilitySignals ? "yes" : "no"}`,
      `Gross margin: ${metrics.grossMargin.displayValue}`,
    ],
  });
  const decisionEngine = {
    marketScore: {
      ...marketOpportunity,
      key: "marketOpportunity" as const,
      label: "Market Score",
      score: roundScore((marketOpportunity.score / marketOpportunity.maximumScore) * 100),
      maximumScore: 100,
    },
    financialScore: {
      ...financialHealth,
      key: "financialHealth" as const,
      label: "Financial Score",
      score: roundScore((financialHealth.score / financialHealth.maximumScore) * 100),
      maximumScore: 100,
    },
    founderScore: {
      ...teamFounder,
      key: "teamFounder" as const,
      label: "Founder Score",
      score: roundScore((teamFounder.score / teamFounder.maximumScore) * 100),
      maximumScore: 100,
      dimensionScores: founderReadinessDimensionScores,
    },
    executionScore: {
      ...executionRisk,
      key: "executionRisk" as const,
      label: "Execution Score",
      score: roundScore((executionRisk.score / executionRisk.maximumScore) * 100),
      maximumScore: 100,
    },
    riskScore: {
      ...executionRisk,
      key: "executionRisk" as const,
      label: "Risk Score",
      score: roundScore((executionRisk.score / executionRisk.maximumScore) * 100),
      maximumScore: 100,
    },
    competitionScore: {
      ...competitiveAdvantage,
      key: "competitiveAdvantage" as const,
      label: "Competition Score",
      score: roundScore((competitiveAdvantage.score / competitiveAdvantage.maximumScore) * 100),
      maximumScore: 100,
    },
    technologyScore: {
      ...technologyScore,
      score: roundScore((technologyScore.score / technologyScore.maximumScore) * 100),
      maximumScore: 100,
    },
  };

  return {
    version: "investment_score_engine_v1",
    fingerprint: hashValue(
      JSON.stringify({
        version: "investment_score_engine_v1",
        prompt: normalizedPrompt,
        financialModelFingerprint: model.fingerprint,
        totalScore,
        confidence,
      })
    ).slice(0, 16),
    totalScore,
    confidence,
    recommendation,
    fatalBlockers,
    estimatedValuation: createEstimatedValuation(model),
    fundingStage: createFundingStage(model),
    nextCriticalAction: createNextCriticalAction(model, recommendation),
    strengths: createStrengths(categoryList, model),
    weaknesses: createWeaknesses(categoryList, model),
    topRisks: createTopRisks(model, categoryList),
    categories: {
      marketOpportunity,
      competitiveAdvantage,
      businessModel,
      financialHealth,
      scalability,
      teamFounder,
      capitalEfficiency,
      executionRisk,
    },
    decisionEngine,
  };
}

const categoryKeyByDecisionEngineKey = {
  marketScore: "marketOpportunity",
  competitionScore: "competitiveAdvantage",
  financialScore: "financialHealth",
  executionScore: "executionRisk",
  founderScore: "teamFounder",
} as const satisfies Partial<
  Record<keyof InvestmentScore["decisionEngine"], InvestmentScoreCategoryKey>
>;

// applyMarketResearchCoverageToContext (market-research-coverage.ts) already
// rescores decisionEngine's 5 research-backed categories with real evidence
// (coverage %, competitor breadth, verified market-size, etc.) once domain
// research resolves -- but score.categories/strengths/weaknesses/topRisks,
// which is what the Executive Summary decision layer and the SWOT fallback
// bullets actually read, stayed frozen at the pre-research, keyword-matched
// version. This propagates the same real evidence into categories and
// re-derives strengths/weaknesses/topRisks from it, so the report's
// decision narrative reflects the same evidence that already updated its
// own confidence number.
export function refreshInvestmentNarrativeFromResearchCoverage(
  score: InvestmentScore,
  model: FinancialModel
): Pick<InvestmentScore, "categories" | "strengths" | "weaknesses" | "topRisks"> {
  const categories = { ...score.categories };

  for (const [decisionEngineKey, categoryKey] of Object.entries(categoryKeyByDecisionEngineKey) as [
    keyof typeof categoryKeyByDecisionEngineKey,
    InvestmentScoreCategoryKey,
  ][]) {
    const decisionCategory = score.decisionEngine[decisionEngineKey];
    const baseCategory = categories[categoryKey];

    if (!decisionCategory || !baseCategory) continue;

    categories[categoryKey] = {
      ...baseCategory,
      score: Math.round(
        (decisionCategory.score / decisionCategory.maximumScore) * baseCategory.maximumScore
      ),
      explanation: decisionCategory.reasoning.length
        ? decisionCategory.reasoning.join("; ")
        : baseCategory.explanation,
      reasoning: decisionCategory.reasoning,
    };
  }

  const categoryList = Object.values(categories);

  return {
    categories,
    strengths: createStrengths(categoryList, model),
    weaknesses: createWeaknesses(categoryList, model),
    topRisks: createTopRisks(model, categoryList),
  };
}

export function formatInvestmentScore(score: InvestmentScore) {
  const categoryRows = Object.values(score.categories)
    .map(
      (category) =>
        `- ${category.label}: ${roundScore((category.score / category.maximumScore) * 100)}/100. ${category.explanation}`
    )
    .join("\n");
  const strengths = score.strengths.map((strength) => `- ${strength}`).join("\n");
  const weaknesses = score.weaknesses.map((weakness) => `- ${weakness}`).join("\n");
  const risks = score.topRisks.map((risk) => `- ${risk}`).join("\n");
  const decisionRows = Object.values(score.decisionEngine)
    .map(
      (category) =>
        `- ${category.label}: ${roundScore((category.score / category.maximumScore) * 100)}/100. ${category.explanation}`
    )
    .join("\n");

  return `Investment Decision Inputs
Total Investment Score: ${score.totalScore}/100
Decision Confidence: ${score.confidence}%
Recommendation: ${createVisibleRecommendation(score.recommendation, score.confidence)}
Estimated Valuation: ${score.estimatedValuation}
Funding Stage: ${score.fundingStage}
Next Critical Action: ${score.nextCriticalAction}

Score dimensions:
${categoryRows}

Decision factors:
${decisionRows}

Strengths:
${strengths}

Weaknesses:
${weaknesses}

Top Risks:
${risks}`;
}
