import type OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { withOpenAiCostOperation } from "./cost-instrumentation";
import {
  logAiModelRoutingDecision,
  resolveAiModelRoutingDecision,
} from "./model-router";

// A hardcoded, regex-derived taxonomy (market-taxonomy.ts's
// expandMarketTaxonomyTerms) can only ever cover the handful of categories
// someone thought to enumerate in advance -- for any market outside that
// list (a physical/local-service business like a car wash, a niche
// vertical, a non-English market) it degrades to generic words pulled from
// the prompt itself, which never surfaces named competitors/equipment
// makers, adjacent categories, or comparator geographies. This module asks
// the model itself, per request, to enumerate concrete research directions
// -- so query breadth scales with the topic instead of with what a static
// list happened to anticipate.
export type MarketQueryExpansions = {
  categoryTerms: string[];
  adjacentCategories: string[];
  competitorBrands: string[];
  geographicComparators: string[];
  methodologyTerms: string[];
  localLanguageTerms: string[];
};

function createExpansionSchema() {
  return {
    type: "json_schema" as const,
    name: "zerinix_market_query_expansions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        categoryTerms: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 8,
        },
        adjacentCategories: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 8,
        },
        competitorBrands: {
          type: "array",
          items: { type: "string" },
          minItems: 0,
          maxItems: 10,
        },
        geographicComparators: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 6,
        },
        methodologyTerms: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 6,
        },
        localLanguageTerms: {
          type: "array",
          items: { type: "string" },
          minItems: 0,
          maxItems: 8,
        },
      },
      required: [
        "categoryTerms",
        "adjacentCategories",
        "competitorBrands",
        "geographicComparators",
        "methodologyTerms",
        "localLanguageTerms",
      ],
    },
  };
}

function sanitizeTerms(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, 80);
    const identity = trimmed.toLowerCase();
    if (!trimmed || seen.has(identity)) continue;
    seen.add(identity);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

const emptyExpansions: MarketQueryExpansions = {
  categoryTerms: [],
  adjacentCategories: [],
  competitorBrands: [],
  geographicComparators: [],
  methodologyTerms: [],
  localLanguageTerms: [],
};

// Never allowed to block or slow the research pipeline: on any failure
// (timeout, malformed output, provider error) this returns the empty shape
// so every caller falls back to the existing static taxonomy expansion
// exactly as before this module existed.
export async function generateMarketResearchQueryExpansions({
  client,
  model,
  prompt,
  signal,
}: {
  client: OpenAI;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<MarketQueryExpansions> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return emptyExpansions;

  try {
    const routingDecision = resolveAiModelRoutingDecision({
      requestKind: "market_analysis",
      category: "research",
      previousModel: model,
    });
    logAiModelRoutingDecision(routingDecision, {
      endpoint: "market-query-expansion",
      operation: "query_expansion",
    });
    const response = await withOpenAiCostOperation(
      { operationName: "market_query_expansion" },
      () =>
        client.responses.create(
          {
            model: routingDecision.routedModel,
            instructions: `You expand one market-intelligence question into the concrete research directions a senior strategy consultant would actually search before writing a decision memo.
Given the user's request, produce:
- categoryTerms: direct synonyms/framings of the exact category asked about (the product/service itself, its equipment/format variants, and how professionals in that industry name it).
- adjacentCategories: parent industries, neighboring categories, and category the target business is a specialized subset of (e.g. a car wash sits inside "vehicle care", "automotive aftersales", "fuel station services").
- competitorBrands: real, specific named companies, equipment manufacturers, franchise operators, or platforms actually active in this space or a closely adjacent one (e.g. named equipment makers). Only real, plausible names for this exact industry -- never invent a brand that does not exist. Return an empty array rather than guessing if you are not confident any exist.
- geographicComparators: markets worth benchmarking against when the requested geography lacks its own public data -- the broader region (e.g. "Europe", "OECD"), 2-4 comparable/neighboring countries, and "global" if relevant.
- methodologyTerms: the statistical/market-sizing vocabulary that surfaces real reports for this category (e.g. CAGR, TAM, market size, industry association names, relevant statistical agencies).
- localLanguageTerms: the same core category and adjacent-category concepts phrased in the language the user's request is written in (skip if the request is already in English), since local-language sources rarely use English market-research vocabulary.
Every entry must be a short (2-5 word) search phrase, not a sentence. Be specific to the actual industry asked about, not generic business vocabulary.`,
            input: [
              {
                role: "user",
                content: `Market intelligence request: ${trimmedPrompt}`,
              },
            ] as ResponseInput,
            // No `reasoning` param, and verbosity fixed to "medium": this
            // call's routedModel is whatever the caller's own model tier
            // resolves to (unlike domain-research.ts's main research call,
            // which always forces DOMAIN_RESEARCH_MODEL, a reasoning-capable
            // model). Confirmed live against gpt-4.1-mini -- the model this
            // call actually routed to end-to-end every single time -- that
            // model rejects `reasoning.effort` outright ("Unsupported
            // parameter: 'reasoning.effort'") AND rejects `verbosity: "low"`
            // ("Unsupported value: 'low' ... Supported values are: 'medium'").
            // Both were swallowed by the catch block below, so this call
            // returned emptyExpansions on every invocation since this module
            // was written -- the entire query-expansion feature was a silent
            // no-op. This is a lightweight structured-extraction task with no
            // real need for tunable reasoning effort or low verbosity, so
            // both are simply set to values every model tier accepts rather
            // than conditioned on per-model capability.
            text: {
              verbosity: "medium",
              format: createExpansionSchema(),
            },
          },
          signal ? { signal } : undefined
        )
    );

    if (response.status !== "completed" || !response.output_text.trim()) {
      return emptyExpansions;
    }

    const parsed = JSON.parse(response.output_text) as Record<
      string,
      unknown
    >;

    return {
      categoryTerms: sanitizeTerms(parsed.categoryTerms, 8),
      adjacentCategories: sanitizeTerms(parsed.adjacentCategories, 8),
      competitorBrands: sanitizeTerms(parsed.competitorBrands, 10),
      geographicComparators: sanitizeTerms(parsed.geographicComparators, 6),
      methodologyTerms: sanitizeTerms(parsed.methodologyTerms, 6),
      localLanguageTerms: sanitizeTerms(parsed.localLanguageTerms, 8),
    };
  } catch {
    return emptyExpansions;
  }
}
