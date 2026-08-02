import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAiCacheKey,
  estimateAiCostUsd,
  getCachedAiResponse,
  storeCachedAiResponse,
  type TokenUsage,
} from "@/app/lib/ai/governance";
import type { DomainResearchBundle } from "@/app/lib/ai/domain-research";
import { estimateAiInputTokens } from "@/app/lib/ai/token-optimization";
import { resolveCachedOrExecuteResearch } from "@/app/lib/ai/research-cache-core";
import { logOperationalInfo } from "@/app/lib/security/logging";

const RESEARCH_CACHE_VERSION = "research-result-v1";
const REPORT_CACHE_VERSION = "pre-research-report-v1";
const RESEARCH_MODEL = "gpt-5.5";

export type ResearchCacheIdentity = {
  normalizedPrompt: string;
  uploadedAssetHash: string;
  analysisMode: string;
  language: string;
  reportFamily: string;
};

type CachedResearchPayload = {
  version: typeof RESEARCH_CACHE_VERSION;
  identity: ResearchCacheIdentity;
  research: DomainResearchBundle;
  estimatedTokenUsage: TokenUsage;
  estimatedCostUsd: number;
};

function serializeIdentity(identity: ResearchCacheIdentity) {
  return JSON.stringify({
    normalizedPrompt: identity.normalizedPrompt,
    uploadedAssetHash: identity.uploadedAssetHash,
    analysisMode: identity.analysisMode,
    language: identity.language,
    reportFamily: identity.reportFamily,
  });
}

function isDomainResearchBundle(value: unknown): value is DomainResearchBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bundle = value as Partial<DomainResearchBundle>;

  return (
    typeof bundle.domain === "string" &&
    Array.isArray(bundle.plan) &&
    Array.isArray(bundle.evidence) &&
    Array.isArray(bundle.attemptedFields) &&
    Array.isArray(bundle.unresolvedFields) &&
    !!bundle.decisionIntelligence &&
    typeof bundle.decisionIntelligence === "object" &&
    !!bundle.timings &&
    typeof bundle.timings === "object"
  );
}

function parseCachedResearch(value: unknown): CachedResearchPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<CachedResearchPayload>;

  if (
    payload.version !== RESEARCH_CACHE_VERSION ||
    !payload.identity ||
    !isDomainResearchBundle(payload.research)
  ) {
    return null;
  }

  const estimatedTokenUsage = payload.estimatedTokenUsage;
  return {
    version: RESEARCH_CACHE_VERSION,
    identity: payload.identity,
    research: payload.research,
    estimatedTokenUsage: {
      promptTokens: Number(estimatedTokenUsage?.promptTokens) || 0,
      completionTokens: Number(estimatedTokenUsage?.completionTokens) || 0,
      totalTokens: Number(estimatedTokenUsage?.totalTokens) || 0,
    },
    estimatedCostUsd: Number(payload.estimatedCostUsd) || 0,
  };
}

