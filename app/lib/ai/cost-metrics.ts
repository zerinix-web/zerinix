export type OpenAiTokenUsageDetails = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearchCalls: number;
};

export type OpenAiCostBreakdown = {
  inputCostUsd: number;
  outputCostUsd: number;
  toolCostUsd: number;
  totalCostUsd: number;
};

export type OpenAiCostEventLike = OpenAiTokenUsageDetails &
  OpenAiCostBreakdown & {
    operationName: string;
    model: string;
    durationMs: number;
    retryCount: number;
    cacheStatus: "hit" | "miss" | "provider_cached";
    cacheSavingsUsd?: number;
    duplicateFingerprint: string;
  };

type Pricing = {
  input: number;
  cachedInput: number;
  output: number;
  webSearchCall: number;
};

const DEFAULT_PRICING: Record<string, Pricing> = {
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30, webSearchCall: 0.01 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2, webSearchCall: 0.01 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4, webSearchCall: 0.01 },
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30, webSearchCall: 0.01 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12, webSearchCall: 0.01 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2, webSearchCall: 0.01 },
};

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function configuredPricing(model: string): Partial<Pricing> {
  try {
    const parsed = JSON.parse(process.env.AI_COST_CONFIG || "{}") as {
      pricing?: Record<string, Partial<Pricing>>;
    };
    return parsed.pricing?.[model] || {};
  } catch {
    return {};
  }
}

export function resolveOpenAiPricing(model: string): Pricing | null {
  const fallback = DEFAULT_PRICING[model];
  const configured = configuredPricing(model);
  const input = numberValue(configured.input) || fallback?.input || 0;
  const output = numberValue(configured.output) || fallback?.output || 0;

  if (!input || !output) return null;

  return {
    input,
    output,
    cachedInput:
      numberValue(configured.cachedInput) || fallback?.cachedInput || input,
    webSearchCall:
      numberValue(configured.webSearchCall) || fallback?.webSearchCall || 0.01,
  };
}

function countWebSearchCalls(output: unknown): number {
  if (!Array.isArray(output)) return 0;
  return output.reduce(
    (count, item) =>
      count +
      (item && typeof item === "object" &&
      (item as { type?: unknown }).type === "web_search_call"
        ? 1
        : 0),
    0
  );
}

export function extractOpenAiTokenUsageDetails(
  response: unknown
): OpenAiTokenUsageDetails {
  if (!response || typeof response !== "object") {
    return {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      webSearchCalls: 0,
    };
  }

  const value = response as {
    usage?: {
      input_tokens?: unknown;
      prompt_tokens?: unknown;
      output_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      input_tokens_details?: { cached_tokens?: unknown };
      prompt_tokens_details?: { cached_tokens?: unknown };
      output_tokens_details?: { reasoning_tokens?: unknown };
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
    output?: unknown;
  };
  const usage = value.usage;
  const inputTokens = numberValue(usage?.input_tokens ?? usage?.prompt_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    numberValue(
      usage?.input_tokens_details?.cached_tokens ??
        usage?.prompt_tokens_details?.cached_tokens
    )
  );
  const outputTokens = numberValue(
    usage?.output_tokens ?? usage?.completion_tokens
  );
  const reasoningTokens = Math.min(
    outputTokens,
    numberValue(
      usage?.output_tokens_details?.reasoning_tokens ??
        usage?.completion_tokens_details?.reasoning_tokens
    )
  );

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens:
      numberValue(usage?.total_tokens) || inputTokens + outputTokens,
    webSearchCalls: countWebSearchCalls(value.output),
  };
}

export function estimateOpenAiCostBreakdown(
  model: string,
  usage: OpenAiTokenUsageDetails
): OpenAiCostBreakdown {
  const pricing = resolveOpenAiPricing(model);
  if (!pricing) {
    return { inputCostUsd: 0, outputCostUsd: 0, toolCostUsd: 0, totalCostUsd: 0 };
  }

  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens
  );
  const inputCostUsd =
    (uncachedInputTokens * pricing.input +
      usage.cachedInputTokens * pricing.cachedInput) /
    1_000_000;
  const outputCostUsd = (usage.outputTokens * pricing.output) / 1_000_000;
  const toolCostUsd = usage.webSearchCalls * pricing.webSearchCall;
  const rounded = (value: number) => Number(value.toFixed(8));

  return {
    inputCostUsd: rounded(inputCostUsd),
    outputCostUsd: rounded(outputCostUsd),
    toolCostUsd: rounded(toolCostUsd),
    totalCostUsd: rounded(inputCostUsd + outputCostUsd + toolCostUsd),
  };
}

