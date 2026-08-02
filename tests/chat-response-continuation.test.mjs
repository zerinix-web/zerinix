import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addTokenUsage,
  CHAT_RESPONSE_CONTINUATION_INPUT,
  getContinuationMaxOutputTokens,
  MAX_CHAT_RESPONSE_CONTINUATIONS,
  shouldContinueResponse,
} from "../app/lib/ai/response-continuation.ts";

const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");

test("only output-token incomplete responses with an id are continued", () => {
  assert.equal(
    shouldContinueResponse({
      incompleteReason: "max_output_tokens",
      responseId: "resp_123",
      continuationCount: 0,
    }),
    true
  );
  assert.equal(
    shouldContinueResponse({
      incompleteReason: "max_tokens",
      responseId: "resp_123",
      continuationCount: 0,
    }),
    true
  );
  assert.equal(
    shouldContinueResponse({
      incompleteReason: "content_filter",
      responseId: "resp_123",
      continuationCount: 0,
    }),
    false
  );
  assert.equal(
    shouldContinueResponse({
      incompleteReason: "max_output_tokens",
      responseId: "",
      continuationCount: 0,
    }),
    false
  );
});

test("continuations are bounded and receive enough headroom to finish", () => {
  assert.equal(
    shouldContinueResponse({
      incompleteReason: "max_output_tokens",
      responseId: "resp_123",
      continuationCount: MAX_CHAT_RESPONSE_CONTINUATIONS,
    }),
    false
  );
  assert.equal(getContinuationMaxOutputTokens(900, 1), 1_800);
  assert.equal(getContinuationMaxOutputTokens(900, 2), 3_600);
  assert.equal(getContinuationMaxOutputTokens(3_200, 2), 8_000);
});

test("usage from the original and continuation responses is accumulated", () => {
  assert.deepEqual(
    addTokenUsage(
      { promptTokens: 100, completionTokens: 900, totalTokens: 1_000 },
      { promptTokens: 40, completionTokens: 300, totalTokens: 340 }
    ),
    { promptTokens: 140, completionTokens: 1_200, totalTokens: 1_340 }
  );
});

test("chat assembler continues by response id without resending research or report context", () => {
  assert.match(chatRoute, /previous_response_id: previousResponseId/);
  assert.match(chatRoute, /input: CHAT_RESPONSE_CONTINUATION_INPUT/);
  assert.match(chatRoute, /operationName: "advisor_continuation"/);
  assert.doesNotMatch(
    CHAT_RESPONSE_CONTINUATION_INPUT,
    /research|schema|report memory|uploaded/i
  );
  assert.match(chatRoute, /getResponseStatus\(completedResponse\) === "completed"/);
});
