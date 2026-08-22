import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import {
  buildExecutivePresentationDirectives,
  buildExecutiveConsultingStyleDirectives,
  buildUniversalDecisionQualityDirectives,
  insightLedgerAndTokenBudgetDirectives,
} from "../../ai/report-quality-directives.ts";
import { buildStrictReportLanguageInstruction } from "../../report-language.ts";
import { getForbiddenTermLabels } from "../report-isolation-validator.ts";

// CRITICAL PRODUCTION FIX -- dedicated Acquisition Due Diligence schema,
// field-for-field matched to the exact requested section list (never the
// generic domain-analysis 14-field schema, and never any Business Plan/
// Startup field -- Problem, Solution, ICP, TAM/SAM/SOM, Pricing Strategy,
// Go-to-Market, Sales Strategy, Founder Roadmap, Founder Readiness,
// Startup KPIs, Business Validation, Product Validation -- so the two
// report families can never be confused by field name, content, or
// template). Every field name below reads as its own acquisition-specific
// heading; there is no field whose title could be mistaken for a
// Business Plan section.
export const acquisitionAnalysisPrompts = {
  executiveAcquisitionSummary:
    "Open with the acquisition decision in one sentence: proceed, proceed conditionally, renegotiate, or walk away, and identify the target, transaction type (asset purchase, stock purchase, merger), and parties without inventing absent identifiers. This is the report's executive entry point -- a board-level summary of the deal, never a startup elevator pitch.",
  targetCompanyOverview:
    "Describe the target company: business, operations, customers, and financial profile, extracted from uploaded assets and the user's own statements. Separate readable evidence from ambiguous or missing data.",
  externalEvidence:
    "Synthesize the completed external research -- comparable M&A transactions, industry benchmarks, and market data -- prioritizing official and primary sources. Every claim must cite an evidence registry ID.",
  strategicFit:
    "Assess the strategic rationale and fit of this acquisition: strategic fit with the acquirer's own strategy, market position, competitive advantage gained, and why this target specifically.",
  valuationAnalysis:
    "Assess valuation using EV/ARR (or the appropriate revenue/earnings multiple), comparable transactions, and the implied purchase multiple, then assess whether the purchase price is fair given that valuation and the target's verified financial profile. Never invent a multiple, comparable transaction, or price figure that was not supplied or researched.",
  financingStructure:
    "Assess the proposed or likely financing structure for this acquisition (cash, stock, debt, or a combination) and its implications for the acquirer.",
  debtCapacity:
    "Assess the acquirer's and/or combined entity's debt capacity and leverage implications of the proposed financing structure.",
  roiAnalysis:
    "Provide evidence-based ROI scenarios (downside, base, upside) for this acquisition. State explicitly when a scenario cannot be supported from the evidence provided rather than inventing one.",
  irrAnalysis:
    "Provide an IRR estimate only when enough information exists to compute it (cash flow timing, exit assumption, holding period). State explicitly when IRR cannot be computed from the evidence provided -- never invent one.",
  revenueSynergies:
    "Assess revenue synergies specifically (cross-sell, upsell, new-channel access, pricing power), each with its supporting rationale and evidence. Never invent a synergy figure without a stated basis.",
  costSynergies:
    "Assess cost synergies specifically (overlapping functions, procurement leverage, facility consolidation, technology consolidation), each with its supporting rationale and evidence. Never invent a synergy figure without a stated basis.",
  integrationRisks:
    "Assess integration risk: technology integration, cultural integration, systems/process consolidation, and the disruption risk of combining the two organizations.",
  operationalRisks:
    "Assess operational risks distinct from integration: supply chain, key operational dependencies, customer/vendor concentration, and delivery continuity risk during and after the transition.",
  regulatoryReview:
    "Assess antitrust, competition, and sector-specific regulatory approval considerations that could affect deal timing or feasibility, only from verified sources.",
  competitivePosition:
    "Assess the combined entity's competitive position after the acquisition: market share shift, competitor response, and durability of the advantage gained.",
  dealRisks:
    "Rank material deal risks (beyond integration and operations) by mechanism, evidence, likelihood, consequence, and mitigation -- including key-person risk, customer concentration, contingent liabilities, and litigation exposure where evidenced.",
  postMergerIntegrationPlan:
    "Provide a post-merger integration plan sequenced across the first 30, 60, and 90 days after closing, with owner and evidence target for each major step.",
  missingInformation:
    "List unresolved critical facts. For each: why it specifically matters to this acquisition decision, what proxy or adjacent evidence was used in its place if any, how its absence changed confidence, and what part of the decision cannot be finalized until it is resolved. Vary the explanation to the actual fact each time -- never reuse the same sentence shape across items.",
  finalInvestmentRecommendation:
    "Write this as the report's single, final executive decision, not a research summary. State the call: proceed, proceed conditionally, renegotiate, or walk away, and why, in language a board would use in a Monday decision meeting -- not a restatement of findings. State the confidence level and the specific evidence gap it depends on. Name the one condition that would change the call. Never overstate certainty, never pad with generic caution language, and never restate findings already established earlier in the report -- only their decision implication belongs here.",
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
    executiveAcquisitionSummary: "Executive Acquisition Summary",
    targetCompanyOverview: "Target Company Overview",
    externalEvidence: "External Evidence",
    strategicFit: "Strategic Fit",
    valuationAnalysis: "Valuation Analysis (EV/ARR, Purchase Price Fairness)",
    financingStructure: "Financing Structure",
    debtCapacity: "Debt Capacity",
    roiAnalysis: "ROI Analysis",
    irrAnalysis: "IRR Analysis",
    revenueSynergies: "Revenue Synergies",
    costSynergies: "Cost Synergies",
    integrationRisks: "Integration Risks",
    operationalRisks: "Operational Risks",
    regulatoryReview: "Regulatory Review",
    competitivePosition: "Competitive Position",
    dealRisks: "Deal Risks",
    postMergerIntegrationPlan: "Post-Merger Integration Plan (30/60/90 Days)",
    missingInformation: "Missing Information",
    finalInvestmentRecommendation: "Final Investment Recommendation",
    sources: "Sources",
  },
  Turkish: {
    executiveAcquisitionSummary: "Yönetici Satın Alma Özeti",
    targetCompanyOverview: "Hedef Şirket Genel Bakışı",
    externalEvidence: "Dış Kaynak Kanıtları",
    strategicFit: "Stratejik Uyum",
    valuationAnalysis: "Değerleme Analizi (EV/ARR, Satın Alma Fiyatının Adilliği)",
    financingStructure: "Finansman Yapısı",
    debtCapacity: "Borçlanma Kapasitesi",
    roiAnalysis: "ROI Analizi",
    irrAnalysis: "IRR Analizi",
    revenueSynergies: "Gelir Sinerjileri",
    costSynergies: "Maliyet Sinerjileri",
    integrationRisks: "Entegrasyon Riskleri",
    operationalRisks: "Operasyonel Riskler",
    regulatoryReview: "Mevzuat İncelemesi",
    competitivePosition: "Rekabet Konumu",
    dealRisks: "İşlem Riskleri",
    postMergerIntegrationPlan: "Birleşme Sonrası Entegrasyon Planı (30/60/90 Gün)",
    missingInformation: "Eksik Bilgiler",
    finalInvestmentRecommendation: "Nihai Yatırım Tavsiyesi",
    sources: "Kaynaklar",
  },
  German: {
    executiveAcquisitionSummary: "Zusammenfassung der Akquisitionsentscheidung",
    targetCompanyOverview: "Überblick über das Zielunternehmen",
    externalEvidence: "Externe Nachweise",
    strategicFit: "Strategische Passung",
    valuationAnalysis: "Bewertungsanalyse (EV/ARR, Angemessenheit des Kaufpreises)",
    financingStructure: "Finanzierungsstruktur",
    debtCapacity: "Verschuldungskapazität",
    roiAnalysis: "ROI-Analyse",
    irrAnalysis: "IRR-Analyse",
    revenueSynergies: "Umsatzsynergien",
    costSynergies: "Kostensynergien",
    integrationRisks: "Integrationsrisiken",
    operationalRisks: "Operative Risiken",
    regulatoryReview: "Regulatorische Prüfung",
    competitivePosition: "Wettbewerbsposition",
    dealRisks: "Transaktionsrisiken",
    postMergerIntegrationPlan: "Post-Merger-Integrationsplan (30/60/90 Tage)",
    missingInformation: "Fehlende Informationen",
    finalInvestmentRecommendation: "Abschließende Investitionsempfehlung",
    sources: "Quellen",
  },
  French: {
    executiveAcquisitionSummary: "Synthèse exécutive de l'acquisition",
    targetCompanyOverview: "Aperçu de la société cible",
    externalEvidence: "Éléments probants externes",
    strategicFit: "Adéquation stratégique",
    valuationAnalysis: "Analyse de valorisation (EV/ARR, équité du prix d'achat)",
    financingStructure: "Structure de financement",
    debtCapacity: "Capacité d'endettement",
    roiAnalysis: "Analyse du ROI",
    irrAnalysis: "Analyse du TRI",
    revenueSynergies: "Synergies de revenus",
    costSynergies: "Synergies de coûts",
    integrationRisks: "Risques d'intégration",
    operationalRisks: "Risques opérationnels",
    regulatoryReview: "Examen réglementaire",
    competitivePosition: "Position concurrentielle",
    dealRisks: "Risques liés à la transaction",
    postMergerIntegrationPlan: "Plan d'intégration post-fusion (30/60/90 jours)",
    missingInformation: "Informations manquantes",
    finalInvestmentRecommendation: "Recommandation d'investissement finale",
    sources: "Sources",
  },
  Spanish: {
    executiveAcquisitionSummary: "Resumen ejecutivo de la adquisición",
    targetCompanyOverview: "Panorama de la empresa objetivo",
    externalEvidence: "Evidencia externa",
    strategicFit: "Ajuste estratégico",
    valuationAnalysis: "Análisis de valoración (EV/ARR, equidad del precio de compra)",
    financingStructure: "Estructura de financiación",
    debtCapacity: "Capacidad de endeudamiento",
    roiAnalysis: "Análisis de ROI",
    irrAnalysis: "Análisis de TIR",
    revenueSynergies: "Sinergias de ingresos",
    costSynergies: "Sinergias de costos",
    integrationRisks: "Riesgos de integración",
    operationalRisks: "Riesgos operativos",
    regulatoryReview: "Revisión regulatoria",
    competitivePosition: "Posición competitiva",
    dealRisks: "Riesgos de la transacción",
    postMergerIntegrationPlan: "Plan de integración posterior a la fusión (30/60/90 días)",
    missingInformation: "Información faltante",
    finalInvestmentRecommendation: "Recomendación de inversión final",
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
    // CRITICAL PRODUCTION FIX -- named, exhaustive ban list. Confirmed
    // live three times: a generic "never write startup sections" rule was
    // not enough to keep this report from still reading like a Business
    // Plan. Every one of these exact section concepts is now named
    // explicitly, once, so there is no ambiguity for the model.
    "This is an Acquisition Due Diligence Report for a company being acquired, not a startup pitch, business plan, legal case assessment, or general strategic report. Never write any of the following Business Plan/Startup sections or their content, under any heading: Problem, Solution, ICP, TAM/SAM/SOM, Pricing Strategy, Go-To-Market, Sales Strategy, Founder Roadmap, Founder Readiness, Startup KPIs, Business Validation, Product Validation. Those are startup-pitch concepts that do not apply to acquiring an already-operating company.",
    "Never invent startup operating metrics -- burn rate, runway, CAC, LTV, churn, ARR growth, or revenue projections -- unless the user explicitly provided the figure or it is clearly labeled 'Planning Assumption'. Verified figures the user or research provided about the target company (including its real ARR, MRR, or margin, when used for EV/ARR valuation or financing analysis) are legitimate acquisition evidence and must be preserved exactly, not withheld.",
    `Never use startup-pitch or venture-validation vocabulary anywhere in this report, including: ${getForbiddenTermLabels("acquisition_due_diligence").join(", ")}. This is an acquisition of an existing business, not a startup being pitched or validated -- do not introduce founder scoring, product-market fit, startup execution scoring, or a build/don't-build recommendation.`,
    "Read Strategic Fit, Valuation Analysis, Financing Structure, Debt Capacity, ROI Analysis, IRR Analysis, Revenue Synergies, Cost Synergies, Integration Risks, Operational Risks, Regulatory Review, Competitive Position, and Deal Risks as one continuous argument, each building on what the last one established, ending in the Post-Merger Integration Plan and the Final Investment Recommendation. Do not write any of them as an isolated observation disconnected from that chain.",
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