export function summarizeOpenAiCostEvents(events: OpenAiCostEventLike[]) {
  const apiEvents = events.filter((event) => event.cacheStatus !== "hit");
  const byModel: Record<string, { calls: number; tokens: number; costUsd: number }> = {};
  const emptyGroup = () => ({ calls: 0, tokens: 0, costUsd: 0 });
  const byStage: Record<string, { calls: number; tokens: number; costUsd: number }> =
    Object.fromEntries(
      [
        "understanding",
        "research",
        "entity_extraction",
        "planning",
        "report_generation",
        "validation",
        "sanitization",
        "localization",
        "translation",
        "pdf_ai",
        "scoring",
        "advisor",
        "market",
        "business_validation",
        "admin_advisor",
        "unscoped",
      ].map((stage) => [stage, emptyGroup()])
    );
  const byOperation: Record<string, { calls: number; tokens: number; costUsd: number }> = {};
  const fingerprints = new Map<string, number>();

  for (const event of apiEvents) {
    const model = (byModel[event.model] ||= { calls: 0, tokens: 0, costUsd: 0 });
    model.calls += 1;
    model.tokens += event.totalTokens;
    model.costUsd += event.totalCostUsd;
    const operation = (byOperation[event.operationName] ||= emptyGroup());
    operation.calls += 1;
    operation.tokens += event.totalTokens;
    operation.costUsd += event.totalCostUsd;
    const stageName = resolvePipelineStage(event.operationName);
    const stage = (byStage[stageName] ||= emptyGroup());
    stage.calls += 1;
    stage.tokens += event.totalTokens;
    stage.costUsd += event.totalCostUsd;
    if (event.duplicateFingerprint) {
      fingerprints.set(
        event.duplicateFingerprint,
        (fingerprints.get(event.duplicateFingerprint) || 0) + 1
      );
    }
  }

  const mostExpensiveStep = [...apiEvents].sort(
    (left, right) => right.totalCostUsd - left.totalCostUsd
  )[0];
  const roundGroups = (
    groups: Record<string, { calls: number; tokens: number; costUsd: number }>
  ) =>
    Object.fromEntries(
      Object.entries(groups).map(([key, value]) => [
        key,
        { ...value, costUsd: Number(value.costUsd.toFixed(8)) },
      ])
    );

  return {
    totalOpenAiCalls: apiEvents.length,
    totalTokens: apiEvents.reduce((sum, event) => sum + event.totalTokens, 0),
    totalEstimatedUsdCost: Number(
      apiEvents.reduce((sum, event) => sum + event.totalCostUsd, 0).toFixed(8)
    ),
    costByModel: roundGroups(byModel),
    costByPipelineStage: roundGroups(byStage),
    costByOperation: roundGroups(byOperation),
    mostExpensiveStep: mostExpensiveStep
      ? {
          operationName: mostExpensiveStep.operationName,
          model: mostExpensiveStep.model,
          costUsd: mostExpensiveStep.totalCostUsd,
        }
      : null,
    duplicatedCalls: [...fingerprints.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0
    ),
    retryCostUsd: Number(
      apiEvents
        .filter((event) => event.retryCount > 0)
        .reduce((sum, event) => sum + event.totalCostUsd, 0)
        .toFixed(8)
    ),
    cacheSavingsUsd: Number(
      events
        .reduce((sum, event) => {
          if (event.cacheStatus === "hit") {
            return sum + (event.cacheSavingsUsd || 0);
          }
          const pricing = resolveOpenAiPricing(event.model);
          if (!pricing) return sum;
          const providerSavings =
            (event.cachedInputTokens * (pricing.input - pricing.cachedInput)) /
            1_000_000;
          return sum + providerSavings;
        }, 0)
        .toFixed(8)
    ),
  };
}

function resolvePipelineStage(operationName: string) {
  if (operationName.startsWith("research:")) return "research";
  if (operationName.includes("entity_extraction")) return "entity_extraction";
  if (operationName.includes("validation")) return "validation";
  if (operationName.includes("sanit")) return "sanitization";
  if (operationName.includes("localiz")) return "localization";
  if (operationName.includes("translat")) return "translation";
  if (operationName.includes("pdf")) return "pdf_ai";
  if (operationName.includes("scor")) return "scoring";
  if (operationName.includes("market")) return "market";
  if (operationName.includes("business_validation")) return "business_validation";
  if (operationName.includes("report_generation")) return "report_generation";
  if (operationName.includes("understanding")) return "understanding";
  if (operationName.includes("advisor") && !operationName.includes("admin")) return "advisor";
  if (operationName.includes("admin_advisor")) return "admin_advisor";
  if (operationName.includes("plan")) return "planning";
  return "unscoped";
}
