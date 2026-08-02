import type { TokenUsage } from "@/app/lib/ai/governance";

export const MAX_CHAT_RESPONSE_CONTINUATIONS = 4;

export const CHAT_RESPONSE_CONTINUATION_INPUT =
  "Continue the immediately preceding answer exactly where it stopped. Do not repeat any text already produced. Preserve the same language, tone, structure, formatting, citations, and level of quality. Finish the answer completely.";

export function isOutputTokenLimitReason(reason: string) {
  return reason === "max_output_tokens" || reason === "max_tokens";
}

export function shouldContinueResponse(input: {
  incompleteReason: string;
  responseId: string;
  continuationCount: number;
}) {
  return (
    Boolean(input.responseId) &&
    isOutputTokenLimitReason(input.incompleteReason) &&
    input.continuationCount < MAX_CHAT_RESPONSE_CONTINUATIONS
  );
}

export function getContinuationMaxOutputTokens(
  initialMaxOutputTokens: number,
  continuationCount: number
) {
  const multiplier = 2 ** Math.max(1, continuationCount);
  return Math.min(8_000, initialMaxOutputTokens * multiplier);
}

export function addTokenUsage(
  total: TokenUsage,
  addition: TokenUsage
): TokenUsage {
  return {
    promptTokens: total.promptTokens + addition.promptTokens,
    completionTokens: total.completionTokens + addition.completionTokens,
    totalTokens: total.totalTokens + addition.totalTokens,
  };
}
