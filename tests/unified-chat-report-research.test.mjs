import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatRoute = readFileSync("app/api/chat/route.ts", "utf8");
const researchCache = readFileSync("app/lib/ai/research-cache.ts", "utf8");
const marketRoute = readFileSync("app/api/market-analysis/route.ts", "utf8");
const planExecutor = readFileSync(
  "app/lib/report-jobs/plan-executor.ts",
  "utf8"
);
const governance = readFileSync("app/lib/ai/governance.ts", "utf8");

test("chat creates one validated research bundle and answers from that bundle", () => {
  assert.match(chatRoute, /resolveDomainResearchWithCache\(\{/);
  assert.match(chatRoute, /formatDomainResearchForReportGeneration\(/);
  assert.match(chatRoute, /storeConversationResearchSnapshot\(\{/);
  assert.match(
    chatRoute,
    /createChatResponseCapabilities\(webResearch && !chatResearchContext\)/
  );
  assert.match(chatRoute, /directChatWebSearchSkipped: Boolean\(chatResearchContext\)/);
});

test("conversation snapshots are server-owned and never globally shared", () => {
  assert.match(researchCache, /allowGlobalSharing: false/);
  assert.match(
    governance,
    /options\.allowGlobalSharing !== false && shouldAllowGlobalAiCacheSharing\(\)/
  );
  assert.match(
    governance,
    /input\.allowGlobalSharing !== false && shouldAllowGlobalAiCacheSharing\(\)/
  );
  assert.doesNotMatch(chatRoute, /body\?\.research|body\?\.evidence/);
});

test("report research resolution checks the conversation snapshot before executing research", () => {
  const resolverStart = researchCache.indexOf(
    "export async function resolveDomainResearchWithCache"
  );
  const resolver = researchCache.slice(resolverStart);
  assert.ok(resolverStart >= 0);
  assert.ok(
    resolver.indexOf("getConversationResearchSnapshot") <
      resolver.indexOf("resolveCachedOrExecuteResearch")
  );
  assert.match(resolver, /source: "conversation_snapshot" as const/);
  assert.match(resolver, /skippedGptResearchCalls: true/);
});

test("every full report branch passes conversation identity into research resolution", () => {
  assert.match(
    marketRoute,
    /resolveDomainResearchWithCache\(\{[\s\S]*?conversationId:[\s\S]*?execute:/
  );
  const reportResolutions = [
    ...planExecutor.matchAll(/resolveDomainResearchWithCache\(\{([\s\S]*?)\n\s*execute:/g),
  ];
  assert.ok(reportResolutions.length >= 3);
  for (const resolution of reportResolutions) {
    assert.match(resolution[1], /conversationId/);
  }
});

test("report cache and executive metrics are derived from the exact research snapshot", () => {
  assert.match(marketRoute, /createResearchBundleFingerprint\(conversationResearch\.research\)/);
  assert.match(planExecutor, /createResearchBundleFingerprint\(conversationResearch\.research\)/);
  assert.match(
    marketRoute,
    /applyMarketResearchCoverageToContext\(\s*canonicalFinancialAssumptions,\s*domainResearch,\s*promptText/
  );
  assert.match(
    planExecutor,
    /const unifiedFinancialContext = applyMarketResearchCoverageToContext\(\s*canonicalFinancialAssumptions,\s*businessResearch,\s*promptText/
  );
  assert.match(planExecutor, /validatedEvidence: businessResearch\.validatedEvidence/);
  assert.match(chatRoute, /marketIntelligenceGraph: chatMarketGraph/);
  assert.match(
    marketRoute,
    /const marketIntelligenceGraph =\s*conversationResearch\?\.marketIntelligenceGraph \|\|/
  );
  assert.match(
    marketRoute,
    /applyMarketResearchCoverageToContext\(\s*canonicalFinancialAssumptions,\s*domainResearch,\s*promptText,\s*marketIntelligenceGraph\.coverage/
  );
});

test("PDF remains downstream of persisted report content and does not start research", () => {
  const pdfFiles = [
    "app/api/usage/pdf-export/route.ts",
    "app/lib/pdf-engine/core.ts",
  ];

  for (const path of pdfFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /runDomainAwareResearch|resolveDomainResearchWithCache/);
  }
});
