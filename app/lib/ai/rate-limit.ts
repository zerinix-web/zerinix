import type { SupabaseClient } from "@supabase/supabase-js";
import { isFounderAccount } from "@/app/lib/beta-access";
import { logOperationalInfo } from "@/app/lib/security/logging";
import {
  checkUsageAllowance,
  createAiPromptHash,
  dailyAiLimitMessage,
  getUserPlanTier,
  normalizeAiPrompt,
  recordAiUsage,
  type AiRequestKind,
  type AIUsageOperationType,
} from "@/app/lib/ai/governance";
import {
  logAiModelRoutingDecision,
  resolveAiModelRoutingDecision,
} from "@/app/lib/ai/model-router";
import { checkAIAbuseProtection } from "@/app/lib/ai/abuse-protection";
import { QUOTA_COUNTING_USAGE_KIND_EXCLUSION } from "@/app/lib/ai/quota-rules.mjs";

type AiProductionRateLimitInput = {
  supabase: SupabaseClient;
  userId: string;
  account?: Parameters<typeof isFounderAccount>[0];
  endpoint: string;
  requestKind: AiRequestKind;
  promptText: string;
  reportField?: string;
  reportRequestId?: string;
  ip: string;
};

function operationTypeForRequestKind(requestKind: AiRequestKind): AIUsageOperationType {
  if (requestKind === "market_analysis") {
    return "market_report";
  }

  if (requestKind === "report_generation") {
    return "plan_report";
  }

  return "chat";
}

export async function checkAiProductionRateLimit({
  supabase,
  userId,
  account,
  endpoint,
  requestKind,
  promptText,
  reportField,
  reportRequestId,
  ip,
}: AiProductionRateLimitInput) {
  const planTier = await getUserPlanTier(supabase, userId);
  const routingDecision = resolveAiModelRoutingDecision({
    requestKind,
    prompt: promptText,
  });
  const model = routingDecision.routedModel;
  logAiModelRoutingDecision(routingDecision, {
    endpoint,
    operation: reportField || requestKind,
  });
  const normalizedPrompt = normalizeAiPrompt(promptText);
  const promptHash = createAiPromptHash(promptText);
  const operationType = operationTypeForRequestKind(requestKind);
  const founderQuotaExempt = isFounderAccount(account);
  const abuseProtection = await checkAIAbuseProtection({
    supabase,
    userId,
    endpoint,
    operationType,
    promptText,
    promptHash,
    reportField,
    reportRequestId,
    ip,
  });

  if (!abuseProtection.allowed) {
    logOperationalInfo("[ai abuse] request blocked", {
      endpoint,
      reportField: reportField ?? null,
      reportRequestId: reportRequestId ?? null,
      planTier,
      requestKind,
      operationType,
      providerCalled: false,
      quotaConsumed: false,
      abuseType: abuseProtection.type,
      failureReason: abuseProtection.reason,
    });

    await recordAiUsage(supabase, {
      userId,
      endpoint,
      operationType,
      reportField,
      promptHash,
      model,
      planTier,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      cacheHit: false,
      status: "rate_limited",
      responseTimeMs: 0,
      metadata: {
        quota_event: false,
        quota_mode: requestKind,
        quota_consumed: false,
        report_request_id: reportRequestId ?? null,
        usage_kind: "abuse_check",
        abuse_type: abuseProtection.type,
        reason: abuseProtection.reason,
        limitKey: userId || ip,
        limitScope: userId ? "user" : "ip",
      },
    });

    return {
      allowed: false,
      planTier,
      dailyUsed: 0,
      monthlyUsed: 0,
      dailyRequests: 0,
      monthlyRequests: 0,
      reason: abuseProtection.reason || "AI request blocked.",
      model,
      promptHash,
      normalizedPrompt,
      quotaAlreadyCharged: true,
      abuseType: abuseProtection.type,
    };
  }

  if (founderQuotaExempt) {
    logOperationalInfo("[ai quota] founder account quota bypass", {
      endpoint,
      reportField: reportField ?? null,
      reportRequestId: reportRequestId ?? null,
      planTier,
      requestKind,
      providerCalled: false,
      quotaConsumed: false,
      quotaExempt: true,
    });

    return {
      allowed: true,
      planTier,
      dailyUsed: 0,
      monthlyUsed: 0,
      dailyRequests: Number.POSITIVE_INFINITY,
      monthlyRequests: Number.POSITIVE_INFINITY,
      reason: "",
      model,
      promptHash,
      normalizedPrompt,
      quotaAlreadyCharged: true,
      quotaExempt: true,
    };
  }

  if (reportRequestId) {
    const { count, error } = await supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .eq("metadata->>quota_event", "true")
      .neq("metadata->>usage_kind", QUOTA_COUNTING_USAGE_KIND_EXCLUSION)
      .eq("metadata->>report_request_id", reportRequestId);

    if (!error && count && count > 0) {
      return {
        allowed: true,
        planTier,
        dailyUsed: 0,
        monthlyUsed: 0,
        dailyRequests: 0,
        monthlyRequests: 0,
        reason: "",
        model,
        promptHash,
        normalizedPrompt,
        quotaAlreadyCharged: true,
      };
    }
  }

  const allowance = await checkUsageAllowance(supabase, userId, planTier, requestKind);
  const remainingUsage = "remainingUsage" in allowance ? allowance.remainingUsage : undefined;

  if (!allowance.allowed) {
    logOperationalInfo("[ai quota] request blocked", {
      endpoint,
      reportField: reportField ?? null,
      reportRequestId: reportRequestId ?? null,
      planTier,
      dailyUsed: allowance.dailyUsed,
      dailyRequests: allowance.dailyRequests,
      monthlyUsed: allowance.monthlyUsed,
      monthlyRequests: allowance.monthlyRequests,
      remainingUsage,
      providerCalled: false,
      quotaConsumed: false,
      failureReason: allowance.reason || dailyAiLimitMessage,
    });

    await recordAiUsage(supabase, {
      userId,
      endpoint,
      reportField,
      promptHash,
      model,
      planTier,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      cacheHit: false,
      status: "rate_limited",
      responseTimeMs: 0,
      metadata: {
        quota_event: false,
        quota_mode: requestKind,
        quota_consumed: false,
        report_request_id: reportRequestId ?? null,
        usage_kind: "quota_check",
        reason: allowance.reason || dailyAiLimitMessage,
        dailyUsed: allowance.dailyUsed,
        dailyRequests: allowance.dailyRequests,
        monthlyUsed: allowance.monthlyUsed,
        monthlyRequests: allowance.monthlyRequests,
        remainingUsage,
        limitKey: userId || ip,
        limitScope: userId ? "user" : "ip",
      },
    });
  } else {
    logOperationalInfo("[ai quota] request allowed", {
      endpoint,
      reportField: reportField ?? null,
      reportRequestId: reportRequestId ?? null,
      planTier,
      dailyUsed: allowance.dailyUsed,
      dailyRequests: allowance.dailyRequests,
      monthlyUsed: allowance.monthlyUsed,
      monthlyRequests: allowance.monthlyRequests,
      requestKind,
      providerCalled: false,
      quotaConsumed: false,
    });
  }

  return {
    ...allowance,
    model,
    planTier,
    promptHash,
    normalizedPrompt,
    quotaAlreadyCharged: false,
  };
}
