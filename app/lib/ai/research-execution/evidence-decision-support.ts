import { z } from "zod";
import type { DecisionEvidence, ExtractedFact } from "../../decision-intelligence/contracts.ts";
import type { DynamicReportPlan } from "../dynamic-report-plan.ts";
import type { EvidenceCollection } from "./contracts.ts";
import { sanitizeUntrustedResearchText } from "./evidence-validator.ts";

export const evidenceStateSchema = z.enum([
  "user_statement",
  "uploaded_document",
  "officially_verified",
  "credible_secondary_source",
  "market_indication",
  "professional_inference",
  "assumption",
  "unresolved",
]);

const qualitativeConfidenceSchema = z.enum([
  "Strong",
  "Moderate",
  "Preliminary",
  "Insufficient Evidence",
  "Verification Required",
]);

export const validatedEvidenceSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  sourceType: z.string().min(1),
  authority: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  publishedDate: z.string(),
  accessedAt: z.string(),
});

export const validatedEvidenceFindingSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  claim: z.string().min(1),
  evidenceState: evidenceStateSchema,
  sourceIds: z.array(z.string()),
  relevance: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  confidence: z.union([z.number().min(0).max(1), qualitativeConfidenceSchema]),
  conflictStatus: z.enum(["none", "conflicted"]),
  decisionImpact: z.enum(["critical", "high", "medium", "low", "unknown"]),
  impactDirection: z.enum(["favorable", "neutral", "adverse", "unknown"]),
  reason: z.string().min(1),
});

export const evidenceConflictSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  findingIds: z.array(z.string()).min(2),
  sourceIds: z.array(z.string()),
  comparison: z.object({
    authority: z.string().min(1),
    date: z.string().min(1),
    relevance: z.string().min(1),
    specificity: z.string().min(1),
  }),
  decisionImpact: z.enum(["critical", "high", "medium", "low"]),
  resolutionRequired: z.string().min(1),
});

export const decisionGateSupportSchema = z.object({
  id: z.string().min(1),
  condition: z.string().min(1),
  status: z.enum(["passed", "failed", "unresolved"]),
  supportingFindingIds: z.array(z.string()),
  requiredEvidenceFields: z.array(z.string()),
  decisionImpact: z.enum(["critical", "high"]),
  requiredNextAction: z.string().min(1),
});

export const sectionDecisionSupportSchema = z.object({
  sectionId: z.string().min(1),
  supportedFindingIds: z.array(z.string()),
  unresolvedFindings: z.array(z.string()),
  risks: z.array(z.string()),
  opportunities: z.array(z.string()),
  conflictIds: z.array(z.string()),
  decisionImpact: z.enum(["critical", "high", "medium", "low"]),
});

export const validatedEvidenceCollectionSchema = z.object({
  version: z.literal("evidence_validation_v1"),
  selectedMode: z.enum(["plan", "market", "chat"]),
  findings: z.array(validatedEvidenceFindingSchema),
  sources: z.array(validatedEvidenceSourceSchema),
  conflicts: z.array(evidenceConflictSchema),
  unresolvedQuestions: z.array(z.string()),
  decisionGates: z.array(decisionGateSupportSchema),
  sectionSupport: z.array(sectionDecisionSupportSchema),
  overallEvidenceQuality: z.enum([
    "strong",
    "moderate",
    "preliminary",
    "insufficient",
  ]),
});

export type ValidatedEvidenceCollection = z.infer<
  typeof validatedEvidenceCollectionSchema
>;
type ValidatedFinding = z.infer<typeof validatedEvidenceFindingSchema>;
type EvidenceState = z.infer<typeof evidenceStateSchema>;

function normalize(value: string) {
  return sanitizeUntrustedResearchText(value, 1_500)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (
      /(?:yüklenen|uploaded|placeholder|example|\bbelge\b)/i.test(
        `${url.hostname}${url.pathname}${url.search}`
      )
    ) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    if (url.pathname === "/") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function similarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}

function evidenceState(item: DecisionEvidence): EvidenceState {
  if (item.authorityLevel === "user" || /user[-_ ]?(?:provided|statement)/i.test(item.source)) {
    return "user_statement";
  }
  if (item.category === "Verified Asset" || item.authorityLevel === "uploaded") {
    return "uploaded_document";
  }
  if (item.category === "Missing Information") return "unresolved";
  if (item.category === "AI Inference") return "professional_inference";
  if (item.category === "Estimated") return "assumption";

  const url = canonicalUrl(item.url);
  const supported = Boolean(
    sanitizeUntrustedResearchText(item.proposition || item.summary || item.value, 1_500)
  );
  if (!url || !supported || !item.verified) return "unresolved";
  if (
    item.official &&
    item.authorityLevel === "primary" &&
    item.sourceClassification !== "unsupported/irrelevant"
  ) return "officially_verified";
  if (/market|listing|comparable|commercial/i.test(`${item.sourceType} ${item.sourceClassification}`)) {
    return "market_indication";
  }
  return "credible_secondary_source";
}

