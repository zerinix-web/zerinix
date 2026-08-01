import {
  deduplicateUsableRealEstateExternalEvidence,
  type RealEstateQualityEvidence,
} from "./real-estate-quality.mjs";

type RealEstateReportField =
  | "assetIdentification"
  | "extractedDocumentFacts"
  | "ownershipTitleFindings"
  | "location"
  | "zoningLandUseStatus"
  | "accessInfrastructure"
  | "comparableMarketEvidence"
  | "valuationRange"
  | "legalRisks"
  | "environmentalGeotechnicalRisks"
  | "liquidity"
  | "developmentPotential"
  | "scenarioAnalysis"
  | "investmentScore"
  | "missingInformation"
  | "recommendedDueDiligence"
  | "finalRecommendation"
  | "sources";
type ResponseLanguage = import("@/app/lib/report-language").ResponseLanguage;

type RealEstateReport = Record<RealEstateReportField, string>;
type PropertyEvidenceContext = {
  documentTypeExtracted: boolean;
  province: string;
  district: string;
  neighborhood: string;
  locality: string;
  block: string;
  sheet: string;
  parcel: string;
  parcelArea: string;
  propertyType: string;
};
export type RealEstateClaimSourceMapping = {
  sourceUrl: string;
  supportedSection: RealEstateReportField;
  supportedClaim: string;
  matchedIdentifiers: string[];
  relevanceStatus: "usable" | "rejected";
};
type RenderableReportSection = {
  field?: string;
  title: string;
  content: string;
};

const presentationFields = [
  "assetIdentification",
  "extractedDocumentFacts",
  "ownershipTitleFindings",
  "location",
  "zoningLandUseStatus",
  "accessInfrastructure",
  "comparableMarketEvidence",
  "valuationRange",
  "legalRisks",
  "environmentalGeotechnicalRisks",
  "liquidity",
  "developmentPotential",
  "scenarioAnalysis",
  "investmentScore",
  "missingInformation",
  "recommendedDueDiligence",
  "finalRecommendation",
  "sources",
] as const satisfies readonly RealEstateReportField[];

const internalResearchDiagnosticPattern =
  /(?:\bprovider_unavailable\b|\bcompleted_no_evidence\b|\brequest (?:was )?aborted\b|\bprovider disabled\b|\bresult\s*=\s*failed\b|\breason\s*=\s*request was aborted\b|\bresearch attempts?\b|\battempt\s*\||\bnext provider\b|\bsearch query\b|\b(?:provider|query|result|reason|status)\s*[:=|]|\b(?:stack trace|request payload|api response|execution log)\b|\b(?:tavily|perplexity|firecrawl|serper|exa|openai|web_search)\b|\baraştırma sağlayıc(?:ı|ıları)\b|\brapor oluşturma doğrulama hatası\b|\bişlem hattı\b|\bZERINIX validated request context\b|\bvalidated request context\b|\bclassification (?:result|wording|context)\b|\bdahili (?:metodoloji|sınıflandırma)\b)/i;
const technicalMethodologyPattern =
  /(?:\bsource parsing\b|\bevidence normaliz(?:er|ation)\b|\bclaim[- ]level mapping\b|\bresearch pipeline\b|\braw pipeline\b|\bschema validation\b|\bjson (?:payload|response)\b|\btechnical diagnostics?\b)/i;
const brokenSourceTextPattern =
  /(?:\bURL\s*:\s*(?:belge|yok|none|n\/?a|null|undefined)?\s*$|\b(?:[a-z0-9-]+\.\s+){2,}[a-z]{2,}\b|^\s*[-•*]?\s*(?:[a-z0-9-]+\.\s*){1,2}$)/i;
const bareDomainPattern = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;
const evidenceLabelPattern =
  /\[(?:Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Unknown|Recommendation)\]\s*/gi;
const provenancePattern =
  /\[(?:(?:Asset|Basis|Required|Method|User)\s*:[^\]]*|R\d+(?:\s*:[^\]]*)?)\]/gi;
const internalFieldPattern =
  /\b(?:uploaded_asset|real_estate|property_document|Likely domain|Likely content type|schema value|enum value|validated request context|classification result|internal methodology)\b/gi;
const brokenPresentationLinePattern =
  /^(?:[-•*]\s*)?(?:(?:Belgeden çıkarılan bilgi|Extracted from uploaded document)\s*:\s*)?(?:Tapu alanı|Yüzölçümü|Parcel area|Parcel size)\s*:\s*(?:[.–—-]|yok|none|unknown|null|undefined)?\s*$/i;
const genericFilenamePattern =
  /\b[^\s()[\]{}<>/\\]+\.(?:png|jpe?g|webp|gif|heic|pdf|docx?|xlsx?|csv|txt|zip)\b/gi;
const externalVerifiedLabelPattern =
  /\[(?:Verified from official source|Verified from external source)\]/i;
const invalidSourceHostPattern =
  /^(?:localhost|127\.0\.0\.1|example\.(?:com|net|org)|example\.gov\.tr|invalid|test)$/i;
const invalidSourcePathPattern =
  /(?:^|\/)(?:yüklenen|yuklenen|uploaded|belge|missing|unknown|null|undefined)(?:\/|$)/i;
const genericSourceHomepagePattern =
  /^\/(?:home|homepage|anasayfa|index(?:\.html?)?|haberler|news|duyurular)?\/?$/i;

const sectionEvidencePatterns: Partial<Record<RealEstateReportField, RegExp>> = {
  ownershipTitleFindings:
    /\b(?:tapu|takyidat|mülkiyet|malik|şerh|ipotek|haciz|title|ownership|encumbrance|lien|mortgage)\b/i,
  location:
    /\b(?:konum|koordinat|harita|mahalle|mevkii|ilçe|location|coordinate|map|neighborhood|district|parcel|parsel)\b/i,
  zoningLandUseStatus:
    /\b(?:imar|plan|plan notu|arazi kullanım|yapılaşma|zoning|land use|development right|planning)\b/i,
  accessInfrastructure:
    /\b(?:yol|erişim|cephe|kadastro|altyapı|elektrik|su|kanalizasyon|road|access|frontage|cadastral|infrastructure|electricity|water|sewer|utility)\b/i,
  comparableMarketEvidence:
    /\b(?:emsal|satılık|satış|işlem|ilan|fiyat|metrekare|m²|comparable|listing|transaction|asking price|sale price|unit price)\b/i,
  valuationRange:
    /\b(?:değerleme|birim fiyat|hesaplama yöntemi|valuation|unit price|calculation method|appraisal)\b/i,
  environmentalGeotechnicalRisks:
    /\b(?:afad|dsi|deprem|sel|taşkın|heyelan|jeoloji|zemin|afet|flood|seismic|earthquake|hazard|geological|wildfire)\b/i,
  liquidity:
    /\b(?:likidite|talep|işlem hacmi|ilanda kalma|satış süresi|liquidity|demand|transaction volume|time on market)\b/i,
  developmentPotential:
    /\b(?:imar|yapılaşma|geliştirme|altyapı|erişim|development|zoning|infrastructure|access)\b/i,
  legalRisks:
    /\b(?:tapu|takyidat|mülkiyet|imar|erişim|hukuki|title|encumbrance|ownership|zoning|access|legal)\b/i,
  scenarioAnalysis:
    /\b(?:imar|erişim|altyapı|afet|emsal|fiyat|zoning|access|infrastructure|hazard|comparable|price)\b/i,
  recommendedDueDiligence:
    /\b(?:tapu|takyidat|imar|kadastro|altyapı|afet|emsal|title|encumbrance|zoning|cadastral|infrastructure|hazard|comparable)\b/i,
  finalRecommendation:
    /\b(?:tapu|takyidat|imar|erişim|altyapı|afet|emsal|değerleme|title|zoning|access|infrastructure|hazard|comparable|valuation)\b/i,
};

const TurkishMissingEvidence =
  "Bu veri açık kaynaklardan doğrulanamadı; resmî belge kontrolü gerekiyor.";
const EnglishMissingEvidence =
  "This information could not be verified from public sources; an official record check is required.";

