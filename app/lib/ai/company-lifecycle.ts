// CRITICAL SCORING ENGINE FIX -- company lifecycle awareness.
//
// Confirmed live: a company reporting "37 paying enterprise customers,
// $4.8M ARR, 82% gross margin, production stage" received the same
// confidence/evidence/KPI/roadmap treatment as a zero-revenue idea --
// every downstream consumer (investment-score.ts's validation-evidence
// boost, market-research-coverage.ts's founder/execution readiness,
// plan-executor.ts's KPI Dashboard and Roadmap builders) only ever asked
// a single boolean question ("does ANY validation evidence exist?"),
// never how far along the company actually is. This module answers that
// second question once, from the same verified facts already extracted
// elsewhere (see financial-model.ts's extractUserStatedFinancials), so
// every consumer reads the same classification instead of re-deriving
// its own inconsistent notion of "early" vs "mature."

export type CompanyLifecycleStage = "idea" | "mvp" | "pilot" | "revenue" | "growth";

export type CompanyLifecycleFinancialSignals = {
  mrr: number | null;
  arr: number | null;
  customers: number | null;
};

// Same negation vocabulary already established in financial-model.ts
// (negatedEvidenceClaimPattern) and investment-score.ts's own copy --
// applied here so "no MVP yet" / "haven't launched a pilot" never
// mis-classifies a pre-product idea as further along than it is.
const negatedStageClaimPattern =
  /\b(?:no|not|zero|without|never (?:had|have|has)|don'?t have|doesn'?t have|do not have|does not have|haven'?t(?:\s+(?:got|had|launched|built|run))?|have not(?:\s+(?:got|had|launched|built|run))?|hasn'?t(?:\s+(?:got|had|launched|built|run))?|has not(?:\s+(?:got|had|launched|built|run))?|not yet|pre[-\s]?)\s+(?:\w+\s+){0,3}?(mvp|prototype|beta|product|pilot|pilots|customers?|loi|letters? of intent|production|launched)\b/gi;

const productSignalPattern = /\b(mvp|minimum viable product|prototype|working prototype|beta|proof of concept|\bpoc\b)\b/i;
const pilotSignalPattern = /\b(pilot|pilots|loi|letters? of intent|design partners?|pilot partners?|pilot customers?|early access)\b/i;
const productionSignalPattern = /\b(production|live in production|generally available|\bga\b|shipped to customers|deployed to production)\b/i;
// Explicit growth/expansion intent (a stated goal, not a product feature
// mention) -- combined with any real revenue, this is what separates
// GROWTH_STAGE ("significant ARR, multiple enterprise customers,
// expansion plans") from plain REVENUE_STAGE.
const expansionSignalPattern =
  /\b(expand|expansion|scale|scaling|international(?:ly)?|multiple countries|new markets?|enter (?:the\s+)?(?:us|u\.s\.|uk|u\.k\.|europe|asia|new market))\b/i;

// "Significant ARR" per the GROWTH_STAGE spec -- a round, defensible
// threshold rather than a precise cutoff, since the requirement gives no
// exact number. $1M ARR is the conventional Series A-readiness marker
// used throughout this codebase's own benchmark tables (see
// industry-benchmarks.ts fundingStage logic), reused here for
// consistency rather than inventing a new threshold.
const GROWTH_ARR_THRESHOLD = 1_000_000;

function stripNegatedStageClaims(prompt: string) {
  return prompt.replace(negatedStageClaimPattern, " ");
}

// Detects the company's lifecycle stage from the same verified financial
// facts (mrr/arr/customers -- see financial-model.ts's
// extractUserStatedFinancials) plus qualitative product-maturity language
// in the prompt. Financial signals take priority: a company with real
// paying customers is REVENUE_STAGE or GROWTH_STAGE regardless of how the
// product itself is described, because paying customers is the strongest,
// least ambiguous signal available.
export function detectCompanyLifecycleStage(
  prompt: string,
  signals: CompanyLifecycleFinancialSignals
): CompanyLifecycleStage {
  const hasRevenueSignal =
    (signals.customers ?? 0) > 0 || (signals.mrr ?? 0) > 0 || (signals.arr ?? 0) > 0;

  if (hasRevenueSignal) {
    const arr = signals.arr ?? (signals.mrr ? signals.mrr * 12 : 0);
    const hasExpansionIntent = expansionSignalPattern.test(prompt);
    const hasMultipleEnterpriseCustomers = (signals.customers ?? 0) >= 2;

    if (arr >= GROWTH_ARR_THRESHOLD || (hasExpansionIntent && hasMultipleEnterpriseCustomers)) {
      return "growth";
    }

    return "revenue";
  }

  const withoutNegatedClaims = stripNegatedStageClaims(prompt);

  if (pilotSignalPattern.test(withoutNegatedClaims)) {
    return "pilot";
  }

  if (productSignalPattern.test(withoutNegatedClaims) || productionSignalPattern.test(withoutNegatedClaims)) {
    return "mvp";
  }

  return "idea";
}

export function isRevenueOrGrowthStage(stage: CompanyLifecycleStage) {
  return stage === "revenue" || stage === "growth";
}

export function isPreRevenueStage(stage: CompanyLifecycleStage) {
  return stage === "idea" || stage === "mvp" || stage === "pilot";
}

const lifecycleStageLabels: Record<CompanyLifecycleStage, { en: string; tr: string }> = {
  idea: { en: "Idea Stage", tr: "Fikir Aşaması" },
  mvp: { en: "MVP Stage", tr: "MVP Aşaması" },
  pilot: { en: "Pilot Stage", tr: "Pilot Aşaması" },
  revenue: { en: "Revenue Stage", tr: "Gelir Aşaması" },
  growth: { en: "Growth Stage", tr: "Büyüme Aşaması" },
};

export function lifecycleStageLabel(stage: CompanyLifecycleStage, isTurkish = false) {
  return isTurkish ? lifecycleStageLabels[stage].tr : lifecycleStageLabels[stage].en;
}

// A single, deliberately small evidence-confidence boost per stage,
// applied ON TOP OF the existing hasValidationEvidence boolean boost
// (financial-model.ts/investment-score.ts keep that boolean gate
// unchanged -- it still separates "any evidence" from "none"). This
// layers gradation on top: idea gets nothing extra, mvp/pilot get a
// modest step, revenue/growth get the largest step, reflecting that
// verified paying customers is categorically stronger evidence than a
// pilot or a prototype. Values are normalized-score deltas (same 0-1
// scale already used throughout investment-score.ts), never large enough
// to single-handedly flip a GO/WAIT/PASS recommendation on their own.
export function lifecycleConfidenceBoost(stage: CompanyLifecycleStage): number {
  if (stage === "growth") return 0.22;
  if (stage === "revenue") return 0.16;
  if (stage === "pilot") return 0.08;
  if (stage === "mvp") return 0.04;

  return 0;
}

// Same shape, for the founder/execution-readiness dimension in
// market-research-coverage.ts's promptReadiness (0-100 scale there).
export function lifecycleReadinessBoost(stage: CompanyLifecycleStage): number {
  if (stage === "growth") return 30;
  if (stage === "revenue") return 22;
  if (stage === "pilot") return 12;
  if (stage === "mvp") return 6;

  return 0;
}
