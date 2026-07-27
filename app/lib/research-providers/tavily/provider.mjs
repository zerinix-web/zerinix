import {
  clampEvidenceScore,
  getEvidenceDomain,
  normalizeEvidenceText,
  normalizeEvidenceUrl,
} from "../../research-evidence/model.mjs";
import { stableResearchHash } from "../model.mjs";
import {
  DEFAULT_TAVILY_COST_PER_CREDIT_USD,
  DEFAULT_TAVILY_TIMEOUT_MS,
  validateTavilyApiKey,
} from "./config.mjs";

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const MAX_TAVILY_RESULTS = 20;

const regionToCountry = Object.freeze({
  AU: "australia",
  BR: "brazil",
  CA: "canada",
  CN: "china",
  DE: "germany",
  ES: "spain",
  FR: "france",
  GB: "united kingdom",
  IN: "india",
  IT: "italy",
  JP: "japan",
  MX: "mexico",
  NL: "netherlands",
  SG: "singapore",
  TR: "turkey",
  US: "united states",
});

export class TavilyProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "TavilyProviderError";
    this.status = options.status || 0;
    this.code = options.code || "provider_error";
  }
}

export class TavilyRateLimitError extends TavilyProviderError {
  constructor(retryAfterSeconds = null) {
    super("Tavily rate limit reached. Research can be retried later.", {
      status: 429,
      code: "rate_limited",
    });
    this.name = "TavilyRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class TavilyTimeoutError extends TavilyProviderError {
  constructor(timeoutMs) {
    super(`Tavily research timed out after ${Math.round(timeoutMs / 1000)} seconds.`, {
      code: "timeout",
    });
    this.name = "TavilyTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function parseRetryAfter(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function formatStartDate(request, now) {
  if (request.freshness.mode === "since") {
    return request.freshness.since.slice(0, 10);
  }

  if (request.freshness.mode === "recent") {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - request.freshness.maxAgeDays);
    return start.toISOString().slice(0, 10);
  }

  return "";
}

function mapTavilyResult(item, executedAt, providerId) {
  const url = normalizeEvidenceUrl(item?.url);
  const domain = getEvidenceDomain(url);
  const rawScore = Number(item?.score);
  const relevanceScore = Number.isFinite(rawScore)
    ? clampEvidenceScore(rawScore <= 1 ? rawScore * 100 : rawScore)
    : 50;

  return {
    title: normalizeEvidenceText(item?.title) || domain || "Untitled Tavily result",
    source: domain || "Unknown source",
    url,
    publishedAt: item?.published_date || null,
    author: null,
    snippet: normalizeEvidenceText(item?.content),
    relevanceScore,
    language: "",
    extractedFacts: [],
    provenance: [
      {
        collector: "TavilyResearchProvider",
        provider: providerId,
        originalUrl: url || undefined,
        collectedAt: executedAt,
      },
    ],
  };
}

export class TavilyResearchProvider {
  constructor(options = {}) {
    this.id = options.id || "tavily-search";
    this.kind = "Search API";
    this.apiKey = String(options.apiKey || "").trim();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.min(60_000, Math.round(options.timeoutMs)))
      : DEFAULT_TAVILY_TIMEOUT_MS;
    this.estimatedCostPerCreditUsd = Number.isFinite(
      options.estimatedCostPerCreditUsd
    )
      ? Math.max(0, options.estimatedCostPerCreditUsd)
      : DEFAULT_TAVILY_COST_PER_CREDIT_USD;
    this.onCostEstimate =
      typeof options.onCostEstimate === "function"
        ? options.onCostEstimate
        : async () => {};
    this.logger = options.logger || {
      info() {},
      error() {},
    };
    this.clock =
      typeof options.clock === "function" ? options.clock : () => new Date();
  }

  supports(request) {
    return Boolean(request?.query && request.maxResults > 0);
  }

  estimateCost() {
    return {
      currency: "USD",
      estimatedCostUsd: this.estimatedCostPerCreditUsd,
      billableUnits: 1,
      unitName: "Tavily basic search credit",
      freeTierEligible: false,
    };
  }

