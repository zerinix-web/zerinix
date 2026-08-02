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
import {
  MARKET_INTELLIGENCE_GRAPH_VERSION,
  type MarketIntelligenceGraph,
} from "@/app/lib/ai/market-intelligence-graph";
import { estimateAiInputTokens } from "@/app/lib/ai/token-optimization";
import { resolveCachedOrExecuteResearch } from "@/app/lib/ai/research-cache-core";
import { logOperationalInfo } from "@/app/lib/security/logging";

const RESEARCH_CACHE_VERSION = "research-result-v1";
const REPORT_CACHE_VERSION = "pre-research-report-v1";
const CONVERSATION_RESEARCH_VERSION = "conversation-research-v1";
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

export type ConversationResearchSnapshot = {
  version: typeof CONVERSATION_RESEARCH_VERSION;
  conversationId: string;
  identity: ResearchCacheIdentity;
  research: DomainResearchBundle;
  marketIntelligenceGraph?: MarketIntelligenceGraph;
  completedAt: string;
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

function parseConversationResearchSnapshot(
  value: unknown
): ConversationResearchSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Partial<ConversationResearchSnapshot>;

  if (
    payload.version !== CONVERSATION_RESEARCH_VERSION ||
    typeof payload.conversationId !== "string" ||
    !payload.identity ||
    !isDomainResearchBundle(payload.research) ||
    typeof payload.completedAt !== "string"
  ) {
    return null;
  }

  const marketIntelligenceGraph =
    payload.marketIntelligenceGraph?.version ===
    MARKET_INTELLIGENCE_GRAPH_VERSION
      ? payload.marketIntelligenceGraph
      : undefined;
  return {
    version: CONVERSATION_RESEARCH_VERSION,
    conversationId: payload.conversationId,
    identity: payload.identity,
    research: payload.research,
    ...(marketIntelligenceGraph ? { marketIntelligenceGraph } : {}),
    completedAt: payload.completedAt,
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

function isReusableResearch(research: DomainResearchBundle) {
  return (
    research.researchAttempted &&
    !research.fallbackUsed &&
    research.evidence.length > 0
  );
}

function getResearchCacheTtlDays(identity: ResearchCacheIdentity) {
  return /\b(latest|current|today|recent|news|güncel|bugün|son gelişmeler|haber)\b/i.test(
    identity.normalizedPrompt
  )
    ? 1
    : 7;
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

export function createConversationResearchCacheKey(conversationId: string) {
  return createAiCacheKey({
    endpoint: "/internal/conversation-research",
    normalizedPrompt: conversationId.trim().slice(0, 128),
    mode: CONVERSATION_RESEARCH_VERSION,
    language: "server",
    model: RESEARCH_MODEL,
  });
}

export function createResearchBundleFingerprint(research: DomainResearchBundle) {
  return createAiCacheKey({
    endpoint: "/internal/validated-research-fingerprint",
    normalizedPrompt: JSON.stringify(research),
    mode: RESEARCH_CACHE_VERSION,
    language: "server",
    model: RESEARCH_MODEL,
  });
}

/**
 * Persists the exact validated research bundle used to produce a chat answer.
 * The snapshot is user-scoped and deliberately excluded from global sharing,
 * so a browser can reference a conversation but can never supply evidence.
 */
export async function storeConversationResearchSnapshot(input: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  identity: ResearchCacheIdentity;
  research: DomainResearchBundle;
  marketIntelligenceGraph?: MarketIntelligenceGraph;
}) {
  const conversationId = input.conversationId.trim().slice(0, 128);
  if (!conversationId || !isReusableResearch(input.research)) return null;

  const cacheKey = createConversationResearchCacheKey(conversationId);
  const tokenUsage = estimateResearchUsage(input.identity, input.research);
  const snapshot: ConversationResearchSnapshot = {
    version: CONVERSATION_RESEARCH_VERSION,
    conversationId,
    identity: input.identity,
    research: input.research,
    ...(input.marketIntelligenceGraph
      ? { marketIntelligenceGraph: input.marketIntelligenceGraph }
      : {}),
    completedAt: new Date().toISOString(),
  };

  await storeCachedAiResponse(input.supabase, {
    userId: input.userId,
    cacheKey,
    promptHash: cacheKey,
    endpoint: "/internal/conversation-research",
    operationType: "chat",
    reportField: "validated_research_snapshot",
    language: input.identity.language,
    model: RESEARCH_MODEL,
    responseText: JSON.stringify(snapshot),
    responseData: snapshot,
    tokenUsage,
    estimatedCostUsd: estimateAiCostUsd(RESEARCH_MODEL, tokenUsage),
    expiresInDays: getResearchCacheTtlDays(input.identity),
    allowGlobalSharing: false,
  });

  return snapshot;
}

export async function getConversationResearchSnapshot(input: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
}) {
  const conversationId = input.conversationId?.trim().slice(0, 128) || "";
  if (!conversationId) return null;

  const cached = await getCachedAiResponse(
    input.supabase,
    input.userId,
    createConversationResearchCacheKey(conversationId),
    { allowGlobalSharing: false }
  );
  let snapshot = parseConversationResearchSnapshot(cached?.responseData);
  if (!snapshot && cached?.responseText) {
    try {
      snapshot = parseConversationResearchSnapshot(JSON.parse(cached.responseText));
    } catch {
      snapshot = null;
    }
  }

  return snapshot?.conversationId === conversationId ? snapshot : null;
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

export function getCachedMarketIntelligenceGraphFromReportData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const graph = (value as { marketIntelligenceGraph?: unknown })
    .marketIntelligenceGraph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return null;
  return (graph as Partial<MarketIntelligenceGraph>).version ===
    MARKET_INTELLIGENCE_GRAPH_VERSION
    ? (graph as MarketIntelligenceGraph)
    : null;
}

export function createReportCacheData(
  research: DomainResearchBundle,
  marketIntelligenceGraph?: MarketIntelligenceGraph
) {
  return {
    version: REPORT_CACHE_VERSION,
    research,
    ...(marketIntelligenceGraph ? { marketIntelligenceGraph } : {}),
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
  conversationId?: string | null;
  execute: () => Promise<DomainResearchBundle>;
}) {
  const conversationSnapshot = await getConversationResearchSnapshot({
    supabase: input.supabase,
    userId: input.userId,
    conversationId: input.conversationId,
  });

  if (conversationSnapshot) {
    const tokenUsage = estimateResearchUsage(
      conversationSnapshot.identity,
      conversationSnapshot.research
    );
    logOperationalInfo("[research-cache] conversation snapshot hit", {
      conversationId: conversationSnapshot.conversationId,
      sourceReportFamily: conversationSnapshot.identity.reportFamily,
      sourceAnalysisMode: conversationSnapshot.identity.analysisMode,
      requestedReportFamily: input.identity.reportFamily,
      requestedAnalysisMode: input.identity.analysisMode,
      skippedGptResearchCalls: true,
      estimatedSavedTokens: tokenUsage.totalTokens,
      estimatedSavedUsd: estimateAiCostUsd(RESEARCH_MODEL, tokenUsage),
    });
    return {
      research: conversationSnapshot.research,
      cacheHit: true,
      cacheKey: createConversationResearchCacheKey(
        conversationSnapshot.conversationId
      ),
      source: "conversation_snapshot" as const,
    };
  }

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
      if (!isReusableResearch(research)) {
        logOperationalInfo("[research-cache] skipped non-reusable result", {
          reportFamily: input.identity.reportFamily,
          analysisMode: input.identity.analysisMode,
          researchAttempted: research.researchAttempted,
          fallbackUsed: research.fallbackUsed,
          evidenceCount: research.evidence.length,
        });
        return;
      }

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
        expiresInDays: getResearchCacheTtlDays(input.identity),
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

  return { research: resolution.value, cacheHit, cacheKey, source: resolution.source };
}
