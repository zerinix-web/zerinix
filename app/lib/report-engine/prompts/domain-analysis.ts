import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import type { ReportDomain } from "@/app/lib/report-engine/domain";
import { buildExecutivePresentationDirectives } from "../../ai/report-quality-directives.ts";
import { buildStrictReportLanguageInstruction } from "../../report-language.ts";

export type SpecializedReportDomain = Exclude<
  ReportDomain,
  "business" | "real_estate"
>;

export const domainAnalysisPrompts = {
  subjectIdentification:
    "Identify the analyzed subject, document set, period, parties, entity, process, or procurement requirement without inventing absent identifiers.",
  extractedFacts:
    "List material facts extracted from uploaded assets. Separate readable evidence from ambiguous or missing data.",
  externalEvidence:
    "Synthesize the completed external research, prioritizing official and primary sources. Every claim must cite an evidence registry ID.",
  domainFindings:
    "Provide domain-specific findings that directly affect the user's decision. Do not introduce startup or unrelated report concepts.",
  regulatoryCompliance:
    "Assess applicable rules, standards, regulator guidance, filing duties, and compliance gaps only from verified sources.",
  financialImplications:
    "Explain supported financial implications, exposures, cash effects, or commercial consequences. Never invent values.",
  operationalImplications:
    "Explain supported workflow, capacity, delivery, control, implementation, or execution implications.",
  riskAnalysis:
    "Rank material risks by mechanism, evidence, likelihood direction, consequence, and mitigation without making unsupported professional conclusions.",
  scenarioAnalysis:
    "Provide evidence-based downside, base, and upside or alternative scenarios. Numeric scenarios require explicit source or method provenance.",
  decisionAssessment:
    "Assess evidence sufficiency and decision readiness. Confidence must decrease when critical evidence remains unresolved.",
  missingInformation:
    "List unresolved critical facts, why each matters, the exact source or document required, and whether external research was attempted.",
  recommendedActions:
    "Provide prioritized, domain-specific next actions with owner, evidence target, and decision gate.",
  finalRecommendation:
    "Give a conditional, evidence-weighted recommendation aligned with the research sufficiency decision. Never overstate certainty.",
  sources:
    "List every uploaded asset and external evidence registry entry actually used, including exact source title, publisher, and URL.",
} as const;

export type DomainAnalysisField = keyof typeof domainAnalysisPrompts;

export const domainAnalysisFields = Object.keys(
  domainAnalysisPrompts
) as DomainAnalysisField[];

export const domainAnalysisFieldLabels: Record<
  ResponseLanguage,
  Record<DomainAnalysisField, string>
