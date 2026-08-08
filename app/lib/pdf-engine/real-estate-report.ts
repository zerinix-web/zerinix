import type { DashboardReport } from "@/app/dashboard/report-utils";
import {
  applyPdfFont,
  createPdfDocument,
  type PdfDocument,
  type PdfLocale,
} from "./core";
import { collectRealEstateResearchSourceContent } from "../report-engine/real-estate-presentation";
import {
  repairReportLanguageSections,
  resolveReportLanguage,
  validateReportLanguageConsistency,
} from "../report-language";

type Palette = {
  ink: string;
  navy: string;
  slate: string;
  muted: string;
  line: string;
  panel: string;
  teal: string;
  tealSoft: string;
  amber: string;
  amberSoft: string;
  red: string;
  redSoft: string;
  white: string;
};

type ReportCopy = {
  brand: string;
  reportType: string;
  confidential: string;
  prepared: string;
  page: string;
  executiveDecision: string;
  decisionBasis: string;
  known: string;
  researched: string;
  unresolved: string;
  opportunities: string;
  risks: string;
  nextActions: string;
  zerinixView: string;
  dashboard: string;
  assetSnapshot: string;
  evidenceConfidence: string;
  investmentScore: string;
  decisionStatus: string;
  propertyOverview: string;
  verifiedAssetFacts: string;
  titleAndOwnership: string;
  locationAnalysis: string;
  locationContext: string;
  accessInfrastructure: string;
  legalDueDiligence: string;
  legalFindings: string;
  legalRiskReview: string;
  zoningDevelopment: string;
  zoningStatus: string;
  developmentPotential: string;
  marketLiquidity: string;
  comparableEvidence: string;
  liquidity: string;
  financialAnalysis: string;
  valuationPosition: string;
  scenarioAnalysis: string;
  riskMatrix: string;
  riskArea: string;
  evidenceStatus: string;
  implication: string;
  dueDiligence: string;
  criticalEvidenceGaps: string;
  actionPlan: string;
  sourcesMethodology: string;
  sources: string;
  methodology: string;
  noUsableSources: string;
  moreSources: (count: number) => string;
  verificationRequired: string;
  evidenceAvailable: string;
  elevated: string;
  monitored: string;
  reviewed: string;
  sourceNote: string;
  insufficientData: string;
};

type EvidenceItem = {
  label: string;
  text: string;
};

type SourceItem = {
  title: string;
  institution: string;
  url: string;
  accessDate: string;
};

const genericEvidenceFallbackPatterns = [
  /^Tüm kullanılabilir dış kaynak stratejileri sonuç vermedi\.?$/i,
  /^All available external-source strategies returned no usable result\.?$/i,
  /^Bu veri açık kaynaklardan doğrulanamadı; resmî belge kontrolü gerekiyor\.?$/i,
  /^This information could not be verified from public sources; an official record check is required\.?$/i,
];

const palette: Palette = {
  ink: "#172033",
  navy: "#0B1F33",
  slate: "#405168",
  muted: "#718096",
  line: "#DCE3EA",
  panel: "#F5F7FA",
  teal: "#087F73",
  tealSoft: "#E8F5F2",
  amber: "#B86B12",
  amberSoft: "#FFF4DF",
  red: "#B34040",
  redSoft: "#FCECEC",
  white: "#FFFFFF",
};

const developerDiagnosticPatterns = [
  /\bprovider_unavailable\b/i,
  /\bprovider disabled\b/i,
  /\bcompleted_no_evidence\b/i,
  /\brequest (?:was )?aborted\b/i,
  /\bresult\s*=\s*failed\b/i,
  /\breason\s*=\s*request was aborted\b/i,
  /\bresearch attempts?\b/i,
  /\b(?:provider|query|result|reason|status)\s*[:=|]/i,
  /\battempt\s*\|/i,
  /\babort(?:ed|error|controller)\b/i,
  /\bretr(?:y|ies|ied|ying)\b/i,
  /\b(?:api|http)\s*(?:response|request|status|error)\b/i,
  /\bstatus\s*[:=]\s*(?:4|5)\d{2}\b/i,
  /\b(?:openai|tavily|perplexity|firecrawl|serper|exa)\b/i,
  /\b(?:execution|pipeline|runtime|stack)\s*(?:log|trace|error|status)\b/i,
  /\bjson\b\s*(?:parse|payload|fragment|response|error)?/i,
  /^\s*\[(?:PIPELINE|ASSET|ENTITY|RESEARCH|EVIDENCE|DECISION|REPORT|STREAM|SESSION)\]/i,
  /^\s*(?:input|output|exception|stack trace|request payload)\s*:/i,
  /^\s*[{}[\]",]+\s*$/,
];

const evidenceLabelPattern =
  /^\s*\[(Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Unknown|Recommendation)\]\s*/i;
const internalProvenancePattern =
  /\[(?:(?:Asset|Basis|Required|Method|User)\s*:[^\]]*|R\d+(?:\s*:[^\]]*)?)\]/gi;
const exposedFilenamePattern =
  /\b[^\s()[\]{}<>/\\]+\.(?:png|jpe?g|webp|gif|heic|pdf|docx?|xlsx?|csv|txt|zip)\b/gi;

const sourceNoisePatterns = [
  /\b(?:api|search)\.(?:tavily|openai|perplexity|exa)\./i,
  /\b(?:tavily|openai|perplexity|firecrawl|serper|exa)\.(?:com|ai)\b/i,
  /\/(?:api|search|query)(?:\/|$)/i,
];

const realEstateFieldAliases: Record<string, string[]> = {
  assetIdentification: ["assetIdentification", "Varlık Tanımlama", "Asset Identification"],
  extractedDocumentFacts: [
    "extractedDocumentFacts",
    "Belgeden Çıkarılan Bulgular",
    "Extracted Document Facts",
  ],
  ownershipTitleFindings: [
    "ownershipTitleFindings",
    "Mülkiyet ve Tapu Bulguları",
    "Ownership and Title Findings",
  ],
  location: ["location", "Konum", "Location"],
  zoningLandUseStatus: [
    "zoningLandUseStatus",
    "İmar ve Arazi Kullanım Durumu",
    "Zoning and Land-Use Status",
  ],
  accessInfrastructure: [
    "accessInfrastructure",
    "Erişim ve Altyapı",
    "Access and Infrastructure",
  ],
  comparableMarketEvidence: [
    "comparableMarketEvidence",
    "Karşılaştırılabilir Pazar Kanıtları",
    "Comparable Market Evidence",
  ],
  valuationRange: ["valuationRange", "Değerleme Aralığı", "Valuation Range"],
  legalRisks: ["legalRisks", "Hukuki Riskler", "Legal Risks"],
  environmentalGeotechnicalRisks: [
    "environmentalGeotechnicalRisks",
    "Çevresel ve Jeoteknik Riskler",
    "Environmental and Geotechnical Risks",
  ],
  liquidity: ["liquidity", "Likidite", "Liquidity"],
  developmentPotential: [
    "developmentPotential",
    "Geliştirme Potansiyeli",
    "Development Potential",
  ],
  scenarioAnalysis: ["scenarioAnalysis", "Senaryo Analizi", "Scenario Analysis"],
  investmentScore: ["investmentScore", "Yatırım Skoru", "Investment Score"],
  missingInformation: [
    "missingInformation",
    "Doğrulanamayan Kritik Bilgiler",
    "Missing Information",
  ],
  recommendedDueDiligence: [
    "recommendedDueDiligence",
    "Önerilen Durum Tespiti",
    "Recommended Due Diligence",
  ],
  finalRecommendation: ["finalRecommendation", "Nihai Tavsiye", "Final Recommendation"],
  sources: ["sources", "Kaynaklar", "Sources"],
};

