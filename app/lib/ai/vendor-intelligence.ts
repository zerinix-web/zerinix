import type { DomainResearchEvidence } from "./domain-research.ts";
import {
  classifyEvidencePublisher,
  classifyOrganizationEntity,
  isCommercialVendorEntity,
  type ClassifiedOrganizationEntity,
} from "./commercial-vendor-intelligence.ts";
import {
  calculateEvidenceConfidence,
  classifyMarketConfidence,
  type MarketConfidenceLevel,
} from "./market-research-coverage.ts";
import {
  getMarketTaxonomyProfile,
  resolveMarketTaxonomy,
  resolveMarketVendorEntities,
} from "./market-taxonomy.ts";

export type VendorMarketPosition =
  | "Market Leader"
  | "Challenger"
  | "Emerging"
  | "Niche";

export type VendorClassification =
  | VendorMarketPosition
  | "Vertical Specialist"
  | "Open Source"
  | "Enterprise"
  | "SMB";

export type VendorPricingModel =
  | "Subscription"
  | "Seat pricing"
  | "Usage pricing"
  | "Enterprise"
  | "Transaction"
  | "Success fee"
  | "Hybrid";

export type VendorIntelligence = {
  name: string;
  category: string;
  headquarters: string;
  targetCustomer: string;
  website: string;
  evidenceSources: string[];
  evidenceDomains: string[];
  evidenceCount: number;
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  position: VendorMarketPosition;
  classifications: VendorClassification[];
  pricingModels: VendorPricingModel[];
  pricingEvidence: string;
  strength: string;
  weakness: string;
  featureEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
  independentEvidenceCount: number;
  rankingScore: number;
  eligibleForMajorPlayers: boolean;
};

export type VendorCoverage = {
  vendorCount: number;
  independentProviderSources: number;
  vendorsWithPricingEvidence: number;
  vendorsWithFeatureEvidence: number;
  vendorsWithCustomerEvidence: number;
  competitiveCoverageScore: number;
  sufficient: boolean;
  reason: string;
};

export type VendorIntelligenceGraph = {
  taxonomy: {
    productCategory: string;
    adjacentCategories: string[];
    industry: string;
    buyerCategories: string[];
    commonTerminology: string[];
    aliases: string[];
  };
  vendors: VendorIntelligence[];
  entities: ClassifiedOrganizationEntity[];
  marketInfrastructure: ClassifiedOrganizationEntity[];
  evidenceProviders: ClassifiedOrganizationEntity[];
  coverage: VendorCoverage;
};

