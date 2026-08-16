import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVendorCandidateMentions,
  isOfficialVendorEvidence,
} from "../app/lib/ai/vendor-discovery.ts";

function evidence(overrides = {}) {
  return {
    id: overrides.id || "e1",
    field: overrides.field || "competitors",
    claim: overrides.claim || "",
    value: overrides.value || "",
    sourceTitle: overrides.sourceTitle || "",
    publisher: overrides.publisher ?? "",
    sourceType: overrides.sourceType || "credible publication",
    url: overrides.url,
    authorityLevel: overrides.authorityLevel || "secondary",
    publishedDate: overrides.publishedDate || "2026-01-01",
    lastChecked: overrides.lastChecked || new Date().toISOString(),
    label: overrides.label || "Verified from external source",
    confidence: overrides.confidence ?? 80,
    qualityScore: overrides.qualityScore,
    supportingData: overrides.supportingData || [],
    impact: overrides.impact || "neutral",
    impactReason: overrides.impactReason || "",
    searchQuery: overrides.searchQuery || "",
  };
}

test("a real vendor's own substantial press-release page (not thin, no heuristic-matching phrasing) is discovered via domain fallback", () => {
  // Reproduces a real, live-observed defect: "Autonomous drones meet LEA
  // Reply: Real-time inventory at LogiMAT 2026 | Reply", a full page
  // hosted on reply.com's own newsroom, produced zero vendor candidates --
  // heuristic extraction found no match (its phrasing doesn't fit any of
  // mentionPatterns' narrow sentence shapes) and domain-fallback (Path C)
  // was gated to isThinDomainOnlyEvidence, which this substantial article
  // fails (it has real content, so it isn't "thin").
  const item = evidence({
    field: "competitors",
    claim: "Autonomous drones meet LEA Reply: Real-time inventory at LogiMAT 2026",
    sourceTitle: "Autonomous drones meet LEA Reply: Real-time inventory at LogiMAT 2026 | Reply",
    sourceType: "company_news",
    url: "https://www.reply.com/en/newsroom/events/autonomous-reply-at-logimat-2026",
  });

  const mentions = extractVendorCandidateMentions([item], null);
  assert.ok(
    mentions.some((m) => m.matchedBy === "domain_fallback" && /reply/i.test(m.name)),
    `expected a domain_fallback mention for reply.com, got: ${JSON.stringify(mentions)}`
  );
});

test("isOfficialVendorEvidence also recognizes a newsroom/press-release URL path, not just product/pricing/solutions", () => {
  const domains = ["reply.com"];
  const item = evidence({
    sourceType: "company_news",
    sourceTitle: "Autonomous drones meet LEA Reply | Reply",
    url: "https://www.reply.com/en/newsroom/events/autonomous-reply-at-logimat-2026",
  });
  assert.equal(isOfficialVendorEvidence(item, domains), true);
});

test("a third-party trade publication's article (substantial, but not self-published) is NOT discovered via domain fallback", () => {
  // Reproduces the over-widening this test suite's companion fix had to
  // correct: naively dropping the "thin" requirement from Path C let a
  // media outlet merely reporting on the market (an article on
  // inboundlogistics.com) be named as if IT were a vendor.
  const item = evidence({
    field: "competitors",
    claim: "Inventory tracking solution: a high-flying success",
    sourceTitle: "Inventory Tracking Solution: A High-Flying Success",
    sourceType: "credible publication",
    url: "https://www.inboundlogistics.com/articles/inventory-tracking-solution-a-high-flying-success/",
  });

  const mentions = extractVendorCandidateMentions([item], null);
  assert.ok(
    !mentions.some((m) => /inboundlogistics/i.test(m.name)),
    `must not mint "Inboundlogistics" as a vendor from third-party coverage, got: ${JSON.stringify(mentions)}`
  );
});

test("domain-fallback still applies to genuinely thin, bare-domain evidence (no regression)", () => {
  const item = evidence({
    field: "competitors",
    claim: "",
    value: "",
    sourceTitle: "",
    sourceType: "credible publication",
    url: "https://www.smallwarehousedrones.example/",
    supportingData: [],
  });

  const mentions = extractVendorCandidateMentions([item], null);
  assert.ok(
    mentions.some((m) => m.matchedBy === "domain_fallback"),
    "thin bare-domain evidence should still produce a domain-fallback candidate"
  );
});
