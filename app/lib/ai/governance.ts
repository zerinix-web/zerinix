import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logServerError } from "@/app/lib/security/errors";
import { QUOTA_COUNTING_USAGE_KIND_EXCLUSION } from "@/app/lib/ai/quota-rules.mjs";
import { estimateModelCostUsd } from "@/app/lib/ai/pricing";
import { resolveAiModelForRequestKind } from "@/app/lib/ai/model-router";

export type PlanTier = "free" | "pro" | "business";
export type AIUsageOperationType =
  | "chat"
  | "plan_report"
  | "market_report"
  | "executive_report"
  | "pdf_export";
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

export type AIUsage = {
  id: string;
  userId: string;
  operationType: AIUsageOperationType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string;
};

export type AICacheOperationType =
  | "chat"
  | "plan_report"
  | "market_report"
  | "executive_report";

export type AICache = {
  id: string;
  cacheKey: string;
  operationType: AICacheOperationType;
  inputHash: string;
  model: string;
  responseData: unknown;
  tokenSavings: number;
  createdAt: string;
  expiresAt: string;
};

type UsageLimit = {
  dailyRequests: number;
  monthlyRequests: number;
};

type UsageLimitSet = Record<AiRequestKind, UsageLimit>;

type AiOperationLimit = {
  monthlyReportCount: number;
  monthlyChatTokens: number;
  monthlyPdfExports: number;
};

type AiUsageLimitConfig = Record<PlanTier, AiOperationLimit>;

type CachedAiResponse = {
  responseText: string;
  responseData?: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
};

type UsageEventInput = {
  userId: string;
  endpoint: string;
  operationType?: AIUsageOperationType;
  reportField?: string;
  reportId?: string | null;
  conversationId?: string | null;
  reportRequestId?: string | null;
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

const defaultAiOperationLimits: AiUsageLimitConfig = {
  free: {
    monthlyReportCount: 3,
    monthlyChatTokens: 100_000,
    monthlyPdfExports: 10,
  },
  pro: {
    monthlyReportCount: 50,
    monthlyChatTokens: 1_000_000,
    monthlyPdfExports: 100,
  },
  business: {
    monthlyReportCount: 250,
    monthlyChatTokens: 5_000_000,
    monthlyPdfExports: 500,
  },
};

type CacheInput = {
  userId: string;
  cacheKey: string;
  promptHash: string;
  endpoint: string;
  operationType?: AIUsageOperationType;
  reportField?: string;
  language: string;
  model: string;
  responseText: string;
  responseData?: unknown;
  tokenUsage: TokenUsage;
  estimatedCostUsd: number;
  expiresInDays?: number;
};

type AiCacheConfig = Record<AICacheOperationType, { ttlHours: number }>;

const defaultAiCacheConfig: AiCacheConfig = {
  chat: { ttlHours: 24 },
  plan_report: { ttlHours: 24 * 7 },
  market_report: { ttlHours: 24 * 7 },
  executive_report: { ttlHours: 24 * 7 },
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

function safeLimitNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function getAiUsageLimitConfig(): AiUsageLimitConfig {
  const rawConfig = process.env.AI_COST_CONFIG;

  if (!rawConfig) {
    return defaultAiOperationLimits;
  }

  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    const limits = parsed.limits && typeof parsed.limits === "object"
      ? parsed.limits as Record<string, unknown>
      : {};

    return (["free", "pro", "business"] as const).reduce<AiUsageLimitConfig>(
      (config, tier) => {
        const tierLimits = limits[tier] && typeof limits[tier] === "object"
          ? limits[tier] as Record<string, unknown>
          : {};
        const fallback = defaultAiOperationLimits[tier];

        config[tier] = {
          monthlyReportCount: safeLimitNumber(
            tierLimits.monthlyReportCount ?? tierLimits.monthlyReports,
            fallback.monthlyReportCount
          ),
          monthlyChatTokens: safeLimitNumber(tierLimits.monthlyChatTokens, fallback.monthlyChatTokens),
          monthlyPdfExports: safeLimitNumber(
            tierLimits.monthlyPdfExports ?? tierLimits.pdfExports,
            fallback.monthlyPdfExports
          ),
        };

        return config;
      },
      { ...defaultAiOperationLimits }
    );
  } catch {
    return defaultAiOperationLimits;
  }
}

function normalizeCacheOperationType(value: unknown): AICacheOperationType {
  return value === "plan_report" ||
    value === "market_report" ||
    value === "executive_report"
    ? value
    : "chat";
}

function getAiCacheConfig(): AiCacheConfig {
  const rawConfig = process.env.AI_CACHE_CONFIG;

  if (!rawConfig) {
    return defaultAiCacheConfig;
  }

  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>;

    return (["chat", "plan_report", "market_report", "executive_report"] as const).reduce<AiCacheConfig>(
      (config, operationType) => {
        const operationConfig = parsed[operationType] && typeof parsed[operationType] === "object"
          ? parsed[operationType] as Record<string, unknown>
          : {};
        const ttlHours = safeLimitNumber(
          operationConfig.ttlHours ?? operationConfig.ttl_hours,
          defaultAiCacheConfig[operationType].ttlHours
        );

        config[operationType] = { ttlHours };
        return config;
      },
      { ...defaultAiCacheConfig }
    );
  } catch {
    return defaultAiCacheConfig;
  }
}

