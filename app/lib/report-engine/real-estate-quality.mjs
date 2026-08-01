const invalidEvidenceHostPattern =
  /^(?:localhost|127\.0\.0\.1|example\.(?:com|net|org)|example\.gov\.tr|invalid|test)$/i;
const placeholderPathSegmentPattern =
  /(?:^|\/)(?:yüklenen|yuklenen|uploaded|belge|missing|unknown|null|undefined)(?:\/|$)/i;
const genericHomepagePathPattern =
  /^\/(?:home|homepage|anasayfa|index(?:\.html?)?|haberler|news|duyurular)?\/?$/i;
const successfulRetrievalPattern =
  /^(?:ok|success|succeeded|retrieved|completed|completed_with_evidence|200)$/i;
const failedRetrievalPattern =
  /(?:fail|error|abort|timeout|timed_out|disabled|skipped|unavailable|no_evidence)/i;

const evidenceFieldPatterns = {
  title_status:
    /\b(?:tapu|takyidat|mülkiyet|malik|şerh|ipotek|haciz|title|ownership|encumbrance|lien|mortgage)\b/i,
  location:
    /\b(?:konum|koordinat|harita|mahalle|mevkii|location|coordinate|map|neighborhood|locality|parcel|parsel)\b/i,
  geospatial_context:
    /\b(?:konum|koordinat|harita|mekânsal|geospatial|coordinate|map|parcel|parsel)\b/i,
  zoning:
    /\b(?:imar|plan notu|arazi kullanım|yapılaşma|emsal|zoning|land use|development right|planning)\b/i,
  access:
    /\b(?:yol|erişim|cephe|kadastro|ulaşım|road|access|frontage|cadastral|transport)\b/i,
  infrastructure:
    /\b(?:altyapı|elektrik|su|kanalizasyon|telekom|doğalgaz|utility|infrastructure|electricity|water|sewer|telecom)\b/i,
  hazards:
    /\b(?:afad|dsi|deprem|sel|taşkın|heyelan|jeoloji|zemin|afet|flood|seismic|earthquake|hazard|geological|wildfire)\b/i,
  comparables:
    /\b(?:emsal|satılık|satış|işlem|ilan|fiyat|metrekare|m²|comparable|listing|transaction|asking price|sale price|unit price)\b/i,
  valuation_method:
    /\b(?:değerleme|hesaplama yöntemi|birim fiyat|valuation|calculation method|unit price|appraisal)\b/i,
  liquidity:
    /\b(?:likidite|talep|işlem hacmi|ilanda kalma|satış süresi|liquidity|demand|transaction volume|time on market)\b/i,
  amenities_projects:
    /\b(?:proje|ulaşım|okul|hastane|olanak|amenity|project|transport|school|hospital)\b/i,
  regional_development:
    /\b(?:bölgesel gelişim|kalkınma|yatırım|proje|regional development|development plan|public project)\b/i,
};

