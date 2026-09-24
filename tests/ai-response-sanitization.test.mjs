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
    assert.match(source, /import \{[\s\S]{0,80}sanitizeAiResponseText/);
    // Every streamed paint is sanitized before it reaches the UI. The Ask
    // workspace paints from a frame-batched buffer (latestOutput) rather
    // than from `output` directly, so the identifier is not pinned -- what
    // matters is that nothing unsanitized is ever handed to onChunk.
    // The Ask workspace additionally normalises confidence precision around
    // the sanitize call, so allow a wrapper -- what matters is that the
    // sanitizer is applied to the accumulated text before it is painted.
    assert.match(source, /onChunk\((?:\w+\()?sanitizeAiResponseText\(\w+\)\)?\)/);
    // The raw accumulators must never be painted directly; only a
    // sanitizeAiResponseText(...) call or an already-sanitized value.
    assert.doesNotMatch(
      source,
      /onChunk\((?:output|latestOutput)\)/,
      "raw streamed text must never be rendered"
    );
    assert.match(source, /const sanitizedOutput = (?:\w+\(\s*)?sanitizeAiResponseText\(output\)/);
    assert.match(source, /return sanitizedOutput/);
  }
});

test("API chat sanitizes cached, mock, and completed response text", () => {
  assert.match(chatRouteSource, /import \{[\s\S]{0,80}sanitizeAiResponseText/);
  // P0 FIX #8 (hardening pass) -- confirmed live: chat/route.ts dumps the
  // market intelligence graph as raw JSON into its own prompt just like
  // market-analysis/route.ts does, so it is exposed to the same internal-
  // identifier leak vector -- these 3 real-model-output call sites now
  // also route through stripInternalImplementationTokens
  // (report-output-sanitization.ts), the same shared generic sanitizer
  // market-analysis/route.ts uses. sanitizeAiResponseText itself is
  // unchanged and still called exactly as before, just wrapped.
  assert.match(chatRouteSource, /const sanitizedContent = stripInternalImplementationTokens\(sanitizeAiResponseText\(content\)\)/);
  assert.match(chatRouteSource, /sanitizeAiResponseText\(\[/);
  assert.match(
    chatRouteSource,
    /const sanitizedCompletedText = stripInternalImplementationTokens\(sanitizeAiResponseText\(completedText\)\)/
  );
  assert.match(
    chatRouteSource,
    /streamedText = stripInternalImplementationTokens\(sanitizeAiResponseText\(streamedText\)\)/
  );
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
