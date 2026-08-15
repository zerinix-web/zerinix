import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveCachedOrExecuteResearch } from "../app/lib/ai/research-cache-core.ts";

const planExecutor = readFileSync(
  "app/lib/report-jobs/plan-executor.ts",
  "utf8"
);
const marketRoute = readFileSync(
  "app/api/market-analysis/route.ts",
  "utf8"
);
const researchCache = readFileSync("app/lib/ai/research-cache.ts", "utf8");
const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");
const chatRequestConfig = readFileSync(
  "app/lib/ai/chat-request-config.ts",
  "utf8"
);

test("identical research is cached without a duplicate GPT research execution", async () => {
  let cached = null;
  let executions = 0;
  const generatedResearch = {
    summary: "Stable research summary",
    evidence: [
      {
        id: "R1",
        title: "Authoritative source",
        url: "https://example.gov/source",
      },
    ],
  };
  const resolve = () =>
    resolveCachedOrExecuteResearch({
      dedupeKey: "same-prompt:same-assets:business:English:business-plan",
      read: async () => cached,
      execute: async () => {
        executions += 1;
        return structuredClone(generatedResearch);
      },
      write: async (value) => {
        cached = structuredClone(value);
      },
    });

  const first = await resolve();
  const second = await resolve();

  assert.equal(first.source, "generated");
  assert.equal(second.source, "cache");
  assert.equal(executions, 1);
  assert.deepEqual(second.value, first.value);
  assert.deepEqual(second.value.evidence, generatedResearch.evidence);
});

test("concurrent identical reports share one in-flight research request", async () => {
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const input = () =>
    resolveCachedOrExecuteResearch({
      dedupeKey: "concurrent-identical-report",
      read: async () => null,
      execute: async () => {
        executions += 1;
        await gate;
        return { evidence: [{ id: "R1", url: "https://example.gov" }] };
      },
      write: async () => {},
    });

  const first = input();
  const second = input();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(executions, 1);
  assert.equal(firstResult.source, "generated");
  assert.equal(secondResult.source, "in_flight");
  assert.deepEqual(secondResult.value, firstResult.value);
});

test("research and report keys include every required reuse dimension", () => {
  for (const dimension of [
    "normalizedPrompt",
    "uploadedAssetHash",
    "analysisMode",
    "language",
    "reportFamily",
  ]) {
    assert.match(researchCache, new RegExp(dimension));
  }
  assert.match(researchCache, /createResearchResultCacheKey/);
  assert.match(researchCache, /createPreResearchReportCacheKey/);
});

test("every full-report family checks report cache before research execution", () => {
  const branches = [
    {
      name: "business",
      source: planExecutor,
      start: 'reportFamily: "business_plan"',
      end: "const existingAiCallCount",
    },
    {
      name: "real estate",
      source: planExecutor,
      start: 'reportFamily: "real_estate"',
      end: "const compressedResearch",
    },
    {
      name: "specialized",
      source: planExecutor,
      start: "reportFamily: `${domain}_decision_analysis`",
      end: "const input = dedupeExactPromptBlocks(`User goal:",
    },
    {
      name: "market",
      source: marketRoute,
      start: 'reportFamily: "market_analysis"',
      end: "const existingAiCallCount",
    },
  ];

  for (const branch of branches) {
    const start = branch.source.indexOf(branch.start);
    const end = branch.source.indexOf(branch.end, start);
    const content = branch.source.slice(start, end);
    const reportCacheRead = content.indexOf("getCachedAiResponse(");
    const researchResolution = content.indexOf("resolveDomainResearchWithCache(");

    assert.ok(start >= 0 && end > start, `${branch.name} branch was not found`);
    assert.ok(reportCacheRead >= 0, `${branch.name} report cache read was not found`);
    assert.ok(
      researchResolution > reportCacheRead,
      `${branch.name} research ran before its report cache read`
    );
  }
});

test("cached reports retain their exact output and research citation provenance", () => {
  assert.match(
    planExecutor,
    /responseText: cacheResponseText,\s*responseData: createReportCacheData\(businessResearch\)/
  );
  assert.match(
    planExecutor,
    /responseText: serializedReport,\s*responseData: createReportCacheData\(domainResearch\)/
  );
  assert.match(
    marketRoute,
    /responseText,\s*responseData: createReportCacheData\(\s*domainResearch,\s*marketIntelligenceGraph\s*\)/
  );
  assert.match(researchCache, /return isDomainResearchBundle\(research\) \? research : null/);
});

test("cache telemetry reports hits misses skipped calls tokens and USD", () => {
  for (const field of [
    "researchCacheHit",
    "skippedGptResearchCalls",
    "estimatedSavedTokens",
    "estimatedSavedUsd",
  ]) {
    assert.match(researchCache, new RegExp(field));
  }
  assert.match(researchCache, /\[research-cache\] hit/);
  assert.match(researchCache, /\[research-cache\] miss/);
});

test("chat web research is validated once and reused without a duplicate Responses web search", () => {
  assert.doesNotMatch(chatRoute, /attachments\.length === 0 &&\s*!input\.webResearch/);
  assert.match(chatRoute, /web:\$\{webResearch\}/);
  assert.match(chatRoute, /expiresInDays: webResearch \? 1 : 7/);
  assert.match(
    chatRoute,
    /createChatResponseCapabilities\(webResearch && !chatResearchContext\)/
  );
  assert.match(chatRoute, /storeConversationResearchSnapshot/);
  assert.match(chatRequestConfig, /type: "web_search_preview"/);
  assert.match(chatRequestConfig, /include: \["web_search_call\.action\.sources"/);
});

test("failed and evidence-free research is never persisted as reusable research", () => {
  assert.match(researchCache, /research\.researchAttempted/);
  assert.match(researchCache, /!research\.fallbackUsed/);
  assert.match(researchCache, /research\.evidence\.length > 0/);
  assert.match(researchCache, /skipped non-reusable result/);
});

test("freshness-sensitive topics use a shorter research cache lifetime", () => {
  assert.match(researchCache, /latest\|current\|today\|recent\|news/);
  assert.match(researchCache, /expiresInDays: getResearchCacheTtlDays/);
});
