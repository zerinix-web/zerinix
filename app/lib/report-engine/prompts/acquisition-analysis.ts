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
// CRITICAL QUALITY FIX -- improve acquisition analysis depth without
// restoring internal metadata. Confirmed live: several fields (Strategic
// Fit, Debt Capacity, ROI Analysis in particular) were collapsing into a
// bare "Additional information is needed" instead of doing the analysis
// that IS possible from the verified deal facts alone. Every field prompt
// below now names its own required sub-structure explicitly (matching a
// premium strategic advisor's actual deliverable shape, not a generic
// template), and repeatedly distinguishes Known facts (from the
// deterministic deal-facts context) from Derived insights (reasoned from
// those facts) from Assumptions (explicitly labeled, never presented as
// fact) -- so a field with only a handful of verified numbers still
// produces real analysis instead of an empty placeholder.
export const acquisitionAnalysisPrompts = {
  executiveAcquisitionSummary:
    "Write a real executive recommendation, not a generic hold/wait placeholder. Never output only the single word 'Wait' (or 'Proceed' or 'Pause') as this field's entire content -- that verdict word belongs in the Final Investment Recommendation field, not here, and this field must always carry the full structure below regardless of which way the deal leans. Structure it as five short parts, each its own paragraph or tight block: (1) Transaction overview -- the target, transaction type, purchase price, and target ARR from the verified deal facts. (2) Main opportunity -- the single strongest reason this acquisition could work, woven from real strategic reasoning: sector/market fit (e.g. how an AI or cybersecurity target fits the acquirer's own market position, when the sector is known), the strength of the target's enterprise customer base, the quality of its recurring revenue (what the ARR and customer count together imply about predictability, without inventing a churn or retention rate that was not provided), and the acquisition rationale this specific target offers over a generic deal in its sector. (3) Main risks -- the two or three risks that most affect the decision, not a generic risk list. (4) Preliminary recommendation -- Proceed with Conditions, Pause Pending Review, or Reject, stated plainly and matching the same vocabulary used in the Final Investment Recommendation. (5) Conditions before closing -- the specific items (e.g. financial statements, customer contracts, security assessment) that must be reviewed before the recommendation becomes final. Identify the target, transaction type (asset purchase, stock purchase, merger), and parties without inventing absent identifiers -- a board-level summary of the deal, never a startup elevator pitch.",
  targetCompanyOverview:
    "Describe the target company: business, operations, customers, and financial profile, extracted from uploaded assets and the user's own statements. Lead with every verified deal fact supplied in the deterministic deal-facts context (purchase price, target ARR, customer count, employee count, buyer available capital, financing structure) exactly as given. Separate readable evidence from ambiguous or missing data.",
  externalEvidence:
    "Synthesize the completed external research -- comparable M&A transactions, industry benchmarks, regulatory considerations, and market data relevant to this deal's sector and jurisdiction -- prioritizing official and primary sources. If no relevant external evidence was returned, say so explicitly and continue the analysis using the verified deal facts and derived metrics; never leave this field empty or block the report. Every claim must cite an evidence registry ID.",
  strategicFit:
    "Never write only 'Additional information is needed' -- use the verified deal facts (sector, target ARR, enterprise customer count, employee count) to do real analysis, and be explicit about which parts of it are which: Known facts (the verified deal facts themselves), Derived insights (what those facts imply, reasoned out loud), and Assumptions (anything inferred beyond the verified facts, explicitly labeled as an assumption, never presented as fact). Cover, using whichever of these the target's actual sector and facts support: market/sector fit (e.g. how an AI/cybersecurity target fits the acquirer's own market position, when the sector is known), the strength and quality of the target's enterprise customer base and its recurring-revenue profile (customer count, ARR, and what a recurring-revenue business model implies for retention and predictability -- without inventing a churn or retention rate that was not provided), the strategic advantages this specific target offers over a generic acquisition in its sector, and integration considerations (org size implied by employee count, likely integration complexity). Write real, deal-specific analysis grounded in the target's actual profile -- never a generic statement that could apply to any acquisition.",
  valuationAnalysis:
    "Assess valuation using EV/ARR (or the appropriate revenue/earnings multiple), comparable transactions, and the implied purchase multiple, then assess whether the purchase price is fair given that valuation and the target's verified financial profile. When the deterministic deal-facts context provides a computed EV/ARR, state it exactly as given and do not recompute it independently or state a different multiple. Then interpret it, not just state it: explain in plain language what this multiple means for a company of the target's scale and sector (e.g. whether it reads as attractive, full, or expensive relative to typical SaaS/technology multiples), name the specific factors that would make it attractive (e.g. a large, sticky enterprise customer base for the ARR level) or expensive (e.g. thin visibility into margin or growth), and state plainly what financial data is still needed to fully validate the multiple (e.g. EBITDA, gross margin, revenue growth rate, or customer churn) without inventing any of those figures. Never invent a multiple, comparable transaction, or price figure that was not supplied or researched.",
  financingStructure:
    "Assess the proposed or likely financing structure for this acquisition (cash, stock, debt, or a combination) and its implications for the acquirer. When the deterministic deal-facts context provides a computed equity contribution, debt requirement, or debt/equity split, state those figures exactly as given and do not recompute them independently. Then assess the structure itself: leverage considerations (what the debt share of the purchase price implies about the combined entity's leverage), financing risk (what could make this financing structure harder to execute or service -- e.g. rate sensitivity, covenant risk, or a thin equity cushion), and repayment considerations (what would need to be true about the target's cash generation for the debt to be serviceable, without inventing a specific cash-flow or EBITDA figure that was not provided).",
  debtCapacity:
    "Never leave this field empty or reduce it to a bare unavailability notice. State plainly that debt capacity cannot be fully determined without EBITDA and cash-flow data, since debt capacity is normally sized against a multiple of EBITDA or free cash flow -- neither of which was provided here. Then be useful anyway: name the specific financial statements or figures needed to determine it properly (e.g. trailing-twelve-month EBITDA, historical cash flow statements, existing debt schedules), and explain how debt risk should be evaluated once they are available (e.g. debt service coverage against free cash flow, leverage multiple versus sector norms, covenant headroom) using the derived debt requirement and debt share of purchase price from the deal-facts context as the starting point for that evaluation.",
  roiAnalysis:
    "Never leave this field as a bare 'additional information needed' notice. Provide evidence-based ROI scenarios (downside, base, upside), structured in four parts: (1) What can be calculated from the verified deal facts alone -- e.g. the implied EV/ARR multiple and what purchase-price-to-revenue payback would look like under a stated, clearly-labeled illustrative revenue-retention assumption (label it as an assumption, not a fact). (2) What cannot be calculated without further data -- a return/IRR figure requires cash-flow timing, margin, and an exit assumption, none of which are available. (3) The specific inputs still missing (EBITDA or operating margin, revenue growth rate, customer churn/retention rate, projected cash flow, expected exit multiple or holding period). (4) Directionally reasoned downside/base/upside scenarios built ONLY from the verified purchase price, ARR, and financing split, each one explicit about which of its own inputs are assumptions rather than verified facts. Do not invent EBITDA, margins, growth rates, churn, or cash flow figures anywhere in this field, even to fill in a scenario -- state their absence plainly instead.",
  irrAnalysis:
    "Provide an IRR estimate only when enough information exists to compute it (cash flow timing, exit assumption, holding period). When it cannot be computed, do not leave a bare unavailability notice: state plainly which of those specific inputs are missing, and what would need to be established (e.g. a holding-period assumption and an exit-multiple assumption, explicitly labeled as assumptions if used for illustration) to produce a defensible estimate. Never invent cash flow, EBITDA, margin, or exit-multiple figures to force a number.",
  revenueSynergies:
    "Assess revenue synergies using real acquisition reasoning grounded in the target's actual customer base and product line, covering: cross-sell opportunities (what each side's product could sell into the other's customer base), customer expansion (upsell and expansion potential within the target's existing enterprise customer base, given its ARR and customer count), and product portfolio fit (how the target's product line complements or extends the acquirer's own portfolio). Name the mechanism and its supporting rationale for each -- do not invent revenue numbers; a synergy is a reasoned opportunity, not a dollar figure, unless a real supporting figure was provided or researched.",
  costSynergies:
    "Assess cost synergies using real acquisition reasoning grounded in the target's actual headcount and operating profile, covering: infrastructure consolidation (systems, platform, and facility overlap that could be consolidated), operational efficiency (redundant functions or processes that could be streamlined post-close, given the target's employee count), and procurement leverage (vendor and contract consolidation opportunities from the combined entity's purchasing scale). Name the mechanism and its supporting rationale for each -- do not invent savings amounts; a synergy is a reasoned opportunity, not a dollar figure, unless a real supporting figure was provided or researched.",
  integrationRisks:
    "Provide real, deal-specific analysis across each of these dimensions, using the target's actual scale (employee count, customer count, sector) wherever it changes the analysis -- never a generic risk list: technology integration (systems, platform, and data consolidation complexity implied by the target's likely tech stack for its sector), cultural integration (working-style and organizational-culture friction implied by the target's size and sector), customer retention (concentration and switching risk within the target's enterprise customer base during the transition), employee retention (key-person and broader retention risk implied by the target's employee count and any likely overlap with the acquirer's own team), security architecture and security operations (for a technology or cybersecurity target specifically, data-handling, access-control, security-posture integration risk, and how the two organizations' security operations and incident-response processes would be unified), and operational alignment (process, tooling, and org-design friction between the two organizations). For a technology or cybersecurity target, explicitly assess security architecture, security operations, and data-handling integration risk.",
  operationalRisks:
    "Assess operational risks distinct from integration: supply chain, key operational dependencies, customer/vendor concentration, and delivery continuity risk during and after the transition. When the target's enterprise customer count is known, assess customer-concentration and retention risk against it specifically.",
  regulatoryReview:
    "Assess antitrust, competition, and sector-specific regulatory approval considerations that could affect deal timing or feasibility, grounded only in the research actually completed -- never fabricated. For an EU or Germany-based target, explicitly address EU competition/merger-control review and, when the target handles personal data or operates in a regulated sector, GDPR and any applicable sector-specific regime (e.g. DORA, BaFin supervision) -- only when the deal's actual jurisdiction and sector make them applicable, never as a generic checklist for a deal they do not apply to.",
  competitivePosition:
    "Assess the combined entity's competitive position after the acquisition: market share shift, competitor response, and durability of the advantage gained.",
  dealRisks:
    "Rank material deal risks (beyond integration and operations) by mechanism, likelihood, consequence, and mitigation, grounded in what has actually been reviewed -- including key-person risk, customer concentration, contingent liabilities, and litigation exposure where documented.",
  postMergerIntegrationPlan:
    "Provide a real, deal-specific post-merger integration plan sequenced across the first 30, 60, and 90 days after closing, with an owner and a concrete milestone for each major step -- never a generic template. Cover at minimum: Days 1-30 -- financial validation (verifying the target's financial statements and figures against what was assumed at signing), customer contract review, a security assessment, and an employee retention plan for key staff. Days 31-60 -- technology integration, operating-model alignment (org design, process, and tooling), and customer strategy (how the combined entity will serve and grow the target's existing customer base). Days 61-90 -- synergy tracking against the revenue and cost synergies identified elsewhere in this report, a unified go-to-market roadmap, and a KPI review to confirm the deal is tracking to plan. Adapt and extend this structure with steps specific to the target's actual sector, size, and the deal's own facts -- do not just restate this list verbatim.",
  missingInformation:
    "List unresolved critical facts. For each: why it specifically matters to this acquisition decision, what proxy or adjacent information was used in its place if any, how its absence changed confidence, and what part of the decision cannot be finalized until it is resolved. Vary the explanation to the actual fact each time -- never reuse the same sentence shape across items.",
  finalInvestmentRecommendation:
    "Write this as a board investment memo's own verdict line, not an internal AI validation report and never a bare 'Preliminary recommendation: Wait'. Never output only the words 'Pause Pending Review', 'Reject', or 'Proceed with Conditions' as this field's entire content -- a board-level recommendation always names its call AND one clear sentence explaining why. State the call as one of exactly three phrases -- Proceed with Conditions, Pause Pending Review, or Reject -- based on the current information available, immediately followed by one sentence naming the single biggest reason for that call, in language a board would use in a Monday decision meeting -- not a restatement of findings. Then, in one or two further sentences: when the call is Proceed with Conditions, name the specific conditions (e.g. what must be reviewed or resolved before or alongside proceeding); when it is Pause Pending Review, name the specific review still pending and what would resolve it; when it is Reject, name the specific, material finding that makes the deal unworkable as currently structured. Ground the reasoning in the deal's own facts and risks, not a bare confidence score. Name the one condition that would change the call. Never overstate certainty, never pad with generic caution language, and never restate findings already established earlier in the report -- only their decision implication belongs here.",
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
    "You are the ZERINIX M&A due-diligence and corporate development analyst. Assess the target company as an acquisition, not a startup pitch -- ground valuation, financing, and integration findings in the deal's own facts and comparable-transaction data.",
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
    "This is an Acquisition Due Diligence Report for a company being acquired, not a startup pitch, business plan, legal case assessment, or general strategic report. Never write any of the following Business Plan/Startup sections or their content, under any heading: Problem, Solution, ICP, TAM/SAM/SOM, Pricing Strategy, Go-To-Market, Sales Strategy, Founder Roadmap, Founder Readiness, Startup KPIs, Business Validation, Product Validation, Founder Validation, GTM Validation, Startup Validation Metrics, Unit Economics (CAC/LTV/ARR/MRR) framework, CAC Payback, Customer Acquisition Cost framework. Those are startup-pitch concepts that do not apply to acquiring an already-operating company.",
    "Never invent startup operating metrics -- burn rate, runway, churn, ARR growth, or revenue projections -- unless the user explicitly provided the figure or it is clearly labeled 'Planning Assumption'. Figures the user or research provided about the target company (including its real ARR, Revenue, EBITDA, Gross margin, or Cash flow, when used for EV/ARR valuation or financing analysis) are legitimate acquisition inputs and must be preserved exactly, not withheld.",
    // CRITICAL FIX -- separate legitimate acquisition metrics from
    // Business Plan leakage. CAC and LTV are a startup unit-economics
    // TEMPLATE, not evidence-grounded acquisition vocabulary like ARR/
    // EBITDA/EV-ARR -- confirmed live, the report was still framing
    // financial findings as "Unit economics (CAC/LTV/ARR/MRR) indicates
    // ..." even when the user supplied a real CAC or LTV figure. Named
    // once, explicitly, with the allowed vocabulary and a concrete before/
    // after rewrite so there is no ambiguity for the model.
    "CAC (Customer Acquisition Cost), LTV (Lifetime Value), CAC payback, and any 'unit economics' framing are a startup Business Plan template -- never write them anywhere in this report, even if the user or research supplied a figure for one of them. This report's legitimate financial vocabulary is: ARR, Revenue, EBITDA (only if provided or clearly marked a Planning Assumption), Gross margin (only if provided or clearly marked a Planning Assumption), Cash flow, Purchase price, EV/ARR, ROI, IRR, Debt service, and Financing structure -- use these instead of a unit-economics framework. For example, never write \"Unit economics (CAC/LTV/ARR/MRR) indicates strong retention...\" -- write \"Based on the available purchase price and ARR, the transaction implies a 4.0x EV/ARR multiple\" instead.",
    `Never use startup-pitch or venture-validation vocabulary anywhere in this report, including: ${getForbiddenTermLabels("acquisition_due_diligence").join(", ")}. This is an acquisition of an existing business, not a startup being pitched or validated -- do not introduce founder scoring, product-market fit, startup execution scoring, or a build/don't-build recommendation.`,
    "Read Strategic Fit, Valuation Analysis, Financing Structure, Debt Capacity, ROI Analysis, IRR Analysis, Revenue Synergies, Cost Synergies, Integration Risks, Operational Risks, Regulatory Review, Competitive Position, and Deal Risks as one continuous argument, each building on what the last one established, ending in the Post-Merger Integration Plan and the Final Investment Recommendation. Do not write any of them as an isolated observation disconnected from that chain.",
    "When a fact could not be verified, do not write a bare 'not verified' notice. Instead: name the exact source or document required, explain briefly why that specific gap matters to this decision, state what proxy or adjacent information stands in for it if any, and say what part of the decision stays open until it is resolved. Vary this explanation to the specific fact each time.",
    // CRITICAL QUALITY FIX -- improve acquisition analysis depth without
    // restoring internal metadata. Confirmed live: several fields
    // collapsed into an internal-reasoning-sounding placeholder phrase
    // instead of real analysis ("More evidence required.", "Additional
    // verification required.", "Need authoritative source."). These read
    // as system/pipeline language, not something a strategic advisor
    // would say to a client -- named explicitly, once, with the required
    // replacement phrasing, so there is no ambiguity for the model.
    "Never write 'More evidence required', 'Additional verification required', 'Need authoritative source', 'Additional information is needed', or any similarly bare, internal-sounding placeholder phrase anywhere in this report -- those read as system or pipeline language, not something a strategic advisor would say to a client. This applies to every field, not only the ones that name the phrase explicitly. Instead, always name the specific thing that still needs review and frame it as a next action a client would actually take: 'Further review is recommended for [specific item]...' or 'Management should validate [specific item] before...' -- naming the exact item (e.g. the target's EBITDA, customer contracts, security posture), never a vague, unnamed reference.",
    // CRITICAL ACQUISITION CONTENT FIX -- confirmed live: sections came
    // back too empty, and some fields were reduced to a bare cross-
    // reference sentence instead of real analysis.
    "Every field must contain substantive, deal-specific analysis of at least several sentences grounded in the verified deal facts, derived metrics, uploaded assets, and research provided. Never write a bare cross-reference such as 'see [section] for the established premise' or similar -- state each field's own distinct analysis and decision implication, even when it draws on the same underlying facts as another field. A short cross-reference is acceptable only to avoid repeating an identical paragraph verbatim, and even then must be followed by the field's own new analysis, never stand alone as the entire field.",
    "When the deterministic deal-facts context in the input supplies verified facts or derived metrics, use those exact figures and exact [Verified]/[Derived] labels wherever they are relevant to a field -- never recompute a derived metric to a different value, never relabel a Derived figure as Verified or a Verified figure as Derived, and never omit a relevant supplied figure.",
    // CRITICAL FIX -- preserve user-provided acquisition facts as
    // authoritative inputs. Confirmed live: the target's enterprise
    // customer count and employee count were both present in the
    // deal-facts context as [Verified], and the report still described
    // them as unverified -- a fact the deal-facts context marks Verified
    // must never be walked back into a caveat anywhere else in the same
    // report.
    "A fact the deterministic deal-facts context marks [Verified] -- including the target's enterprise customer count and employee count -- is a known user-provided input, not something still awaiting confirmation. Never describe a [Verified] figure as unverified, missing, unknown, or requiring verification anywhere in the report, even in a different field from the one where the figure first appears. Reserve 'unverified'/'requires verification'/'further review is recommended' language strictly for facts the deal-facts context does NOT supply.",
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
