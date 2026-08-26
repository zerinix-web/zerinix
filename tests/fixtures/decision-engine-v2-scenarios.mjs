import { buildMarketIntelligenceGraph } from "../../app/lib/ai/market-intelligence-graph.ts";
import { evaluateMarketResearchCoverage } from "../../app/lib/ai/market-research-coverage.ts";

// Single source of truth for Decision Engine V2's realistic decision
// fixtures (Phase 7's lettered A-J scenarios plus the construction-AI
// risk-intelligence scenario). Both tests/decision-engine-v2.test.mjs
// and scripts/decision-engine-v2-shadow-comparison.mjs import from
// here so the regression suite and the controlled Legacy-vs-V2
// comparison run against IDENTICAL inputs -- a comparison run against
// fixtures that have quietly drifted from the tested ones would not be
// trustworthy diagnostic data.

const checkedAt = "2026-08-02T00:00:00.000Z";

export function evidence({
  id,
  field,
  claim,
  value = claim,
  url,
  sourceType = "official company source",
  authorityLevel = "secondary",
  confidence = 76,
  qualityScore = 62,
  publishedDate = "2025-06-01",
  label = "Verified from external source",
}) {
  return {
    id,
    field,
    claim,
    value,
    label,
    sourceTitle: `${id} source`,
    publisher: `${id} publisher`,
    url,
    sourceType,
    authorityLevel,
    confidence,
    publishedDate,
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "x",
    qualityScore,
    qualityRationale: "x",
  };
}

export function buildInput(evidenceItems, prompt, sections) {
  const graph = buildMarketIntelligenceGraph({ evidence: evidenceItems }, prompt);
  const coverage = evaluateMarketResearchCoverage(evidenceItems, prompt);
  return { sections, coverage, graph };
}

