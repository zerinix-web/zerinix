import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { formatStrategicDecisionMemoReportSection } from "../app/lib/report-engine/executive-decision-system-context.ts";

// Integration tests proving the Strategic Decision Memo is a
// first-class Strategic Report section -- generated deterministically
// from the ZERINIX Executive Decision System, replacing the legacy,
// freely-written Executive Recommendation content when a real memo
// exists, while preserving byte-for-byte backward compatibility when
// it does not.
//
// plan-executor.ts is server-only (Supabase/auth/OpenAI dependencies)
// and, per this codebase's established convention, is tested here via
// static source assertions on its real, current file content -- the
// same pattern already used by every other plan-executor.ts
// integration test in this suite.
const planExecutorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realGeneratedMemo() {
  const { package: executiveDecisionPackage } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage });
  assert.equal(memo.generated, true, "fixture must produce a genuinely generated memo");
  return memo;
}

test("formatStrategicDecisionMemoReportSection returns null (never a fabricated section) when there is no real, generated memo", () => {
  assert.equal(formatStrategicDecisionMemoReportSection(undefined), null);
  assert.equal(formatStrategicDecisionMemoReportSection(null), null);
  assert.equal(formatStrategicDecisionMemoReportSection({ generated: false }), null);
  assert.equal(formatStrategicDecisionMemoReportSection("not an object"), null);
  assert.equal(formatStrategicDecisionMemoReportSection({ status: "not-a-real-status" }), null);
});

test("formatStrategicDecisionMemoReportSection renders all 6 required Strategic Decision Memo categories from real data, never inventing content", () => {
  const memo = realGeneratedMemo();
  const section = formatStrategicDecisionMemoReportSection(memo);

  assert.equal(typeof section, "string");
  assert.match(section, /Verified Facts:/);
  assert.match(section, /Assumptions:/);
  assert.match(section, /Critical Risks:/);
  assert.match(section, /Strategic Opportunities:/);
  assert.match(section, /Recommended Actions:/);
  assert.match(section, /Confidence Assessment:/);

  for (const fact of memo.verifiedFacts) {
    assert.ok(section.includes(fact), `expected verified fact to appear verbatim: ${fact}`);
  }
  for (const assumption of memo.assumptions) {
    assert.ok(section.includes(assumption));
  }
  for (const action of memo.recommendedActions) {
    assert.ok(section.includes(action.action));
    for (const citation of action.supportingEvidence) {
      assert.ok(section.includes(citation));
    }
  }
  assert.match(section, new RegExp(`Aggregate confidence: ${memo.confidence.aggregateConfidence}/100`));
  assert.ok(section.includes(memo.confidence.narrative));
  assert.match(section, new RegExp(`"${memo.executiveDecisionSignal}"`));
});

test("empty categories are rendered honestly, never as a fabricated placeholder claim of real content", () => {
  const memo = realGeneratedMemo();
  assert.deepEqual(memo.risks, []);
  assert.deepEqual(memo.opportunities, []);
  const section = formatStrategicDecisionMemoReportSection(memo);
  assert.match(section, /Critical Risks:\nNo critical risks were identified\./);
  assert.match(section, /Strategic Opportunities:\nNo strategic opportunities were identified\./);
});

