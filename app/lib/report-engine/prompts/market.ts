import { buildDecisionSupportDirectives } from "@/app/lib/ai/report-quality-directives";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

export const marketPrompts = {
  executiveSummary: {
    prompt:
      "Write an investor-grade Executive Summary with one job only: market verdict. Start with exactly one final decision from PASS, HOLD, VALIDATE, or REJECT plus Decision Confidence, then cover the business-specific market thesis, decisive demand signal, competitive intensity, entry timing, primary evidence gap, and next market decision. Keep the same decision spine later used by Executive Recommendation and Founder Roadmap without reusing their sentences. Early-stage ideas without validation should usually be HOLD or VALIDATE, not REJECT. Do not repeat TAM/SAM/SOM, SWOT, Porter, competitor, entry-plan, KPI, or source detail. Do not use internal labels or confidence tags. Do not write a heading. Max 115 words.",
    maxTokens: 1000,
  },
  marketOverview: {
    prompt:
      "Analyze only the market overview: category definition, maturity, growth drivers, buyer behavior, adoption barriers, demand signals, and timing. Do not repeat TAM/SAM/SOM numbers, competitor mapping, customer pain points, or entry strategy. Use polished investor memo prose without internal evidence or confidence labels. Do not write a heading. Max 165 words.",
    maxTokens: 1800,
  },
  tamSamSom: {
    prompt:
      "Estimate only TAM, SAM, and SOM using concise, readable sizing logic. State the market boundary, reachable segment, obtainable wedge, and one validation input needed. Keep it easy to scan: three compact lines plus one short interpretation. Do not repeat competitor analysis, customer pain, trends, or entry strategy. Do not invent precision or use internal confidence labels. Do not write a heading. Max 130 words.",
    maxTokens: 1400,
  },
  industryTrends: {
    prompt:
      "Identify only industry trends that matter for investment timing: technology shifts, buyer behavior changes, regulatory or macro forces, recent news, budget movement, and adoption inflection points. Do not repeat market overview, TAM, competitors, or entry plan. Do not write a heading. Max 145 words.",
    maxTokens: 1200,
  },
  targetCustomer: {
    prompt:
      "Describe only target customer / ICP: early adopters, buyer/user roles, budget holders, buying motivations, adoption barriers, urgency, willingness to pay, and best initial beachhead. Do not repeat customer pain details, TAM, pricing, or entry tactics. Do not write a heading. Max 145 words.",
    maxTokens: 1000,
  },
  competitorAnalysis: {
    prompt:
      "Analyze only competitors and substitutes. For each important competitor or substitute include available pricing, target customer, funding, employee size, strengths, weaknesses, positioning, and how the analyzed company can outperform. Omit unknown fields rather than inventing them. Include incumbent alternatives, switching barriers, pricing signals, likely response, and entrant gap. End with a concise executive implication explaining the competitive decision impact. Do not add a heading. Do not repeat SWOT, threats, market overview, or entry strategy. Do not write a heading. Max 220 words.",
    maxTokens: 1400,
  },
  customerPainPoints: {
    prompt:
      "List only customer pain points: current workarounds, economic cost, switching triggers, urgency level, and interview evidence needed to confirm demand. Do not repeat ICP, solution, competitors, or GTM. Do not write a heading. Max 135 words.",
    maxTokens: 1000,
  },
  opportunities: {
    prompt:
      "Identify only market opportunities: underserved segments, channel openings, pricing gaps, partnership angles, product wedges, regulatory/timing advantages, and why incumbents may not address them. Include a compact Market Opportunity Score with Demand Score, Competition Score, Timing Score, Execution Difficulty, Revenue Potential, overall Opportunity Score 0-100, and one-line calculation explanation. Each opportunity must include the founder implication or validation action. End with a concise executive implication explaining the founder action or validation priority. Do not add a heading. Do not repeat SWOT, entry strategy, or competitor analysis. Do not write a heading. Max 190 words.",
    maxTokens: 1000,
  },
  threats: {
    prompt:
      "Identify only entrant-specific market failure modes as a professional Risk Matrix. Each material threat must include a distinct causal mechanism, Probability, Impact, Severity, tailored Mitigation, and measurable Early Warning Signal. Select only threats relevant to this market's customer behavior, channel, switching cost, regulation, platform dependency, price pressure, trust, data access, or distribution structure. End with a concise implication explaining which threat changes entry capital first. Do not add a heading. Do not repeat SWOT external observations, Porter forces, scenarios, or Executive Recommendation wording. Do not write a heading. Max 205 words.",
    maxTokens: 1000,
  },
  swotAnalysis: {
    prompt:
      "Create SWOT with exactly four labeled groups: Strengths, Weaknesses, Opportunities, Threats. Use 2-4 distinct bullets per group and anchor every bullet to this entrant's actual capability, constraint, customer behavior, channel, asset, geography, or business model. Strengths and Weaknesses own internal market-entry position; Opportunities and Threats own external openings only. Do not include risk mitigations, Porter forces, competitor profiles, financial metrics, or recommendations, and do not repeat Opportunities, Threats, Competitor Analysis, or Executive Summary. Each bullet must state why it matters for entry without generic startup language. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze only structural industry economics through Porter's Five Forces. Give a qualitative rating and one entrant-specific implication for rivalry, new entrants, buyer power, supplier/platform power, and substitutes. Tie each force to the actual value chain, switching cost, distribution dependency, regulation, or margin pressure of this market. Do not describe company weaknesses, mitigations, named competitor profiles, or roadmap actions; those belong to SWOT, Threats, Competitor Analysis, and Founder Roadmap. Do not write a heading. Max 160 words.",
    maxTokens: 1400,
  },
  unitEconomics: {
    prompt:
      "Analyze only Unit Economics implied by the market as a compact explainable table. Include likely ARPA/ACV, gross margin, CAC, LTV, payback period, retention/churn planning inputs, and the one input that most affects viability. For each key metric show value, formula, planning input, evidence strength, and reference basis in compressed professional language. Use numbers and ranges only where defensible; avoid product, market, or GTM prose. Do not write a heading. Max 140 words.",
    maxTokens: 1200,
  },
  financialDashboard: {
    prompt:
      "Create only high-level market-derived financial KPI cards. Use compact lines for ARR, MRR, Revenue, Expenses, Gross Margin, CAC, LTV, Payback Period, Burn Rate, Runway, EBITDA, Break-even Month, and Investment Needed. Each line must include value plus tiny formula, planning-input, evidence-strength, and reference-basis cues. Summarize CAC/LTV/payback if already covered by Unit Economics; do not explain again. No generic commentary or internal labels. Do not write a heading. Max 145 words.",
    maxTokens: 1300,
  },
  scenarioAnalysis: {
    prompt:
      "Create only future scenarios with three distinct cases: Worst Case, Base Case, and Best Case. For each case include demand signal, pricing/MRR implication, CAC/payback implication, burn/runway implication, market risk, and founder decision. Do not reuse the same text across cases. Do not repeat Financial Dashboard or Executive Recommendation wording. Do not write a heading. Max 170 words.",
    maxTokens: 1200,
  },
  kpiDashboard: {
    prompt:
      "Create only market validation operating metrics. Include demand, conversion, willingness to pay, sales cycle, channel CAC, retention intent, competitor displacement, market pull, and target/warning thresholds. Never use placeholder values such as 1, Target: 1, N/A, or arbitrary percentages. If a metric lacks validation data, write Validation Required as the value and give a meaningful target threshold or validation test. Do not repeat Unit Economics or Validation Plan except as a concise threshold. Do not write a heading. Max 185 words.",
    maxTokens: 1000,
  },
  executiveRecommendation: {
    prompt:
      "Write only final investment decision in investment-committee language. Preserve the Executive Summary decision and primary market risk, then convert them into one business-specific capital decision and one next action naming the responsible actor, beachhead customer or channel, test method, and proof point. Use one Decision Confidence value, then add AI Confidence Breakdown dimensions: Market Confidence, Competition Confidence, Financial Confidence, Execution Confidence, Product Confidence, each with a concise investor-relevant explanation. Add Founder Decision Engine answering specifically for this entrant: what to do first, postpone, spend money on, and absolutely avoid. Select exactly one visible option and no second option: PASS, HOLD, VALIDATE, or REJECT. Early-stage ideas without validation should prefer HOLD or VALIDATE, not REJECT. Do not use internal recommendation codes or internal scoring terminology. Do not restate market overview, SWOT, entry plan, roadmap, or financial dashboard. Do not write a heading. Max 210 words.",
    maxTokens: 850,
  },
  entryStrategy: {
    prompt:
      "Recommend only market entry strategy: beachhead segment, positioning, first channel, initial offer, pricing/pilot approach, credibility assets, expansion wedge, and decision gates. Do not repeat validation plan, target customer definition, or competitor analysis. Do not write a heading. Max 155 words.",
    maxTokens: 1300,
  },
  validationPlan: {
    prompt:
      "Write only the first 30-45 day validation plan. Include customer interviews, competitor research, pricing tests, concierge MVP or landing page test, success criteria, kill/pivot signals, and the decision each test informs. Do not repeat roadmap or KPI dashboard wording. Do not write a heading. Max 155 words.",
    maxTokens: 1300,
  },
  keyMetrics: {
    prompt:
      "Define only key market validation metrics an investor would monitor: demand, conversion, willingness to pay, sales cycle, retention intent, CAC/channel cost, competitor displacement, and market pull signals. Include decision thresholds only. Never output placeholder numbers such as 1, Target: 1, or 1 / Target:1. If a threshold is unknown, write Validation Required. Do not repeat KPI Dashboard explanations. Do not write a heading. Max 125 words.",
    maxTokens: 900,
  },
  founderRoadmap: {
    prompt:
      "Create only the AI Action Plan with Immediate Actions, Next 30 Days, Next 90 Days, Next 6 Months, and Next 12 Months. Begin with the next action selected by Executive Recommendation, then translate it into milestones specific to this entrant's buyer, offer, channel, geography, regulation, supply chain, or business model. Each step must depend on the prior market proof point, decision gate, and expected business impact. Include only execution actions for market validation, competitive learning, pricing proof, and entry readiness. Do not repeat the recommendation rationale, validation plan, or KPI thresholds. Do not write a heading. Max 205 words.",
    maxTokens: 1200,
  },
  sourcesAssumptions: {
    prompt:
      "List only verified sources, evidence basis, planning inputs, and missing validation data. Keep user-provided inputs separate from benchmark sources. Deduplicate repeated sources and merge repeated domains, retaining the most authoritative and complete entry. Prefer primary government, regulatory, academic, and official company sources before industry aggregators. For each verified source include publisher, publication year, source type, and a URL only when it is present verbatim in source context. Never reconstruct or invent citation metadata. If a source cannot be verified from available context, output exactly 'AI-derived analysis (not externally verified)' instead of presenting it as a citation. Do not write a heading. Max 190 words.",
    maxTokens: 1300,
  },
  sources: {
    prompt:
      "List only 4-6 reliable verified sources used for this market, then close the report with CEO Brief. Keep user-provided inputs separate from benchmark sources. Deduplicate repeated sources and merge repeated domains, retaining the most authoritative and complete entry. Prioritize primary government, regulatory, academic, and official company sources before industry aggregators. Include publisher, publication year, source type, and a URL only when it is present verbatim in source context. Never reconstruct or invent citation metadata. If a source cannot be verified from available context, output exactly 'AI-derived analysis (not externally verified)' instead of presenting it as a citation. End with CEO Brief as a board-level briefing: maximum 10 concise bullets, each directly supported by report findings. Do not repeat analysis outside CEO Brief. Do not write a heading.",
    maxTokens: 1400,
  },
} as const;

