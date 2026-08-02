export type AggregateEvidenceCandidate = {
  claim: string;
  value: string;
  sourceTitle: string;
  url: string;
  label: string;
  confidence: number;
  qualityScore?: number;
  authorityLevel: string;
};

export type AggregateEvidenceMetrics = {
  usableEvidenceCount: number;
  verifiedSources: number;
  sourceDiversity: number;
  averageQuality: number;
  confidenceScore: number;
  reportDecision: "allow_report" | "clarification";
};

const LEGACY_SINGLE_SOURCE_QUALITY_THRESHOLD = 45;
const MEDIUM_SOURCE_QUALITY_FLOOR = 35;
const AGGREGATE_AVERAGE_QUALITY_THRESHOLD = 38;
const AGGREGATE_CONFIDENCE_THRESHOLD = 55;
const MINIMUM_REPORT_CONFIDENCE = 35;

function roundedAverage(values: number[]) {
  if (!values.length) return 0;
  return Math.round(
    values.reduce((total, value) => total + value, 0) / values.length
  );
}

function canonicalExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function isExternalEvidence(item: AggregateEvidenceCandidate) {
  return (
    item.label === "Verified from official source" ||
    item.label === "Verified from external source"
  );
}

function isVerifiedEvidence(item: AggregateEvidenceCandidate) {
  return (
    isExternalEvidence(item) ||
    item.label === "Verified from uploaded asset"
  );
}

function hasUsableShape(item: AggregateEvidenceCandidate) {
  if (!item.claim.trim() || !item.value.trim() || !item.sourceTitle.trim()) {
    return false;
  }
  return !isExternalEvidence(item) || Boolean(canonicalExternalUrl(item.url));
}

function evidenceQuality(item: AggregateEvidenceCandidate) {
  return Math.max(
    0,
    Math.min(100, item.qualityScore ?? item.confidence ?? 0)
  );
}

function metricsFor(
  evidence: AggregateEvidenceCandidate[],
  reportDecision: AggregateEvidenceMetrics["reportDecision"]
): AggregateEvidenceMetrics {
  const usable = evidence.filter(
    (item) => hasUsableShape(item) && isVerifiedEvidence(item)
  );
  const external = usable.filter(isExternalEvidence);
  const urls = new Set(
    external.map((item) => canonicalExternalUrl(item.url)).filter(Boolean)
  );
  const domains = new Set(
    [...urls].flatMap((value) => {
      try {
        return [new URL(value).hostname.replace(/^www\./i, "")];
      } catch {
        return [];
      }
    })
  );

  return {
    usableEvidenceCount: usable.length,
    verifiedSources: urls.size,
    sourceDiversity: domains.size,
    averageQuality: roundedAverage(usable.map(evidenceQuality)),
    confidenceScore: roundedAverage(
      usable.map((item) => Math.max(0, Math.min(100, item.confidence || 0)))
    ),
    reportDecision,
  };
}

/**
 * Preserves the strict provenance checks performed before this function while
 * replacing the former one-source quality cutoff with an aggregate decision.
 * A strong source still qualifies independently. Medium-quality evidence only
 * qualifies when at least two independent domains corroborate it and both its
 * average quality and confidence clear conservative floors.
 */
export function evaluateAggregateResearchEvidence<
  T extends AggregateEvidenceCandidate,
>(evidence: T[]) {
  const structurallyUsable = evidence.filter(hasUsableShape);
  const preservedNonExternal = structurallyUsable.filter(
    (item) => !isExternalEvidence(item)
  );
  const trustedUploadedEvidence = preservedNonExternal.filter(
    (item) => item.label === "Verified from uploaded asset"
  );
  const external = structurallyUsable.filter(isExternalEvidence);
  const legacyAcceptedExternal = external.filter(
    (item) => evidenceQuality(item) >= LEGACY_SINGLE_SOURCE_QUALITY_THRESHOLD
  );
  const mediumOrBetterExternal = external.filter(
    (item) => evidenceQuality(item) >= MEDIUM_SOURCE_QUALITY_FLOOR
  );
  const mediumMetrics = metricsFor(mediumOrBetterExternal, "clarification");
  const aggregateSupportIsSufficient =
    mediumOrBetterExternal.length >= 2 &&
    mediumMetrics.sourceDiversity >= 2 &&
    mediumMetrics.averageQuality >= AGGREGATE_AVERAGE_QUALITY_THRESHOLD &&
    mediumMetrics.confidenceScore >= AGGREGATE_CONFIDENCE_THRESHOLD;
  const acceptedExternal = aggregateSupportIsSufficient
    ? mediumOrBetterExternal
    : legacyAcceptedExternal;
  const acceptedEvidence = [...preservedNonExternal, ...acceptedExternal];
  const beforeDecision =
    trustedUploadedEvidence.length + legacyAcceptedExternal.length > 0
      ? "allow_report"
      : "clarification";
  const preliminaryAfter = metricsFor(acceptedEvidence, "clarification");

  // Fail only when evidence, verified sources, and aggregate confidence are all
  // below their minimums. Any admitted evidence remains subject to downstream
  // claim validation and cannot bypass citation/provenance enforcement.
  const afterDecision =
    preliminaryAfter.usableEvidenceCount === 0 &&
    preliminaryAfter.verifiedSources === 0 &&
    preliminaryAfter.confidenceScore < MINIMUM_REPORT_CONFIDENCE
      ? "clarification"
      : "allow_report";

  return {
    acceptedEvidence,
    aggregateSupportIsSufficient,
    before: metricsFor(
      [...trustedUploadedEvidence, ...legacyAcceptedExternal],
      beforeDecision
    ),
    after: metricsFor(acceptedEvidence, afterDecision),
  };
}

export const researchEvidenceThresholds = {
  legacySingleSourceQuality: LEGACY_SINGLE_SOURCE_QUALITY_THRESHOLD,
  mediumSourceQualityFloor: MEDIUM_SOURCE_QUALITY_FLOOR,
  aggregateAverageQuality: AGGREGATE_AVERAGE_QUALITY_THRESHOLD,
  aggregateConfidence: AGGREGATE_CONFIDENCE_THRESHOLD,
  minimumReportConfidence: MINIMUM_REPORT_CONFIDENCE,
} as const;
