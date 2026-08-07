// Real, non-zero default pricing so estimated_cost_usd stops silently
// reporting $0 for any deployment that hasn't set AI_COST_CONFIG (the
// shipped .env.example zero-prices gpt-5-mini/gpt-5-nano). Mirrors the same
// per-model dollars-per-million-tokens figures already hardcoded in
// cost-metrics.ts's DEFAULT_PRICING for the separate OpenAI
// cost-instrumentation ledger -- kept as its own copy per this codebase's
// established "duplicate small model-pricing tables across independent
// modules" convention, since the two ledgers (ai_usage_events vs
// openai_cost_events) are intentionally independent systems.
//
// No framework/"server-only" imports on purpose: this is the pure data +
// resolution logic behind app/lib/ai/pricing.ts's getModelPricing, split
// out so it can be exercised directly by node --test.
export type AiModelPricing = {
  input: number;
  output: number;
};

export const defaultAiModelPricing: Record<string, AiModelPricing> = {
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

// configuredPricing (from AI_COST_CONFIG) always wins per model when
// present; otherwise falls back to the real default table above instead
// of null, so cost tracking works out of the box without any env setup.
export function resolveModelPricing(
  model: string,
  configuredPricing?: Record<string, AiModelPricing>
): AiModelPricing | null {
  return configuredPricing?.[model] ?? defaultAiModelPricing[model] ?? null;
}
