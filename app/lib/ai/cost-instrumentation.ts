import "server-only";

import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type OpenAI from "openai";
import {
  insertOpenAiCostEvent,
  selectOpenAiCostEvents,
  upsertOpenAiCostSummary,
} from "@/app/admin/openai-cost-store";
import {
  estimateOpenAiCostBreakdown,
  extractOpenAiTokenUsageDetails,
  summarizeOpenAiCostEvents,
  type OpenAiCostEventLike,
} from "@/app/lib/ai/cost-metrics";
import { analyzeOpenAiRequestInput } from "@/app/lib/ai/token-optimization-core";

type CacheStatus = "hit" | "miss" | "provider_cached";

type RequestContext = {
  requestId: string;
  parentRequestId: string | null;
  userId: string | null;
  route: string;
  reportType: string;
  events: CostEvent[];
  pendingWrites: Promise<void>[];
};

type PersistedCostEvent = {
  call_id: string;
  operation_name: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  web_search_calls: number;
  estimated_input_cost_usd: number | string;
  estimated_output_cost_usd: number | string;
  estimated_tool_cost_usd: number | string;
  estimated_total_cost_usd: number | string;
  duration_ms: number;
  retry_count: number;
  cache_status: CacheStatus;
  cache_savings_usd: number | string;
  duplicate_fingerprint: string;
};

type OperationContext = {
  operationName: string;
  reportType?: string;
  retryCount?: number;
  cacheStatus?: CacheStatus;
};

type CostEvent = OpenAiCostEventLike & {
  callId: string;
  requestId: string;
  parentRequestId: string | null;
  userId: string | null;
  route: string;
  reportType: string;
  responseId: string;
  inputCostUsd: number;
  outputCostUsd: number;
  toolCostUsd: number;
  status: "completed" | "failed" | "incomplete" | "cache_hit";
  errorMessage: string;
};

const requestStorage = new AsyncLocalStorage<RequestContext>();
const operationStorage = new AsyncLocalStorage<OperationContext>();
const transportStorage = new AsyncLocalStorage<{ attempts: number }>();

function logOpenAiCost(scope: string, metadata: Record<string, unknown>) {
  // Cost metadata never contains prompts, request bodies, credentials, or response text.
  console.info(scope, metadata);
}

export async function instrumentOpenAiTransportFetch(
  input: string | URL | Request,
  init?: RequestInit
) {
  const transport = transportStorage.getStore();
  if (transport) transport.attempts += 1;
  return fetch(input, init);
}

export function createOpenAiRequestId(request: Request) {
  return (
    request.headers.get("x-zerinix-ai-request-id")?.trim().slice(0, 128) ||
    crypto.randomUUID()
  );
}

export function runWithOpenAiCostContext<T>(
  input: {
    requestId: string;
    parentRequestId?: string | null;
    userId?: string | null;
    route: string;
    reportType?: string;
  },
  callback: () => T
) {
  const existing = requestStorage.getStore();
  if (existing?.requestId === input.requestId) return callback();

  return requestStorage.run(
    {
      requestId: input.requestId,
      parentRequestId: input.parentRequestId ?? null,
      userId: input.userId ?? null,
      route: input.route,
      reportType: input.reportType || "",
      events: [],
      pendingWrites: [],
    },
    callback
  );
}

export function enterOpenAiCostContext(input: {
  requestId?: string;
  parentRequestId?: string | null;
  userId?: string | null;
  route: string;
  reportType?: string;
}) {
  const existing = requestStorage.getStore();
  if (existing) return existing;
  const context: RequestContext = {
    requestId: input.requestId || crypto.randomUUID(),
    parentRequestId: input.parentRequestId ?? null,
    userId: input.userId ?? null,
    route: input.route,
    reportType: input.reportType || "",
    events: [],
    pendingWrites: [],
  };
  requestStorage.enterWith(context);
  return context;
}

