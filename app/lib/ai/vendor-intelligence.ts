import type { DomainResearchEvidence } from "./domain-research.ts";
import {
  classifyEvidencePublisher,
  classifyOrganizationEntity,
  type ClassifiedOrganizationEntity,
} from "./commercial-vendor-intelligence.ts";
import {
  calculateEvidenceConfidence,
  classifyMarketConfidence,
  type MarketConfidenceLevel,
} from "./market-research-coverage.ts";
import { getMarketTaxonomyProfile, resolveMarketTaxonomy } from "./market-taxonomy.ts";
import {
  assessMarketRelevance,
  buildVendorDiscoveryLog,
  buildVendorDiscoveryQueryPlan,
  classifyMajorPlayerLabel,
  computeVendorDiscoveryScores,
  extractVendorCandidateMentions,
  isImplausibleCompetitorName,
  isOfficialVendorEvidence,
  isQualifyingVendorEvidence,
  resolveVendorIdentity,
  validateVendorCandidate,
  type MajorPlayerLabel,
  type VendorDiscoveryLog,
} from "./vendor-discovery.ts";

// Hard, structural fallback for the vendor Category column -- confirmed
// live, a business-idea-style prompt ("...the commercial opportunity of
// launching an AI-powered X...") produced a Category value containing
// that exact prompt fragment even for real, correctly-discovered
// competitors (ServiceNow, IBM). profile.productCategory is a best-effort
// derivation from free-text prompt input for markets with no curated
// taxonomy entry; a smarter regex only shrinks the failure surface, it
// cannot eliminate it for every possible prompt phrasing. This is the
// guarantee: whatever profile.productCategory resolves to, it is validated
// with the same shape check applied to vendor names (rejects
// instruction-verb-led text, "...", markdown/URL artifacts, overly long or
// multi-clause spans) before it is ever allowed into a rendered field, so
// prompt/query text can never reach the report through this column
// regardless of how the extraction upstream behaves.
const uncategorizedVendorLabel = "Not independently classified";

function safeVendorCategory(candidate: string): string {
  return candidate && !isImplausibleCompetitorName(candidate)
    ? candidate
    : uncategorizedVendorLabel;
}

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
  | "Hybrid"
  | "Public list price"
  | "Quote-based"
  | "Per user"
  | "Per company"
  | "Per document"
  | "Services included";

