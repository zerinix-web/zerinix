import { resolveOpenAiPricing } from "@/app/lib/ai/cost-metrics";
export {
  compactConversationHistory,
  compactReportFieldPrompt,
  dedupeExactPromptBlocks,
  omitTrailingDuplicateUserPrompt,
} from "@/app/lib/ai/token-optimization-core";
import { compactConversationHistory } from "@/app/lib/ai/token-optimization-core";

type AiMessageLike = {
  role: string;
  content: string;
};

export type AiCostOptimizationMetrics = {
  cost_optimization_version: "v2";
  input_reduction_target_pct: 40;
  input_reduction_target_met: boolean;
  estimated_input_tokens_before: number;
  estimated_input_tokens_after: number;
  estimated_input_token_savings: number;
  estimated_input_token_savings_pct: number;
  input_chars_before: number;
  input_chars_after: number;
  trimmed_message_count: number;
  summarized_message_count: number;
  history_summary_chars: number;
  recent_message_count: number;
  estimated_input_cost_savings_usd: number;
};

const tokenChars = 4;
export function estimateAiInputTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / tokenChars));
}

function trimTextMiddle(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const headLength = Math.max(160, Math.floor(maxChars * 0.65));
  const tailLength = Math.max(80, maxChars - headLength - 32);

  return `${normalized.slice(0, headLength).trim()} … ${normalized
    .slice(-tailLength)
    .trim()}`;
}

export function createAiCostOptimizationMetrics(input: {
  beforeText: string;
  afterText?: string;
  trimmedMessageCount?: number;
  summarizedMessageCount?: number;
  historySummaryChars?: number;
  recentMessageCount?: number;
  model?: string;
}): AiCostOptimizationMetrics {
  const beforeChars = input.beforeText.length;
  const afterChars = (input.afterText ?? input.beforeText).length;
  const beforeTokens = estimateAiInputTokens(input.beforeText);
  const afterTokens = estimateAiInputTokens(input.afterText ?? input.beforeText);
  const savings = Math.max(0, beforeTokens - afterTokens);
  const inputPrice = input.model
    ? resolveOpenAiPricing(input.model)?.input ?? 0
    : 0;

  return {
    cost_optimization_version: "v2",
    input_reduction_target_pct: 40,
    input_reduction_target_met: beforeTokens > 0 && savings / beforeTokens >= 0.4,
    estimated_input_tokens_before: beforeTokens,
    estimated_input_tokens_after: afterTokens,
    estimated_input_token_savings: savings,
    estimated_input_token_savings_pct: beforeTokens
      ? Math.round((savings / beforeTokens) * 100)
      : 0,
    input_chars_before: beforeChars,
    input_chars_after: afterChars,
    trimmed_message_count: input.trimmedMessageCount ?? 0,
    summarized_message_count: input.summarizedMessageCount ?? 0,
    history_summary_chars: input.historySummaryChars ?? 0,
    recent_message_count: input.recentMessageCount ?? 0,
    estimated_input_cost_savings_usd: Number(
      ((savings * inputPrice) / 1_000_000).toFixed(8)
    ),
  };
}

export function optimizeChatHistoryForCost<TMessage extends AiMessageLike>(
  messages: TMessage[],
  options: {
    maxRecentMessages?: number;
    maxImportantOlderMessages?: number;
    maxMessageChars?: number;
    maxTotalChars?: number;
  } = {}
) {
  const maxRecentMessages = options.maxRecentMessages ?? 10;
  const maxMessageChars = options.maxMessageChars ?? 2_400;
  const maxTotalChars = options.maxTotalChars ?? 18_000;
  const beforeText = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
  const compacted = compactConversationHistory(messages, {
    recentMessageCount: maxRecentMessages,
    maxItemsPerCategory: options.maxImportantOlderMessages ?? 4,
    maxSummaryChars: Math.min(2_400, Math.max(600, Math.floor(maxTotalChars * 0.2))),
  });
  const summaryMessageCount = compacted.summary ? 1 : 0;
  const recentCharacterBudget = Math.max(
    600 * Math.max(1, compacted.recentMessageCount),
    maxTotalChars - compacted.summary.length
  );
  const recentMessageCharLimit = Math.min(
    maxMessageChars,
    Math.max(600, Math.floor(recentCharacterBudget / Math.max(1, compacted.recentMessageCount)))
  );
  const optimizedMessages = compacted.messages.map((message, index) => ({
    ...message,
    content:
      index < summaryMessageCount
        ? message.content
        : trimTextMiddle(message.content, recentMessageCharLimit),
  })) as TMessage[];
  const afterText = optimizedMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return {
    messages: optimizedMessages,
    metrics: createAiCostOptimizationMetrics({
      beforeText,
      afterText,
      trimmedMessageCount: compacted.summarizedMessageCount,
      summarizedMessageCount: compacted.summarizedMessageCount,
      historySummaryChars: compacted.summary.length,
      recentMessageCount: compacted.recentMessageCount,
    }),
  };
}
