import type { SupabaseClient, User } from "@supabase/supabase-js";

export type UserMemoryType =
  | "name"
  | "company"
  | "preference"
  | "writing_style"
  | "language"
  | "long_term_goal"
  | "general";

export type UserMemory = {
  id: string;
  type: UserMemoryType;
  content: string;
  updatedAt: string;
};

export type UserMemoryOperation =
  | {
      action: "remember";
      type: UserMemoryType;
      content: string;
    }
  | {
      action: "forget";
      type?: UserMemoryType;
      content: string;
    };

export type UserMemoryApplyResult = {
  remembered: number;
  forgotten: number;
  failed: number;
  storage: "table" | "metadata" | "none";
  error?: string;
  fallbackMemories?: UserMemory[];
};

type UserMemoryRow = {
  id: string;
  memory_type: UserMemoryType;
  content: string;
  updated_at: string;
};

type UserMemoryError = {
  code?: string;
  message?: string;
  status?: number | string;
};

const MAX_MEMORY_CONTENT_LENGTH = 240;
const MAX_LOADED_MEMORIES = 30;
const USER_METADATA_MEMORY_KEY = "zerinix_memories";
const singletonMemoryTypes = new Set<UserMemoryType>([
  "name",
  "company",
  "preference",
  "language",
  "writing_style",
  "long_term_goal",
  "general",
]);

const memoryTypeLabels: Record<UserMemoryType, string> = {
  name: "Name",
  company: "Company",
  preference: "Preference",
  writing_style: "Writing style",
  language: "Language",
  long_term_goal: "Long-term goal",
  general: "General",
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanMemoryContent(value: string) {
  return normalizeWhitespace(value)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.;,\s]+$/g, "")
    .slice(0, MAX_MEMORY_CONTENT_LENGTH)
    .trim();
}

function createMemoryId(type: UserMemoryType, content: string) {
  return `${type}:${content.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`;
}

function isMissingUserMemoriesTableError(error: { code?: string; message?: string }) {
  const message = error.message || "";

  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /user_memories/i.test(message) && /schema cache|relation|table|does not exist/i.test(message)
  );
}

function formatMemoryError(error: UserMemoryError, phase: string) {
  const code = error.code ? ` code=${error.code}` : "";
  const status = error.status ? ` status=${error.status}` : "";
  const message = error.message || "Unknown Supabase memory error";

  return `${phase} failed:${code}${status} message=${message}`;
}

function inferMemoryType(content: string): UserMemoryType {
  const normalized = content.toLowerCase();

  if (/\b(name|call me|my name is|i am|i'm)\b/.test(normalized)) {
    return "name";
  }

  if (/\b(company|startup|business|organization|organisation)\b/.test(normalized)) {
    return "company";
  }

  if (/\b(language|reply in|respond in|write in|english|turkish|türkçe)\b/.test(normalized)) {
    return "language";
  }

  if (/\b(tone|style|writing style|concise|detailed|formal|casual)\b/.test(normalized)) {
    return "writing_style";
  }

  if (/\b(goal|long-term|long term|objective|mission|vision)\b/.test(normalized)) {
    return "long_term_goal";
  }

  if (/\b(prefer|preference|always|never|like|dislike)\b/.test(normalized)) {
    return "preference";
  }

  return "general";
}

function stripMemoryInstruction(value: string) {
  return cleanMemoryContent(
    value.replace(/\bremember (?:this|that|it)\b/gi, "").replace(/\bplease remember\b/gi, "")
  );
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match?.[1]) {
      return stripMemoryInstruction(match[1]);
    }
  }

  return "";
}

function isLikelyLanguage(value: string) {
  return /^(english|turkish|türkçe|spanish|french|german|italian|arabic|portuguese|russian|chinese|japanese|korean)$/i.test(
    value.trim()
  );
}

function createRememberOperation(type: UserMemoryType, content: string): UserMemoryOperation | null {
  const cleanedContent = cleanMemoryContent(content);

  if (!cleanedContent || cleanedContent.length < 2) {
    return null;
  }

  return {
    action: "remember",
    type,
    content: cleanedContent,
  };
}

function createForgetOperation(content: string): UserMemoryOperation | null {
  const cleanedContent = cleanMemoryContent(content);

  if (!cleanedContent || cleanedContent.length < 2) {
    return null;
  }

  const type =
    /\bname\b/i.test(cleanedContent)
      ? "name"
      : /\bcompany|startup|business\b/i.test(cleanedContent)
        ? "company"
        : /\blanguage\b/i.test(cleanedContent)
          ? "language"
          : undefined;

  return {
    action: "forget",
    type,
    content: cleanedContent,
  };
}

