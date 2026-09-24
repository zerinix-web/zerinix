import test from "node:test";
import assert from "node:assert/strict";
import { loadPlanConversations } from "@/app/plan/conversations";

// A chainable Supabase stub: every builder method returns itself, and awaiting
// it resolves to whatever the last from(table) selected. Enough to drive the
// real loader without a database.
function createSupabaseStub(tables) {
  // from() must bind its own rows: loadPlanConversations runs several queries
  // inside one Promise.all, so a builder sharing mutable state would hand the
  // wrong table's rows to whichever query resolved last.
  return {
    from(table) {
      const rows = tables[table] || [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

const USER = { id: "user-1", email: "user@example.com" };
const CONVERSATION = {
  id: "conv-1",
  title: "Risks for a new AI startup",
  created_at: "2026-09-24T10:00:00.000Z",
  updated_at: "2026-09-24T10:05:00.000Z",
};

const row = (overrides) => ({
  id: "m",
  conversation_id: "conv-1",
  role: "assistant",
  content: "",
  mode: "chat",
  status: "complete",
  attachments: [],
  created_at: "2026-09-24T10:01:00.000Z",
  ...overrides,
});

async function restore(messages) {
  const supabase = createSupabaseStub({
    ai_conversations: [CONVERSATION],
    ai_messages: messages,
  });
  const result = await loadPlanConversations(supabase, USER);
  return result.conversations[0]?.messages ?? [];
}

test("a previous transient timeout is NOT restored as a historical answer", async () => {
  // THE BUG, reproduced. The client persists the assistant row before the
  // request and rewrites it to status "failed" with the friendly error text
  // when the turn breaks. Restoring that row replayed the "Advisor timed out"
  // card every time Ask was opened, with no request in flight.
  const restored = await restore([
    row({ id: "u1", role: "user", content: "What are the 3 biggest risks for a new AI startup?" }),
    row({
      id: "a1",
      status: "failed",
      content: "ZERINIX took too long to finish the answer. Your prompt was kept, and you can retry safely.",
    }),
  ]);

  assert.equal(restored.length, 1, "only the user's prompt survives");
  assert.equal(restored[0].role, "user");
  assert.doesNotMatch(
    restored.map((message) => message.content).join(" "),
    /took too long to finish/,
    "the timeout text must never come back as an assistant message"
  );
});

test("an interrupted turn does not replay the thinking card forever", async () => {
  // The placeholder is persisted as "streaming" BEFORE the request, so a
  // navigation away, a backgrounded app or a crash leaves it behind. Restoring
  // it would render the big "AI is thinking" card with nothing ever arriving.
  const restored = await restore([
    row({ id: "u1", role: "user", content: "Compare bootstrapping versus raising capital." }),
    row({ id: "a1", status: "streaming", content: "" }),
  ]);

  assert.equal(restored.length, 1);
  assert.equal(restored[0].role, "user");
  assert.ok(
    !restored.some((message) => message.status === "streaming"),
    "no restored message may claim to still be streaming"
  );
});

test("the user's prompt is always kept, so retry is safe", async () => {
  const prompt = "What are the 3 biggest risks for a new AI startup?";
  const restored = await restore([
    row({ id: "u1", role: "user", content: prompt }),
    row({ id: "a1", status: "failed", content: "Advisor timed out" }),
    row({ id: "u2", role: "user", content: "Second question" }),
    row({ id: "a2", status: "streaming", content: "" }),
  ]);

  assert.deepEqual(
    restored.map((message) => message.content),
    [prompt, "Second question"],
    "every user prompt survives an unfinished assistant turn"
  );
});

test("successful history is completely intact", async () => {
  const restored = await restore([
    row({ id: "u1", role: "user", content: "First question" }),
    row({ id: "a1", status: "complete", content: "First answer" }),
    row({ id: "u2", role: "user", content: "Second question" }),
    row({ id: "a2", status: "complete", content: "Second answer", attachments: [{ name: "f.pdf" }] }),
  ]);

  assert.deepEqual(
    restored.map((message) => [message.role, message.content, message.status]),
    [
      ["user", "First question", "complete"],
      ["assistant", "First answer", "complete"],
      ["user", "Second question", "complete"],
      ["assistant", "Second answer", "complete"],
    ]
  );
  assert.deepEqual(restored[3].attachments, [{ name: "f.pdf" }]);
});

test("a completed answer that merely mentions a timeout still restores", async () => {
  // The filter keys on status, never on the text. An answer that happens to
  // discuss timeouts is a real answer and must survive.
  const restored = await restore([
    row({ id: "u1", role: "user", content: "How should I handle API timeouts?" }),
    row({
      id: "a1",
      status: "complete",
      content: "Set a timeout budget per call. If a request times out, retry with backoff.",
    }),
  ]);

  assert.equal(restored.length, 2);
  assert.match(restored[1].content, /times out/);
});