function evidenceText(item: DomainResearchEvidence) {
  return [
    item.field,
    item.claim,
    item.value,
    item.sourceTitle,
    item.publisher,
    item.url,
    item.sourceType,
    ...item.supportingData,
  ].join(" ");
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isValidatedVendorEvidence(item: DomainResearchEvidence) {
  return (
    Boolean(hostname(item.url)) &&
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    calculateEvidenceConfidence(item) >= 48
  );
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function concise(value: string, maximum = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trim()}…`;
}

function extractHeadquarters(values: readonly string[]) {
  for (const value of values) {
    const match = value.match(
      /(?:headquartered|headquarters|based)\s+(?:in|at)\s+([A-Z][A-Za-z .'-]{2,60})(?:[.;,]|$)/
    );
    if (match?.[1]) return match[1].trim();
  }
  return "Not established by validated evidence";
}

function extractTargetCustomer(values: readonly string[]) {
  const joined = values.join(" ");
  const targets = [
    ["Enterprise", /\benterprise|large organizations?|global companies\b/i],
    ["SMB", /\bsmbs?|small (?:and medium |to medium )?business|small firms?\b/i],
    ["Mid-market", /\bmid[- ]market|medium-sized\b/i],
    ["Professional firms", /\blaw firms?|accounting firms?|professional services\b/i],
    ["Healthcare providers", /\bhospitals?|health systems?|clinicians?|providers?\b/i],
    ["Contractors", /\bcontractors?|construction firms?|developers?\b/i],
    ["Security teams", /\bsecurity teams?|soc teams?|security operations\b/i],
  ] as const;
  const matched = targets
    .filter(([, pattern]) => pattern.test(joined))
    .map(([label]) => label);
  return matched.length
    ? matched.join(", ")
    : "Not established by validated evidence";
}

function extractPricingModels(values: readonly string[]) {
  const text = values.join(" ");
  const models: Array<[VendorPricingModel, RegExp]> = [
    ["Subscription", /\bsubscription|monthly plan|annual plan|per month|per year\b/i],
    ["Seat pricing", /\bper (?:user|seat)|seat[- ]based|user[- ]based\b/i],
    ["Usage pricing", /\busage[- ]based|consumption|per token|per request|per gb\b/i],
    ["Enterprise", /\benterprise pricing|custom quote|contact sales\b/i],
    ["Transaction", /\bper transaction|transaction fee|per invoice|per document\b/i],
    ["Success fee", /\bsuccess fee|outcome[- ]based|contingency fee\b/i],
    ["Hybrid", /\bhybrid pricing|base fee plus|subscription plus usage\b/i],
  ];
  return models.filter(([, pattern]) => pattern.test(text)).map(([model]) => model);
}

function choosePosition(
  text: string,
  evidenceCount: number,
  independentDomains: number
): VendorMarketPosition {
  if (/\bemerging|startup|new entrant|early[- ]stage\b/i.test(text)) return "Emerging";
  if (/\bniche|specialist|vertical[- ]specific\b/i.test(text)) return "Niche";
  if (
    /\bmarket leader|category leader|leading platform|largest provider\b/i.test(text) ||
    (evidenceCount >= 4 && independentDomains >= 3)
  ) return "Market Leader";
  return evidenceCount >= 2 ? "Challenger" : "Niche";
}

function classificationsFor(
  text: string,
  position: VendorMarketPosition,
  targetCustomer: string
): VendorClassification[] {
  return unique([
    position,
    ...(/\bvertical|industry[- ]specific|specialist\b/i.test(text)
      ? (["Vertical Specialist"] as const)
      : []),
    ...(/\bopen source|source-available\b/i.test(text)
      ? (["Open Source"] as const)
      : []),
    ...(targetCustomer.includes("Enterprise")
      ? (["Enterprise"] as const)
      : []),
    ...(targetCustomer.includes("SMB") ? (["SMB"] as const) : []),
  ]);
}

function coverageScore(input: Omit<VendorCoverage, "competitiveCoverageScore" | "sufficient" | "reason">) {
  const vendorScore = Math.min(35, input.vendorCount * 2.5);
  const providerScore = Math.min(20, input.independentProviderSources * 4);
  const pricingScore = Math.min(15, input.vendorsWithPricingEvidence * 2.5);
  const featureScore = Math.min(15, input.vendorsWithFeatureEvidence * 2);
  const customerScore = Math.min(15, input.vendorsWithCustomerEvidence * 2.5);
  return Math.round(vendorScore + providerScore + pricingScore + featureScore + customerScore);
}

function vendorRankingScore(input: {
  independentEvidenceCount: number;
  featureEvidenceCount: number;
  pricingEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
}) {
  return Math.round(
    Math.min(30, input.independentEvidenceCount * 10) +
    Math.min(20, input.featureEvidenceCount * 10) +
    Math.min(20, input.pricingEvidenceCount * 10) +
    Math.min(15, input.customerEvidenceCount * 7.5) +
    Math.min(15, input.marketMentionCount * 5)
  );
}

function mergeEntity(
  entities: Map<string, ClassifiedOrganizationEntity>,
  entity: ClassifiedOrganizationEntity
) {
  const key = entity.name.toLocaleLowerCase("en");
  const current = entities.get(key);
  if (!current) {
    entities.set(key, entity);
    return;
  }
  const evidenceIds = unique([...current.evidenceIds, ...entity.evidenceIds]);
  const rolePriority = {
    regulator: 11,
    government: 10,
    standards_body: 9,
    academic: 8,
    analyst_firm: 7,
    research_provider: 6,
    consultancy: 5,
    open_source: 4,
    community: 3,
    commercial_vendor: 2,
    unknown: 1,
  } as const;
  const preferred =
    rolePriority[entity.entityType] > rolePriority[current.entityType] ||
    (rolePriority[entity.entityType] === rolePriority[current.entityType] &&
      entity.confidence > current.confidence)
      ? entity
      : current;
  entities.set(key, {
    ...preferred,
    evidenceIds,
    url: preferred.url || current.url || entity.url,
    confidence: Math.max(current.confidence, entity.confidence),
  });
}

export function buildVendorIntelligenceGraph(
  evidence: readonly DomainResearchEvidence[],
  prompt: string
): VendorIntelligenceGraph {
  const taxonomy = resolveMarketTaxonomy(prompt, evidence);
  const profile = taxonomy || getMarketTaxonomyProfile(prompt);
  const evidenceByVendor = new Map<string, {
    name: string;
    items: DomainResearchEvidence[];
    officialWebsite: string;
  }>();
  const organizationEntities = new Map<string, ClassifiedOrganizationEntity>();

  for (const item of evidence) {
    const validatedVendorEvidence = isValidatedVendorEvidence(item);
    const resolvedVendors = validatedVendorEvidence
      ? resolveMarketVendorEntities(item, taxonomy)
      : [];
    const publisherEntity = classifyEvidencePublisher(item);
    if (!isCommercialVendorEntity(publisherEntity) || resolvedVendors.length === 0) {
      mergeEntity(organizationEntities, publisherEntity);
    }
    if (!validatedVendorEvidence) continue;
    for (const entity of resolvedVendors) {
      const classification = classifyOrganizationEntity({
        name: entity.name,
        url: item.url,
        sourceType: item.sourceType,
        context: evidenceText(item),
        knownCommercialVendor: entity.matchedBy !== "company_source" ||
          publisherEntity.entityType === "commercial_vendor",
      });
      const classifiedVendor = {
        name: entity.name,
        entityType: classification.entityType,
        url: item.url,
        evidenceIds: [item.id],
        confidence: classification.confidence,
        reason: classification.reason,
      } satisfies ClassifiedOrganizationEntity;
      mergeEntity(organizationEntities, classifiedVendor);
      if (!isCommercialVendorEntity(classifiedVendor)) continue;
      const key = entity.name.toLowerCase();
      const current = evidenceByVendor.get(key) || {
        name: entity.name,
        items: [],
        officialWebsite: "",
      };
      current.items.push(item);
      if (entity.matchedBy === "domain" || entity.matchedBy === "company_source") {
        current.officialWebsite ||= item.url;
      }
      evidenceByVendor.set(key, current);
    }
  }

  const vendors = [...evidenceByVendor.values()]
    .map(({ name, items, officialWebsite }) => {
      const values = items.map(evidenceText);
      const text = values.join(" ");
      const evidenceDomains = unique(items.map((item) => hostname(item.url)).filter(Boolean));
      const pricingModels = extractPricingModels(values);
      const targetCustomer = extractTargetCustomer(values);
      const confidence = Math.round(
        items.reduce(
          (sum, item) => sum + calculateEvidenceConfidence(item),
          0
        ) / Math.max(1, items.length)
      );
      const position = choosePosition(text, items.length, evidenceDomains.length);
      const featureItems = items.filter((item) =>
        /feature|product|integration|deployment|capabilit|workflow/i.test(evidenceText(item))
      );
      const customerItems = items.filter((item) =>
        /customer|buyer|enterprise|smb|firm|hospital|contractor|security team/i.test(evidenceText(item))
      );
      const weaknessItem = items.find((item) =>
        /weakness|limitation|risk|gap|lacks?|constraint|downside/i.test(evidenceText(item))
      );
      const strengthItem = featureItems[0] || items[0];
      const pricingItem = items.find((item) => extractPricingModels([evidenceText(item)]).length > 0);
      const marketMentionItems = items.filter((item) =>
        /market|vendor|competitor|competitive|leader|provider|platform/i.test(evidenceText(item))
      );
      const independentEvidenceCount = evidenceDomains.length;
      const rankingScore = vendorRankingScore({
        independentEvidenceCount,
        featureEvidenceCount: featureItems.length,
        pricingEvidenceCount: pricingItem ? 1 : 0,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
      });
      const evidenceCount = unique(items.map((item) => item.id)).length;

      return {
        name,
        category: profile.productCategory,
        headquarters: extractHeadquarters(values),
        targetCustomer,
        website: officialWebsite,
        evidenceSources: unique(items.map((item) => item.id)),
        evidenceDomains,
        evidenceCount,
        confidence,
        confidenceLevel: classifyMarketConfidence(confidence),
        position,
        classifications: classificationsFor(text, position, targetCustomer),
        pricingModels,
        pricingEvidence: pricingItem
          ? concise(pricingItem.value || pricingItem.claim)
          : "No validated public pricing evidence",
        strength: strengthItem?.claim
          ? concise(strengthItem.claim)
          : "No validated strength evidence",
        weakness: weaknessItem?.claim
          ? concise(weaknessItem.claim)
          : "No validated weakness evidence",
        featureEvidenceCount: featureItems.length,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
        independentEvidenceCount,
        rankingScore,
        eligibleForMajorPlayers:
          evidenceCount >= 2 && independentEvidenceCount >= 2 && rankingScore >= 40,
      } satisfies VendorIntelligence;
    })
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.evidenceCount - left.evidenceCount ||
        right.confidence - left.confidence ||
        left.name.localeCompare(right.name)
    )
    .slice(0, 30);

  const rawCoverage = {
    vendorCount: vendors.length,
    independentProviderSources: new Set(
      vendors.flatMap((vendor) => vendor.evidenceDomains)
    ).size,
    vendorsWithPricingEvidence: vendors.filter(
      (vendor) => vendor.pricingModels.length > 0
    ).length,
    vendorsWithFeatureEvidence: vendors.filter(
      (vendor) => vendor.featureEvidenceCount > 0
    ).length,
    vendorsWithCustomerEvidence: vendors.filter(
      (vendor) => vendor.customerEvidenceCount > 0
    ).length,
  };
  const competitiveCoverageScore = coverageScore(rawCoverage);
  const sufficient =
    rawCoverage.vendorCount >= 3 &&
    rawCoverage.independentProviderSources >= 2 &&
    competitiveCoverageScore >= 35;
  const reason = sufficient
    ? `${rawCoverage.vendorCount} independently evidenced vendors across ${rawCoverage.independentProviderSources} provider domains.`
    : `Competitive evidence is insufficient: ${rawCoverage.vendorCount} vendors, ${rawCoverage.independentProviderSources} independent provider domains, ${rawCoverage.vendorsWithPricingEvidence} with pricing evidence, ${rawCoverage.vendorsWithFeatureEvidence} with feature evidence, and ${rawCoverage.vendorsWithCustomerEvidence} with customer evidence.`;

  const entities = [...organizationEntities.values()].sort(
    (left, right) =>
      left.entityType.localeCompare(right.entityType) ||
      left.name.localeCompare(right.name)
  );
  const infrastructureTypes = new Set(["government", "regulator", "standards_body"]);
  const evidenceProviderTypes = new Set([
    "research_provider",
    "analyst_firm",
    "consultancy",
    "academic",
    "community",
  ]);

  return {
    taxonomy: {
      productCategory: profile.productCategory,
      adjacentCategories: profile.adjacentCategories,
      industry: profile.industry,
      buyerCategories: profile.buyerCategories,
      commonTerminology: profile.terminology,
      aliases: profile.aliases,
    },
    vendors,
    entities,
    marketInfrastructure: entities.filter((entity) =>
      infrastructureTypes.has(entity.entityType)
    ),
    evidenceProviders: entities.filter((entity) =>
      evidenceProviderTypes.has(entity.entityType)
    ),
    coverage: {
      ...rawCoverage,
      competitiveCoverageScore,
      sufficient,
      reason,
    },
  };
}
