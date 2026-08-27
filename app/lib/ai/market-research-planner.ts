// Deterministic Market Intelligence research planner.
//
// This replaces the market-mode path through dynamic-research-plan.ts's
// generic planner (seedTasks -> normalizeTasks), whose priority-score sort
// and section-count-driven budget slice could silently drop tasks --
// including the regional/global benchmark tasks -- before research ever
// ran for them. There is no sorting, scoring, or slicing here: every
// capability below is always scheduled, every time, for every Market
// Intelligence request. "Deterministic" means the same inputs always
// produce the same task list, not that every task always finds evidence.
import type { ExpertiseProfile } from "./expertise-profile.ts";
import type { DynamicReportPlan } from "./dynamic-report-plan.ts";
import type { ResearchTask } from "../decision-intelligence/contracts.ts";
import { expandMarketTaxonomyTerms, getMarketTaxonomyProfile } from "./market-taxonomy.ts";
import { buildVendorDiscoveryQueryPlan } from "./vendor-discovery.ts";

type ExtractedFact = {
  field?: string;
  label?: string;
  value?: string;
};

export type MarketQueryExpansions = {
  categoryTerms?: readonly string[];
  adjacentCategories?: readonly string[];
  competitorBrands?: readonly string[];
  geographicComparators?: readonly string[];
  methodologyTerms?: readonly string[];
  localLanguageTerms?: readonly string[];
};

export type MarketResearchPlanInput = {
  expertiseProfile: ExpertiseProfile;
  reportPlan: DynamicReportPlan;
  prompt?: string;
  extractedFacts?: readonly ExtractedFact[];
  queryExpansions?: MarketQueryExpansions;
};

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure, verified by executing this exact logic): every call
// site below follows the same shape -- variable-length context/category
// terms first, then a fixed, hand-written phrase LAST that actually
// states the research intent ("market size CAGR methodology geography
// year analyst report", "named competitors brands manufacturers
// distributors", "competitor annual report investor filing market
// position", ...). The previous implementation sliced the WHOLE joined
// string to 220 chars from the front, so a long context/category prefix
// (the taxonomy OR-chain can alone exceed 250 chars) silently ate the
// entire budget and truncated away that final, most-important phrase --
// meaning the query sent to the search provider never actually asked
// for market size, CAGR, or competitor data, even with a clean category
// name. The final part is now always preserved in full; only the
// earlier, variable-length parts are truncated to fit what budget
// remains, so the query's actual intent can never be silently dropped.
function joinQuery(...parts: Array<string | undefined>) {
  const maxLength = 220;
  const cleaned = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim());

  if (cleaned.length === 0) {
    return "";
  }

  const criticalSuffix = cleaned[cleaned.length - 1];
  const variableParts = cleaned.slice(0, -1);
  const variableJoined = variableParts.join(" ").replace(/\s+/g, " ").trim();
  const budgetForVariableParts = Math.max(0, maxLength - criticalSuffix.length - 1);
  const truncatedVariable =
    variableJoined.length <= budgetForVariableParts
      ? variableJoined
      : variableJoined.slice(0, budgetForVariableParts).replace(/\s+\S*$/, "").trim();

  return [truncatedVariable, criticalSuffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function entityContext(facts: readonly ExtractedFact[]) {
  return facts
    .filter((fact) => fact.value?.trim())
    .slice(0, 8)
    .map((fact) => `${fact.label || fact.field || "entity"} ${fact.value}`)
    .join(" ")
    .slice(0, 260);
}

function dedupeQueries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === 3) break;
  }
  return result;
}

function findSectionId(reportPlan: DynamicReportPlan, candidates: readonly string[]) {
  return (
    candidates.find((candidate) =>
      reportPlan.sections.some((section) => section.id === candidate)
    ) ||
    reportPlan.sections.find((section) => section.priority === "critical")?.id ||
    reportPlan.sections[0].id
  );
}

type MarketResearchCapability = {
  id: string;
  field: string;
  priority: "critical" | "high" | "medium";
  required: boolean;
  preferredSourceTypes: readonly string[];
  reportSectionId: string;
  purpose: string;
  queries: string[];
};

