import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import {
  buildExecutivePresentationDirectives,
  buildExecutiveConsultingStyleDirectives,
  buildUniversalDecisionQualityDirectives,
  insightLedgerAndTokenBudgetDirectives,
} from "../../ai/report-quality-directives.ts";
import { buildStrictReportLanguageInstruction } from "../../report-language.ts";
import { getForbiddenTermLabels } from "../report-isolation-validator.ts";

// CRITICAL PRODUCTION FIX -- dedicated Acquisition Due Diligence schema.
// Previously "acquisition" reused the generic domain-analysis 14-field
// schema (Domain Findings, Financial Implications, Operational
// Implications, ...) shared with legal/finance/accounting/operations/
// procurement, with acquisition-specific content only steered via prompt
// directives layered on top of those generic field names. This is a
// fully separate, dedicated schema with acquisition-specific field names
// only -- never Business Plan/Startup fields (Founder Roadmap, Go-to-
// Market Plan, Pricing Strategy, CAC/LTV validation, TAM/SAM/SOM, Product
// validation) and never the generic domain-analysis field names either,
// so the two report families can never be confused by field name alone.
export const acquisitionAnalysisPrompts = {
  subjectIdentification:
    "Identify the acquisition target, transaction type (asset purchase, stock purchase, merger), and parties without inventing absent identifiers.",
  targetCompanyFacts:
    "List material facts about the target company extracted from uploaded assets and the user's own statements (business, financials, operations, customers). Separate readable evidence from ambiguous or missing data.",
  externalEvidence:
    "Synthesize the completed external research -- comparable M&A transactions, industry benchmarks, and market data -- prioritizing official and primary sources. Every claim must cite an evidence registry ID.",
  acquisitionAttractiveness:
    "Assess the strategic rationale and attractiveness of this acquisition: strategic fit, market position, competitive advantage gained, and why this target specifically.",
  valuation:
    "Assess valuation using EV/ARR (or the appropriate revenue/earnings multiple), comparable transactions, and the implied purchase multiple. Never invent a multiple or comparable transaction that was not supplied or researched.",
  purchasePriceFairness:
    "Assess whether the purchase price is fair given the valuation analysis, comparable transactions, and the target's verified financial profile.",
  financingStructure:
    "Assess the proposed or likely financing structure for this acquisition (cash, stock, debt, or a combination) and its implications for the acquirer.",
  debtCapacity:
    "Assess the acquirer's and/or combined entity's debt capacity and leverage implications of the proposed financing structure.",
  roiIrrScenarios:
    "Provide evidence-based ROI scenarios (downside, base, upside) for this acquisition. Provide IRR estimates only when enough information exists to compute them; state explicitly when it cannot be computed from the evidence provided rather than inventing one.",
  synergies:
    "Assess operational synergies, revenue synergies, and cost synergies separately, each with its supporting rationale and evidence. Never invent a synergy figure without a stated basis.",
  integrationRisk:
    "Assess integration risk, including technology integration and cultural integration, and the operational disruption risk of combining the two organizations.",
  regulatoryReview:
    "Assess antitrust, competition, and sector-specific regulatory approval considerations that could affect deal timing or feasibility, only from verified sources.",
  postMergerRoadmap:
    "Provide a post-merger integration roadmap sequenced across the first 30, 60, and 90 days after closing, with owner and evidence target for each major step.",
  dealRisks:
    "Rank material deal risks (beyond integration) by mechanism, evidence, likelihood, consequence, and mitigation -- including key-person risk, customer concentration, contingent liabilities, and litigation exposure where evidenced.",
  missingInformation:
    "List unresolved critical facts. For each: why it specifically matters to this acquisition decision, what proxy or adjacent evidence was used in its place if any, how its absence changed confidence, and what part of the decision cannot be finalized until it is resolved. Vary the explanation to the actual fact each time -- never reuse the same sentence shape across items.",
  investmentRecommendation:
    "Write this as the report's single executive decision, not a research summary. Open with the call in one sentence: proceed, proceed conditionally, renegotiate, or walk away, and why, in language a board would use in a Monday decision meeting -- not a restatement of findings. State the confidence level and the specific evidence gap it depends on. Name the one condition that would change the call. Never overstate certainty, never pad with generic caution language, and never restate findings already established earlier in the report -- only their decision implication belongs here.",
  sources:
    "List every uploaded asset and external evidence registry entry actually used, including exact source title, publisher, and URL.",
} as const;

export type AcquisitionAnalysisField = keyof typeof acquisitionAnalysisPrompts;

