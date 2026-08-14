import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// market-analysis/route.ts imports "next/server" (NextResponse), which
// cannot be resolved outside Next's own build/dev process -- confirmed
// repeatedly this session. Its internal enforceMarketReportLanguage/
// cleanInternalMarketSourceFallbacks helpers are also not exported. This
// mirrors the established pattern elsewhere in this test suite (e.g.
// dynamic-research-plan.test.mjs) for asserting behavior in files that
// can't be imported directly: a static source-text check.
const routeSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);

test("cleanInternalMarketSourceFallbacks strips raw programmer-artifact placeholders report-wide, without touching ordinary words like Unknown/N/A/null-hypothesis", () => {
  assert.match(routeSource, /\.replace\(\/\\\[object Object\\\]\/gi, notVerifiedReplacement\)/);
  assert.match(routeSource, /\.replace\(\/\\bTBD\\b\/g, notVerifiedReplacement\)/);
  assert.match(routeSource, /\.replace\(\/\\bTODO\\b\/g, notVerifiedReplacement\)/);
  // Deliberately NOT present: a blind \bnull\b or \bUnknown\b/\bN\/A\b
  // replacement would corrupt legitimate prose (e.g. "null hypothesis").
  assert.doesNotMatch(routeSource, /\\bnull\\b\/gi, notVerifiedReplacement/);
});

test("enforceMarketReportLanguage's Turkish backstop dictionary covers the confirmed live leftover English fragments", () => {
  const turkishAdditions = [
    /\.replace\(\/\\bsupported estimate\\b\/gi, "desteklenen tahmin"\)/,
    /\.replace\(\/\\brequested market\\b\/gi, "talep edilen pazar"\)/,
    /\.replace\(\/\\bconfidence level\\b\/gi, "güven seviyesi"\)/,
    /\.replace\(\/\\bexecutive recommendation\\b\/gi, "yönetici tavsiyesi"\)/,
    /\.replace\(\/\\bmarket opportunity\\b\/gi, "pazar fırsatı"\)/,
    /\.replace\(\/\\bhowever\\b\/gi, "ancak"\)/,
    /\.replace\(\/\\bnot established\\b\/gi, "bağımsız olarak doğrulanmamış"\)/,
  ];
  for (const pattern of turkishAdditions) {
    assert.match(routeSource, pattern, `missing Turkish backstop: ${pattern}`);
  }
});

test("enforceMarketReportLanguage's English direction mirrors the same additions (bidirectional, matching the file's existing symmetric pattern)", () => {
  const englishAdditions = [
    /\.replace\(\/\\bdesteklenen tahmin\\b\/gi, "supported estimate"\)/,
    /\.replace\(\/\\btalep edilen pazar\\b\/gi, "requested market"\)/,
    /\.replace\(\/\\bgüven seviyesi\\b\/gi, "confidence level"\)/,
    /\.replace\(\/\\byönetici tavsiyesi\\b\/gi, "executive recommendation"\)/,
    /\.replace\(\/\\bpazar fırsatı\\b\/gi, "market opportunity"\)/,
    /\.replace\(\/\\bbağımsız olarak doğrulanmamış\\b\/gi, "not established"\)/,
  ];
  for (const pattern of englishAdditions) {
    assert.match(routeSource, pattern, `missing English mirror: ${pattern}`);
  }
});

test("the new backstop replacements land inside the existing Turkish/English branches of enforceMarketReportLanguage, not a new unrelated function", () => {
  const turkishBranchStart = routeSource.indexOf('if (language === "Turkish") {');
  const englishBranchStart = routeSource.indexOf(
    "return localizeDeterministicMarketText(normalized, language)"
  );
  const supportedEstimateIndex = routeSource.indexOf('"desteklenen tahmin"');
  const mirrorIndex = routeSource.indexOf('"supported estimate"', turkishBranchStart);

  assert.ok(turkishBranchStart > 0 && englishBranchStart > turkishBranchStart);
  assert.ok(
    supportedEstimateIndex > turkishBranchStart && supportedEstimateIndex < englishBranchStart,
    "Turkish-direction addition should sit inside the Turkish branch"
  );
  assert.ok(
    mirrorIndex > englishBranchStart,
    "English-direction mirror should sit inside the English branch"
  );
});