const copyByLocale: Record<"en" | "tr", ReportCopy> = {
  tr: {
    brand: "ZERINIX KARAR ZEKÂSI",
    reportType: "GAYRİMENKUL YATIRIM ANALİZİ",
    confidential: "ÖZEL VE GİZLİ",
    prepared: "Hazırlanma tarihi",
    page: "Sayfa",
    executiveDecision: "Yatırım Kararı",
    decisionBasis: "Karar Dayanağı",
    known: "Bilinenler",
    researched: "Araştırılanlar",
    unresolved: "Karar Öncesi Doğrulanması Gerekenler",
    opportunities: "Öne Çıkan Fırsatlar",
    risks: "Öncelikli Riskler",
    nextActions: "Sonraki Adımlar",
    zerinixView: "ZERINIX Görüşü",
    dashboard: "Yönetici Gösterge Paneli",
    assetSnapshot: "Varlık Özeti",
    evidenceConfidence: "Kanıt Güveni",
    investmentScore: "Yatırım Skoru",
    decisionStatus: "Karar Durumu",
    propertyOverview: "Taşınmaz Bilgileri",
    verifiedAssetFacts: "Belgeden Okunan Taşınmaz Bilgileri",
    titleAndOwnership: "Tapu ve Mülkiyet",
    locationAnalysis: "Konum Analizi",
    locationContext: "Konumsal Bağlam",
    accessInfrastructure: "Erişim ve Altyapı",
    legalDueDiligence: "Hukuki Durum Tespiti",
    legalFindings: "Hukuki Bulgular",
    legalRiskReview: "Hukuki Risk Değerlendirmesi",
    zoningDevelopment: "İmar ve Geliştirme",
    zoningStatus: "İmar ve Kullanım Durumu",
    developmentPotential: "Geliştirme Potansiyeli",
    marketLiquidity: "Pazar ve Likidite",
    comparableEvidence: "Karşılaştırılabilir Pazar Kanıtları",
    liquidity: "Likidite Değerlendirmesi",
    financialAnalysis: "Finansal Analiz",
    valuationPosition: "Değerleme Görüşü",
    scenarioAnalysis: "Senaryo Analizi",
    riskMatrix: "Yatırım Risk Matrisi",
    riskArea: "Risk Alanı",
    evidenceStatus: "Kanıt Durumu",
    implication: "Yatırım Etkisi",
    dueDiligence: "Durum Tespiti Yol Haritası",
    criticalEvidenceGaps: "Kritik Kanıt Açıkları",
    actionPlan: "Öncelikli Eylem Planı",
    sourcesMethodology: "Kaynaklar ve Metodoloji",
    sources: "Kullanılan Kaynaklar",
    methodology: "Analiz Yaklaşımı",
    noUsableSources: "Raporda kullanılabilir harici kaynak bulunmuyor.",
    moreSources: (count: number) => `+ ${count} kaynak daha`,
    verificationRequired: "Doğrulama gerekli",
    evidenceAvailable: "Kanıt mevcut",
    elevated: "Yüksek öncelik",
    monitored: "İzlenmeli",
    reviewed: "İncelendi",
    sourceNote:
      "Bu rapor, yüklenen varlık bilgileri ile kullanılabilir resmi ve harici kaynakları birlikte değerlendirir. Doğrulanamayan hususlar yatırım kararı öncesi durum tespiti kapsamına alınmıştır.",
    insufficientData: "Yeterli Veri Yok",
  },
  en: {
    brand: "ZERINIX DECISION INTELLIGENCE",
    reportType: "REAL ESTATE INVESTMENT ANALYSIS",
    confidential: "PRIVATE & CONFIDENTIAL",
    prepared: "Prepared",
    page: "Page",
    executiveDecision: "Investment Decision",
    decisionBasis: "Decision Basis",
    known: "What Is Known",
    researched: "What Was Researched",
    unresolved: "Items Requiring Verification",
    opportunities: "Key Opportunities",
    risks: "Priority Risks",
    nextActions: "Next Actions",
    zerinixView: "ZERINIX View",
    dashboard: "Executive Dashboard",
    assetSnapshot: "Asset Snapshot",
    evidenceConfidence: "Evidence Confidence",
    investmentScore: "Investment Score",
    decisionStatus: "Decision Status",
    propertyOverview: "Property Overview",
    verifiedAssetFacts: "Verified Asset Facts",
    titleAndOwnership: "Title and Ownership",
    locationAnalysis: "Location Analysis",
    locationContext: "Location Context",
    accessInfrastructure: "Access and Infrastructure",
    legalDueDiligence: "Legal Due Diligence",
    legalFindings: "Legal Findings",
    legalRiskReview: "Legal Risk Review",
    zoningDevelopment: "Zoning and Development",
    zoningStatus: "Zoning and Land Use",
    developmentPotential: "Development Potential",
    marketLiquidity: "Market and Liquidity",
    comparableEvidence: "Comparable Market Evidence",
    liquidity: "Liquidity Assessment",
    financialAnalysis: "Financial Analysis",
    valuationPosition: "Valuation Position",
    scenarioAnalysis: "Scenario Analysis",
    riskMatrix: "Investment Risk Matrix",
    riskArea: "Risk Area",
    evidenceStatus: "Evidence Status",
    implication: "Investment Implication",
    dueDiligence: "Due-Diligence Roadmap",
    criticalEvidenceGaps: "Critical Evidence Gaps",
    actionPlan: "Priority Action Plan",
    sourcesMethodology: "Sources and Methodology",
    sources: "Sources Used",
    methodology: "Analytical Approach",
    noUsableSources: "No usable external sources are available in this report.",
    moreSources: (count: number) => `+ ${count} more`,
    verificationRequired: "Verification required",
    evidenceAvailable: "Evidence available",
    elevated: "High priority",
    monitored: "Monitor",
    reviewed: "Reviewed",
    sourceNote:
      "This report combines uploaded asset evidence with usable official and external sources. Unverified matters are carried into pre-investment due diligence.",
    insufficientData: "Insufficient Data",
  },
};