export type VendorIntelligence = {
  name: string;
  canonicalName: string;
  aliases: string[];
  productName: string;
  companyName: string;
  parentCompany: string;
  category: string;
  segment: string;
  aiCapability: string;
  keyUseCases: string[];
  headquarters: string;
  targetCustomer: string;
  website: string;
  evidenceSources: string[];
  evidenceDomains: string[];
  evidenceCount: number;
  mentionCount: number;
  discoveryQueries: string[];
  firstSeen: string;
  lastSeen: string;
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  position: VendorMarketPosition;
  majorPlayerLabel: MajorPlayerLabel;
  classifications: VendorClassification[];
  pricingModels: VendorPricingModel[];
  pricingEvidence: string;
  strength: string;
  weakness: string;
  featureEvidenceCount: number;
  productEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
  independentEvidenceCount: number;
  officialEvidenceCount: number;
  pricingEvidenceCount: number;
  sourceDiversityScore: number;
  commercialConfidence: number;
  marketRelevanceScore: number;
  overallVendorScore: number;
  marketRelevance: string;
  validationPath: string;
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
  discoveryLog: VendorDiscoveryLog;
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
    ["Public list price", /\bpublic (?:list )?pricing|list price|published pricing|starting at \$/i],
    ["Quote-based", /\bquote[- ]based|request a quote|contact sales for pricing|custom quote\b/i],
    ["Per user", /\bper (?:user|seat)\b/i],
    ["Per company", /\bper company|per organization|flat[- ]rate company\b/i],
    ["Per document", /\bper document|per invoice|per filing\b/i],
    ["Services included", /\bservices included|implementation included|onboarding included|managed service included\b/i],
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

const nonVendorInstitutionalTypes = new Set([
  "government",
  "regulator",
  "standards_body",
  "research_provider",
  "analyst_firm",
  "consultancy",
  "academic",
  "open_source",
  "community",
]);

export function buildVendorIntelligenceGraph(
  evidence: readonly DomainResearchEvidence[],
  prompt: string
): VendorIntelligenceGraph {
  const taxonomy = resolveMarketTaxonomy(prompt, evidence);
  const profile = taxonomy || getMarketTaxonomyProfile(prompt);
  const evidenceById = new Map(evidence.map((item) => [item.id, item] as const));
  const organizationEntities = new Map<string, ClassifiedOrganizationEntity>();

  // Institutional classification is keyed off every evidence item's raw
  // publisher, independent of vendor discovery below, so regulators,
  // government, and analyst/research entities are always captured.
  for (const item of evidence) {
    mergeEntity(organizationEntities, classifyEvidencePublisher(item));
  }

  // Candidate discovery: taxonomy alias/domain matches plus heuristic
  // mentions from vendor-relevant evidence (review/directory sites,
  // vendor-relevant fields and source types) so markets without a hardcoded
  // taxonomy still produce real candidates.
  const mentions = extractVendorCandidateMentions(evidence, taxonomy);
  const aggregatedCandidates = resolveVendorIdentity(mentions);
  const queryPlan = buildVendorDiscoveryQueryPlan(prompt, profile);

  const relevantEvidenceIds = new Set<string>();
  const acceptedEvidenceIds = new Set<string>();

  const vendors = [...aggregatedCandidates.values()]
    .flatMap((candidate) => {
      const allItems = candidate.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((item): item is DomainResearchEvidence => Boolean(item));
      if (allItems.length === 0) return [];
      for (const item of allItems) relevantEvidenceIds.add(item.id);

      const qualifyingItems = allItems.filter(isQualifyingVendorEvidence);
      const evidenceTextJoined = allItems.map(evidenceText).join(" ");

      // Curated taxonomy matches are trusted as commercial by construction
      // (matching prior behavior); everything else runs the full
      // institutional classifier so regulators/analysts/research firms
      // picked up by the heuristic path are never treated as vendors.
      const preliminaryClassification = candidate.matchedByTaxonomy
        ? {
            entityType: "commercial_vendor" as const,
            confidence: 98,
            reason: "Matched to the market taxonomy's commercial vendor catalog.",
          }
        : classifyOrganizationEntity({
            name: candidate.canonicalName,
            url: candidate.sourceUrls[0] || "",
            sourceType: allItems[0].sourceType,
            context: evidenceTextJoined,
            knownCommercialVendor: false,
          });

      if (nonVendorInstitutionalTypes.has(preliminaryClassification.entityType)) {
        mergeEntity(organizationEntities, {
          name: candidate.canonicalName,
          entityType: preliminaryClassification.entityType,
          url: candidate.sourceUrls[0] || "",
          evidenceIds: candidate.evidenceIds,
          confidence: preliminaryClassification.confidence,
          reason: preliminaryClassification.reason,
        });
        return [];
      }

      const validation = validateVendorCandidate(candidate, qualifyingItems);
      const relevance = assessMarketRelevance(candidate, taxonomy, evidenceTextJoined, prompt);
      const isValidatedVendor = validation.validated && relevance.relevant;

      mergeEntity(organizationEntities, {
        name: candidate.canonicalName,
        entityType: isValidatedVendor ? "commercial_vendor" : preliminaryClassification.entityType,
        url: candidate.sourceUrls[0] || "",
        evidenceIds: candidate.evidenceIds,
        confidence: isValidatedVendor
          ? Math.max(preliminaryClassification.confidence, 80)
          : preliminaryClassification.confidence,
        reason: isValidatedVendor
          ? `Validated commercial vendor via ${validation.validationPath.replace(/_/g, " ")}.`
          : preliminaryClassification.reason,
      });
      if (!isValidatedVendor) return [];

      for (const item of qualifyingItems) acceptedEvidenceIds.add(item.id);

      const values = qualifyingItems.map(evidenceText);
      const text = values.join(" ");
      const evidenceDomains = unique(
        qualifyingItems.map((item) => hostname(item.url)).filter(Boolean)
      );
      const pricingModels = extractPricingModels(values);
      const targetCustomer = extractTargetCustomer(values);
      const confidence = Math.round(
        qualifyingItems.reduce(
          (sum, item) => sum + calculateEvidenceConfidence(item),
          0
        ) / Math.max(1, qualifyingItems.length)
      );
      const position = choosePosition(text, qualifyingItems.length, evidenceDomains.length);
      const featureItems = qualifyingItems.filter((item) =>
        /feature|product|integration|deployment|capabilit|workflow/i.test(evidenceText(item))
      );
      const customerItems = qualifyingItems.filter((item) =>
        /customer|buyer|enterprise|smb|firm|hospital|contractor|security team/i.test(evidenceText(item))
      );
      const weaknessItem = qualifyingItems.find((item) =>
        /weakness|limitation|risk|gap|lacks?|constraint|downside/i.test(evidenceText(item))
      );
      const strengthItem = featureItems[0] || qualifyingItems[0];
      const pricingItem = qualifyingItems.find(
        (item) => extractPricingModels([evidenceText(item)]).length > 0
      );
      const marketMentionItems = qualifyingItems.filter((item) =>
        /market|vendor|competitor|competitive|leader|provider|platform/i.test(evidenceText(item))
      );
      const officialWebsite =
        qualifyingItems.find((item) => isOfficialVendorEvidence(item, candidate.sourceDomains))
          ?.url || "";
      const independentEvidenceCount = evidenceDomains.length;
      const rankingScore = vendorRankingScore({
        independentEvidenceCount,
        featureEvidenceCount: featureItems.length,
        pricingEvidenceCount: pricingItem ? 1 : 0,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
      });
      const evidenceCount = unique(qualifyingItems.map((item) => item.id)).length;
      const classifications = classificationsFor(text, position, targetCustomer);
      const scores = computeVendorDiscoveryScores(
        validation,
        candidate,
        confidence,
        relevance.relevant
      );
      const majorPlayerLabel = classifyMajorPlayerLabel({
        position,
        classifications,
        independentEvidenceCount,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
      });
      const parentCompanyMatch = candidate.canonicalName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      const parentCompany = parentCompanyMatch
        ? parentCompanyMatch[1].trim()
        : candidate.canonicalName;
      const productName = parentCompanyMatch
        ? parentCompanyMatch[2].trim()
        : candidate.canonicalName;
      const aiSignal =
        /\bai\b|artificial intelligence|machine learning|automat|copilot|generative|\bllm\b/i.test(
          text
        );

      return [
        {
          name: candidate.canonicalName,
          canonicalName: candidate.canonicalName,
          aliases: candidate.aliases,
          productName,
          companyName: parentCompany,
          parentCompany,
          category: safeVendorCategory(profile.productCategory),
          segment: targetCustomer,
          aiCapability: aiSignal
            ? "AI-enabled (evidence-supported)"
            : "Not established by validated evidence",
          keyUseCases: unique(featureItems.slice(0, 3).map((item) => concise(item.claim, 120))),
          headquarters: extractHeadquarters(values),
          targetCustomer,
          website: officialWebsite,
          evidenceSources: unique(qualifyingItems.map((item) => item.id)),
          evidenceDomains,
          evidenceCount,
          mentionCount: candidate.mentionCount,
          discoveryQueries: candidate.discoveryQueries,
          firstSeen: candidate.firstSeen,
          lastSeen: candidate.lastSeen,
          confidence,
          confidenceLevel: classifyMarketConfidence(confidence),
          position,
          majorPlayerLabel,
          classifications,
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
          productEvidenceCount: featureItems.length,
          customerEvidenceCount: customerItems.length,
          marketMentionCount: marketMentionItems.length,
          independentEvidenceCount,
          officialEvidenceCount: validation.officialEvidenceCount,
          pricingEvidenceCount: validation.pricingEvidenceCount,
          sourceDiversityScore: scores.sourceDiversityScore,
          commercialConfidence: scores.commercialConfidence,
          marketRelevanceScore: scores.marketRelevanceScore,
          overallVendorScore: scores.overallVendorScore,
          marketRelevance: relevance.reason,
          validationPath: validation.validationPath,
          rankingScore,
          eligibleForMajorPlayers:
            evidenceCount >= 2 && independentEvidenceCount >= 2 && rankingScore >= 40,
        } satisfies VendorIntelligence,
      ];
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
  const discoveryLog = buildVendorDiscoveryLog({
    queryPlan,
    candidatesDiscovered: aggregatedCandidates.size,
    vendorsValidated: vendors.length,
    sourcesAccepted: acceptedEvidenceIds.size,
    sourcesRejected: Math.max(0, relevantEvidenceIds.size - acceptedEvidenceIds.size),
    sufficientCoverage: vendors.length >= 5,
  });
  const sufficient =
    rawCoverage.vendorCount >= 5 &&
    rawCoverage.independentProviderSources >= 2 &&
    competitiveCoverageScore >= 35;
  // Internal-facing (English-only, used for logging/diagnostics and as a
  // non-empty fallback) -- market-intelligence-graph.ts is the one place
  // this reaches a report field, and it synthesizes its own localized,
  // business-language sentence from the raw coverage numbers below rather
  // than reusing this string, so this text itself never needs to reach an
  // end user or be translated.
  const reason = sufficient
    ? `${rawCoverage.vendorCount} named competitors independently confirmed across ${rawCoverage.independentProviderSources} independent sources.`
    : rawCoverage.vendorCount === 0
      ? "No named competitors could be independently confirmed from public sources for this market."
      : `Only ${rawCoverage.vendorCount} named competitors independently confirmed across ${rawCoverage.independentProviderSources} independent sources (below the target of 5+).`;

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
    discoveryLog,
  };
}
