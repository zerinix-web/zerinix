import { logOperationalInfo } from "@/app/lib/security/logging";

export const REPORT_GENERATION_MAX_API_CALLS = 1;

export function assertReportApiCallBudget({
  logLabel,
  reportRequestId,
  aiCallsForReport,
  maxAiCallsPerReport = REPORT_GENERATION_MAX_API_CALLS,
}: {
  logLabel: string;
  reportRequestId: string;
  aiCallsForReport: number;
  maxAiCallsPerReport?: number;
}) {
  logOperationalInfo(logLabel, {
    reportRequestId,
    aiCallsForReport,
    maxAiCallsPerReport,
  });

  if (aiCallsForReport > maxAiCallsPerReport) {
    throw new Error(
      "AI call budget exceeded for this report. Please start a new report request."
    );
  }
}

export function calculateReportProgress(completedCount: number, totalCount: number) {
  if (totalCount <= 0) {
    return 0;
  }

  return (completedCount / totalCount) * 100;
}

export function serializeReportStreamChunk<TChunk extends Record<string, unknown>>(
  chunk: TChunk
) {
  return `${JSON.stringify(chunk)}\n`;
}
