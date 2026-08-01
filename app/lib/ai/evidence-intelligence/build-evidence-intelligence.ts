import type { ExpertiseProfile } from "../expertise-profile.ts";
import type {
  EvidenceScoringResult,
  ScoredEvidenceFinding,
} from "../evidence-scoring/contracts.ts";
import type { ValidatedEvidenceCollection } from "../research-execution/evidence-decision-support.ts";
import {
  evidenceIntelligenceResultSchema,
  type EvidenceIntelligenceConflict,
  type EvidenceIntelligenceResult,
  type StructuredEvidence,
} from "./contracts.ts";

type ValidatedFinding = ValidatedEvidenceCollection["findings"][number];
type ValidatedSource = ValidatedEvidenceCollection["sources"][number];

function clamp(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function unique(values: readonly string[], limit = 20) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    limit
  );
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function similarity(left: string, right: string) {
  const leftTokens = new Set(
    normalize(left).split(" ").filter((token) => token.length > 2)
  );
  const rightTokens = new Set(
    normalize(right).split(" ").filter((token) => token.length > 2)
  );
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function evidenceCategory(
  finding: ValidatedFinding,
  sources: readonly ValidatedSource[]
): StructuredEvidence["evidenceCategory"] {
  const text = normalize(
    `${finding.field} ${finding.claim} ${sources
      .map((source) => `${source.sourceType} ${source.title}`)
      .join(" ")}`
  );
  const mappings: Array<[
    StructuredEvidence["evidenceCategory"],
    RegExp,
  ]> = [
    ["Ownership", /\b(?:ownership|title|deed|encumbrance|lien|mortgage|tapu|takyidat|mülkiyet|malik)\b/i],
    ["Zoning", /\b(?:zoning|land use|planning|development right|imar|plan notu|yapılaşma)\b/i],
    ["Comparable Sales", /\b(?:comparable|listing|transaction|sale price|unit price|emsal|ilan|satış fiyatı|birim fiyat)\b/i],
    ["Transportation", /\b(?:transport|transit|road|rail|airport|highway|access|ulaşım|yol|erişim|otoyol)\b/i],
    ["Infrastructure", /\b(?:infrastructure|utility|electricity|water|sewer|telecom|altyapı|elektrik|kanalizasyon)\b/i],
    ["Environmental", /\b(?:environment|hazard|flood|earthquake|seismic|geotechnical|soil|afet|deprem|sel|taşkın|jeoloji|zemin)\b/i],
    ["Financial", /\b(?:financial|finance|revenue|profit|cash flow|cost|price|valuation|currency|mali|gelir|kâr|nakit|maliyet|değerleme)\b/i],
    ["Demographic", /\b(?:demographic|population|household|migration|nüfus|hane|göç)\b/i],
    ["Satellite", /\b(?:satellite|remote sensing|aerial|uydu|hava görüntüsü)\b/i],
    ["News", /\b(?:news|press|announcement|media|haber|basın|duyuru)\b/i],
    ["Legal", /\b(?:legal|law|statute|regulation|court|contract|compliance|hukuk|mevzuat|kanun|mahkeme|sözleşme|uyum)\b/i],
    ["Market", /\b(?:market|demand|supply|competition|customer|industry|liquidity|pazar|talep|arz|rekabet|müşteri|sektör|likidite)\b/i],
  ];
  return mappings.find(([, pattern]) => pattern.test(text))?.[0] || "Market";
}

function evidenceStatus(
  finding: ValidatedFinding
): StructuredEvidence["evidenceStatus"] {
  if (finding.conflictStatus === "conflicted") return "conflicting";
  if (finding.evidenceState === "unresolved") return "missing";
  if (["professional_inference", "assumption"].includes(finding.evidenceState)) {
    return "inferred";
  }
  if (
    ["officially_verified", "credible_secondary_source", "market_indication"].includes(
      finding.evidenceState
    ) && finding.sourceIds.length > 0
  ) {
    return "verified";
  }
  return "pending_verification";
}

function sourceFallback(finding: ValidatedFinding) {
  if (finding.evidenceState === "uploaded_document") return "Uploaded material";
  if (finding.evidenceState === "user_statement") return "User-provided information";
  if (["professional_inference", "assumption"].includes(finding.evidenceState)) {
    return "Professional inference";
  }
  return "No validated source";
}

function qualityScores(
  finding: ValidatedFinding,
  scored: ScoredEvidenceFinding,
  sources: readonly ValidatedSource[]
) {
  const sourceReliability = sources.length
    ? Math.max(...sources.map((source) => source.reliability))
    : finding.reliability;
  const reliabilityScore = clamp(
    (sourceReliability + scored.criteria.confidence) / 2
  );
  const freshnessScore = clamp(scored.criteria.recency);
  const authorityScore = clamp(scored.criteria.authority);
  const completenessScore = clamp(scored.criteria.completeness);
  const evidenceQualityScore = clamp(
    reliabilityScore * 0.35 +
      authorityScore * 0.3 +
      completenessScore * 0.2 +
      freshnessScore * 0.15
  );
  return {
    reliabilityScore,
    freshnessScore,
    authorityScore,
    completenessScore,
    evidenceQualityScore,
  };
}

function createStructuredEvidence({
  finding,
  scored,
  sources,
}: {
  finding: ValidatedFinding;
  scored: ScoredEvidenceFinding;
  sources: readonly ValidatedSource[];
}): StructuredEvidence {
  const quality = qualityScores(finding, scored, sources);
  const sourceNames = unique(sources.map((source) => source.publisher), 3);
  const sourceTypes = unique(sources.map((source) => source.sourceType), 3);
  const collectedAt = sources
    .map((source) => source.accessedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";

  return {
    id: finding.id,
    title:
      finding.claim.length > 140
        ? `${finding.claim.slice(0, 137).trimEnd()}…`
        : finding.claim,
    description: finding.reason,
    sourceName: sourceNames.join("; ") || sourceFallback(finding),
    sourceType: sourceTypes.join("; ") || finding.evidenceState,
    sourceAuthority: quality.authorityScore,
    evidenceCategory: evidenceCategory(finding, sources),
    evidenceStatus: evidenceStatus(finding),
    confidence: clamp(scored.criteria.confidence),
    freshness: quality.freshnessScore,
    collectedAt,
    supportsDecision: finding.impactDirection === "favorable",
    contradictsDecision: finding.impactDirection === "adverse",
    relatedRisks:
      finding.impactDirection === "adverse" ? [finding.claim] : [],
    relatedOpportunities:
      finding.impactDirection === "favorable" ? [finding.claim] : [],
    citations: sources.map((source) => ({
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      accessedAt: source.accessedAt,
    })),
    reliabilityScore: quality.reliabilityScore,
    freshnessScore: quality.freshnessScore,
    authorityScore: quality.authorityScore,
    completenessScore: quality.completenessScore,
    evidenceQualityScore: quality.evidenceQualityScore,
    quality,
    field: finding.field,
    decisionImpact: scored.decisionImpact,
    mergedEvidenceIds: [finding.id],
  };
}

function mergeDuplicateEvidence(evidence: StructuredEvidence[]) {
  const merged: StructuredEvidence[] = [];
  const originalToMerged = new Map<string, string>();

  for (const item of evidence) {
    const duplicate = merged.find(
      (candidate) =>
        candidate.field === item.field &&
        candidate.evidenceCategory === item.evidenceCategory &&
        candidate.supportsDecision === item.supportsDecision &&
        candidate.contradictsDecision === item.contradictsDecision &&
        similarity(candidate.title, item.title) >= 0.8
    );
    if (!duplicate) {
      merged.push({ ...item });
      originalToMerged.set(item.id, item.id);
      continue;
    }

    originalToMerged.set(item.id, duplicate.id);
    duplicate.mergedEvidenceIds = unique(
      [...duplicate.mergedEvidenceIds, ...item.mergedEvidenceIds],
      100
    );
    const citations = [...duplicate.citations, ...item.citations];
    duplicate.citations = citations.filter(
      (citation, index) =>
        citations.findIndex((candidate) => candidate.url === citation.url) === index
    );
    duplicate.sourceName = unique(
      [duplicate.sourceName, item.sourceName].flatMap((value) =>
        value.split(";")
      ),
      5
    ).join("; ");
    duplicate.sourceType = unique(
      [duplicate.sourceType, item.sourceType].flatMap((value) =>
        value.split(";")
      ),
      5
    ).join("; ");
    duplicate.relatedRisks = unique([
      ...duplicate.relatedRisks,
      ...item.relatedRisks,
    ]);
    duplicate.relatedOpportunities = unique([
      ...duplicate.relatedOpportunities,
      ...item.relatedOpportunities,
    ]);
    duplicate.quality = {
      reliabilityScore: Math.max(
        duplicate.quality.reliabilityScore,
        item.quality.reliabilityScore
      ),
      freshnessScore: Math.max(
        duplicate.quality.freshnessScore,
        item.quality.freshnessScore
      ),
      authorityScore: Math.max(
        duplicate.quality.authorityScore,
        item.quality.authorityScore
      ),
      completenessScore: clamp(
        Math.max(
          duplicate.quality.completenessScore,
          item.quality.completenessScore
        ) + (duplicate.citations.length > 1 ? 0.05 : 0)
      ),
      evidenceQualityScore: 0,
    };
    duplicate.quality.evidenceQualityScore = clamp(
      duplicate.quality.reliabilityScore * 0.35 +
        duplicate.quality.authorityScore * 0.3 +
        duplicate.quality.completenessScore * 0.2 +
        duplicate.quality.freshnessScore * 0.15
    );
    duplicate.reliabilityScore = duplicate.quality.reliabilityScore;
    duplicate.freshnessScore = duplicate.quality.freshnessScore;
    duplicate.authorityScore = duplicate.quality.authorityScore;
    duplicate.completenessScore = duplicate.quality.completenessScore;
    duplicate.evidenceQualityScore = duplicate.quality.evidenceQualityScore;
    duplicate.confidence = Math.max(duplicate.confidence, item.confidence);
    duplicate.sourceAuthority = duplicate.quality.authorityScore;
    duplicate.freshness = duplicate.quality.freshnessScore;
    duplicate.collectedAt = [duplicate.collectedAt, item.collectedAt]
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  }
  return { evidence: merged, originalToMerged };
}

function hasSemanticConflict(left: StructuredEvidence, right: StructuredEvidence) {
  if (
    left.id === right.id ||
    left.field !== right.field ||
    left.evidenceCategory !== right.evidenceCategory
  ) {
    return false;
  }
  if (
    left.supportsDecision !== right.supportsDecision &&
    left.contradictsDecision !== right.contradictsDecision
  ) {
    return true;
  }
  const a = normalize(left.title);
  const b = normalize(right.title);
  const negation = /\b(?:not|no|without|prohibited|denied|değil|yok|yasak|bulunmuyor)\b/i;
  if (
    similarity(a.replace(negation, ""), b.replace(negation, "")) >= 0.65 &&
    negation.test(a) !== negation.test(b)
  ) {
    return true;
  }
  if (left.evidenceCategory === "Zoning") {
    const residential = /\b(?:residential|housing|konut)\b/i;
    const agricultural = /\b(?:agricultural|agriculture|farmland|tarım|tarla)\b/i;
    return (
      residential.test(a) && agricultural.test(b) ||
      agricultural.test(a) && residential.test(b)
    );
  }
  return false;
}

function conflictFromEvidence(
  id: string,
  left: StructuredEvidence,
  right: StructuredEvidence
): EvidenceIntelligenceConflict {
  const qualityGap = clamp(
    Math.abs(
      left.quality.evidenceQualityScore - right.quality.evidenceQualityScore
    )
  );
  const preferred =
    qualityGap >= 0.1
      ? left.quality.evidenceQualityScore > right.quality.evidenceQualityScore
        ? left
        : right
      : undefined;
  return {
    id,
    evidenceCategory: left.evidenceCategory,
    field: left.field,
    evidenceIds: [left.id, right.id],
    competingClaims: [left.title, right.title],
    sourceNames: unique([left.sourceName, right.sourceName]),
    preferredEvidenceId: preferred?.id || "",
    status: preferred ? "resolved_by_quality" : "unresolved",
    qualityGap,
    explanation: preferred
      ? `${preferred.title} has the stronger combined reliability, authority, freshness, and completeness score. The competing claim remains recorded and should be reconciled against the controlling source.`
      : "The evidence quality difference is not sufficient to prefer either claim. A more authoritative, current, and directly relevant source is required.",
  };
}

function buildConflicts({
  evidence,
  originalToMerged,
  scoringConflicts,
}: {
  evidence: StructuredEvidence[];
  originalToMerged: Map<string, string>;
  scoringConflicts: EvidenceScoringResult["conflicts"];
}) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const conflicts: EvidenceIntelligenceConflict[] = [];
  const seenPairs = new Set<string>();
  const addPair = (leftId: string, rightId: string) => {
    if (leftId === rightId) return;
    const pair = [leftId, rightId].sort().join("|");
    if (seenPairs.has(pair)) return;
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    if (!left || !right) return;
    seenPairs.add(pair);
    conflicts.push(
      conflictFromEvidence(`evidence_conflict_${conflicts.length + 1}`, left, right)
    );
    left.evidenceStatus = "conflicting";
    right.evidenceStatus = "conflicting";
  };

  for (const conflict of scoringConflicts) {
    const ids = unique(
      conflict.findingIds.map((id) => originalToMerged.get(id) || id)
    );
    for (let index = 1; index < ids.length; index += 1) {
      addPair(ids[0], ids[index]);
    }
  }
  for (let leftIndex = 0; leftIndex < evidence.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < evidence.length;
      rightIndex += 1
    ) {
      if (hasSemanticConflict(evidence[leftIndex], evidence[rightIndex])) {
        addPair(evidence[leftIndex].id, evidence[rightIndex].id);
      }
    }
  }
  return conflicts;
}

