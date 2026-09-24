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

test("simple no-search requests stay on the low-cost route", () => {
  // Fast's floor moved from "minimal" to "low" when the two modes were made
  // genuinely different: "minimal" is no longer used anywhere, so the
  // web-search compatibility hazard it created cannot recur at all.
  const capabilities = createChatResponseCapabilities(false);

  assert.deepEqual(capabilities, {
    reasoning: { effort: "low" },
  });
  assert.equal("tools" in capabilities, false);
  // Model routing is untouched by the preference work.
  assert.match(modelRouter, /chat: "FAST"/);
  assert.match(modelRouter, /FAST: "gpt-5-nano"/);
});

test("Strategic Advisory with web search passes the provider compatibility gate", () => {
  assert.equal(mockResponsesApiStatus(true), 200);
  assert.match(
    chatRoute,
    /createChatResponseCapabilities\(\s*webResearch && !chatResearchContext,\s*modelPreference\s*\)/
  );
  assert.match(chatRoute, /storeConversationResearchSnapshot/);
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