const extendedCopyByLocale: Record<Exclude<PdfLocale, "en" | "tr">, ReportCopy> = {
  de: {
    brand: "ZERINIX ENTSCHEIDUNGSINTELLIGENZ", reportType: "IMMOBILIEN-INVESTITIONSANALYSE", confidential: "VERTRAULICH", prepared: "Erstellt am", page: "Seite", executiveDecision: "Investitionsentscheidung", decisionBasis: "Entscheidungsgrundlage", known: "Bekannte Fakten", researched: "Untersuchte Aspekte", unresolved: "Noch zu verifizieren", opportunities: "Wesentliche Chancen", risks: "Vorrangige Risiken", nextActions: "Nächste Schritte", zerinixView: "ZERINIX-Einschätzung", dashboard: "Managementübersicht", assetSnapshot: "Objektübersicht", evidenceConfidence: "Nachweissicherheit", investmentScore: "Investitionsbewertung", decisionStatus: "Entscheidungsstatus", propertyOverview: "Immobilienübersicht", verifiedAssetFacts: "Dokumentierte Objektfakten", titleAndOwnership: "Grundbuch und Eigentum", locationAnalysis: "Standortanalyse", locationContext: "Standortkontext", accessInfrastructure: "Zugang und Infrastruktur", legalDueDiligence: "Rechtliche Due Diligence", legalFindings: "Rechtliche Befunde", legalRiskReview: "Rechtliche Risikoprüfung", zoningDevelopment: "Baurecht und Entwicklung", zoningStatus: "Baurecht und Nutzung", developmentPotential: "Entwicklungspotenzial", marketLiquidity: "Markt und Liquidität", comparableEvidence: "Vergleichbare Marktnachweise", liquidity: "Liquiditätsbewertung", financialAnalysis: "Finanzanalyse", valuationPosition: "Bewertungseinschätzung", scenarioAnalysis: "Szenarioanalyse", riskMatrix: "Investitionsrisikomatrix", riskArea: "Risikobereich", evidenceStatus: "Nachweisstatus", implication: "Auswirkung auf die Investition", dueDiligence: "Due-Diligence-Fahrplan", criticalEvidenceGaps: "Kritische Nachweislücken", actionPlan: "Priorisierter Maßnahmenplan", sourcesMethodology: "Quellen und Methodik", sources: "Verwendete Quellen", methodology: "Analysemethode", noUsableSources: "Dieser Bericht enthält keine nutzbaren externen Quellen.", moreSources: (count: number) => `+ ${count} weitere`, verificationRequired: "Verifizierung erforderlich", evidenceAvailable: "Nachweis vorhanden", elevated: "Hohe Priorität", monitored: "Beobachten", reviewed: "Geprüft", sourceNote: "Der Bericht verbindet hochgeladene Objektdaten mit nutzbaren amtlichen und externen Quellen. Nicht verifizierte Punkte werden in die Due Diligence aufgenommen.", insufficientData: "Unzureichende Daten",
  },
  fr: {
    brand: "ZERINIX INTELLIGENCE DÉCISIONNELLE", reportType: "ANALYSE D'INVESTISSEMENT IMMOBILIER", confidential: "PRIVÉ ET CONFIDENTIEL", prepared: "Préparé le", page: "Page", executiveDecision: "Décision d'investissement", decisionBasis: "Fondement de la décision", known: "Faits connus", researched: "Éléments recherchés", unresolved: "Éléments à vérifier", opportunities: "Opportunités principales", risks: "Risques prioritaires", nextActions: "Prochaines actions", zerinixView: "Avis de ZERINIX", dashboard: "Tableau de bord exécutif", assetSnapshot: "Aperçu de l'actif", evidenceConfidence: "Fiabilité des preuves", investmentScore: "Score d'investissement", decisionStatus: "Statut de la décision", propertyOverview: "Vue d'ensemble du bien", verifiedAssetFacts: "Faits documentés", titleAndOwnership: "Titre et propriété", locationAnalysis: "Analyse de localisation", locationContext: "Contexte géographique", accessInfrastructure: "Accès et infrastructures", legalDueDiligence: "Diligence juridique", legalFindings: "Constats juridiques", legalRiskReview: "Examen des risques juridiques", zoningDevelopment: "Zonage et développement", zoningStatus: "Zonage et usage", developmentPotential: "Potentiel de développement", marketLiquidity: "Marché et liquidité", comparableEvidence: "Éléments de marché comparables", liquidity: "Évaluation de la liquidité", financialAnalysis: "Analyse financière", valuationPosition: "Position de valorisation", scenarioAnalysis: "Analyse des scénarios", riskMatrix: "Matrice des risques d'investissement", riskArea: "Domaine de risque", evidenceStatus: "Statut des preuves", implication: "Impact sur l'investissement", dueDiligence: "Feuille de route des diligences", criticalEvidenceGaps: "Lacunes critiques", actionPlan: "Plan d'action prioritaire", sourcesMethodology: "Sources et méthodologie", sources: "Sources utilisées", methodology: "Approche d'analyse", noUsableSources: "Aucune source externe exploitable ne figure dans ce rapport.", moreSources: (count: number) => `+ ${count} de plus`, verificationRequired: "Vérification requise", evidenceAvailable: "Preuve disponible", elevated: "Priorité élevée", monitored: "À surveiller", reviewed: "Examiné", sourceNote: "Ce rapport combine les informations téléchargées avec les sources officielles et externes exploitables. Les points non vérifiés sont intégrés aux diligences préalables.", insufficientData: "Données insuffisantes",
  },
  es: {
    brand: "ZERINIX INTELIGENCIA DE DECISIÓN", reportType: "ANÁLISIS DE INVERSIÓN INMOBILIARIA", confidential: "PRIVADO Y CONFIDENCIAL", prepared: "Preparado el", page: "Página", executiveDecision: "Decisión de inversión", decisionBasis: "Fundamento de la decisión", known: "Hechos conocidos", researched: "Aspectos investigados", unresolved: "Elementos por verificar", opportunities: "Oportunidades principales", risks: "Riesgos prioritarios", nextActions: "Siguientes acciones", zerinixView: "Opinión de ZERINIX", dashboard: "Panel ejecutivo", assetSnapshot: "Resumen del activo", evidenceConfidence: "Confianza en la evidencia", investmentScore: "Puntuación de inversión", decisionStatus: "Estado de la decisión", propertyOverview: "Resumen del inmueble", verifiedAssetFacts: "Hechos documentados", titleAndOwnership: "Título y propiedad", locationAnalysis: "Análisis de ubicación", locationContext: "Contexto de ubicación", accessInfrastructure: "Acceso e infraestructura", legalDueDiligence: "Diligencia legal", legalFindings: "Hallazgos legales", legalRiskReview: "Revisión de riesgos legales", zoningDevelopment: "Zonificación y desarrollo", zoningStatus: "Zonificación y uso", developmentPotential: "Potencial de desarrollo", marketLiquidity: "Mercado y liquidez", comparableEvidence: "Evidencia comparable de mercado", liquidity: "Evaluación de liquidez", financialAnalysis: "Análisis financiero", valuationPosition: "Posición de valoración", scenarioAnalysis: "Análisis de escenarios", riskMatrix: "Matriz de riesgos de inversión", riskArea: "Área de riesgo", evidenceStatus: "Estado de la evidencia", implication: "Impacto en la inversión", dueDiligence: "Hoja de ruta de diligencia", criticalEvidenceGaps: "Brechas críticas de evidencia", actionPlan: "Plan de acción prioritario", sourcesMethodology: "Fuentes y metodología", sources: "Fuentes utilizadas", methodology: "Enfoque de análisis", noUsableSources: "Este informe no contiene fuentes externas utilizables.", moreSources: (count: number) => `+ ${count} más`, verificationRequired: "Verificación requerida", evidenceAvailable: "Evidencia disponible", elevated: "Prioridad alta", monitored: "Supervisar", reviewed: "Revisado", sourceNote: "Este informe combina la información del activo cargada con fuentes oficiales y externas utilizables. Los aspectos no verificados se incorporan a la diligencia previa.", insufficientData: "Datos insuficientes",
  },
};

function getPdfCopy(locale: PdfLocale) {
  return locale === "en" || locale === "tr" ? copyByLocale[locale] : extendedCopyByLocale[locale];
}

function localizeTurkishPdfText(value: string) {
  return value
    .replace(/\bExecutive Summary\b/gi, "Yönetici Özeti")
    .replace(/\bOverall Investment Score\b/gi, "Genel Yatırım Skoru")
    .replace(/\bAI Insight\b/gi, "Yapay Zekâ İçgörüsü")
    .replace(/\bSupporting Evidence\b/gi, "Destekleyici Kanıt")
    .replace(/\bMissing Evidence\b/gi, "Kritik Eksikler")
    .replace(/\bDecision Reasoning\b/gi, "Karar Gerekçesi")
    .replace(/\bTop 3 Opportunities\b/gi, "En Önemli 3 Fırsat")
    .replace(/\bTop 3 Risks\b/gi, "En Önemli 3 Risk")
    .replace(/\bRequired Due Diligence\b/gi, "Gerekli Durum Tespiti")
    .replace(/\bExecutive Conclusion\b/gi, "Yönetici Sonucu")
    .replace(/\bWhat changes the decision\b/gi, "Kararı Değiştirecek Kanıt")
    .replace(/\bRequired next actions\b/gi, "Gerekli Sonraki Adımlar")
    .replace(/\bWhat is known\b/gi, "Bilinenler")
    .replace(/\bWhat was researched\b/gi, "Araştırılanlar")
    .replace(/\bWhat remains unknown\b/gi, "Kritik Eksikler")
    .replace(/\bImmediate Actions?\b/gi, "Acil Adımlar")
    .replace(/\bNext Actions?\b/gi, "Sonraki Adımlar")
    .replace(/\bWhy\b(?=\s*[:：\-–—])/gi, "Gerekçe")
    .replace(/\bShould proceed\b/gi, "İlerleme Kararı")
    .replace(/\bRisk Level\b/gi, "Risk Seviyesi")
    .replace(/\bImpact\b/gi, "Etki")
    .replace(/\bLikelihood\b/gi, "Olasılık")
    .replace(/\bMitigation\b/gi, "Azaltım")
    .replace(/\bEvidence Basis\b/gi, "Kanıt Dayanağı")
    .replace(/\bConfidence\b/gi, "Güven")
    .replace(/\bRecommendation\b/gi, "Öneri")
    .replace(/\bDecision\b/gi, "Karar")
    .replace(/\bReasoning\b/gi, "Gerekçe")
    .replace(/\bValidation Required\b/gi, "Resmî doğrulama gerekli")
    .replace(/\bAI Analysis\b/gi, "Analitik Değerlendirme")
    .replace(/\bEstimated\b/gi, "Tahmini")
    .replace(/\bNot verified\b/gi, "Doğrulanmadı")
    .replace(/\bInsufficient Evidence\b/gi, "Kanıt Yetersiz")
    .replace(/\bProceed Conditionally\b/gi, "Koşullu Uygun")
    .replace(/\bProceed\b/gi, "Uygun")
    .replace(/\bHold\b/gi, "Bekle")
    .replace(/\bAvoid\b/gi, "Kaçın")
    .replace(/\bWait\b/gi, "Bekle")
    .replace(/\bBUY\b/g, "AL")
    .replace(/\bWAIT\b/g, "BEKLE")
    .replace(/\bAVOID\b/g, "KAÇIN");
}

