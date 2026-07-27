import "server-only";

import { logOperationalError, logOperationalInfo } from "@/app/lib/security/logging";
import { InMemoryResearchCache } from "../cache.mjs";
import { ResearchCoordinator } from "../coordinator.mjs";
import { ResearchQuotaChecker } from "../quota.mjs";
import { InMemoryResearchUsageTracker } from "../usage.mjs";
import {
  assertTavilyConfiguration,
  resolveTavilyConfiguration,
} from "./config.mjs";
import { TavilyResearchProvider } from "./provider.mjs";

type TavilyCostMetadata = {
  providerId: string;
  providerName: "Tavily";
  estimatedCostUsd: number;
  billableUnits: number;
  queryHash: string;
  queryLength: number;
  language: string;
  region: string;
  maxResults: number;
  freshnessMode: string;
};

type TavilyServerFactoryOptions = {
  fetchImpl?: typeof fetch;
  cache?: InMemoryResearchCache;
  usageTracker?: {
    record(event: Record<string, unknown>): Promise<void> | void;
    list(filter?: Record<string, unknown>): Promise<unknown[]> | unknown[];
  };
  quotaRules?: Partial<
    Record<
      "free" | "paid" | "enterprise",
      Partial<{
        dailyResearchCount: number;
        monthlyResearchCount: number;
        monthlyEstimatedCostUsd: number;
      }>
    >
  >;
  onCostEstimate?: (
    metadata: TavilyCostMetadata
  ) => Promise<void> | void;
};

/**
 * Reads Tavily credentials only inside a server-only module. The returned key
 * must never be serialized into responses, metadata, cache values, or props.
 */
export function getTavilyServerConfiguration() {
  return resolveTavilyConfiguration(process.env);
}

export function getTavilyConfigurationStatus() {
  const configuration = getTavilyServerConfiguration();

  return {
    configured: configuration.configured,
    enabled: configuration.enabled,
    productionBlocked: configuration.productionBlocked,
    missing: configuration.missing,
    timeoutMs: configuration.timeoutMs,
    estimatedCostPerCreditUsd:
      configuration.estimatedCostPerCreditUsd,
  };
}

/**
 * Dormant integration point. Nothing in the current application imports this
 * factory. Production remains hard-disabled even if its flag is set.
 */
export function createTavilyResearchCoordinator(
  options: TavilyServerFactoryOptions = {}
) {
  const configuration = assertTavilyConfiguration(
    getTavilyServerConfiguration()
  );
  const provider = new TavilyResearchProvider({
    apiKey: configuration.apiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: configuration.timeoutMs,
    estimatedCostPerCreditUsd:
      configuration.estimatedCostPerCreditUsd,
    async onCostEstimate(metadata: TavilyCostMetadata) {
      logOperationalInfo("[research:tavily] cost estimate", metadata);
      await options.onCostEstimate?.(metadata);
    },
    logger: {
      info(scope: string, metadata: Record<string, unknown>) {
        logOperationalInfo(scope, metadata);
      },
      error(scope: string, metadata: Record<string, unknown>) {
        logOperationalError(
          scope,
          new Error(
            typeof metadata.code === "string"
              ? metadata.code
              : "Tavily provider error"
          ),
          metadata
        );
      },
    },
  });

  const usageTracker =
    options.usageTracker || new InMemoryResearchUsageTracker();

  return new ResearchCoordinator({
    providers: [provider],
    cache: options.cache || new InMemoryResearchCache(),
    usageTracker,
    quotaChecker: new ResearchQuotaChecker({
      usageStore: usageTracker,
      rules: options.quotaRules,
    }),
  });
}