function missingRequiredSectionContent(
  field: RealEstateReportField,
  language: ResponseLanguage
) {
  const isTurkish = language === "Turkish";

  if (field === "recommendedDueDiligence") {
    return isTurkish
      ? "Kanıt yetersiz. Satın alma kararı öncesinde güncel tapu ve takyidat kaydı, resmî imar durumu, kadastro erişimi, altyapı ve afet kayıtları ile tarihli emsaller yetkili kaynaklardan doğrulanmalıdır."
      : "Insufficient evidence. Before an acquisition decision, verify the current title and encumbrance record, official zoning status, cadastral access, infrastructure and hazard records, and dated comparables with the appropriate authorities.";
  }

  if (field === "finalRecommendation") {
    return isTurkish
      ? "BEKLE. Kritik karar kanıtları tamamlanmadan bağlayıcı bir yatırım kararı verilmemelidir."
      : "WAIT. Do not make a binding investment decision until the critical decision evidence is complete.";
  }

  if (field === "investmentScore") {
    return isTurkish
      ? "Kritik karar girdileri tamamlanmadığı için savunulabilir bir yatırım skoru hesaplanmadı."
      : "No defensible investment score was calculated because critical decision inputs remain incomplete.";
  }

  if (field === "assetIdentification") {
    return isTurkish
      ? "Yüklenen içerik bir gayrimenkul/parsel bilgi belgesi olarak değerlendirildi."
      : "The uploaded content was identified as a real-estate or parcel information record.";
  }

  if (field === "extractedDocumentFacts") {
    return isTurkish
      ? "Yüklenen belgeden okunabilir taşınmaz bilgisi çıkarılamadı."
      : "No readable property facts could be extracted from the uploaded record.";
  }

  if (isTurkish) {
    const TurkishSectionLimitations: Partial<
      Record<RealEstateReportField, string>
    > = {
      ownershipTitleFindings:
        "Mülkiyet ve takyidat durumu, güncel resmî kayıt incelemesi tamamlandığında kesinleştirilebilir.",
      location:
        "Konum değerlendirmesi, belgeden çıkarılan taşınmaz kimliğiyle sınırlıdır.",
      zoningLandUseStatus:
        TurkishMissingEvidence,
      accessInfrastructure:
        "Yasal erişim ve altyapı kapasitesi, kadastro ve hizmet sağlayıcı kayıtlarıyla teyit edilmelidir.",
      comparableMarketEvidence:
        "Pazar görüşü için aynı bölge ve nitelikte, tarihli karşılaştırılabilir işlemler gereklidir.",
      valuationRange:
        "İmar, emsal, para birimi ve hesaplama yöntemi birlikte doğrulanmadan değer aralığı üretilemez.",
      legalRisks:
        "Hukuki risk seviyesi, tapu, takyidat, imar ve erişim kayıtları tamamlandığında kesinleşir.",
      environmentalGeotechnicalRisks:
        "Çevresel ve jeoteknik risk seviyesi, konuma özgü resmî veriler ve uzman incelemesiyle belirlenmelidir.",
      liquidity:
        "Likidite değerlendirmesi için yerel işlem sıklığı ve talep göstergeleri gereklidir.",
      developmentPotential:
        "Geliştirme potansiyeli; imar, erişim, altyapı ve zemin koşulları birlikte olumluysa değerlendirilebilir.",
      scenarioAnalysis:
        "Sayısal senaryo, satın alma koşulları ve kritik resmî kayıtlar tamamlandığında oluşturulabilir.",
      missingInformation:
        "Kritik Eksikler: Yatırım kararını etkileyen resmî kayıtlar tamamlanmalıdır.",
      sources:
        TurkishMissingEvidence,
    };
    return TurkishSectionLimitations[field] || TurkishMissingEvidence;
  }

  return EnglishMissingEvidence;
}

export function collectRealEstateResearchSourceContent(
  sections: readonly RenderableReportSection[]
) {
  const isSourceSection = (section: RenderableReportSection) =>
    /^(?:sources|kaynaklar)$/i.test(section.field?.trim() || "") ||
    /^(?:sources|kaynaklar)$/i.test(section.title.trim());
  const declaredSources = sections.filter(isSourceSection);
  const evidenceSections = sections.filter((section) => !isSourceSection(section));

  return [...declaredSources, ...evidenceSections]
    .map((section) => section.content.trim())
    .filter(Boolean);
}

const identityFieldPattern =
  /^(?:(?:Belgeden çıkarılan bilgi|Extracted from uploaded document)\s*:\s*)?(?:İl|İlçe|Mahalle(?:\/mevkii)?|Mahalle|Mevkii|Ada|Pafta|Parsel|Yüzölçümü|Nitelik|Province|District|Neighborhood|Locality|Block|Sheet|Parcel|Parcel area|Property type)\s*[:\-]/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("tr")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function readExtractedFact(value: string, labels: readonly string[]) {
  const match = value.match(
    new RegExp(
      `(?:^|\\n|[.;]\\s*)(?:${labels.map(escapeRegExp).join("|")})\\s*[:\\-]\\s*([^;\\n]+)`,
      "i"
    )
  );
  return (match?.[1] || "")
    .replace(/\s*\[(?:Asset|Basis):[^\]]+\].*$/i, "")
    .replace(/\s*\.\s*(?:Güven|Confidence|Kaynak|Source)\s*:.*$/i, "")
    .trim()
    .replace(/[.;]+$/, "");
}

function extractPropertyEvidenceContext(
  report: RealEstateReport
): PropertyEvidenceContext {
  const facts = (report.extractedDocumentFacts || "")
    .replace(evidenceLabelPattern, "")
    .replace(provenancePattern, "");
  return {
    documentTypeExtracted:
      /\[Verified from uploaded asset\]/i.test(report.assetIdentification || "") &&
      Boolean((report.assetIdentification || "").trim()),
    province: readExtractedFact(facts, ["İl", "Province"]),
    district: readExtractedFact(facts, ["İlçe", "District"]),
    neighborhood: readExtractedFact(facts, ["Mahalle", "Neighborhood"]),
    locality: readExtractedFact(facts, ["Mevkii", "Locality"]),
    block: readExtractedFact(facts, ["Ada", "Block"]),
    sheet: readExtractedFact(facts, ["Pafta", "Sheet"]),
    parcel: readExtractedFact(facts, ["Parsel", "Parcel"]),
    parcelArea: readExtractedFact(facts, [
      "Yüzölçümü",
      "Tapu alanı",
      "Parcel area",
      "Parcel size",
    ]),
    propertyType: readExtractedFact(facts, ["Nitelik", "Property type"]),
  };
}

function includesContextValue(value: string, contextValue: string) {
  const needle = normalizeKey(contextValue);
  return Boolean(needle && normalizeKey(value).includes(needle));
}

function containsExactParcelIdentity(
  value: string,
  context: PropertyEvidenceContext
) {
  if (!context.block || !context.parcel) return false;
  const escapedBlock = escapeRegExp(context.block);
  const escapedParcel = escapeRegExp(context.parcel);
  return new RegExp(
    `(?:\\b(?:ada|block)\\s*(?:no\\.?\\s*)?${escapedBlock}\\b[\\s\\S]{0,100}\\b(?:parsel|parcel)\\s*(?:no\\.?\\s*)?${escapedParcel}\\b|\\/${escapedBlock}[-_\\/]${escapedParcel}(?:\\b|\\/))`,
    "i"
  ).test(value);
}

function containsImmediateLocation(
  value: string,
  context: PropertyEvidenceContext
) {
  return (
    containsExactParcelIdentity(value, context) ||
    includesContextValue(value, context.locality) ||
    includesContextValue(value, context.neighborhood)
  );
}

function containsFullParcelLocationIdentity(
  value: string,
  context: PropertyEvidenceContext
) {
  const requiredLocations = [
    context.province,
    context.district,
    context.neighborhood || context.locality,
  ].filter(Boolean);
  return (
    requiredLocations.length >= 3 &&
    requiredLocations.every((identifier) =>
      includesContextValue(value, identifier)
    ) &&
    containsExactParcelIdentity(value, context)
  );
}