export const scenarios = [
  {
    name: "A. Strong opportunity + strong evidence",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $2 billion.",
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://competitor-a.example.com",
          claim: "Competitor A is a small vendor in a fragmented market with no clear dominant player.",
        }),
        evidence({
          id: "R3",
          field: "pricing_models",
          url: "https://competitor-a.example.com/pricing",
          claim: "Competitor A charges $500/month per seat.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly, with strong adoption across the segment.",
        marketDrivers: "Structural demand growth in the category continues to accelerate.",
        customerSegments:
          "The target buyer is a mid-market operations team [R1] validated through direct interviews [R2].",
        competitiveLandscape: "The market is fragmented with no clear dominant player [R2].",
        opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
        strategicRecommendations: "Pursue the identified whitespace with a focused go-to-market.",
        marketSegmentation: "Vendors report healthy margins and attractive pricing for this category.",
        barriers: "Sales cycles are short and integration is straightforward for target buyers.",
        threats: "No material regulatory exposure was identified for this category.",
        industryTrends: "No regulatory or compliance blocker applies to this category.",
      }
    ),
  },
  {
    name: "B. Strong opportunity + incomplete TAM",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "competitors",
          url: "https://competitor-a.example.com",
          claim: "Competitor A is a small vendor in a fragmented, underserved segment with no clear dominant player.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly and the segment is underserved today.",
        marketDrivers: "Structural demand growth continues to accelerate in this category.",
        customerSegments: "Buyers report a clear, unmet need for this exact capability [R1].",
        competitiveLandscape: "The market is fragmented with no clear dominant player [R1].",
        opportunities: "A clear, defensible whitespace exists for a differentiated offering.",
        tamSamSom:
          "A verified market-size figure (TAM / SAM / SOM) could not be established for this market.",
        marketSize: "A defensible aggregate market-size figure could not be established for this market.",
      }
    ),
  },
  {
    name: "C. Weak/declining opportunity + excellent evidence",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $2 billion.",
          confidence: 92,
          qualityScore: 88,
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://dominant-incumbent.example.com",
          claim: "The dominant incumbent controls the majority of the market through high switching costs and network effects.",
          confidence: 92,
          qualityScore: 88,
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "The overall category is well documented and mature.",
        marketDrivers: "Demand is declining as the category matures and shrinks.",
        competitiveLandscape:
          "A dominant incumbent controls this market through high switching costs and network effects [R2].",
        majorPlayers: "The dominant incumbent has an entrenched position with high switching costs [R2].",
        opportunities: "The offering would be commoditized and easily replicated by the incumbent.",
        threats: "Thin margins and price-sensitive buyers characterize this declining category.",
      }
    ),
  },
  {
    name: "D. Attractive market + severe competitive disadvantage",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $5 billion.",
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://dominant-incumbent.example.com",
          claim: "A dominant incumbent controls this market with strong network effects.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly across this large category.",
        marketDrivers: "Structural demand growth continues to accelerate.",
        competitiveLandscape: "A dominant incumbent controls this market with strong network effects [R2].",
        majorPlayers: "The incumbent's network effects create high switching costs for buyers.",
        opportunities: "The category itself is attractive despite the competitive structure.",
      }
    ),
  },
  {
    name: "E. Large TAM + weak customer problem",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $50 billion.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "This is simply a large, generic category.",
        opportunities: "The offering would be commoditized and easily replicated.",
        customerSegments: "",
      }
    ),
  },
  {
    name: "F. Small/niche market + strong economics",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "pricing_models",
          url: "https://niche-vendor.example.com/pricing",
          claim: "Niche Vendor charges a premium annual contract value with healthy margins.",
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://niche-vendor.example.com",
          claim: "The niche segment is underserved with no clear dominant player.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "This is a small, specialized niche category.",
        marketSegmentation: "Vendors report healthy margins and attractive pricing for this niche.",
        competitiveLandscape: "The niche segment is underserved with no clear dominant player [R2].",
        opportunities: "A clear whitespace exists within this specialized niche.",
      }
    ),
  },
  {
    name: "G. Contradictory evidence",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $5 billion.",
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://dominant-incumbent.example.com",
          claim: "A dominant incumbent controls this market with high switching costs and network effects.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly with strong structural tailwinds.",
        marketDrivers: "Structural demand growth continues to accelerate significantly.",
        competitiveLandscape: "A dominant incumbent controls this market with high switching costs and network effects [R2].",
        opportunities: "Despite strong demand, the competitive position is difficult.",
      }
    ),
  },
  {
    name: "H. Very poor evidence coverage",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_overview",
          url: "https://example.com/general",
          claim: "General commentary about the market with no specific numeric or qualitative findings.",
        }),
      ],
      "Evaluate this obscure market.",
      {
        marketOverview: "General commentary about the market with no specific numeric findings.",
      }
    ),
  },
  {
    name: "I. Serious regulatory/economic blocker",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $3 billion.",
        }),
        evidence({
          id: "R2",
          field: "industry_structure",
          url: "https://regulator.example.gov",
          sourceType: "official_statistics",
          claim: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly across this category.",
        marketDrivers: "Structural demand growth continues to accelerate.",
        barriers: "This category requires FDA approval and is heavily regulated with significant compliance risk.",
        threats: "Regulatory uncertainty and pending litigation affect several incumbents.",
        competitiveLandscape: "A dominant incumbent controls this market with high switching costs.",
      }
    ),
  },
  {
    name: "J. Missing competitor data",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/market-size",
          sourceType: "official_statistics",
          claim: "The market size is $1 billion.",
        }),
      ],
      "Evaluate this market.",
      {
        marketOverview: "Demand is growing rapidly across this category.",
        marketDrivers: "Structural demand growth continues to accelerate.",
        competitiveLandscape: "Independent, publicly available information on named competitors was limited during research.",
      }
    ),
  },
  {
    name: "Construction AI risk-intelligence SaaS (live-tested scenario)",
    input: buildInput(
      [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/construction-establishments.html",
          sourceType: "official_statistics",
          claim: "There are 212,178 employer establishments in NAICS 23611 (Residential Building Construction).",
        }),
        evidence({
          id: "R2",
          field: "competitors",
          url: "https://www.prnewswire.com/news/shepherd-brickeye",
          claim: "Shepherd and Brickeye partner to bring IoT risk intelligence into autonomous underwriting for construction sites.",
        }),
        evidence({
          id: "R3",
          field: "competitors",
          url: "https://support.procore.com/integrations/procore-analytics",
          claim: "Procore offers an analytics risk-report feature for construction project management.",
        }),
      ],
      "Evaluate whether launching an AI-powered construction risk intelligence SaaS for small and mid-sized general contractors in the United States is commercially attractive.",
      {
        marketOverview: "The construction technology category shows growing adoption of risk and safety analytics tools.",
        marketDrivers: "Insurers and general contractors show growing demand for jobsite risk intelligence.",
        customerSegments:
          "Small and mid-sized general contractors represent a large addressable buyer population [R1].",
        competitiveLandscape:
          "Procore and IoT-risk specialists like Brickeye/Shepherd are active in this fragmented category [R2] [R3].",
        tamSamSom:
          "ZERINIX identified approximately 212,178 qualifying buyers/establishments from [R1], but could not establish a sufficiently reliable annual spend, subscription, or contract-value benchmark for this product category.",
        opportunities: "Selling validated jobsite risk signals to insurers is an emerging opportunity.",
      }
    ),
  },
];
