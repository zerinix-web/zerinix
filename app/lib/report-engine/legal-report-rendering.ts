type LegalReportSection = {
  field?: string;
  title: string;
  content: string;
};

type LegalRenderableReport = {
  type: string;
  title: string;
  prompt: string;
  sections: LegalReportSection[];
};

const legalRenderCopy = {
  en: { statement: "User-provided statement (not independently verified)", executive: "Executive Legal Assessment", facts: "Material Facts", claims: "Claim-by-Claim Analysis", evidence: "Evidence Assessment", procedure: "Procedural and Deadline Risks", counterarguments: "Employer Counterarguments", missing: "Missing Evidence", actions: "Exactly Three Immediate Actions", recommendation: "Final Recommendation", sources: "Verified Sources", methodology: "Legal Methodology and Limitations", publisher: "Publisher", accessDate: "Access date", sourceType: "Source type" },
  tr: { statement: "Kullanıcının beyanı (bağımsız olarak doğrulanmamıştır)", executive: "Yönetici Hukuki Değerlendirmesi", facts: "Maddi Olgular", claims: "Talep Bazlı Analiz", evidence: "Kanıt Değerlendirmesi", procedure: "Usul ve Süre Riskleri", counterarguments: "İşverenin Olası Savunmaları", missing: "Eksik Kanıtlar", actions: "Hemen Atılacak Üç Adım", recommendation: "Nihai Tavsiye", sources: "Doğrulanmış Kaynaklar", methodology: "Hukuki Metodoloji ve Sınırlamalar", publisher: "Kurum", accessDate: "Erişim tarihi", sourceType: "Kaynak türü" },
  de: { statement: "Angaben des Nutzers (nicht unabhängig verifiziert)", executive: "Rechtliche Gesamtbewertung", facts: "Wesentliche Tatsachen", claims: "Anspruchsbezogene Analyse", evidence: "Nachweisbewertung", procedure: "Verfahrens- und Fristrisiken", counterarguments: "Mögliche Einwände des Arbeitgebers", missing: "Fehlende Nachweise", actions: "Genau drei Sofortmaßnahmen", recommendation: "Abschließende Empfehlung", sources: "Verifizierte Quellen", methodology: "Rechtliche Methodik und Grenzen", publisher: "Herausgeber", accessDate: "Zugriffsdatum", sourceType: "Quellentyp" },
  fr: { statement: "Déclaration de l'utilisateur (non vérifiée indépendamment)", executive: "Évaluation juridique exécutive", facts: "Faits matériels", claims: "Analyse par demande", evidence: "Évaluation des preuves", procedure: "Risques procéduraux et délais", counterarguments: "Arguments possibles de l'employeur", missing: "Preuves manquantes", actions: "Exactement trois actions immédiates", recommendation: "Recommandation finale", sources: "Sources vérifiées", methodology: "Méthodologie juridique et limites", publisher: "Éditeur", accessDate: "Date de consultation", sourceType: "Type de source" },
  es: { statement: "Declaración del usuario (no verificada de forma independiente)", executive: "Evaluación jurídica ejecutiva", facts: "Hechos materiales", claims: "Análisis por reclamación", evidence: "Evaluación de la evidencia", procedure: "Riesgos procesales y plazos", counterarguments: "Posibles argumentos del empleador", missing: "Evidencia faltante", actions: "Exactamente tres acciones inmediatas", recommendation: "Recomendación final", sources: "Fuentes verificadas", methodology: "Metodología jurídica y limitaciones", publisher: "Editor", accessDate: "Fecha de acceso", sourceType: "Tipo de fuente" },
} as const;

const legalSignalPattern =
  /\b(?:legal|law|contract|employment|employee|employer|dismissal|termination|severance|notice pay|unpaid wages|annual leave|reinstatement|mediation|limitation|hukuk|sözleşme|işçi|işveren|işten çıkar|fesih|kıdem|ihbar|ücret|maaş|yıllık izin|işe iade|arabuluc|zamanaşımı)\b/i;
const legalCaseSignalPattern =
  /\b(?:employment|employee|employer|dismissal|termination|severance|notice pay|unpaid wages|annual leave|reinstatement|lawsuit|litigation|işçi|işveren|işten çıkar|fesih|kıdem|ihbar|ödenmeyen ücret|ödenmemiş maaş|yıllık izin|işe iade|dava)\b/i;
const businessArtifactPattern =
  /(?:investor[ -]grade|investor ready|strategy model|customer validation|\bCAC\b|capital efficiency|competition|competitor analysis|financial plan|brand strategy|business idea validation|startup KPI|market sizing|market size|financial projections?|KPI estimates?|founder readiness|product strategy|^(?:market|product)\s*:)/i;
const internalMetadataPattern =
  /(?:\[(?:Recommendation|Basis(?::[^\]]*)?|Unknown|Required(?::[^\]]*)?|Verified from [^\]]+|User-provided|Estimate)\]|\b(?:governing_law|market_standard|uploaded_asset)\b|(?:erişim|erisim)[._]+tarihi[._]+\d+|güvenilirlik[._]+(?:yüksek|orta|düşük)|resm[îi]?[._]+başlık)/gi;
