import assert from "node:assert/strict";
import test from "node:test";
import {
  findDuplicateCitationSources,
  assertNoDuplicateCitationSources,
  DuplicateCitationSourceError,
} from "../app/lib/report-engine/evidence-reference-integrity.ts";

// TASK #29D -- Fix the REAL Market Intelligence report-generation failure
// caused by false duplicate-source detection.
//
// ROOT CAUSE (confirmed live, real generation failure): the citation-
// integrity layer's duplicate-source check
// (findDuplicateCitationSources/assertNoDuplicateCitationSources,
// evidence-reference-integrity.ts) grouped sources by normalized
// title+publisher alone, then flagged any group spanning 2+ distinct URL
// strings as a duplicate. The design's own comment stated "two unrelated
// documents essentially never share both an exact title and an exact
// publisher" -- true for byline journalism, false for user-generated/
// forum platforms: when the evidence pipeline cannot extract a real
// per-page title for a page on a UGC domain, it falls back to the bare
// domain for BOTH title and publisher (e.g. "reddit.com"/"reddit.com").
// Every distinct, unrelated thread on that domain then collides onto the
// identical key. Confirmed live: two genuinely different Reddit threads,
// evidence ids R40 and R87, were flagged as duplicates of each other and
// blocked an otherwise-complete report from generating at all.
//
// FIX: findDuplicateCitationSources now groups by normalized URL
// identity (host, lowercased, "www." stripped; path with a trailing
// slash stripped; query string with utm_/fbclid/gclid tracking
// parameters stripped) instead of title+publisher. Title and publisher
// no longer participate in the identity decision at all -- two sources
// are the same source if and only if they resolve to the same document
// location, regardless of what title/publisher text is attached to them.
// This works generically for Reddit or any other UGC/forum-shaped
// domain without naming Reddit anywhere in the fix itself.

function citationSource({ evidenceId, title, publisher, url }) {
  return { evidenceId, title, publisher, url };
}

test("A. same publisher + same generic title + different canonical URLs => allowed (the exact real R40/R87 Reddit shape)", () => {
  const sources = [
    citationSource({
      evidenceId: "R40",
      title: "reddit.com",
      publisher: "reddit.com",
      url: "https://www.reddit.com/r/legaltech/comments/abc123/clm_vendor_comparison_thread/",
    }),
    citationSource({
      evidenceId: "R87",
      title: "reddit.com",
      publisher: "reddit.com",
      url: "https://www.reddit.com/r/artificial/comments/def456/ai_contract_review_accuracy/",
    }),
  ];

  const duplicates = findDuplicateCitationSources(sources);
  assert.equal(duplicates.length, 0, "two genuinely distinct threads must never be flagged, even sharing an identical generic title and publisher");
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(sources));
});

test("A2. the fix is generic, not Reddit-specific: any UGC/forum-shaped domain with a repeated generic title+publisher fallback behaves identically", () => {
  const forumDomains = ["stackoverflow.com", "quora.com", "news.ycombinator.com", "discourse.example.com"];
  for (const domain of forumDomains) {
    const sources = [
      citationSource({ evidenceId: "R1", title: domain, publisher: domain, url: `https://${domain}/questions/1111/first-thread` }),
      citationSource({ evidenceId: "R2", title: domain, publisher: domain, url: `https://${domain}/questions/2222/second-thread` }),
    ];
    assert.equal(findDuplicateCitationSources(sources).length, 0, `${domain}: distinct threads must never be flagged`);
  }
});

test("B. same canonical URL under multiple evidence IDs => duplicate detected", () => {
  const sources = [
    citationSource({ evidenceId: "R5", title: "Vendor Pricing Page", publisher: "Acme", url: "https://acme.com/pricing" }),
    citationSource({ evidenceId: "R9", title: "Vendor Pricing Page (mirror)", publisher: "Acme Inc", url: "https://acme.com/pricing" }),
  ];

  const duplicates = findDuplicateCitationSources(sources);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].evidenceIds.sort(), ["R5", "R9"]);
  assert.throws(() => assertNoDuplicateCitationSources(sources), DuplicateCitationSourceError);
});