function authorityFor(state: EvidenceState) {
  return {
    officially_verified: 0.98,
    uploaded_document: 0.82,
    credible_secondary_source: 0.76,
    market_indication: 0.58,
    user_statement: 0.42,
    professional_inference: 0.38,
    assumption: 0.2,
    unresolved: 0,
  }[state];
}

function relevanceFor(item: DecisionEvidence, state: EvidenceState) {
  if (state === "unresolved") return 0;
  const upstream = item.qualityScore ?? item.confidence;
  const claimSupport = item.proposition?.trim() || item.supportedIssue?.trim() ? 0.08 : 0;
  return Math.max(0, Math.min(1, upstream / 100 + claimSupport));
}

function reliabilityFor(item: DecisionEvidence, state: EvidenceState) {
  const authority = authorityFor(state);
  const freshness = item.publishedDate && !Number.isNaN(Date.parse(item.publishedDate))
    ? Date.now() - Date.parse(item.publishedDate) <= 1000 * 60 * 60 * 24 * 365 * 3
      ? 0.02
      : -0.04
    : 0;
  return Math.max(0, Math.min(1, authority + freshness));
}

function impactFor(item: DecisionEvidence, reportPlan: DynamicReportPlan) {
  const criticalText = reportPlan.sections
    .filter((section) => section.priority === "critical")
    .map((section) => `${section.id} ${section.title} ${section.purpose}`)
    .join(" ");
  if (
    reportPlan.decisionGates.some((gate) =>
      gateFields(gate).some(
        (field) => item.field === field || item.field.startsWith(field)
      )
    ) || normalize(criticalText).includes(normalize(item.field))
  ) return "critical" as const;
  if (item.impact === "adverse" || item.impact === "favorable") return "high" as const;
  return "medium" as const;
}

function confidenceFor({
  state,
  relevance,
  reliability,
}: {
  state: EvidenceState;
  relevance: number;
  reliability: number;
}): ValidatedFinding["confidence"] {
  if (state === "user_statement") return "Preliminary";
  if (state === "professional_inference" || state === "assumption") {
    return "Verification Required";
  }
  if (state === "unresolved") return "Insufficient Evidence";
  return Math.round(relevance * reliability * 100) / 100;
}

function sourcePublisher(item: DecisionEvidence, url: string) {
  const supplied = sanitizeUntrustedResearchText(item.source, 180);
  if (supplied && !/^(?:source|unknown|not provided)$/i.test(supplied)) return supplied;
  return new URL(url).hostname.replace(/^www\./, "");
}

function buildSources(evidence: DecisionEvidence[]) {
  const byUrl = new Map<string, ValidatedEvidenceCollection["sources"][number]>();
  for (const item of evidence) {
    const state = evidenceState(item);
    const url = canonicalUrl(item.url);
    const title = sanitizeUntrustedResearchText(item.title, 240);
    if (!url || !title || state === "unresolved") continue;
    const current = byUrl.get(url);
    const reliability = reliabilityFor(item, state);
    const candidate = {
      id: current?.id || `source_${byUrl.size + 1}`,
      title,
      publisher: sourcePublisher(item, url),
      url,
      sourceType: sanitizeUntrustedResearchText(item.sourceType || item.category, 120),
      authority: authorityFor(state),
      reliability,
      publishedDate: sanitizeUntrustedResearchText(item.publishedDate, 80),
      accessedAt: sanitizeUntrustedResearchText(item.lastChecked, 80),
    };
    if (!current || reliability > current.reliability) byUrl.set(url, candidate);
  }
  return [...byUrl.values()];
}

