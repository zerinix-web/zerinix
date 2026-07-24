import "server-only";

import type { ExecutiveDecisionIntelligence } from "@/app/lib/executive-decision-intelligence";
import type { LiveEvidenceMetadata } from "@/app/lib/live-evidence";
import type { ReportConfidenceMetadata } from "@/app/lib/report-confidence";
import type { ReportQualityValidationResult } from "@/app/lib/report-quality-validation";
import type { SourceReliabilitySummary } from "@/app/lib/source-reliability";

export type AiRoiValueCategory =
  | "Low Value"
  | "Medium Value"
  | "High Value"
  | "Exceptional Value";

export type AiRoiIntelligence = {
  roi_score: number;
  estimated_value_usd: number;
  estimated_hours_saved: number;
  estimated_research_hours_saved: number;
  estimated_document_production_value_usd: number;
  roi_ratio: number;
  value_category: AiRoiValueCategory;
  roi_version: "v1";
};

type AiRoiInput = {
  operationType: "plan_report" | "market_report" | "executive_report";
  estimatedCostUsd: number;
  report: Record<string, string>;
  validation: ReportQualityValidationResult;
  sources: SourceReliabilitySummary;
  confidence: ReportConfidenceMetadata;
  evidence: LiveEvidenceMetadata;
  decision: ExecutiveDecisionIntelligence;
};

const HOURLY_RESEARCH_VALUE_USD = 95;
const DOCUMENT_PRODUCTION_VALUE_USD = 140;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMoney(value: number) {
  return Number(Math.max(0, value).toFixed(2));
}

function roundHours(value: number) {
  return Number(Math.max(0, value).toFixed(1));
}

function getReportTextLength(report: Record<string, string>) {
  return Object.values(report).join("\n").trim().length;
}

function confidenceMultiplier(confidence: ReportConfidenceMetadata["overall_confidence"]) {
  if (confidence === "High") return 1.25;
  if (confidence === "Medium") return 1;
  return 0.72;
}

function classifyValue(score: number): AiRoiValueCategory {
  if (score >= 85) return "Exceptional Value";
  if (score >= 68) return "High Value";
  if (score >= 45) return "Medium Value";
  return "Low Value";
}

export function createAiRoiIntelligence(input: AiRoiInput): AiRoiIntelligence {
  const textLength = getReportTextLength(input.report);
  const reportDepthHours = Math.min(4.5, Math.max(1.5, textLength / 5_500));
  const baseResearchHours =
    input.operationType === "executive_report"
      ? 4.5
      : input.operationType === "plan_report"
        ? 4
        : 3.2;
  const sourceLift = Math.min(2.5, input.sources.source_count * 0.25);
  const evidenceLift = Math.min(2, input.evidence.evidence_count * 0.3);
  const validationPenalty = input.validation.validation_score < 55 ? 0.75 : 1;
  const researchHoursSaved = roundHours(
    (baseResearchHours + sourceLift + evidenceLift) * validationPenalty
  );
  const documentHoursSaved = roundHours(reportDepthHours + (input.validation.validation_score >= 70 ? 0.8 : 0.2));
  const estimatedHoursSaved = roundHours(researchHoursSaved + documentHoursSaved);
  const strategicMultiplier =
    1 +
    input.decision.decision_score / 250 +
    input.decision.impact_score / 300 -
    input.decision.execution_complexity / 500;
  const qualityMultiplier =
    confidenceMultiplier(input.confidence.overall_confidence) *
    (0.75 + Math.min(0.35, input.sources.average_source_score / 300));
  const researchValue = researchHoursSaved * HOURLY_RESEARCH_VALUE_USD;
  const productionValue = documentHoursSaved * DOCUMENT_PRODUCTION_VALUE_USD;
  const estimatedValueUsd = roundMoney(
    Math.max(75, (researchValue + productionValue) * strategicMultiplier * qualityMultiplier)
  );
  const costBasis = input.estimatedCostUsd > 0 ? input.estimatedCostUsd : 0.01;
  const roiRatio = Number((estimatedValueUsd / costBasis).toFixed(2));
  const roiScore = clampScore(
    Math.min(65, roiRatio / 4) +
      input.decision.decision_score * 0.22 +
      input.validation.validation_score * 0.12 +
      input.sources.average_source_score * 0.08
  );

  return {
    roi_score: roiScore,
    estimated_value_usd: estimatedValueUsd,
    estimated_hours_saved: estimatedHoursSaved,
    estimated_research_hours_saved: researchHoursSaved,
    estimated_document_production_value_usd: roundMoney(productionValue),
    roi_ratio: roiRatio,
    value_category: classifyValue(roiScore),
    roi_version: "v1",
  };
}
