import type { AiFinancialModelContext } from "@/app/lib/ai/financial-assumptions";
import type {
  DomainResearchBundle,
  DomainResearchEvidence,
} from "@/app/lib/ai/domain-research";
import { isAuthoritativeMarketEvidenceSource } from "@/app/lib/ai/commercial-vendor-intelligence";
import type { BusinessCompetitorLandscapeState } from "@/app/lib/report-engine/business-competitor-landscape-state";

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
    /\b(?:census|bureau of labor statistics|official[ _]statistics|statistical[ _]office|central bank|regulator)\b/.test(identity)
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
  if (/\b(?:market[ _]research|industry[ _]report|market[ _]data|research[ _]report|forecasts?(?:ing)?)\b/.test(identity)) {
    return "market_research";
  }
  if (/\b(?:news|journal|review|times|reuters|bloomberg|forbes|technology|financial publication)\b/.test(identity)) {
    return "credible_publication";
  }
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): every branch above is a brittle, domain-suffix-
  // or literal-keyword match with no recognition of named market-
  // research publishers (IBISWorld, Grand View Research, Statista,
  // Mordor Intelligence, ...) or industry associations/analyst firms
  // that don't happen to contain one of the exact tokens above in their
  // title/publisher string -- e.g. "grandviewresearch.com" doesn't
  // contain the literal token "market" immediately before "research",
  // so it fell through every branch into "other" (the lowest rank),
  // demoting a genuine market-research citation below a random blog.
  // isAuthoritativeMarketEvidenceSource reuses the same classifier
  // domain-research.ts's scoreResearchEvidence now uses, so a
  // publisher can never be treated as high-authority in one signal and
  // low-authority in the other.
  if (isAuthoritativeMarketEvidenceSource(item)) {
    return "market_research";
  }
  return "other";
}