function getAiCacheTtlMs(operationType: AICacheOperationType) {
  return getAiCacheConfig()[operationType].ttlHours * 60 * 60 * 1_000;
}

function shouldAllowGlobalAiCacheSharing() {
  return process.env.AI_CACHE_ALLOW_GLOBAL_SHARING === "true";
}

function inferOperationType(input: {
  endpoint: string;
  requestKind?: AiRequestKind;
  reportField?: string;
  metadata?: Record<string, unknown>;
}): AIUsageOperationType {
  const metadataOperation = readMetadataString(input.metadata, "operation_type");

  if (
    metadataOperation === "chat" ||
    metadataOperation === "plan_report" ||
    metadataOperation === "market_report" ||
    metadataOperation === "executive_report" ||
    metadataOperation === "pdf_export"
  ) {
    return metadataOperation;
  }

  if (input.endpoint.includes("market-analysis") || input.requestKind === "market_analysis") {
    return "market_report";
  }

  if (input.endpoint.includes("plan") || input.requestKind === "report_generation") {
    return "plan_report";
  }

  if (input.endpoint.includes("pdf")) {
    return "pdf_export";
  }

  return "chat";
}

async function loadMonthlyOperationUsage(
  supabase: SupabaseClient,
  userId: string,
  operationType: AIUsageOperationType | AIUsageOperationType[]
) {
  const monthStart = startOfUtcMonth().toISOString();
  const operationTypes = Array.isArray(operationType) ? operationType : [operationType];
  const selectColumns = "id,total_tokens,status,operation_type,metadata";
  const primary = await supabase
    .from("ai_usage_events")
    .select(selectColumns)
    .eq("user_id", userId)
    .eq("status", "completed")
    .eq("metadata->>quota_consumed", "true")
    .neq("metadata->>usage_kind", QUOTA_COUNTING_USAGE_KIND_EXCLUSION)
    .in("operation_type", operationTypes)
    .gte("created_at", monthStart)
    .limit(5000);
  let data: Array<Record<string, unknown>> | null = primary.data as Array<Record<string, unknown>> | null;
  let error = primary.error;

  if (error && /operation_type|column/i.test(error.message || "")) {
    const fallback = await supabase
      .from("ai_usage_events")
      .select("id,total_tokens,status,metadata")
      .eq("user_id", userId)
      .eq("status", "completed")
      .eq("metadata->>quota_consumed", "true")
      .neq("metadata->>usage_kind", QUOTA_COUNTING_USAGE_KIND_EXCLUSION)
      .in("metadata->>operation_type", operationTypes)
      .gte("created_at", monthStart)
      .limit(5000);

    data = fallback.data as Array<Record<string, unknown>> | null;
    error = fallback.error;
  }

  if (error) {
    logServerError("ai-governance:operation-usage-limit", error);
    return {
      requestCount: 0,
      totalTokens: 0,
      error: error.message,
    };
  }

  const rows = data ?? [];

  return {
    requestCount: rows.length,
    totalTokens: rows.reduce((sum, row) => sum + safeNumber(row.total_tokens), 0),
    error: "",
  };
}

