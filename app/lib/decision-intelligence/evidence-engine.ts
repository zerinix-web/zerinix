import type {
  DecisionEvidence,
  DomainProfile,
  EvidenceConflict,
  EvidenceValidation,
  ExtractedFact,
} from "./contracts";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizedValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const realEstateOfficialVerificationFields = new Set([
  "title_status",
  "zoning",
  "access",
  "infrastructure",
  "hazards",
  "comparables",
  "currency",
  "valuation_method",
  "liquidity",
]);
const realEstatePrimaryRecordFields = new Set([
  "title_status",
  "zoning",
  "access",
]);
const realEstateParcelSpecificFields = new Set([
  "title_status",
  "zoning",
  "access",
]);
const exactValueConflictFields = new Set([
  "asset_identification",
  "location",
  "parcel_size",
  "zoning",
  "currency",
]);

function canonicalConflictValue(field: string, value: string) {
  const normalized = normalizedValue(value);
  if (field === "zoning") {
    const categories: Array<[string, RegExp]> = [
      ["residential", /\b(residential|konut)\b/i],
      ["agricultural", /\b(agricultural|agriculture|tarla|tarım)\b/i],
      ["commercial", /\b(commercial|ticaret)\b/i],
      ["industrial", /\b(industrial|industry|sanayi)\b/i],
      ["protected", /\b(protected|conservation|sit alanı)\b/i],
      ["forest", /\b(forest|orman)\b/i],
    ];
    return categories.find(([, pattern]) => pattern.test(normalized))?.[0] || "";
  }
  if (field === "currency") {
    return normalized.match(/\b(try|tl|usd|eur|gbp)\b/i)?.[1]?.toUpperCase() || "";
  }
  if (field === "parcel_size") {
    return normalized.match(/[\d.,]+\s*(?:m²|m2|sqm|hectare|hektar|ha)\b/i)?.[0] || "";
  }
  return normalized;
}

function hasAbsoluteWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderText(value: string) {
  return /^(?:unknown|n\/a|none|null|undefined|belge|document|source|kaynak|-)?$/i.test(
    value.trim()
  );
}

function hasUsableExternalUrl(value: string) {
  if (!hasAbsoluteWebUrl(value)) return false;
  const url = new URL(value);
  if (
    /(?:yüklenen|uploaded|placeholder|example)(?:[\s/_-]|$)/i.test(
      `${url.pathname}${url.search}`
    )
  ) {
    return false;
  }
  return url.pathname !== "/" && url.pathname.trim().length > 1;
}

function canonicalSourceUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ].forEach((key) => url.searchParams.delete(key));
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

const fieldClaimPatterns: Record<string, RegExp> = {
  asset_identification: /\b(asset|property|parcel|ada|parsel|taşınmaz)\b/i,
  location: /\b(location|province|district|neighbou?rhood|il|ilçe|mahalle\p{L}*|mevkii|konum|köy\p{L}*)\b/iu,
  parcel_size: /\b(area|size|surface|yüzölçümü|metrekare|m²|m2|sqm|hectare|hektar)\b/i,
  title_status: /\b(title|deed|ownership|encumbrance|easement|tapu|takyidat|mülkiyet|şerh|ipotek|irtifak)\b/i,
  zoning: /\b(zoning|land use|development right|plan note|residential|agricultural|commercial|industrial|protected|forest|imar|plan notu|yapılaşma|konut|tarla|tarım|ticaret|sanayi|sit alanı|orman)\b/i,
  access: /\b(access|road|right of way|frontage|erişim|yol|geçit|cephe|kadastro)\b/i,
  infrastructure: /\b(infrastructure|electric|water|sewer|utility|altyapı|elektrik|su|kanalizasyon|telekom)\b/i,
  hazards: /\b(hazard|earthquake|flood|fire|soil|geolog|seismic|risk|deprem|sel|taşkın|yangın|zemin|heyelan|afet)\b/i,
  comparables: /\b(comparable|listing|transaction|asking price|sale price|emsal|ilan|satış|fiyat|m²)\b/i,
  currency: /\b(currency|try|tl|usd|eur|gbp|para birimi|₺|\$|€|£)\b/i,
  valuation_method: /\b(valuation|appraisal|comparable method|income method|değerleme|emsal yöntemi|gelir yöntemi)\b/i,
  liquidity: /\b(liquidity|transaction volume|time on market|demand|likidite|işlem hacmi|satış süresi|talep)\b/i,
  legal_overtime: /\b(?:overtime|unpaid overtime|wage and hour|fazla mesai|fazla çalışma)\b/i,
  legal_exempt_status: /\b(?:exempt|classification|misclassif|duties test|salary test|muaf|istisna)\b/i,
  legal_retaliation: /\b(?:retaliat|protected activity|wage complaint|misilleme|şikayet)\b/i,
  legal_severance_enforceability: /\b(?:severance agreement|settlement|release agreement|enforceab|ibraname|ikale)\b/i,
  legal_claim_waiver: /\b(?:waiver|release of claims|nonwaivable|feragat|ibra)\b/i,
  legal_final_pay: /\b(?:final pay|waiting time penalt|unpaid wage|termination pay|son ücret|ödenmeyen ücret)\b/i,
  legal_filing_routes: /\b(?:agency|complaint|filing|court|administrative claim|başvuru|dava|şikayet)\b/i,
  legal_limitation_deadlines: /\b(?:statute of limitations|limitation period|deadline|filing period|zamanaşımı|hak düşürücü|süre)\b/i,
  legal_evidence_preservation: /\b(?:evidence preservation|time records|payroll|personnel file|litigation hold|delil|kanıt|kayıt|bordro)\b/i,
  legal_case_law: /\b(?:case law|court decision|judgment|ruling|precedent|mahkeme kararı|içtihat|emsal karar)\b/i,
};

