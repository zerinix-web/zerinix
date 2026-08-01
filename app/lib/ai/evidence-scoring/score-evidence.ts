import type { ExpertiseProfile } from "../expertise-profile.ts";
import type { ValidatedEvidenceCollection } from "../research-execution/evidence-decision-support.ts";
import {
  evidenceScoringResultSchema,
  type EvidenceScoringResult,
  type ScoredEvidenceFinding,
} from "./contracts.ts";

type Finding = ValidatedEvidenceCollection["findings"][number];
type Source = ValidatedEvidenceCollection["sources"][number];

const DEFAULT_WEIGHTS = {
  relevance: 0.25,
  confidence: 0.2,
  recency: 0.1,
  authority: 0.2,
  completeness: 0.15,
  consistency: 0.1,
} as const;

const stateCaps: Record<Finding["evidenceState"], number> = {
  officially_verified: 1,
  uploaded_document: 0.82,
  credible_secondary_source: 0.8,
  market_indication: 0.68,
  user_statement: 0.5,
  professional_inference: 0.48,
  assumption: 0.34,
  unresolved: 0.15,
};

function clamp(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function weightsFor(domain: ExpertiseProfile["domain"], field: string) {
  if (
    domain === "real_estate" &&
    /(?:title|ownership|encumbrance|zoning|access)/i.test(field)
  ) {
    return {
      relevance: 0.25,
      confidence: 0.2,
      recency: 0.05,
      authority: 0.3,
      completeness: 0.15,
      consistency: 0.05,
    };
  }
  if (
    /(?:comparable|listing|rent|sale|price|market|liquidity)/i.test(field)
  ) {
    return {
      relevance: 0.25,
      confidence: 0.18,
      recency: 0.2,
      authority: 0.15,
      completeness: 0.12,
      consistency: 0.1,
    };
  }
  if (domain === "legal" && /(?:law|rule|statute|case|deadline|jurisdiction)/i.test(field)) {
    return {
      relevance: 0.25,
      confidence: 0.2,
      recency: 0.08,
      authority: 0.27,
      completeness: 0.12,
      consistency: 0.08,
    };
  }
  return DEFAULT_WEIGHTS;
}

function numericConfidence(finding: Finding, sources: Source[]) {
  const stated = typeof finding.confidence === "number"
    ? finding.confidence
    : ({
    Strong: 0.86,
    Moderate: 0.68,
    Preliminary: 0.48,
    "Insufficient Evidence": 0.15,
    "Verification Required": 0.3,
      }[finding.confidence]);
  const provenanceReliability = sources.length
    ? Math.max(...sources.map((source) => source.reliability))
    : finding.reliability;
  return Math.min(stated, finding.reliability, provenanceReliability);
}

function recencyScore(sources: Source[], finding: Finding) {
  const dates = sources
    .map((source) => source.publishedDate || source.accessedAt)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (!dates.length) {
    return finding.evidenceState === "uploaded_document" ? 0.7 :
      finding.evidenceState === "user_statement" ? 0.45 : 0.5;
  }
  const newest = Math.max(...dates);
  const ageDays = Math.max(0, (Date.now() - newest) / (1000 * 60 * 60 * 24));
  if (ageDays <= 365) return 1;
  if (ageDays <= 365 * 3) return 0.85;
  if (ageDays <= 365 * 5) return 0.68;
  return 0.5;
}

function authorityScore(sources: Source[], finding: Finding) {
  if (sources.length) return Math.max(...sources.map((source) => source.authority));
  return {
    officially_verified: 0.95,
    uploaded_document: 0.78,
    credible_secondary_source: 0.7,
    market_indication: 0.5,
    user_statement: 0.35,
    professional_inference: 0.3,
    assumption: 0.15,
    unresolved: 0,
  }[finding.evidenceState];
}

function completenessScore(finding: Finding, sources: Source[]) {
  const claim = finding.claim.trim();
  const reason = finding.reason.trim();
  const claimComponent = claim.length >= 40 ? 0.35 : claim.length >= 15 ? 0.25 : 0.1;
  const reasonComponent = reason.length >= 30 ? 0.2 : reason.length ? 0.1 : 0;
  const provenanceRequired = [
    "officially_verified",
    "credible_secondary_source",
    "market_indication",
  ].includes(finding.evidenceState);
  const provenanceComponent = provenanceRequired
    ? sources.length > 0 ? 0.35 : 0
    : 0.25;
  const stateComponent = finding.evidenceState === "unresolved" ? 0 : 0.1;
  return clamp(claimComponent + reasonComponent + provenanceComponent + stateComponent);
}

function consistencyScore(finding: Finding, sources: Source[]) {
  if (finding.conflictStatus === "conflicted") return 0.3;
  if (sources.length >= 2) return 1;
  if (sources.length === 1) return 0.76;
  if (finding.evidenceState === "uploaded_document") return 0.68;
  if (finding.evidenceState === "user_statement") return 0.45;
  if (finding.evidenceState === "unresolved") return 0.2;
  return 0.5;
}

function scoreBand(score: number): ScoredEvidenceFinding["scoreBand"] {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function scoreFinding({
  finding,
  sources,
  domain,
}: {
  finding: Finding;
  sources: Source[];
  domain: ExpertiseProfile["domain"];
}): ScoredEvidenceFinding {
  const criteria = {
    relevance: clamp(finding.relevance),
    confidence: clamp(numericConfidence(finding, sources)),
    recency: clamp(recencyScore(sources, finding)),
    authority: clamp(authorityScore(sources, finding)),
    completeness: clamp(completenessScore(finding, sources)),
    consistency: clamp(consistencyScore(finding, sources)),
  };
  const weights = weightsFor(domain, finding.field);
  const weighted = Object.entries(criteria).reduce(
    (total, [criterion, value]) =>
      total + value * weights[criterion as keyof typeof weights],
    0
  );
  const conflictPenalty = finding.conflictStatus === "conflicted" ? 0.72 : 1;
  const finalEvidenceScore = clamp(
    weighted * stateCaps[finding.evidenceState] * conflictPenalty
  );
  const weakest = Object.entries(criteria).sort((left, right) => left[1] - right[1])[0];
  const strongest = Object.entries(criteria).sort((left, right) => right[1] - left[1])[0];

  return {
    id: finding.id,
    field: finding.field,
    claim: finding.claim,
    evidenceState: finding.evidenceState,
    sourceIds: finding.sourceIds,
    criteria,
    finalEvidenceScore,
    scoreBand: scoreBand(finalEvidenceScore),
    decisionImpact: finding.decisionImpact,
    conflictStatus: finding.conflictStatus,
    scoreExplanation: `Strongest criterion: ${strongest[0]} (${strongest[1]}). Limiting criterion: ${weakest[0]} (${weakest[1]}). Evidence state cap: ${stateCaps[finding.evidenceState]}.`,
  };
}

function compareConflicts(
  validation: ValidatedEvidenceCollection,
  findings: ScoredEvidenceFinding[]
) {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return validation.conflicts.map((conflict) => {
    const ranked = conflict.findingIds
      .map((id) => byId.get(id))
      .filter((finding): finding is ScoredEvidenceFinding => Boolean(finding))
      .sort((left, right) => right.finalEvidenceScore - left.finalEvidenceScore);
    const gap = ranked.length >= 2
      ? clamp(ranked[0].finalEvidenceScore - ranked[1].finalEvidenceScore)
      : 0;
    const hasReliableWinner = ranked.length >= 2 && gap >= 0.1 && ranked[0].scoreBand !== "low";
    return {
      conflictId: conflict.id,
      field: conflict.field,
      findingIds: ranked.map((finding) => finding.id),
      preferredFindingId: hasReliableWinner ? ranked[0].id : "",
      confidenceGap: gap,
      resolution: hasReliableWinner
        ? "higher_scoring_evidence_preferred" as const
        : "no_reliable_winner" as const,
      explanation: hasReliableWinner
        ? `The higher-scoring claim is more reliable because its combined authority, relevance, recency, completeness, confidence, and consistency score is ${ranked[0].finalEvidenceScore}, compared with ${ranked[1].finalEvidenceScore}. The conflicting claim remains visible.`
        : "The score difference is not sufficient to prefer either claim safely. Both remain unresolved until a more authoritative or specific source resolves the conflict.",
    };
  });
}

export function scoreValidatedEvidence({
  validation,
  domain,
}: {
  validation: ValidatedEvidenceCollection;
  domain: ExpertiseProfile["domain"];
}): EvidenceScoringResult {
  const sourceById = new Map(validation.sources.map((source) => [source.id, source]));
  const findings = validation.findings
    .map((finding) =>
      scoreFinding({
        finding,
        sources: finding.sourceIds
          .map((sourceId) => sourceById.get(sourceId))
          .filter((source): source is Source => Boolean(source)),
        domain,
      })
    )
    .sort((left, right) => right.finalEvidenceScore - left.finalEvidenceScore);

  return evidenceScoringResultSchema.parse({
    version: "evidence_scoring_v1",
    findings,
    bands: {
      high: findings.filter((finding) => finding.scoreBand === "high").map((finding) => finding.id),
      medium: findings.filter((finding) => finding.scoreBand === "medium").map((finding) => finding.id),
      low: findings.filter((finding) => finding.scoreBand === "low").map((finding) => finding.id),
    },
    conflicts: compareConflicts(validation, findings),
  });
}