function buildUsageLimitMessage(operationType: AIUsageOperationType) {
  if (operationType === "chat") {
    return "Monthly AI chat token limit reached.\nUpgrade your plan to continue.";
  }

  if (operationType === "pdf_export") {
    return "Monthly PDF export limit reached.\nUpgrade your plan to continue.";
  }

  return "Monthly AI report limit reached.\nUpgrade your plan to continue.";
}

export function selectAiModel(kind: AiRequestKind) {
  return resolveAiModelForRequestKind(kind);
}

export function estimateAiCostUsd(model: string, tokenUsage: TokenUsage) {
  return estimateModelCostUsd(model, tokenUsage) ?? 0;
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
  operationType?: AICacheOperationType;
  endpoint: string;
  normalizedPrompt: string;
  mode: string;
  language: string;
  model: string;
  options?: Record<string, unknown>;
}) {
  const normalizedParts = {
    operationType: parts.operationType ?? normalizeCacheOperationType(inferOperationType({
      endpoint: parts.endpoint,
      reportField: parts.mode,
    })),
    endpoint: parts.endpoint,
    inputHash: hashAiPayload(parts.normalizedPrompt),
    mode: parts.mode,
    language: parts.language,
    model: parts.model,
    options: parts.options
      ? Object.keys(parts.options)
          .sort()
          .reduce<Record<string, unknown>>((sorted, key) => {
            sorted[key] = parts.options?.[key];
            return sorted;
          }, {})
      : {},
  };

  return hashAiPayload(JSON.stringify(normalizedParts));
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

export async function checkAIUsagePermission({
  supabase,
  userId,
  operationType,
  planTier,
}: {
  supabase: SupabaseClient;
  userId: string;
  operationType: AIUsageOperationType;
  planTier?: PlanTier;
}): Promise<{
  allowed: boolean;
  reason?: string;
  planTier: PlanTier;
  remainingUsage: {
    reports: number;
    tokens: number;
    pdfExports: number;
  };
  usage: {
    reports: number;
    tokens: number;
    pdfExports: number;
  };
  limits: {
    monthlyReportCount: number;
    monthlyChatTokens: number;
    monthlyPdfExports: number;
  };
}> {
  const resolvedPlanTier = planTier ?? await getUserPlanTier(supabase, userId);
  const limits = getAiUsageLimitConfig()[resolvedPlanTier];
  const [reportUsage, chatUsage, pdfUsage] = await Promise.all([
    loadMonthlyOperationUsage(supabase, userId, ["plan_report", "market_report"]),
    loadMonthlyOperationUsage(supabase, userId, "chat"),
    loadMonthlyOperationUsage(supabase, userId, "pdf_export"),
  ]);
  const usage = {
    reports: reportUsage.requestCount,
    tokens: chatUsage.totalTokens,
    pdfExports: pdfUsage.requestCount,
  };
  const remainingUsage = {
    reports: Math.max(0, limits.monthlyReportCount - usage.reports),
    tokens: Math.max(0, limits.monthlyChatTokens - usage.tokens),
    pdfExports: Math.max(0, limits.monthlyPdfExports - usage.pdfExports),
  };
  const blocked =
    (operationType === "chat" && remainingUsage.tokens <= 0) ||
    ((operationType === "plan_report" || operationType === "market_report") &&
      remainingUsage.reports <= 0) ||
    (operationType === "pdf_export" && remainingUsage.pdfExports <= 0);

  return {
    allowed: !blocked,
    reason: blocked ? buildUsageLimitMessage(operationType) : undefined,
    planTier: resolvedPlanTier,
    remainingUsage,
    usage,
    limits,
  };
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

  const operationType = inferOperationType({
    endpoint: "",
    requestKind,
    reportField: requestKind,
  });
  const operationLimits = getAiUsageLimitConfig()[planTier];
  const operationPermission = await checkAIUsagePermission({
    supabase,
    userId,
    operationType,
    planTier,
  });

  if (
    operationType === "chat" &&
    !operationPermission.allowed
  ) {
    return {
      allowed: false,
      planTier,
      requestKind,
      operationType,
      dailyUsed,
      monthlyUsed,
      monthlyOperationUsed: operationPermission.usage.tokens,
      monthlyOperationLimit: operationLimits.monthlyChatTokens,
      remainingUsage: operationPermission.remainingUsage,
      ...limit,
      reason: operationPermission.reason || buildUsageLimitMessage(operationType),
    };
  }

  if (
    (operationType === "plan_report" || operationType === "market_report") &&
    !operationPermission.allowed
  ) {
    return {
      allowed: false,
      planTier,
      requestKind,
      operationType,
      dailyUsed,
      monthlyUsed,
      monthlyOperationUsed: operationPermission.usage.reports,
      monthlyOperationLimit: operationLimits.monthlyReportCount,
      remainingUsage: operationPermission.remainingUsage,
      ...limit,
      reason: operationPermission.reason || buildUsageLimitMessage(operationType),
    };
  }

  return {
    allowed: true,
    planTier,
    requestKind,
    operationType,
    dailyUsed,
    monthlyUsed,
    monthlyOperationUsed:
      operationType === "chat"
        ? operationPermission.usage.tokens
        : operationType === "pdf_export"
          ? operationPermission.usage.pdfExports
          : operationPermission.usage.reports,
    monthlyOperationLimit:
      operationType === "chat"
        ? operationLimits.monthlyChatTokens
        : operationType === "pdf_export"
          ? operationLimits.monthlyPdfExports
          : operationLimits.monthlyReportCount,
    remainingUsage: operationPermission.remainingUsage,
    ...limit,
    reason: "",
  };
}

export async function getCachedAiResponse(
  supabase: SupabaseClient,
  userId: string,
  cacheKey: string
): Promise<CachedAiResponse | null> {
  const primary = await supabase
    .from("ai_response_cache")
    .select(
      "response_text,response_data,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,model,hit_count"
    )
    .eq("user_id", userId)
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  let data = primary.data as Record<string, unknown> | null;
  let error = primary.error;

  if (error && /response_data|column/i.test(error.message || "")) {
    const fallback = await supabase
      .from("ai_response_cache")
      .select(
        "response_text,prompt_tokens,completion_tokens,total_tokens,estimated_cost_usd,model,hit_count"
      )
      .eq("user_id", userId)
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    data = fallback.data as Record<string, unknown> | null;
    error = fallback.error;
  }

  if (error) {
    logServerError("ai-governance:cache-read", error);
  } else if (data?.response_text) {
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
      responseData: data.response_data,
      promptTokens: safeNumber(data.prompt_tokens),
      completionTokens: safeNumber(data.completion_tokens),
      totalTokens: safeNumber(data.total_tokens),
      estimatedCostUsd: safeNumber(data.estimated_cost_usd),
      model: typeof data.model === "string" ? data.model : "",
    };
  }

  if (shouldAllowGlobalAiCacheSharing()) {
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
  }

  return null;
}

