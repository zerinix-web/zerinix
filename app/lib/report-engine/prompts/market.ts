import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import {
  buildExecutivePresentationDirectives,
  buildExecutiveConsultingStyleDirectives,
  buildUniversalDecisionQualityDirectives,
  insightLedgerAndTokenBudgetDirectives,
} from "../../ai/report-quality-directives.ts";
import { buildStrictReportLanguageInstruction } from "../../report-language.ts";
import { getForbiddenTermLabels } from "../report-isolation-validator.ts";

export const marketPrompts = {
  executiveSummary: {
    prompt:
      "Write an executive consulting deliverable answering the user's exact market question, not an AI response. Use exactly this structure: (1) Bottom Line -- 2-3 sentences opening with one executive verdict for the requested period. (2) Key Findings -- 3 to 5 bullets ranked by business impact, most decision-relevant first (growth signal, competitive intensity, structural drivers). (3) Biggest Opportunity -- one sentence naming the single highest-upside factor. (4) Biggest Risk -- one sentence naming the single most decision-changing uncertainty. (5) Recommendation -- at most 3 bullets, concrete next actions only. Interpret causal drivers and decision impact rather than listing facts. Use only supported market evidence. Do not introduce business-plan, founder, product, pricing-strategy, sales-strategy, or unit-economics content. No filler phrases, no generic AI phrasing, no repeated evidence-label tags on every line. Max 200 words.",
    maxTokens: 1300,
  },
  marketOverview: {
    prompt:
      "Define the market category, scope, value chain, maturity, who typically buys and why, and geographic boundaries. Explain what belongs inside and outside the analyzed market. Do not repeat sizing, segmentation, or trend detail. Write entirely in the report's own language -- never echo an English descriptive phrase from these instructions into the output. Max 180 words.",
    maxTokens: 1300,
  },
  marketSize: {
    prompt:
      "Present the best-supported historical and forecast market-size values, currencies, base years, forecast years, geographic scope, and source methodology. Reconcile differing definitions instead of blending incompatible figures. Never invent a value. If no verified figure exists for the exact requested scope, check whether adjacent-market benchmark data (Europe/OECD/global/regional data) is available before writing anything about unavailability: when at least one such benchmark exists, lead the section with a labeled estimate built from it -- state the benchmark figure and its real geography, state the specific scaling logic you are using (population, GDP, vehicle-fleet, or business-count ratio -- name which and why), give the resulting range for the requested market, and mark the whole derived figure [Estimated]. Only if no adjacent-market benchmark is available may you fall back to: (1) state plainly that a verified market-size figure could not be established and name the specific missing input; (2) state what can still be inferred from vendor/demand signals already in this report, labeled as inferred; (3) state how the gap affects decision confidence; (4) name the exact data source or research step that would close it. A named, sourced benchmark with a transparent scaling assumption is always a stronger analysis than declaring the section unavailable -- an executive can act on a labeled range; they cannot act on 'insufficient evidence'. Write for an executive reader: never use internal terms like 'evidence registry', 'adjacentBenchmarks', 'proxy', or 'evidence graph' -- describe estimates and benchmarks in plain business language. Max 200 words.",
    maxTokens: 1400,
  },
  cagr: {
    prompt:
      "State only defensible CAGR evidence for the requested period or the closest sourced period. Include the calculation basis, period, geography, and source. Explain material differences between published forecasts. Never derive false precision from unsupported endpoints. If no defensible CAGR exists for the requested period/geography, check whether adjacent-market benchmark data is available first: a parent-category or adjacent-geography (Europe/OECD/regional) growth rate can reasonably approximate the requested market's trajectory -- state it, mark it [Estimated], and explain in plain business language, entirely in the report's own language, why it reasonably applies here (same demand drivers, comparable maturity, or structurally linked category), without using internal terms like 'proxy', 'registry', or 'evidence graph'. Only when no such benchmark is available should you instead say so explicitly, name the missing input, state the confidence impact, and name what would need to be sourced. Max 150 words.",
    maxTokens: 1100,
  },
  marketSegmentation: {
    prompt:
      "Segment the market by the dimensions supported by evidence, such as offering, deployment, organization size, use case, industry, and buyer type. Explain which segments are largest, fastest growing, or most strategically relevant. Max 180 words.",
    maxTokens: 1300,
  },
  regionalAnalysis: {
    prompt:
      "Compare the requested regions using supported demand, adoption, regulation, investment, buyer maturity, and competitive-density evidence. Keep Europe and the United States distinct when both are requested. When the requested geography has thin evidence of its own, use adjacent-market benchmark data and any regional or global benchmark evidence to position it relative to comparable or neighboring markets -- name the comparator explicitly and label the read as directional, not a substitute for the requested geography's own verified figures. Max 190 words.",
    maxTokens: 1400,
  },
  industryTrends: {
    prompt:
      "Identify the structural technology, regulatory, procurement, data, and buyer-behavior trends that materially shape the forecast period. Explain why each trend matters to market direction. Draw on academic/independent-research and recent news evidence gathered for this market where it strengthens a trend claim beyond a generic assertion. Max 170 words.",
    maxTokens: 1200,
  },
  competitiveLandscape: {
    prompt:
      "Assess market structure, competitive intensity, positioning clusters, entry barriers, switching costs, and areas of convergence or differentiation. When the evidence supports them, compare multiple relevant competitors across independent domains and do not treat one issuer as representative of the whole market. Only discuss companies that genuinely operate in the requested market -- exclude any organization whose connection to the target market is incidental (e.g. media coverage, distribution, or unrelated industry presence) rather than direct competition. Do not substitute a business plan or go-to-market plan. Max 180 words.",
    maxTokens: 1300,
  },
  majorPlayers: {
    prompt:
      "Identify only evidence-supported major players that genuinely compete in the requested market -- never include an organization because its name appears in the evidence for an unrelated reason (media coverage, distribution, adjacent industry, or incidental mention). Rank the players you include by actual market relevance to the requested category, not by how often they appear in the evidence. Represent multiple competitors when distinct public evidence exists; for each, explain its market role, positioning, geographic strength, and differentiator. If the evidence for a genuine competitor is thin, say so explicitly rather than filling the section with a weaker or unrelated substitute. Omit unsupported revenue, valuation, funding, or customer claims. Max 200 words.",
    maxTokens: 1400,
  },
  customerSegments: {
    prompt:
      "Describe the principal customer segments, decision makers, use cases, adoption maturity, procurement patterns, and unmet needs visible in market evidence. Do not create an ICP or founder sales plan. Max 170 words.",
    maxTokens: 1200,
  },
  marketDrivers: {
    prompt:
      "Rank the demand, technology, regulation, cost, productivity, and organizational drivers that expand the market. Connect each driver to observable evidence and the forecast outlook. Max 160 words.",
    maxTokens: 1100,
  },
  barriers: {
    prompt:
      "Rank the adoption, data, trust, integration, regulation, procurement, skills, and budget barriers that constrain the market. Explain which barriers are structural and which may ease during the forecast period. Max 160 words.",
    maxTokens: 1100,
  },
  opportunities: {
    prompt:
      "Identify evidence-supported market white spaces, underserved segments, geographic openings, ecosystem gaps, and emerging use cases. Explain why each opportunity exists without turning it into a product or founder roadmap. Max 170 words.",
    maxTokens: 1200,
  },
  threats: {
    prompt:
      "Identify market-level threats including commoditization, platform concentration, regulation, data constraints, buyer resistance, substitute technologies, and forecast downside. Explain probability and strategic impact without inventing scores. Max 170 words.",
    maxTokens: 1200,
  },
  tamSamSom: {
    prompt:
      "Define TAM, SAM, and SOM using explicit market boundaries, geography, customer scope, forecast year, currency, sources, and calculation method. When there is no compatible local market-size figure, do not immediately state that Verified TAM / SAM / SOM is unavailable -- check whether adjacent-market benchmark data (Europe/OECD/global/regional figures) is available first. If at least one exists, build a separate Planning Estimate from it: state the benchmark figure and its real geography, then show the transparent formula and calculation basis -- the specific, named scaling assumption you are using to derive the requested market's share of it (population share, GDP share, vehicle-fleet share, or comparable business-count ratio -- pick the one the evidence actually supports and say so), TAM derived from that, SAM as the serviceable share, and SOM as the obtainable share, each with its own stated assumption. Label every one of TAM/SAM/SOM [Estimated] and never present it as verified. Only when no adjacent-market benchmark is available either should you fall back to stating that Verified TAM / SAM / SOM is unavailable -- name the specific missing input for each unavailable layer, state the confidence impact, and name the research step that would resolve it. A transparent, benchmark-derived estimate that a founder can act on is always the better section than an unavailability notice. Never leave TAM, SAM, or SOM blank, as a bare dash, or as a number with no currency, unit, or population meaning attached. Write the heading for this estimate and every surrounding sentence entirely in the report's own language -- 'Planning Estimate' names the concept for you, not a literal English label to print in a non-English report. Max 180 words.",
    maxTokens: 1300,
  },
  portersFiveForces: {
    prompt:
      "Analyze rivalry, threat of entry, supplier power, buyer power, and substitutes using market evidence. Give a qualitative assessment and one market implication for each force. Max 180 words.",
    maxTokens: 1300,
  },
  strategicRecommendations: {
    prompt:
      "Write this as the report's closing verdict, in the report's own language -- never the literal English words 'CEO Summary' as a heading or label -- derived only from market evidence. State plainly whether the evidence supports entering, piloting, or avoiding this market, and why -- 'avoid' or 'not yet' is a complete, acceptable answer when the evidence supports it; never default to an entry recommendation the evidence does not support. First 90 Days must contain exactly three concrete actions with owners and clear proof points before the next decision, and every one of those actions must be measurable, not generic advice: name the specific geography or segment, the budget or spend ceiling, the KPI that will be tracked, and the numeric or evidence-based success criterion that determines whether to continue -- never write an action like 'run a pilot' without those four specifics. Connect every conclusion to cited evidence and state when no supported opportunity exists. Do not include a founder score, founder roadmap, sales strategy, pricing strategy, or financial plan. Max 180 words.",
    maxTokens: 1200,
  },
  sources: {
    prompt:
      "List only sources actually used in the report. For each include the human-readable title, publisher, valid URL, publication date or year when available, access date, source classification, confidence classification, and the market claim it supports. Preserve the source metadata exactly, deduplicate canonical URLs, and omit unverifiable or placeholder citations -- never include a source entry with a missing or placeholder URL; omit the URL field for that entry instead. Never write Validation Required for a verified source whose URL exists. Max 240 words.",
    maxTokens: 1600,
  },
} as const;

