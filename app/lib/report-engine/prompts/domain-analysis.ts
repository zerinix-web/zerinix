import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import type { ReportDomain } from "@/app/lib/report-engine/domain";
import {
  buildExecutivePresentationDirectives,
  buildExecutiveConsultingStyleDirectives,
  buildUniversalDecisionQualityDirectives,
  insightLedgerAndTokenBudgetDirectives,
} from "../../ai/report-quality-directives.ts";
import { buildStrictReportLanguageInstruction } from "../../report-language.ts";

// "acquisition" deliberately excluded: it has its own fully dedicated
// schema (acquisition-analysis.ts) with acquisition-specific field names,
// not this generic 14-field domain-analysis shape -- see
// acquisition-analysis.ts for why (Business Plan/Startup fields like
// Founder Roadmap, GTM, Pricing Strategy, CAC/LTV validation, TAM/SAM/SOM
// must never be reachable from an Acquisition Due Diligence report, and
// neither should this module's own generic "Domain Findings"/"Financial
// Implications" placeholders -- the report needs literal, named
// acquisition sections instead).
export type SpecializedReportDomain = Exclude<
  ReportDomain,
  "business" | "real_estate" | "acquisition"
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
    "Lead with the compact supported figures (exposure, cash effect, cost, or value at stake) before any explanation of how they were derived. Explain supported financial implications, exposures, cash effects, or commercial consequences. Never invent values.",
  operationalImplications:
    "Explain supported workflow, capacity, delivery, control, implementation, or execution implications.",
  riskAnalysis:
    "Rank material risks by mechanism, evidence, likelihood direction, consequence, and mitigation without making unsupported professional conclusions.",
  scenarioAnalysis:
    "Provide evidence-based downside, base, and upside or alternative scenarios. Numeric scenarios require explicit source or method provenance.",
  decisionAssessment:
    "Assess evidence sufficiency and decision readiness. Confidence must decrease when critical evidence remains unresolved. State confidence only as a percentage or a plain-language certainty level (e.g. High/Moderate/Low) -- never as the decision word itself (proceed, proceed conditionally, do not proceed, or any equivalent call).",
  missingInformation:
    "List unresolved critical facts. For each: why it specifically matters to this decision, what proxy or adjacent evidence was used in its place if any, how its absence changed confidence, and what part of the decision cannot be finalized until it is resolved. Vary the explanation to the actual fact each time -- never reuse the same sentence shape across items.",
  recommendedActions:
    "Provide prioritized, domain-specific next actions with owner, evidence target, and decision gate.",
  // TASK #69A-37 -- ROOT CAUSE FIX. Confirmed live: a real Strategic
  // Advisory response wrote "... Confidence: GO (95%)." -- the decision
  // call and the confidence figure conflated into one mislabeled
  // sentence, because this prompt asked for both "the call" and "the
  // confidence level" without ever saying they must be two separate
  // statements, or that confidence must be numeric. Decision and
  // confidence are different concepts and must never share one label.
  // Also broadened "the call" itself: the bare three-word posture
  // (proceed / proceed conditionally / do not proceed) is a coarse
  // internal classification, not a decision-useful action -- the call
  // must name the SPECIFIC strategic action the evidence supports (e.g.
  // "slow aggressive growth spending and prioritize unit-economics
  // improvement" rather than a bare "proceed conditionally"), derived
  // from this business's own decision question, never a fixed template
  // phrase for any one scenario.
  finalRecommendation:
    "Write this as the report's single executive decision, not a research summary. Open with the call in one sentence: name the SPECIFIC strategic action the evidence supports for this exact decision question (not a generic proceed/wait/avoid label), and why, in language a CEO would use in a Monday decision meeting -- not a restatement of findings. Then, on its own separate sentence, state confidence ONLY as a percentage or a plain-language certainty level (e.g. 'Confidence: 82%' or 'Confidence: Moderate') together with the specific evidence gap it depends on -- confidence must never itself be, or contain, a decision/recommendation word (proceed, proceed conditionally, do not proceed, GO, MONITOR, PROCEED WITH CONDITIONS, or any equivalent call); that call belongs only in the opening sentence, never repeated inside the confidence statement. Name the one condition that would change the call. Never overstate certainty, never pad with generic caution language, and never restate findings already established earlier in the report -- only their decision implication belongs here.",
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
    `Respond entirely in ${language}. Evidence registry reference numbers (R#) and asset filenames stay as-is; every word around them, including evidence-classification labels, must be written in ${language} -- never leave an English label or phrase inside a ${language} report.`,
    buildStrictReportLanguageInstruction(language),
    "Use the uploaded assets as primary evidence and the completed research registry as external evidence.",
    "Classify a claim only when its evidence status materially affects the decision, using one word: Verified, Benchmark, Estimated, Assumption, Unknown, or Recommendation, written in the report's own language. Use Benchmark ONLY when a real external reference actually supports that specific number -- a named industry report, a comparable-company figure, or an [R#] registry entry (e.g. a target CAC payback period, an LTV:CAC ratio, an NRR range, an ACV/ARPU improvement band, when you can point to where that figure comes from). If you produced the number yourself with no such external reference, it is never Benchmark -- label it Estimated (your own approximate cost, duration, or impact figure) or Assumption (a planning input you chose to construct a scenario) instead. Do not decorate every sentence with a label -- a label on every line stops carrying any signal.",
    // TASK #69A-37A -- ROOT CAUSE FIX. Confirmed live: a real Strategic
    // Advisory response's Recommended Actions/Final Recommendation
    // named many material numeric thresholds, budgets, and impact
    // ranges (a CAC-reduction gate, an LTV/CAC ratio, a payback window,
    // several dollar spend ranges, several improvement-percentage
    // ranges, a percentage-point NRR shift, a sprint-length range) with
    // NO provenance attached to most of them -- none were supplied by
    // the user, so an unlabeled number reads as a verified fact about
    // this specific business when it is really a planning assumption,
    // an illustrative benchmark, or an approximate estimate. Broadened
    // the field scope beyond Recommended Actions/Final Recommendation
    // (Decision Assessment, Financial Implications, and Scenario
    // Analysis carry the same numbers just as often), and replaced "the
    // first time it appears" with an explicit requirement that the
    // label sit in the SAME clause or sentence as the number itself --
    // never only once, early, or in a separate disclaimer paragraph.
    "Every numeric threshold, budget, spend range, timeframe, or improvement figure named anywhere in Decision Assessment, Financial Implications, Scenario Analysis, Recommended Actions, or the Final Recommendation must carry its provenance directly next to that number, in the same clause or sentence -- never only as a disclaimer elsewhere in the field, and never left completely unlabeled. If the user directly stated it, or it is mathematically derived from a figure the user stated, mark it Verified and name the user's own figure it comes from. If it rests on a real external reference (a named industry report, a comparable-company figure, or an [R#] registry entry), mark it Benchmark and name that reference. If you constructed it yourself as a planning input to build a scenario, mark it Assumption. If it is your own approximate cost, duration, or impact figure with no external reference, mark it Estimated. For example: 'Planning assumption: use a >=20% CAC reduction as the initial re-acceleration gate.' or 'Illustrative benchmark -- verify for this specific segment: an LTV/CAC of 3 or higher.' or 'Estimated implementation cost: $10-30k.' Never state a Benchmark, Estimated, or Assumption figure as if it were a verified fact about this specific user's own business.",
    "Give material factual claims inline provenance (an asset filename, an [R#] registry reference, or a named method) where it strengthens trust; do not force provenance onto claims that do not need it.",
    "Never invent numeric values, sources, professional conclusions, legal status, accounting treatment, prices, or operational findings.",
    "Read Domain Findings, Regulatory/Compliance, Financial Implications, Operational Implications, and Risk Analysis as one continuous argument, each building on what the last one established, ending in the Recommendation. Do not write any of them as an isolated observation disconnected from that chain.",
    "When a fact could not be verified, do not write a bare 'not verified' notice. Instead: name the exact source or document required, explain briefly why that specific gap matters to this decision, state what proxy or adjacent evidence stands in for it if any, and say what part of the decision stays open until it is resolved. Vary this explanation to the specific fact each time.",
    ...buildUniversalDecisionQualityDirectives(),
    ...insightLedgerAndTokenBudgetDirectives,
    ...buildExecutiveConsultingStyleDirectives(),
    ...buildExecutivePresentationDirectives("specialized_analysis"),
    "Use short paragraphs and compact bullets for any list of three or more items; avoid walls of unbroken text.",
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
