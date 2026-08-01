import type { DecisionEvidence } from "../../decision-intelligence/contracts.ts";

export function scoreEvidenceConfidence(evidence: DecisionEvidence) {
  const base = Number.isFinite(evidence.confidence)
    ? Math.max(0, Math.min(100, evidence.confidence))
    : 0;
  const authorityWeight = evidence.official
    ? 1
    : evidence.authorityLevel === "secondary"
      ? 0.88
      : evidence.authorityLevel === "uploaded"
        ? 0.82
        : 0.72;
  const provenanceWeight = /^https?:\/\//i.test(evidence.url)
    ? 1
    : evidence.authorityLevel === "uploaded"
      ? 0.9
      : 0.5;
  const claimWeight = evidence.proposition?.trim() || evidence.summary.trim()
    ? 1
    : 0.5;

  return Math.round(base * authorityWeight * provenanceWeight * claimWeight);
}

export function scoreCollectionConfidence(evidence: DecisionEvidence[]) {
  if (!evidence.length) return 0;
  const scores = evidence.map(scoreEvidenceConfidence).sort((a, b) => b - a);
  const weighted = scores.reduce(
    (total, score, index) => total + score * Math.max(1, scores.length - index),
    0
  );
  const weights = scores.reduce(
    (total, _score, index) => total + Math.max(1, scores.length - index),
    0
  );
  return Math.round(weighted / weights);
}