function isGenericReferencePage(value: string) {
  return /\b(?:ana sayfa|homepage|haber|news|duyuru|announcement|basın|press|bülten|bulletin|proje|project|sorgu|lookup|search)\b/i.test(
    value.replace(/[_/-]+/g, " ")
  );
}

function getMatchedPropertyIdentifiers(
  value: string,
  context: PropertyEvidenceContext
) {
  return [
    ["province", context.province],
    ["district", context.district],
    ["neighborhood", context.neighborhood],
    ["locality", context.locality],
    ["sheet", context.sheet],
    ["parcelArea", context.parcelArea],
    ["propertyType", context.propertyType],
  ]
    .filter(([, identifier]) => includesContextValue(value, identifier))
    .map(([name, identifier]) => `${name}:${identifier}`)
    .concat(
      containsExactParcelIdentity(value, context)
        ? [`block:${context.block}`, `parcel:${context.parcel}`]
        : []
    );
}

function extractSupportedClaim(value: string) {
  return value
    .replace(evidenceLabelPattern, "")
    .replace(provenancePattern, "")
    .replace(/\b(?:URL|Kaynak|Source)\s*:\s*https?:\/\/\S+/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,:\s]+$/, "")
    .trim();
}

function evidenceSupportsReportSection(
  evidence: RealEstateQualityEvidence,
  field: RealEstateReportField,
  context: PropertyEvidenceContext,
  hasValidatedComparables: boolean
) {
  const evidenceText = [
    evidence.label ? `[${evidence.label}]` : "",
    evidence.field,
    evidence.claim,
    evidence.value,
    evidence.sourceTitle,
    evidence.publisher,
    evidence.url,
  ]
    .filter(Boolean)
    .join(" ");
  return hasSectionRelevantEvidence(
    evidenceText,
    field,
    context,
    hasValidatedComparables
  );
}

function parseAreaSquareMetres(value: string) {
  const matches = [
    ...value.matchAll(/(\d[\d.,]*)\s*(?:m²|m2|metrekare|square metres?|sq\.?\s*m)/gi),
  ];
  return matches
    .map((match) => {
      const raw = match[1];
      const normalized = raw.includes(".") && raw.includes(",")
        ? raw.replace(/\./g, "").replace(",", ".")
        : /^\d{1,3}(?:\.\d{3})+$/.test(raw)
          ? raw.replace(/\./g, "")
          : /^\d{1,3}(?:,\d{3})+$/.test(raw)
            ? raw.replace(/,/g, "")
            : raw.replace(",", ".");
      return Number(normalized);
    })
    .filter((area) => Number.isFinite(area) && area > 0);
}

function canonicalizeSourceUrl(value: string) {
  try {
    const url = new URL(value.trim());

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      invalidSourceHostPattern.test(url.hostname) ||
      invalidSourcePathPattern.test(decodeURIComponent(url.pathname)) ||
      genericSourceHomepagePattern.test(url.pathname) ||
      /\.(?:png|jpe?g|gif|webp|svg|ico)$/i.test(url.pathname) ||
      /\/(?:parsel|parcel)[-_]?(?:sorgu|search|query)(?:\/|$)/i.test(
        url.pathname
      )
    ) {
      return null;
    }

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_.+)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return url;
  } catch {
    return null;
  }
}

function sourceUrlsFromLine(value: string) {
  return (value.match(/https?:\/\/[^\s)\]}>,;]+/gi) || [])
    .map((url) => url.replace(/[.;,:]+$/, ""))
    .map(canonicalizeSourceUrl)
    .filter((url): url is URL => Boolean(url));
}

