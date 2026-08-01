import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryResearchCache,
  ResearchCoordinator,
  ResearchQueryPolicy,
  TavilyConfigurationError,
  TavilyProviderError,
  TavilyRateLimitError,
  TavilyResearchProvider,
  TavilyTimeoutError,
  resolveTavilyConfiguration,
} from "../app/lib/research-providers/index.mjs";

const apiKey = "tvly-test_key_123";
const now = new Date("2026-07-27T12:00:00.000Z");

function request(overrides = {}) {
  return new ResearchQueryPolicy().prepare({
    query: "AI accounting market growth",
    language: "en",
    region: "US",
    maxResults: 8,
    freshness: { mode: "recent", maxAgeDays: 30 },
    ...overrides,
  });
}

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status || 200,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
}

test("missing Tavily API key fails with a controlled configuration error before transport", async () => {
  let transportCalls = 0;
  const provider = new TavilyResearchProvider({
    fetchImpl: async () => {
      transportCalls += 1;
      throw new Error("Transport must not execute.");
    },
  });

  await assert.rejects(provider.research(request()), TavilyConfigurationError);
  assert.equal(transportCalls, 0);
});

test("successful mocked response maps Tavily results and provider metadata", async () => {
  const calls = [];
  const costEvents = [];
  const provider = new TavilyResearchProvider({
    apiKey,
    clock: () => now,
    async onCostEstimate(metadata) {
      calls.push("cost");
      costEvents.push(metadata);
    },
    fetchImpl: async (url, init) => {
      calls.push("fetch");
      assert.equal(url, "https://api.tavily.com/search");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, `Bearer ${apiKey}`);
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        query: "AI accounting market growth",
        search_depth: "basic",
        max_results: 8,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        country: "united states",
        start_date: "2026-06-27",
      });

      return jsonResponse({
        query: body.query,
        results: [
          {
            title: " AI Accounting Market ",
            url: "https://www.example.com/research?utm_source=tavily",
            content: "The market reached $5 billion in 2025.",
            score: 0.91,
            published_date: "2026-07-01",
          },
        ],
        response_time: 0.45,
        usage: { credits: 1 },
        request_id: "tavily-request-1",
      });
    },
  });
  const result = await provider.research(request());

  assert.deepEqual(calls, ["cost", "fetch"]);
  assert.equal(costEvents[0].providerName, "Tavily");
  assert.equal(costEvents[0].estimatedCostUsd, 0.008);
  assert.equal("query" in costEvents[0], false);
  assert.deepEqual(result.rawEvidenceItems[0], {
    title: "AI Accounting Market",
    source: "example.com",
    url: "https://www.example.com/research",
    publishedAt: "2026-07-01",
    author: null,
    snippet: "The market reached $5 billion in 2025.",
    relevanceScore: 91,
    language: "",
    extractedFacts: [],
    provenance: [
      {
        collector: "TavilyResearchProvider",
        provider: "tavily-search",
        originalUrl: "https://www.example.com/research",
        collectedAt: now.toISOString(),
      },
    ],
  });
  assert.equal(result.metadata.requestId, "tavily-request-1");
  assert.equal(result.metadata.resultCount, 1);
  assert.equal(result.estimatedCost.estimatedCostUsd, 0.008);
});

test("provider HTTP errors are converted to controlled Tavily errors", async () => {
  const provider = new TavilyResearchProvider({
    apiKey,
    fetchImpl: async () =>
      jsonResponse({ message: "sensitive provider detail" }, { status: 500 }),
  });

  await assert.rejects(
    provider.research(request()),
    (error) =>
      error instanceof TavilyProviderError &&
      error.status === 500 &&
      error.code === "http_error" &&
      !error.message.includes("sensitive provider detail")
  );
});

test("rate-limit responses expose a controlled retry signal", async () => {
  const provider = new TavilyResearchProvider({
    apiKey,
    fetchImpl: async () =>
      jsonResponse(
        { message: "limit" },
        { status: 429, headers: { "retry-after": "12" } }
      ),
  });

  await assert.rejects(
    provider.research(request()),
    (error) =>
      error instanceof TavilyRateLimitError &&
      error.retryAfterSeconds === 12
  );
});

test("timeout aborts the mocked transport and returns TavilyTimeoutError", async () => {
  const provider = new TavilyResearchProvider({
    apiKey,
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      }),
  });

  await assert.rejects(provider.research(request()), TavilyTimeoutError);
});

test("empty Tavily result sets return an empty controlled result", async () => {
  const provider = new TavilyResearchProvider({
    apiKey,
    clock: () => now,
    fetchImpl: async () =>
      jsonResponse({
        results: [],
        usage: { credits: 1 },
        request_id: "empty-request",
      }),
  });
  const result = await provider.research(request());

  assert.deepEqual(result.rawEvidenceItems, []);
  assert.equal(result.metadata.resultCount, 0);
  assert.match(result.metadata.notes[0], /no research results/i);
});