export function setOpenAiCostIdentity(input: {
  userId?: string | null;
  reportType?: string;
  parentRequestId?: string | null;
}) {
  const context = requestStorage.getStore();
  if (!context) return;
  if (input.userId !== undefined) context.userId = input.userId;
  if (input.reportType !== undefined) context.reportType = input.reportType;
  if (input.parentRequestId !== undefined) {
    context.parentRequestId = input.parentRequestId;
  }
}

export function withOpenAiCostOperation<T>(
  operation: OperationContext,
  callback: () => T
) {
  return operationStorage.run(operation, callback);
}

function stableRequestFingerprint(model: string, body: unknown) {
  let serialized = "";
  try {
    serialized = JSON.stringify(body);
  } catch {
    serialized = String(body);
  }
  return crypto
    .createHash("sha256")
    .update(`${model}\n${serialized}`)
    .digest("hex");
}

async function persistEvent(event: CostEvent) {
  try {
    const { error } = await insertOpenAiCostEvent({
      call_id: event.callId,
      request_id: event.requestId,
      parent_request_id: event.parentRequestId,
      user_id: event.userId,
      route: event.route,
      report_type: event.reportType,
      operation_name: event.operationName,
      model: event.model,
      response_id: event.responseId || null,
      input_tokens: event.inputTokens,
      cached_input_tokens: event.cachedInputTokens,
      output_tokens: event.outputTokens,
      reasoning_tokens: event.reasoningTokens,
      total_tokens: event.totalTokens,
      web_search_calls: event.webSearchCalls,
      estimated_input_cost_usd: event.inputCostUsd,
      estimated_output_cost_usd: event.outputCostUsd,
      estimated_tool_cost_usd: event.toolCostUsd,
      estimated_total_cost_usd: event.totalCostUsd,
      cache_savings_usd: event.cacheSavingsUsd || 0,
      duration_ms: event.durationMs,
      retry_count: event.retryCount,
      cache_status: event.cacheStatus,
      status: event.status,
      error_message: event.errorMessage || null,
      duplicate_fingerprint: event.duplicateFingerprint,
    });
    if (error && process.env.NODE_ENV === "development") {
      console.warn("[openai-cost] event persistence skipped", error.message);
    }
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[openai-cost] event persistence unavailable",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function recordEvent(event: CostEvent) {
  const context = requestStorage.getStore();
  context?.events.push(event);
  const write = persistEvent(event);
  if (context) context.pendingWrites.push(write);
  logOpenAiCost("[openai-cost] call", event);
  logOpenAiCost("[openai-input] actual", {
    requestId: event.requestId,
    route: event.route,
    operationName: event.operationName,
    model: event.model,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
  });
}

function createEvent(input: {
  model: string;
  body: unknown;
  startedAt: number;
  response?: unknown;
  status: CostEvent["status"];
  errorMessage?: string;
  requestContext?: RequestContext;
  operationContext?: OperationContext;
}): CostEvent {
  const request = input.requestContext || requestStorage.getStore();
  const operation = input.operationContext || operationStorage.getStore();
  const usage = extractOpenAiTokenUsageDetails(input.response);
  const cost = estimateOpenAiCostBreakdown(input.model, usage);
  const response = input.response as { id?: unknown; status?: unknown } | undefined;
  const cacheStatus: CacheStatus = usage.cachedInputTokens
    ? "provider_cached"
    : operation?.cacheStatus || "miss";

  return {
    callId: crypto.randomUUID(),
    requestId: request?.requestId || crypto.randomUUID(),
    parentRequestId: request?.parentRequestId || null,
    userId: request?.userId || null,
    route: request?.route || "unscoped",
    reportType: operation?.reportType || request?.reportType || "",
    operationName: operation?.operationName || "unscoped_openai_call",
    model: input.model,
    responseId: typeof response?.id === "string" ? response.id : "",
    ...usage,
    ...cost,
    durationMs: Date.now() - input.startedAt,
    retryCount: operation?.retryCount || 0,
    cacheStatus,
    duplicateFingerprint: stableRequestFingerprint(input.model, input.body),
    status:
      input.status === "completed" && response?.status === "incomplete"
        ? "incomplete"
        : input.status,
    errorMessage: input.errorMessage || "",
  };
}

function instrumentStream<T extends AsyncIterable<unknown>>(
  stream: T,
  input: {
    model: string;
    body: unknown;
    startedAt: number;
    requestContext?: RequestContext;
    operationContext?: OperationContext;
  }
): T {
  const originalIterator = stream[Symbol.asyncIterator].bind(stream);
  let recorded = false;
  return new Proxy(stream, {
    get(target, property, receiver) {
      if (property !== Symbol.asyncIterator) {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }

      return async function* () {
        let finalResponse: unknown = null;
        try {
          for await (const event of { [Symbol.asyncIterator]: originalIterator }) {
            if (
              event &&
              typeof event === "object" &&
              "response" in event
            ) {
              finalResponse = (event as { response?: unknown }).response || finalResponse;
            }
            yield event;
          }
          if (!recorded) {
            recorded = true;
            recordEvent(
              createEvent({ ...input, response: finalResponse, status: "completed" })
            );
          }
        } catch (error) {
          if (!recorded) {
            recorded = true;
            recordEvent(
              createEvent({
                ...input,
                response: finalResponse,
                status: "failed",
                errorMessage: error instanceof Error ? error.message : String(error),
              })
            );
          }
          throw error;
        }
      };
    },
  });
}

export function instrumentOpenAiClient(client: OpenAI): OpenAI {
  const originalCreate = client.responses.create.bind(client.responses);
  client.responses.create = (async (...args: Parameters<typeof originalCreate>) => {
    const body = args[0] as { model?: unknown; stream?: unknown };
    const model = typeof body.model === "string" ? body.model : "unknown";
    const startedAt = Date.now();
    const requestContext = requestStorage.getStore();
    const operationContext = operationStorage.getStore();
    const inputAudit = analyzeOpenAiRequestInput(body);
    logOpenAiCost("[openai-input] preflight", {
      requestId: requestContext?.requestId || "unscoped",
      route: requestContext?.route || "unscoped",
      operationName:
        operationContext?.operationName || "unscoped_openai_call",
      model,
      ...inputAudit,
    });
    const transportContext = { attempts: 0 };
    try {
      const result = await transportStorage.run(transportContext, () =>
        originalCreate(...args)
      );
      const measuredOperationContext = {
        ...operationContext,
        retryCount:
          operationContext?.retryCount ?? Math.max(0, transportContext.attempts - 1),
        operationName:
          operationContext?.operationName || "unscoped_openai_call",
      };
      if (
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      ) {
        return instrumentStream(result as AsyncIterable<unknown>, {
          model,
          body,
          startedAt,
          requestContext,
          operationContext: measuredOperationContext,
        }) as typeof result;
      }
      recordEvent(createEvent({
        model,
        body,
        startedAt,
        response: result,
        status: "completed",
        requestContext,
        operationContext: measuredOperationContext,
      }));
      return result;
    } catch (error) {
      recordEvent(
        createEvent({
          model,
          body,
          startedAt,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          requestContext,
          operationContext: {
            ...operationContext,
            retryCount:
              operationContext?.retryCount ??
              Math.max(0, transportContext.attempts - 1),
            operationName:
              operationContext?.operationName || "unscoped_openai_call",
          },
        })
      );
      throw error;
    }
  }) as typeof client.responses.create;
  return client;
}

export function recordOpenAiApplicationCache(input: {
  operationName: string;
  model: string;
  reportType?: string;
  hit: boolean;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}) {
  const request = requestStorage.getStore();
  if (!request) return;
  const usage = {
    inputTokens: input.inputTokens || 0,
    cachedInputTokens: 0,
    outputTokens: input.outputTokens || 0,
    reasoningTokens: 0,
    totalTokens: (input.inputTokens || 0) + (input.outputTokens || 0),
    webSearchCalls: 0,
  };
  const event: CostEvent = {
    callId: crypto.randomUUID(),
    requestId: request.requestId,
    parentRequestId: request.parentRequestId,
    userId: request.userId,
    route: request.route,
    reportType: input.reportType || request.reportType,
    operationName: input.operationName,
    model: input.model,
    responseId: "",
    ...usage,
    inputCostUsd: 0,
    outputCostUsd: 0,
    toolCostUsd: 0,
    totalCostUsd: 0,
    cacheSavingsUsd: input.hit ? input.estimatedCostUsd || 0 : 0,
    durationMs: 0,
    retryCount: 0,
    cacheStatus: input.hit ? "hit" : "miss",
    duplicateFingerprint: "",
    status: input.hit ? "cache_hit" : "completed",
    errorMessage: "",
  };
  recordEvent(event);
  logOpenAiCost("[openai-cost] application-cache", {
    ...event,
    cacheSavingsUsd: input.hit ? input.estimatedCostUsd || 0 : 0,
  });
}

function mapPersistedEvent(row: PersistedCostEvent): OpenAiCostEventLike {
  return {
    operationName: row.operation_name,
    model: row.model,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    webSearchCalls: row.web_search_calls,
    inputCostUsd: Number(row.estimated_input_cost_usd) || 0,
    outputCostUsd: Number(row.estimated_output_cost_usd) || 0,
    toolCostUsd: Number(row.estimated_tool_cost_usd) || 0,
    totalCostUsd: Number(row.estimated_total_cost_usd) || 0,
    durationMs: row.duration_ms,
    retryCount: row.retry_count,
    cacheStatus: row.cache_status,
    cacheSavingsUsd: Number(row.cache_savings_usd) || 0,
    duplicateFingerprint: row.duplicate_fingerprint,
  };
}

async function loadRequestEvents(context: RequestContext) {
  try {
    const { data, error } = await selectOpenAiCostEvents(context.requestId);
    if (error || !data) return context.events;

    const persisted = new Map(
      (data as PersistedCostEvent[]).map((row) => [
        row.call_id,
        mapPersistedEvent(row),
      ])
    );
    for (const event of context.events) {
      if (!persisted.has(event.callId)) persisted.set(event.callId, event);
    }
    return [...persisted.values()];
  } catch {
    return context.events;
  }
}

export async function finalizeOpenAiCostRequest(
  explicitContext?: RequestContext
) {
  const context = explicitContext || requestStorage.getStore();
  if (!context) return null;
  await Promise.allSettled(context.pendingWrites);
  const events = await loadRequestEvents(context);
  const summary = summarizeOpenAiCostEvents(events);
  logOpenAiCost("[openai-cost] request-summary", {
    requestId: context.requestId,
    parentRequestId: context.parentRequestId,
    userId: context.userId,
    route: context.route,
    reportType: context.reportType,
    ...summary,
  });
  try {
    await upsertOpenAiCostSummary({
        request_id: context.requestId,
        parent_request_id: context.parentRequestId,
        user_id: context.userId,
        route: context.route,
        report_type: context.reportType,
        total_openai_calls: summary.totalOpenAiCalls,
        total_tokens: summary.totalTokens,
        total_estimated_cost_usd: summary.totalEstimatedUsdCost,
        cost_by_model: summary.costByModel,
        cost_by_pipeline_stage: summary.costByPipelineStage,
        cost_by_operation: summary.costByOperation,
        most_expensive_step: summary.mostExpensiveStep,
        duplicated_calls: summary.duplicatedCalls,
        retry_cost_usd: summary.retryCostUsd,
        cache_savings_usd: summary.cacheSavingsUsd,
        completed_at: new Date().toISOString(),
      });
  } catch {
    // Structured console logs remain the fallback when persistence is unavailable.
  }
  return summary;
}

export async function finalizeOpenAiCostResponse(response: Response) {
  const context = requestStorage.getStore();
  if (!context) return response;
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("X-Zerinix-AI-Request-Id", context.requestId);
  if (!response.body) {
    await finalizeOpenAiCostRequest(context);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await finalizeOpenAiCostRequest(context);
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
        await finalizeOpenAiCostRequest(context);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await finalizeOpenAiCostRequest(context);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