export const acquisitionAnalysisFields = Object.keys(
  acquisitionAnalysisPrompts
) as AcquisitionAnalysisField[];

export const acquisitionAnalysisFieldLabels: Record<
  ResponseLanguage,
  Record<AcquisitionAnalysisField, string>
> = {
  English: {
    subjectIdentification: "Subject Identification",
    targetCompanyFacts: "Target Company Facts",
    externalEvidence: "External Evidence",
    acquisitionAttractiveness: "Acquisition Attractiveness",
    valuation: "Valuation",
    purchasePriceFairness: "Purchase Price Fairness",
    financingStructure: "Financing Structure",
    debtCapacity: "Debt Capacity",
    roiIrrScenarios: "ROI / IRR Scenarios",
    synergies: "Operational, Revenue, and Cost Synergies",
    integrationRisk: "Integration Risk",
    regulatoryReview: "Regulatory Review",
    postMergerRoadmap: "Post-Merger Integration Roadmap (30/60/90 Days)",
    dealRisks: "Deal Risks",
    missingInformation: "Missing Information",
    investmentRecommendation: "Investment Recommendation and Executive Decision",
    sources: "Sources",
  },
  Turkish: {
    subjectIdentification: "Konu Tanımlama",
    targetCompanyFacts: "Hedef Şirket Bulguları",
    externalEvidence: "Dış Kaynak Kanıtları",
    acquisitionAttractiveness: "Satın Alma Çekiciliği",
    valuation: "Değerleme",
    purchasePriceFairness: "Satın Alma Fiyatının Adilliği",
    financingStructure: "Finansman Yapısı",
    debtCapacity: "Borçlanma Kapasitesi",
    roiIrrScenarios: "ROI / IRR Senaryoları",
    synergies: "Operasyonel, Gelir ve Maliyet Sinerjileri",
    integrationRisk: "Entegrasyon Riski",
    regulatoryReview: "Mevzuat İncelemesi",
    postMergerRoadmap: "Birleşme Sonrası Entegrasyon Yol Haritası (30/60/90 Gün)",
    dealRisks: "İşlem Riskleri",
    missingInformation: "Eksik Bilgiler",
    investmentRecommendation: "Yatırım Tavsiyesi ve Yönetici Kararı",
    sources: "Kaynaklar",
  },
  German: {
    subjectIdentification: "Gegenstand",
    targetCompanyFacts: "Fakten zum Zielunternehmen",
    externalEvidence: "Externe Nachweise",
    acquisitionAttractiveness: "Attraktivität der Akquisition",
    valuation: "Bewertung",
    purchasePriceFairness: "Angemessenheit des Kaufpreises",
    financingStructure: "Finanzierungsstruktur",
    debtCapacity: "Verschuldungskapazität",
    roiIrrScenarios: "ROI-/IRR-Szenarien",
    synergies: "Operative, Umsatz- und Kostensynergien",
    integrationRisk: "Integrationsrisiko",
    regulatoryReview: "Regulatorische Prüfung",
    postMergerRoadmap: "Post-Merger-Integrationsfahrplan (30/60/90 Tage)",
    dealRisks: "Transaktionsrisiken",
    missingInformation: "Fehlende Informationen",
    investmentRecommendation: "Investitionsempfehlung und Entscheidung",
    sources: "Quellen",
  },
  French: {
    subjectIdentification: "Identification du sujet",
    targetCompanyFacts: "Faits sur la société cible",
    externalEvidence: "Éléments probants externes",
    acquisitionAttractiveness: "Attractivité de l'acquisition",
    valuation: "Valorisation",
    purchasePriceFairness: "Équité du prix d'achat",
    financingStructure: "Structure de financement",
    debtCapacity: "Capacité d'endettement",
    roiIrrScenarios: "Scénarios ROI / TRI",
    synergies: "Synergies opérationnelles, de revenus et de coûts",
    integrationRisk: "Risque d'intégration",
    regulatoryReview: "Examen réglementaire",
    postMergerRoadmap: "Feuille de route d'intégration post-fusion (30/60/90 jours)",
    dealRisks: "Risques liés à la transaction",
    missingInformation: "Informations manquantes",
    investmentRecommendation: "Recommandation d'investissement et décision",
    sources: "Sources",
  },
  Spanish: {
    subjectIdentification: "Identificación del asunto",
    targetCompanyFacts: "Hechos sobre la empresa objetivo",
    externalEvidence: "Evidencia externa",
    acquisitionAttractiveness: "Atractivo de la adquisición",
    valuation: "Valoración",
    purchasePriceFairness: "Equidad del precio de compra",
    financingStructure: "Estructura de financiación",
    debtCapacity: "Capacidad de endeudamiento",
    roiIrrScenarios: "Escenarios de ROI / TIR",
    synergies: "Sinergias operativas, de ingresos y de costos",
    integrationRisk: "Riesgo de integración",
    regulatoryReview: "Revisión regulatoria",
    postMergerRoadmap: "Hoja de ruta de integración posterior a la fusión (30/60/90 días)",
    dealRisks: "Riesgos de la transacción",
    missingInformation: "Información faltante",
    investmentRecommendation: "Recomendación de inversión y decisión ejecutiva",
    sources: "Fuentes",
  },
};