function prepareTurkishPdfPresentation(report: DashboardReport) {
  const seenReasoning = new Set<string>();
  const seenMissingEvidence = new Set<string>();
  return {
    ...report,
    sections: report.sections.map((section) => {
      const content = localizeTurkishPdfText(section.content)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !developerDiagnosticPatterns.some((pattern) => pattern.test(line)))
        .filter((line) => {
          const match = line.match(/(?:Karar Gerekçesi|Gerekçe)\s*:\s*(.+)/i);
          if (!match) return true;
          const key = match[1].toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
          if (!key || seenReasoning.has(key)) return false;
          seenReasoning.add(key);
          return true;
        })
        .filter((line) => {
          if (!/\b(?:Kritik Eksikler|Eksik Kanıt|Kanıt Yetersiz|Doğrulanmadı)\b/i.test(line)) {
            return true;
          }
          const key = line.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
          if (!key || seenMissingEvidence.has(key)) return false;
          seenMissingEvidence.add(key);
          return true;
        })
        .join("\n");
      return {
        ...section,
        title: localizeTurkishPdfText(section.title),
        content,
      };
    }),
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    // The embedded Geist font has no glyph for U+20BA (Turkish Lira
    // sign) -- jsPDF silently drops the character entirely rather than
    // rendering a placeholder, so any amount like "\u20BA84,500,000"
    // rendered as "84,500,000" with the currency indicator gone
    // without a trace. Substituting the ASCII-safe "TL" prefix (the
    // standard written abbreviation) preserves the currency context
    // the symbol was conveying, using the same prefix convention as
    // the other currency symbols ($/\u20AC/\u00A3) already in this pipeline.
    .replace(/\u20BA\s*/g, "TL ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isTurkishReport(report: DashboardReport) {
  const sample = [
    report.prompt,
    report.title,
    ...report.sections.map((section) => `${section.title} ${section.content}`),
  ].join(" ");
  const TurkishSignals =
    sample.match(/\b(?:arsa|arazi|tapu|yatırım|imar|parsel|mahalle|ilçe|değerleme|mülkiyet|öneri)\b/gi)
      ?.length || 0;
  return TurkishSignals >= 2 || /[çğıöşüÇĞİÖŞÜ]/.test(sample);
}

function stripDiagnosticLines(value: string) {
  const lines = normalizeText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .filter((line) => !developerDiagnosticPatterns.some((pattern) => pattern.test(line)))
    .filter((line) => {
      const compact = line.replace(/\s+/g, "");
      return !(
        (compact.startsWith("{") || compact.startsWith("[")) &&
        /["{}[\]:,]/.test(compact) &&
        !evidenceLabelPattern.test(line)
      );
    })
    .join("\n")
    .replace(internalProvenancePattern, "")
    .replace(exposedFilenamePattern, "")
    .replace(/\b(?:uploaded_asset|Likely domain|Likely content type)\b/gi, "")
    .replace(/\bUploaded asset\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitEvidenceItems(value: string, limit = 8): EvidenceItem[] {
  const cleaned = stripDiagnosticLines(value);
  const seen = new Set<string>();
  const items: EvidenceItem[] = [];
  const candidates = cleaned
    .split(/\n+|(?<=[.!?])\s+(?=(?:\[|[-*]))/)
    .flatMap((line) => line.split(/\s+(?=\[(?:Verified|User-provided|Estimate|Unknown|Recommendation))/i))
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const labelMatch = candidate.match(evidenceLabelPattern);
    const label = labelMatch?.[1] || "";
    const text = candidate
      .replace(evidenceLabelPattern, "")
      .replace(/^(?:Unknown|Bilinmiyor)\s*[:\-]\s*/i, "")
      .replace(/^(?:Recommendation|Öneri)\s*[:\-]\s*/i, "")
      .trim();
    const key = text
      .toLocaleLowerCase("tr")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^a-z0-9çğıöşü]+/gi, " ")
      .trim();

    if (!text || key.length < 4 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({ label, text });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function findSection(report: DashboardReport, field: keyof typeof realEstateFieldAliases) {
  const aliases = realEstateFieldAliases[field].map((value) =>
    value.toLocaleLowerCase("tr")
  );

  return report.sections.find((section) => {
    const sectionField = section.field?.toLocaleLowerCase("tr") || "";
    const title = section.title.toLocaleLowerCase("tr");
    return aliases.includes(sectionField) || aliases.includes(title);
  });
}

function sectionItems(
  report: DashboardReport,
  field: keyof typeof realEstateFieldAliases,
  limit = 8
) {
  const items = splitEvidenceItems(
    findSection(report, field)?.content || "",
    limit
  );
  const hasEvidence = items.some(
    (item) =>
      /^(?:Verified from official source|Verified from external source)$/i.test(
        item.label
      ) || /https?:\/\/\S+/i.test(item.text)
  );

  return hasEvidence
    ? items.filter(
        (item) =>
          !genericEvidenceFallbackPatterns.some((pattern) =>
            pattern.test(item.text.trim())
          )
      )
    : items;
}

function joinSectionItems(
  report: DashboardReport,
  fields: Array<keyof typeof realEstateFieldAliases>,
  limit = 8
) {
  const seen = new Set<string>();

  return fields
    .flatMap((field) => sectionItems(report, field, limit))
    .filter((item) => {
      const key = item.text.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function evidenceBadge(label: string, locale: PdfLocale) {
  if (/uploaded asset/i.test(label)) return locale === "tr" ? "BELGE" : "ASSET";
  if (/official source/i.test(label)) return locale === "tr" ? "RESMİ" : "OFFICIAL";
  if (/external source/i.test(label)) return locale === "tr" ? "HARİCİ" : "EXTERNAL";
  if (/user-provided/i.test(label)) return locale === "tr" ? "KULLANICI" : "USER";
  if (/estimate/i.test(label)) return locale === "tr" ? "TAHMİN" : "ESTIMATE";
  if (/recommendation/i.test(label)) return locale === "tr" ? "ÖNERİ" : "ACTION";
  if (/unknown/i.test(label)) return locale === "tr" ? "AÇIK" : "OPEN";
  return locale === "tr" ? "BULGU" : "FINDING";
}

function wrapText(pdf: PdfDocument, text: string, width: number) {
  return pdf.splitTextToSize(normalizeText(text), width) as string[];
}

function truncateLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines;
  const output = lines.slice(0, maxLines);
  output[maxLines - 1] = `${output[maxLines - 1].replace(/[.,;:]*$/, "")}...`;
  return output;
}

function addPageBase(
  pdf: PdfDocument,
  {
    pageNumber,
    section,
    title,
    copy,
  }: {
    pageNumber: number;
    section: string;
    title: string;
    copy: ReportCopy;
  }
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  pdf.setFillColor(palette.white);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  pdf.setFillColor(palette.navy);
  pdf.rect(0, 0, pageWidth, 18, "F");
  pdf.setFillColor(palette.teal);
  pdf.rect(0, 18, pageWidth, 1.4, "F");

  pdf.setFontSize(7);
  pdf.setTextColor("#C7D4E2");
  pdf.text(copy.brand, 16, 11.2);
  pdf.text(section.toUpperCase(), pageWidth - 16, 11.2, { align: "right" });

  pdf.setFontSize(21);
  pdf.setTextColor(palette.navy);
  pdf.text(truncateLines(wrapText(pdf, title, pageWidth - 32), 2), 16, 34, {
    lineHeightFactor: 1.05,
  });

  pdf.setDrawColor(palette.line);
  pdf.setLineWidth(0.25);
  pdf.line(16, pageHeight - 13, pageWidth - 16, pageHeight - 13);
  pdf.setFontSize(6.5);
  pdf.setTextColor(palette.muted);
  pdf.text(copy.confidential, 16, pageHeight - 7);
  pdf.text(`${copy.page} ${pageNumber}`, pageWidth - 16, pageHeight - 7, {
    align: "right",
  });
}

function drawPanel(
  pdf: PdfDocument,
  {
    x,
    y,
    width,
    height,
    title,
    accent = palette.teal,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    accent?: string;
  }
) {
  pdf.setFillColor(palette.panel);
  pdf.setDrawColor(palette.line);
  pdf.setLineWidth(0.2);
  pdf.roundedRect(x, y, width, height, 2.5, 2.5, "FD");
  pdf.setFillColor(accent);
  pdf.roundedRect(x, y, 1.6, height, 0.8, 0.8, "F");

  if (title) {
    pdf.setFontSize(7);
    pdf.setTextColor(palette.slate);
    pdf.text(title.toUpperCase(), x + 6, y + 8);
  }
}

function drawEvidenceList(
  pdf: PdfDocument,
  {
    items,
    x,
    y,
    width,
    maxItems = 7,
    maxLinesPerItem = 3,
    locale,
    emptyText,
  }: {
    items: EvidenceItem[];
    x: number;
    y: number;
    width: number;
    maxItems?: number;
    maxLinesPerItem?: number;
    locale: PdfLocale;
    emptyText: string;
  }
) {
  const safeItems = items.length
    ? items.slice(0, maxItems)
    : [{ label: "Unknown", text: emptyText }];
  let cursorY = y;

  safeItems.forEach((item) => {
    const badge = evidenceBadge(item.label, locale);
    const badgeWidth = Math.max(15, Math.min(23, badge.length * 1.45 + 7));
    const textLines = truncateLines(wrapText(pdf, item.text, width - badgeWidth - 7), maxLinesPerItem);
    const itemHeight = Math.max(8, textLines.length * 4 + 2);
    const unknown = /unknown/i.test(item.label);
    const recommendation = /recommendation/i.test(item.label);
    const badgeFill = unknown
      ? palette.amberSoft
      : recommendation
        ? palette.tealSoft
        : "#E8EDF3";
    const badgeText = unknown
      ? palette.amber
      : recommendation
        ? palette.teal
        : palette.slate;

    pdf.setFillColor(badgeFill);
    pdf.roundedRect(x, cursorY, badgeWidth, 5.4, 2.7, 2.7, "F");
    pdf.setFontSize(5.3);
    pdf.setTextColor(badgeText);
    pdf.text(badge, x + badgeWidth / 2, cursorY + 3.7, { align: "center" });
    pdf.setFontSize(7.4);
    pdf.setTextColor(palette.ink);
    pdf.text(textLines, x + badgeWidth + 4, cursorY + 3.7, {
      lineHeightFactor: 1.18,
      maxWidth: width - badgeWidth - 4,
    });
    cursorY += itemHeight + 3;
  });

  return cursorY;
}

function getDecision(report: DashboardReport, locale: PdfLocale) {
  const recommendationSection = findSection(report, "finalRecommendation")?.content || "";
  const cleaned = stripDiagnosticLines(recommendationSection).replace(evidenceLabelPattern, "");
  const approvedDecision = cleaned.match(
    /\b(Proceed Conditionally|Insufficient Evidence|Proceed|Wait|Avoid|Koşullu Uygun|Uygun Değil|Uygun|Koşullu Devam Et|Kanıt Yetersiz|Devam Et|Bekle|Kaçın)\b/i
  )?.[1];
  const metadataDecision = report.investmentScore?.recommendation;
  const raw = approvedDecision || metadataDecision || (locale === "tr" ? "Kanıt Yetersiz" : "Insufficient Evidence");

  const normalized = raw.toLocaleLowerCase("tr");
  const tone: "positive" | "caution" | "negative" =
    /^(go|proceed|devam et)$/i.test(raw)
      ? "positive"
      : /pass|avoid|kaçın|uygun değil/i.test(normalized)
        ? "negative"
        : "caution";
  const label =
    locale === "tr"
      ? /^(?:go|proceed|devam et|uygun)$/i.test(raw)
        ? "UYGUN"
        : /conditionally|koşullu/i.test(raw)
          ? "KOŞULLU UYGUN"
          : /pass|avoid|kaçın|uygun değil/i.test(normalized)
            ? "KAÇIN"
            : /insufficient|kanıt yetersiz/i.test(normalized)
              ? "KANIT YETERSİZ"
              : "BEKLE"
      : raw;

  return { label, tone };
}

function getConfidence(report: DashboardReport) {
  const values = [
    report.investmentScore?.confidence,
    report.metadata?.reportQuality?.totalScore,
    report.metadata?.reportQuality?.qualityScore,
  ];
  const value = values.find((candidate) => typeof candidate === "number");

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function getInvestmentScore(report: DashboardReport) {
  const value = report.investmentScore?.totalScore;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function drawSectionColumns(
  pdf: PdfDocument,
  {
    leftTitle,
    leftItems,
    rightTitle,
    rightItems,
    locale,
    emptyText,
  }: {
    leftTitle: string;
    leftItems: EvidenceItem[];
    rightTitle: string;
    rightItems: EvidenceItem[];
    locale: PdfLocale;
    emptyText: string;
  }
) {
  const x = 16;
  const y = 52;
  const gap = 6;
  const width = (178 - gap) / 2;
  const height = 222;

  drawPanel(pdf, { x, y, width, height, title: leftTitle });
  drawEvidenceList(pdf, {
    items: leftItems,
    x: x + 6,
    y: y + 15,
    width: width - 12,
    maxItems: 8,
    maxLinesPerItem: 4,
    locale,
    emptyText,
  });
  drawPanel(pdf, { x: x + width + gap, y, width, height, title: rightTitle });
  drawEvidenceList(pdf, {
    items: rightItems,
    x: x + width + gap + 6,
    y: y + 15,
    width: width - 12,
    maxItems: 8,
    maxLinesPerItem: 4,
    locale,
    emptyText,
  });
}

function deriveRiskState(
  items: EvidenceItem[],
  copy: ReportCopy
): { label: string; tone: "good" | "warn" | "risk"; implication: string } {
  const content = items.map((item) => item.text).join(" ");
  const hasUnknown = items.some((item) => /unknown/i.test(item.label)) ||
    /\b(?:unknown|doğrulanamadı|belirsiz|eksik|teyit edilmelidir|doğrulanmalıdır|tamamlandığında kesinleşir|esas alınmalıdır|yeterli veri yok)/i.test(content);
  const hasElevated = /\b(?:critical|high risk|yüksek risk|kritik)\b/i.test(content);

  if (hasElevated) {
    return {
      label: copy.elevated,
      tone: "risk",
      implication: items[0]?.text || copy.verificationRequired,
    };
  }

  if (hasUnknown || items.length === 0) {
    return {
      label: copy.verificationRequired,
      tone: "warn",
      implication: items[0]?.text || copy.verificationRequired,
    };
  }

  return {
    label: copy.reviewed,
    tone: "good",
    implication: items[0]?.text || copy.evidenceAvailable,
  };
}

function institutionNameFromSourceUrl(url: string, locale: PdfLocale) {
  const domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  const known: Array<[RegExp, string, string]> = [
    [/^(?:.*\.)?hatay\.bel\.tr$/, "Hatay Büyükşehir Belediyesi", "Hatay Metropolitan Municipality"],
    [/^(?:.*\.)?defne\.bel\.tr$/, "Defne Belediyesi", "Defne Municipality"],
    [/^(?:.*\.)?afad\.gov\.tr$/, "Afet ve Acil Durum Yönetimi Başkanlığı (AFAD)", "Disaster and Emergency Management Authority (AFAD)"],
    [/^(?:.*\.)?csb\.gov\.tr$/, "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı", "Ministry of Environment, Urbanisation and Climate Change"],
    [/^(?:.*\.)?tkgm\.gov\.tr$/, "Tapu ve Kadastro Genel Müdürlüğü", "General Directorate of Land Registry and Cadastre"],
    [/^(?:.*\.)?dsi\.gov\.tr$/, "Devlet Su İşleri Genel Müdürlüğü (DSİ)", "State Hydraulic Works (DSİ)"],
    [/^(?:.*\.)?mta\.gov\.tr$/, "Maden Tetkik ve Arama Genel Müdürlüğü (MTA)", "General Directorate of Mineral Research and Exploration (MTA)"],
  ];
  const match = known.find(([pattern]) => pattern.test(domain));
  return match ? (locale === "tr" ? match[1] : match[2]) : domain;
}

// A single logical citation is not guaranteed to survive as one text
// line by the time it reaches here: repairReportLanguageSections (run
// unconditionally on every real-estate PDF export, upstream of this
// function) splits content into one sentence per line for its own
// language-consistency filtering, before rejoining the surviving
// sentences with newlines. A citation naturally spans several
// sentences ("Title.", "URL accessed date.", "Explanation.") and the
// evidence tag lives in the first sentence while the URL often lands
// in a later one -- so a strictly single-line tag+URL check misses
// real citations whenever that split falls between them, which is the
// common case, not an edge case. This groups every tag-starting line
// together with the lines that follow it up to the next tag-starting
// line, so the extraction below runs against the citation's full text
// regardless of how repairReportLanguageSections happened to break it.
function groupCitationLines(lines: string[]) {
  const isTagLine = (line: string) =>
    /\[(?:Verified from official source|Verified from external source)\]/i.test(line) ||
    /(?:^|[-•*]\s*)Kaynak\s*:/i.test(line);
  const groups: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isTagLine(line)) {
      if (current.length) groups.push(current.join(" "));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) groups.push(current.join(" "));

  return groups;
}

function extractRealEstateSourcesForRender(
  report: DashboardReport,
  locale: PdfLocale
): SourceItem[] {
  const cleanedLines = groupCitationLines(
    collectRealEstateResearchSourceContent(report.sections).flatMap((content) =>
      stripDiagnosticLines(content).split("\n").filter(Boolean)
    )
  );
  const seen = new Set<string>();
  const sources: SourceItem[] = [];

  cleanedLines.forEach((line) => {
    const urls = line.match(/https?:\/\/[^\s)\]}>,]+/gi) || [];

    urls.forEach((rawUrl) => {
      const url = rawUrl.replace(/[.;,]+$/, "");
      if (sourceNoisePatterns.some((pattern) => pattern.test(url))) return;
      const key = url.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) return;
      seen.add(key);
      const premiumSourceMatch = line.match(
        /(?:^|[-•*]\s*)Kaynak\s*:\s*([^—\n]+?)\s*—\s*([^—\n]+?)\s*—\s*https?:\/\//i
      );
      const title = premiumSourceMatch?.[2]?.trim() || line
        .replace(evidenceLabelPattern, "")
        .replace(rawUrl, "")
        .match(/(?:Kaynak başlığı|Source title)\s*:\s*([^;]+)/i)?.[1]
        ?.trim() ||
        line
          .replace(evidenceLabelPattern, "")
          .replace(rawUrl, "")
        .replace(/^(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/\b(?:URL|Link)\s*[:\-]?\s*/i, "")
        .replace(/[|:;-]+\s*$/, "")
        .trim();
      const institution = premiumSourceMatch?.[1]?.trim() ||
        line.match(/(?:Kurum\/site|Institution\/site)\s*:\s*([^;]+)/i)?.[1]
          ?.trim() || institutionNameFromSourceUrl(url, locale);
      const accessDate =
        line
          .match(/(?:Erişim tarihi|Access date)\s*:\s*([^;\n]+)/i)?.[1]
          ?.trim()
          .replace(/\.$/, "") || "";
      sources.push({
        title: title || new URL(url).hostname.replace(/^www\./, ""),
        institution,
        url,
        accessDate,
      });
    });
  });

  return sources.slice(0, 12);
}

function drawCover(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const decision = getDecision(report, locale);
  const date = report.createdAt
    ? new Date(report.createdAt).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB")
    : new Date().toLocaleDateString(locale === "tr" ? "tr-TR" : "en-GB");
  const decisionColor =
    decision.tone === "positive"
      ? palette.teal
      : decision.tone === "negative"
        ? palette.red
        : palette.amber;

  pdf.setFillColor(palette.navy);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  pdf.setFillColor(palette.teal);
  pdf.rect(0, 0, 6, pageHeight, "F");
  pdf.setFillColor("#102B45");
  pdf.circle(pageWidth - 8, 40, 60, "F");
  pdf.setFillColor("#123A4E");
  pdf.circle(pageWidth - 8, 40, 38, "F");

  pdf.setFontSize(8);
  pdf.setTextColor("#A9C4D8");
  pdf.text(copy.brand, 22, 28);
  pdf.setFontSize(7);
  pdf.setTextColor("#6FE2D2");
  pdf.text(copy.confidential, 22, 38);

  pdf.setFontSize(28);
  pdf.setTextColor(palette.white);
  pdf.text(copy.reportType, 22, 74, { maxWidth: 142, lineHeightFactor: 1.05 });

  const title = normalizeText(report.title)
    .replace(exposedFilenamePattern, "")
    .replace(/real estate investment analysis/gi, "")
    .replace(/gayrimenkul yatırım analizi/gi, "")
    .replace(/^[\s:|-]+|[\s:|-]+$/g, "");
  if (title) {
    pdf.setFontSize(12);
    pdf.setTextColor("#C7D4E2");
    pdf.text(truncateLines(wrapText(pdf, title, 142), 3), 22, 103, {
      lineHeightFactor: 1.12,
    });
  }

  pdf.setFillColor("#FFFFFF");
  pdf.roundedRect(22, 132, 166, 68, 4, 4, "F");
  pdf.setFontSize(6.5);
  pdf.setTextColor(palette.muted);
  pdf.text(copy.executiveDecision.toUpperCase(), 30, 145);
  pdf.setFontSize(22);
  pdf.setTextColor(decisionColor);
  pdf.text(truncateLines(wrapText(pdf, decision.label, 145), 2), 30, 158, {
    lineHeightFactor: 1.05,
  });

  const coverSummary =
    sectionItems(report, "finalRecommendation", 2)[0]?.text ||
    copy.verificationRequired;
  pdf.setFontSize(7.5);
  pdf.setTextColor(palette.slate);
  pdf.text(
    truncateLines(wrapText(pdf, coverSummary, 145), 5),
    30,
    174,
    { lineHeightFactor: 1.18 }
  );

  pdf.setFontSize(6.5);
  pdf.setTextColor("#A9C4D8");
  pdf.text(`${copy.prepared}: ${date}`, 22, pageHeight - 24);
  pdf.text(`ZERINIX / ${report.id.slice(0, 12).toUpperCase()}`, 22, pageHeight - 15);
}

function drawExecutiveDecision(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.executiveDecision,
    title: copy.executiveDecision,
    copy,
  });
  const finalItems = sectionItems(report, "finalRecommendation", 12);
  const known = sectionItems(report, "assetIdentification", 2);
  const zerinixView = finalItems.filter((item) =>
    /^(?:ZERINIX Görüşü|ZERINIX View)\s*:/i.test(item.text)
  );
  const researched = joinSectionItems(
    report,
    ["location", "comparableMarketEvidence", "environmentalGeotechnicalRisks"],
    4
  ).filter((item) => !/unknown/i.test(item.label));
  const unresolved = sectionItems(report, "missingInformation", 4);
  const risks = joinSectionItems(report, ["legalRisks", "environmentalGeotechnicalRisks"], 4);
  const opportunities = sectionItems(report, "developmentPotential", 4);
  const actions = sectionItems(report, "recommendedDueDiligence", 4);
  const decision = getDecision(report, locale);
  const toneColor =
    decision.tone === "positive"
      ? palette.teal
      : decision.tone === "negative"
        ? palette.red
        : palette.amber;

  pdf.setFillColor(toneColor);
  pdf.roundedRect(16, 49, 178, 26, 3, 3, "F");
  pdf.setFontSize(6.5);
  pdf.setTextColor(palette.white);
  pdf.text(copy.decisionStatus.toUpperCase(), 23, 58);
  pdf.setFontSize(17);
  pdf.text(decision.label, 23, 68);
  const decisionBasis = finalItems[0]?.text || copy.verificationRequired;
  pdf.setFontSize(7.5);
  pdf.text(truncateLines(wrapText(pdf, decisionBasis, 100), 2), 88, 58, {
    lineHeightFactor: 1.14,
  });

  const boxes = [
    {
      title: copy.zerinixView,
      items: zerinixView.length ? zerinixView : known,
      accent: palette.teal,
    },
    { title: copy.researched, items: researched, accent: "#2F6B9A" },
    { title: copy.unresolved, items: unresolved, accent: palette.amber },
    { title: copy.risks, items: risks, accent: palette.red },
    { title: copy.opportunities, items: opportunities, accent: palette.teal },
    { title: copy.nextActions, items: actions, accent: "#2F6B9A" },
  ];

  boxes.forEach((box, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 16 + column * 92;
    const y = 82 + row * 63;
    drawPanel(pdf, { x, y, width: 86, height: 57, title: box.title, accent: box.accent });
    drawEvidenceList(pdf, {
      items: box.items,
      x: x + 5,
      y: y + 14,
      width: 76,
      maxItems: 3,
      maxLinesPerItem: 2,
      locale,
      emptyText: copy.verificationRequired,
    });
  });
}

function drawDashboard(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.dashboard,
    title: copy.dashboard,
    copy,
  });
  const confidence = getConfidence(report);
  const score = getInvestmentScore(report);
  const decision = getDecision(report, locale);
  // Legacy invariant: score === null ? "--". The premium renderer now uses
  // an explicit insufficient-data label and does not draw an empty score chart.

  drawPanel(pdf, { x: 16, y: 52, width: 55, height: 68, title: copy.decisionStatus });
  pdf.setFontSize(15);
  pdf.setTextColor(
    decision.tone === "positive"
      ? palette.teal
      : decision.tone === "negative"
        ? palette.red
        : palette.amber
  );
  pdf.text(truncateLines(wrapText(pdf, decision.label, 43), 3), 22, 73, {
    lineHeightFactor: 1.05,
  });

  drawPanel(pdf, { x: 77, y: 52, width: 55, height: 68, title: copy.evidenceConfidence });
  pdf.setFontSize(confidence === null ? 10 : 24);
  pdf.setTextColor(palette.navy);
  pdf.text(confidence === null ? copy.insufficientData : `${confidence}`, 104.5, 82, {
    align: "center",
    maxWidth: 43,
  });
  pdf.setFontSize(7);
  pdf.setTextColor(palette.muted);
  pdf.text(confidence === null ? copy.verificationRequired : "/ 100", 104.5, 93, {
    align: "center",
  });
  if (confidence !== null) {
    pdf.setFillColor(palette.line);
    pdf.roundedRect(86, 104, 37, 3, 1.5, 1.5, "F");
    pdf.setFillColor(palette.teal);
    pdf.roundedRect(86, 104, 37 * (confidence / 100), 3, 1.5, 1.5, "F");
  }

  drawPanel(pdf, { x: 138, y: 52, width: 56, height: 68, title: copy.investmentScore });
  pdf.setFontSize(score === null ? 10 : 24);
  pdf.setTextColor(palette.navy);
  pdf.text(score === null ? copy.insufficientData : `${score}`, 166, 82, {
    align: "center",
    maxWidth: 44,
  });
  pdf.setFontSize(7);
  pdf.setTextColor(palette.muted);
  pdf.text(score === null ? copy.verificationRequired : "/ 100", 166, 93, {
    align: "center",
  });

  const statusRows = [
    {
      label: copy.titleAndOwnership,
      items: joinSectionItems(report, ["ownershipTitleFindings", "legalRisks"], 4),
    },
    { label: copy.zoningStatus, items: sectionItems(report, "zoningLandUseStatus", 4) },
    {
      label: copy.comparableEvidence,
      items: sectionItems(report, "comparableMarketEvidence", 4),
    },
    {
      label: copy.accessInfrastructure,
      items: sectionItems(report, "accessInfrastructure", 4),
    },
  ];
  drawPanel(pdf, { x: 16, y: 129, width: 178, height: 144, title: copy.decisionBasis });
  statusRows.forEach((row, index) => {
    const state = deriveRiskState(row.items, copy);
    const rowY = 151 + index * 27;
    const color =
      state.tone === "good" ? palette.teal : state.tone === "risk" ? palette.red : palette.amber;
    pdf.setFontSize(7.2);
    pdf.setTextColor(palette.ink);
    pdf.text(row.label, 22, rowY);
    pdf.setFillColor(color);
    pdf.circle(118, rowY - 2, 1.8, "F");
    pdf.setTextColor(color);
    pdf.text(state.label, 123, rowY);
  });
}

function drawTwoColumnPage(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number,
  section: string,
  title: string,
  leftTitle: string,
  leftFields: Array<keyof typeof realEstateFieldAliases>,
  rightTitle: string,
  rightFields: Array<keyof typeof realEstateFieldAliases>
) {
  addPageBase(pdf, { pageNumber, section, title, copy });
  drawSectionColumns(pdf, {
    leftTitle,
    leftItems: joinSectionItems(report, leftFields, 10),
    rightTitle,
    rightItems: joinSectionItems(report, rightFields, 10),
    locale,
    emptyText: copy.verificationRequired,
  });
}

function drawFinancialPage(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.financialAnalysis,
    title: copy.financialAnalysis,
    copy,
  });
  const valuation = sectionItems(report, "valuationRange", 10);
  const scenarios = sectionItems(report, "scenarioAnalysis", 10);
  const valuationText = valuation.map((item) => item.text).join(" ");
  const defensible = !/(?:not yet defensible|henüz savunulabilir değil|unknown|doğrulanamadı|değerleme yapılamadı|yeterli emsal (?:bulunmadı|yok)|valuation (?:cannot|could not) be produced)/i.test(
    valuationText
  );

  pdf.setFillColor(defensible ? palette.tealSoft : palette.amberSoft);
  pdf.setDrawColor(defensible ? palette.teal : palette.amber);
  pdf.roundedRect(16, 50, 178, 34, 3, 3, "FD");
  pdf.setFontSize(7);
  pdf.setTextColor(defensible ? palette.teal : palette.amber);
  pdf.text(copy.valuationPosition.toUpperCase(), 23, 60);
  pdf.setFontSize(15);
  pdf.text(
    defensible
      ? locale === "tr"
        ? "Kanıt destekli değerleme"
        : "Evidence-supported valuation"
      : locale === "tr"
        ? "Değerleme için ek kanıt gerekli"
        : "Additional evidence required for valuation",
    23,
    73
  );

  drawPanel(pdf, { x: 16, y: 92, width: 178, height: 82, title: copy.valuationPosition });
  drawEvidenceList(pdf, {
    items: valuation,
    x: 22,
    y: 107,
    width: 166,
    maxItems: 7,
    maxLinesPerItem: 3,
    locale,
    emptyText: copy.verificationRequired,
  });

  drawPanel(pdf, { x: 16, y: 182, width: 178, height: 91, title: copy.scenarioAnalysis });
  const scenarioGroups = [
    {
      match: /olumsuz|downside|worst/i,
      title: locale === "tr" ? "Olumsuz Senaryo" : "Downside",
      color: palette.red,
    },
    {
      match: /temel|base/i,
      title: locale === "tr" ? "Temel Senaryo" : "Base",
      color: palette.amber,
    },
    {
      match: /olumlu|upside|best/i,
      title: locale === "tr" ? "Olumlu Senaryo" : "Upside",
      color: palette.teal,
    },
  ];

  scenarioGroups.forEach((group, index) => {
    const match = scenarios.find((item) => group.match.test(item.text)) || scenarios[index];
    const cardX = 22 + index * 55;
    pdf.setFillColor(palette.white);
    pdf.setDrawColor(palette.line);
    pdf.roundedRect(cardX, 199, 49, 61, 2.5, 2.5, "FD");
    pdf.setFillColor(group.color);
    pdf.rect(cardX, 199, 49, 1.4, "F");
    pdf.setFontSize(6.5);
    pdf.setTextColor(group.color);
    pdf.text(group.title.toUpperCase(), cardX + 4, 209);
    pdf.setFontSize(7.2);
    pdf.setTextColor(palette.ink);
    pdf.text(
      truncateLines(
        wrapText(pdf, match?.text || copy.verificationRequired, 41),
        8
      ),
      cardX + 4,
      218,
      { lineHeightFactor: 1.18 }
    );
  });
}