function targetIdentifiers(facts: readonly ExtractedFact[]) {
  const collect = (fields: string[]) =>
    facts
      .filter(
        (fact) =>
          fact.verified && !fact.missing && fields.includes(fact.field)
      )
      .flatMap((fact) =>
        normalizedValue(fact.value)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 2)
      );
  return {
    geography: collect([
      "province",
      "district",
      "neighborhood",
      "locality",
      "location",
      "address",
    ]),
    parcel: collect(["block", "ada", "parcel", "parsel"]),
  };
}

function containsIdentifier(text: string, identifiers: readonly string[]) {
  const normalized = normalizedValue(text);
  return identifiers.some((identifier) =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "u").test(
      normalized
    )
  );
}

function assessEvidenceQuality({
  profile,
  item,
  facts,
}: {
  profile: DomainProfile;
  item: DecisionEvidence;
  facts: readonly ExtractedFact[];
}) {
  if (
    !item.verified ||
    isPlaceholderText(item.value) ||
    isPlaceholderText(item.summary) ||
    isPlaceholderText(item.title)
  ) {
    return null;
  }

  if (item.category === "Verified Asset") {
    return {
      ...item,
      confidence: Math.min(item.confidence, 80),
      qualityScore: Math.min(item.qualityScore ?? 80, 80),
      qualityRationale:
        "Extracted from the uploaded asset; not independently verified against an authoritative record.",
    };
  }

  if (
    item.category === "Official Source" ||
    item.category === "External Research"
  ) {
    if (!hasUsableExternalUrl(item.url)) return null;

    const recognizedFields = new Set([
      ...profile.criticalEvidence,
      ...profile.researchRequirements.map((requirement) => requirement.field),
      ...profile.decisionRules.flatMap((rule) => rule.evidenceFields),
      ...profile.decisionRules.flatMap((rule) => rule.riskFields),
    ]);
    if (
      !recognizedFields.has(item.field) &&
      !(profile.id === "legal" && item.field.startsWith("legal_"))
    ) return null;

    const claimText = [
      item.summary,
      item.value,
      ...item.supportingData,
    ].join(" ");
    const claimPattern = fieldClaimPatterns[item.field];
    if (claimPattern && !claimPattern.test(claimText)) return null;
    if (profile.id === "legal") {
      if (
        !item.supportedIssue?.trim() ||
        !item.proposition?.trim() ||
        !item.jurisdiction?.trim() ||
        !item.sourceClassification ||
        item.sourceClassification === "unsupported/irrelevant"
      ) {
        return null;
      }
    }
    if (
      profile.id === "real_estate" &&
      realEstateOfficialVerificationFields.has(item.field) &&
      claimPattern &&
      !claimPattern.test(item.value)
    ) {
      return null;
    }

    const identifiers = targetIdentifiers(facts);
    if (
      profile.id === "real_estate" &&
      realEstateParcelSpecificFields.has(item.field) &&
      identifiers.geography.length > 0 &&
      identifiers.parcel.length > 0 &&
      (!containsIdentifier(claimText, identifiers.geography) ||
        !containsIdentifier(claimText, identifiers.parcel))
    ) {
      return null;
    }

    const legalReliability = {
      "primary legislation": 96,
      "official regulation": 94,
      "official court decision": 95,
      "official agency guidance": 88,
      "authoritative secondary source": 74,
      "commercial commentary": 58,
      "unsupported/irrelevant": 0,
    }[item.sourceClassification || "unsupported/irrelevant"];
    const baseReliability = profile.id === "legal"
      ? legalReliability
      : item.category === "Official Source" && item.official ? 90 : 65;
    const claimSupport = item.supportingData.some(
      (value) => !isPlaceholderText(value) && value.trim().length >= 12
    )
      ? 8
      : item.value.trim().length >= 8
        ? 4
        : 0;
    const upstreamQuality = item.qualityScore ?? baseReliability;
    const qualityScore = clamp(
      baseReliability * 0.65 + upstreamQuality * 0.25 + claimSupport
    );
    if (qualityScore < 55) return null;

    return {
      ...item,
      confidence: Math.min(item.confidence, qualityScore),
      qualityScore,
      qualityRationale: `${
        item.category === "Official Source" && item.official
          ? "Authoritative primary source"
          : "Independent secondary source"
      }; mapped to ${item.field}; claim support ${claimSupport > 4 ? "present" : "limited"}.`,
    };
  }
  return null;
}