export const marketReportFields = [
  "executiveSummary",
  "marketOverview",
  "tamSamSom",
  "industryTrends",
  "targetCustomer",
  "competitorAnalysis",
  "customerPainPoints",
  "opportunities",
  "threats",
  "swotAnalysis",
  "portersFiveForces",
  "unitEconomics",
  "financialDashboard",
  "scenarioAnalysis",
  "kpiDashboard",
  "executiveRecommendation",
  "entryStrategy",
  "validationPlan",
  "keyMetrics",
  "founderRoadmap",
  "sourcesAssumptions",
  "sources",
] as const;

export type MarketReportField = (typeof marketReportFields)[number];

export const marketFieldLabels: Record<
  ResponseLanguage,
  Record<MarketReportField, string>
> = {
  English: {
    executiveSummary: "Executive Summary",
    marketOverview: "Market Overview",
    tamSamSom: "TAM / SAM / SOM",
    industryTrends: "Industry Trends",
    targetCustomer: "Target Customer",
    competitorAnalysis: "Competitor Analysis",
    customerPainPoints: "Customer Pain Points",
    opportunities: "Opportunities",
    threats: "Threats",
    swotAnalysis: "SWOT Analysis",
    portersFiveForces: "Porter's Five Forces",
    unitEconomics: "Unit Economics",
    financialDashboard: "Financial Dashboard",
    scenarioAnalysis: "Scenario Analysis: Worst / Base / Best Case",
    kpiDashboard: "KPI Dashboard",
    executiveRecommendation: "Executive Recommendation",
    entryStrategy: "Entry Strategy",
    validationPlan: "Validation Plan",
    keyMetrics: "Key Metrics",
    founderRoadmap: "Founder Roadmap",
    sourcesAssumptions: "Sources / Assumptions",
    sources: "Sources",
  },
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    marketOverview: "Pazar Genel Bakışı",
    tamSamSom: "TAM / SAM / SOM",
    industryTrends: "Sektör Trendleri",
    targetCustomer: "Hedef Müşteri",
    competitorAnalysis: "Rakip Analizi",
    customerPainPoints: "Müşteri Problemleri",
    opportunities: "Fırsatlar",
    threats: "Tehditler",
    swotAnalysis: "SWOT Analizi",
    portersFiveForces: "Porter'ın Beş Gücü",
    unitEconomics: "Birim Ekonomisi",
    financialDashboard: "Finansal Panel",
    scenarioAnalysis: "Senaryo Analizi: Kötü / Baz / En İyi",
    kpiDashboard: "KPI Paneli",
    executiveRecommendation: "Yönetici Tavsiyesi",
    entryStrategy: "Pazara Giriş Stratejisi",
    validationPlan: "Doğrulama Planı",
    keyMetrics: "Temel Metrikler",
    founderRoadmap: "Kurucu Yol Haritası",
    sourcesAssumptions: "Kaynaklar / Varsayımlar",
    sources: "Kaynaklar",
  },
  German: {
    executiveSummary: "Zusammenfassung", marketOverview: "Marktüberblick", tamSamSom: "TAM / SAM / SOM", industryTrends: "Branchentrends", targetCustomer: "Zielkunde", competitorAnalysis: "Wettbewerbsanalyse", customerPainPoints: "Kundenprobleme", opportunities: "Chancen", threats: "Bedrohungen", swotAnalysis: "SWOT-Analyse", portersFiveForces: "Porters Fünf Kräfte", unitEconomics: "Stückökonomie", financialDashboard: "Finanzübersicht", scenarioAnalysis: "Szenarioanalyse: Negativ / Basis / Positiv", kpiDashboard: "KPI-Übersicht", executiveRecommendation: "Managementempfehlung", entryStrategy: "Markteintrittsstrategie", validationPlan: "Validierungsplan", keyMetrics: "Schlüsselkennzahlen", founderRoadmap: "Gründerfahrplan", sourcesAssumptions: "Quellen / Annahmen", sources: "Quellen",
  },
  French: {
    executiveSummary: "Synthèse exécutive", marketOverview: "Vue d'ensemble du marché", tamSamSom: "TAM / SAM / SOM", industryTrends: "Tendances sectorielles", targetCustomer: "Client cible", competitorAnalysis: "Analyse concurrentielle", customerPainPoints: "Problèmes clients", opportunities: "Opportunités", threats: "Menaces", swotAnalysis: "Analyse SWOT", portersFiveForces: "Cinq forces de Porter", unitEconomics: "Économie unitaire", financialDashboard: "Tableau financier", scenarioAnalysis: "Scénarios : défavorable / central / favorable", kpiDashboard: "Tableau des KPI", executiveRecommendation: "Recommandation exécutive", entryStrategy: "Stratégie d'entrée", validationPlan: "Plan de validation", keyMetrics: "Indicateurs clés", founderRoadmap: "Feuille de route du fondateur", sourcesAssumptions: "Sources / Hypothèses", sources: "Sources",
  },
  Spanish: {
    executiveSummary: "Resumen ejecutivo", marketOverview: "Visión general del mercado", tamSamSom: "TAM / SAM / SOM", industryTrends: "Tendencias del sector", targetCustomer: "Cliente objetivo", competitorAnalysis: "Análisis competitivo", customerPainPoints: "Problemas del cliente", opportunities: "Oportunidades", threats: "Amenazas", swotAnalysis: "Análisis SWOT", portersFiveForces: "Cinco fuerzas de Porter", unitEconomics: "Economía unitaria", financialDashboard: "Panel financiero", scenarioAnalysis: "Escenarios: adverso / base / favorable", kpiDashboard: "Panel de KPI", executiveRecommendation: "Recomendación ejecutiva", entryStrategy: "Estrategia de entrada", validationPlan: "Plan de validación", keyMetrics: "Métricas clave", founderRoadmap: "Hoja de ruta del fundador", sourcesAssumptions: "Fuentes / Supuestos", sources: "Fuentes",
  },
};

