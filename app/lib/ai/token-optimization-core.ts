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

/**
 * Full-report prompts already have a centralized section-ownership rule. Remove
 * only repeated cross-section prohibition sentences from each field contract;
 * all positive requirements, limits, evidence rules, and output semantics stay.
 */
export function compactReportFieldPrompt(value: string) {
  return value
    .replace(
      /\bDo not (?:repeat|describe|include|add|reuse|substitute|introduce|create|turn)[^.]*\.\s*/gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
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

type OpenAiInputAudit = {
  estimatedInputTokens: number;
  estimatedInstructionTokens: number;
  estimatedContextTokens: number;
  estimatedSchemaTokens: number;
  duplicateBlockCount: number;
  estimatedDuplicateTokens: number;
};

const estimatedCharsPerToken = 4;

function estimatedTokens(value: string) {
  return value ? Math.ceil(value.length / estimatedCharsPerToken) : 0;
}

function isBinaryPayload(value: string) {
  return /^data:[^;,]+;base64,/i.test(value) || value.length > 256_000;
}

function collectText(value: unknown, output: string[]) {
  if (typeof value === "string") {
    if (!isBinaryPayload(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "image_url" || key === "file_data") continue;
    collectText(item, output);
  }
}

function duplicatePromptBlocks(values: string[]) {
  const seen = new Set<string>();
  let duplicateBlockCount = 0;
  let duplicateChars = 0;

  for (const value of values) {
    for (const rawBlock of value.split(/\n{2,}/)) {
      const block = rawBlock.replace(/\s+/g, " ").trim();
      if (block.length < 40) continue;
      if (seen.has(block)) {
        duplicateBlockCount += 1;
        duplicateChars += block.length;
      } else {
        seen.add(block);
      }
    }
  }

  return {
    duplicateBlockCount,
    estimatedDuplicateTokens: estimatedTokens("x".repeat(duplicateChars)),
  };
}

/** Produces metadata-only token estimates; prompt text and binary assets are never returned. */
export function analyzeOpenAiRequestInput(body: unknown): OpenAiInputAudit {
  if (!body || typeof body !== "object") {
    return {
      estimatedInputTokens: 0,
      estimatedInstructionTokens: 0,
      estimatedContextTokens: 0,
      estimatedSchemaTokens: 0,
      duplicateBlockCount: 0,
      estimatedDuplicateTokens: 0,
    };
  }

  const request = body as {
    instructions?: unknown;
    input?: unknown;
    text?: { format?: unknown };
    tools?: unknown;
  };
  const instructionText: string[] = [];
  const contextText: string[] = [];
  const schemaText: string[] = [];
  collectText(request.instructions, instructionText);
  collectText(request.input, contextText);
  collectText(request.tools, contextText);
  if (request.text?.format !== undefined) {
    try {
      schemaText.push(JSON.stringify(request.text.format));
    } catch {
      collectText(request.text.format, schemaText);
    }
  }
  const allText = [...instructionText, ...contextText, ...schemaText];
  const duplicateAudit = duplicatePromptBlocks(allText);

  return {
    estimatedInputTokens: estimatedTokens(allText.join("\n")),
    estimatedInstructionTokens: estimatedTokens(instructionText.join("\n")),
    estimatedContextTokens: estimatedTokens(contextText.join("\n")),
    estimatedSchemaTokens: estimatedTokens(schemaText.join("\n")),
    ...duplicateAudit,
  };
}
