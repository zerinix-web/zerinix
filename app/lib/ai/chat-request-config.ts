// Fast and Balanced differ ONLY in per-request runtime knobs. The model is not
// one of them: model selection stays with the router in
// app/lib/ai/model-router.ts, which encodes quality protection and cost
// ranking. Letting a client-supplied preference pick the model would hand
// model choice -- and spend -- to the client.
//
// Every value below is verified against the installed openai SDK (6.45.0):
//   ReasoningEffort        'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
//   text.verbosity         'low' | 'medium' | 'high'
//   search_context_size    'low' | 'medium' | 'high'
//
// Effort stops at "medium" deliberately. Reasoning tokens bill as output, and
// "high"/"xhigh" multiply them for diminishing returns in advisory chat while
// pushing latency towards the client's own 75s request timeout.
export type ChatModelPreference = "fast" | "balanced";

type ChatReasoningEffort = "low" | "medium";
type ChatSearchContextSize = "low" | "medium";

export type ChatResponseCapabilities =
  | {
      reasoning: { effort: ChatReasoningEffort };
    }
  | {
      reasoning: { effort: ChatReasoningEffort };
      tools: [
        {
          type: "web_search_preview";
          search_context_size: ChatSearchContextSize;
        },
      ];
      include: ["web_search_call.action.sources"];
    };

// Whether web search runs at all is decided upstream by
// shouldUseAnalysisWebResearch(prompt, attachments) and is NOT affected by the
// preference: both modes ground an answer whenever grounding is needed. The
// preference only changes how deeply that search reads.
export function createChatResponseCapabilities(
  webSearch: boolean,
  preference: ChatModelPreference = "fast"
): ChatResponseCapabilities {
  const balanced = preference === "balanced";
  const reasoning = { effort: (balanced ? "medium" : "low") as ChatReasoningEffort };

  if (!webSearch) {
    return { reasoning };
  }

  return {
    reasoning,
    tools: [
      {
        type: "web_search_preview",
        search_context_size: (balanced ? "medium" : "low") as ChatSearchContextSize,
      },
    ],
    include: ["web_search_call.action.sources"],
  };
}

// Concise by default; Balanced is allowed somewhat more detail. Raised
// together with the output budget below -- more verbosity on the same budget
// would truncate, and truncation starts the continuation loop, which is both
// slower and more expensive than simply allowing the tokens up front.
export function createChatResponseVerbosity(
  preference: ChatModelPreference = "fast"
): "low" | "medium" {
  return preference === "balanced" ? "medium" : "low";
}

// Balanced gets roughly 1.5x Fast's budget. Fast's own budget is untouched, so
// the default path keeps exactly the limits it has today.
export function applyChatOutputBudgetPreference(
  baseMaxOutputTokens: number,
  preference: ChatModelPreference = "fast"
): number {
  if (preference !== "balanced") {
    return baseMaxOutputTokens;
  }

  return Math.round(baseMaxOutputTokens * 1.5);
}
