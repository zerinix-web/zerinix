import type { LiveEvidenceMetadata } from "@/app/lib/live-evidence";
import type { ReportConfidenceMetadata } from "@/app/lib/report-confidence";
import type { ReportQualityValidationResult } from "@/app/lib/report-quality-validation";
import type { SourceReliabilitySummary } from "@/app/lib/source-reliability";

export type ExecutiveDecision = "GO" | "WAIT" | "VALIDATE" | "NO-GO";
export type ExecutiveDecisionBand = "High" | "Medium" | "Low";

export type ExecutiveDecisionIntelligence = {
  recommended_decision: ExecutiveDecision;
  decision_confidence: ExecutiveDecisionBand;
  expected_business_impact: ExecutiveDecisionBand;
  urgency: ExecutiveDecisionBand;
  implementation_difficulty: ExecutiveDecisionBand;
  decision_score: number;
  impact_score: number;
  urgency_score: number;
  execution_complexity: number;
  strategic_priority: {
    immediate: string[];
    mediumTerm: string[];
    longTerm: string[];
  };
};

type DecisionInput = {
  report: Record<string, string>;
  validation: ReportQualityValidationResult;
  sources: SourceReliabilitySummary;
  confidence: ReportConfidenceMetadata;
  evidence: LiveEvidenceMetadata;
};

const REPORT_OPERATION_FIELDS = new Set([
  "executiveSummary",
  "marketAnalysis",
  "marketOverview",
  "businessModel",
  "financialDashboard",
  "unitEconomics",
  "risks",
  "threats",
  "executiveRecommendation",
  "recommendations",
]);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreBand(score: number): ExecutiveDecisionBand {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function textFromReport(report: Record<string, string>) {
  return Object.entries(report)
    .filter(([field]) => REPORT_OPERATION_FIELDS.has(field))
    .map(([, value]) => value)
    .join("\n")
    .toLowerCase();
}

function confidenceScore(confidence: ReportConfidenceMetadata["overall_confidence"]) {
  if (confidence === "High") return 82;
  if (confidence === "Medium") return 62;
  return 38;
}

function detectDecision(text: string, score: number, validationScore: number): ExecutiveDecision {
  if (/\b(?:reject|no-go|geç|reddet)\b/i.test(text)) return "NO-GO";
  if (/\b(?:validate|doğrula|doğrulama)\b/i.test(text)) return "VALIDATE";
  if (/\b(?:hold|wait|bekle)\b/i.test(text)) return "WAIT";
  if (/\b(?:go|proceed|ilerle)\b/i.test(text) && score >= 70) return "GO";
  if (validationScore < 55) return "VALIDATE";
  if (score >= 75) return "GO";
  if (score < 42) return "NO-GO";
  return "WAIT";
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) || []).length;
}

export function createExecutiveDecisionIntelligence(input: DecisionInput): ExecutiveDecisionIntelligence {
  const text = textFromReport(input.report);
  const evidenceCount = input.evidence.evidence_count || 0;
  const evidenceScore = Math.min(100, evidenceCount * 14);
  const freshnessScore = input.evidence.freshness_score || 0;
  const validationScore = input.validation.validation_score || 0;
  const sourceScore = input.sources.average_source_score || 0;
  const baseConfidenceScore = confidenceScore(input.confidence.overall_confidence);
  const duplicatePenalty = Math.min(12, input.validation.duplicate_sections.length * 3);
  const missingPenalty = Math.min(18, input.validation.missing_sections.length * 4);

  const decisionScore = clampScore(
    baseConfidenceScore * 0.3 +
      validationScore * 0.25 +
      sourceScore * 0.2 +
      freshnessScore * 0.1 +
      evidenceScore * 0.15 -
      duplicatePenalty -
      missingPenalty
  );
  const opportunitySignals = countMatches(
    text,
    /\b(?:market|pazar|growth|büyüme|revenue|gelir|tam|sam|som|margin|marj|subscription|abonelik|scalable|ölçeklenebilir)\b/g
  );
  const riskSignals = countMatches(
    text,
    /\b(?:risk|validation|doğrulama|uncertain|belirsiz|cac|capital|sermaye|competition|rekabet|execution|yürütme)\b/g
  );
  const impactScore = clampScore(48 + Math.min(28, opportunitySignals * 3) + sourceScore * 0.12 + evidenceScore * 0.08);
  const urgencyScore = clampScore(42 + Math.min(32, riskSignals * 2.5) + (validationScore < 60 ? 12 : 0));
  const executionComplexity = clampScore(
    38 +
      Math.min(34, riskSignals * 2.4) +
      (sourceScore < 55 ? 8 : 0) +
      (validationScore < 55 ? 10 : 0) -
      (evidenceCount > 3 ? 5 : 0)
  );
  const recommendedDecision = detectDecision(text, decisionScore, validationScore);

  return {
    recommended_decision: recommendedDecision,
    decision_confidence: scoreBand(decisionScore),
    expected_business_impact: scoreBand(impactScore),
    urgency: scoreBand(urgencyScore),
    implementation_difficulty: scoreBand(executionComplexity),
    decision_score: decisionScore,
    impact_score: impactScore,
    urgency_score: urgencyScore,
    execution_complexity: executionComplexity,
    strategic_priority: {
      immediate: [
        "Validate customer demand with primary interviews or paid commitments.",
        "Confirm pricing and willingness to pay before scaling acquisition.",
        "Verify CAC, payback, and capital assumptions with a small controlled test.",
      ],
      mediumTerm: [
        "Build a repeatable KPI cadence around acquisition, activation, retention, and revenue.",
        "Strengthen source evidence for market size, benchmarks, and competitor assumptions.",
        "Convert the strongest validation signal into a focused go-to-market wedge.",
      ],
      longTerm: [
        "Scale channels only after validation gates and unit economics are proven.",
        "Expand into adjacent segments using evidence from the initial beachhead.",
        "Prepare the investor narrative around validated traction, margin logic, and execution readiness.",
      ],
    },
  };
}
