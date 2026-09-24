import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPlanConversations } from "@/app/plan/conversations";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workspace = read("components/AIChatWorkspace.tsx");

test("opening Ask starts a fresh, empty session", () => {
  // THE BUG: the newest historical conversation used to become the active one
  // on mount, so tapping Ask in the bottom navigation -- or merely refreshing
  // -- re-opened the last exchange.
  assert.match(workspace, /const freshConversationId = useMemo\(\(\) => createMessageId\(\), \[\]\);/);
  assert.match(
    workspace,
    /useState<Conversation\[\]>\(\(\) => \[\s*createConversation\(freshConversationId\),\s*\.\.\.initialConversations,\s*\]\)/,
    "the fresh session is first, history is kept behind it"
  );
  assert.match(workspace, /useState\(freshConversationId\)/, "the fresh session is the active one");

  // The old behaviour must not come back in any form.
  assert.doesNotMatch(workspace, /useState\(initialConversationId\)/);
  assert.doesNotMatch(
    workspace,
    /initialConversations\[0\]\?\.id \|\| createMessageId\(\)/,
    "the newest conversation must never be auto-selected again"
  );
});

test("history is kept, never dropped, and stays in the drawer", () => {
  // Every loaded conversation is still in state, so the drawer lists them all.
  assert.match(workspace, /\.\.\.initialConversations,/);
  assert.match(
    workspace,
    /new Set\(initialConversations\.map\(\(conversation\) => conversation\.id\)\)/,
    "already-persisted ids are still tracked, so history is not re-inserted"
  );
  // The drawer renders from the sorted list, not from the active session.
  assert.match(workspace, /const sortedConversations = useMemo\(/);
  assert.match(workspace, /\[\.\.\.conversations\]\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\)/);
});

test("selecting a conversation from the drawer restores it", () => {
  assert.match(
    workspace,
    /function selectConversation\(conversationId: string\) \{\s*setActiveConversationId\(conversationId\);/
  );
  // Selecting closes the drawer and clears the composer, so the restored
  // conversation is what the user sees -- not a half-typed new prompt.
  const select = workspace.slice(
    workspace.indexOf("function selectConversation"),
    workspace.indexOf("function selectConversation") + 300
  );
  assert.match(select, /setSidebarOpen\(false\)/);
  assert.match(select, /setPrompt\(""\)/);
});

test("an unused fresh session leaves nothing behind", () => {
  // It is persisted lazily, on the first message, so opening Ask and walking
  // away cannot accumulate empty rows or clutter the drawer.
  assert.match(workspace, /await ensurePersistedConversation\(conversationId, title\);/);
  const mountBlock = workspace.slice(
    workspace.indexOf("const freshConversationId"),
    workspace.indexOf("const [prompt, setPrompt]")
  );
  assert.doesNotMatch(
    mountBlock,
    /ensurePersistedConversation|persistMessage/,
    "mount must not write anything to the database"
  );
});

test("stale timeout turns are still filtered out of restored history", async () => {
  // The previous fix must survive this one: selecting a historical
  // conversation restores its successful turns and none of its failed ones.
  const stub = (tables) => ({
    from(table) {
      const rows = tables[table] || [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  });

  const base = {
    conversation_id: "c1",
    mode: "chat",
    attachments: [],
    created_at: "2026-09-24T10:00:00.000Z",
  };
  const result = await loadPlanConversations(
    stub({
      ai_conversations: [
        { id: "c1", title: "t", created_at: base.created_at, updated_at: base.created_at },
      ],
      ai_messages: [
        { ...base, id: "u1", role: "user", content: "Question", status: "complete" },
        { ...base, id: "a1", role: "assistant", content: "Answer", status: "complete" },
        { ...base, id: "a2", role: "assistant", content: "Advisor timed out", status: "failed" },
      ],
    }),
    { id: "user-1", email: "user@example.com" }
  );

  const restored = result.conversations[0].messages;
  assert.deepEqual(
    restored.map((message) => message.content),
    ["Question", "Answer"],
    "history loads in full, minus the failed turn"
  );
});