  buildRequestBody(request) {
    const now = this.clock();
    const startDate = formatStartDate(request, now);
    const country = regionToCountry[request.region] || "";

    return {
      query: request.query,
      search_depth: "basic",
      max_results: Math.min(MAX_TAVILY_RESULTS, request.maxResults),
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      ...(country ? { country } : {}),
      ...(startDate ? { start_date: startDate } : {}),
    };
  }

  async research(request) {
    const apiKey = validateTavilyApiKey(this.apiKey);
    if (typeof this.fetchImpl !== "function") {
      throw new TavilyProviderError("Tavily transport is unavailable.", {
        code: "transport_unavailable",
      });
    }

    const estimate = this.estimateCost(request);
    const queryMetadata = {
      providerId: this.id,
      providerName: "Tavily",
      estimatedCostUsd: estimate.estimatedCostUsd,
      billableUnits: estimate.billableUnits,
      queryHash: stableResearchHash(
        `${request.language}|${request.region}|${request.query.toLowerCase()}`
      ),
      queryLength: request.query.length,
      language: request.language,
      region: request.region,
      maxResults: Math.min(MAX_TAVILY_RESULTS, request.maxResults),
      freshnessMode: request.freshness.mode,
    };
    await this.onCostEstimate(queryMetadata);
    this.logger.info("[research:tavily] request started", queryMetadata);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(TAVILY_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildRequestBody(request)),
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new TavilyRateLimitError(
          parseRetryAfter(response.headers?.get?.("retry-after"))
        );
      }

      if (!response.ok) {
        throw new TavilyProviderError(
          `Tavily research failed with HTTP ${response.status}.`,
          { status: response.status, code: "http_error" }
        );
      }

      const payload = await response.json().catch(() => {
        throw new TavilyProviderError(
          "Tavily returned an invalid JSON response.",
          { status: response.status, code: "invalid_response" }
        );
      });
      const executedAt = this.clock().toISOString();
      const results = Array.isArray(payload?.results)
        ? payload.results.slice(0, Math.min(MAX_TAVILY_RESULTS, request.maxResults))
        : [];
      const rawEvidenceItems = results.map((item) =>
        mapTavilyResult(item, executedAt, this.id)
      );
      const credits = Number(payload?.usage?.credits);
      const billableUnits = Number.isFinite(credits) ? Math.max(0, credits) : 1;
      const estimatedCost = {
        ...estimate,
        billableUnits,
        estimatedCostUsd: billableUnits * this.estimatedCostPerCreditUsd,
      };
      const durationMs = Date.now() - startedAt;

      this.logger.info("[research:tavily] request completed", {
        providerId: this.id,
        requestId: normalizeEvidenceText(payload?.request_id).slice(0, 100),
        resultCount: rawEvidenceItems.length,
        durationMs,
        estimatedCostUsd: estimatedCost.estimatedCostUsd,
      });

      return {
        rawEvidenceItems,
        metadata: {
          providerId: this.id,
          providerKind: this.kind,
          requestId:
            normalizeEvidenceText(payload?.request_id).slice(0, 100) ||
            undefined,
          executedAt,
          resultCount: rawEvidenceItems.length,
          durationMs,
          notes: rawEvidenceItems.length
            ? [
                `Tavily basic search; language=${request.language}; region=${request.region}.`,
              ]
            : ["Tavily returned no research results."],
        },
        estimatedCost,
      };
    } catch (error) {
      if (error instanceof TavilyProviderError) {
        this.logger.error("[research:tavily] request failed", {
          providerId: this.id,
          code: error.code,
          status: error.status,
        });
        throw error;
      }

      if (controller.signal.aborted) {
        const timeoutError = new TavilyTimeoutError(this.timeoutMs);
        this.logger.error("[research:tavily] request failed", {
          providerId: this.id,
          code: timeoutError.code,
          timeoutMs: this.timeoutMs,
        });
        throw timeoutError;
      }

      const providerError = new TavilyProviderError(
        "Tavily research request failed.",
        { code: "network_error" }
      );
      this.logger.error("[research:tavily] request failed", {
        providerId: this.id,
        code: providerError.code,
      });
      throw providerError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

