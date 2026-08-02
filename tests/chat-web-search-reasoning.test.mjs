import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createChatResponseCapabilities } from "../app/lib/ai/chat-request-config.ts";

const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");
const modelRouter = readFileSync("app/lib/ai/model-router.ts", "utf8");

function mockResponsesApiStatus(webSearch) {
  const capabilities = createChatResponseCapabilities(webSearch);
  const hasWebSearch = "tools" in capabilities && capabilities.tools.some(
    (tool) => tool.type === "web_search_preview"
  );

  return hasWebSearch && capabilities.reasoning.effort === "minimal" ? 500 : 200;
}

test("web_search requests never use minimal reasoning", () => {
  const capabilities = createChatResponseCapabilities(true);

  assert.equal(capabilities.reasoning.effort, "low");
  assert.ok("tools" in capabilities);
  assert.deepEqual(capabilities.tools, [
    {
      type: "web_search_preview",
      search_context_size: "low",
    },
  ]);
  assert.deepEqual(capabilities.include, ["web_search_call.action.sources"]);
});

test("simple no-search requests retain the low-cost minimal reasoning route", () => {
  const capabilities = createChatResponseCapabilities(false);

  assert.deepEqual(capabilities, {
    reasoning: { effort: "minimal" },
  });
  assert.equal("tools" in capabilities, false);
  assert.match(modelRouter, /chat: "FAST"/);
  assert.match(modelRouter, /FAST: "gpt-5-nano"/);
});

test("Strategic Advisory with web search passes the provider compatibility gate", () => {
  assert.equal(mockResponsesApiStatus(true), 200);
  assert.match(chatRoute, /createChatResponseCapabilities\(webResearch\)/);
  assert.match(chatRoute, /reportType: "strategic_advisory"/);
});

test("api chat request construction cannot reproduce the invalid 500 scenario", () => {
  for (const webSearch of [false, true]) {
    assert.equal(mockResponsesApiStatus(webSearch), 200);
  }

  assert.doesNotMatch(
    chatRoute,
    /reasoning:\s*\{\s*effort:\s*"minimal"\s*\}[\s\S]{0,500}type:\s*"web_search_preview"/
  );
});