test("Tavily coordinator uses the existing cache, normalization, and ranking flow", async () => {
  let transportCalls = 0;
  const provider = new TavilyResearchProvider({
    apiKey,
    clock: () => now,
    fetchImpl: async () => {
      transportCalls += 1;
      return jsonResponse({
        results: [
          {
            title: "Government filing",
            url: "https://sec.gov/filing",
            content: "Revenue reached $12 million in 2025.",
            score: 0.88,
            published_date: "2026-06-01",
          },
        ],
        usage: { credits: 1 },
      });
    },
  });
  const coordinator = new ResearchCoordinator({
    providers: [provider],
    cache: new InMemoryResearchCache(),
  });
  const input = {
    query: "company financial filing",
    language: "en",
    region: "US",
  };
  const first = await coordinator.research(input, { now: now.toISOString() });
  const second = await coordinator.research(input, { now: now.toISOString() });

  assert.equal(transportCalls, 1);
  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "exact-hit");
  assert.equal(first.evidence[0].source, "sec.gov");
  assert.equal(first.evidence[0].extractedFacts[0], "Revenue reached $12 million in 2025.");
  assert.ok(first.evidence[0].rankingScore > 0);
});

test("server-side Tavily configuration remains enabled in production when explicitly configured", () => {
  const configuration = resolveTavilyConfiguration({
    NODE_ENV: "production",
    ENABLE_TAVILY_RESEARCH: "true",
    TAVILY_API_KEY: apiKey,
  });

  assert.equal(configuration.configured, true);
  assert.equal(configuration.enabled, true);
  assert.equal(configuration.productionBlocked, false);
});

test("configuration remains disabled when the explicit server flag is absent", () => {
  const configuration = resolveTavilyConfiguration({
    NODE_ENV: "production",
    TAVILY_API_KEY: apiKey,
  });

  assert.equal(configuration.configured, true);
  assert.equal(configuration.enabled, false);
});

test("a timeout is retried once and a successful response is normalized", async () => {
  let transportCalls = 0;
  const provider = new TavilyResearchProvider({
    apiKey,
    timeoutMs: 5,
    maxAttempts: 2,
    clock: () => now,
    fetchImpl: async (_url, init) => {
      transportCalls += 1;
      if (transportCalls === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }

      return jsonResponse({
        results: [
          {
            title: "Defne Municipality planning document",
            url: "https://www.defne.bel.tr/plan/dursunlu",
            content: "Dursunlu plan information is published on this page.",
            score: 0.92,
          },
        ],
        usage: { credits: 1 },
      });
    },
  });

  const result = await provider.research(
    request({
      query: "Hatay Defne Dursunlu 1517 ada 1 parsel imar",
      language: "tr",
      region: "TR",
    })
  );

  assert.equal(transportCalls, 2);
  assert.equal(result.rawEvidenceItems.length, 1);
  assert.equal(result.rawEvidenceItems[0].source, "defne.bel.tr");
  assert.equal(
    result.rawEvidenceItems[0].provenance[0].provider,
    "tavily-search"
  );
});

test("coordinator removes duplicate source URLs and preserves normalized metadata", async () => {
  const provider = new TavilyResearchProvider({
    apiKey,
    maxAttempts: 1,
    clock: () => now,
    fetchImpl: async () =>
      jsonResponse({
        results: [
          {
            title: "AFAD Hatay risk map",
            url: "https://www.afad.gov.tr/hatay-risk?utm_source=search",
            content: "Hatay regional hazard information was published by AFAD.",
            score: 0.94,
            published_date: "2026-06-01",
          },
          {
            title: "AFAD Hatay risk map",
            url: "https://www.afad.gov.tr/hatay-risk",
            content: "Hatay regional hazard information was published by AFAD.",
            score: 0.9,
            published_date: "2026-06-01",
          },
        ],
        usage: { credits: 1 },
      }),
  });
  const coordinator = new ResearchCoordinator({ providers: [provider] });
  const result = await coordinator.research(
    {
      query: "AFAD Hatay Defne risk",
      language: "tr",
      region: "TR",
      maxResults: 5,
    },
    { now: now.toISOString() }
  );

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].url, "https://www.afad.gov.tr/hatay-risk");
  assert.equal(result.evidence[0].source, "afad.gov.tr");
  assert.equal(result.evidence[0].evidenceType, "Government");
  assert.equal(result.evidence[0].publishedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(result.evidence[0].provenance[0].provider, "tavily-search");
  assert.equal(result.evidence[0].provenance[0].collectedAt, now.toISOString());
});
