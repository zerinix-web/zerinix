import assert from "node:assert/strict";
import test from "node:test";
import { compressResearchEvidence } from "../app/lib/ai/evidence-compression.ts";

function evidence(index, overrides = {}) {
  return {
    id: `R${index}`,
    field: index % 2 ? "zoning" : "comparables",
    claim: `Dursunlu için doğrulanmış bulgu ${index}`,
    value: `Bu, ham sayfa içeriği yerine kullanılan yapılandırılmış destekleyici bulgudur ${index}.`,
    label: "Verified from external source",
    sourceTitle: `Kaynak ${index}`,
    publisher: `Kurum ${index}`,
    url: `https://example${index}.gov.tr/kayit/${index}?utm_source=test`,
    sourceType: "official_record",
    authorityLevel: "secondary",
    confidence: 70 + (index % 20),
    publishedDate: "2026-07-01",
    lastChecked: "2026-07-31",
    supportingData: ["A".repeat(220), "B".repeat(180)],
    impact: "neutral",
    impactReason: "Doğrudan karar kanıtı",
    qualityScore: 75 + (index % 20),
    ...overrides,
  };
}

test("evidence compression limits, ranks, deduplicates, and structures final context", () => {
  const raw = Array.from({ length: 12 }, (_, index) => evidence(index + 1));
  raw.push(
    evidence(99, {
      field: "zoning",
      claim: "Dursunlu için doğrulanmış bulgu 1",
      value: "Aynı bulguyu doğrulayan ikinci resmî kayıt.",
      authorityLevel: "primary",
      confidence: 98,
      qualityScore: 99,
      url: "https://official.gov.tr/plan/1",
    })
  );

  const result = compressResearchEvidence(raw);

  assert.ok(result.evidence.length <= 10);
  assert.equal(result.metrics.rawEvidenceCount, 13);
  assert.equal(result.metrics.compressedEvidenceCount, result.evidence.length);
  assert.ok(
    result.metrics.contextCharactersAfter <
      result.metrics.contextCharactersBefore
  );
  assert.equal(
    result.metrics.tokensEstimated,
    Math.ceil(result.metrics.contextCharactersAfter / 4)
  );
  assert.deepEqual(Object.keys(result.evidence[0]), [
    "title",
    "source",
    "claim",
    "supportingFacts",
    "confidence",
    "date",
    "relevanceScore",
  ]);
  assert.ok(result.evidence.every((item) => JSON.stringify(item).length <= 600));
  assert.match(result.evidence[0].source, /official\.gov\.tr/);
  assert.equal(
    result.evidence.filter((item) =>
      item.claim === "Dursunlu için doğrulanmış bulgu 1"
    ).length,
    1
  );
});
