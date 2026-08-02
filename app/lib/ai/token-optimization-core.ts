export type PromptMessage = {
  role: string;
  content: string;
};

export type CompactedConversationHistory<TMessage extends PromptMessage> = {
  messages: TMessage[];
  summary: string;
  summarizedMessageCount: number;
  recentMessageCount: number;
};

const conversationMemoryCategories = [
  {
    label: "Uploaded files and evidence",
    preferRecent: true,
    pattern:
      /\b(attached|attachment|uploaded|file|document|pdf|csv|xlsx?|docx?|image|screenshot|dataset|dosya|belge|yükle(?:dim|ndi)?|ekli)\b|\b[^\s]+\.(?:pdf|csv|xlsx?|docx?|txt|md|json|png|jpe?g|webp)\b/i,
  },
  {
    label: "User goals",
    preferRecent: false,
    pattern:
      /\b(goal|objective|aim|want|need|trying|build|launch|validate|accomplish|hedef|amaç|istiyorum|ihtiyacım|kurmak|oluşturmak|başlatmak|doğrulamak)\b/i,
  },
  {
    label: "Report mode and analysis type",
    preferRecent: true,
    pattern:
      /\b(report mode|report|business plan|market analysis|market intelligence|strategic report|analysis type|decision intelligence|plan mode|rapor|iş planı|pazar analizi|pazar araştırması|stratejik rapor|analiz türü|karar zekâsı)\b/i,
  },
  {
    label: "Important decisions and constraints",
    preferRecent: true,
    pattern:
      /\b(decided|decision|selected|choose|chosen|agreed|must|must not|do not|constraint|budget|deadline|priority|karar|kararlaştır|seç|seçildi|anlaştık|zorunlu|yapma|bütçe|son tarih|öncelik)\b/i,
  },
] as const;

const generalConversationFactPattern =
  /\b(business|startup|company|product|service|market|customer|competitor|pricing|revenue|industry|risk|strategy|investment|validation|mvp|iş|girişim|şirket|ürün|hizmet|pazar|müşteri|rakip|fiyat|gelir|sektör|risk|strateji|yatırım|doğrulama)\b/i;

function normalizeMemoryExcerpt(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 2).trim()} …`;
}

function conversationMemoryExcerpts(message: PromptMessage) {
  return message.content
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => normalizeMemoryExcerpt(part))
    .filter((part) => part.length >= 4)
    .map((part) => `${message.role === "assistant" ? "Assistant" : "User"}: ${part}`);
}

/**
 * Converts older chat turns into a deterministic, extractive memory. It never
 * asks a model to summarize, so compaction cannot add latency, cost, invented
 * facts, or a second AI request.
 */
export function compactConversationHistory<TMessage extends PromptMessage>(
  messages: TMessage[],
  options: {
    recentMessageCount?: number;
    maxSummaryChars?: number;
    maxItemsPerCategory?: number;
  } = {}
): CompactedConversationHistory<TMessage> {
  const recentMessageCount = Math.min(
    12,
    Math.max(8, options.recentMessageCount ?? 10)
  );
  const maxSummaryChars = Math.max(600, options.maxSummaryChars ?? 2_400);
  const maxItemsPerCategory = Math.min(
    2,
    Math.max(1, options.maxItemsPerCategory ?? 2)
  );
  const recent = messages.slice(-recentMessageCount);
  const older = messages.slice(0, -recentMessageCount);

  if (older.length === 0) {
    return {
      messages: recent,
      summary: "",
      summarizedMessageCount: 0,
      recentMessageCount: recent.length,
    };
  }

  const categorized = conversationMemoryCategories.map((category) => ({
    ...category,
    items: [] as string[],
  }));
  const generalItems: string[] = [];
  const seen = new Set<string>();

  for (const message of older) {
    for (const excerpt of conversationMemoryExcerpts(message)) {
      const identity = excerpt.toLocaleLowerCase();
      if (seen.has(identity)) continue;

      const category = categorized.find((item) => item.pattern.test(excerpt));
      if (category) {
        if (category.items.length < maxItemsPerCategory) {
          category.items.push(excerpt);
          seen.add(identity);
          continue;
        }
        if (category.preferRecent) {
          category.items.shift();
          category.items.push(excerpt);
          seen.add(identity);
          continue;
        }
      }

      if (
        generalItems.length < maxItemsPerCategory &&
        generalConversationFactPattern.test(excerpt)
      ) {
        generalItems.push(excerpt);
        seen.add(identity);
      }
    }
  }

  if (categorized.every((category) => category.items.length === 0) && generalItems.length === 0) {
    const fallbackMessages = [
      older.find((message) => message.role === "user"),
      [...older].reverse().find((message) => message.role === "user"),
      [...older].reverse().find((message) => message.role === "assistant"),
    ].filter((message): message is TMessage => Boolean(message));

    for (const fallbackMessage of fallbackMessages) {
      const item = `${fallbackMessage.role === "assistant" ? "Assistant" : "User"}: ${normalizeMemoryExcerpt(fallbackMessage.content, 320)}`;
      if (!generalItems.includes(item)) generalItems.push(item);
    }
  }

  const sections = [
    ...categorized
      .filter((category) => category.items.length > 0)
      .map(
        (category) =>
          `${category.label}:\n${category.items.map((item) => `- ${item}`).join("\n")}`
      ),
    ...(generalItems.length > 0
      ? [`Other durable business context:\n${generalItems.map((item) => `- ${item}`).join("\n")}`]
      : []),
  ];
  const summaryBody = sections.join("\n\n");
  const summary = normalizeMemoryExcerpt(
    `Conversation memory from earlier messages (context only; the latest user message remains the active request):\n${summaryBody}`,
    maxSummaryChars
  );
  const summaryMessage = {
    role: "user",
    content: summary,
  } as TMessage;

  return {
    messages: [summaryMessage, ...recent],
    summary,
    summarizedMessageCount: older.length,
    recentMessageCount: recent.length,
  };
}

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