function reasonFor(state: EvidenceState, item: DecisionEvidence) {
  const reasons: Record<EvidenceState, string> = {
    user_statement: "Reported by the user and retained as an allegation, not an independently verified fact.",
    uploaded_document: "Directly extracted from uploaded material; independent official verification remains separate.",
    officially_verified: "Supported by a directly relevant authoritative source.",
    credible_secondary_source: "Supported by a directly relevant, dated secondary source.",
    market_indication: "Provides a market signal but is not equivalent to an official record or completed transaction.",
    professional_inference: "Professional inference derived from available facts and requiring corroboration.",
    assumption: "Working assumption without sufficient independent support.",
    unresolved: "No usable evidence was found; absence of evidence is not evidence that the claim is false.",
  };
  const rationale = sanitizeUntrustedResearchText(item.qualityRationale, 300);
  return rationale ? `${reasons[state]} ${rationale}` : reasons[state];
}

function buildFindings({
  evidence,
  sources,
  reportPlan,
}: {
  evidence: DecisionEvidence[];
  sources: ValidatedEvidenceCollection["sources"];
  reportPlan: DynamicReportPlan;
}) {
  const sourceByUrl = new Map(sources.map((source) => [source.url, source.id]));
  const findings: ValidatedFinding[] = [];

  for (const item of evidence) {
    const state = evidenceState(item);
    const claim = sanitizeUntrustedResearchText(
      item.proposition || item.summary || item.value,
      1_000
    );
    const field = sanitizeUntrustedResearchText(item.field, 100);
    if (!claim || !field) continue;
    const relevance = relevanceFor(item, state);
    const reliability = reliabilityFor(item, state);
    const url = canonicalUrl(item.url);
    const sourceIds = url && sourceByUrl.has(url) ? [sourceByUrl.get(url)!] : [];
    const candidate: ValidatedFinding = {
      id: `finding_${findings.length + 1}`,
      field,
      claim,
      evidenceState: state,
      sourceIds,
      relevance,
      reliability,
      confidence: confidenceFor({ state, relevance, reliability }),
      conflictStatus: "none",
      decisionImpact: impactFor(item, reportPlan),
      impactDirection: item.impact || "unknown",
      reason: reasonFor(state, item),
    };
    const duplicate = findings.find(
      (finding) =>
        finding.field === candidate.field &&
        finding.evidenceState === candidate.evidenceState &&
        finding.impactDirection === candidate.impactDirection &&
        similarity(finding.claim, candidate.claim) >= 0.82
    );
    if (!duplicate) {
      findings.push(candidate);
      continue;
    }
    duplicate.sourceIds = [...new Set([...duplicate.sourceIds, ...sourceIds])];
    duplicate.relevance = Math.max(duplicate.relevance, relevance);
    duplicate.reliability = Math.min(
      1,
      Math.max(duplicate.reliability, reliability) +
        (duplicate.sourceIds.length > 1 ? 0.05 : 0)
    );
    duplicate.confidence = confidenceFor({
      state: duplicate.evidenceState,
      relevance: duplicate.relevance,
      reliability: duplicate.reliability,
    });
    if (duplicate.sourceIds.length > 1) {
      duplicate.reason = `${duplicate.reason} Independently corroborated by multiple validated sources.`;
    }
  }
  return findings;
}

function explicitContradiction(left: ValidatedFinding, right: ValidatedFinding) {
  if (left.field !== right.field) return false;
  if (
    (left.impactDirection === "favorable" && right.impactDirection === "adverse") ||
    (left.impactDirection === "adverse" && right.impactDirection === "favorable")
  ) return true;
  const a = normalize(left.claim);
  const b = normalize(right.claim);
  const negated = /\b(?:not|no|without|prohibited|denied|değil|yok|yasak|bulunmuyor)\b/i;
  return similarity(a.replace(negated, ""), b.replace(negated, "")) >= 0.65 &&
    negated.test(a) !== negated.test(b);
}