function normalizeEvidenceField(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function parseUsableEvidenceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      invalidEvidenceHostPattern.test(url.hostname) ||
      placeholderPathSegmentPattern.test(decodeURIComponent(url.pathname)) ||
      genericHomepagePathPattern.test(url.pathname) ||
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

function wasSuccessfullyRetrieved(item) {
  const status = String(
    item?.retrievalStatus || item?.resultStatus || item?.status || ""
  ).trim();
  const responseStatus = Number(item?.responseStatus || item?.httpStatus || 0);

  if (responseStatus && (responseStatus < 200 || responseStatus >= 400)) {
    return false;
  }
  if (status && failedRetrievalPattern.test(status)) return false;
  if (status && !successfulRetrievalPattern.test(status)) return false;

  // Existing evidence records predate explicit transport status. A complete
  // source/claim/value tuple is retained as the successful-retrieval signal.
  return Boolean(
    responseStatus ||
      status ||
      (String(item?.claim || "").trim() && String(item?.value || "").trim())
  );
}

function isRelevantToEvidenceField(item, url) {
  const field = normalizeEvidenceField(item?.field || item?.taskId);
  const text = [
    item?.claim,
    item?.value,
    item?.sourceTitle,
    item?.publisher,
    url.hostname,
    decodeURIComponent(url.pathname),
  ]
    .join(" ")
    .replace(/[_/-]+/g, " ");
  const directPattern = evidenceFieldPatterns[field];

  return Boolean(directPattern && directPattern.test(text));
}

function usesDisallowedEvidenceSubstitute(item, url) {
  const field = normalizeEvidenceField(item?.field || item?.taskId);
  const sourceIdentity = [
    item?.sourceTitle,
    item?.publisher,
    item?.sourceType,
    url.hostname,
    decodeURIComponent(url.pathname),
  ].join(" ");
  const claim = `${item?.claim || ""} ${item?.value || ""}`;
  const evidenceText = `${sourceIdentity} ${claim} ${
    Array.isArray(item?.supportingData) ? item.supportingData.join(" ") : ""
  }`;
  const exactParcelIdentifierPattern =
    /\b(?:ada|block)\s*(?:no\.?\s*)?\d+\b[\s\S]{0,80}\b(?:parsel|parcel)\s*(?:no\.?\s*)?\d+\b|\/\d{1,8}[-_/]\d{1,8}(?:\b|\/)/i;

  if (
    ["zoning", "title_status"].includes(field) &&
    item?.label !== "Verified from official source"
  ) {
    return true;
  }

  if (field === "zoning" && !exactParcelIdentifierPattern.test(evidenceText)) {
    return true;
  }

  if (
    field === "title_status" &&
    !(
      exactParcelIdentifierPattern.test(evidenceText) &&
      /\b(?:güncel|current|tarih|dated|20\d{2})\b/i.test(evidenceText)
    )
  ) {
    return true;
  }

  if (
    ["access", "infrastructure"].includes(field) &&
    !(
      exactParcelIdentifierPattern.test(evidenceText) ||
      /\b(?:mahalle|mevkii|neighborhood|locality|coordinate|koordinat)\b/i.test(
        evidenceText
      )
    )
  ) {
    return true;
  }

  if (
    field === "hazards" &&
    !/\b(?:mahalle|mevkii|neighborhood|locality|coordinate|koordinat|parcel|parsel)\b/i.test(
      evidenceText
    )
  ) {
    return true;
  }

  if (
    ["comparables", "valuation_method"].includes(field) &&
    /\b(?:belediye|municipality|afad|deprem|earthquake|altyapı|infrastructure|haber|news)\b/i.test(
      sourceIdentity
    )
  ) {
    return true;
  }

  if (
    field === "comparables" &&
    !(
      /\b(?:mahalle|mevkii|neighborhood|locality)\b/i.test(evidenceText) &&
      /\b(?:arsa|arazi|tarla|land|plot|field)\b/i.test(evidenceText) &&
      /\b20\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b/.test(evidenceText) &&
      /\d[\d.,]*\s*(?:m²|m2|metrekare|square metres?|sq\.?\s*m)/i.test(
        evidenceText
      ) &&
      /(?:₺|\bTL\b|\bTRY\b|\$|€)/i.test(evidenceText) &&
      /\b(?:ilan|satılık|satış|işlem|listing|asking|sale|transaction)\b/i.test(
        evidenceText
      )
    )
  ) {
    return true;
  }

  const claimsParcelLevelConfirmation =
    /\b(?:parsel(?:in|de|e)?|parcel(?:'s)?)\b[^.\n]{0,120}\b(?:doğruland|teyit edild|mevcut|bağlı|uygun|confirmed|verified|available|connected|compliant)\b/i.test(
      claim
    );
  const sourceContainsParcelIdentifier =
    /\b(?:ada|block)\s*(?:no\.?\s*)?\d+\b|\b(?:parsel|parcel)\s*(?:no\.?\s*)?\d+\b|\/\d{1,8}[-_/]\d{1,8}(?:\b|\/)/i.test(
      sourceIdentity
    );

  return Boolean(
    claimsParcelLevelConfirmation &&
      ["zoning", "access", "infrastructure"].includes(field) &&
      !sourceContainsParcelIdentifier
  );
}

export function isUsableRealEstateExternalEvidence(item) {
  const url = parseUsableEvidenceUrl(item?.url);

  return Boolean(
    item &&
      (item.label === "Verified from official source" ||
        item.label === "Verified from external source") &&
      String(item.claim || "").trim() &&
      String(item.value || "").trim() &&
      String(item.sourceTitle || "").trim() &&
      url &&
      wasSuccessfullyRetrieved(item) &&
      isRelevantToEvidenceField(item, url) &&
      !usesDisallowedEvidenceSubstitute(item, url)
  );
}

function usableEvidenceIdentity(item) {
  const url = parseUsableEvidenceUrl(item.url);
  const canonicalUrl = url?.toString().toLowerCase() || "";
  const domain = url?.hostname.replace(/^www\./, "") || "";
  const contentIdentity = [item.sourceTitle, item.claim, item.value]
    .join(" ")
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  return { canonicalUrl, domainContent: `${domain}|${contentIdentity}` };
}

export function deduplicateUsableRealEstateExternalEvidence(evidence) {
  const seenUrls = new Set();
  const seenDomainContent = new Set();
  const usable = (Array.isArray(evidence) ? evidence : []).filter((item) => {
    if (!isUsableRealEstateExternalEvidence(item)) return false;
    const identity = usableEvidenceIdentity(item);
    if (
      seenUrls.has(identity.canonicalUrl) ||
      seenDomainContent.has(identity.domainContent)
    ) {
      return false;
    }
    seenUrls.add(identity.canonicalUrl);
    seenDomainContent.add(identity.domainContent);
    return true;
  });
  const hasValidatedComparables = usable.some(
    (item) => normalizeEvidenceField(item?.field || item?.taskId) === "comparables"
  );

  return usable.filter((item) => {
    const field = normalizeEvidenceField(item?.field || item?.taskId);
    if (field !== "valuation_method") return true;
    const methodText = `${item?.claim || ""} ${item?.value || ""} ${
      Array.isArray(item?.supportingData) ? item.supportingData.join(" ") : ""
    }`;
    return (
      hasValidatedComparables &&
      /\b(?:emsal karşılaştırma|birim fiyat çarpımı|ağırlıklı ortalama|comparable sales|unit price multiplication|weighted average|calculation method)\b/i.test(
        methodText
      )
    );
  });
}

export function assertRealEstateUsesAvailableExternalEvidence({
  reportText,
  evidence,
}) {
  const usableExternalEvidence =
    deduplicateUsableRealEstateExternalEvidence(evidence);
  const externalClaims =
    String(reportText || "").match(
      /\[(?:Verified from official source|Verified from external source)\][^\n]*/gi
    ) || [];

  if (usableExternalEvidence.length > 0 && externalClaims.length === 0) {
    throw new Error(
      "Report quality gate failed: real-estate analysis merely repeats uploaded facts and omits available external evidence."
    );
  }

  return {
    usableExternalEvidenceCount: usableExternalEvidence.length,
    externalClaimCount: externalClaims.length,
  };
}

const excludedCompositionFields = new Set([
  "sources",
  "missingInformation",
]);
const externalEvidencePattern =
  /\[(?:Verified from official source|Verified from external source)\]/i;
const researchRecommendationPattern =
  /\[Recommendation\][^\n]*(?:\[Basis:[^\]]*(?:R\d+|https?:\/\/)[^\]]*\]|https?:\/\/)/i;