function estimateResearchUsage(
  identity: ResearchCacheIdentity,
  research: DomainResearchBundle
): TokenUsage {
  const serializedResearch = JSON.stringify(research);
  const taskCount = Math.max(1, research.plan.length);
  const promptTokens = Math.max(
    1_500,
    estimateAiInputTokens(identity.normalizedPrompt) + taskCount * 500
  );
  const completionTokens = Math.max(
    1_000,
    estimateAiInputTokens(serializedResearch)
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export function createResearchResultCacheKey(identity: ResearchCacheIdentity) {
  return createAiCacheKey({
    endpoint: "/internal/research",
    normalizedPrompt: serializeIdentity(identity),
    mode: `${RESEARCH_CACHE_VERSION}:${identity.reportFamily}:${identity.analysisMode}`,
    language: identity.language,
    model: RESEARCH_MODEL,
  });
}

export function createPreResearchReportCacheKey(input: {
  endpoint: string;
  identity: ResearchCacheIdentity;
  model: string;
  reportVariant: string;
  contextFingerprint?: string;
}) {
  return createAiCacheKey({
    endpoint: input.endpoint,
    normalizedPrompt: serializeIdentity(input.identity),
    mode: `${REPORT_CACHE_VERSION}:${input.identity.reportFamily}:${input.reportVariant}`,
    language: input.identity.language,
    model: input.model,
    options: {
      analysisMode: input.identity.analysisMode,
      contextFingerprint: input.contextFingerprint || "",
      uploadedAssetHash: input.identity.uploadedAssetHash,
    },
  });
}

export function getCachedResearchFromReportData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const research = (value as { research?: unknown }).research;
  return isDomainResearchBundle(research) ? research : null;
}

export function createReportCacheData(research: DomainResearchBundle) {
  return {
    version: REPORT_CACHE_VERSION,
    research,
  };
}

export function logSkippedResearchForReportCache(input: {
  identity: ResearchCacheIdentity;
  model?: string;
  research?: DomainResearchBundle | null;
}) {
  const tokenUsage = input.research
    ? estimateResearchUsage(input.identity, input.research)
    : { promptTokens: 4_000, completionTokens: 2_000, totalTokens: 6_000 };
  const estimatedSavedUsd = estimateAiCostUsd(
    input.model || RESEARCH_MODEL,
    tokenUsage
  );

  logOperationalInfo("[research-cache] report cache hit", {
    reportFamily: input.identity.reportFamily,
    analysisMode: input.identity.analysisMode,
    researchCacheHit: true,
    skippedGptResearchCalls: true,
    estimatedSavedTokens: tokenUsage.totalTokens,
    estimatedSavedUsd,
  });
}

export async function resolveDomainResearchWithCache(input: {
  supabase: SupabaseClient;
  userId: string;
  identity: ResearchCacheIdentity;
  execute: () => Promise<DomainResearchBundle>;
}) {
  const cacheKey = createResearchResultCacheKey(input.identity);
  const resolution = await resolveCachedOrExecuteResearch({
    dedupeKey: `${input.userId}:${cacheKey}`,
    read: async () => {
      const cached = await getCachedAiResponse(
        input.supabase,
        input.userId,
        cacheKey
      );
      let payload = parseCachedResearch(cached?.responseData);
      if (!payload && cached?.responseText) {
        try {
          payload = parseCachedResearch(JSON.parse(cached.responseText));
        } catch {
          payload = null;
        }
      }
      return payload?.research ?? null;
    },
    execute: input.execute,
    write: async (research) => {
      const tokenUsage = estimateResearchUsage(input.identity, research);
      const estimatedCostUsd = estimateAiCostUsd(RESEARCH_MODEL, tokenUsage);
      const payload: CachedResearchPayload = {
        version: RESEARCH_CACHE_VERSION,
        identity: input.identity,
        research,
        estimatedTokenUsage: tokenUsage,
        estimatedCostUsd,
      };

      await storeCachedAiResponse(input.supabase, {
        userId: input.userId,
        cacheKey,
        promptHash: cacheKey,
        endpoint: "/internal/research",
        operationType:
          input.identity.reportFamily === "market_analysis"
            ? "market_report"
            : "plan_report",
        reportField: `research:${input.identity.reportFamily}`,
        language: input.identity.language,
        model: RESEARCH_MODEL,
        responseText: JSON.stringify(payload),
        responseData: payload,
        tokenUsage,
        estimatedCostUsd,
        expiresInDays: 7,
      });
    },
  });
  const tokenUsage = estimateResearchUsage(input.identity, resolution.value);
  const estimatedSavedUsd = estimateAiCostUsd(RESEARCH_MODEL, tokenUsage);
  const cacheHit = resolution.source !== "generated";

  logOperationalInfo(
    resolution.source === "generated"
      ? "[research-cache] miss"
      : resolution.source === "in_flight"
        ? "[research-cache] joined in-flight research"
        : "[research-cache] hit",
    {
      reportFamily: input.identity.reportFamily,
      analysisMode: input.identity.analysisMode,
      researchCacheHit: cacheHit,
      skippedGptResearchCalls: cacheHit,
      estimatedSavedTokens: cacheHit ? tokenUsage.totalTokens : 0,
      estimatedSavedUsd: cacheHit ? estimatedSavedUsd : 0,
    }
  );

  return { research: resolution.value, cacheHit, cacheKey };
}
