export type TavilyEnvironment = {
  NODE_ENV?: string;
  ENABLE_TAVILY_RESEARCH?: string;
  TAVILY_API_KEY?: string;
  TAVILY_TIMEOUT_MS?: string | number;
  TAVILY_ESTIMATED_COST_PER_CREDIT_USD?: string | number;
};

export type TavilyConfiguration = {
  configured: boolean;
  enabled: boolean;
  productionBlocked: boolean;
  missing: string[];
  apiKey: string;
  timeoutMs: number;
  estimatedCostPerCreditUsd: number;
};

export const DEFAULT_TAVILY_TIMEOUT_MS: number;
export const DEFAULT_TAVILY_COST_PER_CREDIT_USD: number;

export class TavilyConfigurationError extends Error {}
export class TavilyResearchDisabledError extends Error {}

export function validateTavilyApiKey(value: unknown): string;
export function resolveTavilyConfiguration(
  environment?: TavilyEnvironment
): TavilyConfiguration;
export function assertTavilyConfiguration(
  configuration: TavilyConfiguration
): TavilyConfiguration;

