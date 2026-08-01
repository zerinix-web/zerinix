import type { DecisionEvidence } from "../../decision-intelligence/contracts.ts";
import type {
  AdapterCitation,
  ResearchProviderKind,
  ValidatedProviderResult,
} from "./contracts.ts";

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?/gi,
  /(?:system|developer)\s+prompt/gi,
  /you\s+are\s+now\s+(?:an?|the)\b/gi,
  /reveal\s+(?:the\s+)?(?:prompt|instructions?|secrets?)/gi,
  /override\s+(?:the\s+)?(?:rules?|instructions?)/gi,
  /<\/?(?:script|iframe|object|embed)[^>]*>/gi,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeUntrustedResearchText(value: unknown, max = 1_500) {
  let text = typeof value === "string" ? value : "";
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  for (const pattern of INJECTION_PATTERNS) {
    text = text.replace(pattern, "[untrusted instruction removed]");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function validAbsoluteUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function validateEvidence(
  value: unknown,
  providerKind: ResearchProviderKind
): DecisionEvidence | null {
  if (!isRecord(value)) return null;
  const field = sanitizeUntrustedResearchText(value.field, 80);
  const title = sanitizeUntrustedResearchText(value.title, 240);
  const summary = sanitizeUntrustedResearchText(value.summary, 1_500);
  const evidenceValue = sanitizeUntrustedResearchText(value.value, 1_500);
  const source = sanitizeUntrustedResearchText(value.source, 240);
  const authorityLevel = ["primary", "secondary", "uploaded", "user", "method"].includes(
    String(value.authorityLevel || "")
  )
    ? (value.authorityLevel as DecisionEvidence["authorityLevel"])
    : "secondary";
  const url = validAbsoluteUrl(value.url);
  const internalEvidence =
    providerKind === "internal_extraction" ||
    providerKind === "uploaded_document" ||
    providerKind === "ocr";

  if (
    !field ||
    !title ||
    (!summary && !evidenceValue) ||
    (!internalEvidence && !url)
  ) {
    return null;
  }

  const confidence = Number(value.confidence);
  const supportingData = Array.isArray(value.supportingData)
    ? value.supportingData
        .map((item) => sanitizeUntrustedResearchText(item, 500))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const category = [
    "Verified Asset",
    "Official Source",
    "External Research",
    "AI Inference",
    "Estimated",
    "Missing Information",
  ].includes(String(value.category || ""))
    ? (value.category as DecisionEvidence["category"])
    : internalEvidence
      ? "Verified Asset"
      : "External Research";

  return {
    id: sanitizeUntrustedResearchText(value.id, 80) || crypto.randomUUID(),
    field,
    title,
    summary: summary || evidenceValue,
    value: evidenceValue || summary,
    source: source || title,
    url,
    provider: providerKind,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(100, confidence))
      : 0,
    official: value.official === true || authorityLevel === "primary",
    verified: value.verified === true,
    publishedDate: sanitizeUntrustedResearchText(value.publishedDate, 80),
    lastChecked: sanitizeUntrustedResearchText(value.lastChecked, 80),
    supportingData,
    category,
    impact: ["favorable", "neutral", "adverse", "unknown"].includes(
      String(value.impact || "")
    )
      ? (value.impact as DecisionEvidence["impact"])
      : "unknown",
    impactReason: sanitizeUntrustedResearchText(value.impactReason, 500),
    sourceType: sanitizeUntrustedResearchText(value.sourceType, 120),
    authorityLevel,
    qualityScore: Number.isFinite(Number(value.qualityScore))
      ? Math.max(0, Math.min(100, Number(value.qualityScore)))
      : undefined,
    qualityRationale: sanitizeUntrustedResearchText(value.qualityRationale, 500),
    researchStage: sanitizeUntrustedResearchText(value.researchStage, 120),
    jurisdiction: sanitizeUntrustedResearchText(value.jurisdiction, 180),
    supportedIssue: sanitizeUntrustedResearchText(value.supportedIssue, 180),
    proposition: sanitizeUntrustedResearchText(value.proposition, 500),
    sourceClassification: value.sourceClassification as DecisionEvidence["sourceClassification"],
  };
}

function validateCitation(value: unknown): AdapterCitation | null {
  if (!isRecord(value)) return null;
  const url = validAbsoluteUrl(value.url);
  const title = sanitizeUntrustedResearchText(value.title, 240);
  if (!url || !title) return null;
  return {
    title,
    url,
    excerpt: sanitizeUntrustedResearchText(value.excerpt, 500),
    accessedAt: sanitizeUntrustedResearchText(value.accessedAt, 80),
  };
}

function sanitizeMetadata(value: unknown) {
  if (!isRecord(value)) return {};
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    const safeKey = sanitizeUntrustedResearchText(key, 80);
    if (!safeKey) continue;
    if (typeof item === "boolean" || typeof item === "number") {
      safe[safeKey] = item;
    } else if (typeof item === "string") {
      safe[safeKey] = sanitizeUntrustedResearchText(item, 500);
    }
  }
  return safe;
}

export function validateProviderResult({
  adapterId,
  providerKind,
  result,
}: {
  adapterId: string;
  providerKind: ResearchProviderKind;
  result: import("./contracts.ts").ResearchAdapterResult;
}): ValidatedProviderResult {
  const evidence = (Array.isArray(result.evidence) ? result.evidence : []).flatMap((item) => {
    const validated = validateEvidence(item, providerKind);
    return validated ? [validated] : [];
  });
  const citations = (Array.isArray(result.citations) ? result.citations : []).flatMap((item) => {
    const validated = validateCitation(item);
    return validated ? [validated] : [];
  });

  return {
    adapterId,
    providerKind,
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    evidence,
    citations,
    metadata: {
      ...sanitizeMetadata(result.metadata),
      trustBoundary:
        providerKind === "internal_extraction"
          ? "trusted_internal_content"
          : "untrusted_external_content",
    },
    extractedFacts: Array.isArray(result.extractedFacts)
      ? result.extractedFacts
      : [],
    attemptedFields: Array.isArray(result.attemptedFields)
      ? result.attemptedFields
      : [],
    unresolvedFields: Array.isArray(result.unresolvedFields)
      ? result.unresolvedFields
      : [],
    taskResults: Array.isArray(result.taskResults) ? result.taskResults : [],
    summary: sanitizeUntrustedResearchText(result.summary, 1_500),
    responseId: sanitizeUntrustedResearchText(result.responseId, 240),
  };
}