const repeatedTemplatePattern =
  /(?:Mevcut olay anlatımı bu başlıkta yön belirlemek için yeterli ayrıntı içermiyor\.?|Uygulanabilir kural resmî kaynakla desteklendiği için hukuki çerçeve daha güçlüdür\.?|Kullanıcı tarafından bildirilen; bağımsız doğrulanmamış\.?)/gi;

type LegalRenderContext = {
  userStatement?: string;
  allowMandatoryMediation?: boolean;
};

const suppliedFactAliases = [
  [/(?:california|jurisdiction|yargı çevresi|uygulanacak hukuk)/i, /(?:california|jurisdiction|yargı çevresi|uygulanacak hukuk)/i],
  [/(?:four years|4 years|dört yıl|4 yıl)/i, /(?:employment duration|length of employment|service|tenure|çalışma süresi|kıdem)/i],
  [/(?:poor performance|performance grounds|düşük performans|performans nedeniyle)/i, /(?:termination reason|dismissal reason|performance|fesih nedeni)/i],
  [/(?:no written warning|written warning|yazılı uyarı)/i, /(?:warning|written warning|uyarı)/i],
  [/(?:no opportunity to respond|opportunity to respond|defen[cs]e|savunma)/i, /(?:response|defen[cs]e|savunma)/i],
  [/(?:unpaid final salary|unpaid salary|unpaid wages|ödenmeyen son ücret|ödenmemiş maaş)/i, /(?:salary|wages|final pay|ücret|maaş)/i],
  [/(?:unused vacation|unused annual leave|kullanılmayan yıllık izin)/i, /(?:vacation|annual leave|izin)/i],
  [/(?:stock options?|vesting|hisse opsiyon|hak ediş)/i, /(?:stock options?|vesting|equity|hisse opsiyon|hak ediş)/i],
] as const;

function contradictsSuppliedFact(line: string, userStatement = "") {
  if (!/(?:not supplied|not provided|was not stated|is missing|has not been supplied|sunulmadı|belirtilmedi|paylaşılmadı|eksik)/i.test(line)) {
    return false;
  }

  return suppliedFactAliases.some(
    ([statementPattern, linePattern]) =>
      statementPattern.test(userStatement) && linePattern.test(line)
  );
}