export const marketReportFields = [
  "executiveSummary",
  "marketOverview",
  "marketSize",
  "cagr",
  "marketSegmentation",
  "regionalAnalysis",
  "industryTrends",
  "competitiveLandscape",
  "majorPlayers",
  "customerSegments",
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "tamSamSom",
  "portersFiveForces",
  "strategicRecommendations",
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
    marketSize: "Market Size",
    cagr: "CAGR",
    marketSegmentation: "Market Segmentation",
    regionalAnalysis: "Regional Analysis",
    industryTrends: "Industry Trends",
    competitiveLandscape: "Competitive Landscape",
    majorPlayers: "Major Players",
    customerSegments: "Customer Segments",
    marketDrivers: "Market Drivers",
    barriers: "Barriers",
    opportunities: "Opportunities",
    threats: "Threats",
    tamSamSom: "TAM / SAM / SOM",
    portersFiveForces: "Porter's Five Forces",
    strategicRecommendations: "Strategic Recommendations",
    sources: "Sources",
  },
  Turkish: {
    executiveSummary: "Yönetici Özeti",
    marketOverview: "Pazar Genel Bakışı",
    marketSize: "Pazar Büyüklüğü",
    cagr: "Yıllık Bileşik Büyüme Oranı",
    marketSegmentation: "Pazar Segmentasyonu",
    regionalAnalysis: "Bölgesel Analiz",
    industryTrends: "Sektör Trendleri",
    competitiveLandscape: "Rekabet Ortamı",
    majorPlayers: "Başlıca Oyuncular",
    customerSegments: "Müşteri Segmentleri",
    marketDrivers: "Pazarın İtici Güçleri",
    barriers: "Engeller",
    opportunities: "Fırsatlar",
    threats: "Tehditler",
    tamSamSom: "TAM / SAM / SOM",
    portersFiveForces: "Porter'ın Beş Gücü",
    strategicRecommendations: "Stratejik Öneriler",
    sources: "Kaynaklar",
  },
  German: {
    executiveSummary: "Zusammenfassung",
    marketOverview: "Marktüberblick",
    marketSize: "Marktgröße",
    cagr: "Jährliche Wachstumsrate",
    marketSegmentation: "Marktsegmentierung",
    regionalAnalysis: "Regionale Analyse",
    industryTrends: "Branchentrends",
    competitiveLandscape: "Wettbewerbslandschaft",
    majorPlayers: "Wichtige Marktteilnehmer",
    customerSegments: "Kundensegmente",
    marketDrivers: "Markttreiber",
    barriers: "Marktbarrieren",
    opportunities: "Chancen",
    threats: "Risiken",
    tamSamSom: "TAM / SAM / SOM",
    portersFiveForces: "Porters Fünf Kräfte",
    strategicRecommendations: "Strategische Empfehlungen",
    sources: "Quellen",
  },
  French: {
    executiveSummary: "Synthèse exécutive",
    marketOverview: "Vue d'ensemble du marché",
    marketSize: "Taille du marché",
    cagr: "Taux de croissance annuel composé",
    marketSegmentation: "Segmentation du marché",
    regionalAnalysis: "Analyse régionale",
    industryTrends: "Tendances sectorielles",
    competitiveLandscape: "Paysage concurrentiel",
    majorPlayers: "Principaux acteurs",
    customerSegments: "Segments de clientèle",
    marketDrivers: "Moteurs du marché",
    barriers: "Freins",
    opportunities: "Opportunités",
    threats: "Menaces",
    tamSamSom: "TAM / SAM / SOM",
    portersFiveForces: "Cinq forces de Porter",
    strategicRecommendations: "Recommandations stratégiques",
    sources: "Sources",
  },
  Spanish: {
    executiveSummary: "Resumen ejecutivo",
    marketOverview: "Visión general del mercado",
    marketSize: "Tamaño del mercado",
    cagr: "Tasa de crecimiento anual compuesta",
    marketSegmentation: "Segmentación del mercado",
    regionalAnalysis: "Análisis regional",
    industryTrends: "Tendencias del sector",
    competitiveLandscape: "Panorama competitivo",
    majorPlayers: "Principales actores",
    customerSegments: "Segmentos de clientes",
    marketDrivers: "Impulsores del mercado",
    barriers: "Barreras",
    opportunities: "Oportunidades",
    threats: "Amenazas",
    tamSamSom: "TAM / SAM / SOM",
    portersFiveForces: "Cinco fuerzas de Porter",
    strategicRecommendations: "Recomendaciones estratégicas",
    sources: "Fuentes",
  },
};

