export type PromptMessage = {
  role: string;
  content: string;
};

/** Removes only byte-for-byte equivalent blocks while retaining first-use order. */
export function dedupeExactPromptBlocks(value: string) {
  const seen = new Set<string>();

  return value
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => {
      if (!block || seen.has(block)) return false;
      seen.add(block);
      return true;
    })
    .join("\n\n");
}

/** Avoids sending the composer value twice when it is also the last history item. */
export function omitTrailingDuplicateUserPrompt<TMessage extends PromptMessage>(
  messages: TMessage[],
  prompt: string
) {
  const last = messages.at(-1);
  return last?.role === "user" && last.content.trim() === prompt.trim()
    ? messages.slice(0, -1)
    : messages;
}