function cleanLegalRenderedText(value: string, context: LegalRenderContext = {}) {
  const seen = new Set<string>();
  return value
    .replace(internalMetadataPattern, "")
    .replace(repeatedTemplatePattern, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const normalized = line.replace(/^[-*•]\s*/, "").trim();
      if (!normalized) return true;
      if (businessArtifactPattern.test(normalized)) return false;
      if (contradictsSuppliedFact(normalized, context.userStatement)) return false;
      if (
        !context.allowMandatoryMediation &&
        /(?:mandatory mediation|compulsory mediation|zorunlu arabuluculuk)/i.test(normalized)
      ) {
        return false;
      }
      if (/^(?:URL:\s*)?(?:Not provided|Validation required|Unknown)$/i.test(normalized)) {
        return false;
      }
      const key = normalized.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinUniqueSections(
  values: Array<string | undefined>,
  context: LegalRenderContext = {}
) {
  const seen = new Set<string>();
  return values
    .map((value) => cleanLegalRenderedText(value || "", context))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

function splitSourcesAndMethodology(content: string) {
  const match = content.match(/(?:^|\n)(Metodoloji|Methodology)\s*\n/i);
  if (!match || match.index === undefined) {
    return {
      sources: cleanLegalRenderedText(content, { allowMandatoryMediation: true }),
      methodology: "",
    };
  }
  return {
    sources: cleanLegalRenderedText(content.slice(0, match.index), {
      allowMandatoryMediation: true,
    }),
    methodology: cleanLegalRenderedText(
      content.slice(match.index + match[0].length),
      { allowMandatoryMediation: true }
    ),
  };
}

export function isLegalRenderableReport(report: LegalRenderableReport) {
  if (report.type === "Real Estate Investment Analysis") return false;
  // Market Intelligence gets the same explicit, unconditional exemption as
  // Real Estate above. Without it, this function's report.type !== "Strategic
  // Report" gate is the ONLY thing standing between a correctly-generated,
  // correctly-typed Market Analysis report and misclassification as legal:
  // the broad legalSignalPattern below matches the bare word "contract",
  // which any market report about a contract-management/CLM/legal-tech
  // *product* will legitimately use throughout. Confirmed live: a Market
  // Intelligence report on an AI-native contract lifecycle management
  // platform was exported as a "Legal Assessment Report" containing only a
  // Material Facts section. report.type should always be "Market Analysis"
  // for a correctly-routed Market Intelligence report, but this check makes
  // that guarantee explicit and type-based -- identical in spirit to the
  // Real Estate line above -- rather than depending on the "Strategic
  // Report" gate alone to indirectly exclude it.
  if (report.type === "Market Analysis") return false;
  const fieldText = report.sections
    .filter((section) =>
      [
        "subjectIdentification",
        "domainFindings",
        "regulatoryCompliance",
        "finalRecommendation",
      ].includes(section.field || "")
    )
    .map((section) => section.content)
    .join(" ");
  const reportText = `${report.title} ${report.prompt} ${fieldText}`;
  if (report.type !== "Strategic Report" && !legalCaseSignalPattern.test(reportText)) {
    return false;
  }
  return legalSignalPattern.test(reportText);
}

export function buildLegalReportSections(
  sections: LegalReportSection[],
  locale: PdfLocale,
  userStatement = ""
) {
  const byField = new Map(
    sections.map((section) => [section.field || section.title, section.content])
  );
  const sourceParts = splitSourcesAndMethodology(byField.get("sources") || "");
  const hasMediationSource =
    /(?:mandatory mediation|compulsory mediation|zorunlu arabuluculuk)/i.test(sourceParts.sources) &&
    /https?:\/\/[^\s)]+/i.test(sourceParts.sources);
  const renderContext: LegalRenderContext = {
    userStatement,
    allowMandatoryMediation: hasMediationSource,
  };
  const labels = legalRenderCopy[locale];
  const userStatementBlock = userStatement.trim()
    ? `${labels.statement}:\n${userStatement.trim()}`
    : "";
  const mapped: LegalReportSection[] = [
    {
      field: "legalExecutiveAssessment",
      title: labels.executive,
      content: joinUniqueSections([
        byField.get("subjectIdentification"),
        byField.get("decisionAssessment"),
      ], renderContext),
    },
    {
      field: "legalMaterialFacts",
      title: labels.facts,
      content: joinUniqueSections(
        [userStatementBlock, byField.get("extractedFacts")],
        renderContext
      ),
    },
    {
      field: "legalClaimAnalysis",
      title: labels.claims,
      content: joinUniqueSections([
        byField.get("domainFindings"),
        byField.get("financialImplications"),
      ], renderContext),
    },
    {
      field: "legalEvidenceAssessment",
      title: labels.evidence,
      content: joinUniqueSections([byField.get("externalEvidence")], renderContext),
    },
    {
      field: "legalProceduralRisks",
      title: labels.procedure,
      content: joinUniqueSections([
        byField.get("regulatoryCompliance"),
        byField.get("riskAnalysis"),
      ], renderContext),
    },
    {
      field: "legalCounterarguments",
      title: labels.counterarguments,
      content: joinUniqueSections([byField.get("operationalImplications")], renderContext),
    },
    {
      field: "legalMissingEvidence",
      title: labels.missing,
      content: joinUniqueSections([byField.get("missingInformation")], renderContext),
    },
    {
      field: "legalImmediateActions",
      title: labels.actions,
      content: joinUniqueSections([byField.get("recommendedActions")], renderContext),
    },
    {
      field: "legalFinalRecommendation",
      title: labels.recommendation,
      content: joinUniqueSections([
        byField.get("finalRecommendation"),
        byField.get("scenarioAnalysis"),
      ], renderContext),
    },
    {
      field: "legalSources",
      title: labels.sources,
      content: formatLegalSourceContent(sourceParts.sources, locale),
    },
    {
      field: "legalMethodology",
      title: labels.methodology,
      content: cleanLegalRenderedText(sourceParts.methodology, renderContext),
    },
  ];

  return mapped.filter((section) => section.content.trim());
}

function readSourceField(block: string, labels: string[]) {
  for (const label of labels) {
    const match = block.match(new RegExp(`^\\s*(?:[-*•]\\s*)?${label}\\s*:\\s*(.+)$`, "im"));
    if (match?.[1]?.trim()) return cleanLegalRenderedText(match[1]);
  }
  return "";
}

function validSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function formatLegalSourceContent(content: string, locale: PdfLocale) {
  const labels = legalRenderCopy[locale];
  const sources = content
    .split(/\n(?:\s*\n)?(?=\s*•)/)
    .map((block) => {
      const title = readSourceField(block, [
        "Resmî başlık",
        "Resmi başlık",
        "Kaynak başlığı",
        "Official title",
        "Source title",
        "Title",
      ]);
      const publisher = readSourceField(block, [
        "Yayınlayan",
        "Kurum",
        "Publisher",
        "Institution",
        "Organization",
      ]);
      const url = validSourceUrl(readSourceField(block, ["URL"]));
      const accessDate = readSourceField(block, ["Erişim tarihi", "Access date", "Accessed"]);
      const sourceType = readSourceField(block, ["Kaynak türü", "Source type"]);
      if (
        !title ||
        !publisher ||
        !url ||
        /^(?:not provided|validation required|unknown)$/i.test(title) ||
        /^(?:not provided|validation required|unknown)$/i.test(publisher)
      ) return "";
      const lines = [
        `• ${title}`,
        `  ${labels.publisher}: ${publisher}`,
        `  URL: ${url}`,
        accessDate && `  ${labels.accessDate}: ${accessDate}`,
        sourceType && `  ${labels.sourceType}: ${sourceType}`,
      ];
      return lines.filter(Boolean).join("\n");
    })
    .filter(Boolean);

  return sources.join("\n\n");
}
import type { PdfLocale } from "@/app/lib/pdf-engine/core";