function detectConflicts(
  findings: ValidatedFinding[],
  sources: ValidatedEvidenceCollection["sources"]
) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const conflicts: ValidatedEvidenceCollection["conflicts"] = [];
  for (let leftIndex = 0; leftIndex < findings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < findings.length; rightIndex += 1) {
      const left = findings[leftIndex];
      const right = findings[rightIndex];
      if (!explicitContradiction(left, right)) continue;
      const sourceIds = [...new Set([...left.sourceIds, ...right.sourceIds])];
      if (sourceIds.length < 2) continue;
      left.conflictStatus = "conflicted";
      right.conflictStatus = "conflicted";
      left.confidence = typeof left.confidence === "number"
        ? Math.round(left.confidence * 0.7 * 100) / 100
        : "Preliminary";
      right.confidence = typeof right.confidence === "number"
        ? Math.round(right.confidence * 0.7 * 100) / 100
        : "Preliminary";
      const compared = sourceIds.map((id) => sourceById.get(id)).filter(Boolean);
      conflicts.push({
        id: `conflict_${conflicts.length + 1}`,
        field: left.field,
        findingIds: [left.id, right.id],
        sourceIds,
        comparison: {
          authority: compared.map((source) => `${source!.title}: ${source!.authority}`).join("; ") || "No validated source authority available.",
          date: compared.map((source) => `${source!.title}: ${source!.publishedDate || "undated"}`).join("; ") || "Source dates unavailable.",
          relevance: `${left.id}: ${left.relevance}; ${right.id}: ${right.relevance}`,
          specificity: "Both claims address the same evidence field and must be resolved against the most specific primary record.",
        },
        decisionImpact:
          left.decisionImpact === "critical" || right.decisionImpact === "critical"
            ? "critical"
            : "high",
        resolutionRequired: `Obtain the most current authoritative record for ${left.field} and reconcile both claims before relying on either.`,
      });
    }
  }
  return conflicts;
}

const gateFieldMap: Record<string, string[]> = {
  jurisdiction_confirmed: ["jurisdiction"],
  claim_elements_supported: ["claim", "legal_", "material_facts"],
  deadline_open: ["legal_limitation_deadlines", "deadline", "event_date"],
  clean_title: ["title_status", "ownership", "encumbrance"],
  compatible_zoning: ["zoning"],
  verified_access: ["access"],
  valuation_supported: ["comparables", "currency", "valuation_method", "purchase_price"],
  period_complete: ["period", "currency"],
  statements_reconciled: ["balance_sheet", "income_statement", "cash_flow"],
  period_currency_known: ["period", "currency"],
  cost_data_available: ["cost", "costs"],
};

function gateFields(gate: DynamicReportPlan["decisionGates"][number]) {
  const mapped = gateFieldMap[gate.id];
  if (mapped) return mapped;
  return [...tokens(`${gate.id} ${gate.condition} ${gate.evidenceRequired}`)].slice(0, 8);
}

function gateRequiresOfficial(gateId: string) {
  return /(?:title|zoning|access|deadline)/i.test(gateId);
}

function buildDecisionGates(
  reportPlan: DynamicReportPlan,
  findings: ValidatedFinding[]
) {
  return reportPlan.decisionGates.map((gate) => {
    const fields = gateFields(gate);
    const relevant = findings.filter((finding) =>
      fields.some((field) =>
        finding.field === field ||
        finding.field.startsWith(field) ||
        normalize(finding.claim).includes(normalize(field))
      )
    );
    const usable = relevant.filter((finding) => {
      if (finding.evidenceState === "unresolved" || finding.conflictStatus === "conflicted") return false;
      if (gateRequiresOfficial(gate.id)) {
        return finding.evidenceState === "officially_verified";
      }
      return !["assumption", "professional_inference"].includes(finding.evidenceState);
    });
    const adverse = usable.some(
      (finding) =>
        finding.impactDirection === "adverse" &&
        ["officially_verified", "credible_secondary_source"].includes(finding.evidenceState)
    );
    const requiresAll = ["valuation_supported", "period_complete", "statements_reconciled", "period_currency_known"].includes(gate.id);
    const allFieldsSupported = fields.every((field) =>
      usable.some((finding) => finding.field === field || finding.field.startsWith(field))
    );
    const status = adverse
      ? "failed" as const
      : usable.length > 0 && (!requiresAll || allFieldsSupported)
        ? "passed" as const
        : "unresolved" as const;
    return {
      id: gate.id,
      condition: gate.condition,
      status,
      supportingFindingIds: usable.map((finding) => finding.id),
      requiredEvidenceFields: fields,
      decisionImpact: gate.blocking ? "critical" as const : "high" as const,
      requiredNextAction:
        status === "passed"
          ? "Retain the supporting evidence and recheck it if material facts change."
          : `Obtain and verify: ${gate.evidenceRequired}.`,
    };
  });
}

function sectionMatchesFinding(
  section: DynamicReportPlan["sections"][number],
  finding: ValidatedFinding
) {
  const sectionText = normalize(
    `${section.id} ${section.title} ${section.purpose} ${section.analysisMethod}`
  );
  if (sectionText.includes(normalize(finding.field))) return true;
  const fieldTerms: Record<string, RegExp> = {
    title_status: /title|ownership|tapu|mülkiyet/i,
    zoning: /zoning|land use|imar/i,
    access: /access|road|erişim|yol/i,
    comparables: /comparable|market|emsal|valuation/i,
    hazards: /hazard|environment|geolog|risk|afet/i,
    legal_limitation_deadlines: /deadline|filing|limitation|süre/i,
  };
  return fieldTerms[finding.field]?.test(sectionText) ?? false;
}