function evidenceCoverage(validation: ValidatedEvidenceCollection) {
  const gateUnits = validation.decisionGates.map((gate) =>
    gate.status === "unresolved" ? 0 : 1
  );
  const sectionUnits = validation.sectionSupport.map((section) =>
    section.supportedFindingIds.length > 0 ? 1 : 0
  );
  const units = [...gateUnits, ...sectionUnits];
  if (units.length) {
    return Math.round(
      (units.reduce<number>((total, value) => total + value, 0) / units.length) * 100
    );
  }
  if (!validation.findings.length) return 0;
  return Math.round(
    (validation.findings.filter((finding) => finding.evidenceState !== "unresolved")
      .length /
      validation.findings.length) *
      100
  );
}

function average(
  evidence: readonly StructuredEvidence[],
  selector: (item: StructuredEvidence) => number
) {
  if (!evidence.length) return 0;
  return clamp(
    evidence.reduce((total, item) => total + selector(item), 0) /
      evidence.length
  );
}

export function buildEvidenceIntelligence({
  validation,
  scoredFindings,
  scoringConflicts,
}: {
  validation: ValidatedEvidenceCollection;
  scoredFindings: ScoredEvidenceFinding[];
  scoringConflicts: EvidenceScoringResult["conflicts"];
  domain: ExpertiseProfile["domain"];
}): EvidenceIntelligenceResult {
  const sourceById = new Map(
    validation.sources.map((source) => [source.id, source])
  );
  const findingById = new Map(
    validation.findings.map((finding) => [finding.id, finding])
  );
  const structured = scoredFindings.flatMap((scored) => {
    const finding = findingById.get(scored.id);
    if (!finding) return [];
    const sources = finding.sourceIds
      .map((sourceId) => sourceById.get(sourceId))
      .filter((source): source is ValidatedSource => Boolean(source));
    return [createStructuredEvidence({ finding, scored, sources })];
  });
  const merged = mergeDuplicateEvidence(structured);
  const conflicts = buildConflicts({
    evidence: merged.evidence,
    originalToMerged: merged.originalToMerged,
    scoringConflicts,
  });
  const missingEvidence = unique([
    ...validation.unresolvedQuestions,
    ...validation.findings
      .filter((finding) => finding.evidenceState === "unresolved")
      .map((finding) => finding.claim),
    ...validation.decisionGates
      .filter((gate) => gate.status === "unresolved")
      .map((gate) => gate.condition),
  ]);
  const criticalUnknowns = unique([
    ...validation.decisionGates
      .filter(
        (gate) =>
          gate.status === "unresolved" && gate.decisionImpact === "critical"
      )
      .map((gate) => gate.condition),
    ...conflicts
      .filter((conflict) => conflict.status === "unresolved")
      .map((conflict) => `Unresolved conflict: ${conflict.field}`),
  ]);
  const verified = merged.evidence.filter(
    (item) => item.evidenceStatus === "verified"
  );
  const pending = merged.evidence.filter((item) =>
    ["pending_verification", "inferred", "missing"].includes(
      item.evidenceStatus
    )
  );

  return evidenceIntelligenceResultSchema.parse({
    version: "evidence_intelligence_v2",
    evidence: merged.evidence,
    conflicts,
    summary: {
      verifiedFacts: verified.map((item) => ({
        evidenceId: item.id,
        statement: item.title,
      })),
      pendingVerification: pending.map((item) => ({
        evidenceId: item.id,
        statement: item.title,
      })),
      conflictingEvidence: conflicts.map((conflict) => ({
        conflictId: conflict.id,
        statement: conflict.competingClaims.join(" ↔ "),
      })),
      missingEvidence,
      criticalUnknowns,
      evidenceCoverage: evidenceCoverage(validation),
      averageEvidenceQuality: average(
        merged.evidence,
        (item) => item.quality.evidenceQualityScore
      ),
      averageAuthority: average(
        merged.evidence,
        (item) => item.quality.authorityScore
      ),
      averageFreshness: average(
        merged.evidence,
        (item) => item.quality.freshnessScore
      ),
    },
  });
}