test("C. URL normalization variants of the same document => duplicate detected", () => {
  const variantGroups = [
    ["https://example.com/report", "http://example.com/report"], // protocol
    ["https://example.com/report", "https://www.example.com/report"], // www subdomain
    ["https://example.com/report", "https://example.com/report/"], // trailing slash
    ["https://example.com/report", "https://EXAMPLE.com/REPORT".replace("REPORT", "report")], // host case
    ["https://example.com/report?utm_source=newsletter&id=5", "https://example.com/report?id=5"], // tracking param stripped, real param kept
  ];

  for (const [urlA, urlB] of variantGroups) {
    const sources = [
      citationSource({ evidenceId: "R1", title: "Report A", publisher: "Pub A", url: urlA }),
      citationSource({ evidenceId: "R2", title: "Report B", publisher: "Pub B", url: urlB }),
    ];
    const duplicates = findDuplicateCitationSources(sources);
    assert.equal(duplicates.length, 1, `expected "${urlA}" and "${urlB}" to normalize to the same document`);
    assert.deepEqual(duplicates[0].evidenceIds.sort(), ["R1", "R2"]);
  }
});

test("C2. a real, meaningful query-string difference is NOT stripped and correctly distinguishes two different documents", () => {
  const sources = [
    citationSource({ evidenceId: "R1", title: "Forum Thread", publisher: "example.com", url: "https://example.com/thread?id=111" }),
    citationSource({ evidenceId: "R2", title: "Forum Thread", publisher: "example.com", url: "https://example.com/thread?id=222" }),
  ];
  assert.equal(findDuplicateCitationSources(sources).length, 0, "a real, non-tracking query parameter is a meaningful discriminator, not noise to strip");
});

test("D. existing citation-integrity failures remain blocked: an actual duplicate is still caught even with completely different, unrelated title/publisher text", () => {
  const sources = [
    citationSource({ evidenceId: "R3", title: "Original headline", publisher: "Publisher One", url: "https://news.example.com/story/42" }),
    citationSource({ evidenceId: "R8", title: "A totally different, unrelated headline", publisher: "A Different Publisher LLC", url: "https://news.example.com/story/42" }),
  ];
  assert.throws(() => assertNoDuplicateCitationSources(sources), DuplicateCitationSourceError, "the same underlying document must still be caught regardless of how different its title/publisher metadata looks");
});

test("D2. an empty or unparseable URL never crashes the check and is never treated as matching another empty URL", () => {
  const sources = [
    citationSource({ evidenceId: "R1", title: "No URL Source A", publisher: "Unknown", url: "" }),
    citationSource({ evidenceId: "R2", title: "No URL Source B", publisher: "Unknown", url: "" }),
    citationSource({ evidenceId: "R3", title: "Malformed", publisher: "Unknown", url: "not a url at all" }),
  ];
  assert.doesNotThrow(() => findDuplicateCitationSources(sources));
  assert.equal(findDuplicateCitationSources(sources).length, 0);
  assert.doesNotThrow(() => assertNoDuplicateCitationSources(sources));
});

test("D3. bare (schemeless) identical strings still match as a last-resort fallback, never silently ignored", () => {
  const sources = [
    citationSource({ evidenceId: "R1", title: "Bare A", publisher: "X", url: "reddit.com/r/test/comments/1" }),
    citationSource({ evidenceId: "R2", title: "Bare B", publisher: "Y", url: "reddit.com/r/test/comments/1" }),
  ];
  assert.equal(findDuplicateCitationSources(sources).length, 1, "identical bare strings (no scheme) are still the same document");
});

test("determinism: repeated runs over the same input produce identical results", () => {
  const sources = [
    citationSource({ evidenceId: "R40", title: "reddit.com", publisher: "reddit.com", url: "https://www.reddit.com/r/a/comments/1/" }),
    citationSource({ evidenceId: "R87", title: "reddit.com", publisher: "reddit.com", url: "https://www.reddit.com/r/b/comments/2/" }),
    citationSource({ evidenceId: "R5", title: "Pricing", publisher: "Acme", url: "https://acme.com/pricing" }),
    citationSource({ evidenceId: "R9", title: "Pricing mirror", publisher: "Acme", url: "https://acme.com/pricing" }),
  ];
  const runs = Array.from({ length: 10 }, () => findDuplicateCitationSources(sources));
  for (const run of runs) {
    assert.deepEqual(run, runs[0]);
  }
  assert.equal(runs[0].length, 1);
  assert.deepEqual(runs[0][0].evidenceIds.sort(), ["R5", "R9"]);
});
