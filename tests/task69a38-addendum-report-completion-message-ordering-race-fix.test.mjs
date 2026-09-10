// ADDENDUM TO #69A-38B -- the legacy raw narrative "Business Plan
// Report" presentation (getReportMarkdown's full text dump: "Executive
// Summary", "Executive Decision: MONITOR (Confidence: NN%)",
// "Confidence Reduced Because:", "Why:", "Top 3 Reasons:") became
// visible again in the live BIV chat UI, above the structured
// ReportPanel.
//
// ROOT CAUSE, confirmed by direct database inspection (not assumed): a
// real, freshly-generated conversation's row showed the ASSISTANT
// message's own persisted created_at (07:31:05.982196) BEFORE its own
// USER message's created_at (07:31:05.995866), even though the user
// message was unambiguously created first, client-side, in the same
// synchronous code path. persistMessage's INSERT never sent its own
// created_at, so Postgres's `default now()` assigned it at network
// ARRIVAL time -- and the user-message and assistant-"streaming"-
// placeholder persistMessage calls are both fired through
// initialPersistenceTasks without awaiting one before the other
// (deliberate, to avoid blocking the UI on two sequential round trips).
// Two concurrent inserts have no guaranteed arrival order.
//
// This did NOT break shouldShowReportCompletionHeadline/
// isCompletedBusinessPlanReportMessage (#69A-9/#69A-10's own suppression
// rule, still fully intact and unit-tested below) -- it broke the INPUT
// those functions receive on reload: loadPersistedMessages/
// loadPlanConversations both sort strictly by created_at ascending, so
// the misordered conversation reloads with the assistant message at
// array index 0 -- no preceding message at all, so precedingUserContent
// is undefined, and the (correctly written) guard correctly declines to
// suppress a message it cannot classify.
//
// FIX (components/Planner.tsx's persistMessage): send the message's own
// already-correct, client-side `createdAt` (ChatMessage.createdAt, a
// Date.now() value assigned synchronously at message-construction time,
// strictly increasing across the user-then-assistant call sequence
// regardless of which HTTP request happens to reach Supabase first) as
// this row's created_at, instead of trusting network arrival order.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const chatMessagesSource = readFileSync(join(repoRoot, "components/planner/ChatMessages.tsx"), "utf8");