function resolvesField(
  profile: DomainProfile,
  field: string,
  items: readonly DecisionEvidence[]
) {
  const verified = items;
  if (
    profile.id === "real_estate" &&
    realEstateOfficialVerificationFields.has(field)
  ) {
    if (realEstatePrimaryRecordFields.has(field)) {
      return verified.some(
        (item) => item.category === "Official Source" && item.official
      );
    }
    if (field === "comparables") {
      return (
        new Set(
          verified
            .filter((item) => item.category === "External Research")
            .map((item) => canonicalSourceUrl(item.url).toLowerCase())
        ).size >= 2
      );
    }
    return verified.some(
      (item) =>
        item.category === "Official Source" ||
        item.category === "External Research"
    );
  }
  return verified.length > 0;
}

function locationValuesOverlap(values: string[]) {
  const ignored = new Set([
    "location",
    "konum",
    "province",
    "il",
    "district",
    "ilçe",
    "neighborhood",
    "mahalle",
    "mahallesi",
    "locality",
    "mevkii",
    "köy",
    "köyü",
  ]);
  const tokenSets = values.map(
    (value) =>
      new Set(
        normalizedValue(value)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((token) => token.length >= 3 && !ignored.has(token))
      )
  );

  return tokenSets.every((tokens, index) =>
    tokenSets.every(
      (candidate, candidateIndex) =>
        index === candidateIndex ||
        [...tokens].some((token) => candidate.has(token))
    )
  );
}

function uploadedSourceIdentity(item: DecisionEvidence) {
  const sourceText = `${item.source} ${item.title}`;
  const filename = sourceText.match(
    /(?:^|[\s/\\])([^/\\\s]+\.(?:pdf|png|jpe?g|webp|gif|docx?|xlsx?|csv|txt|zip))(?:\s|$)/i
  )?.[1];
  return `uploaded:${(filename || item.source).trim().toLowerCase()}`;
}

