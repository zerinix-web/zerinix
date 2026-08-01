import test from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceCollector,
  EvidenceDeduplicator,
  EvidenceNormalizer,
  EvidenceRanker,
  assessEvidenceReliability,
  buildEvidenceSearchText,
  extractEvidenceFacts,
} from "../app/lib/research-evidence/index.mjs";

const collectedAt = "2026-07-27T10:00:00.000Z";
const referenceDate = "2026-07-27T10:00:00.000Z";

test("EvidenceNormalizer canonicalizes metadata, URLs, dates, language, and facts", () => {
  const normalizer = new EvidenceNormalizer();
  const evidence = normalizer.normalize(
    {
      title: "  <b>World Bank Market Update</b>  ",
      source: " World Bank ",
      url: "https://www.worldbank.org//report/?utm_source=test#section",
      publishedAt: "2026-05-04",
      snippet:
        "The market reached $12 million in 2024. General background follows.",
      relevanceScore: 84.4,
    },
    { collectedAt }
  );

  assert.equal(evidence.title, "World Bank Market Update");
  assert.equal(evidence.url, "https://www.worldbank.org/report");
  assert.equal(evidence.publishedAt, "2026-05-04T00:00:00.000Z");
  assert.equal(evidence.evidenceType, "Government");
  assert.equal(evidence.language, "en");
  assert.equal(evidence.relevanceScore, 84);
  assert.deepEqual(evidence.extractedFacts, [
    "The market reached $12 million in 2024.",
  ]);
  assert.equal(evidence.provenance[0].collector, "EvidenceCollector");
});

test("entity relevance text retains facts found in provider snippets and claims", () => {
  const searchText = buildEvidenceSearchText({
    title: "Municipality planning notice",
    source: "defne.bel.tr",
    url: "https://www.defne.bel.tr/plan/notice",
    claim:
      "Hatay Defne Dursunlu Mahallesi 1517 ada 1 parsel için plan kaydı incelendi.",
    value: "Dursunlu plan kaydı",
    supportingData: ["Ada 1517", "Parsel 1"],
  });

  assert.match(searchText, /dursunlu/);
  assert.match(searchText, /ada 1517/);
  assert.match(searchText, /parsel 1/);
});

test("source reliability favors government and filings over news, company, and AI evidence", () => {
  const government = assessEvidenceReliability({
    title: "Official statistics",
    url: "https://data.gov/series",
    evidenceType: "Government",
  });
  const filing = assessEvidenceReliability({
    title: "Form 10-K",
    url: "https://www.sec.gov/filing",
    evidenceType: "Financial Filing",
  });
  const news = assessEvidenceReliability({
    title: "Market update",
    url: "https://reuters.com/markets/update",
    evidenceType: "News",
  });
  const ai = assessEvidenceReliability({
    title: "AI-derived analysis",
    evidenceType: "AI Generated",
  });

  assert.ok(filing > government);
  assert.ok(government > news);
  assert.ok(news > ai);
});

test("EvidenceDeduplicator removes canonical URL duplicates and preserves provenance", () => {
  const normalizer = new EvidenceNormalizer();
  const deduplicator = new EvidenceDeduplicator();
  const items = normalizer.normalizeAll(
    [
      {
        title: "OECD Digital Economy Outlook",
        source: "OECD",
        url: "https://oecd.org/digital/outlook?utm_campaign=test",
        snippet: "Adoption reached 42% in 2025.",
        provenance: [
          {
            collector: "fixture-a",
            sourceId: "a",
            collectedAt,
          },
        ],
      },
      {
        title: "OECD Digital Economy Outlook 2025",
        source: "OECD Research",
        url: "https://oecd.org/digital/outlook",
        snippet:
          "Adoption reached 42% in 2025. The report was published by OECD.",
        provenance: [
          {
            collector: "fixture-b",
            sourceId: "b",
            collectedAt,
          },
        ],
      },
    ],
    { collectedAt }
  );
  const result = deduplicator.deduplicate(items);

  assert.equal(result.length, 1);
  assert.equal(result[0].duplicateCount, 1);
  assert.equal(result[0].provenance.length, 2);
  assert.match(result[0].snippet, /published by OECD/);
});

test("EvidenceRanker prefers authoritative and current evidence while penalizing stale and AI evidence", () => {
  const normalizer = new EvidenceNormalizer();
  const ranker = new EvidenceRanker();
  const items = normalizer.normalizeAll(
    [
      {
        title: "Current government dataset",
        source: "World Bank",
        url: "https://worldbank.org/current-data",
        publishedAt: "2026-06-01",
        relevanceScore: 75,
        evidenceType: "Government",
      },
      {
        title: "Old market article",
        source: "Reuters",
        url: "https://reuters.com/old-market",
        publishedAt: "2020-01-01",
        relevanceScore: 90,
        evidenceType: "News",
      },
      {
        title: "Model interpretation",
        source: "ZERINIX",
        snippet: "AI-derived analysis (not externally verified).",
        relevanceScore: 100,
        reliabilityScore: 100,
        evidenceType: "AI Generated",
      },
    ],
    { collectedAt }
  );
  const ranked = ranker.rank(items, { referenceDate });

  assert.equal(ranked[0].title, "Current government dataset");
  assert.ok(
    ranked.find((item) => item.title === "Old market article").rankingScore <
      ranked[0].rankingScore
  );
  assert.ok(
    ranked.find((item) => item.title === "Model interpretation")
      .reliabilityScore <= 35
  );
});

