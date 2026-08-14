import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// market-analysis/route.ts imports "next/server" and cannot be imported
// directly outside Next's own build/dev process (confirmed repeatedly
// this session) -- mirrors the established static-source-text pattern
// used elsewhere in this suite (e.g. dynamic-research-plan.test.mjs) for
// asserting behavior in files that can't be imported.
const routeSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);

test("enforceInlineRawUrlLimitAcrossSections is imported from the shared report-engine module, not reimplemented locally", () => {
  assert.match(
    routeSource,
    /import \{ enforceInlineRawUrlLimitAcrossSections \} from "@\/app\/lib\/report-engine\/inline-source-url-limit";/
  );
});

test("the inline-URL fix runs on `deduped`, after degradation, before assertReportIsolation and the final quality gate", () => {
  const wiringIndex = routeSource.indexOf("enforceInlineRawUrlLimitAcrossSections({");
  const isolationIndex = routeSource.indexOf('assertReportIsolation("market_intelligence", deduped);');
  const finalGateIndex = routeSource.indexOf("assertExecutiveQualityGate({");
  const degradationIndex = routeSource.indexOf("createInsufficientEvidenceFallback(field, language, coverage, graph)");

  assert.ok(wiringIndex > 0, "call site not found");
  assert.ok(degradationIndex > 0 && degradationIndex < wiringIndex, "must run after degradation");
  assert.ok(wiringIndex < isolationIndex, "must run before assertReportIsolation");
  assert.ok(isolationIndex < finalGateIndex, "assertReportIsolation must precede the final gate");
});

test("the fix is wired with sourceFields: [\"sources\"] and maxInlineUrls: 1, matching runExecutiveQualityGate's own convention", () => {
  const wiringBlock = routeSource.slice(
    routeSource.indexOf("enforceInlineRawUrlLimitAcrossSections({"),
    routeSource.indexOf("enforceInlineRawUrlLimitAcrossSections({") + 300
  );
  assert.match(wiringBlock, /sourceFields:\s*\["sources"\]/);
  assert.match(wiringBlock, /maxInlineUrls:\s*1/);
  assert.match(wiringBlock, /knownSources:\s*graph\?\.sources/);
  assert.match(wiringBlock, /sections:\s*deduped/);
});