export function extractExplicitMemoryOperations(prompt: string): UserMemoryOperation[] {
  const text = normalizeWhitespace(prompt);
  const operations: UserMemoryOperation[] = [];
  const addRemember = (type: UserMemoryType, content: string) => {
    const operation = createRememberOperation(type, content);

    if (
      operation &&
      !operations.some(
        (existing) =>
          existing.action === "remember" &&
          existing.type === operation.type &&
          existing.content.toLowerCase() === operation.content.toLowerCase()
      )
    ) {
      operations.push(operation);
    }
  };

  if (!text) {
    return operations;
  }

  const name = firstMatch(text, [
    /\bmy name is\s+([^.!?\n]{2,80})/i,
    /\bcall me\s+([^.!?\n]{2,80})/i,
    /\bbenim ad[ıi]m\s+([^.!?\n]{2,80})/i,
    /\bad[ıi]m\s+([^.!?\n]{2,80})/i,
    /\b[İIıi]smim\s+([^.!?\n]{2,80})/i,
    /\b[İIıi]smin\s+([^.!?\n]{2,80})/i,
  ]);

  if (name) {
    addRemember("name", name);
  }

  const company = firstMatch(text, [
    /\bmy company is\s+([^.!?\n]{2,120})/i,
    /\bmy business is\s+([^.!?\n]{2,120})/i,
    /\bi work (?:at|for)\s+([^.!?\n]{2,120})/i,
  ]);

  if (company) {
    addRemember("company", company);
  }

  const language = firstMatch(text, [
    /\bmy preferred language is\s+([^.!?\n]{2,80})/i,
    /\bi prefer\s+([a-zçğıöşüİıĞÖŞÜ]{2,40})(?:\s|$|[.!?])/i,
    /\bplease answer in\s+([^.!?\n]{2,80})/i,
    /\brespond in\s+([^.!?\n]{2,80})/i,
    /\breply in\s+([^.!?\n]{2,80})/i,
  ]);

  if (language && (isLikelyLanguage(language) || /\b(language|answer in|respond in|reply in)\b/i.test(text))) {
    addRemember("language", language);
  }

  const writingStyle = firstMatch(text, [
    /\bi (?:like|prefer)\s+((?:concise|short|brief|detailed|formal|casual|direct|structured)[^.!?\n]{0,120}(?:answers|responses|writing|style)?)\b/i,
    /\bmy writing style preference is\s+([^.!?\n]{3,160})/i,
    /\banswer me with\s+([^.!?\n]{3,160})/i,
  ]);

  if (writingStyle && !operations.some((operation) => operation.action === "remember" && operation.type === "language")) {
    addRemember("writing_style", writingStyle);
  }

  const longTermGoal = firstMatch(text, [
    /\bmy long[-\s]?term goal is\s+([^.!?\n]{3,180})/i,
    /\bmy goal is\s+([^.!?\n]{3,180})/i,
  ]);

  if (longTermGoal) {
    addRemember("long_term_goal", longTermGoal);
  }

  for (const match of text.matchAll(/\bremember (?:this|that|it)[:\s]+([^]+?)(?=$|\bforget (?:this|that|it)\b|\bmy name is\b|\bmy company is\b)/gi)) {
    const content = cleanMemoryContent(match[1]);
    addRemember(inferMemoryType(content), content);
  }

  for (const match of text.matchAll(/\balways\s+([^.!?\n]{3,180})/gi)) {
    addRemember("preference", `Always ${match[1]}`);
  }

  for (const match of text.matchAll(/\bforget (?:this|that|it)[:\s]+([^.!?\n]{2,160})/gi)) {
    const operation = createForgetOperation(match[1]);

    if (operation) {
      operations.push(operation);
    }
  }

  return operations;
}

