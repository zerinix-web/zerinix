import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyzeOpenAiRequestInput,
  compactConversationHistory,
  compactReportFieldPrompt,
  dedupeExactPromptBlocks,
  omitTrailingDuplicateUserPrompt,
} from "../app/lib/ai/token-optimization-core.ts";

const costInstrumentation = readFileSync(
  "app/lib/ai/cost-instrumentation.ts",
  "utf8"
);

const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");
const analysisAssets = readFileSync("app/lib/ai/analysis-assets.ts", "utf8");
const tokenOptimization = readFileSync(
  "app/lib/ai/token-optimization.ts",
  "utf8"
);
const domainResearch = readFileSync("app/lib/ai/domain-research.ts", "utf8");
const mobileChatHome = readFileSync(
  "components/mobile/MobileChatHome.tsx",
  "utf8"
);
const aiChatWorkspace = readFileSync("components/AIChatWorkspace.tsx", "utf8");
const planner = readFileSync("components/Planner.tsx", "utf8");

test("older conversation turns become compact memory while the last ten remain intact", () => {
  const older = [
    { role: "user", content: "My goal is to validate an accounting SaaS for small businesses." },
    { role: "assistant", content: "The uploaded finance-model.xlsx is the primary evidence file." },
    { role: "user", content: "Use Market Intelligence as the selected analysis type." },
    { role: "assistant", content: "Decision: prioritize Turkish accountants before expanding." },
  ];
  const recent = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Recent message ${index + 1}`,
  }));
  const compacted = compactConversationHistory([...older, ...recent]);

  assert.equal(compacted.summarizedMessageCount, 4);
  assert.equal(compacted.recentMessageCount, 10);
  assert.equal(compacted.messages.length, 11);
  assert.deepEqual(compacted.messages.slice(1), recent);
  assert.match(compacted.summary, /accounting SaaS/);
  assert.match(compacted.summary, /finance-model\.xlsx/);
  assert.match(compacted.summary, /Market Intelligence/);
  assert.match(compacted.summary, /prioritize Turkish accountants/);
});

test("conversation memory is extractive, bounded, and materially smaller than old history", () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index === 0 ? "My goal is to build a logistics marketplace. " : ""}${"Operational discussion without a new durable decision. ".repeat(30)}`,
  }));
  const beforeChars = messages.reduce((total, message) => total + message.content.length, 0);
  const compacted = compactConversationHistory(messages, {
    recentMessageCount: 10,
    maxSummaryChars: 1_200,
  });
  const afterChars = compacted.messages.reduce(
    (total, message) => total + message.content.length,
    0
  );

  assert.ok(compacted.summary.length <= 1_200);
  assert.ok(compacted.messages.length <= 11);
  assert.ok(afterChars < beforeChars * 0.6);
  assert.match(compacted.summary, /logistics marketplace/);
});

