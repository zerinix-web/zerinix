import type { ReportMetadata } from "../report-investment-score.ts";

// Reads the ZERINIX Executive Decision System's own, already-computed
// report metadata (attached additively by app/lib/report-jobs/worker.ts
// -- reportQualityValidation, reportConsistencyCheck, reportAuditTrail,
// reportExplainability, reportReproducibility, reportVersion) into a
// small, display-ready summary shared by both the dashboard report
// viewer and PDF generation. Returns null when none of those six
// fields is actually present (true for every report today, since the
// pipeline is still behind a disabled-by-default flag) -- every field
// read here is a direct passthrough of a real, already-computed value,
// never derived or guessed. The reproducibility fingerprint is never
// surfaced in full (it's an internal 64-character hash); only a short,
// display-safe excerpt is exposed.
//
// This module makes no network/AI calls. Kept alongside its 6 sibling
// report-engine modules (whose real output it exclusively reads) rather
// than in app/lib/report-presentation.ts, so it can be imported and
// tested directly as a plain ES module -- report-presentation.ts has a
// pre-existing runtime dependency on an "@/"-aliased import that only
// resolves under the Next.js bundler, not under plain `node --test`.

export type ExecutiveDecisionIntelligenceSummary = {
  recommendation: string | null;
  verdict: string | null;
  aggregateConfidence: number | null;
  qualityPassed: boolean | null;
  consistencyPassed: boolean | null;
  auditTrail: { present: boolean; generatedAt: string | null; pipelineVersion: string | null };
  explainability: { present: boolean; explanationCount: number };
  reproducibility: {
    present: boolean;
    status: "fingerprinted" | "insufficient_data" | null;
    selfCheckPassed: boolean | null;
    fingerprintExcerpt: string | null;
  };
  version: { present: boolean; reportSchemaVersion: string | null; executiveDecisionSystemVersion: string | null };
};

export function readExecutiveDecisionIntelligenceSummary(
  metadata?: ReportMetadata
): ExecutiveDecisionIntelligenceSummary | null {
  const qualityValidation = metadata?.reportQualityValidation;
  const consistencyCheck = metadata?.reportConsistencyCheck;
  const auditTrail = metadata?.reportAuditTrail;
  const explainability = metadata?.reportExplainability;
  const reproducibility = metadata?.reportReproducibility;
  const version = metadata?.reportVersion;

  const anyPresent =
    Boolean(qualityValidation?.validated) ||
    Boolean(consistencyCheck?.checked) ||
    Boolean(auditTrail?.generated) ||
    Boolean(explainability?.generated) ||
    Boolean(reproducibility?.generated) ||
    Boolean(version?.generated);

  if (!anyPresent) {
    return null;
  }

  const confidenceSection = auditTrail?.generated
    ? auditTrail.sections.find((section) => section.section === "confidence")
    : undefined;
  const recommendationExplanation = explainability?.generated
    ? explainability.explanations.find((item) => item.type === "recommendation")
    : undefined;
  const verdictExplanation = explainability?.generated
    ? explainability.explanations.find((item) => item.type === "verdict")
    : undefined;
  const fingerprint = reproducibility?.generated ? reproducibility.fingerprint : null;

  return {
    recommendation: recommendationExplanation?.statement ?? null,
    verdict: verdictExplanation?.statement ?? null,
    aggregateConfidence: confidenceSection?.confidenceDerivation.value ?? null,
    qualityPassed: qualityValidation?.validated ? qualityValidation.passed : null,
    consistencyPassed: consistencyCheck?.checked ? consistencyCheck.consistent : null,
    auditTrail: {
      present: Boolean(auditTrail?.generated),
      generatedAt: auditTrail?.generated ? auditTrail.generatedAt : null,
      pipelineVersion: auditTrail?.generated ? auditTrail.pipelineVersion : null,
    },
    explainability: {
      present: Boolean(explainability?.generated),
      explanationCount: explainability?.generated ? explainability.explanations.length : 0,
    },
    reproducibility: {
      present: Boolean(reproducibility?.generated),
      status: reproducibility?.generated ? reproducibility.status : null,
      selfCheckPassed: reproducibility?.generated ? reproducibility.selfCheckPassed : null,
      fingerprintExcerpt: fingerprint ? `${fingerprint.slice(0, 12)}…` : null,
    },
    version: {
      present: Boolean(version?.generated),
      reportSchemaVersion: version?.generated ? version.reportSchemaVersion : null,
      executiveDecisionSystemVersion: version?.generated ? version.executiveDecisionSystemVersion : null,
    },
  };
}
