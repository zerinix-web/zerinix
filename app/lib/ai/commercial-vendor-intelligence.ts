import type { DomainResearchEvidence } from "./domain-research.ts";

export type OrganizationEntityType =
  | "commercial_vendor"
  | "government"
  | "regulator"
  | "standards_body"
  | "research_provider"
  | "analyst_firm"
  | "consultancy"
  | "academic"
  | "open_source"
  | "community"
  | "unknown";

export type ClassifiedOrganizationEntity = {
  name: string;
  entityType: OrganizationEntityType;
  url: string;
  evidenceIds: string[];
  confidence: number;
  reason: string;
};

type EntityClassificationInput = {
  name: string;
  url?: string;
  sourceType?: string;
  context?: string;
  knownCommercialVendor?: boolean;
};

function host(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value.replace(/[._-]+/g, " "));
}

/**
 * Classifies an organization into one mutually exclusive role. Institutional
 * roles are resolved before commercial status so that an official or research
 * publisher can never become a competitor merely because it has a website.
 */
export function classifyOrganizationEntity(
  input: EntityClassificationInput
): Pick<ClassifiedOrganizationEntity, "entityType" | "confidence" | "reason"> {
  const hostname = host(input.url);
  const text = `${input.name} ${hostname} ${input.sourceType || ""} ${input.context || ""}`;

  // A taxonomy match classifies the subject of the evidence. It intentionally
  // precedes publisher-role detection because an analyst page may mention a
  // real vendor without turning that vendor into an analyst firm.
  if (input.knownCommercialVendor) {
    return { entityType: "commercial_vendor", confidence: 98, reason: "Matched to the market taxonomy's commercial vendor catalog." };
  }
  if (matches(text, /\b(?:sec|securities and exchange commission|irs|internal revenue service|finra|federal trade commission|ftc|fda|edgar|regulator|regulatory authority|regulatory organization)\b/i)) {
    return { entityType: "regulator", confidence: 98, reason: "Regulatory authority or regulatory system." };
  }
  if (hostname.endsWith(".gov") || matches(text, /\b(?:bea|bureau of economic analysis|bls|bureau of labor statistics|gsa|general services administration|library of congress|government agency|department of|ministry of|census bureau)\b/i)) {
    return { entityType: "government", confidence: 98, reason: "Government entity or official government domain." };
  }
  if (matches(text, /\b(?:fasb|financial accounting standards board|aicpa|iso|iec|standards body|standards organization)\b/i)) {
    return { entityType: "standards_body", confidence: 96, reason: "Professional or technical standards body." };
  }
  if (matches(text, /\b(?:gartner|idc|forrester|cb insights)\b/i)) {
    return { entityType: "analyst_firm", confidence: 97, reason: "Market analyst firm used as an evidence source." };
  }
  if (matches(text, /\b(?:mckinsey|boston consulting group|bcg|bain|deloitte|pwc|pricewaterhousecoopers|kpmg|ernst and young|accenture|consultancy|consulting firm)\b/i)) {
    return { entityType: "consultancy", confidence: 96, reason: "Consulting organization used as an evidence source." };
  }
  if (matches(text, /\b(?:pitchbook|crunchbase|statista|grand view research|mordor intelligence|ibisworld|research and markets|fortune business insights|research repository|data provider|benchmark resource|market research database)\b/i)) {
    return { entityType: "research_provider", confidence: 96, reason: "Research, benchmark, or company-data provider." };
  }
  if (hostname.endsWith(".edu") || matches(text, /\b(?:university|college|academic|research paper repository|arxiv|ssrn)\b/i)) {
    return { entityType: "academic", confidence: 95, reason: "Academic institution or research repository." };
  }
  if (matches(text, /\b(?:open source|open-source|apache software foundation|linux foundation)\b/i)) {
    return { entityType: "open_source", confidence: 94, reason: "Open-source project or foundation." };
  }
  if (matches(text, /\b(?:community|forum|user group|reddit|stack overflow|github repository)\b/i)) {
    return { entityType: "community", confidence: 90, reason: "Community-maintained resource." };
  }
  if (
    hostname &&
    matches(text, /\b(?:company_source|company website|product page|pricing page|commercial software|software vendor)\b/i)
  ) {
    return { entityType: "commercial_vendor", confidence: 82, reason: "Validated company-owned product or pricing source." };
  }
  return { entityType: "unknown", confidence: 35, reason: "Insufficient evidence to assign a commercial or institutional role." };
}

export function classifyEvidencePublisher(
  item: DomainResearchEvidence
): ClassifiedOrganizationEntity {
  const classification = classifyOrganizationEntity({
    name: item.publisher,
    url: item.url,
    sourceType: item.sourceType,
    context: `${item.sourceTitle} ${item.field}`,
  });
  return {
    name: item.publisher.trim() || "Unknown publisher",
    url: item.url,
    evidenceIds: [item.id],
    ...classification,
  };
}

export function isCommercialVendorEntity(entity: {
  entityType: OrganizationEntityType;
}) {
  return entity.entityType === "commercial_vendor";
}
