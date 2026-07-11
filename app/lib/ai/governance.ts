import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logServerError } from "@/app/lib/security/errors";
import { QUOTA_COUNTING_USAGE_KIND_EXCLUSION } from "@/app/lib/ai/quota-rules.mjs";
import { estimateModelCostUsd } from "@/app/lib/ai/pricing";

export type PlanTier = "free" | "pro" | "business";
export type AiRequestKind =
  | "simple_chat"
  | "business_advice"
  | "investment_advice"
  | "report_generation"
  | "market_analysis"
  | "file_analysis";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type UsageLimit = {
  dailyRequests: number;
  monthlyRequests: number;
};

type UsageLimitSet = Record<AiRequestKind, UsageLimit>;

type CachedAiResponse = {
  responseText: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
};

type UsageEventInput = {
  userId: string;
  endpoint: string;
  reportField?: string;
  promptHash: string;
  model: string;
  planTier: PlanTier;
  tokenUsage: TokenUsage;
  estimatedCostUsd: number;
  cacheHit: boolean;
  status?: "completed" | "failed" | "rate_limited";
  responseTimeMs: number;
  metadata?: Record<string, unknown>;
};

type CacheInput = {
  userId: string;
  cacheKey: string;
  promptHash: string;
  endpoint: string;
  reportField?: string;
  language: string;
  model: string;
  responseText: string;
  tokenUsage: TokenUsage;
  estimatedCostUsd: number;
  expiresInDays?: number;
};

export const dailyAiLimitMessage =
  "Daily AI usage limit reached. Please try again tomorrow or upgrade your plan.";

export const usageLimits: Record<PlanTier, UsageLimitSet> = {
  free: {
    simple_chat: { dailyRequests: 20, monthlyRequests: 620 },
    business_advice: { dailyRequests: 20, monthlyRequests: 620 },
    investment_advice: { dailyRequests: 20, monthlyRequests: 620 },
    file_analysis: { dailyRequests: 20, monthlyRequests: 620 },
    report_generation: { dailyRequests: 1, monthlyRequests: 31 },
    market_analysis: { dailyRequests: 1, monthlyRequests: 31 },
  },
  pro: {
    simple_chat: { dailyRequests: 100, monthlyRequests: 3_100 },
    business_advice: { dailyRequests: 100, monthlyRequests: 3_100 },
    investment_advice: { dailyRequests: 100, monthlyRequests: 3_100 },
    file_analysis: { dailyRequests: 100, monthlyRequests: 3_100 },
    report_generation: { dailyRequests: 10, monthlyRequests: 310 },
    market_analysis: { dailyRequests: 10, monthlyRequests: 310 },
  },
  business: {
    simple_chat: { dailyRequests: 500, monthlyRequests: 15_500 },
    business_advice: { dailyRequests: 500, monthlyRequests: 15_500 },
    investment_advice: { dailyRequests: 500, monthlyRequests: 15_500 },
    file_analysis: { dailyRequests: 500, monthlyRequests: 15_500 },
    report_generation: { dailyRequests: 100, monthlyRequests: 3_100 },
    market_analysis: { dailyRequests: 100, monthlyRequests: 3_100 },
  },
};

