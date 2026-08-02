import { resolveOpenAiPricing } from "@/app/lib/ai/cost-metrics";
export {
  compactReportFieldPrompt,
  dedupeExactPromptBlocks,
  omitTrailingDuplicateUserPrompt,
} from "@/app/lib/ai/token-optimization-core";

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
  estimated_input_cost_savings_usd: number;
};

const tokenChars = 4;
const chatContextImportancePattern =
  /\b(business|startup|company|market|customer|pricing|revenue|model|competitor|risk|strategy|plan|report|analysis|investment|validation|mvp|idea|iş|girişim|şirket|pazar|müşteri|fiyat|gelir|rakip|risk|strateji|rapor|analiz|yatırım|doğrulama)\b/i;

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

function getMessageChars(messages: AiMessageLike[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export function createAiCostOptimizationMetrics(input: {
  beforeText: string;
  afterText?: string;
  trimmedMessageCount?: number;
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
  const maxImportantOlderMessages = options.maxImportantOlderMessages ?? 4;
  const maxMessageChars = options.maxMessageChars ?? 2_400;
  const maxTotalChars = options.maxTotalChars ?? 18_000;
  const beforeText = messages.map((message) => `${message.role}: ${message.content}`).join("\n");

  if (messages.length <= maxRecentMessages && getMessageChars(messages) <= maxTotalChars) {
    return {
      messages,
      metrics: createAiCostOptimizationMetrics({ beforeText }),
    };
  }

  const indexed = messages.map((message, index) => ({ message, index }));
  const recent = indexed.slice(-maxRecentMessages);
  const older = indexed.slice(0, -maxRecentMessages);
  const firstUserContext = older.find(({ message }) => message.role === "user");
  const importantOlder = older
    .filter(
      (item) =>
        item !== firstUserContext && chatContextImportancePattern.test(item.message.content)
    )
    .slice(-maxImportantOlderMessages);
  const selected = [...(firstUserContext ? [firstUserContext] : []), ...importantOlder, ...recent]
    .filter((item, index, array) => array.findIndex((candidate) => candidate.index === item.index) === index)
    .sort((a, b) => a.index - b.index);
  const optimizedMessages = selected.map(({ message }) => ({
    ...message,
    content: trimTextMiddle(message.content, maxMessageChars),
  })) as TMessage[];
  const afterText = optimizedMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return {
    messages: optimizedMessages,
    metrics: createAiCostOptimizationMetrics({
      beforeText,
      afterText,
      trimmedMessageCount: Math.max(0, messages.length - optimizedMessages.length),
    }),
  };
}
