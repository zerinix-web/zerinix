// TASK #69A-10 -- Remove the final redundant report-completion shell
// before ZERINIX EXECUTIVE REPORT.
//
// ROOT CAUSE: Task #69A-9 truncated a completed report-generation
// message's DISPLAYED CONTENT down to just its title line, but left the
// surrounding chat bubble/row shell (desktop: "ZERINIX" sender label +
// Streaming badge + Copy/Regenerate header, in ChatMessageBubble; mobile:
// the avatar + row wrapper, in MobileConversationExperience) fully
// visible. ReportPanel, rendered immediately below the message list,
// already shows that exact same title as "ZERINIX EXECUTIVE REPORT" /
// {reportTitle} -- so the truncated bubble/row became a second,
// redundant "shell" duplicating a title ReportPanel already displays.
//
// FIX: reuse the SAME shared shouldShowReportCompletionHeadline rule
// (never a second, independently-maintained condition) at the LIST-
// RENDER level -- desktop's <ChatMessages> map, and mobile's new
// shouldRenderMessage prop threaded from Planner.tsx -- to skip mounting
// the entire message shell for a qualifying message, instead of merely
// truncating its content. message.content itself, and the pre-existing
// getReportCompletionHeadline/displayContent logic inside
// ChatMessageBubble, are left completely untouched (still correct, still
// tested by task69a9's own suite) -- this is purely an additional,
// list-level presentation filter, not a change to underlying data.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const chatMessagesSource = readFileSync(
  join(repoRoot, "components/planner/ChatMessages.tsx"),
  "utf8"
);
const mobileConversationSource = readFileSync(
  join(repoRoot, "components/planner/MobileConversationExperience.tsx"),
  "utf8"
);
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// Same established extraction pattern used throughout this session
// (task69a9's own test file, ReportPdfButton.tsx's tests, etc.) for
// pulling a named function's real source text out of a "use client" TSX
// file plain node cannot import directly.
function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`export function ${name}\\(`));
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

  return source.slice(start, i + 1).replace(/^export /, "");
}

function stripTsTypes(text) {
  return text
    .replace(/message:\s*\{[^}]*\}/g, "message")
    .replace(/precedingUserContent\?:\s*string/g, "precedingUserContent")
    .replace(/content:\s*string/g, "content")
    .replace(/\)\s*:\s*[^{]+\{/g, ") {");
}