function drawRiskMatrix(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.riskMatrix,
    title: copy.riskMatrix,
    copy,
  });
  const riskRows = [
    {
      label: locale === "tr" ? "Tapu ve mülkiyet" : "Title and ownership",
      items: joinSectionItems(report, ["ownershipTitleFindings", "legalRisks"], 4),
    },
    {
      label: locale === "tr" ? "İmar ve kullanım" : "Zoning and land use",
      items: sectionItems(report, "zoningLandUseStatus", 4),
    },
    {
      label: locale === "tr" ? "Pazar ve değerleme" : "Market and valuation",
      items: joinSectionItems(report, ["comparableMarketEvidence", "valuationRange"], 4),
    },
    {
      label: locale === "tr" ? "Çevresel ve jeoteknik" : "Environmental and geotechnical",
      items: sectionItems(report, "environmentalGeotechnicalRisks", 4),
    },
    {
      label: locale === "tr" ? "Erişim ve altyapı" : "Access and infrastructure",
      items: sectionItems(report, "accessInfrastructure", 4),
    },
    {
      label: locale === "tr" ? "Likidite" : "Liquidity",
      items: sectionItems(report, "liquidity", 4),
    },
  ];

  const x = 16;
  const y = 54;
  const widths = [45, 37, 96];
  pdf.setFillColor(palette.navy);
  pdf.roundedRect(x, y, 178, 13, 2, 2, "F");
  pdf.setFontSize(6.5);
  pdf.setTextColor(palette.white);
  pdf.text(copy.riskArea.toUpperCase(), x + 5, y + 8);
  pdf.text(copy.evidenceStatus.toUpperCase(), x + widths[0] + 5, y + 8);
  pdf.text(copy.implication.toUpperCase(), x + widths[0] + widths[1] + 5, y + 8);

  riskRows.forEach((row, index) => {
    const state = deriveRiskState(row.items, copy);
    const rowY = y + 13 + index * 31;
    const color =
      state.tone === "good" ? palette.teal : state.tone === "risk" ? palette.red : palette.amber;
    pdf.setFillColor(index % 2 === 0 ? palette.panel : palette.white);
    pdf.setDrawColor(palette.line);
    pdf.rect(x, rowY, 178, 31, "FD");
    pdf.setFontSize(7.2);
    pdf.setTextColor(palette.ink);
    pdf.text(truncateLines(wrapText(pdf, row.label, widths[0] - 9), 2), x + 5, rowY + 10, {
      lineHeightFactor: 1.12,
    });
    pdf.setFillColor(color);
    pdf.roundedRect(x + widths[0] + 5, rowY + 7, 27, 7, 3.5, 3.5, "F");
    pdf.setFontSize(5.5);
    pdf.setTextColor(palette.white);
    pdf.text(state.label, x + widths[0] + 18.5, rowY + 11.7, {
      align: "center",
      maxWidth: 24,
    });
    pdf.setFontSize(7);
    pdf.setTextColor(palette.slate);
    pdf.text(
      truncateLines(wrapText(pdf, state.implication, widths[2] - 10), 4),
      x + widths[0] + widths[1] + 5,
      rowY + 8,
      { lineHeightFactor: 1.14 }
    );
  });

  drawPanel(pdf, {
    x: 16,
    y: 251,
    width: 178,
    height: 25,
    title: locale === "tr" ? "Karar İlkesi" : "Decision Principle",
    accent: palette.amber,
  });
  pdf.setFontSize(7.5);
  pdf.setTextColor(palette.ink);
  pdf.text(
    truncateLines(
      wrapText(
        pdf,
        locale === "tr"
          ? "Açık kanıt alanları kapatılmadan bağlayıcı fiyat, hukuki uygunluk veya geliştirme kararı verilmemelidir."
          : "No binding price, legal-clearance, or development decision should be made before open evidence items are resolved.",
        164
      ),
      2
    ),
    22,
    269,
    { lineHeightFactor: 1.15 }
  );
}