function buildSectionSupport(
  reportPlan: DynamicReportPlan,
  findings: ValidatedFinding[],
  conflicts: ValidatedEvidenceCollection["conflicts"],
  unresolved: string[]
) {
  return reportPlan.sections.map((section) => {
    const relevant = findings.filter((finding) => sectionMatchesFinding(section, finding));
    const conflictIds = conflicts
      .filter((conflict) => relevant.some((finding) => conflict.findingIds.includes(finding.id)))
      .map((conflict) => conflict.id);
    return {
      sectionId: section.id,
      supportedFindingIds: relevant
        .filter((finding) => finding.evidenceState !== "unresolved")
        .map((finding) => finding.id),
      unresolvedFindings: [
        ...new Set([
          ...relevant
            .filter((finding) => finding.evidenceState === "unresolved")
            .map((finding) => finding.claim),
          ...unresolved.filter((item) => normalize(`${section.id} ${section.title}`).includes(normalize(item))),
        ]),
      ],
      risks: relevant
        .filter((finding) => finding.impactDirection === "adverse")
        .map((finding) => finding.claim),
      opportunities: relevant
        .filter((finding) => finding.impactDirection === "favorable")
        .map((finding) => finding.claim),
      conflictIds,
      decisionImpact:
        section.priority === "critical"
          ? "critical" as const
          : section.priority === "high"
            ? "high" as const
            : "medium" as const,
    };
  });
}

function overallQuality(
  findings: ValidatedFinding[],
  conflicts: ValidatedEvidenceCollection["conflicts"],
  gates: ValidatedEvidenceCollection["decisionGates"]
) {
  if (!findings.some((finding) => finding.evidenceState !== "unresolved")) return "insufficient" as const;
  const blocking = gates.filter((gate) => gate.decisionImpact === "critical");
  const passed = blocking.filter((gate) => gate.status === "passed").length;
  const verified = findings.filter((finding) =>
    ["officially_verified", "uploaded_document", "credible_secondary_source"].includes(finding.evidenceState)
  );
  const criticalConflicts = conflicts.filter((conflict) => conflict.decisionImpact === "critical").length;
  if (blocking.length > 0 && passed === blocking.length && criticalConflicts === 0 && verified.length >= 3) {
    return "strong" as const;
  }
  if (verified.length >= 2 && passed >= Math.ceil(blocking.length / 2) && criticalConflicts === 0) {
    return "moderate" as const;
  }
  return "preliminary" as const;
}

function fallbackValidation({
  collection,
  reportPlan,
}: {
  collection: EvidenceCollection;
  reportPlan: DynamicReportPlan;
}): ValidatedEvidenceCollection {
  const normalizedFindings = Array.isArray(collection?.findings)
    ? collection.findings
    : [];
  const missingInformation = Array.isArray(collection?.missingInformation)
    ? collection.missingInformation
    : [];
  const findings = normalizedFindings.map((finding, index) => ({
    id: `finding_${index + 1}`,
    field: sanitizeUntrustedResearchText(finding.field, 100) || "unresolved",
    claim: sanitizeUntrustedResearchText(finding.claim || finding.evidence, 1_000) || "Evidence requires validation.",
    evidenceState: "unresolved" as const,
    sourceIds: [],
    relevance: 0,
    reliability: 0,
    confidence: "Verification Required" as const,
    conflictStatus: "none" as const,
    decisionImpact: "unknown" as const,
    impactDirection: "unknown" as const,
    reason: "Evidence validation was incomplete; the normalized research finding was preserved without treating it as verified.",
  }));
  return {
    version: "evidence_validation_v1",
    selectedMode: reportPlan.selectedMode,
    findings,
    sources: [],
    conflicts: [],
    unresolvedQuestions: [...new Set(missingInformation)],
    decisionGates: reportPlan.decisionGates.map((gate) => ({
      id: gate.id,
      condition: gate.condition,
      status: "unresolved",
      supportingFindingIds: [],
      requiredEvidenceFields: gateFields(gate),
      decisionImpact: gate.blocking ? "critical" : "high",
      requiredNextAction: `Obtain and verify: ${gate.evidenceRequired}.`,
    })),
    sectionSupport: reportPlan.sections.map((section) => ({
      sectionId: section.id,
      supportedFindingIds: [],
      unresolvedFindings: [],
      risks: [],
      opportunities: [],
      conflictIds: [],
      decisionImpact: section.priority === "critical" ? "critical" : section.priority === "high" ? "high" : "medium",
    })),
    overallEvidenceQuality: findings.length ? "preliminary" : "insufficient",
  };
}