// The fixed, explicit set of research capabilities a Market Intelligence
// report always needs. Every entry here is always scheduled -- there is no
// branch that can omit one. In particular, regional_benchmark and
// global_benchmark (what buildAdjacentBenchmarkEstimate in
// market-intelligence-graph.ts needs to build a transparent estimate when
// local market-size data doesn't exist) are no longer conditional on a
// section-count budget or a priority-sort tie-break.
function buildCapabilities(input: {
  reportPlan: DynamicReportPlan;
  context: string;
  categoryQuery: string;
  adjacentQuery: string;
  brandQuery: string;
  comparatorQuery: string;
  methodologyQuery: string;
  localQuery: string;
  vendorDiscoveryFirstQuery: string;
}): MarketResearchCapability[] {
  const {
    reportPlan,
    context,
    categoryQuery,
    adjacentQuery,
    brandQuery,
    comparatorQuery,
    methodologyQuery,
    localQuery,
    vendorDiscoveryFirstQuery,
  } = input;
  const section = (candidates: string[]) => findSectionId(reportPlan, candidates);

  return [
    {
      id: "market_vendor_discovery",
      field: "vendor_discovery",
      priority: "critical",
      required: true,
      preferredSourceTypes: ["credible_market_data", "professional_standard", "company_source", "official_filing"],
      reportSectionId: section(["major_players", "competitive_landscape", "competition"]),
      purpose:
        "Discover 10–30 evidence-supported vendors/competitors where available by reconciling independent directories, analyst coverage, industry publications, filings, official company sources, review sites, and named brand/equipment-maker pages.",
      queries: dedupeQueries([
        vendorDiscoveryFirstQuery || joinQuery(context, categoryQuery, "vendors alternatives directory market map"),
        joinQuery(context, adjacentQuery, "software companies vendor landscape comparison"),
        joinQuery(context, brandQuery || categoryQuery, "named competitors brands manufacturers distributors"),
      ]),
    },
    {
      id: "market_competitor_landscape",
      field: "competitors",
      priority: "critical",
      required: true,
      preferredSourceTypes: ["company_source", "official_filing", "credible_market_data"],
      reportSectionId: section(["competitive_landscape", "major_players", "competition"]),
      purpose:
        "Identify multiple relevant competitors dynamically and compare their verified market role, positioning, products, and pricing without over-weighting one company.",
      queries: dedupeQueries([
        joinQuery(context, categoryQuery, "leading competitors vendors independent sources"),
        joinQuery(context, categoryQuery, "competitor products pricing official company pages"),
        joinQuery(context, "competitor annual report investor filing market position"),
      ]),
    },
    {
      id: "market_official_demand",
      field: "market_demand",
      priority: "critical",
      required: true,
      preferredSourceTypes: ["official_statistics", "official_government", "regulator", "credible_market_data"],
      reportSectionId: section(["market_overview", "market_drivers", "customer_segments"]),
      purpose:
        "Verify demand, adoption, customer, and business-population signals from government, statistical, regulatory, or industry-association sources.",
      queries: dedupeQueries([
        joinQuery(context, "demand adoption customers official statistics government"),
        joinQuery(context, "industry association adoption survey market demand"),
      ]),
    },
    {
      id: "market_size_endpoints",
      field: "market_size",
      priority: "high",
      required: false,
      preferredSourceTypes: ["official_statistics", "credible_market_data", "official_filing"],
      reportSectionId: section(["market_size", "tam_sam_som", "cagr"]),
      purpose:
        "Find compatible market-size or growth endpoints with geography, period, currency, definition, and methodology; preserve an explicit gap when no reliable endpoint exists.",
      queries: dedupeQueries([
        joinQuery(context, categoryQuery, methodologyQuery, "market size CAGR methodology geography year analyst report"),
        joinQuery(context, categoryQuery, "official statistics market revenue spending adoption"),
        joinQuery(context, localQuery || categoryQuery, "istatistik pazar büyüklüğü"),
      ]),
    },
    {
      id: "market_industry_structure",
      field: "industry_structure",
      priority: "high",
      required: false,
      preferredSourceTypes: ["credible_market_data", "professional_standard", "regulator", "official_statistics"],
      reportSectionId: section(["industry_trends", "porters_five_forces", "barriers"]),
      purpose:
        "Verify market structure, trends, regulation, switching costs, and buyer behavior across independent research, associations, and credible publications.",
      queries: dedupeQueries([
        joinQuery(context, adjacentQuery, "industry trends buyer behavior switching costs association research"),
        joinQuery(context, "regulation technology financial publication market analysis"),
      ]),
    },
    {
      id: "market_pricing_intelligence",
      field: "pricing_models",
      priority: "high",
      required: false,
      preferredSourceTypes: ["company_source", "credible_market_data"],
      reportSectionId: section(["major_players", "competitive_landscape", "market_segmentation"]),
      purpose:
        "Collect current public subscription, seat, usage, enterprise, transaction, success-fee, and hybrid pricing evidence from distinct vendor-owned sources without inferring missing prices.",
      queries: dedupeQueries([
        joinQuery(context, categoryQuery, "official pricing subscription per seat usage transaction"),
        joinQuery(context, adjacentQuery, "vendor pricing plans enterprise quote official"),
        joinQuery(context, "pricing page packages plans official vendors"),
      ]),
    },
    {
      id: "market_product_evidence",
      field: "product_evidence",
      priority: "high",
      required: false,
      preferredSourceTypes: ["company_source", "credible_market_data"],
      reportSectionId: section(["market_segmentation", "major_players", "competitive_landscape"]),
      purpose:
        "Verify current product scope, deployment, integrations, and public pricing directly from multiple relevant company sources.",
      queries: dedupeQueries([
        joinQuery(context, "competitor product features integrations pricing official"),
        joinQuery(context, "software product comparison customer segments deployment official"),
      ]),
    },
    {
      id: "market_company_filings",
      field: "company_evidence",
      priority: "high",
      required: false,
      preferredSourceTypes: ["official_filing", "audited_statement", "company_source", "regulator"],
      reportSectionId: section(["major_players", "competitive_landscape", "market_overview"]),
      purpose:
        "Collect primary company and filing evidence across relevant public competitors without treating one issuer as representative of the entire market.",
      queries: dedupeQueries([
        joinQuery(context, "competitors SEC filing annual report investor relations"),
        joinQuery(context, "public company filing market competition revenue segment"),
        joinQuery(context, localQuery || categoryQuery, "ticaret sicili faaliyet raporu şirket bilgileri resmi kaynak"),
      ]),
    },
    {
      id: "market_academic_evidence",
      field: "academic_evidence",
      priority: "medium",
      required: false,
      preferredSourceTypes: ["credible_market_data", "professional_standard"],
      reportSectionId: section(["industry_trends", "market_overview", "market_drivers"]),
      purpose:
        "Verify structural, technological, or demand-side facts about this market from academic papers, theses, or independent research institutions where available.",
      queries: dedupeQueries([
        joinQuery(context, categoryQuery, "academic research paper study university"),
        joinQuery(context, adjacentQuery, "thesis dissertation research institute report"),
      ]),
    },
    {
      id: "market_news_evidence",
      field: "news_evidence",
      priority: "medium",
      required: false,
      preferredSourceTypes: ["credible_market_data", "professional_standard"],
      reportSectionId: section(["market_drivers", "threats", "opportunities"]),
      purpose:
        "Verify recent news, price movements, demand shifts, expansion or closure signals, and independent press sentiment about this market.",
      queries: dedupeQueries([
        joinQuery(context, categoryQuery, "news press coverage recent"),
        joinQuery(context, localQuery || categoryQuery, "industry news price change expansion closure"),
      ]),
    },
    {
      id: "market_regional_benchmark",
      field: "regional_benchmark",
      priority: "high",
      required: false,
      preferredSourceTypes: ["official_statistics", "credible_market_data", "professional_standard"],
      reportSectionId: section(["regional_analysis", "market_size", "market_overview"]),
      purpose:
        "Find comparable neighboring-country or regional market data (size, growth, structure) to benchmark against when the requested geography lacks its own public data.",
      queries: dedupeQueries([
        joinQuery(comparatorQuery, categoryQuery, "market size regional comparison"),
        joinQuery(comparatorQuery || context, "neighboring market benchmark statistics"),
      ]),
    },
    {
      id: "market_global_benchmark",
      field: "global_benchmark",
      priority: "high",
      required: false,
      preferredSourceTypes: ["official_statistics", "credible_market_data", "professional_standard"],
      reportSectionId: section(["market_size", "tam_sam_som", "cagr"]),
      purpose:
        "Find Europe-wide, OECD, or global market-size and growth data for this category or its closest parent category, to build a transparent, clearly labeled estimate when local data does not exist.",
      queries: dedupeQueries([
        joinQuery("Europe global", categoryQuery, methodologyQuery, "market size CAGR"),
        joinQuery("OECD", adjacentQuery, "statistics report"),
        joinQuery(comparatorQuery, methodologyQuery || categoryQuery, "industry report market value"),
      ]),
    },
  ];
}

