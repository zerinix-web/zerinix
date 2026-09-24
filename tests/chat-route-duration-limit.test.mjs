import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatRoute = read("app/api/chat/route.ts");
const workspace = read("components/AIChatWorkspace.tsx");

// Every API route in the app.
function findRoutes(dir = "app/api") {
  const entries = readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? findRoutes(`${dir}/${entry.name}`)
      : entry.name === "route.ts"
        ? [`${dir}/${entry.name}`]
        : []
  );
}

const declaredDuration = (source) => {
  const match = /export const maxDuration = (\d+)/.exec(source);
  return match ? Number(match[1]) : null;
};

test("every route that STREAMS a model response declares an execution ceiling", () => {
  // THE BUG. A route with no maxDuration gets the platform default, which is
  // far below what a streaming advisory answer needs, so Vercel terminated the
  // function while the answer was still being written. /api/chat was the only
  // streaming model route in the app without one -- app/api/plan and
  // app/api/market-analysis have declared 300 all along.
  const streamingModelRoutes = findRoutes().filter((path) => {
    const source = read(path);
    return /stream: true/.test(source) && /responses\.create|chat\.completions\.create/.test(source);
  });

  assert.ok(streamingModelRoutes.length > 0, "the scan must actually find routes");
  assert.ok(streamingModelRoutes.includes("app/api/chat/route.ts"), "/api/chat must be in scope");

  for (const path of streamingModelRoutes) {
    const duration = declaredDuration(read(path));
    assert.ok(
      duration !== null,
      `${path} streams a model response and must declare maxDuration, or the platform will cut it off mid-answer`
    );
    assert.ok(duration >= 60, `${path} declares maxDuration ${duration}s, too low for a streamed answer`);
  }
});

test("the ceiling covers a whole turn, not just one model call", () => {
  // One Ask turn is not one model call: a response that stops on
  // max_output_tokens is continued up to MAX_CHAT_RESPONSE_CONTINUATIONS more
  // times, so a single answer can be five sequential calls, each paying its own
  // time to first token -- on top of pre-model work and optional web research.
  // A measured SUCCESSFUL request was already 14.67s end to end.
  const continuationLimit = /MAX_CHAT_RESPONSE_CONTINUATIONS = (\d+)/.exec(
    read("app/lib/ai/response-continuation.ts")
  );
  assert.ok(continuationLimit, "the continuation limit must be discoverable");

  const calls = Number(continuationLimit[1]) + 1;
  const duration = declaredDuration(chatRoute);
  assert.ok(
    duration >= calls * 20,
    `maxDuration ${duration}s is too low for up to ${calls} sequential model calls`
  );
  // Matches the convention every other AI route in this app already follows.
  assert.equal(duration, 300);
});

test("the ceiling does not mask genuine failures", () => {
  // The server ceiling must stay ABOVE the client's own limits, so a hung
  // request is still surfaced to the user by the client rather than being held
  // open by the platform -- and those client limits must not have been raised
  // to paper over the real problem.
  const idle = Number(/CHAT_STREAM_IDLE_TIMEOUT_MS = (\d+)_000/.exec(workspace)[1]);
  const request = Number(/CHAT_REQUEST_TIMEOUT_MS = (\d+)_000/.exec(workspace)[1]);

  assert.equal(idle, 60, "the no-chunk timeout must stay at 60s");
  assert.equal(request, 75, "the overall request timeout must stay at 75s");
  assert.ok(request < declaredDuration(chatRoute), "the client must give up before the platform does");
});

test("the fix changes nothing about quality, grounding or the model", () => {
  // maxDuration is a ceiling only: no model change, no research gating, no
  // shorter answers, no weaker auth.
  assert.doesNotMatch(chatRoute, /webResearch = [^;]*modelPreference/);
  assert.match(chatRoute, /await supabase\.auth\.getUser\(\)/);
  // The budget still derives from requestKind; Balanced scales that base by
  // ~1.5x and Fast leaves it exactly as it was.
  assert.match(
    chatRoute,
    /applyChatOutputBudgetPreference\(\s*getChatMaxOutputTokens\(requestKind\),\s*modelPreference\s*\)/
  );
  assert.match(read("app/lib/ai/response-continuation.ts"), /MAX_CHAT_RESPONSE_CONTINUATIONS = 4/);
});