export function validateEvidenceForDecisionSupport({
  collection,
  evidence,
  extractedFacts,
  reportPlan,
}: {
  collection: EvidenceCollection;
  evidence: DecisionEvidence[];
  extractedFacts: ExtractedFact[];
  reportPlan: DynamicReportPlan;
}): ValidatedEvidenceCollection {
  try {
    const sources = buildSources(evidence);
    const findings = buildFindings({ evidence, sources, reportPlan });
    const conflicts = detectConflicts(findings, sources);
    const factMissing = extractedFacts
      .filter((fact) => fact.missing)
      .map((fact) => fact.field);
    const unresolvedQuestions = [
      ...new Set([
        ...collection.missingInformation,
        ...factMissing,
        ...findings
          .filter((finding) => finding.evidenceState === "unresolved")
          .map((finding) => finding.field),
      ]),
    ];
    const decisionGates = buildDecisionGates(reportPlan, findings);
    const sectionSupport = buildSectionSupport(
      reportPlan,
      findings,
      conflicts,
      unresolvedQuestions
    );
    return validatedEvidenceCollectionSchema.parse({
      version: "evidence_validation_v1",
      selectedMode: reportPlan.selectedMode,
      findings,
      sources,
      conflicts,
      unresolvedQuestions,
      decisionGates,
      sectionSupport,
      overallEvidenceQuality: overallQuality(findings, conflicts, decisionGates),
    });
  } catch {
    return validatedEvidenceCollectionSchema.parse(
      fallbackValidation({ collection, reportPlan })
    );
  }
}

/**
 * Creates the sole report-writer boundary for Phase 5. Internal IDs, provider
 * names, queries, retries, timings, and schema diagnostics are intentionally
 * excluded.
 */
export function formatValidatedEvidenceForReportContext(
  validated: ValidatedEvidenceCollection
) {
  const stateLabels: Record<EvidenceState, string> = {
    user_statement: "User statement (not independently verified)",
    uploaded_document: "Extracted from uploaded document",
    officially_verified: "Officially verified",
    credible_secondary_source: "Credible secondary source",
    market_indication: "Market indication",
    professional_inference: "Professional inference",
    assumption: "Assumption",
    unresolved: "Unresolved",
  };
  const sourceById = new Map(validated.sources.map((source) => [source.id, source]));
  const sources = validated.sources.map(
    (source) =>
      `${source.title} | Publisher: ${source.publisher} | URL: ${source.url} | Published: ${source.publishedDate || "not available"} | Accessed: ${source.accessedAt || "not available"} | Type: ${source.sourceType || "external source"} | Reliability: ${Math.round(source.reliability * 100)}/100`
  );
  const findings = validated.findings.map((finding) => {
    const sources = finding.sourceIds
      .map((id) => sourceById.get(id))
      .filter(Boolean)
      .map((source) => `${source!.title} (${source!.publisher}) ${source!.url}`)
      .join(" | ");
    return `Field: ${finding.field}\nClaim: ${finding.claim}\nEvidence state: ${stateLabels[finding.evidenceState]}\nSources: ${sources || "No independently validated source"}\nRelevance: ${finding.relevance}\nReliability: ${finding.reliability}\nConfidence: ${finding.confidence}\nConflict: ${finding.conflictStatus}\nDecision impact: ${finding.decisionImpact}\nReason: ${finding.reason}`;
  });
  const gates = validated.decisionGates.map(
    (gate) =>
      `- ${gate.condition}: ${gate.status}. Next action: ${gate.requiredNextAction}`
  );
  const conflicts = validated.conflicts.map(
    (conflict) => `- ${conflict.field}: ${conflict.resolutionRequired}`
  );
  return `Evidence quality: ${validated.overallEvidenceQuality}
Decision gates:
${gates.join("\n") || "- No decision gates defined."}
Unresolved decision questions:
${validated.unresolvedQuestions.map((item) => `- ${item}`).join("\n") || "- None."}
Conflicts:
${conflicts.join("\n") || "- None."}

Validated source registry:
${sources.join("\n") || "No validated external sources."}

Validated findings:
${findings.join("\n\n") || "No validated findings."}`;
}
