import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sanitizerSource = readFileSync("app/lib/ai/response-sanitization.ts", "utf8");
const chatWorkspaceSource = readFileSync("components/AIChatWorkspace.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const chatRouteSource = readFileSync("app/api/chat/route.ts", "utf8");
const planRouteSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const marketRouteSource = readFileSync("app/api/market-analysis/route.ts", "utf8");
const reportDetailSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");

test("shared AI response sanitizer removes accidental non-English prefixes", () => {
  assert.match(sanitizerSource, /sanitizeAiResponseText/);
  assert.match(sanitizerSource, /理由\|原因/);
  assert.match(sanitizerSource, /回答\|答案/);
  assert.match(sanitizerSource, /요약\|이유/);
  assert.match(sanitizerSource, /accidentalPrefixPattern/);
});

test("chat streaming sanitizes accumulated output before rendering and persistence", () => {
  for (const source of [chatWorkspaceSource, plannerSource]) {
    assert.match(source, /import \{ sanitizeAiResponseText \}/);
    assert.match(source, /onChunk\(sanitizeAiResponseText\(output\)\)/);
    assert.match(source, /const sanitizedOutput = sanitizeAiResponseText\(output\)/);
    assert.match(source, /return sanitizedOutput/);
  }
});

test("API chat sanitizes cached, mock, and completed response text", () => {
  assert.match(chatRouteSource, /import \{ sanitizeAiResponseText \}/);
  assert.match(chatRouteSource, /const sanitizedContent = sanitizeAiResponseText\(content\)/);
  assert.match(chatRouteSource, /sanitizeAiResponseText\(\[/);
  assert.match(chatRouteSource, /const sanitizedCompletedText = sanitizeAiResponseText\(completedText\)/);
  assert.match(chatRouteSource, /streamedText = sanitizeAiResponseText\(streamedText\)/);
});

test("report generation and saved report detail use AI response sanitization", () => {
  // sanitizeVisibleReportContent strips leaked prompt echoes/code
  // fences ahead of the shared sanitizer, so it now calls
  // sanitizeAiResponseText on that intermediate value rather than the
  // raw `content` param directly -- same sanitizer, same pipeline.
  assert.match(planRouteSource, /sanitizeAiResponseText\(withoutPromptEcho\)/);
  assert.match(marketRouteSource, /sanitizeAiResponseText\(value\)/);
  assert.match(plannerSource, /return sanitizeAiResponseText\(content\)/);
  assert.match(reportDetailSource, /sanitizeAiResponseText\(content\)/);
});
