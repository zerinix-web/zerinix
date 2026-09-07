import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// TASK #69A-9 -- Remove duplicate prose response in Business Idea
// Validation report mode and make ZERINIX EXECUTIVE REPORT the single
// authoritative output. Extends the EXISTING, already-shipped Market
// Intelligence duplicate-prose fix (ChatMessages.tsx's
// getReportCompletionHeadline / isCompletedMarketReportMessage) to also
// cover Business Idea Validation ("plan" mode, "business" domain)
// specifically, without touching acquisition/real_estate/legal/finance/
// accounting/operations/procurement (the other "plan"-mode report
// domains) or Market Intelligence's own behavior at all.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const chatMessagesSourcePath = join(repoRoot, "components/planner/ChatMessages.tsx");
const chatMessagesSource = readFileSync(chatMessagesSourcePath, "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`export function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;

  // Find the matching close paren of the parameter list FIRST (by paren
  // depth, not brace depth) -- a parameter's own object-type annotation
  // (e.g. `message: { role: ...; mode?: ...; }`) contains braces that
  // would otherwise be mistaken for the function body's own braces.
  let parenIndex = source.indexOf("(", start);
  let parenDepth = 0;
  for (; parenIndex < source.length; parenIndex++) {
    if (source[parenIndex] === "(") parenDepth++;
    if (source[parenIndex] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }

  // The function body's real opening brace is the FIRST "{" after the
  // closing paren (skipping over any ": ReturnType" annotation in between).
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
    // Strip the `message: { ... }` parameter's own inline object-type
    // annotation (contains braces, so it must be removed before the
    // generic ") : ReturnType {" -> ") {" pass below, which assumes no
    // unbalanced braces remain in the parameter list).
    .replace(/message:\s*\{[^}]*\}/g, "message")
    .replace(/precedingUserContent\?:\s*string/g, "precedingUserContent")
    .replace(/content:\s*string/g, "content")
    .replace(/\)\s*:\s*[^{]+\{/g, ") {");
}

// Loads the REAL, unmodified getReportCompletionHeadline,
// isCompletedBusinessPlanReportMessage, and shouldShowReportCompletionHeadline
// from ChatMessages.tsx -- a "use client" file containing JSX elsewhere,
// which plain node cannot import directly -- wired to the real
// classifyReportDomain (report-engine/domain.ts, a plain module), never
// a stub. Same established extraction pattern used throughout this
// session for React/JSX files (ReportPdfButton.tsx, Planner.tsx).
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

  const dir = mkdtempSync(join(tmpdir(), "zerinix-chat-messages-"));
  const outPath = join(dir, "chat-messages.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

let getReportCompletionHeadline;
let isCompletedBusinessPlanReportMessage;
let shouldShowReportCompletionHeadline;

test.before(async () => {
  const mod = await loadChatMessageFunctions();
  getReportCompletionHeadline = mod.getReportCompletionHeadline;
  isCompletedBusinessPlanReportMessage = mod.isCompletedBusinessPlanReportMessage;
  shouldShowReportCompletionHeadline = mod.shouldShowReportCompletionHeadline;
});

const REAL_BIV_PROMPT =
  "I'm considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

const REAL_BIV_REPORT_MARKDOWN = [
  "## AI-Powered Financial Planning Platform for SMBs",
  "",
  "### Problem",
  "SMBs lack real-time cash-flow visibility...",
  "",
  "### Executive Summary",
  "Executive Decision\nDecision: MONITOR (Confidence: 48%)\n\nWhy: ...",
  "",
  "### Founder Readiness Score",
  "Founder Readiness Score: 40/100\nIdea Quality: 48/100 - ...",
].join("\n");

// Regression test 1/2: successful BIV report mode does not render the
// long duplicate plain-text response, and the headline it DOES show is
// minimal (just the title line), never a second decision summary.
test("regression 1/2: a completed Business Idea Validation message shows only its title line, never the full duplicate markdown dump", () => {
  const message = { role: "assistant", mode: "plan", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(message, REAL_BIV_PROMPT), true);

  const headline = getReportCompletionHeadline(REAL_BIV_REPORT_MARKDOWN);
  assert.equal(headline, "## AI-Powered Financial Planning Platform for SMBs");
  assert.doesNotMatch(headline, /Executive Decision/);
  assert.doesNotMatch(headline, /Decision: MONITOR/);
  assert.doesNotMatch(headline, /Founder Readiness Score: 40\/100/);
});

test("requirement C: the shown headline is a minimal transition (the report's own title), never a restated decision summary", () => {
  const headline = getReportCompletionHeadline(REAL_BIV_REPORT_MARKDOWN);
  assert.match(headline, /^#{1,2}\s+\S/);
  assert.doesNotMatch(headline, /Decision:|Confidence:|MONITOR|ENTER|AVOID/);
});

// Fail-before proof: reproduces the OLD, unfixed condition directly
// (Market-Intelligence-only, exactly as it shipped before this task) to
// prove BIV messages used to fall through to full-content rendering.
test("fail-before proof: the OLD Market-Intelligence-only condition would NOT have suppressed this exact BIV message", () => {
  const message = { role: "assistant", mode: "plan", status: "complete" };
  const oldConditionResult = !( // isUser
    message.role === "user"
  ) && message.mode === "market" && message.status === "complete";

  assert.equal(oldConditionResult, false, "the old condition never covered mode === 'plan' at all");
  // The NEW condition correctly covers it.
  assert.equal(shouldShowReportCompletionHeadline(message, REAL_BIV_PROMPT), true);
});

// Requirement A / scope precision -- only Business Idea Validation
// ("business" domain) is covered; every other "plan"-mode report domain
// (acquisition, real_estate, legal/finance/accounting/operations/
// procurement) keeps rendering in full, completely unchanged.
test("requirement A: only the 'business' domain within 'plan' mode is suppressed -- acquisition/real_estate/legal-family prompts are NOT", () => {
  const message = { role: "assistant", mode: "plan", status: "complete" };
  const nonBusinessPrompts = [
    "We are evaluating an acquisition target for $40M, assess valuation, purchase price, financing structure, and integration risk.",
    "Analyze this residential real estate investment property for cap rate, cash flow, and appreciation potential.",
    "Provide a legal risk assessment and compliance review for our data privacy policy under GDPR.",
  ];
  for (const prompt of nonBusinessPrompts) {
    assert.equal(
      shouldShowReportCompletionHeadline(message, prompt),
      false,
      `must NOT suppress for a non-business plan-mode prompt: "${prompt.slice(0, 40)}..."`
    );
  }
  assert.equal(shouldShowReportCompletionHeadline(message, REAL_BIV_PROMPT), true);
});

// Regression test 3: normal chat mode still renders assistant prose
// normally.
test("regression 3: ordinary chat-mode messages are never suppressed, regardless of preceding content", () => {
  const chatMessage = { role: "assistant", mode: "chat", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(chatMessage, REAL_BIV_PROMPT), false);
  assert.equal(shouldShowReportCompletionHeadline(chatMessage, undefined), false);
});

test("regression 3b: a completed message with no mode at all (legacy/undefined) is never suppressed", () => {
  const legacyMessage = { role: "assistant", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(legacyMessage, REAL_BIV_PROMPT), false);
});

// Requirement E / regression test 4: failed report generation still
// renders the appropriate error/failure message (never suppressed).
test("regression 4: a failed plan-mode message (even with a business-shaped preceding prompt) is never suppressed -- the real failure text must always show", () => {
  const failedMessage = { role: "assistant", mode: "plan", status: "failed" };
  assert.equal(shouldShowReportCompletionHeadline(failedMessage, REAL_BIV_PROMPT), false);
});

test("regression 4b: a still-streaming plan-mode message is never suppressed -- the live streaming text must always show", () => {
  const streamingMessage = { role: "assistant", mode: "plan", status: "streaming" };
  assert.equal(shouldShowReportCompletionHeadline(streamingMessage, REAL_BIV_PROMPT), false);
});

// Regression test 5/6: reload and regenerate use the exact same,
// deterministic, persisted-data-only classification -- no new schema
// needed, and re-evaluating twice against identical persisted data
// yields identical results.
test("regression 5/6: re-evaluating the same persisted message+preceding-prompt pair (simulating reload/regenerate) is deterministic and idempotent", () => {
  const message = { role: "assistant", mode: "plan", status: "complete" };
  const first = shouldShowReportCompletionHeadline(message, REAL_BIV_PROMPT);
  const second = shouldShowReportCompletionHeadline(message, REAL_BIV_PROMPT);
  assert.equal(first, true);
  assert.equal(first, second);

  const firstHeadline = getReportCompletionHeadline(REAL_BIV_REPORT_MARKDOWN);
  const secondHeadline = getReportCompletionHeadline(REAL_BIV_REPORT_MARKDOWN);
  assert.equal(firstHeadline, secondHeadline);
});

test("regression: no preceding user message (edge case -- message is first in conversation) is never suppressed, the safer default", () => {
  const message = { role: "assistant", mode: "plan", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(message, undefined), false);
  assert.equal(shouldShowReportCompletionHeadline(message, ""), false);
  assert.equal(shouldShowReportCompletionHeadline(message, "   "), false);
});

// Requirement B -- the underlying message content is never touched;
// only the INLINE render is suppressed.
test("requirement B: getReportCompletionHeadline never mutates or truncates message.content itself -- it is a pure, read-only projection", () => {
  const original = REAL_BIV_REPORT_MARKDOWN;
  const headline = getReportCompletionHeadline(original);
  assert.equal(original, REAL_BIV_REPORT_MARKDOWN, "the source string must be completely unmodified");
  assert.notEqual(headline, original, "the projection is shorter, but the original is untouched");
});

// Regression test 8 -- Market Intelligence behavior is completely
// unchanged (still suppressed, via the exact same shared function, not
// a second parallel condition).
test("regression 8: Market Intelligence's own suppression is completely unchanged -- still covered by shouldShowReportCompletionHeadline, mode === 'market' alone, no domain classification needed", () => {
  const marketMessage = { role: "assistant", mode: "market", status: "complete" };
  assert.equal(shouldShowReportCompletionHeadline(marketMessage, undefined), true);
  assert.equal(shouldShowReportCompletionHeadline(marketMessage, "any prompt at all"), true);
});

test("requirement: no separate, independently-maintained duplicate condition exists -- Planner.tsx's mobile renderer imports and calls the exact same shouldShowReportCompletionHeadline ChatMessages.tsx exports", () => {
  assert.match(
    plannerSource,
    /import\s*\{\s*\n?\s*ChatMessages,\s*\n?\s*getReportCompletionHeadline,\s*\n?\s*shouldShowReportCompletionHeadline,?\s*\n?\s*\}\s*from\s*"@\/components\/planner\/ChatMessages"/
  );
  assert.match(plannerSource, /shouldShowReportCompletionHeadline\(message, precedingUserContent\)/);
  // The OLD, MI-only inline condition must no longer exist as real code.
  assert.doesNotMatch(
    plannerSource,
    /message\.role === "assistant" && message\.mode === "market" && message\.status === "complete"\s*\n\s*\?\s*getReportCompletionHeadline/
  );
});

test("requirement D: ChatMessages.tsx's desktop bubble list passes the immediately-preceding message's content only when that message is the user's own prompt", () => {
  assert.match(
    chatMessagesSource,
    /const precedingMessage = index > 0 \? messages\[index - 1\] : undefined;\s*\n\s*const precedingUserContent =\s*\n\s*precedingMessage\?\.role === "user" \? precedingMessage\.content : undefined;/
  );
});

test("isCompletedBusinessPlanReportMessage in isolation: true only for a completed assistant 'plan'-mode message whose preceding user prompt classifies as the 'business' domain; false for a user message, a non-'plan' mode, an incomplete status, a missing/blank preceding prompt, or a non-business 'plan' prompt", () => {
  const completeAssistantPlan = { role: "assistant", mode: "plan", status: "complete" };
  assert.equal(isCompletedBusinessPlanReportMessage(completeAssistantPlan, REAL_BIV_PROMPT), true);
  assert.equal(
    isCompletedBusinessPlanReportMessage({ ...completeAssistantPlan, role: "user" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(
    isCompletedBusinessPlanReportMessage({ ...completeAssistantPlan, mode: "market" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(
    isCompletedBusinessPlanReportMessage({ ...completeAssistantPlan, status: "streaming" }, REAL_BIV_PROMPT),
    false
  );
  assert.equal(isCompletedBusinessPlanReportMessage(completeAssistantPlan, undefined), false);
  assert.equal(isCompletedBusinessPlanReportMessage(completeAssistantPlan, "   "), false);
  assert.equal(
    isCompletedBusinessPlanReportMessage(
      completeAssistantPlan,
      "I'm evaluating whether to acquire a regional HVAC services company for $4M."
    ),
    false
  );
});
