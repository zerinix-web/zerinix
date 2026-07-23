import "server-only";

import type { TokenUsage } from "@/app/lib/ai/governance";

export type AiModelPricing = {
  input: number;
  output: number;
};

type AiCostConfig = {
  pricing?: Record<string, AiModelPricing>;
};

let cachedConfig: AiCostConfig | null = null;

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizePricing(value: unknown): Record<string, AiModelPricing> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, AiModelPricing>>(
    (pricing, [model, raw]) => {
      if (!raw || typeof raw !== "object") {
        return pricing;
      }

      const input = (raw as Record<string, unknown>).input;
      const output = (raw as Record<string, unknown>).output;

      if (isPositiveNumber(input) && isPositiveNumber(output)) {
        pricing[model] = { input, output };
      }

      return pricing;
    },
    {}
  );
}

export function getAiCostConfig(): AiCostConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawConfig = process.env.AI_COST_CONFIG;

  if (!rawConfig) {
    cachedConfig = { pricing: {} };
    return cachedConfig;
  }

  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    cachedConfig = {
      pricing: normalizePricing(parsed.pricing),
    };
  } catch {
    cachedConfig = { pricing: {} };
  }

  return cachedConfig;
}

export function getModelPricing(model: string) {
  return getAiCostConfig().pricing?.[model] ?? null;
}

export function estimateModelCostUsd(model: string, tokenUsage: TokenUsage) {
  const pricing = getModelPricing(model);

  if (!pricing) {
    return null;
  }

  return Number(
    (
      (tokenUsage.promptTokens / 1_000_000) * pricing.input +
      (tokenUsage.completionTokens / 1_000_000) * pricing.output
    ).toFixed(6)
  );
}
