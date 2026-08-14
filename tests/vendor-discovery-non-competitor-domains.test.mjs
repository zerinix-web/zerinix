import test from "node:test";
import assert from "node:assert/strict";
import { extractVendorCandidateMentions } from "../app/lib/ai/vendor-discovery.ts";

function thinEvidence({ id, url, sourceTitle = "" }) {
  return {
    id,
    field: "vendor_discovery",
    claim: sourceTitle,
    value: sourceTitle,
    label: "Verified from external source",
    sourceTitle,
    publisher: "",
    url,
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 60,
    publishedDate: "2026-01-01",
    lastChecked: new Date().toISOString(),
    supportingData: [],
    impact: "neutral",
    impactReason: "",
  };
}

function richEvidence({ id, url, claim }) {
  return {
    ...thinEvidence({ id, url, sourceTitle: claim }),
    claim,
    value: claim,
  };
}

const noiseDomains = [
  "https://unpkg.com/some-package@1.0.0/dist/bundle.js",
  "https://cdn.jsdelivr.net/npm/some-lib",
  "https://docs.stripe.com/api/some-endpoint",
  "https://github.com/some-org/some-repo",
  "https://medium.com/@author/some-article-slug",
  "https://indeed.com/jobs?q=customer+support",
  "https://zendesk.com/help/some-article",
  "https://support.acmewidgets.com/hc/en-us",
  "https://crunchbase.com/organization/some-company",
];

test("domain-fallback path (Path C) never mints a vendor from a CDN/docs/github/blog/recruiting/support/directory URL", () => {
  for (const url of noiseDomains) {
    const evidence = [thinEvidence({ id: "e1", url })];
    const mentions = extractVendorCandidateMentions(evidence, null);
    assert.equal(
      mentions.length,
      0,
      `expected no vendor mention from thin evidence on ${url}, got ${JSON.stringify(mentions)}`
    );
  }
});

test("domain-fallback path (Path C) still discovers a genuine small business from an ordinary thin-evidence domain (no regression)", () => {
  const evidence = [thinEvidence({ id: "e1", url: "https://acmewidgetsupply.com/" })];
  const mentions = extractVendorCandidateMentions(evidence, null);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].matchedBy, "domain_fallback");
  assert.match(mentions[0].name, /Acmewidgetsupply/i);
});

test("a real competitor named in evidence prose is discovered even when the evidence happens to be hosted on an excluded domain shape (never removes a real competitor)", () => {
  const evidence = [
    richEvidence({
      id: "e1",
      url: "https://zendesk.com/help/some-article",
      claim: "Zendesk offers AI-powered customer support with automated ticket routing.",
    }),
  ];
  const mentions = extractVendorCandidateMentions(evidence, null);
  const names = mentions.map((mention) => mention.name);
  assert.ok(
    names.some((name) => /zendesk/i.test(name)),
    `expected Zendesk to still be discovered via heuristic text mention, got ${JSON.stringify(names)}`
  );
  assert.ok(mentions.every((mention) => mention.matchedBy !== "domain_fallback"));
});