> = {
  English: {
    subjectIdentification: "Subject Identification",
    extractedFacts: "Extracted Facts",
    externalEvidence: "External Evidence",
    domainFindings: "Domain Findings",
    regulatoryCompliance: "Regulatory and Compliance Findings",
    financialImplications: "Financial Implications",
    operationalImplications: "Operational Implications",
    riskAnalysis: "Risk Analysis",
    scenarioAnalysis: "Scenario Analysis",
    decisionAssessment: "Decision Assessment",
    missingInformation: "Missing Information",
    recommendedActions: "Recommended Actions",
    finalRecommendation: "Final Recommendation",
    sources: "Sources",
  },
  Turkish: {
    subjectIdentification: "Konu Tanımlama",
    extractedFacts: "Çıkarılan Bulgular",
    externalEvidence: "Dış Kaynak Kanıtları",
    domainFindings: "Alan Bulguları",
    regulatoryCompliance: "Mevzuat ve Uyum Bulguları",
    financialImplications: "Finansal Etkiler",
    operationalImplications: "Operasyonel Etkiler",
    riskAnalysis: "Risk Analizi",
    scenarioAnalysis: "Senaryo Analizi",
    decisionAssessment: "Karar Değerlendirmesi",
    missingInformation: "Eksik Bilgiler",
    recommendedActions: "Önerilen Aksiyonlar",
    finalRecommendation: "Nihai Tavsiye",
    sources: "Kaynaklar",
  },
  German: {
    subjectIdentification: "Gegenstand",
    extractedFacts: "Ermittelte Fakten",
    externalEvidence: "Externe Nachweise",
    domainFindings: "Fachliche Erkenntnisse",
    regulatoryCompliance: "Regulatorik und Compliance",
    financialImplications: "Finanzielle Auswirkungen",
    operationalImplications: "Operative Auswirkungen",
    riskAnalysis: "Risikoanalyse",
    scenarioAnalysis: "Szenarioanalyse",
    decisionAssessment: "Entscheidungsbewertung",
    missingInformation: "Fehlende Informationen",
    recommendedActions: "Empfohlene Maßnahmen",
    finalRecommendation: "Abschließende Empfehlung",
    sources: "Quellen",
  },
  French: {
    subjectIdentification: "Identification du sujet",
    extractedFacts: "Faits extraits",
    externalEvidence: "Éléments probants externes",
    domainFindings: "Constats spécialisés",
    regulatoryCompliance: "Réglementation et conformité",
    financialImplications: "Implications financières",
    operationalImplications: "Implications opérationnelles",
    riskAnalysis: "Analyse des risques",
    scenarioAnalysis: "Analyse des scénarios",
    decisionAssessment: "Évaluation de la décision",
    missingInformation: "Informations manquantes",
    recommendedActions: "Actions recommandées",
    finalRecommendation: "Recommandation finale",
    sources: "Sources",
  },
  Spanish: {
    subjectIdentification: "Identificación del asunto",
    extractedFacts: "Hechos extraídos",
    externalEvidence: "Evidencia externa",
    domainFindings: "Hallazgos especializados",
    regulatoryCompliance: "Regulación y cumplimiento",
    financialImplications: "Implicaciones financieras",
    operationalImplications: "Implicaciones operativas",
    riskAnalysis: "Análisis de riesgos",
    scenarioAnalysis: "Análisis de escenarios",
    decisionAssessment: "Evaluación de la decisión",
    missingInformation: "Información faltante",
    recommendedActions: "Acciones recomendadas",
    finalRecommendation: "Recomendación final",
    sources: "Fuentes",
  },
};

const domainRole: Record<SpecializedReportDomain, string> = {
  legal:
    "contract and legal-risk analyst. Provide legal information and due-diligence guidance, not definitive legal advice.",
  finance:
    "financial analyst. Reconcile uploaded figures before calculating, and expose every formula and assumption.",
  accounting:
    "accounting-review analyst. Apply only verified standards and tax authority guidance; do not provide a filing opinion without sufficient records.",
  operations:
    "operations analyst. Ground capacity, quality, cost, bottleneck, and implementation findings in observed data and authoritative benchmarks.",
  procurement:
    "procurement and supplier-risk analyst. Verify suppliers, compliance, sanctions, commercial terms, alternatives, and delivery risk.",
};

export function buildDomainAnalysisInstructions(
  domain: SpecializedReportDomain,
  language: ResponseLanguage
) {
  return [
    `You are the ZERINIX ${domainRole[domain]}`,
    `Respond entirely in ${language}, preserving evidence labels and evidence registry IDs exactly.`,
    buildStrictReportLanguageInstruction(language),
    "Use the uploaded assets as primary evidence and the completed research registry as external evidence.",
    "Every factual bullet or paragraph must begin with exactly one label: [Verified from uploaded asset], [Verified from external source], [User-provided], [Estimate], [Unknown], or [Recommendation].",
    "Every material factual claim must include inline provenance: [Asset: filename], [R#], [User], [Method: ...], [Required: ...], or [Basis: ...].",
    "Never invent numeric values, sources, professional conclusions, legal status, accounting treatment, prices, or operational findings.",
    "If research could not verify a fact, write Unknown and name the exact source or document required.",
    ...buildExecutivePresentationDirectives("specialized_analysis"),
  ].join("\n");
}

export function validateDomainAnalysisReport(
  report: Record<DomainAnalysisField, string>
) {
  const missingFields = domainAnalysisFields.filter(
    (field) => !report[field]?.trim()
  );

  if (missingFields.length) {
    throw new Error(
      `Domain report schema validation failed: missing fields ${missingFields.join(", ")}.`
    );
  }

  return report;
}