function visibleLineLength(value) {
  return String(value || "")
    .replace(
      /\[(?:Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Unknown|Recommendation)\]\s*/gi,
      ""
    )
    .replace(/\[(?:Asset|Basis|Required|Method|User)\s*:[^\]]*\]/gi, "")
    .replace(/\[R\d+\]/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

export function calculateRealEstateResearchComposition(report) {
  let researchedCharacters = 0;
  let totalDecisionCharacters = 0;

  for (const [field, content] of Object.entries(report || {})) {
    if (excludedCompositionFields.has(field)) continue;

    for (const line of String(content || "").split(/\n+/)) {
      const length = visibleLineLength(line);
      if (length === 0) continue;
      totalDecisionCharacters += length;

      if (
        externalEvidencePattern.test(line) ||
        researchRecommendationPattern.test(line)
      ) {
        researchedCharacters += length;
      }
    }
  }

  return {
    researchedCharacters,
    totalDecisionCharacters,
    researchShare:
      totalDecisionCharacters > 0
        ? researchedCharacters / totalDecisionCharacters
        : 0,
  };
}

export function assertRealEstateResearchComposition({
  report,
  minimumResearchShare = 0.8,
}) {
  const composition = calculateRealEstateResearchComposition(report);

  if (composition.researchShare + Number.EPSILON < minimumResearchShare) {
    throw new Error(
      `Report quality gate failed: external research content share ${Math.round(
        composition.researchShare * 100
      )}% is below the required ${Math.round(minimumResearchShare * 100)}%.`
    );
  }

  return composition;
}
