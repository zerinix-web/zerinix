import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSourceLookupByUrl,
  enforceInlineRawUrlLimit,
  enforceInlineRawUrlLimitAcrossSections,
} from "../app/lib/report-engine/inline-source-url-limit.ts";

function countRawUrls(content) {
  return (content.match(/https?:\/\/\S+/g) || []).length;
}

test("content within the inline-URL limit is left untouched", () => {
  const content = "CrowdStrike leads the segment (https://crowdstrike.com/reports/2026).";
  const { content: result, extraSourceLines } = enforceInlineRawUrlLimit(content, 1, new Map());
  assert.equal(result, content);
  assert.deepEqual(extraSourceLines, []);
});

test("a known URL beyond the limit is rewritten to its evidence-ID bracket, not dropped or left raw", () => {
  const content =
    "CrowdStrike leads with Falcon (https://crowdstrike.com/falcon). SentinelOne follows (https://sentinelone.com/singularity). Palo Alto rounds out the field (https://paloaltonetworks.com/cortex).";
  const lookup = buildSourceLookupByUrl([
    { url: "https://sentinelone.com/singularity", evidenceId: "R7", title: "SentinelOne Singularity overview", publisher: "SentinelOne" },
    { url: "https://paloaltonetworks.com/cortex", evidenceId: "R12", title: "Cortex XDR product page", publisher: "Palo Alto Networks" },
  ]);

  const { content: result, extraSourceLines } = enforceInlineRawUrlLimit(content, 1, lookup);

  assert.equal(countRawUrls(result), 1, "only the first URL should remain raw");
  assert.match(result, /https:\/\/crowdstrike\.com\/falcon/);
  assert.match(result, /\[R7\]/);
  assert.match(result, /\[R12\]/);
  assert.doesNotMatch(result, /sentinelone\.com\/singularity/);
  assert.doesNotMatch(result, /paloaltonetworks\.com\/cortex/);
  // Known URLs resolve via lookup -- nothing new needs to be appended to Sources.
  assert.deepEqual(extraSourceLines, []);
  // The substantive competitor analysis text is preserved verbatim.
  assert.match(result, /CrowdStrike leads with Falcon/);
  assert.match(result, /SentinelOne follows/);
  assert.match(result, /Palo Alto rounds out the field/);
});

test("an unknown URL beyond the limit is replaced with a marker and gets an honest, non-fabricated reference line (hostname only)", () => {
  const content =
    "Vendor A is notable (https://vendor-a.example.com/page). Vendor B is also notable (https://vendor-b.example.io/about).";
  const { content: result, extraSourceLines } = enforceInlineRawUrlLimit(content, 1, new Map());

  assert.equal(countRawUrls(result), 1);
  assert.match(result, /\[R-extra-2\]/);
  assert.equal(extraSourceLines.length, 1);
  assert.match(extraSourceLines[0], /vendor-b\.example\.io/);
  // Never a raw URL in the appended reference line -- it must not be able
  // to trip the same no_long_source_lists check on the Sources field.
  assert.equal(countRawUrls(extraSourceLines[0]), 0);
  assert.doesNotMatch(extraSourceLines[0], /https?:\/\//);
});

test("enforceInlineRawUrlLimitAcrossSections skips the designated source field and folds extracted references into it", () => {
  const sections = {
    competitiveLandscape:
      "Alpha Corp (https://alpha.example.com/a). Beta Inc (https://beta.example.com/b). Gamma LLC (https://gamma.example.com/c).",
    sources: "- [R1] Existing Source | Publisher: Example Wire",
  };

  const result = enforceInlineRawUrlLimitAcrossSections({
    sections,
    sourceFields: ["sources"],
    maxInlineUrls: 1,
  });

  assert.equal(countRawUrls(result.competitiveLandscape), 1);
  assert.match(result.sources, /Existing Source/); // original content preserved
  assert.match(result.sources, /R-extra-2/);
  assert.match(result.sources, /R-extra-3/);
  assert.equal(countRawUrls(result.sources), 0, "appended lines must never introduce raw URLs into Sources");
  // Preserves all substantive competitor names.
  assert.match(result.competitiveLandscape, /Alpha Corp/);
  assert.match(result.competitiveLandscape, /Beta Inc/);
  assert.match(result.competitiveLandscape, /Gamma LLC/);
});

test("enforceInlineRawUrlLimitAcrossSections is a no-op when every field is already within the limit", () => {
  const sections = {
    competitiveLandscape: "Alpha Corp is the market leader (https://alpha.example.com/a).",
    sources: "- [R1] Alpha overview | Publisher: Example Wire",
  };

  const result = enforceInlineRawUrlLimitAcrossSections({
    sections,
    sourceFields: ["sources"],
    maxInlineUrls: 1,
  });

  assert.deepEqual(result, sections);
});