function containsBrokenSourceText(value: string) {
  return (
    brokenSourceTextPattern.test(value) ||
    (!/https?:\/\//i.test(value) && bareDomainPattern.test(value))
  );
}

function hasSectionRelevantEvidence(
  value: string,
  field: RealEstateReportField,
  context: PropertyEvidenceContext,
  hasValidatedComparables: boolean
) {
  const decoded = value.replace(/[_/-]+/g, " ");
  const pattern = sectionEvidencePatterns[field];
  if (
    pattern
      ? !pattern.test(decoded)
      : !Object.values(sectionEvidencePatterns).some((candidate) =>
          candidate.test(decoded)
        )
  ) {
    return false;
  }

  if (
    field === "comparableMarketEvidence" &&
    !(
      /\d/.test(decoded) &&
      /(?:₺|\bTL\b|\bTRY\b|\$|€|fiyat|price)/i.test(decoded) &&
      /(?:m²|m2|metrekare|square metre|sq\.?\s*m)/i.test(decoded)
    )
  ) {
    return false;
  }

  if (
    ["comparableMarketEvidence", "valuationRange"].includes(field) &&
    /\b(?:belediye|municipality|afad|deprem|earthquake|altyapı|infrastructure|haber|news)\b/i.test(
      decoded
    )
  ) {
    return false;
  }

  if (
    ["zoningLandUseStatus", "ownershipTitleFindings"].includes(field) &&
    !/\[Verified from official source\]/i.test(value)
  ) {
    return false;
  }

  if (
    isGenericReferencePage(value) &&
    !containsFullParcelLocationIdentity(decoded, context)
  ) {
    return false;
  }

  if (
    ["zoningLandUseStatus", "ownershipTitleFindings"].includes(field) &&
    !containsFullParcelLocationIdentity(decoded, context)
  ) {
    return false;
  }

  if (
    field === "ownershipTitleFindings" &&
    !/\b(?:güncel|current|tarih|dated|20\d{2})\b/i.test(decoded)
  ) {
    return false;
  }

  if (
    field === "accessInfrastructure" &&
    !containsImmediateLocation(decoded, context)
  ) {
    return false;
  }

  if (
    field === "environmentalGeotechnicalRisks" &&
    !(
      containsImmediateLocation(decoded, context) ||
      /\b(?:koordinat|coordinate)\s*[:\-]?\s*\d/i.test(decoded)
    )
  ) {
    return false;
  }

  if (field === "comparableMarketEvidence") {
    const targetArea = parseAreaSquareMetres(context.parcelArea)[0];
    const comparableAreas = parseAreaSquareMetres(decoded);
    const hasComparableArea = targetArea
      ? comparableAreas.some(
          (area) => area >= targetArea * 0.25 && area <= targetArea * 4
        )
      : comparableAreas.length > 0;
    const hasComparableLocality =
      includesContextValue(decoded, context.locality) ||
      includesContextValue(decoded, context.neighborhood);
    const normalizedPropertyType = normalizeKey(context.propertyType);
    const hasComparableLandType = normalizedPropertyType
      ? normalizeKey(decoded).includes(normalizedPropertyType) ||
        /\b(?:arsa|arazi|tarla|land|plot|field)\b/i.test(decoded)
      : /\b(?:arsa|arazi|tarla|land|plot|field)\b/i.test(decoded);

    if (
      !(
        hasComparableLocality &&
        hasComparableLandType &&
        hasComparableArea &&
        /\b20\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/.test(decoded) &&
        /\b(?:ilan|satılık|satış|işlem|listing|asking|sale|transaction)\b/i.test(
          decoded
        )
      )
    ) {
      return false;
    }
  }

  if (
    field === "valuationRange" &&
    !(
      hasValidatedComparables &&
      /\b(?:emsal karşılaştırma|birim fiyat çarpımı|ağırlıklı ortalama|comparable sales|unit price multiplication|weighted average|calculation method)\b/i.test(
        decoded
      )
    )
  ) {
    return false;
  }

  if (
    field === "valuationRange" &&
    !(
      /\d/.test(decoded) &&
      /(?:₺|\bTL\b|\bTRY\b|\$|€|m²|m2|metrekare|birim fiyat|unit price)/i.test(
        decoded
      )
    )
  ) {
    return false;
  }

  const claimsParcelLevelFinding =
    /\b(?:parsel(?:in|de|e)?|parcel(?:'s)?)\b[^.\n]{0,100}\b(?:doğruland|teyit edild|mevcut|bağlı|confirmed|verified|available|connected)\b/i.test(
      decoded
    );
  const hasExactParcelIdentifier =
    /\b(?:ada|block)\s*(?:no\.?\s*)?\d+\b|\b(?:parsel|parcel)\s*(?:no\.?\s*)?\d+\b/i.test(
      decoded
    );

  if (
    claimsParcelLevelFinding &&
    ["zoningLandUseStatus", "accessInfrastructure"].includes(field) &&
    !hasExactParcelIdentifier
  ) {
    return false;
  }

  return true;
}

function removeUnusableVerifiedEvidence(
  value: string,
  field: RealEstateReportField,
  context: PropertyEvidenceContext,
  hasValidatedComparables: boolean
) {
  return value
    .split("\n")
    .filter((line) => {
      if (!externalVerifiedLabelPattern.test(line)) return true;
      const urls = sourceUrlsFromLine(line);
      return (
        urls.length > 0 &&
        hasSectionRelevantEvidence(
          line,
          field,
          context,
          hasValidatedComparables
        )
      );
    })
    .join("\n");
}

function removeIsoTimestamps(value: string, language: ResponseLanguage) {
  return value.replace(
    /\b(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g,
    (_, year: string, month: string, day: string) =>
      language === "Turkish" ? `${day}.${month}.${year}` : `${year}-${month}-${day}`
  );
}

function repairSplitNumericEvidence(value: string) {
  return value
    .replace(
      /(\d{1,3}[.,])\s*\n\s*(\d{3}(?:[.,]\d{3})*(?:,\d+)?\s*(?:TL|TRY|₺|USD|EUR|\$|€))/g,
      "$1$2"
    )
    .replace(
      /(\d{1,3})\s*\n\s*([.,]\d{3}(?:[.,]\d{3})*(?:,\d+)?\s*(?:TL|TRY|₺|USD|EUR|\$|€))/g,
      "$1$2"
    )
    .split("\n")
    .filter(
      (line) =>
        !/^\s*0{3}(?:[.,]0{3})*(?:,0+)?\s*(?:TL|TRY|₺|USD|EUR|\$|€)\b/i.test(
          line
        )
    )
    .join("\n");
}

function localizePresentationText(
  value: string,
  language: ResponseLanguage
) {
  if (language !== "Turkish") return value;

  return value
    .replace(/\bExecutive Summary\b/gi, "Yönetici Özeti")
    .replace(/\bAI Insight\b/gi, "Yapay Zekâ İçgörüsü")
    .replace(/\bSupporting Evidence\b/gi, "Destekleyici Kanıt")
    .replace(/\bMissing Evidence\b/gi, "Eksik Kanıt")
    .replace(/\bDecision Reasoning\b/gi, "Karar Gerekçesi")
    .replace(/\bInsufficient Evidence\b/gi, "Kanıt Yetersiz")
    .replace(/\bProceed Conditionally\b/gi, "Koşullu Uygun")
    .replace(/\bProceed\b/gi, "Uygun")
    .replace(/\bAvoid\b/gi, "Uygun Değil")
    .replace(/\bWait\b/gi, "Bekle")
    .replace(/\bNot verified\b/gi, "Doğrulanmadı")
    .replace(/\bValidation Required\b/gi, "Resmî doğrulama gerekli")
    .replace(
      /\bSee Development Potential\b/gi,
      "Geliştirme potansiyeli incelenebilir"
    )
    .replace(
      /\bUploaded facts, external evidence, estimates, and recommendations are treated as separate evidence classes\.?/gi,
      "Belgeden çıkarılan bilgiler, dış kaynak kanıtları, tahminler ve öneriler ayrı değerlendirilir."
    )
    .replace(/\bKoşullu Devam Et\b/gi, "Koşullu Uygun")
    .replace(/\bDevam Et\b/gi, "Uygun")
    .replace(/\bKaçın\b/gi, "Uygun Değil")
    .replace(/\bPreliminary due-diligence report\b/gi, "Ön durum tespiti raporu")
    .replace(/\bWhat is known\b/gi, "Bilinenler")
    .replace(/\bWhat was researched\b/gi, "Araştırılanlar")
    .replace(/\bWhat remains unknown\b/gi, "Resmî belge gerektiren bilgiler")
    .replace(/\bTop risks\b/gi, "Öncelikli riskler")
    .replace(/\bTop opportunities\b/gi, "Potansiyel fırsatlar")
    .replace(/\bNext actions\b/gi, "Sonraki adımlar")
    .replace(/\bSources and Methodology\b/gi, "Kaynaklar")
    .replace(/\bMethodology\b/gi, "Yöntem")
    .replace(/\bUnknown\b/gi, "Doğrulanamadı")
    .replace(/\bRecommendation\b/gi, "Öneri");
}

function localizeTurkishExecutiveLanguage(value: string) {
  return value
    .replace(/\bOverall Investment Score\b/gi, "Genel Yatırım Skoru")
    .replace(/\bTop 3 Opportunities\b/gi, "En Önemli 3 Fırsat")
    .replace(/\bTop 3 Risks\b/gi, "En Önemli 3 Risk")
    .replace(/\bRequired Due Diligence\b/gi, "Gerekli Durum Tespiti")
    .replace(/\bExecutive Conclusion\b/gi, "Yönetici Sonucu")
    .replace(/\bWhat changes the decision\b/gi, "Kararı Değiştirecek Kanıt")
    .replace(/\bRequired next actions\b/gi, "Gerekli Sonraki Adımlar")
    .replace(/\bRisk Level\b/gi, "Risk Seviyesi")
    .replace(/\bImpact\b/gi, "Etki")
    .replace(/\bLikelihood\b/gi, "Olasılık")
    .replace(/\bMitigation\b/gi, "Azaltım")
    .replace(/\bEvidence Basis\b/gi, "Kanıt Dayanağı")
    .replace(/\bDecision\b/gi, "Karar")
    .replace(/\bReasoning\b/gi, "Gerekçe")
    .replace(/\bConfidence\b/gi, "Güven")
    .replace(/\bNot calculated\b/gi, "Hesaplanmadı")
    .replace(/\bNot quantifiable from current evidence\b/gi, "Mevcut kanıtla ölçülemedi")
    .replace(/\bOpen\b/gi, "Açık")
    .replace(/\bBUY\b/g, "AL")
    .replace(/\bWAIT\b/g, "BEKLE")
    .replace(/\bAVOID\b/g, "KAÇIN");
}

function isGenericMissingEvidenceLine(value: string) {
  const normalized = normalizeKey(value);
  return (
    /^(?:doğrulanmadı )?(?:bu veri )?açık kaynaklardan doğrulanamadı resmî belge kontrolü gerekiyor$/.test(
      normalized
    ) ||
    /^(?:not verified )?this information could not be verified from public sources an official record check is required$/.test(
      normalized
    ) ||
    /^(?:kanıt yetersiz|doğrulanmadı|insufficient evidence|not verified)$/.test(
      normalized
    )
  );
}

function removeRepeatedMissingEvidenceLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isGenericMissingEvidenceLine(line))
    .join("\n");
}

function consolidateCriticalGaps(
  value: string,
  language: ResponseLanguage
) {
  const fallback =
    language === "Turkish"
      ? "Yatırım kararını etkileyen resmî kayıtlar tamamlanmalıdır."
      : "Official records affecting the investment decision must be completed.";
  const seen = new Set<string>();
  const items = value
    .replace(/^(?:Kritik Eksikler|Doğrulanamayan Kritik Bilgiler|Critical Gaps|Missing Information)\s*:\s*/i, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/)
    .map((item) =>
      item
        .replace(/^(?:[-•*]|\d+[.)])\s*/, "")
        .replace(/^(?:Eksik Kanıt|Missing Evidence|Doğrulanmadı|Not verified)\s*:\s*/i, "")
        .trim()
    )
    .filter(Boolean)
    .filter((item) => !isGenericMissingEvidenceLine(item))
    .filter((item) => {
      const key = normalizeKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  const heading = language === "Turkish" ? "Kritik Eksikler" : "Critical Gaps";

  return `${heading}:\n${(items.length ? items : [fallback])
    .map((item) => `• ${item.replace(/[.;]+$/, "")}`)
    .join("\n")}`;
}

function polishExecutiveSummary(
  value: string,
  language: ResponseLanguage
) {
  const localized =
    language === "Turkish"
      ? localizeTurkishExecutiveLanguage(value)
      : value;
  const headingPattern =
    language === "Turkish"
      ? /\s+(?=(?:Yönetici Özeti|Genel Yatırım Skoru|Tavsiye|Güven|Yapay Zekâ İçgörüsü|Destekleyici Kanıt|En Önemli 3 Fırsat|En Önemli 3 Risk|Gerekli Durum Tespiti|Yönetici Sonucu|Karar|Karar Gerekçesi|Gerekçe|Kararı Değiştirecek Kanıt|Gerekli Sonraki Adımlar)\s*:)/g
      : /\s+(?=(?:Executive Summary|Overall Investment Score|Recommendation|Confidence|AI Insight|Supporting Evidence|Top 3 Opportunities|Top 3 Risks|Required Due Diligence|Executive Conclusion|Decision|Decision Reasoning|Reasoning|What changes the decision|Required next actions)\s*:)/g;
  const seen = new Set<string>();

  return localized
    .replace(headingPattern, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !internalResearchDiagnosticPattern.test(line))
    .filter((line) => {
      const key = normalizeKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .join("\n");
}

function decisionCandidateLines(
  values: readonly string[],
  language: ResponseLanguage,
  limit: number,
  positiveOnly = false
) {
  const seen = new Set<string>();
  const negativePattern =
    /\b(?:eksik|doğrulanamadı|doğrulama|belirsiz|risk|yetersiz|gerekiyor|sınırlı|teyit edilmelidir|esas alınmalıdır|ancak|required|unknown|unverified|insufficient|risk|missing|only if)\b/i;
  const positivePattern =
    /\b(?:fırsat|olumlu|gelişim|büyüme|talep|doğrulanmış erişim|mevcut altyapı|opportunity|positive|growth|demand|confirmed access|available infrastructure)\b/i;
  const internalReportFieldPattern =
    /\b(?:assetIdentification|extractedDocumentFacts|ownershipTitleFindings|zoningLandUseStatus|accessInfrastructure|comparableMarketEvidence|valuationRange|legalRisks|environmentalGeotechnicalRisks|scenarioAnalysis|investmentScore|missingInformation|recommendedDueDiligence|finalRecommendation)\b/i;

  return values
    .flatMap((value) => value.split(/\n+|(?<=[.!?])\s+/))
    .map((line) =>
      line
        .replace(/^(?:[-•*]|\d+[.)])\s*/, "")
        .replace(/^(?:Kritik Eksikler|Doğrulanamayan Kritik Bilgiler|Critical Gaps|Missing Information|Karar Gerekçesi|Decision Reasoning)\s*:\s*/i, "")
        .replace(/https?:\/\/\S+/gi, "")
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !internalResearchDiagnosticPattern.test(line))
    .filter((line) => !internalReportFieldPattern.test(line))
    .filter((line) => !isGenericMissingEvidenceLine(line))
    .filter(
      (line) =>
        !positiveOnly ||
        (positivePattern.test(line) && !negativePattern.test(line))
    )
    .filter((line) => {
      const key = normalizeKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((line) =>
      line.length > 190 ? `${line.slice(0, 187).trimEnd()}…` : line
    )
    .slice(0, limit)
    .map((line) =>
      language === "Turkish" ? localizeTurkishExecutiveLanguage(line) : line
    );
}

function buildDecisionOrientedRecommendation({
  report,
  language,
  evidenceIsInsufficient,
  previousRecommendation,
  usableSourceCount,
}: {
  report: RealEstateReport;
  language: ResponseLanguage;
  evidenceIsInsufficient: boolean;
  previousRecommendation: string;
  usableSourceCount: number;
}) {
  const negativeDecision = /\b(?:Avoid|Kaçın|Uygun Değil|AVOID)\b/i.test(
    previousRecommendation
  );
  const positiveDecision = /\b(?:Proceed|Uygun|BUY|AL)\b/i.test(
    previousRecommendation
  );
  const decision = negativeDecision
    ? "AVOID"
    : positiveDecision && !evidenceIsInsufficient
      ? "BUY"
      : "WAIT";
  const risks = decisionCandidateLines(
    [
      report.legalRisks,
      report.environmentalGeotechnicalRisks,
      report.zoningLandUseStatus,
      report.accessInfrastructure,
    ],
    language,
    3
  );
  const positiveSignals = decisionCandidateLines(
    [
      report.developmentPotential,
      report.comparableMarketEvidence,
      report.location,
      report.accessInfrastructure,
    ],
    language,
    3,
    true
  );
  const missing = decisionCandidateLines(
    [report.missingInformation],
    language,
    4
  );
  const actions = decisionCandidateLines(
    [report.recommendedDueDiligence],
    language,
    4
  );
  const biggestReason = risks[0] || missing[0];
  const biggestReasonText = (
    biggestReason ||
    (language === "Turkish"
      ? "Kritik karar kanıtlarının tamamlanmamış olması"
      : "Critical decision evidence remains incomplete")
  ).replace(/[.!?]+$/, "");
  const legacyLocalizationNote =
    language === "Turkish" &&
    /Not verified|Doğrulanmadı/i.test(previousRecommendation)
      ? ` Kanıt Durumu: Doğrulanmadı.${
          /See Development Potential|Geliştirme potansiyeli incelenebilir/i.test(
            previousRecommendation
          )
            ? " Geliştirme potansiyeli incelenebilir."
            : ""
        }`
      : "";

  if (language === "Turkish") {
    const TurkishDecision =
      decision === "BUY" ? "Al" : decision === "AVOID" ? "Kaçın" : "Bekle";
    const TurkishDecisionCode = TurkishDecision.toLocaleUpperCase("tr-TR");
    const conclusion =
      decision === "BUY"
        ? "Mevcut doğrulanmış kanıtlar varlığın koşullu olarak yatırım incelemesinde ilerletilebileceğini gösteriyor."
        : decision === "AVOID"
          ? "Mevcut olumsuz bulgular sermaye taahhüdünü desteklemiyor."
          : "ZERINIX bugün sermaye taahhüdünü önermiyor; kritik resmî kayıtlar tamamlanmadan risk-getiri dengesi savunulabilir değil.";
    const noPositiveSignal =
      "Mevcut kanıtlarla doğrulanmış olumlu yatırım sinyali bulunmuyor.";
    const nextVerification =
      actions[0] ||
      "Yetkili tapu müdürlüğü ve belediyeden güncel tapu/takyidat, imar ve kadastro erişim kayıtları alınmalıdır.";
    const changeDecision =
      decision === "AVOID"
        ? "Olumsuz bulgunun yetkili kayıtla ortadan kalkması ve diğer kritik kontrollerin olumlu tamamlanması kararı yeniden incelemeye açar."
        : "Temiz tapu/takyidat, geliştirmeye uyumlu resmî imar ve doğrulanmış yasal erişim kararı AL yönünde incelemeye taşır; bunlardan birindeki maddi olumsuzluk KAÇIN kararını destekler.";
    const verifiedPattern = /Dış kaynaktan doğrulandı|resmî kaynaktan doğrulandı/i;
    const unverifiedConditions = [
      !verifiedPattern.test(report.ownershipTitleFindings) ? "tapu/takyidat" : "",
      !verifiedPattern.test(report.zoningLandUseStatus) ? "imar" : "",
      !verifiedPattern.test(report.accessInfrastructure) ? "yasal erişim" : "",
    ].filter(Boolean);
    const pageOneReason = unverifiedConditions.length
      ? `${unverifiedConditions.join(", ")} doğrulanmadı`
      : biggestReasonText;
    const immediateActions =
      "1) Güncel tapu/takyidat kaydını al; 2) imar durumu ve plan notlarını doğrula; 3) kadastrodan yasal erişimi teyit et.";

    return `${TurkishDecision}. Yönetici Özeti — Öneri: ${TurkishDecisionCode}. ${decision === "WAIT" ? "ZERINIX bugün sermaye taahhüt etmez." : conclusion} Neden: ${pageOneReason}. AL koşulu: temiz tapu, geliştirmeye uyumlu imar ve doğrulanmış yasal erişim. KAÇIN koşulu: tapu riski, uygunsuz imar veya yasal erişimin bulunmaması. İlk 3 adım: ${immediateActions}
Neden — Karar Gerekçesi / Yapay Zekâ İçgörüsü: ${biggestReasonText}. Destekleyici Kanıt: ${usableSourceCount} kullanılabilir dış kaynak. Öncelikli Riskler: ${risks.length ? risks.join(" | ") : "Kritik riskleri sıralamak için yeterli doğrulanmış veri yok."} Potansiyel Fırsatlar: ${positiveSignals.length ? positiveSignals.join(" | ") : noPositiveSignal}
Kararı Değiştirecek Kanıt: ${changeDecision} Kritik Eksikler (Eksik Kanıt): ${missing.length ? missing.join(" | ") : evidenceIsInsufficient ? "Tapu, imar, erişim ve diğer kritik resmî kayıtlar tamamlanmalıdır." : "Kritik ek bilgi açığı kaydedilmedi."}
Sonraki Adımlar: ${immediateActions} ${nextVerification}
ZERINIX Görüşü: ZERINIX bugün ${decision === "BUY" ? "yalnızca belirtilen koşullarla sermaye taahhüdünü değerlendirebilir" : "sermaye taahhüt etmez"}. Varlık şu anda ${decision === "BUY" ? "koşullu olarak cazip" : decision === "AVOID" ? "cazip değil" : "kritik resmî kayıtlar nedeniyle kesin değerlendirilemiyor"}. Olumlu çözüm AL incelemesini, olumsuz çözüm KAÇIN kararını destekler. Karar ağacı: İmar uyumlu, erişim doğrulanmış ve tapu temizse AL için incele; aksi yöndeki maddi bulguda KAÇIN.${legacyLocalizationNote}`;
  }

  const conclusion =
    decision === "BUY"
      ? "Available verified evidence supports advancing the asset through a conditional investment review."
      : decision === "AVOID"
        ? "Available adverse findings do not support committing capital."
        : "ZERINIX would not commit capital today because the risk-return case is not defensible until critical official records are complete.";
  const nextVerification =
    actions[0] ||
    "Obtain current title, encumbrance, zoning, and cadastral-access records from the competent authorities.";
  const changeDecision =
    "Clean title and encumbrance records, development-compatible official zoning, and confirmed legal access move the case toward BUY; a material adverse result in any of these supports AVOID.";

  const verifiedPattern = /Verified from external source|Verified from official source/i;
  const unverifiedConditions = [
    !verifiedPattern.test(report.ownershipTitleFindings) ? "title/encumbrances" : "",
    !verifiedPattern.test(report.zoningLandUseStatus) ? "zoning" : "",
    !verifiedPattern.test(report.accessInfrastructure) ? "legal access" : "",
  ].filter(Boolean);
  const pageOneReason = unverifiedConditions.length
    ? `${unverifiedConditions.join(", ")} are not verified`
    : biggestReasonText;
  const immediateActions =
    "1) Obtain current title and encumbrance records; 2) verify zoning and plan notes; 3) confirm legal cadastral access.";

  return `${decision}. Executive Summary — Recommendation: ${decision}. ${decision === "WAIT" ? "ZERINIX would not commit capital today." : conclusion} Why: ${pageOneReason}. BUY condition: clean title, development-compatible zoning, and verified legal access. AVOID condition: title risk, unsuitable zoning, or no legal access. Immediate actions: ${immediateActions}
Why — Decision Reasoning / ZERINIX Insight: ${biggestReasonText}. Supporting Evidence: ${usableSourceCount} usable external source(s). Priority Risks: ${risks.length ? risks.join(" | ") : "Insufficient verified evidence to rank material risks."} Positive Signals: ${positiveSignals.length ? positiveSignals.join(" | ") : "No positive investment signal is currently verified."}
What Changes the Decision: ${changeDecision} Critical Missing Information: ${missing.length ? missing.join(" | ") : evidenceIsInsufficient ? "Title, zoning, access, and other critical official records must be completed." : "No critical information gap was recorded."}
Next Actions: ${immediateActions} ${nextVerification}
ZERINIX View: ZERINIX would ${decision === "BUY" ? "consider committing capital only under the stated conditions" : "not commit capital today"}. The asset is currently ${decision === "BUY" ? "conditionally attractive" : decision === "AVOID" ? "unattractive" : "impossible to judge defensibly"}. A positive resolution supports BUY review; a negative resolution supports AVOID. Decision tree: if zoning is compatible, legal access is confirmed, and title is clean, review for BUY; otherwise AVOID on a material adverse finding.`;
}

function removeAssetNames(value: string, assetNames: readonly string[]) {
  let cleaned = value;

  for (const assetName of assetNames) {
    const normalizedName = assetName.trim();
    if (!normalizedName) continue;
    cleaned = cleaned.replace(
      new RegExp(escapeRegExp(normalizedName), "gi"),
      "yüklenen belge"
    );
  }

  return cleaned.replace(genericFilenamePattern, "yüklenen belge");
}

function cleanPresentationText({
  value,
  field,
  context,
  hasValidatedComparables,
  language,
  assetNames,
}: {
  value: string;
  field: RealEstateReportField;
  context: PropertyEvidenceContext;
  hasValidatedComparables: boolean;
  language: ResponseLanguage;
  assetNames: readonly string[];
}) {
  const withoutDiagnostics = removeUnusableVerifiedEvidence(
    repairSplitNumericEvidence(value),
    field,
    context,
    hasValidatedComparables
  )
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter(
      (line) =>
        !internalResearchDiagnosticPattern.test(line) &&
        !technicalMethodologyPattern.test(line) &&
        !containsBrokenSourceText(line) &&
        !brokenPresentationLinePattern.test(line) &&
        !/^\s*[-•*]\s*$/.test(line)
    )
    .join("\n");

  const documentFactCleanup = [
    "assetIdentification",
    "extractedDocumentFacts",
  ].includes(field)
    ? removeAssetNames(withoutDiagnostics, assetNames)
        .replace(
          /\[Verified from uploaded asset\]\s*/gi,
          language === "Turkish"
            ? "Belgeden çıkarılan bilgi: "
            : "Extracted from uploaded document: "
        )
        .replace(
          /\b(?:Güven|Confidence)\s*:\s*\d{1,3}(?:[.,]\d+)?\s*\/\s*100\.?/gi,
          language === "Turkish" ? "Belgeden çıkarıldı." : "Extracted from document."
        )
        .replace(
          /(?:^|[.;]\s*)(?:Kaynak|Source)\s*:\s*yüklenen belge[.;]?/gi,
          " "
        )
        .replace(
          /\b(?:Karar Gerekçesi\s*:\s*Belgeden doğrudan çıkarılan bu bilgi taşınmaz kimliğinin değerlendirme temelidir|Decision Reasoning\s*:\s*This directly extracted document fact forms part of the asset-identification basis)\.?/gi,
          ""
        )
        .replace(/\bDoğrulanmış Kanıt\s*:/gi, "Belgeden çıkarılan bilgi:")
        .replace(/\bVerified Evidence\s*:/gi, "Extracted document fact:")
        .replace(/\bAda\s*:\s*Pafta\s+/gi, "Pafta: ")
    : withoutDiagnostics;

  const localized = localizePresentationText(
    removeAssetNames(
      removeIsoTimestamps(documentFactCleanup, language)
        .replace(
          /Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi\.?/gi,
          ""
        )
        .replace(
          /All available external-source strategies returned no usable result\.?/gi,
          ""
        )
        .replace(
          /\[(?:Verified from official source|Verified from external source)\]\s*/gi,
          language === "Turkish"
            ? "Dış kaynaktan doğrulandı: "
            : "Verified from external source: "
        )
        .replace(
          /\[Unknown\]\s*/gi,
          ""
        )
        .replace(evidenceLabelPattern, "")
        .replace(provenancePattern, "")
        .replace(internalFieldPattern, "")
        .replace(/\/varlık\b/gi, "")
        .replace(/\bAsset\s*:\s*/gi, "")
        .replace(/\b(?:Kaynak|Source)\s*:\s*yüklenen belge\.?/gi, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .replace(/\(\s*\)/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      assetNames
    ),
    language
  );

  return language === "Turkish"
    ? localizeTurkishExecutiveLanguage(localized)
    : localized;
}

function dedupeLines(value: string, globalSeen: Set<string>) {
  const localSeen = new Set<string>();

  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = normalizeKey(line);
      if (!key || localSeen.has(key) || globalSeen.has(key)) return false;
      localSeen.add(key);
      globalSeen.add(key);
      return true;
    })
    .join("\n");
}

function extractIdentityLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => identityFieldPattern.test(line));
}

function normalizeIdentityLine(value: string) {
  return normalizeKey(
    value.replace(
      /^(?:Belgeden çıkarılan bilgi|Extracted from uploaded document)\s*:\s*/i,
      ""
    )
  );
}

function removeRepeatedIdentityLines(
  value: string,
  identityLines: readonly string[]
) {
  const identityKeys = new Set(
    identityLines.map(normalizeIdentityLine).filter(Boolean)
  );

  return value
    .split("\n")
    .filter((line) => !identityKeys.has(normalizeIdentityLine(line)))
    .join("\n")
    .trim();
}

function sourceInstitutionName(
  domain: string,
  explicitInstitution: string,
  language: ResponseLanguage
) {
  const normalizedDomain = domain.replace(/^www\./, "").toLowerCase();
  const knownInstitutions: Array<[
    RegExp,
    string,
    string,
  ]> = [
    [/^(?:.*\.)?hatay\.bel\.tr$/, "Hatay Metropolitan Municipality", "Hatay Büyükşehir Belediyesi"],
    [/^(?:.*\.)?defne\.bel\.tr$/, "Defne Municipality", "Defne Belediyesi"],
    [/^(?:.*\.)?afad\.gov\.tr$/, "Disaster and Emergency Management Authority (AFAD)", "Afet ve Acil Durum Yönetimi Başkanlığı (AFAD)"],
    [/^(?:.*\.)?(?:csb|csb\.gov|csb\.gov\.tr|mekansalplanlama\.csb\.gov\.tr)$/, "Ministry of Environment, Urbanisation and Climate Change", "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı"],
    [/^(?:.*\.)?tkgm\.gov\.tr$/, "General Directorate of Land Registry and Cadastre", "Tapu ve Kadastro Genel Müdürlüğü"],
    [/^(?:.*\.)?dsi\.gov\.tr$/, "State Hydraulic Works (DSİ)", "Devlet Su İşleri Genel Müdürlüğü (DSİ)"],
    [/^(?:.*\.)?mta\.gov\.tr$/, "General Directorate of Mineral Research and Exploration (MTA)", "Maden Tetkik ve Arama Genel Müdürlüğü (MTA)"],
  ];
  const known = knownInstitutions.find(([pattern]) =>
    pattern.test(normalizedDomain)
  );

  if (known) return language === "Turkish" ? known[2] : known[1];
  return explicitInstitution.trim() || normalizedDomain;
}

function sourceDecisionRelevance(
  mapping: RealEstateClaimSourceMapping | undefined,
  language: ResponseLanguage
) {
  const TurkishReasons: Partial<Record<RealEstateReportField, string>> = {
    ownershipTitleFindings:
      "Mülkiyet, takyidat ve hukuki yük değerlendirmesinin resmî dayanağını sağlar.",
    zoningLandUseStatus:
      "Parselin plan statüsü ve geliştirme hakkı değerlendirmesini doğrudan destekler.",
    accessInfrastructure:
      "Yasal erişim ve temel hizmet bağlantıları hakkındaki değerlendirmeyi destekler.",
    environmentalGeotechnicalRisks:
      "Konuma özgü afet, çevre veya zemin riskinin değerlendirilmesine dayanak sağlar.",
    comparableMarketEvidence:
      "Pazar karşılaştırması ve fiyat görüşünde kullanılan emsal kanıtı sağlar.",
    valuationRange:
      "Değerleme girdisi veya hesaplama dayanağı olarak kullanılır.",
    liquidity:
      "Yerel talep ve satış kabiliyeti değerlendirmesini destekler.",
    developmentPotential:
      "Geliştirme potansiyelinin dayandığı planlama, erişim veya altyapı koşulunu destekler.",
    location:
      "Taşınmazın idari ve mekânsal konumunu doğrulayan dayanak sağlar.",
  };
  const EnglishReasons: Partial<Record<RealEstateReportField, string>> = {
    ownershipTitleFindings:
      "Provides the official basis for ownership, encumbrance, and legal-burden assessment.",
    zoningLandUseStatus:
      "Directly supports the assessment of planning status and development rights.",
    accessInfrastructure:
      "Supports the assessment of legal access and essential utility connections.",
    environmentalGeotechnicalRisks:
      "Supports the location-specific hazard, environmental, or ground-risk assessment.",
    comparableMarketEvidence:
      "Provides comparable evidence used in the market and pricing assessment.",
    valuationRange:
      "Provides a valuation input or calculation basis.",
    liquidity:
      "Supports the local demand and marketability assessment.",
    developmentPotential:
      "Supports the planning, access, or infrastructure condition behind development potential.",
    location:
      "Provides evidence for the property's administrative and spatial location.",
  };
  const fallback = language === "Turkish"
    ? "İlgili rapor bulgusunun izlenebilir kanıt dayanağını sağlar."
    : "Provides a traceable evidence basis for the related report finding.";

  return mapping
    ? (language === "Turkish" ? TurkishReasons : EnglishReasons)[
        mapping.supportedSection
      ] || fallback
    : fallback;
}

function dedupeSources(
  value: string,
  mappings: readonly RealEstateClaimSourceMapping[],
  language: ResponseLanguage
) {
  const seenUrls = new Set<string>();
  const seenDomainContent = new Set<string>();
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) =>
      sourceUrlsFromLine(line).map((url) => {
        const canonicalUrl = url.toString().toLowerCase();
        const domain = url.hostname.replace(/^www\./, "");
        const explicitTitle = line.match(
          /(?:Kaynak başlığı|Source title)\s*:\s*([^;\n]+)/i
        )?.[1];
        const explicitInstitution = line.match(
          /(?:Kurum\/site|Institution\/site)\s*:\s*([^;\n]+)/i
        )?.[1] || "";
        const fallbackTitle = line
          .replace(/https?:\/\/\S+/gi, "")
          .replace(
            /(?:Kurum\/site|Institution\/site|URL|Erişim tarihi|Access date|Güven|Confidence|Karar gerekçesi|Decision reasoning)\s*:[^;\n]*/gi,
            ""
          )
          .replace(/^[-•*\s]+/, "")
          .trim();
        const title = (explicitTitle || fallbackTitle || domain)
          .replace(/[.;,:]+$/, "")
          .slice(0, 140);
        const domainContent = `${domain}|${normalizeKey(title)}`;

        if (
          seenUrls.has(canonicalUrl) ||
          seenDomainContent.has(domainContent)
        ) {
          return "";
        }
        seenUrls.add(canonicalUrl);
        seenDomainContent.add(domainContent);
        const mapping = mappings.find(
          (candidate) =>
            canonicalizeSourceUrl(candidate.sourceUrl)?.toString().toLowerCase() ===
            canonicalUrl
        );
        const institution = sourceInstitutionName(
          domain,
          explicitInstitution,
          language
        );
        const reason = sourceDecisionRelevance(mapping, language);
        return language === "Turkish"
          ? `- Kaynak: ${institution} — ${title} — ${url.toString()} — Neden önemli: ${reason}`
          : `- Source: ${institution} — ${title} — ${url.toString()} — Why it matters: ${reason}`;
      })
    )
    .filter(Boolean);

  return entries.join("\n");
}

function dedupeRepeatedJustifications(value: string, seen: Set<string>) {
  return value.replace(
    /(?:Karar Gerekçesi|Decision Reasoning)\s*:\s*[^.\n]+\.?/gi,
    (sentence) => {
      const key = normalizeKey(sentence);
      if (!key || seen.has(key)) return "";
      seen.add(key);
      return sentence;
    }
  );
}

function replaceSourceCounts(value: string, count: number) {
  return value
    .replace(
      /\b\d+\s+gerçek dış kaynak\b/gi,
      `${count} kullanılabilir dış kaynak`
    )
    .replace(
      /\b\d+\s+(?:real|usable) external source(?:\(s\)|s)?\b/gi,
      `${count} usable external source${count === 1 ? "" : "s"}`
    );
}

function removeArtificialConfidence(value: string) {
  return value.replace(
    /\b(?:Karar güveni|Decision confidence|Güven|Confidence)\s*:\s*\d{1,3}(?:[.,]\d+)?\s*\/\s*100\.?/gi,
    ""
  );
}

function removeResolvedMissingItems(
  value: string,
  context: PropertyEvidenceContext
) {
  return value
    .split("\n")
    .map((line) => {
      let cleaned = line;
      if (context.documentTypeExtracted) {
        cleaned = cleaned.replace(
          /((?:resmî|resmi|official|current|güncel)\s+)?(?:belge türü|doküman türü|document type|content type|yüklenen belge|uploaded (?:document|asset)|belge\b|doküman\b|document\b|asset\b)\s*[,;]?/gi,
          (match, qualifier: string | undefined) => qualifier ? match : ""
        );
      }
      if (context.parcelArea) {
        cleaned = cleaned.replace(
          /((?:resmî|resmi|official|current|güncel)\s+)?(?:parsel alanı|yüzölçümü|parcel area|parcel size)\s*[,;]?/gi,
          (match, qualifier: string | undefined) => qualifier ? match : ""
        );
      }
      return cleaned
        .replace(/([,:;])\s*[,;]+/g, "$1")
        .replace(/:\s*([,;])/g, ": ")
        .replace(/\s+([,.;:])/g, "$1")
        .replace(/[,;]\s*$/g, "")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}

export function prepareRealEstateReportForPresentation({
  report,
  language,
  assetNames = [],
  evidence,
}: {
  report: RealEstateReport;
  language: ResponseLanguage;
  assetNames?: readonly string[];
  evidence?: readonly RealEstateQualityEvidence[];
}): RealEstateReport {
  const evidenceContext = extractPropertyEvidenceContext(report);
  const validatedComparableContent = removeUnusableVerifiedEvidence(
    report.comparableMarketEvidence || "",
    "comparableMarketEvidence",
    evidenceContext,
    false
  );
  const hasValidatedComparables = validatedComparableContent
    .split("\n")
    .some((line) => externalVerifiedLabelPattern.test(line));
  const survivingClaimLines = presentationFields
    .filter((field) => field !== "sources")
    .flatMap((field) =>
      removeUnusableVerifiedEvidence(
        report[field] || "",
        field,
        evidenceContext,
        hasValidatedComparables
      )
      .split("\n")
      .filter((line) => externalVerifiedLabelPattern.test(line))
      .map((line) => ({ field, line }))
    );
  const usableEvidenceRegistry = evidence
    ? deduplicateUsableRealEstateExternalEvidence([...evidence])
    : [];
  const evidenceByUrl = new Map<string, RealEstateQualityEvidence[]>();
  for (const item of usableEvidenceRegistry) {
    const url = canonicalizeSourceUrl(String(item.url || ""));
    if (!url) continue;
    const key = url.toString().toLowerCase();
    evidenceByUrl.set(key, [...(evidenceByUrl.get(key) || []), item]);
  }
  const claimSourceMappings: RealEstateClaimSourceMapping[] =
    survivingClaimLines.flatMap(({ field, line }) => {
      const supportedClaim = extractSupportedClaim(line);
      const matchedIdentifiers = getMatchedPropertyIdentifiers(
        line,
        evidenceContext
      );
      return sourceUrlsFromLine(line).map((url) => ({
        sourceUrl: url.toString(),
        supportedSection: field,
        supportedClaim,
        matchedIdentifiers,
        relevanceStatus:
          supportedClaim &&
          matchedIdentifiers.length > 0 &&
          (!evidence ||
            (evidenceByUrl.get(url.toString().toLowerCase()) || []).some(
              (item) =>
                evidenceSupportsReportSection(
                  item,
                  field,
                  evidenceContext,
                  hasValidatedComparables
                )
            ))
            ? ("usable" as const)
            : ("rejected" as const),
      }));
    });
  const declaredSourceLines = (report.sources || "").split("\n");
  const verifiedSourceCandidates = claimSourceMappings
    .filter((mapping) => mapping.relevanceStatus === "usable")
    .map((mapping) => {
    const claimUrl = canonicalizeSourceUrl(mapping.sourceUrl);
    const declaredLine = claimUrl
      ? declaredSourceLines.find((line) =>
          sourceUrlsFromLine(line).some(
            (candidate) =>
              candidate.toString().toLowerCase() ===
              claimUrl.toString().toLowerCase()
          )
        )
      : "";
    const claimLine = survivingClaimLines.find(
      (candidate) =>
        candidate.field === mapping.supportedSection &&
        sourceUrlsFromLine(candidate.line).some(
          (url) => url.toString() === mapping.sourceUrl
        )
    )?.line;
    return removeIsoTimestamps(declaredLine || claimLine || "", language)
      .replace(evidenceLabelPattern, "")
      .replace(provenancePattern, "")
      .trim();
  });
  const cleaned = Object.fromEntries(
    presentationFields.map((field) => [
      field,
      cleanPresentationText({
        value: report[field] || "",
        field,
        context: evidenceContext,
        hasValidatedComparables,
        language,
        assetNames,
      }),
    ])
  ) as RealEstateReport;
  const identityLines = extractIdentityLines(cleaned.extractedDocumentFacts);
  const globalSeen = new Set<string>();
  const seenJustifications = new Set<string>();

  for (const field of presentationFields) {
    if (field === "sources") continue;
    let value = cleaned[field];

    if (field !== "extractedDocumentFacts") {
      value = removeRepeatedIdentityLines(value, identityLines);
    }

    if (field !== "missingInformation") {
      value = removeRepeatedMissingEvidenceLines(value);
    }

    value = dedupeRepeatedJustifications(value, seenJustifications);
    const globallyDeduped = dedupeLines(value, globalSeen);
    cleaned[field] =
      globallyDeduped ||
      (value.trim() ? dedupeLines(value, new Set<string>()) : "");
  }

  cleaned.sources = dedupeSources(
    verifiedSourceCandidates.join("\n"),
    claimSourceMappings.filter(
      (mapping) => mapping.relevanceStatus === "usable"
    ),
    language
  );
  cleaned.missingInformation = removeResolvedMissingItems(
    cleaned.missingInformation,
    evidenceContext
  );
  cleaned.missingInformation = consolidateCriticalGaps(
    cleaned.missingInformation,
    language
  );
  const usableSourceCount = cleaned.sources
    ? cleaned.sources.split("\n").filter(Boolean).length
    : 0;
  const evidenceIsInsufficient =
    usableSourceCount === 0 ||
    /\b(?:Kanıt Yetersiz|Insufficient Evidence|doğrulanamadı|doğrulama gerekiyor|could not be verified|verification required|Valuation Not Yet Defensible|Değerleme Henüz Savunulabilir Değil)\b/i.test(
      [cleaned.valuationRange, cleaned.missingInformation, cleaned.finalRecommendation].join(" ")
    );
  const previousRecommendation = cleaned.finalRecommendation;

  cleaned.finalRecommendation = replaceSourceCounts(
    cleaned.finalRecommendation,
    usableSourceCount
  );
  cleaned.finalRecommendation = polishExecutiveSummary(
    cleaned.finalRecommendation,
    language
  );

  if (evidenceIsInsufficient) {
    for (const field of presentationFields) {
      if (field === "assetIdentification" || field === "extractedDocumentFacts") {
        continue;
      }
      cleaned[field] = removeArtificialConfidence(cleaned[field]);
    }
  }

  for (const field of presentationFields) {
    if (!cleaned[field]?.trim()) {
      cleaned[field] = missingRequiredSectionContent(field, language);
    }
  }
  cleaned.finalRecommendation = buildDecisionOrientedRecommendation({
    report: cleaned,
    language,
    evidenceIsInsufficient,
    previousRecommendation,
    usableSourceCount,
  });

  return cleaned;
}