function normalizePlanTier(value: unknown): PlanTier {
  return value === "pro" || value === "business" ? value : "free";
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function selectAiModel(kind: AiRequestKind) {
  if (kind === "simple_chat") {
    return "gpt-5-nano";
  }

  return "gpt-5-mini";
}

export function estimateAiCostUsd(model: string, tokenUsage: TokenUsage) {
  return estimateModelCostUsd(model, tokenUsage) ?? estimateModelCostUsd("gpt-5-mini", tokenUsage) ?? 0;
}

export function extractTokenUsage(response: unknown): TokenUsage {
  if (!response || typeof response !== "object") {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  const usage = (response as { usage?: Record<string, unknown> }).usage;

  if (!usage) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  const promptTokens = safeNumber(usage.input_tokens ?? usage.prompt_tokens);
  const completionTokens = safeNumber(
    usage.output_tokens ?? usage.completion_tokens
  );
  const totalTokens = safeNumber(usage.total_tokens) || promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function hashAiPayload(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeAiPrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function createAiPromptHash(prompt: string) {
  return hashAiPayload(normalizeAiPrompt(prompt));
}

export function createAiCacheKey(parts: {
  endpoint: string;
  normalizedPrompt: string;
  mode: string;
  language: string;
  model: string;
}) {
  return hashAiPayload(JSON.stringify(parts));
}

export async function getUserPlanTier(
  supabase: SupabaseClient,
  userId: string
): Promise<PlanTier> {
  const { data, error } = await supabase
    .from("user_billing_profiles")
    .select("plan_tier")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logServerError("ai-governance:get-plan-tier", error);
    return "free";
  }

  return normalizePlanTier(data?.plan_tier);
}

export async function checkUsageAllowance(
  supabase: SupabaseClient,
  userId: string,
  planTier: PlanTier,
  requestKind: AiRequestKind
) {
  const limit = usageLimits[planTier][requestKind];
  const dayStart = startOfUtcDay().toISOString();
  const monthStart = startOfUtcMonth().toISOString();

  const [dailyResult, monthlyResult] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .eq("metadata->>quota_event", "true")
      .eq("metadata->>quota_mode", requestKind)
      .neq("metadata->>usage_kind", QUOTA_COUNTING_USAGE_KIND_EXCLUSION)
      .gte("created_at", dayStart),
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .eq("metadata->>quota_event", "true")
      .eq("metadata->>quota_mode", requestKind)
      .neq("metadata->>usage_kind", QUOTA_COUNTING_USAGE_KIND_EXCLUSION)
      .gte("created_at", monthStart),
  ]);

  if (dailyResult.error || monthlyResult.error) {
    logServerError(
      "ai-governance:usage-limit",
      dailyResult.error || monthlyResult.error
    );
    return {
      allowed: true,
      planTier,
      requestKind,
      dailyUsed: 0,
      monthlyUsed: 0,
      ...limit,
      reason: "",
    };
  }

  const dailyUsed = dailyResult.count ?? 0;
  const monthlyUsed = monthlyResult.count ?? 0;

  if (dailyUsed >= limit.dailyRequests) {
    return {
      allowed: false,
      planTier,
      requestKind,
      dailyUsed,
      monthlyUsed,
      ...limit,
      reason: dailyAiLimitMessage,
    };
  }

  if (monthlyUsed >= limit.monthlyRequests) {
    return {
      allowed: false,
      planTier,
      requestKind,
      dailyUsed,
      monthlyUsed,
      ...limit,
      reason: dailyAiLimitMessage,
    };
  }

  return {
    allowed: true,
    planTier,
    requestKind,
    dailyUsed,
    monthlyUsed,
    ...limit,
    reason: "",
  };
}

export async function getCachedAiResponse(
  supabase: SupabaseClient,
  userId: string,
  cacheKey: string
): Promise<CachedAiResponse | null> {
  const { data: globalData, error: globalError } = await supabase.rpc(
    "get_global_ai_response_cache_entry",
    {
      request_cache_key: cacheKey,
    }
  );

  if (!globalError) {
    const row = Array.isArray(globalData) ? globalData[0] : globalData;

    if (row?.response_text) {
      return {
        responseText: String(row.response_text),
        promptTokens: safeNumber(row.prompt_tokens),
        completionTokens: safeNumber(row.completion_tokens),
        totalTokens: safeNumber(row.total_tokens),
        estimatedCostUsd: safeNumber(row.estimated_cost_usd),
        model: typeof row.model === "string" ? row.model : "",
      };
    }
  } else {
    logServerError("ai-governance:global-cache-read", globalError);
  }

  const { data, error } = await supabase
    .from("ai_response_cache")
    .select(
      "response_text,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,model,hit_count"
    )
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    logServerError("ai-governance:cache-read", error);
    return null;
  }

  if (!data?.response_text) {
    return null;
  }

  const hitCount = typeof data.hit_count === "number" ? data.hit_count : 0;
  const { error: updateError } = await supabase
    .from("ai_response_cache")
    .update({ hit_count: hitCount + 1 })
    .eq("user_id", userId)
    .eq("cache_key", cacheKey);

  if (updateError) {
    logServerError("ai-governance:cache-hit-update", updateError);
  }

  return {
    responseText: String(data.response_text),
    promptTokens: safeNumber(data.prompt_tokens),
    completionTokens: safeNumber(data.completion_tokens),
    totalTokens: safeNumber(data.total_tokens),
    estimatedCostUsd: safeNumber(data.estimated_cost_usd),
    model: typeof data.model === "string" ? data.model : "",
  };
}