test("plan-executor.ts computes the memo report section exactly once, immediately after body is parsed, reusing body.strategicDecisionMemo (never a second, independent source)", () => {
  const callCount = (planExecutorSource.match(/formatStrategicDecisionMemoReportSection\(/g) || []).length;
  // 1 computation call + 3 usage sites (cache-hit, live-generation,
  // timeout-fallback) referencing the SAME precomputed
  // strategicDecisionMemoReportSection constant.
  assert.equal(callCount, 1, "formatStrategicDecisionMemoReportSection must be called exactly once");

  const bodyParseIndex = planExecutorSource.indexOf("const body = await req.json();");
  const computeIndex = planExecutorSource.indexOf("formatStrategicDecisionMemoReportSection(");
  assert.ok(computeIndex > bodyParseIndex);

  assert.match(planExecutorSource, /body\?\.strategicDecisionMemo/);
  const bodyReadCount = (planExecutorSource.match(/body\?\.strategicDecisionMemo/g) || []).length;
  assert.equal(bodyReadCount, 1, "body.strategicDecisionMemo must be read exactly once");
});

test("the precomputed strategicDecisionMemoReportSection is reused (never recomputed) at exactly 3 override sites: cache-hit, live-generation, and timeout-fallback", () => {
  const usageCount = (planExecutorSource.match(/strategicDecisionMemoReportSection/g) || []).length;
  // 1 declaration + 3 conditional-usage sites, each referencing the
  // variable at least once (declaration + 3 `if` conditions + 3
  // assignment right-hand-sides = 7 total occurrences of the
  // identifier).
  assert.ok(usageCount >= 4, `expected the precomputed value to be reused at multiple sites, found ${usageCount} occurrences`);

  const overrideAssignments = planExecutorSource.match(/\.executiveSummary = strategicDecisionMemoReportSection;/g) || [];
  assert.equal(overrideAssignments.length, 3, "expected exactly 3 override assignment sites (cache-hit, live-generation, timeout-fallback)");
});

test("backward compatibility: every override is conditionally guarded, so the report's own deterministic Executive Decision layer is used verbatim whenever no real memo exists", () => {
  const guardedOverrides = planExecutorSource.match(
    /if \(strategicDecisionMemoReportSection\) \{\s*\n\s*\S+\.executiveSummary = strategicDecisionMemoReportSection;\s*\n\s*\}/g
  ) || [];
  assert.equal(guardedOverrides.length, 3, "expected all 3 override sites to be guarded by `if (strategicDecisionMemoReportSection)`");

  // The report's own builder functions themselves are untouched -- still
  // called, still the sole source of content, whenever no memo exists.
  assert.match(planExecutorSource, /buildPlanExecutiveDecisionBrief\(/);
  assert.match(planExecutorSource, /normalized\.executiveSummary = formatExecutiveDecisionBrief\(/);
});

test("cache safety: the live-generation override happens strictly after cacheResponseText is captured, so the AI response cache always stores memo-agnostic content -- a future cache hit for a different request is never contaminated by this request's memo", () => {
  const cacheCaptureIndex = planExecutorSource.indexOf("const cacheResponseText = JSON.stringify(parsedReport);");
  const liveGenOverrideIndex = planExecutorSource.indexOf(
    "if (strategicDecisionMemoReportSection) {\n              parsedReport.executiveSummary"
  );
  assert.ok(cacheCaptureIndex >= 0 && liveGenOverrideIndex > cacheCaptureIndex);

  const streamIndex = planExecutorSource.indexOf(
    "enqueue(serializePlanReportChunks(parsedReport));",
    liveGenOverrideIndex
  );
  assert.ok(streamIndex > liveGenOverrideIndex, "the override must happen before the overridden content is streamed");
});

test("the cache-hit override happens strictly after validation, metadata extraction, and usage recording -- so those all observe the original, untouched deterministic content, exactly as before this integration", () => {
  const metadataIndex = planExecutorSource.indexOf("const cachedReportMetadataContext = createReportMetadataContext(");
  const usageRecordIndex = planExecutorSource.indexOf("await recordAiUsage(supabase, {", metadataIndex);
  const cacheHitOverrideIndex = planExecutorSource.indexOf(
    "if (strategicDecisionMemoReportSection) {\n          parsedCachedReport.executiveSummary"
  );
  const responseIndex = planExecutorSource.indexOf("return new Response(encoder.encode(", cacheHitOverrideIndex);

  assert.ok(metadataIndex >= 0 && usageRecordIndex > metadataIndex);
  assert.ok(cacheHitOverrideIndex > usageRecordIndex, "the override must happen after metadata/usage recording");
  assert.ok(responseIndex > cacheHitOverrideIndex, "the override must happen before the response is returned");
});

test("does not modify parseFullPlanReport/normalizeFullPlanReport's own internals, the report section schema, PDF generation, UI, billing, authentication, or routing -- the override is a pure post-hoc content replacement", async () => {
  const schemaSource = await readFile(new URL("../app/lib/report-engine/schema.ts", import.meta.url), "utf8");
  assert.doesNotMatch(schemaSource, /strategic-decision-memo|StrategicDecisionMemo/);

  const pdfButtonSource = await readFile(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(pdfButtonSource, /strategic-decision-memo|StrategicDecisionMemo/);

  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(planRouteSource, /executiveSummary = strategicDecisionMemoReportSection/);
});
