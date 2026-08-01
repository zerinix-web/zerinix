import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationSource = readFileSync(
  "supabase/migrations/20260711200000_create_user_memories.sql",
  "utf8"
);
const helperSource = readFileSync("app/lib/ai/user-memory.ts", "utf8");
const chatRouteSource = readFileSync("app/api/chat/route.ts", "utf8");
const planRouteSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const marketRouteSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

test("user memories table is owner-scoped with RLS", () => {
  assert.match(migrationSource, /create table if not exists public\.user_memories/);
  assert.match(migrationSource, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migrationSource, /alter table public\.user_memories enable row level security/i);
  assert.match(migrationSource, /for select\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)/i);
  assert.match(migrationSource, /for insert\s+to authenticated\s+with check \(auth\.uid\(\) = user_id\)/i);
  assert.match(migrationSource, /for update\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\)/i);
  assert.match(migrationSource, /for delete\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)/i);
});

test("memory extraction only reacts to explicit durable-memory phrases", () => {
  assert.match(helperSource, /extractExplicitMemoryOperations/);
  assert.match(helperSource, /my name is/);
  assert.match(helperSource, /my company is/);
  assert.match(helperSource, /my preferred language is/);
  assert.match(helperSource, /please answer in/);
  assert.match(helperSource, /i prefer/);
  assert.match(helperSource, /my long\[-\\s\]\?term goal is/);
  assert.match(helperSource, /isLikelyLanguage/);
  assert.match(helperSource, /remember \(\?:this\|that\|it\)/);
  assert.match(helperSource, /forget \(\?:this\|that\|it\)/);
  assert.match(helperSource, /always/);
  assert.match(helperSource, /MAX_MEMORY_CONTENT_LENGTH/);
  assert.match(helperSource, /UserMemoryApplyResult/);
  assert.match(helperSource, /getUserNameFromMemories/);
  assert.match(helperSource, /loadUserMemoriesForUser/);
  assert.match(helperSource, /USER_METADATA_MEMORY_KEY/);
  assert.match(helperSource, /isMissingUserMemoriesTableError/);
  assert.match(helperSource, /formatMemoryError/);
  assert.match(helperSource, /phase: "insert"/);
  assert.match(helperSource, /phase: "load_for_user"/);
  assert.match(helperSource, /singletonMemoryTypes/);
  assert.match(helperSource, /\.update\(\{\s*content: operation\.content,\s*source: "explicit"/s);
});

test("AI Chat loads, updates, and injects persistent user memories", () => {
  assert.match(chatRouteSource, /loadUserMemoriesForUser/);
  assert.match(chatRouteSource, /extractExplicitMemoryOperations/);
  assert.match(chatRouteSource, /applyUserMemoryOperations/);
  assert.match(chatRouteSource, /buildUserMemoryContext/);
  assert.match(chatRouteSource, /Persistent user memories for stable personalization/);
  assert.match(chatRouteSource, /Persistent user memory context/);
  assert.match(chatRouteSource, /persistent memory operation/);
  assert.match(chatRouteSource, /persistent memory loaded/);
  assert.match(chatRouteSource, /memoryApplyResult\.failed > 0/);
  assert.match(chatRouteSource, /memoryApplyResult\.fallbackMemories/);
  assert.match(chatRouteSource, /memoryApplyResult\.storage !== "table"/);
  assert.match(chatRouteSource, /memoryApplyResult\.error/);
  assert.match(chatRouteSource, /memory database write failed/);
  assert.match(chatRouteSource, /Storage used: \$\{memoryApplyResult\.storage\}/);
  assert.match(chatRouteSource, /formatMemorySaveResponse/);
  assert.match(chatRouteSource, /I've saved your company as \$\{content\}/);
  assert.match(chatRouteSource, /I've saved your language preference as \$\{content\}/);
  assert.match(chatRouteSource, /I'll remember that you prefer \$\{content\}/);
  assert.match(chatRouteSource, /I've saved your long-term goal/);
  assert.match(chatRouteSource, /user_memory_used/);
  assert.match(chatRouteSource, /memory_operation_count/);
});

test("AI Chat can answer memory recall questions directly from persistent memory", () => {
  assert.match(chatRouteSource, /getMemoryRecallType/);
  assert.match(chatRouteSource, /what is my company/);
  assert.match(chatRouteSource, /which language do i prefer/);
  assert.match(chatRouteSource, /how should you answer me/);
  assert.match(chatRouteSource, /what is my long\[-\\s\]\?term goal/);
  assert.match(chatRouteSource, /formatMemoryRecallResponse/);
  assert.match(chatRouteSource, /answered from persistent memory/);
  assert.match(chatRouteSource, /Your company is \$\{content\}/);
  assert.match(chatRouteSource, /You prefer \$\{content\}/);
  assert.match(chatRouteSource, /Your long-term goal is \$\{content\}/);
});

test("AI Chat cache is disabled when persistent memory affects the response", () => {
  assert.match(chatRouteSource, /userMemoryContext: string/);
  assert.match(chatRouteSource, /!input\.userMemoryContext/);
  assert.match(chatRouteSource, /User memories:/);
});

test("AI Plan and Market Analysis include user memory context in provider input and cache keys", () => {
  for (const source of [planRouteSource, marketRouteSource]) {
    assert.match(source, /loadUserMemories/);
    assert.match(source, /loadUserMemoriesForUser/);
    assert.match(source, /extractExplicitMemoryOperations/);
    assert.match(source, /applyUserMemoryOperations/);
    assert.match(source, /buildUserMemoryContext/);
    assert.match(source, /Persistent user memories for stable context/);
    assert.match(source, /memories:\$\{userMemoryContext\}/);
  }
});
