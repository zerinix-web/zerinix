import type { AnalysisAsset } from "@/app/lib/ai/analysis-assets";
import type {
  DomainResearchBundle,
  DomainResearchEvidence,
} from "@/app/lib/ai/domain-research";
import type { DomainAnalysisField } from "@/app/lib/report-engine/prompts/domain-analysis";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import { extractLegalResearchContext } from "../decision-intelligence/legal-research-context.mjs";

type DomainAnalysisReport = Record<DomainAnalysisField, string>;
type EmploymentIssue =
  | "wages"
  | "severance"
  | "notice"
  | "annualLeave"
  | "reinstatement"
  | "dismissalProcedure"
  | "mediation"
  | "limitation";
type LegalAssessment =
  | "HIGH PROBABILITY"
  | "LIKELY"
  | "UNCERTAIN"
  | "LOW PROBABILITY"
  | "WAIT";

type UserClaimKey =
  | "longTenure"
  | "poorPerformanceTermination"
  | "noWarning"
  | "noDefense"
  | "noImprovementPlan"
  | "noObjectiveEvaluation"
  | "unpaidWages"
  | "unusedLeave"
  | "employerTermination"
  | "noNoticePay";

type LegalResearchDiagnosticContext = {
  traceId?: string;
  originalQuery?: string;
};

const internalTokenPattern =
  /\[(?:Recommendation|Basis(?::[^\]]*)?|Unknown|Required(?::[^\]]*)?|Verified from (?:official source|external source|uploaded asset)|User-provided|Estimate|Asset(?::[^\]]*)?|R\d+)\]/gi;
const internalWordPattern =
  /\b(?:governing_law|market_standard|uploaded_asset|provider|pipeline|registry|schema|debug|synthesis timeout)\b/gi;
const prohibitedLegalReportLine =
  /(?:\bCAC\b|customer validation|capital efficiency|financial model|investor.?ready|strategy model|startup KPI|financial projection methodology|market intelligence|planning assumptions|benchmark KPI|competitive landscape|product strategy|market size|market comparisons|pazar karşılaştırmaları|founder readiness|^(?:market|product|competition)\s*[:\-]|request (?:was )?aborted|provider unavailable|response payload|stack trace|retry attempt|execution log|^\s*(?:not provided|validation required|unknown|title(?:\.[\w-]+)+|no verified contrary evidence(?: exists)?)\s*[.!]?\s*$)/i;
const employmentPattern =
  /(?:employment|employee|employer|wage|salary|overtime|severance|notice pay|annual leave|reinstatement|dismissal|termination|mediation|limitation|işçi|işveren|ücret|maaş|fazla mesai|kıdem|ihbar|yıllık izin|işe iade|işten çıkar|fesih|arabuluc|zamanaşımı)/i;

const issuePatterns: Record<EmploymentIssue, RegExp> = {
  wages: /(?:wage|salary|overtime|unpaid|payroll|ücret|maaş|fazla mesai|ödenme|bordro)/i,
  severance: /(?:severance|service period|kıdem|çalışma süresi)/i,
  notice: /(?:notice pay|notice period|ihbar|bildirim süresi)/i,
  annualLeave: /(?:annual leave|unused leave|yıllık izin|kullanılmayan izin)/i,
  reinstatement: /(?:reinstatement|re-employment|işe iade)/i,
  dismissalProcedure: /(?:poor performance|performance improvement|written warning|defence request|dismissal procedure|düşük performans|performans geliştirme|yazılı uyarı|savunma|fesih usul)/i,
  mediation: /(?:mediation|mediator|arabuluc)/i,
  limitation: /(?:limitation|time.?bar|prescription|zamanaşımı|hak düşürücü)/i,
};

const userClaimPatterns: Record<UserClaimKey, RegExp> = {
  longTenure: /(?:\d+\s*(?:yıl|sene|year)|uzun süredir çalış)/i,
  poorPerformanceTermination: /(?:poor performance|performance grounds|performans (?:nedeniyle|düşüklüğü)|düşük performans)/i,
  noWarning: /(?:no (?:written )?warning|without (?:a )?warning|uyarı.{0,50}(?:verilmedi|almadım|yapılmadı)|yazılı uyarı yok)/i,
  noDefense: /(?:no defence request|defence was not requested|savunma(?:m| talebi)?.{0,100}(?:istenmedi|alınmadı|verilmedi))/i,
  noImprovementPlan: /(?:no performance improvement (?:plan|process)|no pip|iyileştirme (?:planı|süreci).{0,30}(?:yok|sunulmadı|verilmedi)|performans geliştirme (?:planı|süreci).{0,30}(?:yok|uygulanmadı|verilmedi))/i,
  noObjectiveEvaluation: /(?:no objective performance (?:evaluation|documentation)|objective evaluation was not|objektif performans değerlendirmesi (?:yok|yapılmadı)|imzalı değerlendirme belgesi.{0,30}(?:yok|gösterilmedi|göstermiyor))/i,
  unpaidWages: /(?:unpaid (?:wage|salary|overtime)|without overtime compensation|salary was not paid|ücret.{0,60}(?:ödenmedi|ödemedi)|maaş.{0,80}(?:ödenmedi|ödemedi)|ödenmeyen ücret|ödenmeyen fazla mesai)/i,
  unusedLeave: /(?:unused annual leave|unused leave|kullanılmayan yıllık izin|kullanmadığım yıllık izin|izin ücretim ödenmedi)/i,
  employerTermination: /(?:employer terminated|dismissed|fired|[İi]şveren.{0,160}(?:feshetti|işten çıkardı)|beni işten çıkardı|işten çıkarıldım)/i,
  noNoticePay: /(?:no notice pay|notice pay was not paid|ihbar (?:tazminatı )?(?:ödenmedi|almadım))/i,
};

const userReportedEvidencePatterns = [
  [/(?:employment contract|employment agreement|iş sözleşme)/i, "İş sözleşmesinin mevcut olduğu belirtiliyor", "An employment agreement is stated to be available"],
  [/(?:SGK|social security|service record|hizmet dökümü)/i, "SGK/hizmet kayıtlarının mevcut olduğu belirtiliyor", "Social-security/service records are stated to be available"],
  [/(?:bank records?|bank statements?|banka kayıt|banka hareket)/i, "Banka kayıtlarının mevcut olduğu belirtiliyor", "Bank records are stated to be available"],
  [/(?:dismissal notice|termination notice|işten çıkarma bildirimi|fesih bildirimi)/i, "Fesih bildiriminin mevcut olduğu belirtiliyor", "A dismissal notice is stated to be available"],
  [/(?:WhatsApp|messages?|messages with the employer|yazışma|mesaj)/i, "İşverenle yazışmaların mevcut olduğu belirtiliyor", "Messages with the employer are stated to be available"],
] as const;