test("independent sources confirming the same extracted fact receive a confirmation boost", () => {
  const normalizer = new EvidenceNormalizer();
  const ranker = new EvidenceRanker();
  const confirmedFact = "The category reached $25 billion in 2025.";
  const items = normalizer.normalizeAll(
    [
      {
        title: "Government category data",
        source: "Data.gov",
        url: "https://data.gov/category",
        snippet: confirmedFact,
        evidenceType: "Government",
      },
      {
        title: "Academic category study",
        source: "Example University",
        url: "https://example.edu/category-study",
        snippet: confirmedFact,
        evidenceType: "Research Paper",
      },
    ],
    { collectedAt }
  );
  const ranked = ranker.rank(items, { referenceDate });

  assert.equal(ranked[0].independentConfirmations, 1);
  assert.equal(ranked[1].independentConfirmations, 1);
});

test("duplicate evidence receives a ranking penalty after merging", () => {
  const normalizer = new EvidenceNormalizer();
  const deduplicator = new EvidenceDeduplicator();
  const ranker = new EvidenceRanker();
  const normalized = normalizer.normalizeAll(
    [
      {
        title: "Company metrics",
        source: "Alpha",
        url: "https://alpha.example/metrics",
        relevanceScore: 70,
        reliabilityScore: 70,
      },
      {
        title: "Company metrics",
        source: "Alpha",
        url: "https://alpha.example/metrics?utm_source=copy",
        relevanceScore: 70,
        reliabilityScore: 70,
      },
      {
        title: "Independent company metrics",
        source: "Beta",
        url: "https://beta.example/metrics",
        relevanceScore: 70,
        reliabilityScore: 70,
      },
    ],
    { collectedAt }
  );
  const ranked = ranker.rank(deduplicator.deduplicate(normalized), {
    referenceDate,
  });
  const duplicate = ranked.find((item) => item.source === "Alpha");
  const unique = ranked.find((item) => item.source === "Beta");

  assert.equal(duplicate.duplicateCount, 1);
  assert.ok(duplicate.rankingScore < unique.rankingScore);
});

test("fact extraction keeps quantified and attributable claims while dropping commentary", () => {
  const facts = extractEvidenceFacts(
    "Revenue grew 18% in 2025. The company described its strategy. Reuters reported that the filing was delayed."
  );

  assert.deepEqual(facts, [
    "Revenue grew 18% in 2025.",
    "Reuters reported that the filing was delayed.",
  ]);
});

test("evidence merging keeps the richest content, unique facts, and all provenance", () => {
  const normalizer = new EvidenceNormalizer();
  const deduplicator = new EvidenceDeduplicator();
  const left = normalizer.normalize(
    {
      title: "Annual filing",
      source: "SEC",
      url: "https://sec.gov/company/filing",
      snippet: "Revenue was $8 million in 2025.",
      evidenceType: "Financial Filing",
      provenance: [{ collector: "filings", sourceId: "one", collectedAt }],
    },
    { collectedAt }
  );
  const right = normalizer.normalize(
    {
      title: "Company annual filing for fiscal year 2025",
      source: "SEC EDGAR",
      url: "https://sec.gov/company/filing",
      snippet:
        "Revenue was $8 million in 2025. Gross margin reached 61% in 2025.",
      evidenceType: "Financial Filing",
      provenance: [{ collector: "edgar", sourceId: "two", collectedAt }],
    },
    { collectedAt }
  );
  const merged = deduplicator.merge(left, right);

  assert.equal(merged.title, "Company annual filing for fiscal year 2025");
  assert.equal(merged.provenance.length, 2);
  assert.equal(merged.extractedFacts.length, 2);
  assert.equal(merged.duplicateCount, 1);
});

test("EvidenceCollector orchestrates normalization, deduplication, and ranking without network access", () => {
  const collector = new EvidenceCollector();
  const result = collector.collect(
    [
      {
        title: "Official labor data",
        source: "BLS",
        url: "https://bls.gov/data?utm_source=one",
        publishedAt: "2026-06-01",
        snippet: "Employment increased 4% in 2025.",
        evidenceType: "Government",
      },
      {
        title: "Official labor data",
        source: "BLS",
        url: "https://bls.gov/data",
        publishedAt: "2026-06-01",
        snippet: "Employment increased 4% in 2025.",
        evidenceType: "Government",
      },
    ],
    { collectedAt, referenceDate }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].duplicateCount, 1);
  assert.ok(result[0].rankingScore > 0);
});
