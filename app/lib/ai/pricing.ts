import "server-only";

import type { TokenUsage } from "@/app/lib/ai/governance";

export const modelPricingPerMillionTokens: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
};

export function getModelPricing(model: string) {
  return modelPricingPerMillionTokens[model] ?? null;
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