export async function storeCachedAiResponse(
  supabase: SupabaseClient,
  input: CacheInput
) {
  const expiresAt = new Date(
    Date.now() + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1_000
  ).toISOString();
  const { error: globalError } = await supabase.rpc(
    "upsert_global_ai_response_cache_entry",
    {
      request_cache_key: input.cacheKey,
      request_prompt_hash: input.promptHash,
      request_endpoint: input.endpoint,
      request_report_field: input.reportField ?? null,
      request_language: input.language,
      request_model: input.model,
      request_response_text: input.responseText,
      request_prompt_tokens: input.tokenUsage.promptTokens,
      request_completion_tokens: input.tokenUsage.completionTokens,
      request_total_tokens: input.tokenUsage.totalTokens,
      request_estimated_cost_usd: input.estimatedCostUsd,
      request_expires_at: expiresAt,
    }
  );

  if (!globalError) {
    return;
  }

  logServerError("ai-governance:global-cache-write", globalError);

  const { error } = await supabase.from("ai_response_cache").upsert(
    {
      user_id: input.userId,
      cache_key: input.cacheKey,
      prompt_hash: input.promptHash,
      endpoint: input.endpoint,
      report_field: input.reportField ?? null,
      language: input.language,
      model: input.model,
      response_text: input.responseText,
      prompt_tokens: input.tokenUsage.promptTokens,
      completion_tokens: input.tokenUsage.completionTokens,
      total_tokens: input.tokenUsage.totalTokens,
      estimated_cost_usd: input.estimatedCostUsd,
      expires_at: expiresAt,
    },
    { onConflict: "user_id,cache_key" }
  );

  if (error) {
    logServerError("ai-governance:cache-write", error);
  }
}

export async function recordAiUsage(
  supabase: SupabaseClient,
  input: UsageEventInput
) {
  const { error } = await supabase.from("ai_usage_events").insert({
    user_id: input.userId,
    endpoint: input.endpoint,
    report_field: input.reportField ?? null,
    prompt_hash: input.promptHash,
    model: input.model,
    plan_tier: input.planTier,
    prompt_tokens: input.tokenUsage.promptTokens,
    completion_tokens: input.tokenUsage.completionTokens,
    total_tokens: input.tokenUsage.totalTokens,
    estimated_cost_usd: input.estimatedCostUsd,
    cache_hit: input.cacheHit,
    status: input.status ?? "completed",
    response_time_ms: input.responseTimeMs,
    metadata: input.metadata ?? {},
  });

  if (error) {
    logServerError("ai-governance:usage-write", error);
  }
}