export async function loadUserMemories(
  supabase: SupabaseClient,
  userId: string
): Promise<UserMemory[]> {
  const { data, error } = await supabase
    .from("user_memories")
    .select("id,memory_type,content,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_LOADED_MEMORIES);

  if (error) {
    console.error("[user_memories select failed]", {
      phase: "load",
      userId,
      message: error.message,
      code: error.code,
    });
    return [];
  }

  return ((data || []) as UserMemoryRow[])
    .map((row) => ({
      id: row.id,
      type: row.memory_type,
      content: row.content,
      updatedAt: row.updated_at,
    }))
    .filter((memory) => Boolean(memory.content.trim()));
}

export function buildUserMemoryContext(memories: UserMemory[]) {
  if (!memories.length) {
    return "";
  }

  return memories
    .map((memory) => `- ${memoryTypeLabels[memory.type]}: ${memory.content}`)
    .join("\n");
}

export function getUserNameFromMemories(memories: UserMemory[]) {
  return memories.find((memory) => memory.type === "name")?.content || "";
}

export function getUserMemoryByType(memories: UserMemory[], type: UserMemoryType) {
  return memories.find((memory) => memory.type === type)?.content || "";
}

function readUserMetadataMemories(user: User): UserMemory[] {
  const rawMemories = user.user_metadata?.[USER_METADATA_MEMORY_KEY];

  if (!Array.isArray(rawMemories)) {
    return [];
  }

  return rawMemories
    .map((memory): UserMemory | null => {
      if (!memory || typeof memory !== "object") {
        return null;
      }

      const record = memory as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      const content = typeof record.content === "string" ? cleanMemoryContent(record.content) : "";

      if (
        !content ||
        ![
          "name",
          "company",
          "preference",
          "writing_style",
          "language",
          "long_term_goal",
          "general",
        ].includes(type)
      ) {
        return null;
      }

      return {
        id:
          typeof record.id === "string" && record.id
            ? record.id
            : createMemoryId(type as UserMemoryType, content),
        type: type as UserMemoryType,
        content,
        updatedAt:
          typeof record.updatedAt === "string" && record.updatedAt
            ? record.updatedAt
            : new Date(0).toISOString(),
      };
    })
    .filter((memory): memory is UserMemory => Boolean(memory))
    .slice(0, MAX_LOADED_MEMORIES);
}

function applyOperationsToMemoryList(
  existingMemories: UserMemory[],
  operations: UserMemoryOperation[]
) {
  let memories = [...existingMemories];
  let remembered = 0;
  let forgotten = 0;

  for (const operation of operations) {
    if (operation.action === "remember") {
      const duplicate = memories.some(
        (memory) =>
          memory.type === operation.type &&
          memory.content.toLowerCase() === operation.content.toLowerCase()
      );

      if (!duplicate) {
        memories = [
          {
            id: createMemoryId(operation.type, operation.content),
            type: operation.type,
            content: operation.content,
            updatedAt: new Date().toISOString(),
          },
          ...memories,
        ].slice(0, MAX_LOADED_MEMORIES);
        remembered += 1;
      }

      continue;
    }

    const target = operation.content.toLowerCase();
    const beforeCount = memories.length;

    memories = memories.filter((memory) => {
      if (operation.type && memory.type === operation.type) {
        return false;
      }

      const content = memory.content.toLowerCase();

      return !(content.includes(target) || target.includes(content));
    });
    forgotten += beforeCount - memories.length;
  }

  return {
    memories,
    remembered,
    forgotten,
  };
}

async function applyUserMemoryOperationsToMetadata(
  supabase: SupabaseClient,
  user: User,
  operations: UserMemoryOperation[]
): Promise<UserMemoryApplyResult> {
  const next = applyOperationsToMemoryList(readUserMetadataMemories(user), operations);
  const { error } = await supabase.auth.updateUser({
    data: {
      [USER_METADATA_MEMORY_KEY]: next.memories.map((memory) => ({
        id: memory.id,
        type: memory.type,
        content: memory.content,
        updatedAt: memory.updatedAt,
      })),
    },
  });

  if (error) {
    console.error("[user_memories metadata fallback update failed]", {
      message: error.message,
      code: error.code,
      status: error.status,
    });

    return {
      remembered: 0,
      forgotten: 0,
      failed: operations.length,
      storage: "none",
      error: formatMemoryError(error, "metadata_update"),
    };
  }

  return {
    remembered: next.remembered,
    forgotten: next.forgotten,
    failed: 0,
    storage: "metadata",
    fallbackMemories: next.memories,
  };
}

export async function loadUserMemoriesForUser(
  supabase: SupabaseClient,
  user: User,
  fallbackMemories: UserMemory[] = []
): Promise<UserMemory[]> {
  const { data, error } = await supabase
    .from("user_memories")
    .select("id,memory_type,content,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(MAX_LOADED_MEMORIES);

  if (error) {
    console.error("[user_memories select failed]", {
      phase: "load_for_user",
      userId: user.id,
      message: error.message,
      code: error.code,
    });

    if (isMissingUserMemoriesTableError(error)) {
      return fallbackMemories.length ? fallbackMemories : readUserMetadataMemories(user);
    }

    return [];
  }

  return ((data || []) as UserMemoryRow[])
    .map((row) => ({
      id: row.id,
      type: row.memory_type,
      content: row.content,
      updatedAt: row.updated_at,
    }))
    .filter((memory) => Boolean(memory.content.trim()));
}

export async function applyUserMemoryOperations(
  supabase: SupabaseClient,
  userId: string,
  operations: UserMemoryOperation[],
  user?: User
): Promise<UserMemoryApplyResult> {
  const result: UserMemoryApplyResult = {
    remembered: 0,
    forgotten: 0,
    failed: 0,
    storage: "table",
  };

  if (!operations.length) {
    return result;
  }

  for (const operation of operations) {
    if (operation.action === "remember") {
      const normalizedContent = operation.content.toLowerCase();
      const { data: existingMemories, error: existingError } = await supabase
        .from("user_memories")
        .select("id,content")
        .eq("user_id", userId)
        .eq("memory_type", operation.type);

      if (existingError) {
        console.error("[user_memories duplicate check failed]", {
          phase: "duplicate_check",
          userId,
          memoryType: operation.type,
          message: existingError.message,
          code: existingError.code,
        });

        if (user && isMissingUserMemoriesTableError(existingError)) {
          return applyUserMemoryOperationsToMetadata(supabase, user, operations);
        }

        result.failed += 1;
        result.error = formatMemoryError(existingError, "duplicate_check");
        continue;
      }

      const duplicate = (existingMemories || []).some((memory) => {
        const content =
          typeof memory.content === "string" ? memory.content.toLowerCase() : "";

        return content === normalizedContent;
      });

      if (duplicate) {
        continue;
      }

      if (singletonMemoryTypes.has(operation.type) && existingMemories?.length) {
        const [primaryMemory, ...duplicateMemories] = existingMemories;
        const { error: updateError } = await supabase
          .from("user_memories")
          .update({
            content: operation.content,
            source: "explicit",
          })
          .eq("user_id", userId)
          .eq("id", primaryMemory.id);

        if (updateError) {
          console.error("[user_memories update failed]", {
            phase: "update",
            userId,
            memoryType: operation.type,
            message: updateError.message,
            code: updateError.code,
          });

          if (user && isMissingUserMemoriesTableError(updateError)) {
            return applyUserMemoryOperationsToMetadata(supabase, user, operations);
          }

          result.failed += 1;
          result.error = formatMemoryError(updateError, "update");
          continue;
        }

        result.remembered += 1;

        const duplicateIds = duplicateMemories
          .map((memory) => memory.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);

        if (duplicateIds.length) {
          const { error: cleanupError } = await supabase
            .from("user_memories")
            .delete()
            .eq("user_id", userId)
            .in("id", duplicateIds);

          if (cleanupError) {
            console.error("[user_memories duplicate cleanup failed]", {
              phase: "duplicate_cleanup",
              userId,
              memoryType: operation.type,
              message: cleanupError.message,
              code: cleanupError.code,
            });
          }
        }

        continue;
      }

      const { error } = await supabase.from("user_memories").insert({
        user_id: userId,
        memory_type: operation.type,
        content: operation.content,
        source: "explicit",
      });

      if (error) {
        console.error("[user_memories insert failed]", {
          phase: "insert",
          userId,
          memoryType: operation.type,
          message: error.message,
          code: error.code,
        });

        if (user && isMissingUserMemoriesTableError(error)) {
          return applyUserMemoryOperationsToMetadata(supabase, user, operations);
        }

        result.failed += 1;
        result.error = formatMemoryError(error, "insert");
      } else {
        result.remembered += 1;
      }

      continue;
    }

    const { data: existingMemories, error: selectError } = await supabase
      .from("user_memories")
      .select("id,memory_type,content")
      .eq("user_id", userId);

    if (selectError) {
      console.error("[user_memories forget select failed]", {
        phase: "forget_select",
        userId,
        message: selectError.message,
        code: selectError.code,
      });

      if (user && isMissingUserMemoriesTableError(selectError)) {
        return applyUserMemoryOperationsToMetadata(supabase, user, operations);
      }

      result.failed += 1;
      result.error = formatMemoryError(selectError, "forget_select");
      continue;
    }

    const target = operation.content.toLowerCase();
    const idsToDelete = (existingMemories || [])
      .filter((memory) => {
        const memoryType =
          typeof memory.memory_type === "string" ? memory.memory_type : "";
        const content =
          typeof memory.content === "string" ? memory.content.toLowerCase() : "";

        if (operation.type && memoryType === operation.type) {
          return true;
        }

        return content.includes(target) || target.includes(content);
      })
      .map((memory) => memory.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (!idsToDelete.length) {
      continue;
    }

    const { error } = await supabase
      .from("user_memories")
      .delete()
      .eq("user_id", userId)
      .in("id", idsToDelete);

    if (error) {
      console.error("[user_memories delete failed]", {
        phase: "delete",
        userId,
        message: error.message,
        code: error.code,
      });

      if (user && isMissingUserMemoriesTableError(error)) {
        return applyUserMemoryOperationsToMetadata(supabase, user, operations);
      }

      result.failed += 1;
      result.error = formatMemoryError(error, "delete");
    } else {
      result.forgotten += idsToDelete.length;
    }
  }

  return result;
}
