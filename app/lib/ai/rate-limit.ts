import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkUsageAllowance,
  createAiPromptHash,
  dailyAiLimitMessage,
  getUserPlanTier,
  normalizeAiPrompt,
  recordAiUsage,
  selectAiModel,
  type AiRequestKind,
} from "@/app/lib/ai/governance";

type AiProductionRateLimitInput = {
  supabase: SupabaseClient;
  userId: string;
  endpoint: string;
  requestKind: AiRequestKind;
  promptText: string;
  reportField?: string;
  reportRequestId?: string;
  ip: string;
};

export async function checkAiProductionRateLimit({
  supabase,
  userId,
  endpoint,
  requestKind,
  promptText,
  reportField,
  reportRequestId,
  ip,
}: AiProductionRateLimitInput) {
  const planTier = await getUserPlanTier(supabase, userId);
  const model = selectAiModel(requestKind);
  const normalizedPrompt = normalizeAiPrompt(promptText);
  const promptHash = createAiPromptHash(promptText);

  if (reportRequestId) {
    const { count, error } = await supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .eq("metadata->>quota_event", "true")
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

  const allowance = await checkUsageAllowance(supabase, userId, planTier);

  if (!allowance.allowed) {
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
        quota_event: true,
        report_request_id: reportRequestId ?? null,
        usage_kind: "quota_check",
        reason: dailyAiLimitMessage,
        dailyUsed: allowance.dailyUsed,
        dailyRequests: allowance.dailyRequests,
        monthlyUsed: allowance.monthlyUsed,
        monthlyRequests: allowance.monthlyRequests,
        limitKey: userId || ip,
        limitScope: userId ? "user" : "ip",
      },
    });
  } else {
    await recordAiUsage(supabase, {
      userId,
      endpoint,
      reportField: reportRequestId ? undefined : reportField,
      promptHash,
      model,
      planTier,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      cacheHit: false,
      responseTimeMs: 0,
      metadata: {
        quota_event: true,
        report_request_id: reportRequestId ?? null,
        usage_kind: "quota_check",
        requestKind,
        first_report_field: reportField ?? null,
      },
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
