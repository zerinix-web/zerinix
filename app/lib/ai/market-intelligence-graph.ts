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
  | "assumptionTag";

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
      "Verified TAM / SAM / SOM is unavailable. A planning estimate was not produced because the validated graph contains neither a compatible market-size endpoint nor both a validated buyer-population input and validated annual-pricing input. Vendor breadth alone is not used to fabricate market sizing.",
    tableHeader:
      "| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Evidence Count | Confidence | Market Relevance |",
    notEstablished: "Not established by validated evidence",
    notPubliclyValidated: "Not publicly validated",
    notProvided: "Not provided",
    publisherLabel: "Publisher",
    publishedLabel: "Published",
    accessedLabel: "Accessed",
    sourceTypeLabel: "Source type",
    classificationLabel: "Classification",
    claimLinkageLabel: "Claim linkage",
    basisLabel: "Basis",
    evidenceLabel: "Evidence",
    assumptionOnlyScenario: "assumption-only scenario",
    verifiedTag: "Verified",
    estimatedTag: "Estimated",
    assumptionTag: "Assumption",
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
      "Doğrulanmış TAM / SAM / SOM mevcut değil. Doğrulanmış grafikte uyumlu bir pazar büyüklüğü uç noktası veya birlikte doğrulanmış alıcı nüfusu ile yıllık fiyatlandırma girdileri bulunmadığı için planlama tahmini üretilmedi. Tedarikçi genişliği tek başına pazar büyüklüğü uydurmak için kullanılmaz.",
    tableHeader:
      "| Tedarikçi | Ana Şirket | Kategori | Segment | Yapay Zeka Yeteneği | Temel Kullanım Alanları | Fiyatlandırma Modeli | Güçlü Yönler | Zayıf Yönler | Kanıt Sayısı | Güven | Pazar Uygunluğu |",
    notEstablished: "Doğrulanmış kanıtla belirlenmemiştir",
    notPubliclyValidated: "Kamuya açık olarak doğrulanmamış",
    notProvided: "Sağlanmadı",
    publisherLabel: "Yayıncı",
    publishedLabel: "Yayın tarihi",
    accessedLabel: "Erişim tarihi",
    sourceTypeLabel: "Kaynak türü",
    classificationLabel: "Sınıflandırma",
    claimLinkageLabel: "İddia bağlantısı",
    basisLabel: "Temel",
    evidenceLabel: "Kanıt",
    assumptionOnlyScenario: "sadece varsayıma dayalı senaryo",
    verifiedTag: "Doğrulanmış",
    estimatedTag: "Tahmini",
    assumptionTag: "Varsayım",
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
      "Verifizierte TAM-/SAM-/SOM-Werte sind nicht verfügbar. Es wurde keine Planungsschätzung erstellt, da der validierte Datensatz weder einen kompatiblen Marktgrößen-Endpunkt noch gleichzeitig einen validierten Käuferpopulations- und einen validierten Jahrespreis-Eingabewert enthält. Die Anbieterbreite allein wird nicht verwendet, um eine Marktgröße zu erfinden.",
    tableHeader:
      "| Anbieter | Muttergesellschaft | Kategorie | Segment | KI-Fähigkeit | Wichtigste Anwendungsfälle | Preismodell | Stärken | Schwächen | Anzahl Nachweise | Konfidenz | Marktrelevanz |",
    notEstablished: "Durch validierte Nachweise nicht ermittelt",
    notPubliclyValidated: "Nicht öffentlich validiert",
    notProvided: "Nicht angegeben",
    publisherLabel: "Herausgeber",
    publishedLabel: "Veröffentlicht",
    accessedLabel: "Zugegriffen",
    sourceTypeLabel: "Quellentyp",
    classificationLabel: "Klassifizierung",
    claimLinkageLabel: "Aussagenbezug",
    basisLabel: "Grundlage",
    evidenceLabel: "Nachweis",
    assumptionOnlyScenario: "reines Annahmenszenario",
    verifiedTag: "Verifiziert",
    estimatedTag: "Geschätzt",
    assumptionTag: "Annahme",
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
      "Le TAM / SAM / SOM vérifié n'est pas disponible. Aucune estimation de planification n'a été produite car le graphe validé ne contient ni un point de référence de taille de marché compatible, ni à la fois une entrée validée de population d'acheteurs et une entrée validée de tarification annuelle. L'étendue des fournisseurs seule n'est pas utilisée pour fabriquer une taille de marché.",
    tableHeader:
      "| Fournisseur | Société mère | Catégorie | Segment | Capacité IA | Cas d'usage clés | Modèle tarifaire | Forces | Faiblesses | Nombre de preuves | Confiance | Pertinence pour le marché |",
    notEstablished: "Non établi par des preuves validées",
    notPubliclyValidated: "Non validé publiquement",
    notProvided: "Non fourni",
    publisherLabel: "Éditeur",
    publishedLabel: "Publié",
    accessedLabel: "Consulté",
    sourceTypeLabel: "Type de source",
    classificationLabel: "Classification",
    claimLinkageLabel: "Lien avec l'affirmation",
    basisLabel: "Base",
    evidenceLabel: "Preuve",
    assumptionOnlyScenario: "scénario basé uniquement sur des hypothèses",
    verifiedTag: "Vérifié",
    estimatedTag: "Estimé",
    assumptionTag: "Hypothèse",
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
      "El TAM / SAM / SOM verificado no está disponible. No se generó una estimación de planificación porque el gráfico validado no contiene ni un punto de referencia de tamaño de mercado compatible ni, a la vez, una entrada validada de población de compradores y una entrada validada de precios anuales. La amplitud de proveedores por sí sola no se utiliza para fabricar el tamaño del mercado.",
    tableHeader:
      "| Proveedor | Empresa matriz | Categoría | Segmento | Capacidad de IA | Casos de uso clave | Modelo de precios | Fortalezas | Debilidades | Cantidad de evidencia | Confianza | Relevancia para el mercado |",
    notEstablished: "No establecido por evidencia validada",
    notPubliclyValidated: "No validado públicamente",
    notProvided: "No proporcionado",
    publisherLabel: "Editor",
    publishedLabel: "Publicado",
    accessedLabel: "Consultado",
    sourceTypeLabel: "Tipo de fuente",
    classificationLabel: "Clasificación",
    claimLinkageLabel: "Vínculo con la afirmación",
    basisLabel: "Base",
    evidenceLabel: "Evidencia",
    assumptionOnlyScenario: "escenario basado únicamente en suposiciones",
    verifiedTag: "Verificado",
    estimatedTag: "Estimado",
    assumptionTag: "Suposición",
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
        "Bu pazardaki isimli rakiplere ilişkin bağımsız ve kamuya açık bilgi, araştırma sırasında sınırlı kalmıştır. Aşağıdaki rekabet yoğunluğu, doğrulanmış rakip profillerinden ziyade kategori düzeyindeki yapısal kanıtlardan çıkarılmıştır; bu durum şirkete özgü iddialara olan güveni azaltır, ancak rekabetin yokluğu anlamına gelmez.",
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
      ...graph.vendorIntelligence.marketInfrastructure.map(
        (entity) =>
          `- ${entity.name} — ${entity.entityType.replace(/_/g, " ")} (${entity.reason}; ${entity.evidenceIds.map((id) => `[${id}]`).join(", ")})`
      ),
    ].join("\n");
  }

  if (graph.competitors.length > 0) {
    const competitorLines = graph.vendorIntelligence.vendors.map(
      (vendor) =>
        `| ${marketTableCell(vendor.name)} | ${marketTableCell(vendor.parentCompany)} | ${marketTableCell(vendor.category)} | ${marketTableCell(vendor.segment)} | ${marketTableCell(vendor.aiCapability)} | ${marketTableCell(vendor.keyUseCases.join("; ") || copy.notEstablished)} | ${marketTableCell(vendor.pricingModels.join(", ") || copy.notPubliclyValidated)} | ${marketTableCell(vendor.strength)} | ${marketTableCell(vendor.weakness)} | ${vendor.evidenceCount} | ${vendor.confidence}/100 (${vendor.confidenceLevel}) | ${marketTableCell(vendor.marketRelevance)} |`
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
      ...graph.vendorIntelligence.vendors
        .filter((vendor) => vendor.eligibleForMajorPlayers)
        .map(
          (vendor) =>
            `- ${vendor.name} (${vendor.majorPlayerLabel}): ${vendor.classifications.join(", ")}; target: ${vendor.targetCustomer} (ranking ${vendor.rankingScore}/100; overall score ${vendor.overallVendorScore}/100; confidence ${vendor.confidence}/100 ${vendor.confidenceLevel}; ${vendor.evidenceSources.map((id) => `[${id}]`).join(", ")})`
      ),
    ].join("\n");
    if (!graph.vendorIntelligence.vendors.some((vendor) => vendor.eligibleForMajorPlayers)) {
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
    projection.tamSamSom = sizing;
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