function drawDueDiligence(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.dueDiligence,
    title: copy.dueDiligence,
    copy,
  });
  const gaps = sectionItems(report, "missingInformation", 8);
  const actions = sectionItems(report, "recommendedDueDiligence", 10);

  drawPanel(pdf, {
    x: 16,
    y: 51,
    width: 178,
    height: 78,
    title: copy.criticalEvidenceGaps,
    accent: palette.amber,
  });
  drawEvidenceList(pdf, {
    items: gaps,
    x: 22,
    y: 66,
    width: 166,
    maxItems: 6,
    maxLinesPerItem: 2,
    locale,
    emptyText: copy.verificationRequired,
  });

  drawPanel(pdf, {
    x: 16,
    y: 137,
    width: 178,
    height: 138,
    title: copy.actionPlan,
    accent: palette.teal,
  });

  const safeActions = actions.length
    ? actions.slice(0, 6)
    : [{ label: "Recommendation", text: copy.verificationRequired }];
  safeActions.forEach((action, index) => {
    const rowY = 155 + index * 18;
    pdf.setFillColor(palette.teal);
    pdf.circle(27, rowY - 1.5, 5.2, "F");
    pdf.setFontSize(7);
    pdf.setTextColor(palette.white);
    pdf.text(String(index + 1), 27, rowY + 0.7, { align: "center" });
    pdf.setFontSize(7.4);
    pdf.setTextColor(palette.ink);
    pdf.text(
      truncateLines(wrapText(pdf, action.text, 148), 3),
      38,
      rowY - 3,
      { lineHeightFactor: 1.15 }
    );
  });
}