function cleanLegalText(value: unknown) {
  return String(value || "")
    .split("\n")
    .filter((line) => !prohibitedLegalReportLine.test(line))
    .join("\n")
    .replace(internalTokenPattern, "")
    .replace(internalWordPattern, "")
    .replace(/\bR\d+\b/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function logLegalResearchDiagnostic(
  event: string,
  details: Record<string, unknown>
) {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.LEGAL_RESEARCH_DIAGNOSTICS !== "true"
  ) {
    return;
  }
  console.info(`[legal-research-diagnostic] ${event}`, details);
}

function isAbsoluteWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function legalSourceType(item: DomainResearchEvidence) {
  if (item.sourceClassification) {
    const classified = {
      "primary legislation": "legislation",
      "official regulation": "legislation",
      "official court decision": "case_law",
      "official agency guidance": "official_guidance",
      "authoritative secondary source": "external",
      "commercial commentary": "external",
      "unsupported/irrelevant": "unusable",
    } as const;
    return classified[item.sourceClassification];
  }
  try {
    const url = new URL(item.url);
    const hasSpecificPath = url.pathname.replace(/\/+$/, "").length > 1;
    if (!hasSpecificPath) return "unusable" as const;
    const identity = cleanLegalText(
      [
        item.field,
        item.sourceType,
        item.sourceTitle,
        item.publisher,
        item.claim,
        item.value,
        url.pathname,
      ].join(" ")
    );
    if (
      /(?:court|tribunal|supreme|judgment|judgement|case law|decision|ruling|appellate|cassation|mahkeme|yargı|içtihat|karar|hüküm)/i.test(
        identity
      )
    ) {
      return "case_law" as const;
    }
    if (
      /(?:legislation|statute|regulation|code|gazette|act\b|law\b|mevzuat|kanun|yasa|yönetmelik|tebliğ|resmî gazete)/i.test(
        identity
      )
    ) {
      return "legislation" as const;
    }
    return item.label === "Verified from official source" &&
      item.authorityLevel === "primary"
      ? ("official_guidance" as const)
      : item.label === "Verified from external source"
        ? ("external" as const)
        : ("unusable" as const);
  } catch {
    return "unusable" as const;
  }
}

function hasAccessDate(item: DomainResearchEvidence) {
  return /^\d{4}-\d{2}-\d{2}/.test(item.lastChecked || "");
}

function getLegalEvidenceRejectionReasons(item: DomainResearchEvidence) {
  const reasons: string[] = [];
  const text = evidenceText(item);
  if (!isAbsoluteWebUrl(item.url)) reasons.push("invalid_or_missing_absolute_url");
  if (text.length < 24) reasons.push("insufficient_evidentiary_text");
  if (!employmentPattern.test(text)) reasons.push("not_relevant_to_employment_law");
  if (evidenceIssue(item) === null && !item.supportedIssue?.trim()) {
    reasons.push("no_supported_legal_issue_mapping");
  }
  if (item.field.startsWith("legal_") && !item.supportedIssue?.trim()) {
    reasons.push("missing_issue_mapping");
  }
  if (item.field.startsWith("legal_") && !item.proposition?.trim()) {
    reasons.push("missing_supported_proposition");
  }
  if (item.field.startsWith("legal_") && !item.jurisdiction?.trim()) {
    reasons.push("missing_jurisdiction_fit");
  }
  if (
    item.label !== "Verified from official source" &&
    item.label !== "Verified from external source"
  ) {
    reasons.push("not_classified_as_verified_external_source");
  }
  if (
    item.authorityLevel !== "primary" &&
    item.authorityLevel !== "secondary"
  ) {
    reasons.push("unsupported_authority_level");
  }
  if (legalSourceType(item) === "unusable") {
    reasons.push("untrusted_domain_or_generic_homepage");
  }
  if (!hasAccessDate(item)) reasons.push("missing_access_date");
  if (item.confidence <= 0) reasons.push("non_positive_confidence");
  return reasons;
}

function evidenceText(item: DomainResearchEvidence) {
  return cleanLegalText(
    [item.field, item.claim, item.value, ...item.supportingData].join(" ")
  );
}

function usableLegalEvidence(item: DomainResearchEvidence) {
  return getLegalEvidenceRejectionReasons(item).length === 0;
}

function issueEvidence(
  evidence: DomainResearchEvidence[],
  issue: EmploymentIssue
) {
  return evidence.filter((item) => issuePatterns[issue].test(evidenceText(item)));
}

function evidenceIssue(item: DomainResearchEvidence): EmploymentIssue | null {
  return (
    (Object.keys(issuePatterns) as EmploymentIssue[]).find((issue) =>
      issuePatterns[issue].test(evidenceText(item))
    ) || null
  );
}

function bulletList(items: string[], empty: string) {
  const unique = [...new Set(items.map(cleanLegalText).filter(Boolean))];
  return (unique.length ? unique : [empty])
    .map((item) => `• ${item}`)
    .join("\n");
}

function hasFact(facts: string[], pattern: RegExp) {
  return facts.some((fact) => pattern.test(fact));
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function deduplicateEvidence(evidence: DomainResearchEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = canonicalUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractUserClaims(prompt: string) {
  return Object.fromEntries(
    (Object.keys(userClaimPatterns) as UserClaimKey[]).map((key) => [
      key,
      userClaimPatterns[key].test(prompt),
    ])
  ) as Record<UserClaimKey, boolean>;
}

function extractUserReportedEvidence(prompt: string, isTurkish: boolean) {
  return userReportedEvidencePatterns
    .filter(([pattern]) => pattern.test(prompt))
    .map(([, turkish, english]) => (isTurkish ? turkish : english));
}

function extractReportedTenure(prompt: string, isTurkish: boolean) {
  const match = prompt.match(/(\d+)\s*(?:yıl|sene|years?)/i);
  if (!match) return isTurkish ? "Uzun süreli çalışma ilişkisi" : "Long period of employment";
  return isTurkish
    ? `${match[1]} yıllık çalışma ilişkisi`
    : `${match[1]} years of employment`;
}

function extractReportedUnpaidSalary(prompt: string, isTurkish: boolean) {
  const match = prompt.match(/(?:son\s+)?(\d+)\s*aylık\s+maaş/i);
  if (!match) return isTurkish ? "Ödenmeyen ücret alacağı" : "Unpaid wages";
  return isTurkish
    ? `Son ${match[1]} aylık ücretin ödenmediği beyanı`
    : `${match[1]} months of unpaid salary reported`;
}

function probabilityBand(probability: number, hasMeaningfulFacts: boolean): LegalAssessment {
  if (!hasMeaningfulFacts) return "WAIT";
  if (probability >= 75) return "HIGH PROBABILITY";
  if (probability >= 55) return "LIKELY";
  if (probability >= 30) return "UNCERTAIN";
  return "LOW PROBABILITY";
}

function buildEmploymentDecision({
  prompt,
  parsedFacts,
  evidence,
  conflicts,
}: {
  prompt: string;
  parsedFacts: string[];
  evidence: DomainResearchEvidence[];
  conflicts: DomainResearchBundle["decisionIntelligence"]["evidenceValidation"]["conflicts"];
}) {
  const combinedFacts = parsedFacts.join(" ");
  const userClaims = extractUserClaims(prompt);
  const factChecks = {
    relationship: hasFact(parsedFacts, /(?:employment|employee|işçi|işveren|çalışan|iş sözleşmesi)/i),
    duration: hasFact(parsedFacts, /(?:service period|start date|çalışma süresi|işe giriş|kıdem süresi)/i),
    termination: hasFact(parsedFacts, /(?:termination|dismissal|resignation|fesih|işten çıkar|istifa)/i),
    payment: hasFact(parsedFacts, /(?:payroll|bank|payment|wage|salary|bordro|banka|ödeme|ücret|maaş)/i),
    dates: hasFact(parsedFacts, /(?:date|dated|tarih|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i),
  };
  const ruleChecks = Object.fromEntries(
    (Object.keys(issuePatterns) as EmploymentIssue[]).map((issue) => [
      issue,
      issueEvidence(evidence, issue).some(
        (item) => item.authorityLevel === "primary" || item.label === "Verified from official source"
      ),
    ])
  ) as Record<EmploymentIssue, boolean>;
  const factCoverage = Object.values(factChecks).filter(Boolean).length;
  const ruleCoverage = Object.values(ruleChecks).filter(Boolean).length;
  const structuredUserFactCount = extractLegalResearchContext(prompt).userFacts.length;
  const userClaimCount = Math.min(
    10,
    Math.max(
      Object.values(userClaims).filter(Boolean).length,
      structuredUserFactCount
    )
  );
  const contradictionPenalty = Math.min(30, conflicts.length * 10);
  const confidence = Math.max(
    0,
    Math.min(
      95,
      Math.round(
        (Math.min(8, userClaimCount) / 8) * 35 +
          (factCoverage / 5) * 20 +
          (ruleCoverage / 8) * 35 +
          (evidence.length > 0 && conflicts.length === 0 ? 10 : 0) -
          contradictionPenalty
      )
    )
  );
  const adverseProof =
    /(?:valid release|full payment|final judgment|time.?barred|geçerli ibraname|tam ödeme|kesin hüküm|zamanaşımına uğramış)/i.test(
      combinedFacts
    );
  let meritsProbability = 35;
  if (userClaims.poorPerformanceTermination) meritsProbability += 5;
  if (userClaims.noWarning) meritsProbability += 10;
  if (userClaims.noDefense) meritsProbability += 10;
  if (userClaims.noImprovementPlan) meritsProbability += 8;
  if (userClaims.noObjectiveEvaluation) meritsProbability += 8;
  if (userClaims.unpaidWages) meritsProbability += 7;
  if (userClaims.unusedLeave) meritsProbability += 4;
  if (userClaims.employerTermination) meritsProbability += 5;
  if (userClaims.noNoticePay) meritsProbability += 5;
  if (userClaims.longTenure) meritsProbability += 5;
  meritsProbability += factCoverage * 4;
  meritsProbability -= Math.min(20, conflicts.length * 7);
  if (adverseProof) meritsProbability = Math.min(25, meritsProbability);
  if (factCoverage === 0) meritsProbability = Math.min(74, meritsProbability);
  if (ruleCoverage === 0) meritsProbability = Math.min(54, meritsProbability);
  const probability = Math.max(5, Math.min(95, Math.round(meritsProbability)));
  const hasMeaningfulFacts =
    userClaimCount > 0 || factCoverage > 0 || evidence.length > 0;
  const decision = probabilityBand(probability, hasMeaningfulFacts);

  const allegationIssues = (Object.keys(issuePatterns) as EmploymentIssue[]).filter(
    (issue) => issuePatterns[issue].test(prompt)
  );

  return {
    decision,
    probability,
    confidence,
    adverseProof,
    factChecks,
    ruleChecks,
    userClaims,
    allegationIssues,
    confidenceBasis: {
      factCoverage,
      ruleCoverage,
      userClaimCount,
      contradictionCount: conflicts.length,
    },
  };
}

function localizeDecision(decision: LegalAssessment, language: ResponseLanguage) {
  if (language === "English") return decision;
  const labels: Record<LegalAssessment, string> = {
    "HIGH PROBABILITY": "YÜKSEK OLASILIK",
    LIKELY: "MUHTEMEL",
    UNCERTAIN: "BELİRSİZ",
    "LOW PROBABILITY": "DÜŞÜK OLASILIK",
    WAIT: "BEKLE",
  };
  return labels[decision];
}

function accessDate(item: DomainResearchEvidence) {
  return (item.lastChecked || "").slice(0, 10);
}

function formatLegalSource(
  item: DomainResearchEvidence,
  supportedTopic: string,
  isTurkish: boolean
) {
  const title = cleanLegalText(item.sourceTitle);
  const publisher = cleanLegalText(item.publisher);
  const checkedAt = accessDate(item);
  const isOfficial =
    item.label === "Verified from official source" &&
    item.authorityLevel === "primary";
  const lines = [
    title && `${
      isOfficial
        ? isTurkish
          ? "Resmî başlık"
          : "Official title"
        : isTurkish
          ? "Kaynak başlığı"
          : "Source title"
    }: ${title}`,
    publisher && `${isTurkish ? "Yayınlayan" : "Publisher"}: ${publisher}`,
    `URL: ${item.url}`,
    checkedAt && `${isTurkish ? "Erişim tarihi" : "Access date"}: ${checkedAt}`,
    `${isTurkish ? "Güvenilirlik" : "Reliability"}: ${
      isOfficial
        ? isTurkish
          ? "Yüksek — resmî birincil kaynak"
          : "High — official primary authority"
        : isTurkish
          ? "Orta — doğrulanabilir ikincil kaynak"
          : "Moderate — verifiable secondary source"
    }`,
    `${isTurkish ? "Kaynak türü" : "Source type"}: ${
      isOfficial
        ? isTurkish
          ? "Resmî birincil hukuk kaynağı"
          : "Official primary legal authority"
        : isTurkish
          ? "Doğrulanabilir ikincil kaynak"
          : "Verifiable secondary source"
    }`,
    `${isTurkish ? "Karara katkısı" : "Decision relevance"}: ${
      isOfficial
        ? isTurkish
          ? `${supportedTopic} için uygulanabilir hukuk çerçevesini destekler; somut olayın gerçekleştiğini tek başına kanıtlamaz.`
          : `Supports the applicable legal framework for ${supportedTopic}; it does not independently prove the case facts.`
        : isTurkish
          ? `${supportedTopic} için doğrulanabilir bağlam sağlar; resmî hukuk kuralının veya somut olayın kanıtı değildir.`
          : `Provides verifiable context for ${supportedTopic}; it is not proof of an official rule or the case facts.`
    }`,
  ].filter((line): line is string => Boolean(line));
  return `• ${lines.join("\n  ")}`;
}

function methodologyText(isTurkish: boolean) {
  return isTurkish
    ? "Metodoloji\nAnaliz; kullanıcı beyanlarını, yüklenen dosyalardan ayrıştırılan olguları, doğrulanmış dış kaynakları ve koşullu hukuki çıkarımları ayrı değerlendirmiştir. Kaynaklar yalnızca geçerli URL, konu ilgisi ve izlenebilir erişim tarihi taşıdığında kullanılmış; güven düzeyi dosya kapsamı, resmî hukuk desteği ve kaynak çelişkilerine göre açıklanmıştır."
    : "Methodology\nThe analysis evaluates user-provided facts, facts extracted from parsed uploads, verified external sources, and conditional legal inferences separately. Sources are used only when they have a valid URL, issue relevance, and a traceable access date; confidence is explained by file coverage, official legal support, and source conflicts.";
}

export function assessLegalResearchCoverage(
  evidence: DomainResearchEvidence[],
  language: ResponseLanguage,
  context: LegalResearchDiagnosticContext = {}
) {
  logLegalResearchDiagnostic("coverage-input", {
    traceId: context.traceId || null,
    originalUserQuery: context.originalQuery || null,
    language,
    evidenceCount: evidence.length,
    evidence: evidence.map((item) => ({
      id: item.id,
      field: item.field,
      title: item.sourceTitle,
      publisher: item.publisher,
      url: item.url,
      label: item.label,
      authorityLevel: item.authorityLevel,
      lastChecked: item.lastChecked,
    })),
  });
  evidence.forEach((item) => {
    const rejectionReasons = getLegalEvidenceRejectionReasons(item);
    logLegalResearchDiagnostic("source-classification", {
      traceId: context.traceId || null,
      evidenceId: item.id,
      field: item.field,
      title: item.sourceTitle,
      url: item.url,
      classifiedSourceType: legalSourceType(item),
      officialLegalSource:
        rejectionReasons.length === 0 &&
        item.label === "Verified from official source" &&
        item.authorityLevel === "primary",
      accepted: rejectionReasons.length === 0,
      rejectionReasons,
    });
  });
  const usable = deduplicateEvidence(evidence.filter(usableLegalEvidence));
  const official = usable.filter(
    (item) =>
      item.label === "Verified from official source" &&
      item.authorityLevel === "primary"
  );
  const hasLegislation = official.some(
    (item) => legalSourceType(item) === "legislation"
  );
  const hasCaseLaw = official.some(
    (item) => legalSourceType(item) === "case_law"
  );
  const preliminary = !hasLegislation || !hasCaseLaw;
  logLegalResearchDiagnostic("coverage-decision", {
    traceId: context.traceId || null,
    originalUserQuery: context.originalQuery || null,
    usableOfficialEvidenceCount: usable.length,
    usableOfficialEvidenceUrls: usable.map((item) => item.url),
    officialSourceFound: official.some((item) =>
      ["legislation", "official_guidance"].includes(legalSourceType(item))
    ),
    courtDecisionFound: hasCaseLaw,
    hasLegislation,
    hasCaseLaw,
    gracefulDegradationCondition: "!hasLegislation || !hasCaseLaw",
    preliminary,
    blocksReportGeneration: false,
  });
  return { usable, hasLegislation, hasCaseLaw, preliminary };
}

export function prepareLegalDecisionReport({
  report,
  research,
  assets,
  prompt,
  language,
}: {
  report: DomainAnalysisReport;
  research: DomainResearchBundle;
  assets: AnalysisAsset[];
  prompt: string;
  language: ResponseLanguage;
}): DomainAnalysisReport {
  const isTurkish = language === "Turkish";
  const legalContext = extractLegalResearchContext(prompt);
  const assetNames = new Set(assets.map((asset) => asset.name));
  const parsedFacts = research.decisionIntelligence.extractedFacts
    .filter(
      (fact) =>
        fact.verified &&
        !fact.missing &&
        fact.category === "Verified Asset" &&
        assetNames.has(fact.source)
    )
    .map((fact) => `${cleanLegalText(fact.field)}: ${cleanLegalText(fact.value)}`)
    .filter((fact) => fact.length > 2);
  const researchCoverage = assessLegalResearchCoverage(
    research.evidence,
    language
  );
  const evidence = researchCoverage.usable;
  const preliminaryWarning = isTurkish
    ? "Resmî kaynaklar tam olarak doğrulanamadı. Bu analiz ön değerlendirme niteliğindedir ve profesyonel danışmanlığın yerini almamalıdır."
    : "Official sources could not be fully verified. This analysis is preliminary and should not replace professional advice.";
  const conflicts = research.decisionIntelligence.evidenceValidation.conflicts;
  const reportText = Object.values(report).map(cleanLegalText).join(" ");
  const employmentCase = employmentPattern.test(`${prompt} ${reportText}`);

  if (!employmentCase) {
    const emptySectionCopy: Record<DomainAnalysisField, [string, string]> = {
      subjectIdentification: [
        "İncelenen hukuki konu mevcut girdilerle daha dar tanımlanamamıştır.",
        "The legal matter cannot be defined more narrowly from the available input.",
      ],
      extractedFacts: [
        "Karara esas alınabilecek somut olay olgusu ayrıştırılmamıştır.",
        "No case-specific fact was extracted for the decision.",
      ],
      externalEvidence: [
        "Dış kaynak kapsamı aşağıdaki kanıt değerlendirmesinde açıklanmıştır.",
        "External-source coverage is explained in the evidence assessment below.",
      ],
      domainFindings: [
        "Mevcut olgular ek bir hukuki bulguyu desteklememektedir.",
        "The available facts do not support an additional legal finding.",
      ],
      regulatoryCompliance: [
        "Uygulanabilir yükümlülükler, yetkili hukuk ve işlem belgeleri netleştirilerek teyit edilmelidir.",
        "Applicable obligations require confirmation against the governing law and transaction records.",
      ],
      financialImplications: [
        "Belgeye dayalı bir parasal etki hesabı yapılamamıştır.",
        "No document-supported financial impact can be calculated.",
      ],
      operationalImplications: [
        "Uygulama adımları, sorumlular ve süreler somut dosya kapsamına göre belirlenmelidir.",
        "Execution steps, owners, and deadlines should be set against the specific case file.",
      ],
      riskAnalysis: [
        "Maddi risklerin sıralanabilmesi için olay ve belge kapsamının netleştirilmesi gerekir.",
        "The factual and documentary record must be clarified before material risks can be ranked.",
      ],
      scenarioAnalysis: [
        "Alternatif sonuçlar, doğrulanabilir olay olguları oluştuğunda karşılaştırılabilir.",
        "Alternative outcomes can be compared once verifiable case facts are available.",
      ],
      decisionAssessment: [
        "Mevcut kapsam kesin bir hukuki yön tayini için yeterli değildir.",
        "The current record is insufficient for a definitive legal direction.",
      ],
      missingInformation: [
        "Kararı etkileyen olay belgeleri ve uygulanabilir hukuk kaynakları tamamlanmalıdır.",
        "Decision-relevant case records and applicable legal authorities must be completed.",
      ],
      recommendedActions: [
        "Dosya kapsamını tamamlayın, uygulanabilir hukuku teyit edin ve sonucu uzman incelemesine sunun.",
        "Complete the case file, confirm the governing law, and submit the outcome for professional review.",
      ],
      finalRecommendation: [
        "Nihai yön, doğrulanabilir dosya olguları tamamlandıktan sonra belirlenmelidir.",
        "Final direction should be determined after the verifiable case record is complete.",
      ],
      sources: [
        "Bu değerlendirmede yayımlanabilir dış kaynak kullanılmamıştır.",
        "No publishable external source was used in this assessment.",
      ],
    };
    const cleaned = Object.fromEntries(
        Object.entries(report).map(([field, value]) => [
          field,
          cleanLegalText(value) ||
            emptySectionCopy[field as DomainAnalysisField][isTurkish ? 0 : 1],
        ])
      ) as DomainAnalysisReport;
    const genericSources = evidence.map((item) =>
      formatLegalSource(
        item,
        isTurkish ? "ilgili hukuki değerlendirme" : "the relevant legal assessment",
        isTurkish
      )
    );
    return {
      ...cleaned,
      externalEvidence: evidence.length
        ? isTurkish
          ? `${evidence.length} doğrulanabilir dış kaynak, rapordaki hukuki değerlendirmeleri desteklemek üzere kullanılmıştır. Kaynakların ayrıntıları ve karara katkıları Kaynaklar bölümünde yer almaktadır.`
          : `${evidence.length} verifiable external source(s) support the legal assessment. Source details and decision relevance appear in Sources.`
        : preliminaryWarning,
      finalRecommendation: cleaned.finalRecommendation,
      sources:
        [genericSources.join("\n\n"), methodologyText(isTurkish)]
          .filter(Boolean)
          .join("\n\n") ||
        (isTurkish
          ? "Doğrulanmış dış kaynak bulunmuyor."
          : "No verified external sources were available."),
    };
  }

  const assessment = buildEmploymentDecision({
    prompt,
    parsedFacts,
    evidence,
    conflicts,
  });
  const researchConfidencePenalty =
    (researchCoverage.hasLegislation ? 0 : 15) +
    (researchCoverage.hasCaseLaw ? 0 : 10) +
    (evidence.length > 0 ? 0 : 10);
  const calibratedConfidence = Math.max(
    5,
    assessment.confidence - researchConfidencePenalty
  );
  const decision = localizeDecision(assessment.decision, language);
  const issueLabels: Record<EmploymentIssue, [string, string]> = {
    wages: ["Ödenmeyen ücretler", "Unpaid wages"],
    severance: ["Kıdem tazminatı", "Severance eligibility"],
    notice: ["İhbar tazminatı", "Notice-pay eligibility"],
    annualLeave: ["Kullanılmayan yıllık izin", "Unused annual leave"],
    reinstatement: ["İşe iade", "Reinstatement"],
    dismissalProcedure: ["Feshin geçerliliği", "Validity of dismissal"],
    mediation: ["Zorunlu arabuluculuk", "Mandatory mediation"],
    limitation: ["Zamanaşımı", "Limitation periods"],
  };
  const claimedFacts = [
    ...legalContext.userFacts.map((fact) => `${fact.field}: ${fact.value}`),
    assessment.userClaims.longTenure &&
      extractReportedTenure(prompt, isTurkish),
    assessment.userClaims.poorPerformanceTermination &&
      (isTurkish ? "Performans gerekçeli fesih" : "Dismissal on performance grounds"),
    assessment.userClaims.noWarning &&
      (isTurkish ? "Yazılı uyarı verilmemesi" : "No written warning"),
    assessment.userClaims.noDefense &&
      (isTurkish ? "Savunma istenmemesi" : "No defence request"),
    assessment.userClaims.noImprovementPlan &&
      (isTurkish ? "Performans geliştirme planı uygulanmaması" : "No performance-improvement plan"),
    assessment.userClaims.noObjectiveEvaluation &&
      (isTurkish ? "Objektif performans değerlendirmesi yapılmaması" : "No objective performance evaluation"),
    assessment.userClaims.unpaidWages &&
      extractReportedUnpaidSalary(prompt, isTurkish),
    assessment.userClaims.unusedLeave &&
      (isTurkish ? "Kullanılmayan yıllık izin" : "Unused annual leave"),
    assessment.userClaims.employerTermination &&
      (isTurkish ? "İşveren tarafından fesih" : "Employer-initiated termination"),
    assessment.userClaims.noNoticePay &&
      (isTurkish ? "Ödenmeyen ihbar tazminatı" : "Unpaid notice compensation"),
    ...extractUserReportedEvidence(prompt, isTurkish),
  ].filter((item): item is string => Boolean(item));
  const issueSupport: Record<EmploymentIssue, boolean> = {
    wages: assessment.userClaims.unpaidWages,
    severance:
      assessment.userClaims.longTenure && assessment.userClaims.employerTermination,
    notice:
      assessment.userClaims.employerTermination || assessment.userClaims.noNoticePay,
    annualLeave: assessment.userClaims.unusedLeave,
    reinstatement:
      assessment.userClaims.employerTermination &&
      (assessment.userClaims.poorPerformanceTermination ||
        assessment.userClaims.noWarning ||
        assessment.userClaims.noDefense),
    dismissalProcedure:
      assessment.userClaims.poorPerformanceTermination &&
      (assessment.userClaims.noWarning ||
        assessment.userClaims.noDefense ||
        assessment.userClaims.noImprovementPlan ||
        assessment.userClaims.noObjectiveEvaluation),
    mediation: true,
    limitation: true,
  };
  const issueFindings = (Object.keys(issuePatterns) as EmploymentIssue[]).map(
    (issue) => {
      const label = issueLabels[issue][isTurkish ? 0 : 1];
      const supported = issueSupport[issue];
      const findings: Record<EmploymentIssue, [string, string]> = {
        wages: [
          supported
            ? "Ödenmeyen ücret beyanı ayrı bir alacak talebini destekler; miktar ve ödeme durumu bordro ile banka hareketlerinden teyit edilmelidir."
            : "Ödenmeyen ücret yönünde somut bir beyan bulunmadığından bu alacak için olumlu veya olumsuz yön tayin edilmemiştir.",
          supported
            ? "The reported unpaid salary supports a separate wage claim; amount and payment status require payroll and bank confirmation."
            : "No specific unpaid-wage allegation was supplied, so no directional assessment is made for this claim.",
        ],
        severance: [
          supported
            ? "Altı yıllık çalışma ve işveren feshi beyanları kıdem tazminatı ihtimalini güçlendirir; fesih türü ve hizmet kaydı sonucu belirler."
            : "Kıdem değerlendirmesi için çalışma süresi ile sözleşmenin kim tarafından ve hangi nedenle sona erdirildiği netleşmelidir.",
          supported
            ? "The reported six-year tenure and employer termination strengthen potential severance eligibility; the termination basis and service record determine the outcome."
            : "Severance direction depends on confirmed service duration and who ended the employment on what grounds.",
        ],
        notice: [
          supported
            ? "İşveren feshi ve ihbar ödemesi yapılmadığı beyanı, bildirim süresi uygulanmadıysa ihbar tazminatı talebini destekleyebilir."
            : "İhbar tazminatı yönü, fesih bildirimi ve bildirim süresine ilişkin kayıtlar olmadan belirlenemez.",
          supported
            ? "The reported employer termination and absent notice payment may support notice compensation if the notice period was not observed."
            : "Notice-pay direction depends on the termination notice and records showing whether the notice period was observed.",
        ],
        annualLeave: [
          supported
            ? "Kullanılmayan yıllık izin beyanı fesih sonrası ücret alacağına dönüşebilir; işverenin izin kayıtları ve ödeme bordrosu belirleyicidir."
            : "Kullanılmayan izin yönünde somut bir beyan bulunmadığından bu kalem için talep gücü ölçülmemiştir.",
          supported
            ? "Reported unused annual leave may convert into a payment claim after termination; employer leave records and payment payroll are decisive."
            : "No specific unused-leave allegation was supplied, so claim strength is not assessed for this item.",
        ],
        reinstatement: [
          supported
            ? "İşe iade ihtimali, fesih anlatımına göre incelenmeye değerdir; uygunluk işyeri çalışan sayısı, kıdem, sözleşme türü ve hak düşürücü süre gibi yetki alanına özgü koşullara bağlıdır."
            : "İşe iade uygunluğu, işveren feshi ile yasal kapsam ve başvuru süresi koşulları birlikte doğrulanmadan değerlendirilemez.",
          supported
            ? "Reinstatement merits review on the reported dismissal facts; eligibility remains subject to jurisdiction-specific headcount, tenure, contract, and filing-deadline conditions."
            : "Reinstatement eligibility cannot be assessed without confirming employer termination, statutory scope, and the filing deadline.",
        ],
        dismissalProcedure: [
          supported
            ? "Beyan doğruysa yazılı uyarı, savunma talebi, iyileştirme süreci ve objektif performans kaydının bulunmaması işverenin performans feshi savunmasını zayıflatabilir."
            : "Feshin hukuki dayanıklılığı, gerekçe ile bunu destekleyen uyarı, savunma ve performans kayıtlarının birlikte incelenmesine bağlıdır.",
          supported
            ? "If the account is accurate, the absence of written warning, a defence request, an improvement process, and objective performance records may weaken the employer's performance-dismissal case."
            : "The legal strength of dismissal depends on reviewing the stated reason alongside warning, defence, and performance records.",
        ],
        mediation: [
          "Zorunlu arabuluculuk veya eşdeğer dava öncesi başvuru, uygulanacak hukukta teyit edilerek dava açılmadan önce tamamlanmalıdır.",
          "Mandatory mediation or an equivalent pre-action process must be confirmed under the governing law and completed before filing where required.",
        ],
        limitation: [
          "Fesih tarihi ile her alacağın muacceliyet tarihi, zamanaşımı ve hak düşürücü süre hesabının başlangıç noktasıdır; gecikme hak kaybına yol açabilir.",
          "The dismissal date and accrual date of each claim start the limitation and filing-deadline analysis; delay may cause loss of rights.",
        ],
      };
      return `${label}: ${findings[issue][isTurkish ? 0 : 1]}`;
    }
  );
  const proceduralFinding = isTurkish
    ? "Dosya stratejisi: Beyan edilen olaylar, tarih sıralı belge seti ve talep bazlı hesap cetveliyle eşleştirilmelidir; bu yapı uzlaşma ve dava stratejisinin ortak dayanağını oluşturur."
    : "Case strategy: The factual account should be matched to a chronological document set and a claim-by-claim calculation schedule; this becomes the common basis for settlement and litigation strategy.";
  const defenses = isTurkish
    ? "İşveren savunmaları: Ödeme, istifa, haklı fesih, geçerli ibraname ve zamanaşımı savunmaları belgeyle karşılaştırılmalıdır."
    : "Employer defenses: Payment, resignation, just-cause termination, a valid release, and limitation defenses must be tested against documents.";

  const officialEvidenceCount = evidence.filter(
    (item) =>
      item.label === "Verified from official source" &&
      item.authorityLevel === "primary"
  ).length;
  const supportedLegalIssues = [...new Set(
    evidence
      .map((item) => {
        if (item.supportedIssue?.trim()) return item.supportedIssue.trim();
        const issue = evidenceIssue(item);
        return issue ? issueLabels[issue][isTurkish ? 0 : 1] : "";
      })
      .filter(Boolean)
  )];
  const evidenceAssessment = isTurkish
    ? evidence.length
      ? `${evidence.length} doğrulanabilir dış kaynağın ${officialEvidenceCount} adedi resmî birincil kaynaktır. Kaynaklar ${supportedLegalIssues.join(", ") || "uygulanabilir hukuk"} başlıklarındaki hukuk çerçevesini destekler; somut olayın ispatı ise yüklenen belgelere bağlıdır.`
      : "Dış araştırma, izlenebilirlik ve konu ilgisi koşullarını karşılayan bir kaynak üretmemiştir. Bu nedenle değerlendirme beyan ve dosya olgularıyla sınırlıdır; güven düzeyi bu sınırı yansıtır."
    : evidence.length
      ? `${officialEvidenceCount} of ${evidence.length} verifiable external source(s) are official primary authorities. They support the legal framework for ${supportedLegalIssues.join(", ") || "the applicable law"}; proof of the case facts still depends on the underlying documents.`
      : "External research produced no source meeting the traceability and issue-relevance requirements. The assessment is therefore limited to the factual account and parsed documents, and confidence reflects that limitation.";
  const issueMappedEvidence = evidence
    .map((item) => {
      const issue = item.supportedIssue?.trim();
      const proposition = item.proposition?.trim() || item.claim.trim();
      if (!issue || !proposition) return "";
      return `• ${issue}: ${proposition} (${item.sourceTitle})`;
    })
    .filter(Boolean)
    .join("\n");
  const missing = [
    !assessment.factChecks.relationship && (isTurkish ? "Çalışma ilişkisinin başlangıç ve bitiş kayıtları" : "Employment start and end records"),
    !assessment.factChecks.termination && (isTurkish ? "Fesih/istifa bildirimi ile fesih nedeni" : "Termination/resignation notice and stated reason"),
    !assessment.factChecks.payment && (isTurkish ? "Bordrolar, banka hareketleri ve ücret ödeme kayıtları" : "Payroll, bank statements, and wage-payment records"),
    !assessment.factChecks.dates && (isTurkish ? "Her talebin doğum ve muacceliyet tarihleri" : "Accrual and due dates for each claim"),
    !assessment.ruleChecks.mediation && (isTurkish ? "Uyuşmazlığa uygulanan arabuluculuk kuralının güncel resmî metni" : "Current official mediation rule applicable to the dispute"),
    !assessment.ruleChecks.limitation && (isTurkish ? "Her talebe uygulanan güncel zamanaşımı kuralı" : "Current limitation rule applicable to each claim"),
    !researchCoverage.hasLegislation &&
      (isTurkish
        ? "Uygulanabilir resmî mevzuat kaynağı"
        : "Applicable official legislation source"),
    !researchCoverage.hasCaseLaw &&
      (isTurkish
        ? "Uyuşmazlıkla ilgili doğrulanabilir yargı kararı"
        : "Verifiable judicial decision relevant to the dispute"),
  ].filter((item): item is string => Boolean(item));
  const risks = [
    isTurkish
      ? "Feshin geçersizliği riski: Performans gerekçesi, uyarı, savunma ve objektif değerlendirme kayıtları birlikte incelenmeden feshin hukuki dayanıklılığı ölçülemez."
      : "Wrongful-dismissal risk: The legal strength of a performance dismissal cannot be assessed without the warning, defence, and objective-evaluation records.",
    isTurkish
      ? "Parasal alacak riski: Bordro, banka, kıdem, ihbar ve yıllık izin kayıtları olmadan alacak kalemleri ile tutarları savunmaya açıktır."
      : "Monetary-claim risk: Without payroll, bank, severance, notice, and annual-leave records, entitlement and amounts remain contestable.",
    isTurkish
      ? "İşe iade ve usul riski: Çalışan sayısı, sözleşme türü, fesih tarihi, arabuluculuk ve dava süreleri bilinmeden hak kaybı riski ölçülemez."
      : "Reinstatement and procedural risk: Loss-of-right risk cannot be measured without headcount, contract type, dismissal date, mediation status, and filing deadlines.",
    ...conflicts.slice(0, 2).map((conflict) =>
      isTurkish
        ? `Güvenilir kaynaklar arasında çelişki: ${cleanLegalText(conflict.explanation)} Bu çelişki giderilene kadar güven düzeyi düşürülmüştür.`
        : `Trusted-source conflict: ${cleanLegalText(conflict.explanation)} Confidence is reduced until the conflict is resolved.`
    ),
  ];
  const nextActions = isTurkish
    ? [
        "İş sözleşmesi, çalışma/hizmet kayıtları, fesih/istifa bildirimi, bordrolar ve banka hareketlerini tek dosyada toplayın.",
        "Bir iş hukuku uzmanıyla her talep için hak kazanımı, tutar, muacceliyet ve zamanaşımı hesabını belge bazında doğrulayın.",
        "Uygulanacak hukukta dava öncesi arabuluculuk veya başka bir zorunlu başvuru bulunup bulunmadığını teyit ederek kanıt eklerini hazırlayın.",
      ]
    : [
        "Collect the employment agreement, service record, termination/resignation notice, payroll, and bank statements in one evidence file.",
        "Have employment counsel verify entitlement, amount, accrual, and limitation for each claim against the documents.",
        "Confirm whether the applicable jurisdiction requires pre-action mediation or another mandatory filing, then prepare indexed evidence.",
      ];
  const likelyOutcome = assessment.adverseProof
    ? isTurkish
      ? "Doğrulanmış maddi engel nedeniyle ileri sürülen işçilik taleplerinin başarı olasılığı düşüktür."
      : "The employment claims have a low probability of success because a verified material bar is present."
    : issueSupport.dismissalProcedure
      ? isTurkish
        ? "Kullanıcının anlatımı doğruysa performans gerekçeli fesih usulen kırılgan görünür; işe iade ve feshe bağlı alacaklar ciddi biçimde incelenmelidir."
        : "If the user's account is accurate, the performance dismissal appears procedurally vulnerable and the reinstatement and termination-related claims warrant serious review."
      : issueSupport.wages
        ? isTurkish
          ? "Ödenmeyen ücret iddiası hukuken ileri sürülebilir görünür; başarı, bordro ve banka kayıtlarıyla ispatlanmasına bağlıdır."
          : "The unpaid-wage claim appears legally arguable; success depends on payroll and bank evidence."
        : isTurkish
          ? "Mevcut beyanlar en az bir iş hukuku talebinin ayrıntılı incelenmesini gerektiriyor, ancak sonuç talep bazında değişebilir."
          : "The current account warrants detailed review of at least one employment claim, although the outcome may differ by claim.";
  const confidenceExplanation = isTurkish
    ? `Olasılık: %${assessment.probability}. Güven: %${calibratedConfidence}. Güven hesabı; 10 kullanıcı olgusu grubundan ${assessment.confidenceBasis.userClaimCount}, 5 kritik olay grubundan ${assessment.confidenceBasis.factCoverage} ayrıştırılmış dosya kanıtı ve 8 hukuk başlığından ${assessment.confidenceBasis.ruleCoverage} resmî kaynak kapsamına dayanır. Eksik resmî kaynak kapsamı güveni ${researchConfidencePenalty} puan, ${assessment.confidenceBasis.contradictionCount} kaynak çelişkisi ayrıca düşürmüştür.`
    : `Probability: ${assessment.probability}%. Confidence: ${calibratedConfidence}%. Confidence reflects ${assessment.confidenceBasis.userClaimCount} of 10 user-fact groups, parsed-file support for ${assessment.confidenceBasis.factCoverage} of 5 critical fact groups, and official-rule coverage for ${assessment.confidenceBasis.ruleCoverage} of 8 legal issues. Missing official-source coverage reduced confidence by ${researchConfidencePenalty} points; ${assessment.confidenceBasis.contradictionCount} source conflict(s) reduced it further.`;
  const alternativeOutcome = assessment.adverseProof
    ? isTurkish
      ? "Maddi engel oluşturan belgenin geçersizliği kanıtlanır ve ödenmeyen alacaklar doğrulanırsa değerlendirme MUHTEMEL yönüne yükselebilir."
      : "The assessment may rise toward LIKELY if the material-bar document is shown to be invalid and unpaid entitlements are proven."
    : isTurkish
      ? "İşverenin geçerli performans süreci, yazılı uyarılar, alınmış savunma, tam ödeme veya haklı fesih belgeleri sunması hâlinde değerlendirme DÜŞÜK OLASILIK yönüne döner."
      : "The assessment moves toward LOW PROBABILITY if the employer produces a valid performance process, written warnings, a defence record, full-payment proof, or just-cause documentation.";
  const strongestPotentialClaim = issueSupport.dismissalProcedure
    ? isTurkish
      ? "performans gerekçeli feshin usulen zayıf olduğu iddiası"
      : "the potential procedural weakness of the performance dismissal"
    : issueSupport.wages
      ? isTurkish
        ? "ödenmeyen ücret alacağı"
        : "the unpaid-wage claim"
      : isTurkish
        ? "belgeyle desteklenebilen işçilik alacağı"
        : "the employment claim best supported by the documents";
  const urgentProceduralPoint = isTurkish
    ? "Fesih tarihi esas alınarak zorunlu arabuluculuk ve işe iade dâhil tüm başvuru süreleri derhâl teyit edilmelidir."
    : "All filing deadlines, including mandatory mediation and reinstatement deadlines, should be confirmed immediately from the dismissal date.";
  const finalRecommendation = isTurkish
    ? `Nihai tavsiye: ${decision}\nMevcut beyanlara göre en güçlü potansiyel talep ${strongestPotentialClaim}dır. ${urgentProceduralPoint} İşverenin usule uygun performans kayıtları, tam ödeme kanıtı veya geçerli bir fesih savunması sunması bu yönü tersine çevirebilir; bu nedenle sonuç koşulludur.`
    : `Final recommendation: ${decision}\nOn the current account, the strongest potential claim is ${strongestPotentialClaim}. ${urgentProceduralPoint} The conclusion may reverse if the employer produces a compliant performance record, proof of full payment, or a valid termination defence; the assessment therefore remains conditional.`;

  const sourceLines = evidence.slice(0, 5).map((item) => {
    const issue = evidenceIssue(item);
    const supportedTopic = item.supportedIssue?.trim() || (issue
      ? issueLabels[issue][isTurkish ? 0 : 1]
      : isTurkish
        ? "ilgili hukuk kuralı"
        : "the relevant legal rule");
    return formatLegalSource(item, supportedTopic, isTurkish);
  });
  const allegationSummary = assessment.allegationIssues.map(
    (issue) => issueLabels[issue][isTurkish ? 0 : 1]
  );
  const executiveSummary = [
    researchCoverage.preliminary ? preliminaryWarning : "",
    isTurkish ? `Karar: ${decision}` : `Assessment: ${decision}`,
    likelyOutcome,
    isTurkish
      ? `Kararın temeli: ${assessment.confidenceBasis.userClaimCount} kullanıcı olgusu grubu, ${assessment.confidenceBasis.factCoverage} ayrıştırılmış dosya olgusu grubu ve ${assessment.confidenceBasis.ruleCoverage} resmî hukuk başlığı.`
      : `Decision basis: ${assessment.confidenceBasis.userClaimCount} user-fact group(s), ${assessment.confidenceBasis.factCoverage} parsed-file fact group(s), and ${assessment.confidenceBasis.ruleCoverage} officially supported legal issue(s).`,
  ].filter(Boolean).join("\n");
  const keyFindings = [
    claimedFacts.length
      ? `${isTurkish ? "Beyan edilen olgular (bağımsız doğrulama yapılmadı)" : "Reported facts (not independently verified)"}\n${bulletList(claimedFacts, "")}`
      : "",
    parsedFacts.length
      ? `${isTurkish ? "Yüklenen dosyalardan ayrıştırılan olgular" : "Facts extracted from parsed uploads"}\n${bulletList(parsedFacts, "")}`
      : "",
  ].filter(Boolean).join("\n\n") ||
    (isTurkish
      ? "Somut olay değerlendirmesine esas alınabilecek olgu sunulmamıştır."
      : "No case-specific facts were available for assessment.");

  return {
    subjectIdentification: executiveSummary,
    extractedFacts: `${isTurkish ? "Öne çıkan bulgular" : "Key findings"}\n${keyFindings}\n${isTurkish ? "İncelenen hukuki başlıklar" : "Legal issues assessed"}: ${allegationSummary.join(", ") || (isTurkish ? "iş ilişkisinden doğan talepler" : "claims arising from employment")}.`,
    externalEvidence: [evidenceAssessment, issueMappedEvidence]
      .filter(Boolean)
      .join("\n\n"),
    domainFindings: `${issueFindings[5]}\n\n${issueFindings[4]}`,
    regulatoryCompliance: `${issueFindings[6]}\n\n${issueFindings[7]}`,
    financialImplications: issueFindings.slice(0, 4).join("\n\n"),
    operationalImplications: `${proceduralFinding}\n${defenses}`,
    riskAnalysis: bulletList(risks, isTurkish ? "Kanıtlanmış ek maddi risk yok." : "No additional evidenced material risk."),
    scenarioAnalysis: isTurkish
      ? `Alternatif senaryo\n${alternativeOutcome}`
      : `Alternative scenario\n${alternativeOutcome}`,
    decisionAssessment: `${isTurkish ? "Güven değerlendirmesi" : "Confidence assessment"}\n${confidenceExplanation}`,
    missingInformation: bulletList(
      missing,
      isTurkish ? "Kararı engelleyen ek kanıt boşluğu bulunmuyor." : "No additional decision-blocking evidence gap was identified."
    ),
    recommendedActions: nextActions
      .map((action, index) => `${index + 1}. ${action}`)
      .join("\n"),
    finalRecommendation,
    sources: [
      sourceLines.join("\n\n") ||
        (isTurkish
          ? "Bu değerlendirmede yayımlanabilir dış kaynak kullanılmamıştır."
          : "No publishable external source was used in this assessment."),
      methodologyText(isTurkish),
    ].join("\n\n"),
  };
}