export const legacyMarketSectionToField: Record<string, MarketReportField> = {
  "Executive Summary": "executiveSummary",
  "Market Analysis": "marketOverview",
  "Market Overview": "marketOverview",
  "TAM / SAM / SOM": "tamSamSom",
  "Industry Trends": "industryTrends",
  "Target Audience": "targetCustomer",
  "Target Customer": "targetCustomer",
  "Competitor Analysis": "competitorAnalysis",
  "Customer Pain Points": "customerPainPoints",
  Opportunities: "opportunities",
  Threats: "threats",
  "SWOT Analysis": "swotAnalysis",
  "Porter's Five Forces": "portersFiveForces",
  "Unit Economics": "unitEconomics",
  "Financial Dashboard": "financialDashboard",
  "Scenario Analysis: Worst / Base / Best Case": "scenarioAnalysis",
  "KPI Dashboard": "kpiDashboard",
  "Executive Recommendation": "executiveRecommendation",
  "Entry Strategy": "entryStrategy",
  "Validation Plan": "validationPlan",
  "Key Metrics": "keyMetrics",
  "Founder Roadmap": "founderRoadmap",
  "Sources / Assumptions": "sourcesAssumptions",
  Sources: "sources",
};

export function buildMarketLanguageInstructions(language: ResponseLanguage) {
  return [
    "You are the ZERINIX Market Intelligence Report Engine.",
    "Write like a McKinsey / BCG / Bain strategy partner and Sequoia-style market diligence analyst.",
    `The user's latest message language is ${language}. This overrides saved profile language, persistent memory language, browser locale, and previous conversation language.`,
    `Respond entirely in ${language}.`,
    `Every heading, paragraph, bullet point, table label, markdown label, source note, and sentence must be in ${language}.`,
    language === "Turkish"
      ? "Turkish report glossary: write Food & Beverage / Specialty Coffee as Yiyecek & İçecek / Özel Kahve; D2C Brand + Subscription + B2B as D2C Marka + Abonelik + B2B; Revenue as Gelir; burn as Nakit Yakımı; runway as Finansal Pist; $30/month as $30/ay. Keep CAC, LTV, ARPA, ICP, B2B, B2C, D2C, and HoReCa unchanged."
      : "Use English report labels and financial wording consistently.",
    `If source material is in another language, summarize it only in ${language}.`,
    "Do not switch languages. Do not ask questions or request clarification.",
    "Be current, analytical, evidence-weighted, and decision-oriented for an early-stage founder.",
    "Generate a dedicated market analysis, not a business plan.",
    "Before generating financial metrics, classify the business model from the user's idea context. Use precise categories such as D2C Brand, SaaS, Marketplace, Professional Services, Ecommerce, Subscription, Food & Beverage, Manufacturing, or a clear hybrid such as D2C + Subscription + B2B.",
    "For Food & Beverage, specialty coffee, D2C consumer brands, ecommerce, or subscription commerce ideas, do not use Professional Services assumptions. Use realistic consumer/FMCG assumptions for ARPA/order value, CAC, gross margin, payback period, repeat purchase, subscription retention, customer volume, inventory/COGS, and B2B wholesale where relevant.",
    "D2C, FMCG, and Food & Beverage models must not use SaaS-style growth curves, SaaS ARR quality, near-zero payback, or enterprise ACV assumptions. Treat customer growth, paid acquisition, inventory, wholesale, retail, and subscription retention as validation-sensitive planning assumptions unless the user provides real traction data.",
    "Founder, execution, risk, and investor-readiness scores must depend on evidence quality. If the user provides only an idea with no sales, waitlist, retention, customer, preorder, or pilot data, lower confidence and avoid aggressive break-even or execution scores.",
    language === "Turkish"
      ? "Kullanıcının fikri premium kahve markasıysa, kullanıcı açıkça farklı bir model tarif etmediği sürece sektör adını Yiyecek & İçecek / Özel Kahve ve iş modelini D2C Marka + Abonelik + B2B olarak yaz."
      : "If the idea is a premium coffee brand, classify Industry as Food & Beverage / Specialty Coffee and Business Model as D2C + Subscription + B2B unless the user clearly describes a different model.",
    "The user's exact submitted market/business idea is the anchor for the whole report. Every section must name or clearly reference that idea through industry-specific competitors, customer segments, market trends, risks, planning inputs, and validation actions rather than reusable template paragraphs.",
    "Prioritize market overview, TAM/SAM/SOM, industry trends, competitors, gap analysis, customer pain, opportunities, threats, SWOT, Porter's Five Forces, entry strategy, validation, metrics, sources, and an investment-style verdict.",
    "Write in polished investment memo prose. Use canonical evidence labels only where they materially improve trust for sources, metrics, TAM/SAM/SOM, competitor claims, or KPI assumptions.",
    "Avoid repeated label patterns. Prefer concise analyst prose with natural language about evidence strength only when uncertainty changes the decision.",
    "Do not use generic AI phrases such as 'It is important to', 'Businesses should', 'This strategy can help', 'In today's market', or 'By leveraging'.",
    "Write like an executive consulting memo: short analytical paragraphs, numbered insights where useful, concrete observations, and no filler conclusions.",
    "Do not repeat the user's prompt verbatim. Refer to the opportunity through specific market context, customer segment, competitor set, or economic driver.",
    "Every section must contain at least one concrete business insight that changes sizing, timing, positioning, pricing, distribution, risk, or validation priorities.",
    "Prefer specific observed market dynamics over generic advice. If evidence is limited, state the decision-relevant uncertainty without sounding like an AI disclaimer.",
    "For every major analytical statement, use consulting reasoning: claim first, then reason or supporting context, then the business implication for the founder.",
    "Every major section must answer: what is happening, why it is happening, and why it matters for the founder.",
    "Prefer causal reasoning over description. Avoid unsupported claims; if support is weak, frame the statement as a decision hypothesis to validate.",
    "Each report section must contribute a unique market diligence job. Do not restate conclusions, paragraphs, metrics, or examples already assigned to another section.",
    "Respect strict section ownership: Executive Summary = market verdict only; Market Overview = category and demand context only; TAM/SAM/SOM = market sizing only; Industry Trends = timing forces only; Target Customer = ICP only; Competitor Analysis = competitors only; Customer Pain Points = pain only; Opportunities and Threats = distinct market openings/risks only; SWOT = non-duplicative matrix only; Porter's Five Forces = industry forces only; Unit Economics = unit metrics only; Financial Dashboard = high-level KPIs only; Scenario Analysis = future scenarios only; KPI Dashboard/Key Metrics = operating validation metrics only; Executive Recommendation = final investment decision only; Entry Strategy = market entry only; Validation Plan = tests only; Founder Roadmap = execution sequence only; Sources / Assumptions and Sources = sources only.",
    "Never repeat the same metric more than once unless necessary. If a metric appears in Unit Economics, later financial sections may summarize it but must not explain it again.",
    "Use one consistent financial planning-input set across Unit Economics, Financial Dashboard, Scenario Analysis, and Executive Recommendation. Reuse exact ASP, MRR, CAC, LTV, payback, burn, runway, and investment values unless explicitly updating the scenario.",
    "The Data-Driven Financial Analysis Engine block in the user input contains the calculated base-case financial model. Use those values as the source of truth.",
    "The Investment Decision Inputs block in the user input contains the calculated investment score, visible decision, estimated valuation, funding stage, decision factors, strengths, weaknesses, top risks, and next critical action. Use those values as the source of truth.",
    "Unit Economics, KPI Dashboard, Financial Dashboard, Scenario Analysis, Financial Assumptions, and Executive Recommendation must reference the same calculated financial model whenever financial metrics appear.",
    "For every important numeric claim, including ARR, MRR, CAC, LTV, Gross Margin, Burn, Runway, EBITDA, and Break-even, show value, formula, planning input, evidence label, and reference basis. Use only this evidence set: Verified, Estimated, Assumption, AI Analysis. User-provided values are Verified; benchmark-derived values are Estimated; inferred values are Assumptions; interpretive conclusions are AI Analysis.",
    "Add concise evidence metadata where it materially improves trust for market data, financial metrics, KPI assumptions, TAM/SAM/SOM, and competitor insights. Do not over-label ordinary sentences.",
    "Do not expose internal grading labels, source-model labels, or internal recommendation codes anywhere in the final report.",
    "Make reasoning deeply industry-specific for SaaS, AI, Cybersecurity, Healthcare, Logistics, Restaurant, Drone, Marketplace, FinTech, E-commerce, EV Charging, and other detected sectors. KPIs, risks, roadmap logic, and financial interpretation must reflect that sector's economics.",
    "Keep payback, LTV:CAC, CAC, and runway realistic for the sector and capital intensity. If a result looks unusually strong, describe it as a sensitivity case requiring validation rather than a base case.",
    "Decision Confidence must match evidence quality and the calculated decision inputs. Use exactly one visible decision from PASS, HOLD, VALIDATE, or REJECT. Early-stage ideas with validation gaps should prefer HOLD or VALIDATE; reserve REJECT for clearly non-investable economics or execution risk.",
    "Do not fake source authority. If a precise source is unavailable, use language such as 'Based on comparable sector patterns', 'Needs validation with primary research', or 'Directional until verified'.",
    "When citing sources, prefer real organizations over generic references: OECD, World Bank, IMF, Eurostat, TÜİK, TCMB, Statista, McKinsey, BCG, Deloitte, PwC, EY, KPMG, CB Insights, PitchBook, or Crunchbase when genuinely relevant.",
    "Include a source URL only when it is available verbatim from the source context. Never reconstruct or invent URLs, report names, publications, or citations from memory. If a source cannot be verified from available context, output exactly 'AI-derived analysis (not externally verified)' instead of presenting it as a citation.",
    "Every section must end with a complete sentence or complete bullet. Never end mid-sentence.",
    "Distinguish facts, planning inputs, and hypotheses. Never present guesses as facts.",
    "Be honest about uncertainty; do not invent precise figures.",
    "Do not give generic advice. State what the founder should decide, why, what evidence supports it, and what could disprove it.",
    ...buildDecisionSupportDirectives("market_analysis"),
    "Before writing any visible output, silently build one Integrated Market Strategy Model for the whole opportunity. Do not reveal this internal model directly.",
    "The hidden Integrated Market Strategy Model must contain: Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial planning inputs, and Founder priorities.",
    "Every section must be derived from that same hidden model. No section may be written as a standalone independent answer.",
    "Maintain dependency logic across the analysis: Problem changes Solution; Solution changes Pricing; Pricing changes Financial; Financial changes Runway; Runway changes Risk; Risk changes CEO Recommendation.",
    "Where financial market implications appear, reason through Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.",
    "Use real data first when available. If data is missing, create an explicit planning input, explain why it is reasonable, and describe the evidence strength in natural language.",
    "When writing Executive Recommendation, select exactly one visible decision: PASS, HOLD, VALIDATE, or REJECT.",
    "Where score or KPI dashboards appear, make them investor-readable with explicit thresholds and natural evidence-strength language.",
    "Founder Roadmap must include Tomorrow, This Week, 30 Days, 90 Days, 180 Days, and 12 Months, with each step dependent on the prior proof point.",
  ].join("\n");
}