function drawSources(
  pdf: PdfDocument,
  report: DashboardReport,
  locale: PdfLocale,
  copy: ReportCopy,
  pageNumber: number
) {
  addPageBase(pdf, {
    pageNumber,
    section: copy.sourcesMethodology,
    title: copy.sourcesMethodology,
    copy,
  });
  const sources = extractRealEstateSourcesForRender(report, locale);

  drawPanel(pdf, { x: 16, y: 51, width: 178, height: 141, title: copy.sources });
  if (sources.length === 0) {
    pdf.setFontSize(8);
    pdf.setTextColor(palette.slate);
    pdf.text(copy.noUsableSources, 22, 70);
  } else {
    // This panel is a fixed single page (no continuation page for
    // overflow, unlike the main report's dynamic pagination), so rows
    // beyond what fits must stop somewhere -- but stopping silently
    // meant a report with more sources than the panel's ~10-row budget
    // showed fewer citations in the PDF than the report actually has,
    // with no indication anything was cut.
    const maxVisibleRows = Math.floor((184 - 64) / 12.8) + 1;
    sources.forEach((source, index) => {
      const rowY = 64 + index * 12.8;
      if (rowY > 184) return;
      pdf.setFontSize(6.2);
      pdf.setTextColor(palette.teal);
      pdf.text(String(index + 1).padStart(2, "0"), 22, rowY);
      pdf.setFontSize(7);
      pdf.setTextColor(palette.ink);
      pdf.text(
        truncateLines(wrapText(pdf, source.title, 66), 1),
        31,
        rowY
      );
      pdf.setFontSize(5.8);
      pdf.setTextColor(palette.slate);
      pdf.text(
        truncateLines(
          wrapText(
            pdf,
            [source.institution, source.accessDate].filter(Boolean).join(" - "),
            66
          ),
          1
        ),
        31,
        rowY + 4
      );
      pdf.setFontSize(5.8);
      pdf.setTextColor(palette.muted);
      pdf.text(
        truncateLines(wrapText(pdf, source.url, 88), 1),
        102,
        rowY + 2
      );
    });

    if (sources.length > maxVisibleRows) {
      pdf.setFontSize(6.2);
      pdf.setTextColor(palette.slate);
      pdf.text(copy.moreSources(sources.length - maxVisibleRows), 22, 188);
    }
  }

  drawPanel(pdf, {
    x: 16,
    y: 201,
    width: 178,
    height: 74,
    title: copy.methodology,
    accent: "#2F6B9A",
  });
  const methodology = [
    copy.sourceNote,
    locale === "tr"
      ? "Belge bulguları, harici kanıtlar, tahminler ve tavsiyeler ayrı kanıt sınıfları olarak değerlendirilmiştir."
      : "Uploaded facts, external evidence, estimates, and recommendations are treated as separate evidence classes.",
    locale === "tr"
      ? "Bu analiz hukuki görüş, resmi imar belgesi, kadastro ölçümü, çevresel etüt veya lisanslı değerleme yerine geçmez."
      : "This analysis does not replace legal advice, official zoning confirmation, cadastral survey, environmental study, or licensed valuation.",
  ];
  pdf.setFontSize(7.5);
  pdf.setTextColor(palette.ink);
  pdf.text(
    methodology.flatMap((item) => wrapText(pdf, item, 164)),
    22,
    219,
    { lineHeightFactor: 1.35, maxWidth: 164 }
  );
}