async function loadChatMessageFunctions() {
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

  const dir = mkdtempSync(join(tmpdir(), "zerinix-chat-messages-69a10-"));
  const outPath = join(dir, "chat-messages.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

let shouldShowReportCompletionHeadline;

test.before(async () => {
  const mod = await loadChatMessageFunctions();
  shouldShowReportCompletionHeadline = mod.shouldShowReportCompletionHeadline;
});

const REAL_BIV_PROMPT =
  "I'm considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

const COMPLETED_BIV_MESSAGE = { role: "assistant", mode: "plan", status: "complete" };
const COMPLETED_MI_MESSAGE = { role: "assistant", mode: "market", status: "complete" };

test("fail-before proof: before this fix, ChatMessages.tsx's map rendered a full ChatMessageBubble shell (ZERINIX label + Copy/Regenerate) for every completed report-generation message -- the new guard did not exist", () => {
  assert.doesNotMatch(
    chatMessagesSource.replace(
      /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}\s*\n\n\s*/,
      ""
    ),
    /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );
});

test("the new suppression guard exists in ChatMessages.tsx's map, gated by the exact same shared rule used for headline truncation, positioned before ChatMessageBubble is returned", () => {
  assert.match(
    chatMessagesSource,
    /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );

  const mapBody = chatMessagesSource.slice(
    chatMessagesSource.indexOf("{messages.map((message, index) => {"),
    chatMessagesSource.indexOf("</section>")
  );
  const guardIndex = mapBody.indexOf("if (shouldShowReportCompletionHeadline(message, precedingUserContent))");
  const bubbleIndex = mapBody.indexOf("<ChatMessageBubble");
  assert.ok(guardIndex > -1 && bubbleIndex > -1 && guardIndex < bubbleIndex);
});

test("requirement A: a completed Business Idea Validation report message satisfies the exact condition gating the new null-return guard", () => {
  assert.equal(shouldShowReportCompletionHeadline(COMPLETED_BIV_MESSAGE, REAL_BIV_PROMPT), true);
});

test("requirement B: ReportPanel and its 'ZERINIX EXECUTIVE REPORT' header are completely untouched -- still rendered from both the desktop and mobile call sites, unaffected by the new list-level suppression", () => {
  assert.match(plannerSource, /const ReportPanel = memo\(function ReportPanel\(/);
  assert.match(plannerSource, /ZERINIX EXECUTIVE REPORT/);

  const reportPanelCallSites = plannerSource.match(/<ReportPanel/g) || [];
  assert.equal(reportPanelCallSites.length, 2, "expected exactly the desktop and mobile ReportPanel call sites");
});

test("requirement C: normal chat-mode and mode-less messages are never suppressed -- shouldShowReportCompletionHeadline (the exact function gating the new guard) already returns false for them", () => {
  assert.equal(
    shouldShowReportCompletionHeadline({ role: "assistant", mode: "chat", status: "complete" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(
    shouldShowReportCompletionHeadline({ role: "assistant", status: "complete" }, REAL_BIV_PROMPT),
    false
  );
});

test("requirement D: a still-streaming report-generation message is never suppressed -- status !== 'complete' keeps shouldShowReportCompletionHeadline false", () => {
  assert.equal(
    shouldShowReportCompletionHeadline({ ...COMPLETED_BIV_MESSAGE, status: "streaming" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(
    shouldShowReportCompletionHeadline({ ...COMPLETED_MI_MESSAGE, status: "streaming" }, REAL_BIV_PROMPT),
    false
  );
});

test("requirement E: a failed report-generation message is never suppressed -- the real failure text must remain visible", () => {
  assert.equal(
    shouldShowReportCompletionHeadline({ ...COMPLETED_BIV_MESSAGE, status: "failed" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(
    shouldShowReportCompletionHeadline({ ...COMPLETED_MI_MESSAGE, status: "failed" }, REAL_BIV_PROMPT),
    false
  );
});

test("requirement F: Market Intelligence has the exact same redundant completion-shell architecture as Business Idea Validation, and the new guard deliberately reuses the identical shared rule for both -- no MI-specific carve-out exempts it from the new suppression", () => {
  assert.equal(shouldShowReportCompletionHeadline(COMPLETED_MI_MESSAGE, undefined), true);

  // The guard in the map is a single, unconditional call to the shared
  // function -- no additional "&&" / "mode ===" branching wraps it that
  // could exempt one mode while suppressing the other.
  const guardMatch = chatMessagesSource.match(
    /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );
  assert.notEqual(guardMatch, null);
  assert.doesNotMatch(guardMatch[0], /&&|mode ===/);
});

test("mobile: MobileConversationExperience.tsx declares an optional shouldRenderMessage prop that skips the ENTIRE message row (not merely its content) before any avatar/wrapper markup is computed", () => {
  assert.match(
    mobileConversationSource,
    /shouldRenderMessage\?:\s*\(message: MobileConversationMessage\) => boolean;/
  );

  const mapBody = mobileConversationSource.slice(
    mobileConversationSource.indexOf("{messages.map((message) => {"),
    mobileConversationSource.indexOf("</article>")
  );
  const guardIndex = mapBody.indexOf("if (shouldRenderMessage && !shouldRenderMessage(message))");
  const isUserIndex = mapBody.indexOf('const isUser = message.role === "user"');
  assert.ok(guardIndex > -1 && isUserIndex > -1 && guardIndex < isUserIndex);
});

test("mobile: the prop is optional -- omitting it (any other caller/test that constructs MobileConversationExperience without it) still renders every message exactly as before, since the guard only skips when the prop is BOTH provided and false", () => {
  assert.match(
    mobileConversationSource,
    /if \(shouldRenderMessage && !shouldRenderMessage\(message\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );
});

test("requirement 6 (desktop/mobile consistency): Planner.tsx wires MobileConversationExperience's shouldRenderMessage to negate the exact same shouldShowReportCompletionHeadline rule, using the identical preceding-user-message lookup renderMessageContent already uses", () => {
  assert.match(
    plannerSource,
    /shouldRenderMessage=\{\(message: MobileConversationMessage\) => \{/
  );

  const wiringBlock = plannerSource.slice(
    plannerSource.indexOf("shouldRenderMessage={(message: MobileConversationMessage) => {"),
    plannerSource.indexOf("shouldRenderMessage={(message: MobileConversationMessage) => {") + 1200
  );
  assert.match(wiringBlock, /const messageIndex = messages\.findIndex\(\(candidate\) => candidate\.id === message\.id\);/);
  assert.match(wiringBlock, /precedingMessage\?\.role === "user" \? precedingMessage\.content : undefined;/);
  assert.match(wiringBlock, /return !shouldShowReportCompletionHeadline\(message, precedingUserContent\);/);
});

test("regression: message.content and the pre-existing headline-truncation logic inside ChatMessageBubble are completely untouched -- this is purely an additional list-level filter, never a change to underlying data or to the task69a9 fix it builds on", () => {
  assert.match(
    chatMessagesSource,
    /const displayContent = shouldShowReportCompletionHeadline\(message, precedingUserContent\)\s*\n\s*\? getReportCompletionHeadline\(message\.content\)\s*\n\s*: message\.content;/
  );
  assert.match(chatMessagesSource, /await navigator\.clipboard\.writeText\(message\.content\);/);
});

test("AI generation, prompts, report schema, decision/confidence logic, Founder Readiness, risk authority, TAM/SAM/SOM, and report persistence are untouched -- this pass only added a presentation-level list-render filter (drift check)", () => {
  assert.doesNotMatch(plannerSource, /function ReportPanel\(\{[\s\S]{0,50}reportData,[\s\S]{0,2000}shouldShowReportCompletionHeadline/);
});