export async function storeCachedAiResponse(
  supabase: SupabaseClient,
  input: CacheInput
) {
  const operationType = normalizeCacheOperationType(input.operationType ?? inferOperationType({
    endpoint: input.endpoint,
    reportField: input.reportField,
  }));
  const ttlMs = input.expiresInDays
    ? input.expiresInDays * 24 * 60 * 60 * 1_000
    : getAiCacheTtlMs(operationType);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  if (shouldAllowGlobalAiCacheSharing()) {
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
  }

  const cacheRow = {
    user_id: input.userId,
    cache_key: input.cacheKey,
    operation_type: operationType,
    input_hash: input.promptHash,
    prompt_hash: input.promptHash,
    endpoint: input.endpoint,
    report_field: input.reportField ?? null,
    language: input.language,
    model: input.model,
    response_text: input.responseText,
    response_data: input.responseData ?? { text: input.responseText },
    prompt_tokens: input.tokenUsage.promptTokens,
    completion_tokens: input.tokenUsage.completionTokens,
    total_tokens: input.tokenUsage.totalTokens,
    token_savings: input.tokenUsage.totalTokens,
    estimated_cost_usd: input.estimatedCostUsd,
    expires_at: expiresAt,
  };
  const { error } = await supabase.from("ai_response_cache").upsert(
    cacheRow,
    { onConflict: "user_id,cache_key" }
  );

  if (!error) {
    return;
  }

  if (!/operation_type|input_hash|response_data|token_savings|column/i.test(error.message || "")) {
    logServerError("ai-governance:cache-write", error);
    return;
  }

  const { error: fallbackError } = await supabase.from("ai_response_cache").upsert(
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

  if (fallbackError) {
    logServerError("ai-governance:cache-write", fallbackError);
  }
}

export async function recordAiUsage(
  supabase: SupabaseClient,
  input: UsageEventInput
) {
  const metadata = input.metadata ?? {};
  const operationType =
    input.operationType ||
    inferOperationType({
      endpoint: input.endpoint,
      reportField: input.reportField,
      metadata,
    });
  const metadataReportId =
    readMetadataString(metadata, "report_id") ||
    readMetadataString(metadata, "reportId") ||
    readMetadataString(metadata, "saved_report_id") ||
    readMetadataString(metadata, "savedReportId");
  const metadataConversationId =
    readMetadataString(metadata, "conversation_id") ||
    readMetadataString(metadata, "conversationId");
  const metadataReportRequestId =
    readMetadataString(metadata, "report_request_id") ||
    readMetadataString(metadata, "reportRequestId");
  const reportId =
    input.reportId ?? (metadataReportId || null);
  const rawConversationId = input.conversationId ?? (metadataConversationId || null);
  const conversationId = rawConversationId && isUuid(rawConversationId)
    ? rawConversationId
    : null;
  const reportRequestId =
    input.reportRequestId ?? (metadataReportRequestId || null);
  const status = input.status ?? "completed";
  const generationSuccess = status === "completed";
  const isReportOperation =
    operationType === "plan_report" ||
    operationType === "market_report" ||
    operationType === "executive_report";
  const retryCount =
    readMetadataNumber(metadata, "retry_count") ||
    readMetadataNumber(metadata, "retryCount");
  const responseLength =
    readMetadataNumber(metadata, "response_length") ||
    readMetadataNumber(metadata, "responseLength") ||
    (generationSuccess ? input.tokenUsage.completionTokens * 4 : 0);
  const { error } = await supabase.from("ai_usage_events").insert({
    user_id: input.userId,
    operation_type: operationType,
    endpoint: input.endpoint,
    report_field: input.reportField ?? null,
    report_id: reportId,
    conversation_id: conversationId,
    report_request_id: reportRequestId,
    prompt_hash: input.promptHash,
    model: input.model,
    plan_tier: input.planTier,
    prompt_tokens: input.tokenUsage.promptTokens,
    completion_tokens: input.tokenUsage.completionTokens,
    total_tokens: input.tokenUsage.totalTokens,
    estimated_cost_usd: input.estimatedCostUsd,
    cache_hit: input.cacheHit,
    status,
    response_time_ms: input.responseTimeMs,
    metadata: {
      ...metadata,
      operation_type: operationType,
      quality_monitoring_version: "v1",
      report_type: input.reportField ?? operationType,
      report_completed:
        typeof metadata.report_completed === "boolean"
          ? metadata.report_completed
          : isReportOperation && generationSuccess,
      generation_success:
        typeof metadata.generation_success === "boolean"
          ? metadata.generation_success
          : generationSuccess,
      retry_count: retryCount,
      response_length: responseLength,
      ...(input.cacheHit
        ? {
            cache_event: "hit",
            token_savings: input.tokenUsage.totalTokens,
            estimated_token_savings: input.tokenUsage.totalTokens,
          }
        : {
            cache_event: "miss",
          }),
    },
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