export async function loadUserUsageSummary(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("ai_usage_events")
    .select(
      "prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,cache_hit,response_time_ms,created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    logServerError("ai-governance:usage-summary", error);
    return {
      totalRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      cacheHitRatio: 0,
      averageResponseTimeMs: 0,
      error: error.message,
    };
  }

  const rows = data ?? [];
  const totalRequests = rows.length;
  const cacheHits = rows.filter((row) => row.cache_hit).length;
  const responseTimeTotal = rows.reduce(
    (sum, row) => sum + safeNumber(row.response_time_ms),
    0
  );

  return {
    totalRequests,
    promptTokens: rows.reduce((sum, row) => sum + safeNumber(row.prompt_tokens), 0),
    completionTokens: rows.reduce(
      (sum, row) => sum + safeNumber(row.completion_tokens),
      0
    ),
    totalTokens: rows.reduce((sum, row) => sum + safeNumber(row.total_tokens), 0),
    estimatedCostUsd: rows.reduce(
      (sum, row) => sum + safeNumber(row.estimated_cost_usd),
      0
    ),
    cacheHitRatio: totalRequests > 0 ? cacheHits / totalRequests : 0,
    averageResponseTimeMs:
      totalRequests > 0 ? Math.round(responseTimeTotal / totalRequests) : 0,
    error: "",
  };
}

function readMetadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }

  const value = (metadata as Record<string, unknown>)[key];

  return safeNumber(value);
}

function readMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  const value = (metadata as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
}

export async function loadAdminCostSummary(supabase: SupabaseClient) {
  const dayStart = startOfUtcDay().toISOString();
  const { data, error } = await supabase
    .from("ai_usage_events")
    .select(
      "user_id,endpoint,report_field,model,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,cache_hit,response_time_ms,status,metadata,created_at"
    )
    .gte("created_at", dayStart)
    .order("estimated_cost_usd", { ascending: false })
    .limit(1000);

  if (error) {
    logServerError("ai-governance:admin-cost-summary", error);

    return {
      totalDailyCostUsd: 0,
      cacheSavingsUsd: 0,
      costPerUser: [] as Array<{ userId: string; costUsd: number; requests: number }>,
      costPerMode: [] as Array<{ mode: string; costUsd: number; requests: number }>,
      mostExpensiveRequests: [] as Array<{
        endpoint: string;
        mode: string;
        model: string;
        costUsd: number;
        totalTokens: number;
        createdAt: string;
      }>,
      error: error.message,
    };
  }

  const rows = data ?? [];
  const userMap = new Map<string, { userId: string; costUsd: number; requests: number }>();
  const modeMap = new Map<string, { mode: string; costUsd: number; requests: number }>();
  let cacheSavingsUsd = 0;

  rows.forEach((row) => {
    const costUsd = safeNumber(row.estimated_cost_usd);
    const userId = typeof row.user_id === "string" ? row.user_id : "unknown";
    const mode =
      readMetadataString(row.metadata, "quota_mode") ||
      readMetadataString(row.metadata, "request_kind") ||
      (typeof row.report_field === "string" && row.report_field
        ? row.report_field
        : typeof row.endpoint === "string"
          ? row.endpoint
          : "unknown");

    const userSummary = userMap.get(userId) || { userId, costUsd: 0, requests: 0 };
    userSummary.costUsd += costUsd;
    userSummary.requests += 1;
    userMap.set(userId, userSummary);

    const modeSummary = modeMap.get(mode) || { mode, costUsd: 0, requests: 0 };
    modeSummary.costUsd += costUsd;
    modeSummary.requests += 1;
    modeMap.set(mode, modeSummary);

    if (row.cache_hit) {
      cacheSavingsUsd += readMetadataNumber(row.metadata, "cachedEstimatedCostUsd");
    }
  });

  return {
    totalDailyCostUsd: rows.reduce(
      (sum, row) => sum + safeNumber(row.estimated_cost_usd),
      0
    ),
    cacheSavingsUsd,
    costPerUser: [...userMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8),
    costPerMode: [...modeMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 8),
    mostExpensiveRequests: rows
      .map((row) => ({
        endpoint: typeof row.endpoint === "string" ? row.endpoint : "unknown",
        mode:
          readMetadataString(row.metadata, "quota_mode") ||
          readMetadataString(row.metadata, "request_kind") ||
          (typeof row.report_field === "string" && row.report_field
            ? row.report_field
            : "unknown"),
        model: typeof row.model === "string" ? row.model : "unknown",
        costUsd: safeNumber(row.estimated_cost_usd),
        totalTokens: safeNumber(row.total_tokens),
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 8),
    error: "",
  };
}