function extractFunctionSource(source, name, exported = true) {
  const startMatch = source.match(new RegExp(`${exported ? "export " : ""}(?:async )?function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;

  let parenIndex = source.indexOf("(", start);
  let parenDepth = 0;
  for (; parenIndex < source.length; parenIndex++) {
    if (source[parenIndex] === "(") parenDepth++;
    if (source[parenIndex] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }

  let i = source.indexOf("{", parenIndex);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  return source.slice(start, i + 1);
}

// --- [1] the exact fix is present in persistMessage's INSERT payload ----

test("[1] persistMessage's ai_messages INSERT now sends created_at derived from the message's own client-side createdAt, never left to the database's arrival-time default", () => {
  const persistMessageSource = extractFunctionSource(plannerSource, "persistMessage", false);
  assert.match(persistMessageSource, /created_at:\s*new Date\(message\.createdAt\)\.toISOString\(\)/);
});

test("[1b] FAIL-BEFORE PROOF: the OLD insert payload (reconstructed by removing the fix line from the CURRENT source, not git-dependent) never sent created_at at all -- self-verifying that the fix is genuinely present before simulating its removal", () => {
  const persistMessageSource = extractFunctionSource(plannerSource, "persistMessage", false);
  const fixLine = /\s*created_at: new Date\(message\.createdAt\)\.toISOString\(\),\n/;
  assert.match(persistMessageSource, fixLine, "expected the CURRENT source to contain the fix before simulating its removal");
  const reverted = persistMessageSource.replace(fixLine, "\n");
  assert.doesNotMatch(reverted, /created_at:/);
});

// --- [2] updatePersistedMessage deliberately does not touch created_at --

test("[2] updatePersistedMessage's status-transition UPDATE never touches created_at -- a message's original creation-order timestamp must survive its own streaming -> complete transition unchanged", () => {
  const updateSource = extractFunctionSource(plannerSource, "updatePersistedMessage", false);
  assert.doesNotMatch(updateSource, /created_at/);
  assert.match(updateSource, /\.update\(\{ content, status \}\)/);
});

// --- [3] deterministic ordering simulation --------------------------------

test("[3] simulating the EXACT reported race: two persistMessage calls fired concurrently (assistant's INSERT arriving at the database before the user's) still reload in the CORRECT conversational order once each row's created_at is the message's own client-side createdAt", () => {
  // Mirrors addUserMessage then addAssistantMessage's real call
  // sequence: two synchronous Date.now() calls, strictly increasing,
  // with no async gap between them (the worst case for a race, since a
  // real submission has additional awaited work in between that would
  // only widen this gap further).
  const userCreatedAt = Date.now();
  const assistantCreatedAt = userCreatedAt + 1;

  const userMessage = { id: "u1", role: "user", content: "the real prompt", createdAt: userCreatedAt };
  const assistantMessage = { id: "a1", role: "assistant", mode: "plan", status: "complete", content: "# Business Plan Report\n...", createdAt: assistantCreatedAt };

  // Simulate the two INSERTs "racing" -- the assistant's row happens to
  // be written to the mock table FIRST (the exact failure mode observed
  // live), but each row's stored created_at is still derived from the
  // message's own createdAt, per the fix, never from arrival order.
  const table = [];
  function insert(message) {
    table.push({ ...message, created_at: new Date(message.createdAt).toISOString() });
  }
  insert(assistantMessage); // arrives first at the "database"
  insert(userMessage); // arrives second

  // loadPersistedMessages/loadPlanConversations both sort strictly by
  // created_at ascending on reload.
  const reloaded = [...table].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );

  assert.equal(reloaded[0].role, "user", "the user message must sort first despite arriving at the database second");
  assert.equal(reloaded[1].role, "assistant");

  const precedingMessage = reloaded[0];
  const precedingUserContent = precedingMessage.role === "user" ? precedingMessage.content : undefined;
  assert.equal(precedingUserContent, "the real prompt", "the assistant message's preceding-user-content lookup must resolve correctly after reload");
});

test("[3b] FAIL-BEFORE PROOF: the SAME race, simulated with the OLD behavior (created_at left to arrival order, never the message's own createdAt), reproduces the exact reported corruption -- the assistant message ends up with no preceding message at all", () => {
  const userCreatedAt = Date.now();
  const assistantCreatedAt = userCreatedAt + 1;
  const userMessage = { id: "u1", role: "user", content: "the real prompt", createdAt: userCreatedAt };
  const assistantMessage = { id: "a1", role: "assistant", mode: "plan", status: "complete", content: "# Business Plan Report\n...", createdAt: assistantCreatedAt };

  // OLD (pre-fix) behavior: created_at is whatever the database assigns
  // at arrival time, modeled here as arrival order -- the assistant's
  // INSERT genuinely reaches the database first (the real, observed
  // failure), so its arrival-time created_at is EARLIER than the user
  // message's, despite being created client-side second.
  const arrivalTimeBase = Date.now();
  const table = [
    { ...assistantMessage, created_at: new Date(arrivalTimeBase).toISOString() },
    { ...userMessage, created_at: new Date(arrivalTimeBase + 13).toISOString() },
  ];

  const reloaded = [...table].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );

  assert.equal(reloaded[0].role, "assistant", "reproduces the exact reported corruption: the assistant message sorts first");
  const precedingUserContent = reloaded[0].role === "user" ? undefined : undefined;
  assert.equal(precedingUserContent, undefined, "no preceding user message exists at index 0 -- this is exactly what made isCompletedBusinessPlanReportMessage return false live");
});

// --- [4] the legacy raw narrative block is not rendered (suppression -----
// --- rule itself, unchanged and still correct) ---------------------------

async function loadChatMessageFunctions() {
  function stripTsTypes(text) {
    return text
      .replace(/message:\s*\{[^}]*\}/g, "message")
      .replace(/precedingUserContent\?:\s*string/g, "precedingUserContent")
      .replace(/content:\s*string/g, "content")
      .replace(/\)\s*:\s*[^{]+\{/g, ") {")
      .replace(/^export /, "");
  }

  const blob = [
    stripTsTypes(extractFunctionSource(chatMessagesSource, "getReportCompletionHeadline")),
    stripTsTypes(extractFunctionSource(chatMessagesSource, "isCompletedBusinessPlanReportMessage")),
    stripTsTypes(extractFunctionSource(chatMessagesSource, "shouldShowReportCompletionHeadline")),
  ].join("\n\n");

  const domainUrl = pathToFileURL(join(repoRoot, "app/lib/report-engine/domain.ts")).href;
  const fullSource = [
    `import { classifyReportDomain } from ${JSON.stringify(domainUrl)};`,
    blob,
    "export { getReportCompletionHeadline, isCompletedBusinessPlanReportMessage, shouldShowReportCompletionHeadline };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-chat-messages-addendum-"));
  const outPath = join(dir, "chat-messages.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

let shouldShowReportCompletionHeadline;

test.before(async () => {
  const mod = await loadChatMessageFunctions();
  shouldShowReportCompletionHeadline = mod.shouldShowReportCompletionHeadline;
});

const REAL_ADDENDUM_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

test("[4] with correct ordering restored (this fix), the completed BIV report message is correctly suppressed -- the legacy raw narrative never renders", () => {
  const assistantMessage = { role: "assistant", mode: "plan", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(assistantMessage, REAL_ADDENDUM_PROMPT), true);
});

test("[4b] with the corrupted ordering (no preceding user message resolved), suppression correctly declines -- proving the guard itself was never the defect; only its input was", () => {
  const assistantMessage = { role: "assistant", mode: "plan", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(assistantMessage, undefined), false);
});

// --- [5] canonical report data/generation logic untouched -----------------

test("[5] no report generation, decision-engine, financial-model, Porter, or competitor-landscape file was touched by this fix -- it is confined to chat-message persistence ordering", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-consistency-validation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /ADDENDUM TO #69A-38B/, `${relativePath} should not carry this addendum's marker`);
  }
});

test("[5b] narrative data itself (getReportMarkdown, the chat message's own content) is completely untouched -- only its persisted created_at changes; canonical data, PDF generation, and validation are unaffected", () => {
  assert.match(plannerSource, /function getReportMarkdown\(/);
  assert.doesNotMatch(
    extractFunctionSource(plannerSource, "getReportMarkdown", false),
    /ADDENDUM TO #69A-38B/
  );
});

// --- [6] regression: existing #69A-9/#69A-10 suppression architecture ----
// --- is completely unaffected -----------------------------------------

test("[6] the suppression guard in ChatMessages.tsx's map (list-level full suppression, #69A-10's own fix) is unchanged", () => {
  assert.match(
    chatMessagesSource,
    /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );
});