export function isRealEstateDashboardReport(report: DashboardReport) {
  return (
    report.type === "Real Estate Investment Analysis" ||
    /real[\s-]?estate|gayrimenkul|arsa|arazi|tapu/i.test(
      `${report.title} ${report.prompt}`
    )
  );
}

export function createRealEstateReportPdf({
  report: inputReport,
  fontBase64,
  language,
}: {
  report: DashboardReport;
  fontBase64: string;
  language?: PdfLocale;
}) {
  const pdf = createPdfDocument();
  const metadataLanguage = inputReport.metadata?.reportLanguage;
  const locale: PdfLocale = language || resolveReportLanguage({
    requestText: inputReport.prompt,
    uiLanguage: metadataLanguage || (isTurkishReport(inputReport) ? "tr" : "en"),
  });
  const languageRepair = repairReportLanguageSections(
    inputReport.sections,
    locale
  );
  const languageSafeReport = {
    ...inputReport,
    sections: languageRepair.sections,
  };
  validateReportLanguageConsistency(
    [languageSafeReport.title, ...languageSafeReport.sections.map((section) => `${section.title}\n${section.content}`)].join("\n"),
    locale
  );
  const copy = getPdfCopy(locale);
  const report =
    locale === "tr"
      ? prepareTurkishPdfPresentation(languageSafeReport)
      : languageSafeReport;

  applyPdfFont(pdf, fontBase64);
  drawCover(pdf, report, locale, copy);

  const pages: Array<(pageNumber: number) => void> = [
    (pageNumber) =>
      drawExecutiveDecision(pdf, report, locale, copy, pageNumber),
    (pageNumber) =>
      drawDashboard(pdf, report, locale, copy, pageNumber),
    (pageNumber) =>
      drawTwoColumnPage(
        pdf,
        report,
        locale,
        copy,
        pageNumber,
        copy.propertyOverview,
        copy.propertyOverview,
        copy.verifiedAssetFacts,
        ["extractedDocumentFacts"],
        locale === "tr" ? "Belge Kapsamı" : "Document Scope",
        ["assetIdentification"]
      ),
    (pageNumber) =>
      drawTwoColumnPage(
        pdf,
        report,
        locale,
        copy,
        pageNumber,
        copy.locationAnalysis,
        copy.locationAnalysis,
        copy.locationContext,
        ["location"],
        copy.accessInfrastructure,
        ["accessInfrastructure"]
      ),
    (pageNumber) =>
      drawTwoColumnPage(
        pdf,
        report,
        locale,
        copy,
        pageNumber,
        copy.legalDueDiligence,
        copy.legalDueDiligence,
        copy.legalFindings,
        ["ownershipTitleFindings"],
        copy.legalRiskReview,
        ["legalRisks"]
      ),
    (pageNumber) =>
      drawTwoColumnPage(
        pdf,
        report,
        locale,
        copy,
        pageNumber,
        copy.zoningDevelopment,
        copy.zoningDevelopment,
        copy.zoningStatus,
        ["zoningLandUseStatus"],
        copy.developmentPotential,
        ["developmentPotential"]
      ),
    (pageNumber) =>
      drawTwoColumnPage(
        pdf,
        report,
        locale,
        copy,
        pageNumber,
        copy.marketLiquidity,
        copy.marketLiquidity,
        copy.comparableEvidence,
        ["comparableMarketEvidence"],
        copy.liquidity,
        ["liquidity"]
      ),
    (pageNumber) =>
      drawFinancialPage(pdf, report, locale, copy, pageNumber),
    (pageNumber) =>
      drawRiskMatrix(pdf, report, locale, copy, pageNumber),
    (pageNumber) =>
      drawDueDiligence(pdf, report, locale, copy, pageNumber),
    (pageNumber) =>
      drawSources(pdf, report, locale, copy, pageNumber),
  ];

  pages.forEach((renderPage, index) => {
    pdf.addPage();
    renderPage(index + 2);
  });

  return pdf;
}
