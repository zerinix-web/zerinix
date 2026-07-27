export const DEFAULT_TAVILY_TIMEOUT_MS = 15_000;
export const DEFAULT_TAVILY_COST_PER_CREDIT_USD = 0.008;

export class TavilyConfigurationError extends Error {
  constructor(message = "Tavily research is not configured.") {
    super(message);
    this.name = "TavilyConfigurationError";
  }
}

export class TavilyResearchDisabledError extends Error {
  constructor(message = "Tavily research is disabled in this environment.") {
    super(message);
    this.name = "TavilyResearchDisabledError";
  }
}

function boundedNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(minimum, Math.min(maximum, numeric))
    : fallback;
}

export function validateTavilyApiKey(value) {
  const apiKey = String(value || "").trim();

  if (!apiKey) {
    throw new TavilyConfigurationError(
      "TAVILY_API_KEY is required before Tavily research can run."
    );
  }

  if (!/^tvly-[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    throw new TavilyConfigurationError(
      "TAVILY_API_KEY is not in the expected server-side format."
    );
  }

  return apiKey;
}

export function resolveTavilyConfiguration(environment = {}) {
  const nodeEnvironment = String(environment.NODE_ENV || "development");
  const requested = environment.ENABLE_TAVILY_RESEARCH === "true";
  const productionBlocked = nodeEnvironment === "production";
  const apiKey = String(environment.TAVILY_API_KEY || "").trim();

  return {
    configured: Boolean(apiKey),
    enabled: requested && !productionBlocked,
    productionBlocked,
    missing: apiKey ? [] : ["TAVILY_API_KEY"],
    apiKey,
    timeoutMs: Math.round(
      boundedNumber(
        environment.TAVILY_TIMEOUT_MS,
        DEFAULT_TAVILY_TIMEOUT_MS,
        1_000,
        60_000
      )
    ),
    estimatedCostPerCreditUsd: boundedNumber(
      environment.TAVILY_ESTIMATED_COST_PER_CREDIT_USD,
      DEFAULT_TAVILY_COST_PER_CREDIT_USD,
      0,
      10
    ),
  };
}

export function assertTavilyConfiguration(configuration) {
  if (!configuration.enabled) {
    throw new TavilyResearchDisabledError(
      configuration.productionBlocked
        ? "Tavily research is intentionally disabled in production."
        : "Tavily research is disabled. Set ENABLE_TAVILY_RESEARCH=true only in an approved non-production environment."
    );
  }

  validateTavilyApiKey(configuration.apiKey);
  return configuration;
}