test("conversation memory retains boundary context when the language has no keyword matcher", () => {
  const older = [
    { role: "user", content: "Ich entwickle eine Lösung für lokale Hersteller." },
    { role: "assistant", content: "Wir haben zunächst den regionalen Vertrieb besprochen." },
    { role: "user", content: "Die zuletzt vereinbarte Richtung gilt weiterhin." },
  ];
  const recent = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Aktuelle Nachricht ${index + 1}`,
  }));
  const compacted = compactConversationHistory([...older, ...recent]);

  assert.match(compacted.summary, /lokale Hersteller/);
  assert.match(compacted.summary, /zuletzt vereinbarte Richtung/);
  assert.match(compacted.summary, /regionalen Vertrieb/);
});

test("all chat clients submit available history for centralized server compaction", () => {
  assert.doesNotMatch(mobileChatHome, /contextualMemoryMessages/);
  assert.doesNotMatch(
    aiChatWorkspace,
    /const memoryMessages = currentMessages[\s\S]{0,400}\.slice\(-8\)/
  );
  assert.doesNotMatch(
    planner,
    /const memoryMessages = currentMessages[\s\S]{0,500}\.slice\(-12\)/
  );
  assert.doesNotMatch(
    chatRoute,
    /function normalizeMessages[\s\S]{0,900}\.slice\(-10\)/
  );
  assert.match(tokenOptimization, /compactConversationHistory\(messages/);
  assert.match(aiChatWorkspace, /Uploaded files referenced in this message/);
  assert.match(aiChatWorkspace, /Selected analysis type/);
  assert.match(planner, /Uploaded files referenced in this message/);
  assert.match(planner, /Selected analysis type/);
});

test("exact duplicate prompt blocks are removed without changing unique report content", () => {
  const evidence = "Completed research:\n[R1] Market size — https://example.gov/data";
  const schema = "Report schema:\n- summary\n- sources";
  const before = `Business context\n\n${evidence}\n\n${schema}\n\n${evidence}`;
  const after = dedupeExactPromptBlocks(before);

  assert.equal(after, `Business context\n\n${evidence}\n\n${schema}`);
  assert.match(after, /\[R1\]/);
  assert.match(after, /https:\/\/example\.gov\/data/);
  assert.match(after, /summary[\s\S]*sources/);
});

test("full-report field compaction removes only centralized ownership repetition", () => {
  const before = "Explain pricing value, packaging, and validation tests. Do not repeat revenue model, unit economics, or GTM channels. Use supported evidence. Max 145 words.";
  const after = compactReportFieldPrompt(before);
  assert.equal(
    after,
    "Explain pricing value, packaging, and validation tests. Use supported evidence. Max 145 words."
  );
});

test("the current user prompt is not resent when already present in history", () => {
  const history = [
    { role: "user", content: "I run an accounting SaaS." },
    { role: "assistant", content: "How can I help?" },
    { role: "user", content: "How should I price it?" },
  ];
  const optimized = omitTrailingDuplicateUserPrompt(
    history,
    "How should I price it?"
  );

  assert.deepEqual(optimized, history.slice(0, -1));
  assert.deepEqual(
    omitTrailingDuplicateUserPrompt(history, "Estimate market size"),
    history
  );
});

test("all shared asset-backed OpenAI inputs receive lossless prompt compaction", () => {
  assert.match(analysisAssets, /const compactPrompt = dedupeExactPromptBlocks\(prompt\)/);
  assert.match(analysisAssets, /text: compactPrompt/);
  assert.match(chatRoute, /omitTrailingDuplicateUserPrompt\([\s\S]*messages,[\s\S]*prompt/);
});

test("input optimization records before after tokens and estimated USD savings", () => {
  for (const field of [
    "estimated_input_tokens_before",
    "estimated_input_tokens_after",
    "estimated_input_token_savings",
    "estimated_input_cost_savings_usd",
    "input_reduction_target_met",
  ]) {
    assert.match(tokenOptimization, new RegExp(field));
  }
  assert.match(chatRoute, /estimatedInputCostSavingsUsd/);
});

test("the repository OpenAI call inventory remains explicit and bounded", () => {
  const files = [
    "app/api/market-analysis/route.ts",
    "app/api/understanding/route.ts",
    "app/admin/actions.ts",
    "app/api/chat/route.ts",
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/ai/domain-research.ts",
    "app/lib/ai/research-entity-extraction.ts",
  ];
  const callCount = files.reduce((count, file) => {
    const source = readFileSync(file, "utf8");
    return count + (source.match(/\.responses\.create\(/g) || []).length;
  }, 0);

  // 12th call: plan-executor.ts's resolveConcreteBusinessIdeaForPlan --
  // a small, schema-constrained pre-step that generates one concrete
  // business idea when the user's own prompt doesn't describe one (either
  // they explicitly asked the system to propose idea(s), or the request is
  // too vague to analyze as a specific business). Everything downstream
  // (financial model, competitor research, report writing) reads its
  // output the same way it reads a user-submitted business description.
  // 13th call: plan-executor.ts's generateAcquisitionDueDiligenceReport,
  // the Acquisition Due Diligence report's own dedicated generator
  // (mirrors generateSpecializedDomainReport/generateRealEstateInvestmentReport,
  // one call each, already counted above).
  assert.equal(callCount, 13);
});

test("every instrumented OpenAI request logs safe estimated and actual input tokens", () => {
  const audit = analyzeOpenAiRequestInput({
    instructions: "Use the supplied evidence only.",
    input: "Context block\n\nRepeated evidence block with a sufficiently long verified claim.\n\nRepeated evidence block with a sufficiently long verified claim.",
    text: { format: { type: "json_schema", name: "report", schema: { type: "object" } } },
  });

  assert.ok(audit.estimatedInputTokens > 0);
  assert.ok(audit.estimatedInstructionTokens > 0);
  assert.ok(audit.estimatedContextTokens > 0);
  assert.ok(audit.estimatedSchemaTokens > 0);
  assert.equal(audit.duplicateBlockCount, 1);
  assert.ok(audit.estimatedDuplicateTokens > 0);
  assert.match(costInstrumentation, /\[openai-input\] preflight/);
  assert.match(costInstrumentation, /\[openai-input\] actual/);
  assert.doesNotMatch(costInstrumentation, /promptText:\s|requestBody:\s/);
});

test("report-context compaction retains the closed evidence registry and citation provenance", () => {
  assert.match(domainResearch, /formatDomainResearchForReportGeneration/);
  assert.match(
    domainResearch,
    /formatValidatedEvidenceForReportContext\(bundle\.validatedEvidence\)/
  );
  assert.match(domainResearch, /Cite its exact evidence IDs\/URLs, preserve provenance/);
  assert.match(domainResearch, /<untrusted_research_evidence>/);
});
