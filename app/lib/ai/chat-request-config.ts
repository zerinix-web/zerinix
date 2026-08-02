export type ChatResponseCapabilities =
  | {
      reasoning: { effort: "minimal" };
    }
  | {
      reasoning: { effort: "low" };
      tools: [
        {
          type: "web_search_preview";
          search_context_size: "low";
        },
      ];
      include: ["web_search_call.action.sources"];
    };

/**
 * Keeps inexpensive no-search chat requests on minimal reasoning while making
 * the Responses API web-search combination valid for the already-routed model.
 */
export function createChatResponseCapabilities(
  webSearch: boolean
): ChatResponseCapabilities {
  if (!webSearch) {
    return {
      reasoning: { effort: "minimal" },
    };
  }

  return {
    reasoning: { effort: "low" },
    tools: [
      {
        type: "web_search_preview",
        search_context_size: "low",
      },
    ],
    include: ["web_search_call.action.sources"],
  };
}