// The complete, fixed set of evidence fields a Market Intelligence report
// requires -- exported so tests (and anything auditing planner output) can
// assert the task list always covers exactly this set, with no additions
// or omissions.
export const REQUIRED_MARKET_RESEARCH_FIELDS = [
  "vendor_discovery",
  "competitors",
  "market_demand",
  "market_size",
  "industry_structure",
  "pricing_models",
  "product_evidence",
  "company_evidence",
  "academic_evidence",
  "news_evidence",
  "regional_benchmark",
  "global_benchmark",
] as const;

export function buildMarketResearchTasks(input: MarketResearchPlanInput): ResearchTask[] {
  const { expertiseProfile, reportPlan, prompt = "", extractedFacts = [], queryExpansions } = input;
  const context = joinQuery(
    expertiseProfile.jurisdiction,
    entityContext(extractedFacts),
    prompt.replace(/\s+/g, " ").trim().slice(0, 150)
  );
  const taxonomyTerms = expandMarketTaxonomyTerms(prompt);
  const categoryQuery = [
    ...taxonomyTerms.slice(0, 6),
    ...(queryExpansions?.categoryTerms || []),
  ]
    .slice(0, 10)
    .join(" OR ");
  const adjacentQuery = [
    ...taxonomyTerms.slice(6, 12),
    ...(queryExpansions?.adjacentCategories || []),
  ]
    .slice(0, 10)
    .join(" OR ");
  const brandQuery = (queryExpansions?.competitorBrands || []).join(" OR ");
  const comparatorQuery = (queryExpansions?.geographicComparators || []).join(" OR ");
  const methodologyQuery = (queryExpansions?.methodologyTerms || []).join(" OR ");
  const localQuery = (queryExpansions?.localLanguageTerms || []).join(" OR ");
  const vendorDiscoveryQueryPlan = buildVendorDiscoveryQueryPlan(prompt, getMarketTaxonomyProfile(prompt));

  const capabilities = buildCapabilities({
    reportPlan,
    context,
    categoryQuery,
    adjacentQuery,
    brandQuery,
    comparatorQuery,
    methodologyQuery,
    localQuery,
    vendorDiscoveryFirstQuery: vendorDiscoveryQueryPlan.packedQueries[0] || "",
  });

  return capabilities.map((capability) => ({
    id: capability.id,
    field: capability.field,
    priority: capability.priority,
    reason: `${capability.purpose} Report section: ${capability.reportSectionId}.`,
    query: capability.queries[0],
    queryVariants: capability.queries,
    provider: "auto",
    status: "skipped_with_reason",
    statusReason: "Awaiting existing provider selection and execution.",
    confidence: 0,
    required: capability.required,
    preferredSources: capability.preferredSourceTypes.map((source) => source.replaceAll("_", " ")),
    jurisdiction: expertiseProfile.jurisdiction,
  }));
}
