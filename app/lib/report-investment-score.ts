export type ReportInvestmentScore = {
  version?: string;
  fingerprint?: string;
  totalScore: number;
  confidence: number;
  recommendation: "GO" | "WAIT" | "PASS" | string;
  estimatedValuation?: string;
  fundingStage?: string;
  nextCriticalAction?: string;
  strengths?: string[];
  weaknesses?: string[];
  topRisks?: string[];
  categories?: Record<
    string,
    { score?: number; maximumScore?: number; label?: string; explanation?: string; reasoning?: string[] }
  >;
  // TASK #69A-17 -- dimensionScores mirrors investment-score.ts's own
  // FounderReadinessDimensionScoreEntry[] (score-only, keyed by
  // FounderReadinessDimensionKey, additive/optional): the one canonical,
  // deterministic source every Founder Readiness renderer reads first,
  // never re-derived from `reasoning`'s prose. Absent on any report
  // persisted before this field existed -- degrades honestly to the
  // pre-existing reasoning-based extraction, never fabricated.
  decisionEngine?: Record<
    string,
    {
      score?: number;
      maximumScore?: number;
      label?: string;
      reasoning?: string[];
      dimensionScores?: Array<{ key: string; label: string; score: number }>;
    }
  >;
};

export type ReportBenchmarkFit = {
  version?: string;
  industryKey?: string;
  industry?: string;
  businessModel?: string;
  benchmarkBasis?: string;
  confidence?: string;
  fit?: string;
  matchedSignals?: string[];
  validationGaps?: string[];
  rationale?: string;
};

export type ReportQualityScore = {
  version?: string;
  totalScore: number;
  qualityScore?: number;
  overallQuality?: string;
  confidenceLevel: "High Confidence" | "Medium Confidence" | "Low Confidence" | string;
  dimensions: {
    evidenceQuality: number;
    sourceConfidence: number;
    financialConsistency: number;
    benchmarkFit: number;
    validationReadiness: number;
  };
  strengths: string[];
  weaknesses: string[];
  improvementActions: string[];
  risks?: string[];
  warnings?: string[];
  confidenceSummary?: string;
};

export type ReportBenchmarkScore = {
  version?: string;
  overallFit: number;
  dimensions: {
    industryFit: number;
    businessModelFit: number;
    geographyFit: number;
    pricingFit: number;
    financialBenchmarkFit: number;
  };
  confidence: "High" | "Medium" | "Low" | string;
  deviations: Array<{
    metric: string;
    userValue: string;
    benchmarkRange: string;
    status: string;
  }>;
  insights: string[];
  actions: string[];
};

export type ReportValidationIntelligence = {
  version?: string;
  overallScore: number;
  confidenceLevel: "High" | "Medium" | "Low" | string;
  assumptions: Array<{
    id: string;
    assumption: string;
    riskLevel: "Critical" | "High" | "Medium" | string;
    evidenceStatus: "Validated" | "Partial" | "Missing" | string;
    experiment: string;
    successMetric: string;
    timeframe: string;
    priority: number;
  }>;
  summary: string;
  recommendedSequence: string[];
};

export type ReportMetadata = {
  reportLanguage?: "en" | "tr" | "de" | "fr" | "es";
  investmentScore?: ReportInvestmentScore;
  benchmarkFit?: ReportBenchmarkFit;
  benchmarkScore?: ReportBenchmarkScore;
  reportQuality?: ReportQualityScore;
  validationIntelligence?: ReportValidationIntelligence;
  expertiseProfile?: import("@/app/lib/ai/expertise-profile").ExpertiseProfile;
  reportPlan?: import("@/app/lib/ai/dynamic-report-plan").DynamicReportPlan;
  researchPlan?: import("@/app/lib/ai/dynamic-research-plan").DynamicResearchPlan;
  reportQualityValidation?: import("@/app/lib/report-engine/executive-report-quality-validator").ExecutiveReportQualityValidationResult;
  reportConsistencyCheck?: import("@/app/lib/report-engine/report-consistency-checker").ReportConsistencyCheckResult;
  reportAuditTrail?: import("@/app/lib/report-engine/report-audit-trail").ReportAuditTrailResult;
  reportExplainability?: import("@/app/lib/report-engine/explainability-engine").ExplainabilityEngineResult;
  reportReproducibility?: import("@/app/lib/report-engine/decision-reproducibility-engine").ReproducibilityRecord;
  reportVersion?: import("@/app/lib/report-engine/report-versioning-engine").ReportVersionManifest;
  // TASK #23 -- the versioned, frozen snapshot of Market Intelligence's
  // decision-critical structured facts (decision, confidence, TAM/SAM/SOM
  // + evidence methods, competitor evidence, citation registry) captured
  // once at generation time. Absent on every report persisted before this
  // field existed, and on any report whose generation didn't have a full
  // graph + decision brief available -- both are legacy/degraded states
  // handled by the existing prose-parsing fallback, never migrated or
  // backfilled. See market-intelligence-canonical-state.ts.
  marketIntelligenceCanonicalState?: import("@/app/lib/report-engine/market-intelligence-canonical-state").MarketIntelligenceCanonicalState;
  // TASK #23 (follow-up) -- always set alongside (or instead of)
  // marketIntelligenceCanonicalState whenever a full Market Intelligence
  // report actually runs ensureMarketReportQuality: "available" when a
  // real canonical state was built, "unavailable_no_graph" when
  // generation itself had no graph/evidence to snapshot (deliberately not
  // fabricated -- see market-intelligence-canonical-state.ts). Absent
  // entirely only for a report persisted before this mechanism existed.
  marketIntelligenceCanonicalStateStatus?: import("@/app/lib/report-engine/market-intelligence-canonical-state").MarketIntelligenceCanonicalStateStatus;
  // TASK #69A-15 -- the versioned, structured snapshot of Business Idea
  // Validation's Competitor Landscape (company/type/positioning/
  // strengths/weaknesses/threat per real competitor), captured once at
  // generation time from competitorLandscape's own newly-labeled prompt
  // output. Absent on every report persisted before this field existed,
  // and on any report whose model output didn't follow the labeled
  // format -- both are legacy states handled by the existing,
  // unmodified prose-parsing fallback (extractCompetitorRows), never
  // migrated or backfilled. See business-competitor-landscape-state.ts.
  businessCompetitorLandscapeState?: import("@/app/lib/report-engine/business-competitor-landscape-state").BusinessCompetitorLandscapeState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isReportInvestmentScore(value: unknown): value is ReportInvestmentScore {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.totalScore === "number" &&
    typeof value.confidence === "number" &&
    typeof value.recommendation === "string"
  );
}

export function readReportInvestmentScore(
  metadata: unknown
): ReportInvestmentScore | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const score = metadata.investmentScore;

  return isReportInvestmentScore(score) ? score : undefined;
}
