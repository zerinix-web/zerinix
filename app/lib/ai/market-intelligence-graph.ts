import type {
  DomainResearchBundle,
  DomainResearchEvidence,
} from "./domain-research.ts";
import {
  calculateEvidenceConfidence,
  calculateMarketOverallConfidence,
  calculatePlanningEstimateConfidence,
  classifyMarketConfidence,
  evaluateMarketResearchCoverage,
  type MarketConfidenceLevel,
  type MarketResearchCoverage,
} from "./market-research-coverage.ts";
import {
  sanitizeResearchPublisher,
} from "./market-taxonomy.ts";
import {
  buildVendorIntelligenceGraph,
  type VendorIntelligenceGraph,
} from "./vendor-intelligence.ts";
import { isImplausibleCompetitorName } from "./vendor-discovery.ts";

export const MARKET_INTELLIGENCE_GRAPH_VERSION =
  "market-intelligence-graph-v4" as const;

export type MarketIntelligenceSource = {
  evidenceId: string;
  title: string;
  publisher: string;
  url: string;
  publishedDate: string;
  accessedAt: string;
  sourceType: string;
  confidenceClassification: "Verified" | "Estimated" | "Assumption";
  confidenceScore: number;
  confidenceLevel: MarketConfidenceLevel;
  claim: string;
};

export type MarketIntelligenceCompetitor = {
  name: string;
  positioning: string;
  pricingEvidence: string;
  confidenceClassification: "Verified" | "Estimated";
  confidenceScore: number;
  confidenceLevel: MarketConfidenceLevel;
  evidenceIds: string[];
};

export type MarketPlanningEstimate = {
  classification: "Estimated";
  tam: string;
  sam: string;
  som: string;
  formula: string;
  assumptions: string[];
  evidenceIds: string[];
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  basis: "source_based";
};