export function freshness(item: DomainResearchEvidence) {
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

// TASK #69A-3 -- CRITICAL BUG FIX (confirmed live: a real Business Idea
// Validation report's Competitor Landscape named two real, cited
// competitors -- Float [R56][R59], Cash Flow Frog [R57] -- both backed by
// genuinely "Verified from external source" evidence with real URLs and
// publishers, yet the Executive Summary said "Distinct competitor
// organizations represented: 0"). ROOT CAUSE: coversField above only
// inspects `field`/`claim`/`sourceType`, and Business Idea Validation's
// own research pipeline tags virtually all of its evidence with one of
// four coarse field values (executive_assessment/priority_actions/
// material_facts/analysis) -- none of which contain "compet", and the raw
// `claim` text describes what a vendor's product DOES ("Float targets
// finance teams... integrates with Xero/QuickBooks...") without
// necessarily using the word "competitor" either. The SAME evidence items'
// own, already-populated `impactReason` field -- the research pipeline's
// own structured statement of why this evidence matters -- explicitly said
// "Shows established competitor..." (R56) and "Indicates available
// low-price competition..." (R57), a genuine, structured, AI-scored
// signal this narrow competitor-only check simply never looked at.
// Deliberately scoped to ONLY the competitor-evidence check below (not a
// change to the shared coversField helper, which 5 other, unrelated
// coverage dimensions -- market size, demand, product/pricing, industry
// structure, company filings -- also depend on) so this fix cannot
// possibly change any of those other dimensions' behavior.
function coversCompetitorEvidence(item: DomainResearchEvidence) {
  return /compet|major.players|product.evidence|company.evidence/i.test(
    `${item.field} ${item.claim} ${item.sourceType} ${item.impactReason}`
  );
}

// TASK #69A-38D -- ROOT CAUSE FIX. Confirmed live: a fresh Business Idea
// Validation report showed "Competitive evidence: 93%; Distinct
// competitor organizations represented: 5" (Executive Summary /
// Competitive Advantage category / Confidence Radar "Evidence") while
// the SAME report's Competitor Landscape said "No competitor data could
// be validated for this market yet." and Benchmark Intelligence said
// "Competitor Insights: evidence missing" -- an internally contradictory
// report. ROOT CAUSE: `competitorBreadth`/`dimensions.competitiveEvidence`
// below were derived entirely from RAW, unstructured research evidence
// (`competitorSources`, matched by field/claim/sourceType/impactReason
// text against /compet|major.players|.../i) -- a rough estimate that
// predates, and is completely independent of, the AI's own schema-
// enforced `competitorLandscapeStructured` response
// (business-competitor-landscape-state.ts's `businessCompetitorLandscapeState`,
// #69A-15A's canonical, authoritative competitor source). Raw evidence
// items can legitimately mention competitor-shaped text (a vendor
// comparison snippet, a "product_evidence" research result) even when
// the model's own FINAL structured competitor array comes back empty --
// and since this coverage evaluation runs BEFORE report generation even
// starts (plan-executor.ts calls it on the raw research bundle, long
// before the AI response -- and therefore businessCompetitorLandscapeState
// -- exists), it had no way to know that at the time. The two numbers
// (a rough pre-generation estimate vs. the real post-generation
// canonical list) were never reconciled once the canonical list became
// available, so the report shipped whichever one each surface happened
// to read.
//
// FIX: `canonicalCompetitorEvidence`, when provided, REPLACES the raw-
// evidence-derived competitorBreadth/competitiveEvidence with the
// canonical, structurally-authoritative values derived from
// businessCompetitorLandscapeState (see deriveCanonicalCompetitiveEvidence
// below) -- zero real competitors validated means competitorBreadth=0
// and competitiveEvidence=0, never a leftover raw-evidence guess. Every
// OTHER dimension (marketConfidence/financialEvidence/productEvidence/
// executionReadiness/founderReadiness) is completely unaffected -- this
// task is scoped to competitor evidence specifically, matching what was
// actually proven wrong. Called a second time, after
// businessCompetitorLandscapeState is known, by plan-executor.ts (see
// its own #69A-38D comment) -- never called instead of the original,
// pre-generation call, which must still run to produce the OTHER four
// dimensions the generation prompt itself depends on.
export function deriveCanonicalCompetitiveEvidence(
  competitorState: Pick<BusinessCompetitorLandscapeState, "competitors"> | null | undefined
): { competitorBreadth: number; competitiveEvidence: number } {
  const competitors = competitorState?.competitors ?? [];
  const competitorBreadth = competitors.length;

  if (competitorBreadth === 0) {
    return { competitorBreadth: 0, competitiveEvidence: 0 };
  }

  // Evidence QUALITY per validated competitor: how many of its own
  // independently-captured fields (positioning/strengths/weaknesses/
  // threat) are genuinely populated -- never the canonical "—" missing-
  // value marker every Tier 0/Tier 1 builder already uses for a field
  // the model could not support with evidence. Averaged across every
  // real, named competitor, so one thin record among several well-
  // evidenced ones does not by itself collapse the score, and one
  // thin record ALONE cannot inflate it either.
  const fieldCompletenessRatios = competitors.map((competitor) => {
    const fields = [competitor.positioning, competitor.strengths, competitor.weaknesses, competitor.threat];
    return fields.filter((field) => field && field !== "—").length / fields.length;
  });
  const averageFieldCompleteness = average(fieldCompletenessRatios);

  const competitiveEvidence = clamp(
    Math.min(competitorBreadth, 6) * 12 + averageFieldCompleteness * 28
  );

  return { competitorBreadth, competitiveEvidence };
}

export function evaluateMarketResearchCoverage(
  evidence: readonly DomainResearchEvidence[],
  prompt = "",
  canonicalCompetitorEvidence?: { competitorBreadth: number; competitiveEvidence: number } | null
): MarketResearchCoverage {
  const verified = evidence.filter(isVerifiedExternal);
  const domains = new Set(verified.map((item) => normalizedDomain(item.url)).filter(Boolean));
  const classes = new Set(verified.map(classifyMarketEvidenceSource));
  classes.delete("other");
  const competitorSources = verified.filter((item) => coversCompetitorEvidence(item));
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
  // TASK #69A-38D -- see this function's own canonicalCompetitorEvidence
  // parameter doc comment above: when the canonical, post-generation
  // competitor state is available, it REPLACES this raw-evidence-only
  // estimate entirely, rather than being blended with or overridden by
  // it inconsistently.
  const rawCompetitorBreadth = competitorOrganizations.size;
  const rawCompetitiveEvidence = clamp(
    Math.min(rawCompetitorBreadth, 6) * 12 +
      Math.min(new Set(competitorSources.map((item) => normalizedDomain(item.url))).size, 5) * 5 +
      quality * 0.15
  );
  const competitorBreadth = canonicalCompetitorEvidence
    ? canonicalCompetitorEvidence.competitorBreadth
    : rawCompetitorBreadth;
  const competitiveEvidence = canonicalCompetitorEvidence
    ? canonicalCompetitorEvidence.competitiveEvidence
    : rawCompetitiveEvidence;
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
  coverageOverride?: MarketResearchCoverage,
  // TASK #69A-38D -- see evaluateMarketResearchCoverage's own doc
  // comment. Threaded through here so plan-executor.ts's post-generation
  // correction call (once businessCompetitorLandscapeState is known) can
  // re-run this SAME function -- recomputing overallConfidence/
  // competitionScore/reportIntelligence consistently in one pass -- with
  // only competitor evidence replaced, never a second, divergent
  // recomputation path.
  canonicalCompetitorEvidence?: { competitorBreadth: number; competitiveEvidence: number } | null
) {
  const coverage =
    coverageOverride || evaluateMarketResearchCoverage(bundle.evidence, prompt, canonicalCompetitorEvidence);
  const dimensions = coverage.dimensions;
  const decisionEngine = context.investmentScore.decisionEngine;
  const originalFounderReasoning = decisionEngine.founderScore.reasoning;
  // TASK #69A-59 -- ROOT CAUSE FIX. Confirmed live: this line had no
  // "original ?? ..." preservation at all (unlike every sibling line
  // below it), so it unconditionally overwrote the founder-readiness
  // "Market attractiveness" reasoning line with an unrelated formula --
  // see the founderScore reasoning line below, which read this exact
  // label but recomputed it from (dimensions.marketConfidence +
  // dimensions.founderReadiness) / 2. investment-score.ts's own teamFounder
  // construction intentionally scores "Market attractiveness" identically
  // to "Idea Quality" (see that file's own comment on
  // founderReadinessDimensionScores) -- so the reasoning TEXT for that
  // same dimension must stay consistent with the value its own
  // dimensionScores entry already reports, never a second, independently
  // -recomputed number. This mirrors the exact preservation pattern the
  // four sibling lines below already use.
  const originalMarketAttractiveness = extractOriginalReasoningPercent(originalFounderReasoning, "Market attractiveness");
  const originalBusinessModelQuality = extractOriginalReasoningPercent(originalFounderReasoning, "Business model quality");
  const originalExecutionComplexity = extractOriginalReasoningPercent(originalFounderReasoning, "Execution complexity");
  const originalValidationConfidence = extractOriginalReasoningPercent(originalFounderReasoning, "Validation confidence");
  const originalEvidenceConfidence = extractOriginalReasoningPercent(originalFounderReasoning, "Evidence confidence");
  // TASK #69A-27B -- ROOT CAUSE FIX: unlike every sibling line above
  // (Business model quality/Validation confidence/Execution complexity/
  // Evidence confidence), this one had NO "original ?? ..." preservation
  // at all -- it unconditionally printed dimensions.founderReadiness (a
  // general market-research-coverage signal, blended from external
  // evidence breadth/quality) as "Founder evidence," silently discarding
  // the prompt-derived, founder-signal-specific founderEvidenceScore
  // (investment-score.ts) this line is supposed to describe. Founder
  // Evidence is deliberately founder-specific (domain experience,
  // operating capacity, explicit-inexperience detection) and must never
  // be inflated by how much UNRELATED market/competitive evidence
  // research happened to find -- exactly the "general research coverage
  // cannot inflate Founder Evidence" invariant this fix restores. This
  // text was already masked for every current renderer (readFounderReadinessDimensionScore/
  // resolveDimensionScoreText both prefer the structured dimensionScores
  // array first, and dimensionScores itself was never touched by this
  // function), so this had no visible effect on any currently-displayed
  // number -- but it left a genuinely wrong, independently-recomputed
  // second "Founder evidence" value sitting in structured decisionEngine
  // data, one accidental future read away from a real drift. Fixed the
  // same way its siblings already work: prefer the original,
  // founder-signal-derived value; fall back to the research dimension
  // only if that original line is somehow missing.
  const originalFounderEvidence = extractOriginalReasoningPercent(originalFounderReasoning, "Founder evidence");
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
  // TASK #69A-47 -- ROOT CAUSE FIX. Confirmed live (and by direct,
  // reproducible test): scoreCategory below overwrites founderScore.score
  // with dimensions.founderReadiness -- a coarse, PROMPT-KEYWORD-derived
  // proxy (promptReadiness, this file) -- discarding the richer,
  // lifecycle-aware teamFounder category score investment-score.ts
  // already computed (ideaQuality x2, validationLevel, founderEvidence,
  // executionComplexity, a floored metricConfidence). #69A-27B's own
  // comment immediately below ALREADY establishes that "Business model
  // quality, validation confidence, execution complexity, and evidence
  // confidence are founder/business-model judgments... not something
  // external web-research coverage can verify" -- and correctly
  // protects each of those four dimensions' own reasoning text AND
  // dimensionScores entries from this contamination. But the CATEGORY
  // TOTAL itself (founderScore.score, the exact field
  // readFounderReadinessScoreValue reads for the headline "Founder
  // Readiness Score") was never given the same protection: reproduced
  // live, a fresh context with teamFounder.score=60 pre-refresh
  // collapsed to founderScore.score=25 post-refresh -- exactly
  // dimensions.founderReadiness, with ZERO founder-specific research
  // evidence involved (an abundant-but-generic external evidence
  // fixture was enough to trigger it) -- while its own 7 displayed
  // dimensionScores (Idea Quality, Business Model Quality, ...) stayed
  // completely unchanged. This is precisely the "same concept
  // recomputed differently in different sections" defect this ticket
  // exists to close: the headline Founder Readiness Score must be
  // computed the SAME way its own displayed dimensions are, never
  // silently replaced by an unrelated market-research-coverage signal.
  //
  // FIX: mirrors the EXACT preservation pattern this file's own #69A-43
  // fix already established for financialConsistency/benchmarkFit/
  // validationReadiness (report-intelligence.ts dimensions) -- the
  // original, pre-refresh founderScore.score is preserved verbatim.
  // Only .reasoning (informational text, already correctly protected by
  // #69A-27B's own original-value preservation below) is refreshed.
  // refreshInvestmentNarrativeFromResearchCoverage (investment-score.ts)
  // reads this SAME, now-corrected decisionEngine.founderScore.score to
  // recompute investmentScore.categories.teamFounder.score immediately
  // afterward in this pipeline's own established call order -- so this
  // one preservation point is sufficient; no second fix is needed there.
  const founderScore = {
    ...scoreCategory(
      decisionEngine.founderScore,
      dimensions.founderReadiness,
      [
        // TASK #69A-59 -- Market attractiveness, like its four siblings
        // below, is a founder/business-model judgment inside
        // investment-score.ts (intentionally scored identically to Idea
        // Quality there -- see that file's own comment), not something
        // external web-research coverage can verify. Reuses the
        // category's own original value instead of the unrelated
        // (marketConfidence + founderReadiness) / 2 blend this line used
        // to compute unconditionally. Falls back to that blend only if
        // the original line was somehow missing (defensive, should not
        // happen in practice).
        `Market attractiveness: ${originalMarketAttractiveness ?? Math.round((dimensions.marketConfidence + dimensions.founderReadiness) / 2)}%`,
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
        `Founder evidence: ${originalFounderEvidence ?? dimensions.founderReadiness}%`,
      ]
    ),
    score: decisionEngine.founderScore.score,
  };
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
          // TASK #69A-50 -- ROOT CAUSE FIX, same pattern and same audit
          // class as financialConsistency/benchmarkFit/validationReadiness
          // immediately below: this line used to unconditionally read
          // `dimensions.marketConfidence` -- how much EXTERNAL, VERIFIED
          // market research evidence exists -- for a dimension
          // report-presentation.ts labels "Data Completeness" (see
          // getReportQualityBreakdown), which report-intelligence.ts's
          // own createReportIntelligenceModel originally computes as
          // `clampScore(investmentScore.confidence*0.45 +
          // decisionConfidence.confidenceScore*0.25 +
          // (hasUserEvidence?22:4))` -- a measure of how complete the
          // INPUTS to this analysis are, INCLUDING whether the founder
          // supplied real user/customer/revenue evidence. These are
          // unrelated concepts: a founder who has supplied real MRR,
          // paying-customer, and waitlist figures has genuinely complete
          // input data regardless of how much INDEPENDENT external market
          // research this pipeline happened to find. Confirmed live and
          // by direct, reproducible test: a fixture with real, stated
          // MRR/paying-customer/waitlist evidence scored evidenceQuality=70
          // pre-refresh, then collapsed to 0 post-refresh purely because
          // external research evidence was sparse for that market --
          // while nothing about the founder's own supplied data changed
          // at all. FIX: preserve the original, pre-refresh value, mirroring
          // the exact preservation pattern already established for
          // financialConsistency/benchmarkFit/validationReadiness below.
          evidenceQuality: context.reportIntelligence?.dimensions?.evidenceQuality ?? 0,
          sourceConfidence: clamp(
            coverage.averageQuality * 0.55 +
              Math.min(coverage.independentDomains, 6) * 7.5
          ),
          // TASK #69A-43 -- ROOT CAUSE FIX. Confirmed live: a fresh
          // report showed Report Quality's "Financial Consistency:
          // 67/100" and Confidence Radar "Financial: 67" while the
          // report's own financial assumptions (ARPA/CAC/LTV/gross
          // margin/burn/runway/investment need) were still entirely
          // unvalidated planning estimates -- no paying customers, no
          // pilots, no observed retention/CAC. ROOT CAUSE: this line
          // read `dimensions.financialEvidence` -- how much EXTERNAL
          // market/industry research evidence was found about financial
          // topics (Census/BLS/GAO-style macro data; #69A-40B's own
          // investigation traced exactly this kind of evidence) -- a
          // completely unrelated concept from "Financial Consistency"
          // (whether THIS business's own financial model is internally
          // coherent: margin vs. CAC vs. LTV vs. runway), which shares
          // no conceptual overlap with research-evidence coverage at
          // all. Having many external sources about the market or
          // industry does not validate this business's own CAC, LTV, or
          // burn assumptions -- exactly the semantic-contamination
          // pattern #69A-38G already fixed once for benchmarkFit,
          // immediately below, just unaudited for this sibling
          // dimension at the time. report-intelligence.ts's own
          // createReportIntelligenceModel already computes this exact
          // dimension correctly and deterministically from
          // context.financialConsistency.quality (the financial model's
          // own internal-coherence check -- Healthy/Needs Validation/
          // Poor -- computed once from the canonical financial
          // assumptions, confirmed never touched by market research:
          // see #69A-18A's own comment on this file listing
          // financialConsistency among the four inputs market research
          // never alters). That already-correct, already-computed value
          // is preserved verbatim here -- never silently replaced with
          // an unrelated dimension merely because both happened to need
          // *some* number under this refresh's object literal.
          financialConsistency:
            context.reportIntelligence?.dimensions?.financialConsistency ?? 34,
          // TASK #69A-38G -- ROOT CAUSE FIX. Confirmed live: a fresh
          // report showed Executive Snapshot/Report Quality's "Benchmark
          // Fit: 0/100" while the SAME report's Benchmark Intelligence
          // panel said "Overall Fit: 70/100" -- an internally
          // contradictory report. ROOT CAUSE: this line used to read
          // `dimensions.competitiveEvidence` -- a completely unrelated
          // metric (competitive EVIDENCE strength, #69A-38D/#69A-38E/
          // #69A-38F's own now-corrected value, honestly 0 when no
          // competitors are validated) that happens to share no
          // conceptual overlap with "benchmark fit" at all -- it was
          // never re-derived from context.benchmarkFit (financial-
          // model.ts's own createBenchmarkFit, the SAME structured
          // object Benchmark Intelligence's own overallFit is built
          // from via createBenchmarkIntelligenceScore) the way
          // report-intelligence.ts's own benchmarkFitScore(context)
          // originally computed this exact dimension at context-
          // creation time. context.benchmarkFit is never changed by
          // market research at all (it depends only on the financial
          // model's own benchmark comparison, computed once from the
          // prompt), so this dimension's already-correct, already-
          // computed value from context.reportIntelligence.dimensions.benchmarkFit
          // is preserved verbatim here -- never silently replaced with
          // an unrelated dimension merely because both happened to need
          // *some* number under this refresh's object literal. Optional
          // chaining is defensive only, for a hand-built partial test
          // context (e.g. `reportIntelligence: {}`) that never runs
          // through createCanonicalFinancialAssumptions -- every real
          // caller's context already has this field populated, since
          // AiFinancialModelContext requires it non-optionally.
          benchmarkFit: context.reportIntelligence?.dimensions?.benchmarkFit ?? 0,
          // TASK #69A-43 -- ROOT CAUSE FIX, same pattern and same audit
          // pass as financialConsistency immediately above:
          // "Validation Readiness" (how ready is customer-demand/
          // pricing/CAC/retention validation, per
          // report-intelligence.ts's own validationReadinessScore(context.validationIntelligence))
          // was being silently replaced by `dimensions.executionReadiness`
          // -- a business-model/capital/team execution-difficulty signal
          // with no conceptual relationship to validation status at all.
          // context.validationIntelligence is untouched by this refresh
          // (only investmentScore/reportIntelligence are ever
          // overwritten by the object literal below; every other
          // context field, including validationIntelligence, survives
          // via the `...context` spread above), so the already-correct,
          // already-computed value is preserved verbatim, never
          // silently replaced with an unrelated dimension.
          validationReadiness:
            context.reportIntelligence?.dimensions?.validationReadiness ?? 42,
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