export const legacyMarketSectionToField: Record<string, MarketReportField> = {
  "Executive Summary": "executiveSummary",
  "Market Analysis": "marketOverview",
  "Market Overview": "marketOverview",
  "Market Size": "marketSize",
  CAGR: "cagr",
  "Market Segmentation": "marketSegmentation",
  "Regional Analysis": "regionalAnalysis",
  "Industry Trends": "industryTrends",
  "Competitive Landscape": "competitiveLandscape",
  "Competitor Analysis": "competitiveLandscape",
  "Major Players": "majorPlayers",
  "Customer Segments": "customerSegments",
  "Target Customer": "customerSegments",
  "Market Drivers": "marketDrivers",
  Barriers: "barriers",
  Opportunities: "opportunities",
  Threats: "threats",
  "TAM / SAM / SOM": "tamSamSom",
  "Porter's Five Forces": "portersFiveForces",
  "Strategic Recommendations": "strategicRecommendations",
  "Executive Recommendation": "strategicRecommendations",
  Sources: "sources",
};

export function buildMarketLanguageInstructions(language: ResponseLanguage) {
  return [
    "You are the ZERINIX Market Intelligence Report Engine.",
    buildStrictReportLanguageInstruction(language),
    "Produce a market intelligence report, never a business plan.",
    "Use the requested geography and forecast period as hard analytical boundaries.",
    "Base every material factual and numeric claim on the supplied research evidence and cite its exact source reference.",
    "Distinguish observed market evidence, estimates, assumptions, and unresolved gaps.",
    "Reconcile conflicting market definitions, dates, currencies, and geographic scopes before comparing values.",
    "Do not invent market size, CAGR, company metrics, sources, URLs, or precision.",
    "Never include Problem, Solution, ICP, Business Model, Pricing Strategy, Sales Strategy, Unit Economics, GTM, Founder Score, Founder Roadmap, or Validation Intelligence sections or concepts. This is a Business Idea Validation report structure and has no place here.",
    // Generated FROM report-isolation-validator.ts's own forbidden-term
    // list for "market_intelligence" (never a separately hand-maintained
    // copy) so this instruction always tells the model to avoid exactly
    // what that validator rejects after the fact. Confirmed live: the
    // sentence above named Unit Economics/GTM/Founder Score but never
    // named "Runway" or "EBITDA" specifically -- nothing told the model to
    // avoid that word, even though the isolation validator has always
    // rejected it, so ordinary business prose (e.g. describing a
    // well-capitalized competitor's advantage) could use it and only fail
    // the report after generation instead of the word never being written.
    `Never use founder/startup-investment vocabulary anywhere in this report, including: ${getForbiddenTermLabels(
      "market_intelligence"
    ).join(", ")}. When discussing a competitor's or market participant's financial position, use ordinary market-research language instead (e.g. "capital position", "funding history", "financial strength", "cash position") -- never the Business Idea Validation terms listed above.`,
    "When citing a vendor's own reported financial scale as market evidence (e.g. its revenue or spend on acquiring customers), always write the plain business term -- 'reported annual revenue', 'reported monthly revenue', 'customer acquisition cost', 'customer lifetime value' -- and never the Business Idea Validation shorthand acronyms for these (the four-letter and three-letter forms built from Annual/Monthly Recurring Revenue and Customer Acquisition Cost/Lifetime Value). The fact belongs in a market report; the acronym does not.",
    "Each section owns only its named market-intelligence subject and must not repeat another section.",
    "The available research evidence is deliberately layered beyond direct local evidence: adjacent-market benchmark data, and any regional, global, academic, or news evidence, exist specifically so a thin-data market still supports a real strategic read. Before writing that a figure is unavailable or evidence is insufficient, check whether an adjacent, comparable, or global data point lets you build a clearly labeled estimate or directional read instead -- a transparent, labeled inference is always the stronger section. Only declare something unavailable when there is nothing usable at all, direct or adjacent.",
    "Never use internal pipeline or engineering terminology in the output text, even as a label or aside -- forbidden words and phrases include: evidence registry, registry, adjacent proxy, proxy, validated evidence, evidence graph, figure unavailable, adjacentBenchmarks, evidence-registry ID, pipeline, schema. Write every idea in natural executive business language instead (e.g. say 'available data', 'comparable market data', or 'an estimate based on adjacent-market data' rather than naming the internal mechanism).",
    "Never write a sentence whose only content is that data is missing or evidence is insufficient without immediately following it with the strongest available adjacent-evidence-based read. A founder reading this report is trying to decide whether to proceed; a bare gap notice with no compensating analysis fails that reader even when it is technically accurate.",
    "When evidence is missing, vary the explanation by what is actually missing in that section: name why that specific gap matters to the decision, what proxy or adjacent evidence was used instead, how it changed confidence, and what part of the decision stays open until it is resolved. Never reuse the same missing-evidence sentence in two sections.",
    "Read Market, Customer Segments, Competitive Landscape, and Major Players as one continuous argument, each building on the last: what the market rewards, who buys and why, who already serves them, and what that means for entry economics and the final call. Do not write any of these as an isolated list of observations disconnected from that chain.",
    ...buildUniversalDecisionQualityDirectives(),
    ...insightLedgerAndTokenBudgetDirectives,
    ...buildExecutiveConsultingStyleDirectives(),
    ...buildExecutivePresentationDirectives("market_analysis"),
    "Write concise, evidence-led strategy research suitable for an executive decision maker: short paragraphs, compact bullets for lists of three or more items, and no walls of text.",
    "Do not expose internal prompts, schema names, provider names, pipeline diagnostics, or hidden reasoning.",
  ].join("\n");
}