export type MarketIntelligenceGraph = {
  version: typeof MARKET_INTELLIGENCE_GRAPH_VERSION;
  competitors: MarketIntelligenceCompetitor[];
  pricingModels: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified" | "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  verifiedMarketSize: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  planningEstimate: MarketPlanningEstimate | null;
  // Regional/global market data (Europe, OECD, neighboring countries) is
  // never the requested geography's own verified figure, so it is kept
  // separate from verifiedMarketSize rather than blended into it -- this
  // is the raw material the model needs to build a transparent, clearly
  // labeled estimate (per marketPrompts.marketSize/cagr/tamSamSom) instead
  // of defaulting to "insufficient evidence" whenever local-only data does
  // not exist.
  adjacentBenchmarks: Array<{
    description: string;
    geography: string;
    evidenceIds: string[];
    confidenceClassification: "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  cagr: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified" | "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  sources: MarketIntelligenceSource[];
  // Every evidence ID backed by a real, valid-URL source -- see the
  // build-time comment in buildMarketIntelligenceGraph. A superset of
  // `sources.map(s => s.evidenceId)`: also includes IDs that were merged
  // away by the display-level canonical-URL dedup but are still real,
  // citable evidence.
  citableEvidenceIds: Set<string>;
  // Every citable evidence ID mapped to its representative (post-dedup)
  // source record -- see the build-time comment in
  // buildMarketIntelligenceGraph. Used to build the deterministic Sources
  // bibliography from the exact [R#] references actually used in the
  // final report.
  sourceRecordByEvidenceId: Record<string, MarketIntelligenceSource>;
  vendorIntelligence: VendorIntelligenceGraph;
  coverage: MarketResearchCoverage;
};

export type MarketIntelligenceReportProjection = {
  marketInfrastructure?: string;
  competitiveLandscape?: string;
  majorPlayers?: string;
  marketSize?: string;
  cagr?: string;
  tamSamSom?: string;
  sources?: string;
};

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function canonicalUrl(value: string) {
  const url = validUrl(value);
  if (!url) return "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString().replace(/\/$/, "");
}

function isVerified(item: DomainResearchEvidence) {
  return (
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    Boolean(validUrl(item.url))
  );
}

function confidenceClassification(item: DomainResearchEvidence) {
  if (/forecast|estimate|estimated|projected|projection|assumption/i.test(
    evidenceText(item)
  )) return "Estimated" as const;
  if (isVerified(item)) return "Verified" as const;
  if (item.label === "Estimate") return "Estimated" as const;
  return "Assumption" as const;
}

function evidenceText(item: DomainResearchEvidence) {
  return [
    item.field,
    item.claim,
    item.value,
    item.sourceTitle,
    item.publisher,
    item.sourceType,
    ...item.supportingData,
  ].join(" ");
}

function isAuthoritativeObservedMarketSize(item: DomainResearchEvidence) {
  const text = evidenceText(item);
  return (
    isVerified(item) &&
    (item.authorityLevel === "primary" ||
      /official_statistics|official_filing|government/i.test(item.sourceType)) &&
    !/forecast|estimate|projected|projection|planning/i.test(text)
  );
}

function concise(value: string, maximum = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trim()}…`;
}

function extractNumber(value: string) {
  const match = value.match(
    /([$€£₺])?\s*(\d+(?:[.,]\d+)?)\s*(thousand|million|billion|trillion|[kmbt])?\b/i
  );
  if (!match) return null;
  const raw = match[2].replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const unit = (match[3] || "").toLowerCase();
  const multiplier = unit.startsWith("t")
    ? unit === "thousand" || unit === "k"
      ? 1_000
      : 1_000_000_000_000
    : unit.startsWith("b")
      ? 1_000_000_000
      : unit.startsWith("m")
        ? 1_000_000
        : 1;
  return {
    amount: numeric * multiplier,
    currency: match[1] || "",
    token: match[0].trim(),
  };
}

function extractMarketAmount(value: string) {
  const parsed = extractNumber(value);
  if (!parsed) return null;
  return /[$€£₺]|\b(?:million|billion|trillion|[mbt])\b/i.test(parsed.token)
    ? parsed
    : null;
}

function formatAmount(amount: number, currency: string) {
  const absolute = Math.abs(amount);
  const divisor = absolute >= 1_000_000_000
    ? 1_000_000_000
    : absolute >= 1_000_000
      ? 1_000_000
      : absolute >= 1_000
        ? 1_000
        : 1;
  const suffix = divisor === 1_000_000_000
    ? "B"
    : divisor === 1_000_000
      ? "M"
      : divisor === 1_000
        ? "K"
        : "";
  const scaled = amount / divisor;
  return `${currency}${scaled.toLocaleString("en-US", {
    maximumFractionDigits: scaled < 10 ? 2 : 1,
  })}${suffix}`;
}

const geographyLabelPatterns: Array<[RegExp, string]> = [
  [/\boecd\b/i, "OECD"],
  [/\beuropean union\b|\beu\b/i, "European Union"],
  [/\beurope\b/i, "Europe"],
  [/\bglobal\b|\bworldwide\b|\binternational\b/i, "Global"],
];

function extractGeographyLabel(text: string) {
  for (const [pattern, label] of geographyLabelPatterns) {
    if (pattern.test(text)) return label;
  }
  return "Regional";
}

function buildPlanningEstimate(
  evidence: readonly DomainResearchEvidence[]
): MarketPlanningEstimate | null {
  const sourceBacked = evidence.filter(
    (item) =>
      isVerified(item) &&
      calculateEvidenceConfidence(item) >= 48 &&
      item.claim.trim() &&
      item.value.trim()
  );
  const explicitSize = sourceBacked.find(
    (item) =>
      /market.size|tam|addressable.market|market.value/i.test(evidenceText(item)) &&
      extractMarketAmount(`${item.claim} ${item.value}`)
  );
  const buyerPopulation = sourceBacked.find(
    (item) =>
      /business.population|buyer.population|addressable.customer|number.of.business|establishment|small.business/i.test(
        evidenceText(item)
      ) && extractNumber(`${item.claim} ${item.value}`)
  );
  const annualPricing = sourceBacked.find(
    (item) =>
      /pricing|subscription|per.month|per.year|annual.price|monthly.price/i.test(
        evidenceText(item)
      ) && extractNumber(`${item.claim} ${item.value}`)
  );

  let tamAmount = 0;
  let currency = "$";
  let basis = "";
  let tamLow = 0;
  let tamHigh = 0;
  const evidenceIds: string[] = [];

  if (explicitSize) {
    const numeric = extractMarketAmount(
      `${explicitSize.claim} ${explicitSize.value}`
    );
    if (!numeric) return null;
    tamAmount = numeric.amount;
    tamLow = tamAmount;
    tamHigh = tamAmount;
    currency = numeric.currency || "$";
    basis = `TAM planning baseline uses ${numeric.token} from [${explicitSize.id}].`;
    evidenceIds.push(explicitSize.id);
  } else if (buyerPopulation && annualPricing) {
    const buyers = extractNumber(`${buyerPopulation.claim} ${buyerPopulation.value}`);
    const pricing = extractNumber(`${annualPricing.claim} ${annualPricing.value}`);
    if (!buyers || !pricing) return null;
    const pricingText = evidenceText(annualPricing);
    const annualizedPrice = /per.month|monthly/i.test(pricingText)
      ? pricing.amount * 12
      : pricing.amount;
    tamAmount = buyers.amount * annualizedPrice;
    tamLow = tamAmount;
    tamHigh = tamAmount;
    currency = pricing.currency || "$";
    basis = `TAM = addressable buyers from [${buyerPopulation.id}] × annualized price from [${annualPricing.id}].`;
    evidenceIds.push(buyerPopulation.id, annualPricing.id);
  }

  if (!Number.isFinite(tamAmount) || tamAmount <= 0) return null;
  const samLow = tamLow * 0.25;
  const samHigh = tamHigh * 0.25;
  const somLow = samLow * 0.02;
  const somHigh = samHigh * 0.02;
  const supporting = sourceBacked.filter((item) => evidenceIds.includes(item.id));
  const confidence = calculatePlanningEstimateConfidence(
    supporting,
    false
  );
  const range = (low: number, high: number) =>
    low === high
      ? formatAmount(low, currency)
      : `${formatAmount(low, currency)}–${formatAmount(high, currency)}`;

  return {
    classification: "Estimated",
    tam: range(tamLow, tamHigh),
    sam: range(samLow, samHigh),
    som: range(somLow, somHigh),
    formula: `${basis} SAM = TAM × 25% serviceable-share assumption. SOM = SAM × 2% obtainable-share assumption.`,
    assumptions: [
      "[Assumption] Serviceable share is 25% until segment and geography data are validated.",
      "[Assumption] Obtainable share is 2% of SAM until paid conversion and capacity are validated.",
    ],
    evidenceIds: [...new Set(evidenceIds)],
    confidence,
    confidenceLevel: classifyMarketConfidence(confidence),
    basis: "source_based",
  };
}

export function buildMarketIntelligenceGraph(
  bundle: Pick<DomainResearchBundle, "evidence">,
  prompt = ""
): MarketIntelligenceGraph {
  const evidence = bundle.evidence;
  const vendorIntelligence = buildVendorIntelligenceGraph(evidence, prompt);
  const sanitizedSources = evidence
    .map((item) => {
      const sanitized = sanitizeResearchPublisher({
        publisher: item.publisher,
        title: item.sourceTitle,
        url: item.url,
      });
      if (!sanitized) return null;
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        evidenceId: item.id,
        title: sanitized.title,
        publisher: sanitized.publisher,
        url: canonicalUrl(sanitized.url.toString()),
        publishedDate: item.publishedDate,
        accessedAt: item.lastChecked,
        sourceType: item.sourceType,
        confidenceClassification: confidenceClassification(item),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
        claim: concise(item.claim),
      } satisfies MarketIntelligenceSource;
    })
    .filter((item): item is MarketIntelligenceSource => Boolean(item));

  // Every evidence ID that produced a real, valid-URL sanitized source --
  // BEFORE the canonical-URL dedup below collapses same-URL duplicates
  // down to one representative row. Two evidence items can legitimately
  // point at the same canonical URL (re-fetched, or discovered via two
  // different search queries); the dedup keeps only one row to display,
  // but the model was given every original ID and may correctly cite
  // whichever one it saw. Confirmed live: a citation to a real, gathered
  // source (not a hallucination) was rejected as an "orphan" purely
  // because its specific ID lost the dedup coin-flip to another ID
  // pointing at the same URL. This is the authoritative "was this ID ever
  // a real, gathered, valid-URL source" set -- the rendered `sources`
  // list below is a presentation dedup on top of it, not a narrower
  // definition of what counts as real.
  const citableEvidenceIds = new Set(sanitizedSources.map((item) => item.evidenceId));

  const sources = sanitizedSources.filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) => canonicalUrl(candidate.url) === canonicalUrl(item.url)
      ) === index
  );

  // Maps EVERY citable evidence ID -- not just the ones that survived the
  // canonical-URL dedup above as their own row -- to the one representative
  // MarketIntelligenceSource record a reader should see for it. Two
  // evidence IDs pointing at the same canonical URL both resolve to the
  // SAME record here, which is what lets the bibliography merge them into
  // a single reference entry (tagged with every ID that cites it) instead
  // of either duplicating the entry or losing the citation. Plain object,
  // not a Map, so this survives a JSON round-trip (report-cache snapshots
  // store this graph as JSON).
  const sourceRecordByEvidenceId: Record<string, MarketIntelligenceSource> = {};
  for (const item of sanitizedSources) {
    const representative =
      sources.find((candidate) => canonicalUrl(candidate.url) === canonicalUrl(item.url)) ||
      item;
    sourceRecordByEvidenceId[item.evidenceId] = representative;
  }

  const competitorMap = new Map<string, MarketIntelligenceCompetitor>();
  for (const vendor of vendorIntelligence.vendors) {
    competitorMap.set(vendor.name.toLocaleLowerCase("en"), {
      name: vendor.name,
      positioning: `${vendor.classifications.join(", ")}; target: ${vendor.targetCustomer}`,
      pricingEvidence:
        vendor.pricingModels.length > 0 ? vendor.pricingEvidence : "",
      confidenceClassification:
        vendor.confidence >= 48 ? "Verified" : "Estimated",
      confidenceScore: vendor.confidence,
      confidenceLevel: vendor.confidenceLevel,
      evidenceIds: vendor.evidenceSources,
    });
  }

  const commercialEvidenceIds = new Set(
    vendorIntelligence.vendors.flatMap((vendor) => vendor.evidenceSources)
  );

  const pricingModels = evidence
    .filter(
      (item) =>
        commercialEvidenceIds.has(item.id) &&
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 48 &&
        /pricing|subscription|per.month|per.year|usage.based|seat.based/i.test(
          evidenceText(item)
        )
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification:
          confidenceClassification(item) === "Verified"
            ? ("Verified" as const)
            : ("Estimated" as const),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const verifiedMarketSize = evidence
    .filter(
      (item) =>
        isAuthoritativeObservedMarketSize(item) &&
        /market.size|tam|sam|som|addressable.market/i.test(evidenceText(item)) &&
        Boolean(extractMarketAmount(`${item.claim} ${item.value}`))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification: "Verified" as const,
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const cagr = evidence
    .filter(
      (item) =>
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 48 &&
        /cagr|compound annual|growth rate|forecast growth/i.test(
          evidenceText(item)
        ) && /\d+(?:\.\d+)?\s*%/.test(evidenceText(item))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification:
          confidenceClassification(item) === "Verified"
            ? ("Verified" as const)
            : ("Estimated" as const),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const adjacentBenchmarks = evidence
    .filter(
      (item) =>
        (item.field === "global_benchmark" || item.field === "regional_benchmark") &&
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 40 &&
        Boolean(extractNumber(`${item.claim} ${item.value}`))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        geography: extractGeographyLabel(evidenceText(item)),
        evidenceIds: [item.id],
        confidenceClassification: "Estimated" as const,
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const baseCoverage = evaluateMarketResearchCoverage(evidence, prompt);
  const competitorBreadth = competitorMap.size;
  const planningEstimate = buildPlanningEstimate(evidence);
  const competitiveEvidence = Math.max(
    baseCoverage.dimensions.competitiveEvidence,
    vendorIntelligence.coverage.competitiveCoverageScore,
    Math.min(100, competitorBreadth * 13 + baseCoverage.averageQuality * 0.15)
  );
  const financialEvidence = Math.max(
    baseCoverage.dimensions.financialEvidence,
    planningEstimate ? Math.min(62, 30 + planningEstimate.confidence * 0.3) : 0,
    // No verified local market-size figure and no source-based planning
    // estimate is not the same as no financial signal at all -- a real
    // Europe/OECD/regional benchmark is still concrete evidence the model
    // can reason from, just never presented as the requested geography's
    // own verified number (adjacentBenchmarks stays a separate array from
    // verifiedMarketSize/planningEstimate for exactly that reason).
    adjacentBenchmarks.length > 0 ? Math.min(40, 18 + adjacentBenchmarks.length * 6) : 0
  );
  const dimensions = {
    ...baseCoverage.dimensions,
    competitiveEvidence: Math.round(competitiveEvidence),
    financialEvidence: Math.round(financialEvidence),
  };
  const overallConfidence = calculateMarketOverallConfidence(dimensions);
  const coverage: MarketResearchCoverage = {
    ...baseCoverage,
    competitorBreadth,
    dimensions,
    overallConfidence,
  };

  return {
    version: MARKET_INTELLIGENCE_GRAPH_VERSION,
    competitors: [...competitorMap.values()],
    pricingModels,
    verifiedMarketSize,
    planningEstimate,
    adjacentBenchmarks,
    cagr,
    sources,
    citableEvidenceIds,
    sourceRecordByEvidenceId,
    vendorIntelligence,
    coverage,
  };
}

// Drops `version` (a static constant, identical on every call, carries zero
// information for the model) and `null`-valued keys (a JSON `null` costs
// tokens to encode and parse for the same "no data" meaning an omitted key
// already conveys) before serializing. No information available to the
// model is removed -- every non-null field/array is sent exactly as before.
export function formatMarketIntelligenceGraphForModel(
  graph: MarketIntelligenceGraph
) {
  const { version, ...rest } = graph;
  void version;
  return JSON.stringify(rest, (_key, value) => (value === null ? undefined : value));
}

type MarketGraphLanguage = "English" | "Turkish" | "German" | "French" | "Spanish";

type MarketGraphCopyKey =
  | "marketInfrastructureTitle"
  | "pricingEvidenceLabel"
  | "competitorComparisonTitle"
  | "majorPlayersTitle"
  | "insufficientMajorPlayers"
  | "verifiedMarketSizeTitle"
  | "planningEstimateTitle"
  | "formulaLabel"
  | "confidenceLabel"
  | "tamSamSomUnavailable"
  | "tableHeader"
  | "notEstablished"
  | "notPubliclyValidated"
  | "notProvided"
  | "publisherLabel"
  | "publishedLabel"
  | "accessedLabel"
  | "sourceTypeLabel"
  | "classificationLabel"
  | "claimLinkageLabel"
  | "basisLabel"
  | "evidenceLabel"
  | "assumptionOnlyScenario"
  | "verifiedTag"
  | "estimatedTag"
  | "assumptionTag"
  | "noValidatedPricingEvidence"
  | "noValidatedStrengthEvidence"
  | "noValidatedWeaknessEvidence"
  | "commercialVendorReasonTemplate"
  | "excludedVendorReasonTemplate"
  | "entityTypeGovernment"
  | "entityTypeRegulator"
  | "entityTypeStandardsBody"
  | "reasonRegulator"
  | "reasonGovernment"
  | "reasonStandardsBody"
  | "targetCustomerLabel"
  | "rankingLabel"
  | "overallScoreLabel"
  | "sourcesTitle"
  | "noVerifiableSourcesText";

const marketGraphCopy: Record<MarketGraphLanguage, Record<MarketGraphCopyKey, string>> = {
  English: {
    marketInfrastructureTitle: "Market Infrastructure",
    pricingEvidenceLabel: "Pricing evidence",
    competitorComparisonTitle: "Validated competitor comparison",
    majorPlayersTitle: "Evidence-supported major players",
    insufficientMajorPlayers:
      "Insufficient independent evidence for Major Players ranking; validated commercial vendors remain available in the Competitive Landscape.",
    verifiedMarketSizeTitle: "Verified market-size evidence",
    planningEstimateTitle: "Planning Estimate — not externally verified market size",
    formulaLabel: "Formula",
    confidenceLabel: "Confidence",
    tamSamSomUnavailable:
      "A verified market-size figure (TAM / SAM / SOM) could not be established for this market. No comparable local, regional, or global benchmark was available to build a labeled estimate from, and the available data on buyer population and pricing was not sufficient together to construct one either. This gap reflects a lack of published data for this specific scope, not the size of the opportunity. The number of vendors identified was not used on its own to fabricate a market-size figure.",
    tableHeader:
      "| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Evidence Count | Confidence | Market Relevance |",
    notEstablished: "Not disclosed in public sources",
    notPubliclyValidated: "Not independently confirmed",
    notProvided: "Not disclosed",
    publisherLabel: "Publisher",
    publishedLabel: "Published",
    accessedLabel: "Accessed",
    sourceTypeLabel: "Source type",
    classificationLabel: "Classification",
    claimLinkageLabel: "Claim linkage",
    sourcesTitle: "Sources",
    noVerifiableSourcesText:
      "No independently verifiable sources were used in this report.",
    basisLabel: "Basis",
    evidenceLabel: "Evidence",
    assumptionOnlyScenario: "assumption-only scenario",
    verifiedTag: "Verified",
    estimatedTag: "Estimated",
    assumptionTag: "Assumption",
    noValidatedPricingEvidence: "Pricing not publicly disclosed",
    noValidatedStrengthEvidence: "No distinct strength identified in public sources",
    noValidatedWeaknessEvidence: "No distinct weakness identified in public sources",
    commercialVendorReasonTemplate: "%NAME% is a commercial product vendor with evidence directly tied to %CATEGORY%.",
    excludedVendorReasonTemplate: "%NAME% is identified by the evidence as an implementation partner, marketplace, outsourced service provider, or advisory firm rather than a commercial product vendor in this market.",
    entityTypeGovernment: "government",
    entityTypeRegulator: "regulator",
    entityTypeStandardsBody: "standards body",
    reasonRegulator: "Regulatory authority, filing platform, or disclosure system.",
    reasonGovernment: "Government entity or official government domain.",
    reasonStandardsBody: "Trade association, exhibition organizer, or professional/technical standards body.",
    targetCustomerLabel: "Target",
    rankingLabel: "Ranking",
    overallScoreLabel: "Overall score",
  },
  Turkish: {
    marketInfrastructureTitle: "Pazar Altyapısı",
    pricingEvidenceLabel: "Fiyatlandırma kanıtı",
    competitorComparisonTitle: "Doğrulanmış rakip karşılaştırması",
    majorPlayersTitle: "Kanıt destekli başlıca oyuncular",
    insufficientMajorPlayers:
      "Başlıca Oyuncular sıralaması için bağımsız kanıt yetersiz; doğrulanmış ticari satıcılar Rekabet Ortamı bölümünde yer almaya devam ediyor.",
    verifiedMarketSizeTitle: "Doğrulanmış pazar büyüklüğü kanıtı",
    planningEstimateTitle: "Planlama Tahmini — dış kaynakla doğrulanmış pazar büyüklüğü değildir",
    formulaLabel: "Formül",
    confidenceLabel: "Güven",
    tamSamSomUnavailable:
      "Bu pazar için doğrulanmış bir TAM / SAM / SOM rakamı belirlenemedi. Etiketli bir tahmin oluşturmak için karşılaştırılabilir yerel, bölgesel veya küresel bir referans veri bulunamadı; alıcı nüfusu ve fiyatlandırmaya dair mevcut veriler de birlikte yeterli değildi. Bu boşluk, fırsatın büyüklüğünü değil, bu kapsam için yayımlanmış veri eksikliğini yansıtır. Tespit edilen tedarikçi sayısı tek başına bir pazar büyüklüğü rakamı üretmek için kullanılmamıştır.",
    tableHeader:
      "| Tedarikçi | Ana Şirket | Kategori | Segment | Yapay Zeka Yeteneği | Temel Kullanım Alanları | Fiyatlandırma Modeli | Güçlü Yönler | Zayıf Yönler | Kanıt Sayısı | Güven | Pazar Uygunluğu |",
    notEstablished: "Kamuya açık kaynaklarda belirtilmemiş",
    notPubliclyValidated: "Bağımsız olarak teyit edilmemiş",
    notProvided: "Belirtilmemiş",
    publisherLabel: "Yayıncı",
    publishedLabel: "Yayın tarihi",
    accessedLabel: "Erişim tarihi",
    sourceTypeLabel: "Kaynak türü",
    classificationLabel: "Sınıflandırma",
    claimLinkageLabel: "İddia bağlantısı",
    sourcesTitle: "Kaynaklar",
    noVerifiableSourcesText:
      "Bu raporda bağımsız olarak doğrulanabilir bir kaynak kullanılmadı.",
    basisLabel: "Temel",
    evidenceLabel: "Kanıt",
    assumptionOnlyScenario: "sadece varsayıma dayalı senaryo",
    verifiedTag: "Doğrulanmış",
    estimatedTag: "Tahmini",
    assumptionTag: "Varsayım",
    noValidatedPricingEvidence: "Fiyatlandırma bilgisi kamuya açık değil",
    noValidatedStrengthEvidence: "Kamuya açık kaynaklarda belirgin bir güçlü yön bulunmuyor",
    noValidatedWeaknessEvidence: "Kamuya açık kaynaklarda belirgin bir zayıf yön bulunmuyor",
    commercialVendorReasonTemplate: "%NAME%, %CATEGORY% ile doğrudan ilişkili kanıtlara sahip ticari bir ürün tedarikçisidir.",
    excludedVendorReasonTemplate: "Kanıtlar %NAME%'i bu pazarda ticari bir ürün tedarikçisi değil; bir uygulama ortağı, pazaryeri, dış kaynaklı hizmet sağlayıcısı veya danışmanlık firması olarak tanımlıyor.",
    entityTypeGovernment: "kamu kurumu",
    entityTypeRegulator: "düzenleyici kurum",
    entityTypeStandardsBody: "standart/birlik kuruluşu",
    reasonRegulator: "Düzenleyici kurum, başvuru platformu veya kamuyu aydınlatma sistemi.",
    reasonGovernment: "Kamu kurumu veya resmi devlet alan adı.",
    reasonStandardsBody: "Ticaret birliği, fuar organizatörü veya mesleki/teknik standart kuruluşu.",
    targetCustomerLabel: "Hedef müşteri",
    rankingLabel: "Sıralama",
    overallScoreLabel: "Genel skor",
  },
  German: {
    marketInfrastructureTitle: "Marktinfrastruktur",
    pricingEvidenceLabel: "Preisnachweis",
    competitorComparisonTitle: "Validierter Wettbewerbervergleich",
    majorPlayersTitle: "Durch Nachweise gestützte Hauptakteure",
    insufficientMajorPlayers:
      "Unzureichende unabhängige Nachweise für die Rangliste der Hauptakteure; validierte kommerzielle Anbieter sind weiterhin in der Wettbewerbslandschaft verfügbar.",
    verifiedMarketSizeTitle: "Verifizierter Nachweis zur Marktgröße",
    planningEstimateTitle: "Planungsschätzung — keine extern verifizierte Marktgröße",
    formulaLabel: "Formel",
    confidenceLabel: "Konfidenz",
    tamSamSomUnavailable:
      "Für diesen Markt konnte kein verifizierter TAM-/SAM-/SOM-Wert ermittelt werden. Es lag weder ein vergleichbarer lokaler, regionaler oder globaler Referenzwert vor, um daraus eine gekennzeichnete Schätzung abzuleiten, noch reichten die verfügbaren Daten zu Käuferpopulation und Preisgestaltung gemeinsam aus, um eine eigene Schätzung zu erstellen. Diese Lücke spiegelt das Fehlen veröffentlichter Daten für diesen konkreten Rahmen wider, nicht die Größe der Chance. Die Anzahl der identifizierten Anbieter allein wurde nicht verwendet, um eine Marktgröße zu erfinden.",
    tableHeader:
      "| Anbieter | Muttergesellschaft | Kategorie | Segment | KI-Fähigkeit | Wichtigste Anwendungsfälle | Preismodell | Stärken | Schwächen | Anzahl Nachweise | Konfidenz | Marktrelevanz |",
    notEstablished: "In öffentlichen Quellen nicht angegeben",
    notPubliclyValidated: "Nicht unabhängig bestätigt",
    notProvided: "Nicht angegeben",
    publisherLabel: "Herausgeber",
    publishedLabel: "Veröffentlicht",
    accessedLabel: "Zugegriffen",
    sourceTypeLabel: "Quellentyp",
    classificationLabel: "Klassifizierung",
    claimLinkageLabel: "Aussagenbezug",
    sourcesTitle: "Quellen",
    noVerifiableSourcesText:
      "In diesem Bericht wurden keine unabhängig überprüfbaren Quellen verwendet.",
    basisLabel: "Grundlage",
    evidenceLabel: "Nachweis",
    assumptionOnlyScenario: "reines Annahmenszenario",
    verifiedTag: "Verifiziert",
    estimatedTag: "Geschätzt",
    assumptionTag: "Annahme",
    noValidatedPricingEvidence: "Preisinformationen nicht öffentlich verfügbar",
    noValidatedStrengthEvidence: "Keine erkennbare Stärke in öffentlichen Quellen",
    noValidatedWeaknessEvidence: "Keine erkennbare Schwäche in öffentlichen Quellen",
    commercialVendorReasonTemplate: "%NAME% ist ein kommerzieller Produktanbieter mit Nachweisen, die direkt mit %CATEGORY% verbunden sind.",
    excludedVendorReasonTemplate: "%NAME% wird durch die Nachweise als Implementierungspartner, Marktplatz, ausgelagerter Dienstleister oder Beratungsunternehmen identifiziert, nicht als kommerzieller Produktanbieter in diesem Markt.",
    entityTypeGovernment: "Regierungsbehörde",
    entityTypeRegulator: "Aufsichtsbehörde",
    entityTypeStandardsBody: "Normungsorganisation",
    reasonRegulator: "Aufsichtsbehörde, Meldeplattform oder Offenlegungssystem.",
    reasonGovernment: "Regierungsbehörde oder offizielle Regierungsdomain.",
    reasonStandardsBody: "Handelsverband, Messeveranstalter oder fachliche/technische Normungsorganisation.",
    targetCustomerLabel: "Zielkunde",
    rankingLabel: "Rang",
    overallScoreLabel: "Gesamtbewertung",
  },
  French: {
    marketInfrastructureTitle: "Infrastructure du marché",
    pricingEvidenceLabel: "Preuve tarifaire",
    competitorComparisonTitle: "Comparaison validée des concurrents",
    majorPlayersTitle: "Principaux acteurs étayés par des preuves",
    insufficientMajorPlayers:
      "Preuves indépendantes insuffisantes pour le classement des principaux acteurs ; les fournisseurs commerciaux validés restent disponibles dans le paysage concurrentiel.",
    verifiedMarketSizeTitle: "Preuve vérifiée de la taille du marché",
    planningEstimateTitle: "Estimation de planification — taille de marché non vérifiée en externe",
    formulaLabel: "Formule",
    confidenceLabel: "Confiance",
    tamSamSomUnavailable:
      "Aucun chiffre TAM / SAM / SOM vérifié n'a pu être établi pour ce marché. Aucune référence locale, régionale ou mondiale comparable n'était disponible pour construire une estimation clairement indiquée, et les données disponibles sur la population d'acheteurs et la tarification n'étaient pas non plus suffisantes ensemble pour en construire une. Cet écart reflète l'absence de données publiées pour ce périmètre précis, et non la taille de l'opportunité. Le nombre de fournisseurs identifiés seul n'a pas été utilisé pour fabriquer un chiffre de taille de marché.",
    tableHeader:
      "| Fournisseur | Société mère | Catégorie | Segment | Capacité IA | Cas d'usage clés | Modèle tarifaire | Forces | Faiblesses | Nombre de preuves | Confiance | Pertinence pour le marché |",
    notEstablished: "Non indiqué dans les sources publiques",
    notPubliclyValidated: "Non confirmé de manière indépendante",
    notProvided: "Non indiqué",
    publisherLabel: "Éditeur",
    publishedLabel: "Publié",
    accessedLabel: "Consulté",
    sourceTypeLabel: "Type de source",
    classificationLabel: "Classification",
    claimLinkageLabel: "Lien avec l'affirmation",
    sourcesTitle: "Sources",
    noVerifiableSourcesText:
      "Aucune source vérifiable de manière indépendante n'a été utilisée dans ce rapport.",
    basisLabel: "Base",
    evidenceLabel: "Preuve",
    assumptionOnlyScenario: "scénario basé uniquement sur des hypothèses",
    verifiedTag: "Vérifié",
    estimatedTag: "Estimé",
    assumptionTag: "Hypothèse",
    noValidatedPricingEvidence: "Tarification non communiquée publiquement",
    noValidatedStrengthEvidence: "Aucun point fort identifiable dans les sources publiques",
    noValidatedWeaknessEvidence: "Aucun point faible identifiable dans les sources publiques",
    commercialVendorReasonTemplate: "%NAME% est un fournisseur de produits commerciaux avec des preuves directement liées à %CATEGORY%.",
    excludedVendorReasonTemplate: "%NAME% est identifié par les preuves comme un partenaire de mise en œuvre, une place de marché, un prestataire de services externalisé ou un cabinet de conseil plutôt qu'un fournisseur de produits commerciaux sur ce marché.",
    entityTypeGovernment: "organisme public",
    entityTypeRegulator: "organisme de régulation",
    entityTypeStandardsBody: "organisme de normalisation",
    reasonRegulator: "Autorité de régulation, plateforme de dépôt ou système de divulgation.",
    reasonGovernment: "Entité gouvernementale ou domaine gouvernemental officiel.",
    reasonStandardsBody: "Association professionnelle, organisateur de salons ou organisme de normalisation technique.",
    targetCustomerLabel: "Cible",
    rankingLabel: "Classement",
    overallScoreLabel: "Score global",
  },
  Spanish: {
    marketInfrastructureTitle: "Infraestructura del mercado",
    pricingEvidenceLabel: "Evidencia de precios",
    competitorComparisonTitle: "Comparación validada de competidores",
    majorPlayersTitle: "Principales actores respaldados por evidencia",
    insufficientMajorPlayers:
      "Evidencia independiente insuficiente para la clasificación de los principales actores; los proveedores comerciales validados siguen disponibles en el panorama competitivo.",
    verifiedMarketSizeTitle: "Evidencia verificada del tamaño del mercado",
    planningEstimateTitle: "Estimación de planificación — tamaño de mercado no verificado externamente",
    formulaLabel: "Fórmula",
    confidenceLabel: "Confianza",
    tamSamSomUnavailable:
      "No se pudo establecer una cifra verificada de TAM / SAM / SOM para este mercado. No había una referencia local, regional o global comparable para construir una estimación claramente etiquetada, y los datos disponibles sobre población de compradores y precios tampoco fueron suficientes en conjunto para construir una. Esta brecha refleja la falta de datos publicados para este alcance específico, no el tamaño de la oportunidad. El número de proveedores identificados por sí solo no se utilizó para fabricar una cifra de tamaño de mercado.",
    tableHeader:
      "| Proveedor | Empresa matriz | Categoría | Segmento | Capacidad de IA | Casos de uso clave | Modelo de precios | Fortalezas | Debilidades | Cantidad de evidencia | Confianza | Relevancia para el mercado |",
    notEstablished: "No indicado en fuentes públicas",
    notPubliclyValidated: "No confirmado de forma independiente",
    notProvided: "No indicado",
    publisherLabel: "Editor",
    publishedLabel: "Publicado",
    accessedLabel: "Consultado",
    sourceTypeLabel: "Tipo de fuente",
    classificationLabel: "Clasificación",
    claimLinkageLabel: "Vínculo con la afirmación",
    sourcesTitle: "Fuentes",
    noVerifiableSourcesText:
      "No se utilizaron fuentes verificables de forma independiente en este informe.",
    basisLabel: "Base",
    evidenceLabel: "Evidencia",
    assumptionOnlyScenario: "escenario basado únicamente en suposiciones",
    verifiedTag: "Verificado",
    estimatedTag: "Estimado",
    assumptionTag: "Suposición",
    noValidatedPricingEvidence: "Precios no disponibles públicamente",
    noValidatedStrengthEvidence: "Sin fortaleza distintiva identificada en fuentes públicas",
    noValidatedWeaknessEvidence: "Sin debilidad distintiva identificada en fuentes públicas",
    commercialVendorReasonTemplate: "%NAME% es un proveedor de productos comerciales con evidencia directamente vinculada a %CATEGORY%.",
    excludedVendorReasonTemplate: "La evidencia identifica a %NAME% como un socio de implementación, mercado, proveedor de servicios subcontratado o firma consultora, no como un proveedor de productos comerciales en este mercado.",
    entityTypeGovernment: "entidad gubernamental",
    entityTypeRegulator: "organismo regulador",
    entityTypeStandardsBody: "organismo de normalización",
    reasonRegulator: "Autoridad reguladora, plataforma de presentación o sistema de divulgación.",
    reasonGovernment: "Entidad gubernamental o dominio gubernamental oficial.",
    reasonStandardsBody: "Asociación comercial, organizador de ferias u organismo de normalización profesional/técnica.",
    targetCustomerLabel: "Cliente objetivo",
    rankingLabel: "Clasificación",
    overallScoreLabel: "Puntuación general",
  },
};

function copyLanguage(language: string): MarketGraphLanguage {
  return language in marketGraphCopy ? (language as MarketGraphLanguage) : "English";
}

function classificationTag(language: string, classification: "Verified" | "Estimated" | "Assumption") {
  const copy = marketGraphCopy[copyLanguage(language)];
  if (classification === "Verified") return copy.verifiedTag;
  if (classification === "Estimated") return copy.estimatedTag;
  return copy.assumptionTag;
}

function marketTableCell(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

// Natural-language, localized explanation of competitive-evidence coverage
// -- replaces a raw internal-diagnostics dump (candidate counts, packed
// discovery queries, "no vendor mentions passed validation") that used to
// be spliced directly into competitiveLandscape/majorPlayers. Built here
// (not in vendor-intelligence.ts) because this is the one place both the
// report's target language and the raw coverage numbers are in scope.
function describeCompetitiveCoverage(
  language: MarketGraphLanguage,
  coverage: { vendorCount: number; independentProviderSources: number; sufficient: boolean }
): string {
  const { vendorCount, independentProviderSources, sufficient } = coverage;

  if (sufficient) {
    return {
      English: `Confirmed by independent, publicly available sources covering ${vendorCount} named competitors across ${independentProviderSources} independent sources.`,
      Turkish: `${vendorCount} isimli rakip, ${independentProviderSources} bağımsız kaynak genelinde bağımsız ve kamuya açık kaynaklarla doğrulanmıştır.`,
      German: `Bestätigt durch unabhängige, öffentlich verfügbare Quellen zu ${vendorCount} namentlich genannten Wettbewerbern über ${independentProviderSources} unabhängige Quellen.`,
      French: `Confirmé par des sources indépendantes et publiquement disponibles couvrant ${vendorCount} concurrents nommés sur ${independentProviderSources} sources indépendantes.`,
      Spanish: `Confirmado por fuentes independientes y disponibles públicamente que cubren ${vendorCount} competidores nombrados en ${independentProviderSources} fuentes independientes.`,
    }[language];
  }

  if (vendorCount === 0) {
    return {
      English:
        "Independent, publicly available information on named competitors in this market was limited during research. Competitive intensity below is inferred from category-level and structural evidence rather than confirmed vendor profiles -- this narrows confidence in company-specific claims but does not indicate an absence of competition.",
      Turkish:
        "Yeterli doğrulanmış ticari rakip bulunamadı. Bu pazardaki isimli rakiplere ilişkin bağımsız ve kamuya açık bilgi, araştırma sırasında sınırlı kalmıştır. Aşağıdaki rekabet yoğunluğu, doğrulanmış rakip profillerinden ziyade kategori düzeyindeki yapısal kanıtlardan çıkarılmıştır; bu durum şirkete özgü iddialara olan güveni azaltır, ancak rekabetin yokluğu anlamına gelmez.",
      German:
        "Unabhängige, öffentlich verfügbare Informationen zu namentlich genannten Wettbewerbern in diesem Markt waren während der Recherche begrenzt. Die untenstehende Wettbewerbsintensität wird aus kategorieweiter, struktureller Evidenz abgeleitet und nicht aus bestätigten Anbieterprofilen -- dies verringert das Vertrauen in unternehmensspezifische Aussagen, bedeutet aber nicht das Fehlen von Wettbewerb.",
      French:
        "Les informations indépendantes et accessibles au public sur les concurrents nommés de ce marché étaient limitées durant la recherche. L'intensité concurrentielle ci-dessous est déduite de preuves structurelles au niveau de la catégorie plutôt que de profils de fournisseurs confirmés -- cela réduit la confiance dans les affirmations propres à l'entreprise sans indiquer une absence de concurrence.",
      Spanish:
        "La información independiente y disponible públicamente sobre competidores nombrados en este mercado fue limitada durante la investigación. La intensidad competitiva a continuación se infiere de evidencia estructural a nivel de categoría en lugar de perfiles de proveedores confirmados; esto reduce la confianza en afirmaciones específicas de la empresa, pero no indica ausencia de competencia.",
    }[language];
  }

  return {
    English: `Only ${vendorCount} named competitors could be independently confirmed from public sources (target: 5+), across ${independentProviderSources} independent sources. Competitive intensity is directionally reliable, but company-specific detail below should be read with that limitation in mind.`,
    Turkish: `Kamuya açık kaynaklardan bağımsız olarak yalnızca ${vendorCount} isimli rakip doğrulanabilmiştir (hedef: 5+), ${independentProviderSources} bağımsız kaynak genelinde. Rekabet yoğunluğu yönü itibarıyla güvenilirdir, ancak aşağıdaki şirkete özgü detaylar bu sınırlama göz önünde bulundurularak okunmalıdır.`,
    German: `Aus öffentlichen Quellen konnten unabhängig nur ${vendorCount} namentlich genannte Wettbewerber bestätigt werden (Ziel: 5+), über ${independentProviderSources} unabhängige Quellen. Die Wettbewerbsintensität ist richtungsweisend verlässlich, die unternehmensspezifischen Details unten sollten jedoch unter Berücksichtigung dieser Einschränkung gelesen werden.`,
    French: `Seuls ${vendorCount} concurrents nommés ont pu être confirmés indépendamment à partir de sources publiques (objectif : 5+), sur ${independentProviderSources} sources indépendantes. L'intensité concurrentielle est directionnellement fiable, mais les détails spécifiques à l'entreprise ci-dessous doivent être lus en tenant compte de cette limite.`,
    Spanish: `Solo se pudieron confirmar de forma independiente ${vendorCount} competidores nombrados a partir de fuentes públicas (objetivo: 5+), en ${independentProviderSources} fuentes independientes. La intensidad competitiva es direccionalmente confiable, pero el detalle específico de la empresa a continuación debe leerse teniendo en cuenta esa limitación.`,
  }[language];
}

// vendor-intelligence.ts's field builders have no concept of report
// language (they run before language is known) and fall back to fixed
// English sentinel strings when evidence is missing -- confirmed live in
// a Turkish report as "Not established by validated evidence" and "No
// validated weakness evidence" rendered verbatim inside an otherwise
// Turkish competitor table. Translating the known sentinel values here,
// at the one place the target language and the raw graph are both in
// scope, is cheaper and lower-risk than threading a language parameter
// through the whole vendor-discovery pipeline for values that never
// carry real information beyond "this wasn't found."
function localizeVendorFallbackText(
  value: string,
  copy: Record<MarketGraphCopyKey, string>
): string {
  if (value === "Not established by validated evidence") return copy.notEstablished;
  if (value === "No validated public pricing evidence") return copy.noValidatedPricingEvidence;
  if (value === "No validated strength evidence") return copy.noValidatedStrengthEvidence;
  if (value === "No validated weakness evidence") return copy.noValidatedWeaknessEvidence;
  return value;
}

const commercialVendorReasonPattern =
  /^(.+?) is a commercial product vendor with evidence directly tied to (.+?)\.$/;
const excludedVendorReasonPattern =
  /^Excluded: evidence identifies (.+?) as an implementation partner, marketplace, outsourced service provider, or advisory firm rather than a commercial product vendor in this market\.$/;

// assessMarketRelevance (vendor-discovery.ts) builds vendor.marketRelevance
// as an English sentence with the vendor name and category interpolated,
// for the same no-language-context reason as above -- confirmed live as
// the literal phrase "commercial product vendor" appearing in a Turkish
// competitor table's last column. Both known sentence shapes are
// reconstructed here from their own interpolated pieces rather than
// translated word-for-word, since the vendor name and category must stay
// exactly as evidence identified them.
function localizeMarketRelevanceReason(
  reason: string,
  copy: Record<MarketGraphCopyKey, string>
): string {
  const relevantMatch = reason.match(commercialVendorReasonPattern);
  if (relevantMatch) {
    return copy.commercialVendorReasonTemplate
      .replace("%NAME%", relevantMatch[1])
      .replace("%CATEGORY%", relevantMatch[2]);
  }

  const excludedMatch = reason.match(excludedVendorReasonPattern);
  if (excludedMatch) {
    return copy.excludedVendorReasonTemplate.replace("%NAME%", excludedMatch[1]);
  }

  return reason;
}

// vendor-intelligence.ts's pricing-model classifier (extractPricingModels)
// and its AI-capability tag are, like its other field builders, computed
// with no concept of report language and hardcode fixed English labels
// (VendorPricingModel's 13 literal values, plus the AI-capability tag) --
// rendered verbatim into the competitor table (vendor.pricingModels.join,
// vendor.aiCapability) with no localization call at all, unlike
// strength/weakness/marketRelevance which already route through
// localizeVendorFallbackText/localizeMarketRelevanceReason. A standalone
// per-language lookup, not routed through MarketGraphCopyKey, since these
// ~13 short tags are a closed set specific to this one rendering site.
const vendorPricingModelLabels: Record<MarketGraphLanguage, Record<string, string>> = {
  English: {
    Subscription: "Subscription",
    "Seat pricing": "Seat pricing",
    "Usage pricing": "Usage-based pricing",
    Enterprise: "Enterprise pricing",
    Transaction: "Transaction-based pricing",
    "Success fee": "Success fee",
    Hybrid: "Hybrid pricing",
    "Public list price": "Public list price",
    "Quote-based": "Quote-based pricing",
    "Per user": "Per-user pricing",
    "Per company": "Per-company pricing",
    "Per document": "Per-document pricing",
    "Services included": "Services included",
  },
  Turkish: {
    Subscription: "Abonelik",
    "Seat pricing": "Kullanıcı başına fiyatlandırma",
    "Usage pricing": "Kullanım bazlı fiyatlandırma",
    Enterprise: "Kurumsal fiyatlandırma",
    Transaction: "İşlem bazlı fiyatlandırma",
    "Success fee": "Başarı ücreti",
    Hybrid: "Hibrit fiyatlandırma",
    "Public list price": "Kamuya açık liste fiyatı",
    "Quote-based": "Teklife dayalı fiyatlandırma",
    "Per user": "Kullanıcı başına",
    "Per company": "Şirket başına",
    "Per document": "Belge başına",
    "Services included": "Hizmetler dahil",
  },
  German: {
    Subscription: "Abonnement",
    "Seat pricing": "Preise pro Nutzer",
    "Usage pricing": "Nutzungsbasierte Preise",
    Enterprise: "Unternehmenspreise",
    Transaction: "Transaktionsbasierte Preise",
    "Success fee": "Erfolgshonorar",
    Hybrid: "Hybride Preisgestaltung",
    "Public list price": "Öffentlicher Listenpreis",
    "Quote-based": "Angebotsbasierte Preise",
    "Per user": "Pro Nutzer",
    "Per company": "Pro Unternehmen",
    "Per document": "Pro Dokument",
    "Services included": "Leistungen inbegriffen",
  },
  French: {
    Subscription: "Abonnement",
    "Seat pricing": "Tarification par utilisateur",
    "Usage pricing": "Tarification à l'usage",
    Enterprise: "Tarification entreprise",
    Transaction: "Tarification par transaction",
    "Success fee": "Commission au succès",
    Hybrid: "Tarification hybride",
    "Public list price": "Prix catalogue public",
    "Quote-based": "Tarification sur devis",
    "Per user": "Par utilisateur",
    "Per company": "Par entreprise",
    "Per document": "Par document",
    "Services included": "Services inclus",
  },
  Spanish: {
    Subscription: "Suscripción",
    "Seat pricing": "Precio por usuario",
    "Usage pricing": "Precio basado en el uso",
    Enterprise: "Precio empresarial",
    Transaction: "Precio por transacción",
    "Success fee": "Tarifa de éxito",
    Hybrid: "Precio híbrido",
    "Public list price": "Precio de lista público",
    "Quote-based": "Precio bajo cotización",
    "Per user": "Por usuario",
    "Per company": "Por empresa",
    "Per document": "Por documento",
    "Services included": "Servicios incluidos",
  },
};

function localizeVendorPricingModel(model: string, language: MarketGraphLanguage): string {
  return vendorPricingModelLabels[language][model] || model;
}

function localizeVendorPricingModelList(
  models: readonly string[],
  language: MarketGraphLanguage
): string {
  return models.map((model) => localizeVendorPricingModel(model, language)).join(", ");
}

const vendorAiCapabilityEnabledLabel: Record<MarketGraphLanguage, string> = {
  English: "AI-enabled (evidence-supported)",
  Turkish: "Yapay zeka destekli (kanıtla desteklenmiş)",
  German: "KI-gestützt (evidenzbasiert)",
  French: "Doté d'IA (étayé par des preuves)",
  Spanish: "Con IA (respaldado por evidencia)",
};

function localizeVendorAiCapability(
  value: string,
  language: MarketGraphLanguage,
  copy: Record<MarketGraphCopyKey, string>
): string {
  if (value === "AI-enabled (evidence-supported)") {
    return vendorAiCapabilityEnabledLabel[language];
  }
  return localizeVendorFallbackText(value, copy);
}

const institutionalEntityLabels: Record<string, MarketGraphCopyKey> = {
  government: "entityTypeGovernment",
  regulator: "entityTypeRegulator",
  standards_body: "entityTypeStandardsBody",
};

const institutionalEntityReasons: Record<string, MarketGraphCopyKey> = {
  "Regulatory authority, filing platform, or disclosure system.": "reasonRegulator",
  "Government entity or official government domain.": "reasonGovernment",
  "Trade association, exhibition organizer, or professional/technical standards body.":
    "reasonStandardsBody",
};

// Market Infrastructure only ever holds government/regulator/standards_body
// entities (commercial-vendor-intelligence.ts), each with one of exactly
// three fixed reason sentences -- a plain lookup, not a template, since
// none of them interpolate the entity's own name.
function localizeInstitutionalEntity(
  entityType: string,
  reason: string,
  copy: Record<MarketGraphCopyKey, string>
): { label: string; reason: string } {
  const labelKey = institutionalEntityLabels[entityType];
  const reasonKey = institutionalEntityReasons[reason];

  return {
    label: labelKey ? copy[labelKey] : entityType.replace(/_/g, " "),
    reason: reasonKey ? copy[reasonKey] : reason,
  };
}

/**
 * Produces the report fields that must remain identical to the final validated
 * graph. Model prose may enrich other sections, but it cannot replace these
 * evidence-owned competitors, calculations, classifications, or citations.
 */
export function projectMarketIntelligenceGraphToReport(
  graph: MarketIntelligenceGraph,
  language = "English"
): MarketIntelligenceReportProjection {
  const projection: MarketIntelligenceReportProjection = {};
  const vendorCoverage = graph.vendorIntelligence.coverage;

  const copy = marketGraphCopy[copyLanguage(language)];

  if (graph.vendorIntelligence.marketInfrastructure.length > 0) {
    projection.marketInfrastructure = [
      copy.marketInfrastructureTitle,
      ...graph.vendorIntelligence.marketInfrastructure.map((entity) => {
        const localized = localizeInstitutionalEntity(entity.entityType, entity.reason, copy);

        return `- ${entity.name} — ${localized.label} (${localized.reason}; ${entity.evidenceIds.map((id) => `[${id}]`).join(", ")})`;
      }),
    ].join("\n");
  }

  // Final, rendering-time gate: independent of every upstream discovery/
  // validation step above, no vendor whose name fails a basic real-company-
  // name shape check is ever allowed into the table or Major Players list --
  // confirmed live, this is what previously let prompt/instruction
  // fragments and evidence-provider domain labels reach the PDF even though
  // they had already passed discovery. If filtering drops every candidate,
  // this falls through to the same honest "insufficient evidence" copy as
  // having found zero competitors at all -- never a fabricated stand-in.
  const renderableVendors = graph.vendorIntelligence.vendors.filter(
    (vendor) => !isImplausibleCompetitorName(vendor.name)
  );

  if (renderableVendors.length > 0) {
    const competitorLines = renderableVendors.map(
      (vendor) =>
        `| ${marketTableCell(vendor.name)} | ${marketTableCell(vendor.parentCompany === vendor.name ? "-" : vendor.parentCompany)} | ${marketTableCell(vendor.category)} | ${marketTableCell(vendor.segment)} | ${marketTableCell(localizeVendorAiCapability(vendor.aiCapability, copyLanguage(language), copy))} | ${marketTableCell(vendor.keyUseCases.join("; ") || copy.notEstablished)} | ${marketTableCell(vendor.pricingModels.length ? localizeVendorPricingModelList(vendor.pricingModels, copyLanguage(language)) : copy.notPubliclyValidated)} | ${marketTableCell(localizeVendorFallbackText(vendor.strength, copy))} | ${marketTableCell(localizeVendorFallbackText(vendor.weakness, copy))} | ${vendor.evidenceCount} | ${vendor.confidence}/100 (${vendor.confidenceLevel}) | ${marketTableCell(localizeMarketRelevanceReason(vendor.marketRelevance, copy))} |`
    );
    const pricingLines = graph.pricingModels.map(
      (pricing) =>
        `- ${copy.pricingEvidenceLabel}: ${pricing.description} (${classificationTag(language, pricing.confidenceClassification)}; ${copy.confidenceLabel.toLowerCase()} ${pricing.confidenceScore}/100 ${pricing.confidenceLevel}; ${pricing.evidenceIds.map((id) => `[${id}]`).join(", ")})`
    );
    projection.competitiveLandscape = [
      copy.competitorComparisonTitle,
      describeCompetitiveCoverage(copyLanguage(language), vendorCoverage),
      copy.tableHeader,
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |",
      ...competitorLines,
      ...pricingLines,
    ].join("\n");
    projection.majorPlayers = [
      copy.majorPlayersTitle,
      ...renderableVendors
        .filter((vendor) => vendor.eligibleForMajorPlayers)
        .map(
          (vendor) =>
            `- ${vendor.name} (${vendor.majorPlayerLabel}): ${vendor.classifications.join(", ")}; ${copy.targetCustomerLabel.toLowerCase()}: ${localizeVendorFallbackText(vendor.targetCustomer, copy)} (${copy.rankingLabel.toLowerCase()} ${vendor.rankingScore}/100; ${copy.overallScoreLabel.toLowerCase()} ${vendor.overallVendorScore}/100; ${copy.confidenceLabel.toLowerCase()} ${vendor.confidence}/100 ${vendor.confidenceLevel}; ${vendor.evidenceSources.map((id) => `[${id}]`).join(", ")})`
      ),
    ].join("\n");
    if (!renderableVendors.some((vendor) => vendor.eligibleForMajorPlayers)) {
      projection.majorPlayers = copy.insufficientMajorPlayers;
    }
  } else {
    const coverageDescription = describeCompetitiveCoverage(copyLanguage(language), vendorCoverage);
    projection.competitiveLandscape = coverageDescription;
    projection.majorPlayers = coverageDescription;
  }

  if (graph.verifiedMarketSize.length > 0) {
    const sizing = [
      copy.verifiedMarketSizeTitle,
      ...graph.verifiedMarketSize.map(
        (item) =>
          `- [${copy.verifiedTag}] ${item.description} | ${copy.confidenceLabel}: ${item.confidenceScore}/100 (${item.confidenceLevel}) | ${copy.evidenceLabel}: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      ),
    ].join("\n");
    projection.marketSize = sizing;
    // tamSamSom is deliberately left untouched here, not overwritten with
    // this same raw sizing line -- a verified market-size figure is a
    // single headline number, not a TAM/SAM/SOM breakdown (TAM/SAM/SOM
    // must still be nested, TAM >= SAM >= SOM, with an explicit
    // serviceable/obtainable derivation). marketPrompts.tamSamSom already
    // instructs the model to build exactly that breakdown FROM whichever
    // verified or benchmark figure is available. Confirmed live:
    // overwriting tamSamSom here discarded the model's own real
    // TAM/SAM/SOM derivation and replaced it with a bare copy of the
    // marketSize line, which the PDF's TAM/SAM/SOM chart then correctly
    // couldn't parse as three nested figures -- rendering "Could not be
    // calculated" despite the model having verified evidence to derive
    // from. Same principle already applied to the adjacentBenchmarks
    // branch below (see its own comment): never replace the model's real,
    // evidence-grounded analysis with a deterministic stand-in when it had
    // real material to build from.
  } else if (graph.planningEstimate) {
    const estimate = graph.planningEstimate;
    projection.tamSamSom = [
      copy.planningEstimateTitle,
      `TAM [${copy.estimatedTag}]: ${estimate.tam}`,
      `SAM [${copy.estimatedTag}]: ${estimate.sam}`,
      `SOM [${copy.estimatedTag}]: ${estimate.som}`,
      `${copy.formulaLabel}: ${estimate.formula}`,
      ...estimate.assumptions,
      `${copy.confidenceLabel}: ${estimate.confidence}/100 (${estimate.confidenceLevel}) | ${copy.basisLabel}: ${estimate.basis} | ${copy.evidenceLabel}: ${estimate.evidenceIds.map((id) => `[${id}]`).join(", ") || copy.assumptionOnlyScenario}`,
    ].join("\n");
  } else if (graph.adjacentBenchmarks.length === 0) {
    // Only forced to the flat "unavailable" notice when there is truly
    // nothing to reason from -- no verified local figure, no source-based
    // planning estimate, AND no regional/global benchmark either. When a
    // benchmark exists, the model has real, sourced material and explicit
    // instructions (marketPrompts.tamSamSom) to build its own transparent,
    // clearly labeled estimate from it -- overwriting that with this
    // generic string, as this branch used to do unconditionally, is
    // exactly the "insufficient evidence instead of the strongest
    // available analysis" failure mode this exists to prevent.
    projection.tamSamSom = copy.tamSamSomUnavailable;
  }

  if (graph.cagr.length > 0) {
    projection.cagr = graph.cagr
      .map(
        (item) =>
          `- [${classificationTag(language, item.confidenceClassification)}] ${item.description} | ${copy.confidenceLabel}: ${item.confidenceScore}/100 (${item.confidenceLevel}) | ${copy.evidenceLabel}: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      )
      .join("\n");
  }

  if (graph.sources.length > 0) {
    projection.sources = graph.sources
      .map(
        (source) =>
          `- [${source.evidenceId}] ${source.title} | ${copy.publisherLabel}: ${source.publisher} | URL: ${source.url} | ${copy.publishedLabel}: ${source.publishedDate || copy.notProvided} | ${copy.accessedLabel}: ${source.accessedAt || copy.notProvided} | ${copy.sourceTypeLabel}: ${source.sourceType} | ${copy.classificationLabel}: ${classificationTag(language, source.confidenceClassification)} | ${copy.confidenceLabel}: ${source.confidenceScore}/100 (${source.confidenceLevel}) | ${copy.claimLinkageLabel}: ${source.claim}`
      )
      .join("\n");
  }

  return projection;
}

const bibliographyReferencePattern = /\[R(\d+)\]/g;

/**
 * Builds the final, deterministic Sources bibliography: every [R#]
 * reference actually cited anywhere in the report body (never the model's
 * own free-form sources text, never a category+count compression), each
 * resolved to its real verified evidence record. Order matches first
 * citation appearance across sections; two IDs that resolve to the same
 * canonical document merge into one entry tagged with every ID that cites
 * it. The per-entry field labels below ("Title:", "Publisher:", ...) are
 * intentionally hardcoded in English regardless of `language` -- they are
 * parsing keys for ReportPdfButton.tsx's parseCitations, not user-facing
 * prose (matching that renderer's own existing English-only field labels,
 * e.g. "Source type:"/"Confidence:", which are not localized either).
 */
export function buildMarketIntelligenceBibliography(
  sections: Record<string, string | undefined>,
  graph: MarketIntelligenceGraph,
  language: string = "English"
): string {
  const copy = marketGraphCopy[copyLanguage(language)];

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const [field, content] of Object.entries(sections)) {
    if (field === "sources" || !content) continue;
    bibliographyReferencePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = bibliographyReferencePattern.exec(content))) {
      const id = `R${match[1]}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      orderedIds.push(id);
    }
  }

  if (orderedIds.length === 0) {
    return [copy.sourcesTitle, copy.noVerifiableSourcesText].join("\n");
  }

  const entryOrder: MarketIntelligenceSource[] = [];
  const tagsByRecord = new Map<MarketIntelligenceSource, string[]>();
  for (const id of orderedIds) {
    const record = graph.sourceRecordByEvidenceId[id];
    // Defensive only: assertNoOrphanEvidenceReferences already fails
    // generation before this function is ever reached if any cited ID
    // has no record, so this branch should be unreachable in practice.
    if (!record) continue;
    if (!tagsByRecord.has(record)) {
      tagsByRecord.set(record, []);
      entryOrder.push(record);
    }
    tagsByRecord.get(record)!.push(id);
  }

  const entries = entryOrder.map((record) => {
    const tags = (tagsByRecord.get(record) || []).map((id) => `[${id}]`).join("");
    const year = record.publishedDate.match(/\b(19|20)\d{2}\b/)?.[0];
    // A full ISO timestamp ("2026-08-15T00:00:00.000Z") reads worse than
    // a plain date in a citation card, and its "." trips the PDF
    // parser's own prose-rejection guard (built to reject a value like
    // "the gap in verified evidence." -- a real timestamp's decimal
    // point is an unrelated false positive against that same check), so
    // the field silently disappeared even when accessedAt was present.
    // Reducing to the plain YYYY-MM-DD date fixes both at once.
    const accessDate = record.accessedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || record.accessedAt;
    return [
      `Reference: ${tags}`,
      `Title: ${record.title}`,
      `Publisher: ${record.publisher}`,
      `URL: ${record.url}`,
      ...(year ? [`Year: ${year}`] : []),
      ...(accessDate ? [`Accessed: ${accessDate}`] : []),
      `Type: ${record.sourceType}`,
      `Confidence: ${record.confidenceLevel}`,
    ].join("\n");
  });

  return [copy.sourcesTitle, "", ...entries].join("\n\n").trim();
}
