import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logServerError } from "@/app/lib/security/errors";

export type PlanTier = "free" | "pro" | "business";
export type AiRequestKind = "simple" | "business_plan" | "market_analysis";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type UsageLimit = {
  dailyRequests: number;
  monthlyRequests: number;
};

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
};

const usageLimits: Record<PlanTier, UsageLimit> = {
  free: {
    dailyRequests: 25,
    monthlyRequests: 300,
  },
  pro: {
    dailyRequests: 250,
    monthlyRequests: 5_000,
  },
  business: {
    dailyRequests: 1_500,
    monthlyRequests: 50_000,
  },
};

const modelPricingPerMillionTokens: Record<
  string,
  { input: number; output: number }
> = {
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
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
  if (kind === "simple") {
    return "gpt-5-nano";
  }

  return "gpt-5-mini";
}

export function estimateAiCostUsd(model: string, tokenUsage: TokenUsage) {
  const pricing = modelPricingPerMillionTokens[model] ?? modelPricingPerMillionTokens["gpt-5-mini"];

  return Number(
    (
      (tokenUsage.promptTokens / 1_000_000) * pricing.input +
      (tokenUsage.completionTokens / 1_000_000) * pricing.output
    ).toFixed(6)
  );
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

export function createAiCacheKey(parts: {
  endpoint: string;
  reportField?: string;
  language: string;
  model: string;
  instructions: string;
  input: string;
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
  planTier: PlanTier
) {
  const limit = usageLimits[planTier];
  const dayStart = startOfUtcDay().toISOString();
  const monthStart = startOfUtcMonth().toISOString();

  const [dailyResult, monthlyResult] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", dayStart),
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
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
      dailyUsed,
      monthlyUsed,
      ...limit,
      reason: "Daily AI request limit exceeded.",
    };
  }

  if (monthlyUsed >= limit.monthlyRequests) {
    return {
      allowed: false,
      planTier,
      dailyUsed,
      monthlyUsed,
      ...limit,
      reason: "Monthly AI request limit exceeded.",
    };
  }

  return {
    allowed: true,
    planTier,
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
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
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
