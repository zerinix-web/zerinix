import type { AiFinancialModelContext } from "@/app/lib/ai/financial-assumptions";
import { createAiBusinessImpactIntelligence } from "@/app/lib/ai-business-impact-intelligence";
import { createAiOutcomeIntelligence } from "@/app/lib/ai-outcome-intelligence";
import { createAiRoiIntelligence } from "@/app/lib/ai-roi-intelligence";
import { createExecutiveDecisionIntelligence } from "@/app/lib/executive-decision-intelligence";
import { createFounderOperatingSystem } from "@/app/lib/founder-operating-system";
import { aggregateReportEvidence } from "@/app/lib/live-evidence";
import { createMarketIntelligence } from "@/app/lib/market-intelligence";
import { evaluateReportConfidence } from "@/app/lib/report-confidence";
import { createReportPersonalization } from "@/app/lib/report-personalization";
import { scoreReportSources } from "@/app/lib/source-reliability";
import { analyzeReportSourceIntelligence, collectSourceFieldText } from "@/app/lib/report-source-intelligence";
import { validateReportSections } from "./validation";

type ReportMetadataOperationType = "plan_report" | "market_report";

export function createReportMetadataContext({
  prompt,
  report,
  context,
  operationType,
  estimatedCostUsd,
}: {
  prompt: string;
  report: Record<string, string>;
  context: AiFinancialModelContext;
  operationType: ReportMetadataOperationType;
  estimatedCostUsd: number;
}) {
  const reportValidation = validateReportSections(report);
  const sourceReliability = scoreReportSources(report);
  const sourceIntelligence = analyzeReportSourceIntelligence(collectSourceFieldText(report));
  const liveEvidence = aggregateReportEvidence({ report });
  const reportConfidence = evaluateReportConfidence({
    report,
    validation: reportValidation,
    sources: sourceReliability,
  });
  const decisionIntelligence = createExecutiveDecisionIntelligence({
    report,
    validation: reportValidation,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
  });
  const marketIntelligence = createMarketIntelligence({
    report,
    context,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
    decision: decisionIntelligence,
  });
  const roiIntelligence = createAiRoiIntelligence({
    operationType,
    estimatedCostUsd,
    report,
    validation: reportValidation,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
    decision: decisionIntelligence,
  });
  const businessImpactIntelligence = createAiBusinessImpactIntelligence({
    report,
    validation: reportValidation,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
    decision: decisionIntelligence,
    roi: roiIntelligence,
  });
  const outcomeIntelligence = createAiOutcomeIntelligence({
    validation: reportValidation,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
    decision: decisionIntelligence,
    roi: roiIntelligence,
    businessImpact: businessImpactIntelligence,
  });
  const founderOperatingSystem = createFounderOperatingSystem({
    validation: reportValidation,
    sources: sourceReliability,
    evidence: liveEvidence,
    confidence: reportConfidence,
    decision: decisionIntelligence,
    roi: roiIntelligence,
    businessImpact: businessImpactIntelligence,
    outcome: outcomeIntelligence,
    market: marketIntelligence,
  });
  const reportPersonalization = createReportPersonalization({
    prompt,
    report,
    context,
    confidence: reportConfidence,
    sources: sourceReliability,
    decision: decisionIntelligence,
    market: marketIntelligence,
    founderOs: founderOperatingSystem,
  });

  return {
    reportValidation,
    sourceReliability,
    // Per-source detail (type, trust level, freshness, explanation,
    // deduplicated reference ids) -- an array, so it is kept as its
    // own named field below rather than spread like the other,
    // flat-object metadata bundles.
    sourceIntelligence,
    liveEvidence,
    reportConfidence,
    decisionIntelligence,
    marketIntelligence,
    roiIntelligence,
    businessImpactIntelligence,
    outcomeIntelligence,
    founderOperatingSystem,
    reportPersonalization,
  };
}

export function flattenReportMetadataForUsage(
  metadata: ReturnType<typeof createReportMetadataContext>
) {
  return {
    ...metadata.reportValidation,
    ...metadata.sourceReliability,
    sourceIntelligence: metadata.sourceIntelligence,
    ...metadata.liveEvidence,
    ...metadata.reportConfidence,
    ...metadata.decisionIntelligence,
    ...metadata.marketIntelligence,
    ...metadata.roiIntelligence,
    ...metadata.businessImpactIntelligence,
    ...metadata.outcomeIntelligence,
    ...metadata.founderOperatingSystem,
    ...metadata.reportPersonalization,
  };
}

