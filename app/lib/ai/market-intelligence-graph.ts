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
  cagr: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified" | "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  sources: MarketIntelligenceSource[];
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
  const sources = evidence
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
    .filter((item): item is MarketIntelligenceSource => Boolean(item))
    .filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) => canonicalUrl(candidate.url) === canonicalUrl(item.url)
        ) === index
    );

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
    planningEstimate ? Math.min(62, 30 + planningEstimate.confidence * 0.3) : 0
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
    cagr,
    sources,
    vendorIntelligence,
    coverage,
  };
}

export function formatMarketIntelligenceGraphForModel(
  graph: MarketIntelligenceGraph
) {
  return JSON.stringify(graph);
}

function localized(language: string, english: string, turkish: string) {
  return language === "Turkish" ? turkish : english;
}

function marketTableCell(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
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

  if (graph.vendorIntelligence.marketInfrastructure.length > 0) {
    projection.marketInfrastructure = [
      localized(language, "Market Infrastructure", "Pazar Altyapısı"),
      ...graph.vendorIntelligence.marketInfrastructure.map(
        (entity) =>
          `- ${entity.name} — ${entity.entityType.replace(/_/g, " ")} (${entity.reason}; ${entity.evidenceIds.map((id) => `[${id}]`).join(", ")})`
      ),
    ].join("\n");
  }

  if (graph.competitors.length > 0) {
    const competitorLines = graph.vendorIntelligence.vendors.map(
      (vendor) =>
        `| ${marketTableCell(vendor.name)} | ${marketTableCell(vendor.classifications.join(", "))} | ${marketTableCell(vendor.targetCustomer)} | ${marketTableCell(vendor.pricingModels.join(", ") || "Not publicly validated")} | ${marketTableCell(vendor.strength)} | ${marketTableCell(vendor.weakness)} | ${vendor.evidenceCount} | ${vendor.rankingScore}/100 | ${vendor.confidence}/100 (${vendor.confidenceLevel}) |`
    );
    const pricingLines = graph.pricingModels.map(
      (pricing) =>
        `- ${localized(language, "Pricing evidence", "Fiyatlandırma kanıtı")}: ${pricing.description} (${pricing.confidenceClassification}; confidence ${pricing.confidenceScore}/100 ${pricing.confidenceLevel}; ${pricing.evidenceIds.map((id) => `[${id}]`).join(", ")})`
    );
    projection.competitiveLandscape = [
      localized(
        language,
        "Validated competitor comparison",
        "Doğrulanmış rakip karşılaştırması"
      ),
      `Competitive Coverage Score: ${vendorCoverage.competitiveCoverageScore}/100 — ${vendorCoverage.reason}`,
      "| Vendor | Position | Target | Pricing | Strength | Weakness | Evidence Count | Ranking | Confidence |",
      "| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |",
      ...competitorLines,
      ...pricingLines,
    ].join("\n");
    projection.majorPlayers = [
      localized(
        language,
        "Evidence-supported major players",
        "Kanıt destekli başlıca oyuncular"
      ),
      ...graph.vendorIntelligence.vendors
        .filter((vendor) => vendor.eligibleForMajorPlayers)
        .map(
          (vendor) =>
            `- ${vendor.name}: ${vendor.classifications.join(", ")}; target: ${vendor.targetCustomer} (ranking ${vendor.rankingScore}/100; confidence ${vendor.confidence}/100 ${vendor.confidenceLevel}; ${vendor.evidenceSources.map((id) => `[${id}]`).join(", ")})`
      ),
    ].join("\n");
    if (!graph.vendorIntelligence.vendors.some((vendor) => vendor.eligibleForMajorPlayers)) {
      projection.majorPlayers = localized(
        language,
        "Insufficient independent evidence for Major Players ranking; validated commercial vendors remain available in the Competitive Landscape.",
        "Başlıca Oyuncular sıralaması için bağımsız kanıt yetersiz; doğrulanmış ticari satıcılar Rekabet Ortamı bölümünde yer almaya devam ediyor."
      );
    }
  } else {
    projection.competitiveLandscape = vendorCoverage.reason;
    projection.majorPlayers = vendorCoverage.reason;
  }

  if (graph.verifiedMarketSize.length > 0) {
    const sizing = [
      localized(
        language,
        "Verified market-size evidence",
        "Doğrulanmış pazar büyüklüğü kanıtı"
      ),
      ...graph.verifiedMarketSize.map(
        (item) =>
          `- [Verified] ${item.description} | Confidence: ${item.confidenceScore}/100 (${item.confidenceLevel}) | Evidence: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      ),
    ].join("\n");
    projection.marketSize = sizing;
    projection.tamSamSom = sizing;
  } else if (graph.planningEstimate) {
    const estimate = graph.planningEstimate;
    projection.tamSamSom = [
      localized(
        language,
        "Planning Estimate — not externally verified market size",
        "Planlama Tahmini — dış kaynakla doğrulanmış pazar büyüklüğü değildir"
      ),
      `TAM [Estimated]: ${estimate.tam}`,
      `SAM [Estimated]: ${estimate.sam}`,
      `SOM [Estimated]: ${estimate.som}`,
      `${localized(language, "Formula", "Formül")}: ${estimate.formula}`,
      ...estimate.assumptions,
      `${localized(language, "Confidence", "Güven")}: ${estimate.confidence}/100 (${estimate.confidenceLevel}) | Basis: ${estimate.basis} | Evidence: ${estimate.evidenceIds.map((id) => `[${id}]`).join(", ") || "assumption-only scenario"}`,
    ].join("\n");
  } else {
    projection.tamSamSom = localized(
      language,
      "Verified TAM / SAM / SOM is unavailable. A planning estimate was not produced because the validated graph contains neither a compatible market-size endpoint nor both a validated buyer-population input and validated annual-pricing input. Vendor breadth alone is not used to fabricate market sizing.",
      "Doğrulanmış TAM / SAM / SOM mevcut değil. Doğrulanmış grafikte uyumlu bir pazar büyüklüğü uç noktası veya birlikte doğrulanmış alıcı nüfusu ile yıllık fiyatlandırma girdileri bulunmadığı için planlama tahmini üretilmedi. Tedarikçi genişliği tek başına pazar büyüklüğü uydurmak için kullanılmaz."
    );
  }

  if (graph.cagr.length > 0) {
    projection.cagr = graph.cagr
      .map(
        (item) =>
          `- [${item.confidenceClassification}] ${item.description} | Confidence: ${item.confidenceScore}/100 (${item.confidenceLevel}) | Evidence: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      )
      .join("\n");
  }

  if (graph.sources.length > 0) {
    projection.sources = graph.sources
      .map(
        (source) =>
          `- [${source.evidenceId}] ${source.title} | Publisher: ${source.publisher} | URL: ${source.url} | Published: ${source.publishedDate || "Not provided"} | Accessed: ${source.accessedAt || "Not provided"} | Source type: ${source.sourceType} | Classification: ${source.confidenceClassification} | Confidence: ${source.confidenceScore}/100 (${source.confidenceLevel}) | Claim linkage: ${source.claim}`
      )
      .join("\n");
  }

  return projection;
}