export function crossValidateEvidence({
  profile,
  evidence,
  facts,
  unresolvedFields,
}: {
  profile: DomainProfile;
  evidence: DecisionEvidence[];
  facts: ExtractedFact[];
  unresolvedFields: string[];
}): EvidenceValidation {
  const byField = new Map<string, DecisionEvidence[]>();

  const usableEvidence = evidence
    .flatMap((item) => {
      const assessed = assessEvidenceQuality({ profile, item, facts });
      return assessed ? [assessed] : [];
    })
    .sort(
      (left, right) =>
        (right.qualityScore || 0) - (left.qualityScore || 0)
    )
    .filter((item, index, items) => {
      const identity =
        item.category === "Verified Asset"
          ? `${uploadedSourceIdentity(item)}:${item.field}:${normalizedValue(item.value)}`
          : `${canonicalSourceUrl(item.url)}:${item.field}:${normalizedValue(item.value)}`;
      return (
        items.findIndex((candidate) => {
          const candidateIdentity =
            candidate.category === "Verified Asset"
              ? `${uploadedSourceIdentity(candidate)}:${candidate.field}:${normalizedValue(candidate.value)}`
              : `${canonicalSourceUrl(candidate.url)}:${candidate.field}:${normalizedValue(candidate.value)}`;
          return candidateIdentity === identity;
        }) === index
      );
    });

  usableEvidence.forEach((item) => {
    const items = byField.get(item.field) || [];
    items.push(item);
    byField.set(item.field, items);
  });

  const conflicts: EvidenceConflict[] = [];
  const corroboratedFields: string[] = [];

  byField.forEach((items, field) => {
    const verified = items;
    const values = [...new Set(verified.map((item) => normalizedValue(item.value)))];
    const distinctSources = new Set(
      verified.map(
        (item) =>
          item.category === "Verified Asset"
            ? uploadedSourceIdentity(item)
            : canonicalSourceUrl(item.url).toLowerCase() ||
              `${item.provider}:${item.source}`.toLowerCase()
      )
    );
    const assessedImpacts = new Set(
      verified
        .map((item) => item.impact)
        .filter((impact) => impact === "favorable" || impact === "adverse")
    );
    const hasOpposingDecisionImpact =
      assessedImpacts.has("favorable") && assessedImpacts.has("adverse");
    const canonicalValues = new Set(
      verified
        .map((item) => canonicalConflictValue(field, item.value))
        .filter(Boolean)
    );
    const hasMaterialValueConflict =
      exactValueConflictFields.has(field) &&
      canonicalValues.size > 1 &&
      !(field === "location" && locationValuesOverlap(values));

    if (
      distinctSources.size > 1 &&
      (hasOpposingDecisionImpact || hasMaterialValueConflict)
    ) {
      conflicts.push({
        field,
        evidenceIds: verified.map((item) => item.id),
        values: verified.map((item) => item.value),
        explanation: `Verified sources disagree about ${field}; the conflict must be resolved before a confident decision.`,
        severity: profile.criticalEvidence.includes(field) ? "high" : "medium",
      });
    } else if (
      verified.length > 1 &&
      distinctSources.size > 1 &&
      (values.length === 1 ||
        (field === "location" && locationValuesOverlap(values)))
    ) {
      corroboratedFields.push(field);
    }
  });

  const resolvedFields = new Set(
    [...byField.entries()]
      .filter(([field, items]) => resolvesField(profile, field, items))
      .map(([field]) => field)
  );
  facts
    .filter((item) => item.verified && !item.missing)
    .forEach((item) => {
      if (
        profile.id !== "real_estate" ||
        !realEstateOfficialVerificationFields.has(item.field)
      ) {
        resolvedFields.add(item.field);
      }
    });
  const criticalUnresolved = profile.criticalEvidence.filter(
    (field) => !resolvedFields.has(field)
  );
  const coverage = profile.criticalEvidence.length
    ? clamp(
        ((profile.criticalEvidence.length - criticalUnresolved.length) /
          profile.criticalEvidence.length) *
          100
      )
    : 100;
  const verifiedEvidence = usableEvidence;
  const externallyVerifiedEvidence = verifiedEvidence.filter(
    (item) =>
      item.category === "Official Source" ||
      item.category === "External Research"
  );
  const bestConfidenceByField = new Map<string, number>();
  verifiedEvidence.forEach((item) => {
    bestConfidenceByField.set(
      item.field,
      Math.max(bestConfidenceByField.get(item.field) || 0, item.confidence)
    );
  });
  const evidenceConfidence = bestConfidenceByField.size
    ? [...bestConfidenceByField.values()].reduce((sum, value) => sum + value, 0) /
      bestConfidenceByField.size
    : 0;
  const officialRatio = externallyVerifiedEvidence.length
    ? externallyVerifiedEvidence.filter((item) => item.official).length /
      externallyVerifiedEvidence.length
    : 0;
  const distinctExternalSources = new Set(
    externallyVerifiedEvidence
      .map((item) => canonicalSourceUrl(item.url).toLowerCase())
      .filter(Boolean)
  ).size;
  const sourceBreadth = Math.min(100, distinctExternalSources * 20);
  const confidence = clamp(
    coverage * 0.3 +
      evidenceConfidence * 0.2 +
      officialRatio * 15 +
      sourceBreadth * 0.2 -
      conflicts.filter((item) => item.severity === "high").length * 12 +
      Math.min(5, corroboratedFields.length * 2)
  );

  return {
    evidence: usableEvidence,
    conflicts,
    corroboratedFields,
    unresolvedFields: [
      ...new Set([
        ...unresolvedFields.filter((field) => !resolvedFields.has(field)),
        ...criticalUnresolved,
      ]),
    ],
    coverage,
    confidence,
  };
}
