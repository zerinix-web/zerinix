import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("components/AIChatWorkspace.tsx");
const route = read("app/api/chat/route.ts");

const readLoop = chat.slice(
  chat.indexOf("async function readStreamingText"),
  chat.indexOf("async function sendMessage")
);

test("streaming repaints are coalesced to one per frame, not one per chunk", () => {
  // Painting every chunk was quadratic: sanitizeAiResponseText rescans the
  // whole accumulated answer and the React update re-parses the entire
  // markdown message, both growing with the reply. A long answer paid that
  // hundreds of times, each more expensive than the last.
  assert.match(readLoop, /requestAnimationFrame\(paint\)/);
  assert.match(readLoop, /cancelAnimationFrame/);

  // The expensive call must NOT sit directly in the read loop any more.
  const loopBody = readLoop.slice(readLoop.indexOf("while (true)"));
  assert.doesNotMatch(
    loopBody,
    /onChunk\(sanitizeAiResponseText\(output\)\)/,
    "the per-chunk full-text sanitize + setState is the regression"
  );
  // Exactly one scheduled paint can be outstanding.
  assert.match(readLoop, /if \(paintHandle === null\) \{\s*paintHandle = requestAnimationFrame/);
});

test("batching never delays or loses the final answer", () => {
  // A pending frame is cancelled and the exact final text flushed, so the
  // completed message is never a frame-stale copy.
  assert.match(readLoop, /cancelPendingPaint\(\);\s*output \+= decoder\.decode\(\);/);
  assert.match(readLoop, /const sanitizedOutput = sanitizeAiResponseText\(output\);\s*onChunk\(sanitizedOutput\);/);
  // Stream errors still abort immediately, per chunk, before any paint.
  assert.match(readLoop, /if \(streamError !== null\) \{\s*cancelPendingPaint\(\);\s*throw new Error\(streamError\)/);
});

test("non-browser runtimes keep the original synchronous behaviour", () => {
  // No rAF (tests, SSR, older runtimes) means paint immediately -- the batching
  // is an optimisation, never a correctness dependency.
  assert.match(readLoop, /typeof requestAnimationFrame === "function"/);
  assert.match(readLoop, /if \(!canSchedulePaint\) \{\s*paint\(\);/);
});

test("Ask shows exactly one waiting state, and Stop stays reachable", () => {
  const stopAt = chat.indexOf("onClick={stopGeneration}");
  const composer = chat.slice(stopAt - 400, stopAt + 1800);

  // The answer card is the single progress indicator.
  assert.match(chat, /\{message\.regenerating\s*\? "Regenerating"\s*: message\.content\s*\? "Generating"\s*: "Thinking"\}/);
  // The composer no longer spins a second time for the same event.
  // (Comments explain the removal, so they name the old label.)
  const chatCode = chat.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(chatCode, /Advising\.\.\./);
  assert.doesNotMatch(composer, /loading \? <Loader2/);

  // Stop replaces send while streaming: one button, always meaningful.
  assert.match(composer, /onClick=\{stopGeneration\}/);
  assert.match(composer, /Stop/);
  assert.match(composer, /Ask advisor/);
  assert.match(chat, /\{loading \? \(\s*<button[\s\S]{0,400}?stopGeneration[\s\S]*?\) : \(/);
  // The send button's own guards survive; `loading` is no longer one of them
  // because it is not rendered while loading.
  assert.match(composer, /!prompt\.trim\(\)/);
  assert.match(composer, /attachments\.some\(\(attachment\) => attachment\.status !== "ready"\)/);
});

test("the research snapshot no longer blocks the first token", () => {
  // It is a snapshot of context the model already has; nothing in this request
  // reads it back, so awaiting it before the model call only cost a database
  // round trip of first-token latency.
  assert.match(route, /import \{ NextResponse, after \} from "next\/server";/);
  assert.match(route, /after\(async \(\) => \{[\s\S]*?storeConversationResearchSnapshot\(researchSnapshot\)/);

  // ...and it must still actually run, with its failure logged, not swallowed.
  assert.match(route, /logServerError\("chat:research_snapshot", snapshotError\)/);

  // No blocking await may come back.
  const beforeModel = route.slice(0, route.indexOf('mark("prep")'));
  assert.doesNotMatch(
    beforeModel,
    /await storeConversationResearchSnapshot\(\{/,
    "the snapshot write must not be awaited on the critical path"
  );
});

test("the server reports its own share of first-token latency", () => {
  // Cumulative marks, emitted as Server-Timing on the streamed response, so
  // the pre-model cost can be read from a device Network tab rather than
  // inferred. Measurement only: nothing branches on these.
  for (const phase of ["auth", "profile", "memory", "prep"]) {
    assert.match(route, new RegExp(`mark\\("${phase}"\\)`), `${phase} must be marked`);
  }
  assert.match(route, /"Server-Timing": Object\.entries\(timings\)/);
  assert.match(route, /`\$\{phase\};dur=\$\{duration\}`/);

  // The anti-buffering headers that make progressive delivery possible stay.
  assert.match(route, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(route, /"X-Accel-Buffering": "no"/);
});
