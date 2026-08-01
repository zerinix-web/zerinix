import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const chatRouteSource = await readFile(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

test("Advisor workspace does not render developer context or execution panels", () => {
  for (const label of [
    "Conversation Context",
    "Current session",
    "Recent Outputs",
    "LIVE AI WORKFLOW",
    "Overall Progress",
    "Preparing report engine",
  ]) {
    assert.doesNotMatch(plannerSource, new RegExp(label, "i"));
  }
  assert.doesNotMatch(plannerSource, />\s*Analysis type\s*</i);
  assert.doesNotMatch(plannerSource, /<WorkflowPanel|showDesktopAdvisorPanels/);
});

test("report modes remain report-oriented while Strategic Advisory remains conversational", () => {
  assert.match(
    plannerSource,
    /if \(selectedMode === "chat"\)[\s\S]*sendChatMessage/
  );
  assert.match(
    plannerSource,
    /createDirectReportReadiness\(understanding\)[\s\S]*generatePlan\([\s\S]*selectedMode/
  );
  assert.match(
    chatRouteSource,
    /This is a direct Strategic Advisory submission\.[\s\S]*conversation-oriented/
  );
});

test("Strategic Advisory uses a concise executive-consultant answer contract", () => {
  assert.match(chatRouteSource, /Lead with one concise recommendation paragraph/);
  assert.match(chatRouteSource, /3–5 key reasons/);
  assert.match(chatRouteSource, /Key risks and Immediate next actions/);
  assert.match(chatRouteSource, /avoid a long essay unless the user explicitly requests a detailed report/);
  assert.match(chatRouteSource, /Do not end with follow-up questions/);
});

test("routing and planner metadata is removed from streamed user output", () => {
  const sanitized = sanitizeAiResponseText([
    "Proceed with a limited pilot.",
    "Classified user intent: Startup",
    "Selected expert: Startup Mentor",
    "Internal asset identifier: asset_internal_42",
    "Execution metadata: stage=researching",
    "Conversation Context",
    "Planner/debug metadata: internal",
  ].join("\n"));

  assert.equal(sanitized, "Proceed with a limited pilot.");
});
