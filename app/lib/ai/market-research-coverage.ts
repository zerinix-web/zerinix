import type { AiFinancialModelContext } from "@/app/lib/ai/financial-assumptions";
import type {
  DomainResearchBundle,
  DomainResearchEvidence,
} from "@/app/lib/ai/domain-research";

export type MarketSourceClass =
  | "government_statistics"
  | "financial_filing"
  | "company_primary"
  | "market_research"
  | "industry_association"
  | "credible_publication"
  | "other";

export type MarketResearchCoverage = {
  evidenceCount: number;
  verifiedSources: number;
  independentDomains: number;
  competitorBreadth: number;
  sourceTypeDiversity: number;
  claimCoverage: number;
  freshnessScore: number;
  averageQuality: number;
  verifiedMarketSizeAvailable: boolean;
  dimensions: {
    marketConfidence: number;
    competitiveEvidence: number;
    financialEvidence: number;
    productEvidence: number;
    executionReadiness: number;
    founderReadiness: number;
  };
  overallConfidence: number;
  sourceClasses: MarketSourceClass[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export type MarketConfidenceLevel = "High" | "Medium" | "Low";

export function classifyMarketConfidence(score: number): MarketConfidenceLevel {
  if (score >= 72) return "High";
  if (score >= 48) return "Medium";
  return "Low";
}

export function calculateEvidenceConfidence(
  item: Pick<
    DomainResearchEvidence,
    "confidence" | "qualityScore" | "label" | "url" | "sourceTitle"
  >
) {
  const base = item.qualityScore ?? item.confidence;
  const verifiedExternal =
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    Boolean(externalUrl(item.url)) &&
    Boolean(item.sourceTitle.trim());
  const provenanceAdjustment = verifiedExternal
    ? 8
    : item.label === "Estimate"
      ? -8
      : -18;
  return clamp(base + provenanceAdjustment);
}

export function calculateMarketOverallConfidence(
  dimensions: MarketResearchCoverage["dimensions"]
) {
  return clamp(
    dimensions.marketConfidence * 0.36 +
      dimensions.competitiveEvidence * 0.24 +
      dimensions.financialEvidence * 0.12 +
      dimensions.productEvidence * 0.12 +
      dimensions.executionReadiness * 0.08 +
      dimensions.founderReadiness * 0.08
  );
}

export function calculatePlanningEstimateConfidence(
  evidence: readonly Pick<
    DomainResearchEvidence,
    "confidence" | "qualityScore" | "label" | "url" | "sourceTitle"
  >[],
  assumptionOnly: boolean
) {
  if (assumptionOnly) return 24;
  if (!evidence.length) return 0;
  return clamp(
    average(evidence.map((item) => calculateEvidenceConfidence(item)))
  );
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function externalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedDomain(value: string) {
  return externalUrl(value)?.hostname.replace(/^www\./i, "").toLowerCase() || "";
}

function isVerifiedExternal(item: DomainResearchEvidence) {
  return (
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    Boolean(externalUrl(item.url)) &&
    Boolean(item.sourceTitle.trim())
  );
}

export function classifyMarketEvidenceSource(
  item: Pick<
    DomainResearchEvidence,
    "url" | "sourceTitle" | "publisher" | "sourceType" | "field"
  >
): MarketSourceClass {
  const domain = normalizedDomain(item.url);
  const identity = `${domain} ${item.sourceTitle} ${item.publisher} ${item.sourceType} ${item.field}`.toLowerCase();

  if (
    /(?:^|\.)(?:gov|mil)(?:\.|$)|\.gov\.[a-z]{2}$|europa\.eu$/.test(domain) ||
    /\b(?:census|bureau of labor statistics|official statistics|statistical office|central bank|regulator)\b/.test(identity)
  ) return "government_statistics";
  if (
    /\b(?:sec\.gov|10-k|10-q|annual report|financial[ _]filing|official[ _]filing|investor relations|audited statement)\b/.test(identity)
  ) return "financial_filing";
  if (
    /\b(?:official company|product page|pricing page|company website|company[ _]source)\b/.test(identity) ||
    /(?:pricing|products?|solutions?|features?)\//.test(externalUrl(item.url)?.pathname.toLowerCase() || "")
  ) return "company_primary";
  if (/\b(?:association|institute|foundation|council|alliance|society|professional[ _]standard)\b/.test(identity)) {
    return "industry_association";
  }
  if (/\b(?:market research|industry report|market data|research report|forecast)\b/.test(identity)) {
    return "market_research";
  }
  if (/\b(?:news|journal|review|times|reuters|bloomberg|forbes|technology|financial publication)\b/.test(identity)) {
    return "credible_publication";
  }
  return "other";
}

function freshness(item: DomainResearchEvidence) {
  if (!item.publishedDate) return 50;
  const published = Date.parse(item.publishedDate);
  if (!Number.isFinite(published)) return 45;
  const ageYears = Math.max(0, (Date.now() - published) / 31_556_952_000);
  if (ageYears <= 1) return 95;
  if (ageYears <= 3) return 78;
  if (ageYears <= 5) return 58;
  return 30;
}

function promptReadiness(prompt: string) {
  const normalized = prompt.toLowerCase();
  // Confirmed live: a prompt reporting "working prototype, two enterprise
  // design partners, no paid contracts yet" matched none of these
  // patterns -- "prototype"/"mvp"/"beta" have no entry at all, and
  // "design partners" narrowly missed pattern 3's "partnership" (singular
  // noun form, not "partner(s)"). Non-revenue validation evidence like a
  // working prototype or a design/pilot partner must positively affect
  // founder/execution readiness even though it correctly stays outside
  // hasValidationEvidence's stricter revenue/traction keyword set
  // (financial-model.ts, investment-score.ts) -- that distinction is what
  // keeps design partners from ever being counted as paid customers or
  // revenue.
  const founderSignals = [
    /\b(?:founder|cofounder|team|domain expertise|operator)\b/,
    /\b(?:pilot|customers?|revenue|traction|waitlist|interviews?|validated|loi)\b/,
    /\b(?:capital|budget|funding|runway|self-funded|bootstrapped)\b/,
    /\b(?:launch plan|roadmap|milestone|hire|partnership|partners?|distribution)\b/,
    /\b(?:prototype|mvp|proof of concept|poc|beta(?:\s+customers?)?|design partners?|pilot partners?|pilot customers?)\b/,
  ].map((pattern) => pattern.test(normalized));
  // CRITICAL SCORING ENGINE FIX -- company lifecycle awareness. A company
  // with verified paying customers/MRR/ARR is categorically further along
  // than one that only matches founderSignals[1]'s generic "customers/
  // revenue" keyword pattern, so its founder/execution readiness gets an
  // additional stage-proportional step on top of the keyword-based base
  // score. Deliberately a local, self-contained approximation rather
  // than importing detectCompanyLifecycleStage from company-lifecycle.ts
  // (the canonical version, also used by financial-model.ts and
  // investment-score.ts) -- this module is kept intentionally free of
  // real cross-file imports so it stays directly importable in tests
  // with no path rewriting (dozens of existing tests rely on that).
  const hasPayingRevenueSignal =
    /\b(paying customers?|\d[\d,]*\s*paying|mrr|arr|annual recurring revenue|monthly recurring revenue)\b/i.test(
      normalized
    ) &&
    !/\b(?:no|not|zero|without|don'?t have|doesn'?t have|do not have|does not have|haven'?t|have not|pre[-\s]?revenue)\s+(?:\w+\s+){0,3}?(paying customers?|mrr|arr|revenue)\b/i.test(
      normalized
    );
  const hasGrowthScaleSignal =
    hasPayingRevenueSignal &&
    /\b(\$\s*[1-9](?:\.\d+)?\s*m(?:illion)?\b|expand|expansion|scale|scaling|international)\b/i.test(normalized);
  const lifecycleBoost = hasGrowthScaleSignal ? 30 : hasPayingRevenueSignal ? 22 : founderSignals[4] ? 6 : 0;
  const founderReadiness = clamp(
    25 + founderSignals.reduce((sum, present) => sum + (present ? 15 : 0), 0) + lifecycleBoost
  );
  const executionReadiness = clamp(
    30 +
      (founderSignals[1] ? 22 : 0) +
      (founderSignals[2] ? 14 : 0) +
      (founderSignals[3] ? 20 : 0) +
      lifecycleBoost
  );
  return { founderReadiness, executionReadiness };
}

function coversField(item: DomainResearchEvidence, pattern: RegExp) {
  return pattern.test(`${item.field} ${item.claim} ${item.sourceType}`);
}

export function evaluateMarketResearchCoverage(
  evidence: readonly DomainResearchEvidence[],
  prompt = ""
): MarketResearchCoverage {
  const verified = evidence.filter(isVerifiedExternal);
  const domains = new Set(verified.map((item) => normalizedDomain(item.url)).filter(Boolean));
  const classes = new Set(verified.map(classifyMarketEvidenceSource));
  classes.delete("other");
  const competitorSources = verified.filter((item) =>
    coversField(item, /compet|major.players|product.evidence|company.evidence/i)
  );
  const competitorOrganizations = new Set(
    competitorSources
      .map((item) => item.publisher.trim().toLowerCase() || normalizedDomain(item.url))
      .filter(Boolean)
  );
  const coveragePatterns = [
    /market.size|tam|sam|som|cagr/i,
    /market.demand|adoption|customer/i,
    /compet/i,
    /product|pricing/i,
    /industry.structure|trend|barrier|regulation/i,
    /company.evidence|filing|annual.report/i,
  ];
  const coveredClaims = coveragePatterns.filter((pattern) =>
    verified.some((item) => coversField(item, pattern))
  ).length;
  const quality = clamp(
    average(verified.map((item) => item.qualityScore ?? item.confidence))
  );
  const fresh = clamp(average(verified.map(freshness)));
  const verifiedMarketSizeAvailable = verified.some(
    (item) =>
      coversField(item, /market.size|tam|sam|som|cagr/i) &&
      /\b\d[\d.,]*\s*(?:%|million|billion|trillion|[kmb])?\b/i.test(
        `${item.claim} ${item.value}`
      )
  );
  const sourceBreadthScore = clamp(Math.min(domains.size, 6) * 14);
  const sourceTypeScore = clamp(Math.min(classes.size, 5) * 18);
  const claimCoverage = clamp((coveredClaims / coveragePatterns.length) * 100);
  const competitorBreadth = competitorOrganizations.size;
  const competitiveEvidence = clamp(
    Math.min(competitorBreadth, 6) * 12 +
      Math.min(new Set(competitorSources.map((item) => normalizedDomain(item.url))).size, 5) * 5 +
      quality * 0.15
  );
  const marketConfidence = clamp(
    quality * 0.32 + sourceBreadthScore * 0.25 + sourceTypeScore * 0.18 + claimCoverage * 0.2 + fresh * 0.05
  );
  const filingCount = verified.filter(
    (item) => classifyMarketEvidenceSource(item) === "financial_filing"
  ).length;
  const financialEvidence = clamp(
    verifiedMarketSizeAvailable
      ? 58 + Math.min(22, filingCount * 6) + quality * 0.2
      : 22 + Math.min(24, filingCount * 8) + quality * 0.08
  );
  const productSources = verified.filter((item) =>
    coversField(item, /product|pricing|feature|integration|deployment/i)
  );
  const productEvidence = clamp(
    22 +
      Math.min(45, new Set(productSources.map((item) => normalizedDomain(item.url))).size * 11) +
      quality * 0.2
  );
  const readiness = promptReadiness(prompt);
  const dimensions = {
    marketConfidence,
    competitiveEvidence,
    financialEvidence,
    productEvidence,
    executionReadiness: readiness.executionReadiness,
    founderReadiness: readiness.founderReadiness,
  };
  const overallConfidence = calculateMarketOverallConfidence(dimensions);

  return {
    evidenceCount: verified.length,
    verifiedSources: new Set(verified.map((item) => item.url)).size,
    independentDomains: domains.size,
    competitorBreadth,
    sourceTypeDiversity: classes.size,
    claimCoverage,
    freshnessScore: fresh,
    averageQuality: quality,
    verifiedMarketSizeAvailable,
    dimensions,
    overallConfidence,
    sourceClasses: [...classes],
  };
}

function scoreCategory<T extends { score: number; maximumScore: number; reasoning: string[] }>(
  category: T,
  score: number,
  reasoning: string[]
): T {
  return {
    ...category,
    score: Math.round((clamp(score) / 100) * category.maximumScore),
    reasoning,
  };
}

// CRITICAL SCORING ENGINE FIX -- one canonical score source, never
// duplicated/conflicting values across sections. Confirmed live:
// "Business Model Quality" appeared with a high score in one section and
// a low score in another for the SAME report. Root cause: investment-
// score.ts's teamFounder category already computes a correct, lifecycle-
// aware "Business model quality" percentage from real financial-model
// signals (recurring revenue, margin, payback) -- decisionEngine.
// founderScore starts as a copy of that category (see investment-
// score.ts's decisionEngine construction), so its reasoning array
// already carries the right number. This function used to silently
// discard it and substitute dimensions.productEvidence -- a measure of
// how many distinct domains mention this company's product/pricing
// online, which has no relationship to business model quality at all.
// Business model quality and execution complexity are founder/business-
// model judgments, not something external web research can verify, so
// they are read back from the category's own original reasoning and
// reused verbatim rather than recomputed from an unrelated dimension.
function extractOriginalReasoningPercent(reasoning: readonly string[], label: string): number | null {
  const line = reasoning.find((entry) => entry.startsWith(`${label}:`));
  const match = line?.match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

export function applyMarketResearchCoverageToContext(
  context: AiFinancialModelContext,
  bundle: Pick<DomainResearchBundle, "evidence">,
  prompt: string,
  coverageOverride?: MarketResearchCoverage
) {
  const coverage =
    coverageOverride || evaluateMarketResearchCoverage(bundle.evidence, prompt);
  const dimensions = coverage.dimensions;
  const decisionEngine = context.investmentScore.decisionEngine;
  const originalFounderReasoning = decisionEngine.founderScore.reasoning;
  const originalBusinessModelQuality = extractOriginalReasoningPercent(originalFounderReasoning, "Business model quality");
  const originalExecutionComplexity = extractOriginalReasoningPercent(originalFounderReasoning, "Execution complexity");
  const originalValidationConfidence = extractOriginalReasoningPercent(originalFounderReasoning, "Validation confidence");
  const originalEvidenceConfidence = extractOriginalReasoningPercent(originalFounderReasoning, "Evidence confidence");
  const marketScore = scoreCategory(
    decisionEngine.marketScore,
    dimensions.marketConfidence,
    [`Market evidence coverage: ${dimensions.marketConfidence}%`, `Independent domains: ${coverage.independentDomains}`, `Claim coverage: ${coverage.claimCoverage}%`]
  );
  const competitionScore = scoreCategory(
    decisionEngine.competitionScore,
    dimensions.competitiveEvidence,
    [`Competitive evidence: ${dimensions.competitiveEvidence}%`, `Distinct competitor organizations represented: ${coverage.competitorBreadth}`]
  );
  const financialScore = scoreCategory(
    decisionEngine.financialScore,
    dimensions.financialEvidence,
    [
      `Financial evidence: ${dimensions.financialEvidence}%`,
      coverage.verifiedMarketSizeAvailable
        ? "Verified market-size endpoint detected: yes"
        : "Verified market-size endpoint detected: no; planning estimates must remain separate",
    ]
  );
  const executionScore = scoreCategory(
    decisionEngine.executionScore,
    dimensions.executionReadiness,
    [`Execution readiness: ${dimensions.executionReadiness}%`, "Derived from validation, capital, team, and execution inputs—not missing market-size data."]
  );
  // Confirmed live: "Market attractiveness" here used to read purely from
  // dimensions.marketConfidence -- a measure of how much VERIFIED EXTERNAL
  // web evidence was found, not of whether the opportunity itself is
  // attractive. A prompt reporting real, specific, self-reported evidence
  // (a working prototype, named design partners) that a narrow B2B/
  // enterprise niche's public web search simply has no indexed coverage
  // for was scored "Market attractiveness: 0%" purely because research
  // came back empty, with the founder's own credible claims never
  // factored in at all. Blending in founderReadiness (prompt-derived,
  // covers exactly this self-reported evidence -- see promptReadiness
  // above) means thin external search coverage alone can no longer zero
  // this out, while a prompt with neither external corroboration nor any
  // self-reported evidence still scores low, honestly.
  const founderScore = scoreCategory(
    decisionEngine.founderScore,
    dimensions.founderReadiness,
    [
      `Market attractiveness: ${Math.round((dimensions.marketConfidence + dimensions.founderReadiness) / 2)}%`,
      // Business model quality, validation confidence, execution
      // complexity, and evidence confidence are founder/business-model
      // judgments (recurring revenue, margin, payback, lifecycle stage --
      // see investment-score.ts) -- not something external web-research
      // coverage can verify, so the category's own original,
      // already-lifecycle-aware value is reused verbatim instead of
      // being replaced by an unrelated research-coverage dimension. Falls
      // back to the coverage dimension only if the original line was
      // somehow missing (defensive, should not happen in practice).
      `Business model quality: ${originalBusinessModelQuality ?? dimensions.productEvidence}%`,
      `Validation confidence: ${originalValidationConfidence ?? dimensions.executionReadiness}%`,
      `Execution complexity: ${originalExecutionComplexity ?? dimensions.executionReadiness}%`,
      `Evidence confidence: ${originalEvidenceConfidence ?? coverage.overallConfidence}%`,
      `Founder evidence: ${dimensions.founderReadiness}%`,
    ]
  );
  const confidenceLevel = classifyMarketConfidence(coverage.overallConfidence);
  const reportConfidenceLevel = `${confidenceLevel} Confidence` as
    | "High Confidence"
    | "Medium Confidence"
    | "Low Confidence";
  const overallQuality = reportConfidenceLevel === "Medium Confidence"
    ? "Moderate Confidence" as const
    : reportConfidenceLevel;

  return {
    coverage,
    context: {
      ...context,
      investmentScore: {
        ...context.investmentScore,
        confidence: coverage.overallConfidence,
        decisionEngine: {
          ...decisionEngine,
          marketScore,
          competitionScore,
          financialScore,
          executionScore,
          founderScore,
        },
      },
      reportIntelligence: {
        ...context.reportIntelligence,
        totalScore: coverage.overallConfidence,
        qualityScore: coverage.overallConfidence,
        confidenceLevel: reportConfidenceLevel,
        overallQuality,
        dimensions: {
          evidenceQuality: dimensions.marketConfidence,
          sourceConfidence: clamp(
            coverage.averageQuality * 0.55 +
              Math.min(coverage.independentDomains, 6) * 7.5
          ),
          financialConsistency: dimensions.financialEvidence,
          benchmarkFit: dimensions.competitiveEvidence,
          validationReadiness: dimensions.executionReadiness,
        },
        confidenceSummary: coverage.verifiedMarketSizeAvailable
          ? "Market confidence reflects aggregate source, competitor, product, and financial coverage."
          : "Market and competitive findings are decision-useful; verified market sizing remains unavailable and financial confidence is lower.",
      },
    } satisfies AiFinancialModelContext,
  };
}

export function formatMarketResearchCoverageForReport(
  coverage: MarketResearchCoverage
) {
  // This text is injected into the model's context for every Market
  // Intelligence field generation call. It must never name "founder" or
  // "execution" dimensions -- even inside an instruction telling the model
  // NOT to collapse them, the words themselves prime a startup-founder
  // framing that has no place in a market research report. Only the
  // market-native dimensions (market, competitive, market-sizing, product)
  // are ever surfaced here.
  return [
    "Aggregate market evidence coverage (scoring guidance, not a source):",
    `- Verified sources: ${coverage.verifiedSources}; independent domains: ${coverage.independentDomains}; source types: ${coverage.sourceTypeDiversity}.`,
    `- Competitor breadth: ${coverage.competitorBreadth}; claim coverage: ${coverage.claimCoverage}%; average quality: ${coverage.averageQuality}/100.`,
    `- Verified market-size endpoints: ${coverage.verifiedMarketSizeAvailable ? "available" : "unavailable"}.`,
    "- Missing market-size endpoints reduce market-sizing confidence only; do not collapse market, competitive, or product-evidence dimensions.",
  ].join("\n");
}
