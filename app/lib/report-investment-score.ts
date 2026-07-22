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
  categories?: Record<string, unknown>;
  decisionEngine?: Record<string, { score?: number; maximumScore?: number; label?: string }>;
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

export type ReportMetadata = {
  investmentScore?: ReportInvestmentScore;
  benchmarkFit?: ReportBenchmarkFit;
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