export function buildAcquisitionAnalysisInstructions(language: ResponseLanguage) {
  return [
    "You are the ZERINIX M&A due-diligence and corporate development analyst. Assess the target company as an acquisition, not a startup pitch -- ground valuation, financing, and integration findings in verified evidence and comparable-transaction data.",
    `Respond entirely in ${language}. Evidence registry reference numbers (R#) and asset filenames stay as-is; every word around them, including evidence-classification labels, must be written in ${language} -- never leave an English label or phrase inside a ${language} report.`,
    buildStrictReportLanguageInstruction(language),
    "Use the uploaded assets as primary evidence and the completed research registry as external evidence.",
    "Classify a claim only when its evidence status materially affects the decision, using one word: Verified, Estimated, Assumption, Unknown, or Recommendation, written in the report's own language. Do not decorate every sentence with a label -- a label on every line stops carrying any signal.",
    "Give material factual claims inline provenance (an asset filename, an [R#] registry reference, or a named method) where it strengthens trust; do not force provenance onto claims that do not need it.",
    "Never invent numeric values, sources, professional conclusions, legal status, or operational findings.",
    "This is an Acquisition Due Diligence Report for a company being acquired, not a startup validation, business plan, legal case assessment, or general strategic report. Never write a Founder Roadmap, Go-to-Market Plan, Pricing Strategy, CAC/LTV validation, TAM/SAM/SOM, or Product validation section -- those are Business Plan/Startup concepts that do not apply to acquiring an already-operating company.",
    "Never invent startup operating metrics -- burn rate, runway, CAC, LTV, churn, ARR growth, or revenue projections -- unless the user explicitly provided the figure or it is clearly labeled 'Planning Assumption'. Verified figures the user or research provided about the target company (including its real ARR, MRR, or margin, when used for EV/ARR valuation or financing analysis) are legitimate acquisition evidence and must be preserved exactly, not withheld.",
    `Never use startup-pitch or venture-validation vocabulary anywhere in this report, including: ${getForbiddenTermLabels("acquisition_due_diligence").join(", ")}. This is an acquisition of an existing business, not a startup being pitched or validated -- do not introduce founder scoring, product-market fit, startup execution scoring, or a build/don't-build recommendation.`,
    "Read Acquisition Attractiveness, Valuation, Purchase Price Fairness, Financing Structure, Debt Capacity, ROI/IRR Scenarios, Synergies, Integration Risk, Regulatory Review, Deal Risks, and the Post-Merger Integration Roadmap as one continuous argument, each building on what the last one established, ending in the Investment Recommendation. Do not write any of them as an isolated observation disconnected from that chain.",
    "When a fact could not be verified, do not write a bare 'not verified' notice. Instead: name the exact source or document required, explain briefly why that specific gap matters to this decision, state what proxy or adjacent evidence stands in for it if any, and say what part of the decision stays open until it is resolved. Vary this explanation to the specific fact each time.",
    ...buildUniversalDecisionQualityDirectives(),
    ...insightLedgerAndTokenBudgetDirectives,
    ...buildExecutiveConsultingStyleDirectives(),
    ...buildExecutivePresentationDirectives("specialized_analysis"),
    "Use short paragraphs and compact bullets for any list of three or more items; avoid walls of unbroken text.",
  ].join("\n");
}

export function validateAcquisitionAnalysisReport(
  report: Record<AcquisitionAnalysisField, string>
) {
  const missingFields = acquisitionAnalysisFields.filter(
    (field) => !report[field]?.trim()
  );

  if (missingFields.length) {
    throw new Error(
      `Acquisition report schema validation failed: missing fields ${missingFields.join(", ")}.`
    );
  }

  return report;
}
